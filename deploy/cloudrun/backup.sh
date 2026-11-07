#!/usr/bin/env bash
# Private Singapore bucket, Cloud Run Job recdms-backup, and a 01:00 Asia/Manila schedule.
# Secrets: backup-direct-url, s3-access-key, s3-secret-key, cron-secret.
set -euo pipefail

PROJECT="${PROJECT:?Set PROJECT}"
BUCKET="${BUCKET:?Set BUCKET to the globally unique bucket name}"
APP_BASE_URL="${APP_BASE_URL:?Set APP_BASE_URL}"
S3_ENDPOINT="${S3_ENDPOINT:?Set S3_ENDPOINT}"
S3_BUCKET="${S3_BUCKET:?Set S3_BUCKET}"
REGION="asia-southeast1"
TAG="${TAG:-17}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/recdms/backup:${TAG}"
SCHEDULER_SA="${SCHEDULER_SA:?Set SCHEDULER_SA to a service account email that can run Cloud Run jobs}"

gcloud config set project "$PROJECT"

if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --project "$PROJECT" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi
gcloud storage buckets update "gs://${BUCKET}" --versioning
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file=deploy/cloudrun/backup-lifecycle.json

if ! gcloud artifacts repositories describe recdms --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create recdms --repository-format=docker --location="$REGION"
fi

gcloud builds submit docker/backup --tag "$IMAGE" --project "$PROJECT"

gcloud run jobs deploy recdms-backup \
  --project "$PROJECT" \
  --image "$IMAGE" \
  --region "$REGION" \
  --tasks 1 \
  --max-retries 1 \
  --task-timeout 3600 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "BACKUP_BUCKET=${BUCKET},S3_ENDPOINT=${S3_ENDPOINT},S3_BUCKET=${S3_BUCKET},S3_REGION=ap-southeast-1,APP_BASE_URL=${APP_BASE_URL}" \
  --set-secrets "DIRECT_URL=backup-direct-url:latest,S3_ACCESS_KEY=s3-access-key:latest,S3_SECRET_KEY=s3-secret-key:latest,CRON_SECRET=cron-secret:latest"

# The job's runtime service account needs objectAdmin on the bucket.
JOB_SA=$(gcloud run jobs describe recdms-backup --region "$REGION" --format='value(spec.template.spec.serviceAccountName)')
if [ -z "$JOB_SA" ]; then
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
  JOB_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${JOB_SA}" \
  --role="roles/storage.objectAdmin"

gcloud run jobs add-iam-policy-binding recdms-backup \
  --region "$REGION" \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role="roles/run.invoker"

URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/recdms-backup:run"
if gcloud scheduler jobs describe recdms-backup-nightly --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http recdms-backup-nightly \
    --location="$REGION" \
    --schedule="0 1 * * *" \
    --time-zone="Asia/Manila" \
    --uri="$URI" \
    --http-method=POST \
    --oauth-service-account-email="$SCHEDULER_SA"
else
  gcloud scheduler jobs create http recdms-backup-nightly \
    --location="$REGION" \
    --schedule="0 1 * * *" \
    --time-zone="Asia/Manila" \
    --uri="$URI" \
    --http-method=POST \
    --oauth-service-account-email="$SCHEDULER_SA"
fi

echo "Job recdms-backup will run at 01:00 Asia/Manila into gs://${BUCKET}"
