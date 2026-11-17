# MidePay v4.6 — Independent Verification Checklist & Staging Runbook (Codex Handoff)

**Branch:** `fix-v46-migration-repair`  
**Primary Migration:** `supabase/migrations/20261116050000_auth_verification_gate.sql`  
**Production Safety Rule:** **DO NOT** run `supabase db push` or execute SQL against the production project (`pxdzdehocjnmxbuvipxu`) until all staging verification gates below pass and external provider blockers are resolved or confirmed intentionally quarantined.

---

## 1. Repository Files Modified / Added

| File | Purpose |
|---|---|
| `supabase/migrations/20260928000000_payment_requests.sql` | Catches `undefined_object` alongside `duplicate_object` on `ALTER PUBLICATION supabase_realtime`. |
| `supabase/migrations/20261116020000_nuban_and_cards_production.sql` | Adds `CREATE SCHEMA IF NOT EXISTS extensions;` and `SET search_path = public, extensions, pg_temp` so `pgcrypto` functions resolve identically on hosted Supabase and standalone PostgreSQL. |
| `supabase/migrations/20261116030000_midesave_bills_payroll.sql` | Reconciles legacy `20260923` `savings_vaults` (`status`, `current_balance`) and `payroll_runs` (`user_id`, `total_amount`, nullable `business_id`) columns before index creation so `030000` never rolls back. |
| `supabase/migrations/20261116040000_backend_security_hardening.sql` | Adds `CREATE TABLE IF NOT EXISTS public.payroll_items` + indexes before `ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY`. |
| `supabase/migrations/20261116050000_auth_verification_gate.sql` | Complete self-healing v4.6 schema reconciliation, RLS + column-level `SELECT` lockdown across all 18 tables, PCI PAN/CVV scrubbing, Email OTP + mandatory bcrypt PIN + 5-strike lockout + expiry reset, `frozen_by_admin` compliance separation, user-scoped idempotency + payload hash + `pg_advisory_xact_lock`, universal ledger parity, and explicit quarantine of unintegrated providers. |
| `supabase/schema.sql` | Lists all 10 migrations (`20260923000000` through `20261116050000`) in exact execution order. |
| `supabase/functions/bank-payout/index.ts` | Enforces `email_confirmed_at` + `email_otp_verified_at`, resets expired PIN lockout strikes, logs failed PIN strikes to `security_audit_logs`, and keeps outbound NIP payouts in `'pending'` status until webhook settlement. |
| `supabase/functions/payment-webhook/index.ts` | Adds `finalize_payout_settlement` handling for Paystack `transfer.success` and S2S-verified Flutterwave `transfer.completed` (`SUCCESSFUL`). |
| `supabaseClient.js` & `app.js` | Replaces `.select('*')` on `profiles` and `virtual_cards` with explicit safe column lists (compatible with column-level `REVOKE SELECT` on PIN hashes & card secrets), removes cross-user `.from('profiles')` lookup fallback, and passes settled `txRef` to `respond_payment_request`. |
| `api/config.js` | Mirrors `FINANCIAL_RPCS_LIVE` (default `false`) in dynamic config responses. |
| `scripts/test_v46_postgres_migration.mjs` | Real compiled PostgreSQL 18.6 (`@electric-sql/pglite` + `pgcrypto` + `uuid-ossp`) automated migration, upgrade, privilege, concurrency, rollback, and ledger reconciliation test suite. |
| `docs/MIDEPAY_V46_AUDIT.md` | Full root-cause compatibility report & 20-point financial security audit. |
| `docs/MIDEPAY_V46_TEST_REPORT.md` | Verbatim automated execution results & remaining provider blockers. |

---

## 2. Independent Verification Checklist for Codex

Run every check below from the repository root on branch `fix-v46-migration-repair` **without** connecting to production:

### Step A — Run All Local Static, Webhook, E2E & Real PostgreSQL Test Suites
```bash
# 1. Static asset, syntax, DOM parity & SQL structural validator
node scripts/validate_production.js

# 2. Edge Function TypeScript syntax & HMAC-SHA512 / Flutterwave S2S webhook suite
node scripts/test_payment_webhook.js

# 3. Headless DOM / OTP / Mandatory PIN / Submit-Lock E2E runtime suite
node scripts/test_e2e_runtime.js

# 4. Adversarial CSP, secrets, RLS & pen-test suite
node scripts/test_security_penetration.js

# 5. Real PostgreSQL 18.6 clean chain + legacy upgrades + concurrency + ledger reconciliation
#    (If @electric-sql/pglite is not installed in node_modules, install in a temp dir and pass PGLITE_MODULE_DIR)
node scripts/test_v46_postgres_migration.mjs
```

### Step B — Independent SQL Catalog Queries to Run Against Any Disposable / Staging DB
After applying the migrations to an isolated disposable PostgreSQL or Supabase Staging project, execute the following read-only verification queries:

