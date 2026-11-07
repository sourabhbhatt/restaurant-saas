import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { POST as runJob } from "@/app/api/v1/jobs/subscriptions/route";
import { GET as getEntitlements } from "@/app/api/v1/workspaces/[workspaceId]/entitlements/route";
import type { SubscriptionSweepResult } from "@ros/contracts/platform";
import { DEFAULT_PLATFORM_SETTINGS } from "@ros/domain/platform/settings";
import type { Entitlements } from "@ros/domain/subscriptions/entitlements";
import {
  connectPglite,
  runMigrations,
  type DatabaseHandle,
  type Executor,
} from "@ros/database/providers/postgres/client";
import {
  emailOutbox,
  subscriptionPlans,
  subscriptions,
} from "@ros/database/providers/postgres/schema";
import { rowsOf } from "@ros/database/providers/postgres/row-counts";
import type { Container } from "@/composition/container";
import { addStaffMember, createWorkspaceAs, signUpUser } from "@/test/fixtures";
import { freshCookie, setClockDays } from "@/test/fixtures-platform";
import { call, createTestContainer } from "@/test/harness";
import { migrateTo } from "@ros/testing/migrate-to";

/**
 * 0004_trial_and_workspace_limits: plan `max_workspaces` (pro 3, enterprise
 * unlimited, others 1) and the 15-day trial defaults, applied only where the
 * stored settings still equal the old defaults (spec section 7.3).
 */

const DAY_MS = 86_400_000;
const PRE = "0003_organizations";
const LEGACY_TRIAL_DAYS = 30;
const OLD_REMINDERS = [7, 15, 25];

const U = "11111111-1111-4111-8111-111111111111";
const O = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const W = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function seedPlans(db: Executor): Promise<void> {
  await db.execute(sql`insert into subscription_plans (id, key, name, limits, features) values
    (${PRO}, 'pro', 'Pro', '{}'::jsonb, '[]'::jsonb),
    (gen_random_uuid(), 'starter', 'Starter', '{}'::jsonb, '[]'::jsonb),
    (gen_random_uuid(), 'enterprise', 'Enterprise', '{}'::jsonb, '[]'::jsonb),
    (gen_random_uuid(), 'custom', 'Custom', '{}'::jsonb, '[]'::jsonb)`);
}

async function seedSettings(db: Executor, values: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await db.execute(
      sql`insert into platform_settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)`,
    );
  }
}

async function setting(db: Executor, key: string): Promise<unknown> {
  const [row] = rowsOf<{ value: unknown }>(
    await db.execute(sql`select value from platform_settings where key = ${key}`),
  );
  return row?.value;
}

/** A fresh database at the pre-migration schema, seeded, then fully migrated. */
async function migratedWith(seed: (db: Executor) => Promise<void>): Promise<DatabaseHandle> {
  const handle = await connectPglite();
  await migrateTo(handle, PRE);
  await seed(handle.db);
  await runMigrations(handle, "pglite");
  return handle;
}

describe("0004 settings migration", () => {
  it("default trialDays 30 becomes 15 and the old reminder days become [7, 12, 14]", async () => {
    const h = await migratedWith(async (db) => {
      await seedSettings(db, { trialDays: 30, trialReminderDays: OLD_REMINDERS, graceDays: 7 });
    });
    try {
      expect(await setting(h.db, "trialDays")).toBe(DEFAULT_PLATFORM_SETTINGS.trialDays);
      expect(await setting(h.db, "trialReminderDays")).toEqual(
        DEFAULT_PLATFORM_SETTINGS.trialReminderDays,
      );
      expect(await setting(h.db, "graceDays")).toBe(7);
    } finally {
      await h.close();
    }
  });

  it("admin-edited trialDays 21 is kept", async () => {
    const h = await migratedWith(async (db) => {
      await seedSettings(db, { trialDays: 21, trialReminderDays: OLD_REMINDERS });
    });
    try {
      expect(await setting(h.db, "trialDays")).toBe(21);
      expect(await setting(h.db, "trialReminderDays")).toEqual(
        DEFAULT_PLATFORM_SETTINGS.trialReminderDays,
      );
    } finally {
      await h.close();
    }
  });

  it("edited reminder days are kept", async () => {
    const h = await migratedWith(async (db) => {
      await seedSettings(db, { trialDays: 30, trialReminderDays: [3, 10] });
    });
    try {
      expect(await setting(h.db, "trialDays")).toBe(DEFAULT_PLATFORM_SETTINGS.trialDays);
      expect(await setting(h.db, "trialReminderDays")).toEqual([3, 10]);
    } finally {
      await h.close();
    }
  });

  it("a missing trialDays row stays missing (the code default already applies)", async () => {
    const h = await migratedWith(async () => {});
    try {
      expect(await setting(h.db, "trialDays")).toBeUndefined();
    } finally {
      await h.close();
    }
  });

  it("pro gets 3, enterprise null, custom plan 1", async () => {
    const h = await migratedWith(seedPlans);
    try {
      const rows = await h.db
        .select({ key: subscriptionPlans.key, max: subscriptionPlans.maxWorkspaces })
        .from(subscriptionPlans)
        .orderBy(subscriptionPlans.key);
      expect(rows).toEqual([
        { key: "custom", max: 1 },
        { key: "enterprise", max: null },
        { key: "pro", max: 3 },
        { key: "starter", max: 1 },
      ]);
    } finally {
      await h.close();
    }
  });
});

