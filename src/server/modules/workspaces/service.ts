import { ONBOARDING_STEPS, type OnboardingStep, type WorkspaceDto } from "@/contracts/workspaces";
import { conflict, DomainError } from "@/domain/shared/errors";
import { addDays } from "@/domain/subscriptions/entitlements";
import type { TransactionRunner } from "@/infrastructure/database/interfaces/transaction";

import { recordAudit } from "../../audit/audit-service";
import type { WorkspaceScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta, type UserActor } from "../../context";
import type { Clock } from "../../ports/observability";
import type { EntitlementService } from "../../subscriptions/entitlement-service";
import type { WorkspaceRepos } from "./ports";

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

export interface WorkspaceServiceDeps {
  tx: TransactionRunner<WorkspaceRepos>;
  /** Owner-level runner for `create` only: the new workspace has no tenant context yet. */
  bootstrap: TransactionRunner<{
    workspaces: Pick<
      WorkspaceRepos["workspaces"],
      | "slugExists"
      | "insert"
      | "findSystemRoleId"
      | "insertMembership"
      | "findPlanByKey"
      | "insertOrganization"
      | "insertOrganizationMember"
      | "insertSubscription"
    >;
    audit: WorkspaceRepos["audit"];
  }>;
  clock: Clock;
  entitlements: EntitlementService;
}

export function createWorkspaceService({
  tx,
  bootstrap,
  clock,
  entitlements,
}: WorkspaceServiceDeps) {
  return {
    /**
     * Create an organization (the billing owner) with its first workspace,
     * owned by the actor, and start the organization's free trial. The trial
     * plan and length come from platform settings (Super Admin), never code.
     */
    async create(
      actor: UserActor,
      input: { name: string; defaultCurrency: string; country: string },
      meta: RequestMeta,
    ): Promise<WorkspaceDto> {
      const settings = await entitlements.getPlatformSettings();
      return bootstrap.run(async (r) => {
        const base = slugify(input.name);
        let slug = base;
        for (let i = 0; await r.workspaces.slugExists(slug); i++) {
          if (i > 20) throw conflict("Could not allocate a workspace URL; try another name");
          slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
        }
        const org = await r.workspaces.insertOrganization({
          name: input.name,
          createdBy: actor.userId,
        });
        await r.workspaces.insertOrganizationMember({
          organizationId: org.id,
          userId: actor.userId,
          role: "OWNER",
        });
        const ws = await r.workspaces.insert({
          ...input,
          organizationId: org.id,
          slug,
          createdBy: actor.userId,
        });
        const ownerRole = await r.workspaces.findSystemRoleId("workspace_owner");
        await r.workspaces.insertMembership({
          workspaceId: ws.id,
          userId: actor.userId,
          roleId: ownerRole,
        });

        const plan = await r.workspaces.findPlanByKey(settings.trialPlanKey);
        if (!plan)
          throw new DomainError("CONFLICT", "No trial plan is configured. Contact support.");
        const now = clock.now();
        await r.workspaces.insertSubscription({
          organizationId: org.id,
          workspaceId: ws.id,
          planId: plan.id,
          planKey: plan.key,
          status: "TRIALING",
          trialStartsAt: now,
          trialEndsAt: addDays(now, settings.trialDays),
          actorUserId: actor.userId,
        });
        await recordAudit(
          r.audit,
          auditActorFor(actor, meta),
          "workspace.created",
          {
            workspaceId: ws.id,
            targetType: "workspace",
            targetId: ws.id,
          },
          { organizationId: org.id, trialDays: settings.trialDays, planKey: plan.key },
        );
        return ws;
      });
    },

    async get(scope: WorkspaceScope): Promise<WorkspaceDto> {
      scope.require("workspace.view");
      const ws = await tx.read((r) => r.workspaces.findById(scope.workspaceId));
      if (!ws) throw new DomainError("NOT_FOUND", "Workspace not found");
      return ws;
    },

    async update(
      scope: WorkspaceScope,
      patch: Partial<
        Pick<
          WorkspaceDto,
          | "name"
          | "legalName"
          | "businessEmail"
          | "businessPhone"
          | "country"
          | "taxId"
          | "defaultCurrency"
        >
      >,
      expectedVersion: number | undefined,
      meta: RequestMeta,
    ): Promise<WorkspaceDto> {
      scope.require("workspace.update");
      return tx.run(async (r) => {
        const updated = await r.workspaces.update(scope.workspaceId, patch, expectedVersion);
        if (!updated) {
          throw new DomainError(
            "STALE_VERSION",
            "This workspace was changed by someone else. Reload and try again.",
          );
        }
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "workspace.updated",
          {
            workspaceId: scope.workspaceId,
            targetType: "workspace",
            targetId: scope.workspaceId,
          },
          { fields: Object.keys(patch) },
        );
        return updated;
      });
    },

    /** Persist onboarding progress so the guided setup can be resumed. */
    async updateOnboarding(
      scope: WorkspaceScope,
      input: {
        completedStep?: OnboardingStep;
        currentStep?: OnboardingStep | null;
        restaurantId?: string | null;
        branchId?: string | null;
        dismiss?: boolean;
      },
    ): Promise<WorkspaceDto["onboarding"]> {
      scope.require("workspace.update");
      return tx.run(async (r) => {
        const ws = await r.workspaces.findById(scope.workspaceId);
        if (!ws) throw new DomainError("NOT_FOUND", "Workspace not found");
        const completed = new Set(ws.onboarding.completedSteps);
        if (input.completedStep) completed.add(input.completedStep);
        const ordered = ONBOARDING_STEPS.filter((s) => completed.has(s));
        const firstOpen = ONBOARDING_STEPS.find((s) => !completed.has(s)) ?? "done";
        const next = {
          completedSteps: ordered,
          currentStep: input.currentStep !== undefined ? input.currentStep : firstOpen,
          restaurantId:
            input.restaurantId !== undefined
              ? input.restaurantId
              : (ws.onboarding.restaurantId ?? null),
          branchId:
            input.branchId !== undefined ? input.branchId : (ws.onboarding.branchId ?? null),
          dismissedAt: input.dismiss
            ? clock.now().toISOString()
            : (ws.onboarding.dismissedAt ?? null),
        };
        await r.workspaces.setOnboarding(scope.workspaceId, next);
        return next;
      });
    },
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
