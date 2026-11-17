# MidePay v4.6 — Automated PostgreSQL & Application Test Report

**Branch:** `fix-v46-migration-repair`  
**PostgreSQL Test Engine:** Compiled PostgreSQL 18.6 (`@electric-sql/pglite` 0.5.10 WASM with native C extensions `pgcrypto` and `uuid-ossp`, isolated in-memory, zero network/production connection).  
**Production Database:** Untouched (`pxdzdehocjnmxbuvipxu` was never queried or modified).

---

## 1. Test Execution Summary

| Suite | Command | Assertions | Exit Code | Status |
|---|---|---:|---:|---|
| Real PostgreSQL 18.6 Migration, Compatibility & Financial Security Suite | `node scripts/test_v46_postgres_migration.mjs` | **55 / 55** | `0` | **PASSED** |
| Production Static, DOM Parity, Bundle & SQL Structure Validator | `node scripts/validate_production.js` | **26 / 26** | `0` | **PASSED** |
| Edge Functions TypeScript & Cryptographic Webhook Suite | `node scripts/test_payment_webhook.js` | **11 / 11** | `0` | **PASSED** |
| Headless DOM, 6-Digit OTP, Mandatory PIN & Submit-Lock E2E Suite | `node scripts/test_e2e_runtime.js` | **19 / 19** | `0` | **PASSED** |
| Adversarial CSP, Secrets, RLS & Penetration Suite | `node scripts/test_security_penetration.js` | **13 / 13** | `0` | **PASSED** |
| **Total Verified Automated Assertions** | | **124 / 124** | `0` | **100% PASSED** |

---

## 2. Detailed Real PostgreSQL 18.6 Test Coverage (`scripts/test_v46_postgres_migration.mjs`)

### Category 1 — Clean Database Migration From Scratch (`3/3` Passed)
- Applied all 10 migrations (`20260923000000` through `20261116050000`) sequentially in a clean PostgreSQL 18.6 database with zero errors.
- Verified via `pg_tables` that all **18 public tables** (`profiles`, `wallets`, `transactions`, `payment_requests`, `virtual_cards`, `savings_vaults`, `midesave_vaults`, `bill_payments`, `payroll_runs`, `payroll_items`, `beneficiaries`, `businesses`, `business_members`, `business_sub_accounts`, `invoices`, `waitlist`, `audit_logs`, `security_audit_logs`) exist and have `rowsecurity = true`.
- Verified via `pg_policies` that **0** client `INSERT`, `UPDATE`, `DELETE`, or `ALL` policies exist across all 18 tables.

### Category 2 — Pre-v4.6 Schema Upgrade & Data Preservation (`4/4` Passed)
- **Upgrade Path 2A (`20260923000000` -> `20261116050000` directly):** Verified that a database lacking `profiles.pin_hash` and `public.bill_payments` upgrades with zero `42703` or `42P01` errors, migrates `savings_vaults.current_amount` (`₦45,000.00`) into `current_balance` and `midesave_vaults`, and backfills `email_otp_verified_at` for pre-existing confirmed users.
- **Upgrade Path 2B (`20260923000000..20261116020000` -> `20261116050000`):** Verified that existing users retain their bcrypt `pin_hash` (synchronized into `transaction_pin_hash`, verified via `verify_user_transaction_pin('7391') -> valid: true`) while 100% of stored `virtual_cards.card_number` and `virtual_cards.cvv` values are scrubbed to `NULL` and protected by `CHECK (cvv IS NULL)` (`23514`).

### Category 3 — Function Signatures, Overloads, `search_path` & Role Grants (`4/4` Passed)
- Verified via `pg_proc` that **0** duplicate/legacy overloaded application function names remain in `public`.
- Verified via `pg_proc.proconfig` that **100%** of `SECURITY DEFINER` functions enforce `search_path = public, extensions, pg_temp`.
- Verified via `has_function_privilege` that `anon` can execute **only** `join_waitlist(text, text)`.
- Verified that `authenticated` has **0** `EXECUTE` grants on server-only settlement RPCs (`settle_gateway_deposit`, `debit_wallet_for_payout`, `finalize_payout_settlement`, `reverse_failed_payout`, `generate_unique_midepay_nuban`, `_assert_verified_wallet_ready`, `_verify_pin_and_audit`) and **0** `EXECUTE` grants on quarantined provider RPCs.

