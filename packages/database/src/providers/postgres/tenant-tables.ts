/**
 * Every table with a `workspace_id` column. Each one has row-level security
 * enabled with the `tenant_isolation` and `runtime_access` policies (migration
 * 0002_tenant_rls). tests/integration/security-rls.test.ts compares this list
 * to the live schema, so a new tenant table fails the suite until it is added
 * here and given policies in a migration.
 */
export const TENANT_TABLES = [
  "addon_groups",
  "addons",
  "audit_logs",
  "bill_items",
  "bills",
  "branch_settings",
  "branches",
  "dining_tables",
  "invitations",
  "menu_categories",
  "menu_item_branch_overrides",
  "menu_items",
  "menu_variants",
  "menus",
  "notifications",
  "order_item_addons",
  "order_items",
  "order_status_history",
  "orders",
  "payment_history",
  "payments",
  "restaurant_settings",
  "restaurants",
  "role_assignments",
  "roles",
  "stored_files",
  "subscription_events",
  "subscriptions",
  "support_requests",
  "table_qr_tokens",
  "table_session_members",
  "table_sessions",
  "upgrade_requests",
  "workspace_entitlements",
  "workspace_memberships",
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

/**
 * Billing-owner tables without a `workspace_id`. Row-level security scopes
 * them to the organization of the bound workspace, or to the bound user's
 * memberships (migration 0003_organizations). Tenants read them only; every
 * write goes through the system runner.
 */
export const ORGANIZATION_TABLES = ["organizations", "organization_members"] as const;

export type OrganizationTable = (typeof ORGANIZATION_TABLES)[number];

/**
 * Payment tables (migration 0005_payments): organization-scoped like the
 * tables above, read-only for tenants; the payments module writes them
 * through the system runner.
 */
export const PAYMENT_TABLES = ["payment_orders", "payment_events"] as const;

export type PaymentTable = (typeof PAYMENT_TABLES)[number];

/**
 * The tenant root and the child tables without a `workspace_id` of their own
 * (migration 0006_workspace_and_user_rls). `workspaces` is scoped by its id
 * (readable for every workspace the bound user is an active member of,
 * writable for the bound one only; tenant INSERT/DELETE is revoked). The
 * others are scoped through their parent row: branches, roles,
 * support_requests and upgrade_requests.
 */
export const WORKSPACE_SCOPED_TABLES = [
  "workspaces",
  "branch_counters",
  "role_permissions",
  "support_request_notes",
  "upgrade_request_events",
] as const;

export type WorkspaceScopedTable = (typeof WORKSPACE_SCOPED_TABLES)[number];

/**
 * Per-user tables (migration 0006_workspace_and_user_rls): a tenant
 * transaction reads and writes only the bound user's own rows.
 * `notification_preferences` is also readable for members of the bound
 * workspace, so the in-app fan-out can honour their opt-outs.
 */
export const USER_TABLES = [
  "user_profiles",
  "notification_preferences",
  "push_subscriptions",
] as const;

export type UserTable = (typeof USER_TABLES)[number];
