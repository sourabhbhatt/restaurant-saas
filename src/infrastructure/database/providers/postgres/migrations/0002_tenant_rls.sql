-- Row-level security for every table with workspace_id (spec section 6).
-- ENABLE without FORCE: the owner (migrations, system runner) bypasses the policies.
-- Every statement is idempotent so the migration can be re-run safely.
CREATE OR REPLACE FUNCTION app_current_workspace() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ros_tenant') THEN
    CREATE ROLE ros_tenant NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ros_runtime') THEN
    CREATE ROLE ros_runtime NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT ros_tenant TO ros_runtime;
--> statement-breakpoint
GRANT ros_tenant TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ros_tenant, ros_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ros_tenant, ros_runtime;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ros_tenant, ros_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ros_tenant, ros_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ros_tenant, ros_runtime;
--> statement-breakpoint
-- Credentials and request plumbing are never visible to tenant transactions.
REVOKE ALL ON sessions, auth_tokens, rate_limit_buckets, idempotency_records, email_outbox FROM ros_tenant;
--> statement-breakpoint
ALTER TABLE "addon_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "addon_groups";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "addon_groups" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "addon_groups";
--> statement-breakpoint
CREATE POLICY runtime_access ON "addon_groups" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "addons" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "addons";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "addons" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "addons";
--> statement-breakpoint
CREATE POLICY runtime_access ON "addons" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "audit_logs";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_logs" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "audit_logs";
--> statement-breakpoint
CREATE POLICY runtime_access ON "audit_logs" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "bill_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "bill_items";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bill_items" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "bill_items";
--> statement-breakpoint
CREATE POLICY runtime_access ON "bill_items" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "bills";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bills" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "bills";
--> statement-breakpoint
CREATE POLICY runtime_access ON "bills" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "branch_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "branch_settings";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "branch_settings" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "branch_settings";
--> statement-breakpoint
CREATE POLICY runtime_access ON "branch_settings" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "branches";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "branches" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "branches";
--> statement-breakpoint
CREATE POLICY runtime_access ON "branches" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "dining_tables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "dining_tables";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "dining_tables" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "dining_tables";
--> statement-breakpoint
CREATE POLICY runtime_access ON "dining_tables" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "invitations";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invitations" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "invitations";
--> statement-breakpoint
CREATE POLICY runtime_access ON "invitations" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "menu_categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "menu_categories";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "menu_categories" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "menu_categories";
--> statement-breakpoint
CREATE POLICY runtime_access ON "menu_categories" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "menu_item_branch_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "menu_item_branch_overrides";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "menu_item_branch_overrides" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "menu_item_branch_overrides";
--> statement-breakpoint
CREATE POLICY runtime_access ON "menu_item_branch_overrides" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "menu_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "menu_items";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "menu_items" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "menu_items";
--> statement-breakpoint
CREATE POLICY runtime_access ON "menu_items" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "menu_variants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "menu_variants";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "menu_variants" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "menu_variants";
--> statement-breakpoint
CREATE POLICY runtime_access ON "menu_variants" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "menus" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "menus";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "menus" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "menus";
--> statement-breakpoint
CREATE POLICY runtime_access ON "menus" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "notifications";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notifications" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace() OR user_id = app_current_user())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "notifications";
--> statement-breakpoint
CREATE POLICY runtime_access ON "notifications" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "order_item_addons" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "order_item_addons";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "order_item_addons" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "order_item_addons";
--> statement-breakpoint
CREATE POLICY runtime_access ON "order_item_addons" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "order_items";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "order_items" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "order_items";
--> statement-breakpoint
CREATE POLICY runtime_access ON "order_items" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "order_status_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "order_status_history";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "order_status_history" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "order_status_history";
--> statement-breakpoint
CREATE POLICY runtime_access ON "order_status_history" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "orders";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "orders" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "orders";
--> statement-breakpoint
CREATE POLICY runtime_access ON "orders" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "payment_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "payment_history";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment_history" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "payment_history";
--> statement-breakpoint
CREATE POLICY runtime_access ON "payment_history" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "payments";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payments" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "payments";
--> statement-breakpoint
CREATE POLICY runtime_access ON "payments" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "restaurant_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "restaurant_settings";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "restaurant_settings" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "restaurant_settings";
--> statement-breakpoint
CREATE POLICY runtime_access ON "restaurant_settings" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "restaurants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "restaurants";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "restaurants" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "restaurants";
--> statement-breakpoint
CREATE POLICY runtime_access ON "restaurants" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "role_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "role_assignments";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "role_assignments" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "role_assignments";
--> statement-breakpoint
CREATE POLICY runtime_access ON "role_assignments" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "roles";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "roles" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "roles";
--> statement-breakpoint
CREATE POLICY runtime_access ON "roles" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
-- System roles (workspace_id IS NULL) are readable, never writable, in tenant mode.
DROP POLICY IF EXISTS tenant_system_roles ON "roles";
--> statement-breakpoint
CREATE POLICY tenant_system_roles ON "roles" FOR SELECT TO ros_tenant USING (workspace_id IS NULL);
--> statement-breakpoint
ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "stored_files";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stored_files" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "stored_files";
--> statement-breakpoint
CREATE POLICY runtime_access ON "stored_files" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "subscription_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "subscription_events";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "subscription_events" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "subscription_events";
--> statement-breakpoint
CREATE POLICY runtime_access ON "subscription_events" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "subscriptions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "subscriptions" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "subscriptions";
--> statement-breakpoint
CREATE POLICY runtime_access ON "subscriptions" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "support_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "support_requests";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "support_requests" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "support_requests";
--> statement-breakpoint
CREATE POLICY runtime_access ON "support_requests" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "table_qr_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "table_qr_tokens";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "table_qr_tokens" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "table_qr_tokens";
--> statement-breakpoint
CREATE POLICY runtime_access ON "table_qr_tokens" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "table_session_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "table_session_members";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "table_session_members" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "table_session_members";
--> statement-breakpoint
CREATE POLICY runtime_access ON "table_session_members" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "table_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "table_sessions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "table_sessions" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "table_sessions";
--> statement-breakpoint
CREATE POLICY runtime_access ON "table_sessions" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "upgrade_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "upgrade_requests";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "upgrade_requests" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "upgrade_requests";
--> statement-breakpoint
CREATE POLICY runtime_access ON "upgrade_requests" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "workspace_entitlements";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workspace_entitlements" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "workspace_entitlements";
--> statement-breakpoint
CREATE POLICY runtime_access ON "workspace_entitlements" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "workspace_memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "workspace_memberships";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workspace_memberships" FOR ALL TO ros_tenant
  USING (workspace_id = app_current_workspace() OR user_id = app_current_user())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "workspace_memberships";
--> statement-breakpoint
CREATE POLICY runtime_access ON "workspace_memberships" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
