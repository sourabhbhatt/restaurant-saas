import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  type OrganizationSummaryDto,
  type WorkspaceDto,
} from "@ros/contracts/workspaces";
import { DomainError, conflict, isDomainError, notFound } from "@ros/domain/shared/errors";
import { addDays, assertOperationAllowed } from "@ros/domain/subscriptions/entitlements";
import { assertCanCreateWorkspace } from "@ros/domain/subscriptions/workspace-limit";
import type { TransactionRunner } from "@ros/database/interfaces/transaction";

import { recordAudit } from "../../audit/audit-service";
import type { WorkspaceScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta, type UserActor } from "../../context";
import type { Clock, Logger } from "../../ports/observability";
import { noServerTracking, trackSafely, type ServerTracking } from "../../ports/server-tracking";
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
      | "hasStartedTrial"
      | "lockOrganization"
      | "countOrganizationWorkspaces"
      | "insertOrganization"
      | "insertOrganizationMember"
      | "insertSubscription"
    >;
    audit: WorkspaceRepos["audit"];
  }>;
  clock: Clock;
  entitlements: EntitlementService;
  /** Growth events (`trial_started`). Default: none. */
  tracking?: ServerTracking;
  logger?: Logger;
}

export function createWorkspaceService({
  tx,
  bootstrap,
  clock,
  entitlements,
  tracking = noServerTracking,
  logger,
}: WorkspaceServiceDeps) {
  type Bootstrap = Parameters<Parameters<WorkspaceServiceDeps["bootstrap"]["run"]>[0]>[0];

  async function allocateSlug(repo: Bootstrap["workspaces"], name: string): Promise<string> {
    const base = slugify(name);
    let slug = base;
    for (let i = 0; await repo.slugExists(slug); i++) {
      if (i > 20) throw conflict("Could not allocate a workspace URL; try another name");
      slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
    }
    return slug;
  }

  /** First workspace: a new organization owned by the actor, on a trial (once per person). */
  async function createOrganization(
    actor: UserActor,
    input: { name: string; defaultCurrency: string; country: string },
    meta: RequestMeta,
  ): Promise<WorkspaceDto> {
    const settings = await entitlements.getPlatformSettings();
    // Trials are per person, not per organization (spec section 7.1).
    if (await bootstrap.read((r) => r.workspaces.hasStartedTrial(actor.userId))) {
      throw new DomainError(
        "TRIAL_ALREADY_USED",
        "You have already used a free trial. Upgrade your existing organization to add workspaces.",
      );
    }
    const created = await bootstrap.run(async (r) => {
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
        name: input.name,
        defaultCurrency: input.defaultCurrency,
        country: input.country,
        organizationId: org.id,
        slug: await allocateSlug(r.workspaces, input.name),
        createdBy: actor.userId,
      });
      await r.workspaces.insertMembership({
        workspaceId: ws.id,
        userId: actor.userId,
        roleId: await r.workspaces.findSystemRoleId("workspace_owner"),
      });

      const plan = await r.workspaces.findPlanByKey(settings.trialPlanKey);
      if (!plan) throw new DomainError("CONFLICT", "No trial plan is configured. Contact support.");
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
        { workspaceId: ws.id, targetType: "workspace", targetId: ws.id },
        { organizationId: org.id, trialDays: settings.trialDays, planKey: plan.key },
      );
      return { ws, planKey: plan.key };
    });
    // Committed: one trial per person, so this fires once per trial.
    trackSafely(
      tracking,
      logger,
      {
        name: "trial_started",
        params: { plan_key: created.planKey, trial_days: settings.trialDays },
      },
      { analytics: meta.analytics },
    );
    return created.ws;
  }

  return {
    /**
     * Create a workspace for the actor. The first workspace creates an
     * organization (the billing owner) and starts its free trial; later ones
     * join an organization the actor owns, within its workspace limit (spec
     * section 7.2). The trial plan and length come from platform settings.
     */
    async create(
      actor: UserActor,
      input: { name: string; defaultCurrency: string; country: string; organizationId?: string },
      meta: RequestMeta,
    ): Promise<WorkspaceDto> {
      const owned = (
        await tx.read((r) => r.workspaces.listOrganizationsForUser(actor.userId))
      ).filter((o) => o.role === "OWNER");
      let target: { id: string } | null;
      if (input.organizationId) {
        // Hidden from non-owners, like every tenant resource.
        target = owned.find((o) => o.id === input.organizationId) ?? null;
        if (!target) throw notFound("Organization");
      } else if (owned.length <= 1) {
        target = owned[0] ?? null;
      } else {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Choose the organization for the new workspace",
          {
            fieldErrors: { organizationId: ["Choose an organization"] },
          },
        );
      }
      if (!target) return createOrganization(actor, input, meta);

      const limit = await entitlements.getOrganizationWorkspaceLimit(target.id);
      assertOperationAllowed(limit.entitlements, "grow");
      const outcome = await bootstrap.run(async (r) => {
        // The organization row is locked for the whole transaction, so concurrent
        // creations serialise and the counts below cannot race past the limit.
        await r.workspaces.lockOrganization(target.id);
        const counts = await r.workspaces.countOrganizationWorkspaces(
          target.id,
          addDays(clock.now(), -1),
        );
        try {
          assertCanCreateWorkspace({
            ...limit.input,
            currentWorkspaces: counts.total,
            createdLast24h: counts.createdSince,
            createsPerDay: limit.createsPerDay,
          });
        } catch (error) {
          const reason = isDomainError(error) ? error.details?.reason : undefined;
          if (isDomainError(error) && (reason === "FAIR_USE" || reason === "DAILY_LIMIT")) {
            await recordAudit(
              r.audit,
              auditActorFor(actor, meta),
              "organization.fair_use_limit_hit",
              { workspaceId: null, targetType: "organization", targetId: target.id },
              error.details,
            );
          }
          // Returned, not thrown, so the refusal's audit row commits.
          return { refused: error };
        }
        const ws = await r.workspaces.insert({
          ...input,
          organizationId: target.id,
          slug: await allocateSlug(r.workspaces, input.name),
          createdBy: actor.userId,
        });
        await r.workspaces.insertMembership({
          workspaceId: ws.id,
          userId: actor.userId,
          roleId: await r.workspaces.findSystemRoleId("workspace_owner"),
        });
        await recordAudit(
          r.audit,
          auditActorFor(actor, meta),
          "workspace.created",
          { workspaceId: ws.id, targetType: "workspace", targetId: ws.id },
          { organizationId: target.id, workspaceCount: counts.total + 1 },
        );
        return { ws };
      });
      if ("refused" in outcome) throw outcome.refused;
      return outcome.ws;
    },

    /** The actor's organizations with how many workspaces each may hold right now. */
    async listOrganizations(actor: UserActor): Promise<OrganizationSummaryDto[]> {
      const rows = await tx.read((r) => r.workspaces.listOrganizationsForUser(actor.userId));
      return Promise.all(
        rows.map(async (o) => ({
          ...o,
          maxWorkspaces: (await entitlements.getOrganizationWorkspaceLimit(o.id)).maxWorkspaces,
        })),
      );
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
