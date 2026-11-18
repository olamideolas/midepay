# MidePay money-safety verification — 18 November 2026

Release decision: staging only. Production Supabase was not accessed, changed or deployed. Work remains on fix-v46-migration-repair.

## Verified improvement

The old PostgreSQL 15 installation cannot launch on this Windows machine. A separate disposable PostgreSQL 18.6 installation successfully ran the native harness. The harness now uses the pinned pg 8.16.3 client instead of requiring psql.exe, which the standalone binary package does not include. Server binaries are scratch test tools, not application dependencies. Each run creates its own loopback-only cluster on an ephemeral port, applies all 12 migrations and stops the server afterward. No remote database URL is accepted.

11 native checks passed:

- Eight independent backend PIDs have overlapping execution windows.
- All migrations apply with pgcrypto and uuid-ossp in a separate extensions schema.
- Sixteen duplicate payout requests debit once. A coordinator held the wallet lock and observed 15 financial sessions waiting concurrently on database locks, then released them; this is actual lock-contention evidence.
- Twenty distinct payouts cannot overdraw a synthetic NGN10,000 wallet: ten succeed, ten fail for insufficient funds.
- Sixteen duplicate deposit settlements credit once.
- Sixteen duplicate payout reversals refund once.
- Reusing a payout reference with changed money parameters is rejected.
- Client roles cannot execute service-only settlement.
- Sixteen duplicate P2P requests create one outgoing/incoming pair and debit once.
- Twenty distinct P2P requests cannot overspend the sender.
- Twenty opposing P2P requests complete without deadlocks in this run and conserve the two-wallet total.

These results establish the tested scenarios on PostgreSQL 18.6 with synthetic Auth tables and users. They do not prove every race is impossible, the exact hosted PostgreSQL 17 configuration, production throughput, provider delivery or real Supabase Auth behavior. Synthetic funding resets deliberately isolate scenarios; this is not a complete lifetime accounting reconciliation.

Evidence: Codex workspace outputs/money-safety/native-final.log; work/native-postgres/midepay-isolated-pg-carggU/{overlap-evidence.json,financial-lock-evidence.json,opposing-p2p-results.json,server.log}. Earlier logs retain the missing-psql startup failure and an incorrect test assumption that both paired transactions share one idempotency key; the corrected test checks one sender key and two ledger rows.

## Verified payout bug fixed

A browser-provided account_name skipped provider account resolution and was forwarded as the beneficiary name. The provider's returned account number was also not checked against the requested destination. Two regression cases reproduced these failures before the fix (17 passing groups, 2 failing).

The handler now always resolves the exact account server-side before reserving money, requires a nonempty provider name and an exact matching account number, and ignores the browser name as proof of ownership. Existing payout quarantine, JWT verification, atomic debit and ambiguous-outcome handling remain intact. This prevents unverified beneficiary labels; it does not establish legal ownership of the destination or prevent a customer deliberately selecting the wrong account.

The payout boundary suite now passes all 19 groups. An existing ambiguous-timeout test fixture was updated to let account resolution succeed before simulating a dispatch timeout, preserving its original financial assertion. Final results: all 15 existing suites pass, 310 PASS groups, plus the 11 native checks. Initial full-suite results and the affected suite's successful rerun are retained. Passing static 'production readiness' output is not release approval.

Staging bank-payout deployed ACTIVE version 9 with verify_jwt=true. Remote source was compared with the reviewed base before replacement; only the intended fix and harmless trailing newlines differed. Staging smoke checks: approved-origin preflight 204, unauthenticated POST 401. No payout, customer debit or database migration was performed against staging.

## Repeatability and remaining work

A separate financial-safety.yml workflow runs isolated native PostgreSQL checks and all 15 regression suites without production credentials or deployment steps. It targets Ubuntu PostgreSQL 16; it has been authored but has not run on GitHub, so no CI pass is claimed. Production deploy workflow was not triggered.

To reproduce locally: npm ci --ignore-scripts; set MIDEPAY_PG_BIN to a working PostgreSQL bin directory with pgcrypto/uuid-ossp; optionally set MIDEPAY_PG_TEST_ROOT to a disposable writable directory; run npm run test:postgres-concurrency. MIDEPAY_PG_MODULE is an optional absolute pg module file for scratch-only dependency installations.

Priority still open: durable payout outbox and recovery worker, verification of lost provider responses, reconciliation of stale deposits/payouts, refunds/disputes, fee accounting, broader failure/load testing, real identity/provider approvals, operational and legal readiness. Keep live payouts disabled. This milestone does not make the product production-ready.
