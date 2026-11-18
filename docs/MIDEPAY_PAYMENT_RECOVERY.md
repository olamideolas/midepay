# MidePay scheduled payment recovery — 18 November 2026

Release decision: staging only. Production was not accessed, changed or deployed. Live payout dispatch remains quarantined.

## Behavior implemented

The reconcile-payments Edge Function verifies existing pending Paystack deposits and payouts through Paystack's GET verification APIs. It never initializes checkout, creates a transfer recipient, sends/retries a transfer, or trusts a browser callback. The exact approved staging project and a Paystack test key are required.

Verified matching test NGN deposits settle through the existing atomic settlement RPC. Verified successful payouts finalize; verified failed/reversed payouts refund through existing atomic reversal RPCs. Payout evidence must match the stored bank/account, amount, currency, reference, transfer code and test domain. Provider not-found, timeout, malformed data or nonterminal status does not authorize a refund. Mismatches enter review.

Private durable jobs are discovered from pending transactions older than 30 seconds, at most 500 new jobs per discovery. Each worker claims at most five jobs with SKIP LOCKED, random fencing tokens and two-minute leases. Crashes recover on lease expiry. Backoff starts at one minute and caps at six hours. After 12 claims, unresolved jobs enter review. Finishing with a stale/expired token is rejected; queue acknowledgements do not replace atomic/idempotent ledger settlement. Normal completion/retry/review outcomes append security audit events; crash-exhausted jobs remain visible in the private review queue.

## Scheduler authentication and platform finding

The scheduled worker accepts POST only, rejects browser Origin headers, ignores request-body references and validates a dedicated signed invocation in PostgreSQL before claiming work. Signing material is generated inside a private RLS-protected table. Neither application clients nor service_role can read that table directly. Client roles cannot execute the worker RPCs or mint signatures.

Each signature binds the fixed recovery operation and Unix timestamp, expires after 60 seconds, and is consumed atomically once. The scheduler sends no reusable bearer credential or Paystack/service key through pg_net. A visible signed request can only trigger the already authorized fixed batch once within its window; it cannot select transactions or forge future calls. Responses contain counts, not references or customer details.

Important hosted limitation: pg_net's managed request queue has inherited PUBLIC access and is owned by supabase_admin. A narrow permission migration successfully removes client access in an owner-controlled test fixture, but hosted PostgreSQL emitted grantor limitations and retained its default ACL. We independently checked the effective hosted ACL rather than treating a successful migration call as proof. Reusable credentials were never inserted into that queue. The signed one-use design avoids relying on its confidentiality. This platform queue visibility must remain part of any production platform review; do not put reusable credentials into other pg_net requests.

Automatic approval review rejected a broad permission revocation because it could affect service access. The narrower migration preserved service access; the signed design then addressed the managed-ownership limitation. Automatic review also rejected manually rewriting staging migration-history versions because of drift risk. No history entry was rewritten. Local migration filenames were instead aligned to the actual applied versions:

- 20261118160728_payment_reconciliation_queue.sql
- 20261118161218_recovery_scheduler_permissions.sql
- 20261118161813_signed_reconciliation_invocations.sql

Both private recovery tables have RLS, no client SELECT, and no direct service-role SELECT. Hosted verification found zero client-callable recovery RPCs and no client signature-mint privilege. Existing security advisors still flag broad categories of SECURITY DEFINER entry points and disabled leaked-password protection; these are not claimed resolved by this work. See Supabase's database-linter guidance: https://supabase.com/docs/guides/database/database-linter and password protection: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

## Verification actually completed

All 16 regression suites pass: 326 PASS groups, zero failing suites. The recovery suite contributes 16 groups executing the actual TypeScript handler against all SQL migrations in isolated PGlite with synthetic Auth and provider HTTP. It covers server-only authorization, signature expiry/forgery/replay, disabled/live-target guards, queue privileges, missed deposits, duplicate credit prevention, acknowledgement loss, payment mismatches, timeout/backoff, not-found payouts, finalization/refunds, recipient mismatches, leases and retry exhaustion. Local-only fixture/SQL type errors during development were fixed before deployment; earlier logs remain in the workspace.

The native PostgreSQL 18.6 suite passes all 13 groups after all 15 migrations, including parallel queue claims and expired-lease fencing. Other native cases cover simultaneous payout/deposit/reversal/P2P mutations, actual lock contention, balance conservation and client-role rejection. This is not a hosted Supabase load test or a proof that every possible race is impossible.

Evidence lives in the Codex workspace outputs/reconciliation and work/native-postgres/midepay-isolated-pg-YZJiBI. The test workflow now includes recovery regressions. The new source has not yet run on GitHub until the user pushes it; the previously green run tested the earlier commit.

## Staging deployment and actual scheduled behavior

Worker reconcile-payments is ACTIVE version 2, verify_jwt=false because it performs its own server-only signed-invocation authentication. The scheduler job midepay-staging-reconcile-payments runs every minute. Signing material was initialized server-side without printing, downloading or committing it. No extra user secret setup is required.

Two initial scheduled invocations returned HTTP 200: the first processed one genuinely unfinished staging test payment, classified it PROVIDER_NOT_TERMINAL and retained it for retry; the next processed zero jobs while respecting backoff. The existing customer test balance remained NGN200.00. This proves actual scheduling, authorization and a real Paystack verification/pending path. It does not prove a new missed successful payment or payout was recovered against the provider; successful recovery/refund and replay cases here use isolated synthetic provider responses. No new payment or payout was created for this deployment.

## Operation and remaining work

The staging-only scheduler configuration is saved under supabase/staging/payment_reconciliation_scheduler.sql. It is separate from the application migration chain and must never be run against production. To pause new invocations, disable the private control row and unschedule the named job using the commented commands; an already authorized batch may finish. Never expose the signing key or put a reusable secret in the request queue.

Operator checks (privileged staging SQL only): group private.payment_reconciliation_jobs by state/last_code; inspect review rows; inspect net._http_response HTTP status/content as well as cron.job_run_details. Cron SQL success alone does not mean the HTTP worker succeeded. No customer-facing review dashboard or outbound alert delivery has been added.

Still required: durable outbound dispatch/outbox recovery for a crash before provider acceptance; controlled resubmission rules; fees/accounting; provider refunds/disputes/chargebacks after successful deposits; operational alerts and review UI; hosted failure/load testing; real identity/provider/compliance readiness. Not-found or ambiguous payouts deliberately remain pending/review and are never automatically resent or refunded. Keep live payouts disabled.
