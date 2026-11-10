import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  AdminPlanDto,
  AnnouncementDto,
  AuditLogDto,
  PublicAnnouncementDto,
  SupportCategory,
  SupportNoteDto,
  SupportRequestDto,
} from "@ros/contracts/platform";
import type {
  AdminWorkspaceBaseRow,
  PlatformRepository,
  SubscriptionRow,
  SupportFilter,
  WorkspaceRecord,
} from "@ros/application/modules/platform/ports";

import type { Executor } from "../client";
import {
  announcements,
  auditLogs,
  authTokens,
  branches,
  idempotencyRecords,
  notificationPreferences,
  organizations,
  platformSettings,
  rateLimitBuckets,
  restaurants,
  roles,
  sessions,
  subscriptionEvents,
  subscriptionPlans,
  subscriptions,
  supportRequestNotes,
  supportRequests,
  upgradeRequests,
  users,
  workspaceEntitlements,
  workspaceMemberships,
  workspaces,
} from "../schema";
import { notifyUsers } from "./notifications";
import { upgradeRepository } from "./upgrades";

const escapeLike = (v: string) => `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toPlanDto(row: typeof subscriptionPlans.$inferSelect, active = 0): AdminPlanDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    currency: row.currency,
    monthlyPrice: row.monthlyPrice,
    annualPrice: row.annualPrice,
    isTrialEligible: row.isTrialEligible,
    isPublic: row.isPublic,
    status: row.status,
    limits: row.limits,
    maxWorkspaces: row.maxWorkspaces,
    features: row.features,
    sortOrder: row.sortOrder,
    activeSubscriptions: active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSubscriptionRow(
  sub: typeof subscriptions.$inferSelect,
  plan: { key: string; name: string },
): SubscriptionRow {
  return {
    id: sub.id,
    organizationId: sub.organizationId,
    workspaceId: sub.workspaceId,
    planId: sub.planId,
    planKey: plan.key,
    planName: plan.name,
    status: sub.status,
    billingCycle: sub.billingCycle,
    trialStartsAt: sub.trialStartsAt,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelledAt: sub.cancelledAt,
    remindersSent: Array.isArray(sub.remindersSent) ? sub.remindersSent : [],
    notes: sub.notes,
    createdAt: sub.createdAt,
  };
}

function toAnnouncement(row: typeof announcements.$inferSelect): AnnouncementDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    level: row.level,
    startsAt: row.startsAt.toISOString(),
    endsAt: iso(row.endsAt),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWorkspaceRecord(w: typeof workspaces.$inferSelect): WorkspaceRecord {
  return {
    id: w.id,
    organizationId: w.organizationId,
    name: w.name,
    slug: w.slug,
    status: w.status,
    statusReason: w.statusReason,
    country: w.country,
    defaultCurrency: w.defaultCurrency,
    businessEmail: w.businessEmail,
    createdAt: w.createdAt,
  };
}

const creator = alias(users, "support_creator");
const assignee = alias(users, "support_assignee");

const supportSelect = {
  req: supportRequests,
  workspaceName: workspaces.name,
  creatorId: creator.id,
  creatorName: creator.name,
  creatorEmail: creator.email,
  assigneeId: assignee.id,
  assigneeName: assignee.name,
};

type SupportJoinRow = {
  req: typeof supportRequests.$inferSelect;
  workspaceName: string | null;
  creatorId: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
};

function toSupportDto(r: SupportJoinRow): SupportRequestDto {
  return {
    id: r.req.id,
    workspaceId: r.req.workspaceId,
    workspaceName: r.workspaceName,
    subject: r.req.subject,
    message: r.req.message,
    category: r.req.category as SupportCategory,
    status: r.req.status,
    priority: r.req.priority,
    contactEmail: r.req.contactEmail,
    createdBy:
      r.creatorId && r.creatorName && r.creatorEmail
        ? { id: r.creatorId, name: r.creatorName, email: r.creatorEmail }
        : null,
    assignedTo: r.assigneeId && r.assigneeName ? { id: r.assigneeId, name: r.assigneeName } : null,
    resolvedAt: iso(r.req.resolvedAt),
    createdAt: r.req.createdAt.toISOString(),
    updatedAt: r.req.updatedAt.toISOString(),
  };
}

export function platformRepository(db: Executor): PlatformRepository {
  const supportQuery = () =>
    db
      .select(supportSelect)
      .from(supportRequests)
      .leftJoin(workspaces, eq(workspaces.id, supportRequests.workspaceId))
      .leftJoin(creator, eq(creator.id, supportRequests.createdBy))
      .leftJoin(assignee, eq(assignee.id, supportRequests.assignedTo));

  async function planCounts(): Promise<Map<string, number>> {
    const rows = await db
      .select({ planId: subscriptions.planId, n: count() })
      .from(subscriptions)
      .where(eq(subscriptions.isCurrent, true))
      .groupBy(subscriptions.planId);
    return new Map(rows.map((r) => [r.planId, r.n]));
  }

  /**
   * The subscription rows of a workspace's billing owner: its organization, or
   * the workspace itself for a row not yet backfilled (spec section 9.2, switch).
   */
  async function ownedBy(workspaceId: string): Promise<SQL> {
    const [ws] = await db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return ws?.organizationId
      ? eq(subscriptions.organizationId, ws.organizationId)
      : eq(subscriptions.workspaceId, workspaceId);
  }

  /**
   * Dual-write target for `subscriptions.workspace_id`: the organization's
   * first live workspace (same choice as the payment repository's billing workspace).
   */
  async function billingOwner(
    workspaceId: string,
  ): Promise<{ organizationId: string | null; workspaceId: string }> {
    const [ws] = await db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws?.organizationId) return { organizationId: null, workspaceId };
    const [first] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, ws.organizationId), isNull(workspaces.deletedAt)))
      .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
      .limit(1);
    return { organizationId: ws.organizationId, workspaceId: first?.id ?? workspaceId };
  }

  async function organizationRecord(where: SQL) {
    const [row] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        status: organizations.status,
        maxWorkspacesOverride: organizations.maxWorkspacesOverride,
      })
      .from(organizations)
      .where(where)
      .limit(1);
    if (!row) return null;
    const [n] = await db
      .select({ n: count() })
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, row.id), isNull(workspaces.deletedAt)));
    return { ...row, workspaceCount: n?.n ?? 0 };
  }

  return {
    ...upgradeRepository(db),
    // ---------------------------------------------------------------- plans
    async listPlans(filter = {}) {
      const rows = await db
        .select()
        .from(subscriptionPlans)
        .where(
          filter.publicActiveOnly
            ? and(eq(subscriptionPlans.isPublic, true), eq(subscriptionPlans.status, "ACTIVE"))
            : undefined,
        )
        .orderBy(asc(subscriptionPlans.sortOrder), asc(subscriptionPlans.name));
      const counts = filter.publicActiveOnly ? new Map<string, number>() : await planCounts();
      return rows.map((r) => toPlanDto(r, counts.get(r.id) ?? 0));
    },
    async findPlanById(planId) {
      const [row] = await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.id, planId))
        .limit(1);
      if (!row) return null;
      return toPlanDto(row, (await planCounts()).get(row.id) ?? 0);
    },
    async findPlanByKey(key) {
      const [row] = await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.key, key))
        .limit(1);
      return row ? toPlanDto(row) : null;
    },
    async insertPlan(input) {
      const [row] = await db
        .insert(subscriptionPlans)
        .values({
          key: input.key,
          name: input.name,
          description: input.description,
          currency: input.currency,
          monthlyPrice: input.monthlyPrice,
          annualPrice: input.annualPrice,
          isTrialEligible: input.isTrialEligible,
          isPublic: input.isPublic,
          status: input.status,
          limits: input.limits,
          maxWorkspaces: input.maxWorkspaces,
          features: input.features,
          sortOrder: input.sortOrder,
        })
        .returning();
      return toPlanDto(row!);
    },
    async updatePlan(planId, input) {
      const [row] = await db
        .update(subscriptionPlans)
        .set({
          key: input.key,
          name: input.name,
          description: input.description,
          currency: input.currency,
          monthlyPrice: input.monthlyPrice,
          annualPrice: input.annualPrice,
          isTrialEligible: input.isTrialEligible,
          isPublic: input.isPublic,
          status: input.status,
          limits: input.limits,
          maxWorkspaces: input.maxWorkspaces,
          features: input.features,
          sortOrder: input.sortOrder,
        })
        .where(eq(subscriptionPlans.id, planId))
        .returning();
      if (!row) return null;
      return toPlanDto(row, (await planCounts()).get(row.id) ?? 0);
    },

    // ---------------------------------------------------------------- settings
    async loadSettingRows() {
      return db
        .select({ key: platformSettings.key, value: platformSettings.value })
        .from(platformSettings);
    },
    async upsertSettings(values, actorUserId) {
      const now = new Date();
      for (const [key, value] of Object.entries(values)) {
        await db
          .insert(platformSettings)
          .values({ key, value, updatedBy: actorUserId, updatedAt: now })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value, updatedBy: actorUserId, updatedAt: now },
          });
      }
    },

    // ---------------------------------------------------------------- announcements
    async listAnnouncements() {
      const rows = await db
        .select()
        .from(announcements)
        .orderBy(desc(announcements.startsAt), desc(announcements.createdAt));
      return rows.map(toAnnouncement);
    },
    async listActiveAnnouncements(now): Promise<PublicAnnouncementDto[]> {
      const rows = await db
        .select()
        .from(announcements)
        .where(
          and(
            eq(announcements.isActive, true),
            lte(announcements.startsAt, now),
            or(isNull(announcements.endsAt), sql`${announcements.endsAt} > ${now.toISOString()}`),
          ),
        )
        .orderBy(
          sql`case ${announcements.level} when 'CRITICAL' then 0 when 'WARNING' then 1 else 2 end`,
          desc(announcements.startsAt),
        )
        .limit(5);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        level: r.level,
        startsAt: r.startsAt.toISOString(),
        endsAt: iso(r.endsAt),
      }));
    },
    async insertAnnouncement(input, actorUserId) {
      const [row] = await db
        .insert(announcements)
        .values({
          title: input.title,
          body: input.body,
          level: input.level,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          isActive: input.isActive,
          createdBy: actorUserId,
        })
        .returning();
      return toAnnouncement(row!);
    },
    async updateAnnouncement(id, input) {
      const [row] = await db
        .update(announcements)
        .set({
          title: input.title,
          body: input.body,
          level: input.level,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          isActive: input.isActive,
        })
        .where(eq(announcements.id, id))
        .returning();
      return row ? toAnnouncement(row) : null;
    },
    async deleteAnnouncement(id) {
      const rows = await db
        .delete(announcements)
        .where(eq(announcements.id, id))
        .returning({ id: announcements.id });
      return rows.length > 0;
    },

    // ---------------------------------------------------------------- subscriptions
    async findCurrentSubscription(workspaceId) {
      const [row] = await db
        .select({ sub: subscriptions, key: subscriptionPlans.key, name: subscriptionPlans.name })
        .from(subscriptions)
        .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
        .where(and(await ownedBy(workspaceId), eq(subscriptions.isCurrent, true)))
        .limit(1);
      return row ? toSubscriptionRow(row.sub, row) : null;
    },
    async retireCurrentSubscription(workspaceId) {
      await db
        .update(subscriptions)
        .set({ isCurrent: false })
        .where(and(await ownedBy(workspaceId), eq(subscriptions.isCurrent, true)));
    },
    async insertSubscription(input) {
      const owner = await billingOwner(input.workspaceId);
      const [row] = await db
        .insert(subscriptions)
        .values({
          organizationId: owner.organizationId,
          workspaceId: owner.workspaceId,
          planId: input.planId,
          status: input.status,
          billingCycle: input.billingCycle,
          trialStartsAt: input.trialStartsAt ?? null,
          trialEndsAt: input.trialEndsAt ?? null,
          currentPeriodStart: input.currentPeriodStart ?? null,
          currentPeriodEnd: input.currentPeriodEnd ?? null,
          notes: input.notes ?? null,
          activatedBy: input.activatedBy ?? null,
          isCurrent: true,
        })
        .returning({ id: subscriptions.id });
      return row!.id;
    },
    async updateSubscription(subscriptionId, workspaceId, patch) {
      const set: Partial<typeof subscriptions.$inferInsert> = {};
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.trialEndsAt !== undefined) set.trialEndsAt = patch.trialEndsAt;
      if (patch.currentPeriodEnd !== undefined) set.currentPeriodEnd = patch.currentPeriodEnd;
      if (patch.cancelledAt !== undefined) set.cancelledAt = patch.cancelledAt;
      if (patch.remindersSent !== undefined) set.remindersSent = patch.remindersSent;
      if (Object.keys(set).length === 0) return;
      await db
        .update(subscriptions)
        .set(set)
        .where(and(eq(subscriptions.id, subscriptionId), await ownedBy(workspaceId)));
    },
    async compareAndSetReminders(subscriptionId, expected, next) {
      const rows = await db
        .update(subscriptions)
        .set({ remindersSent: [...next] })
        .where(
          and(
            eq(subscriptions.id, subscriptionId),
            sql`${subscriptions.remindersSent} = ${JSON.stringify(expected)}::jsonb`,
          ),
        )
        .returning({ id: subscriptions.id });
      return rows.length > 0;
    },
    async insertSubscriptionEvent(input) {
      await db.insert(subscriptionEvents).values({
        workspaceId: input.workspaceId,
        subscriptionId: input.subscriptionId,
        type: input.type,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        planKey: input.planKey ?? null,
        actorUserId: input.actorUserId ?? null,
        metadata: input.metadata ?? {},
      });
    },
    async listSubscriptionEvents(workspaceId, limit) {
      // The workspace's own events plus those of its organization's subscriptions,
      // which may have been recorded against a sibling workspace.
      const orgSubscriptions = db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(await ownedBy(workspaceId));
      const rows = await db
        .select({ e: subscriptionEvents, actorName: users.name })
        .from(subscriptionEvents)
        .leftJoin(users, eq(users.id, subscriptionEvents.actorUserId))
        .where(
          or(
            eq(subscriptionEvents.workspaceId, workspaceId),
            inArray(subscriptionEvents.subscriptionId, orgSubscriptions),
          ),
        )
        .orderBy(desc(subscriptionEvents.createdAt))
        .limit(limit);
      return rows.map(({ e, actorName }) => ({
        id: e.id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        planKey: e.planKey,
        actorName: actorName ?? null,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      }));
    },
    async listSweepCandidates() {
      // The organization's first live workspace receives the lifecycle notices;
      // legacy rows without an organization fall back to their own workspace.
      const liveWorkspace = sql`(
        select w.id from ${workspaces} w
        where w.organization_id = ${subscriptions.organizationId}
          and w.status = 'ACTIVE' and w.deleted_at is null
        order by w.created_at, w.id limit 1)`;
      const rows = await db
        .select({
          sub: subscriptions,
          key: subscriptionPlans.key,
          name: subscriptionPlans.name,
          workspaceId: workspaces.id,
          workspaceName: workspaces.name,
        })
        .from(subscriptions)
        .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
        .innerJoin(
          workspaces,
          or(
            and(isNotNull(subscriptions.organizationId), eq(workspaces.id, liveWorkspace)),
            and(isNull(subscriptions.organizationId), eq(workspaces.id, subscriptions.workspaceId)),
          ),
        )
        .where(
          and(
            eq(subscriptions.isCurrent, true),
            inArray(subscriptions.status, ["TRIALING", "ACTIVE", "CANCELLED"]),
            eq(workspaces.status, "ACTIVE"),
            isNull(workspaces.deletedAt),
          ),
        );
      return rows.map((r) => ({
        subscription: { ...toSubscriptionRow(r.sub, r), workspaceId: r.workspaceId },
        workspaceName: r.workspaceName,
      }));
    },
    async pruneExpired(input) {
      // Driver row counts, never `returning`: the first run on an old database may remove
      // millions of rows and must not pull their ids into memory.
      const removed = async (query: Promise<unknown>) => {
        const result = (await query) as { rowCount?: number | null; affectedRows?: number };
        return result.rowCount ?? result.affectedRows ?? 0;
      };
      return {
        rateLimitBuckets: await removed(
          db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.resetAt, input.rateLimitBefore)),
        ),
        idempotencyRecords: await removed(
          db
            .delete(idempotencyRecords)
            .where(lt(idempotencyRecords.createdAt, input.idempotencyBefore)),
        ),
        sessions: await removed(
          db
            .delete(sessions)
            .where(
              or(
                lt(sessions.expiresAt, input.sessionsBefore),
                lt(sessions.revokedAt, input.sessionsBefore),
              ),
            ),
        ),
        authTokens: await removed(
          db
            .delete(authTokens)
            .where(
              or(
                lt(authTokens.expiresAt, input.authTokensBefore),
                lt(authTokens.usedAt, input.authTokensBefore),
              ),
            ),
        ),
      };
    },

    // ---------------------------------------------------------------- Super Admin workspaces
    async listWorkspacesForAdmin(filter) {
      const conds: SQL[] = [isNull(workspaces.deletedAt)];
      if (filter.status) conds.push(eq(workspaces.status, filter.status));
      if (filter.q) {
        const like = escapeLike(filter.q);
        conds.push(
          or(
            ilike(workspaces.name, like),
            ilike(workspaces.slug, like),
            sql`exists (select 1 from ${workspaceMemberships} m join ${users} u on u.id = m.user_id where m.workspace_id = ${workspaces.id} and u.email ilike ${like})`,
          )!,
        );
      }
      const ws = await db
        .select()
        .from(workspaces)
        .where(and(...conds))
        .orderBy(desc(workspaces.createdAt))
        .limit(2000);
      if (ws.length === 0) return [];
      const ids = ws.map((w) => w.id);

      const [subs, rCounts, bCounts, uCounts, owners, overrides] = await Promise.all([
        // Each workspace's organization subscription (a legacy row by workspace until backfilled).
        db
          .select({ wsId: workspaces.id, sub: subscriptions, plan: subscriptionPlans })
          .from(workspaces)
          .innerJoin(
            subscriptions,
            and(
              eq(subscriptions.isCurrent, true),
              or(
                eq(subscriptions.organizationId, workspaces.organizationId),
                and(
                  isNull(workspaces.organizationId),
                  eq(subscriptions.workspaceId, workspaces.id),
                ),
              ),
            ),
          )
          .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
          .where(inArray(workspaces.id, ids)),
        db
          .select({ id: restaurants.workspaceId, n: count() })
          .from(restaurants)
          .where(and(inArray(restaurants.workspaceId, ids), isNull(restaurants.deletedAt)))
          .groupBy(restaurants.workspaceId),
        db
          .select({ id: branches.workspaceId, n: count() })
          .from(branches)
          .where(and(inArray(branches.workspaceId, ids), isNull(branches.deletedAt)))
          .groupBy(branches.workspaceId),
        db
          .select({ id: workspaceMemberships.workspaceId, n: count() })
          .from(workspaceMemberships)
          .where(
            and(
              inArray(workspaceMemberships.workspaceId, ids),
              eq(workspaceMemberships.status, "ACTIVE"),
            ),
          )
          .groupBy(workspaceMemberships.workspaceId),
        db
          .select({
            id: workspaceMemberships.workspaceId,
            email: users.email,
            createdAt: workspaceMemberships.createdAt,
          })
          .from(workspaceMemberships)
          .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
          .innerJoin(users, eq(users.id, workspaceMemberships.userId))
          .where(
            and(inArray(workspaceMemberships.workspaceId, ids), eq(roles.key, "workspace_owner")),
          )
          .orderBy(asc(workspaceMemberships.createdAt)),
        db
          .select({
            id: workspaceEntitlements.workspaceId,
            key: workspaceEntitlements.key,
            value: workspaceEntitlements.value,
          })
          .from(workspaceEntitlements)
          .where(inArray(workspaceEntitlements.workspaceId, ids)),
      ]);
      const toMap = (rows: { id: string; n: number }[]) => new Map(rows.map((r) => [r.id, r.n]));
      const rc = toMap(rCounts);
      const bc = toMap(bCounts);
      const uc = toMap(uCounts);
      const ownerBy = new Map<string, string>();
      for (const o of owners) if (!ownerBy.has(o.id)) ownerBy.set(o.id, o.email);
      const subBy = new Map(subs.map((s) => [s.wsId, s]));

      return ws.map((w): AdminWorkspaceBaseRow => {
        const s = subBy.get(w.id);
        return {
          id: w.id,
          name: w.name,
          slug: w.slug,
          status: w.status,
          createdAt: w.createdAt,
          ownerEmail: ownerBy.get(w.id) ?? null,
          subscription: s ? toSubscriptionRow(s.sub, s.plan) : null,
          plan: s
            ? {
                id: s.plan.id,
                key: s.plan.key,
                name: s.plan.name,
                limits: s.plan.limits,
                maxWorkspaces: s.plan.maxWorkspaces,
                features: s.plan.features,
              }
            : null,
          overrides: overrides
            .filter((o) => o.id === w.id)
            .map((o) => ({ key: o.key, value: o.value })),
          counts: {
            restaurants: rc.get(w.id) ?? 0,
            branches: bc.get(w.id) ?? 0,
            users: uc.get(w.id) ?? 0,
          },
        };
      });
    },
    async findWorkspace(workspaceId) {
      const [w] = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
        .limit(1);
      return w ? toWorkspaceRecord(w) : null;
    },
    async setWorkspaceStatus(workspaceId, status, reason) {
      const [w] = await db
        .update(workspaces)
        .set({ status, statusReason: reason, version: sql`${workspaces.version} + 1` })
        .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
        .returning();
      return w ? toWorkspaceRecord(w) : null;
    },
    async findOrganization(organizationId) {
      return organizationRecord(eq(organizations.id, organizationId));
    },
    async findOrganizationOfWorkspace(workspaceId) {
      const [ws] = await db
        .select({ organizationId: workspaces.organizationId })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      return ws?.organizationId
        ? organizationRecord(eq(organizations.id, ws.organizationId))
        : null;
    },
    async setOrganizationMaxWorkspacesOverride(organizationId, value) {
      const rows = await db
        .update(organizations)
        .set({ maxWorkspacesOverride: value })
        .where(eq(organizations.id, organizationId))
        .returning({ id: organizations.id });
      return rows.length ? organizationRecord(eq(organizations.id, organizationId)) : null;
    },
    async listMembers(workspaceId) {
      return db
        .select({
          membershipId: workspaceMemberships.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          roleKey: roles.key,
          roleName: roles.name,
          status: workspaceMemberships.status,
          joinedAt: workspaceMemberships.createdAt,
        })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
        .where(eq(workspaceMemberships.workspaceId, workspaceId))
        .orderBy(asc(workspaceMemberships.createdAt));
    },
    async listRestaurantTree(workspaceId) {
      const rs = await db
        .select({ id: restaurants.id, name: restaurants.name, status: restaurants.status })
        .from(restaurants)
        .where(and(eq(restaurants.workspaceId, workspaceId), isNull(restaurants.deletedAt)))
        .orderBy(asc(restaurants.name));
      const bs = await db
        .select({
          id: branches.id,
          restaurantId: branches.restaurantId,
          name: branches.name,
          code: branches.code,
          city: branches.city,
          status: branches.status,
        })
        .from(branches)
        .where(and(eq(branches.workspaceId, workspaceId), isNull(branches.deletedAt)))
        .orderBy(asc(branches.name));
      return rs.map((r) => ({
        ...r,
        branches: bs.filter((b) => b.restaurantId === r.id).map(({ restaurantId: _r, ...b }) => b),
      }));
    },
    async listOverrides(workspaceId) {
      const rows = await db
        .select({ o: workspaceEntitlements, by: users.name })
        .from(workspaceEntitlements)
        .leftJoin(users, eq(users.id, workspaceEntitlements.createdBy))
        .where(eq(workspaceEntitlements.workspaceId, workspaceId))
        .orderBy(asc(workspaceEntitlements.key));
      return rows.map(({ o, by }) => ({
        key: o.key,
        value: o.value ?? null,
        reason: o.reason,
        createdBy: by ?? null,
        updatedAt: o.updatedAt.toISOString(),
      }));
    },
    async upsertOverride(input) {
      await db
        .insert(workspaceEntitlements)
        .values({
          workspaceId: input.workspaceId,
          key: input.key,
          value: input.value,
          reason: input.reason,
          createdBy: input.createdBy,
        })
        .onConflictDoUpdate({
          target: [workspaceEntitlements.workspaceId, workspaceEntitlements.key],
          set: {
            value: sql`excluded.value`,
            reason: input.reason,
            createdBy: input.createdBy,
            updatedAt: new Date(),
          },
        });
    },
    async deleteOverride(workspaceId, key) {
      const rows = await db
        .delete(workspaceEntitlements)
        .where(
          and(
            eq(workspaceEntitlements.workspaceId, workspaceId),
            eq(workspaceEntitlements.key, key),
          ),
        )
        .returning({ id: workspaceEntitlements.id });
      return rows.length > 0;
    },

    // ---------------------------------------------------------------- notifications
    async listWorkspaceOwners(workspaceId) {
      return db
        .select({ userId: users.id, email: users.email, name: users.name })
        .from(workspaceMemberships)
        .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            eq(workspaceMemberships.status, "ACTIVE"),
            eq(roles.key, "workspace_owner"),
            isNull(users.disabledAt),
          ),
        );
    },
    notify(userIds, workspaceId, input) {
      return notifyUsers(db, userIds, { workspaceId }, input);
    },
    async emailOptOuts(userIds, type) {
      if (userIds.length === 0) return new Set();
      const rows = await db
        .select({ userId: notificationPreferences.userId })
        .from(notificationPreferences)
        .where(
          and(
            inArray(notificationPreferences.userId, userIds),
            eq(notificationPreferences.type, type),
            eq(notificationPreferences.email, false),
          ),
        );
      return new Set(rows.map((r) => r.userId));
    },

    // ---------------------------------------------------------------- support
    async insertSupportRequest(input) {
      const [row] = await db
        .insert(supportRequests)
        .values({
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          contactEmail: input.contactEmail,
          subject: input.subject,
          message: input.message,
          category: input.category,
          priority: input.priority,
        })
        .returning({ id: supportRequests.id });
      const [full] = await supportQuery().where(eq(supportRequests.id, row!.id)).limit(1);
      return toSupportDto(full!);
    },
    async listSupportRequests(filter: SupportFilter, page, pageSize) {
      const conds: SQL[] = [];
      if (filter.workspaceId) conds.push(eq(supportRequests.workspaceId, filter.workspaceId));
      if (filter.createdBy) conds.push(eq(supportRequests.createdBy, filter.createdBy));
      if (filter.status) conds.push(eq(supportRequests.status, filter.status));
      if (filter.category) conds.push(eq(supportRequests.category, filter.category));
      if (filter.priority) conds.push(eq(supportRequests.priority, filter.priority));
      if (filter.assignedTo) conds.push(eq(supportRequests.assignedTo, filter.assignedTo));
      if (filter.unassigned) conds.push(isNull(supportRequests.assignedTo));
      if (filter.q) {
        const like = escapeLike(filter.q);
        conds.push(
          or(
            ilike(supportRequests.subject, like),
            ilike(supportRequests.contactEmail, like),
            ilike(workspaces.name, like),
          )!,
        );
      }
      const where = conds.length ? and(...conds) : undefined;
      const [rows, [total]] = await Promise.all([
        supportQuery()
          .where(where)
          .orderBy(
            sql`case ${supportRequests.status} when 'OPEN' then 0 when 'IN_PROGRESS' then 1 else 2 end`,
            sql`case ${supportRequests.priority} when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end`,
            desc(supportRequests.createdAt),
          )
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db
          .select({ n: count() })
          .from(supportRequests)
          .leftJoin(workspaces, eq(workspaces.id, supportRequests.workspaceId))
          .where(where),
      ]);
      return { items: rows.map(toSupportDto), page, pageSize, total: total?.n ?? 0 };
    },
    async findSupportRequest(id) {
      const [row] = await supportQuery().where(eq(supportRequests.id, id)).limit(1);
      return row ? toSupportDto(row) : null;
    },
    async updateSupportRequest(id, patch) {
      const set: Partial<typeof supportRequests.$inferInsert> = {};
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.priority !== undefined) set.priority = patch.priority;
      if (patch.assignedTo !== undefined) set.assignedTo = patch.assignedTo;
      if (patch.resolvedAt !== undefined) set.resolvedAt = patch.resolvedAt;
      set.updatedAt = new Date();
      const rows = await db
        .update(supportRequests)
        .set(set)
        .where(eq(supportRequests.id, id))
        .returning({ id: supportRequests.id });
      if (rows.length === 0) return null;
      const [row] = await supportQuery().where(eq(supportRequests.id, id)).limit(1);
      return row ? toSupportDto(row) : null;
    },
    async listSupportNotes(requestId): Promise<SupportNoteDto[]> {
      const rows = await db
        .select({ n: supportRequestNotes, name: users.name })
        .from(supportRequestNotes)
        .leftJoin(users, eq(users.id, supportRequestNotes.authorId))
        .where(eq(supportRequestNotes.requestId, requestId))
        .orderBy(asc(supportRequestNotes.createdAt));
      return rows.map(({ n, name }) => ({
        id: n.id,
        body: n.body,
        isInternal: n.isInternal,
        author: n.authorId && name ? { id: n.authorId, name } : null,
        createdAt: n.createdAt.toISOString(),
      }));
    },
    async insertSupportNote(input) {
      const [n] = await db
        .insert(supportRequestNotes)
        .values({ requestId: input.requestId, authorId: input.authorId, body: input.body })
        .returning();
      const [u] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, input.authorId))
        .limit(1);
      return {
        id: n!.id,
        body: n!.body,
        isInternal: n!.isInternal,
        author: u ? { id: input.authorId, name: u.name } : null,
        createdAt: n!.createdAt.toISOString(),
      };
    },
    async findOpenUpgradeRequest(workspaceId) {
      const [row] = await db
        .select({
          id: upgradeRequests.id,
          createdAt: upgradeRequests.createdAt,
          planKey: subscriptionPlans.key,
          planName: subscriptionPlans.name,
        })
        .from(upgradeRequests)
        .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, upgradeRequests.requestedPlanId))
        .where(
          and(eq(upgradeRequests.workspaceId, workspaceId), eq(upgradeRequests.status, "PENDING")),
        )
        .limit(1);
      return row
        ? {
            id: row.id,
            subject: `${row.planName} plan`,
            requestedPlanKey: row.planKey,
            requestedPlanName: row.planName,
            createdAt: row.createdAt.toISOString(),
          }
        : null;
    },

    // ---------------------------------------------------------------- audit
    async listAudit(filter, page, pageSize) {
      const conds: SQL[] = [];
      if (filter.workspaceId) conds.push(eq(auditLogs.workspaceId, filter.workspaceId));
      if (filter.action) conds.push(ilike(auditLogs.action, escapeLike(filter.action)));
      if (filter.actorType) conds.push(eq(auditLogs.actorType, filter.actorType as "USER"));
      if (filter.from) conds.push(gte(auditLogs.createdAt, filter.from));
      if (filter.to) conds.push(lt(auditLogs.createdAt, filter.to));
      if (filter.actor) {
        const like = escapeLike(filter.actor);
        conds.push(or(ilike(users.name, like), ilike(users.email, like))!);
      }
      const where = conds.length ? and(...conds) : undefined;
      const [rows, [total]] = await Promise.all([
        db
          .select({
            a: auditLogs,
            userName: users.name,
            userEmail: users.email,
            workspaceName: workspaces.name,
          })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.actorUserId))
          .leftJoin(workspaces, eq(workspaces.id, auditLogs.workspaceId))
          .where(where)
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db
          .select({ n: count() })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.actorUserId))
          .where(where),
      ]);
      const items: AuditLogDto[] = rows.map(({ a, userName, userEmail, workspaceName }) => ({
        id: a.id,
        workspaceId: a.workspaceId,
        workspaceName: workspaceName ?? null,
        branchId: a.branchId,
        actorType: a.actorType,
        actor:
          a.actorUserId && userName && userEmail
            ? { id: a.actorUserId, name: userName, email: userEmail }
            : null,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        metadata: a.metadata,
        ip: a.ip,
        createdAt: a.createdAt.toISOString(),
      }));
      return { items, page, pageSize, total: total?.n ?? 0 };
    },
  };
}
