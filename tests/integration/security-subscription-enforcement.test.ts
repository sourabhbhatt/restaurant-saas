import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PATCH as patchOrganization } from "@/app/api/v1/admin/organizations/[organizationId]/route";
import { POST as setStatus } from "@/app/api/v1/admin/workspaces/[workspaceId]/status/route";
import { POST as activate } from "@/app/api/v1/admin/workspaces/[workspaceId]/subscription/activate/route";
import { POST as recordPayment } from "@/app/api/v1/bills/[billId]/payments/route";
import { GET as branchAnalytics } from "@/app/api/v1/branches/[branchId]/analytics/route";
import { POST as staffOrder } from "@/app/api/v1/branches/[branchId]/orders/route";
import { PATCH as patchItem } from "@/app/api/v1/menu/items/[itemId]/route";
import { GET as getEntitlements } from "@/app/api/v1/workspaces/[workspaceId]/entitlements/route";
import { POST as createInvitation } from "@/app/api/v1/workspaces/[workspaceId]/invitations/route";
import { POST as createRestaurant } from "@/app/api/v1/workspaces/[workspaceId]/restaurants/route";
import { GET as getWorkspace } from "@/app/api/v1/workspaces/[workspaceId]/route";
import { POST as createWorkspace } from "@/app/api/v1/workspaces/route";
import { DEFAULT_PLATFORM_SETTINGS } from "@ros/domain/platform/settings";
import {
  isOperationAllowed,
  type AccessLevel,
  type Entitlements,
  type OperationKind,
  type SubscriptionPhase,
} from "@ros/domain/subscriptions/entitlements";
import { menuItems, roles } from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import {
  addWorkspaceToOrganization,
  createWorkspaceAs,
  organizationOf,
  signUpUser,
  type TestUser,
} from "@/test/fixtures";
import { openSession } from "@/test/fixtures-billing";
import { createOrderingWorld, type OrderingWorld } from "@/test/fixtures-ordering";
import { freshCookie, setClockDays, signUpAdmin } from "@/test/fixtures-platform";
import { insertBill } from "@/test/fixtures-staff-ops";
import { call, uniqueEmail, type CallResult, createTestContainer } from "@/test/harness";

/**
 * Subscription enforcement matrix (spec section 7.3): one organization on a
 * trial created at T0, checked in every phase against
 * `isOperationAllowed(accessLevel, kind)`. A failure here is a bug in the
 * service that owns the action, not in this test.
 */

const { trialDays, graceDays } = DEFAULT_PLATFORM_SETTINGS;

interface Phase {
  name: SubscriptionPhase;
  level: AccessLevel;
  /** Clock offset in days from T0. */
  day: number;
  suspend?: boolean;
}

const PHASES: Phase[] = [
  { name: "TRIAL", level: "FULL", day: 1 },
  { name: "GRACE", level: "LIMITED", day: trialDays + 1 },
  { name: "RESTRICTED", level: "READ_ONLY", day: trialDays + graceDays + 1 },
  { name: "SUSPENDED", level: "NONE", day: 1, suspend: true },
];

interface Action {
  name: string;
  kind: OperationKind;
  run: (cookie: string, phase: Phase) => Promise<CallResult>;
}

let c: Container;
let admin: TestUser;
let w: OrderingWorld;
let organizationId: string;
let memberRoleId: string;
/** One open bill per phase, created at T0 while the trial is in full force. */
const openBills = new Map<string, string>();

let keySeq = 0;
const key = () => `matrix-${Date.now().toString(36)}-${++keySeq}`;

beforeAll(async () => {
  c = await createTestContainer();
  admin = await signUpAdmin(c);
  w = await createOrderingWorld(c, "Matrix");
  organizationId = await organizationOf(c, w.workspaceId);
  // Workspace creation is limited by count as well; the matrix tests the access gate only.
  const override = await call(patchOrganization, {
    method: "PATCH",
    params: { organizationId },
    cookie: admin.cookie,
    body: { maxWorkspacesOverride: 100 },
  });
  expect(override.status).toBe(200);
  const [member] = await c.db
    .select({ id: roles.id })
    .from(roles)
    .where(and(isNull(roles.workspaceId), eq(roles.key, "workspace_member")));
  memberRoleId = member!.id;
  for (const phase of PHASES) {
    const session = await openSession(c, w);
    openBills.set(phase.name, await insertBill(c, w, { ...session, grandTotal: 10_000 }));
  }
});
afterEach(() => setClockDays(c, 0));
afterAll(() => c.close());

async function entitlementsOf(workspaceId: string, cookie: string): Promise<Entitlements> {
  const res = await call<{ entitlements: Entitlements }>(getEntitlements, {
    params: { workspaceId },
    cookie,
  });
  expect(res.status).toBe(200);
  return res.body.data!.entitlements;
}

