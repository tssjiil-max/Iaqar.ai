#!/usr/bin/env bash
# Office OS pre-merge preview — Staging project only, isolated surfaces:
#   Hosting channel  office-os-preview  on iaqar-ai-staging  (never the "staging" channel)
#   Worker           iaqar-intake-os-preview (wrangler --env preview, never --env staging)
# Firestore rules/indexes are NOT deployed from here; the shared Staging data is used.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="iaqar-ai-staging"
CHANNEL="office-os-preview"
WORKER_NAME="iaqar-intake-os-preview"
WORKER_URL="https://${WORKER_NAME}.iaqar-ai.workers.dev"
GAC_FILE=""
SECRET_DIR=""
OUT_FILE="${PREVIEW_OUTPUT_FILE:-}"

cleanup() {
  [[ -n "$SECRET_DIR" && -d "$SECRET_DIR" ]] && rm -rf "$SECRET_DIR" || true
  [[ -n "$GAC_FILE" && -f "$GAC_FILE" ]] && rm -f "$GAC_FILE" || true
  git checkout -- firebase.json 2>/dev/null || true
  rm -f public/version.json
}
trap cleanup EXIT
die() { echo "ERROR: $1" >&2; exit 1; }

[[ "${IAQAR_DEPLOY_TARGET:-}" == "preview" ]] || die "IAQAR_DEPLOY_TARGET must be 'preview'"
[[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]] || die "Cloudflare credentials missing"
[[ -n "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]] || die "FIREBASE_SERVICE_ACCOUNT_JSON missing"
grep -q '^\[env.preview\]' worker/wrangler.toml || die "wrangler env.preview missing"
grep -A2 '^\[env.preview\]' worker/wrangler.toml | grep -q "name = \"${WORKER_NAME}\"" || die "preview worker name mismatch"

echo "--- Credentials (Staging service account only; values never printed) ---"
GAC_FILE="$(mktemp /tmp/os-preview-gac.XXXXXX)"; SECRET_DIR="$(mktemp -d /tmp/os-preview-secrets.XXXXXX)"
export FIREBASE_STAGING_PROJECT_ID="$PROJECT"
node scripts/staging-gac.mjs "$GAC_FILE" "$SECRET_DIR"
chmod 600 "$GAC_FILE"
export GOOGLE_APPLICATION_CREDENTIALS="$GAC_FILE"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(j.project_id!=="iaqar-ai-staging"){console.error("service account is not iaqar-ai-staging");process.exit(1)}' "$GAC_FILE"

echo "--- Hosting channel ${CHANNEL} on ${PROJECT} ---"
node scripts/write-staging-version.mjs
node scripts/patch-firebase-office-link-redirect.mjs "$WORKER_URL"
LOG="$(mktemp)"
npx firebase-tools hosting:channel:deploy "$CHANNEL" --project "$PROJECT" --expires 14d --non-interactive 2>&1 | tee "$LOG"
PREVIEW_URL="$(grep -oE "https://${PROJECT}--${CHANNEL}-[A-Za-z0-9]+\.web\.app" "$LOG" | head -1 || true)"
rm -f "$LOG"
[[ -n "$PREVIEW_URL" ]] || die "could not read the preview channel URL"
case "$PREVIEW_URL" in *"--staging-"*) die "refusing: resolved to the shared staging channel";; esac
echo "Preview Hosting: $PREVIEW_URL"

echo "--- Preview Worker ${WORKER_NAME} (links point at the preview channel) ---"
(
  cd worker
  npx wrangler deploy --env preview --var "APP_ORIGIN:${PREVIEW_URL}"
  npx wrangler secret put FIREBASE_CLIENT_EMAIL --env preview < "$SECRET_DIR/FIREBASE_CLIENT_EMAIL" # // pragma: allowlist secret
  npx wrangler secret put FIREBASE_PRIVATE_KEY --env preview < "$SECRET_DIR/FIREBASE_PRIVATE_KEY" # // pragma: allowlist secret
  npx wrangler secret put FIREBASE_PRIVATE_KEY_ID --env preview < "$SECRET_DIR/FIREBASE_PRIVATE_KEY_ID" # // pragma: allowlist secret
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    printf '%s' "$GEMINI_API_KEY" | npx wrangler secret put GEMINI_API_KEY --env preview # // pragma: allowlist secret
    echo "GEMINI_API_KEY set on preview Worker (value not printed)"
  else
    echo "NOTE: GEMINI_API_KEY not provided — assist falls back to rule-based suggestions"
  fi
)

echo "--- Health ---"
for i in 1 2 3 4 5 6; do
  HEALTH="$(curl -fsS --max-time 20 "${WORKER_URL}/health" || true)"
  echo "$HEALTH" | grep -q '"backendReady":true' && break
  sleep 5
done
echo "$HEALTH"
echo "$HEALTH" | node -e '
const b = JSON.parse(require("fs").readFileSync(0, "utf8"));
const bad = [];
if (b.deploymentEnvironment !== "staging") bad.push("deploymentEnvironment");
if (b.projectId && b.projectId !== "iaqar-ai-staging") bad.push("projectId");
if (b.backendReady !== true) bad.push("backendReady");
if (b.outboundMessaging === true) bad.push("outboundMessaging");
if (bad.length) { console.error("preview health failed:", bad.join(",")); process.exit(1); }
console.log("preview Worker healthy on iaqar-ai-staging");'

HTML="$(curl -fsS --max-time 20 "${PREVIEW_URL}/")"
echo "$HTML" | grep -q '/os/app.js' || die "preview channel does not serve the new shell"
curl -fsS --max-time 20 "${PREVIEW_URL}/js/runtime-config.js" | grep -q "$WORKER_NAME" || die "runtime-config does not route to the preview Worker"
curl -fsS --max-time 20 "${PREVIEW_URL}/version.json"; echo

echo "PREVIEW_URL=${PREVIEW_URL}"
echo "PREVIEW_WORKER_URL=${WORKER_URL}"
if [[ -n "$OUT_FILE" ]]; then
  { echo "PREVIEW_URL=${PREVIEW_URL}"; echo "PREVIEW_WORKER_URL=${WORKER_URL}"; } >> "$OUT_FILE"
fi
