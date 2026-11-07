-- Reverts the row-level security part of 0003_organizations. Tables, columns and backfilled data stay (additive migration).
DROP POLICY IF EXISTS tenant_isolation ON "organizations";
DROP POLICY IF EXISTS runtime_access ON "organizations";
ALTER TABLE "organizations" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "organization_members";
DROP POLICY IF EXISTS runtime_access ON "organization_members";
ALTER TABLE "organization_members" DISABLE ROW LEVEL SECURITY;
