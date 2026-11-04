import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PUT as putOverride, DELETE as deleteOverride } from "@/app/api/v1/admin/workspaces/[workspaceId]/entitlements/route";
import { POST as setStatus } from "@/app/api/v1/admin/workspaces/[workspaceId]/status/route";
import { POST as activate } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/activate/route";
import { POST as cancel } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/cancel/route";
import { POST as expire } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/expire/route";
import { POST as extendTrial } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/extend-trial/route";
import { GET as getEntitlements } from "@/app/api/v1/workspaces/[workspaceId]/entitlements/route";
import {
  GET as getWorkspace,
  PATCH as patchWorkspace,
} from "@/app/api/v1/workspaces/[workspaceId]/route";
import { GET as getStructure } from "@/app/api/v1/workspaces/[workspaceId]/structure/route";
import { GET as getSubscription } from "@/app/api/v1/workspaces/[workspaceId]/subscription/route";
import { POST as createSupport } from "@/app/api/v1/workspaces/[workspaceId]/support/route";
import type { SubscriptionOverviewDto } from "@/contracts/platform";
import type { Entitlements } from "@/domain/subscriptions/entitlements";
import {
  auditLogs,
  emailOutbox,
  notifications,
  subscriptionEvents,
  subscriptions,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import {
  addStaffMember,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
  type TestUser,
} from "@/test/fixtures";
import { freshCookie, setClockDays, signUpAdmin } from "@/test/fixtures-platform";
import { call, createTestContainer } from "@/test/harness";

let c: Container;
let admin: TestUser;
beforeAll(async () => {
  c = await createTestContainer();
  admin = await signUpAdmin(c);
});
afterEach(() => setClockDays(c, 0));
afterAll(async () => {
  await c.close();
});

async function entitlementsOf(workspaceId: string, cookie: string): Promise<Entitlements> {
  const res = await call<{ entitlements: Entitlements }>(getEntitlements, {
    params: { workspaceId },
    cookie,
  });
  expect(res.status).toBe(200);
  return res.body.data!.entitlements;
}

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("subscription overview", () => {
  it("returns entitlements, usage, plans and history; hides other tenants", async () => {
    const owner = await signUpUser("Overview Owner");
    const ws = await createWorkspaceAs(owner, "Overview Kitchen");
    const res = await call<SubscriptionOverviewDto>(getSubscription, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
    });
    expect(res.status).toBe(200);
    const d = res.body.data!;
    expect(d.entitlements.phase).toBe("TRIAL");
    expect(d.subscription?.status).toBe("TRIALING");
    expect(d.currentPlan?.key).toBe("pro");
    expect(d.availablePlans.map((p) => p.key)).toEqual(
      expect.arrayContaining(["starter", "pro", "enterprise"]),
    );
    expect(d.usage.staff).toBe(1);
    expect(d.history[0]?.type).toBe("trial_started");
    expect(d.canRequestUpgrade).toBe(true);

    const stranger = await signUpUser("Stranger");
    const denied = await call(getSubscription, {
      params: { workspaceId: ws.id },
      cookie: stranger.cookie,
    });
    expect(denied.status).toBe(404);
  });

  it("forbids branch staff without workspace.subscription.view", async () => {
    const owner = await signUpUser("Staff Owner");
    const ws = await createWorkspaceAs(owner, "Staffed Place");
    const { restaurantId, branchId } = await insertRestaurantWithBranch(c, ws.id);
    const waiter = await signUpUser("Waiter");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: waiter.userId,
      role: "waiter",
      restaurantId,
      branchId,
    });
    const res = await call(getSubscription, { params: { workspaceId: ws.id }, cookie: waiter.cookie });
    expect(res.status).toBe(403);
  });
});

