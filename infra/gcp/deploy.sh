#!/usr/bin/env bash
# Deploys RestaurantOS to Cloud Run (asia-south1) from images already pushed by
# infra/gcp/cloudbuild.yaml. Idempotent: re-run with a new TAG to roll out.
#   TAG=$(git rev-parse --short HEAD) infra/gcp/deploy.sh
# Order: on-demand Cloud SQL backup → migrate job → api → console, ops, admin.
# Payments stay off (PAYMENT_PROVIDER=none) until Razorpay keys are added.
set -euo pipefail

PROJECT="${PROJECT:-restaurant-os-514008}"
REGION="${REGION:-asia-south1}"
TAG="${TAG:?set TAG to the image tag (git short sha)}"
INSTANCE="${INSTANCE:-ros-pg18}"
CONN="$PROJECT:$REGION:$INSTANCE"
REPO="$REGION-docker.pkg.dev/$PROJECT/ros"
NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
url() { echo "https://ros-$1-$NUM.$REGION.run.app"; }
API_URL="$(url api)"
CONSOLE_URL="$(url console)"
OPS_URL="$(url ops)"
ADMIN_URL="$(url admin)"

echo "== on-demand backup before migrating"
gcloud sql backups create --instance="$INSTANCE" --project="$PROJECT" \
  --description="pre-deploy $TAG" --quiet

echo "== migrate job"
gcloud run jobs deploy ros-migrate --project="$PROJECT" --region="$REGION" \
  --image="$REPO/migrate:$TAG" \
  --service-account="ros-migrate@$PROJECT.iam.gserviceaccount.com" \
  --set-cloudsql-instances="$CONN" \
  --set-env-vars="DATABASE_PROVIDER=postgres,NODE_ENV=production" \
  --set-secrets="DATABASE_URL=ros-owner-database-url:latest" \
  --max-retries=0 --task-timeout=600s --quiet
gcloud run jobs execute ros-migrate --project="$PROJECT" --region="$REGION" --wait

echo "== api"
API_ENV="NODE_ENV=production,APP_VERSION=$TAG,APP_URL=$CONSOLE_URL,QR_BASE_URL=$CONSOLE_URL"
API_ENV+=",TRUSTED_PROXY_HOPS=1,DATABASE_PROVIDER=postgres,DATABASE_TENANT_ROLE=ros_tenant,DATABASE_POOL_MAX=5"
API_ENV+=",REALTIME_PROVIDER=postgres,STORAGE_PROVIDER=gcs,GCS_BUCKET=ros-uploads-514008"
API_ENV+=",EMAIL_PROVIDER=outbox,PAYMENT_PROVIDER=none,PUSH_PROVIDER=none"
gcloud run deploy ros-api --project="$PROJECT" --region="$REGION" \
  --image="$REPO/api:$TAG" \
  --service-account="ros-api@$PROJECT.iam.gserviceaccount.com" \
  --set-cloudsql-instances="$CONN" \
  --set-env-vars="^@^${API_ENV//,/@}@ALLOWED_ORIGINS=$CONSOLE_URL,$OPS_URL,$ADMIN_URL" \
  --set-secrets="DATABASE_URL=ros-database-url:latest,APP_SECRET=ros-app-secret:latest,CRON_SECRET=ros-cron-secret:latest" \
  --port=3000 --cpu=1 --memory=512Mi --concurrency=80 \
  --min-instances=0 --max-instances=3 --timeout=3600 \
  --allow-unauthenticated --quiet

for app in console ops admin; do
  echo "== $app"
  gcloud run deploy "ros-$app" --project="$PROJECT" --region="$REGION" \
    --image="$REPO/$app:$TAG" \
    --service-account="ros-web@$PROJECT.iam.gserviceaccount.com" \
    --set-env-vars="NODE_ENV=production,APP_VERSION=$TAG,API_INTERNAL_URL=$API_URL,CONSOLE_URL=$CONSOLE_URL,OPS_URL=$OPS_URL,ADMIN_URL=$ADMIN_URL" \
    --port=3000 --cpu=1 --memory=512Mi --concurrency=80 \
    --min-instances=0 --max-instances=2 --timeout=3600 \
    --allow-unauthenticated --quiet
done

echo "== smoke"
for u in "$API_URL/api/v1/health/ready" "$CONSOLE_URL/healthz" "$OPS_URL/healthz" "$ADMIN_URL/healthz"; do
  printf '%-75s ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "$u"
done
echo "console $CONSOLE_URL"; echo "ops     $OPS_URL"; echo "admin   $ADMIN_URL"; echo "api     $API_URL"
