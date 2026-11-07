/**
 * Cross-tenant HTTP isolation. The owner of workspace B (full permissions in
 * B, none in A) calls every tenant-scoped route with A's ids and must get 404,
 * with A's data unchanged afterwards (checked through A's own GET). A route
 * guard keeps the table complete: a new dynamic route without a case fails.
 */
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  invitations,
  payments,
  roleAssignments,
  roles,
  tableSessions,
  upgradeRequests,
  workspaceMemberships,
  orderItems,
  orders,
  bills,
} from "@/infrastructure/database/providers/postgres/schema";
import type { ObjectStorage } from "@/infrastructure/storage/interfaces/object-storage";
import type { Container } from "@/server/container";
import { createTenantWorld, type TenantWorld } from "@/test/fixtures-rls";
import { call, createTestContainer, TEST_ORIGIN, type CallResult } from "@/test/harness";
import {
  callStream,
  isDynamic,
  listRouteKeys,
  loadRoutes,
  routePath,
  type Handler,
  type HttpMethod,
} from "@/test/routes";

/** Covered by their own suites (admin, public/guest, invitation tokens, files, test and dev hooks). */
const EXCLUDED = [
  /^admin\//,
  /^public\//,
  /^invitations\/\[token\]/,
  /^files\//,
  /^test\//,
  /^dev\//,
];

const ROUTES = await loadRoutes();

function h(route: string, method: HttpMethod): Handler {
  const handler = ROUTES.get(route)?.methods[method];
  if (!handler) throw new Error(`No ${method} export in ${route}/route.ts`);
  return handler;
}

interface Fixture extends TenantWorld {
  sessionId: string;
  orderId: string;
  orderItemId: string;
  billId: string;
  paymentId: string;
  ownerMembershipId: string;
  staffMembershipId: string;
  assignmentId: string;
  invitationId: string;
  upgradeRequestId: string;
  /** A custom role of WORKSPACE scope (the world's own custom role is BRANCH scope). */
  workspaceCustomRoleId: string;
}

/** A's resource read back as A: the before/after snapshot that must not change. */
type Probe =
  | "workspace"
  | "members"
  | "invitations"
  | "roles"
  | "restaurants"
  | "restaurant"
  | "branches"
  | "branch"
  | "settings"
  | "branchStaff"
  | "menu"
  | "overrides"
  | "tables"
  | "table"
  | "qr"
  | "session"
  | "order"
  | "bill"
  | "support"
  | "upgradeRequests"
  | "usage";

const PROBES: Record<Probe, { route: string; params: (a: Fixture) => Record<string, string> }> = {
  workspace: { route: "workspaces/[workspaceId]", params: (a) => ({ workspaceId: a.workspaceId }) },
  members: {
    route: "workspaces/[workspaceId]/members",
    params: (a) => ({ workspaceId: a.workspaceId }),
  },
  invitations: {
    route: "workspaces/[workspaceId]/invitations",
    params: (a) => ({ workspaceId: a.workspaceId }),
  },
  roles: {
    route: "workspaces/[workspaceId]/roles",
    params: (a) => ({ workspaceId: a.workspaceId }),
  },
  restaurants: {
    route: "workspaces/[workspaceId]/restaurants",
    params: (a) => ({ workspaceId: a.workspaceId }),
  },
  restaurant: {
    route: "restaurants/[restaurantId]",
    params: (a) => ({ restaurantId: a.restaurantId }),
  },
  branches: {
    route: "restaurants/[restaurantId]/branches",
    params: (a) => ({ restaurantId: a.restaurantId }),
  },
  branch: { route: "branches/[branchId]", params: (a) => ({ branchId: a.branchId }) },
  settings: { route: "branches/[branchId]/settings", params: (a) => ({ branchId: a.branchId }) },
  branchStaff: { route: "branches/[branchId]/staff", params: (a) => ({ branchId: a.branchId }) },
  menu: {
    route: "restaurants/[restaurantId]/menu",
    params: (a) => ({ restaurantId: a.restaurantId }),
  },
  overrides: {
    route: "branches/[branchId]/menu/overrides",
    params: (a) => ({ branchId: a.branchId }),
  },
  tables: { route: "branches/[branchId]/tables", params: (a) => ({ branchId: a.branchId }) },
  table: { route: "tables/[tableId]", params: (a) => ({ tableId: a.table.tableId }) },
  qr: { route: "tables/[tableId]/qr", params: (a) => ({ tableId: a.table.tableId }) },
  session: {
    route: "branches/[branchId]/sessions/[sessionId]",
    params: (a) => ({ branchId: a.branchId, sessionId: a.sessionId }),
  },
  order: { route: "orders/[orderId]", params: (a) => ({ orderId: a.orderId }) },
  bill: { route: "bills/[billId]", params: (a) => ({ billId: a.billId }) },
  support: {
    route: "workspaces/[workspaceId]/support",
    params: (a) => ({ workspaceId: a.workspaceId }),
  },
  upgradeRequests: {
    route: "workspaces/[workspaceId]/upgrade-requests",
    params: (a) => ({ workspaceId: a.workspaceId }),
  },
  usage: {
    route: "workspaces/[workspaceId]/entitlements",
    params: (a) => ({ workspaceId: a.workspaceId }),
  },
};

