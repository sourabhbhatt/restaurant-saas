# Manual actions required (owner)

Everything here needs you: a decision, an account setting, a console click, or approval to spend. The code side is done (audit branch `audit/integration` at `d13b1c3`) or tracked in the [full audit](../audits/full-e2e-audit.md); test results are in [regression results](../audits/regression-results.md).

**Priorities**

- **P0**: before the next staging redeploy (or before the next push to `staging`).
- **P1**: before production goes live.
- **P2**: later, after launch.

**Cost rule.** The default is ₹0. Every item that can cost money says so and is marked **needs approval**. Nothing in this list should be done on a paid basis without your explicit yes. Budget alerts only send e-mails; they never stop charges.

Project facts used below (from `docs/runbooks/staging-gcp.md`, `infra/gcp/deploy.sh`, `docs/runbooks/ci-cd.md`): staging project `restaurant-os-514008`, region `asia-south1` (Mumbai), Cloud SQL instance `ros-pg18` (currently stopped), service accounts `ros-api`, `ros-web`, `ros-deployer`, `ros-migrate`. The GitHub repository `sourabhbhatt/restaurant-saas` is public, so GitHub Actions minutes and branch protection are free.

## Approvals you need to give or refuse

| Item                                                                                       | Approximate cost                                                                   | Where it comes from                                                                                                                               | Section                  |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Dedicated secret `ros-staging-proxy-secret`                                                | about ₹5 a month                                                                   | Secret Manager, US$0.06 per active secret version per month beyond the free tier; the project is already past it (`client-ip-signing-rollout.md`) | A2                       |
| Cloud SQL running time for any staging deploy or staging test                              | ₹4.00 per hour while running (`db-g1-small`)                                       | `staging-gcp.md` cost table                                                                                                                       | A2, B6, B7, B9, B10, B12 |
| GA4 Measurement Protocol secret `ros-staging-ga-api-secret` (and one for production later) | about ₹5 a month each                                                              | `analytics-events.md` §4 (verify on the Secret Manager pricing page)                                                                              | B6                       |
| Resend API key secret `ros-staging-resend-api-key`                                         | about ₹5 a month, same Secret Manager rate                                         | `deploy.sh` uses it if it exists                                                                                                                  | B7                       |
| Domain name                                                                                | registrar's price                                                                  | —                                                                                                                                                 | B3                       |
| Production project (Cloud SQL, Cloud Run, secrets, backups)                                | for reference, staging's shape costs about ₹3,200 a month if Cloud SQL never stops | `staging-gcp.md` scenario table                                                                                                                   | B2                       |
| Legal review of the privacy policy and legal templates                                     | lawyer's fees                                                                      | —                                                                                                                                                 | B5                       |
| Thermal printer or test phones, if you do not own them                                     | hardware price                                                                     | —                                                                                                                                                 | B10                      |

## Summary

| #   | Priority                | Action                                                                                                                             | Cost                                                    |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A1  | P0                      | Check whether the Google Cloud billing account is a free trial or paid                                                             | ₹0                                                      |
| A2  | P0                      | Decide on the proxy secret; if approved, create it, grant access and redeploy all four apps                                        | ≈₹5/month + Cloud SQL time, **needs approval**          |
| A3  | P0                      | Protect the `staging` and `main` branches                                                                                          | ₹0                                                      |
| A4  | Done                    | The audit branch is pushed; its first CI run on GitHub passed (the e2e job runs on push to `staging`/`main`, not on pull requests) | ₹0                                                      |
| A5  | P0 (compose users only) | Add `PROXY_SHARED_SECRET` to `infra/compose/.env.compose`; validate the Caddy file once                                            | ₹0                                                      |
| B1  | P1                      | Schedule `/api/v1/jobs/subscriptions` hourly with Cloud Scheduler                                                                  | ₹0 within the free jobs, verify first                   |
| B2  | P1                      | Provision production (separate project); the production workflow fails closed today                                                | **needs approval**                                      |
| B3  | P1                      | Domain and DNS, then the indexing variables on production only, and switch off production's `*.run.app` URL                        | domain price, **needs approval**                        |
| B4  | P1                      | Pin GitHub Actions to commit SHAs and enable Dependabot for actions                                                                | ₹0                                                      |
| B5  | P1                      | Legal review of the privacy policy; set the real legal entity and support e-mail                                                   | lawyer's fees, **needs approval**                       |
| B6  | P1                      | GA4: two properties, Enhanced measurement off (hard gate), IDs, API secret, DebugView check, key events                            | ₹0 for GA4; secret and Cloud SQL time **need approval** |
| B7  | P1                      | E-mail provider (Resend)                                                                                                           | free tier, verify limits; secret **needs approval**     |
| B8  | P1                      | Search Console and Bing Webmaster Tools, after the domain exists                                                                   | ₹0                                                      |
| B9  | P1                      | Razorpay test-mode checkout by hand, and the dashboard webhook check                                                               | ₹0 locally; staging needs Cloud SQL time                |
| B10 | P1                      | Real-device tests: phones, thermal printer, kitchen screen, real Wi-Fi drops                                                       | ₹0 with your own devices                                |
| B11 | P1                      | Track the remaining engineering items                                                                                              | ₹0                                                      |
| B12 | P1                      | Check whether Cloud Run compresses API JSON (one read-only request)                                                                | during an approved testing window                       |
| C1  | P2                      | List RestaurantOS honestly on software directories; genuine reviews only                                                           | ₹0 for free listings                                    |
| C2  | P2                      | Decide whether AI training crawlers may read the public site                                                                       | ₹0                                                      |
| C3  | P2                      | A short usability session with 2–3 real restaurant owners                                                                          | ₹0                                                      |
| C4  | P2                      | Decide on the growth recommendations                                                                                               | ₹0 to build and run                                     |
| C5  | P2                      | Keep or discard the audit working files                                                                                            | ₹0                                                      |

