# Runbook: disable row-level security (emergency)

Use only when row-level security blocks legitimate work in production (for example a tenant query fails with `permission denied` or returns no rows after a release) and a code fix is not minutes away. Tenant isolation does not disappear: every handler still resolves a server-side scope and filters by `workspace_id` (see [tenant security](../tenant-security.md)). What you lose is the second, database-level layer. Record who did it and when, and turn it back on as soon as the fix ships.

## Symptoms that point at RLS

- API logs `TENANT_CONTEXT_MISSING` or `TENANT_CONTEXT_CONFLICT` (a tenant query ran without, or with two, bound workspaces), or Postgres `permission denied for table …` / `new row violates row-level security policy`.
- A page shows empty lists for data that exists, for one module only.

## Level 1: stop the role switch (no database change)

Set on the **API** only and redeploy or restart it:

```bash
DATABASE_TENANT_ROLE=none
```

Effect: the tenant runner no longer runs `SET LOCAL ROLE ros_tenant`; tenant transactions run as the connection user. As `ros_runtime` that user matches the `runtime_access … USING (true)` policies; as the owner it bypasses RLS (policies are enabled, not forced). The request context is still required, so `TENANT_CONTEXT_MISSING` still fails closed. The API logs `tenant_role_disabled` at startup, so the state is visible.

- Cloud Run: `gcloud run services update ros-api --region asia-south1 --update-env-vars DATABASE_TENANT_ROLE=none`
- Compose: change `DATABASE_TENANT_ROLE` in `infra/compose/docker-compose.yml` (service `api`) to `none`, then `docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env.compose up -d --no-deps api`
- Local: add `DATABASE_TENANT_ROLE=none` to `.env.local` and restart `pnpm dev`

Undo: remove the variable (the default is `ros_tenant`) and restart. Check that `tenant_role_disabled` no longer appears in the startup log.

Level 1 is enough in almost every case: it is instant, reversible and touches no data.

## Level 2: remove the policies (database change)

Only if Level 1 does not help (for example a grant problem in a system path). Take a backup first ([backup and restore](backup-and-restore.md)), then run the down scripts **as the database owner**, newest first:

```bash
OWNER_URL="postgres://<owner>:<pw>@<host>:5432/<db>"
D=packages/database/src/providers/postgres/migrations-down
for f in 0005_payments 0003_organizations 0002_tenant_rls; do
  psql "$OWNER_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$D/$f.down.sql" || break
done
```

(With no local `psql` 18: `docker exec -i <postgres:18 container> psql "$OWNER_URL" -v ON_ERROR_STOP=1 --single-transaction < "$D/$f.down.sql"`.)

Effect: every `tenant_isolation`, `tenant_own_rows`, `tenant_system_roles` and `runtime_access` policy is dropped and RLS is disabled on every tenant table; `0002`'s down script also gives `ros_tenant` back full DML on `users`, `permissions`, `subscription_plans`, `platform_settings` and `announcements`, and drops `app_current_workspace()` / `app_current_user()`. The roles `ros_tenant` / `ros_runtime` and their memberships stay (harmless). No table, column or row is touched. Keep `DATABASE_TENANT_ROLE=none` on the API as well while the policies are off.

Check: `psql "$OWNER_URL" -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity"` returns 0.

### Re-enable after Level 2

The migration journal still lists `0002`, `0003` and `0005` as applied, so `db:migrate` will not re-run them. Re-apply their RLS parts by hand, as the owner. `0002` is idempotent as a whole; for `0003` and `0005` only the RLS sections are (their table and backfill parts must not run again):

```bash
M=packages/database/src/providers/postgres/migrations
psql "$OWNER_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$M/0002_tenant_rls.sql"
sed -n '/^-- Row-level security (same shape as 0002_tenant_rls)/,$p' "$M/0003_organizations.sql" \
  | psql "$OWNER_URL" -v ON_ERROR_STOP=1 --single-transaction
sed -n '/^-- rls:begin/,$p' "$M/0005_payments.sql" \
  | psql "$OWNER_URL" -v ON_ERROR_STOP=1 --single-transaction
```

Then remove `DATABASE_TENANT_ROLE=none` from the API and restart it. Verify: the `relrowsecurity` count above equals the number of tenant tables plus the four organization and payment tables, and `pnpm smoke --base-url <console URL>` passes.

## Afterwards

Fix the cause in code (usually a repository call that runs outside a request context, or a new table without policies; `security-rls.test.ts` catches the latter), add a test, release, and turn RLS back on. Note the incident window: tenant queries ran without the database-level check during it.
