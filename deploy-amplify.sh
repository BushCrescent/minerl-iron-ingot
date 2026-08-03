#!/usr/bin/env bash
# Redeploy web/ to AWS Amplify Hosting.
#
#   ./deploy-amplify.sh
#
# Zips the site and pushes it through Amplify's manual-deployment API. No Git
# connection, no build step, no CI — the site is static, so this is the whole
# pipeline. Takes about 20 seconds.
set -euo pipefail

APP_ID="${AMPLIFY_APP_ID:-dqfv9j2jsw34b}"
BRANCH="${AMPLIFY_BRANCH:-main}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-west-2}"

cd "$(dirname "$0")"
[ -f web/index.html ] || { echo "web/index.html not found — run this from the repo root." >&2; exit 1; }

ZIP="$(mktemp -d)/site.zip"
( cd web && zip -qr "$ZIP" . -x 'bundle.js' -x '.DS_Store' -x '*/.DS_Store' )
echo "packaged $(unzip -l "$ZIP" | tail -1 | awk '{print $2}') files"

read -r JOB_ID UPLOAD_URL <<<"$(
  aws amplify create-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --output json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["jobId"], d["zipUploadUrl"])'
)"

curl -sS -X PUT --upload-file "$ZIP" "$UPLOAD_URL" -o /dev/null
aws amplify start-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" >/dev/null
echo "deployment $JOB_ID started"

for _ in $(seq 1 40); do
  STATUS="$(aws amplify get-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" \
            --query 'job.summary.status' --output text)"
  case "$STATUS" in
    SUCCEED)             echo "live: https://${BRANCH}.${APP_ID}.amplifyapp.com"; exit 0 ;;
    FAILED|CANCELLED)    echo "deployment $STATUS" >&2; exit 1 ;;
  esac
  sleep 3
done
echo "timed out waiting on deployment $JOB_ID (last status: $STATUS)" >&2
exit 1
