#!/usr/bin/env bash
# Five HTTP schedules in Asia/Manila. The bearer token is read from Secret Manager
# at create time and stored in the job. Re-run this script after rotating cron-secret.
set -euo pipefail

PROJECT="${PROJECT:?Set PROJECT}"
APP_BASE_URL="${APP_BASE_URL:?Set APP_BASE_URL without a trailing slash}"
REGION="asia-southeast1"

gcloud config set project "$PROJECT"
TOKEN=$(gcloud secrets versions access latest --secret=cron-secret)

upsert() {
  local name="$1"
  local schedule="$2"
  local path="$3"
  local deadline="$4"
  if gcloud scheduler jobs describe "$name" --location="$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" \
      --location="$REGION" \
      --schedule="$schedule" \
      --time-zone="Asia/Manila" \
      --uri="${APP_BASE_URL}${path}" \
      --http-method=POST \
      --update-headers="Authorization=Bearer ${TOKEN}" \
      --attempt-deadline="$deadline" \
      --max-retry-attempts=3 \
      --min-backoff=10s \
      --max-backoff=120s
  else
    gcloud scheduler jobs create http "$name" \
      --location="$REGION" \
      --schedule="$schedule" \
      --time-zone="Asia/Manila" \
      --uri="${APP_BASE_URL}${path}" \
      --http-method=POST \
      --headers="Authorization=Bearer ${TOKEN}" \
      --attempt-deadline="$deadline" \
      --max-retry-attempts=3 \
      --min-backoff=10s \
      --max-backoff=120s
  fi
}

upsert recdms-cron-jobs "* * * * *" "/api/cron/jobs" "50s"
upsert recdms-cron-sla "0 * * * *" "/api/cron/sla" "180s"
upsert recdms-cron-digest "0 7 * * *" "/api/cron/digest" "180s"
upsert recdms-cron-audit "0 2 * * *" "/api/cron/audit-verify" "180s"
upsert recdms-cron-retention "0 3 * * 1" "/api/cron/retention" "180s"

echo "Cloud Scheduler jobs are in ${REGION}, time zone Asia/Manila."
