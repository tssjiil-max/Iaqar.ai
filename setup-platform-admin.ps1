$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$adminDir = Join-Path $root "admin"
Set-Location $adminDir

Write-Host "IAQAR platform administrator setup" -ForegroundColor Green
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "Node.js is not installed" }
if (-not (Test-Path "node_modules")) { npm.cmd install }

Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Select Firebase service account JSON"
$dialog.Filter = "Firebase service account (*.json)|*.json"
$dialog.CheckFileExists = $true
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw "No JSON file selected" }

$email = Read-Host "Platform administrator email"
$securePassword = Read-Host "New administrator password (8+ characters)" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
  $env:IAQAR_SERVICE_ACCOUNT_JSON = $dialog.FileName
  $env:IAQAR_ADMIN_EMAIL = $email
  $env:IAQAR_ADMIN_PASSWORD = $plainPassword
  node setup-platform-admin.mjs
  if ($LASTEXITCODE -ne 0) { throw "Administrator setup failed" }
  Write-Host "Platform administrator created successfully" -ForegroundColor Green
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
  Remove-Item Env:IAQAR_SERVICE_ACCOUNT_JSON -ErrorAction SilentlyContinue
  Remove-Item Env:IAQAR_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:IAQAR_ADMIN_PASSWORD -ErrorAction SilentlyContinue
}
