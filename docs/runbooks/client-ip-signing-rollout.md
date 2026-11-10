# Rollout: signed client IP between the frontends and the API (staging)

**Why.** On Cloud Run the frontends call the API's public URL, so the API's `X-Forwarded-For` ends with the _frontend's_ egress address and every browser behind one frontend instance shares the per-IP sign-in, sign-up and guest-ordering limits (ten sign-ups per hour for everyone, for example). Trusting a second hop would let anyone who can reach the API URL pick their own address. With `PROXY_SHARED_SECRET` set on both sides, the frontend proxy signs the browser's address (`x-ros-client-ip` + `x-ros-client-ip-signature`, HMAC-SHA256, 60 s replay window) and the API uses it; see [environment variables](../environment-variables.md#proxy_shared_secret-the-client-ip-when-the-frontends-reach-the-api-over-its-public-url).

**What `deploy.sh` does on its own.** If a Secret Manager secret named `ros-staging-proxy-secret` exists, the next deploy mounts it as `PROXY_SHARED_SECRET` into the API and the three frontends and sets `TRUSTED_PROXY_HOPS=1` on the frontends. If it does not exist, nothing changes: the variable stays unset everywhere and the `X-Forwarded-For` rule applies as today. `PROXY_SECRET_REF=<secret>:<version>` overrides the secret name for one deploy. The secret is dedicated on purpose: it must not be the cron or app secret, so a frontend container (the largest attack surface) never holds another credential.

## Manual steps (project owner; nothing here is run by CI or by the audit)

Cost: Secret Manager bills US$0.06 per active secret version per month beyond the free tier; the project is past it, so this is about ₹5/month from the trial credit that already funds staging. It needs your approval because it is not strictly ₹0.

1. Create the secret with a random value (never typed, never logged):

   ```bash
   openssl rand -hex 32 | gcloud secrets create ros-staging-proxy-secret \
     --project=restaurant-os-514008 --replication-policy=automatic --data-file=-
   ```

   Expected: `gcloud secrets versions list ros-staging-proxy-secret --project=restaurant-os-514008` shows version 1, enabled.

2. Let only the two runtime identities read it (the CI deployer needs no access: `deploy.sh` checks existence through `gcloud secrets versions list`, which `secretmanager.viewer` on the project already allows if you grant it; otherwise grant `roles/secretmanager.viewer` on this one secret to `ros-deployer` as `setup-ci-identity.sh` does for the Razorpay secrets):

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

   Expected: `gcloud secrets get-iam-policy ros-staging-proxy-secret` lists `ros-api` and `ros-web` as `secretAccessor` and `ros-deployer` as `viewer`. Without the accessor bindings the deploys fail with "permission denied on secret".

3. Redeploy all four apps once so every service holds the same secret version: push `staging` inside a testing window, or run **Deploy staging** manually with `apps = api console ops admin`. `deploy.sh` prints `signed client IP on (ros-staging-proxy-secret:latest)`.

**Strictly-₹0 alternative** (if even ₹5/month is refused): put the random value in a GitHub Actions secret and pass it as a plain environment variable (`--set-env-vars PROXY_SHARED_SECRET=…`) to the four services. It is then visible in revision metadata to anyone with `run.viewer` on the project, which is acceptable for a rate-limit keying secret in a single-owner staging project but weaker than Secret Manager; this is not wired up, it would need a small change to `deploy.sh` and the workflow. Reusing `ros-cron-secret` is **not** recommended: every frontend would then hold the cron credential and rotating one use would break the other.

## Verify after the deploy

1. Sign in on the console, then open the workspace audit log: the `auth.signin` entry's IP is your own public address, not a `34.x`/`35.x` Google egress address.
2. From a second network (phone hotspot), 30 wrong passwords for a throwaway email return 429; from the first network a wrong password still returns 401 (separate buckets).
3. The API log has no `client_ip_signature_rejected` warnings; a burst of them means the two sides hold different secret versions (`:latest` of the same secret on all four services).

Rollback: delete or disable the secret version and redeploy, or redeploy with `PROXY_SECRET_REF=` unset after removing the secret; the hop rule applies again immediately, nothing else changes.
