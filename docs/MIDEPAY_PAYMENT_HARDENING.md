# MidePay payment hardening — 17 November 2026

**Release decision: still staging only. Keep live payments and bank payouts disabled.**

This round modifies only `fix-v46-migration-repair`. No production Supabase access or deployment occurred. No database migrations were changed or applied. The existing staging preview remains https://midepay-4as10yyqw-ola-f90f.vercel.app.

## Problems independently reproduced and fixed

The initial payout boundary run reported two passing groups and nine failing groups before fixes. The final expanded boundary suite reports 17 passing groups with zero failures.

1. A null JSON payload threw an exception; unknown payout providers silently selected Paystack. Invalid payloads and unknown providers now return 400 before financial work.
2. Both payment handlers accepted browser origins without enforcing an allowlist when it was missing. Disallowed browser origins now receive 403 before Auth, database or gateway work. This is an additional origin restriction, not a replacement for JWT authorization; requests without an Origin header still require authentication.
3. Missing provider credentials were detected after reserving wallet funds, stranding a pending debit without attempting a transfer. Configuration is now checked before debit.
4. Staging could use a live Paystack key. In the exact approved staging project, the two payment handlers require a Paystack `sk_test_` key and block Flutterwave until a separate reviewed staging configuration exists. This check has not been retrofitted to the webhook function and does not establish that dashboard secrets are correct.
5. A null, malformed, or negative-success debit RPC response could still reach the external transfer call. Dispatch now requires `debitResult.success === true`. Existing duplicate debit responses continue to return without another provider request.
6. Amounts were coerced and silently rounded. Both handlers now require a numeric amount representable to two decimal places, within their existing limits.
7. An accepted transfer followed by a failed gateway-reference database update was reported as success. The handler now returns HTTP 202 with `reconciliation_required: true`, preserving the pending debit and deterministic reference; it does not refund on an ambiguous outcome.
8. Checkout callback URLs could point to arbitrary HTTPS sites. Callbacks now require a configured approved origin and disallow embedded URL credentials. A caller without an Origin header must supply an approved callback explicitly; there is no production-site fallback.

No durable payout outbox, reconciliation worker, automatic retry scheduler or new refund mechanism was added. These remain required work; preserving pending money alone does not solve recovery.

## Verification actually completed

All **12 automated suites passed: 254 PASS groups, zero failing suites**. The new 17 groups execute the actual TypeScript handlers, substituting only the SDK client factory and external HTTP calls. Existing SQL tests use isolated PGlite. See `test-results.json` and the individual logs for exact exits and counts. Passing mocked provider requests are not real Paystack test payments.

Staging `bank-payout` and `init-payment` were deployed and then refreshed as ACTIVE version 3, retaining `verify_jwt=true`. The refresh rules out an older running instance after the user reported saving the origin configuration. No payment request or wallet debit was performed against hosted staging. The user's confirmation that a test key is saved was recorded as a user-provided configuration statement; no secret was retrieved or independently validated.

Public preflight smoke checks reached both deployed handlers. Requests from the unapproved origin returned 403 without an Allow-Origin header, as intended. Requests from the actual preview origin also returned 403 without that header, demonstrating that staging `ALLOWED_ORIGINS` is missing or does not include the exact preview origin. Browser payment integration is therefore currently blocked until that setting is corrected. Evidence: `staging-http-smoke.json`.

After the user reported saving the setting, both handlers were checked again, refreshed and rechecked. The actual preview still returned `403 ORIGIN_NOT_ALLOWED`. See `staging-http-smoke-after-config.json` and `staging-http-smoke-after-refresh.json`. The current public setting value was requested to diagnose the mismatch; no private credential is needed for that check.

## Native PostgreSQL concurrency status

Added `scripts/test_native_postgres.mjs`, exposed as `npm run test:postgres-concurrency`. It creates a new isolated cluster bound only to loopback on an ephemeral port, overrides connection-related environment variables, applies all migrations, runs independent concurrent psql sessions, and shuts the cluster down afterward. It tests duplicate payouts, distinct payouts exceeding available balance, duplicate deposits, duplicate reversals, payload conflicts and client-role permissions. Synthetic data never leaves that local cluster.

**This test has not passed on this machine.** The installed PostgreSQL 15 `initdb.exe` failed to launch (`spawnSync ... UNKNOWN`); direct execution identified an Illegal System DLL Relocation error. Zero concurrency assertions ran. The attempted run is saved in `native-postgres-attempt.log` and is excluded from the 12 passing suites.

As an alternative, two harmless staging SQL session probes were dispatched together. They used different PostgreSQL backend PIDs but their execution windows did not overlap. This connector run cannot establish simultaneous request safety, so no hosted concurrency pass is claimed and no synthetic financial data was created there.

On a working native PostgreSQL installation, set `MIDEPAY_PG_BIN` to its bin directory and run `npm run test:postgres-concurrency`. Use an optional `MIDEPAY_PG_TEST_ROOT` for the disposable data and log directory. The script intentionally does not accept a remote database URL.

## Next required work

- Set staging `ALLOWED_ORIGINS` to `https://midepay-4as10yyqw-ola-f90f.vercel.app` without a trailing slash, then repeat the preflight smoke check.
- Complete browser signup/OTP/PIN/MFA tests, including email template and proof behavior.
- Run an actual Paystack test checkout and signed webhook replay against staging, with balance reconciliation; leave live keys out of staging.
- Implement and verify durable payout dispatch/reconciliation, including crashes before dispatch, accepted transfers with lost responses, provider failures, retries and refund replay.
- Pass the native multi-session PostgreSQL tests, extend them to P2P transfers, and finish the incomplete financial UI integrations before considering a live launch.
