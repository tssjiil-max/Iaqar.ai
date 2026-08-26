#!/usr/bin/env bash
# Production pilot deploy — owner-run only. Refuses staging credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PRODUCTION_PROJECT="aqar-b5d76"
PRODUCTION_HOST="https://iaqar.ai"

die() { echo "ERROR: $*" >&2; exit 1; }

if [[ "${IAQAR_DEPLOY_TARGET:-}" == "staging" ]]; then
  die "Use deploy-staging.sh for staging. This script is production-only."
fi

if [[ -z "${FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON:-}" ]]; then
  die "FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON is required for production Firebase deploy."
fi

if node -e "
  const sa = JSON.parse(process.env.FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON || '{}');
  if (sa.project_id !== '${PRODUCTION_PROJECT}') process.exit(2);
" 2>/dev/null; then
  :
else
  die "Production service account must target project ${PRODUCTION_PROJECT}."
fi

echo "=== Production pilot preflight ==="
echo "Host: ${PRODUCTION_HOST}"
echo "Firebase project: ${PRODUCTION_PROJECT}"

echo "--- Test gate ---"
npm test
npm run test:rules
npm run check

echo "--- Generate version.json ---"
node scripts/write-staging-version.mjs --channel=production

echo "--- Deploy production Worker ---"
(cd worker && npx wrangler deploy)

echo "--- Deploy Firestore rules, indexes, Hosting ---"
node scripts/staging-gac.mjs --from-env FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON
export GOOGLE_APPLICATION_CREDENTIALS="${IAQAR_TEMP_GAC:-}"
firebase deploy --only firestore:rules,firestore:indexes,hosting --project "${PRODUCTION_PROJECT}"

echo "--- Smoke ${PRODUCTION_HOST} ---"
curl -fsS "${PRODUCTION_HOST}/" >/dev/null
curl -fsS "${PRODUCTION_HOST}/js/runtime-config.js" | rg -q 'iaqar-macrodroid-intake'
curl -fsS "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev/health" | rg -q '"backendReady":true'

echo "=== Production pilot deploy finished ==="