```sql
-- 1. Confirm ALL 18 public tables have RLS enabled (`no_rls_count` MUST be 0)
SELECT COUNT(*) AS total_tables,
       COUNT(*) FILTER (WHERE NOT rowsecurity) AS no_rls_count
FROM pg_tables
WHERE schemaname = 'public';

-- 2. Confirm ZERO client INSERT/UPDATE/DELETE/ALL policies exist (`write_policy_count` MUST be 0)
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND cmd <> 'SELECT';

-- 3. Confirm ZERO duplicate overloaded application functions exist in `public`
SELECT p.proname, COUNT(*)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
  )
GROUP BY p.proname
HAVING COUNT(*) > 1;

-- 4. Confirm `anon` can ONLY execute `join_waitlist` (and optional pgcrypto/uuid extension C funcs if installed in public)
SELECT p.oid::regprocedure::text AS callable_by_anon
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
  )
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 5. Confirm `authenticated` CANNOT execute server-only settlement or quarantined provider RPCs (MUST return 0 rows)
SELECT p.oid::regprocedure::text AS unsafe_grant
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'concept_topup_wallet', 'execute_external_bank_transfer',
    'issue_virtual_card', 'fund_virtual_card', 'fund_virtual_card_from_wallet',
    'generate_unique_virtual_card_pan', 'pay_vtu_bill', 'pay_utility_bill',
    'execute_payroll_batch', 'execute_business_payroll',
    'settle_gateway_deposit', 'debit_wallet_for_payout',
    'finalize_payout_settlement', 'reverse_failed_payout',
    'generate_unique_midepay_nuban', '_assert_verified_wallet_ready', '_verify_pin_and_audit'
  )
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- 6. Confirm zero stored PANs or CVVs exist in `virtual_cards`
SELECT COUNT(*) FILTER (WHERE card_number IS NOT NULL) AS exposed_pans,
       COUNT(*) FILTER (WHERE cvv IS NOT NULL) AS exposed_cvvs
FROM public.virtual_cards;
```

---

## 3. Safe Staging Deployment Procedure

1. **Create / Target a Separate Supabase Staging Project (NEVER Production First):**
   - Provision a dedicated non-production Supabase project (e.g., `midepay-staging`).
   - In Supabase Dashboard -> **Authentication -> Providers -> Email**:
     - Enable **Confirm email** (`mailer_autoconfirm = false`).
     - Update the **Confirm signup** email template to include `{{ .Token }}` (6-digit OTP).
2. **Backup Staging Schema & Data (If Upgrading an Existing Staging Project):**
   ```bash
   supabase db dump --project-ref <STAGING_PROJECT_REF> -f backup_pre_v46_staging.sql
   supabase db dump --project-ref <STAGING_PROJECT_REF> --data-only -f backup_pre_v46_staging_data.sql
   ```
3. **Link CLI Exclusively to `<STAGING_PROJECT_REF>` & Dry-Run:**
   ```bash
   supabase link --project-ref <STAGING_PROJECT_REF>
   supabase db push --dry-run
   ```
4. **Apply Migrations to Staging & Run Catalog Audit Queries:**
   ```bash
   supabase db push
   ```
   Execute all 6 read-only catalog verification queries from **Section 2, Step B** in the Staging SQL Editor and verify every count matches expected values.
5. **Deploy Updated Edge Functions to Staging:**
   ```bash
   supabase functions deploy init-payment --project-ref <STAGING_PROJECT_REF>
   supabase functions deploy payment-webhook --no-verify-jwt --project-ref <STAGING_PROJECT_REF>
   supabase functions deploy bank-payout --project-ref <STAGING_PROJECT_REF>
   ```
6. **End-to-End Staging Smoke Test (With Test Keys Only):**
   - Configure Paystack (`sk_test_...`) / Flutterwave (`FLWSECK_TEST-...`) test keys on the staging project.
   - Deploy a Vercel Preview build with `SUPABASE_URL=<STAGING_URL>`, `SUPABASE_ANON_KEY=<STAGING_ANON_KEY>`, and `FINANCIAL_RPCS_LIVE=true` scoped **only** to the Preview environment.
   - Verify:
     1) New user signup -> 6-digit Email OTP verification -> `record_verified_login_session` (`USER_LOGIN` row created) -> mandatory 4-digit PIN onboarding (`PIN_ONBOARDING_COMPLETED`).
     2) Test Paystack/Flutterwave deposit -> webhook settles balance once (`settle_gateway_deposit`).
     3) Internal P2P NUBAN transfer (`execute_p2p_transfer`) & MideSave vault deposit/withdrawal (`manage_midesave_vault`) -> `verify_wallet_ledger_reconciliation` returns `ok: true, discrepancy: 0.00`.
     4) Verify VTU, card funding, and batch payroll remain blocked (`42501`).

---

## 4. Production Promotion Blockers (Do Not Promote Until Resolved or Signed Off)

- **Keep `FINANCIAL_RPCS_LIVE: false` in production `config.js` / `api/config.js`** until:
  1. Staging verification steps 1–6 above are signed off by Engineering & Security.
  2. A pre-migration `pg_dump` snapshot of production is taken during a scheduled maintenance window.
  3. Unintegrated features (VTU bills, virtual card issuing/funding, corporate sub-account payroll) are either hidden in the production UI or backed by real provider Edge Functions.