### Category 4 — Email OTP Attestation, `USER_LOGIN` (`user_agent`) & PIN Onboarding (`12/12` Passed)
- Verified `handle_new_user()` provisions a `₦0.00` NGN wallet with a valid `90XXXXXXXX` CSPRNG NUBAN, `kyc_tier = 1`, `email_otp_verified_at = NULL`, and **0** synthetic cards.
- Verified real `SET LOCAL ROLE authenticated` throws `42501` on `SELECT pin_hash FROM public.profiles`, `SELECT transaction_pin_hash FROM public.profiles`, `SELECT cvv FROM public.virtual_cards`, `UPDATE public.wallets`, and `UPDATE public.business_sub_accounts`.
- Verified unconfirmed users (`email_confirmed_at IS NULL`) and unattested sessions (`email_confirmed_at IS NOT NULL` while `email_otp_verified_at IS NULL`) are blocked with `EMAIL_NOT_VERIFIED`.
- Verified `record_verified_login_session` stamps `email_otp_verified_at` and writes `USER_LOGIN` with `user_agent` into `public.security_audit_logs` (confirming `42703` on `user_agent` is resolved).
- Verified `set_user_transaction_pin` hashes 4-digit PINs with `pgcrypto` bcrypt (`$2a$10$...`) under `FOR UPDATE` row lock and blocks unauthenticated PIN overwrites.
- Verified `lookup_recipient_profile` resolves recipient display name, `@tag`, and NUBAN while masking `email` and `phone` (`NULL`).

### Category 5 — 5-Strike 15-Minute PIN Lockout & Post-Expiry Reset (`2/2` Passed)
- Verified 5 consecutive wrong PIN attempts increment `pin_failed_attempts` (`1..5`), trigger a 15-minute `PIN_LOCKED` cooldown on strike 5, and reject even the **correct** PIN during active lockout (`PIN_LOCKOUT_REJECTED`).
- Verified that once `pin_locked_until` expires, a subsequent wrong PIN resets the strike window cleanly to `1 of 5` (`attempts_remaining = 4`) rather than immediately re-locking on strike `6`, and a valid PIN clears `pin_failed_attempts = 0`.

### Category 6 — Ownership, Compliance Freeze & Payment Request Spoofing (`5/5` Passed)
- Verified `transfer_funds` blocks spoofed `sender_id <> auth.uid()` (`UNAUTHORIZED`).
- Verified non-executives cannot invoke `admin_credit_wallet`, and executives cannot credit their own personal wallet (Separation of Duties).
- Verified compliance freeze (`admin_set_account_freeze(uid, true, ...)`) stamps `frozen_by_admin = TRUE` and blocks client `set_own_account_freeze(false, pin)` (`ADMIN_FREEZE_LOCKED`).
- Verified user Panic Switch self-freeze blocks PIN-less unfreezing and lifts cleanly when valid PIN is supplied.

### Category 7 — Verified Gateway Deposit, Insufficient Funds & CBN KYC Limits (`3/3` Passed)
- Verified `settle_gateway_deposit` (`service_role` only) settles a pending Paystack deposit (`15,000,000` kobo -> `₦150,000.00`) once and returns `already_settled: true` on replay.
- Verified CBN KYC Tier 1 single-transfer limit (`₦50,000.00`) blocks a `₦60,000.00` transfer (`KYC_SINGLE_LIMIT_EXCEEDED`).
- Verified overdraft transfers (`₦200,000.00` against `₦150,000.00` balance) fail cleanly (`INSUFFICIENT_FUNDS`) with zero balance change.

### Category 8 — Idempotency Deduplication, Conflict Detection, Cross-User Isolation & Payment Requests (`3/3` Passed)
- Verified `respond_payment_request` blocks requester self-approval (`FORBIDDEN`) and blocks payer approval prior to transfer settlement (`SETTLEMENT_PROOF_REQUIRED`), succeeding only when linked to an unlinked settled transfer (`fulfilled_tx_id`).
- Verified exact `idempotency_key` replay returns `status: 'duplicate'` without a second debit, reusing the same key with a modified amount returns `IDEMPOTENCY_CONFLICT`, and **two different users using the exact same UUID `idempotency_key`** succeed independently without collision.

