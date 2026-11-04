import { and, asc, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  AssignmentDto,
  BranchDto,
  BranchSettingsDto,
  BusinessHoursDayDto,
  InvitationDto,
  MemberDto,
  RestaurantDto,
  RoleDto,
  StaffAssignmentDto,
} from "@/contracts/tenancy";
import { isPermission } from "@/domain/access/permissions";
import type {
  InvitationRecord,
  RoleRecord,
  TenancyRepository,
} from "@/server/modules/tenancy/ports";

import type { Executor } from "../client";
import {
  branchSettings,
  branches,
  invitations,
  menus,
  restaurantSettings,
  restaurants,
  roleAssignments,
  rolePermissions,
  roles,
  tableSessions,
  users,
  workspaceMemberships,
  workspaces,
} from "../schema";
import { notifyUsers } from "./notifications";

type RestaurantRow = typeof restaurants.$inferSelect;
type BranchRow = typeof branches.$inferSelect;
type SettingsRow = typeof branchSettings.$inferSelect;
type RoleRow = typeof roles.$inferSelect;

function toRestaurant(row: RestaurantRow): RestaurantDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    cuisineTypes: row.cuisineTypes,
    logoKey: row.logoKey,
    coverKey: row.coverKey,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    website: row.website,
    brandColor: row.brandColor,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBranch(row: BranchRow, restaurantName: string): BranchDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    restaurantId: row.restaurantId,
    restaurantName,
    name: row.name,
    code: row.code,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    phone: row.phone,
    email: row.email,
    timezone: row.timezone,
    currency: row.currency,
    businessHours: row.businessHours as BusinessHoursDayDto[],
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSettings(row: SettingsRow): BranchSettingsDto {
  return {
    branchId: row.branchId,
    taxes: row.taxes.map((t) => ({ name: t.name, rateBps: t.rateBps })),
    pricesIncludeTax: row.pricesIncludeTax,
    serviceChargeBps: row.serviceChargeBps,
    paymentMethods: row.paymentMethods,
    requireFullPaymentToClose: row.requireFullPaymentToClose,
    autoCompleteOnPayment: row.autoCompleteOnPayment,
    allowCustomerBillRequest: row.allowCustomerBillRequest,
    acceptingOrders: row.acceptingOrders,
    kitchenDelayMinutes: row.kitchenDelayMinutes,
    kitchenSoundEnabled: row.kitchenSoundEnabled,
    waiterSoundEnabled: row.waiterSoundEnabled,
    receiptHeader: row.receiptHeader,
    receiptFooter: row.receiptFooter,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRoleRecord(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    scope: row.scope,
    workspaceId: row.workspaceId,
    isSystem: row.isSystem,
    description: row.description,
  };
}

const roleVisibleIn = (workspaceId: string) =>
  or(isNull(roles.workspaceId), eq(roles.workspaceId, workspaceId));

const liveRestaurant = (workspaceId: string) =>
  and(eq(restaurants.workspaceId, workspaceId), isNull(restaurants.deletedAt));

const liveBranch = (workspaceId: string) =>
  and(eq(branches.workspaceId, workspaceId), isNull(branches.deletedAt));

const assignmentRoles = alias(roles, "assignment_roles");
const inviter = alias(users, "inviter");

export function tenancyRepository(db: Executor): TenancyRepository {
  async function assignmentsFor(workspaceId: string, membershipIds: string[]) {
    if (membershipIds.length === 0) return new Map<string, AssignmentDto[]>();
    const rows = await db
      .select({
        id: roleAssignments.id,
        membershipId: roleAssignments.membershipId,
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
        roleScope: roles.scope,
        restaurantId: roleAssignments.restaurantId,
        restaurantName: restaurants.name,
        branchId: roleAssignments.branchId,
        branchName: branches.name,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .innerJoin(restaurants, eq(restaurants.id, roleAssignments.restaurantId))
      .leftJoin(branches, eq(branches.id, roleAssignments.branchId))
      .where(
        and(
          eq(roleAssignments.workspaceId, workspaceId),
          inArray(roleAssignments.membershipId, membershipIds),
          isNull(restaurants.deletedAt),
          or(isNull(roleAssignments.branchId), isNull(branches.deletedAt)),
        ),
      )
      .orderBy(asc(restaurants.name), asc(branches.name));
    const map = new Map<string, AssignmentDto[]>();
    for (const r of rows) {
      const list = map.get(r.membershipId) ?? [];
      list.push({
        id: r.id,
        role: { id: r.roleId, key: r.roleKey, name: r.roleName, scope: r.roleScope },
        restaurantId: r.restaurantId,
        restaurantName: r.restaurantName,
        branchId: r.branchId,
        branchName: r.branchName,
      });
      map.set(r.membershipId, list);
    }
    return map;
  }

  async function membersWhere(workspaceId: string, membershipId?: string): Promise<MemberDto[]> {
    const rows = await db
      .select({
        membershipId: workspaceMemberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        status: workspaceMemberships.status,
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
        roleScope: roles.scope,
        joinedAt: workspaceMemberships.createdAt,
      })
      .from(workspaceMemberships)
      .innerJoin(users, eq(users.id, workspaceMemberships.userId))
      .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          membershipId ? eq(workspaceMemberships.id, membershipId) : undefined,
        ),
      )
      .orderBy(asc(users.name));
    const assignments = await assignmentsFor(
      workspaceId,
      rows.map((r) => r.membershipId),
    );
    return rows.map((r) => ({
      membershipId: r.membershipId,
      userId: r.userId,
      name: r.name,
      email: r.email,
      status: r.status,
      role: { id: r.roleId, key: r.roleKey, name: r.roleName, scope: r.roleScope },
      joinedAt: r.joinedAt.toISOString(),
      assignments: assignments.get(r.membershipId) ?? [],
    }));
  }

  async function invitationsWhere(
    workspaceId: string,
    now: Date,
    invitationId?: string,
  ): Promise<InvitationDto[]> {
    const rows = await db
      .select({
        inv: invitations,
        wsRoleKey: roles.key,
        wsRoleName: roles.name,
        wsRoleScope: roles.scope,
        asRoleKey: assignmentRoles.key,
        asRoleName: assignmentRoles.name,
        asRoleScope: assignmentRoles.scope,
        restaurantName: restaurants.name,
        branchName: branches.name,
        inviterName: inviter.name,
      })
      .from(invitations)
      .innerJoin(roles, eq(roles.id, invitations.workspaceRoleId))
      .leftJoin(assignmentRoles, eq(assignmentRoles.id, invitations.assignmentRoleId))
      .leftJoin(restaurants, eq(restaurants.id, invitations.restaurantId))
      .leftJoin(branches, eq(branches.id, invitations.branchId))
      .leftJoin(inviter, eq(inviter.id, invitations.invitedBy))
      .where(
        and(
          eq(invitations.workspaceId, workspaceId),
          invitationId ? eq(invitations.id, invitationId) : undefined,
        ),
      )
      .orderBy(sql`${invitations.createdAt} desc`)
      .limit(invitationId ? 1 : 200);
    return rows.map((r) => ({
      id: r.inv.id,
      email: r.inv.email,
      status: r.inv.status,
      expired:
        r.inv.status === "EXPIRED" ||
        (r.inv.status === "PENDING" && r.inv.expiresAt.getTime() <= now.getTime()),
      workspaceRole: {
        id: r.inv.workspaceRoleId,
        key: r.wsRoleKey,
        name: r.wsRoleName,
        scope: r.wsRoleScope,
      },
      assignmentRole:
        r.inv.assignmentRoleId && r.asRoleKey && r.asRoleName && r.asRoleScope
          ? {
              id: r.inv.assignmentRoleId,
              key: r.asRoleKey,
              name: r.asRoleName,
              scope: r.asRoleScope,
            }
          : null,
      restaurantId: r.inv.restaurantId,
      restaurantName: r.restaurantName,
      branchId: r.inv.branchId,
      branchName: r.branchName,
      invitedByName: r.inviterName,
      expiresAt: r.inv.expiresAt.toISOString(),
      createdAt: r.inv.createdAt.toISOString(),
    }));
  }

  function toInvitationRecord(row: typeof invitations.$inferSelect): InvitationRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      email: row.email,
      status: row.status,
      workspaceRoleId: row.workspaceRoleId,
      assignmentRoleId: row.assignmentRoleId,
      restaurantId: row.restaurantId,
      branchId: row.branchId,
      expiresAt: row.expiresAt,
    };
  }

  async function rolesWhere(workspaceId: string, roleId?: string): Promise<RoleDto[]> {
    const rows = await db
      .select()
      .from(roles)
      .where(and(roleVisibleIn(workspaceId), roleId ? eq(roles.id, roleId) : undefined))
      .orderBy(sql`${roles.isSystem} desc`, asc(roles.name));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [perms, memberUse, assignmentUse, invitationUse] = await Promise.all([
      db
        .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, ids)),
      db
        .select({ roleId: workspaceMemberships.roleId, n: count() })
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            inArray(workspaceMemberships.roleId, ids),
          ),
        )
        .groupBy(workspaceMemberships.roleId),
      db
        .select({ roleId: roleAssignments.roleId, n: count() })
        .from(roleAssignments)
        .where(
          and(eq(roleAssignments.workspaceId, workspaceId), inArray(roleAssignments.roleId, ids)),
        )
        .groupBy(roleAssignments.roleId),
      db
        .select({ ws: invitations.workspaceRoleId, as: invitations.assignmentRoleId })
        .from(invitations)
        .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.status, "PENDING"))),
    ]);
    const usage = new Map<string, number>();
    const bump = (id: string | null, n = 1) => {
      if (id) usage.set(id, (usage.get(id) ?? 0) + n);
    };
    for (const m of memberUse) bump(m.roleId, m.n);
    for (const a of assignmentUse) bump(a.roleId, a.n);
    for (const i of invitationUse) {
      bump(i.ws);
      bump(i.as);
    }
    const permsByRole = new Map<string, RoleDto["permissions"]>();
    for (const p of perms) {
      if (!isPermission(p.key)) continue;
      const list = permsByRole.get(p.roleId) ?? [];
      list.push(p.key);
      permsByRole.set(p.roleId, list);
    }
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      scope: r.scope,
      description: r.description,
      isSystem: r.isSystem,
      permissions: permsByRole.get(r.id) ?? [],
      usageCount: usage.get(r.id) ?? 0,
    }));
  }

  return {
    // ---------------------------------------------------------- workspace / users
    async findWorkspace(workspaceId) {
      const [row] = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          country: workspaces.country,
          defaultCurrency: workspaces.defaultCurrency,
        })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
        .limit(1);
      return row ?? null;
    },
    async findUserByEmail(email) {
      const [row] = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.email, email.trim().toLowerCase()))
        .limit(1);
      return row ?? null;
    },
    async findUserName(userId) {
      const [row] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.name ?? null;
    },
    async updateUserName(userId, name) {
      await db.update(users).set({ name }).where(eq(users.id, userId));
    },

    // ---------------------------------------------------------- restaurants
    async listRestaurants(workspaceId, restaurantIds) {
      if (restaurantIds && restaurantIds.length === 0) return [];
      const rows = await db
        .select()
        .from(restaurants)
        .where(
          and(
            liveRestaurant(workspaceId),
            restaurantIds ? inArray(restaurants.id, restaurantIds) : undefined,
          ),
        )
        .orderBy(asc(restaurants.name));
      return rows.map(toRestaurant);
    },
    async listBranchSummaries(workspaceId, restaurantIds) {
      if (restaurantIds.length === 0) return [];
      return db
        .select({
          id: branches.id,
          restaurantId: branches.restaurantId,
          name: branches.name,
          code: branches.code,
          city: branches.city,
          status: branches.status,
        })
        .from(branches)
        .where(and(liveBranch(workspaceId), inArray(branches.restaurantId, restaurantIds)))
        .orderBy(asc(branches.name));
    },
    async restaurantSlugExists(workspaceId, slug) {
      const [row] = await db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(and(liveRestaurant(workspaceId), eq(restaurants.slug, slug)))
        .limit(1);
      return Boolean(row);
    },
    async insertRestaurant(workspaceId, input) {
      const [row] = await db
        .insert(restaurants)
        .values({ workspaceId, ...input })
        .returning();
      await db.insert(restaurantSettings).values({ restaurantId: row!.id, workspaceId });
      await db.insert(menus).values({ workspaceId, restaurantId: row!.id, name: "Main Menu" });
      return toRestaurant(row!);
    },
    async findRestaurant(workspaceId, restaurantId) {
      const [row] = await db
        .select()
        .from(restaurants)
        .where(and(liveRestaurant(workspaceId), eq(restaurants.id, restaurantId)))
        .limit(1);
      return row ? toRestaurant(row) : null;
    },
    async getRestaurantSettings(workspaceId, restaurantId) {
      const [row] = await db
        .select()
        .from(restaurantSettings)
        .where(
          and(
            eq(restaurantSettings.workspaceId, workspaceId),
            eq(restaurantSettings.restaurantId, restaurantId),
          ),
        )
        .limit(1);
      if (!row) {
        // Restaurants created before settings existed: lazily create defaults.
        const [created] = await db
          .insert(restaurantSettings)
          .values({ restaurantId, workspaceId })
          .onConflictDoNothing()
          .returning();
        return {
          showPrepTime: created?.showPrepTime ?? true,
          showAllergens: created?.showAllergens ?? true,
          welcomeMessage: created?.welcomeMessage ?? null,
          version: created?.version ?? 1,
        };
      }
      return {
        showPrepTime: row.showPrepTime,
        showAllergens: row.showAllergens,
        welcomeMessage: row.welcomeMessage,
        version: row.version,
      };
    },
    async updateRestaurant(workspaceId, restaurantId, patch, expectedVersion) {
      const [row] = await db
        .update(restaurants)
        .set({ ...patch, version: sql`${restaurants.version} + 1` })
        .where(
          and(
            liveRestaurant(workspaceId),
            eq(restaurants.id, restaurantId),
            expectedVersion !== undefined ? eq(restaurants.version, expectedVersion) : undefined,
          ),
        )
        .returning();
      return row ? toRestaurant(row) : null;
    },
    async updateRestaurantSettings(workspaceId, restaurantId, patch) {
      await db
        .insert(restaurantSettings)
        .values({ restaurantId, workspaceId, ...patch })
        .onConflictDoUpdate({
          target: restaurantSettings.restaurantId,
          set: { ...patch, version: sql`${restaurantSettings.version} + 1` },
          setWhere: eq(restaurantSettings.workspaceId, workspaceId),
        });
    },
    async archiveRestaurant(workspaceId, restaurantId, now) {
      const rows = await db
        .update(restaurants)
        .set({ status: "ARCHIVED", deletedAt: now, version: sql`${restaurants.version} + 1` })
        .where(and(liveRestaurant(workspaceId), eq(restaurants.id, restaurantId)))
        .returning({ id: restaurants.id });
      if (rows.length === 0) return false;
      await db
        .update(branches)
        .set({ status: "ARCHIVED", deletedAt: now, version: sql`${branches.version} + 1` })
        .where(and(liveBranch(workspaceId), eq(branches.restaurantId, restaurantId)));
      return true;
    },
    async countOpenSessions(workspaceId, target) {
      const [row] = await db
        .select({ n: count() })
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.workspaceId, workspaceId),
            eq(tableSessions.restaurantId, target.restaurantId),
            target.branchId ? eq(tableSessions.branchId, target.branchId) : undefined,
            ne(tableSessions.status, "CLOSED"),
          ),
        );
      return row?.n ?? 0;
    },

    // ---------------------------------------------------------- branches
    async listBranches(workspaceId, restaurantId) {
      const rows = await db
        .select({ b: branches, restaurantName: restaurants.name })
        .from(branches)
        .innerJoin(restaurants, eq(restaurants.id, branches.restaurantId))
        .where(
          and(
            liveBranch(workspaceId),
            eq(branches.restaurantId, restaurantId),
            isNull(restaurants.deletedAt),
          ),
        )
        .orderBy(asc(branches.name));
      return rows.map((r) => toBranch(r.b, r.restaurantName));
    },
    async countBranches(workspaceId, restaurantId) {
      const [row] = await db
        .select({ n: count() })
        .from(branches)
        .where(and(liveBranch(workspaceId), eq(branches.restaurantId, restaurantId)));
      return row?.n ?? 0;
    },
    async listBranchCodes(workspaceId, restaurantId, exceptBranchId) {
      const rows = await db
        .select({ code: branches.code })
        .from(branches)
        .where(
          and(
            liveBranch(workspaceId),
            eq(branches.restaurantId, restaurantId),
            exceptBranchId ? ne(branches.id, exceptBranchId) : undefined,
          ),
        );
      return rows.map((r) => r.code);
    },
    async insertBranch(workspaceId, restaurantId, input) {
      const [row] = await db
        .insert(branches)
        .values({ workspaceId, restaurantId, ...input })
        .returning();
      await db.insert(branchSettings).values({ branchId: row!.id, workspaceId });
      const [r] = await db
        .select({ name: restaurants.name })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
      return toBranch(row!, r?.name ?? "");
    },
    async findBranch(workspaceId, branchId) {
      const [row] = await db
        .select({ b: branches, restaurantName: restaurants.name })
        .from(branches)
        .innerJoin(restaurants, eq(restaurants.id, branches.restaurantId))
        .where(and(liveBranch(workspaceId), eq(branches.id, branchId), isNull(restaurants.deletedAt)))
        .limit(1);
      return row ? toBranch(row.b, row.restaurantName) : null;
    },
    async updateBranch(workspaceId, branchId, patch, expectedVersion) {
      const [row] = await db
        .update(branches)
        .set({ ...patch, version: sql`${branches.version} + 1` })
        .where(
          and(
            liveBranch(workspaceId),
            eq(branches.id, branchId),
            expectedVersion !== undefined ? eq(branches.version, expectedVersion) : undefined,
          ),
        )
        .returning();
      if (!row) return null;
      const [r] = await db
        .select({ name: restaurants.name })
        .from(restaurants)
        .where(eq(restaurants.id, row.restaurantId))
        .limit(1);
      return toBranch(row, r?.name ?? "");
    },
    async archiveBranch(workspaceId, branchId, now) {
      const rows = await db
        .update(branches)
        .set({ status: "ARCHIVED", deletedAt: now, version: sql`${branches.version} + 1` })
        .where(and(liveBranch(workspaceId), eq(branches.id, branchId)))
        .returning({ id: branches.id });
      return rows.length > 0;
    },
    async getBranchSettings(workspaceId, branchId) {
      const [row] = await db
        .select()
        .from(branchSettings)
        .where(and(eq(branchSettings.workspaceId, workspaceId), eq(branchSettings.branchId, branchId)))
        .limit(1);
      if (row) return toSettings(row);
      const [created] = await db
        .insert(branchSettings)
        .values({ branchId, workspaceId })
        .onConflictDoNothing()
        .returning();
      return created ? toSettings(created) : null;
    },
    async updateBranchSettings(workspaceId, branchId, settings, expectedVersion) {
      const [row] = await db
        .update(branchSettings)
        .set({ ...settings, version: sql`${branchSettings.version} + 1` })
        .where(
          and(
            eq(branchSettings.workspaceId, workspaceId),
            eq(branchSettings.branchId, branchId),
            expectedVersion !== undefined ? eq(branchSettings.version, expectedVersion) : undefined,
          ),
        )
        .returning();
      return row ? toSettings(row) : null;
    },

    // ---------------------------------------------------------- roles
    listRoles: (workspaceId) => rolesWhere(workspaceId),
    async findRoleDto(workspaceId, roleId) {
      const [role] = await rolesWhere(workspaceId, roleId);
      return role ?? null;
    },
    async findRole(workspaceId, roleId) {
      const [row] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), roleVisibleIn(workspaceId)))
        .limit(1);
      return row ? toRoleRecord(row) : null;
    },
    async findSystemRole(key) {
      const [row] = await db
        .select()
        .from(roles)
        .where(and(isNull(roles.workspaceId), eq(roles.key, key)))
        .limit(1);
      if (!row) throw new Error(`System role ${key} missing; run ensureSystemData`);
      return toRoleRecord(row);
    },
    async roleKeyExists(workspaceId, key) {
      const [row] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(roleVisibleIn(workspaceId), eq(roles.key, key)))
        .limit(1);
      return Boolean(row);
    },
    async insertRole(workspaceId, input) {
      const [row] = await db
        .insert(roles)
        .values({
          workspaceId,
          key: input.key,
          name: input.name,
          description: input.description,
          scope: input.scope,
          isSystem: false,
        })
        .returning({ id: roles.id });
      await db
        .insert(rolePermissions)
        .values(input.permissions.map((p) => ({ roleId: row!.id, permissionKey: p })));
      return row!.id;
    },
    async updateRole(workspaceId, roleId, patch) {
      const where = and(
        eq(roles.id, roleId),
        eq(roles.workspaceId, workspaceId),
        eq(roles.isSystem, false),
      );
      const fields: { name?: string; description?: string | null } = {};
      if (patch.name !== undefined) fields.name = patch.name;
      if (patch.description !== undefined) fields.description = patch.description;
      const rows = await db
        .update(roles)
        .set({ ...fields, updatedAt: new Date() })
        .where(where)
        .returning({ id: roles.id });
      if (rows.length === 0) return false;
      if (patch.permissions) {
        await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
        await db
          .insert(rolePermissions)
          .values(patch.permissions.map((p) => ({ roleId, permissionKey: p })));
      }
      return true;
    },
    async deleteRole(workspaceId, roleId) {
      const rows = await db
        .delete(roles)
        .where(
          and(eq(roles.id, roleId), eq(roles.workspaceId, workspaceId), eq(roles.isSystem, false)),
        )
        .returning({ id: roles.id });
      return rows.length > 0;
    },
    async roleUsageCount(workspaceId, roleId) {
      const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
      const [m, a, i] = await Promise.all([
        one(
          db
            .select({ n: count() })
            .from(workspaceMemberships)
            .where(
              and(
                eq(workspaceMemberships.workspaceId, workspaceId),
                eq(workspaceMemberships.roleId, roleId),
              ),
            ),
        ),
        one(
          db
            .select({ n: count() })
            .from(roleAssignments)
            .where(
              and(eq(roleAssignments.workspaceId, workspaceId), eq(roleAssignments.roleId, roleId)),
            ),
        ),
        one(
          db
            .select({ n: count() })
            .from(invitations)
            .where(
              and(
                eq(invitations.workspaceId, workspaceId),
                or(
                  eq(invitations.workspaceRoleId, roleId),
                  eq(invitations.assignmentRoleId, roleId),
                ),
              ),
            ),
        ),
      ]);
      return m + a + i;
    },

    // ---------------------------------------------------------- members
    listMembers: (workspaceId) => membersWhere(workspaceId),
    async findMember(workspaceId, membershipId) {
      const [m] = await membersWhere(workspaceId, membershipId);
      return m ?? null;
    },
    async findMembership(workspaceId, membershipId) {
      const [row] = await db
        .select({
          id: workspaceMemberships.id,
          workspaceId: workspaceMemberships.workspaceId,
          userId: workspaceMemberships.userId,
          status: workspaceMemberships.status,
          roleId: workspaceMemberships.roleId,
          roleKey: roles.key,
        })
        .from(workspaceMemberships)
        .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            eq(workspaceMemberships.id, membershipId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async findMembershipByUser(workspaceId, userId) {
      const [row] = await db
        .select({
          id: workspaceMemberships.id,
          workspaceId: workspaceMemberships.workspaceId,
          userId: workspaceMemberships.userId,
          status: workspaceMemberships.status,
          roleId: workspaceMemberships.roleId,
          roleKey: roles.key,
        })
        .from(workspaceMemberships)
        .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            eq(workspaceMemberships.userId, userId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async lockActiveOwners(workspaceId) {
      const [owner] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(isNull(roles.workspaceId), eq(roles.key, "workspace_owner")))
        .limit(1);
      if (!owner) return [];
      const rows = await db
        .select({ id: workspaceMemberships.id })
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            eq(workspaceMemberships.roleId, owner.id),
            eq(workspaceMemberships.status, "ACTIVE"),
          ),
        )
        .for("update");
      return rows.map((r) => r.id);
    },
    async updateMembership(workspaceId, membershipId, patch) {
      const fields: { roleId?: string; status?: "ACTIVE" | "DISABLED" } = {};
      if (patch.roleId !== undefined) fields.roleId = patch.roleId;
      if (patch.status !== undefined) fields.status = patch.status;
      await db
        .update(workspaceMemberships)
        .set(fields)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            eq(workspaceMemberships.id, membershipId),
          ),
        );
    },
    async deleteMembership(workspaceId, membershipId) {
      const rows = await db
        .delete(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            eq(workspaceMemberships.id, membershipId),
          ),
        )
        .returning({ id: workspaceMemberships.id });
      return rows.length > 0;
    },
    async insertMembership(input) {
      const [row] = await db
        .insert(workspaceMemberships)
        .values(input)
        .returning({ id: workspaceMemberships.id });
      return row!.id;
    },
    async isActiveMemberEmail(workspaceId, email) {
      const [row] = await db
        .select({ id: workspaceMemberships.id })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            eq(workspaceMemberships.status, "ACTIVE"),
            eq(users.email, email.trim().toLowerCase()),
          ),
        )
        .limit(1);
      return Boolean(row);
    },
    async listActiveMemberOptions(workspaceId) {
      return db
        .select({
          membershipId: workspaceMemberships.id,
          name: users.name,
          email: users.email,
          roleName: roles.name,
        })
        .from(workspaceMemberships)
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            eq(workspaceMemberships.status, "ACTIVE"),
          ),
        )
        .orderBy(asc(users.name));
    },

    // ---------------------------------------------------------- assignments
    async listBranchAssignments(workspaceId, restaurantId, branchId) {
      const rows = await db
        .select({
          id: roleAssignments.id,
          membershipId: workspaceMemberships.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          memberStatus: workspaceMemberships.status,
          roleId: roles.id,
          roleKey: roles.key,
          roleName: roles.name,
          roleScope: roles.scope,
          restaurantId: roleAssignments.restaurantId,
          restaurantName: restaurants.name,
          branchId: roleAssignments.branchId,
          branchName: branches.name,
        })
        .from(roleAssignments)
        .innerJoin(workspaceMemberships, eq(workspaceMemberships.id, roleAssignments.membershipId))
        .innerJoin(users, eq(users.id, workspaceMemberships.userId))
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .innerJoin(restaurants, eq(restaurants.id, roleAssignments.restaurantId))
        .leftJoin(branches, eq(branches.id, roleAssignments.branchId))
        .where(
          and(
            eq(roleAssignments.workspaceId, workspaceId),
            eq(roleAssignments.restaurantId, restaurantId),
            or(isNull(roleAssignments.branchId), eq(roleAssignments.branchId, branchId)),
          ),
        )
        .orderBy(asc(users.name), asc(roles.name));
      return rows.map(
        (r): StaffAssignmentDto => ({
          id: r.id,
          membershipId: r.membershipId,
          userId: r.userId,
          name: r.name,
          email: r.email,
          memberStatus: r.memberStatus,
          role: { id: r.roleId, key: r.roleKey, name: r.roleName, scope: r.roleScope },
          restaurantId: r.restaurantId,
          restaurantName: r.restaurantName,
          branchId: r.branchId,
          branchName: r.branchName,
        }),
      );
    },
    async findAssignment(workspaceId, assignmentId) {
      const [row] = await db
        .select({
          id: roleAssignments.id,
          membershipId: roleAssignments.membershipId,
          roleId: roleAssignments.roleId,
          restaurantId: roleAssignments.restaurantId,
          branchId: roleAssignments.branchId,
        })
        .from(roleAssignments)
        .where(and(eq(roleAssignments.workspaceId, workspaceId), eq(roleAssignments.id, assignmentId)))
        .limit(1);
      return row ?? null;
    },
    async insertAssignment(input) {
      const rows = await db
        .insert(roleAssignments)
        .values(input)
        .onConflictDoNothing()
        .returning({ id: roleAssignments.id });
      const id = rows[0]?.id;
      if (!id) return null;
      const map = await assignmentsFor(input.workspaceId, [input.membershipId]);
      return map.get(input.membershipId)?.find((a) => a.id === id) ?? null;
    },
    async deleteAssignment(workspaceId, assignmentId) {
      const rows = await db
        .delete(roleAssignments)
        .where(and(eq(roleAssignments.workspaceId, workspaceId), eq(roleAssignments.id, assignmentId)))
        .returning({ id: roleAssignments.id });
      return rows.length > 0;
    },

    // ---------------------------------------------------------- invitations
    listInvitations: (workspaceId, now) => invitationsWhere(workspaceId, now),
    async findInvitationDto(workspaceId, invitationId, now) {
      const [row] = await invitationsWhere(workspaceId, now, invitationId);
      return row ?? null;
    },
    async findInvitation(workspaceId, invitationId) {
      const [row] = await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.id, invitationId)))
        .limit(1);
      return row ? toInvitationRecord(row) : null;
    },
    async findPendingInvitationByEmail(workspaceId, email) {
      const [row] = await db
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.workspaceId, workspaceId),
            eq(invitations.email, email.trim().toLowerCase()),
            eq(invitations.status, "PENDING"),
          ),
        )
        .limit(1);
      return row ? toInvitationRecord(row) : null;
    },
    async findInvitationByTokenHash(tokenHash, lock = false) {
      const base = db
        .select({
          inv: invitations,
          workspaceName: workspaces.name,
          roleName: roles.name,
          assignmentRoleName: assignmentRoles.name,
          restaurantName: restaurants.name,
          branchName: branches.name,
          inviterName: inviter.name,
        })
        .from(invitations)
        .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
        .innerJoin(roles, eq(roles.id, invitations.workspaceRoleId))
        .leftJoin(assignmentRoles, eq(assignmentRoles.id, invitations.assignmentRoleId))
        .leftJoin(restaurants, eq(restaurants.id, invitations.restaurantId))
        .leftJoin(branches, eq(branches.id, invitations.branchId))
        .leftJoin(inviter, eq(inviter.id, invitations.invitedBy))
        .where(and(eq(invitations.tokenHash, tokenHash), isNull(workspaces.deletedAt)))
        .limit(1);
      const [row] = lock ? await base.for("update", { of: invitations }) : await base;
      if (!row) return null;
      return {
        ...toInvitationRecord(row.inv),
        workspaceName: row.workspaceName,
        inviterName: row.inviterName,
        roleName: row.roleName,
        assignmentRoleName: row.assignmentRoleName,
        restaurantName: row.restaurantName,
        branchName: row.branchName,
      };
    },
    async insertInvitation(input) {
      const email = input.email.trim().toLowerCase();
      const [row] = await db
        .insert(invitations)
        .values({
          workspaceId: input.workspaceId,
          email,
          tokenHash: input.tokenHash,
          workspaceRoleId: input.workspaceRoleId,
          assignmentRoleId: input.assignmentRoleId,
          restaurantId: input.restaurantId,
          branchId: input.branchId,
          invitedBy: input.invitedBy,
          expiresAt: input.expiresAt,
        })
        .returning({ id: invitations.id });
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing) {
        // Global (workspace null): the invitee is not a member of this workspace yet.
        await notifyUsers(
          db,
          [existing.id],
          { workspaceId: null },
          {
            type: "staff.invited",
            title: `You're invited to join ${input.workspaceName}`,
            body: `${input.inviterName} invited you. Open the invitation link sent to ${email} to accept.`,
            data: { invitationId: row!.id },
          },
        );
      }
      return row!.id;
    },
    async rotateInvitationToken(workspaceId, invitationId, tokenHash, expiresAt) {
      const rows = await db
        .update(invitations)
        .set({ tokenHash, expiresAt })
        .where(
          and(
            eq(invitations.workspaceId, workspaceId),
            eq(invitations.id, invitationId),
            eq(invitations.status, "PENDING"),
          ),
        )
        .returning({ id: invitations.id });
      return rows.length > 0;
    },
    async transitionInvitation(workspaceId, invitationId, to, extra = {}) {
      const rows = await db
        .update(invitations)
        .set({
          status: to,
          ...(extra.acceptedAt ? { acceptedAt: extra.acceptedAt } : {}),
          ...(extra.acceptedBy ? { acceptedBy: extra.acceptedBy } : {}),
        })
        .where(
          and(
            eq(invitations.workspaceId, workspaceId),
            eq(invitations.id, invitationId),
            eq(invitations.status, "PENDING"),
          ),
        )
        .returning({ id: invitations.id });
      return rows.length > 0;
    },
  };
}
