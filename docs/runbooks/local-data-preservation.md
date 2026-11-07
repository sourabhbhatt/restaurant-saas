# Runbook: local data preservation (PGlite)

`.data/pglite` at the repo root is the owner's real data (embedded PostgreSQL 18, PGlite 0.5). `.data/` is git-ignored and never deleted by any script. These rules keep it safe.

## Rules

- **One process at a time.** PGlite cannot be opened by two processes. Stop `pnpm dev` (the API holds the directory) before any `db:*` script.
- **Never migrate without a snapshot.** The API refuses to start when a persistent PGlite directory has pending migrations (`Pending migrations for <dir>: … Run pnpm db:snapshot then pnpm db:migrate.`); only `pnpm db:migrate` migrates it, and it snapshots first.
- **Absolute paths.** Set `PGLITE_DATA_DIR=/absolute/path/to/repo/.data/pglite`. The root scripts run in the repo root while `next dev` for the API runs in `apps/api`; a relative path would point the API at an empty `apps/api/.data/pglite`.
- **Experiments run on copies** under `.data/rehearsal/`, never on `.data/pglite`.
- **Snapshots are never deleted** by scripts. Remove old ones by hand only when you have a newer verified one.

## Take a snapshot

```bash
# pnpm dev stopped
DATABASE_PROVIDER=pglite PGLITE_DATA_DIR=$PWD/.data/pglite pnpm db:snapshot
```

Writes `.data/snapshots/pglite-<YYYYMMDD-HHmmss>/` (a byte copy) and its `manifest.json`: `createdAt`, `sourceDir`, `pgVersion`, `rowCounts` (every table), `files` (SHA-256 per file). The script prints the path and the total row count. `SNAPSHOT_DIR` overrides the snapshots root.

## Apply new migrations

```bash
# pnpm dev stopped
DATABASE_PROVIDER=pglite PGLITE_DATA_DIR=$PWD/.data/pglite pnpm db:snapshot   # restore point you name in your notes
DATABASE_PROVIDER=pglite PGLITE_DATA_DIR=$PWD/.data/pglite pnpm db:migrate
```

`db:migrate` takes its own snapshot as well, detects pending migrations **on the copy**, and only then opens and migrates the original (logs `snapshot_written` with the path, then `migrations_applied`). Nothing is opened when nothing is pending, except the copy.

Rehearse first on a copy when the batch is large (the controller did this for `0002`–`0005`):

```bash
cp -R .data/snapshots/<latest> .data/rehearsal/m1
DATABASE_PROVIDER=pglite PGLITE_DATA_DIR=$PWD/.data/rehearsal/m1 pnpm db:migrate
```

## Verify after migrating

Take a fresh snapshot of the migrated directory and compare its row counts with the pre-migration manifest; every pre-existing table must match (new tables appear with their backfilled counts, for example `organizations` = number of workspaces after `0003`):

```bash
DATABASE_PROVIDER=pglite PGLITE_DATA_DIR=$PWD/.data/pglite pnpm db:snapshot
node -e '
const [a, b] = process.argv.slice(1).map((p) => require(require("path").resolve(p)).rowCounts);
for (const t of Object.keys(a)) if (a[t] !== b[t]) console.log("MISMATCH", t, a[t], b[t]);
console.log("compared", Object.keys(a).length, "tables");
' .data/snapshots/<before>/manifest.json .data/snapshots/<after>/manifest.json
```

Then start `pnpm dev` and run `pnpm smoke --base-url http://localhost:3000`. (`pnpm db:verify` compares against a Postgres target and is used when the data moves to Postgres; see [backup and restore](backup-and-restore.md).)

## Restore from a snapshot

On any failure, stop. Do not delete the failed directory: move it aside, then copy the snapshot back.

```bash
# pnpm dev stopped
mv .data/pglite .data/pglite.failed-$(date +%Y%m%d-%H%M%S)
cp -R .data/snapshots/<snapshot taken before the change> .data/pglite
rm .data/pglite/manifest.json        # the manifest belongs to the snapshot, not to a data directory
```

Start `pnpm dev`, sign in and run `pnpm smoke`. Keep the `.failed-*` directory until the cause is understood.

## Move the data to Postgres

Use the rehearsal in [backup and restore](backup-and-restore.md#local-pglite--postgres-18-rehearsal-from-a-copy): dump (which dumps a fresh copy, never the original), restore into an empty Postgres 18, migrate, verify, smoke. The local directory is never modified by the move.
