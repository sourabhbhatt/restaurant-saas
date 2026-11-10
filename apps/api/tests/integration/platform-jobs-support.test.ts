import { and, eq, like } from "drizzle-orm";
import { DEFAULT_PLATFORM_SETTINGS } from "@ros/domain/platform/settings";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { GET as adminSupportList } from "@/app/api/v1/admin/support/route";
import {
  GET as adminSupportGet,
  PATCH as adminSupportPatch,
} from "@/app/api/v1/admin/support/[requestId]/route";
import { POST as adminSupportNote } from "@/app/api/v1/admin/support/[requestId]/notes/route";
import { POST as runJob } from "@/app/api/v1/jobs/subscriptions/route";
import { GET as getClock, POST as setClock } from "@/app/api/v1/test/clock/route";
import { GET as workspaceAudit } from "@/app/api/v1/workspaces/[workspaceId]/audit/route";
import { GET as getSubscription } from "@/app/api/v1/workspaces/[workspaceId]/subscription/route";
import {
  GET as listSupport,
  POST as createSupport,
} from "@/app/api/v1/workspaces/[workspaceId]/support/route";
import type {
  AuditLogDto,
  Paginated,
  SubscriptionJobResult,
  SubscriptionOverviewDto,
  SupportRequestDetailDto,
  SupportRequestDto,
  TestClockDto,
} from "@ros/contracts/platform";
import { platformRepository } from "@ros/database/providers/postgres/repositories/platform";
import {
  authTokens,
  emailOutbox,
  idempotencyRecords,
  notifications,
  rateLimitBuckets,
  sessions,
  subscriptions,
} from "@ros/database/providers/postgres/schema";
import type { Container } from "@/composition/container";
import {
  addStaffMember,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
  type TestUser,
} from "@/test/fixtures";
import { setClockDays, signUpAdmin } from "@/test/fixtures-platform";
import { call, createTestContainer } from "@/test/harness";

let c: Container;
let admin: TestUser;
const SECRET = "test-cron-secret-0123456789";
beforeAll(async () => {
  c = await createTestContainer();
  admin = await signUpAdmin(c);
});
afterEach(() => {
  setClockDays(c, 0);
  c.env.ENABLE_TEST_HOOKS = true;
});
afterAll(async () => {
  await c.close();
});

