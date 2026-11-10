# Runbook: rollback

Each app is its own image and its own deploy, so roll back only what broke. Migrations are additive (no dropped column, table or constraint), so the previous release always runs on the newer schema.

| Failure                                   | Action                                                                                                       | Typical time |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| Bad release of one app                    | Route traffic back to that app's previous revision / image                                                   | < 1 min      |
| Bad additive migration                    | Redeploy the previous API revision; old code ignores new columns. Fix forward with a new migration           | < 5 min      |
| Row-level security blocks legitimate work | [Disable RLS (emergency)](disable-rls-emergency.md)                                                          | < 5 min      |
| Bad data change or contract migration     | Restore to a new database (point-in-time clone or last dump), switch `DATABASE_URL`, redeploy the API        | 15–30 min    |
| Hosting provider unavailable              | Restore the latest logical dump on another Postgres 18 (for example the compose stack on a VPS), repoint DNS | 1–3 h        |

## Application release

**Cloud Run** (per service: `ros-api`, `ros-console`, `ros-ops`, `ros-admin`):

```bash
gcloud run revisions list --service <service> --region asia-south1
gcloud run services update-traffic <service> --region asia-south1 --to-revisions=<previous revision>=100
```

**Compose** (the compose file builds every service from the checked-out source; it has no `image:` tags):

```bash
git checkout <previous release commit>
docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env.compose up -d --build --no-deps <api|console|ops|admin>
```

**Local:** `git checkout <previous commit>` and restart `pnpm dev`.

After any rollback: `curl -fsS <API URL>/api/v1/health/ready` (200 means the database answers and every migration the running code knows is applied) and `pnpm smoke --base-url <console URL>`.

## Migration

A released migration is never edited or reverted in place. If a new migration misbehaves:

1. Roll the API back to the previous revision (above); the extra columns or tables are ignored.
2. Write a new forward migration that corrects it, and release it.

Down scripts live in `packages/database/src/providers/postgres/migrations-down/`. The RLS ones (`0002_tenant_rls`, and the RLS parts of `0003_organizations` and `0005_payments`) remove policies only, never data; use them through [disable RLS](disable-rls-emergency.md). The index migrations `0009_perf_indexes` and `0010_kitchen_recent_indexes` only drop their indexes (no data change; queries keep working, slower). The others are listed with their conditions in [database schema → Migrations](../database-schema.md#migrations).

## Data

Never restore over the live database. Restore into a **new** database, verify, then switch:

- **Cloud SQL point-in-time:** clone the instance to a timestamp just before the bad change:

  ```bash
  gcloud sql instances clone <instance> <instance>-pitr --point-in-time '<RFC 3339 timestamp>'
  ```

  Verify with `pnpm db:verify` against a dump manifest or with spot checks and `pnpm smoke`, then point the API's `DATABASE_URL` secret at the clone and redeploy the API.

- **Logical dump:** follow [backup and restore](backup-and-restore.md) into an empty database, then switch `DATABASE_URL`.

Keep the broken database until the incident is closed; it is evidence and a second copy.

## Local PGlite

The snapshot taken before every migration is the restore point (see [local data preservation](local-data-preservation.md#restore-from-a-snapshot)).
