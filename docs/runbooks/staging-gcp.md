# Staging on Google Cloud: start, stop, check

Staging lives in project `restaurant-os-514008` (`asia-south1`, Mumbai) and is for personal testing. Everything is set up so that the only meaningful cost is the Cloud SQL instance while it runs. Local development (`pnpm dev`, PGlite under `.data/`) never touches GCP.

## Commands

Run from the repo root (needs `gcloud` signed in to the project).

| Command                               | What it does                                                                              | Time     |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| `infra/gcp/staging.sh start [hours]`  | Starts Cloud SQL and sets a testing window (default 4 h, max 24)                          | 1–5 min  |
| `infra/gcp/staging.sh extend [hours]` | Moves the window end to now + hours (default 2)                                           | seconds  |
| `infra/gcp/staging.sh stop`           | Stops Cloud SQL now                                                                       | ~1 min   |
| `infra/gcp/staging.sh status`         | Database state and window, last backups, Cloud Run services, guard, cost rates, budgets   | seconds  |
| `TAG=<sha> infra/gcp/deploy.sh`       | Deploys staging (refuses while the database is stopped). `APPS="console"` deploys one app | 5–10 min |

Typical session:

```bash
infra/gcp/staging.sh start 2      # test for two hours
# … use the staging URLs …
infra/gcp/staging.sh stop         # or let the guard stop it after the window
```

## What keeps costs down

- **Cloud SQL is stopped when not testing.** `stop` sets the activation policy to `NEVER`. Data, users, automated backups, point-in-time-recovery settings, flags and the connection name are all kept; `start` brings back the same database. Verified on 2026-11-08: a fingerprint of the schema, migrations, plans, settings and RLS policies was identical before and after stop/start.
- **The guard** (`ros-sql-guard`) runs every hour at :17 (Cloud Scheduler → Cloud Run job). If the instance is running outside a testing window — the window passed, none was set, or Google started a stopped instance on its own (maintenance or any automatic restart) — it stops it. Worst case an unexpected start costs about one hour of running time. It uses a service account with a custom role of exactly two permissions (`cloudsql.instances.get`, `cloudsql.instances.update`). Verified on 2026-11-08: inside a window it left the instance running; with the window expired, a Scheduler-triggered run stopped it.
- **Cloud Run scales to zero.** All four services and the jobs run `min-instances=0`, with `max-instances` 2 (frontends) and 3 (API). They cost nothing between requests.
- **Budgets with email alerts** (to the billing account's admins):
  - `restaurant-os staging monthly`: ₹1,500 per month, alerts at 50%, 90%, 100% and on forecast. A normal personal-testing month stays under it; crossing it means the database ran far longer than planned.
  - `restaurant-os trial guardrail`: ₹12,600 per month, alerts at 25/50/75/100% and on forecast.

The window is stored as the instance label `staging-until` (Unix time; `0` = no window). gcloud has no label flag for Cloud SQL, so the script sets it through the Cloud SQL Admin API.

## Costs (Mumbai list prices from the Cloud Billing catalog, 2026-11-08, INR)

| Item                                                      | Running                                                                       | Stopped                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| Cloud SQL `db-g1-small`                                   | ₹4.00 / hour                                                                  | ₹0                                       |
| Reserved public IPv4                                      | ₹0                                                                            | ₹1.14 / hour (billed only while stopped) |
| 10 GB SSD storage                                         | ₹194 / month                                                                  | ₹194 / month                             |
| Backups (7 retained)                                      | ~₹30 / month                                                                  | ~₹30 / month                             |
| Cloud Run (4 services)                                    | per request; ~₹0 at personal-testing traffic                                  | ₹0                                       |
| Guard (1 Scheduler job, hourly job runs)                  | free tier (3 Scheduler jobs free per billing account); job runs ≤ ₹20 / month | same                                     |
| Artifact Registry (last 3 images per app), Secret Manager | ~₹30 / month                                                                  | ~₹30 / month                             |

| Scenario                             | Per day | Per month |
| ------------------------------------ | ------- | --------- |
| Always running (no stopping)         | ~₹105   | ~₹3,200   |
| Always stopped                       | ~₹35    | ~₹1,050   |
| Testing 2 h a day, stopped otherwise | ~₹41    | ~₹1,250   |

Stopped cost is dominated by the reserved public IP (~₹820 a month). Removing it requires private IP for Cloud SQL plus VPC egress for Cloud Run; that saves the IP charge but adds networking setup, so it is not done.

## Rules

- Never delete the instance, buckets, secrets or images from these scripts; none of the commands delete anything. Cloud SQL has deletion protection on.
- Automated backups run daily at 02:00 IST only while the instance is running; existing backups are kept while it is stopped.
- To change the guard schedule: `GUARD_SCHEDULE="17 */2 * * *" infra/gcp/staging.sh install-guard` (idempotent).
- To pause the guard (for a long session): `gcloud scheduler jobs pause ros-sql-guard --location asia-south1`; resume with `… resume …`. Prefer `extend` instead.
