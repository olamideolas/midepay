#!/usr/bin/env bash
# ==============================================================================
# MidePay v4.1 — Enterprise Production Deployment & Secrets Automation Script
# Target Supabase Project: pxdzdehocjnmxbuvipxu
# Target Edge Hosting: Vercel Production (`vercel --prod`)
# ==============================================================================

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-pxdzdehocjnmxbuvipxu}"
export APP_ENV="${APP_ENV:-production}"

echo "======================================================================"
echo " MidePay v4.1 — Production Pre-Flight Validation Gates"
echo "======================================================================"

node scripts/validate_production.js
node scripts/test_e2e_runtime.js
node scripts/test_payment_webhook.js

echo ""
echo "======================================================================"
echo " Step 1: Supabase Database Migrations & Edge Functions Deployment"
echo "======================================================================"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: Supabase CLI not installed. Install via: npm install -g supabase" >&2
  exit 1
fi

supabase link --project-ref "${PROJECT_REF}"

# Configure Edge Function Vault secrets if exported in current shell environment
SECRET_ARGS=()
[[ -n "${PAYSTACK_SECRET_KEY:-}" ]] && SECRET_ARGS+=("PAYSTACK_SECRET_KEY=${PAYSTACK_SECRET_KEY}")
[[ -n "${FLUTTERWAVE_SECRET_KEY:-}" ]] && SECRET_ARGS+=("FLUTTERWAVE_SECRET_KEY=${FLUTTERWAVE_SECRET_KEY}")
[[ -n "${FLUTTERWAVE_WEBHOOK_HASH:-}" ]] && SECRET_ARGS+=("FLUTTERWAVE_WEBHOOK_HASH=${FLUTTERWAVE_WEBHOOK_HASH}")
[[ -n "${ALLOWED_ORIGINS:-}" ]] && SECRET_ARGS+=("ALLOWED_ORIGINS=${ALLOWED_ORIGINS}")

if [[ ${#SECRET_ARGS[@]} -gt 0 ]]; then
  echo "Syncing encrypted Edge Function secrets to Supabase Vault..."
  supabase secrets set "${SECRET_ARGS[@]}" --project-ref "${PROJECT_REF}"
fi

echo "Pushing PostgreSQL migrations (including 20261116000000 & 20261116010000)..."
supabase db push

echo "Deploying JWT-protected Edge Functions (init-payment, bank-payout)..."
supabase functions deploy init-payment --project-ref "${PROJECT_REF}"
supabase functions deploy bank-payout --project-ref "${PROJECT_REF}"

echo "Deploying cryptographic webhook Edge Function (payment-webhook with --no-verify-jwt)..."
supabase functions deploy payment-webhook --no-verify-jwt --project-ref "${PROJECT_REF}"

echo ""
echo "======================================================================"
echo " Step 2: Build & Deploy Frontend to Vercel Production"
echo "======================================================================"

if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: Vercel CLI not installed. Install via: npm install -g vercel" >&2
  exit 1
fi

node build.js

if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  vercel --prod --yes --token "${VERCEL_TOKEN}"
else
  vercel --prod --yes
fi

echo ""
echo "======================================================================"
echo " MidePay v4.1 Production Deployment Complete!"
echo " Webhook URL: https://${PROJECT_REF}.supabase.co/functions/v1/payment-webhook"
echo "======================================================================"

