# Phase 9A — full-functional staging-only deploy (Windows parity). Refuses production.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Die([string]$Message) {
  Write-Error "ERROR: $Message"
  exit 1
}

Write-Host "=== IAQAR Phase 9A staging deploy (full-functional) ==="

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
$channelOutput = npx firebase-tools hosting:channel:deploy staging `
  --project aqar-b5d76 `
  --expires 30d `
  --token $env:FIREBASE_TOKEN 2>&1 | Out-String
Write-Host $channelOutput
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($channelOutput -match "Unable to add channel domain|authorized domain") {
  Write-Warning "Auth authorized-domain sync may have failed. Ensure FIREBASE_TOKEN has Auth Admin."
}

$StagingHostingUrl = $null
if ($channelOutput -match 'https://[A-Za-z0-9._-]+--staging[A-Za-z0-9._-]+\.web\.app') {
  $StagingHostingUrl = $Matches[0]
} elseif ($channelOutput -match 'https://[A-Za-z0-9._-]+--staging[A-Za-z0-9._-]+\.firebaseapp\.com') {
  $StagingHostingUrl = $Matches[0]
}

Write-Host "--- Smoke: staging Worker /health (must be backendReady) ---"
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
if ($HealthJson.firebaseConfigured -ne $true -or $HealthJson.backendReady -ne $true) {
  Die "Staging Worker is UI-only. Set Wrangler secrets on --env staging: FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PRIVATE_KEY_ID"
}
if ($HealthJson.cronEnabled -eq $true) {
  Die "cronEnabled must be false on staging"
}
Write-Host "Staging health OK (full-functional backendReady)"

$env:STAGING_WORKER_URL = $StagingWorkerUrl
if ($StagingHostingUrl) {
  $env:STAGING_HOSTING_URL = $StagingHostingUrl
  Write-Host "Hosting channel: $StagingHostingUrl"
}
node (Join-Path $Root "scripts/smoke-staging.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== Phase 9A full-functional staging deploy complete ==="
Write-Host "Worker:  $StagingWorkerUrl"
if ($StagingHostingUrl) { Write-Host "Hosting: $StagingHostingUrl" }
Write-Host 'Verify in browser: window.IAQAR.deploymentEnvironment === "staging"'
Write-Host "Do NOT run deploy-all / bare wrangler deploy / bare firebase deploy from this path."