describe("trials across the migration", () => {
  let c: Container;
  let legacyTrialEnd: Date;
  const SECRET = "test-cron-secret-0123456789";

  beforeAll(async () => {
    const start = new Date();
    legacyTrialEnd = new Date(start.getTime() + LEGACY_TRIAL_DAYS * DAY_MS);
    c = await createTestContainer({
      upTo: PRE,
      seed: async (db) => {
        await seedSettings(db, { trialDays: 30, trialReminderDays: OLD_REMINDERS });
        await seedPlans(db);
        await db.execute(
          sql`insert into users (id, email, name) values (${U}, 'legacy@example.test', 'Legacy Owner')`,
        );
        await db.execute(
          sql`insert into organizations (id, name, created_by) values (${O}, 'Legacy Org', ${U})`,
        );
        await db.execute(
          sql`insert into organization_members (organization_id, user_id, role) values (${O}, ${U}, 'OWNER')`,
        );
        await db.execute(
          sql`insert into workspaces (id, organization_id, name, slug, created_by) values (${W}, ${O}, 'Legacy Kitchen', 'legacy-kitchen', ${U})`,
        );
        await db.execute(sql`insert into subscriptions
          (workspace_id, organization_id, plan_id, status, trial_starts_at, trial_ends_at, is_current)
          values (${W}, ${O}, ${PRO}, 'TRIALING', ${start.toISOString()}, ${legacyTrialEnd.toISOString()}, true)`);
      },
    });
    c.env.CRON_SECRET = SECRET;
    await addStaffMember(c, { workspaceId: W, userId: U, role: "workspace_owner" });
  });
  afterEach(() => setClockDays(c, 0));
  afterAll(() => c.close());

  const sweep = () =>
    call<SubscriptionSweepResult>(runJob, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });

  async function entitlementsOf(workspaceId: string, userId: string): Promise<Entitlements> {
    const res = await call<{ entitlements: Entitlements }>(getEntitlements, {
      params: { workspaceId },
      cookie: await freshCookie(c, userId),
    });
    expect(res.status).toBe(200);
    return res.body.data!.entitlements;
  }

  it("legacy trial keeps its end date and gets accurate reminder text", async () => {
    expect(await setting(c.db, "trialDays")).toBe(DEFAULT_PLATFORM_SETTINGS.trialDays);
    const [sub] = await c.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.workspaceId, W), eq(subscriptions.isCurrent, true)));
    expect(sub!.trialEndsAt!.toISOString()).toBe(legacyTrialEnd.toISOString());

    setClockDays(c, 12.5);
    const day12 = await entitlementsOf(W, U);
    expect(day12.phase).toBe("TRIAL");
    expect(day12.trialDaysRemaining).toBe(LEGACY_TRIAL_DAYS - 12);

    const res = await sweep();
    expect(res.status).toBe(200);
    expect(res.body.data!.trialReminders).toBe(1);
    const mails = await c.db
      .select({ subject: emailOutbox.subject, text: emailOutbox.textBody })
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.toAddress, "legacy@example.test"),
          eq(emailOutbox.template, "trial_reminder"),
        ),
      );
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toContain(`${LEGACY_TRIAL_DAYS - 12} days left`);
    expect(mails[0]!.text).toContain(
      legacyTrialEnd.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
    );

    // The 15-day default does not shorten it: still a trial on day 16, grace only after day 30.
    setClockDays(c, 16);
    expect((await entitlementsOf(W, U)).phase).toBe("TRIAL");
    setClockDays(c, LEGACY_TRIAL_DAYS + 0.5);
    const grace = await entitlementsOf(W, U);
    expect(grace.phase).toBe("GRACE");
    expect(grace.graceEndsAt).toBe(
      new Date(
        legacyTrialEnd.getTime() + DEFAULT_PLATFORM_SETTINGS.graceDays * DAY_MS,
      ).toISOString(),
    );
    const [after] = await c.db
      .select({ trialEndsAt: subscriptions.trialEndsAt })
      .from(subscriptions)
      .where(and(eq(subscriptions.workspaceId, W), eq(subscriptions.isCurrent, true)));
    expect(after!.trialEndsAt!.toISOString()).toBe(legacyTrialEnd.toISOString());
  });

  it("new trial after migration ends 15 days after creation", async () => {
    const owner = await signUpUser("Fresh Owner");
    const ws = await createWorkspaceAs(owner, "Fresh Kitchen");
    const [sub] = await c.db
      .select({ starts: subscriptions.trialStartsAt, ends: subscriptions.trialEndsAt })
      .from(subscriptions)
      .where(and(eq(subscriptions.workspaceId, ws.id), eq(subscriptions.isCurrent, true)));
    expect(sub!.ends!.getTime() - sub!.starts!.getTime()).toBe(
      DEFAULT_PLATFORM_SETTINGS.trialDays * DAY_MS,
    );
    expect((await entitlementsOf(ws.id, owner.userId)).trialDaysRemaining).toBe(
      DEFAULT_PLATFORM_SETTINGS.trialDays,
    );
  });
});
