import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getAnnouncements } from "@/app/api/v1/admin/announcements/route";
import { POST as createAnnouncement } from "@/app/api/v1/admin/announcements/route";
import { DELETE as deleteAnnouncement } from "@/app/api/v1/admin/announcements/[announcementId]/route";
import { GET as adminAudit } from "@/app/api/v1/admin/audit/route";
import { GET as listPlans, POST as createPlan } from "@/app/api/v1/admin/plans/route";
import { PATCH as updatePlan } from "@/app/api/v1/admin/plans/[planId]/route";
import { GET as getSettings, PUT as putSettings } from "@/app/api/v1/admin/settings/route";
import { GET as adminSupport } from "@/app/api/v1/admin/support/route";
import { GET as adminWorkspaces } from "@/app/api/v1/admin/workspaces/route";
import { GET as adminWorkspace } from "@/app/api/v1/admin/workspaces/[workspaceId]/route";
import { GET as publicAnnouncements } from "@/app/api/v1/public/announcements/route";
import { GET as publicPlans } from "@/app/api/v1/public/plans/route";
import type {
  AdminPlanDto,
  AdminSettingsDto,
  AdminWorkspaceRowDto,
  AnnouncementDto,
  AuditLogDto,
  Paginated,
  PlanInput,
  PublicAnnouncementDto,
  PublicPlanDto,
} from "@/contracts/platform";
import { auditLogs } from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import { createWorkspaceAs, signUpUser, type TestUser } from "@/test/fixtures";
import { signUpAdmin } from "@/test/fixtures-platform";
import { call, createTestContainer } from "@/test/harness";

let c: Container;
let admin: TestUser;
let owner: TestUser;
beforeAll(async () => {
  c = await createTestContainer();
  admin = await signUpAdmin(c);
  owner = await signUpUser("Plain Owner");
});
afterAll(async () => {
  await c.close();
});

const planBody = (over: Partial<PlanInput> = {}): PlanInput => ({
  key: `growth-${Math.random().toString(36).slice(2, 8)}`,
  name: "Growth",
  description: "For growing groups",
  currency: "INR",
  monthlyPrice: 149_900,
  annualPrice: 1_499_000,
  isTrialEligible: true,
  isPublic: true,
  status: "ACTIVE",
  limits: {
    maxRestaurants: 5,
    maxBranches: 20,
    maxStaff: 100,
    maxTables: null,
    maxMenuItems: null,
    storageMb: 5000,
  },
  features: ["qr_ordering", "analytics"],
  sortOrder: 5,
  ...over,
});

describe("admin access control", () => {
  it("rejects anonymous (401) and non-admin users (403) on every admin endpoint", async () => {
    const ws = await createWorkspaceAs(owner, "Owner Foods");
    const handlers = [
      () => call(listPlans, {}),
      () => call(getSettings, {}),
      () => call(adminWorkspaces, {}),
      () => call(adminAudit, {}),
      () => call(adminSupport, {}),
      () => call(getAnnouncements, {}),
    ];
    for (const h of handlers) expect((await h()).status).toBe(401);

    const asOwner = [
      await call(listPlans, { cookie: owner.cookie }),
      await call(createPlan, { cookie: owner.cookie, body: planBody() }),
      await call(getSettings, { cookie: owner.cookie }),
      await call(adminWorkspaces, { cookie: owner.cookie }),
      await call(adminWorkspace, { cookie: owner.cookie, params: { workspaceId: ws.id } }),
      await call(adminAudit, { cookie: owner.cookie }),
      await call(adminSupport, { cookie: owner.cookie }),
    ];
    for (const res of asOwner) {
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("FORBIDDEN");
    }
  });
});