---

## P0: before the next staging redeploy

### A1. Check whether billing is a free trial or a paid account

**Why.** The audit could not tell (ledger: "Billing account open INR; trial vs paid status = manual check"). It decides whether staging's running costs come from trial credit or from your card.

**Steps.**

1. Open the Google Cloud console, select the billing account linked to `restaurant-os-514008`, then **Billing → Overview**.
2. Read whether it is a **free trial** (the page shows the remaining credit and the end date) or an **activated paid account**.
3. Open **Billing → Budgets & alerts** and confirm the two budgets from `staging-gcp.md` exist: `restaurant-os staging monthly` (₹1,500) and `restaurant-os trial guardrail` (₹12,600).

**Expected outcome.** You know which one applies. A free trial cannot charge the card. On an activated paid account, charges go to the card, and the budgets only send e-mail: they never stop spending.

**What staging costs today**, even with Cloud SQL stopped (from `staging-gcp.md`): about ₹35 a day, about ₹1,050 a month, mostly the reserved public IP (about ₹820 a month) and storage. With two hours of testing a day, about ₹1,250 a month. If the account is paid and that is not acceptable, the decision to reduce or remove staging is yours; none of the scripts delete anything.

**Cost.** ₹0.

### A2. Decide on the signed client IP secret, then create it and redeploy

**Why.** On Cloud Run the API sees the frontend's address instead of the browser's, so every visitor behind one frontend instance shares the sign-in, sign-up, password-reset and guest-ordering rate limits (audit item W1-01, high). The fix is in the code but **stays off** until a dedicated secret exists. Source: `docs/runbooks/client-ip-signing-rollout.md`.

**Cost. Needs approval.** About ₹5 a month for the secret. The redeploy needs Cloud SQL running (`deploy.sh` refuses otherwise): ₹4.00 an hour while it runs, plus the on-demand backup `deploy.sh` takes before migrating.

**Option 1: approve (recommended).**

1. Create the secret with a random value (never typed, never logged):

   ```bash
   openssl rand -hex 32 | gcloud secrets create ros-staging-proxy-secret \
     --project=restaurant-os-514008 --replication-policy=automatic --data-file=-
   ```

   Expected: `gcloud secrets versions list ros-staging-proxy-secret --project=restaurant-os-514008` shows version 1, enabled.

2. Let only the two runtime identities read it, and let the deployer see that it exists:

   ```bash
   for sa in ros-api ros-web; do
     gcloud secrets add-iam-policy-binding ros-staging-proxy-secret --project=restaurant-os-514008 \
       --member="serviceAccount:$sa@restaurant-os-514008.iam.gserviceaccount.com" \
       --role=roles/secretmanager.secretAccessor
   done
   gcloud secrets add-iam-policy-binding ros-staging-proxy-secret --project=restaurant-os-514008 \
     --member="serviceAccount:ros-deployer@restaurant-os-514008.iam.gserviceaccount.com" \
     --role=roles/secretmanager.viewer
   ```

   Expected: `gcloud secrets get-iam-policy ros-staging-proxy-secret` lists `ros-api` and `ros-web` as `secretAccessor` and `ros-deployer` as `viewer`. Without the viewer grant the deploy cannot see the secret and keeps the feature off (it prints so).

