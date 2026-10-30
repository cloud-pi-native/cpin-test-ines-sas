#!/usr/bin/env bash
# Initialises the local Garage: layout, two buckets and two keys, each limited to its own bucket
# (simulates two separate S3 accounts). Idempotent: safe to run again.
set -euo pipefail

# Prevents Git Bash (Windows) from rewriting /garage into a Windows path.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
source .env
set +a

garage() {
  docker compose exec -T garage /garage "$@"
}

NODE_ID=$(garage node id -q | cut -d@ -f1)
if ! garage layout show | grep -q "${NODE_ID:0:16}"; then
  garage layout assign -z dc1 -c 1G "$NODE_ID"
  garage layout apply --version 1
fi

for ROLE in SENDER RECEIVER; do
  BUCKET_VAR="${ROLE}_S3_BUCKET"
  ACCESS_VAR="${ROLE}_S3_ACCESS_KEY"
  SECRET_VAR="${ROLE}_S3_SECRET_KEY"
  BUCKET="${!BUCKET_VAR}"
  KEY_NAME="${BUCKET}-dev"

  garage bucket info "$BUCKET" >/dev/null 2>&1 || garage bucket create "$BUCKET"
  garage key info "$KEY_NAME" >/dev/null 2>&1 || garage key import --yes -n "$KEY_NAME" "${!ACCESS_VAR}" "${!SECRET_VAR}"
  garage bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME"
done

echo "Garage ready: buckets ${SENDER_S3_BUCKET} and ${RECEIVER_S3_BUCKET}."
