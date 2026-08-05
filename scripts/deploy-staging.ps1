# Phase 9A — staging-only deploy (Windows parity). Refuses production targets.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Die([string]$Message) {
  Write-Error "ERROR: $Message"
  exit 1
}

Write-Host "=== IAQAR Phase 9A staging deploy ==="

if (($env:IAQAR_DEPLOY_TARGET -or "staging") -ne "staging") {
  Die "IAQAR_DEPLOY_TARGET must be 'staging'. Refusing."
}
if ($args -contains "--production" -or $args -contains "production") {
  Die "This script cannot deploy production. Use owner-run deploy-all on a trusted machine."
}

if (-not $env:CLOUDFLARE_API_TOKEN) { Die "CLOUDFLARE_API_TOKEN is required" }
if (-not $env:CLOUDFLARE_ACCOUNT_ID) { Die "CLOUDFLARE_ACCOUNT_ID is required" }
if (-not $env:FIREBASE_TOKEN) { Die "FIREBASE_TOKEN is required (firebase login:ci)" }

Write-Host "--- Preflight tests ---"
npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$StagingWorkerName = "iaqar-intake-staging"
$StagingWorkerUrl = "https://$StagingWorkerName.iaqar-ai.workers.dev"

Write-Host "--- Cloudflare Worker (staging env only) ---"
Push-Location (Join-Path $Root "worker")
try {
  npx wrangler deploy --env staging
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Host "--- Firebase Hosting channel 'staging' only ---"
npx firebase-tools hosting:channel:deploy staging `
  --project aqar-b5d76 `
  --expires 30d `
  --token $env:FIREBASE_TOKEN
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "--- Smoke: staging Worker /health ---"
try {
  $HealthJson = Invoke-RestMethod -Uri "$StagingWorkerUrl/health" -TimeoutSec 30
} catch {
  Die "Staging Worker health check failed at $StagingWorkerUrl/health"
}
if (-not $HealthJson.ok) { Die "health.ok is false" }
if ($HealthJson.deploymentEnvironment -ne "staging") {
  Die "deploymentEnvironment must be staging"
}
if ($HealthJson.outboundMessaging -eq $true) {
  Die "outboundMessaging must remain false on staging"
}
Write-Host "Staging health OK"

Write-Host ""
Write-Host "=== Phase 9A staging deploy complete ==="
Write-Host "Worker:  $StagingWorkerUrl"
Write-Host "Hosting: open the firebase channel URL printed above (must contain --staging)"
Write-Host 'Verify in browser: window.IAQAR.deploymentEnvironment === "staging"'
Write-Host "Do NOT run deploy-all / bare wrangler deploy / bare firebase deploy from this path."
