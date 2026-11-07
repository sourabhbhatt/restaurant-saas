# Runbook: backup and restore

Applies to any PostgreSQL 18 (local Docker, the compose stack, Cloud SQL, any managed host) and to the local PGlite directory. All commands run from the repo root.

The root `db:*` scripts load `.env.local` with `tsx --env-file=.env.local`, so that file must exist (it may be empty). Variables set on the command line win over the file, which is how the commands below pick the database.

## What a backup is

| Source         | Command                                                                            | Output                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Postgres       | `DATABASE_URL=<owner URL> pnpm db:dump --out <file>.dump`                          | `pg_dump --format=custom --no-owner` (grants and RLS policies included) + `<file>.dump.manifest.json`                    |
| PGlite (local) | `DATABASE_PROVIDER=pglite PGLITE_DATA_DIR=<abs dir> pnpm db:dump --out <file>.sql` | snapshots the directory first, then dumps **the copy** as plain SQL + manifest                                           |
| PGlite (local) | `pnpm db:snapshot`                                                                 | byte copy in `<data dir parent>/snapshots/pglite-<YYYYMMDD-HHmmss>/` with `manifest.json` (row counts, per-file SHA-256) |
| Uploads        | bucket versioning (`s3`), or copy `STORAGE_LOCAL_DIR` (`local`)                    | —                                                                                                                        |

The manifest holds per-table row counts taken just before the dump; `db:verify` compares a restored database with it.

`pg_dump` must be the server's major version (18). Without a local client, set `PG_DOCKER_CONTAINER=<a running postgres:18 container>` and the scripts run `pg_dump` / `pg_restore` / `psql` inside it.

## Nightly backup (Postgres)

```bash
DATABASE_URL="postgres://<owner>:<pw>@<host>:5432/<db>?sslmode=require" \
  pnpm db:dump --out backups/ros-$(date +%F).dump
```

Keep `backups/ros-<date>.dump` **and** its `.manifest.json` together, in a separate account or bucket, for 30 days. On Cloud SQL also keep automated backups and point-in-time recovery on (see [rollback](rollback.md) for using them).

## Restore into an empty database

1. Create an empty database (any name), owned by the user that will run migrations:

   ```bash
   docker exec ros-pg createdb -U postgres ros_restore        # local example
   ```

2. Restore. The script refuses a database that already has tables in `public` or a `drizzle` schema (exit 2), so it never overwrites. It runs in a single transaction: on any error the target stays empty.

   ```bash
   pnpm db:restore --in backups/ros-2026-11-07.dump \
     --target-url postgres://postgres:dev@localhost:55432/ros_restore
   ```

   A `.sql` file is replayed with `psql -v ON_ERROR_STOP=1`; anything else with `pg_restore --no-owner --exit-on-error`. Exit 3 means the tenant roles are missing and this user cannot create them, or they exist and this user lacks the ADMIN option to grant their memberships; see [restoring as a different user](../deployment.md#restoring-as-a-different-user).

3. Apply any migrations newer than the dump and sync system data:

   ```bash
   DATABASE_PROVIDER=postgres DATABASE_URL=postgres://postgres:dev@localhost:55432/ros_restore pnpm db:migrate
   ```

4. Verify row counts against the manifest (only tables named in it are compared; exit 1 prints the differences):

   ```bash
   pnpm db:verify --manifest backups/ros-2026-11-07.dump.manifest.json \
     --target-url postgres://postgres:dev@localhost:55432/ros_restore
   ```

5. Give `ros_runtime` a login if this is a new cluster, point the API at it and run the smoke flow:

   ```sql
   ALTER ROLE ros_runtime LOGIN PASSWORD '<runtime password>';
   GRANT CONNECT ON DATABASE ros_restore TO ros_runtime;
   ```

   ```bash
   pnpm smoke --base-url http://localhost:3000
   ```

6. Switch production over only after steps 4 and 5 pass: update the API's `DATABASE_URL` secret and redeploy the API.

## Local PGlite → Postgres 18 (rehearsal, from a copy)

The Task 25 rehearsal, with copies only:

```bash
cp -R .data/snapshots/<latest> .data/rehearsal/r1
DATABASE_PROVIDER=pglite PGLITE_DATA_DIR=$PWD/.data/rehearsal/r1 pnpm db:dump --out .data/rehearsal/r1.sql
docker exec ros-pg createdb -U postgres ros_rehearsal
pnpm db:restore --in .data/rehearsal/r1.sql --target-url postgres://postgres:dev@localhost:55432/ros_rehearsal
DATABASE_PROVIDER=postgres DATABASE_URL=postgres://postgres:dev@localhost:55432/ros_rehearsal pnpm db:migrate
pnpm db:verify --manifest .data/rehearsal/r1.sql.manifest.json --target-url postgres://postgres:dev@localhost:55432/ros_rehearsal
# start the API against ros_rehearsal, then:
pnpm smoke --base-url http://localhost:3000
```

Expected: identical counts for every pre-existing table, smoke PASS. If the restore fails on a PGlite-specific statement, fix the dump step; never edit the source data.

## Monthly drill

Restore the latest nightly dump into a temporary database with the steps above, run `db:verify` and `smoke`, record the result, then drop the temporary database (on a billed instance, ask for approval before creating it).