describe("plans", () => {
  it("creates, lists and updates plans with an audit trail", async () => {
    const body = planBody();
    const created = await call<AdminPlanDto>(createPlan, { cookie: admin.cookie, body });
    expect(created.status).toBe(201);
    expect(created.body.data!.key).toBe(body.key);
    expect(created.body.data!.limits.maxTables).toBeNull();

    const dup = await call(createPlan, { cookie: admin.cookie, body: { ...body } });
    expect(dup.status).toBe(422);
    expect(dup.body.error?.fieldErrors?.key).toBeDefined();

    const updated = await call<AdminPlanDto>(updatePlan, {
      method: "PATCH",
      cookie: admin.cookie,
      params: { planId: created.body.data!.id },
      body: { ...body, name: "Growth Plus", monthlyPrice: 159_900 },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data!.name).toBe("Growth Plus");

    const list = await call<AdminPlanDto[]>(listPlans, { cookie: admin.cookie });
    expect(list.body.data!.some((p) => p.key === body.key)).toBe(true);

    const audit = await c.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, "platform.plan_updated"), eq(auditLogs.actorUserId, admin.userId)),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(audit[0]?.actorType).toBe("PLATFORM_ADMIN");
    expect(audit[0]?.metadata).toMatchObject({ fields: expect.arrayContaining(["name"]) });
  });

  it("validates plan input", async () => {
    const res = await call(createPlan, {
      cookie: admin.cookie,
      body: { ...planBody(), key: "Bad Key!", monthlyPrice: -5 },
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error!.fieldErrors!)).toEqual(
      expect.arrayContaining(["key", "monthlyPrice"]),
    );
  });

  it("refuses to archive the configured trial plan", async () => {
    const list = await call<AdminPlanDto[]>(listPlans, { cookie: admin.cookie });
    const pro = list.body.data!.find((p) => p.key === "pro")!;
    const { id: _id, activeSubscriptions: _a, createdAt: _c, updatedAt: _u, ...rest } = pro;
    const res = await call(updatePlan, {
      method: "PATCH",
      cookie: admin.cookie,
      params: { planId: pro.id },
      body: { ...rest, status: "ARCHIVED" },
    });
    expect(res.status).toBe(422);
    expect(res.body.error?.fieldErrors?.status).toBeDefined();
  });

  it("publishes only public ACTIVE plans without internal fields", async () => {
    const hidden = planBody({ isPublic: false });
    const archived = planBody({ status: "ARCHIVED" });
    await call(createPlan, { cookie: admin.cookie, body: hidden });
    await call(createPlan, { cookie: admin.cookie, body: archived });
    const res = await call<PublicPlanDto[]>(publicPlans, {});
    expect(res.status).toBe(200);
    const keys = res.body.data!.map((p) => p.key);
    expect(keys).toContain("pro");
    expect(keys).not.toContain(hidden.key);
    expect(keys).not.toContain(archived.key);
    const pro = res.body.data!.find((p) => p.key === "pro")!;
    expect(pro).not.toHaveProperty("id");
    expect(pro).not.toHaveProperty("status");
    expect(pro).not.toHaveProperty("sortOrder");
    expect(pro.features[0]).toEqual({ key: expect.any(String), label: expect.any(String) });
  });
});

describe("platform settings", () => {
  it("validates and saves settings, writing an audit row", async () => {
    const current = await call<AdminSettingsDto>(getSettings, { cookie: admin.cookie });
    expect(current.status).toBe(200);
    const s = current.body.data!.settings;

    const invalid = await call(putSettings, {
      method: "PUT",
      cookie: admin.cookie,
      body: { ...s, trialDays: -1, supportEmail: "nope" },
    });
    expect(invalid.status).toBe(422);
    expect(Object.keys(invalid.body.error!.fieldErrors!)).toEqual(
      expect.arrayContaining(["trialDays", "supportEmail"]),
    );

    const badPlan = await call(putSettings, {
      method: "PUT",
      cookie: admin.cookie,
      body: { ...s, trialPlanKey: "does-not-exist" },
    });
    expect(badPlan.status).toBe(422);
    expect(badPlan.body.error?.fieldErrors?.trialPlanKey).toBeDefined();

    const badReminders = await call(putSettings, {
      method: "PUT",
      cookie: admin.cookie,
      body: { ...s, trialDays: 10, trialReminderDays: [5, 12] },
    });
    expect(badReminders.status).toBe(422);

    const ok = await call<AdminSettingsDto>(putSettings, {
      method: "PUT",
      cookie: admin.cookie,
      body: { ...s, graceDays: 10, productName: "RestaurantOS Test" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data!.settings.graceDays).toBe(10);
    const [row] = await c.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "platform.settings_updated"))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(row?.actorType).toBe("PLATFORM_ADMIN");
    expect(Object.keys((row?.metadata as { changes: object }).changes)).toEqual(
      expect.arrayContaining(["graceDays", "productName"]),
    );

    // Restore defaults for other tests.
    await call(putSettings, { method: "PUT", cookie: admin.cookie, body: s });
    expect((await c.entitlements.getPlatformSettings()).graceDays).toBe(s.graceDays);
  });
});

