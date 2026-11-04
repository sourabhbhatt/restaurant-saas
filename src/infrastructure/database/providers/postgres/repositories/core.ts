import { and, count, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";

import type {
  AccessRepository,
  AuditRepository,
  EmailOutboxRepository,
  EntitlementRepository,
  IdempotencyRepository,
  IdentityRepository,
  MembershipGrants,
  RateLimitRepository,
  UserRecord,
} from "@/server/ports/core-repositories";

import type { Executor } from "../client";
import {
  auditLogs,
  authTokens,
  branches,
  diningTables,
  emailOutbox,
  idempotencyRecords,
  menuItems,
  platformSettings,
  rateLimitBuckets,
  restaurants,
  roleAssignments,
  rolePermissions,
  roles,
  storedFiles,
  subscriptionPlans,
  subscriptions,
  users,
  workspaceEntitlements,
  workspaceMemberships,
  workspaces,
} from "../schema";

function toUser(row: typeof users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    emailVerifiedAt: row.emailVerifiedAt,
    platformRole: row.platformRole ?? null,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
  };
}

export function identityRepository(db: Executor): IdentityRepository {
  return {
    async findUserByEmail(email) {
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.trim().toLowerCase()))
        .limit(1);
      return row ? toUser(row) : null;
    },
    async findUserById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ? toUser(row) : null;
    },
    async createUser(input) {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email.trim().toLowerCase(),
          name: input.name.trim(),
          passwordHash: input.passwordHash,
        })
        .returning();
      return toUser(row!);
    },
    async updateUser(id, patch) {
      await db.update(users).set(patch).where(eq(users.id, id));
    },
    async createAuthToken(input) {
      await db.insert(authTokens).values(input);
    },
    async consumeAuthToken(tokenHash, purpose, now) {
      const [row] = await db
        .update(authTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(authTokens.tokenHash, tokenHash),
            eq(authTokens.purpose, purpose),
            isNull(authTokens.usedAt),
            gt(authTokens.expiresAt, now),
          ),
        )
        .returning({ userId: authTokens.userId });
      return row ?? null;
    },
    async invalidateAuthTokens(userId, purpose, now) {
      await db
        .update(authTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(authTokens.userId, userId),
            eq(authTokens.purpose, purpose),
            isNull(authTokens.usedAt),
          ),
        );
    },
    async countRecentAuthTokens(userId, purpose, since) {
      const [row] = await db
        .select({ n: count() })
        .from(authTokens)
        .where(
          and(
            eq(authTokens.userId, userId),
            eq(authTokens.purpose, purpose),
            gte(authTokens.createdAt, since),
          ),
        );
      return row?.n ?? 0;
    },
  };
}

