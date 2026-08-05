#!/usr/bin/env bash
# Phase 9A — full-functional staging-only deploy. Refuses production targets.
# Requires Worker Firebase secrets on --env staging so backend APIs work (not UI-only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { echo "ERROR: $*" >&2; exit 1; }

echo "=== IAQAR Phase 9A staging deploy (full-functional) ==="

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
CHANNEL_LOG="$(mktemp)"
# Preview channel — does not overwrite live hosting.
# FIREBASE_TOKEN needs Auth Admin so the channel domain is authorized for Auth.
set +e
npx firebase-tools hosting:channel:deploy staging \
  --project aqar-b5d76 \
  --expires 30d \
  --token "$FIREBASE_TOKEN" 2>&1 | tee "$CHANNEL_LOG"
CHANNEL_RC=${PIPESTATUS[0]}
set -e
[[ "$CHANNEL_RC" -eq 0 ]] || die "Firebase hosting:channel:deploy staging failed"

if grep -qiE "Unable to add channel domain|authorized domain" "$CHANNEL_LOG"; then
  echo "WARNING: Auth authorized-domain sync may have failed. Phone/email Auth on the channel can break." >&2
  echo "Ensure FIREBASE_TOKEN has Auth Admin, then re-run channel deploy." >&2
fi

STAGING_HOSTING_URL="$(grep -oE 'https://[A-Za-z0-9._-]+--staging[A-Za-z0-9._-]+\.web\.app' "$CHANNEL_LOG" | head -1 || true)"
if [[ -z "$STAGING_HOSTING_URL" ]]; then
  STAGING_HOSTING_URL="$(grep -oE 'https://[A-Za-z0-9._-]+--staging[A-Za-z0-9._-]+\.firebaseapp\.com' "$CHANNEL_LOG" | head -1 || true)"
fi
rm -f "$CHANNEL_LOG"

echo "--- Smoke: staging Worker /health (must be backendReady) ---"
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
if (body.firebaseConfigured !== true || body.backendReady !== true) {
  console.error("Staging Worker is UI-only: firebaseConfigured/backendReady must be true.");
  console.error("Set Wrangler secrets on --env staging: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PRIVATE_KEY_ID");
  process.exit(1);
}
if (body.cronEnabled === true) {
  console.error("cronEnabled must be false on staging");
  process.exit(1);
}
console.log("Staging health OK (full-functional backendReady)");
'

echo "--- Smoke: staging adapters + hosting wiring ---"
export STAGING_WORKER_URL
if [[ -n "${STAGING_HOSTING_URL:-}" ]]; then
  export STAGING_HOSTING_URL
  echo "Hosting channel: ${STAGING_HOSTING_URL}"
else
  echo "WARNING: could not parse Hosting channel URL from firebase-tools output; hosting smoke skipped" >&2
fi
node scripts/smoke-staging.mjs

echo ""
echo "=== Phase 9A full-functional staging deploy complete ==="
echo "Worker:  ${STAGING_WORKER_URL}"
if [[ -n "${STAGING_HOSTING_URL:-}" ]]; then
  echo "Hosting: ${STAGING_HOSTING_URL}"
else
  echo "Hosting: open the firebase channel URL printed above (must contain --staging)"
fi
echo "Verify in browser: window.IAQAR.deploymentEnvironment === \"staging\""
echo "Verify Worker: /health backendReady === true"
echo "Do NOT run deploy-all / bare wrangler deploy / bare firebase deploy from this path."