type Ids = (a: Fixture, b: Fixture) => Record<string, string>;

export interface IsolationCase {
  route: string;
  method: HttpMethod;
  handler: Handler;
  params: Ids;
  query?: Ids;
  body?: unknown | ((a: Fixture, b: Fixture) => unknown);
  /** A's resource that must read the same before and after. */
  probe: Probe;
  /** Server-Sent Events: status only, then the request is aborted. */
  stream?: boolean;
  /** multipart/form-data upload. */
  upload?: boolean;
}

let seq = 0;
const key = (p: string) => `${p}-${(++seq).toString().padStart(6, "0")}`;

const ws = (a: Fixture) => ({ workspaceId: a.workspaceId });
const rest = (a: Fixture) => ({ restaurantId: a.restaurantId });
const br = (a: Fixture) => ({ branchId: a.branchId });
const bill = (a: Fixture) => ({ billId: a.billId });
const order = (a: Fixture) => ({ orderId: a.orderId });
const table = (a: Fixture) => ({ tableId: a.table.tableId });

function iso(
  route: string,
  method: HttpMethod,
  probe: Probe,
  params: Ids,
  extra: Partial<Pick<IsolationCase, "body" | "query" | "stream" | "upload">> = {},
): IsolationCase {
  return { route, method, handler: h(route, method), params, probe, ...extra };
}

let memberRoleId: string;
let waiterRoleId: string;

const fullSettings = {
  taxes: [{ name: "VAT", rateBps: 1000 }],
  pricesIncludeTax: false,
  serviceChargeBps: 0,
  paymentMethods: ["CASH"],
  requireFullPaymentToClose: true,
  autoCompleteOnPayment: false,
  allowCustomerBillRequest: true,
  acceptingOrders: true,
  kitchenDelayMinutes: 20,
  kitchenSoundEnabled: true,
  waiterSoundEnabled: true,
};

