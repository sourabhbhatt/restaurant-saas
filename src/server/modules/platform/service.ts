import type { NotificationInput } from "@/contracts/notifications";
import type {
  ActivateSubscriptionInput,
  AdminAuditQuery,
  AdminPlanDto,
  AdminSettingsDto,
  AdminWorkspaceDetailDto,
  AdminWorkspaceListQuery,
  AdminWorkspaceRowDto,
  AnnouncementDto,
  AnnouncementInput,
  AuditLogDto,
  AuditQuery,
  CreateSupportRequestInput,
  CurrentSubscriptionDto,
  EntitlementOverrideInput,
  Paginated,
  PlanInput,
  PublicAnnouncementDto,
  PublicPlanDto,
  SubscriptionOverviewDto,
  SubscriptionSweepResult,
  SupportListQuery,
  SupportPriority,
  SupportRequestDetailDto,
  SupportRequestDto,
  SupportStatus,
} from "@/contracts/platform";
import { createSupportRequestSchema } from "@/contracts/platform";
import {
  extendedTrialEnd,
  periodEndFromDate,
  planSubscriptionSweep,
  remindersAfterExtension,
} from "@/domain/platform/subscription-sweep";
import { mergePlatformSettings, type PlatformSettings } from "@/domain/platform/settings";
import { conflict, DomainError, forbidden, notFound } from "@/domain/shared/errors";
import {
  FEATURES,
  resolveEntitlements,
  type WorkspaceStatus,
} from "@/domain/subscriptions/entitlements";
import {
  UniqueViolationError,
  type TransactionRunner,
} from "@/infrastructure/database/interfaces/transaction";

import { recordAudit } from "../../audit/audit-service";
import type { WorkspaceScope } from "../../authz/access-service";
import { auditActorFor, type AuditActor, type RequestMeta, type UserActor } from "../../context";
import type { Clock, Logger } from "../../ports/observability";
import type { EntitlementService } from "../../subscriptions/entitlement-service";
import type { AuditFilter, PlatformMailer, PlatformRepos, SubscriptionRow } from "./ports";

export interface PlatformServiceDeps {
  tx: TransactionRunner<PlatformRepos>;
  clock: Clock;
  entitlements: EntitlementService;
  mailer: PlatformMailer;
  appUrl: string;
  logger?: Logger;
}

interface Mail {
  to: string;
  template: string;
  subject: string;
  text: string;
}

const DAY_MS = 86_400_000;

function adminActor(actor: UserActor, meta?: RequestMeta): AuditActor {
  return {
    type: "PLATFORM_ADMIN",
    userId: actor.userId,
    ip: meta?.ip ?? null,
    requestId: meta?.requestId ?? null,
  };
}

function assertAdmin(actor: UserActor): void {
  if (!actor.isPlatformAdmin) throw forbidden("Super Admin access required");
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function toPublicPlan(p: AdminPlanDto): PublicPlanDto {
  return {
    key: p.key,
    name: p.name,
    description: p.description,
    currency: p.currency,
    monthlyPrice: p.monthlyPrice,
    annualPrice: p.annualPrice,
    isTrialEligible: p.isTrialEligible,
    limits: p.limits,
    features: p.features.filter((f) => f in FEATURES).map((f) => ({ key: f, label: FEATURES[f] })),
  };
}

export function toSubscriptionDto(s: SubscriptionRow): CurrentSubscriptionDto {
  return {
    id: s.id,
    planKey: s.planKey,
    planName: s.planName,
    status: s.status,
    billingCycle: s.billingCycle,
    trialStartsAt: iso(s.trialStartsAt),
    trialEndsAt: iso(s.trialEndsAt),
    currentPeriodStart: iso(s.currentPeriodStart),
    currentPeriodEnd: iso(s.currentPeriodEnd),
    cancelledAt: iso(s.cancelledAt),
    remindersSent: s.remindersSent,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
  };
}

function auditFilter(q: {
  action?: string;
  actor?: string;
  actorType?: string;
  from?: string;
  to?: string;
}): AuditFilter {
  return {
    action: q.action,
    actor: q.actor,
    actorType: q.actorType,
    from: q.from ? new Date(`${q.from}T00:00:00.000Z`) : undefined,
    // `to` is an inclusive day.
    to: q.to ? new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + DAY_MS) : undefined,
  };
}

