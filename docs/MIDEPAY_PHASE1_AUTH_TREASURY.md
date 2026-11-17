# MidePay Phase 1: authentication and treasury controls

Updated: 17 November 2026 (Europe/London)
Branch: `fix-v46-migration-repair`
Status: implemented and tested locally; **not deployed and not production-ready**.

This completes the first remediation phase discussed in chat. Payout recovery, full frontend/payment integration, native multi-session testing, and hosted staging verification remain separate open phases. Production Supabase and real payment-provider endpoints were not accessed.

## What changed

Added `supabase/migrations/20261116070000_email_proof_treasury_controls.sql`, bringing the clean chain to twelve migrations. Earlier migrations and existing user changes were preserved.

### Email verification now requires server proof

The new `verify-email-otp` Edge Function accepts an email and a six-digit code. It verifies the code with Supabase Auth using `type: 'email'`, checks that the verified user and returned session match the requested address, then calls a service-only attestation RPC. Only after the proof is saved does it return a session to the browser. Verification errors and proof-write errors do not return tokens.

The browser no longer calls `auth.verifyOtp` itself. It invokes this endpoint and adopts the returned session through `auth.setSession`. The signup, returning-user verification, resend and session-restoration paths use this flow. An autoconfirmed signup is signed out and explicitly sent a new email challenge instead of being trusted. A failed login-security check stops dashboard completion.

Four private tables were added with RLS enabled and no direct client or service-role table privileges:

- `private.email_verification_proofs`
- `private.email_otp_attempts`
- `private.treasury_wallets`
- `private.treasury_credit_requests`

Server functions access them through their controlled SECURITY DEFINER interfaces. The email proof is bound to the current Auth user, current email and Auth confirmation timestamp. Changing the email invalidates the old proof even if a profile timestamp remains present. Login, PIN onboarding, financial readiness checks, payout debits and deposit initialization now check this proof.

**Migration consequence:** all earlier `profiles.email_otp_verified_at` values are cleared. They were created through a self-attestation mechanism and are not grandfathered as independent proof. Existing users must verify a fresh email code. Balances, PIN hashes and settled transactions are preserved. The upgrade regression verifies that an old verified flag is invalidated while a settled balance remains unchanged.

The endpoint limits verification to five attempts per normalized email in ten minutes through an atomic database counter. It defaults to denying browser origins unless explicitly allowed, rejects malformed/oversized inputs, emits generic errors, and uses `Cache-Control: no-store`. This is not a replacement for platform-wide abuse monitoring: targeted email throttling and limiter-row retention still need operational policy.