/** Every tenant-scoped dynamic route + method, called by B with A's ids. */
export const ISOLATION_CASES: IsolationCase[] = [
  // ---------------------------------------------------------------- bills & payments
  iso("bills/[billId]/payments", "POST", "bill", bill, {
    body: () => ({ method: "CASH", amount: 100, idempotencyKey: key("iso-pay") }),
  }),
  iso("bills/[billId]/receipt", "GET", "bill", bill),
  iso("bills/[billId]/refunds", "POST", "bill", bill, {
    body: () => ({
      method: "CASH",
      amount: 100,
      note: "Cross-tenant",
      idempotencyKey: key("iso-ref"),
    }),
  }),
  iso("bills/[billId]", "GET", "bill", bill),
  iso("bills/[billId]/void", "POST", "bill", bill, { body: { reason: "Cross-tenant" } }),
  iso("payments/[paymentId]/void", "POST", "bill", (a) => ({ paymentId: a.paymentId }), {
    body: { reason: "Cross-tenant" },
  }),
  // ---------------------------------------------------------------- branches
  iso("branches/[branchId]/analytics/live", "GET", "branch", br),
  iso("branches/[branchId]/analytics", "GET", "branch", br),
  iso("branches/[branchId]/bills/preview", "POST", "session", br, {
    body: (a: Fixture) => ({ sessionId: a.sessionId }),
  }),
  iso("branches/[branchId]/bills/queue", "GET", "bill", br),
  iso("branches/[branchId]/bills", "GET", "bill", br),
  iso("branches/[branchId]/bills", "POST", "session", br, {
    body: (a: Fixture) => ({ sessionId: a.sessionId, idempotencyKey: key("iso-bill") }),
  }),
  iso("branches/[branchId]/context", "GET", "branch", br),
  iso("branches/[branchId]/events", "GET", "branch", br, { stream: true }),
  iso("branches/[branchId]/kitchen", "GET", "order", br),
  iso(
    "branches/[branchId]/menu/overrides/[itemId]",
    "PUT",
    "overrides",
    (a) => ({
      branchId: a.branchId,
      itemId: a.simpleItemId,
    }),
    { body: { isAvailable: true, price: 1 } },
  ),
  iso("branches/[branchId]/menu/overrides", "GET", "overrides", br),
  iso("branches/[branchId]/menu", "GET", "menu", br),
  iso("branches/[branchId]/orders", "GET", "order", br),
  iso("branches/[branchId]/orders", "POST", "session", br, {
    body: (a: Fixture) => ({
      tableId: a.table.tableId,
      lines: [{ menuItemId: a.simpleItemId, quantity: 1 }],
      idempotencyKey: key("iso-order"),
    }),
  }),
  iso("branches/[branchId]/payments/summary", "GET", "bill", br),
  iso("branches/[branchId]", "GET", "branch", br),
  iso("branches/[branchId]", "PATCH", "branch", br, { body: { name: "Hijacked Branch" } }),
  iso("branches/[branchId]", "DELETE", "branch", br),
  iso("branches/[branchId]/sessions/[sessionId]/close", "POST", "session", (a) => ({
    branchId: a.branchId,
    sessionId: a.sessionId,
  })),
  iso("branches/[branchId]/sessions/[sessionId]", "GET", "session", (a) => ({
    branchId: a.branchId,
    sessionId: a.sessionId,
  })),
  iso("branches/[branchId]/sessions", "GET", "session", br),
  iso("branches/[branchId]/settings", "GET", "settings", br),
  iso("branches/[branchId]/settings", "PUT", "settings", br, { body: fullSettings }),
  iso("branches/[branchId]/staff/[assignmentId]", "DELETE", "branchStaff", (a) => ({
    branchId: a.branchId,
    assignmentId: a.assignmentId,
  })),
  iso("branches/[branchId]/staff", "GET", "branchStaff", br),
  iso("branches/[branchId]/staff", "POST", "branchStaff", br, {
    body: (a: Fixture) => ({ membershipId: a.ownerMembershipId, roleId: waiterRoleId }),
  }),
  iso("branches/[branchId]/staff", "DELETE", "branchStaff", br, {
    query: (a) => ({ assignmentId: a.assignmentId }),
  }),
  iso("branches/[branchId]/tables/bulk", "POST", "tables", br, {
    body: { prefix: "X", from: 1, to: 2, capacity: 2 },
  }),
  iso("branches/[branchId]/tables/qr-sheet", "GET", "qr", br),
  iso("branches/[branchId]/tables", "GET", "tables", br),
  iso("branches/[branchId]/tables", "POST", "tables", br, {
    body: { name: "Hijack", capacity: 2 },
  }),
  // ---------------------------------------------------------------- menu
  iso("menu/categories/[categoryId]", "PATCH", "menu", (a) => ({ categoryId: a.categoryId }), {
    body: { name: "Hijacked" },
  }),
  iso("menu/categories/[categoryId]", "DELETE", "menu", (a) => ({ categoryId: a.categoryId })),
  iso("menu/items/[itemId]/availability", "PATCH", "menu", (a) => ({ itemId: a.simpleItemId }), {
    body: { isAvailable: false },
  }),
  iso("menu/items/[itemId]", "GET", "menu", (a) => ({ itemId: a.simpleItemId })),
  iso("menu/items/[itemId]", "PATCH", "menu", (a) => ({ itemId: a.simpleItemId }), {
    body: { name: "Hijacked", price: 1 },
  }),
  iso("menu/items/[itemId]", "DELETE", "menu", (a) => ({ itemId: a.simpleItemId })),
  // ---------------------------------------------------------------- orders
  iso(
    "orders/[orderId]/items/[itemId]",
    "PATCH",
    "order",
    (a) => ({
      orderId: a.orderId,
      itemId: a.orderItemId,
    }),
    { body: { status: "PREPARING" } },
  ),
  iso("orders/[orderId]/priority", "PATCH", "order", order, {
    body: { priority: "RUSH", expectedVersion: 1 },
  }),
  iso("orders/[orderId]", "GET", "order", order),
  iso("orders/[orderId]/transition", "POST", "order", order, {
    body: { action: "cancel", reason: "Cross-tenant", expectedVersion: 1 },
  }),
  // ---------------------------------------------------------------- restaurants
  iso("restaurants/[restaurantId]/branches", "GET", "branches", rest),
  iso("restaurants/[restaurantId]/branches", "POST", "branches", rest, {
    body: { name: "Hijack Branch" },
  }),
  iso("restaurants/[restaurantId]/menu/categories", "POST", "menu", rest, {
    body: { name: "Hijack" },
  }),
  iso("restaurants/[restaurantId]/menu/items", "POST", "menu", rest, {
    body: (a: Fixture) => ({
      categoryId: a.categoryId,
      name: "Hijack Item",
      price: 100,
      dietary: "VEG",
      prepTimeMinutes: 5,
    }),
  }),
  iso("restaurants/[restaurantId]/menu", "GET", "menu", rest),
  iso("restaurants/[restaurantId]", "GET", "restaurant", rest),
  iso("restaurants/[restaurantId]", "PATCH", "restaurant", rest, { body: { name: "Hijacked" } }),
  iso("restaurants/[restaurantId]", "DELETE", "restaurant", rest),
  // ---------------------------------------------------------------- tables
  iso("tables/[tableId]/qr", "GET", "qr", table),
  iso("tables/[tableId]/qr", "POST", "qr", table),
  iso("tables/[tableId]/qr", "DELETE", "qr", table),
  iso("tables/[tableId]", "GET", "table", table),
  iso("tables/[tableId]", "PATCH", "table", table, { body: { name: "Hijacked" } }),
  iso("tables/[tableId]", "DELETE", "table", table),
  // ---------------------------------------------------------------- workspaces
  iso("workspaces/[workspaceId]/analytics", "GET", "workspace", ws),
  iso("workspaces/[workspaceId]/audit", "GET", "workspace", ws),
  iso("workspaces/[workspaceId]/entitlements", "GET", "usage", ws),
  iso("workspaces/[workspaceId]/invitations/[invitationId]/resend", "POST", "invitations", (a) => ({
    workspaceId: a.workspaceId,
    invitationId: a.invitationId,
  })),
  iso("workspaces/[workspaceId]/invitations/[invitationId]", "DELETE", "invitations", (a) => ({
    workspaceId: a.workspaceId,
    invitationId: a.invitationId,
  })),
  iso("workspaces/[workspaceId]/invitations", "GET", "invitations", ws),
  iso("workspaces/[workspaceId]/invitations", "POST", "invitations", ws, {
    body: () => ({ email: `${key("hijack")}@example.test`, workspaceRoleId: memberRoleId }),
  }),
  iso(
    "workspaces/[workspaceId]/members/[membershipId]/assignments/[assignmentId]",
    "DELETE",
    "members",
    (a) => ({
      workspaceId: a.workspaceId,
      membershipId: a.staffMembershipId,
      assignmentId: a.assignmentId,
    }),
  ),
  iso(
    "workspaces/[workspaceId]/members/[membershipId]/assignments",
    "POST",
    "members",
    (a) => ({ workspaceId: a.workspaceId, membershipId: a.staffMembershipId }),
    { body: (a: Fixture) => ({ roleId: waiterRoleId, restaurantId: a.restaurantId }) },
  ),
  iso(
    "workspaces/[workspaceId]/members/[membershipId]",
    "PATCH",
    "members",
    (a) => ({
      workspaceId: a.workspaceId,
      membershipId: a.staffMembershipId,
    }),
    { body: { status: "DISABLED" } },
  ),
  iso("workspaces/[workspaceId]/members/[membershipId]", "DELETE", "members", (a) => ({
    workspaceId: a.workspaceId,
    membershipId: a.staffMembershipId,
  })),
  iso("workspaces/[workspaceId]/members", "GET", "members", ws),
  iso("workspaces/[workspaceId]/members", "POST", "invitations", ws, {
    body: () => ({ email: `${key("hijack")}@example.test`, workspaceRoleId: memberRoleId }),
  }),
  iso("workspaces/[workspaceId]/onboarding", "PUT", "workspace", ws, { body: { dismiss: true } }),
  iso("workspaces/[workspaceId]/restaurants", "GET", "restaurants", ws),
  iso("workspaces/[workspaceId]/restaurants", "POST", "restaurants", ws, {
    body: { name: "Hijack Restaurant" },
  }),
  iso(
    "workspaces/[workspaceId]/roles/[roleId]",
    "PATCH",
    "roles",
    (a) => ({
      workspaceId: a.workspaceId,
      roleId: a.customRoleId,
    }),
    { body: { name: "Hijacked" } },
  ),
  iso("workspaces/[workspaceId]/roles/[roleId]", "DELETE", "roles", (a) => ({
    workspaceId: a.workspaceId,
    roleId: a.customRoleId,
  })),
  iso("workspaces/[workspaceId]/roles", "GET", "roles", ws),
  iso("workspaces/[workspaceId]/roles", "POST", "roles", ws, {
    body: () => ({ name: key("Hijack"), scope: "BRANCH", permissions: ["branch.view"] }),
  }),
  iso("workspaces/[workspaceId]", "GET", "workspace", ws),
  iso("workspaces/[workspaceId]", "PATCH", "workspace", ws, { body: { name: "Hijacked" } }),
  iso("workspaces/[workspaceId]/structure", "GET", "workspace", ws),
  iso("workspaces/[workspaceId]/subscription", "GET", "upgradeRequests", ws),
  iso("workspaces/[workspaceId]/support", "GET", "support", ws),
  iso("workspaces/[workspaceId]/support", "POST", "support", ws, {
    body: { subject: "Hijack", message: "Cross-tenant support request", category: "GENERAL" },
  }),
  iso(
    "workspaces/[workspaceId]/upgrade-requests/[requestId]",
    "DELETE",
    "upgradeRequests",
    (a) => ({
      workspaceId: a.workspaceId,
      requestId: a.upgradeRequestId,
    }),
  ),
  iso("workspaces/[workspaceId]/upgrade-requests", "GET", "upgradeRequests", ws),
  iso("workspaces/[workspaceId]/upgrade-requests", "POST", "upgradeRequests", ws, {
    body: { planKey: "enterprise" },
  }),
  iso("workspaces/[workspaceId]/uploads", "POST", "usage", ws, { upload: true }),
];