export function accessRepository(db: Executor): AccessRepository {
  return {
    async findBranchRef(branchId) {
      const [row] = await db
        .select({
          id: branches.id,
          workspaceId: branches.workspaceId,
          restaurantId: branches.restaurantId,
          name: branches.name,
          restaurantName: restaurants.name,
          currency: branches.currency,
          timezone: branches.timezone,
          status: branches.status,
        })
        .from(branches)
        .innerJoin(restaurants, eq(restaurants.id, branches.restaurantId))
        .where(
          and(eq(branches.id, branchId), isNull(branches.deletedAt), isNull(restaurants.deletedAt)),
        )
        .limit(1);
      return row ?? null;
    },
    async findWorkspaceName(workspaceId) {
      const [row] = await db
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
        .limit(1);
      return row?.name ?? null;
    },
    async findRestaurantRef(restaurantId) {
      const [row] = await db
        .select({
          id: restaurants.id,
          workspaceId: restaurants.workspaceId,
          name: restaurants.name,
          status: restaurants.status,
        })
        .from(restaurants)
        .where(and(eq(restaurants.id, restaurantId), isNull(restaurants.deletedAt)))
        .limit(1);
      return row ?? null;
    },
    async loadMembershipGrants(userId, workspaceId) {
      const [m] = await db
        .select({
          membershipId: workspaceMemberships.id,
          workspaceId: workspaces.id,
          workspaceName: workspaces.name,
          workspaceStatus: workspaces.status,
          status: workspaceMemberships.status,
          roleId: roles.id,
          roleKey: roles.key,
          roleName: roles.name,
        })
        .from(workspaceMemberships)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
        .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
        .where(
          and(
            eq(workspaceMemberships.userId, userId),
            eq(workspaceMemberships.workspaceId, workspaceId),
            isNull(workspaces.deletedAt),
          ),
        )
        .limit(1);
      if (!m) return null;

      const assignmentRows = await db
        .select({
          restaurantId: roleAssignments.restaurantId,
          branchId: roleAssignments.branchId,
          roleId: roleAssignments.roleId,
          roleKey: roles.key,
          roleName: roles.name,
        })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(
          and(
            eq(roleAssignments.membershipId, m.membershipId),
            eq(roleAssignments.workspaceId, workspaceId),
          ),
        );

      const roleIds = [m.roleId, ...assignmentRows.map((a) => a.roleId)];
      const perms = await db
        .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, roleIds));
      const byRole = new Map<string, string[]>();
      for (const p of perms) {
        const list = byRole.get(p.roleId) ?? [];
        list.push(p.key);
        byRole.set(p.roleId, list);
      }
      const grants: MembershipGrants = {
        membershipId: m.membershipId,
        workspaceId: m.workspaceId,
        workspaceName: m.workspaceName,
        workspaceStatus: m.workspaceStatus,
        status: m.status,
        roleKey: m.roleKey,
        roleName: m.roleName,
        workspacePermissions: byRole.get(m.roleId) ?? [],
        assignments: assignmentRows.map((a) => ({
          restaurantId: a.restaurantId,
          branchId: a.branchId,
          roleKey: a.roleKey,
          roleName: a.roleName,
          permissions: byRole.get(a.roleId) ?? [],
        })),
      };
      return grants;
    },
    async listStructure(workspaceId) {
      const rs = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          status: restaurants.status,
          logoKey: restaurants.logoKey,
        })
        .from(restaurants)
        .where(and(eq(restaurants.workspaceId, workspaceId), isNull(restaurants.deletedAt)))
        .orderBy(restaurants.name);
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
        .orderBy(branches.name);
      return rs.map((r) => ({
        ...r,
        branches: bs.filter((b) => b.restaurantId === r.id).map(({ restaurantId: _r, ...b }) => b),
      }));
    },
    async listUserWorkspaces(userId) {
      return db
        .select({
          workspaceId: workspaces.id,
          name: workspaces.name,
          slug: workspaces.slug,
          status: workspaces.status,
          roleKey: roles.key,
          roleName: roles.name,
        })
        .from(workspaceMemberships)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
        .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
        .where(
          and(
            eq(workspaceMemberships.userId, userId),
            eq(workspaceMemberships.status, "ACTIVE"),
            isNull(workspaces.deletedAt),
          ),
        )
        .orderBy(workspaces.name);
    },
  };
}

export function auditRepository(db: Executor): AuditRepository {
  return {
    async insert(entry) {
      await db.insert(auditLogs).values({
        workspaceId: entry.workspaceId,
        branchId: entry.branchId ?? null,
        actorType: entry.actorType,
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ?? {},
        ip: entry.ip ?? null,
        requestId: entry.requestId ?? null,
      });
    },
  };
}

