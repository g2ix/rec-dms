#!/bin/sh
set -eu

if [ -z "${DIRECT_URL:-}" ] || [ -z "${BACKUP_BUCKET:-}" ]; then
  echo "DIRECT_URL and BACKUP_BUCKET are required." >&2
  exit 1
fi

STAMP=$(date -u +%Y/%m/%d)
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

pg_dump --format=custom --no-owner --no-acl --dbname="$DIRECT_URL" --schema=recdms > "$WORKDIR/recdms.dump"
gzip -c "$WORKDIR/recdms.dump" > "$WORKDIR/recdms.dump.gz"

export RCLONE_CONFIG_GCS_TYPE="google cloud storage"
export RCLONE_CONFIG_GCS_BUCKET_POLICY_ONLY=true
rclone copyto "$WORKDIR/recdms.dump.gz" "gcs:${BACKUP_BUCKET}/db/${STAMP}.dump.gz"

if [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ACCESS_KEY:-}" ] && [ -n "${S3_SECRET_KEY:-}" ]; then
  export RCLONE_CONFIG_SRC_TYPE=s3
  export RCLONE_CONFIG_SRC_PROVIDER=Other
  export RCLONE_CONFIG_SRC_ENDPOINT="$S3_ENDPOINT"
  export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$S3_ACCESS_KEY"
  export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
  export RCLONE_CONFIG_SRC_REGION="${S3_REGION:-ap-southeast-1}"
  export RCLONE_CONFIG_SRC_FORCE_PATH_STYLE=true
  rclone sync "src:${S3_BUCKET}" "gcs:${BACKUP_BUCKET}/files" --fast-list
fi

if [ -n "${APP_BASE_URL:-}" ] && [ -n "${CRON_SECRET:-}" ]; then
  curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" "${APP_BASE_URL%/}/api/cron/backup-stamp"
fi

echo "Backup stored at gs://${BACKUP_BUCKET}/db/${STAMP}.dump.gz"
