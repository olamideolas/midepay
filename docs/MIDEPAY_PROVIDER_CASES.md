# Refund/dispute intake and provider-fee observations

20 November 2026 — feature branch `fix-v46-migration-repair`.

**Release decision: not ready for real-money production.** This increment stops supported refund/dispute notifications from being silently ignored and retains provider-fee evidence. It does not initiate a refund, settle a chargeback, freeze a wallet, debit a customer or post a general accounting journal.

## Implemented behavior

The actual `payment-webhook` handler now retains Paystack `refund.pending`, `refund.processing`, `refund.processed`, `refund.failed`, `charge.dispute.create`, `charge.dispute.remind` and `charge.dispute.resolve` events. HMAC verification still precedes JSON parsing and all database work. Staging requires a test secret and a test event domain, including the nested transaction domain used by some case payloads. Missing or unsafe case identifiers fail validation.

HTTP 200 is returned only after the intake RPC confirms durable storage. Database failure, an exception or an incomplete RPC result returns HTTP 503 so Paystack can retry. Unknown refund/dispute event types return a retryable failure instead of an ignored-event success. Body reading is bounded to 256 KiB, including streamed bodies, and invalid JSON object shapes are rejected.

`private.payment_provider_cases` identifies a refund or dispute by kind, provider ID and test/live domain. `private.payment_provider_case_events` retains distinct deliveries under that case. A per-case advisory transaction lock and unique digests prevent concurrent duplicate inserts. Equivalent parsed JSON key ordering deduplicates. Changed amounts and later state notifications remain separate evidence. Every case remains **needs_review**; the last received event is explicitly an arrival observation, not an authoritative lifecycle state.

The intake distinguishes a refund reference from the original charge reference. It links charge references/receipts when consistent, retains unmatched cases, flags conflicting identities and flags amounts above the original charge. The review query sums distinct refund cases with consistent NGN amount observations and at least one processed event, and flags cumulative exposure above the original payment. Conflicting, unknown or unmatched amounts are not folded into a fabricated total. Reported exposure is not verified money movement; a later failure notification does not authorize a credit or erase earlier evidence.

The new tables store normalized amounts, IDs, limited status/resolution labels, timestamps and a digest. Customer emails, card/authorization details, notes and arbitrary metadata are not copied into them. Existing transaction webhook payload storage is unchanged; this is not a claim that all legacy provider payloads are sanitized.

## Provider fees

Validated Paystack deposit settlement now atomically appends an immutable row to `private.payment_charge_observations`. It records gross kobo, receipt, domain, declared source and the observed merchant fee. Existing row locking and settlement idempotency remain in force. A successful exact replay may supply a previously missing fee without crediting the wallet again.

Only a nonnegative integer fee no larger than the gross payment is known. Zero is valid. Missing/null fees stay unknown; strings, fractions, negative values and above-gross values are invalid observations. Distinct known fees produce a conflict rather than overwriting evidence. An invalid observation also prevents the review API from claiming a reliable net amount. Expected provider net is shown only when the observations support one fee, and `bank_settlement_verified` is always false.

Both authenticated manual recovery and the signed scheduled verification worker now retain the `fees` field from their existing Paystack verification response. No extra provider request is introduced. Full customer credit remains unchanged. Fees are not silently charged to a wallet, and no fee backfill is inferred from historical payments.

This is **accounting evidence, not a double-entry merchant ledger**. It does not reconcile tax, processor reserves, payout charges, chargeback costs, bank payouts or settlement reports.

## Authorization and review

All three new tables have RLS enabled, no client policies, and direct table access revoked from PUBLIC, anon, authenticated and service_role. Update/delete triggers reject changes to the observations. The intake RPC is service-only. The fee helper cannot be called directly by client or service roles; it is invoked by the existing settlement definer function.

`get_operator_provider_review(p_view, p_before, p_before_id)` exposes a bounded, read-only projection with 25-row keyset pagination. Views are `cases` and `charges`. It reuses the existing verified executive, nonfrozen account and recent AAL2/TOTP authorization boundary. Anonymous and service-role execution is denied. It omits raw payloads, digests, customer identities and private signing/lease material. It has no financial actions.

For a signed-in authorized operator, the SDK's underlying Supabase client can call:

```javascript
await supabase.rpc('get_operator_provider_review', { p_view: 'cases' });
await supabase.rpc('get_operator_provider_review', { p_view: 'charges' });
```

