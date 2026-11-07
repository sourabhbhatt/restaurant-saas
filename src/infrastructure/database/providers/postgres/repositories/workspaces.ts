import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { WorkspaceDto } from "@/contracts/workspaces";
import type { WorkspaceRepository } from "@/server/modules/workspaces/ports";

import type { Executor } from "../client";
import {
  organizationMembers,
  organizations,
  roles,
  subscriptionEvents,
  subscriptionPlans,
  subscriptions,
  workspaceMemberships,
  workspaces,
} from "../schema";

function toDto(row: typeof workspaces.$inferSelect): WorkspaceDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    legalName: row.legalName,
    businessEmail: row.businessEmail,
    businessPhone: row.businessPhone,
    country: row.country,
    taxId: row.taxId,
    defaultCurrency: row.defaultCurrency,
    onboarding: row.onboarding,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

export function workspaceRepository(db: Executor): WorkspaceRepository {
  return {
    async slugExists(slug) {
      const [row] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slug))
        .limit(1);
      return Boolean(row);
    },
    async insert(input) {
      const [row] = await db.insert(workspaces).values(input).returning();
      return toDto(row!);
    },
    async findById(workspaceId) {
      const [row] = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
        .limit(1);
      return row ? toDto(row) : null;
    },
    async update(workspaceId, patch, expectedVersion) {
      const [row] = await db
        .update(workspaces)
        .set({ ...patch, version: sql`${workspaces.version} + 1` })
        .where(
          and(
            eq(workspaces.id, workspaceId),
            expectedVersion !== undefined ? eq(workspaces.version, expectedVersion) : undefined,
          ),
        )
        .returning();
      return row ? toDto(row) : null;
    },
    async setOnboarding(workspaceId, progress) {
      await db
        .update(workspaces)
        .set({ onboarding: progress })
        .where(eq(workspaces.id, workspaceId));
    },
    async findSystemRoleId(key) {
      const [row] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(isNull(roles.workspaceId), eq(roles.key, key)))
        .limit(1);
      if (!row) throw new Error(`System role ${key} missing; run ensureSystemData`);
      return row.id;
    },
    async insertMembership(input) {
      const [row] = await db
        .insert(workspaceMemberships)
        .values({ ...input, invitedBy: input.invitedBy ?? null })
        .returning({ id: workspaceMemberships.id });
      return row!.id;
    },
    async findPlanByKey(key) {
      const [row] = await db
        .select({ id: subscriptionPlans.id, key: subscriptionPlans.key })
        .from(subscriptionPlans)
        .where(and(eq(subscriptionPlans.key, key), eq(subscriptionPlans.status, "ACTIVE")))
        .limit(1);
      return row ?? null;
    },
    async listOrganizationsForUser(userId) {
      return db
        .select({
          id: organizations.id,
          name: organizations.name,
          role: organizationMembers.role,
          workspaceCount: count(workspaces.id),
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .leftJoin(
          workspaces,
          and(eq(workspaces.organizationId, organizations.id), isNull(workspaces.deletedAt)),
        )
        .where(eq(organizationMembers.userId, userId))
        .groupBy(organizations.id, organizations.name, organizationMembers.role)
        .orderBy(organizations.name);
    },
    async lockOrganization(organizationId) {
      await db.execute(
        sql`select id from ${organizations} where ${organizations.id} = ${organizationId} for update`,
      );
    },
    async countOrganizationWorkspaces(organizationId, since) {
      const [row] = await db
        .select({
          total: count(),
          createdSince: sql<number>`count(*) filter (where ${workspaces.createdAt} > ${since.toISOString()}::timestamptz)::int`,
        })
        .from(workspaces)
        .where(and(eq(workspaces.organizationId, organizationId), isNull(workspaces.deletedAt)));
      return { total: row?.total ?? 0, createdSince: Number(row?.createdSince ?? 0) };
    },
    async hasStartedTrial(userId) {
      const [row] = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .innerJoin(organizations, eq(organizations.id, subscriptions.organizationId))
        .where(and(eq(organizations.createdBy, userId), isNotNull(subscriptions.trialStartsAt)))
        .limit(1);
      return Boolean(row);
    },
    async insertOrganization(input) {
      const [row] = await db
        .insert(organizations)
        .values({ name: input.name, createdBy: input.createdBy })
        .returning({ id: organizations.id });
      return row!;
    },
    async insertOrganizationMember(input) {
      await db.insert(organizationMembers).values(input);
    },
    async insertSubscription(input) {
      const [sub] = await db
        .insert(subscriptions)
        .values({
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          planId: input.planId,
          status: input.status,
          trialStartsAt: input.trialStartsAt,
          trialEndsAt: input.trialEndsAt,
          isCurrent: true,
        })
        .returning({ id: subscriptions.id });
      await db.insert(subscriptionEvents).values({
        workspaceId: input.workspaceId,
        subscriptionId: sub!.id,
        type: input.status === "TRIALING" ? "trial_started" : "activated",
        toStatus: input.status,
        planKey: input.planKey,
        actorUserId: input.actorUserId,
      });
    },
  };
}