### Category 9 — Bidirectional Deadlock-Free Locking & Concurrent Double-Spend Race (`2/2` Passed)
- Verified simultaneous `A -> B` and `B -> A` transfers acquire `wallets` locks in deterministic UUID order (`v_sender_wallet_id < v_recipient_wallet_id`) and conserve total NGN.
- Verified a 4-way concurrent burst of `₦20,000.00` transfers against a `₦26,000.00` wallet allows exactly **1** transfer and rejects **3** with `INSUFFICIENT_FUNDS`, leaving `₦6,000.00`.

### Category 10 — PostgreSQL Transaction Rollback Atomicity (`2/2` Passed)
- Verified that a multi-step transaction where `execute_p2p_transfer` succeeds followed by a downstream exception rolls back 100% of wallet and transaction state (`₦144,000.00` unchanged).

### Category 11 — End-to-End Mathematical Wallet <-> Ledger Reconciliation (`8/8` Passed)
- Verified MideSave vault rate tampering (`99.90%` -> forced `14.50%`), vault deposit (`₦40,000.00`), 1.5% early-break withdrawal (`₦20,000.00` gross -> `₦300.00` fee -> `₦19,700.00` net credit), cross-user vault IDOR rejection, pending outbound NIP payout (`debit_wallet_for_payout` -> `'pending'`), webhook settlement (`finalize_payout_settlement` -> `'successful'`), failed NIP reversal (`reverse_failed_payout` -> `'reversed'` + `₦8,010.00` refund), ledger immutability (`DELETE` blocked even for superuser), and `verify_wallet_ledger_reconciliation`:
  - **User A:** `wallet_balance = ₦111,675.00`, `ledger_balance = ₦111,675.00`, `computed_ledger_net = ₦111,675.00`, **`discrepancy = ₦0.00`** (`ok = true`).
  - **User B:** `wallet_balance = ₦31,000.00`, `ledger_balance = ₦31,000.00`, `computed_ledger_net = ₦31,000.00`, **`discrepancy = ₦0.00`** (`ok = true`).

### Category 12 — Quarantined / Disabled Unintegrated Provider Verification (`7/7` Passed)
- Verified `authenticated` receives PostgreSQL `42501 permission denied` on `concept_topup_wallet`, `execute_external_bank_transfer`, `issue_virtual_card`, `fund_virtual_card`, `pay_vtu_bill`, and `execute_payroll_batch`, and internal execution returns explicit `DISABLED` blocker codes with `₦0.00` wallet impact.

---

## 3. Disabled / Blocked Features Not Ready for Live Production Use

| Feature | SQL RPC(s) | Status | Blocker |
|---|---|---|---|
| Client Direct Wallet Top-Up | `concept_topup_wallet` | **PERMANENTLY DISABLED** | Unsafe self-credit; deposits must settle exclusively via `payment-webhook` -> `settle_gateway_deposit`. |
| SQL-Direct External NIP Bank Transfer | `execute_external_bank_transfer` | **DISABLED** | Cannot confirm NIP settlement inside SQL; use `bank-payout` Edge Function (`pending` -> `payment-webhook` `finalize_payout_settlement` / `reverse_failed_payout`). |
| VTU Airtime / Data / Cable / Electricity | `pay_vtu_bill`, `pay_utility_bill` | **BLOCKED / QUARANTINED** | No licensed Nigerian VTU / DisCo aggregator API integrated yet. |
| Virtual Card Issuing & Funding | `issue_virtual_card`, `fund_virtual_card`, `fund_virtual_card_from_wallet` | **BLOCKED / QUARANTINED** | No PCI-DSS tokenized card issuer API or live USD/NGN FX quote desk integrated yet. |
| Corporate Batch Payroll | `execute_payroll_batch`, `execute_business_payroll` | **BLOCKED / QUARANTINED** | Corporate `business_sub_accounts` treasury funding & settlement contract not yet wired. |

