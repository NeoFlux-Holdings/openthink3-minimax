# Creates the OpenThink3 Cloudflare OAuth client (public, PKCE).
# Account id is hard-coded for thomas.zarebczan@gmail.com.
#
# Requires an API token with `OAuth Clients: Write` permission.
# After creation the script prints the client_id — paste it into
# src/lib/cfOAuth.ts:CF_OAUTH_CONFIG.clientId and into
# `wrangler secret put OAUTH_CLIENT_ID`.

$CF_TOKEN = $env:CF_OAUTH_SETUP_TOKEN
if (-not $CF_TOKEN) {
  Write-Host "Set CF_OAUTH_SETUP_TOKEN in the env (an API token with `OAuth Clients: Write` permission) and re-run." -ForegroundColor Yellow
  exit 1
}
$ACCT = "5c7b9547d3e8e93f815ccb235fb5be8b"

$body = @{
  client_name = "OpenThink3"
  grant_types = @("authorization_code", "refresh_token")
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
  scopes = @(
    "account-settings.read",
    "user-details.read",
    "workers-scripts.write",
    "workers-routes.write",
    "workers-kv-storage.write",
    "page.write",
    "d1.write",
    "zone.read",
    "offline_access"
  )
  response_types = @("code")
  token_endpoint_auth_method = "none"
  client_uri = "https://openthink3.com"
  allowed_cors_origins = @(
    "http://localhost:5173",
    "https://openthink3-worker.thomas-zarebczan.workers.dev",
    "https://openthink-harness.pages.dev",
    "https://beta3.open-think.app",
    "https://open-think.app"
  )
} | ConvertTo-Json -Depth 6

try {
  $r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$ACCT/oauth_clients" `
    -Method Post -Headers @{Authorization="Bearer $CF_TOKEN"; "Content-Type"="application/json"} -Body $body
  $r | ConvertTo-Json -Depth 8
  Write-Host ""
  Write-Host "Client ID:" -ForegroundColor Green
  Write-Host $r.result.id -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Next:" -ForegroundColor Yellow
  Write-Host "  1. Paste the client_id into src/lib/cfOAuth.ts (CF_OAUTH_CONFIG.clientId)"
  Write-Host "  2. cd worker && npx wrangler secret put OAUTH_CLIENT_ID  (paste the same id)"
  Write-Host "  3. cd worker && npx wrangler secret put SESSION_SECRET  (any random 32+ char string)"
  Write-Host "  4. cd worker && npx wrangler deploy"
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = [System.IO.StreamReader]::new($resp.GetResponseStream())
    Write-Host "Cloudflare error:" -ForegroundColor Red
    Write-Host $reader.ReadToEnd() -ForegroundColor Red
  } else {
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
  exit 1
}
