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
