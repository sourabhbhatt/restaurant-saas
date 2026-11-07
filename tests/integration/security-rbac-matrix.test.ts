/**
 * RBAC matrix: every system role template × every guarded action. Each role
 * gets its own workspace (so mutations by one role never affect another) with
 * the role user assigned at the template's scope: workspace roles through the
 * membership, restaurant_manager on the restaurant, branch roles on the branch.
 *
 * Expected: allowed when the role holds the permission → 2xx. Denied → 403
 * FORBIDDEN, or 404 where the scope hides the resource: a plain
 * workspace_member has no restaurant or branch assignment, so every
 * restaurant/branch route reports the resource as not found.
 */
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ROLE_TEMPLATE_LIST,
  ROLE_TEMPLATES,
  ALL_PERMISSIONS,
  type Permission,
  type RoleTemplate,
  type RoleTemplateKey,
} from "@/domain/access/permissions";
import {
  bills,
  payments,
  tableSessions,
  roles,
  workspaceMemberships,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import { addStaffMember, createWorkspaceAs, insertRestaurantWithBranch } from "@/test/fixtures";
import { signUpAdmin } from "@/test/fixtures-platform";
import {
  insertMenuItem,
  insertOrder,
  insertSiblingBranch,
  insertTable,
  openSession,
  signUpStaffUser,
  type TestBranch,
} from "@/test/fixtures-staff-ops";
import { call, createTestContainer, type CallResult } from "@/test/harness";
import {
  isDynamic,
  listRouteKeys,
  loadRoutes,
  routePath,
  type Handler,
  type HttpMethod,
} from "@/test/routes";

const ROUTES = await loadRoutes();

function h(route: string, method: HttpMethod): Handler {
  const handler = ROUTES.get(route)?.methods[method];
  if (!handler) throw new Error(`No ${method} export in ${route}/route.ts`);
  return handler;
}

interface World extends TestBranch {
  role: RoleTemplateKey;
  /** Cookie of the user holding `role` in this workspace. */
  cookie: string;
  menuItemId: string;
}

interface Ctx {
  c: Container;
  w: World;
}

export interface RbacAction {
  permission: Permission;
  level: "workspace" | "restaurant" | "branch";
  invoke: (ctx: Ctx) => Promise<CallResult>;
}

let seq = 0;
const next = (p: string) => `${p}-${(++seq).toString().padStart(6, "0")}`;

let memberRoleId: string;
let waiterRoleId: string;

function send(
  ctx: Ctx,
  route: string,
  method: HttpMethod,
  params: Record<string, string>,
  body?: unknown,
): Promise<CallResult> {
  return call(h(route, method), {
    method,
    path: routePath(route, params),
    params,
    cookie: ctx.w.cookie,
    body: method === "GET" || method === "DELETE" ? undefined : (body ?? {}),
  });
}

const ws = ({ w }: Ctx) => ({ workspaceId: w.workspaceId });
const rest = ({ w }: Ctx) => ({ restaurantId: w.restaurantId });
const br = ({ w }: Ctx) => ({ branchId: w.branchId });

/** A fresh table with an open session, so each invocation has its own preconditions. */
async function freshSession({ c, w }: Ctx): Promise<{ tableId: string; sessionId: string }> {
  const tableId = await insertTable(c, w, next("T").slice(0, 20));
  return { tableId, sessionId: await openSession(c, w, tableId) };
}

async function freshOrder(ctx: Ctx, status: string) {
  const s = await freshSession(ctx);
  const o = await insertOrder(ctx.c, ctx.w, {
    ...s,
    status,
    lines: [{ menuItemId: ctx.w.menuItemId, name: "Paneer Tikka" }],
  });
  return { ...s, ...o };
}

/**
 * A bill inserted directly (so it also works in a suspended workspace). Its
 * number is far above the branch counter the billing service draws from.
 */
async function freshBill(ctx: Ctx, paid = false) {
  const s = await freshOrder(ctx, "SERVED");
  const [bill] = await ctx.c.db
    .insert(bills)
    .values({
      workspaceId: ctx.w.workspaceId,
      restaurantId: ctx.w.restaurantId,
      branchId: ctx.w.branchId,
      tableId: s.tableId,
      sessionId: s.sessionId,
      billNumber: 100_000 + ++seq,
      paymentStatus: paid ? "PAID" : "UNPAID",
      currency: "INR",
      subtotal: 25_000,
      pricesIncludeTax: false,
      taxBreakdown: [],
      taxTotal: 0,
      grandTotal: 25_000,
      balanceDue: paid ? 0 : 25_000,
    })
    .returning({ id: bills.id });
  const billId = bill!.id;
  let paymentId: string | undefined;
  if (paid) {
    const [p] = await ctx.c.db
      .insert(payments)
      .values({
        workspaceId: ctx.w.workspaceId,
        branchId: ctx.w.branchId,
        billId,
        method: "CASH",
        amount: 25_000,
        idempotencyKey: next("rbac-pay"),
      })
      .returning({ id: payments.id });
    paymentId = p!.id;
  }
  return { ...s, billId, paymentId };
}

/** Permissions with no entry in RBAC_ACTIONS, and why. */
const EXCLUDED_PERMS: Partial<Record<Permission, string>> = {
  "restaurant.view":
    "no route requires it: restaurant reads fall back to workspace.view for members the scope already lets see the restaurant",
  "workspace.analytics.view":
    "workspace analytics also admit reports.view holders, limited to their restaurants",
};

/**
 * One entry per permission that guards a mutation or a sensitive read.
 * `restaurant.delete` is last: archiving the restaurant ends the world.
 */
export const RBAC_ACTIONS: RbacAction[] = [
  // ---------------------------------------------------------------- workspace
  {
    permission: "workspace.view",
    level: "workspace",
    invoke: (ctx) => send(ctx, "workspaces/[workspaceId]", "GET", ws(ctx)),
  },
  {
    permission: "workspace.update",
    level: "workspace",
    invoke: (ctx) =>
      send(ctx, "workspaces/[workspaceId]", "PATCH", ws(ctx), { legalName: next("Legal") }),
  },
  {
    permission: "workspace.members.view",
    level: "workspace",
    invoke: (ctx) => send(ctx, "workspaces/[workspaceId]/members", "GET", ws(ctx)),
  },
  {
    permission: "workspace.members.manage",
    level: "workspace",
    invoke: (ctx) =>
      send(ctx, "workspaces/[workspaceId]/invitations", "POST", ws(ctx), {
        email: `${next("invitee")}@example.test`,
        workspaceRoleId: memberRoleId,
      }),
  },
  {
    permission: "workspace.roles.manage",
    level: "workspace",
    invoke: (ctx) =>
      send(ctx, "workspaces/[workspaceId]/roles", "POST", ws(ctx), {
        name: next("Role"),
        scope: "BRANCH",
        permissions: ["branch.view"],
      }),
  },
  {
    permission: "workspace.subscription.view",
    level: "workspace",
    invoke: (ctx) => send(ctx, "workspaces/[workspaceId]/upgrade-requests", "GET", ws(ctx)),
  },
  {
    permission: "workspace.subscription.manage",
    level: "workspace",
    invoke: (ctx) =>
      send(ctx, "workspaces/[workspaceId]/upgrade-requests", "POST", ws(ctx), {
        planKey: "enterprise",
      }),
  },
  {
    permission: "workspace.audit.view",
    level: "workspace",
    invoke: (ctx) => send(ctx, "workspaces/[workspaceId]/audit", "GET", ws(ctx)),
  },
  {
    permission: "workspace.support.manage",
    level: "workspace",
    invoke: (ctx) =>
      send(ctx, "workspaces/[workspaceId]/support", "POST", ws(ctx), {
        subject: "RBAC matrix",
        message: "Support request from the RBAC matrix suite",
        category: "GENERAL",
      }),
  },
  {
    permission: "restaurant.create",
    level: "workspace",
    invoke: (ctx) =>
      send(ctx, "workspaces/[workspaceId]/restaurants", "POST", ws(ctx), { name: next("Resto") }),
  },
  // ---------------------------------------------------------------- restaurant
  {
    permission: "restaurant.update",
    level: "restaurant",
    invoke: (ctx) =>
      send(ctx, "restaurants/[restaurantId]", "PATCH", rest(ctx), { description: next("About") }),
  },
  {
    permission: "branch.create",
    level: "restaurant",
    invoke: (ctx) =>
      send(ctx, "restaurants/[restaurantId]/branches", "POST", rest(ctx), { name: next("Branch") }),
  },
  {
    permission: "menu.view",
    level: "restaurant",
    invoke: (ctx) => send(ctx, "restaurants/[restaurantId]/menu", "GET", rest(ctx)),
  },
  {
    permission: "menu.manage",
    level: "restaurant",
    invoke: (ctx) =>
      send(ctx, "restaurants/[restaurantId]/menu/categories", "POST", rest(ctx), {
        name: next("Cat").slice(0, 60),
      }),
  },
  {
    permission: "staff.manage",
    level: "restaurant",
    invoke: async (ctx) => {
      const user = await signUpStaffUser("Assignee");
      await addStaffMember(ctx.c, {
        workspaceId: ctx.w.workspaceId,
        userId: user.userId,
        role: "workspace_member",
      });
      const [m] = await ctx.c.db
        .select({ id: workspaceMemberships.id })
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, ctx.w.workspaceId),
            eq(workspaceMemberships.userId, user.userId),
          ),
        );
      return send(ctx, "branches/[branchId]/staff", "POST", br(ctx), {
        membershipId: m!.id,
        roleId: waiterRoleId,
      });
    },
  },
  {
    permission: "reports.view",
    level: "restaurant",
    invoke: (ctx) => send(ctx, "branches/[branchId]/analytics", "GET", br(ctx)),
  },
  // ---------------------------------------------------------------- branch
  {
    permission: "branch.view",
    level: "branch",
    invoke: (ctx) => send(ctx, "branches/[branchId]", "GET", br(ctx)),
  },
  {
    permission: "branch.update",
    level: "branch",
    invoke: (ctx) =>
      send(ctx, "branches/[branchId]", "PATCH", br(ctx), { phone: next("98").slice(0, 30) }),
  },
  {
    permission: "menu.availability.manage",
    level: "branch",
    invoke: async (ctx) => {
      // Its own item: hiding the shared one would break later order actions.
      const itemId = await insertMenuItem(ctx.c, ctx.w, next("Special"));
      return send(
        ctx,
        "branches/[branchId]/menu/overrides/[itemId]",
        "PUT",
        { ...br(ctx), itemId },
        { isAvailable: false },
      );
    },
  },
  {
    permission: "tables.view",
    level: "branch",
    invoke: (ctx) => send(ctx, "branches/[branchId]/sessions", "GET", br(ctx)),
  },
  {
    permission: "tables.manage",
    level: "branch",
    invoke: (ctx) =>
      send(ctx, "branches/[branchId]/tables", "POST", br(ctx), {
        name: next("N").slice(0, 30),
        capacity: 4,
      }),
  },
  {
    permission: "sessions.manage",
    level: "branch",
    invoke: async (ctx) => {
      const s = await freshSession(ctx);
      return send(ctx, "branches/[branchId]/sessions/[sessionId]/close", "POST", {
        ...br(ctx),
        sessionId: s.sessionId,
      });
    },
  },
  {
    permission: "orders.view",
    level: "branch",
    invoke: (ctx) => send(ctx, "branches/[branchId]/orders", "GET", br(ctx)),
  },
  {
    permission: "orders.create",
    level: "branch",
    invoke: async (ctx) => {
      const tableId = await insertTable(ctx.c, ctx.w, next("O").slice(0, 20));
      return send(ctx, "branches/[branchId]/orders", "POST", br(ctx), {
        tableId,
        lines: [{ menuItemId: ctx.w.menuItemId, quantity: 1 }],
        idempotencyKey: next("rbac-order"),
      });
    },
  },
  {
    permission: "orders.approve",
    level: "branch",
    invoke: async (ctx) => {
      const o = await freshOrder(ctx, "PENDING");
      return send(
        ctx,
        "orders/[orderId]/transition",
        "POST",
        { orderId: o.orderId },
        {
          action: "accept",
          expectedVersion: 1,
        },
      );
    },
  },
  {
    permission: "orders.serve",
    level: "branch",
    invoke: async (ctx) => {
      const o = await freshOrder(ctx, "READY");
      return send(
        ctx,
        "orders/[orderId]/transition",
        "POST",
        { orderId: o.orderId },
        {
          action: "serve",
          expectedVersion: 1,
        },
      );
    },
  },
  {
    permission: "orders.cancel",
    level: "branch",
    invoke: async (ctx) => {
      const o = await freshOrder(ctx, "ACCEPTED");
      return send(
        ctx,
        "orders/[orderId]/transition",
        "POST",
        { orderId: o.orderId },
        {
          action: "cancel",
          reason: "Guest left",
          expectedVersion: 1,
        },
      );
    },
  },
  {
    permission: "kitchen.view",
    level: "branch",
    invoke: (ctx) => send(ctx, "branches/[branchId]/kitchen", "GET", br(ctx)),
  },
  {
    permission: "kitchen.update",
    level: "branch",
    invoke: async (ctx) => {
      const o = await freshOrder(ctx, "ACCEPTED");
      return send(
        ctx,
        "orders/[orderId]/items/[itemId]",
        "PATCH",
        { orderId: o.orderId, itemId: o.itemIds[0]! },
        { status: "PREPARING" },
      );
    },
  },
  {
    permission: "bills.view",
    level: "branch",
    invoke: async (ctx) => {
      const b = await freshBill(ctx);
      return send(ctx, "bills/[billId]", "GET", { billId: b.billId });
    },
  },
  {
    permission: "bills.generate",
    level: "branch",
    invoke: async (ctx) => {
      const o = await freshOrder(ctx, "SERVED");
      return send(ctx, "branches/[branchId]/bills", "POST", br(ctx), {
        sessionId: o.sessionId,
        idempotencyKey: next("rbac-bill"),
      });
    },
  },
  {
    permission: "bills.discount",
    level: "branch",
    invoke: async (ctx) => {
      const o = await freshOrder(ctx, "SERVED");
      return send(ctx, "branches/[branchId]/bills/preview", "POST", br(ctx), {
        sessionId: o.sessionId,
        discount: { type: "PERCENT", value: 1000 },
      });
    },
  },
  {
    permission: "bills.void",
    level: "branch",
    invoke: async (ctx) => {
      const b = await freshBill(ctx);
      return send(
        ctx,
        "bills/[billId]/void",
        "POST",
        { billId: b.billId },
        { reason: "Wrong table" },
      );
    },
  },
  {
    permission: "payments.record",
    level: "branch",
    invoke: async (ctx) => {
      const b = await freshBill(ctx);
      return send(
        ctx,
        "bills/[billId]/payments",
        "POST",
        { billId: b.billId },
        {
          method: "CASH",
          amount: 10_000,
          idempotencyKey: next("rbac-pay"),
        },
      );
    },
  },
  {
    permission: "payments.refund",
    level: "branch",
    invoke: async (ctx) => {
      const b = await freshBill(ctx, true);
      return send(
        ctx,
        "payments/[paymentId]/void",
        "POST",
        { paymentId: b.paymentId! },
        {
          reason: "Entered twice",
        },
      );
    },
  },
  {
    permission: "payments.summary.view",
    level: "branch",
    invoke: (ctx) => send(ctx, "branches/[branchId]/payments/summary", "GET", br(ctx)),
  },
  {
    permission: "restaurant.delete",
    level: "restaurant",
    invoke: async (ctx) => {
      // Archiving requires every table session to be closed.
      await ctx.c.db
        .update(tableSessions)
        .set({ status: "CLOSED", closedAt: new Date() })
        .where(eq(tableSessions.restaurantId, ctx.w.restaurantId));
      return send(ctx, "restaurants/[restaurantId]", "DELETE", rest(ctx));
    },
  },
];

