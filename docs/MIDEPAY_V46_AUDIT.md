# Current independent review — 24 November 2026

**Deployment verdict: NOT production-ready.** The verified repairs below improve staging safety; they are not proof that every feature, provider integration or operational control is complete. Production Supabase was not accessed or changed. Earlier report text is retained below as historical material, not as instructions or independent evidence.

## Verified findings and repairs

1. **Unclear rejected test transfers.** The browser showed “Outcome unknown” for every non-success response and permanently disabled confirmation even when failure occurred before submission. The new read-only readiness check verifies the current session and both payout switches before recipient lookup/PIN entry. Known pre-reservation rejections receive safe, specific messages and may retry the same identity; transport, queue and unrecognized failures remain unknown and locked. A rejected readiness check never initiates a transfer.
2. **Test scope too broad.** The Edge handler previously restricted account and amount but not the exact test destination/request identity. Staging now requires the nominated user, Paystack's Zenith test recipient 1000000001/057, the fixed one-test UUID and the existing NGN100 cap. Recipient lookup is also restricted. The worker's service-only SQL gate independently checks the stored test destination, owner, amount, fee, pending state and provider before it contacts Paystack. Browser parameters are not authorization.
3. **Fabricated wallet fallback.** Missing or malformed wallet data after login could produce a generated wallet number, a zero balance and a Tier 2 fallback. Login completion now rejects missing/mismatched profile or wallet ownership, wrong currency, invalid wallet number and unsafe monetary values before saving the dashboard identity. Valid zero balances remain supported. Missing tier metadata defaults to Tier 1 and missing bank metadata does not imply Providus provisioning.
4. **Preview offline screen.** Earlier browser verification loaded the fresh deployment but the stable preview returned the worker's offline fallback. The protected stable preview now delegates requests to native browser navigation; it does not remove Vercel authentication. Misleading mobile-data diagnosis and absolute fund-security claims were removed. Stable-page loading was verified in the browser after that repair.

## Actual validation

| Check | Actual result |
|---|---|
| Full isolated regression run | 23/23 suites passed, before the final wallet fallback/UI ordering refinements |
| Native PostgreSQL 18.6 concurrency | 22/22 groups passed; disposable database stopped afterward |
| Migration/security suite | 55/55 groups passed across all 27 migrations |
| Controlled payout client | 15 groups passed after final UI refinement |
| Payout/deposit boundaries | 29 groups passed after exact recipient restrictions |
| Operator/session review | 17 groups passed |
| Recovery/dispatch | 44 groups passed |
| Wallet-session guards | 3 groups passed, including 13 invalid wallet cases and valid zero/whole-kobo balances |
| Affected checks after wallet refinement | Runtime E2E, adversarial security and staging packaging passed again |
| Dependency audit | npm audit reported zero known vulnerabilities for the locked dependency tree; this excludes provider/platform assurance |

Evidence: Codex workspace work/full-review-tests.json and work/full-review-tests-after.json; native evidence work/native-postgres/midepay-isolated-pg-v9sR4A. These runs use local synthetic fixtures and mocked provider responses where applicable. The earlier “124 tests” statement is not used as the current evidence total. Historical test banners saying production readiness passed are not launch approval.

## Hosted staging observations

The attempted controlled payout received HTTP 503 in Edge logs. No matching transaction or outbox row exists and the nominated wallet remains NGN5000. The original response's exact rejection code was not retained, so no more specific cause is asserted. The new readiness check and structured errors address that diagnostic gap. Both the server BANK_PAYOUTS_ENABLED setting and database payout dispatch have been switched off; the temporary auto-stop job was removed. No real funds moved.

Staging has 27 recorded migrations, 18 public tables with RLS enabled and no private table without RLS. Readiness helper privileges were checked: authenticated-only boolean/status access, no anonymous/service-role execution and no direct Auth-session-table privileges. Current advisors still report 15 informational RLS/no-policy findings on intentionally restricted tables, the anonymous waitlist definer warning, 37 authenticated definer endpoints requiring gated authorization review, and disabled leaked-password protection. Do not blindly remove required gates to silence those categories.

