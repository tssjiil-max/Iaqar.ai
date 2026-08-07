#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "[iaqar-env] Installing worker dependencies..."
(cd worker && npm install)

echo "[iaqar-env] Installing admin tooling dependencies..."
(cd admin && npm install)

echo "[iaqar-env] Verifying JavaScript syntax..."
for file in \
  worker/src/index.js \
  public/js/access-gate.js \
  public/js/firebase-office.js \
  public/js/fcm-fid.js \
  public/js/office-settings.js \
  public/js/whatsapp-office.js \
  public/js/workflow-office.js \
  public/firebase-messaging-sw.js \
  admin/link-office-phone-login.mjs
do
  node --check "$file"
done

echo "[iaqar-env] Running worker tests..."
(cd worker && npm test)

echo "[iaqar-env] Install complete."
