# Rollout: signed client IP between the frontends and the API (staging)

**Why.** On Cloud Run the frontends call the API's public URL, so the API's `X-Forwarded-For` ends with the _frontend's_ egress address and every browser behind one frontend instance shares the per-IP sign-in, sign-up and guest-ordering limits (ten sign-ups per hour for everyone, for example). Trusting a second hop would let anyone who can reach the API URL pick their own address. With `PROXY_SHARED_SECRET` set on both sides, the frontend proxy signs the browser's address (`x-ros-client-ip` + `x-ros-client-ip-signature`, HMAC-SHA256, 60 s replay window) and the API uses it; see [environment variables](../environment-variables.md#proxy_shared_secret-the-client-ip-when-the-frontends-reach-the-api-over-its-public-url).

No new cloud resource is needed: the existing `ros-cron-secret` is mounted into the four services as `PROXY_SHARED_SECRET` (domain separation is by header format, and the value never reaches a browser). A dedicated `ros-proxy-secret` is cleaner if you are willing to create one secret; set `PROXY_SECRET_REF=ros-proxy-secret:latest` when deploying.

## One-time IAM step (project owner, before the first deploy)

The frontends run as `ros-web`, which has no secret access today:

```bash
gcloud secrets add-iam-policy-binding ros-cron-secret --project=restaurant-os-514008 \
  --member="serviceAccount:ros-web@restaurant-os-514008.iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

Expected: the binding is listed by `gcloud secrets get-iam-policy ros-cron-secret`. Without it the frontend deploy fails with "permission denied on secret".

## Change to `infra/gcp/deploy.sh` (on the `staging` branch)

Apply the next staging deploy with this diff; the API keeps `TRUSTED_PROXY_HOPS=1` as the fallback and the frontends get the same secret plus their own hop count.

```diff
@@ API_SECRETS
 API_SECRETS="DATABASE_URL=ros-database-url:latest,APP_SECRET=ros-app-secret:latest,CRON_SECRET=ros-cron-secret:latest"
+# The frontends sign the browser's address for the API (x-ros-client-ip); both sides share this value.
+# Reuses the existing ros-cron-secret, so no new Secret Manager resource is created. ros-web needs
+# roles/secretmanager.secretAccessor on it once (see docs/deployment.md, Cloud Run notes).
+PROXY_SECRET_REF="${PROXY_SECRET_REF:-ros-cron-secret:latest}"
+API_SECRETS+=",PROXY_SHARED_SECRET=$PROXY_SECRET_REF"
 if has_secret ros-staging-razorpay-key-id && ...
@@ frontends
   gcloud run deploy "$(svc "$app")" --project="$PROJECT" --region="$REGION" \
     --image="$REPO/$app:$TAG" \
     --service-account="ros-web@$PROJECT.iam.gserviceaccount.com" \
-    --set-env-vars="NODE_ENV=production,APP_VERSION=$TAG,API_INTERNAL_URL=$API_URL,CONSOLE_URL=$CONSOLE_URL,OPS_URL=$OPS_URL,ADMIN_URL=$ADMIN_URL" \
+    --set-env-vars="NODE_ENV=production,APP_VERSION=$TAG,API_INTERNAL_URL=$API_URL,CONSOLE_URL=$CONSOLE_URL,OPS_URL=$OPS_URL,ADMIN_URL=$ADMIN_URL,TRUSTED_PROXY_HOPS=1" \
+    --set-secrets="PROXY_SHARED_SECRET=$PROXY_SECRET_REF" \
     --labels="env=$ENVIRONMENT,app=$app" \
```

## Verify after the deploy

1. Sign in on the console, then open the workspace audit log: the `auth.signin` entry's IP is your own public address, not a `34.x`/`35.x` Google egress address.
2. From a second network (phone hotspot), ten wrong passwords for a throwaway email return 429; from the first network a wrong password still returns 401 (separate buckets).
3. The API log has no `client_ip_signature_rejected` warnings; a burst of them means the two sides hold different secret versions (`:latest` of the same secret on all four services).

Rollback: remove `PROXY_SHARED_SECRET` from the API (or from the frontends); the hop rule applies again immediately, nothing else changes.