export function entitlementRepository(db: Executor): EntitlementRepository {
  return {
    async loadSubscriptionContext(workspaceId) {
      const [ws] = await db
        .select({ status: workspaces.status })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (!ws) return null;
      const [row] = await db
        .select({ sub: subscriptions, plan: subscriptionPlans })
        .from(subscriptions)
        .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
        .where(and(eq(subscriptions.workspaceId, workspaceId), eq(subscriptions.isCurrent, true)))
        .limit(1);
      const overrides = await db
        .select({ key: workspaceEntitlements.key, value: workspaceEntitlements.value })
        .from(workspaceEntitlements)
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
      return {
        workspaceStatus: ws.status,
        subscription: row
          ? {
              id: row.sub.id,
              planId: row.sub.planId,
              status: row.sub.status,
              trialStartsAt: row.sub.trialStartsAt,
              trialEndsAt: row.sub.trialEndsAt,
              currentPeriodEnd: row.sub.currentPeriodEnd,
              cancelledAt: row.sub.cancelledAt,
            }
          : null,
        plan: row
          ? {
              id: row.plan.id,
              key: row.plan.key,
              name: row.plan.name,
              limits: row.plan.limits,
              features: row.plan.features,
            }
          : null,
        overrides,
      };
    },
    async loadPlatformSettingRows() {
      return db
        .select({ key: platformSettings.key, value: platformSettings.value })
        .from(platformSettings);
    },
    async countUsage(workspaceId) {
      const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
      const [r, b, s, t, m, f] = await Promise.all([
        one(
          db
            .select({ n: count() })
            .from(restaurants)
            .where(and(eq(restaurants.workspaceId, workspaceId), isNull(restaurants.deletedAt))),
        ),
        one(
          db
            .select({ n: count() })
            .from(branches)
            .where(and(eq(branches.workspaceId, workspaceId), isNull(branches.deletedAt))),
        ),
        one(
          db
            .select({ n: count() })
            .from(workspaceMemberships)
            .where(
              and(
                eq(workspaceMemberships.workspaceId, workspaceId),
                eq(workspaceMemberships.status, "ACTIVE"),
              ),
            ),
        ),
        one(
          db
            .select({ n: count() })
            .from(diningTables)
            .where(and(eq(diningTables.workspaceId, workspaceId), isNull(diningTables.deletedAt))),
        ),
        one(
          db
            .select({ n: count() })
            .from(menuItems)
            .where(and(eq(menuItems.workspaceId, workspaceId), isNull(menuItems.deletedAt))),
        ),
        one(
          db
            .select({ n: sql<number>`coalesce(sum(${storedFiles.sizeBytes}), 0)::int` })
            .from(storedFiles)
            .where(and(eq(storedFiles.workspaceId, workspaceId), isNull(storedFiles.deletedAt))),
        ),
      ]);
      return { restaurants: r, branches: b, staff: s, tables: t, menuItems: m, storageBytes: f };
    },
  };
}

export function idempotencyRepository(db: Executor): IdempotencyRepository {
  return {
    async find(scope, key) {
      const [row] = await db
        .select()
        .from(idempotencyRecords)
        .where(and(eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.key, key)))
        .limit(1);
      return row
        ? { requestHash: row.requestHash, statusCode: row.statusCode, response: row.response }
        : null;
    },
    async save(scope, key, requestHash, statusCode, response) {
      const rows = await db
        .insert(idempotencyRecords)
        .values({ scope, key, requestHash, statusCode, response })
        .onConflictDoNothing()
        .returning({ id: idempotencyRecords.id });
      return rows.length > 0;
    },
  };
}

export function rateLimitRepository(db: Executor): RateLimitRepository {
  return {
    async hit(key, windowMs, now) {
      const resetAt = new Date(now.getTime() + windowMs);
      const [row] = await db
        .insert(rateLimitBuckets)
        .values({ key, count: 1, resetAt })
        .onConflictDoUpdate({
          target: rateLimitBuckets.key,
          set: {
            count: sql`case when ${rateLimitBuckets.resetAt} <= ${now.toISOString()}::timestamptz then 1 else ${rateLimitBuckets.count} + 1 end`,
            resetAt: sql`case when ${rateLimitBuckets.resetAt} <= ${now.toISOString()}::timestamptz then ${resetAt.toISOString()}::timestamptz else ${rateLimitBuckets.resetAt} end`,
          },
        })
        .returning({ count: rateLimitBuckets.count, resetAt: rateLimitBuckets.resetAt });
      return row!;
    },
  };
}

export function emailOutboxRepository(db: Executor): EmailOutboxRepository {
  return {
    async enqueue(input) {
      const [row] = await db
        .insert(emailOutbox)
        .values({
          toAddress: input.to,
          subject: input.subject,
          template: input.template,
          textBody: input.text,
          htmlBody: input.html,
          provider: input.provider,
          status: input.delivered ? "PENDING" : "SENT",
        })
        .returning({ id: emailOutbox.id });
      return row!.id;
    },
    async markSent(id, providerMessageId) {
      await db
        .update(emailOutbox)
        .set({
          status: "SENT",
          sentAt: new Date(),
          providerMessageId,
          attempts: sql`${emailOutbox.attempts} + 1`,
        })
        .where(eq(emailOutbox.id, id));
    },
    async markFailed(id, error) {
      await db
        .update(emailOutbox)
        .set({
          status: "FAILED",
          lastError: error.slice(0, 300),
          attempts: sql`${emailOutbox.attempts} + 1`,
        })
        .where(eq(emailOutbox.id, id));
    },
  };
}
