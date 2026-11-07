/**
 * Permission catalog and default role templates.
 *
 * Permissions are the unit of authorization. Code checks permissions, never
 * role names. Roles are just named permission sets; the templates below are
 * seeded into the `roles` / `role_permissions` tables, and workspaces can
 * create custom roles from the same catalog.
 *
 * Scope semantics:
 * - WORKSPACE permissions are granted by the workspace membership role.
 * - RESTAURANT / BRANCH permissions are granted by role assignments that point
 *   at a restaurant (applies to all its branches) or a single branch. A
 *   workspace role may also include restaurant/branch permissions, which then
 *   apply to every restaurant and branch in the workspace (owner/admin).
 */

export const PERMISSION_SCOPES = ["WORKSPACE", "RESTAURANT", "BRANCH"] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const PERMISSIONS = {
  // Workspace
  "workspace.view": { scope: "WORKSPACE", description: "View workspace overview" },
  "workspace.update": { scope: "WORKSPACE", description: "Edit workspace business details" },
  "workspace.members.view": { scope: "WORKSPACE", description: "View workspace members" },
  "workspace.members.manage": {
    scope: "WORKSPACE",
    description: "Invite, remove and change roles of members",
  },
  "workspace.roles.manage": { scope: "WORKSPACE", description: "Create and edit custom roles" },
  "workspace.subscription.view": { scope: "WORKSPACE", description: "View subscription and usage" },
  "workspace.subscription.manage": {
    scope: "WORKSPACE",
    description: "Manage billing settings and plan changes",
  },
  "workspace.analytics.view": { scope: "WORKSPACE", description: "View workspace-wide analytics" },
  "workspace.audit.view": { scope: "WORKSPACE", description: "View workspace audit log" },
  "workspace.support.manage": { scope: "WORKSPACE", description: "Create support requests" },
  "restaurant.create": { scope: "WORKSPACE", description: "Create restaurants" },
  // Restaurant
  "restaurant.view": { scope: "RESTAURANT", description: "View restaurant details" },
  "restaurant.update": { scope: "RESTAURANT", description: "Edit restaurant details and settings" },
  "restaurant.delete": { scope: "RESTAURANT", description: "Archive restaurants" },
  "branch.create": { scope: "RESTAURANT", description: "Create branches" },
  "menu.view": { scope: "RESTAURANT", description: "View menu configuration" },
  "menu.manage": { scope: "RESTAURANT", description: "Create and edit menu, prices, add-ons" },
  "staff.manage": { scope: "RESTAURANT", description: "Assign staff to restaurant and branches" },
  "reports.view": { scope: "RESTAURANT", description: "View restaurant and branch reports" },
  // Branch
  "branch.view": { scope: "BRANCH", description: "View branch" },
  "branch.update": { scope: "BRANCH", description: "Edit branch details and settings" },
  "menu.availability.manage": {
    scope: "BRANCH",
    description: "Toggle item availability and branch pricing",
  },
  "tables.view": { scope: "BRANCH", description: "View tables and sessions" },
  "tables.manage": { scope: "BRANCH", description: "Create/edit tables, generate and revoke QR" },
  "sessions.manage": { scope: "BRANCH", description: "Open and close table sessions" },
  "orders.view": { scope: "BRANCH", description: "View branch orders" },
  "orders.create": { scope: "BRANCH", description: "Add items to a table session as staff" },
  "orders.approve": { scope: "BRANCH", description: "Accept or reject customer orders" },
  "orders.serve": { scope: "BRANCH", description: "Mark orders served" },
  "orders.cancel": { scope: "BRANCH", description: "Cancel accepted orders" },
  "kitchen.view": { scope: "BRANCH", description: "View the kitchen display" },
  "kitchen.update": { scope: "BRANCH", description: "Update preparation status" },
  "bills.view": { scope: "BRANCH", description: "View bills" },
  "bills.generate": { scope: "BRANCH", description: "Generate and preview bills" },
  "bills.discount": { scope: "BRANCH", description: "Apply discounts to bills" },
  "bills.void": { scope: "BRANCH", description: "Void an issued bill" },
  "payments.record": { scope: "BRANCH", description: "Record payments" },
  "payments.refund": { scope: "BRANCH", description: "Record refunds and void payments" },
  "payments.summary.view": { scope: "BRANCH", description: "View cash and payment summaries" },
} as const satisfies Record<string, { scope: PermissionScope; description: string }>;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function permissionScope(permission: Permission): PermissionScope {
  return PERMISSIONS[permission].scope;
}

/** The scope at which a role is assigned. */
export const ROLE_SCOPES = ["WORKSPACE", "RESTAURANT", "BRANCH"] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