describe("announcements", () => {
  it("shows only active announcements inside their time window", async () => {
    const now = Date.now();
    const mk = (title: string, over: Record<string, unknown> = {}) =>
      call<AnnouncementDto>(createAnnouncement, {
        cookie: admin.cookie,
        body: {
          title,
          body: "Scheduled maintenance tonight",
          level: "WARNING",
          startsAt: new Date(now - 60_000).toISOString(),
          endsAt: new Date(now + 3_600_000).toISOString(),
          isActive: true,
          ...over,
        },
      });
    const live = await mk("Live notice");
    expect(live.status).toBe(201);
    await mk("Inactive notice", { isActive: false });
    await mk("Future notice", { startsAt: new Date(now + 86_400_000).toISOString(), endsAt: null });
    await mk("Past notice", {
      startsAt: new Date(now - 7_200_000).toISOString(),
      endsAt: new Date(now - 3_600_000).toISOString(),
    });
    const bad = await mk("Backwards", { endsAt: new Date(now - 7_200_000).toISOString() });
    expect(bad.status).toBe(422);

    const pub = await call<PublicAnnouncementDto[]>(publicAnnouncements, {});
    const titles = pub.body.data!.map((a) => a.title);
    expect(titles).toContain("Live notice");
    expect(titles).not.toContain("Inactive notice");
    expect(titles).not.toContain("Future notice");
    expect(titles).not.toContain("Past notice");

    const del = await call(deleteAnnouncement, {
      method: "DELETE",
      cookie: admin.cookie,
      params: { announcementId: live.body.data!.id },
    });
    expect(del.status).toBe(200);
    const after = await call<PublicAnnouncementDto[]>(publicAnnouncements, {});
    expect(after.body.data!.map((a) => a.title)).not.toContain("Live notice");
  });
});

describe("admin workspace directory and audit", () => {
  it("lists workspaces with phase and counts, filters, and shows detail", async () => {
    const o = await signUpUser("Directory Owner");
    const ws = await createWorkspaceAs(o, "Directory Diner");
    const res = await call<Paginated<AdminWorkspaceRowDto>>(adminWorkspaces, {
      cookie: admin.cookie,
      path: "/api/v1/admin/workspaces?q=Directory%20Diner&phase=TRIAL",
    });
    expect(res.status).toBe(200);
    const row = res.body.data!.items.find((w) => w.id === ws.id)!;
    expect(row).toMatchObject({ phase: "TRIAL", planKey: "pro", ownerEmail: o.email });
    expect(row.counts.users).toBe(1);
    expect(row.trialDaysRemaining).toBe(30);

    const none = await call<Paginated<AdminWorkspaceRowDto>>(adminWorkspaces, {
      cookie: admin.cookie,
      path: "/api/v1/admin/workspaces?q=Directory%20Diner&phase=RESTRICTED",
    });
    expect(none.body.data!.items.find((w) => w.id === ws.id)).toBeUndefined();

    const detail = await call<{ members: unknown[]; subscription: { status: string } }>(
      adminWorkspace,
      { cookie: admin.cookie, params: { workspaceId: ws.id } },
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data!.members).toHaveLength(1);
    expect(detail.body.data!.subscription.status).toBe("TRIALING");

    const missing = await call(adminWorkspace, {
      cookie: admin.cookie,
      params: { workspaceId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(missing.status).toBe(404);

    const audit = await call<Paginated<AuditLogDto>>(adminAudit, {
      cookie: admin.cookie,
      path: `/api/v1/admin/audit?workspaceId=${ws.id}`,
    });
    expect(audit.status).toBe(200);
    expect(audit.body.data!.items.map((a) => a.action)).toContain("workspace.created");
    expect(audit.body.data!.items.every((a) => a.workspaceId === ws.id)).toBe(true);
  });
});
