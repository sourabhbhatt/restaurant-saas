-- Row-level security for the tenant root (workspaces), the child tables without a workspace_id of
-- their own, and the per-user tables. Closes the gap 0002 left: ros_tenant held full DML on these
-- tables with no policy, so a transaction bound to workspace A could rename or soft-delete
-- workspace B, reset B's order counter, extend B's roles, read Super Admin's internal support notes
-- and read every user's phone number and push keys.
-- Same conventions as 0002: ENABLE without FORCE (the owner and the system runner bypass the
-- policies), per-role policies, runtime_access USING (true) for ros_runtime, every statement
-- idempotent. Policies on ros_tenant are permissive, so a SELECT-only policy widens reads without
-- widening writes.
-- rls:begin
-- workspaces: the bound workspace is readable and updatable; every workspace the bound user is an
-- active member of is readable too (workspace switcher, access-service listing). Creation happens
-- through the system runner (bootstrap) and deletion is a Super Admin action, so tenant INSERT and
-- DELETE are revoked outright.
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "workspaces";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workspaces" FOR ALL TO ros_tenant
  USING (id = app_current_workspace())
  WITH CHECK (id = app_current_workspace());
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_own_rows ON "workspaces";
--> statement-breakpoint
CREATE POLICY tenant_own_rows ON "workspaces" FOR SELECT TO ros_tenant
  USING (id IN (
    SELECT workspace_id FROM workspace_memberships
    WHERE user_id = app_current_user() AND status = 'ACTIVE'
  ));
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "workspaces";
--> statement-breakpoint
CREATE POLICY runtime_access ON "workspaces" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
REVOKE INSERT, DELETE ON workspaces FROM ros_tenant;
--> statement-breakpoint
-- branch_counters: scoped through the owning branch.
ALTER TABLE "branch_counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "branch_counters";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "branch_counters" FOR ALL TO ros_tenant
  USING (EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = branch_counters.branch_id AND b.workspace_id = app_current_workspace()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM branches b
    WHERE b.id = branch_counters.branch_id AND b.workspace_id = app_current_workspace()
  ));
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "branch_counters";
--> statement-breakpoint
CREATE POLICY runtime_access ON "branch_counters" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
-- role_permissions: the bound workspace's own roles are readable and writable; system roles
-- (roles.workspace_id IS NULL) are readable, never writable, as on roles itself.
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "role_permissions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "role_permissions" FOR ALL TO ros_tenant
  USING (EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = role_permissions.role_id AND r.workspace_id = app_current_workspace()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = role_permissions.role_id AND r.workspace_id = app_current_workspace()
  ));
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_system_roles ON "role_permissions";
--> statement-breakpoint
CREATE POLICY tenant_system_roles ON "role_permissions" FOR SELECT TO ros_tenant
  USING (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.workspace_id IS NULL
  ));
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "role_permissions";
--> statement-breakpoint
CREATE POLICY runtime_access ON "role_permissions" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
-- support_request_notes: scoped through the request; internal (Super Admin) notes are never
-- visible to, nor writable by, a tenant transaction.
ALTER TABLE "support_request_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "support_request_notes";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "support_request_notes" FOR ALL TO ros_tenant
  USING (
    NOT is_internal AND EXISTS (
      SELECT 1 FROM support_requests s
      WHERE s.id = support_request_notes.request_id AND s.workspace_id = app_current_workspace()
    )
  )
  WITH CHECK (
    NOT is_internal AND EXISTS (
      SELECT 1 FROM support_requests s
      WHERE s.id = support_request_notes.request_id AND s.workspace_id = app_current_workspace()
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "support_request_notes";
--> statement-breakpoint
CREATE POLICY runtime_access ON "support_request_notes" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
-- upgrade_request_events: scoped through the request.
ALTER TABLE "upgrade_request_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "upgrade_request_events";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "upgrade_request_events" FOR ALL TO ros_tenant
  USING (EXISTS (
    SELECT 1 FROM upgrade_requests u
    WHERE u.id = upgrade_request_events.request_id AND u.workspace_id = app_current_workspace()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM upgrade_requests u
    WHERE u.id = upgrade_request_events.request_id AND u.workspace_id = app_current_workspace()
  ));
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "upgrade_request_events";
--> statement-breakpoint
CREATE POLICY runtime_access ON "upgrade_request_events" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Per-user tables: the bound user's own rows only.
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "user_profiles";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "user_profiles" FOR ALL TO ros_tenant
  USING (user_id = app_current_user())
  WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "user_profiles";
--> statement-breakpoint
CREATE POLICY runtime_access ON "user_profiles" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "push_subscriptions";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "push_subscriptions" FOR ALL TO ros_tenant
  USING (user_id = app_current_user())
  WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "push_subscriptions";
--> statement-breakpoint
CREATE POLICY runtime_access ON "push_subscriptions" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
-- notification_preferences: own rows readable and writable. The in-app fan-out (notifyUsers, run
-- inside tenant transactions by the ordering and staff modules) reads the opt-outs of the other
-- members of the bound workspace, so those rows are readable too, never writable.
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "notification_preferences";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification_preferences" FOR ALL TO ros_tenant
  USING (user_id = app_current_user())
  WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_workspace_members ON "notification_preferences";
--> statement-breakpoint
CREATE POLICY tenant_workspace_members ON "notification_preferences" FOR SELECT TO ros_tenant
  USING (user_id IN (
    SELECT user_id FROM workspace_memberships WHERE workspace_id = app_current_workspace()
  ));
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "notification_preferences";
--> statement-breakpoint
CREATE POLICY runtime_access ON "notification_preferences" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
