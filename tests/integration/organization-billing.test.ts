import { and, desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PATCH as patchOrganization } from "@/app/api/v1/admin/organizations/[organizationId]/route";
import { GET as getAdminWorkspace } from "@/app/api/v1/admin/workspaces/[workspaceId]/route";
import { POST as activate } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/activate/route";
import { POST as extendTrial } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/extend-trial/route";
import { GET as getEntitlements } from "@/app/api/v1/workspaces/[workspaceId]/entitlements/route";
import type { AdminWorkspaceDetailDto } from "@ros/contracts/platform";
import { DEFAULT_PLATFORM_SETTINGS } from "@ros/domain/platform/settings";
import type { Entitlements } from "@ros/domain/subscriptions/entitlements";
import {
  auditLogs,
  organizationMembers,
  organizations,
  subscriptions,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import {
  addWorkspaceToOrganization,
  createWorkspaceAs,
  organizationOf,
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
afterAll(() => c.close());

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function entitlementsOf(workspaceId: string, cookie: string): Promise<Entitlements> {
  const res = await call<{ entitlements: Entitlements }>(getEntitlements, {
    params: { workspaceId },
    cookie,
  });
  expect(res.status).toBe(200);
  return res.body.data!.entitlements;
}

async function currentSubscriptions(organizationId: string) {
  return c.db
    .select({
      id: subscriptions.id,
      workspaceId: subscriptions.workspaceId,
      organizationId: subscriptions.organizationId,
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
    })
    .from(subscriptions)
    .where(
      and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.isCurrent, true)),
    );
}

/** An owner with two workspaces in one organization (the second added directly). */
async function twoWorkspaceOrg(name: string) {
  const owner = await signUpUser(`${name} Owner`);
  const first = await createWorkspaceAs(owner, `${name} One`);
  const organizationId = await organizationOf(c, first.id);
  const second = await addWorkspaceToOrganization(c, {
    organizationId,
    userId: owner.userId,
    name: `${name} Two`,
  });
  return { owner, first, second, organizationId };
}

describe("organizations own the subscription", () => {
  it("creating a workspace creates its organization and dual-writes the subscription", async () => {
    const owner = await signUpUser("Org Creator");
    const ws = await createWorkspaceAs(owner, "Creator Kitchen");
    const organizationId = await organizationOf(c, ws.id);

    const [org] = await c.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    expect(org).toMatchObject({
      name: "Creator Kitchen",
      createdBy: owner.userId,
      status: "ACTIVE",
      maxWorkspacesOverride: null,
    });
    const members = await c.db
      .select({ userId: organizationMembers.userId, role: organizationMembers.role })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId));
    expect(members).toEqual([{ userId: owner.userId, role: "OWNER" }]);

    const subs = await currentSubscriptions(organizationId);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ workspaceId: ws.id, organizationId, status: "TRIALING" });
  });

  it("two workspaces in one organization share the plan", async () => {
    const { owner, first, second, organizationId } = await twoWorkspaceOrg("Shared");

    const trial = await entitlementsOf(second.id, owner.cookie);
    expect(trial.phase).toBe("TRIAL");
    expect(trial.planKey).toBe(DEFAULT_PLATFORM_SETTINGS.trialPlanKey);

    const res = await call(activate, {
      params: { workspaceId: first.id },
      cookie: admin.cookie,
      body: { planKey: "pro", billingCycle: "ANNUAL", periodEnd: inDays(365) },
    });
    expect(res.status).toBe(200);

    for (const ws of [first, second]) {
      const ent = await entitlementsOf(ws.id, owner.cookie);
      expect(ent.planKey, ws.name).toBe("pro");
      expect(ent.phase, ws.name).toBe("ACTIVE");
    }
    const subs = await currentSubscriptions(organizationId);
    expect(subs).toHaveLength(1);
    // The legacy column stays in sync: the organization's first workspace.
    expect(subs[0]).toMatchObject({ workspaceId: first.id, organizationId, status: "ACTIVE" });

    // Acting on the second workspace changes the same organization subscription.
    const viaSecond = await call(activate, {
      params: { workspaceId: second.id },
      cookie: admin.cookie,
      body: { planKey: "starter", billingCycle: "ANNUAL", periodEnd: inDays(365) },
    });
    expect(viaSecond.status).toBe(200);
    expect((await entitlementsOf(first.id, owner.cookie)).planKey).toBe("starter");
    const after = await currentSubscriptions(organizationId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ workspaceId: first.id, organizationId });
  });

  it("extending the trial from either workspace moves the organization's trial end", async () => {
    const { owner, first, second, organizationId } = await twoWorkspaceOrg("Extend");
    const [before] = await currentSubscriptions(organizationId);
    const res = await call(extendTrial, {
      params: { workspaceId: second.id },
      cookie: admin.cookie,
      body: { days: 10, reason: "Onboarding took longer" },
    });
    expect(res.status).toBe(200);
    const [after] = await currentSubscriptions(organizationId);
    expect(after!.id).toBe(before!.id);
    expect(after!.trialEndsAt!.getTime() - before!.trialEndsAt!.getTime()).toBe(10 * 86_400_000);
    expect((await entitlementsOf(first.id, owner.cookie)).trialDaysRemaining).toBe(
      DEFAULT_PLATFORM_SETTINGS.trialDays + 10,
    );
  });

  it("expiry of the organization's period restricts every workspace in it", async () => {
    const { owner, first, second } = await twoWorkspaceOrg("Expiry");
    const res = await call(activate, {
      params: { workspaceId: first.id },
      cookie: admin.cookie,
      body: { planKey: "pro", billingCycle: "ANNUAL", periodEnd: inDays(30) },
    });
    expect(res.status).toBe(200);

    setClockDays(c, 31);
    let cookie = await freshCookie(c, owner.userId);
    for (const ws of [first, second]) {
      const ent = await entitlementsOf(ws.id, cookie);
      expect(ent.phase, ws.name).toBe("GRACE");
      expect(ent.accessLevel, ws.name).toBe("LIMITED");
    }

    setClockDays(c, 31 + DEFAULT_PLATFORM_SETTINGS.graceDays + 1);
    cookie = await freshCookie(c, owner.userId);
    for (const ws of [first, second]) {
      const ent = await entitlementsOf(ws.id, cookie);
      expect(ent.phase, ws.name).toBe("RESTRICTED");
      expect(ent.accessLevel, ws.name).toBe("READ_ONLY");
    }
  });
});