/**
 * Permissions a role user holds. Restaurant and branch roles are assigned on
 * top of a workspace_member membership, so they also hold its permissions
 * (`workspace.view`); the template alone would not grant it.
 */
function holds(template: RoleTemplate, permission: Permission): boolean {
  if (template.permissions.includes(permission)) return true;
  return (
    template.scope !== "WORKSPACE" &&
    ROLE_TEMPLATES.workspace_member.permissions.includes(permission)
  );
}

/** 404 where the scope hides the resource (no assignment in it), else 403. */
function deniedStatus(role: RoleTemplateKey, level: RbacAction["level"]): number {
  return role === "workspace_member" && level !== "workspace" ? 404 : 403;
}

let c: Container;
const worlds = new Map<RoleTemplateKey, World>();

async function systemRoleId(key: string): Promise<string> {
  const [row] = await c.db
    .select({ id: roles.id })
    .from(roles)
    .where(and(isNull(roles.workspaceId), eq(roles.key, key)));
  return row!.id;
}

async function createWorld(role: RoleTemplateKey): Promise<World> {
  const owner = await signUpStaffUser(`${role} owner`);
  const workspace = await createWorkspaceAs(owner, `RBAC ${role}`);
  const r = await insertRestaurantWithBranch(c, workspace.id, { name: `RBAC ${role}` });
  const base: TestBranch = {
    workspaceId: workspace.id,
    restaurantId: r.restaurantId,
    branchId: r.branchId,
    categoryId: r.categoryId,
    owner,
  };
  const menuItemId = await insertMenuItem(c, base, "Paneer Tikka");
  let cookie = owner.cookie;
  if (role !== "workspace_owner") {
    const user = await signUpStaffUser(role);
    const scope = ROLE_TEMPLATES[role].scope;
    await addStaffMember(c, {
      workspaceId: workspace.id,
      userId: user.userId,
      role,
      restaurantId: scope === "WORKSPACE" ? undefined : r.restaurantId,
      branchId: scope === "BRANCH" ? r.branchId : undefined,
    });
    cookie = user.cookie;
  }
  return { ...base, role, cookie, menuItemId };
}

