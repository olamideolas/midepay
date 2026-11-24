# MidePay durable payout dispatch — 18 November 2026

Release decision: staging only. Production Supabase was not accessed, changed or deployed. No provider payout was created during this work. Outbound dispatch remains disabled.

## Behavior implemented

bank-payout no longer sends transfers inline. After authentication, email proof, PIN, limits, freeze and beneficiary verification, it calls the service-only enqueue_wallet_payout RPC. The RPC requires both reconciliation and dispatch to be enabled in private control state, then calls the existing atomic debit. A transaction-insert trigger creates its outbox entry in the same database transaction. If the outbox insert fails, the debit and ledger insert roll back. The browser receives HTTP 202 with pending status. Duplicate requests do not debit again or issue a transfer.

New queued payout references are opaque deterministic SHA-256-derived values, 48 characters long. Existing legacy references remain idempotent. Legacy pending payouts are not backfilled into the send queue because a prior provider call may already have happened. Reusing a reference with a different amount or destination remains a conflict.

The scheduled worker may claim one outbox job per invocation, in addition to up to three reconciliation jobs. It requires BANK_PAYOUTS_ENABLED=true and the private payout_dispatch_enabled switch. Both new reservations and the final send gate enforce the database switch. The scheduled handler remains restricted to the exact approved staging project and a Paystack test key.

Preparation can be retried after an expired two-minute lease. Recipient creation is checked against the stored bank/account/currency. Before any money-sending HTTP call, begin_payout_dispatch atomically fences the lease, rechecks control state, pending transaction and account freeze, records sending state, and appends an immutable audit event. Concurrent calls cannot authorize that gate twice. Stale preparation workers cannot authorize dispatch.

After five failed preparation attempts, a payout with no sending marker may be cancelled and refunded once. Cancellation and dispatch contend on the same outbox row. If cancellation wins, the stale sender is rejected; if the send gate wins, cancellation refuses to refund. Cancellation is never inferred from a provider 404 or timeout.

Once a sending marker exists, the job is never reclaimed for another transfer POST. Provider timeout, malformed response, or acknowledgement uncertainty goes to verification/review. A successful response records the provider transfer code while leaving the ledger pending until the existing verified reconciliation/webhook flow resolves it. Dispatch start/result events append security audit records.

## Important remaining limit

There is an unavoidable local gap between committing sending state and executing the external HTTP request. A crash in that gap might mean nothing was sent, but the worker cannot prove that from a later not-found response alone. Such a payout stays pending/review and is neither automatically resent nor automatically refunded. This implementation favors avoiding duplicate external payments. It is not a claim of perfect exactly-once delivery at Paystack. A future reviewed provider-specific retry/manual resolution process is still required for ambiguous cases.

This first implementation supports Paystack dispatch only. Flutterwave cannot reserve through the new enqueue RPC. Provider fees, merchant transfer/OTP settings and real outbound contract behavior still need controlled verification. The public Paystack transfer documentation request returned HTTP 403 in this environment; no live-provider success is inferred from local fixtures.

## Verification actually completed

All 16 regression suites pass: 342 PASS groups and zero failed suites. The actual recovery/dispatch TypeScript plus all 16 migrations run in isolated PGlite with synthetic Auth/provider HTTP. Its 32 groups include disabled reservations, debit/outbox rollback, crash recovery, stale leases, recipient mismatch, preparation cancellation/refund replay, crash after sending marker, transfer timeout, lost acknowledgement after database commit, frozen accounts, idempotency conflicts, legacy isolation, server flag quarantine and client-role rejection. Existing bank-handler tests now assert queued behavior rather than expecting inline transfer POSTs.

The independent-session native PostgreSQL 18.6 harness passes all 16 groups, including eight competing dispatch claims, 16 competing send gates, a real cancellation-versus-dispatch race, and stale preparation fencing. Evidence: Codex workspace outputs/payout-outbox and work/native-postgres/midepay-isolated-pg-UuiBln. The full-suite run preceded a small blank-reference rejection refinement; the affected recovery/dispatch suite was re-run successfully afterward. No broader checks were represented as newly passed after unrelated changes.

The existing financial-safety workflow already includes the expanded recovery and native suites. The new commit still requires a user push and a fresh GitHub run; the previous green run tested the prior commit.

## Staging deployment

Rollout order was deliberate: deploy the queue-only bank handler first, apply the outbox migration with default dispatch disabled, then deploy the worker. A missing enqueue RPC in the short transition would fail without a debit rather than falling back to inline dispatch.

- bank-payout: ACTIVE version 10, verify_jwt=true.
- reconcile-payments: ACTIVE version 3, existing signed server-only authentication retained.
- Applied migration: 20261118165154_payout_dispatch_outbox.sql.

The CLI originally generated the local migration under an earlier timestamp. Its local filename was aligned to the version Supabase actually recorded; no staging migration-history metadata was rewritten.

Hosted checks confirm: outbox RLS enabled; zero client EXECUTE grants on the five new RPCs; no direct outbox SELECT/INSERT/UPDATE/DELETE for anon, authenticated or service_role; payout_dispatch_enabled=false; no outbox rows; existing customer test balance NGN200.00. The server payout environment setting was not changed and its code default remains disabled. Scheduled worker v3 returned HTTP 200 with zero dispatch counts. Anonymous bank requests returned 401; worker anonymous requests returned 401 and browser-origin requests 403.