export function createPlatformService(deps: PlatformServiceDeps) {
  const { tx, clock, entitlements, mailer, appUrl, logger } = deps;
  const base = appUrl.replace(/\/$/, "");

  async function settings(): Promise<PlatformSettings> {
    return entitlements.getPlatformSettings();
  }

  async function deliver(mails: Mail[]): Promise<void> {
    for (const m of mails) {
      try {
        await mailer.send(m.to, m.template, m.subject, m.text);
      } catch (error) {
        logger?.warn("platform_email_failed", { template: m.template, error });
      }
    }
  }

  /** In-app notification (in the caller's transaction) + queued email to every owner. */
  async function notifyOwners(
    r: PlatformRepos,
    workspaceId: string,
    input: NotificationInput,
    email: { template: string; subject: string; text: string },
    outbox: Mail[],
  ): Promise<void> {
    const owners = await r.platform.listWorkspaceOwners(workspaceId);
    const ids = owners.map((o) => o.userId);
    await r.platform.notify(ids, workspaceId, input);
    const optedOut = await r.platform.emailOptOuts(ids, input.type);
    for (const o of owners) {
      if (!optedOut.has(o.userId)) {
        outbox.push({
          to: o.email,
          template: email.template,
          subject: email.subject,
          text: `Hi ${o.name},\n\n${email.text}\n\n${base}/app/w/${workspaceId}/subscription`,
        });
      }
    }
  }

  async function requireWorkspace(r: PlatformRepos, workspaceId: string) {
    const ws = await r.platform.findWorkspace(workspaceId);
    if (!ws) throw notFound("Workspace");
    return ws;
  }

  async function requireSubscription(r: PlatformRepos, workspaceId: string) {
    const sub = await r.platform.findCurrentSubscription(workspaceId);
    if (!sub) throw conflict("This workspace has no subscription yet. Assign a plan first.");
    return sub;
  }

  const service = {
    // =============================================================== public

    async listPublicPlans(): Promise<PublicPlanDto[]> {
      const plans = await tx.read((r) => r.platform.listPlans({ publicActiveOnly: true }));
      return plans.map(toPublicPlan);
    },

    async listActiveAnnouncements(): Promise<PublicAnnouncementDto[]> {
      return tx.read((r) => r.platform.listActiveAnnouncements(clock.now()));
    },

    // =============================================================== workspace

    /**
     * Subscription overview. Readable in every phase — including SUSPENDED and
     * RESTRICTED — so owners can always see why access is limited and how to
     * restore it. The permission is checked without the access-level gate.
     */
    async getSubscriptionOverview(scope: WorkspaceScope): Promise<SubscriptionOverviewDto> {
      if (!scope.can("workspace.subscription.view")) throw forbidden();
      const [usage, s] = await Promise.all([entitlements.getUsage(scope.workspaceId), settings()]);
      return tx.read(async (r) => {
        const [ws, sub, plans, history, pendingUpgrade] = await Promise.all([
          r.platform.findWorkspace(scope.workspaceId),
          r.platform.findCurrentSubscription(scope.workspaceId),
          r.platform.listPlans({ publicActiveOnly: true }),
          r.platform.listSubscriptionEvents(scope.workspaceId, 50),
          r.platform.findOpenUpgradeRequest(scope.workspaceId),
        ]);
        if (!ws) throw notFound("Workspace");
        const current = sub ? await r.platform.findPlanById(sub.planId) : null;
        return {
          workspaceId: scope.workspaceId,
          workspaceName: ws.name,
          workspaceStatus: ws.status,
          entitlements: scope.entitlements,
          usage,
          subscription: sub ? toSubscriptionDto(sub) : null,
          currentPlan: current ? toPublicPlan(current) : null,
          availablePlans: plans.map(toPublicPlan),
          history,
          pendingUpgrade,
          trialDays: s.trialDays,
          supportEmail: s.supportEmail,
          canRequestUpgrade: scope.can("workspace.support.manage"),
        };
      });
    },

    /**
     * Support requests of a workspace. Holders of workspace.support.manage see
     * every request of the workspace; other members only their own. Support
     * stays reachable when the workspace is suspended or read-only.
     */
    async listWorkspaceSupport(
      scope: WorkspaceScope,
      query: Pick<SupportListQuery, "status" | "category" | "page" | "pageSize">,
    ): Promise<Paginated<SupportRequestDto> & { canCreate: boolean }> {
      const canManage = scope.can("workspace.support.manage");
      if (!canManage && !scope.can("workspace.view")) throw forbidden();
      const result = await tx.read((r) =>
        r.platform.listSupportRequests(
          {
            workspaceId: scope.workspaceId,
            createdBy: canManage ? undefined : scope.actor.userId,
            status: query.status,
            category: query.category,
          },
          query.page,
          query.pageSize,
        ),
      );
      return { ...result, canCreate: canManage };
    },

    async createSupportRequest(
      scope: WorkspaceScope,
      raw: CreateSupportRequestInput,
      meta: RequestMeta,
    ): Promise<SupportRequestDto> {
      // Deliberately not gated by the subscription access level: a suspended
      // or expired workspace must still be able to contact support.
      if (!scope.can("workspace.support.manage")) throw forbidden();
      const input = createSupportRequestSchema.parse(raw);
      const s = await settings();
      const outbox: Mail[] = [];
      const created = await tx.run(async (r) => {
        let message = input.message;
        if (input.category === "UPGRADE") {
          const open = await r.platform.findOpenUpgradeRequest(scope.workspaceId);
          if (open) {
            throw conflict("An upgrade request is already open. Our team will contact you soon.");
          }
          if (input.planKey) {
            const plan = await r.platform.findPlanByKey(input.planKey);
            if (!plan || plan.status !== "ACTIVE" || !plan.isPublic) {
              throw new DomainError("VALIDATION_FAILED", "Choose an available plan", {
                fieldErrors: { planKey: ["Choose an available plan"] },
              });
            }
            message = `Requested plan: ${plan.name} (${plan.key})${
              input.billingCycle ? `, billed ${input.billingCycle.toLowerCase()}` : ""
            }\n\n${message}`;
          }
        }
        const req = await r.platform.insertSupportRequest({
          workspaceId: scope.workspaceId,
          createdBy: scope.actor.userId,
          contactEmail: scope.actor.email,
          subject: input.subject,
          message,
          category: input.category,
          priority: input.priority,
        });
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "support.request_created",
          { workspaceId: scope.workspaceId, targetType: "support_request", targetId: req.id },
          { category: req.category, priority: req.priority, planKey: input.planKey ?? null },
        );
        outbox.push({
          to: s.supportEmail,
          template: "support_request_created",
          subject: `[${req.category}] ${req.subject} — ${scope.workspaceName}`,
          text: `New support request from ${scope.actor.name} <${scope.actor.email}> (${scope.workspaceName}).\n\nCategory: ${req.category}\nPriority: ${req.priority}\n\n${message}\n\n${base}/admin/support/${req.id}`,
        });
        outbox.push({
          to: scope.actor.email,
          template: "support_request_received",
          subject: `We received your request: ${req.subject}`,
          text: `Hi ${scope.actor.name},\n\nThanks for contacting ${s.productName} support. We received your request "${req.subject}" and will reply to ${scope.actor.email}.\n\n${base}/app/w/${scope.workspaceId}/support`,
        });
        return req;
      });
      await deliver(outbox);
      return created;
    },

    async listWorkspaceAudit(
      scope: WorkspaceScope,
      query: AuditQuery,
    ): Promise<Paginated<AuditLogDto>> {
      scope.require("workspace.audit.view");
      return tx.read((r) =>
        r.platform.listAudit(
          { ...auditFilter(query), workspaceId: scope.workspaceId },
          query.page,
          query.pageSize,
        ),
      );
    },

    // =============================================================== admin: plans

    async listPlans(admin: UserActor): Promise<AdminPlanDto[]> {
      assertAdmin(admin);
      return tx.read((r) => r.platform.listPlans());
    },

    async getPlan(admin: UserActor, planId: string): Promise<AdminPlanDto> {
      assertAdmin(admin);
      const plan = await tx.read((r) => r.platform.findPlanById(planId));
      if (!plan) throw notFound("Plan");
      return plan;
    },

    async createPlan(admin: UserActor, input: PlanInput, meta: RequestMeta): Promise<AdminPlanDto> {
      assertAdmin(admin);
      try {
        return await tx.run(async (r) => {
          const plan = await r.platform.insertPlan(input);
          await recordAudit(
            r.audit,
            adminActor(admin, meta),
            "platform.plan_created",
            { workspaceId: null, targetType: "plan", targetId: plan.id },
            { key: plan.key, status: plan.status, isPublic: plan.isPublic },
          );
          return plan;
        });
      } catch (error) {
        if (error instanceof UniqueViolationError) {
          throw new DomainError("VALIDATION_FAILED", "A plan with this key already exists", {
            fieldErrors: { key: ["A plan with this key already exists"] },
          });
        }
        throw error;
      }
    },

    async updatePlan(
      admin: UserActor,
      planId: string,
      input: PlanInput,
      meta: RequestMeta,
    ): Promise<AdminPlanDto> {
      assertAdmin(admin);
      const s = await settings();
      try {
        return await tx.run(async (r) => {
          const existing = await r.platform.findPlanById(planId);
          if (!existing) throw notFound("Plan");
          if (existing.key === s.trialPlanKey) {
            if (input.status === "ARCHIVED") {
              throw new DomainError(
                "VALIDATION_FAILED",
                "This is the trial plan. Choose another trial plan in Settings before archiving it.",
                { fieldErrors: { status: ["The trial plan can't be archived"] } },
              );
            }
            if (input.key !== existing.key) {
              throw new DomainError(
                "VALIDATION_FAILED",
                "The trial plan's key is referenced by platform settings and can't change.",
                { fieldErrors: { key: ["The trial plan's key can't change"] } },
              );
            }
          }
          const updated = await r.platform.updatePlan(planId, input);
          if (!updated) throw notFound("Plan");
          const changed = (Object.keys(input) as (keyof PlanInput)[]).filter(
            (k) => JSON.stringify(input[k]) !== JSON.stringify(existing[k]),
          );
          await recordAudit(
            r.audit,
            adminActor(admin, meta),
            "platform.plan_updated",
            { workspaceId: null, targetType: "plan", targetId: planId },
            { key: updated.key, fields: changed },
          );
          return updated;
        });
      } catch (error) {
        if (error instanceof UniqueViolationError) {
          throw new DomainError("VALIDATION_FAILED", "A plan with this key already exists", {
            fieldErrors: { key: ["A plan with this key already exists"] },
          });
        }
        throw error;
      }
    },

    // =============================================================== admin: settings

    async getSettings(admin: UserActor): Promise<AdminSettingsDto> {
      assertAdmin(admin);
      return tx.read(async (r) => {
        const [rows, plans] = await Promise.all([
          r.platform.loadSettingRows(),
          r.platform.listPlans(),
        ]);
        return {
          settings: mergePlatformSettings(rows),
          plans: plans.map((p) => ({ key: p.key, name: p.name, status: p.status })),
        };
      });
    },

    async updateSettings(
      admin: UserActor,
      input: PlatformSettings,
      meta: RequestMeta,
    ): Promise<AdminSettingsDto> {
      assertAdmin(admin);
      const next: PlatformSettings = {
        ...input,
        defaultCurrency: input.defaultCurrency.toUpperCase(),
        trialReminderDays: [...new Set(input.trialReminderDays)].sort((a, b) => a - b),
      };
      if (next.trialReminderDays.some((d) => d >= next.trialDays)) {
        throw new DomainError("VALIDATION_FAILED", "Reminders must fall within the trial", {
          fieldErrors: {
            trialReminderDays: [`Use days between 1 and ${Math.max(1, next.trialDays - 1)}`],
          },
        });
      }
      await tx.run(async (r) => {
        const plan = await r.platform.findPlanByKey(next.trialPlanKey);
        if (!plan || plan.status !== "ACTIVE") {
          throw new DomainError("VALIDATION_FAILED", "Choose an active plan for trials", {
            fieldErrors: { trialPlanKey: ["Choose an active plan"] },
          });
        }
        const current = mergePlatformSettings(await r.platform.loadSettingRows());
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(next) as (keyof PlatformSettings)[]) {
          if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) {
            changes[key] = { from: current[key], to: next[key] };
            patch[key] = next[key];
          }
        }
        if (Object.keys(patch).length === 0) return;
        await r.platform.upsertSettings(patch, admin.userId);
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.settings_updated",
          { workspaceId: null, targetType: "platform_settings" },
          { changes },
        );
      });
      return service.getSettings(admin);
    },

    // =============================================================== admin: announcements

    async listAnnouncements(admin: UserActor): Promise<AnnouncementDto[]> {
      assertAdmin(admin);
      return tx.read((r) => r.platform.listAnnouncements());
    },

    async createAnnouncement(
      admin: UserActor,
      input: AnnouncementInput,
      meta: RequestMeta,
    ): Promise<AnnouncementDto> {
      assertAdmin(admin);
      return tx.run(async (r) => {
        const a = await r.platform.insertAnnouncement(input, admin.userId);
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.announcement_created",
          { workspaceId: null, targetType: "announcement", targetId: a.id },
          { level: a.level, isActive: a.isActive },
        );
        return a;
      });
    },

    async updateAnnouncement(
      admin: UserActor,
      id: string,
      input: AnnouncementInput,
      meta: RequestMeta,
    ): Promise<AnnouncementDto> {
      assertAdmin(admin);
      return tx.run(async (r) => {
        const a = await r.platform.updateAnnouncement(id, input);
        if (!a) throw notFound("Announcement");
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.announcement_updated",
          { workspaceId: null, targetType: "announcement", targetId: id },
          { level: a.level, isActive: a.isActive },
        );
        return a;
      });
    },

    async deleteAnnouncement(admin: UserActor, id: string, meta: RequestMeta): Promise<void> {
      assertAdmin(admin);
      await tx.run(async (r) => {
        if (!(await r.platform.deleteAnnouncement(id))) throw notFound("Announcement");
        await recordAudit(r.audit, adminActor(admin, meta), "platform.announcement_deleted", {
          workspaceId: null,
          targetType: "announcement",
          targetId: id,
        });
      });
    },

    // =============================================================== admin: workspaces

    async listWorkspaces(
      admin: UserActor,
      query: AdminWorkspaceListQuery,
    ): Promise<Paginated<AdminWorkspaceRowDto>> {
      assertAdmin(admin);
      const [rows, s] = await Promise.all([
        tx.read((r) => r.platform.listWorkspacesForAdmin({ q: query.q, status: query.status })),
        settings(),
      ]);
      const now = clock.now();
      const all = rows.map((w): AdminWorkspaceRowDto => {
        const ent = resolveEntitlements({
          workspaceStatus: w.status,
          subscription: w.subscription,
          plan: w.plan,
          overrides: w.overrides,
          policy: { graceDays: s.graceDays, restrictedMode: s.restrictedMode },
          now,
        });
        return {
          id: w.id,
          name: w.name,
          slug: w.slug,
          status: w.status,
          ownerEmail: w.ownerEmail,
          planKey: w.plan?.key ?? null,
          planName: w.plan?.name ?? null,
          subscriptionStatus: w.subscription?.status ?? null,
          phase: ent.phase,
          trialDaysRemaining: ent.trialDaysRemaining,
          counts: w.counts,
          createdAt: w.createdAt.toISOString(),
        };
      });
      const filtered = query.phase ? all.filter((w) => w.phase === query.phase) : all;
      const start = (query.page - 1) * query.pageSize;
      return {
        items: filtered.slice(start, start + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        total: filtered.length,
      };
    },

    async getWorkspace(admin: UserActor, workspaceId: string): Promise<AdminWorkspaceDetailDto> {
      assertAdmin(admin);
      const detail = await tx.read(async (r) => {
        const ws = await r.platform.findWorkspace(workspaceId);
        if (!ws) throw notFound("Workspace");
        const [members, restaurants, overrides, sub, history, plans] = await Promise.all([
          r.platform.listMembers(workspaceId),
          r.platform.listRestaurantTree(workspaceId),
          r.platform.listOverrides(workspaceId),
          r.platform.findCurrentSubscription(workspaceId),
          r.platform.listSubscriptionEvents(workspaceId, 100),
          r.platform.listPlans(),
        ]);
        return { ws, members, restaurants, overrides, sub, history, plans };
      });
      const [ent, usage] = await Promise.all([
        entitlements.getWorkspaceEntitlements(workspaceId),
        entitlements.getUsage(workspaceId),
      ]);
      return {
        workspace: { ...detail.ws, createdAt: detail.ws.createdAt.toISOString() },
        members: detail.members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })),
        restaurants: detail.restaurants,
        usage,
        entitlements: ent,
        subscription: detail.sub ? toSubscriptionDto(detail.sub) : null,
        history: detail.history,
        overrides: detail.overrides,
        plans: detail.plans.map((p) => ({ key: p.key, name: p.name, status: p.status })),
      };
    },

    async setWorkspaceStatus(
      admin: UserActor,
      workspaceId: string,
      input: { status: WorkspaceStatus; reason: string },
      meta: RequestMeta,
    ): Promise<void> {
      assertAdmin(admin);
      const s = await settings();
      const outbox: Mail[] = [];
      await tx.run(async (r) => {
        const ws = await requireWorkspace(r, workspaceId);
        if (ws.status === input.status) {
          throw conflict(`The workspace is already ${input.status.toLowerCase()}.`);
        }
        await r.platform.setWorkspaceStatus(workspaceId, input.status, input.reason);
        const sub = await r.platform.findCurrentSubscription(workspaceId);
        await r.platform.insertSubscriptionEvent({
          workspaceId,
          subscriptionId: sub?.id ?? null,
          type: `workspace_${input.status.toLowerCase()}`,
          fromStatus: ws.status,
          toStatus: input.status,
          planKey: sub?.planKey ?? null,
          actorUserId: admin.userId,
          metadata: { reason: input.reason },
        });
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.workspace_status_changed",
          { workspaceId, targetType: "workspace", targetId: workspaceId },
          { from: ws.status, to: input.status, reason: input.reason },
        );
        const owners = await r.platform.listWorkspaceOwners(workspaceId);
        const verb =
          input.status === "ACTIVE"
            ? "has been reactivated. Your team has full access again."
            : input.status === "SUSPENDED"
              ? `has been suspended. Reason: ${input.reason}\n\nYour data is safe. Contact ${s.supportEmail} to restore access.`
              : `has been deactivated. Reason: ${input.reason}\n\nYour data is retained. Contact ${s.supportEmail} with any questions.`;
        for (const o of owners) {
          outbox.push({
            to: o.email,
            template: `workspace_${input.status.toLowerCase()}`,
            subject: `${ws.name}: workspace ${input.status === "ACTIVE" ? "reactivated" : input.status.toLowerCase()}`,
            text: `Hi ${o.name},\n\nYour ${s.productName} workspace "${ws.name}" ${verb}`,
          });
        }
      });
      await deliver(outbox);
    },

    /**
     * Assign a plan and manually activate a paid subscription (no payment
     * gateway: Super Admin confirms payment offline). The previous current
     * subscription is retired and the new one inserted in one transaction.
     */
    async activateSubscription(
      admin: UserActor,
      workspaceId: string,
      input: ActivateSubscriptionInput,
      meta: RequestMeta,
    ): Promise<void> {
      assertAdmin(admin);
      const now = clock.now();
      const periodEnd = periodEndFromDate(input.periodEnd);
      if (periodEnd.getTime() <= now.getTime()) {
        throw new DomainError("VALIDATION_FAILED", "The period must end in the future", {
          fieldErrors: { periodEnd: ["Choose a date in the future"] },
        });
      }
      const outbox: Mail[] = [];
      await tx.run(async (r) => {
        const ws = await requireWorkspace(r, workspaceId);
        const plan = await r.platform.findPlanByKey(input.planKey);
        if (!plan || plan.status !== "ACTIVE") {
          throw new DomainError("VALIDATION_FAILED", "Choose an active plan", {
            fieldErrors: { planKey: ["Choose an active plan"] },
          });
        }
        const old = await r.platform.findCurrentSubscription(workspaceId);
        await r.platform.retireCurrentSubscription(workspaceId);
        const subscriptionId = await r.platform.insertSubscription({
          workspaceId,
          planId: plan.id,
          status: "ACTIVE",
          billingCycle: input.billingCycle,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          notes: input.notes ?? null,
          activatedBy: admin.userId,
        });
        await r.platform.insertSubscriptionEvent({
          workspaceId,
          subscriptionId,
          type: "activated",
          fromStatus: old?.status ?? null,
          toStatus: "ACTIVE",
          planKey: plan.key,
          actorUserId: admin.userId,
          metadata: {
            billingCycle: input.billingCycle,
            periodEnd: periodEnd.toISOString(),
            previousPlanKey: old?.planKey ?? null,
          },
        });
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.subscription_activated",
          { workspaceId, targetType: "subscription", targetId: subscriptionId },
          {
            planKey: plan.key,
            billingCycle: input.billingCycle,
            periodEnd: periodEnd.toISOString(),
            previousSubscriptionId: old?.id ?? null,
          },
        );
        await notifyOwners(
          r,
          workspaceId,
          {
            type: "subscription.activated",
            title: `${plan.name} plan activated`,
            body: `Your subscription is active until ${fmtDate(periodEnd)}.`,
            data: { workspaceId, planKey: plan.key },
          },
          {
            template: "subscription_activated",
            subject: `${ws.name}: ${plan.name} plan activated`,
            text: `Your ${plan.name} subscription for "${ws.name}" is now active (billed ${input.billingCycle.toLowerCase()}) until ${fmtDate(periodEnd)}.`,
          },
          outbox,
        );
      });
      await deliver(outbox);
    },

    async extendTrial(
      admin: UserActor,
      workspaceId: string,
      input: { days: number; reason: string },
      meta: RequestMeta,
    ): Promise<void> {
      assertAdmin(admin);
      const now = clock.now();
      const outbox: Mail[] = [];
      await tx.run(async (r) => {
        const ws = await requireWorkspace(r, workspaceId);
        const sub = await requireSubscription(r, workspaceId);
        const isTrial =
          sub.status === "TRIALING" || (sub.status === "EXPIRED" && sub.trialEndsAt !== null);
        if (!isTrial || !sub.trialEndsAt) {
          throw conflict("Only trials can be extended. Activate a subscription instead.");
        }
        const newEnd = extendedTrialEnd(sub.trialEndsAt, now, input.days);
        await r.platform.updateSubscription(sub.id, workspaceId, {
          status: "TRIALING",
          trialEndsAt: newEnd,
          remindersSent: remindersAfterExtension(sub.remindersSent),
        });
        await r.platform.insertSubscriptionEvent({
          workspaceId,
          subscriptionId: sub.id,
          type: "trial_extended",
          fromStatus: sub.status,
          toStatus: "TRIALING",
          planKey: sub.planKey,
          actorUserId: admin.userId,
          metadata: {
            days: input.days,
            reason: input.reason,
            previousTrialEndsAt: sub.trialEndsAt.toISOString(),
            trialEndsAt: newEnd.toISOString(),
          },
        });
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.trial_extended",
          { workspaceId, targetType: "subscription", targetId: sub.id },
          { days: input.days, reason: input.reason, trialEndsAt: newEnd.toISOString() },
        );
        await notifyOwners(
          r,
          workspaceId,
          {
            type: "subscription.activated",
            title: "Your trial was extended",
            body: `Your free trial now ends on ${fmtDate(newEnd)}.`,
            data: { workspaceId },
          },
          {
            template: "trial_extended",
            subject: `${ws.name}: your trial was extended`,
            text: `Good news — your free trial for "${ws.name}" was extended by ${input.days} day(s) and now ends on ${fmtDate(newEnd)}.`,
          },
          outbox,
        );
      });
      await deliver(outbox);
    },

    /** Cancel: no renewal; access continues until the end of the current period (or trial). */
    async cancelSubscription(
      admin: UserActor,
      workspaceId: string,
      input: { reason: string },
      meta: RequestMeta,
    ): Promise<void> {
      assertAdmin(admin);
      const now = clock.now();
      const outbox: Mail[] = [];
      await tx.run(async (r) => {
        const ws = await requireWorkspace(r, workspaceId);
        const sub = await requireSubscription(r, workspaceId);
        if (sub.status !== "ACTIVE" && sub.status !== "TRIALING") {
          throw conflict(`A ${sub.status.toLowerCase()} subscription can't be cancelled.`);
        }
        const accessUntil = sub.currentPeriodEnd ?? sub.trialEndsAt ?? now;
        await r.platform.updateSubscription(sub.id, workspaceId, {
          status: "CANCELLED",
          cancelledAt: now,
          currentPeriodEnd: accessUntil,
        });
        await r.platform.insertSubscriptionEvent({
          workspaceId,
          subscriptionId: sub.id,
          type: "cancelled",
          fromStatus: sub.status,
          toStatus: "CANCELLED",
          planKey: sub.planKey,
          actorUserId: admin.userId,
          metadata: { reason: input.reason, accessUntil: accessUntil.toISOString() },
        });
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.subscription_cancelled",
          { workspaceId, targetType: "subscription", targetId: sub.id },
          { reason: input.reason, accessUntil: accessUntil.toISOString() },
        );
        await notifyOwners(
          r,
          workspaceId,
          {
            type: "subscription.expired",
            title: "Subscription cancelled",
            body: `Your ${sub.planName} subscription will not renew. Access continues until ${fmtDate(accessUntil)}.`,
            data: { workspaceId },
          },
          {
            template: "subscription_cancelled",
            subject: `${ws.name}: subscription cancelled`,
            text: `Your ${sub.planName} subscription for "${ws.name}" was cancelled and will not renew. Your team keeps access until ${fmtDate(accessUntil)}; your data is kept.`,
          },
          outbox,
        );
      });
      await deliver(outbox);
    },

    async expireSubscription(
      admin: UserActor,
      workspaceId: string,
      input: { reason: string },
      meta: RequestMeta,
    ): Promise<void> {
      assertAdmin(admin);
      const s = await settings();
      const outbox: Mail[] = [];
      await tx.run(async (r) => {
        const ws = await requireWorkspace(r, workspaceId);
        const sub = await requireSubscription(r, workspaceId);
        if (sub.status === "EXPIRED") throw conflict("The subscription has already expired.");
        await r.platform.updateSubscription(sub.id, workspaceId, { status: "EXPIRED" });
        await r.platform.insertSubscriptionEvent({
          workspaceId,
          subscriptionId: sub.id,
          type: "expired",
          fromStatus: sub.status,
          toStatus: "EXPIRED",
          planKey: sub.planKey,
          actorUserId: admin.userId,
          metadata: { reason: input.reason, manual: true },
        });
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.subscription_expired",
          { workspaceId, targetType: "subscription", targetId: sub.id },
          { reason: input.reason, from: sub.status },
        );
        await notifyOwners(
          r,
          workspaceId,
          {
            type: "subscription.expired",
            title: "Subscription expired",
            body:
              s.restrictedMode === "READ_ONLY"
                ? "The workspace is now read-only. Your data is safe."
                : "Access to the workspace is paused. Your data is safe.",
            data: { workspaceId },
          },
          {
            template: "subscription_expired",
            subject: `${ws.name}: subscription expired`,
            text: `Your subscription for "${ws.name}" has expired. ${
              s.restrictedMode === "READ_ONLY"
                ? "The workspace is read-only until it is reactivated."
                : "Access is paused until it is reactivated."
            } Your data is kept. Contact ${s.supportEmail} to reactivate.`,
          },
          outbox,
        );
      });
      await deliver(outbox);
    },

    async setOverride(
      admin: UserActor,
      workspaceId: string,
      input: EntitlementOverrideInput,
      meta: RequestMeta,
    ): Promise<void> {
      assertAdmin(admin);
      await tx.run(async (r) => {
        await requireWorkspace(r, workspaceId);
        await r.platform.upsertOverride({
          workspaceId,
          key: input.key,
          value: input.value,
          reason: input.reason,
          createdBy: admin.userId,
        });
        const sub = await r.platform.findCurrentSubscription(workspaceId);
        await r.platform.insertSubscriptionEvent({
          workspaceId,
          subscriptionId: sub?.id ?? null,
          type: "override_set",
          planKey: sub?.planKey ?? null,
          actorUserId: admin.userId,
          metadata: { key: input.key, value: input.value, reason: input.reason },
        });
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.entitlement_override_set",
          { workspaceId, targetType: "workspace_entitlement", targetId: input.key },
          { key: input.key, value: input.value, reason: input.reason },
        );
      });
    },

    async removeOverride(
      admin: UserActor,
      workspaceId: string,
      key: string,
      meta: RequestMeta,
    ): Promise<void> {
      assertAdmin(admin);
      await tx.run(async (r) => {
        await requireWorkspace(r, workspaceId);
        if (!(await r.platform.deleteOverride(workspaceId, key))) throw notFound("Override");
        const sub = await r.platform.findCurrentSubscription(workspaceId);
        await r.platform.insertSubscriptionEvent({
          workspaceId,
          subscriptionId: sub?.id ?? null,
          type: "override_removed",
          planKey: sub?.planKey ?? null,
          actorUserId: admin.userId,
          metadata: { key },
        });
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.entitlement_override_removed",
          { workspaceId, targetType: "workspace_entitlement", targetId: key },
          { key },
        );
      });
    },

    // =============================================================== admin: support

    async listSupport(
      admin: UserActor,
      query: SupportListQuery,
    ): Promise<Paginated<SupportRequestDto>> {
      assertAdmin(admin);
      return tx.read((r) =>
        r.platform.listSupportRequests(
          {
            workspaceId: query.workspaceId,
            status: query.status,
            category: query.category,
            priority: query.priority,
            q: query.q,
            assignedTo: query.assigned === "me" ? admin.userId : undefined,
            unassigned: query.assigned === "unassigned",
          },
          query.page,
          query.pageSize,
        ),
      );
    },

    async getSupport(admin: UserActor, id: string): Promise<SupportRequestDetailDto> {
      assertAdmin(admin);
      return tx.read(async (r) => {
        const req = await r.platform.findSupportRequest(id);
        if (!req) throw notFound("Support request");
        return { ...req, notes: await r.platform.listSupportNotes(id) };
      });
    },

    async updateSupport(
      admin: UserActor,
      id: string,
      input: { status?: SupportStatus; priority?: SupportPriority; assignee?: "me" | null },
      meta: RequestMeta,
    ): Promise<SupportRequestDetailDto> {
      assertAdmin(admin);
      const s = await settings();
      const outbox: Mail[] = [];
      await tx.run(async (r) => {
        const req = await r.platform.findSupportRequest(id);
        if (!req) throw notFound("Support request");
        const patch: Parameters<typeof r.platform.updateSupportRequest>[1] = {};
        if (input.status !== undefined && input.status !== req.status) {
          patch.status = input.status;
          const done = input.status === "RESOLVED" || input.status === "CLOSED";
          patch.resolvedAt = done
            ? req.resolvedAt
              ? new Date(req.resolvedAt)
              : clock.now()
            : null;
        }
        if (input.priority !== undefined) patch.priority = input.priority;
        if (input.assignee !== undefined) {
          patch.assignedTo = input.assignee === "me" ? admin.userId : null;
        }
        await r.platform.updateSupportRequest(id, patch);
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.support_updated",
          { workspaceId: req.workspaceId, targetType: "support_request", targetId: id },
          {
            status: patch.status ?? null,
            fromStatus: patch.status ? req.status : null,
            priority: input.priority ?? null,
            assignedTo: patch.assignedTo === undefined ? undefined : patch.assignedTo,
          },
        );
        if (patch.status === "RESOLVED") {
          outbox.push({
            to: req.contactEmail,
            template: "support_request_resolved",
            subject: `Resolved: ${req.subject}`,
            text: `Hello,\n\nYour ${s.productName} support request "${req.subject}" was marked as resolved. If anything is still not right, reply to ${s.supportEmail} or open a new request.`,
          });
        }
      });
      await deliver(outbox);
      return service.getSupport(admin, id);
    },

    async addSupportNote(
      admin: UserActor,
      id: string,
      body: string,
      meta: RequestMeta,
    ): Promise<SupportRequestDetailDto> {
      assertAdmin(admin);
      await tx.run(async (r) => {
        const req = await r.platform.findSupportRequest(id);
        if (!req) throw notFound("Support request");
        const note = await r.platform.insertSupportNote({
          requestId: id,
          authorId: admin.userId,
          body,
        });
        await r.platform.updateSupportRequest(id, {});
        await recordAudit(
          r.audit,
          adminActor(admin, meta),
          "platform.support_note_added",
          { workspaceId: req.workspaceId, targetType: "support_request", targetId: id },
          { noteId: note.id },
        );
      });
      return service.getSupport(admin, id);
    },

    // =============================================================== admin: audit

    async listAudit(admin: UserActor, query: AdminAuditQuery): Promise<Paginated<AuditLogDto>> {
      assertAdmin(admin);
      return tx.read((r) =>
        r.platform.listAudit(
          { ...auditFilter(query), workspaceId: query.workspaceId },
          query.page,
          query.pageSize,
        ),
      );
    },

    // =============================================================== jobs

    /**
     * Scheduled sweep (idempotent): sends due trial reminders, the one-time
     * "trial ended", "subscription ended" and "grace ended" notices. Access is
     * never changed here — it is computed from dates on every request — and no
     * data is deleted. Each subscription's markers are updated with a
     * compare-and-set, so overlapping runs can't double-send.
     */
    async runSubscriptionSweep(): Promise<SubscriptionSweepResult> {
      const s = await settings();
      const now = clock.now();
      const candidates = await tx.read((r) => r.platform.listSweepCandidates());
      const result: SubscriptionSweepResult = {
        now: now.toISOString(),
        scanned: candidates.length,
        trialReminders: 0,
        trialExpired: 0,
        periodExpired: 0,
        graceEnded: 0,
      };
      const system: AuditActor = { type: "SYSTEM", userId: null };
      const readOnly = s.restrictedMode === "READ_ONLY";

      for (const { subscription: sub, workspaceName } of candidates) {
        const d = planSubscriptionSweep(
          sub,
          { trialReminderDays: s.trialReminderDays, graceDays: s.graceDays },
          now,
        );
        if (!d.changed) continue;
        const outbox: Mail[] = [];
        try {
          const applied = await tx.run(async (r) => {
            const ok = await r.platform.compareAndSetReminders(
              sub.id,
              sub.remindersSent,
              d.nextRemindersSent,
            );
            if (!ok) return false;
            const ws = sub.workspaceId;
            const event = async (type: string, metadata: Record<string, unknown> = {}) => {
              await r.platform.insertSubscriptionEvent({
                workspaceId: ws,
                subscriptionId: sub.id,
                type,
                fromStatus: sub.status,
                toStatus: sub.status,
                planKey: sub.planKey,
                metadata,
              });
              await recordAudit(
                r.audit,
                system,
                `subscription.${type}`,
                { workspaceId: ws, targetType: "subscription", targetId: sub.id },
                metadata,
              );
            };
            if (d.reminderDay !== null && sub.trialEndsAt) {
              const left = d.trialDaysLeft ?? 0;
              await event("trial_reminder_sent", { day: d.reminderDay, daysLeft: left });
              await notifyOwners(
                r,
                ws,
                {
                  type: "trial.reminder",
                  title: `${left} day${left === 1 ? "" : "s"} left in your free trial`,
                  body: `Your ${sub.planName} trial ends on ${fmtDate(sub.trialEndsAt)}. Request an upgrade to keep full access.`,
                  data: { workspaceId: ws, daysLeft: left },
                },
                {
                  template: "trial_reminder",
                  subject: `${workspaceName}: ${left} day${left === 1 ? "" : "s"} left in your trial`,
                  text: `Your ${s.productName} trial for "${workspaceName}" ends on ${fmtDate(sub.trialEndsAt)}. Upgrade from the subscription page to keep full access — your data stays exactly where it is.`,
                },
                outbox,
              );
              result.trialReminders += 1;
            }
            if (d.trialExpired) {
              await event("trial_ended");
              await notifyOwners(
                r,
                ws,
                {
                  type: "trial.expired",
                  title: "Your free trial has ended",
                  body: `You're in a ${s.graceDays}-day grace period: daily operations continue, but adding restaurants, branches or staff is paused.`,
                  data: { workspaceId: ws },
                },
                {
                  template: "trial_expired",
                  subject: `${workspaceName}: your free trial has ended`,
                  text: `Your free trial for "${workspaceName}" has ended. For the next ${s.graceDays} day(s) your team can keep operating; growth actions are paused. Request an upgrade to keep full access. Your data is safe.`,
                },
                outbox,
              );
              result.trialExpired += 1;
            }
            if (d.periodExpired) {
              await event("period_ended");
              await notifyOwners(
                r,
                ws,
                {
                  type: "subscription.expired",
                  title: "Your subscription period has ended",
                  body: `Renew within ${s.graceDays} day(s) to avoid restrictions.`,
                  data: { workspaceId: ws },
                },
                {
                  template: "subscription_period_ended",
                  subject: `${workspaceName}: subscription period ended`,
                  text: `Your ${sub.planName} subscription period for "${workspaceName}" has ended. Renew within ${s.graceDays} day(s) to avoid restrictions. Your data is safe.`,
                },
                outbox,
              );
              result.periodExpired += 1;
            }
            if (d.graceEnded) {
              await event("grace_ended", { restrictedMode: s.restrictedMode });
              await notifyOwners(
                r,
                ws,
                {
                  type: "subscription.expired",
                  title: readOnly ? "Workspace is now read-only" : "Workspace access paused",
                  body: "The grace period has ended. Your data is preserved — upgrade to restore full access.",
                  data: { workspaceId: ws },
                },
                {
                  template: "subscription_restricted",
                  subject: `${workspaceName}: ${readOnly ? "workspace is now read-only" : "access paused"}`,
                  text: `The grace period for "${workspaceName}" has ended and the workspace is now ${readOnly ? "read-only" : "paused"}. Nothing has been deleted. Request an upgrade or contact ${s.supportEmail} to restore full access.`,
                },
                outbox,
              );
              result.graceEnded += 1;
            }
            return true;
          });
          if (applied) await deliver(outbox);
        } catch (error) {
          logger?.error("subscription_sweep_failed", { subscriptionId: sub.id, error });
        }
      }
      return result;
    },
  };
  return service;
}

export type PlatformService = ReturnType<typeof createPlatformService>;
