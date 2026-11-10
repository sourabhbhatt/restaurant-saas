-- Reverts 0008_payment_order_analytics_opt_in. The column holds only GA4 client ids of
-- buyers who opted in to analytics, and only until their order is paid; nothing else
-- depends on it. Webhook-confirmed payments then send no growth events.
ALTER TABLE "payment_orders" DROP COLUMN IF EXISTS "analytics_client_id";
