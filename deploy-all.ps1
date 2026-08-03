$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
Set-Location $PSScriptRoot

function Invoke-Checked {
  param([string]$Label, [scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit code $LASTEXITCODE)." }
}

Write-Host "IAQAR Stage 3 validation and deployment" -ForegroundColor Green
foreach ($commandName in @("node.exe", "npm.cmd", "npx.cmd", "firebase.cmd")) {
  if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $commandName"
  }
}

$wranglerConfig = Join-Path $PSScriptRoot "worker\wrangler.toml"
$toml = Get-Content -LiteralPath $wranglerConfig -Raw -Encoding UTF8
if ($toml -match '(?m)^FCM_WEB_PUSH_VAPID_KEY\s*=\s*"\s*"') {
  throw "FCM is not configured. Run setup-fcm-worker.cmd first, then run deploy-all.cmd."
}

Write-Host "Checking JavaScript files..." -ForegroundColor Cyan
foreach ($file in @(
  "worker/src/index.js",
  "public/js/access-gate.js",
  "public/js/firebase-office.js",
  "public/js/fcm-fid.js",
  "public/js/office-settings.js",
  "public/js/whatsapp-office.js",
  "public/js/workflow-office.js",
  "public/firebase-messaging-sw.js",
  "admin/link-office-phone-login.mjs"
)) {
  Invoke-Checked "JavaScript check: $file" { node.exe --check $file }
}

Push-Location worker
try {
  Write-Host "Running Worker tests..." -ForegroundColor Cyan
  Invoke-Checked "Worker tests" { npm.cmd test }
  Write-Host "Deploying Cloudflare Worker..." -ForegroundColor Cyan
  Invoke-Checked "Worker deployment" { npx.cmd wrangler deploy }
} finally {
  Pop-Location
}

Write-Host "Deploying Firestore rules, indexes and Firebase Hosting..." -ForegroundColor Cyan
Invoke-Checked "Firebase deployment" { firebase.cmd deploy --only firestore:rules,firestore:indexes,hosting }

Write-Host "Verifying deployed FCM configuration..." -ForegroundColor Cyan
$config = Invoke-RestMethod -Method Get -Uri "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev/fcm/config" -TimeoutSec 30
if (-not $config.enabled -or -not $config.vapidConfigured -or -not $config.serverReady) {
  throw "Deployment completed, but FCM is not ready. Run setup-fcm-worker.cmd and verify Cloudflare secrets."
}

Write-Host ""
Write-Host "Stage 3 deployed successfully: Worker, FCM, protected Firestore rules and Hosting." -ForegroundColor Green
Write-Host "Sign in to an office and press Enable notifications. The system will send a test notification." -ForegroundColor Green
Read-Host "Press Enter to close"
