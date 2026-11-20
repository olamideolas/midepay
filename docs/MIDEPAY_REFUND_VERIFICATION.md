# Staging refund verification — 2026-11-20

## Verified result

Staging project: `ajbhsmcosxgymrtawlmd`. No production project accessed.

Deployed `reconcile-payments` version 5 after confirming version 4 matched the repository HEAD. The new explicit `verify_refund` action uses the existing signed, one-use worker authorization and accepts test credentials only. It makes one GET to Paystack's refund API, validates identity, domain, currency, integer amount and status, and returns only normalized evidence. It does not claim payment jobs, dispatch a transfer, create a refund, or change wallet balances.

Staging pg_net request 2749 returned HTTP 200 with:

```json
{"success":true,"verification":{"refund_id":"19221040","transaction_id":"6774684861","domain":"test","currency":"NGN","amount_kobo":10000,"status":"processed","source":"paystack_refund_api","wallet_changed":false}}
```

The provider transaction matches MidePay deposit `MDP-PSK-MWLBGKZL-5CD9FC20BCB0`, amount NGN 100, previously successful. This is provider API verification, not inference from a screenshot or a replayed signed webhook.

After verification, the normalized observation was recorded through the existing `record_paystack_case_event` function as `refund.processed`, with `verification_source: paystack_refund_api` included in its input. First recording returned `duplicate:false`; identical recording returned `duplicate:true`. Both returned `review_required:true` and `wallet_changed:false`.

The current evidence schema stores normalized case fields and an input digest; it does not retain a separate verification-source column or the complete API response. This report preserves that provenance distinction. The observation must not be represented as a newly delivered signed webhook.

Wallet balance and ledger balance both remained NGN 200 before and after recording.

## Validation performed

- `node scripts/test_payment_reconciliation.mjs`: 35 passed, 0 failed.
- `node scripts/test_provider_cases.mjs`: 24 passed, 0 failed.
- `git diff --check`: passed (Windows line-ending warnings only).
- Staging provider GET: HTTP 200, processed test refund, matching original transaction.
- Staging duplicate evidence recording: duplicate detected, no wallet change.

These are 59 test groups run for this change, not a claim that the full historical suite was rerun. Local tests use isolated PGlite with the repository migrations and synthetic provider responses.

## Remaining work / readiness

NOT production ready. Recording refund evidence does not implement refund accounting. The NGN 100 processed refund still requires a reviewed, idempotent wallet/ledger adjustment workflow with insufficient-funds handling and independent authorization. No automatic debit, completed-review claim, or deposit reversal was performed here. Production payouts, chargeback accounting, settlement reconciliation and the remaining readiness items in MIDEPAY_PROVIDER_CASES.md remain outstanding.

The lookup is an explicit staging operator action, not automatic refund discovery or a customer-facing feature. Original scheduled reconciliation remains available when no action is supplied. No frontend redeployment or schema migration was needed.

API reference: https://paystack.com/docs/api/refund/#fetch