const job = (authorization?: string) =>
  call<SubscriptionJobResult>(runJob, {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

async function notificationTypes(userId: string): Promise<string[]> {
  const rows = await c.db
    .select({ type: notifications.type })
    .from(notifications)
    .where(eq(notifications.userId, userId));
  return rows.map((r) => r.type).sort();
}

describe("subscription sweep job", () => {
  it("requires the bearer CRON_SECRET (401 when unset or wrong)", async () => {
    c.env.CRON_SECRET = undefined;
    expect((await job(`Bearer ${SECRET}`)).status).toBe(401);
    c.env.CRON_SECRET = SECRET;
    expect((await job()).status).toBe(401);
    expect((await job("Bearer wrong-secret-value-000")).status).toBe(401);
    expect((await job(SECRET)).status).toBe(401);
    const ok = await job(`Bearer ${SECRET}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data!.scanned).toBeGreaterThanOrEqual(0);
    // The job's answer is the sweep plus the analytics cleanup, as the contract declares.
    expect(typeof ok.body.data!.analyticsIdsCleared).toBe("number");
    expect(ok.body.data!.housekeeping).toBeDefined();
  });

  it("sends reminders and the trial-ended notice exactly once", async () => {
    c.env.CRON_SECRET = SECRET;
    const owner = await signUpUser("Reminder Owner");
    const ws = await createWorkspaceAs(owner, "Reminder Rasoi");

    expect((await job(`Bearer ${SECRET}`)).status).toBe(200);
    expect(await notificationTypes(owner.userId)).toEqual([]);

    setClockDays(c, DEFAULT_PLATFORM_SETTINGS.trialReminderDays[0]! + 0.5);
    await job(`Bearer ${SECRET}`);
    await job(`Bearer ${SECRET}`);
    expect(await notificationTypes(owner.userId)).toEqual(["trial.reminder"]);

    setClockDays(c, DEFAULT_PLATFORM_SETTINGS.trialReminderDays.at(-1)! + 0.5);
    await job(`Bearer ${SECRET}`);
    await job(`Bearer ${SECRET}`);
    // The last two reminder days were both due: only the latest is sent.
    expect(await notificationTypes(owner.userId)).toEqual(["trial.reminder", "trial.reminder"]);

    setClockDays(c, DEFAULT_PLATFORM_SETTINGS.trialDays + 1);
    await job(`Bearer ${SECRET}`);
    await job(`Bearer ${SECRET}`);
    expect(await notificationTypes(owner.userId)).toEqual([
      "trial.expired",
      "trial.reminder",
      "trial.reminder",
    ]);

    setClockDays(c, DEFAULT_PLATFORM_SETTINGS.trialDays + DEFAULT_PLATFORM_SETTINGS.graceDays + 1);
    const res = await job(`Bearer ${SECRET}`);
    expect(res.body.data!.graceEnded).toBeGreaterThanOrEqual(1);
    await job(`Bearer ${SECRET}`);
    const types = await notificationTypes(owner.userId);
    expect(types.filter((t) => t === "subscription.expired")).toHaveLength(1);

    const [sub] = await c.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.workspaceId, ws.id), eq(subscriptions.isCurrent, true)));
    // Status is computed from dates; the job never changes it or deletes data.
    expect(sub!.status).toBe("TRIALING");
    expect(sub!.remindersSent).toEqual(
      expect.arrayContaining([...DEFAULT_PLATFORM_SETTINGS.trialReminderDays, -1, -3]),
    );

    const mails = await c.db
      .select({ template: emailOutbox.template })
      .from(emailOutbox)
      .where(eq(emailOutbox.toAddress, owner.email));
    const templates = mails.map((m) => m.template);
    expect(templates.filter((t) => t === "trial_reminder")).toHaveLength(2);
    expect(templates.filter((t) => t === "trial_expired")).toHaveLength(1);
    expect(templates.filter((t) => t === "subscription_restricted")).toHaveLength(1);
  });
});

describe("housekeeping in the sweep job", () => {
  it("deletes in batches until the backlog is gone, each statement bounded by the batch size", async () => {
    const now = c.clock.now();
    await c.db.insert(rateLimitBuckets).values(
      Array.from({ length: 5 }, (_, i) => ({
        key: `hk:batch:${i}`,
        count: 1,
        resetAt: new Date(now.getTime() - 2 * 86_400_000),
      })),
    );
    const before = new Date(now.getTime() - 86_400_000);
    const result = await platformRepository(c.db).pruneExpired({
      now,
      rateLimitBefore: before,
      idempotencyBefore: new Date(0),
      sessionsBefore: new Date(0),
      authTokensBefore: new Date(0),
      batchSize: 2,
    });
    // 2 + 2 + 1 across three statements; the loop stops on the short batch.
    expect(result.rateLimitBuckets).toBe(5);
    const left = await c.db
      .select({ key: rateLimitBuckets.key })
      .from(rateLimitBuckets)
      .where(like(rateLimitBuckets.key, "hk:batch:%"));
    expect(left).toEqual([]);
  });

  it("removes expired plumbing rows and keeps live ones", async () => {
    c.env.CRON_SECRET = SECRET;
    const now = c.clock.now();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const user = await signUpUser("Housekeeping User");
    await c.db.insert(rateLimitBuckets).values([
      { key: "hk:stale", count: 3, resetAt: daysAgo(2) },
      { key: "hk:live", count: 3, resetAt: new Date(now.getTime() + 60_000) },
    ]);
    await c.db.insert(idempotencyRecords).values([
      { scope: "hk", key: "stale-key-0001", requestHash: "h", statusCode: 200, response: {} },
      { scope: "hk", key: "live-key-00001", requestHash: "h", statusCode: 200, response: {} },
    ]);
    await c.db
      .update(idempotencyRecords)
      .set({ createdAt: daysAgo(31) })
      .where(eq(idempotencyRecords.key, "stale-key-0001"));
    await c.db.insert(sessions).values([
      { userId: user.userId, tokenHash: "hk-stale-session", expiresAt: daysAgo(31) },
      { userId: user.userId, tokenHash: "hk-live-session", expiresAt: daysAgo(-1) },
    ]);
    await c.db.insert(authTokens).values([
      {
        userId: user.userId,
        purpose: "PASSWORD_RESET",
        tokenHash: "hk-stale-token",
        expiresAt: daysAgo(8),
      },
      {
        userId: user.userId,
        purpose: "PASSWORD_RESET",
        tokenHash: "hk-live-token",
        expiresAt: daysAgo(-1),
      },
    ]);

    const res = await job(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const hk = res.body.data!.housekeeping;
    expect(hk.rateLimitBuckets).toBeGreaterThanOrEqual(1);
    expect(hk.idempotencyRecords).toBeGreaterThanOrEqual(1);
    expect(hk.sessions).toBeGreaterThanOrEqual(1);
    expect(hk.authTokens).toBeGreaterThanOrEqual(1);

    const keys = (await c.db.select({ key: rateLimitBuckets.key }).from(rateLimitBuckets)).map(
      (r) => r.key,
    );
    expect(keys).toContain("hk:live");
    expect(keys).not.toContain("hk:stale");
    const idem = (await c.db.select({ key: idempotencyRecords.key }).from(idempotencyRecords)).map(
      (r) => r.key,
    );
    expect(idem).toContain("live-key-00001");
    expect(idem).not.toContain("stale-key-0001");
    const sess = (
      await c.db
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .where(eq(sessions.userId, user.userId))
    ).map((r) => r.tokenHash);
    expect(sess).toContain("hk-live-session");
    expect(sess).not.toContain("hk-stale-session");
    const tokens = (
      await c.db
        .select({ tokenHash: authTokens.tokenHash })
        .from(authTokens)
        .where(eq(authTokens.userId, user.userId))
    ).map((r) => r.tokenHash);
    expect(tokens).toContain("hk-live-token");
    expect(tokens).not.toContain("hk-stale-token");
    // The user's real session (issued at sign-up) survives.
    expect(
      (await call(getSubscription, { params: { workspaceId: "x" }, cookie: user.cookie })).status,
    ).not.toBe(401);
  });
});

describe("test clock", () => {
  it("is admin-only and disappears (404) when test hooks are off", async () => {
    const user = await signUpUser("Clock User");
    expect((await call(getClock, { cookie: user.cookie })).status).toBe(403);
    expect((await call(getClock, {})).status).toBe(401);

    const set = await call<TestClockDto>(setClock, {
      method: "POST",
      cookie: admin.cookie,
      body: { offsetDays: 2 },
    });
    expect(set.status).toBe(200);
    expect(set.body.data!.offsetDays).toBe(2);
    expect(c.clock.offsetMs()).toBe(2 * 86_400_000);
    const bad = await call(setClock, { cookie: admin.cookie, body: { offsetDays: "x" } });
    expect(bad.status).toBe(422);

    c.env.ENABLE_TEST_HOOKS = false;
    expect((await call(getClock, { cookie: admin.cookie })).status).toBe(404);
    expect((await call(setClock, { cookie: admin.cookie, body: { offsetDays: 5 } })).status).toBe(
      404,
    );
    expect(c.clock.offsetMs()).toBe(2 * 86_400_000);
  });
});

describe("support requests", () => {
  it("lets owners open support requests and Super Admins work them", async () => {
    const owner = await signUpUser("Support Owner");
    const ws = await createWorkspaceAs(owner, "Support Spice");
    const { restaurantId, branchId } = await insertRestaurantWithBranch(c, ws.id);
    const waiter = await signUpUser("Support Waiter");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: waiter.userId,
      role: "waiter",
      restaurantId,
      branchId,
    });

    // Plan changes are not support tickets: they use the upgrade-request flow.
    const asUpgrade = await call(createSupport, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      body: {
        subject: "Upgrade to Pro",
        message: "Please activate Pro annual.",
        category: "UPGRADE",
      },
    });
    expect(asUpgrade.status).toBe(422);

    const created = await call<SupportRequestDto>(createSupport, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      body: {
        subject: "Invoice question",
        message: "Please resend our last invoice.",
        category: "BILLING",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data!.contactEmail).toBe(owner.email);

    const overview = await call<SubscriptionOverviewDto>(getSubscription, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
    });
    expect(overview.body.data!.pendingUpgrade).toBeNull();

    const invalid = await call(createSupport, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      body: { subject: "x", message: "short", category: "NOPE" },
    });
    expect(invalid.status).toBe(422);

    // Waiter: cannot create; sees only their own (none).
    const waiterCreate = await call(createSupport, {
      params: { workspaceId: ws.id },
      cookie: waiter.cookie,
      body: {
        subject: "Printer broken",
        message: "Kitchen printer is offline.",
        category: "TECHNICAL",
      },
    });
    expect(waiterCreate.status).toBe(403);
    const waiterList = await call<Paginated<SupportRequestDto>>(listSupport, {
      params: { workspaceId: ws.id },
      cookie: waiter.cookie,
    });
    expect(waiterList.status).toBe(200);
    expect(waiterList.body.data!.items).toHaveLength(0);

    const ownerList = await call<Paginated<SupportRequestDto> & { canCreate: boolean }>(
      listSupport,
      { params: { workspaceId: ws.id }, cookie: owner.cookie },
    );
    expect(ownerList.body.data!.items).toHaveLength(1);
    expect(ownerList.body.data!.canCreate).toBe(true);

    // Other tenant: 404.
    const stranger = await signUpUser("Support Stranger");
    expect(
      (await call(listSupport, { params: { workspaceId: ws.id }, cookie: stranger.cookie })).status,
    ).toBe(404);

    // Super Admin.
    const list = await call<Paginated<SupportRequestDto>>(adminSupportList, {
      cookie: admin.cookie,
      path: `/api/v1/admin/support?category=BILLING&workspaceId=${ws.id}`,
    });
    expect(list.body.data!.items.map((r) => r.id)).toEqual([created.body.data!.id]);
    const id = created.body.data!.id;

    const asOwner = await call(adminSupportGet, {
      params: { requestId: id },
      cookie: owner.cookie,
    });
    expect(asOwner.status).toBe(403);

    const patched = await call<SupportRequestDetailDto>(adminSupportPatch, {
      method: "PATCH",
      params: { requestId: id },
      cookie: admin.cookie,
      body: { status: "IN_PROGRESS", priority: "HIGH", assignee: "me" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data!).toMatchObject({ status: "IN_PROGRESS", priority: "HIGH" });
    expect(patched.body.data!.assignedTo?.id).toBe(admin.userId);

    const mine = await call<Paginated<SupportRequestDto>>(adminSupportList, {
      cookie: admin.cookie,
      path: "/api/v1/admin/support?assigned=me",
    });
    expect(mine.body.data!.items.map((r) => r.id)).toContain(id);

    const noted = await call<SupportRequestDetailDto>(adminSupportNote, {
      params: { requestId: id },
      cookie: admin.cookie,
      body: { body: "Called the owner; payment received by bank transfer." },
    });
    expect(noted.status).toBe(201);
    expect(noted.body.data!.notes).toHaveLength(1);
    expect(noted.body.data!.notes[0]!.isInternal).toBe(true);

    const resolved = await call<SupportRequestDetailDto>(adminSupportPatch, {
      method: "PATCH",
      params: { requestId: id },
      cookie: admin.cookie,
      body: { status: "RESOLVED" },
    });
    expect(resolved.body.data!.resolvedAt).not.toBeNull();
    const empty = await call(adminSupportPatch, {
      method: "PATCH",
      params: { requestId: id },
      cookie: admin.cookie,
      body: {},
    });
    expect(empty.status).toBe(422);

    // Workspace audit trail shows the request and the admin's handling.
    const audit = await call<Paginated<AuditLogDto>>(workspaceAudit, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      path: "/api/v1/x?action=support",
    });
    expect(audit.status).toBe(200);
    const actions = audit.body.data!.items.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["support.request_created", "platform.support_updated"]),
    );
    expect(
      audit.body.data!.items.find((a) => a.action === "platform.support_updated")?.actorType,
    ).toBe("PLATFORM_ADMIN");
  });
});

describe("workspace audit log", () => {
  it("paginates, filters and enforces workspace.audit.view", async () => {
    const owner = await signUpUser("Audit Owner");
    const ws = await createWorkspaceAs(owner, "Audit Adda");
    const res = await call<Paginated<AuditLogDto>>(workspaceAudit, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      path: "/api/v1/x?pageSize=1&page=1",
    });
    expect(res.status).toBe(200);
    expect(res.body.data!.items).toHaveLength(1);
    expect(res.body.data!.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data!.items[0]!.actor?.email).toBe(owner.email);

    const byActor = await call<Paginated<AuditLogDto>>(workspaceAudit, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      path: "/api/v1/x?actor=nobody-matches",
    });
    expect(byActor.body.data!.total).toBe(0);

    const future = await call<Paginated<AuditLogDto>>(workspaceAudit, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      path: "/api/v1/x?from=2099-01-01",
    });
    expect(future.body.data!.total).toBe(0);
    const badRange = await call(workspaceAudit, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      path: "/api/v1/x?from=2026-02-01&to=2026-01-01",
    });
    expect(badRange.status).toBe(422);

    const { restaurantId, branchId } = await insertRestaurantWithBranch(c, ws.id);
    const cashier = await signUpUser("Audit Cashier");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: cashier.userId,
      role: "cashier",
      restaurantId,
      branchId,
    });
    expect(
      (await call(workspaceAudit, { params: { workspaceId: ws.id }, cookie: cashier.cookie }))
        .status,
    ).toBe(403);
    const other = await signUpUser("Audit Stranger");
    expect(
      (await call(workspaceAudit, { params: { workspaceId: ws.id }, cookie: other.cookie })).status,
    ).toBe(404);
  });
});
