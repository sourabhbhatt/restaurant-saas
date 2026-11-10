import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PATCH as patchBranch,
  DELETE as archiveBranch,
  GET as getBranch,
} from "@/app/api/v1/branches/[branchId]/route";
import {
  GET as getSettings,
  PUT as putSettings,
} from "@/app/api/v1/branches/[branchId]/settings/route";
import {
  GET as listBranches,
  POST as createBranch,
} from "@/app/api/v1/restaurants/[restaurantId]/branches/route";
import {
  DELETE as archiveRestaurant,
  GET as getRestaurant,
  PATCH as patchRestaurant,
} from "@/app/api/v1/restaurants/[restaurantId]/route";
import {
  GET as listRestaurants,
  POST as createRestaurant,
} from "@/app/api/v1/workspaces/[workspaceId]/restaurants/route";
import type {
  BranchDto,
  BranchSettingsDto,
  RestaurantDetailDto,
  RestaurantDto,
  RestaurantListItemDto,
} from "@ros/contracts/tenancy";
import {
  auditLogs,
  branchSettings,
  menus,
  restaurants,
  restaurantSettings,
  subscriptionPlans,
  subscriptions,
  rateLimitBuckets,
} from "@ros/database/providers/postgres/schema";
import type { Container } from "@/composition/container";
import {
  addStaffMember,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
} from "@/test/fixtures";
import { call, createTestContainer } from "@/test/harness";

let c: Container;
beforeAll(async () => {
  c = await createTestContainer();
});
afterAll(async () => {
  await c.close();
});
// Every test signs up several users from the same (unknown) IP; keep the signup limiter fresh.
beforeEach(async () => {
  await c.db.delete(rateLimitBuckets);
});

async function switchPlan(workspaceId: string, planKey: string) {
  const [plan] = await c.db
    .select({ id: subscriptionPlans.id })
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.key, planKey));
  await c.db
    .update(subscriptions)
    .set({ planId: plan!.id })
    .where(and(eq(subscriptions.workspaceId, workspaceId), eq(subscriptions.isCurrent, true)));
}

async function auditActions(workspaceId: string) {
  const rows = await c.db
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(eq(auditLogs.workspaceId, workspaceId));
  return rows.map((r) => r.action);
}

const settingsBody = {
  taxes: [
    { name: "CGST", rateBps: 250 },
    { name: "SGST", rateBps: 250 },
  ],
  pricesIncludeTax: false,
  serviceChargeBps: 1000,
  paymentMethods: ["CASH", "UPI"],
  requireFullPaymentToClose: true,
  autoCompleteOnPayment: false,
  allowCustomerBillRequest: true,
  acceptingOrders: true,
  kitchenDelayMinutes: 25,
  kitchenSoundEnabled: true,
  waiterSoundEnabled: false,
  receiptHeader: "Thanks for dining",
  receiptFooter: "",
};

