# Verified recovery of a missed Paystack test deposit

17 November 2026. Staging only; production Supabase was not accessed or deployed.

## Incident and observed state

Paystack's transaction-details screenshot showed a successful NGN 100 TEST payment matching reference `MDP-PSK-MWLA9YWI-7F5F8F4AB998`. Independent staging SQL inspection found the same deposit pending, balance and ledger balance both 0.00, and zero settlement audit records. Earlier logs contained checkout initialization but no payment webhook for the attempt. A screenshot is useful diagnostic evidence, but is not accepted by the implementation as authorization to credit a wallet.

## Fix

Added an authenticated `action: verify_payment` path to the existing init-payment function. It is explicitly restricted to staging `ajbhsmcosxgymrtawlmd` with a Paystack test secret. It validates the Auth user and independent email proof, scopes its transaction lookup to that user's Paystack inflow deposits, and checks either an explicit validated reference or the newest matching deposit.

The server uses its private test key to call Paystack's transaction verification API over HTTPS. Settlement requires provider success, test domain, NGN currency, an exact matching reference and amount in integer kobo, and a valid provider receipt ID. Browser callbacks, caller amounts, client success flags, screenshots and local balance hints are never used as payment proof. A missing/unconfirmed payment, timeout, ownership mismatch, receipt mismatch or database failure cannot authorize a credit.

The existing service-only settle_gateway_deposit RPC performs the actual atomic ledger change. Repeat checks and a later webhook use its existing idempotency and receipt uniqueness. Recovery does not create a new checkout or manually alter balances. Its normalized audit payload records verification_source=paystack_verify_api and excludes reusable card authorizations and customer details from the verification response. The legacy settlement RPC audit reason still uses the word webhook; consumers should inspect verification_source to distinguish this recovery path. No schema migration was added.

Added Check latest Paystack deposit below Add Money. It serializes clicks, reports pending/error states without adding local money, and reloads authoritative wallet data after verified settlement. The service-worker cache version was advanced to deliver the new page controls. General financial RPCs and bank payouts remain quarantined.

## Verification

15 automated suites passed: **308 PASS groups, zero failing suites**. Logs and exact exits are adjacent in test-results.json. The expanded pipeline now has 24 checks and the client suite has 13. Pipeline tests run the actual handlers and migrations in isolated PGlite with simulated Auth/provider responses. Native simultaneous-session PostgreSQL tests remain unresolved as documented previously; these are not a substitute for that testing.

New coverage includes recovery after a missed webhook, repeated recovery followed by a webhook without a second credit, non-successful provider states, mismatched amounts/currencies/domains/references/receipts, cross-user deposit access, missing independent email proof, provider timeouts, non-staging targets, invalid reference formats, failed settlement, and user-scoped newest-deposit lookup. Browser checks cover preserved quarantine and authoritative balance refresh only after verification.

The normalized provider payload adjustment was followed by another passing pipeline run. Service-worker JavaScript syntax and git diff whitespace checks passed. No actual user password, OTP, private key or card authorization was obtained or logged by the agent.

## Deployment and hosted checks

Implementation commit: `1cac4dfcf1308273562869cecb45349b18ef9727` on fix-v46-migration-repair. Remote push was not attempted; earlier Git credential-helper issues remain unresolved.

Staging init-payment is ACTIVE version 10 with verify_jwt=true. Preview deployment `dpl_EM3U2XJZr6RVt4ETPyYd1tvw9pro` reached READY. The existing stable alias was moved from the previous Preview deployment to this one:

https://midepay-staging-ola-f90f.vercel.app

The stable page, app script and config endpoint returned HTTP 200. The new button and its handler were present. Config still targets the approved staging project with financial actions disabled. An unauthenticated verification POST returned HTTP 401. The artifact was sanitized by the existing staging generator; no production deployment alias was changed.

## User acceptance still pending

Have the user hard-refresh the stable staging page, sign in if needed, open Add Money and press Check latest Paystack deposit. Then independently verify that the hosted deposit is successful, wallet and ledger are NGN 100, and there is exactly one settlement record. Press the check again and verify no additional credit; later replay the original provider webhook if available. These hosted acceptance steps have not yet completed in this report.

The underlying Paystack test webhook configuration still needs verification so new payments can settle automatically. This fallback is an on-demand test-deposit check, not a background reconciliation scheduler, payout outbox or production readiness sign-off. Provider fee accounting and general ledger reconciliation also remain launch work; the existing deposit model credits the gross checkout amount.
