# Phase 9A — full-functional staging-only deploy (Windows parity).
# Auth: service account via temporary GOOGLE_APPLICATION_CREDENTIALS (no FIREBASE_TOKEN).
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$StagingFirebaseProject = "iaqar-ai-staging"
$StagingWorkerName = "iaqar-intake-staging"
$StagingWorkerUrl = "https://$StagingWorkerName.iaqar-ai.workers.dev"
$GacFile = $null
$NormalizedSecretDir = $null

function Die([string]$Message) {
  Write-Error "ERROR: $Message"
  exit 1
}

function Cleanup {
  if ($NormalizedSecretDir -and (Test-Path -LiteralPath $NormalizedSecretDir)) {
    Remove-Item -LiteralPath $NormalizedSecretDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($GacFile -and (Test-Path -LiteralPath $GacFile)) {
    Remove-Item -LiteralPath $GacFile -Force -ErrorAction SilentlyContinue
  }
  Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS -ErrorAction SilentlyContinue
}

try {
  Write-Host "=== IAQAR Phase 9A staging deploy (full-functional, project $StagingFirebaseProject) ==="

  if (($env:IAQAR_DEPLOY_TARGET -or "staging") -ne "staging") {
    Die "IAQAR_DEPLOY_TARGET must be 'staging'. Refusing."
  }
  if ($args -contains "--production" -or $args -contains "production") {
    Die "This script cannot deploy production. Use owner-run deploy-all on a trusted machine."
  }

  if (-not $env:CLOUDFLARE_API_TOKEN) { Die "CLOUDFLARE_API_TOKEN is required" }
  if (-not $env:CLOUDFLARE_ACCOUNT_ID) { Die "CLOUDFLARE_ACCOUNT_ID is required" }
  if (-not $env:FIREBASE_CLIENT_EMAIL) { Die "FIREBASE_CLIENT_EMAIL is required" }
  if (-not $env:FIREBASE_PRIVATE_KEY) { Die "FIREBASE_PRIVATE_KEY is required" }
  if (-not $env:FIREBASE_PRIVATE_KEY_ID) { Die "FIREBASE_PRIVATE_KEY_ID is required" }

  if ($env:FIREBASE_TOKEN) {
    Write-Host "NOTE: FIREBASE_TOKEN is set but ignored; staging deploy uses service-account GAC."
  }

  Write-Host "--- Normalize + validate Firebase credentials (no secret output) ---"
  $GacFile = Join-Path ([System.IO.Path]::GetTempPath()) ("iaqar-staging-gac-" + [guid]::NewGuid().ToString("N") + ".json")
  $NormalizedSecretDir = Join-Path ([System.IO.Path]::GetTempPath()) ("iaqar-staging-secrets-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $NormalizedSecretDir | Out-Null
  $env:FIREBASE_STAGING_PROJECT_ID = $StagingFirebaseProject
  node (Join-Path $Root "scripts/staging-gac.mjs") $GacFile $NormalizedSecretDir
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $env:GOOGLE_APPLICATION_CREDENTIALS = $GacFile

  Write-Host "--- Staging credential + permission preflight ---"
  node (Join-Path $Root "scripts/preflight-staging.mjs") $GacFile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "--- Full Phase 9A test gate ---"
  npm run test:phase9a
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "--- Cloudflare Worker (staging env only) ---"
  Push-Location (Join-Path $Root "worker")
  try {
    npx wrangler deploy --env staging
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "--- Sync Worker staging secrets from environment (values not printed) ---"
    Get-Content -LiteralPath (Join-Path $NormalizedSecretDir "FIREBASE_CLIENT_EMAIL") -Raw | # // pragma: allowlist secret
      npx wrangler secret put FIREBASE_CLIENT_EMAIL --env staging # // pragma: allowlist secret
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Get-Content -LiteralPath (Join-Path $NormalizedSecretDir "FIREBASE_PRIVATE_KEY") -Raw | # // pragma: allowlist secret
      npx wrangler secret put FIREBASE_PRIVATE_KEY --env staging # // pragma: allowlist secret
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Get-Content -LiteralPath (Join-Path $NormalizedSecretDir "FIREBASE_PRIVATE_KEY_ID") -Raw | # // pragma: allowlist secret
      npx wrangler secret put FIREBASE_PRIVATE_KEY_ID --env staging # // pragma: allowlist secret
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }

  Write-Host "--- Firebase Hosting channel 'staging' on $StagingFirebaseProject ---"
  $channelOutput = npx firebase-tools hosting:channel:deploy staging `
    --project $StagingFirebaseProject `
    --expires 30d `
    --non-interactive 2>&1 | Out-String
  Write-Host $channelOutput
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  if ($channelOutput -match "Unable to add channel domain|authorized domain") {
    Write-Warning "Auth authorized-domain sync may have failed. Grant Auth Admin on the staging service account or add the domain manually."
  }

  $StagingHostingUrl = $null
  if ($channelOutput -match "https://[A-Za-z0-9._-]*iaqar-ai-staging--staging[A-Za-z0-9._-]*\.web\.app") {
    $StagingHostingUrl = $Matches[0]
  } elseif ($channelOutput -match 'https://[A-Za-z0-9._-]+--staging[A-Za-z0-9._-]+\.web\.app') {
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
  if ($HealthJson.deploymentEnvironment -ne "staging") { Die "deploymentEnvironment must be staging" }
  if ($HealthJson.projectId -and $HealthJson.projectId -ne "iaqar-ai-staging") {
    Die "health.projectId must be iaqar-ai-staging"
  }
  if ($HealthJson.outboundMessaging -eq $true) { Die "outboundMessaging must remain false on staging" }
  if ($HealthJson.firebaseConfigured -ne $true -or $HealthJson.backendReady -ne $true) {
    Die "Staging Worker is UI-only: firebaseConfigured/backendReady must be true"
  }
  if ($HealthJson.cronEnabled -eq $true) { Die "cronEnabled must be false on staging" }
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
  Write-Host "Firebase project: $StagingFirebaseProject"
  Write-Host "Worker:  $StagingWorkerUrl"
  if ($StagingHostingUrl) { Write-Host "Hosting: $StagingHostingUrl" }
  Write-Host 'Verify in browser: window.IAQAR.deploymentEnvironment === "staging"'
  Write-Host "Do NOT run deploy-all / bare wrangler deploy / bare firebase deploy from this path."
} finally {
  Cleanup
}