Deployed bank-payout version 19 and migration 20261124232549_controlled_payout_readiness.sql to staging. Frontend preview dpl_ESFUsAMPyVMC3aRXdeALu997X7U1 reached READY and received the stable staging alias. Browser checks confirmed the closed-window message with PIN entry hidden, and the main dashboard reloaded the existing NGN5000 wallet and its original funding activity after the fail-closed wallet guard was added. No transfer confirmation was performed. This release has the local checks above; its own pushed CI result must be checked separately.

## Remaining launch blockers

- An actual controlled Paystack TEST payout, exact webhook/verification settlement and duplicate/retry/failure behavior still need a completed hosted round trip. Key access and the previously observed NGN5100 provider test balance do not prove transfer approval. Provider account lookup has also returned a transient/unexplained rejection; no fallback recipient identity is invented.
- Strict active-session enforcement is not yet comprehensive across P2P, savings, treasury/refund mutations and direct RLS reads. The payout handler checks before PIN work and again before enqueue; it cannot cancel an already-authorized transfer or eliminate the interval between its final check and a separate service-role reservation.
- Real KYC/AML, provider approvals, licensed banking/safeguarding arrangements and live bank provisioning remain external launch requirements. Unintegrated cards, bills and payroll must stay disabled.
- Refund/treasury financial adjustments remain disabled. Independent approval requires a second authorized operator; the owner currently chose one account. Insufficient refund funds must remain manual review under the owner's selected policy.
- Production transactional email/domain deliverability, compromised-password protection, recovery/session exercises and abuse controls need operational completion. Gmail staging delivery is not production delivery assurance.
- Backup/restore drills, incident response, monitoring, realistic load/failure exercises and full provider-fee/refund/chargeback accounting are not established by these tests. Existing refund journal checks are not a complete general ledger certification.

**Safe next state:** keep live payouts and refund adjustments off; push the tested feature-branch repairs through CI; complete the restricted hosted test only after the owner is ready to enter their own PIN. No production promotion is authorized by this report.

---

# Earlier report retained below

# MidePay v4.6 — Complete Database Compatibility & 20-Point Security Audit

**Branch:** `fix-v46-migration-repair`  
**Target Migration:** `supabase/migrations/20261116050000_auth_verification_gate.sql`  
**Supporting Chain Fixes:** `20260928000000`, `20261116020000`, `20261116030000`, `20261116040000`, `supabase/schema.sql`, `bank-payout/index.ts`, `payment-webhook/index.ts`, `supabaseClient.js`, `app.js`, `api/config.js`  
**Production Database Status:** Untouched (`pxdzdehocjnmxbuvipxu` was **not** connected to or modified).

---

## 1. Executive Summary

Prior to this repair, `20261116050000_auth_verification_gate.sql` could not execute cleanly on either a fresh migration chain (`20260923000000` -> `20261116050000`) or an existing pre-v4.6 database, and contained multiple architectural & financial security vulnerabilities.

Using an isolated compiled **PostgreSQL 18.6** (`pgcrypto` + `uuid-ossp`) verification harness, we reproduced every database failure verbatim, traced the root causes across all 10 SQL migrations, 3 Edge Functions, and frontend RPC bindings, repaired the migration chain, and conducted a full 20-point fintech security audit.

---

## 2. Database Compatibility & SQL Errors Discovered (Root-Cause Analysis)

