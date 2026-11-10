#!/usr/bin/env bash
# One-time: lets GitHub Actions deploy STAGING through Workload Identity
# Federation (no service-account keys exist anywhere). Idempotent; run from
# the repo root by a project owner:  infra/gcp/setup-ci-identity.sh
#
# Creates nothing billable. What it sets up:
#   - pool `github` + provider `github-oidc`: accepts only OIDC tokens from
#     sourabhbhatt/restaurant-saas, ref refs/heads/staging, never pull requests
#   - service account ros-deployer, impersonable only through that provider
#   - least privilege for ros-deployer:
#       run.developer (deploy services and the migrate job, run the job)
#       actAs on the three runtime accounts (ros-api, ros-web, ros-migrate)
#       Artifact Registry writer on the `ros` repo only
#       custom role rosDeployerSql: read the instance and take backups —
#         it cannot start, stop or change Cloud SQL
#       Secret Manager: metadata only (no values) for the Razorpay/Resend
#         staging secrets (deploy.sh checks they exist), and read access to
#         the three staging seed passwords (smoke tests)
set -euo pipefail

PROJECT="${PROJECT:-restaurant-os-514008}"
REPO="${REPO:-sourabhbhatt/restaurant-saas}"
NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="ros-deployer@$PROJECT.iam.gserviceaccount.com"
gc() { gcloud --project="$PROJECT" --quiet "$@"; }

gc services enable sts.googleapis.com iamcredentials.googleapis.com

gc iam workload-identity-pools describe github --location=global >/dev/null 2>&1 \
  || gc iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gc iam workload-identity-pools providers describe github-oidc --location=global \
  --workload-identity-pool=github >/dev/null 2>&1 \
  || gc iam workload-identity-pools providers create-oidc github-oidc --location=global \
    --workload-identity-pool=github --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.event_name=assertion.event_name" \
    --attribute-condition="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/staging' && assertion.event_name != 'pull_request' && assertion.event_name != 'pull_request_target'"

gc iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || gc iam service-accounts create ros-deployer --display-name="GitHub Actions staging deployer (WIF, no keys)"

gc iam roles describe rosDeployerSql >/dev/null 2>&1 \
  || gc iam roles create rosDeployerSql --title="RestaurantOS deployer: SQL read + backups" \
    --permissions=cloudsql.instances.get,cloudsql.backupRuns.create,cloudsql.backupRuns.get,cloudsql.backupRuns.list \
    --stage=GA

for role in "projects/$PROJECT/roles/rosDeployerSql" roles/run.developer; do
  gc projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None >/dev/null
done
for runtime in ros-api ros-web ros-migrate; do
  gc iam service-accounts add-iam-policy-binding "$runtime@$PROJECT.iam.gserviceaccount.com" \
    --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser >/dev/null
done
gc artifacts repositories add-iam-policy-binding ros --location=asia-south1 \
  --member="serviceAccount:$SA" --role=roles/artifactregistry.writer >/dev/null
for secret in ros-staging-razorpay-key-id ros-staging-razorpay-key-secret ros-staging-razorpay-webhook-secret ros-staging-resend-api-key ros-staging-ga-api-secret; do
  gc secrets describe "$secret" >/dev/null 2>&1 || continue
  gc secrets add-iam-policy-binding "$secret" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.viewer --condition=None >/dev/null
done
for secret in ros-staging-seed-owner-password ros-staging-seed-staff-password ros-staging-seed-admin-password; do
  gc secrets add-iam-policy-binding "$secret" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
done
gc iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" >/dev/null

echo "GitHub repository variables to set (not secrets; nothing here is sensitive):"
echo "  GCP_PROJECT=$PROJECT"
echo "  GCP_PROJECT_NUMBER=$NUM"
echo "  GCP_WIF_PROVIDER=projects/$NUM/locations/global/workloadIdentityPools/github/providers/github-oidc"
echo "  GCP_DEPLOYER_SA=$SA"
