import { and, desc, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PATCH as patchOrganization } from "@/app/api/v1/admin/organizations/[organizationId]/route";
import { GET as getSettings, PUT as putSettings } from "@/app/api/v1/admin/settings/route";
import { POST as activate } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/activate/route";
import { GET as listOrganizations } from "@/app/api/v1/organizations/route";
import { GET as getWorkspace } from "@/app/api/v1/workspaces/[workspaceId]/route";
import { POST as createWorkspace } from "@/app/api/v1/workspaces/route";
import type { AdminSettingsDto, PlatformSettings } from "@ros/contracts/platform";
import type { OrganizationSummaryDto } from "@ros/contracts/workspaces";
import type { WorkspaceDto } from "@ros/contracts/workspaces";
import { DEFAULT_PLATFORM_SETTINGS } from "@ros/domain/platform/settings";
import {
  auditLogs,
  organizationMembers,
  organizations,
  rateLimitBuckets,
  roles,
  subscriptionPlans,
  subscriptions,
  workspaceMemberships,
  workspaces,
} from "@ros/database/providers/postgres/schema";
import type { Container } from "@/composition/container";
import {
  addStaffMember,
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
afterEach(async () => {
  setClockDays(c, 0);
  await setSettings(DEFAULT_PLATFORM_SETTINGS);
  // Many sign-ups from one test IP would trip the sign-up rate limit.
  await c.db.delete(rateLimitBuckets);
});
afterAll(() => c.close());

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function setSettings(patch: Partial<PlatformSettings>): Promise<void> {
  const current = await call<AdminSettingsDto>(getSettings, { cookie: admin.cookie });
  expect(current.status).toBe(200);
  const res = await call(putSettings, {
    method: "PUT",
    cookie: admin.cookie,
    body: { ...current.body.data!.settings, ...patch },
  });
  expect(res.status).toBe(200);
}

async function activateOn(
  workspaceId: string,
  planKey: string,
  billingCycle: "MONTHLY" | "ANNUAL",
): Promise<void> {
  const res = await call(activate, {
    params: { workspaceId },
    cookie: admin.cookie,
    body: { planKey, billingCycle, periodEnd: inDays(365) },
  });
  expect(res.status).toBe(200);
}

const create = (cookie: string, name: string, organizationId?: string) =>
  call<WorkspaceDto>(createWorkspace, { cookie, body: { name, organizationId } });

const myOrganizations = async (cookie: string) => {
  const res = await call<OrganizationSummaryDto[]>(listOrganizations, { cookie });
  expect(res.status).toBe(200);
  return res.body.data!;
};

async function orgSubscriptions(organizationId: string) {
  return c.db
    .select({ id: subscriptions.id, isCurrent: subscriptions.isCurrent })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId));
}

async function fairUseAudits(organizationId: string) {
  return c.db
    .select({ metadata: auditLogs.metadata, actorUserId: auditLogs.actorUserId })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, "organization.fair_use_limit_hit"),
        eq(auditLogs.targetId, organizationId),
      ),
    )
    .orderBy(desc(auditLogs.createdAt));
}

