#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROJECT_ID="aqar-b5d76"
WORKER_URL="https://iaqar-macrodroid-intake.iaqar-ai.workers.dev"

echo "[iaqar-deploy] Verifying Firebase project config..."
test "$(node -e "console.log(JSON.parse(require('fs').readFileSync('.firebaserc','utf8')).projects.default)")" = "$PROJECT_ID"

echo "[iaqar-deploy] Running worker tests..."
(cd worker && npm test)

echo "[iaqar-deploy] Deploying Cloudflare Worker..."
(cd worker && npx wrangler deploy)

if [[ -n "${FIREBASE_TOKEN:-}" ]]; then
  echo "[iaqar-deploy] Deploying Firebase Hosting with FIREBASE_TOKEN..."
  npx firebase-tools deploy --only hosting --project "$PROJECT_ID" --non-interactive
elif [[ -n "${FIREBASE_SERVICE_ACCOUNT_JSON_PRODUCTION:-}" ]]; then
  echo "[iaqar-deploy] Deploying Firebase Hosting with production service account..."
  SA_FILE="$(mktemp)"
  trap 'rm -f "$SA_FILE"' EXIT
  printf '%s' "$FIREBASE_SERVICE_ACCOUNT_JSON_PRODUCTION" > "$SA_FILE"
  GOOGLE_APPLICATION_CREDENTIALS="$SA_FILE" npx firebase-tools deploy --only hosting --project "$PROJECT_ID" --non-interactive
else
  echo "[iaqar-deploy] Skipping Firebase Hosting: add FIREBASE_TOKEN or FIREBASE_SERVICE_ACCOUNT_JSON_PRODUCTION secret for project $PROJECT_ID." >&2
  exit 2
fi

echo "[iaqar-deploy] Verifying live access-gate.js marker..."
if curl -fsS "https://iaqar.ai/js/access-gate.js" | rg -q "normalizeLoginPhone"; then
  echo "[iaqar-deploy] Hosting verification passed."
else
  echo "[iaqar-deploy] Hosting verification failed: normalizeLoginPhone not found on https://iaqar.ai" >&2
  exit 3
fi

echo "[iaqar-deploy] Worker health:"
curl -fsS "$WORKER_URL/health"
echo
echo "[iaqar-deploy] Done."