/**
 * B's own parent in the URL with A's child id: the service must look the
 * child up inside B's scope, not by id alone.
 */
const NESTED_CASES: (IsolationCase & { label: string })[] = [
  {
    ...iso(
      "branches/[branchId]/menu/overrides/[itemId]",
      "PUT",
      "overrides",
      (a, b) => ({
        branchId: b.branchId,
        itemId: a.simpleItemId,
      }),
      { body: { isAvailable: true, price: 1 } },
    ),
    label: "B's branch, A's menu item",
  },
  {
    ...iso("branches/[branchId]/sessions/[sessionId]", "GET", "session", (a, b) => ({
      branchId: b.branchId,
      sessionId: a.sessionId,
    })),
    label: "B's branch, A's session",
  },
  {
    ...iso("branches/[branchId]/sessions/[sessionId]/close", "POST", "session", (a, b) => ({
      branchId: b.branchId,
      sessionId: a.sessionId,
    })),
    label: "B's branch, A's session",
  },
  {
    ...iso("branches/[branchId]/staff/[assignmentId]", "DELETE", "branchStaff", (a, b) => ({
      branchId: b.branchId,
      assignmentId: a.assignmentId,
    })),
    label: "B's branch, A's assignment",
  },
  {
    ...iso("branches/[branchId]/staff", "DELETE", "branchStaff", (_a, b) => br(b), {
      query: (a) => ({ assignmentId: a.assignmentId }),
    }),
    label: "B's branch, A's assignment (query)",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/invitations/[invitationId]/resend",
      "POST",
      "invitations",
      (a, b) => ({
        workspaceId: b.workspaceId,
        invitationId: a.invitationId,
      }),
    ),
    label: "B's workspace, A's invitation",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/invitations/[invitationId]",
      "DELETE",
      "invitations",
      (a, b) => ({
        workspaceId: b.workspaceId,
        invitationId: a.invitationId,
      }),
    ),
    label: "B's workspace, A's invitation",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/members/[membershipId]/assignments/[assignmentId]",
      "DELETE",
      "members",
      (a, b) => ({
        workspaceId: b.workspaceId,
        membershipId: a.staffMembershipId,
        assignmentId: a.assignmentId,
      }),
    ),
    label: "B's workspace, A's member and assignment",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/members/[membershipId]/assignments/[assignmentId]",
      "DELETE",
      "members",
      (a, b) => ({
        workspaceId: b.workspaceId,
        membershipId: b.staffMembershipId,
        assignmentId: a.assignmentId,
      }),
    ),
    label: "B's workspace and member, A's assignment",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/members/[membershipId]/assignments",
      "POST",
      "members",
      (a, b) => ({ workspaceId: b.workspaceId, membershipId: a.staffMembershipId }),
      {
        body: (_a: Fixture, b: Fixture) => ({ roleId: waiterRoleId, restaurantId: b.restaurantId }),
      },
    ),
    label: "B's workspace, A's member",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/members/[membershipId]",
      "PATCH",
      "members",
      (a, b) => ({
        workspaceId: b.workspaceId,
        membershipId: a.staffMembershipId,
      }),
      { body: { status: "DISABLED" } },
    ),
    label: "B's workspace, A's member",
  },
  {
    ...iso("workspaces/[workspaceId]/members/[membershipId]", "DELETE", "members", (a, b) => ({
      workspaceId: b.workspaceId,
      membershipId: a.staffMembershipId,
    })),
    label: "B's workspace, A's member",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/roles/[roleId]",
      "PATCH",
      "roles",
      (a, b) => ({
        workspaceId: b.workspaceId,
        roleId: a.customRoleId,
      }),
      { body: { name: "Hijacked" } },
    ),
    label: "B's workspace, A's role",
  },
  {
    ...iso("workspaces/[workspaceId]/roles/[roleId]", "DELETE", "roles", (a, b) => ({
      workspaceId: b.workspaceId,
      roleId: a.customRoleId,
    })),
    label: "B's workspace, A's role",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/upgrade-requests/[requestId]",
      "DELETE",
      "upgradeRequests",
      (a, b) => ({
        workspaceId: b.workspaceId,
        requestId: a.upgradeRequestId,
      }),
    ),
    label: "B's workspace, A's upgrade request",
  },
];

