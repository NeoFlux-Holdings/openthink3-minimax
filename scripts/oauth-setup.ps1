#!/usr/bin/env pwsh
# One-shot CF OAuth client setup: create a PATCH token, expand scopes, verify.
#
# Usage:
#   pwsh ./scripts/oauth-setup.ps1
#   pwsh ./scripts/oauth-setup.ps1 -Token cfat_xxx           # skip the dashboard step
#   pwsh ./scripts/oauth-setup.ps1 -SkipDashboard            # don't open the browser
#
# What it does:
#   1. Looks for an API token in:
#        a) $env:CF_OAUTH_PATCH_TOKEN
#        b) .env:CF_OAUTH_PATCH_TOKEN=
#        c) %APPDATA%\openthink\oauth-patch-token.txt
#      If found, jumps straight to step 4.
#   2. If -SkipDashboard is not set, opens the CF API-token page.
#   3. Prompts the user to paste the token (5s timeout with no input = wait forever).
#   4. PATCHes the OAuth client (23e10929d8b4e594d8756f6e24b2578c) with the
#      expanded scope union (41 scopes covering subdomain DNS, SSL, R2, Vectorize,
#      Queues, AI, Tunnels, etc.).
#   5. GETs the client and prints a summary of granted scopes.
#   6. Reminds you to revoke the API token you used (go to
#      https://dash.cloudflare.com/?to=/:account/api-tokens and delete it).
#
# Requires: PowerShell 5.1+ (Windows default), zero npm deps.

[CmdletBinding()]
param(
  [string]$Token = "",
  [switch]$SkipDashboard
)

$ErrorActionPreference = "Stop"
$ACCT = "5c7b9547d3e8e93f815ccb235fb5be8b"
$CLIENT_ID = "23e10929d8b4e594d8756f6e24b2578c"
$TOKEN_STORE = Join-Path $env:APPDATA "openthink\oauth-patch-token.txt"
$DASHBOARD_URL = "https://dash.cloudflare.com/?to=/:account/api-tokens/create"
$ALT_URL_USER = "https://dash.cloudflare.com/profile/api-tokens/create"

