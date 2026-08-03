$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$adminDir = Join-Path $root "admin"
Set-Location $adminDir

Write-Host "IAQAR office phone login migration" -ForegroundColor Green
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "Node.js is not installed" }
if (-not (Test-Path "node_modules")) { npm.cmd install }

Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Select Firebase service account JSON"
$dialog.Filter = "Firebase service account (*.json)|*.json"
$dialog.CheckFileExists = $true
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw "No JSON file selected" }

$email = Read-Host "Existing office account email"
$phone = Read-Host "Saudi mobile number (05xxxxxxxx)"
$officeId = Read-Host "Existing office ID (press Enter to detect automatically)"
try {
  $env:IAQAR_SERVICE_ACCOUNT_JSON = $dialog.FileName
  $env:IAQAR_LOGIN_EMAIL = $email
  $env:IAQAR_LOGIN_PHONE = $phone
  $env:IAQAR_OFFICE_ID = $officeId
  node link-office-phone-login.mjs
  if ($LASTEXITCODE -ne 0) { throw "Phone login migration failed" }
  Write-Host "Office phone login linked successfully" -ForegroundColor Green
} finally {
  Remove-Item Env:IAQAR_SERVICE_ACCOUNT_JSON -ErrorAction SilentlyContinue
  Remove-Item Env:IAQAR_LOGIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:IAQAR_LOGIN_PHONE -ErrorAction SilentlyContinue
  Remove-Item Env:IAQAR_OFFICE_ID -ErrorAction SilentlyContinue
}