/**
 * B's own route with A's ids in the body. Rejected as not found or as invalid
 * input, never applied.
 */
const BODY_REFERENCE_CASES: (IsolationCase & { label: string })[] = [
  {
    ...iso("branches/[branchId]/bills", "POST", "session", (_a, b) => br(b), {
      body: (a: Fixture) => ({ sessionId: a.sessionId, idempotencyKey: key("iso-bill") }),
    }),
    label: "A's session",
  },
  {
    ...iso("branches/[branchId]/bills/preview", "POST", "session", (_a, b) => br(b), {
      body: (a: Fixture) => ({ sessionId: a.sessionId }),
    }),
    label: "A's session",
  },
  {
    ...iso("branches/[branchId]/orders", "POST", "session", (_a, b) => br(b), {
      body: (a: Fixture, b: Fixture) => ({
        tableId: a.table.tableId,
        lines: [{ menuItemId: b.simpleItemId, quantity: 1 }],
        idempotencyKey: key("iso-order"),
      }),
    }),
    label: "A's table",
  },
  {
    ...iso("branches/[branchId]/orders", "POST", "menu", (_a, b) => br(b), {
      body: (a: Fixture, b: Fixture) => ({
        tableId: b.table.tableId,
        lines: [{ menuItemId: a.simpleItemId, quantity: 1 }],
        idempotencyKey: key("iso-order"),
      }),
    }),
    label: "A's menu item",
  },
  {
    ...iso("branches/[branchId]/staff", "POST", "members", (_a, b) => br(b), {
      body: (a: Fixture) => ({ membershipId: a.staffMembershipId, roleId: waiterRoleId }),
    }),
    label: "A's member",
  },
  {
    ...iso("branches/[branchId]/staff", "POST", "roles", (_a, b) => br(b), {
      body: (a: Fixture, b: Fixture) => ({
        membershipId: b.staffMembershipId,
        roleId: a.customRoleId,
      }),
    }),
    label: "A's custom role",
  },
  {
    ...iso("restaurants/[restaurantId]/menu/items", "POST", "menu", (_a, b) => rest(b), {
      body: (a: Fixture) => ({
        categoryId: a.categoryId,
        name: "Hijack Item",
        price: 100,
        dietary: "VEG",
        prepTimeMinutes: 5,
      }),
    }),
    label: "A's category",
  },
  {
    ...iso("menu/items/[itemId]", "PATCH", "menu", (_a, b) => ({ itemId: b.simpleItemId }), {
      body: (a: Fixture) => ({ categoryId: a.categoryId }),
    }),
    label: "A's category",
  },
  {
    ...iso("workspaces/[workspaceId]/invitations", "POST", "roles", (_a, b) => ws(b), {
      body: (a: Fixture) => ({
        email: `${key("hijack")}@example.test`,
        workspaceRoleId: memberRoleId,
        assignmentRoleId: waiterRoleId,
        restaurantId: a.restaurantId,
      }),
    }),
    label: "A's restaurant",
  },
  {
    ...iso("workspaces/[workspaceId]/invitations", "POST", "roles", (_a, b) => ws(b), {
      body: (a: Fixture) => ({
        email: `${key("hijack")}@example.test`,
        workspaceRoleId: a.workspaceCustomRoleId,
      }),
    }),
    label: "A's custom role",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/members/[membershipId]/assignments",
      "POST",
      "branchStaff",
      (_a, b) => ({ workspaceId: b.workspaceId, membershipId: b.staffMembershipId }),
      {
        body: (a: Fixture) => ({
          roleId: waiterRoleId,
          restaurantId: a.restaurantId,
          branchId: a.branchId,
        }),
      },
    ),
    label: "A's restaurant and branch",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/members/[membershipId]/assignments",
      "POST",
      "roles",
      (_a, b) => ({ workspaceId: b.workspaceId, membershipId: b.staffMembershipId }),
      {
        body: (a: Fixture, b: Fixture) => ({
          roleId: a.customRoleId,
          restaurantId: b.restaurantId,
        }),
      },
    ),
    label: "A's custom role",
  },
  {
    ...iso(
      "workspaces/[workspaceId]/members/[membershipId]",
      "PATCH",
      "roles",
      (_a, b) => ({
        workspaceId: b.workspaceId,
        membershipId: b.staffMembershipId,
      }),
      { body: (a: Fixture) => ({ roleId: a.workspaceCustomRoleId }) },
    ),
    label: "A's custom role",
  },
];