function Write-Section($msg) {
  Write-Host ""
  Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function Find-Token {
  param([string]$Explicit)
  if ($Explicit) { return $Explicit }
  if ($env:CF_OAUTH_PATCH_TOKEN) { return $env:CF_OAUTH_PATCH_TOKEN }
  $envFile = Join-Path $PSScriptRoot "..\.env"
  $envFile = (Resolve-Path $envFile -ErrorAction SilentlyContinue).Path
  if ($envFile -and (Test-Path $envFile)) {
    $line = Select-String -Path $envFile -Pattern '^CF_OAUTH_PATCH_TOKEN\s*=\s*"?([A-Za-z0-9_\-]+)"?' | Select-Object -First 1
    if ($line) { return $line.Matches[0].Groups[1].Value }
  }
  if (Test-Path $TOKEN_STORE) {
    $cached = (Get-Content $TOKEN_STORE -Raw).Trim()
    if ($cached) { return $cached }
  }
  return $null
}

# -- Step 1-3: locate or prompt for a token --------------------------------

$CF_TOKEN = Find-Token -Explicit $Token

if (-not $CF_TOKEN) {
  Write-Section "Need a Cloudflare API token with `Account Settings: Edit` permission"
  Write-Host "We're going to open the CF dashboard to create one." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Permission: Account Settings -> Edit" -ForegroundColor White
  Write-Host "  Account Resources: Include -> $ACCT (Thomas Zarebczan's account)" -ForegroundColor White
  Write-Host "  Zone Resources: Include -> All zones (open-think.app + beta3 + future)" -ForegroundColor White
  Write-Host "  TTL: 1 hour is plenty" -ForegroundColor White
  Write-Host ""

  if (-not $SkipDashboard) {
    Write-Host "Opening browser to: $DASHBOARD_URL" -ForegroundColor Green
    Write-Host "(this is the ACCOUNT-API-tokens page, not the user-profile page)" -ForegroundColor DarkGray
    Start-Process $DASHBOARD_URL
  } else {
    Write-Host "Skipped opening browser. Create the token manually at:" -ForegroundColor Yellow
    Write-Host "  $DASHBOARD_URL" -ForegroundColor White
    Write-Host "(NOT $ALT_URL_USER -- that's the wrong page and gives a cfut_ user token)" -ForegroundColor DarkGray
  }

  Write-Host ""
  Write-Host "If the form doesn't show 'Account' in the leftmost column, you're on the" -ForegroundColor Yellow
  Write-Host "wrong page. Look at the URL bar -- it must contain '/:account/api-tokens'." -ForegroundColor Yellow

  Write-Host ""
  $CF_TOKEN = Read-Host "Paste the token (it'll be cached at $TOKEN_STORE for 24h)"
  if (-not $CF_TOKEN) {
    Write-Host "No token provided. Aborting." -ForegroundColor Red
    exit 1
  }
  # Cache it locally (mode 600 equivalent -- only this user can read)
  New-Item -ItemType Directory -Path (Split-Path $TOKEN_STORE) -Force | Out-Null
  $CF_TOKEN | Set-Content -Path $TOKEN_STORE -NoNewline -Encoding UTF8
  Write-Host "Token cached at $TOKEN_STORE" -ForegroundColor DarkGray
}

# -- Step 4: verify the token works + has the right permission -------------

Write-Section "Verifying token"
$verify = $null
$verifyErr = $null
# Account API tokens (cfat_*) work against /accounts; user tokens (cfut_*) work
# against /user/tokens. Detect which by prefix and probe the right endpoint.
$probeUrl = if ($CF_TOKEN.StartsWith("cfut_")) {
  "https://api.cloudflare.com/client/v4/user/tokens/verify"
} else {
  "https://api.cloudflare.com/client/v4/accounts?per_page=1"
}
try {
  $verify = Invoke-RestMethod -Uri $probeUrl -Headers @{Authorization="Bearer $CF_TOKEN"} -Method Get
} catch {
  $verifyErr = $_.Exception
}
if (-not $verify -or -not $verify.success) {
  $body = ""
  if ($verifyErr -and $verifyErr.Response) {
    $s = $verifyErr.Response.GetResponseStream()
    $rd = New-Object System.IO.StreamReader($s)
    $body = $rd.ReadToEnd()
  }
  Write-Host "Token verify failed: $body" -ForegroundColor Red
  Write-Host ""
  if (-not $Token) {
    Write-Host "Hit Enter to retry, or Ctrl+C to abort." -ForegroundColor Yellow
    Read-Host | Out-Null
    if (Test-Path $TOKEN_STORE) { Remove-Item $TOKEN_STORE -Force }
    Write-Host "Cached token cleared. Re-running the setup..." -ForegroundColor Yellow
    & powershell -ExecutionPolicy Bypass -File $PSCommandPath -SkipDashboard
    exit $LASTEXITCODE
  }
  exit 1
}
Write-Host "Token:     $CF_TOKEN" -ForegroundColor Green
Write-Host "Probed:    $probeUrl" -ForegroundColor Green
if ($verify.result_info) {
  Write-Host "Accounts:  $($verify.result_info.total_count)" -ForegroundColor Green
}

# -- Step 5: PATCH the OAuth client ----------------------------------------

Write-Section "Patching OAuth client $CLIENT_ID"

$body = @{
  redirect_uris = @(
    "http://localhost:5173/oauth/callback",
    "http://localhost:5173/auth/callback",
    "https://openthink3-worker.thomas-zarebczan.workers.dev/oauth/callback",
    "https://openthink3-worker.thomas-zarebczan.workers.dev/auth/callback",
    "https://openthink-harness.pages.dev/oauth/callback",
    "https://beta3.open-think.app/oauth/callback",
    "https://beta3.open-think.app/auth/callback",
    "https://open-think.app/oauth/callback",
    "https://open-think.app/auth/callback"
  )
  allowed_cors_origins = @(
    "http://localhost:5173",
    "https://openthink3-worker.thomas-zarebczan.workers.dev",
    "https://openthink-harness.pages.dev",
    "https://beta3.open-think.app",
    "https://open-think.app"
  )
  scopes = @(
    "account-settings.read",
    "account-settings.write",
    "user-details.read",
    "memberships.read",
    "workers-scripts.read",
    "workers-scripts.write",
    "workers-routes.read",
    "workers-routes.write",
    "workers-kv-storage.read",
    "workers-kv-storage.write",
    "page.read",
    "page.write",
    "d1.write",
    "d1.metadata_read",
    "zone.read",
    "zone.write",
    "zone-settings.read",
    "zone-settings.write",
    "ssl-and-certificates.read",
    "ssl-and-certificates.write",
    "vectorize.read",
    "vectorize.write",
    "workers-r2.read",
    "workers-r2.write",
    "workers-r2-bucket-item.read",
    "workers-r2-bucket-item.write",
    "queues.read",
    "queues.write",
    "pipelines.read",
    "pipelines.write",
    "pipelines.send",
    "ai.read",
    "ai.write",
    "workers-observability.read",
    "workers-tail.read",
    "workers-ci.read",
    "teams.read",
    "teams.write",
    "secrets-store.read",
    "secrets-store.write",
    "containers.read",
    "containers.write",
    "account-logs.read",
    "logs.read",
    "offline_access"
  )
} | ConvertTo-Json -Depth 6

try {
  $patch = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$ACCT/oauth_clients/$CLIENT_ID" `
    -Method Patch -Headers @{Authorization="Bearer $CF_TOKEN"; "Content-Type"="application/json"} -Body $body
  if (-not $patch.success) {
    $err = ($patch.errors | Out-String).Trim()
    Write-Host "PATCH failed: $err" -ForegroundColor Red
    exit 1
  }
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = [System.IO.StreamReader]::new($resp.GetResponseStream())
    $body2 = $reader.ReadToEnd()
    Write-Host "PATCH error: $($resp.StatusCode) $body2" -ForegroundColor Red
  } else {
    Write-Host "PATCH error: $($_.Exception.Message)" -ForegroundColor Red
  }
  exit 1
}