Security advisors continue to show the existing anonymous waitlist and authenticated SECURITY DEFINER entry-point categories, private tables intentionally protected by RLS without client policies, and disabled leaked-password protection. No new dispatch function is client-callable. Reference: https://supabase.com/docs/guides/database/database-linter and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

## Operation and next release gates

CI follow-up: run 45376466563 failed its regression step. Running the broader suite locally reproduced an operator-review fixture failure: its new-payout fixture still used the uppercase format and therefore created no outbox row. The fixture now uses the canonical lowercase format and explicitly asserts that its outbox row exists before marking it ambiguous. All 14 operator-review groups and all 9 staging-preview groups pass. The other local regression suites rerun during diagnosis passed. No hosted migration or Edge Function rollout was performed while this CI failure was unresolved; the fixture fix requires a fresh CI run.

### Independent boundary review — 24 November 2026

Local bank-payout changes add an 8-second recipient-lookup deadline, reject redirects, validate bank codes as 3–10 digits and replace provider/transport diagnostics with safe user messages. Both standalone lookup and lookup before reservation fail without queuing a transfer. The mocked boundary suite passed 22 groups, including three new regression groups. These changes are not yet deployed; no provider call, wallet reservation or live payout was performed by this test run.

The independent review found the previous queue generated `MDP-OUT-` plus 40 hexadecimal characters, while current Paystack documentation specifies lowercase reference characters. Source: https://paystack.com/docs/transfers/single-transfers/ .

Local follow-up migration 20261124104448_payout_reference_compatibility.sql generates new `mdp-out-` plus 40 hex references and queues only that format. Existing references are never rewritten or backfilled. Enqueue checks the old hashed identity before creating a new reference, so retrying an older request cannot reserve funds twice. A request advisory lock serializes the lookup/create decision. Function privileges remain unchanged through CREATE OR REPLACE.

The worker sends only the new canonical format and still accepts legacy references for read-only recovery. Exact stored references continue through dispatch and settlement; webhook lookup already uses exact references without a prefix requirement. Legacy unsent uppercase jobs are not automatically converted or dispatched and require review/cancellation under the existing controls. Payout dispatch remains disabled. This is local-only pending CI, staging deployment and an actual Paystack TEST round trip.

Local validation: 38 recovery/dispatch groups, 55 migration/security groups and 22 native PostgreSQL concurrency groups passed against the full 24-migration chain. Native evidence directory: Codex workspace work/native-postgres/midepay-isolated-pg-5d1duH; the isolated server stopped after testing. The new regressions cover old hashed request replay and settlement of the exact lowercase identity. A preliminary settlement fixture omitted the required provider event and was correctly rejected; it passed after supplying transfer.success. These checks use synthetic data and mocked provider responses, not a real bank transfer. Prior boundary commit 33e12bb passed GitHub Actions run 45375583410; the reference change needs its own CI run.

Do not enable outbound dispatch yet. Review private.payout_dispatch_outbox joined to transactions for ready/preparing/sending/submitted/review/cancelled/resolved state, attempts, dispatch_started_at and last_code. Review security_audit_logs for PAYOUT_DISPATCH_STARTED/PAYOUT_DISPATCH_RESULT and audit_logs for refunds/settlement. Use only privileged staging access. Never manually reset sending/review to ready merely because Paystack reports not found.

New invocations can be stopped using the existing reconciliation enable switch and scheduler controls; dispatch additionally honors BANK_PAYOUTS_ENABLED and payout_dispatch_enabled. An already authorized external call may finish. Service-only cancellation is safe only while the RPC proves no dispatch marker exists; legacy/ambiguous payouts require provider verification and operator review.

Next: fresh CI run; a controlled real Paystack TEST payout and verification of its actual response/webhook/OTP behavior; operator review/alert UI; explicit procedure for ambiguous sends; fee/chargeback/refund accounting; broader hosted failure/load testing. Provider approvals, identity checks, legal/compliance and production operational readiness remain separate launch blockers.


## Reference compatibility staging rollout — 24 November 2026

GitHub run 45377290944 passed for b249b0c720743d2b19cee2bfc42dccd55510435c. Deployed reconcile-payments version 7 first (existing signed-worker authentication retained), applied migration 20261124104448, then deployed bank-payout version 11 with JWT verification enabled. Local migration filename aligned to the actual hosted version; no migration history was rewritten.

Read-only postchecks: lowercase reference generation present; anonymous and authenticated clients cannot enqueue payouts; payout dispatch and refund adjustments remain disabled; outbox contains zero rows; test-wallet total remains NGN5200 before/after. Security advisors ran before/after; existing definer endpoint and password-protection findings remain launch work. No provider payout or hosted wallet mutation was performed for this rollout.

Actual Paystack TEST payout, exact signed webhook/verification round trip, provider approval behavior, active-session enforcement on money-changing endpoints and production operational gates remain outstanding. This deployment does not make external transfers ready for public use.
