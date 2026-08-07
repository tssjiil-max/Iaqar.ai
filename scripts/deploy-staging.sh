#!/usr/bin/env bash
# Phase 9A — full-functional staging-only deploy. Refuses production targets.
# Auth: Google service account via temporary GOOGLE_APPLICATION_CREDENTIALS (no FIREBASE_TOKEN).
# Firebase project: iaqar-ai-staging
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAGING_FIREBASE_PROJECT="iaqar-ai-staging"
STAGING_WORKER_NAME="iaqar-intake-staging"
STAGING_WORKER_URL="https://${STAGING_WORKER_NAME}.iaqar-ai.workers.dev"
GAC_FILE=""
NORMALIZED_SECRET_DIR=""

die() { echo "ERROR: $*" >&2; exit 1; }

cleanup() {
  if [[ -n "${NORMALIZED_SECRET_DIR:-}" && -d "$NORMALIZED_SECRET_DIR" ]]; then
    rm -rf "$NORMALIZED_SECRET_DIR" || true
  fi
  if [[ -n "${GAC_FILE:-}" && -f "$GAC_FILE" ]]; then
    rm -f "$GAC_FILE" || true
  fi
  unset GOOGLE_APPLICATION_CREDENTIALS || true
}
trap cleanup EXIT

echo "=== IAQAR Phase 9A staging deploy (full-functional, project ${STAGING_FIREBASE_PROJECT}) ==="

if [[ "${IAQAR_DEPLOY_TARGET:-staging}" != "staging" ]]; then
  die "IAQAR_DEPLOY_TARGET must be 'staging' (got '${IAQAR_DEPLOY_TARGET:-}'). Refusing."
fi
if [[ "${1:-}" == "--production" || "${1:-}" == "production" ]]; then
  die "This script cannot deploy production. Use owner-run deploy-all on a trusted machine."
fi

[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || die "CLOUDFLARE_API_TOKEN is required"
[[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]] || die "CLOUDFLARE_ACCOUNT_ID is required"
[[ -n "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]] || die "FIREBASE_SERVICE_ACCOUNT_JSON is required"

# Explicitly unused — service account auth replaces CI user tokens.
if [[ -n "${FIREBASE_TOKEN:-}" ]]; then
  echo "NOTE: FIREBASE_TOKEN is set but ignored; staging deploy uses service-account GAC."
fi

command -v node >/dev/null || die "node is required"
command -v npm >/dev/null || die "npm is required"
command -v npx >/dev/null || die "npx is required"

echo "--- Parse + validate Firebase service-account JSON (no secret output) ---"
GAC_FILE="$(mktemp "${TMPDIR:-/tmp}/iaqar-staging-gac.XXXXXX")"
NORMALIZED_SECRET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/iaqar-staging-secrets.XXXXXX")"
export FIREBASE_STAGING_PROJECT_ID="$STAGING_FIREBASE_PROJECT"
node scripts/staging-gac.mjs "$GAC_FILE" "$NORMALIZED_SECRET_DIR"
export GOOGLE_APPLICATION_CREDENTIALS="$GAC_FILE"
chmod 600 "$GAC_FILE"

echo "--- Staging credential + permission preflight ---"
node scripts/preflight-staging.mjs "$GAC_FILE"

echo "--- Full Phase 9A test gate ---"
npm run test:phase9a

echo "--- Firebase Firestore rules (${STAGING_FIREBASE_PROJECT} only) ---"
node scripts/deploy-firestore-rules-staging.mjs "$GAC_FILE" "$ROOT/firestore.rules"

echo "--- Cloudflare Worker (staging env only) ---"
(
  cd worker
  npx wrangler deploy --env staging
)

echo "--- Sync derived Worker staging secrets (values not printed) ---"
(
  cd worker
  # Wrangler reads normalized values from private temp files. Values never reach logs.
  npx wrangler secret put FIREBASE_CLIENT_EMAIL --env staging < "$NORMALIZED_SECRET_DIR/FIREBASE_CLIENT_EMAIL" # // pragma: allowlist secret
  npx wrangler secret put FIREBASE_PRIVATE_KEY --env staging < "$NORMALIZED_SECRET_DIR/FIREBASE_PRIVATE_KEY" # // pragma: allowlist secret
  npx wrangler secret put FIREBASE_PRIVATE_KEY_ID --env staging < "$NORMALIZED_SECRET_DIR/FIREBASE_PRIVATE_KEY_ID" # // pragma: allowlist secret
)

echo "--- Firebase Hosting channel 'staging' on ${STAGING_FIREBASE_PROJECT} ---"
CHANNEL_LOG="$(mktemp "${TMPDIR:-/tmp}/iaqar-staging-channel.XXXXXX")"
set +e
npx firebase-tools hosting:channel:deploy staging \
  --project "$STAGING_FIREBASE_PROJECT" \
  --expires 30d \
  --non-interactive 2>&1 | tee "$CHANNEL_LOG"
CHANNEL_RC=${PIPESTATUS[0]}
set -e
[[ "$CHANNEL_RC" -eq 0 ]] || die "Firebase hosting:channel:deploy staging failed for ${STAGING_FIREBASE_PROJECT}"

if grep -qiE "Unable to add channel domain|authorized domain" "$CHANNEL_LOG"; then
  echo "WARNING: Auth authorized-domain sync may have failed." >&2
  echo "Grant the staging service account Firebase Auth Admin (or add the channel domain manually)." >&2
fi

STAGING_HOSTING_URL="$(grep -oE "https://[A-Za-z0-9._-]*${STAGING_FIREBASE_PROJECT}--staging[A-Za-z0-9._-]*\\.web\\.app" "$CHANNEL_LOG" | head -1 || true)"
if [[ -z "$STAGING_HOSTING_URL" ]]; then
  STAGING_HOSTING_URL="$(grep -oE 'https://[A-Za-z0-9._-]+--staging[A-Za-z0-9._-]+\.web\.app' "$CHANNEL_LOG" | head -1 || true)"
fi
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
if (body.projectId && body.projectId !== "iaqar-ai-staging") {
  console.error("health.projectId must be iaqar-ai-staging, got", body.projectId);
  process.exit(1);
}
if (body.outboundMessaging === true) {
  console.error("outboundMessaging must remain false on staging");
  process.exit(1);
}
if (body.firebaseConfigured !== true || body.backendReady !== true) {
  console.error("Staging Worker is UI-only: firebaseConfigured/backendReady must be true.");
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
echo "Firebase project: ${STAGING_FIREBASE_PROJECT}"
echo "Worker:  ${STAGING_WORKER_URL}"
if [[ -n "${STAGING_HOSTING_URL:-}" ]]; then
  echo "Hosting: ${STAGING_HOSTING_URL}"
else
  echo "Hosting: open the firebase channel URL printed above (must contain --staging)"
fi
echo "Verify in browser: window.IAQAR.deploymentEnvironment === \"staging\""
echo "Verify Worker: /health backendReady === true and projectId === iaqar-ai-staging"
echo "Do NOT run deploy-all / bare wrangler deploy / bare firebase deploy from this path."
# trap cleanup removes GAC_FILE
