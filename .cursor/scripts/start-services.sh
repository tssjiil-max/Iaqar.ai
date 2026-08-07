#!/usr/bin/env bash
set -euo pipefail

# iaqar.ai does not require a long-lived local server for deploy tasks.
# Cloudflare Worker and Firebase Hosting are deployed to managed endpoints.
echo "[iaqar-env] Ready. Production worker: https://iaqar-macrodroid-intake.iaqar-ai.workers.dev"
echo "[iaqar-env] Production hosting project: aqar-b5d76 (https://iaqar.ai)"