describe("organization limit override", () => {
  it("override endpoint is platform-only and audited", async () => {
    const owner = await signUpUser("Override Owner");
    const ws = await createWorkspaceAs(owner, "Override Kitchen");
    const organizationId = await organizationOf(c, ws.id);
    const params = { organizationId };

    const asOwner = await call(patchOrganization, {
      method: "PATCH",
      params,
      cookie: owner.cookie,
      body: { maxWorkspacesOverride: 2 },
    });
    expect(asOwner.status).toBe(403);

    const set = await call<{ id: string; maxWorkspacesOverride: number | null }>(
      patchOrganization,
      { method: "PATCH", params, cookie: admin.cookie, body: { maxWorkspacesOverride: 2 } },
    );
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ id: organizationId, maxWorkspacesOverride: 2 });
    const [org] = await c.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    expect(org!.maxWorkspacesOverride).toBe(2);

    const audits = () =>
      c.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, "organization.limit_override_changed"),
            eq(auditLogs.targetId, organizationId),
          ),
        )
        .orderBy(desc(auditLogs.createdAt));
    const [entry] = await audits();
    expect(entry).toMatchObject({
      actorType: "PLATFORM_ADMIN",
      actorUserId: admin.userId,
      targetType: "organization",
      metadata: { from: null, to: 2 },
    });

    const clear = await call(patchOrganization, {
      method: "PATCH",
      params,
      cookie: admin.cookie,
      body: { maxWorkspacesOverride: null },
    });
    expect(clear.status).toBe(200);
    expect((await audits())[0]!.metadata).toEqual({ from: 2, to: null });

    const invalid = await call(patchOrganization, {
      method: "PATCH",
      params,
      cookie: admin.cookie,
      body: { maxWorkspacesOverride: -1 },
    });
    expect(invalid.status).toBe(422);
    const missing = await call(patchOrganization, {
      method: "PATCH",
      params: { organizationId: "00000000-0000-4000-8000-000000000000" },
      cookie: admin.cookie,
      body: { maxWorkspacesOverride: 1 },
    });
    expect(missing.status).toBe(404);
  });

  it("the admin workspace detail shows the organization and its override", async () => {
    const { first, second, organizationId } = await twoWorkspaceOrg("Detail");
    await call(patchOrganization, {
      method: "PATCH",
      params: { organizationId },
      cookie: admin.cookie,
      body: { maxWorkspacesOverride: 5 },
    });
    const res = await call<AdminWorkspaceDetailDto>(getAdminWorkspace, {
      params: { workspaceId: second.id },
      cookie: admin.cookie,
    });
    expect(res.status).toBe(200);
    expect(res.body.data!.organization).toEqual({
      id: organizationId,
      name: "Detail One",
      maxWorkspacesOverride: 5,
      workspaceCount: 2,
    });
    // The second workspace reports the organization's (first workspace's) subscription.
    expect(res.body.data!.subscription?.status).toBe("TRIALING");
    expect(res.body.data!.entitlements.planKey).toBe(DEFAULT_PLATFORM_SETTINGS.trialPlanKey);
    expect(first.id).not.toBe(second.id);
  });
});