describe("Super Admin subscription actions", () => {
  it("manual activation switches the current subscription and the phase to ACTIVE", async () => {
    const owner = await signUpUser("Activation Owner");
    const ws = await createWorkspaceAs(owner, "Activation Bistro");

    const asOwner = await call(activate, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      body: { planKey: "starter", billingCycle: "ANNUAL", periodEnd: inDays(365) },
    });
    expect(asOwner.status).toBe(403);

    const past = await call(activate, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { planKey: "starter", billingCycle: "ANNUAL", periodEnd: "2020-01-01" },
    });
    expect(past.status).toBe(422);
    expect(past.body.error?.fieldErrors?.periodEnd).toBeDefined();

    const res = await call(activate, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { planKey: "starter", billingCycle: "ANNUAL", periodEnd: inDays(365), notes: "PO 42" },
    });
    expect(res.status).toBe(200);

    const rows = await c.db.select().from(subscriptions).where(eq(subscriptions.workspaceId, ws.id));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    const current = rows.find((r) => r.isCurrent)!;
    expect(current.status).toBe("ACTIVE");
    expect(current.billingCycle).toBe("ANNUAL");
    expect(current.activatedBy).toBe(admin.userId);

    const ent = await entitlementsOf(ws.id, owner.cookie);
    expect(ent.phase).toBe("ACTIVE");
    expect(ent.planKey).toBe("starter");
    expect(ent.limits.maxRestaurants).toBe(1);

    const events = await c.db
      .select()
      .from(subscriptionEvents)
      .where(and(eq(subscriptionEvents.workspaceId, ws.id), eq(subscriptionEvents.type, "activated")));
    expect(events[0]).toMatchObject({ fromStatus: "TRIALING", toStatus: "ACTIVE", planKey: "starter" });

    const [audit] = await c.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, ws.id), eq(auditLogs.action, "platform.subscription_activated")));
    expect(audit?.actorType).toBe("PLATFORM_ADMIN");
    expect(audit?.actorUserId).toBe(admin.userId);

    const notes = await c.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, owner.userId), eq(notifications.type, "subscription.activated")));
    expect(notes).toHaveLength(1);
    const mails = await c.db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.toAddress, owner.email), eq(emailOutbox.template, "subscription_activated")));
    expect(mails).toHaveLength(1);

    // Cancel: access continues until period end.
    const cancelled = await call(cancel, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { reason: "Customer asked to stop renewal" },
    });
    expect(cancelled.status).toBe(200);
    expect((await entitlementsOf(ws.id, owner.cookie)).phase).toBe("ACTIVE");

    // Expire now: restricted immediately.
    const expired = await call(expire, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { reason: "Payment reversed" },
    });
    expect(expired.status).toBe(200);
    expect((await entitlementsOf(ws.id, owner.cookie)).phase).toBe("RESTRICTED");
    const again = await call(expire, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { reason: "Payment reversed" },
    });
    expect(again.status).toBe(409);
  });

  it("extends a trial by N days", async () => {
    const owner = await signUpUser("Extend Owner");
    const ws = await createWorkspaceAs(owner, "Extend Eatery");
    const before = await entitlementsOf(ws.id, owner.cookie);
    const res = await call(extendTrial, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { days: 14, reason: "Onboarding took longer" },
    });
    expect(res.status).toBe(200);
    const after = await entitlementsOf(ws.id, owner.cookie);
    expect(after.phase).toBe("TRIAL");
    expect(after.trialDaysRemaining).toBe((before.trialDaysRemaining ?? 0) + 14);
    expect(new Date(after.trialEndsAt!).getTime() - new Date(before.trialEndsAt!).getTime()).toBe(
      14 * 86_400_000,
    );

    const invalid = await call(extendTrial, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { days: 0, reason: "x" },
    });
    expect(invalid.status).toBe(422);
  });

  it("applies limit and feature overrides", async () => {
    const owner = await signUpUser("Override Owner");
    const ws = await createWorkspaceAs(owner, "Override Cafe");
    const put = (key: string, value: unknown) =>
      call(putOverride, {
        method: "PUT",
        params: { workspaceId: ws.id },
        cookie: admin.cookie,
        body: { key, value, reason: "Enterprise pilot" },
      });
    expect((await put("maxBranches", 42)).status).toBe(200);
    expect((await put("feature:data_export", false)).status).toBe(200);
    expect((await put("maxStaff", null)).status).toBe(200);
    expect((await put("feature:qr_ordering", 3)).status).toBe(422);
    expect((await put("notAKey", 3)).status).toBe(422);

    const ent = await entitlementsOf(ws.id, owner.cookie);
    expect(ent.limits.maxBranches).toBe(42);
    expect(ent.limits.maxStaff).toBeNull();
    expect(ent.features).not.toContain("data_export");

    const del = await call(deleteOverride, {
      method: "DELETE",
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      path: "/api/v1/admin/x?key=maxBranches",
    });
    expect(del.status).toBe(200);
    expect((await entitlementsOf(ws.id, owner.cookie)).limits.maxBranches).toBe(10);

    const asOwner = await call(putOverride, {
      method: "PUT",
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      body: { key: "maxBranches", value: 999, reason: "Self-service hack" },
    });
    expect(asOwner.status).toBe(403);
  });
});

