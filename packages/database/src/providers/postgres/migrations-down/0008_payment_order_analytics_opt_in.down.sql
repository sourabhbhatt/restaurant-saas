-- Reverts 0008_payment_order_analytics_opt_in. Run it only after rolling the API back to a
-- version before be4daad (one that does not know analytics_client_id): with current code every
-- payment_orders query and the checkout INSERT name the column and fail once it is gone.
-- The column holds only GA4 client ids of buyers who opted in to analytics, for at most 48 hours.
ALTER TABLE "payment_orders" DROP COLUMN IF EXISTS "analytics_client_id";