beforeAll(async () => {
  c = await createTestContainer();
  memberRoleId = await systemRoleId("workspace_member");
  waiterRoleId = await systemRoleId("waiter");
  for (const t of ROLE_TEMPLATE_LIST) worlds.set(t.key, await createWorld(t.key));
});

afterAll(() => c.close());

describe("RBAC matrix across system roles", () => {
  it("every permission is an action or an explicit exclusion", () => {
    const listed = new Set<string>(RBAC_ACTIONS.map((a) => a.permission));
    const excluded = Object.keys(EXCLUDED_PERMS);
    expect(
      excluded.filter((p) => listed.has(p)),
      "both listed and excluded",
    ).toEqual([]);
    const missing = ALL_PERMISSIONS.filter((p) => !listed.has(p) && !excluded.includes(p));
    expect(missing, `Add RBAC_ACTIONS or EXCLUDED_PERMS for: ${missing.join(", ")}`).toEqual([]);
  });

  it("covers the 7 system roles", () => {
    expect(ROLE_TEMPLATE_LIST.map((t) => t.key).sort()).toEqual(
      [
        "cashier",
        "kitchen_staff",
        "restaurant_manager",
        "waiter",
        "workspace_admin",
        "workspace_member",
        "workspace_owner",
      ].sort(),
    );
  });

  describe.each(ROLE_TEMPLATE_LIST.map((t) => [t.key, t] as const))("%s", (_key, template) => {
    const cases = RBAC_ACTIONS.map((action) => {
      const allowed = holds(template, action.permission);
      return [
        template.key,
        allowed ? "allowed" : "denied",
        action.permission,
        action,
        allowed,
      ] as const;
    });
    it.each(cases)("%s %s %s", async (_role, _verdict, _permission, action, allowed) => {
      const w = worlds.get(template.key)!;
      const res = await action.invoke({ c, w });
      const detail = `${res.status} ${JSON.stringify(res.body.error ?? {})}`;
      if (allowed) {
        expect(res.status, detail).toBeGreaterThanOrEqual(200);
        expect(res.status, detail).toBeLessThan(300);
      } else {
        const status = deniedStatus(template.key, action.level);
        expect(res.status, detail).toBe(status);
        expect(res.body.error?.code, detail).toBe(status === 404 ? "NOT_FOUND" : "FORBIDDEN");
      }
    });
  });
});

