# scripts/set-secrets.ps1
# One-shot script: reads .env, the PEM at GITHUB_PRIVATE_KEY_FILE, generates
# the 2 random secrets, and pushes all 5 to the worker via `wrangler secret bulk`.
#
# Usage (from project root):
#   cd worker
#   ../scripts/set-secrets.ps1
#
# Secrets pushed:
#   GITHUB_APP_PRIVATE_KEY     <- .env GITHUB_PRIVATE_KEY_FILE (PEM contents)
#   GITHUB_INSTALL_TOKEN_KEY   <- 32 random bytes, hex
#   GITHUB_WEBHOOK_SECRET      <- .env GITHUB_WEBHOOK_SECRET
#   GITHUB_CLIENT_SECRET       <- .env GITHUB_CLIENT_SECRET
#   SESSION_SECRET             <- 32 random bytes, hex

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envFile = Join-Path $root ".env"

if (-not (Test-Path $envFile)) {
  Write-Error "No .env at $envFile. Create one first."
  exit 1
}

$envMap = @{}
foreach ($line in (Get-Content $envFile)) {
  $trim = $line.Trim()
  if (-not $trim -or $trim.StartsWith("#")) { continue }
  $eq = $trim.IndexOf("=")
  if ($eq -lt 1) { continue }
  $k = $trim.Substring(0, $eq).Trim()
  $v = $trim.Substring($eq + 1).Trim().Trim('"', "'")
  $envMap[$k] = $v
}

if (-not $envMap["GITHUB_PRIVATE_KEY_FILE"]) {
  Write-Error ".env is missing GITHUB_PRIVATE_KEY_FILE=<path-to-pem>."
  exit 1
}
$pemPath = $envMap["GITHUB_PRIVATE_KEY_FILE"]
if (-not (Test-Path $pemPath)) {
  Write-Error "PEM file not found: $pemPath"
  exit 1
}
$pem = (Get-Content $pemPath -Raw).Trim()
if ($pem -notmatch "-----BEGIN [A-Z ]+-----") {
  Write-Error "File at $pemPath does not look like a PEM (no BEGIN header)."
  exit 1
}

foreach ($req in @("GITHUB_WEBHOOK_SECRET", "GITHUB_CLIENT_SECRET")) {
  if (-not $envMap[$req]) {
    Write-Error ".env is missing $req"
    exit 1
  }
}

function New-HexSecret {
  param([int]$Bytes = 32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $buf = New-Object 'byte[]' $Bytes
    $rng.GetBytes($buf)
  } finally {
    $rng.Dispose()
  }
  return -join ($buf | ForEach-Object { $_.ToString("x2") })
}

$sessionSecret = New-HexSecret
$installKey = New-HexSecret

$payload = [ordered]@{
  GITHUB_APP_PRIVATE_KEY    = $pem
  GITHUB_INSTALL_TOKEN_KEY  = $installKey
  GITHUB_WEBHOOK_SECRET     = $envMap["GITHUB_WEBHOOK_SECRET"]
  GITHUB_CLIENT_SECRET      = $envMap["GITHUB_CLIENT_SECRET"]
  SESSION_SECRET            = $sessionSecret
}
$json = $payload | ConvertTo-Json -Depth 5 -Compress
# PowerShell's ConvertTo-Json emits literal newlines inside multi-line string values
# (the PEM, in our case), which is invalid JSON. Fix it by escaping newlines.
$json = $json -replace '\\u000[aA]', '\\n'  # already-escaped \n in case PS 7 does that
# Re-do the PEM escape properly:
function ConvertTo-JsonSafe {
  param($obj)
  $lines = @()
  $lines += '{'
  $first = $true
  foreach ($k in $obj.Keys) {
    $v = [string]$obj[$k]
    $escaped = $v -replace '\\', '\\\\' -replace '"', '\"' -replace "`r", '\r' -replace "`n", '\n' -replace "`t", '\t'
    $comma = if ($first) { '' } else { ',' }
    $lines += "$comma`"$k`": `"$escaped`""
    $first = $false
  }
  $lines += '}'
  return ($lines -join "`n")
}
$json = ConvertTo-JsonSafe $payload

Write-Host ""
Write-Host "Generated secrets:" -ForegroundColor Cyan
Write-Host "  SESSION_SECRET          = $($sessionSecret.Substring(0, 8))... (32 bytes hex)"
Write-Host "  GITHUB_INSTALL_TOKEN_KEY= $($installKey.Substring(0, 8))... (32 bytes hex)"
Write-Host "  GITHUB_WEBHOOK_SECRET   = $($envMap['GITHUB_WEBHOOK_SECRET'].Substring(0, [Math]::Min(8, $envMap['GITHUB_WEBHOOK_SECRET'].Length)))..."
Write-Host "  GITHUB_CLIENT_SECRET    = $($envMap['GITHUB_CLIENT_SECRET'].Substring(0, [Math]::Min(8, $envMap['GITHUB_CLIENT_SECRET'].Length)))..."
Write-Host "  GITHUB_APP_PRIVATE_KEY  = $pemPath ($((Get-Item $pemPath).Length) bytes)"
Write-Host ""
Write-Host "Pushing 5 secrets to wrangler..." -ForegroundColor Yellow

# `wrangler secret bulk -` is broken on Windows PowerShell, so use a temp file.
$tmp = New-TemporaryFile
try {
  Set-Content -LiteralPath $tmp -Value $json -NoNewline -Encoding UTF8
  npx wrangler secret bulk $tmp.FullName
  if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "All 5 secrets pushed. You can verify with:" -ForegroundColor Green
    Write-Host "  npx wrangler secret list"
    Write-Host ""
    Write-Host "Save the new SESSION_SECRET and GITHUB_INSTALL_TOKEN_KEY somewhere safe" -ForegroundColor Yellow
    Write-Host "(they are also stored in Cloudflare, so a fresh re-push is fine if lost):"
    Write-Host "  SESSION_SECRET=$sessionSecret"
    Write-Host "  GITHUB_INSTALL_TOKEN_KEY=$installKey"
  } else {
    Write-Error "wrangler secret bulk exited with code $LASTEXITCODE"
    exit $LASTEXITCODE
  }
} finally {
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
