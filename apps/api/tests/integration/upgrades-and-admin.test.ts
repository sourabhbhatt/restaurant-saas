import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as adminMenuRoute } from "@/app/api/v1/admin/workspaces/[workspaceId]/restaurants/[restaurantId]/menu/route";
import { POST as activateRoute } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/activate/route";
import { POST as approveRoute } from "@/app/api/v1/admin/upgrade-requests/[requestId]/approve/route";
import { POST as noteRoute } from "@/app/api/v1/admin/upgrade-requests/[requestId]/notes/route";
import { POST as rejectRoute } from "@/app/api/v1/admin/upgrade-requests/[requestId]/reject/route";
import { GET as adminDetailRoute } from "@/app/api/v1/admin/upgrade-requests/[requestId]/route";
import { GET as adminListRoute } from "@/app/api/v1/admin/upgrade-requests/route";
import { PUT as switchRoute } from "@/app/api/v1/auth/active-workspace/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { GET as contextRoute } from "@/app/api/v1/branches/[branchId]/context/route";
import { GET as staffRoute } from "@/app/api/v1/branches/[branchId]/staff/route";
import { GET as entitlementsRoute } from "@/app/api/v1/workspaces/[workspaceId]/entitlements/route";
import { GET as structureRoute } from "@/app/api/v1/workspaces/[workspaceId]/structure/route";
import { DELETE as cancelRoute } from "@/app/api/v1/workspaces/[workspaceId]/upgrade-requests/[requestId]/route";
import {
  GET as listMineRoute,
  POST as createRoute,
} from "@/app/api/v1/workspaces/[workspaceId]/upgrade-requests/route";
import type { AdminRestaurantMenuDto } from "@ros/contracts/menu";
import type {
  UpgradeRequestDetailDto,
  UpgradeRequestDto,
  UpgradeRequestListDto,
} from "@ros/contracts/upgrades";
import {
  menuItems,
  menus,
  notifications,
  restaurants,
  upgradeRequests,
} from "@ros/database/providers/postgres/schema";
import type { Container } from "@/composition/container";
import {
  addStaffMember,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
  type TestUser,
} from "@/test/fixtures";
import { call, createTestContainer, makePlatformAdmin } from "@/test/harness";

let c: Container;
let owner: TestUser;
let admin: TestUser;
let stranger: TestUser;
let ws: { id: string; name: string };

const future = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  c = await createTestContainer();
  owner = await signUpUser("Olivia Owner");
  admin = await signUpUser("Ada Admin");
  stranger = await signUpUser("Sam Stranger");
  await makePlatformAdmin(c, admin.userId);
  ws = await createWorkspaceAs(owner, "Upgrade Foods");
  // Put the workspace on Starter so there is something to upgrade from.
  const res = await call(activateRoute, {
    params: { workspaceId: ws.id },
    cookie: admin.cookie,
    body: { planKey: "starter", billingCycle: "MONTHLY", periodEnd: future(30) },
  });
  expect(res.status).toBe(200);
});
afterAll(() => c.close());

const request = (user: TestUser, body: Record<string, unknown>, workspaceId = ws.id) =>
  call<UpgradeRequestDto>(createRoute, { params: { workspaceId }, cookie: user.cookie, body });
const planOf = async () =>
  (
    await call<{
      entitlements: { planKey: string; phase: string; limits: { maxBranches: number | null } };
    }>(entitlementsRoute, { params: { workspaceId: ws.id }, cookie: owner.cookie })
  ).body.data!.entitlements;
const notificationsFor = (userId: string, type: string) =>
  c.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