Use `next_cursor.before` and `next_cursor.id` as `p_before` and `p_before_id` to fetch the next page. This increment adds the backend review API; it does not add new frontend screens or resolve the postponed executive signup/MFA setup.

## Validation

The new suite executes the actual HMAC webhook handler and all SQL migrations against synthetic local data. It covers duplicate and concurrent delivery, partial refunds, reordered lifecycle events, changed amounts, identity mismatches, malformed events, retry behavior, fee ingestion through recovery paths, missing/zero/conflicting fees, immutable records, role denial, recent MFA, paging and unchanged customer money.

Actual local results: **19 regression suites, 393 passing groups, zero failed suites**. The new provider-case suite contributes 24 of those groups. Manual payment verification contributes one added fee-retention group and the scheduled worker contributes another. **18 native PostgreSQL 18.6 groups passed**, applying all 19 migrations. Native concurrency tests include sixteen simultaneous refund deliveries and sixteen simultaneous fee observations in independent PostgreSQL sessions. They are synthetic provider tests, not real Paystack refunds or chargebacks. No frontend layout changed, so browser layout tests were not repeated.

Run `npm run test:provider-cases` after installing the pinned development dependencies, or set `PGLITE_MODULE_DIR` to an installed PGlite package. The financial safety CI workflow includes the new suite. Remote CI for this increment remains pending until its commit is pushed and the run is checked.

## Staging deployment and security evidence

Only staging project `ajbhsmcosxgymrtawlmd` was changed. Migration `20261120090704_provider_case_intake_and_fees.sql` matches the hosted migration history. Staging functions are ACTIVE: `payment-webhook` version 8 (HMAC authentication, gateway JWT disabled as before), `init-payment` version 11 (gateway JWT enabled), and `reconcile-payments` version 4 (existing signed one-use server invocation). The previous deployed function sources matched the branch HEAD before replacement.

Before and after deployment, two staging wallets total **200 NGN available balance and 200 NGN ledger balance**. Payout dispatch remains false. A synthetic refund intake was exercised inside a rolled-back subtransaction; no synthetic cases remain. Anonymous review returned FORBIDDEN. Actual HTTP requests without credentials returned 401 from both the webhook and recovery worker. Direct table privileges and function grants were independently queried and match the boundaries above. No real refund, dispute or provider payment was created. Production was not accessed or deployed; Vercel assets were not changed.

Security advisors were checked before and after the migration. The new private tables produce informational RLS-without-policy notices by design; direct grants are revoked. The protected authenticated definer review RPC produces the expected definer-function advisory; role, email proof and recent MFA checks are enforced and tested. Existing notices include an anonymously callable `join_waitlist` RPC and disabled leaked-password protection; this increment does not clear or certify those independent findings. See [RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [definer access advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [anonymous definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

An additional hosted waitlist table/RPC exists outside this local migration chain. It was not modified. The advisor output is not a clean bill of health or a new complete audit of those unrelated features.

## Remaining work before real-money use

1. Independently verify cases through Paystack's refund/dispute GET APIs before making financial decisions. Implement durable verification leases, retries, discrepancy alerts and provider deadlines. Current authenticity proves receipt of a signed notification, not a reconciled financial outcome.
2. Define and implement authorized full/partial refund decisions, maker/checker approval, a bounded cumulative refund journal, deterministic outbound request idempotency, ambiguous-response handling and customer recovery/deficit policy. Never debit an already-spent wallet into a fabricated balance or issue a second refund from a repeated event.
3. Implement dispute evidence, deadlines, reserves/holds, appeals, chargeback liabilities and independently approved resolution. A provider `resolve` message alone must not release or collect funds.
4. Build the merchant double-entry journal and reconcile observed fees and gross amounts against provider settlement reports and bank receipts. Missing historical fees require independent verification, not assumptions.
5. Add the operator frontend, alerting and an end-to-end executive MFA exercise once the postponed SMTP/signup issue is resolved. The read RPC alone is not an operational review process.
6. Complete real test-mode payout/refund/dispute exercises and operational/security readiness checks. Keep bank payout dispatch disabled and production untouched until release evidence supports enabling real money.

## Provider documentation checked

- [Paystack webhook event types and signature handling](https://paystack.com/docs/payments/webhooks/)
- [Paystack refunds guide](https://paystack.com/docs/payments/refunds/)
- [Refund API](https://paystack.com/docs/api/refund/)
- [Dispute API](https://paystack.com/docs/api/dispute/)
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)

The current Supabase changelog was checked; this work does not merge branches or upgrade the pinned CLI or client libraries.