3. Start a testing window, then redeploy **all four apps** once so every service holds the same secret version:

   ```bash
   infra/gcp/staging.sh start 2
   ```

   Then push `staging`, or run **Actions → Deploy staging → Run workflow** on `staging` with `apps = api console ops admin`. Expected log line: `signed client IP on (ros-staging-proxy-secret:latest)`. The deploy also applies migrations `0008`, `0009` and `0010`, in that order (all additive, with down files; the index builds take well under a second at staging's size).

4. Verify:
   - Sign in on the staging console and open the workspace audit log: the `auth.signin` entry's IP is your own public address, not a Google `34.x`/`35.x` address.
   - From a second network (a phone hotspot), 30 wrong passwords for a throwaway e-mail return 429; from the first network a wrong password still returns 401.
   - The API log has no `client_ip_signature_rejected` warnings.

5. Stop Cloud SQL when done: `infra/gcp/staging.sh stop` (or let the hourly guard stop it after the window).

**Option 2: strictly ₹0 (not wired).** Put a random value in a GitHub Actions secret and pass it as a plain environment variable to the four services. It is then visible in revision metadata to anyone with `run.viewer`. This needs a small change to `deploy.sh` and the workflow first; reusing `ros-cron-secret` is not recommended.

**Option 3: decline.** Nothing changes on staging: the shared rate-limit buckets remain. Revisit before production.

**Rollback.** Disable or delete the secret version and redeploy; the old rule applies again.

### A3. Protect the `staging` and `main` branches

**Why.** A push to `staging` builds images and runs the migrate job with the database owner's credentials (W1-12). Workload Identity already limits Google Cloud access to `refs/heads/staging`; branch protection is the remaining control.

**Steps.** In GitHub: **Settings → Branches** (or **Settings → Rules → Rulesets**), add a rule for `staging` and one for `main`:

1. Require a pull request before merging.
2. Require status checks to pass (the `CI` jobs).
3. Block force pushes and deletions.

With a single maintainer, a required approval would block your own merges, because GitHub does not let a pull request's author approve it. Either set required approvals to 0 and rely on the pull request and status checks, or allow yourself as an administrator to bypass.

**Expected outcome.** Direct pushes and force pushes to `staging` and `main` are refused; changes arrive through pull requests with green checks.

**Cost.** ₹0 (public repository).

### A4. First CI run on GitHub (done)

**Status.** Done. The controller pushed the audited head `ea29797` to `claude/epic-turing-vhor3y` and to `staging`. **Deploy staging** run [42813872728](https://github.com/sourabhbhatt/restaurant-saas/actions/runs/42813872728) passed every check: `verify`, `integration-pg` (including the Postgres-only `postgres-resilience.test.ts`), `storage-s3`, `secrets`, `audit` and `e2e` (156 passed, 0 failed, 27 skipped in 3.3 minutes, then the consent run: 16 passed, 2 skipped). The gate found Cloud SQL stopped and ended with **"Staging deploy pending"**: nothing was built for Cloud Run or deployed, at ₹0. The whole pipeline took about 14 minutes, well inside the e2e job's 30-minute limit.

**When the e2e job runs.** Only on a **push to `staging` or `main`**, never on a pull request. While Cloud SQL is stopped, a push to `staging` runs every check and ends green with "Staging deploy pending".

**Your part.** Nothing now. When a test fails in a later run, download the `playwright-report` artifact (kept 7 days) for traces; in CI a failed test is retried twice and a test that passed on retry still shows in the report.

### A5. Compose users: add `PROXY_SHARED_SECRET`

Only if you run the Docker compose stack. The compose file now refuses to start without it (W1 report §5).

**Steps.**

1. Add `PROXY_SHARED_SECRET=<at least 16 random characters>` to `infra/compose/.env.compose` (copy the format from `infra/compose/.env.compose.example`; the placeholder value `replace-with-…` is refused in production).
2. The compose edge (Caddy) now compresses JSON, HTML, JS, CSS and SVG. This was not run during the audit (no Docker available), so validate it once: `docker compose -f infra/compose/docker-compose.yml config`, and `caddy validate` on `infra/compose/Caddyfile` if you have the binary (W6 report §6).
3. Start the stack:

   ```bash
   docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env.compose up -d --build
   ```

**Expected outcome.** `docker compose -f infra/compose/docker-compose.yml ps` shows `migrate` and `roles` exited 0 and the rest healthy; a JSON response through Caddy carries `Content-Encoding: zstd` or `gzip`.

**Cost.** ₹0.

---

## P1: before production

### B1. Schedule the hourly cleanup job

**Why.** `POST /api/v1/jobs/subscriptions` sends trial reminders and expiry notices, deletes expired rate-limit buckets, idempotency records, dead sessions and spent tokens (W1-09), and deletes the GA4 client id of checkouts left unpaid for 48 hours, which the privacy policy promises (W5-N1). Nothing schedules it today. Hourly, not daily (the W1 report's "daily" is superseded; `docs/deployment.md` step 7).

**Steps** (from `docs/growth/analytics-events.md` §4b; once per environment, against the API's own URL, because the frontends' proxy drops `Authorization`):

```sh
API_URL=https://<api service URL>
gcloud scheduler jobs create http ros-subscription-sweep \
  --project=<project> --location=asia-south1 \
  --schedule="23 * * * *" --time-zone=Asia/Kolkata \
  --uri="$API_URL/api/v1/jobs/subscriptions" --http-method=POST \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=ros-cron-secret --project=<project>)" \
  --attempt-deadline=120s
```

Notes: the bearer secret is stored in the job's configuration and is visible to anyone with Cloud Scheduler read access; after rotating `ros-cron-secret`, update the job's headers. On staging, runs fail with HTTP 500 while Cloud SQL is stopped and catch up after the next start.

**Expected outcome.** Each run logs `subscription_sweep_completed` with `housekeeping` counts and `analyticsIdsCleared`.

**Cost.** ₹0 within Cloud Scheduler's 3 free jobs per billing account; `ros-sql-guard` already uses one. One job per environment on the same billing account stays within 3 only if no other jobs are added. **Verify on the Cloud Scheduler pricing page before creating it** (<https://cloud.google.com/scheduler/pricing>).

### B2. Provision production

**Why.** Production does not exist. `.github/workflows/deploy-production.yml` refuses to run without `PROD_GCP_PROJECT` and `PROD_GCP_WIF_PROVIDER`, refuses the staging project and provider, and then stops at "Production deployment steps are added when the production project exists". So it fails closed today (`docs/runbooks/ci-cd.md`).

**Steps (outline; no script exists yet).**

1. Create a separate Google Cloud project for production, with its own Workload Identity provider, deployer identity and secrets.
2. Set the repository variables `PROD_GCP_PROJECT` and `PROD_GCP_WIF_PROVIDER`; keep the `production` environment limited to `main` with a required reviewer.
3. Write the production deploy steps (an engineering task). The deploy definition must set, from production values: `SITE_INDEXABLE` and `PUBLIC_SITE_URL` (B3), `SITE_SUPPORT_EMAIL` and `SITE_LEGAL_ENTITY` (B5), the e-mail provider (B7), GA4 variables if approved (B6), `PROXY_SHARED_SECRET` from a production secret (A2), and the cleanup schedule (B1). Then run the indexing curl checks (B3) and `pnpm smoke`.

**Expected outcome.** A manual, approved production deploy from `main` that passes the smoke test.

**Cost. Needs approval.** Cloud SQL, Cloud Run, secrets, backups and a public IP in a second project. For reference only, the runbook's estimate for staging's shape with the database never stopped is about ₹3,200 a month.

### B3. Domain, DNS and indexing (production only)

**Why.** Every page is `noindex` until a production domain exists and two variables are set on production. Source: `docs/growth/seo-strategy.md` "Indexing requirements".

**Steps.**

1. **Buy a domain** (needs approval) and serve the production console on it over HTTPS, for example `www.<brand>.in`. Choose `www` or the apex and 301-redirect the other at the DNS host or load balancer.
2. **Set two variables in the production deploy definition**, never by hand and **never on staging**: `PUBLIC_SITE_URL=https://www.<brand>.in` (no path) and `SITE_INDEXABLE=true`. A value set by hand in Cloud Run disappears on the next deploy, because the deploy replaces the whole environment.
3. **Switch off production's default `*.run.app` URL** once the domain serves traffic: deploy production with `--no-default-url` (then check the domain still answers), or redirect the `*.run.app` host to the domain at the load balancer. Staging keeps its default URL.
4. Make sure requests reach the app with the domain in `Host` (or `X-Forwarded-Host`).
5. **Verify after the first production deploy and after every later one:**

   ```sh
   curl -sI https://www.<brand>.in/pricing | grep -i x-robots-tag      # no output
   curl -sI https://www.<brand>.in/logo.png | grep -i x-robots-tag     # no output
   curl -s  -A Googlebot https://www.<brand>.in/pricing | grep -o '<meta name="robots"[^>]*>'
   #   <meta name="robots" content="index, follow"/>
   curl -s  https://www.<brand>.in/robots.txt | tail -1               # Sitemap: https://www.<brand>.in/sitemap.xml
   curl -s  https://www.<brand>.in/sitemap.xml | grep -c '<loc>'      # 12
   curl -sI https://www.<brand>.in/t/anything | grep -i x-robots-tag  # noindex, nofollow
   curl -sI https://<service>.run.app/pricing | grep -i x-robots-tag  # noindex, nofollow (or no answer once the default URL is off)
   ```

   If pages stay `noindex`, search the console service's logs for `site_not_indexable`: it names the reason.

**Expected outcome.** Public pages, `/logo.png` and `/og-image.png` carry no `X-Robots-Tag`; robots.txt lists the sitemap; the sitemap has 12 URLs; guest and private routes stay `noindex`.

**Cost.** Domain registration **needs approval**; the rest ₹0.

### B4. Pin GitHub Actions to commit SHAs

**Why.** The workflows use major tags (W1-11): `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `pnpm/action-setup@v4`, `docker/login-action@v3`, `docker/setup-buildx-action@v3`, `docker/build-push-action@v6`, `google-github-actions/auth@v2`, `google-github-actions/setup-gcloud@v2`, `gitleaks/gitleaks-action@v2`. A moved tag would run new code with the deployer's Google Cloud identity.

**Steps.** For each action, look up the full commit SHA of the release you use on its GitHub releases page, and replace `@v4` with `@<40-character SHA> # v4.x.y` in `.github/workflows/ci.yml`, `deploy-staging.yml` and `deploy-production.yml`. Then add a Dependabot configuration for the `github-actions` ecosystem (`.github/dependabot.yml`) so pinned SHAs get update pull requests. This is a small code change; an engineer can do it in a pull request.

**Expected outcome.** No `uses:` line references a tag; Dependabot opens pull requests for action updates.

**Cost.** ₹0.

### B5. Legal review, legal entity and support e-mail

**Why.** The privacy policy was rewritten to describe the optional analytics exactly (W5-M3, W5-N3) and must be reviewed by a lawyer with the other legal templates (their banner says so). The site shows placeholders until you set two values: support e-mail `support@restaurantos.example` and legal entity `[Your company legal name]`. They are now **runtime settings** (`SITE_SUPPORT_EMAIL`, `SITE_LEGAL_ENTITY`, commit `e721d51`); no rebuild is needed.

**Steps.**

1. Have a lawyer review the privacy policy and legal templates, in particular (from `docs/growth/analytics-events.md` §8 and the W5 report): the cross-border transfer wording; "up to 14 months" retention, which must match the GA4 property setting (B6); the case of a payment reported after a withdrawal; consent being per browser; the device and approximate-location data Google Analytics collects by default; the 48-hour use of a checkout's GA id; which Google entity to name. Also workspace data retention (`docs/deployment.md` "Data retention").
2. Decide the legal entity name and a real support inbox on your domain.
3. Staging: add GitHub repository variables `SITE_SUPPORT_EMAIL` and `SITE_LEGAL_ENTITY` (**Settings → Secrets and variables → Actions → Variables**; they are not secrets), or export them before running `infra/gcp/deploy.sh`. Values may contain spaces, commas and `@`, but not `|`. Production: set them in the production deploy definition (B2).

**Expected outcome.** The contact page, footer and legal pages show real details; the Organization structured data gains the e-mail and legal name (placeholders are never published there).

**Cost. Needs approval** for the lawyer's fees; setting the variables is ₹0.

### B6. GA4 analytics (optional; hard gates)

**Why.** The analytics code is inert until a Measurement ID is set. Turning it on wrongly would leak tokens in URLs to Google. Source: `docs/growth/analytics-events.md` "Manual GA4 setup" (including §4 "Staging, step by step").

**Do not set a Measurement ID anywhere until steps 1–3 are done for that environment.** The staging deploy enforces this: it refuses to turn analytics on unless `STAGING_GA_ENHANCED_MEASUREMENT=off` is also set.

**Steps.** Do this twice: once for staging, once for production.

1. **Two separate GA4 properties**, `RestaurantOS – Staging` and `RestaurantOS – Production` (not two streams in one property): analytics.google.com → **Admin → Create → Property**, time zone India, currency Indian Rupee; accept the terms and the Data Processing Amendment.
2. **Web stream with Enhanced measurement OFF (hard gate):** **Admin → Data collection and modification → Data streams → Add stream → Web**, URL = that environment's console origin, name `Console`. Switch **Enhanced measurement off** before saving. Take a screenshot for the record. If it is ever found on later, unset the Measurement ID first, then fix the stream.
3. **Privacy settings:** Google signals off; event data retention **14 months** (matches the policy); do not link Google Ads.
4. **Copy the Measurement ID** (`G-…`) from **Stream details**, and create a **Measurement Protocol API secret** (**Data streams → Console → Measurement Protocol API secrets → Create**, nickname `api-server`). Never paste the secret into a frontend variable, a ticket or chat.
5. **Store the API secret in Secret Manager** (staging; **new secret version, about ₹5 a month, needs approval**), pasting it at the prompt so it never lands in shell history:

   ```bash
   read -rs GA_SECRET && printf '%s' "$GA_SECRET" | gcloud secrets create ros-staging-ga-api-secret \
     --project=restaurant-os-514008 --replication-policy=automatic --data-file=- ; unset GA_SECRET
   ```

   Then let the API read it and the deployer see it:

   ```bash
   gcloud secrets add-iam-policy-binding ros-staging-ga-api-secret --project=restaurant-os-514008 \
     --member="serviceAccount:ros-api@restaurant-os-514008.iam.gserviceaccount.com" \
     --role=roles/secretmanager.secretAccessor
   gcloud secrets add-iam-policy-binding ros-staging-ga-api-secret --project=restaurant-os-514008 \
     --member="serviceAccount:ros-deployer@restaurant-os-514008.iam.gserviceaccount.com" \
     --role=roles/secretmanager.viewer
   ```

   Without the secret, the console still measures page views after consent, and server events stay off.

6. **Turn it on for staging** (needs staging running: **Cloud SQL time, needs approval**):

   ```bash
   export STAGING_GA_MEASUREMENT_ID=G-XXXXXXX      # the staging stream
   export STAGING_GA_ENHANCED_MEASUREMENT=off       # you checked step 2 on this stream
   TAG=$(git rev-parse --short HEAD) infra/gcp/deploy.sh
   ```

   Expected output: `GA4 server events on (G-…)` and `console analytics on (G-…, debug true)`. To keep it on for CI deploys, add repository variables `STAGING_GA_MEASUREMENT_ID` and `STAGING_GA_ENHANCED_MEASUREMENT=off` (optionally `STAGING_GA_DEBUG_MODE`); without them, the next push to `staging` deploys with analytics off. To turn it off, unset them and redeploy.

7. **DebugView check on staging:** **Admin → Data display → DebugView**; visit three pages including `/invite/x`, `/reset-password?token=x` and one `/app/w/<id>` page. Expected: exactly one `page_view` per navigation; no `scroll`, `click`, `view_search_results`, `form_start` or `file_download`; no token, UUID or non-`utm` query in any `page_location`. Production's ID stays unset until this passes.
8. **Key events:** **Admin → Data display → Key events → New key event** for `signup_completed`, `trial_started`, `qr_generated`, `payment_succeeded`, `subscription_activated`.
9. **Custom definitions:** event-scoped custom dimensions `plan_key`, `billing_cycle`, `renewal`, `invited`, `landing_page`; event-scoped custom metric `count` (QR codes per `qr_generated`) and, if wanted, `trial_days`.
10. **Schedule the hourly cleanup (B1)** in every environment with server events on.
11. Run the remaining checks in `analytics-events.md` §7 (decline in a private window sends nothing; cross-tab withdrawal; a Razorpay test purchase counts once).
12. **Production:** there is no production deploy script yet; its deploy definition (B2) must set the same variables from the production property and its own secret, after the gate passes on staging.

**Expected outcome.** Staging never pollutes production; DebugView shows only sanitized page views and the documented events.

**Cost.** GA4 standard properties and the Measurement Protocol are free. The secret and staging test time **need approval**.

### B7. E-mail provider (Resend)

**Why.** Without a provider key, the API writes e-mails to an internal outbox and nothing is delivered: invitations, password resets and trial reminders do not arrive.

**Steps.**

1. Staging: `deploy.sh` switches to Resend automatically when a secret named `ros-staging-resend-api-key` exists, with the sender `RestaurantOS Staging <onboarding@resend.dev>` unless `EMAIL_FROM` is set (a sender may not contain `|` or `,`; the `@` problem in the deploy script was fixed in `d13b1c3`). Create the key in your Resend account and store it as that secret (**new secret version, about ₹5 a month, needs approval**). The deployer already has metadata access for it (`setup-ci-identity.sh`).
2. Production: after the domain exists (B3), verify a sending domain in Resend and set `EMAIL_FROM` to an address on it in the production deploy.
3. **Verify the current free-tier limits on Resend's pricing page** before relying on it (daily and monthly sending caps, number of domains). Brevo is also supported (`EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`).

**Expected outcome.** An invitation sent from staging arrives in the invitee's inbox.

**Cost.** Provider free tier, to be verified; the secret **needs approval**.

### B8. Search Console and Bing Webmaster Tools

Only after the production domain serves traffic and B3's checks pass. Source: `docs/growth/seo-strategy.md` "Search Console and Bing setup".

**Steps.**

1. <https://search.google.com/search-console>: add a **Domain property** for `<brand>.in`, verify with the DNS TXT record it shows.
2. **Sitemaps → add** `https://www.<brand>.in/sitemap.xml`. Expected: "Success" with 12 discovered URLs (can take a day).
3. **URL Inspection → Test live URL** on `/`, `/pricing` and `/features/qr-code-ordering`. Expected: available to Google; the user-declared canonical equals Google's; canonical and `index, follow` inside `<head>`. Then **Request indexing** for those three.
4. Rich Results Test (<https://search.google.com/test/rich-results>) on `/` and `/features/restaurant-billing`: Breadcrumb and Organization recognised. "Software App" is **not** expected, because there are no reviews.
5. <https://www.bing.com/webmasters>: **Import from Google Search Console**.
6. After 2–4 weeks, read **Performance → Queries** and re-rank the keyword map with real numbers.

**Cost.** ₹0.

### B9. Razorpay test-mode checkout by hand

**Why.** No automated test drives the hosted Checkout form in a browser. The API refuses any key that does not start with `rzp_test_`; no live payments are possible. Source: `docs/deployment.md` "Razorpay setup" and "Test-mode checks".

**Steps.**

1. In the Razorpay dashboard, switch to **Test mode**, create test keys, and set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in the server environment (never in the client or git).
2. Run the scripted API check:

   ```sh
   RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_WEBHOOK_SECRET=... \
     pnpm razorpay:test-e2e --api http://localhost:3000 --email owner@demo.local --password 'Demo-Owner-2026'
   ```

   (locally, against `pnpm dev` started with `PAYMENT_PROVIDER=razorpay` and the test keys in `.env.local`). Expected: a PASS table.

3. In a browser, sign in as an organization owner → **Subscription → Upgrade** → choose a plan → **Pay with Razorpay**. Pay with the test card `4111 1111 1111 1111`, any future expiry, any CVV, and the OTP the test bank page shows (check Razorpay's test docs for current values), or test UPI `success@razorpay`. Then repeat with `failure@razorpay`.
4. Expected on success: "Confirming payment…", then "plan activated"; the plan ACTIVE with the new period end and "Payment received"; audit rows `payment.checkout_created` and `subscription.paid`. On failure: Checkout shows the error and stays open for a retry; nothing becomes active.
5. **Webhook delivery check** (needs a public API URL, i.e. staging: **Cloud SQL time, needs approval**): in the test-mode dashboard, **Account & Settings → Webhooks**, URL `https://<staging API>/api/v1/webhooks/razorpay` (the API itself, not a frontend), events `order.paid`, `payment.captured`, `payment.failed`, secret equal to `RAZORPAY_WEBHOOK_SECRET`. On staging, `deploy.sh` turns payments on only when the three `ros-staging-razorpay-*` secrets exist; creating any that do not exist yet is a Secret Manager cost (**needs approval**). Expected: every delivery shows 2xx; a 401 means the secrets differ.

**Cost.** ₹0 locally (steps 2–4). Staging webhooks need Cloud SQL time and possibly new secrets.

### B10. Real-device tests

**Why.** Every UI check in the audit ran in local Chromium. Sources: W3 report §6, W2 report §0, W6 report, final frontend review.

Service workers and offline support need HTTPS (except on `localhost`), so offline tests on a phone need staging (**Cloud SQL time, needs approval**) or a local HTTPS setup. The service worker now installs only on staff screens (console `/app/**` and `/print/**`, and the ops app); guest QR pages are not saved for offline use.

| Test                       | Steps                                                                                              | Expected                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Thermal printer (80 mm)    | Cashier → table → Generate bill → Print receipt; then void a bill and print it                     | Fits 80 mm, nothing clipped; GSTIN, address, header and footer appear; the voided bill shows the VOID block                                                        |
| Phones                     | Guest QR menu and cart; waiter console; owner checklist, on real Android and iPhone browsers       | Nothing cut off; buttons reachable; the waiter header shows the live/offline dot                                                                                   |
| Kitchen display            | Open it on the actual kitchen screen, in kitchen light                                             | Text and status colours readable at a distance (the automated check covers WCAG contrast only)                                                                     |
| Real Wi-Fi drop            | Waiter: compose an order, switch Wi-Fi off, send, switch on. Kitchen: tap items offline, reconnect | The order is sent exactly once; kitchen lines show "Waiting to sync" until confirmed and are never shown as done before that; reconnect is detected within seconds |
| First visit on a slow link | Open the kitchen display for the first time on a weak connection and tap a ticket at once          | Controls show "Connecting…" until the device knows the signed-in user, then the tap is saved (fix FF-F1)                                                           |
| Private browsing           | Kitchen display in a private window where storage is blocked                                       | Online: taps are sent directly, one at a time. Offline: a message says changes cannot be saved in this browser (fix FF-F8)                                         |

**Cost.** ₹0 with your own devices; staging time **needs approval**.

### B11. Track the remaining engineering items

Not owner actions, listed so production is not launched with them forgotten. Details in the [full audit](../audits/full-e2e-audit.md) §4 and §7. Nothing critical or high is open.

| ID           | Severity | What                                                                                                 |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------- |
| W6-P9        | medium   | API JSON is not compressed on Cloud Run (guest menu about 192 KB per load); decide after B12         |
| CI first run | —        | `e2e` and `integration-pg` green on GitHub (A4)                                                      |
| W2-12        | low      | Invitation endpoint validates before checking permission (422 instead of 403 for an invalid role id) |
| W6-P13       | low      | Owner dashboard layout shift (CLS 0.117)                                                             |
| W6-PRE       | low      | Staff devices precache about 1 MB (console) and 0.5 MB (ops)                                         |
| W6-N2        | low      | Occasional late first API request on sign-in and guest pages (pre-existing)                          |
| W5-11        | low      | QR menu views are not measured (needs a small database counter)                                      |
| W5-M1R       | low      | "Cookie settings" missing on the onboarding wizard, notifications and error pages                    |
| W4-13        | low      | PWA icon does not match the brand mark                                                               |
| FF-N-R2-2    | low      | Harmless pending messages on public pages (optional cleanup)                                         |

### B12. Check whether Cloud Run already compresses API JSON

**Why.** Next.js does not compress API route responses, so the guest menu travels uncompressed unless something in front does (W6-P9). Google's front end may already do it; one request tells you. Source: `docs/audits/performance-report.md` open item 2.

**Steps.** During a testing window you have already approved (staging must be running), run one read-only request (this is not a load test):

```sh
curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' <staging console>/api/v1/public/plans | grep -i content-encoding
```

**Expected outcome.** If it prints `content-encoding: gzip` (or `br`), nothing more is needed. If it prints nothing, ask an engineer for the zero-dependency gzip front in the frontend image, or a Caddy sidecar (both ₹0, no new cloud resource; described in the performance report).

**Cost.** ₹0 beyond the testing window.

---

## P2: later

### C1. Directory listings, honestly

**Why.** Directories and listicles dominate the head search terms, and AI assistants summarise them (`docs/growth/seo-strategy.md` "Next steps", `docs/growth/ai-search-visibility.md`).

**Steps.** After launch, list RestaurantOS on Capterra India, SoftwareSuggest, Techjockey and G2 with the same name, one-line description and domain everywhere, and with accurate features and limits (match the site's "doesn't do yet" lists). Ask real customers for reviews.

**Rules.** No fake, paid or undisclosed incentivised reviews, no made-up customer counts, ratings or awards, no paid link schemes. Only genuine reviews may later feed `aggregateRating`, and only if they are shown on the page too.

**Cost.** Use free listings only; any paid placement **needs approval**. Verify each directory's terms.

### C2. AI training crawlers

Training crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`) are **allowed by default**; search crawlers must stay allowed. Decide whether to opt out of training; the robots.txt snippet and where to add it are in `docs/growth/ai-search-visibility.md` "Opting out of AI training". ₹0.

### C3. Usability session

Watch 2–3 real restaurant owners go from sign-up to their first accepted order without help (W3 report §6). Scripted clicks measured 14 clicks and 10 fields, but not comprehension. ₹0.

### C4. Growth recommendations

`docs/growth/growth-opportunities.md` lists recommendations for activation, acquisition, retention and monetization that need your decision. All are ₹0 to build and run.

### C5. Audit working files

The audit's reports, reviews, raw performance data and final logs are in `.claude/audit/` (git-ignored, in the main checkout; final run logs in `.claude/audit/final/`). The accessibility checks now live in the repository (`tests/e2e/accessibility.spec.ts`); W3's earlier sweep and journey scripts exist only in W3's worktree under `.claude/audit/W3-scripts/`. Copy anything you want to keep before the audit worktrees are removed. ₹0.
