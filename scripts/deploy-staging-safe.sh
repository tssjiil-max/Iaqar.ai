#!/usr/bin/env bash
# Staging-only safe deploy. Refuses main/production, dirty trees, and SHA drift.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REQUIRED_BRANCH="codex/unified-staging-lineage-2026-08-29"
STAGING_FIREBASE_PROJECT="iaqar-ai-staging"
APPROVED_HOSTING="https://iaqar-ai-staging--staging-9c4b0k7h.web.app"
CURRENT_STAGE="bootstrap"

diag_failure() {
  local rc="${1:-1}"
  echo "::error title=Staging deploy diagnostic::stage=${CURRENT_STAGE} exit_code=${rc}" >&2
}

trap 'rc=$?; diag_failure "$rc"' ERR

die() {
  local message="$1"
  local rc="${2:-1}"
  echo "ERROR: ${message}" >&2
  diag_failure "$rc"
  exit "$rc"
}

if [[ "${IAQAR_DEPLOY_TARGET:-staging}" != "staging" ]]; then
  die "IAQAR_DEPLOY_TARGET must be staging. Refusing."
fi
if [[ "${1:-}" == "--production" || "${1:-}" == "production" ]]; then
  die "deploy:staging:safe cannot deploy production."
fi
if [[ "${FIREBASE_PROJECT:-}" == "aqar-b5d76" || "${GCLOUD_PROJECT:-}" == "aqar-b5d76" ]]; then
  die "Production Firebase project is forbidden on this path."
fi

echo "=== IAQAR safe staging deploy ==="
echo "Approved hosting: ${APPROVED_HOSTING}"
echo "Firebase project: ${STAGING_FIREBASE_PROJECT}"
echo "Required branch: ${REQUIRED_BRANCH}"

CURRENT_STAGE="release-guard"
node scripts/staging-release-guard.mjs "$@"

echo "--- Test gate ---"
CURRENT_STAGE="npm-test"
npm test
CURRENT_STAGE="npm-check"
npm run check

echo "--- Generate public/version.json from current Git commit ---"
trap 'rm -f "$ROOT/public/version.json"' EXIT
rm -f "$ROOT/public/version.json"
CURRENT_STAGE="write-version"
node scripts/write-staging-version.mjs

export IAQAR_DEPLOY_TARGET="staging"
export IAQAR_SKIP_INNER_TESTS="1"
export STAGING_HOSTING_URL="${APPROVED_HOSTING}"
export FIREBASE_STAGING_PROJECT_ID="${STAGING_FIREBASE_PROJECT}"

echo "--- Staging deploy only (Worker --env staging + Hosting channel staging) ---"
CURRENT_STAGE="staging-deploy"
bash scripts/deploy-staging.sh

echo "--- Verify published version.json matches local HEAD ---"
export STAGING_HOSTING_URL="${APPROVED_HOSTING}"
CURRENT_STAGE="verify-published-version"
node scripts/verify-staging-release.mjs

CURRENT_STAGE="complete"
echo "=== Safe staging deploy verified on ${APPROVED_HOSTING} ==="
