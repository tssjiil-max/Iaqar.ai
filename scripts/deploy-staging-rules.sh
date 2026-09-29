#!/usr/bin/env bash
# Deploy firestore.rules to the Staging Firebase project ONLY (iaqar-ai-staging).
# Rules only: no indexes, no hosting, no functions. Production (aqar-b5d76) is refused.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="iaqar-ai-staging"
GAC_FILE=""
SECRET_DIR=""
cleanup() {
  [[ -n "$SECRET_DIR" && -d "$SECRET_DIR" ]] && rm -rf "$SECRET_DIR" || true
  [[ -n "$GAC_FILE" && -f "$GAC_FILE" ]] && rm -f "$GAC_FILE" || true
}
trap cleanup EXIT
die() { echo "ERROR: $1" >&2; exit 1; }

[[ "${IAQAR_DEPLOY_TARGET:-}" == "staging-rules" ]] || die "IAQAR_DEPLOY_TARGET must be 'staging-rules'"
[[ -n "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]] || die "FIREBASE_SERVICE_ACCOUNT_JSON missing"
[[ -f firestore.rules ]] || die "firestore.rules missing"

GAC_FILE="$(mktemp /tmp/staging-rules-gac.XXXXXX)"; SECRET_DIR="$(mktemp -d /tmp/staging-rules-secrets.XXXXXX)"
export FIREBASE_STAGING_PROJECT_ID="$PROJECT"
node scripts/staging-gac.mjs "$GAC_FILE" "$SECRET_DIR"
chmod 600 "$GAC_FILE"
export GOOGLE_APPLICATION_CREDENTIALS="$GAC_FILE"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(j.project_id!=="iaqar-ai-staging"){console.error("service account is not iaqar-ai-staging");process.exit(1)}' "$GAC_FILE"

echo "--- Deploy firestore.rules to ${PROJECT} (rules only) ---"
npx firebase-tools deploy --only firestore:rules --project "$PROJECT" --non-interactive
echo "::notice title=Staging rules::firestore.rules deployed to ${PROJECT} from $(git rev-parse HEAD)"