| # | PostgreSQL Code | Exact Failure / Location | Root Cause | Resolution Implemented |
|---|---|---|---|---|
| 1 | `42703` (`undefined_column`) | `column "pin_hash" does not exist` (`20261116050000` lines 34 & 416) | `20260923000000_initial_midepay_schema.sql` created `public.profiles` without `pin_hash`, `pin_failed_attempts`, `pin_locked_until`, `role`, or `is_frozen`. Any database initialized from `20260923` without `20260924`/`20261116000000` crashed immediately on `UPDATE public.profiles SET transaction_pin_hash = pin_hash`. | `20261116050000` now idempotently adds `pin_hash`, `transaction_pin_hash`, `pin_failed_attempts`, `pin_locked_until`, `role`, `is_frozen`, `frozen_by_admin`, and `email_otp_verified_at` before synchronizing valid `^\$2[abxy]\$` bcrypt hashes and scrubbing malformed values. |
| 2 | `42P01` (`undefined_table`) | `relation "public.bill_payments" does not exist` (`20261116050000` line 2447) | `bill_payments` is an active table queried by `supabaseClient.js` (`getBillHistory()`), introduced in `20261116030000`. However, `030000` crashed at line 29 (see #3 below), rolling back its entire transaction so `bill_payments`, `payroll_items`, and `payroll_runs` upgrades were never committed. Additionally, `supabase/schema.sql` omitted migrations `020000`–`050000`. | Fixed upstream `030000`, updated `supabase/schema.sql`, and added `CREATE TABLE IF NOT EXISTS public.bill_payments` + indexes + RLS directly inside `20261116050000` so standalone upgrades also succeed. |
| 3 | `42703` (`undefined_column`) | `column "status" does not exist` on `public.savings_vaults` (`20261116030000` line 29) | `20260923000000` created `savings_vaults` with `(current_amount, maturity_date, is_locked)` and **no** `status` or `current_balance` column. `030000` ran `CREATE TABLE IF NOT EXISTS public.savings_vaults` (no-op because the table already existed!) and then failed on `CREATE INDEX ... ON savings_vaults(status)`. | Added idempotent `ALTER TABLE public.savings_vaults ADD COLUMN IF NOT EXISTS ...` and legacy `current_amount` -> `current_balance` / `maturity_date` -> `lock_until` migration before index creation in both `030000` and `050000`. |
| 4 | `42703` (`undefined_column`) | `column "user_id" does not exist` on `public.payroll_runs` (`20261116030000` line 496) | `20260923000000` created `payroll_runs` with `(business_id NOT NULL, total_recipients NOT NULL, total_payout NOT NULL)` and no `user_id`, `total_amount`, `total_fee`, `employee_count`, or `reference`. | Dropped legacy `NOT NULL` locks on `business_id`, `total_recipients`, and `total_payout` and idempotently added/backfilled `user_id`, `total_amount`, `total_fee`, `employee_count`, `reference`, and `idempotency_key` in `030000` and `050000`. |
| 5 | `42P01` (`undefined_table`) | `relation "public.payroll_items" does not exist` (`20261116040000` line 248) | `20261116040000` ran `ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY` without `CREATE TABLE IF NOT EXISTS public.payroll_items`, crashing whenever `030000` had rolled back or been skipped. | Added `CREATE TABLE IF NOT EXISTS public.payroll_items` in both `040000` and `050000`. |
| 6 | `42703` (`undefined_column`) | `column "user_agent" of relation "security_audit_logs" does not exist` (`20261116050000` line 693) | `record_verified_login_session()` inserted into `security_audit_logs(..., user_agent, ...)`, a column that was never created in `20261116040000`. Calling `record_verified_login_session()` at runtime threw `42703`. | Added `ADD COLUMN IF NOT EXISTS user_agent TEXT` on `public.security_audit_logs` in `20261116050000`. |
| 7 | `42704` (`undefined_object`) | `publication "supabase_realtime" does not exist` (`20260928000000` line 54) | `EXCEPTION WHEN duplicate_object` did not catch `undefined_object` on disposable local/CI PostgreSQL instances without pre-seeded `supabase_realtime`. | Updated exception handler in `20260928000000` to `WHEN duplicate_object OR undefined_object THEN NULL`. |
| 8 | `42883` (`undefined_function`) | `gen_random_bytes(integer)` resolution risk in `20261116020000` | Hosted Supabase installs `pgcrypto` into schema `extensions`, whereas `020000` set `search_path = public` (omitting `extensions`). | Standardized `CREATE SCHEMA IF NOT EXISTS extensions;` and `SET search_path = public, extensions, pg_temp` across `020000` and all `SECURITY DEFINER` functions in `050000`. |
| 9 | Function Overload Collisions | Ambiguous/unprotected legacy overloads in `public` | Legacy migrations left 3-arg `transfer_funds(UUID, UUID, NUMERIC)` (granted to **`anon`** in `0924`!), 4-arg `transfer_funds`, 2-arg `fund_savings_vault`, 2-arg `withdraw_savings_vault`, 6-arg `pay_utility_bill`, 3-arg `execute_business_payroll`, 2-arg `respond_payment_request`, 1-arg `set_own_account_freeze`, and 3-arg `admin_credit_wallet`. | Explicitly dropped all legacy overloads in `20261116050000`; verified `0` duplicate `proname` entries exist in `pg_proc`. |

---

## 3. Complete 20-Point Financial Security Audit & Remediation

### 1. Unauthorized Wallet Crediting (`CRITICAL` — Fixed)
- **Findings:**
  - `concept_topup_wallet` allowed any authenticated user to credit up to `₦5,000,000.00` per call without payment gateway settlement.
  - Legacy `20260923` `handle_new_user()` seeded new signups with `₦250,000.00`.
  - `admin_credit_wallet` lacked separation-of-duties (an executive could credit their own wallet), lacked an amount cap, used weak `random()` references, and lacked idempotency.
- **Fixes:**
  - `concept_topup_wallet` is revoked from `PUBLIC, anon, authenticated, service_role` and its body fails closed (`WALLET_SELF_CREDIT_DISABLED`) while logging a critical security event.
  - `handle_new_user()` provisions `balance = 0.00`, `ledger_balance = 0.00`, `kyc_tier = 1`.
  - `settle_gateway_deposit` is restricted strictly to `service_role`.
  - `admin_credit_wallet` enforces `is_executive()`, verified email, `target_user_id <> auth.uid()` (separation of duties), `₦10,000,000` ceiling, CSPRNG references, `pg_advisory_xact_lock` idempotency, and dual `audit_logs` + `security_audit_logs` entries.

### 2. PIN Verification Bypasses (`CRITICAL` — Fixed)
- **Findings:**
  - `20261116040000` wrapped PIN checks in `IF p_pin IS NOT NULL THEN ...` (allowing `p_pin => NULL` to bypass PIN verification completely!) and auto-initialized a PIN on first transaction if unset.
  - `set_user_transaction_pin` checked `transaction_pin_hash IS NULL` without locking `profiles FOR UPDATE`, permitting a concurrent initial-PIN race.
- **Fixes:**
  - `_verify_pin_and_audit` is unconditionally required before any user-initiated debit/withdrawal and never auto-initializes an unset PIN.
  - `set_user_transaction_pin` locks `public.profiles FOR UPDATE` before checking `transaction_pin_hash`.

### 3. Email Verification Bypasses (`HIGH` — Fixed)
- **Findings:**
  - Checking `auth.users.email_confirmed_at IS NOT NULL` alone proves only that GoTrue marked the email confirmed (which happens automatically at signup if GoTrue `mailer_autoconfirm = true` is misconfigured), not that the user completed OTP session attestation.
- **Fixes:**
  - Added `profiles.email_otp_verified_at TIMESTAMPTZ`. New signups via `handle_new_user()` start with `email_otp_verified_at = NULL`.
  - `_assert_verified_wallet_ready` and `set_user_transaction_pin` require **both** `auth.users.email_confirmed_at IS NOT NULL` **and** `profiles.email_otp_verified_at IS NOT NULL`.
  - `record_verified_login_session` stamps `email_otp_verified_at` and records `autoconfirm_suspected: (email_confirmed_at = created_at)` in `security_audit_logs` for compliance monitoring.

### 4. Missing Account Ownership & Payment Request Spoofing (`CRITICAL` — Fixed)
- **Findings:**
  - Legacy `transfer_funds(UUID, UUID, NUMERIC)` was granted to `anon` in `0924`, where `auth.uid()` was `NULL` and bypassed `IF v_caller IS NOT NULL AND v_caller <> sender_id`.
  - `respond_payment_request` allowed `requester_id` to mark their own payment request `'approved'`, and allowed `payer_id` to mark `'approved'` without transferring any funds.
- **Fixes:**
  - Dropped legacy `transfer_funds` overloads; `transfer_funds` strictly enforces `auth.uid() = sender_id`, mandatory `p_pin`, and mandatory `p_idempotency_key`.
  - `respond_payment_request` enforces strict role-based transitions from `'pending'`: only `requester_id` can set `'cancelled'`, only `payer_id` can set `'declined'`, and `'approved'` requires `payer_id = auth.uid()` **plus** an unlinked `'successful'` outflow transaction to `requester_id` with `amount >= request.amount`, linking `fulfilled_tx_id`.

### 5. Frozen Account Transaction & Unfreeze Bypasses (`HIGH` — Fixed)
- **Findings:**
  - `set_own_account_freeze(false)` overwrote `profiles.is_frozen = FALSE` directly, allowing a user frozen by compliance via `admin_set_account_freeze(uid, true, ...)` to unfreeze their own account!
  - `set_user_transaction_pin`, `set_virtual_card_freeze(card, false)`, `set_virtual_card_limit`, and `save_beneficiary` did not check `profiles.is_frozen`.
- **Fixes:**
  - Added `profiles.frozen_by_admin BOOLEAN NOT NULL DEFAULT FALSE`. `admin_set_account_freeze` sets `frozen_by_admin = freeze_state`.
  - `set_own_account_freeze(false, p_pin)` rejects with `ADMIN_FREEZE_LOCKED` (and logs `ADMIN_FREEZE_BYPASS_BLOCKED`) whenever `frozen_by_admin IS TRUE`, and requires valid 4-digit PIN verification to lift a user-initiated Panic Switch freeze.
  - Frozen accounts are blocked across PIN rotation, card unfreezing, card limit changes, payment requests, beneficiaries, and all ledger RPCs.

### 6. Payroll Authorization & Corporate Ledger Contract (`HIGH` — Quarantined)
- **Findings:**
  - `execute_payroll_batch` debited the caller's **personal** `public.wallets` row instead of a corporate `public.business_sub_accounts` treasury ledger, locked recipient wallets in loop order (`40P01` deadlock vector), and created wallets inline mid-batch.
- **Fixes:**
  - Hardened `is_business_member` and `has_business_write_role` to check `businesses.is_frozen = FALSE`.
  - Quarantined `execute_payroll_batch` and `execute_business_payroll` (`REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` + fail-closed `CORPORATE_PAYROLL_LEDGER_DISABLED`) until corporate sub-account funding & settlement rules are specified.

### 7. Duplicate Transaction Processing (`HIGH` — Fixed)
- **Findings:**
  - `p_idempotency_key` defaulted to `NULL` on financial RPCs, allowing callers omitting the key to bypass deduplication.
- **Fixes:**
  - `execute_p2p_transfer`, `transfer_funds`, `fund_savings_vault`, and `withdraw_savings_vault` reject `NULL` `p_idempotency_key` (`IDEMPOTENCY_KEY_REQUIRED`).

### 8. Idempotency Key Collisions & Parameter Tampering (`HIGH` — Fixed)
- **Findings:**
  - Un-scoped global unique indexes (`ON transactions(idempotency_key)`) allowed cross-user UUID probing/collisions, and replaying the same key with a different amount or recipient silently returned `'duplicate'`.
- **Fixes:**
  - Replaced global idempotency indexes with user-scoped composite unique partial indexes (`ON transactions(user_id, idempotency_key)`).
  - Added `transactions.idempotency_payload_hash` (SHA-256 over canonical operation + target + amount) and return `IDEMPOTENCY_CONFLICT` if a key is reused with altered parameters.

### 9. Concurrent Transaction Race Conditions (`HIGH` — Fixed)
- **Findings:**
  - Two simultaneous requests sharing `(user_id, idempotency_key)` could both pass the pre-lock `SELECT` check, waste PIN strikes, and collide on `INSERT` (`23505`) instead of returning `'duplicate'`.
- **Fixes:**
  - Added `PERFORM pg_advisory_xact_lock(hashtext(user_id::TEXT), hashtext(p_idempotency_key::TEXT))` before the idempotency lookup, serializing identical concurrent retries cleanly.
  - Enforced deterministic UUID-ordered `SELECT ... FOR UPDATE` row locks on `wallets` (`v_sender_wallet_id < v_recipient_wallet_id`) and fixed table lock order (`wallets` -> `savings_vaults`).

### 10. Wallet Balance Inconsistencies & Overdrafts (`HIGH` — Fixed)
- **Findings:**
  - `wallets.ledger_balance` lacked a `CHECK (ledger_balance >= 0)` constraint in `0923`, and CBN KYC Tier limits were missing from SQL P2P transfers.
- **Fixes:**
  - Added `chk_wallets_balance_nonneg` and `chk_wallets_ledger_nonneg` (`>= 0`).
  - Enforced CBN KYC Tier 1/2/3 single-transfer (`₦50k` / `₦250k` / `₦5M`) and daily cumulative outflow (`₦300k` / `₦1M` / `₦25M`) limits inside `execute_p2p_transfer` under `FOR UPDATE` lock.

### 11. Incorrect Ledger Accounting (`HIGH` — Fixed)
- **Findings:**
  - `withdraw_savings_vault` stored net credit (`v_net_credit`) in `transactions.amount` alongside `fee = v_early_break_fee`, making `amount - fee` double-count the 1.5% penalty during ledger reconciliation.
- **Fixes:**
  - `withdraw_savings_vault` now records gross withdrawn principal (`v_amt`) in `amount` and `v_early_break_fee` in `fee`, so **every** row in `public.transactions` obeys the universal reconciliation formula verified by `public.verify_wallet_ledger_reconciliation(wallet_id)`:
    $$\text{balance} = \sum_{\text{settled inflows}} (\text{amount} - \text{fee}) - \sum_{\text{settled + pending outflows}} (\text{amount} + \text{fee})$$

### 12. Unsafe External Bank Transfer Settlement (`CRITICAL` — Fixed)
- **Findings:**
  - SQL `execute_external_bank_transfer` marked external NIP bank transfers `'successful'` immediately without calling any NIP switch.
  - Edge Function `supabase/functions/bank-payout/index.ts` (line 457) immediately updated `transactions.status = 'successful'` as soon as Paystack/Flutterwave accepted the async transfer request (`NEW`/`pending`), before actual bank settlement!
- **Fixes:**
  - Quarantined SQL `execute_external_bank_transfer` (`EXTERNAL_NIP_SETTLEMENT_DISABLED`).
  - Updated `bank-payout/index.ts` to keep `transactions.status = 'pending'` upon initiation (storing only `gateway_reference`).
  - Added `public.finalize_payout_settlement` (`service_role` only) and wired Paystack `transfer.success` and S2S-verified Flutterwave `transfer.completed` (`SUCCESSFUL`) in `supabase/functions/payment-webhook/index.ts`.

### 13. Virtual Card Funding Vulnerabilities (`HIGH` — Quarantined)
- **Findings:**
  - `fund_virtual_card` debited real NGN wallet balance at a hardcoded `₦1,550/$1` FX rate and incremented a local `card_balance` column backed by no card issuer settlement account.
- **Fixes:**
  - Quarantined `issue_virtual_card`, `fund_virtual_card`, and `fund_virtual_card_from_wallet` (`CARD_ISSUER_DISABLED`).

### 14. Sensitive Card, PIN Hash & PII Exposure (`CRITICAL` — Fixed)
- **Findings:**
  - Legacy migrations persisted full 16-digit PANs (`card_number`) and 3-digit CVVs (`cvv`) in `public.virtual_cards` and exposed them via `SELECT *` to `authenticated`.
  - `SELECT * FROM public.profiles` exposed bcrypt `pin_hash` and `transaction_pin_hash` digests to the client for offline cracking.
  - `lookup_recipient_profile` returned full `email` and `phone` for any 10-digit NUBAN or `@tag` query.
- **Fixes:**
  - Scrubbed all `virtual_cards.card_number` and `virtual_cards.cvv` values to `NULL` and added `CHECK (cvv IS NULL)` and `CHECK (card_number IS NULL)`.
  - Applied PostgreSQL **column-level `GRANT SELECT (...)`** on `public.profiles` (excluding `pin_hash` and `transaction_pin_hash`) and `public.virtual_cards` (excluding `card_number` and `cvv`), and updated `supabaseClient.js` & `app.js` to select explicit safe columns.
  - Masked `email` and `phone` (`NULL`) in `lookup_recipient_profile`.

### 15. Savings Vault Rate Tampering & Withdrawal Authorization (`MEDIUM` — Fixed)
- **Findings:**
  - `create_savings_vault` accepted client-supplied `p_interest_rate_pa`, allowing a caller to record arbitrary yield metadata.
- **Fixes:**
  - Server-side `create_savings_vault` ignores client `p_interest_rate_pa` and enforces the fixed `14.50%` display rate; deposits and withdrawals enforce Email OTP + bcrypt PIN + `FOR UPDATE` owner locks + idempotency.

### 16. VTU Payment Verification (`CRITICAL` — Quarantined)
- **Findings:**
  - `pay_vtu_bill` / `pay_utility_bill` debited real NGN wallet balance and fabricated random 20-digit STS electricity meter tokens (`gen_random_bytes`) with zero VTU/DisCo aggregator integration.
- **Fixes:**
  - Removed synthetic meter token generation and quarantined `pay_vtu_bill` and `pay_utility_bill` (`VTU_PROVIDER_DISABLED`).

### 17. Incorrect RLS Policies & Unrevoked Corporate Tables (`HIGH` — Fixed)
- **Findings:**
  - `20261116040000` only revoked client writes on 13 personal tables, leaving `businesses`, `business_members`, `business_sub_accounts`, and `invoices` with legacy `INSERT`/`UPDATE`/`DELETE` policies from `0923`/`000000` (allowing business owners/admins to `UPDATE business_sub_accounts SET balance = ...` directly!).
- **Fixes:**
  - `20261116050000` purges all client write policies and executes `REVOKE ALL FROM PUBLIC, anon` + `REVOKE INSERT, UPDATE, DELETE, TRUNCATE FROM authenticated` across **all 18 public tables**, and attaches `enforce_immutable_ledger()` (`BEFORE UPDATE OR DELETE`) to `transactions`, `audit_logs`, and `security_audit_logs`.

### 18. `SECURITY DEFINER` Privilege Escalation (`MEDIUM` — Fixed)
- **Fixes:**
  - Every `SECURITY DEFINER` function in `public` explicitly sets `SET search_path = public, extensions, pg_temp` (verified via `pg_proc.proconfig` inspection).

### 19. Insecure Function `EXECUTE` Permissions (`HIGH` — Fixed)
- **Fixes:**
  - All functions in `public` default-revoke `EXECUTE` from `PUBLIC, anon, authenticated`.
  - `anon` can execute **only** `join_waitlist(TEXT, TEXT)`.
  - Settlement RPCs (`settle_gateway_deposit`, `debit_wallet_for_payout`, `finalize_payout_settlement`, `reverse_failed_payout`, `generate_unique_midepay_nuban`) are granted **only** to `service_role`.

### 20. PIN Brute-Force & Lockout Expiry Bug (`MEDIUM` — Fixed)
- **Findings:**
  - After a 5-strike 15-minute lockout expired (`pin_locked_until <= NOW()`), `pin_failed_attempts` remained `5`; a single typo after waiting 15 minutes computed `5 + 1 = 6 >= 5` and immediately locked the user out for another 15 minutes instead of granting a fresh 5-strike window.
- **Fixes:**
  - Both `_verify_pin_and_audit` (SQL) and `bank-payout/index.ts` (Edge Function) reset the base strike count to `0` once `pin_locked_until <= NOW()` has elapsed, while preserving active 15-minute cooldown enforcement and `security_audit_logs` recording.

---

## 4. Remaining External Provider & Operational Blockers

The following capabilities are **intentionally disabled** in `20261116050000_auth_verification_gate.sql` (and gated on the client by `FINANCIAL_RPCS_LIVE: false` in `config.js` / `api/config.js`) until external integrations are completed:

1. **VTU Airtime, Data, Cable & Electricity (`pay_vtu_bill`, `pay_utility_bill` — `VTU_PROVIDER_DISABLED`):** Requires server-side Edge Function integration with a licensed Nigerian VTU/DisCo aggregator (e.g., VTpass, Reloadly, Baxi, or Flutterwave Bills API) with pending-debit -> verified vend -> auto-reversal accounting.
2. **Virtual Card Issuing & Funding (`issue_virtual_card`, `fund_virtual_card`, `fund_virtual_card_from_wallet` — `CARD_ISSUER_DISABLED`):** Requires integration with a PCI-DSS Level 1 card issuing processor (e.g., Maplerad, Bridgecard, Sudo Africa, or Stripe Issuing) using iframe/vault tokenization so raw PAN/CVV never touch MidePay servers, plus live treasury FX quotes.
3. **Corporate Batch Payroll (`execute_payroll_batch`, `execute_business_payroll` — `CORPORATE_PAYROLL_LEDGER_DISABLED`):** Requires a finalized corporate treasury ledger specification debiting funded `public.business_sub_accounts` (never personal `public.wallets`) with deterministic sorted wallet locking.
4. **Supabase Auth Dashboard Verification:** Before enabling live client RPCs on staging or production, confirm in Supabase Dashboard (`Authentication -> Providers -> Email`) that **Confirm email** is enabled (`mailer_autoconfirm = false`) and the **Confirm signup** email template emits the 6-digit `{{ .Token }}` OTP.

