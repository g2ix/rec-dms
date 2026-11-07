#!/usr/bin/env bash
# Restore one custom-format dump into the database named by DIRECT_URL, then verify the audit chain.
# Point DIRECT_URL at a fresh Supabase project. Do not point it at production.
set -euo pipefail

DUMP="${1:?Pass the path to YYYY-MM-DD.dump.gz}"
if [ -z "${DIRECT_URL:-}" ]; then
  echo "Set DIRECT_URL to the empty project's session pooler URL." >&2
  exit 1
fi

case "$DIRECT_URL" in
  *jrgsxhcegqstegpqgbyv*)
    echo "Refusing to restore into the development project." >&2
    exit 1
    ;;
esac

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
gunzip -c "$DUMP" > "$WORKDIR/recdms.dump"
pg_restore --no-owner --no-acl --dbname="$DIRECT_URL" "$WORKDIR/recdms.dump"
pnpm audit:verify
echo "Restore finished and the audit chain verified."
