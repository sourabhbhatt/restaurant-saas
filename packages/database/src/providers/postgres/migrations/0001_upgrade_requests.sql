CREATE TABLE "upgrade_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" uuid,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upgrade_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" uuid,
	"current_plan_id" uuid,
	"requested_plan_id" uuid NOT NULL,
	"billing_cycle" text DEFAULT 'MONTHLY' NOT NULL,
	"message" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"applied_subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upgrade_requests_status_ck" CHECK ("upgrade_requests"."status" in ('PENDING','APPROVED','REJECTED','CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "upgrade_request_events" ADD CONSTRAINT "upgrade_request_events_request_id_upgrade_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."upgrade_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_request_events" ADD CONSTRAINT "upgrade_request_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_requests" ADD CONSTRAINT "upgrade_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_requests" ADD CONSTRAINT "upgrade_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_requests" ADD CONSTRAINT "upgrade_requests_current_plan_id_subscription_plans_id_fk" FOREIGN KEY ("current_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_requests" ADD CONSTRAINT "upgrade_requests_requested_plan_id_subscription_plans_id_fk" FOREIGN KEY ("requested_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_requests" ADD CONSTRAINT "upgrade_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_requests" ADD CONSTRAINT "upgrade_requests_applied_subscription_id_subscriptions_id_fk" FOREIGN KEY ("applied_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upgrade_request_events_request_idx" ON "upgrade_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "upgrade_requests_one_pending_uq" ON "upgrade_requests" USING btree ("workspace_id") WHERE "upgrade_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "upgrade_requests_status_idx" ON "upgrade_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "upgrade_requests_workspace_idx" ON "upgrade_requests" USING btree ("workspace_id","created_at");