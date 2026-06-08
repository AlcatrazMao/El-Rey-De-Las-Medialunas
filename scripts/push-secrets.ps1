# ============================================================================
# push-secrets.ps1 — Subir secrets al worker admin-users-production
# Uso: .\scripts\push-secrets.ps1
# ============================================================================
param(
  [string]$AuthSecret = "",
  [string]$SaJsonPath = ".\firebase-key.json",
  [string]$FbApiKey = ""
)

$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\..\workers\admin-users"

Write-Host "=== Pushing AUTH_SECRET ===" -ForegroundColor Yellow
if ($AuthSecret -eq "") { $AuthSecret = Read-Host -Prompt "AUTH_SECRET" }
[IO.File]::WriteAllText("$env:TEMP\auth.txt", $AuthSecret, [Text.Encoding]::UTF8)
Get-Content "$env:TEMP\auth.txt" -Raw | npx wrangler secret put AUTH_SECRET --env production
Write-Host "AUTH_SECRET: OK ($($AuthSecret.Length) chars)" -ForegroundColor Green

Write-Host "`n=== Pushing FIREBASE_SERVICE_ACCOUNT ===" -ForegroundColor Yellow
if (-not (Test-Path $SaJsonPath)) {
  Write-Host "No se encontró $SaJsonPath. Pegá el JSON ahora (Ctrl+Z + Enter para terminar):" -ForegroundColor Cyan
  $json = $input | Out-String
} else {
  $json = Get-Content $SaJsonPath -Raw
}
[IO.File]::WriteAllText("$env:TEMP\sa.json", $json.Trim(), [Text.Encoding]::UTF8)
Get-Content "$env:TEMP\sa.json" -Raw | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT --env production
Write-Host "FIREBASE_SERVICE_ACCOUNT: OK ($($json.Trim().Length) chars)" -ForegroundColor Green

Write-Host "`n=== Pushing FIREBASE_API_KEY ===" -ForegroundColor Yellow
if ($FbApiKey -eq "") { $FbApiKey = Read-Host -Prompt "FIREBASE_API_KEY" }
[IO.File]::WriteAllText("$env:TEMP\fbkey.txt", $FbApiKey, [Text.Encoding]::UTF8)
Get-Content "$env:TEMP\fbkey.txt" -Raw | npx wrangler secret put FIREBASE_API_KEY --env production
Write-Host "FIREBASE_API_KEY: OK ($($FbApiKey.Length) chars)" -ForegroundColor Green

Write-Host "`n=== Listo. Los 3 secrets están en admin-users-production ===" -ForegroundColor Green
