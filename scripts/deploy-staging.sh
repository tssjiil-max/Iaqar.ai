#!/usr/bin/env bash
# Phase 9A — staging-only deploy. Refuses production targets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { echo "ERROR: $*" >&2; exit 1; }

echo "=== IAQAR Phase 9A staging deploy ==="

# Hard guards — never allow production deploy through this script.
if [[ "${IAQAR_DEPLOY_TARGET:-staging}" != "staging" ]]; then
  die "IAQAR_DEPLOY_TARGET must be 'staging' (got '${IAQAR_DEPLOY_TARGET:-}'). Refusing."
fi
if [[ "${1:-}" == "--production" || "${1:-}" == "production" ]]; then
  die "This script cannot deploy production. Use owner-run deploy-all on a trusted machine."
fi

[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || die "CLOUDFLARE_API_TOKEN is required"
[[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]] || die "CLOUDFLARE_ACCOUNT_ID is required"
[[ -n "${FIREBASE_TOKEN:-}" ]] || die "FIREBASE_TOKEN is required (firebase login:ci)"

command -v node >/dev/null || die "node is required"
command -v npm >/dev/null || die "npm is required"
command -v npx >/dev/null || die "npx is required"

echo "--- Preflight tests ---"
npm test
npm run check

STAGING_WORKER_NAME="iaqar-intake-staging"
STAGING_WORKER_URL="https://${STAGING_WORKER_NAME}.iaqar-ai.workers.dev"

echo "--- Cloudflare Worker (staging env only) ---"
(
  cd worker
  # Explicit --env staging; never bare deploy.
  npx wrangler deploy --env staging
)

echo "--- Firebase Hosting channel 'staging' only ---"
# Preview channel — does not overwrite live hosting.
npx firebase-tools hosting:channel:deploy staging \
  --project aqar-b5d76 \
  --expires 30d \
  --token "$FIREBASE_TOKEN"

echo "--- Smoke: staging Worker /health ---"
HEALTH_JSON="$(curl -fsS --max-time 30 "${STAGING_WORKER_URL}/health" || true)"
if [[ -z "$HEALTH_JSON" ]]; then
  die "Staging Worker health check failed at ${STAGING_WORKER_URL}/health"
fi
echo "$HEALTH_JSON"
echo "$HEALTH_JSON" | node -e '
const fs = require("fs");
const body = JSON.parse(fs.readFileSync(0, "utf8"));
if (!body.ok) { console.error("health.ok is false"); process.exit(1); }
if (body.deploymentEnvironment !== "staging") {
  console.error("deploymentEnvironment must be staging, got", body.deploymentEnvironment);
  process.exit(1);
}
if (body.outboundMessaging === true) {
  console.error("outboundMessaging must remain false on staging");
  process.exit(1);
}
console.log("Staging health OK");
'

echo ""
echo "=== Phase 9A staging deploy complete ==="
echo "Worker:  ${STAGING_WORKER_URL}"
echo "Hosting: open the firebase channel URL printed above (must contain --staging)"
echo "Verify in browser: window.IAQAR.deploymentEnvironment === \"staging\""
echo "Do NOT run deploy-all / bare wrangler deploy / bare firebase deploy from this path."