describe("upgrade requests", () => {
  let pendingId: string;

  it("owner submits a request; duplicates and no-op plans are refused", async () => {
    const res = await request(owner, {
      planKey: "pro",
      billingCycle: "ANNUAL",
      message: "Opening 2 branches",
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: "PENDING",
      workspaceName: "Upgrade Foods",
      currentPlan: { key: "starter" },
      requestedPlan: { key: "pro" },
      requestedBy: { email: owner.email },
    });
    pendingId = res.body.data!.id;

    expect((await request(owner, { planKey: "enterprise" })).status).toBe(409); // already one pending
    expect((await request(owner, { planKey: "starter" })).status).toBe(422); // already on it
    expect((await request(owner, { planKey: "nope" })).status).toBe(422); // unknown plan
  });

  it("the same plan on the other billing cycle is a valid request (annual unlocks workspaces)", async () => {
    const other = await signUpUser("Cycle Owner");
    const cycleWs = await createWorkspaceAs(other, "Cycle Foods");
    const activated = await call(activateRoute, {
      params: { workspaceId: cycleWs.id },
      cookie: admin.cookie,
      body: { planKey: "pro", billingCycle: "MONTHLY", periodEnd: future(30) },
    });
    expect(activated.status).toBe(200);
    const same = await request(other, { planKey: "pro", billingCycle: "MONTHLY" }, cycleWs.id);
    expect(same.status).toBe(422);
    expect(same.body.error?.fieldErrors?.planKey).toBeDefined();
    const annual = await request(other, { planKey: "pro", billingCycle: "ANNUAL" }, cycleWs.id);
    expect(annual.status).toBe(201);
    expect(annual.body.data).toMatchObject({
      status: "PENDING",
      requestedPlan: { key: "pro" },
      billingCycle: "ANNUAL",
    });
  });

  it("only people who manage the subscription can ask, and other tenants cannot see or cancel it", async () => {
    expect((await request(stranger, { planKey: "pro" })).status).toBe(404); // not a member
    const mine = await call<UpgradeRequestDto[]>(listMineRoute, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
    });
    expect(mine.body.data!.map((r) => r.id)).toContain(pendingId);
    expect(
      (
        await call(cancelRoute, {
          method: "DELETE",
          params: { workspaceId: ws.id, requestId: pendingId },
          cookie: stranger.cookie,
        })
      ).status,
    ).toBe(404);
  });

  it("super admin sees it with details, internal notes and history; owners cannot use admin APIs", async () => {
    const list = await call<UpgradeRequestListDto>(adminListRoute, {
      cookie: admin.cookie,
      path: "/api/test?status=PENDING",
    });
    expect(list.status).toBe(200);
    expect(list.body.data!.items.some((r) => r.id === pendingId)).toBe(true);
    expect(list.body.data!.pendingCount).toBeGreaterThan(0);
    expect((await call(adminListRoute, { cookie: owner.cookie })).status).toBe(403);

    const note = await call(noteRoute, {
      params: { requestId: pendingId },
      cookie: admin.cookie,
      body: { body: "Paid by bank transfer" },
    });
    expect(note.status).toBe(201);
    const detail = await call<UpgradeRequestDetailDto>(adminDetailRoute, {
      params: { requestId: pendingId },
      cookie: admin.cookie,
    });
    expect(detail.body.data!.events.map((e) => e.type)).toEqual(["CREATED", "NOTE"]);
    expect(detail.body.data!.currentSubscription?.planName).toBe("Starter");
    // The owner-facing list never carries internal notes.
    const mine = await call<UpgradeRequestDto[]>(listMineRoute, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
    });
    expect(JSON.stringify(mine.body.data)).not.toContain("bank transfer");
    expect(
      (
        await call(noteRoute, {
          params: { requestId: pendingId },
          cookie: owner.cookie,
          body: { body: "x" },
        })
      ).status,
    ).toBe(403);
  });

  it("approval activates the plan, records the approver, notifies the owner and cannot be repeated", async () => {
    const before = await planOf();
    expect(before.planKey).toBe("starter");
    const res = await call<UpgradeRequestDto>(approveRoute, {
      params: { requestId: pendingId },
      cookie: admin.cookie,
      body: { billingCycle: "ANNUAL", periodEnd: future(365), note: "Verified payment" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "APPROVED", decidedByName: "Ada Admin" });
    expect(res.body.data!.decidedAt).toBeTruthy();

    const after = await planOf();
    expect(after).toMatchObject({ planKey: "pro", phase: "ACTIVE" });
    expect(after.limits.maxBranches).toBe(10); // entitlements of the approved plan
    const [row] = await c.db
      .select()
      .from(upgradeRequests)
      .where(eq(upgradeRequests.id, pendingId));
    expect(row!.decidedBy).toBe(admin.userId);
    expect(row!.appliedSubscriptionId).toBeTruthy();
    expect((await notificationsFor(owner.userId, "subscription.activated")).length).toBeGreaterThan(
      0,
    );

    const again = await call(approveRoute, {
      params: { requestId: pendingId },
      cookie: admin.cookie,
      body: { billingCycle: "ANNUAL", periodEnd: future(365) },
    });
    expect(again.status).toBe(409);
    expect(
      (
        await call(rejectRoute, {
          params: { requestId: pendingId },
          cookie: admin.cookie,
          body: { reason: "too late" },
        })
      ).status,
    ).toBe(409);
  });

  it("rejection needs a reason, keeps the subscription, and notifies the owner", async () => {
    const created = await request(owner, { planKey: "enterprise" });
    expect(created.status).toBe(201);
    const id = created.body.data!.id;
    expect(
      (
        await call(rejectRoute, {
          params: { requestId: id },
          cookie: admin.cookie,
          body: { reason: "" },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(rejectRoute, {
          params: { requestId: id },
          cookie: owner.cookie,
          body: { reason: "nope nope" },
        })
      ).status,
    ).toBe(403);

    const res = await call<UpgradeRequestDto>(rejectRoute, {
      params: { requestId: id },
      cookie: admin.cookie,
      body: { reason: "Enterprise needs a signed contract first" },
    });
    expect(res.body.data).toMatchObject({
      status: "REJECTED",
      decisionReason: "Enterprise needs a signed contract first",
    });
    expect((await planOf()).planKey).toBe("pro"); // unchanged
    const n = await notificationsFor(owner.userId, "subscription.upgrade_rejected");
    expect(n[0]?.body).toContain("signed contract");
    expect(
      (
        await call(approveRoute, {
          params: { requestId: id },
          cookie: admin.cookie,
          body: { billingCycle: "MONTHLY", periodEnd: future(30) },
        })
      ).status,
    ).toBe(409);
  });

  it("an owner can cancel a pending request, after which it cannot be approved", async () => {
    const id = (await request(owner, { planKey: "enterprise" })).body.data!.id;
    const res = await call<UpgradeRequestDto>(cancelRoute, {
      method: "DELETE",
      params: { workspaceId: ws.id, requestId: id },
      cookie: owner.cookie,
    });
    expect(res.body.data!.status).toBe("CANCELLED");
    expect(
      (
        await call(approveRoute, {
          params: { requestId: id },
          cookie: admin.cookie,
          body: { billingCycle: "MONTHLY", periodEnd: future(30) },
        })
      ).status,
    ).toBe(409);
    expect((await planOf()).planKey).toBe("pro");
  });
});

describe("super admin menu inspection", () => {
  it("shows the real menu of the right restaurant only, read-only, and refuses mismatched tenants", async () => {
    const other = await signUpUser("Other Owner");
    const otherWs = await createWorkspaceAs(other, "Other Foods");
    const mine = await insertRestaurantWithBranch(c, ws.id, { name: "Saffron" });
    const theirs = await insertRestaurantWithBranch(c, otherWs.id, { name: "Pasta House" });
    await c.db.insert(menuItems).values([
      {
        workspaceId: ws.id,
        restaurantId: mine.restaurantId,
        categoryId: mine.categoryId,
        name: "Paneer Tikka",
        price: 24_900,
        dietary: "VEG",
      },
      {
        workspaceId: otherWs.id,
        restaurantId: theirs.restaurantId,
        categoryId: theirs.categoryId,
        name: "Carbonara",
        price: 39_900,
        dietary: "NON_VEG",
      },
    ]);

    const res = await call<AdminRestaurantMenuDto>(adminMenuRoute, {
      params: { workspaceId: ws.id, restaurantId: mine.restaurantId },
      cookie: admin.cookie,
    });
    expect(res.status).toBe(200);
    const names = res.body.data!.menu.categories.flatMap((cat) => cat.items.map((i) => i.name));
    expect(names).toEqual(["Paneer Tikka"]); // never the other restaurant's Carbonara
    expect(res.body.data).toMatchObject({
      workspace: { name: "Upgrade Foods" },
      restaurant: { name: "Saffron" },
    });
    expect(res.body.data!.branches.map((b) => b.id)).toEqual([mine.branchId]);

    // Restaurant of workspace B requested under workspace A → not found.
    expect(
      (
        await call(adminMenuRoute, {
          params: { workspaceId: ws.id, restaurantId: theirs.restaurantId },
          cookie: admin.cookie,
        })
      ).status,
    ).toBe(404);
    // Owners cannot use the admin endpoint.
    expect(
      (
        await call(adminMenuRoute, {
          params: { workspaceId: ws.id, restaurantId: mine.restaurantId },
          cookie: owner.cookie,
        })
      ).status,
    ).toBe(403);
  });

  it("inspecting a restaurant that has no menu yet does not create one", async () => {
    const [r] = await c.db
      .insert(restaurants)
      .values({ workspaceId: ws.id, name: "Empty Place", slug: `empty-${Date.now()}` })
      .returning({ id: restaurants.id });
    const res = await call<AdminRestaurantMenuDto>(adminMenuRoute, {
      params: { workspaceId: ws.id, restaurantId: r!.id },
      cookie: admin.cookie,
    });
    expect(res.status).toBe(200);
    expect(res.body.data!.menu.categories).toEqual([]);
    expect(await c.db.select().from(menus).where(eq(menus.restaurantId, r!.id))).toHaveLength(0);
  });
});

describe("identity, roles and workspace context", () => {
  it("shows role labels per context and keeps the account identity across workspace switches", async () => {
    const { branchId, restaurantId } = await insertRestaurantWithBranch(c, ws.id, {
      name: "Role Cafe",
    });
    const waiter = await signUpUser("Wanda Waiter");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: waiter.userId,
      role: "waiter",
      restaurantId,
      branchId,
    });

    const ctxOwner = await call<{ roleLabel: string }>(contextRoute, {
      params: { branchId },
      cookie: owner.cookie,
    });
    expect(ctxOwner.body.data!.roleLabel).toBe("Workspace Owner");
    const ctxWaiter = await call<{ roleLabel: string }>(contextRoute, {
      params: { branchId },
      cookie: waiter.cookie,
    });
    expect(ctxWaiter.body.data!.roleLabel).toBe("Waiter");
    const structure = await call<{ workspaceName: string; roleLabel: string }>(structureRoute, {
      params: { workspaceId: ws.id },
      cookie: waiter.cookie,
    });
    expect(structure.body.data).toMatchObject({
      workspaceName: "Upgrade Foods",
      roleLabel: "Waiter",
    });

    // A user in two workspaces switches between them; identity never changes.
    const second = await createWorkspaceAs(owner, "Second Group");
    const before = await call<{ user: { id: string; email: string }; activeWorkspaceId: string }>(
      meRoute,
      { cookie: owner.cookie },
    );
    const sw = await call(switchRoute, {
      method: "PUT",
      cookie: owner.cookie,
      body: { workspaceId: ws.id },
    });
    expect(sw.status).toBe(200);
    const after = await call<{
      user: { id: string; email: string };
      activeWorkspaceId: string;
      workspaces: { id: string }[];
    }>(meRoute, { cookie: owner.cookie });
    expect(after.body.data!.user).toEqual(before.body.data!.user);
    expect(after.body.data!.activeWorkspaceId).toBe(ws.id);
    expect(after.body.data!.workspaces.map((w) => w.id)).toEqual(
      expect.arrayContaining([ws.id, second.id]),
    );
    // Cannot switch into a workspace you do not belong to.
    expect(
      (
        await call(switchRoute, {
          method: "PUT",
          cookie: stranger.cookie,
          body: { workspaceId: ws.id },
        })
      ).status,
    ).toBe(404);
  });

  it("blocks restricted data when a URL is entered manually", async () => {
    const { branchId, restaurantId } = await insertRestaurantWithBranch(c, ws.id, {
      name: "Guarded",
    });
    const kitchen = await signUpUser("Kim Kitchen");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: kitchen.userId,
      role: "kitchen_staff",
      restaurantId,
      branchId,
    });
    // Kitchen staff cannot list branch staff; strangers cannot even see the branch.
    expect((await call(staffRoute, { params: { branchId }, cookie: kitchen.cookie })).status).toBe(
      403,
    );
    expect((await call(staffRoute, { params: { branchId }, cookie: stranger.cookie })).status).toBe(
      404,
    );
    expect((await call(adminListRoute, { cookie: kitchen.cookie })).status).toBe(403);
  });
});
