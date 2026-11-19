# Payment accounting review — 19 November 2026

Release decision: **not ready for real-money production use**. This increment hardens monetary validation and verifies payout fee reversal. It does not implement merchant settlement accounting, card refunds or disputes.

## Verified defects and corrections

The new disposable-database regression suite produced six failing groups against the previous migration chain, with each failed group rolled back to avoid cascading balance failures. After migration `20261119041317_accounting_amount_boundaries.sql`, all twelve groups pass.

| Verified defect | Result after correction |
| --- | --- |
| Deposit settlement accepted more than the registered amount and credited only the registered amount. | The provider amount must match exactly. Underpayments and overpayments fail without changing the wallet. |
| SQL rounded fractional Paystack kobo into a valid deposit. | Raw kobo must be positive, finite integers within the ledger's range. Flutterwave NGN inputs must have at most two decimal places. |
| A nonzero customer deposit fee created a mismatch between the credited wallet and ledger reconciliation. | Settlement rejects nonzero deposit fees. Current checkout creates zero customer fees and promises full credit; no new customer charge is introduced. |
| A successful deposit replay with a different receipt was reported as already settled. | Replays must match both the original amount and receipt. Exact replays remain idempotent. |
| Negative payout fees were silently clamped to zero; fractional fees were rounded. | Invalid fees fail before any debit. An omitted/null fee retains its existing zero-fee meaning. |
| Fractional payout principal was silently rounded by SQL. | Principal must be positive, finite and exactly representable to two decimals. Principal plus fee must fit the ledger. |

These SQL functions remain service-only. The browser and ordinary authenticated wallet accounts cannot call them. Existing row locks, idempotency checks, email proof, account restrictions, KYC limits and payout outbox behavior are retained. No historical transactions or balances are rewritten.

## Accounting behavior verified

The synthetic fee test settles a 1,000 NGN deposit, reserves a 100 NGN payout plus a 2.50 NGN customer fee, and observes 897.50 NGN available. A verified failed payout restores exactly 102.50 NGN once. Repeated failure events do not increase the balance again. The wallet reconciliation function agrees before and after reversal. Reusing the payout reference with a different fee fails.

The actual checkout/webhook integration test also verifies that a signed overpayment cannot settle a pending deposit. These tests use synthetic provider responses and isolated data, not real customer money.

## Actual validation results

- 18 local regression suites: **367 passing groups**, zero failed suites after configuring the installed PGlite dependency. The first runner attempt could not load PGlite for two suites; rerunning with `PGLITE_MODULE_DIR` set resolved that environment issue.
- Native PostgreSQL 18.6: **16 passing groups**, applying all 18 migrations, with independent concurrent sessions. This covers duplicate deposits/debits/reversals, overspending, opposing P2P transfers, recovery claims, dispatch claims and dispatch/cancellation races.
- The new accounting suite: **12 passing groups**, included in the 367 above; the checkout/webhook suite: **25 passing groups**, also included above.
- GitHub financial safety workflow now includes the accounting suite. A new remote CI run is pending the user's push; local success is not a claim of remote CI success.
- No frontend changes; existing browser checks were not rerun for this SQL-only increment.

Reproduce the new suite with `npm run test:accounting`. Install the pinned dev dependencies first, or supply `PGLITE_MODULE_DIR` pointing to the installed package directory. Native concurrency tests require `MIDEPAY_PG_BIN`; the runner only creates a disposable loopback database and never accepts a remote database URL.

## Staging verification

Only staging project `ajbhsmcosxgymrtawlmd` was inspected and migrated. Hosted migration version is `20261119041317`; the local filename matches it. Function execution is denied to `anon` and `authenticated`, and granted to `service_role`. A harmless synthetic fractional-amount probe raises `INVALID_GATEWAY_AMOUNT` before any transaction lookup or balance change.

Before and after the migration: two staging wallets total **200 NGN balance and 200 NGN ledger balance**. No pending deposit had a nonzero customer fee. `payout_dispatch_enabled` remains false. No production database access, production deployment, provider transfer, refund or real payment was performed. No Vercel deployment is needed for these SQL changes.

## Remaining release blockers and next work

1. **Merchant processing fees and settlement:** provider fees are not recorded as a separate immutable merchant expense/receivable. Customer wallet reconciliation alone does not reconcile the Paystack merchant balance, fees, bank settlement, reserves or payout charges. Unknown provider fees must not be assumed zero. Establish the fee policy and reconcile provider settlement reports to a proper accounting journal before handling real money.
2. **Card refunds:** refund events are currently acknowledged as unsupported/ignored by the webhook. There is no complete full/partial refund lifecycle or bounded, idempotent refund journal. A payout reversal test does not validate a card refund. Build durable verified event intake, provider verification, cumulative refund limits, audit records and insufficient-wallet handling before enabling refunds.
3. **Disputes/chargebacks:** dispute events are likewise ignored. There is no complete liability/reserve/hold process, evidence workflow, deadlines or chargeback reconciliation. Do not automatically debit a customer solely from an unverified event or treat an ignored event as a resolved case.
4. **Real provider payout testing:** test-mode Transfers API access, provider fees, OTP-dependent transfer states, ambiguous outcomes and operator resolution still require an end-to-end staging exercise. Keep payouts disabled until verified.
5. **Privileged operations:** executive signup is blocked by staging SMTP authentication; the real executive MFA journey and independent approval exercise remain pending. The user asked to postpone email setup.
6. **Operational readiness:** verified sender domain/email delivery, KYC/compliance arrangements, monitoring and incident response, recovery/backup drills, independent reconciliation and deployment controls still require release evidence. Passing the static production validator is not deployment approval.

Next implementation priority: durable refund/dispute intake and explicit journal design, with synthetic duplicate, partial-refund, out-of-order event and insufficient-funds tests. Merchant accounting and customer wallet balances must be reconciled separately.