describe("workspace creation limits per organization", () => {
  it("trial org cannot create a second workspace", async () => {
    const owner = await signUpUser("Trial Owner");
    const first = await createWorkspaceAs(owner, "Trial One");
    const organizationId = await organizationOf(c, first.id);

    const res = await create(owner.cookie, "Trial Two");
    expect(res.status).toBe(402);
    expect(res.body.error?.code).toBe("LIMIT_REACHED");
    expect(res.body.error?.details).toMatchObject({ reason: "PLAN_LIMIT", limit: 1, current: 1 });

    expect(await myOrganizations(owner.cookie)).toEqual([
      { id: organizationId, name: "Trial One", role: "OWNER", workspaceCount: 1, maxWorkspaces: 1 },
    ]);
  });

  it("monthly pro org cannot create a second workspace", async () => {
    const owner = await signUpUser("Monthly Owner");
    const first = await createWorkspaceAs(owner, "Monthly One");
    await activateOn(first.id, "pro", "MONTHLY");

    const res = await create(owner.cookie, "Monthly Two");
    expect(res.status).toBe(402);
    expect(res.body.error?.details).toMatchObject({ reason: "PLAN_LIMIT", limit: 1 });
  });

  it("annual pro org creates 3, 4th is refused", async () => {
    const owner = await signUpUser("Annual Owner");
    const first = await createWorkspaceAs(owner, "Annual One");
    const organizationId = await organizationOf(c, first.id);
    await activateOn(first.id, "pro", "ANNUAL");

    for (const name of ["Annual Two", "Annual Three"]) {
      const res = await create(owner.cookie, name);
      expect(res.status, name).toBe(201);
      expect(res.body.data!.organizationId).toBe(organizationId);
    }
    const fourth = await create(owner.cookie, "Annual Four");
    expect(fourth.status).toBe(402);
    expect(fourth.body.error?.details).toMatchObject({
      reason: "PLAN_LIMIT",
      limit: 3,
      current: 3,
    });

    // Further workspaces add no subscription: the retired trial and the active plan only.
    const subs = await orgSubscriptions(organizationId);
    expect(subs).toHaveLength(2);
    expect(subs.filter((s) => s.isCurrent)).toHaveLength(1);
    expect(await myOrganizations(owner.cookie)).toMatchObject([
      { id: organizationId, workspaceCount: 3, maxWorkspaces: 3 },
    ]);
  });

  it("annual enterprise org is stopped at the fair-use limit", async () => {
    await setSettings({ fairUseMaxWorkspaces: 3 });
    const owner = await signUpUser("Enterprise Owner");
    const first = await createWorkspaceAs(owner, "Enterprise One");
    const organizationId = await organizationOf(c, first.id);
    await activateOn(first.id, "enterprise", "ANNUAL");

    for (const name of ["Enterprise Two", "Enterprise Three"]) {
      expect((await create(owner.cookie, name)).status, name).toBe(201);
    }
    expect(await fairUseAudits(organizationId)).toEqual([]);
    const fourth = await create(owner.cookie, "Enterprise Four");
    expect(fourth.status).toBe(402);
    expect(fourth.body.error?.code).toBe("LIMIT_REACHED");
    expect(fourth.body.error?.details).toMatchObject({ reason: "FAIR_USE", limit: 3, current: 3 });
    const [audit] = await fairUseAudits(organizationId);
    expect(audit).toMatchObject({
      actorUserId: owner.userId,
      metadata: { reason: "FAIR_USE", limit: 3, current: 3 },
    });
    expect(await myOrganizations(owner.cookie)).toMatchObject([{ maxWorkspaces: 3 }]);
  });

  it("creations beyond the daily limit are refused until the window passes", async () => {
    await setSettings({ workspaceCreatesPerDay: 2 });
    const owner = await signUpUser("Daily Owner");
    const first = await createWorkspaceAs(owner, "Daily One");
    const organizationId = await organizationOf(c, first.id);
    await activateOn(first.id, "enterprise", "ANNUAL");

    expect((await create(owner.cookie, "Daily Two")).status).toBe(201);
    const third = await create(owner.cookie, "Daily Three");
    expect(third.status).toBe(402);
    expect(third.body.error?.details).toMatchObject({
      reason: "DAILY_LIMIT",
      limit: 2,
      current: 2,
    });
    expect((await fairUseAudits(organizationId))[0]?.metadata).toMatchObject({
      reason: "DAILY_LIMIT",
    });

    setClockDays(c, 1.01);
    const later = await create(await freshCookie(c, owner.userId), "Daily Three");
    expect(later.status).toBe(201);
  });

  it("concurrent creates on the last slot yield one success and one LIMIT_REACHED", async () => {
    const owner = await signUpUser("Racing Owner");
    const first = await createWorkspaceAs(owner, "Race One");
    const organizationId = await organizationOf(c, first.id);
    await activateOn(first.id, "pro", "ANNUAL");
    expect((await create(owner.cookie, "Race Two")).status).toBe(201);

    const results = await Promise.all([
      create(owner.cookie, "Race Three A"),
      create(owner.cookie, "Race Three B"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 402]);
    const refused = results.find((r) => r.status === 402)!;
    expect(refused.body.error?.code).toBe("LIMIT_REACHED");
    expect(refused.body.error?.details).toMatchObject({
      reason: "PLAN_LIMIT",
      limit: 3,
      current: 3,
    });
    expect(
      await c.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.organizationId, organizationId)),
    ).toHaveLength(3);
  });

  it("override 2 lets a trial org hold 2", async () => {
    const owner = await signUpUser("Override Owner");
    const first = await createWorkspaceAs(owner, "Override One");
    const organizationId = await organizationOf(c, first.id);
    const set = await call(patchOrganization, {
      method: "PATCH",
      params: { organizationId },
      cookie: admin.cookie,
      body: { maxWorkspacesOverride: 2 },
    });
    expect(set.status).toBe(200);

    expect((await create(owner.cookie, "Override Two")).status).toBe(201);
    const third = await create(owner.cookie, "Override Three");
    expect(third.status).toBe(402);
    expect(third.body.error?.details).toMatchObject({ reason: "PLAN_LIMIT", limit: 2, current: 2 });
    expect(await myOrganizations(owner.cookie)).toMatchObject([
      { workspaceCount: 2, maxWorkspaces: 2 },
    ]);
  });

  it("user who already used a trial gets TRIAL_ALREADY_USED for a new org", async () => {
    const owner = await signUpUser("Serial Trialist");
    const first = await createWorkspaceAs(owner, "First Trial");
    const organizationId = await organizationOf(c, first.id);
    // No longer an owner of any organization (for example after handing it over).
    await c.db
      .delete(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId));
    expect(await myOrganizations(owner.cookie)).toEqual([]);

    const res = await create(owner.cookie, "Second Trial");
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("TRIAL_ALREADY_USED");
    expect(
      await c.db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.createdBy, owner.userId)),
    ).toHaveLength(1);
  });

  it("legacy multi-org owner must choose organization", async () => {
    const owner = await signUpUser("Legacy Owner");
    const a = await createWorkspaceAs(owner, "Legacy A");
    const orgA = await organizationOf(c, a.id);

    // A second, backfilled organization (id = workspace id) owned by the same user.
    const [ownerRole] = await c.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.workspaceId), eq(roles.key, "workspace_owner")));
    const [pro] = await c.db
      .select({ id: subscriptionPlans.id })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.key, "pro"));
    const [orgB] = await c.db
      .insert(organizations)
      .values({ name: "Legacy B", createdBy: owner.userId })
      .returning({ id: organizations.id });
    await c.db
      .insert(organizationMembers)
      .values({ organizationId: orgB!.id, userId: owner.userId, role: "OWNER" });
    const [b] = await c.db
      .insert(workspaces)
      .values({
        id: orgB!.id,
        organizationId: orgB!.id,
        name: "Legacy B",
        slug: `legacy-b-${Date.now().toString(36)}`,
        createdBy: owner.userId,
      })
      .returning({ id: workspaces.id });
    await c.db
      .insert(workspaceMemberships)
      .values({ workspaceId: b!.id, userId: owner.userId, roleId: ownerRole!.id });
    await c.db.insert(subscriptions).values({
      workspaceId: b!.id,
      organizationId: orgB!.id,
      planId: pro!.id,
      status: "TRIALING",
      trialStartsAt: new Date(),
      trialEndsAt: new Date(Date.now() + 15 * 86_400_000),
    });

    const orgs = await myOrganizations(owner.cookie);
    expect(orgs.map((o) => o.id).sort()).toEqual([orgA, orgB!.id].sort());

    const ambiguous = await create(owner.cookie, "Legacy C");
    expect(ambiguous.status).toBe(422);
    expect(ambiguous.body.error?.fieldErrors?.organizationId).toEqual(["Choose an organization"]);

    await activateOn(b!.id, "pro", "ANNUAL");
    const chosen = await create(owner.cookie, "Legacy C", orgB!.id);
    expect(chosen.status).toBe(201);
    expect(chosen.body.data!.organizationId).toBe(orgB!.id);

    for (const id of [a.id, b!.id]) {
      const res = await call(getWorkspace, { params: { workspaceId: id }, cookie: owner.cookie });
      expect(res.status, id).toBe(200);
    }
  });

  it("non-owner member cannot create in the org", async () => {
    const owner = await signUpUser("Boss");
    const first = await createWorkspaceAs(owner, "Boss Kitchen");
    const organizationId = await organizationOf(c, first.id);
    await activateOn(first.id, "pro", "ANNUAL");

    const member = await signUpUser("Staffer");
    await addStaffMember(c, {
      workspaceId: first.id,
      userId: member.userId,
      role: "workspace_admin",
    });
    const asMember = await create(member.cookie, "Staffer Place", organizationId);
    expect(asMember.status).toBe(404);

    const billing = await signUpUser("Billing Admin");
    await c.db
      .insert(organizationMembers)
      .values({ organizationId, userId: billing.userId, role: "BILLING_ADMIN" });
    const asBilling = await create(billing.cookie, "Billing Place", organizationId);
    expect(asBilling.status).toBe(404);
    expect(await myOrganizations(billing.cookie)).toMatchObject([
      { id: organizationId, role: "BILLING_ADMIN" },
    ]);

    const stranger = await signUpUser("Stranger");
    const asStranger = await create(stranger.cookie, "Stranger Place", organizationId);
    expect(asStranger.status).toBe(404);
    expect(
      await c.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.organizationId, organizationId)),
    ).toHaveLength(1);
  });
});
