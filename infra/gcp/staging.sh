#!/usr/bin/env bash
# RestaurantOS staging power switch (personal testing, minimum cost).
#
#   infra/gcp/staging.sh start [hours]    start Cloud SQL for a testing window (default 4 h)
#   infra/gcp/staging.sh extend [hours]   push the window end out from now
#   infra/gcp/staging.sh stop             stop Cloud SQL now (data, backups, secrets kept)
#   infra/gcp/staging.sh status           database, window, Cloud Run, guard, cost rates
#   infra/gcp/staging.sh install-guard    (once) hourly auto-stop job, free tier
#   infra/gcp/staging.sh guard            what the hourly job runs: stop if past the window
#
# Cloud Run services always scale to zero, so the database is the only thing that
# costs money while idle. The guard stops it when the testing window has passed,
# when no window was set (e.g. Google started a stopped instance for maintenance),
# or when it runs on its own. Nothing here deletes anything.
set -euo pipefail

PROJECT="${PROJECT:-restaurant-os-514008}"
REGION="${REGION:-asia-south1}"
INSTANCE="${INSTANCE:-ros-pg18}"
LABEL="staging-until"
GUARD_SA="ros-sql-guard@$PROJECT.iam.gserviceaccount.com"
GUARD_JOB="ros-sql-guard"
GUARD_SCHEDULE="${GUARD_SCHEDULE:-17 * * * *}"   # every hour at :17
# Mumbai list prices (Cloud Billing catalog, 2026-11-08), INR.
RATE_RUNNING_HOUR="4.00"    # db-g1-small, zonal
RATE_IP_STOPPED_HOUR="1.14" # public IPv4 is billed only while the instance is stopped
STORAGE_MONTH="194"         # 10 GB SSD
gc() { gcloud --project="$PROJECT" --quiet "$@"; }

sql_field() { gc sql instances describe "$INSTANCE" --format="value($1)"; }
# gcloud has no label flag for Cloud SQL; the Admin API merges userLabels on PATCH.
# "0" means no testing window (labels are never removed, only overwritten).
set_label() {
  curl -fsS -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "content-type: application/json" \
    "https://sqladmin.googleapis.com/v1/projects/$PROJECT/instances/$INSTANCE" \
    -d "{\"settings\":{\"userLabels\":{\"$LABEL\":\"$1\"}}}" >/dev/null
}
now() { date +%s; }
fmt() { date -r "$1" '+%Y-%m-%d %H:%M %Z' 2>/dev/null || date -d "@$1" '+%Y-%m-%d %H:%M %Z'; }

set_window() {
  local hours="${1:-4}"
  [[ "$hours" =~ ^[0-9]+$ ]] && ((hours >= 1 && hours <= 24)) || { echo "hours must be 1-24"; exit 1; }
  local until=$(($(now) + hours * 3600))
  set_label "$until"
  echo "testing window ends $(fmt "$until") (${hours} h); the guard stops the database after that"
}

wait_state() {
  local want="$1" i
  for i in $(seq 1 60); do
    [ "$(sql_field state)" = "$want" ] && return 0
    sleep 10
  done
  echo "timed out waiting for $want"; exit 1
}

cmd_start() {
  if [ "$(sql_field settings.activationPolicy)" != "ALWAYS" ]; then
    echo "starting Cloud SQL $INSTANCE (about 1-3 minutes)…"
    gc sql instances patch "$INSTANCE" --activation-policy=ALWAYS >/dev/null
  fi
  wait_state RUNNABLE
  set_window "${1:-4}"
  local num; num="$(gc projects describe "$PROJECT" --format='value(projectNumber)')"
  local api="https://ros-api-staging-$num.$REGION.run.app"
  if gc run services describe ros-api-staging --region="$REGION" --format='value(metadata.name)' >/dev/null 2>&1; then
    printf 'API readiness: '; curl -s -o /dev/null -w '%{http_code}\n' "$api/api/v1/health/ready" || true
  fi
  echo "running: about ₹${RATE_RUNNING_HOUR}/hour for the database; Cloud Run bills only while requests run"
}

cmd_extend() {
  [ "$(sql_field settings.activationPolicy)" = "ALWAYS" ] || { echo "database is stopped; use start"; exit 1; }
  set_window "${1:-2}"
}

cmd_stop() {
  if [ "$(sql_field settings.activationPolicy)" = "NEVER" ]; then
    echo "already stopped"
  else
    echo "stopping Cloud SQL $INSTANCE (data, backups and settings are kept)…"
    gc sql instances patch "$INSTANCE" --activation-policy=NEVER >/dev/null
  fi
  set_label 0 || true
  echo "stopped: about ₹${RATE_IP_STOPPED_HOUR}/hour for the reserved IP plus ₹${STORAGE_MONTH}/month storage"
}