let c: Container;
let a: Fixture;
let b: Fixture;
let fileKey: string;

function memoryStorage(): ObjectStorage {
  const files = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    name: "memory",
    async put({ key: k, body, contentType }) {
      files.set(k, { body, contentType });
    },
    async get(k) {
      return files.get(k) ?? null;
    },
    async delete(k) {
      files.delete(k);
    },
    url: (k) => `/api/v1/files/${k}`,
  };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2]);

async function uploadAs(cookie: string, workspaceId: string, restaurantId?: string) {
  const form = new FormData();
  form.set("file", new Blob([PNG as BlobPart], { type: "image/png" }), "x.png");
  form.set("purpose", restaurantId ? "logo" : "menu_item");
  if (restaurantId) form.set("restaurantId", restaurantId);
  const req = new Request(`${TEST_ORIGIN}/api/v1/workspaces/${workspaceId}/uploads`, {
    method: "POST",
    headers: { cookie, origin: TEST_ORIGIN },
    body: form,
  });
  const res = await h("workspaces/[workspaceId]/uploads", "POST")(req, {
    params: Promise.resolve({ workspaceId }),
  });
  return { status: res.status, body: (await res.json()) as CallResult<{ key: string }>["body"] };
}

async function complete(c: Container, w: TenantWorld): Promise<Fixture> {
  const one = async <T>(rows: Promise<T[]>): Promise<T> => {
    const [row] = await rows;
    if (!row) throw new Error("fixture row missing");
    return row;
  };
  const wsId = w.workspaceId;
  const session = await one(
    c.db
      .select({ id: tableSessions.id })
      .from(tableSessions)
      .where(eq(tableSessions.workspaceId, wsId)),
  );
  const o = await one(
    c.db.select({ id: orders.id }).from(orders).where(eq(orders.workspaceId, wsId)),
  );
  const item = await one(
    c.db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, o.id)),
  );
  const bl = await one(
    c.db.select({ id: bills.id }).from(bills).where(eq(bills.workspaceId, wsId)),
  );
  const pay = await one(
    c.db.select({ id: payments.id }).from(payments).where(eq(payments.workspaceId, wsId)),
  );
  const membership = (userId: string) =>
    one(
      c.db
        .select({ id: workspaceMemberships.id })
        .from(workspaceMemberships)
        .where(
          and(eq(workspaceMemberships.workspaceId, wsId), eq(workspaceMemberships.userId, userId)),
        ),
    );
  const staffMembership = await membership(w.staff.userId);
  const assignment = await one(
    c.db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(eq(roleAssignments.membershipId, staffMembership.id)),
  );
  const inv = await one(
    c.db.select({ id: invitations.id }).from(invitations).where(eq(invitations.workspaceId, wsId)),
  );
  const upgrade = await one(
    c.db
      .select({ id: upgradeRequests.id })
      .from(upgradeRequests)
      .where(eq(upgradeRequests.workspaceId, wsId)),
  );
  const [wsRole] = await c.db
    .insert(roles)
    .values({
      workspaceId: wsId,
      key: `ws_custom_${wsId.slice(0, 8)}`,
      name: "WS Custom",
      scope: "WORKSPACE",
    })
    .returning({ id: roles.id });
  return {
    ...w,
    workspaceCustomRoleId: wsRole!.id,
    sessionId: session.id,
    orderId: o.id,
    orderItemId: item.id,
    billId: bl.id,
    paymentId: pay.id,
    ownerMembershipId: (await membership(w.owner.userId)).id,
    staffMembershipId: staffMembership.id,
    assignmentId: assignment.id,
    invitationId: inv.id,
    upgradeRequestId: upgrade.id,
  };
}

