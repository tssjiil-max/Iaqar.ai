param(
    [string]$ServiceAccountPath = "",
    [string]$VapidKey = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Invoke-ExternalChecked {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )
    & $Command
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "$Label failed (exit code $exitCode)."
    }
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Value
    )
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Set-WranglerSecretExact {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = '/d /s /c "npx.cmd wrangler secret put ' + $Name + '"'
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $process.StandardInput.WriteLine($Value)
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    if ($process.ExitCode -ne 0) {
        throw "Could not save $Name in Cloudflare. $stderr $stdout"
    }
}

function Select-ServiceAccountFile {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Select Firebase service account JSON"
    $dialog.Filter = "Firebase service account (*.json)|*.json"
    $dialog.CheckFileExists = $true
    $dialog.Multiselect = $false
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw "No Firebase service account file was selected."
    }
    return $dialog.FileName
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$worker = Join-Path $root "worker"
$wranglerConfig = Join-Path $worker "wrangler.toml"
$validator = Join-Path $root "admin\verify-firebase-service-account.mjs"
$workerBase = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev"

Write-Host ""
Write-Host "IAQAR - FCM notification setup" -ForegroundColor Green
Write-Host "This setup validates Firebase, saves Cloudflare secrets, tests the Worker, and deploys it." -ForegroundColor Cyan

foreach ($commandName in @("node.exe", "npm.cmd", "npx.cmd")) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Node.js is incomplete. Missing command: $commandName"
    }
}
if (-not (Test-Path -LiteralPath $worker)) { throw "The worker folder is missing." }
if (-not (Test-Path -LiteralPath $wranglerConfig)) { throw "worker\wrangler.toml is missing." }
if (-not (Test-Path -LiteralPath $validator)) { throw "Firebase credential validator is missing." }

Set-Location $worker
if (-not (Test-Path (Join-Path $worker "node_modules"))) {
    Write-Host "Installing Worker dependencies..." -ForegroundColor Cyan
    Invoke-ExternalChecked "npm install" { npm.cmd install }
}

Write-Host "Running Worker tests before changing Cloudflare..." -ForegroundColor Cyan
Invoke-ExternalChecked "Worker tests" { npm.cmd test }

if ([string]::IsNullOrWhiteSpace($VapidKey)) {
    $VapidKey = Read-Host "Paste Firebase Web Push public key (VAPID)"
}
$VapidKey = ([string]$VapidKey).Trim()
if ($VapidKey -notmatch '^[A-Za-z0-9_-]{40,}$') {
    throw "The VAPID key is incomplete or invalid. Copy the full public key from Firebase Cloud Messaging."
}

if ([string]::IsNullOrWhiteSpace($ServiceAccountPath)) {
    Write-Host "Select the Firebase service account JSON file..." -ForegroundColor Cyan
    $ServiceAccountPath = Select-ServiceAccountFile
}
$ServiceAccountPath = [System.IO.Path]::GetFullPath($ServiceAccountPath)
if (-not (Test-Path -LiteralPath $ServiceAccountPath)) { throw "Firebase service account JSON was not found." }

try {
    $serviceAccount = Get-Content -LiteralPath $ServiceAccountPath -Raw -Encoding UTF8 | ConvertFrom-Json
}
catch {
    throw "The selected Firebase service account JSON is invalid."
}

foreach ($field in @("project_id", "client_email", "private_key", "private_key_id")) {
    if ([string]::IsNullOrWhiteSpace([string]$serviceAccount.$field)) {
        throw "The Firebase JSON is missing: $field"
    }
}
if ([string]$serviceAccount.project_id -ne "aqar-b5d76") {
    throw "Wrong Firebase project. Expected aqar-b5d76 but found $($serviceAccount.project_id)."
}
if ([string]$serviceAccount.private_key -notmatch 'BEGIN PRIVATE KEY') {
    throw "The Firebase private key is invalid."
}

Write-Host "Validating the Firebase key directly with Google..." -ForegroundColor Cyan
& node.exe $validator $ServiceAccountPath
if ($LASTEXITCODE -ne 0) {
    throw "Google rejected the Firebase service account key. Cloudflare was not changed."
}

$toml = Get-Content -LiteralPath $wranglerConfig -Raw -Encoding UTF8
$escapedVapid = $VapidKey.Replace('\', '\\').Replace('"', '\"')
$updatedToml = [regex]::Replace(
    $toml,
    '(?m)^FCM_WEB_PUSH_VAPID_KEY\s*=\s*".*"$',
    ('FCM_WEB_PUSH_VAPID_KEY = "' + $escapedVapid + '"')
)
if ($updatedToml -eq $toml -and $toml -notmatch '(?m)^FCM_WEB_PUSH_VAPID_KEY\s*=') {
    throw "FCM_WEB_PUSH_VAPID_KEY is missing from worker\wrangler.toml."
}
Write-Utf8NoBom -Path $wranglerConfig -Value $updatedToml

Write-Host "Checking Cloudflare login..." -ForegroundColor Cyan
& npx.cmd wrangler whoami *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "A browser window may open for Cloudflare sign-in." -ForegroundColor Yellow
    Invoke-ExternalChecked "Cloudflare login" { npx.cmd wrangler login }
}

Write-Host "Saving Firebase secrets in Cloudflare..." -ForegroundColor Cyan
Set-WranglerSecretExact -Name "FIREBASE_CLIENT_EMAIL" -Value ([string]$serviceAccount.client_email).Trim() -WorkingDirectory $worker
Set-WranglerSecretExact -Name "FIREBASE_PRIVATE_KEY" -Value ([string]$serviceAccount.private_key).Trim() -WorkingDirectory $worker
Set-WranglerSecretExact -Name "FIREBASE_PRIVATE_KEY_ID" -Value ([string]$serviceAccount.private_key_id).Trim() -WorkingDirectory $worker

Write-Host "Deploying the Worker..." -ForegroundColor Cyan
Invoke-ExternalChecked "Worker deployment" { npx.cmd wrangler deploy }

Write-Host "Checking the deployed FCM configuration..." -ForegroundColor Cyan
$config = Invoke-RestMethod -Method Get -Uri "$workerBase/fcm/config" -TimeoutSec 30
if (-not $config.enabled -or -not $config.vapidConfigured -or -not $config.serverReady) {
    throw "The Worker deployed, but FCM is not fully ready. Check Cloudflare secrets and the VAPID key."
}

Write-Host ""
Write-Host "FCM setup completed successfully." -ForegroundColor Green
Write-Host "Open the office, sign in, then press Enable notifications. A test notification will be sent automatically." -ForegroundColor Green
Write-Host "Firebase private credentials were stored only as Cloudflare secrets." -ForegroundColor Green