describe("scope boundaries", () => {
  it("branch-assigned waiter is 404 at another branch of the same restaurant", async () => {
    const w = worlds.get("waiter")!;
    const sibling = await insertSiblingBranch(c, w, "Sibling Branch");
    const ctx = { c, w };
    expect((await send(ctx, "branches/[branchId]", "GET", br(ctx))).status).toBe(200);
    for (const route of [
      "branches/[branchId]",
      "branches/[branchId]/orders",
      "branches/[branchId]/sessions",
    ]) {
      const res = await send(ctx, route, "GET", { branchId: sibling.branchId });
      expect(res.status, route).toBe(404);
      expect(res.body.error?.code).toBe("NOT_FOUND");
    }
    const tableId = await insertTable(c, sibling, "Sibling T1");
    const order = await send(
      ctx,
      "branches/[branchId]/orders",
      "POST",
      { branchId: sibling.branchId },
      {
        tableId,
        lines: [{ menuItemId: w.menuItemId, quantity: 1 }],
        idempotencyKey: next("rbac-sibling"),
      },
    );
    expect(order.status).toBe(404);
  });

  it("restaurant manager is 404 for another restaurant in the same workspace", async () => {
    const w = worlds.get("restaurant_manager")!;
    const other = await insertRestaurantWithBranch(c, w.workspaceId, { name: "Other Resto" });
    const ctx = { c, w };
    expect((await send(ctx, "restaurants/[restaurantId]", "GET", rest(ctx))).status).toBe(200);
    for (const [route, params] of [
      ["restaurants/[restaurantId]", { restaurantId: other.restaurantId }],
      ["restaurants/[restaurantId]/menu", { restaurantId: other.restaurantId }],
      ["branches/[branchId]", { branchId: other.branchId }],
      ["branches/[branchId]/orders", { branchId: other.branchId }],
    ] as const) {
      const res = await send(ctx, route, "GET", params);
      expect(res.status, route).toBe(404);
    }
    const patch = await send(
      ctx,
      "restaurants/[restaurantId]",
      "PATCH",
      { restaurantId: other.restaurantId },
      {
        name: "Taken over",
      },
    );
    expect(patch.status).toBe(404);
  });

  it("non-admin gets 403 on every /api/v1/admin route", async () => {
    const owner = worlds.get("workspace_owner")!;
    const admin = await signUpAdmin(c);
    const adminRoutes = listRouteKeys().filter((r) => r.startsWith("admin/"));
    expect(adminRoutes.length).toBeGreaterThan(20);
    let checked = 0;
    for (const route of adminRoutes) {
      const methods = ROUTES.get(route)!.methods;
      for (const [method, handler] of Object.entries(methods) as [HttpMethod, Handler][]) {
        const params = Object.fromEntries(
          [...route.matchAll(/\[(\w+)\]/g)].map((m) => [m[1]!, crypto.randomUUID()]),
        );
        const res = await call(handler, {
          method,
          path: routePath(route, params),
          params,
          cookie: owner.cookie,
          body: method === "GET" || method === "DELETE" ? undefined : {},
        });
        expect(res.status, `${method} ${route}`).toBe(403);
        expect(res.body.error?.code, `${method} ${route}`).toBe("FORBIDDEN");
        checked += 1;
        // Control: the Super Admin is past the gate on the same static reads.
        if (method === "GET" && !isDynamic(route)) {
          const ok = await call(handler, { path: routePath(route, {}), cookie: admin.cookie });
          expect(ok.status, `admin GET ${route}`).toBe(200);
        }
      }
    }
    expect(checked).toBeGreaterThan(25);
  });

  it("removed member's next request is 404", async () => {
    const w = await createWorld("waiter");
    const ctx = { c, w };
    expect((await send(ctx, "branches/[branchId]", "GET", br(ctx))).status).toBe(200);
    const members = await c.db
      .select({ id: workspaceMemberships.id, userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, w.workspaceId));
    const waiter = members.find((x) => x.userId !== w.owner.userId)!;
    const removed = await call(h("workspaces/[workspaceId]/members/[membershipId]", "DELETE"), {
      method: "DELETE",
      params: { workspaceId: w.workspaceId, membershipId: waiter.id },
      cookie: w.owner.cookie,
    });
    expect(removed.status).toBe(200);
    for (const [route, params] of [
      ["branches/[branchId]", br(ctx)],
      ["branches/[branchId]/orders", br(ctx)],
      ["workspaces/[workspaceId]", ws(ctx)],
    ] as const) {
      const res = await send(ctx, route, "GET", params);
      expect(res.status, route).toBe(404);
    }
  });
});

