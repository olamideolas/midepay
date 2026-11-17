# MidePay staging verification — 17 November 2026

**Decision: staging preview available; not ready for live money or production launch.**

Preview: https://midepay-4as10yyqw-ola-f90f.vercel.app

Vercel deployment `dpl_4aAEbsLmgPTkKDFMLTBQLhPVKomH` reached READY with Preview target (`target: null`), no production aliases. Existing Vercel protection remains enabled; use the Vercel owner account to open it.

## Scope and isolation

Only Supabase staging project `ajbhsmcosxgymrtawlmd` was used for hosted database and function changes. Production Supabase was not queried, modified, or deployed. Preview configuration and CSP contain only the approved staging database target. Both `/api/config` and `/config.js` returned HTTP 200 with staging URL and `FINANCIAL_RPCS_LIVE: false`; `/` returned HTTP 200. `APP_ENV=production` selects real authentication behavior and disables demo fallbacks; it does not select the database. The database URL selects staging.

Four Preview environment variables were scoped to `fix-v46-migration-repair`: APP_ENV, SUPABASE_URL, SUPABASE_ANON_KEY (publishable key), and FINANCIAL_RPCS_LIVE. Production variables were not changed. No private Paystack or Supabase key was added to frontend assets.

## Database and backend results

All 12 source migrations (the original ten plus independent hardening and email-proof/treasury changes) applied successfully on hosted PostgreSQL 17.12 staging. Actual migration history was normalized to the source filename versions after checking all twelve names and applied SQL, to avoid a later CLI replay. Schema inspection found 18 public and four private tables, all with RLS enabled; zero public client write policies and zero staging Auth users. Anonymous function execution was restricted to the intentional waitlist RPC.

All four Edge Functions are ACTIVE at version 1: init-payment and bank-payout retain gateway JWT verification; payment-webhook and verify-email-otp perform their own endpoint-specific authentication. Imports are pinned to the official Supabase SDK 2.119.0.

Security Advisor findings remain for intentional default-deny tables without policies and explicitly granted SECURITY DEFINER RPCs. These are not a clean advisory scan and must remain under review. Required RPCs use controlled grants and internal authorization; switching them blindly to invoker would break those APIs. See the earlier independent review for function-level findings and tests.

## Verified fixes in this staging iteration

- Replaced the custom browser SDK shim, which lacked signInWithOtp, setSession and MFA methods used by the app, with the official pinned UMD bundle. Recorded its npm integrity, license and bundle digest.
- Added an actual browser SDK contract test; corrected the DOM simulator so it exercises the server-side OTP flow and session installation without accidentally replacing its mocks with the real SDK.
- Added a staging-only packaging command with target checks, safe output handling, staging CSP and fixed disabled financial configuration.
- Removed embedded member accounts/passwords, contact/bank identifiers, transaction fixtures and waitlist leads from the preview artifact. Regression checks also verify JavaScript syntax after removal. Source prototype fixtures still exist in app.js; ordinary Git-based deployment does not sanitize them and must not be promoted to production.

The preview was uploaded as a generated staging artifact from the feature checkout, with dirty metadata against base commit 26892bb. It is not an exact Git-source deployment. The generator and fixes are saved on the feature branch for reproducibility; production configuration files in the source checkout were not retargeted.

## Actual automated tests

11 suites completed successfully, **237 PASS groups, zero failing suites**. Counts are assertion/log groups, not a claim of 237 independent end-to-end scenarios. Full logs and command outcomes are in `test-results.json` and adjacent `.log` files.

| Suite | PASS groups |
| --- | ---: |
| validate_production.js | 30 |
| test_payment_webhook.js | 12 |
| test_e2e_runtime.js | 37 |
| test_security_penetration.js | 13 |
| test_v46_postgres_migration.mjs | 55 |
| test_independent_database.mjs | 11 |
| test_independent_webhook.mjs | 15 |
| test_phase1_security.mjs | 32 |
| test_phase1_handlers.mjs | 12 |
| test_browser_sdk.js | 12 |
| test_staging_preview.js | 8 |

Database behavioral suites run in isolated PGlite. Hosted staging independently verifies migration execution, schema, RLS/grants and function deployment. It does not establish real PostgreSQL concurrent-session behavior, provider settlement correctness, email delivery or a complete browser-to-provider payment journey. No live payment was attempted.

## Remaining deployment blockers

1. In the **staging** Supabase dashboard, configure `ALLOWED_ORIGINS` to the exact preview origin above. Until configured, browser requests to protected-origin handlers fail closed.
2. Configure only a Paystack **test** secret in staging Edge Function secrets. Keep bank payouts disabled (`BANK_PAYOUTS_ENABLED=false`). No Paystack credential has been received or configured by this review.
3. Verify staging Auth email confirmation is enabled and signup/magic-link templates deliver the numeric `{{ .Token }}` required by the six-digit email OTP UI. Test signup, OTP expiry/replay, returning login, PIN enrollment and TOTP maker/checker approval in a real browser.
4. Configure the Paystack test webhook to `https://ajbhsmcosxgymrtawlmd.supabase.co/functions/v1/payment-webhook`, then test signed event replay, provider reference/amount/currency matching and balance reconciliation. Do not enable financial operations as a substitute for completing these checks.
5. Complete payout recovery/outbox and ambiguous provider response handling, durable retry/reconciliation, real concurrent transfer/double-spend tests and failover tests before enabling money movement.
6. Finish wiring disabled/legacy financial UI actions to reviewed server flows. Prototype marketing, demo display data and simulated product capabilities require a separate launch cleanup. A loaded landing page does not establish that all advertised features work.

Open the folder `C:\Users\TestAdmin\Downloads\midepay` in Antigravity and select `fix-v46-migration-repair`. Use the Preview URL for staging; do not promote it to production.