export type RoleTemplateKey =
  | "workspace_owner"
  | "workspace_admin"
  | "workspace_member"
  | "restaurant_manager"
  | "waiter"
  | "kitchen_staff"
  | "cashier";

export interface RoleTemplate {
  key: RoleTemplateKey;
  name: string;
  scope: RoleScope;
  description: string;
  permissions: readonly Permission[];
}

const restaurantAndBranchPermissions = ALL_PERMISSIONS.filter(
  (p) => PERMISSIONS[p].scope !== "WORKSPACE",
);

export const ROLE_TEMPLATES: Record<RoleTemplateKey, RoleTemplate> = {
  workspace_owner: {
    key: "workspace_owner",
    name: "Workspace Owner",
    scope: "WORKSPACE",
    description: "Full control of the workspace, restaurants, billing and members.",
    permissions: ALL_PERMISSIONS,
  },
  workspace_admin: {
    key: "workspace_admin",
    name: "Workspace Admin",
    scope: "WORKSPACE",
    description:
      "Manages restaurants, branches, staff, menus and reports. No subscription control.",
    permissions: ALL_PERMISSIONS.filter(
      (p) => p !== "workspace.subscription.manage" && p !== "workspace.roles.manage",
    ),
  },
  workspace_member: {
    key: "workspace_member",
    name: "Member",
    scope: "WORKSPACE",
    description: "Belongs to the workspace; access comes from restaurant/branch assignments.",
    permissions: ["workspace.view"],
  },
  restaurant_manager: {
    key: "restaurant_manager",
    name: "Restaurant Manager",
    scope: "RESTAURANT",
    description:
      "Runs assigned restaurants or branches: menu, tables, staff, orders, bills, reports.",
    permissions: restaurantAndBranchPermissions.filter((p) => p !== "restaurant.delete"),
  },
  waiter: {
    key: "waiter",
    name: "Waiter",
    scope: "BRANCH",
    description: "Approves orders, serves, manages tables and generates bills.",
    permissions: [
      "branch.view",
      "tables.view",
      "sessions.manage",
      "orders.view",
      "orders.create",
      "orders.approve",
      "orders.serve",
      "bills.view",
      "bills.generate",
    ],
  },
  kitchen_staff: {
    key: "kitchen_staff",
    name: "Kitchen Staff",
    scope: "BRANCH",
    description: "Sees accepted orders and updates preparation status.",
    permissions: ["branch.view", "kitchen.view", "kitchen.update"],
  },
  cashier: {
    key: "cashier",
    name: "Cashier",
    scope: "BRANCH",
    description: "Views bills, records payments and closes paid tables.",
    permissions: [
      "branch.view",
      "tables.view",
      "sessions.manage",
      "orders.view",
      "bills.view",
      "bills.generate",
      "bills.discount",
      "payments.record",
      "payments.summary.view",
    ],
  },
};

export const ROLE_TEMPLATE_LIST = Object.values(ROLE_TEMPLATES);

/**
 * Grants a user holds, as resolved on the server from the database. Never
 * built from client input.
 */
export interface AccessGrants {
  /** Permissions from the workspace membership role (apply workspace-wide). */
  workspace: ReadonlySet<Permission>;
  /** Restaurant-scoped grants keyed by restaurantId. */
  restaurants: ReadonlyMap<string, ReadonlySet<Permission>>;
  /** Branch-scoped grants keyed by branchId. */
  branches: ReadonlyMap<string, ReadonlySet<Permission>>;
}

export interface AccessTarget {
  restaurantId?: string;
  branchId?: string;
}

/**
 * Pure permission check. A workspace-role permission applies everywhere in the
 * workspace; a restaurant grant applies to that restaurant and all of its
 * branches; a branch grant applies to that branch only.
 */
export function hasPermission(
  grants: AccessGrants,
  permission: Permission,
  target: AccessTarget = {},
): boolean {
  if (grants.workspace.has(permission)) return true;
  const scope = permissionScope(permission);
  if (scope === "WORKSPACE") return false;
  if (target.restaurantId && grants.restaurants.get(target.restaurantId)?.has(permission)) {
    return true;
  }
  if (
    scope === "BRANCH" &&
    target.branchId &&
    grants.branches.get(target.branchId)?.has(permission)
  ) {
    return true;
  }
  return false;
}

/** Effective permission list at a target, for sending to the UI (display only). */
export function effectivePermissions(
  grants: AccessGrants,
  target: AccessTarget = {},
): Permission[] {
  return ALL_PERMISSIONS.filter((p) => hasPermission(grants, p, target));
}