describe("restaurants and branches", () => {
  it("creates, lists, updates and archives a restaurant with settings and a default menu", async () => {
    const owner = await signUpUser("Owner One");
    const ws = await createWorkspaceAs(owner, "Spice Co");

    const created = await call<RestaurantDto>(createRestaurant, {
      params: { workspaceId: ws.id },
      body: {
        name: "Spice Garden",
        description: "North Indian",
        cuisineTypes: ["Indian", "Indian", "Mughlai"],
        contactEmail: "Hello@Spice.test",
        website: "spice.test",
        brandColor: "#E4572E",
      },
      cookie: owner.cookie,
    });
    expect(created.status).toBe(201);
    const r = created.body.data!;
    expect(r.cuisineTypes).toEqual(["Indian", "Mughlai"]);
    expect(r.contactEmail).toBe("hello@spice.test");
    expect(r.website).toBe("https://spice.test");
    expect(r.slug).toBe("spice-garden");

    const [settings] = await c.db
      .select()
      .from(restaurantSettings)
      .where(eq(restaurantSettings.restaurantId, r.id));
    expect(settings).toBeDefined();
    const menuRows = await c.db.select().from(menus).where(eq(menus.restaurantId, r.id));
    expect(menuRows.map((m) => m.name)).toEqual(["Main Menu"]);

    const list = await call<RestaurantListItemDto[]>(listRestaurants, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
    });
    expect(list.body.data!.map((x) => x.id)).toEqual([r.id]);

    const patched = await call<RestaurantDetailDto>(patchRestaurant, {
      method: "PATCH",
      params: { restaurantId: r.id },
      body: {
        name: "Spice Garden Deluxe",
        version: r.version,
        settings: { welcomeMessage: "Welcome!", showAllergens: false },
      },
      cookie: owner.cookie,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data!.name).toBe("Spice Garden Deluxe");
    expect(patched.body.data!.settings.welcomeMessage).toBe("Welcome!");
    expect(patched.body.data!.settings.showAllergens).toBe(false);

    const stale = await call(patchRestaurant, {
      method: "PATCH",
      params: { restaurantId: r.id },
      body: { name: "Stale", version: r.version },
      cookie: owner.cookie,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error!.code).toBe("STALE_VERSION");

    const bad = await call(patchRestaurant, {
      method: "PATCH",
      params: { restaurantId: r.id },
      body: { brandColor: "red" },
      cookie: owner.cookie,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error!.fieldErrors!.brandColor).toBeDefined();

    const archived = await call(archiveRestaurant, {
      method: "DELETE",
      params: { restaurantId: r.id },
      cookie: owner.cookie,
    });
    expect(archived.status).toBe(200);
    expect(
      (await call(getRestaurant, { params: { restaurantId: r.id }, cookie: owner.cookie })).status,
    ).toBe(404);
    expect(await auditActions(ws.id)).toEqual(
      expect.arrayContaining(["restaurant.created", "restaurant.updated", "restaurant.archived"]),
    );
  });

  it("creates branches with generated unique codes and default settings", async () => {
    const owner = await signUpUser();
    const ws = await createWorkspaceAs(owner);
    const r = await call<RestaurantDto>(createRestaurant, {
      params: { workspaceId: ws.id },
      body: { name: "Dosa Hub" },
      cookie: owner.cookie,
    });
    const restaurantId = r.body.data!.id;

    const b1 = await call<BranchDto>(createBranch, {
      params: { restaurantId },
      body: { name: "Indiranagar", city: "Bengaluru", timezone: "Asia/Kolkata" },
      cookie: owner.cookie,
    });
    expect(b1.status).toBe(201);
    expect(b1.body.data!.code).toBe("INDIRANA");
    expect(b1.body.data!.currency).toBe("INR");
    expect(b1.body.data!.businessHours).toHaveLength(7);

    const b2 = await call<BranchDto>(createBranch, {
      params: { restaurantId },
      body: { name: "Indiranagar 2nd" },
      cookie: owner.cookie,
    });
    expect(b2.body.data!.code).toBe("INDIRANA-2");

    const dup = await call(createBranch, {
      params: { restaurantId },
      body: { name: "Other", code: "indirana" },
      cookie: owner.cookie,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error!.fieldErrors!.code).toBeDefined();

    const [s] = await c.db
      .select()
      .from(branchSettings)
      .where(eq(branchSettings.branchId, b1.body.data!.id));
    expect(s!.paymentMethods).toEqual(["CASH", "UPI", "CARD"]);

    const list = await call<BranchDto[]>(listBranches, {
      params: { restaurantId },
      cookie: owner.cookie,
    });
    expect(list.body.data).toHaveLength(2);

    const branchId = b1.body.data!.id;
    const patched = await call<BranchDto>(patchBranch, {
      method: "PATCH",
      params: { branchId },
      body: {
        phone: "+91 98450 00000",
        version: b1.body.data!.version,
        businessHours: [{ day: 1, closed: false, open: "10:00", close: "23:30" }],
      },
      cookie: owner.cookie,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data!.phone).toBe("+91 98450 00000");

    const badHours = await call(patchBranch, {
      method: "PATCH",
      params: { branchId },
      body: { businessHours: [{ day: 1, closed: false, open: "25:00", close: "10:00" }] },
      cookie: owner.cookie,
    });
    expect(badHours.status).toBe(422);

    const archived = await call(archiveBranch, {
      method: "DELETE",
      params: { branchId: b2.body.data!.id },
      cookie: owner.cookie,
    });
    expect(archived.status).toBe(200);
    expect(
      (await call(getBranch, { params: { branchId: b2.body.data!.id }, cookie: owner.cookie }))
        .status,
    ).toBe(404);
    expect(await auditActions(ws.id)).toEqual(
      expect.arrayContaining(["branch.created", "branch.updated", "branch.archived"]),
    );
  });

  it("reads and updates branch settings with validation and optimistic versions", async () => {
    const owner = await signUpUser();
    const ws = await createWorkspaceAs(owner);
    const { branchId } = await insertRestaurantWithBranch(c, ws.id);

    const current = await call<BranchSettingsDto>(getSettings, {
      params: { branchId },
      cookie: owner.cookie,
    });
    expect(current.status).toBe(200);

    const saved = await call<BranchSettingsDto>(putSettings, {
      method: "PUT",
      params: { branchId },
      body: { ...settingsBody, version: current.body.data!.version },
      cookie: owner.cookie,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data!.serviceChargeBps).toBe(1000);
    expect(saved.body.data!.paymentMethods).toEqual(["CASH", "UPI"]);
    expect(saved.body.data!.receiptFooter).toBeNull();

    const stale = await call(putSettings, {
      method: "PUT",
      params: { branchId },
      body: { ...settingsBody, version: current.body.data!.version },
      cookie: owner.cookie,
    });
    expect(stale.status).toBe(409);

    const noMethods = await call(putSettings, {
      method: "PUT",
      params: { branchId },
      body: { ...settingsBody, paymentMethods: [] },
      cookie: owner.cookie,
    });
    expect(noMethods.status).toBe(422);
    expect(noMethods.body.error!.fieldErrors!.paymentMethods).toBeDefined();

    const tooMuchTax = await call(putSettings, {
      method: "PUT",
      params: { branchId },
      body: {
        ...settingsBody,
        taxes: [
          { name: "A", rateBps: 9000 },
          { name: "B", rateBps: 2000 },
        ],
      },
      cookie: owner.cookie,
    });
    expect(tooMuchTax.status).toBe(422);
    expect(await auditActions(ws.id)).toContain("branch.settings_updated");
  });
});

describe("plan limits", () => {
  it("enforces maxRestaurants, maxBranches and multi_branch on the Starter plan", async () => {
    const owner = await signUpUser();
    const ws = await createWorkspaceAs(owner);
    await switchPlan(ws.id, "starter");

    const first = await call<RestaurantDto>(createRestaurant, {
      params: { workspaceId: ws.id },
      body: { name: "Only One" },
      cookie: owner.cookie,
    });
    expect(first.status).toBe(201);
    const second = await call(createRestaurant, {
      params: { workspaceId: ws.id },
      body: { name: "Second" },
      cookie: owner.cookie,
    });
    expect(second.status).toBe(402);
    expect(second.body.error!.code).toBe("LIMIT_REACHED");

    const b1 = await call(createBranch, {
      params: { restaurantId: first.body.data!.id },
      body: { name: "Main" },
      cookie: owner.cookie,
    });
    expect(b1.status).toBe(201);
    const b2 = await call(createBranch, {
      params: { restaurantId: first.body.data!.id },
      body: { name: "Second" },
      cookie: owner.cookie,
    });
    expect(b2.status).toBe(402);
    expect(b2.body.error!.code).toBe("LIMIT_REACHED");
  });

  it("concurrent creates on the last restaurant slot yield one success and one LIMIT_REACHED", async () => {
    const owner = await signUpUser();
    const ws = await createWorkspaceAs(owner);
    await switchPlan(ws.id, "starter"); // maxRestaurants: 1
    const attempt = (name: string) =>
      call<RestaurantDto>(createRestaurant, {
        params: { workspaceId: ws.id },
        body: { name },
        cookie: owner.cookie,
      });
    const results = await Promise.all([attempt("Race A"), attempt("Race B"), attempt("Race C")]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 402, 402]);
    for (const refused of results.filter((r) => r.status === 402)) {
      expect(refused.body.error!.code).toBe("LIMIT_REACHED");
    }
    const rows = await c.db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(and(eq(restaurants.workspaceId, ws.id), isNull(restaurants.deletedAt)));
    expect(rows).toHaveLength(1);
  });

  it("requires multi_branch for a second branch even when the branch limit allows it", async () => {
    const owner = await signUpUser();
    const ws = await createWorkspaceAs(owner);
    const [starter] = await c.db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.key, "starter"));
    // Pro limits but without multi_branch: simulate by overriding the starter limits.
    await switchPlan(ws.id, "starter");
    await c.db
      .update(subscriptionPlans)
      .set({ limits: { ...starter!.limits, maxBranches: 5 } })
      .where(eq(subscriptionPlans.id, starter!.id));
    try {
      const { restaurantId } = await insertRestaurantWithBranch(c, ws.id);
      const res = await call(createBranch, {
        params: { restaurantId },
        body: { name: "Second" },
        cookie: owner.cookie,
      });
      expect(res.status).toBe(402);
      expect(res.body.error!.code).toBe("ENTITLEMENT_REQUIRED");
    } finally {
      await c.db
        .update(subscriptionPlans)
        .set({ limits: starter!.limits })
        .where(eq(subscriptionPlans.id, starter!.id));
    }
  });
});

describe("tenant isolation and roles", () => {
  it("returns 404 for another workspace's restaurants, branches and settings", async () => {
    const a = await signUpUser("Tenant A");
    const b = await signUpUser("Tenant B");
    const wsA = await createWorkspaceAs(a);
    await createWorkspaceAs(b);
    const { restaurantId, branchId } = await insertRestaurantWithBranch(c, wsA.id);

    const asB = b.cookie;
    expect((await call(getRestaurant, { params: { restaurantId }, cookie: asB })).status).toBe(404);
    expect(
      (
        await call(patchRestaurant, {
          method: "PATCH",
          params: { restaurantId },
          body: { name: "Hacked" },
          cookie: asB,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(archiveRestaurant, { method: "DELETE", params: { restaurantId }, cookie: asB }))
        .status,
    ).toBe(404);
    expect(
      (await call(createBranch, { params: { restaurantId }, body: { name: "X1" }, cookie: asB }))
        .status,
    ).toBe(404);
    expect((await call(getBranch, { params: { branchId }, cookie: asB })).status).toBe(404);
    expect((await call(getSettings, { params: { branchId }, cookie: asB })).status).toBe(404);
    expect(
      (
        await call(putSettings, {
          method: "PUT",
          params: { branchId },
          body: settingsBody,
          cookie: asB,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(listRestaurants, { params: { workspaceId: wsA.id }, cookie: asB })).status,
    ).toBe(404);
  });

  it("lets a waiter view their branch but not create restaurants or edit settings", async () => {
    const owner = await signUpUser();
    const waiter = await signUpUser("Wally Waiter");
    const ws = await createWorkspaceAs(owner);
    const { restaurantId, branchId } = await insertRestaurantWithBranch(c, ws.id);
    const other = await insertRestaurantWithBranch(c, ws.id, { name: "Other Place" });
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: waiter.userId,
      role: "waiter",
      restaurantId,
      branchId,
    });

    expect((await call(getSettings, { params: { branchId }, cookie: waiter.cookie })).status).toBe(
      200,
    );
    expect(
      (
        await call(putSettings, {
          method: "PUT",
          params: { branchId },
          body: settingsBody,
          cookie: waiter.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(createRestaurant, {
          params: { workspaceId: ws.id },
          body: { name: "Waiter's Place" },
          cookie: waiter.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(patchBranch, {
          method: "PATCH",
          params: { branchId },
          body: { name: "Renamed" },
          cookie: waiter.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(createBranch, {
          params: { restaurantId },
          body: { name: "New" },
          cookie: waiter.cookie,
        })
      ).status,
    ).toBe(403);
    // Only their own restaurant is visible.
    const list = await call<RestaurantListItemDto[]>(listRestaurants, {
      params: { workspaceId: ws.id },
      cookie: waiter.cookie,
    });
    expect(list.body.data!.map((r) => r.id)).toEqual([restaurantId]);
    expect(
      (await call(getBranch, { params: { branchId: other.branchId }, cookie: waiter.cookie }))
        .status,
    ).toBe(404);
  });
});