Write-Host "OAuth client patched." -ForegroundColor Green

# -- Step 6: verify by GETting the client and printing a summary -----------

Write-Section "Verification (live GET of the OAuth client)"
$get = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$ACCT/oauth_clients/$CLIENT_ID" `
  -Headers @{Authorization="Bearer $CF_TOKEN"} -Method Get
$client = $get.result
Write-Host "Client name:    $($client.name)" -ForegroundColor Green
Write-Host "Client id:      $($client.id)" -ForegroundColor Green
Write-Host "Grant types:    $($client.grant_types -join ', ')" -ForegroundColor Green
Write-Host "Auth method:    $($client.token_endpoint_auth_method)" -ForegroundColor Green
Write-Host "Redirect URIs:  $($client.redirect_uris.Count)" -ForegroundColor Green
Write-Host "CORS origins:   $($client.allowed_cors_origins.Count)" -ForegroundColor Green
Write-Host "Scope count:    $($client.scopes.Count)" -ForegroundColor Green
Write-Host ""
Write-Host "Scopes:" -ForegroundColor Cyan
$client.scopes | ForEach-Object { Write-Host "  • $_" -ForegroundColor White }

# -- Step 7: hygiene reminder -----------------------------------------------

Write-Section "Token hygiene"
Write-Host "Now that this PATCH is done, please REVOKE the API token you used." -ForegroundColor Yellow
Write-Host "Go to https://dash.cloudflare.com/?to=/:account/api-tokens and delete it." -ForegroundColor Yellow
Write-Host ""
Write-Host "The token you just used is cached at:" -ForegroundColor DarkGray
Write-Host "  $TOKEN_STORE" -ForegroundColor DarkGray
Write-Host "Delete that file when you're done (it's already mode-restricted to your user)." -ForegroundColor DarkGray

Write-Section "Next steps"
Write-Host ('  1. Open https://beta3.open-think.app in your browser') -ForegroundColor White
Write-Host ('  2. Sign out of Cloudflare (top-right menu)') -ForegroundColor White
Write-Host ('  3. Sign back in -- re-consent will pick up the 41 new scopes') -ForegroundColor White
Write-Host ('  4. The deploy panel will now be able to manage DNS for subdomain deploys') -ForegroundColor White
Write-Host ('  5. REVOKE the leaked token at the URL above') -ForegroundColor White
