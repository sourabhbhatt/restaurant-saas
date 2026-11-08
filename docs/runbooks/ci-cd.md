# CI/CD

GitHub Actions, three workflows. No service-account keys exist: GitHub authenticates to Google Cloud through Workload Identity Federation.

## Branches

| Branch                          | Purpose           | What runs                                                                                                                             |
| ------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| feature branches → pull request | development       | `CI`: affected packages only (typecheck, lint, tests, build), Postgres 18 and MinIO suites, gitleaks, `pnpm audit`, build-only images |
| `staging`                       | what staging runs | `Deploy staging`: full CI (every package plus E2E) → gate → build changed apps → deploy → smoke                                       |
| `main`                          | stable code       | `CI` (full E2E on push). Production deploys only through `Deploy production`: manual, from `main`, after a required reviewer approves |

Promote by pull request: feature → `staging` (tested on staging) → `main`.

## Deploy staging (`.github/workflows/deploy-staging.yml`)

1. **checks**: `ci.yml` with `full: true`. Any failure stops the pipeline; nothing is built or deployed.
2. **gate**: never starts anything. Deploys only if Cloud SQL is running _and_ inside a testing window (`infra/gcp/staging.sh start`). Otherwise the run ends green with a "Staging deploy pending" summary. Apps to deploy are those whose code changed since the version each Cloud Run service runs (its `APP_VERSION`), so a skipped deploy is caught up next time.
3. **build**: one job per changed app (plus `migrate` with the API) on GitHub's runners, layers cached in the GitHub Actions cache, pushed to Artifact Registry as `<app>:<short sha>`. Cloud Build is not used.
4. **deploy**: `infra/gcp/deploy.sh` for those apps (API first: on-demand Cloud SQL backup, migrate job). Cloud Run stays at `min-instances=0`.
5. **smoke**: `pnpm smoke:staging` against the four public URLs; passwords come from Secret Manager and are masked.

One staging deploy runs at a time (`concurrency: staging-deploy`); a newer push waits.

**Deploy by hand** after starting staging: Actions → Deploy staging → Run workflow on `staging` (optionally list apps, e.g. `api`).

## Deploy production (`.github/workflows/deploy-production.yml`)

Manual only. Requires: run from `main`, the confirmation text, approval in the `production` environment, and a separate production project and identity provider (`PROD_GCP_PROJECT`, `PROD_GCP_WIF_PROVIDER`). It refuses the staging project and provider. Production is not provisioned, so it fails closed today.

## Identity and permissions

`infra/gcp/setup-ci-identity.sh` (one time, by a project owner):

- Pool `github`, provider `github-oidc`: only tokens from `sourabhbhatt/restaurant-saas` on `refs/heads/staging`, never pull-request events. Forks and feature branches cannot reach Google Cloud.
- `ros-deployer`: Cloud Run developer; actAs the three runtime accounts; Artifact Registry writer on `ros`; custom role `rosDeployerSql` (read the instance, create backups; **cannot start, stop or modify Cloud SQL**); Secret Manager metadata for the Razorpay/Resend staging secrets (no values) and read access to the three staging seed passwords for smoke tests.

Repository variables (not secrets): `GCP_PROJECT`, `GCP_PROJECT_NUMBER`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`. Environments: `staging` (branch `staging` only), `production` (branch `main` only, required reviewer).

## Cost

Public repository: GitHub-hosted runner minutes are free. Docker layer cache: GitHub Actions cache (free, 10 GB). Artifact Registry keeps the last 3 tags per image (cleanup policy), about ₹10–30 a month. No Cloud Build minutes. Cloud SQL time is only spent when you start staging.
