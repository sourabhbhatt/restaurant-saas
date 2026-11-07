CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_role_ck" CHECK ("organization_members"."role" in ('OWNER', 'BILLING_ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"max_workspaces_override" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_status_ck" CHECK ("organizations"."status" in ('ACTIVE', 'SUSPENDED'))
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_uq" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspaces_organization_idx" ON "workspaces" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_current_org_uq" ON "subscriptions" USING btree ("organization_id") WHERE "subscriptions"."is_current" and "subscriptions"."organization_id" is not null;--> statement-breakpoint
-- backfill:begin
-- Everything from here on is hand-written and idempotent (spec section 9.2: expand, backfill).
-- One organization per existing workspace, reusing the workspace's uuid as the organization's.
INSERT INTO organizations (id, name, created_by, created_at, updated_at)
SELECT id, name, created_by, created_at, now() FROM workspaces
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- The organization owner is the workspace creator, else its earliest workspace_owner member.
INSERT INTO organization_members (organization_id, user_id, role)
SELECT w.id,
       coalesce(w.created_by,
                (SELECT m.user_id FROM workspace_memberships m
                   JOIN roles r ON r.id = m.role_id
                  WHERE m.workspace_id = w.id AND r.key = 'workspace_owner'
                  ORDER BY m.created_at, m.id LIMIT 1)),
       'OWNER'
  FROM workspaces w
 WHERE coalesce(w.created_by,
                (SELECT m.user_id FROM workspace_memberships m
                   JOIN roles r ON r.id = m.role_id
                  WHERE m.workspace_id = w.id AND r.key = 'workspace_owner'
                  ORDER BY m.created_at, m.id LIMIT 1)) IS NOT NULL
ON CONFLICT (organization_id, user_id) DO NOTHING;
--> statement-breakpoint
UPDATE workspaces SET organization_id = id WHERE organization_id IS NULL;
--> statement-breakpoint
UPDATE subscriptions SET organization_id = workspace_id WHERE organization_id IS NULL;
--> statement-breakpoint
-- Row-level security (same shape as 0002_tenant_rls). A tenant transaction sees the organization
-- of its bound workspace and every organization the bound user belongs to; writes are confined to
-- the bound workspace's organization and, by grant, never come from tenant transactions at all.
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "organizations";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "organizations" FOR ALL TO ros_tenant
  USING (
    id = (SELECT organization_id FROM workspaces WHERE id = app_current_workspace())
    OR id IN (SELECT organization_id FROM organization_members WHERE user_id = app_current_user())
  )
  WITH CHECK (id = (SELECT organization_id FROM workspaces WHERE id = app_current_workspace()));
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "organizations";
--> statement-breakpoint
CREATE POLICY runtime_access ON "organizations" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "organization_members";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "organization_members" FOR ALL TO ros_tenant
  USING (
    organization_id = (SELECT organization_id FROM workspaces WHERE id = app_current_workspace())
    OR user_id = app_current_user()
  )
  WITH CHECK (organization_id = (SELECT organization_id FROM workspaces WHERE id = app_current_workspace()));
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "organization_members";
--> statement-breakpoint
CREATE POLICY runtime_access ON "organization_members" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Billing fields (plan limits, overrides, ownership) change only through the system runner
-- (Super Admin and sign-up); the default privileges from 0002 would otherwise grant tenant DML.
REVOKE INSERT, UPDATE, DELETE ON organizations, organization_members FROM ros_tenant;
