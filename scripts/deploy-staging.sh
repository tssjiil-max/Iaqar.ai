#!/usr/bin/env bash
# Phase 9A — full-functional staging-only deploy. Refuses production targets.
# Auth: Google service account via temporary GOOGLE_APPLICATION_CREDENTIALS (no FIREBASE_TOKEN).
# Firebase project: iaqar-ai-staging
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAGING_FIREBASE_PROJECT="iaqar-ai-staging"
STAGING_WORKER_NAME="iaqar-intake-staging"
STAGING_WORKER_URL="https://${STAGING_WORKER_NAME}.iaqar-ai.workers.dev"
GAC_FILE=""
NORMALIZED_SECRET_DIR=""
CURRENT_STAGE="bootstrap"
DIAGNOSTIC_FILE="${IAQAR_DEPLOY_DIAGNOSTIC_FILE:-}"

diag_failure() {
  local rc="${1:-1}"
  local line="stage=${CURRENT_STAGE} exit_code=${rc}"
  echo "::error title=Staging deploy internal diagnostic::${line}" >&2
  if [[ -n "$DIAGNOSTIC_FILE" ]]; then
    mkdir -p "$(dirname "$DIAGNOSTIC_FILE")"
    printf '%s\n' "$line" >> "$DIAGNOSTIC_FILE"
  fi
}

die() {
  local message="$1"
  local rc="${2:-1}"
  echo "ERROR: ${message}" >&2
  diag_failure "$rc"
  exit "$rc"
}

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
trap 'rc=$?; diag_failure "$rc"' ERR

echo "=== IAQAR Phase 9A staging deploy (full-functional, project ${STAGING_FIREBASE_PROJECT}) ==="

CURRENT_STAGE="validate-staging-target"
if [[ "${IAQAR_DEPLOY_TARGET:-staging}" != "staging" ]]; then
  die "IAQAR_DEPLOY_TARGET must be 'staging' (got '${IAQAR_DEPLOY_TARGET:-}'). Refusing."
fi
if [[ "${1:-}" == "--production" || "${1:-}" == "production" ]]; then
  die "This script cannot deploy production. Use owner-run deploy-all on a trusted machine."
fi

