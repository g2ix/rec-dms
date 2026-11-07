#!/usr/bin/env bash
# Build the Times New Roman Gotenberg image and deploy recdms-pdf in Singapore.
# Run from the repository root, in Cloud Shell or any machine with gcloud.
# Create the two secrets first (see docs/DEPLOY.md). Do not pass passwords on the command line.
set -euo pipefail

PROJECT="${PROJECT:?Set PROJECT to the Google Cloud project id}"
TAG="${TAG:-8.40.0}"
REGION="asia-southeast1"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/recdms/gotenberg:${TAG}"

gcloud config set project "$PROJECT"

if ! gcloud artifacts repositories describe recdms --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create recdms \
    --repository-format=docker \
    --location="$REGION" \
    --description="REC-DMS images"
fi

gcloud builds submit docker/gotenberg --tag "$IMAGE" --project "$PROJECT"

gcloud run deploy recdms-pdf \
  --project "$PROJECT" \
  --image "$IMAGE" \
  --region "$REGION" \
  --memory 2Gi \
  --cpu 1 \
  --concurrency 4 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 120 \
  --ingress all \
  --allow-unauthenticated \
  --set-secrets "GOTENBERG_API_BASIC_AUTH_USERNAME=gotenberg-username:latest,GOTENBERG_API_BASIC_AUTH_PASSWORD=gotenberg-password:latest"

echo "Service URL:"
gcloud run services describe recdms-pdf --project "$PROJECT" --region "$REGION" --format='value(status.url)'
