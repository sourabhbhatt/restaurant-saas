-- Reverts the row-level security part of 0005_payments. Tables and data stay (additive migration).
DROP POLICY IF EXISTS tenant_isolation ON "payment_orders";
DROP POLICY IF EXISTS runtime_access ON "payment_orders";
ALTER TABLE "payment_orders" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "payment_events";
DROP POLICY IF EXISTS runtime_access ON "payment_events";
ALTER TABLE "payment_events" DISABLE ROW LEVEL SECURITY;