beforeAll(async () => {
  c = await createTestContainer();
  c.storage = memoryStorage();
  a = await complete(c, await createTenantWorld(c, "Iso A"));
  b = await complete(c, await createTenantWorld(c, "Iso B"));
  const systemRole = async (k: string) => {
    const [row] = await c.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.workspaceId), eq(roles.key, k)));
    return row!.id;
  };
  memberRoleId = await systemRole("workspace_member");
  waiterRoleId = await systemRole("waiter");
  const up = await uploadAs(a.owner.cookie, a.workspaceId);
  expect(up.status).toBe(201);
  fileKey = up.body.data!.key;
});

afterAll(() => c.close());

async function probe(name: Probe): Promise<unknown> {
  const p = PROBES[name];
  const res = await call(h(p.route, "GET"), { params: p.params(a), cookie: a.owner.cookie });
  expect(res.status, `A's ${p.route} probe`).toBe(200);
  return res.body.data;
}

const resolve = <T>(v: T | ((a: Fixture, b: Fixture) => T)): T =>
  typeof v === "function" ? (v as (a: Fixture, b: Fixture) => T)(a, b) : v;

async function invokeAsB(k: IsolationCase): Promise<{ status: number; code?: string }> {
  const params = k.params(a, b);
  const query = k.query ? `?${new URLSearchParams(k.query(a, b))}` : "";
  const path = `${routePath(k.route, params)}${query}`;
  if (k.stream) {
    const res = await callStream(k.handler, { params, cookie: b.owner.cookie, path });
    return { status: res.status, code: res.body.error?.code };
  }
  if (k.upload) {
    const res = await uploadAs(b.owner.cookie, params.workspaceId!);
    return { status: res.status, code: res.body.error?.code };
  }
  const res = await call(k.handler, {
    method: k.method,
    path,
    params,
    cookie: b.owner.cookie,
    body: k.method === "GET" || k.method === "DELETE" ? undefined : resolve(k.body ?? {}),
  });
  return { status: res.status, code: res.body.error?.code };
}

async function expectIsolated(k: IsolationCase, allowed: number[]): Promise<void> {
  const before = await probe(k.probe);
  const res = await invokeAsB(k);
  expect(allowed, `${k.method} ${k.route} → ${res.status} ${res.code ?? ""}`).toContain(res.status);
  expect(await probe(k.probe)).toEqual(before);
}

