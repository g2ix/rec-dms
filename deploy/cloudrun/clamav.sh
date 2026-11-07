#!/usr/bin/env bash
# Build and deploy recdms-scan in Singapore. The bearer token is clamav-token in Secret Manager.
set -euo pipefail

PROJECT="${PROJECT:?Set PROJECT to the Google Cloud project id}"
TAG="${TAG:-1.4.3}"
REGION="asia-southeast1"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/recdms/clamav:${TAG}"

gcloud config set project "$PROJECT"

if ! gcloud artifacts repositories describe recdms --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create recdms \
    --repository-format=docker \
    --location="$REGION" \
    --description="REC-DMS images"
fi

gcloud builds submit docker/clamav --tag "$IMAGE" --project "$PROJECT"

gcloud run deploy recdms-scan \
  --project "$PROJECT" \
  --image "$IMAGE" \
  --region "$REGION" \
  --memory 4Gi \
  --cpu 1 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 300 \
  --ingress all \
  --allow-unauthenticated \
  --set-secrets "CLAMAV_TOKEN=clamav-token:latest"

echo "Service URL:"
gcloud run services describe recdms-scan --project "$PROJECT" --region "$REGION" --format='value(status.url)'