const ACTIONS: Action[] = [
  {
    name: "create restaurant",
    kind: "grow",
    run: (cookie, phase) =>
      call(createRestaurant, {
        params: { workspaceId: w.workspaceId },
        cookie,
        body: { name: `Restaurant ${phase.name}` },
      }),
  },
  {
    name: "invite staff",
    kind: "grow",
    run: (cookie) =>
      call(createInvitation, {
        params: { workspaceId: w.workspaceId },
        cookie,
        body: { email: uniqueEmail("invitee"), workspaceRoleId: memberRoleId },
      }),
  },
  {
    name: "create workspace",
    kind: "grow",
    run: (cookie, phase) =>
      call(createWorkspace, { cookie, body: { name: `Sibling ${phase.name}`, organizationId } }),
  },
  {
    name: "place staff order",
    kind: "operate",
    run: (cookie) =>
      call(staffOrder, {
        params: { branchId: w.branchId },
        cookie,
        body: {
          tableId: w.table.tableId,
          idempotencyKey: key(),
          lines: [{ menuItemId: w.simpleItemId, quantity: 1 }],
        },
      }),
  },
  {
    name: "edit menu item",
    kind: "operate",
    run: async (cookie, phase) => {
      const [item] = await c.db
        .select({ version: menuItems.version })
        .from(menuItems)
        .where(eq(menuItems.id, w.simpleItemId));
      return call(patchItem, {
        method: "PATCH",
        params: { itemId: w.simpleItemId },
        cookie,
        body: { version: item!.version, name: `Paneer Tikka ${phase.name}` },
      });
    },
  },
  {
    name: "record payment on an open bill",
    kind: "settle",
    run: (cookie, phase) =>
      call(recordPayment, {
        params: { billId: openBills.get(phase.name)! },
        cookie,
        body: { idempotencyKey: key(), method: "CASH", amount: 10_000 },
      }),
  },
  {
    name: "view analytics",
    kind: "read",
    run: (cookie) => call(branchAnalytics, { params: { branchId: w.branchId }, cookie }),
  },
];

function expectOutcome(res: CallResult, allowed: boolean, label: string): void {
  if (allowed) {
    expect([200, 201], `${label}: ${JSON.stringify(res.body.error ?? null)}`).toContain(res.status);
  } else {
    expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
    expect(res.body.error?.code, label).toBe("WORKSPACE_RESTRICTED");
  }
}

describe("subscription enforcement matrix", () => {
  describe.each(PHASES)("$name / $level (day $day)", (phase) => {
    let cookie: string;
    beforeAll(async () => {
      setClockDays(c, phase.day);
      if (phase.suspend) {
        const res = await call(setStatus, {
          params: { workspaceId: w.workspaceId },
          cookie: admin.cookie,
          body: { status: "SUSPENDED", reason: "Matrix: suspended by Super Admin" },
        });
        expect(res.status).toBe(200);
      }
      cookie = await freshCookie(c, w.owner.userId);
    });
    afterAll(() => setClockDays(c, 0));

    it("is the expected phase", async () => {
      setClockDays(c, phase.day);
      // Entitlements stay readable in every phase, so owners can see why access is limited.
      const ent = await entitlementsOf(w.workspaceId, cookie);
      expect(ent.phase).toBe(phase.name);
      expect(ent.accessLevel).toBe(phase.level);
    });

    it.each(ACTIONS)("$name ($kind)", async (action) => {
      setClockDays(c, phase.day);
      const allowed = isOperationAllowed(phase.level, action.kind);
      expectOutcome(await action.run(cookie, phase), allowed, `${phase.name}: ${action.name}`);
    });
  });
});

describe("organization-wide phases", () => {
  it("a second workspace in the same annual org follows the org's phase", async () => {
    const owner = await signUpUser("Annual Matrix Owner");
    const first = await createWorkspaceAs(owner, "Annual Matrix One");
    const orgId = await organizationOf(c, first.id);
    const second = await addWorkspaceToOrganization(c, {
      organizationId: orgId,
      userId: owner.userId,
      name: "Annual Matrix Two",
    });
    const activated = await call(activate, {
      params: { workspaceId: first.id },
      cookie: admin.cookie,
      body: {
        planKey: "pro",
        billingCycle: "ANNUAL",
        periodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      },
    });
    expect(activated.status).toBe(200);

    const grow = (workspaceId: string, cookie: string, name: string) =>
      call(createRestaurant, { params: { workspaceId }, cookie, body: { name } });
    const read = (workspaceId: string, cookie: string) =>
      call(getWorkspace, { params: { workspaceId }, cookie });

    const checks: { day: number; phase: SubscriptionPhase; level: AccessLevel }[] = [
      { day: 1, phase: "ACTIVE", level: "FULL" },
      { day: 31, phase: "GRACE", level: "LIMITED" },
      { day: 31 + graceDays + 1, phase: "RESTRICTED", level: "READ_ONLY" },
    ];
    for (const check of checks) {
      setClockDays(c, check.day);
      const cookie = await freshCookie(c, owner.userId);
      for (const ws of [first, second]) {
        const ent = await entitlementsOf(ws.id, cookie);
        expect(ent.phase, `${ws.name} day ${check.day}`).toBe(check.phase);
        expect(ent.accessLevel, `${ws.name} day ${check.day}`).toBe(check.level);
        expectOutcome(
          await grow(ws.id, cookie, `R ${ws.name} ${check.day}`),
          isOperationAllowed(check.level, "grow"),
          `${ws.name} day ${check.day}: grow`,
        );
        expectOutcome(
          await read(ws.id, cookie),
          isOperationAllowed(check.level, "read"),
          `${ws.name} day ${check.day}: read`,
        );
      }
    }
  });
});