CURRENT_STAGE="validate-required-secrets"
[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || die "CLOUDFLARE_API_TOKEN is required"
[[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]] || die "CLOUDFLARE_ACCOUNT_ID is required"
[[ -n "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]] || die "FIREBASE_SERVICE_ACCOUNT_JSON is required"

# Explicitly unused — service account auth replaces CI user tokens.
if [[ -n "${FIREBASE_TOKEN:-}" ]]; then
  echo "NOTE: FIREBASE_TOKEN is set but ignored; staging deploy uses service-account GAC."
fi

CURRENT_STAGE="validate-cli"
command -v node >/dev/null || die "node is required"
command -v npm >/dev/null || die "npm is required"
command -v npx >/dev/null || die "npx is required"

echo "--- Parse + validate Firebase service-account JSON (no secret output) ---"
CURRENT_STAGE="normalize-firebase-credentials"
GAC_FILE="$(mktemp "${TMPDIR:-/tmp}/iaqar-staging-gac.XXXXXX")"
NORMALIZED_SECRET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/iaqar-staging-secrets.XXXXXX")"
export FIREBASE_STAGING_PROJECT_ID="$STAGING_FIREBASE_PROJECT"
node scripts/staging-gac.mjs "$GAC_FILE" "$NORMALIZED_SECRET_DIR"
export GOOGLE_APPLICATION_CREDENTIALS="$GAC_FILE"
chmod 600 "$GAC_FILE"

echo "--- Staging credential + permission preflight ---"
CURRENT_STAGE="staging-permission-preflight"
node scripts/preflight-staging.mjs "$GAC_FILE"

if [[ "${IAQAR_SKIP_INNER_TESTS:-}" == "1" ]]; then
  echo "--- Full Phase 9A test gate skipped (already run by deploy:staging:safe) ---"
else
  echo "--- Full Phase 9A test gate ---"
  CURRENT_STAGE="phase9a-tests"
  npm run test:phase9a
fi

echo "--- Cloudflare Worker (staging env only) ---"
(
  CURRENT_STAGE="wrangler-worker-deploy"
  cd worker
  npx wrangler deploy --env staging
)

echo "--- Sync derived Worker staging secrets (values not printed) ---"
(
  cd worker
  # Wrangler reads normalized values from private temp files. Values never reach logs.
  CURRENT_STAGE="wrangler-secret-firebase-client-email"
  npx wrangler secret put FIREBASE_CLIENT_EMAIL --env staging < "$NORMALIZED_SECRET_DIR/FIREBASE_CLIENT_EMAIL" # // pragma: allowlist secret
  CURRENT_STAGE="wrangler-secret-firebase-private-key"
  npx wrangler secret put FIREBASE_PRIVATE_KEY --env staging < "$NORMALIZED_SECRET_DIR/FIREBASE_PRIVATE_KEY" # // pragma: allowlist secret
  CURRENT_STAGE="wrangler-secret-firebase-private-key-id"
  npx wrangler secret put FIREBASE_PRIVATE_KEY_ID --env staging < "$NORMALIZED_SECRET_DIR/FIREBASE_PRIVATE_KEY_ID" # // pragma: allowlist secret
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    CURRENT_STAGE="wrangler-secret-gemini-api-key"
    printf '%s' "$GEMINI_API_KEY" | npx wrangler secret put GEMINI_API_KEY --env staging # // pragma: allowlist secret
    echo "GEMINI_API_KEY synced to staging Worker (value not printed)."
  else
    echo "NOTE: GEMINI_API_KEY not set — voice analyze returns GEMINI_NOT_CONFIGURED until configured."
  fi
)

# «قنوات المكتب» — WhatsApp Embedded Signup (optional). Staging Worker only; values never reach logs.
(
  cd worker
  if [[ -n "${META_APP_SECRET:-}" ]]; then
    CURRENT_STAGE="wrangler-secret-meta-app-secret"
    printf '%s' "$META_APP_SECRET" | tr -d '[:space:]' | npx wrangler secret put META_APP_SECRET --env staging # // pragma: allowlist secret
    echo "::notice title=WhatsApp link (Staging)::META_APP_SECRET synced to the staging Worker (value not printed)."
  else
    echo "NOTE: META_APP_SECRET not set — «ربط واتساب» stays hidden on Staging."
  fi
  if [[ -n "${META_WEBHOOK_VERIFY_TOKEN:-}" ]]; then
    CURRENT_STAGE="wrangler-secret-meta-verify-token"
    printf '%s' "$META_WEBHOOK_VERIFY_TOKEN" | tr -d '\r\n' | npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN --env staging # // pragma: allowlist secret
    echo "::notice title=WhatsApp link (Staging)::META_WEBHOOK_VERIFY_TOKEN synced to the staging Worker (value not printed)."
  else
    echo "NOTE: META_WEBHOOK_VERIFY_TOKEN not set — the Meta webhook cannot be verified on Staging yet."
  fi
)

# «قنوات المكتب» — the platform's Telegram bot (optional). Staging only; the bot only receives.
# A problem here never fails the deploy: the screen keeps saying «بوت المنصة غير مفعّل».
TELEGRAM_READY=""
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "--- Telegram bot for Staging (values not printed) ---"
  CURRENT_STAGE="telegram-prepare"
  TELEGRAM_SECRET_DIR="$NORMALIZED_SECRET_DIR/telegram"
  if node scripts/staging-telegram-activate.mjs prepare "$TELEGRAM_SECRET_DIR"; then
    CURRENT_STAGE="wrangler-secret-telegram"
    if (
      cd worker \
        && npx wrangler secret put TELEGRAM_BOT_TOKEN --env staging < "$TELEGRAM_SECRET_DIR/TELEGRAM_BOT_TOKEN" \
        && npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging < "$TELEGRAM_SECRET_DIR/TELEGRAM_WEBHOOK_SECRET" \
        && npx wrangler secret put TELEGRAM_BOT_USERNAME --env staging < "$TELEGRAM_SECRET_DIR/TELEGRAM_BOT_USERNAME" \
        && printf 'yes' | npx wrangler secret put TELEGRAM_WEBHOOK_KEPT --env staging
    ); then # // pragma: allowlist secret
      # TELEGRAM_WEBHOOK_KEPT=yes until the webhook is really pointed at Staging: until then Staging sends nothing through this bot.
      TELEGRAM_READY="@$(cat "$TELEGRAM_SECRET_DIR/TELEGRAM_BOT_USERNAME")"
      echo "Telegram bot settings synced to staging Worker (values not printed)."
    else
      echo "::warning title=Telegram bot (Staging)::the bot settings could not be saved to the Staging Worker — the bot stays off."
    fi
  else
    echo "::warning title=Telegram bot (Staging)::TELEGRAM_BOT_TOKEN was not accepted by Telegram — the bot stays off on Staging."
  fi
else
  echo "NOTE: TELEGRAM_BOT_TOKEN not set — «قنوات المكتب» shows the platform bot as not enabled."
fi

# «مركز التواصل والدعم» — the platform support assistant (Telegram Business), optional.
# A separate bot from the intake bot; a problem here never fails the deploy (the card simply hides it).
SUPPORT_READY=""
if [[ -n "${TELEGRAM_SUPPORT_BOT_TOKEN:-}" ]]; then
  echo "--- Telegram Business support bot for Staging (values not printed) ---"
  CURRENT_STAGE="support-prepare"
  SUPPORT_SECRET_DIR="$NORMALIZED_SECRET_DIR/telegram-support"
  if node scripts/staging-telegram-support-activate.mjs prepare "$SUPPORT_SECRET_DIR"; then
    CURRENT_STAGE="wrangler-secret-support"
    if (
      cd worker \
        && npx wrangler secret put TELEGRAM_SUPPORT_BOT_TOKEN --env staging < "$SUPPORT_SECRET_DIR/TELEGRAM_SUPPORT_BOT_TOKEN" \
        && npx wrangler secret put TELEGRAM_SUPPORT_WEBHOOK_SECRET --env staging < "$SUPPORT_SECRET_DIR/TELEGRAM_SUPPORT_WEBHOOK_SECRET"
    ); then # // pragma: allowlist secret
      SUPPORT_READY="yes"
      echo "Support bot settings synced to staging Worker (values not printed)."
    else
      echo "::warning title=Support bot (Staging)::the support bot settings could not be saved to the Staging Worker — the assistant stays off."
    fi
  else
    echo "::warning title=Support bot (Staging)::TELEGRAM_SUPPORT_BOT_TOKEN was not accepted — the assistant stays off on Staging."
  fi
else
  echo "NOTE: TELEGRAM_SUPPORT_BOT_TOKEN not set — the support assistant is off; the card shows no assistant."
fi
if [[ -n "${SUPPORT_TELEGRAM_BUSINESS_USERNAME:-}" ]]; then
  CURRENT_STAGE="wrangler-var-support-username"
  if ( cd worker && printf '%s' "$SUPPORT_TELEGRAM_BUSINESS_USERNAME" | npx wrangler secret put SUPPORT_TELEGRAM_BUSINESS_USERNAME --env staging ); then
    echo "Support business account username synced to the staging Worker."
  else
    echo "::warning title=Support account (Staging)::the business account username could not be saved — the Telegram Business chip stays hidden."
  fi
fi

echo "--- Generate public/version.json from current Git commit ---"
CURRENT_STAGE="write-staging-version"
node scripts/write-staging-version.mjs

echo "--- Firebase Hosting channel 'staging' on ${STAGING_FIREBASE_PROJECT} ---"
CURRENT_STAGE="prepare-firebase-hosting"
FIREBASE_JSON_BACKUP="$(mktemp "${TMPDIR:-/tmp}/iaqar-firebase-json.XXXXXX")"
cp firebase.json "$FIREBASE_JSON_BACKUP"
node scripts/patch-firebase-office-link-redirect.mjs "$STAGING_WORKER_URL"
CHANNEL_LOG="$(mktemp "${TMPDIR:-/tmp}/iaqar-staging-channel.XXXXXX")"
CURRENT_STAGE="firebase-hosting-channel-deploy"
set +e
npx firebase-tools hosting:channel:deploy staging \
  --project "$STAGING_FIREBASE_PROJECT" \
  --expires 30d \
  --non-interactive 2>&1 | tee "$CHANNEL_LOG"
CHANNEL_RC=${PIPESTATUS[0]}
set -e
[[ "$CHANNEL_RC" -eq 0 ]] || die "Firebase hosting:channel:deploy staging failed for ${STAGING_FIREBASE_PROJECT}" "$CHANNEL_RC"
CURRENT_STAGE="restore-firebase-config"
mv "$FIREBASE_JSON_BACKUP" firebase.json

CURRENT_STAGE="inspect-hosting-output"
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
CURRENT_STAGE="worker-health-fetch"
HEALTH_JSON="$(curl -fsS --max-time 30 "${STAGING_WORKER_URL}/health" || true)"
if [[ -z "$HEALTH_JSON" ]]; then
  die "Staging Worker health check failed at ${STAGING_WORKER_URL}/health"
fi
echo "$HEALTH_JSON"
CURRENT_STAGE="worker-health-assert"
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

if [[ -n "$TELEGRAM_READY" ]]; then
  echo "--- Telegram: point the bot at the Staging Worker and check the chain ---"
  CURRENT_STAGE="telegram-register"
  if REGISTER_OUT=$(STAGING_WORKER_URL="$STAGING_WORKER_URL" node scripts/staging-telegram-activate.mjs register); then
    echo "$REGISTER_OUT"
    if grep -q "^KEEP:" <<<"$REGISTER_OUT"; then
      echo "::notice title=Telegram bot (Staging)::${TELEGRAM_READY} keeps its current webhook (not moved). Staging can verify «دخول بتيليجرام» but does not receive this bot's messages."
    else
      ( cd worker && printf 'no' | npx wrangler secret put TELEGRAM_WEBHOOK_KEPT --env staging ) || echo "::warning title=Telegram bot (Staging)::the bot receives on Staging but sending stays paused (TELEGRAM_WEBHOOK_KEPT not cleared)." # // pragma: allowlist secret
      echo "::notice title=Telegram bot (Staging)::${TELEGRAM_READY} receives on the Staging Worker; offices can link from «قنوات المكتب»."
    fi
  else
    echo "::warning title=Telegram bot (Staging)::the bot settings were saved but pointing it at Staging failed — see the deploy log."
  fi
fi

if [[ -n "$SUPPORT_READY" ]]; then
  echo "--- Support bot: point it at the Staging Worker and check the chain ---"
  CURRENT_STAGE="support-register"
  if STAGING_WORKER_URL="$STAGING_WORKER_URL" node scripts/staging-telegram-support-activate.mjs register; then
    echo "::notice title=Support bot (Staging)::the support assistant receives on the Staging Worker; link it to the business account in Telegram (Settings → Business → Chatbots)."
  else
    echo "::warning title=Support bot (Staging)::the support bot settings were saved but pointing it at Staging failed — see the deploy log."
  fi
fi

echo "--- Smoke: staging adapters + hosting wiring ---"
export STAGING_WORKER_URL
if [[ -n "${STAGING_HOSTING_URL:-}" ]]; then
  export STAGING_HOSTING_URL
  echo "Hosting channel: ${STAGING_HOSTING_URL}"
else
  echo "WARNING: could not parse Hosting channel URL from firebase-tools output; hosting smoke skipped" >&2
fi
CURRENT_STAGE="smoke-staging"
node scripts/smoke-staging.mjs

CURRENT_STAGE="complete"
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
