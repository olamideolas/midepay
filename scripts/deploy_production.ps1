# ==============================================================================
# MidePay v4.1 — Windows PowerShell Production Deployment & Secrets Script
# Target Supabase Project: pxdzdehocjnmxbuvipxu
# ==============================================================================

$ErrorActionPreference = "Stop"
$ProjectRef = if ($env:SUPABASE_PROJECT_REF) { $env:SUPABASE_PROJECT_REF } else { "pxdzdehocjnmxbuvipxu" }
$env:APP_ENV = if ($env:APP_ENV) { $env:APP_ENV } else { "production" }

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " MidePay v4.1 — Running Pre-Deploy Validation Gates" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

node scripts/validate_production.js
node scripts/test_e2e_runtime.js
node scripts/test_payment_webhook.js

Write-Host "`nLinking & Pushing Supabase Migrations ($ProjectRef)..." -ForegroundColor Green
npx --yes supabase@latest link --project-ref $ProjectRef

$SecretArgs = @()
if ($env:PAYSTACK_SECRET_KEY)     { $SecretArgs += "PAYSTACK_SECRET_KEY=$($env:PAYSTACK_SECRET_KEY)" }
if ($env:FLUTTERWAVE_SECRET_KEY)  { $SecretArgs += "FLUTTERWAVE_SECRET_KEY=$($env:FLUTTERWAVE_SECRET_KEY)" }
if ($env:FLUTTERWAVE_WEBHOOK_HASH){ $SecretArgs += "FLUTTERWAVE_WEBHOOK_HASH=$($env:FLUTTERWAVE_WEBHOOK_HASH)" }
if ($env:ALLOWED_ORIGINS)         { $SecretArgs += "ALLOWED_ORIGINS=$($env:ALLOWED_ORIGINS)" }

if ($SecretArgs.Count -gt 0) {
  Write-Host "Syncing Edge Function secrets to Supabase Vault..."
  npx --yes supabase@latest secrets set @SecretArgs --project-ref $ProjectRef
}

npx --yes supabase@latest db push
npx --yes supabase@latest functions deploy init-payment --project-ref $ProjectRef
npx --yes supabase@latest functions deploy bank-payout --project-ref $ProjectRef
npx --yes supabase@latest functions deploy payment-webhook --no-verify-jwt --project-ref $ProjectRef

Write-Host "`nBuilding & Deploying Frontend to Vercel Production..." -ForegroundColor Cyan
node build.js
npx --yes vercel@latest --prod --yes
