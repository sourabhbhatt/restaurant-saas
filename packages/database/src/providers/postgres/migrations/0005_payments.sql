CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"organization_id" uuid,
	"type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing_cycle" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"provider_payment_id" text,
	"created_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_status_ck" CHECK ("payment_orders"."status" in ('CREATED', 'PAID', 'FAILED', 'EXPIRED'))
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_event_uq" ON "payment_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "payment_events_organization_idx" ON "payment_events" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_provider_order_uq" ON "payment_orders" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "payment_orders_organization_idx" ON "payment_orders" USING btree ("organization_id","created_at");--> statement-breakpoint
-- rls:begin
-- Everything from here on is hand-written and idempotent. Row-level security has the same shape as
-- the organization tables (0003): a tenant transaction reads the payment rows of its bound workspace's
-- organization and of every organization the bound user belongs to. Writes come only from the system
-- runner (checkout, verify, webhook), so tenant DML is revoked.
ALTER TABLE "payment_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "payment_orders";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment_orders" FOR ALL TO ros_tenant
  USING (
    organization_id = (SELECT organization_id FROM workspaces WHERE id = app_current_workspace())
    OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = app_current_user())
  )
  WITH CHECK (organization_id = (SELECT organization_id FROM workspaces WHERE id = app_current_workspace()));
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "payment_orders";
--> statement-breakpoint
CREATE POLICY runtime_access ON "payment_orders" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "payment_events";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment_events" FOR ALL TO ros_tenant
  USING (
    organization_id = (SELECT organization_id FROM workspaces WHERE id = app_current_workspace())
    OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = app_current_user())
  )
  WITH CHECK (organization_id = (SELECT organization_id FROM workspaces WHERE id = app_current_workspace()));
--> statement-breakpoint
DROP POLICY IF EXISTS runtime_access ON "payment_events";
--> statement-breakpoint
CREATE POLICY runtime_access ON "payment_events" FOR ALL TO ros_runtime USING (true) WITH CHECK (true);
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON payment_orders, payment_events FROM ros_tenant;
