-- Growth analytics (docs/growth/analytics-events.md): the buyer's GA4 client id,
-- recorded at checkout only when they had opted in to analytics, so the payment
-- events a webhook confirms respect that choice. Nullable and additive; cleared
-- when the order is paid.
ALTER TABLE "payment_orders" ADD COLUMN "analytics_client_id" text;