describe("workspace suspension", () => {
  it("blocks operational access but keeps the subscription page and support reachable", async () => {
    const owner = await signUpUser("Suspended Owner");
    const ws = await createWorkspaceAs(owner, "Suspended Sizzlers");
    const res = await call(setStatus, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { status: "SUSPENDED", reason: "Chargeback investigation" },
    });
    expect(res.status).toBe(200);

    const read = await call(getWorkspace, { params: { workspaceId: ws.id }, cookie: owner.cookie });
    expect(read.status).toBe(403);
    expect(read.body.error?.code).toBe("WORKSPACE_RESTRICTED");
    const write = await call(patchWorkspace, {
      method: "PATCH",
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      body: { name: "Renamed" },
    });
    expect(write.body.error?.code).toBe("WORKSPACE_RESTRICTED");

    // The shell (structure) and the subscription page still load so owners see why.
    expect(
      (await call(getStructure, { params: { workspaceId: ws.id }, cookie: owner.cookie })).status,
    ).toBe(200);
    const sub = await call<SubscriptionOverviewDto>(getSubscription, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
    });
    expect(sub.status).toBe(200);
    expect(sub.body.data!.entitlements.phase).toBe("SUSPENDED");
    expect(sub.body.data!.workspaceStatus).toBe("SUSPENDED");

    const support = await call(createSupport, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      body: {
        subject: "Please restore access",
        message: "We resolved the chargeback with our bank.",
        category: "ACCOUNT",
      },
    });
    expect(support.status).toBe(201);

    const same = await call(setStatus, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { status: "SUSPENDED", reason: "Again" },
    });
    expect(same.status).toBe(409);

    const restored = await call(setStatus, {
      params: { workspaceId: ws.id },
      cookie: admin.cookie,
      body: { status: "ACTIVE", reason: "Chargeback resolved" },
    });
    expect(restored.status).toBe(200);
    expect(
      (await call(getWorkspace, { params: { workspaceId: ws.id }, cookie: owner.cookie })).status,
    ).toBe(200);

    const [audit] = await c.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, ws.id), eq(auditLogs.action, "platform.workspace_status_changed")));
    expect(audit?.actorType).toBe("PLATFORM_ADMIN");
  });
});

describe("trial expiry with the test clock", () => {
  it("moves TRIAL → GRACE → RESTRICTED, keeps data and blocks writes", async () => {
    const owner = await signUpUser("Clock Owner");
    const ws = await createWorkspaceAs(owner, "Clockwork Curry");
    const patch = (cookie: string, name: string) =>
      call(patchWorkspace, {
        method: "PATCH",
        params: { workspaceId: ws.id },
        cookie,
        body: { name },
      });
    expect((await patch(owner.cookie, "Clockwork Curry House")).status).toBe(200);

    setClockDays(c, 31);
    // The original session (30-day TTL) has expired at +31 days, as in production.
    const cookie31 = await freshCookie(c, owner.userId);
    const grace = await entitlementsOf(ws.id, cookie31);
    expect(grace.phase).toBe("GRACE");
    expect(grace.accessLevel).toBe("LIMITED");
    // Daily operations continue; growth is blocked.
    expect((await patch(cookie31, "Clockwork Curry Grace")).status).toBe(200);
    const actor = (await c.repos.identity.findUserById(owner.userId))!;
    const scope = await c.access.forWorkspace(
      {
        type: "user",
        userId: actor.id,
        sessionId: "test",
        email: actor.email,
        name: actor.name,
        isPlatformAdmin: false,
        emailVerified: false,
        activeWorkspaceId: ws.id,
      },
      ws.id,
    );
    expect(() => scope.require("restaurant.create")).toThrow(/Upgrade/);

    setClockDays(c, 38);
    const cookie38 = await freshCookie(c, owner.userId);
    const restricted = await entitlementsOf(ws.id, cookie38);
    expect(restricted.phase).toBe("RESTRICTED");
    expect(restricted.accessLevel).toBe("READ_ONLY");

    const blocked = await patch(cookie38, "Should not save");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error?.code).toBe("WORKSPACE_RESTRICTED");

    const read = await call<{ workspace: { name: string } }>(getWorkspace, {
      params: { workspaceId: ws.id },
      cookie: cookie38,
    });
    expect(read.status).toBe(200);
    expect(read.body.data!.workspace.name).toBe("Clockwork Curry Grace");

    // Super Admin activation restores full access at the shifted time.
    const adminCookie = await freshCookie(c, admin.userId);
    const res = await call(activate, {
      params: { workspaceId: ws.id },
      cookie: adminCookie,
      body: { planKey: "pro", billingCycle: "MONTHLY", periodEnd: inDays(70) },
    });
    expect(res.status).toBe(200);
    expect((await entitlementsOf(ws.id, cookie38)).phase).toBe("ACTIVE");
    expect((await patch(cookie38, "Clockwork Curry Reborn")).status).toBe(200);
  });
});
