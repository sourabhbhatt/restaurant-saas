import { and, eq, isNull } from "drizzle-orm";
import type { RoleTemplateKey } from "@ros/domain/access/permissions";
import {
  branchSettings,
  branches,
  menuCategories,
  menus,
  organizationMembers,
  restaurantSettings,
  restaurants,
  roleAssignments,
  roles,
  workspaceMemberships,
  workspaces,
} from "@ros/database/providers/postgres/schema";
import { POST as signUp } from "@/app/api/v1/auth/signup/route";
import { POST as createWorkspace } from "@/app/api/v1/workspaces/route";
import type { Container } from "@/composition/container";

import { call, cookieFrom, uniqueEmail } from "./harness";

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  cookie: string;
}

export async function signUpUser(name = "Test User", email = uniqueEmail()): Promise<TestUser> {
  const password = "correct-horse-42";
  const res = await call<{ user: { id: string } }>(signUp, {
    body: { name, email, password, acceptTerms: true },
  });
  if (res.status !== 201)
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { userId: res.body.data!.user.id, email, password, cookie: cookieFrom(res.setCookie) };
}

export async function createWorkspaceAs(
  user: TestUser,
  name = "Test Workspace",
): Promise<{ id: string; name: string }> {
  const res = await call<{ id: string; name: string }>(createWorkspace, {
    body: { name },
    cookie: user.cookie,
  });
  if (res.status !== 201)
    throw new Error(`workspace create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data!;
}

export type { Container };

/** The billing organization of a workspace (null only for pre-backfill rows). */
export async function organizationOf(c: Container, workspaceId: string): Promise<string> {
  const [row] = await c.db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row?.organizationId) throw new Error(`workspace ${workspaceId} has no organization`);
  return row.organizationId;
}

// ------------------------------------------------------------------
// Direct-insert fixtures for module tests (bypass APIs owned by other modules).

/**
 * A further workspace in the organization `user` owns (the one of their first
 * workspace), sharing its subscription. Tests that need a second tenant for the
 * same person use this: a trial organization holds one workspace, so a second
 * `createWorkspaceAs` is refused by design.
 */
export async function createSiblingWorkspaceAs(
  c: Container,
  user: TestUser,
  name: string,
): Promise<{ id: string; name: string }> {
  const [member] = await c.db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, user.userId), eq(organizationMembers.role, "OWNER")))
    .orderBy(organizationMembers.createdAt)
    .limit(1);
  if (!member) throw new Error(`user ${user.userId} owns no organization`);
  return addWorkspaceToOrganization(c, {
    organizationId: member.organizationId,
    userId: user.userId,
    name,
  });
}

/**
 * A further workspace inside an existing organization, owned by `userId`.
 * Adds no subscription: the organization's subscription covers it.
 */
export async function addWorkspaceToOrganization(
  c: Container,
  input: { organizationId: string; userId: string; name: string },
): Promise<{ id: string; name: string }> {
  const [ownerRole] = await c.db
    .select({ id: roles.id })
    .from(roles)
    .where(and(isNull(roles.workspaceId), eq(roles.key, "workspace_owner")))
    .limit(1);
  const [ws] = await c.db
    .insert(workspaces)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      slug: `${input.name.toLowerCase().replace(/\W+/g, "-")}-${Date.now().toString(36)}`,
      createdBy: input.userId,
    })
    .returning({ id: workspaces.id, name: workspaces.name });
  await c.db.insert(workspaceMemberships).values({
    workspaceId: ws!.id,
    userId: input.userId,
    roleId: ownerRole!.id,
  });
  return ws!;
}

export async function insertRestaurantWithBranch(
  c: Container,
  workspaceId: string,
  opts: { name?: string; branchName?: string; taxes?: { name: string; rateBps: number }[] } = {},
): Promise<{ restaurantId: string; branchId: string; menuId: string; categoryId: string }> {
  const name = opts.name ?? "Spice Garden";
  const [r] = await c.db
    .insert(restaurants)
    .values({
      workspaceId,
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${Date.now().toString(36)}`,
    })
    .returning({ id: restaurants.id });
  await c.db.insert(restaurantSettings).values({ restaurantId: r!.id, workspaceId });
  const [b] = await c.db
    .insert(branches)
    .values({
      workspaceId,
      restaurantId: r!.id,
      name: opts.branchName ?? "Main Branch",
      code: `b${Date.now().toString(36)}`,
    })
    .returning({ id: branches.id });
  await c.db.insert(branchSettings).values({
    branchId: b!.id,
    workspaceId,
    taxes: opts.taxes ?? [
      { name: "CGST", rateBps: 250 },
      { name: "SGST", rateBps: 250 },
    ],
  });
  const [m] = await c.db
    .insert(menus)
    .values({ workspaceId, restaurantId: r!.id, name: "Main Menu" })
    .returning({ id: menus.id });
  const [cat] = await c.db
    .insert(menuCategories)
    .values({ workspaceId, restaurantId: r!.id, menuId: m!.id, name: "Mains" })
    .returning({ id: menuCategories.id });
  return { restaurantId: r!.id, branchId: b!.id, menuId: m!.id, categoryId: cat!.id };
}

/** Add an existing user to a workspace with a member role plus a restaurant/branch role assignment. */
export async function addStaffMember(
  c: Container,
  input: {
    workspaceId: string;
    userId: string;
    role: RoleTemplateKey;
    restaurantId?: string;
    branchId?: string;
  },
): Promise<void> {
  const roleId = async (key: string) => {
    const [row] = await c.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.workspaceId), eq(roles.key, key)))
      .limit(1);
    return row!.id;
  };
  const workspaceRole = input.role.startsWith("workspace_") ? input.role : "workspace_member";
  const [m] = await c.db
    .insert(workspaceMemberships)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      roleId: await roleId(workspaceRole),
    })
    .returning({ id: workspaceMemberships.id });
  if (!input.role.startsWith("workspace_")) {
    if (!input.restaurantId) throw new Error("restaurantId required for non-workspace roles");
    await c.db.insert(roleAssignments).values({
      workspaceId: input.workspaceId,
      membershipId: m!.id,
      roleId: await roleId(input.role),
      restaurantId: input.restaurantId,
      branchId: input.branchId ?? null,
    });
  }
}
