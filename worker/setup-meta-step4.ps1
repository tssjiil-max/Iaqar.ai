$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "IAQAR multi-office WhatsApp setup" -ForegroundColor Green
Write-Host "Inbound only: automatic outbound WhatsApp remains disabled." -ForegroundColor Yellow

$appId = Read-Host "Meta App ID"
$configId = Read-Host "Embedded Signup Configuration ID"
$appSecretSecure = Read-Host "Meta App Secret" -AsSecureString
$appSecret = [System.Net.NetworkCredential]::new("", $appSecretSecure).Password
$vapidKey = Read-Host "Firebase Web Push VAPID public key [optional now]"
$verifyToken = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})

$toml = Get-Content -Raw -LiteralPath ".\wrangler.toml"
$toml = [regex]::Replace($toml, 'META_APP_ID = ".*"', 'META_APP_ID = "' + $appId + '"')
$toml = [regex]::Replace($toml, 'META_CONFIG_ID = ".*"', 'META_CONFIG_ID = "' + $configId + '"')
$toml = [regex]::Replace($toml, 'FCM_WEB_PUSH_VAPID_KEY = ".*"', 'FCM_WEB_PUSH_VAPID_KEY = "' + $vapidKey + '"')
Set-Content -LiteralPath ".\wrangler.toml" -Value $toml -Encoding UTF8

$appSecret | npx wrangler secret put META_APP_SECRET
$verifyToken | npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN

npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "Worker deployment failed." }

$callback = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev/meta/webhook"
@("META WEBHOOK CALLBACK URL", $callback, "", "VERIFY TOKEN - KEEP PRIVATE", $verifyToken) | Set-Content -LiteralPath ".\META-WEBHOOK-PRIVATE.txt" -Encoding UTF8

Write-Host "Deployment completed." -ForegroundColor Green
Write-Host "Callback URL: $callback"
Write-Host "Private verify token saved in META-WEBHOOK-PRIVATE.txt" -ForegroundColor Yellow
Write-Host "All registered offices can use Embedded Signup; mappings are isolated by officeId." -ForegroundColor Cyan
Read-Host "Press Enter to close"