/**
 * Deliberately reachable while suspended, so owners can contact support (see
 * platform service `createSupportRequest`).
 */
const SUSPENSION_EXEMPT: Permission[] = ["workspace.support.manage"];

describe("suspended workspace", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld("workspace_owner");
    const admin = await signUpAdmin(c, "Suspending Admin");
    const res = await call(h("admin/workspaces/[workspaceId]/status", "POST"), {
      params: { workspaceId: w.workspaceId },
      cookie: admin.cookie,
      body: { status: "SUSPENDED", reason: "RBAC matrix suspension" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it.each(
    RBAC_ACTIONS.filter((a) => !SUSPENSION_EXEMPT.includes(a.permission)).map(
      (a) => [a.permission, a] as const,
    ),
  )("suspended workspace denies %s with WORKSPACE_RESTRICTED", async (_p, action) => {
    const res = await action.invoke({ c, w });
    expect(res.status, JSON.stringify(res.body.error)).toBe(403);
    expect(res.body.error?.code).toBe("WORKSPACE_RESTRICTED");
  });

  it.each(
    SUSPENSION_EXEMPT.map((p) => [p, RBAC_ACTIONS.find((a) => a.permission === p)!] as const),
  )("suspended workspace still allows %s (by design)", async (_p, action) => {
    const res = await action.invoke({ c, w });
    expect(res.status, JSON.stringify(res.body.error)).toBeLessThan(300);
  });
});