describe("cross-tenant isolation over HTTP", () => {
  it.each(ISOLATION_CASES.map((k) => [`${k.method} ${k.route}`, k] as const))(
    "user of workspace B gets 404 for A's %s",
    async (_name, k) => {
      await expectIsolated(k, [404]);
    },
  );

  // Control: the same ids work for A, so B's 404 is isolation, not a bad fixture.
  it.each(
    ISOLATION_CASES.filter((k) => k.method === "GET" && !k.stream).map(
      (k) => [k.route, k] as const,
    ),
  )("A's owner reads its own %s", async (_name, k) => {
    const params = k.params(a, b);
    const res = await call(k.handler, {
      params,
      path: routePath(k.route, params),
      cookie: a.owner.cookie,
    });
    expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  });

  it.each(NESTED_CASES.map((k) => [`${k.method} ${k.route} (${k.label})`, k] as const))(
    "user of workspace B gets 404 for %s",
    async (_name, k) => {
      await expectIsolated(k, [404]);
    },
  );

  it.each(BODY_REFERENCE_CASES.map((k) => [`${k.method} ${k.route} with ${k.label}`, k] as const))(
    "user of workspace B is refused %s in the body",
    async (_name, k) => {
      await expectIsolated(k, [404, 422]);
    },
  );

  it("QR sheet of B's branch never returns A's tables", async () => {
    const res = await call<{ tableId: string }[]>(h("branches/[branchId]/tables/qr-sheet", "GET"), {
      path: `/api/v1/branches/${b.branchId}/tables/qr-sheet?tableIds=${a.table.tableId},${b.table.tableId}`,
      params: br(b),
      cookie: b.owner.cookie,
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).not.toContain(a.table.tableId);
  });

  it("every dynamic route is covered", () => {
    const covered = new Set(ISOLATION_CASES.map((k) => `${k.method} ${k.route}`));
    const required = listRouteKeys()
      .filter((r) => isDynamic(r) && !EXCLUDED.some((x) => x.test(r)))
      .flatMap((r) => Object.keys(ROUTES.get(r)!.methods).map((m) => `${m} ${r}`));
    expect(required.length).toBeGreaterThan(90);
    const missing = required.filter((r) => !covered.has(r));
    expect(missing, `Add ISOLATION_CASES for: ${missing.join(", ")}`).toEqual([]);
  });

  it("SSE stream for another tenant's branch is 404", async () => {
    const handler = h("branches/[branchId]/events", "GET");
    const own = await callStream(handler, {
      params: br(a),
      cookie: a.owner.cookie,
      path: `/api/v1/branches/${a.branchId}/events`,
    });
    expect(own.status).toBe(200);
    expect(own.contentType).toContain("text/event-stream");
    const other = await callStream(handler, {
      params: br(a),
      cookie: b.owner.cookie,
      path: `/api/v1/branches/${a.branchId}/events`,
    });
    expect(other.status).toBe(404);
    expect(other.body.error?.code).toBe("NOT_FOUND");
  });

  it("file key from workspace A is served (public-by-key) but cannot be listed or deleted by B", async () => {
    const getFile = h("files/[...key]", "GET");
    const fetchFile = (cookie?: string) =>
      getFile(
        new Request(`${TEST_ORIGIN}/api/v1/files/${fileKey}`, {
          headers: cookie ? { cookie } : {},
        }),
        { params: Promise.resolve({ key: fileKey.split("/") }) },
      );
    expect((await fetchFile()).status).toBe(200);
    expect((await fetchFile(b.owner.cookie)).status).toBe(200);

    // No route deletes or lists stored files; uploads are the only write.
    for (const r of listRouteKeys().filter((x) => x.startsWith("files/"))) {
      expect(Object.keys(ROUTES.get(r)!.methods)).toEqual(["GET"]);
    }
    // B cannot upload into A, nor attach A's key to its own menu or restaurant.
    expect((await uploadAs(b.owner.cookie, a.workspaceId)).status).toBe(404);
    const item = await call(h("menu/items/[itemId]", "PATCH"), {
      method: "PATCH",
      params: { itemId: b.simpleItemId },
      cookie: b.owner.cookie,
      body: { imageKey: fileKey },
    });
    expect(item.status).toBe(422);
    const logo = await call(h("restaurants/[restaurantId]", "PATCH"), {
      method: "PATCH",
      params: rest(b),
      cookie: b.owner.cookie,
      body: { logoKey: fileKey, coverKey: fileKey },
    });
    expect(logo.status).toBe(422);
    // Dot segments under B's own prefix would resolve to A's file in a browser.
    const tail = fileKey.slice(`ws/${a.workspaceId}/`.length);
    for (const sneaky of [
      `ws/${b.workspaceId}/../${a.workspaceId}/${tail}`,
      `ws/${b.workspaceId}/%2e%2e/${a.workspaceId}/${tail}`,
      `ws/${b.workspaceId}/logo/../../${a.workspaceId}/${tail}`,
    ]) {
      for (const field of ["logoKey", "coverKey"]) {
        const res = await call(h("restaurants/[restaurantId]", "PATCH"), {
          method: "PATCH",
          params: rest(b),
          cookie: b.owner.cookie,
          body: { [field]: sneaky },
        });
        expect(res.status, `${field} ${sneaky}`).toBe(422);
      }
    }
    const created = await call(h("workspaces/[workspaceId]/restaurants", "POST"), {
      params: ws(b),
      cookie: b.owner.cookie,
      body: { name: "Borrowed Logo", logoKey: fileKey },
    });
    expect(created.status).toBe(422);
    // B's own upload is still accepted as its logo.
    const own = await uploadAs(b.owner.cookie, b.workspaceId, b.restaurantId);
    expect(own.status).toBe(201);
    const ownLogo = await call(h("restaurants/[restaurantId]", "PATCH"), {
      method: "PATCH",
      params: rest(b),
      cookie: b.owner.cookie,
      body: { logoKey: own.body.data!.key },
    });
    expect(ownLogo.status).toBe(200);
    const ownUsage = await call<{ usage: { storageBytes: number } }>(
      h("workspaces/[workspaceId]/entitlements", "GET"),
      { params: ws(b), cookie: b.owner.cookie },
    );
    expect(ownUsage.status).toBe(200);
    expect(JSON.stringify(ownUsage.body.data)).not.toContain(fileKey);

    expect((await fetchFile()).status).toBe(200);
  });
});
