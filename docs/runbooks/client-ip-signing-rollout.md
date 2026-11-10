# Rollout: signed client IP between the frontends and the API (staging)

**Why.** On Cloud Run the frontends call the API's public URL, so the API's `X-Forwarded-For` ends with the _frontend's_ egress address and every browser behind one frontend instance shares the per-IP sign-in, sign-up and guest-ordering limits (ten sign-ups per hour for everyone, for example). Trusting a second hop would let anyone who can reach the API URL pick their own address. With `PROXY_SHARED_SECRET` set on both sides, the frontend proxy signs the browser's address (`x-ros-client-ip` + `x-ros-client-ip-signature`, HMAC-SHA256, 60 s replay window) and the API uses it; see [environment variables](../environment-variables.md#proxy_shared_secret-the-client-ip-when-the-frontends-reach-the-api-over-its-public-url).

`infra/gcp/deploy.sh` already does the wiring: it mounts one Secret Manager secret into the API and the three frontends as `PROXY_SHARED_SECRET` and sets `TRUSTED_PROXY_HOPS=1` on the frontends. By default it reuses the existing `ros-cron-secret` (`PROXY_SECRET_REF=ros-cron-secret:latest`), so no new cloud resource is created; the value never reaches a browser, and a frontend holding it could at most call the idempotent `/api/v1/jobs/subscriptions` sweep. A dedicated secret is cleaner if you accept creating one: `gcloud secrets create ros-proxy-secret --data-file=<(openssl rand -hex 32)` and deploy with `PROXY_SECRET_REF=ros-proxy-secret:latest`.

## The one manual step (project owner, once, before the next deploy)

The frontends run as `ros-web`, which has no access to the secret yet:

```bash
gcloud secrets add-iam-policy-binding ros-cron-secret --project=restaurant-os-514008 \
  --member="serviceAccount:ros-web@restaurant-os-514008.iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

Expected: `gcloud secrets get-iam-policy ros-cron-secret` lists `ros-web` as `secretmanager.secretAccessor`. Without the binding the frontend deploy fails with "permission denied on secret" (the API deploy still succeeds, and the hop rule keeps applying until the frontends are redeployed).

Then push `staging` (or run **Deploy staging** manually inside a testing window); the workflow runs `deploy.sh` for the changed apps, and all four must be redeployed at least once (`APPS="api console ops admin"`) so every service holds the same secret version.

## Verify after the deploy

1. Sign in on the console, then open the workspace audit log: the `auth.signin` entry's IP is your own public address, not a `34.x`/`35.x` Google egress address.
2. From a second network (phone hotspot), ten wrong passwords for a throwaway email return 429; from the first network a wrong password still returns 401 (separate buckets).
3. The API log has no `client_ip_signature_rejected` warnings; a burst of them means the two sides hold different secret versions (`:latest` of the same secret on all four services).

Rollback: remove `PROXY_SHARED_SECRET` from the API (or from the frontends); the hop rule applies again immediately, nothing else changes.