cmd_guard() {
  local policy until
  policy="$(sql_field settings.activationPolicy)"
  if [ "$policy" != "ALWAYS" ]; then echo "guard: stopped, nothing to do"; return 0; fi
  until="$(sql_field "settings.userLabels.$LABEL")"
  if [[ "$until" =~ ^[0-9]+$ ]] && (($(now) < until)); then
    echo "guard: inside the testing window (until $(fmt "$until")), leaving it running"
    return 0
  fi
  echo "guard: running ${until:+past its window }${until:-without a testing window}; stopping"
  gc sql instances patch "$INSTANCE" --activation-policy=NEVER >/dev/null
  set_label 0 || true
}

cmd_status() {
  local state policy until
  state="$(sql_field state)"; policy="$(sql_field settings.activationPolicy)"
  until="$(sql_field "settings.userLabels.$LABEL")"
  echo "Cloud SQL $INSTANCE: state=$state policy=$policy tier=$(sql_field settings.tier)"
  if [[ "$until" =~ ^[0-9]+$ ]] && ((until > $(now))); then
    echo "  testing window ends $(fmt "$until") ($(((until - $(now)) / 60)) min left)"
  else
    echo "  no active testing window"
  fi
  echo "  last backups:"
  gc sql backups list --instance="$INSTANCE" --limit=3 \
    --format="value(windowStartTime.date('%Y-%m-%d %H:%M'),type,status)" | sed 's/^/    /'
  echo "Cloud Run (all scale to zero):"
  local svc mn mx
  for svc in $(gc run services list --region="$REGION" --format="value(metadata.name)" 2>/dev/null); do
    mn="$(gc run services describe "$svc" --region="$REGION" --format="value(spec.template.metadata.annotations['autoscaling.knative.dev/minScale'])")"
    mx="$(gc run services describe "$svc" --region="$REGION" --format="value(spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'])")"
    printf '  %-22s min=%s max=%s\n' "$svc" "${mn:-0}" "${mx:-default}"
  done
  printf 'Guard: '
  gc scheduler jobs describe "$GUARD_JOB" --location="$REGION" --format="value(state,schedule)" 2>/dev/null || echo "not installed (run install-guard)"
  echo "Cost rates (INR, Mumbai list): running ₹${RATE_RUNNING_HOUR}/h (≈₹96/day); stopped ₹${RATE_IP_STOPPED_HOUR}/h IP + ₹${STORAGE_MONTH}/mo storage (≈₹34/day)"
  echo "Budget: $(gcloud billing budgets list --billing-account="$(gc billing projects describe "$PROJECT" --format='value(billingAccountName)' | sed 's#billingAccounts/##')" --format="value(displayName,amount.specifiedAmount.units)" | tr '\t' ' ' | paste -sd ';' -)"
}

cmd_install_guard() {
  echo "== service account and minimal custom role"
  gc iam service-accounts describe "$GUARD_SA" >/dev/null 2>&1 \
    || gc iam service-accounts create ros-sql-guard --display-name="Stops staging Cloud SQL outside testing windows"
  gc iam roles describe rosSqlGuard >/dev/null 2>&1 \
    || gc iam roles create rosSqlGuard --title="RestaurantOS SQL guard" \
      --permissions=cloudsql.instances.get,cloudsql.instances.update --stage=GA
  gc projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$GUARD_SA" \
    --role="projects/$PROJECT/roles/rosSqlGuard" --condition=None >/dev/null
  echo "== Cloud Run job (gcloud image, runs this script's guard logic)"
  local script
  script="$(declare -f now fmt sql_field set_label gc cmd_guard); PROJECT=$PROJECT INSTANCE=$INSTANCE LABEL=$LABEL; cmd_guard"
  gc run jobs deploy "$GUARD_JOB" --region="$REGION" \
    --image=gcr.io/google.com/cloudsdktool/google-cloud-cli:slim \
    --service-account="$GUARD_SA" --command=bash --args="^##^-c##$script" \
    --cpu=1 --memory=512Mi --max-retries=0 --task-timeout=300s --labels=env=staging,app=sql-guard
  gc run jobs add-iam-policy-binding "$GUARD_JOB" --region="$REGION" \
    --member="serviceAccount:$GUARD_SA" --role=roles/run.invoker >/dev/null
  echo "== Cloud Scheduler: $GUARD_SCHEDULE (Asia/Kolkata)"
  local uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$GUARD_JOB:run"
  if gc scheduler jobs describe "$GUARD_JOB" --location="$REGION" >/dev/null 2>&1; then
    gc scheduler jobs update http "$GUARD_JOB" --location="$REGION" --schedule="$GUARD_SCHEDULE" \
      --time-zone=Asia/Kolkata --uri="$uri" --http-method=POST --oauth-service-account-email="$GUARD_SA" >/dev/null
  else
    gc scheduler jobs create http "$GUARD_JOB" --location="$REGION" --schedule="$GUARD_SCHEDULE" \
      --time-zone=Asia/Kolkata --uri="$uri" --http-method=POST --oauth-service-account-email="$GUARD_SA" >/dev/null
  fi
  echo "guard installed: hourly, stops Cloud SQL outside a testing window"
}

case "${1:-status}" in
  start) cmd_start "${2:-4}" ;;
  extend) cmd_extend "${2:-2}" ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  guard) cmd_guard ;;
  install-guard) cmd_install_guard ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
