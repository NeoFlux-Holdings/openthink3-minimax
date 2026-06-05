# PATCH the existing OpenThink3 OAuth client to add or update scopes / redirect_uris / cors origins.
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
  # Union of all scope tiers (basic + domain + platform).
  # Source of truth: src/lib/cfOAuth.ts:CF_OAUTH_CONFIG.scopes
  scopes = @(
    # Tier 1 — basic (account discovery + worker/Pages/KV/D1 deploy)
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
    # Tier 2 — custom-domain subdomain deploy + SSL automation
    "zone.write",
    "zone-settings.read",
    "zone-settings.write",
    "ssl-and-certificates.read",
    "ssl-and-certificates.write",
    # Tier 3 — full platform surface
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
