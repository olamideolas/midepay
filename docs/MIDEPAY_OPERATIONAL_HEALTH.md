# Staging operational checks — 25 November 2026

Scope: staging project `ajbhsmcosxgymrtawlmd` only. No production database access. This is a manual diagnostic and response guide, not an installed alert service or production approval.

## Repeatable check

Run `supabase/staging/operational_health.sql` through privileged staging SQL access. The explicit read-only transaction returns aggregate counts; it does not expose signing material, customer identifiers or HTTP response bodies, invoke workers, or move money. Do not grant this diagnostic to browser clients. Confirm the project before running it.

The scheduler result is restricted to the named recovery job. HTTP response totals are **project-wide**: they do not prove that a particular recovery invocation succeeded. Correlate request IDs and inspect server logs through authorized operational access when investigating. A cron success only proves that its SQL ran; HTTP 200 alone does not prove ledger settlement.

## Verified snapshot

The saved SQL executed successfully on staging on 25 November 2026:

| Signal | Observed |
|---|---|
| Recovery enabled / named scheduler | true / one active job |
| Scheduler runs in preceding 15 minutes | 15 succeeded, 0 failed |
| Project-wide HTTP responses in same window | 15 HTTP 200, no timeout |
| Overdue recovery jobs / expired recovery leases | 0 / 0 |
| Manual review queue | 1, PROVIDER_NOT_TERMINAL |
| Payout dispatch / payout queue | disabled / empty |
| Expired payout leases | 0 |

This is a point-in-time observation. Review items are unresolved work, not healthy completed payments. No payment was retried, refunded or manually settled during this check.

## Response rules

| Signal | Initial response |
|---|---|
| Recovery disabled, missing/inactive scheduler, or no success for 5 minutes | Investigate scheduler/worker availability and authorization. Check HTTP failures as well as cron. Do not enable payouts as a repair. |
| Any scheduler failure, HTTP timeout or non-2xx response | Inspect the corresponding invocation and bounded error category. Never export tokens or response bodies into public reports. |
| Overdue jobs or expired leases persisting across two checks a minute apart | Investigate worker progress and database contention. Existing fenced leases handle recovery; do not clear leases or reset attempts manually. |
| Any review row | Inspect Payment Review with executive MFA and compare the provider record. Pending, abandoned, not-found or ambiguous evidence does not authorize a new send, credit or refund. |
| Any payout dispatch enabled in current staging baseline | Treat as unexpected configuration drift. Stop new dispatch through the reviewed operational control; an in-flight request can still finish. Investigate before resuming. |
| Any unexplained ledger mismatch or duplicate credit | Stop affected new money operations, preserve evidence and reconcile with the provider. Never edit balances or delete ledger rows to make totals match. |

Use the existing Payment Review screen for individual records. No recipient details, transaction references or amounts are included in this aggregate diagnostic. Escalate ambiguous outcomes for independent review; do not bypass the second-approver requirement.

## Offline health evaluator

`node scripts/evaluate_staging_health.mjs snapshot.json` evaluates the raw aggregate object or the SQL export shape `[{"health": {...}}]`. Omitting the filename reads standard input. Export only the diagnostic result, not SQL-editor metadata or MCP prose. The SQL includes the expected staging project label; that label is a provenance check, not cryptographic proof of which server produced a file.

Exit codes: **0** means no configured operational signal was detected; **1** means attention is required; **2** means invalid/unreadable input. Neither 0 nor a successful HTTP response is a production readiness verdict. The evaluator rejects missing fields, invalid counters, wrong project, malformed queue states and invalid timestamps. It flags snapshots older than five minutes or more than 30 seconds ahead, and scheduler successes absent for over five minutes. Run on a host with a synchronized clock.

Output contains fixed alert codes/severities only. It does not echo provider text, references or unknown input fields. Review rows remain warnings even when all HTTP requests returned 200. Expired leases and overdue jobs request a recheck; this stateless evaluator cannot prove persistence across checks or deduplicate deliveries. Project-wide HTTP failures are explicitly labeled and must be correlated separately.

Verification on 25 November 2026: **12/12 evaluator tests passed**. A fresh staging read returned 15 scheduler successes, zero scheduler failures and one recovery review item. Evaluating that recorded snapshot at its observation time returned exactly `RECOVERY_MANUAL_REVIEW` with status `attention` and alert exit code 1. This was expected, not a failed regression. Payout dispatch remained false. GitHub CI now includes evaluator regressions; its new run has not been independently observed here.

This is an offline evaluator, not a scheduled collector or delivered alert. No credentials, scheduled remote connection, notification destination or messaging permission was added.

## Remaining operations work

Connect a real monitoring destination and test alert delivery, acknowledgment, deduplication and escalation with a named operator. No messages or external notifications were sent by this work. Thresholds above are initial staging investigation thresholds, not approved production service levels.

Backup readiness requires a genuine backup restored into an isolated target, then migration/schema, ownership/RLS, record counts, ledger conservation and application recovery checks. A synthetic fresh migration run is not a backup restore. Do not restore over an active database. Agree recovery objectives, data handling and backup retention before a hosted drill. A subsequent [local synthetic backup restore drill](MIDEPAY_LOCAL_RESTORE_DRILL.md) passed; hosted backup recovery remains unverified.
