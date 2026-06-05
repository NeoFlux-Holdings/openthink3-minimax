# PATCH the existing OpenThink3 OAuth client to add or update redirect_uris + cors origins.
# Requires an API token with `Account Settings: Edit` permission (must be set in env).
#
# Usage:
#   $env:CF_OAUTH_PATCH_TOKEN = "cfat_…"
#   pwsh ./oauth-patch.ps1

$CF_TOKEN = $env:CF_OAUTH_PATCH_TOKEN
if (-not $CF_TOKEN) {
  Write-Host "Set CF_OAUTH_PATCH_TOKEN in the env (an API token with `Account Settings: Edit` permission) and re-run." -ForegroundColor Yellow
  exit 1
}
$ACCT = "5c7b9547d3e8e93f815ccb235fb5be8b"
$CLIENT_ID = "23e10929d8b4e594d8756f6e24b2578c"

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
} | ConvertTo-Json -Depth 6

try {
  $r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$ACCT/oauth_clients/$CLIENT_ID" `
    -Method Patch -Headers @{Authorization="Bearer $CF_TOKEN"; "Content-Type"="application/json"} -Body $body
  $r | ConvertTo-Json -Depth 8
  Write-Host ""
  Write-Host "Patched client $CLIENT_ID on account $ACCT" -ForegroundColor Green
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
