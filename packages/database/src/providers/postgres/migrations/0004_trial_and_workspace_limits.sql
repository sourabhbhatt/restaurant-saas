ALTER TABLE "subscription_plans" ADD COLUMN "max_workspaces" integer DEFAULT 1;--> statement-breakpoint
-- data:begin
-- Hand-written and idempotent (spec sections 7.2 and 7.3). Pro allows 3 workspaces on annual billing;
-- Enterprise is unlimited within fair use; every other plan keeps the column default of 1.
UPDATE subscription_plans SET max_workspaces = 3 WHERE key = 'pro';
--> statement-breakpoint
UPDATE subscription_plans SET max_workspaces = NULL WHERE key = 'enterprise';
--> statement-breakpoint
-- 15-day trials: only rows still at the old defaults change; a Super Admin edit is kept.
UPDATE platform_settings SET value = '15'::jsonb WHERE key = 'trialDays' AND value = '30'::jsonb;
--> statement-breakpoint
UPDATE platform_settings SET value = '[7,12,14]'::jsonb WHERE key = 'trialReminderDays' AND value = '[7,15,25]'::jsonb;
