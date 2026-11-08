#!/usr/bin/env bash
# Deploys the RestaurantOS STAGING environment to Cloud Run (asia-south1) from
# images already pushed by infra/gcp/cloudbuild.yaml. Idempotent: re-run with a
# new TAG to roll out. Deploy one app with APPS="console" (default: all four).
#   TAG=$(git rev-parse --short HEAD) infra/gcp/deploy.sh
# Order: on-demand Cloud SQL backup → migrate job → api → console, ops, admin.
# This project is staging only; production gets its own project (design §11).
# Razorpay runs in TEST mode when the three ros-staging-razorpay-* secrets exist
# (the API refuses rzp_live_ keys); otherwise PAYMENT_PROVIDER=none.
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-staging}"
[ "$ENVIRONMENT" = "staging" ] || { echo "This project hosts staging only (got ENVIRONMENT=$ENVIRONMENT)"; exit 1; }
APPS="${APPS:-api console ops admin}"

PROJECT="${PROJECT:-restaurant-os-514008}"
REGION="${REGION:-asia-south1}"
TAG="${TAG:?set TAG to the image tag (git short sha)}"
INSTANCE="${INSTANCE:-ros-pg18}"
CONN="$PROJECT:$REGION:$INSTANCE"
REPO="$REGION-docker.pkg.dev/$PROJECT/ros"
NUM="${PROJECT_NUMBER:-$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')}"
# CI may not change IAM: services keep their existing public-invoker policy.
PUBLIC_FLAG="--allow-unauthenticated"
[ "${CI_DEPLOY:-}" = "1" ] && PUBLIC_FLAG=""
svc() { echo "ros-$1-$ENVIRONMENT"; }
url() { echo "https://$(svc "$1")-$NUM.$REGION.run.app"; }
has_secret() { gcloud secrets versions list "$1" --project="$PROJECT" --filter=state=ENABLED --format='value(name)' 2>/dev/null | grep -q .; }
want() { [[ " $APPS " == *" $1 "* ]]; }
API_URL="$(url api)"
CONSOLE_URL="$(url console)"
OPS_URL="$(url ops)"
ADMIN_URL="$(url admin)"

if [ "$(gcloud sql instances describe "$INSTANCE" --project="$PROJECT" --format='value(settings.activationPolicy)')" != "ALWAYS" ]; then
  echo "Cloud SQL is stopped. Run: infra/gcp/staging.sh start   (then re-run this deploy)"; exit 1
fi

if want api; then
echo "== on-demand backup before migrating"
gcloud sql backups create --instance="$INSTANCE" --project="$PROJECT" \
  --description="pre-deploy $TAG" --quiet

echo "== migrate job"
gcloud run jobs deploy "ros-migrate-$ENVIRONMENT" --project="$PROJECT" --region="$REGION" \
  --image="$REPO/migrate:$TAG" \
  --service-account="ros-migrate@$PROJECT.iam.gserviceaccount.com" \
  --set-cloudsql-instances="$CONN" \
  --set-env-vars="DATABASE_PROVIDER=postgres,NODE_ENV=production" \
  --set-secrets="DATABASE_URL=ros-owner-database-url:latest" \
  --max-retries=0 --task-timeout=600s --quiet
gcloud run jobs execute "ros-migrate-$ENVIRONMENT" --project="$PROJECT" --region="$REGION" --wait

echo "== api"
API_ENV="NODE_ENV=production,APP_VERSION=$TAG,APP_URL=$CONSOLE_URL,QR_BASE_URL=$CONSOLE_URL"
API_ENV+=",TRUSTED_PROXY_HOPS=1,DATABASE_PROVIDER=postgres,DATABASE_TENANT_ROLE=ros_tenant,DATABASE_POOL_MAX=5"
API_ENV+=",REALTIME_PROVIDER=postgres,STORAGE_PROVIDER=gcs,GCS_BUCKET=ros-uploads-514008"
API_ENV+=",EMAIL_PROVIDER=outbox,PUSH_PROVIDER=none"
API_SECRETS="DATABASE_URL=ros-database-url:latest,APP_SECRET=ros-app-secret:latest,CRON_SECRET=ros-cron-secret:latest"
if has_secret ros-staging-razorpay-key-id && has_secret ros-staging-razorpay-key-secret && has_secret ros-staging-razorpay-webhook-secret; then
  echo "   Razorpay TEST mode (secrets present)"
  API_ENV+=",PAYMENT_PROVIDER=razorpay"
  API_SECRETS+=",RAZORPAY_KEY_ID=ros-staging-razorpay-key-id:latest,RAZORPAY_KEY_SECRET=ros-staging-razorpay-key-secret:latest,RAZORPAY_WEBHOOK_SECRET=ros-staging-razorpay-webhook-secret:latest"
else
  echo "   payments off (no ros-staging-razorpay-* secrets)"
  API_ENV+=",PAYMENT_PROVIDER=none"
fi
if has_secret ros-staging-resend-api-key; then
  API_ENV="${API_ENV/EMAIL_PROVIDER=outbox/EMAIL_PROVIDER=resend}"
  API_ENV+=",EMAIL_FROM=${EMAIL_FROM:-RestaurantOS Staging <onboarding@resend.dev>}"
  API_SECRETS+=",RESEND_API_KEY=ros-staging-resend-api-key:latest"
fi
gcloud run deploy "$(svc api)" --project="$PROJECT" --region="$REGION" \
  --image="$REPO/api:$TAG" \
  --service-account="ros-api@$PROJECT.iam.gserviceaccount.com" \
  --set-cloudsql-instances="$CONN" \
  --set-env-vars="^@^${API_ENV//,/@}@ALLOWED_ORIGINS=$CONSOLE_URL,$OPS_URL,$ADMIN_URL" \
  --set-secrets="$API_SECRETS" \
  --labels="env=$ENVIRONMENT,app=api" \
  --port=3000 --cpu=1 --memory=512Mi --concurrency=80 \
  --min-instances=0 --max-instances=3 --timeout=3600 \
  $PUBLIC_FLAG --quiet
fi

for app in console ops admin; do
  want "$app" || continue
  echo "== $app"
  gcloud run deploy "$(svc "$app")" --project="$PROJECT" --region="$REGION" \
    --image="$REPO/$app:$TAG" \
    --service-account="ros-web@$PROJECT.iam.gserviceaccount.com" \
    --set-env-vars="NODE_ENV=production,APP_VERSION=$TAG,API_INTERNAL_URL=$API_URL,CONSOLE_URL=$CONSOLE_URL,OPS_URL=$OPS_URL,ADMIN_URL=$ADMIN_URL" \
    --labels="env=$ENVIRONMENT,app=$app" \
    --port=3000 --cpu=1 --memory=512Mi --concurrency=80 \
    --min-instances=0 --max-instances=2 --timeout=3600 \
    $PUBLIC_FLAG --quiet
done

echo "== smoke"
for u in "$API_URL/api/v1/health/ready" "$CONSOLE_URL/health" "$OPS_URL/health" "$ADMIN_URL/health"; do
  printf '%-75s ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "$u"
done
echo "console $CONSOLE_URL"; echo "ops     $OPS_URL"; echo "admin   $ADMIN_URL"; echo "api     $API_URL"
echo "Razorpay webhook URL (test mode): $API_URL/api/v1/webhooks/razorpay"