Supabase documents email OTP verification with `verifyOtp({ email, token, type: 'email' })`. Its general OTP authentication-method claim can also represent SMS or magic-link authentication, so the implementation uses a verified email-code response rather than treating an arbitrary OTP claim as email proof. [Email OTP API](https://supabase.com/docs/reference/javascript/auth-verifyotp), [authentication methods](https://supabase.com/docs/guides/auth/auth-mfa).

### Executive credits now transfer funded money with two-person approval

The legacy `admin_credit_wallet` function has its execution grants revoked from browser and service roles; its body also fails closed if invoked by an owner. The frontend's old direct-credit helper fails closed, and the credit buttons now open a treasury approval panel instead of adding a local balance.

The replacement workflow is:

1. A database owner explicitly designates a **dedicated institutional NGN wallet**. This migration designates no wallet and creates no funds. A personal account must not be repurposed without an ownership/funding review.
2. One executive creates a request naming the source, recipient, amount and reason. The request requires independent email proof, a PIN, a stable UUID idempotency key and recent authenticator verification. Creating a request moves no funds.
3. A different executive approves the request using their own PIN and recent authenticator verification. Executives cannot be credit recipients, and neither approver may be the source-wallet owner.
4. Approval locks the participants, request and wallets in a consistent order, rechecks authority/freeze state/source configuration/expiry, and verifies both wallets reconcile to their ledgers.
5. It debits the designated treasury wallet and credits the recipient atomically, recording paired ledger rows and an audit record naming both executives. Insufficient or unreconciled funds leave the recipient unchanged. Approval replay returns the existing result without another transfer.

Requests expire after 24 hours and can be cancelled by their maker while pending. Request keys are mandatory and bound to the operation payload. The form keeps the same key when retrying unchanged details during the page session; PINs are not retained in the retry state. The approval queue is restricted to verified executives and omits internal idempotency hashes/keys.

A designated treasury identity cannot use the ordinary P2P, savings/PIN-verification debit paths or bank-payout helper to bypass approval. Disabling a treasury source also blocks approval; it does not restore personal spending privileges to that designated account.

The server requires a trusted JWT with `aal2` and a TOTP method timestamp within ten minutes. A refreshed token does not make an old TOTP timestamp fresh. The panel supports authenticator enrollment and verification; its QR code and input secrets are cleared on completion/logout. Supabase documents assurance levels and timestamped authentication-method references for server authorization. [MFA enforcement](https://supabase.com/docs/guides/auth/auth-mfa), [JWT claim reference](https://supabase.com/docs/guides/auth/jwt-fields).

The new API functions are `request_treasury_credit`, `approve_treasury_credit`, `cancel_treasury_credit`, and `get_treasury_credit_queue`. Service-only email functions are `consume_email_otp_attempt` and `attest_verified_email`. Client input, device metadata and frontend flags cannot write verification proof, modify treasury requests, change the allowlist, or bypass the server approval rules.

An additional catalog check found that the legacy `prevent_security_audit_mutation` trigger function omitted explicit `pg_temp` ordering. The new migration pins its full search path. The earlier audit's looser prefix check did not detect that distinction.

## Actual verification

The final process results are saved in `test-results.json` beside this report. All nine suites exit 0:

| Suite | Reported PASS groups |
|---|---:|
| Static production validator | 30 |
| Edge syntax/webhook suite, now including the fourth Edge Function | 12 |
| DOM/Auth/RPC runtime harness | 37 |
| Existing penetration harness | 13 |
| PostgreSQL migration/security suite | 55 |
| Independent database regressions | 11 |
| Independent webhook/render/config regressions | 15 |
| New Phase 1 real SQL regressions | 32 |
| New Phase 1 handler/client regressions | 12 |
| **Total** | **217** |

The 44 new Phase 1 groups cover server-only attestation, fake metadata/autoconfirm rejection, private table privileges, email-change invalidation, limiter expiry, blocked direct minting, unconfigured source rejection, role/MFA/PIN enforcement, source-account bypass attempts, self-approval, idempotency conflict/replay, funded settlement and ledger conservation, insufficient funds, unreconciled balances, disabled sources, expiry, cancellation, maker freeze, inconsistent legacy compliance flags and queue restrictions. Handler tests execute the real endpoint with substituted upstream transport and exercise the client endpoint/session adoption and login rejection paths.

The original PostgreSQL suite's old administrative-credit funding fixture was replaced with a verified gateway-deposit fixture. This preserves its reconciliation coverage without reopening the removed mint capability. Legacy card/PIN upgrades now explicitly obtain server email proof before financial use. The static validator and DOM simulator were updated to the new server OTP boundary; the simulator is still a simulator, not hosted Auth evidence.

The same Phase 1 SQL suite has also been exercised with extensions installed in Supabase's `extensions` schema. See the separate log for the executed variant and PASS count. The public/private catalogs are metadata from disposable test databases, not production snapshots.

PASS groups differ in breadth and must not be presented as 217 independent production security guarantees. PGlite executes actual PostgreSQL SQL and role changes, but uses one connection. The new lock ordering is reviewed and sequentially exercised; true independent-session contention remains unverified. Node parses the TypeScript source but is not a Deno deployment type check. No hosted SMTP, actual authenticator device, full real-browser session, or production infrastructure was used.

## Staging handoff: required before promotion

These are pending verification steps, not actions already performed:

1. Use a separately identified non-production Supabase project and test credentials. The repository still has production defaults and a production-specific CSP; prepare a staging-only URL, publishable key and CSP before opening an app against any database. Keep the app in its production behavior mode so demo fallbacks remain disabled.
2. Validate the complete twelve-migration chain and a sanitized upgrade snapshot. The new migration deliberately requires fresh email verification and disables the legacy credit API; coordinate migration, Edge and frontend rollout on staging. Do not rerun edited historical migrations against an already-recorded deployment.
3. Set `ALLOWED_ORIGINS` to the exact staging frontend origin for `verify-email-otp`. Its JWT gateway check is disabled so unconfirmed users can submit a code, but successful code verification and the database limiter are mandatory. Never expose a generic public attestation endpoint.
4. Configure confirmed-email signup and both confirmation/sign-in email templates to deliver the numeric token. Test a new signup, an intentionally autoconfirmed signup, an existing account requiring re-verification, invalid/expired/replayed codes, email changes, failed proof writes, and restoration of an unverified session. Verify real SDK responses rather than copying the test fixtures.
5. Use two separate verified executive accounts with enrolled authenticators, a distinct institutional treasury identity and a distinct recipient. Only an owner may designate the institutional source. Fund it through verified test-provider settlement, reconcile the ledger, then test request/approve/replay/cancel/expiry/freeze/insufficient-funds scenarios. Leaving the allowlist empty must continue to block all credits.
6. Run independent database sessions for overlapping approvals, request-key collisions, simultaneous cancellation/approval, freeze/revocation races, PIN attempts and normal-wallet/treasury contention. Verify deadlock handling and safe retries. The earlier native PostgreSQL startup attempt failed with a Windows DLL relocation error; that gate has not been passed by PGlite.
7. Complete payout dispatch/reconciliation recovery, verify provider sandbox settlement and wire all frontend payment states before enabling financial traffic. Keep `BANK_PAYOUTS_ENABLED` unset/false and production financial controls disabled meanwhile.

Operational follow-ups include limiter-table cleanup/abuse alerts, exact dependency locking and Deno checks, review of institutional funding ownership, MFA recovery/revocation behavior, and an operational response to pending payouts. The new UI is ready for isolated review, but is not a substitute for real staging/browser acceptance.

## Reproduction and changed files

From the feature checkout:

```text
npm run test:phase1
npm run test:database
npm run test:independent
npm run test:runtime
npm run test:security
npm run test:webhooks
npm run validate
```

The existing PGlite loader requires a local dependency installation or `PGLITE_MODULE_DIR`. No dependency download or production connection was needed during this phase.

New files:

- `supabase/migrations/20261116070000_email_proof_treasury_controls.sql`
- `supabase/functions/verify-email-otp/index.ts`
- `scripts/test_phase1_security.mjs`
- `scripts/test_phase1_handlers.mjs`
- `docs/MIDEPAY_PHASE1_AUTH_TREASURY.md`

Updated files: `supabase/schema.sql`, `supabase/config.toml`, deposit initialization, `supabaseClient.js`, `app.js`, `index.html`, `package.json`, and the relevant migration/runtime/static/webhook test fixtures. Existing changes on the feature branch were retained. Nothing was committed, pushed, deployed or run against production.

**Readiness decision remains NO-GO for production.** Authentication and treasury code gaps are addressed locally; the remaining recovery, concurrency, integration and hosted acceptance gates must be completed before a production decision.
