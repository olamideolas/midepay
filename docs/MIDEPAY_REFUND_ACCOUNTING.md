# Test-mode refund accounting — 2026-11-20

## Scope and policy

Accounts for an already processed Paystack test refund; it does not initiate a provider refund. The user explicitly selected: insufficient wallet funds must block the adjustment and require manual review. Production was not accessed or changed.

The backend now separates trusted verification, a maker's proposal, an independent checker's approval, and an immutable adjustment journal. The customer deposit remains successful; a separate successful `refund` outflow records the adjustment. The original amount and provider receipt remain intact.

Both operators require executive authorization, verified email, an active/unfrozen profile, recent TOTP MFA and transaction PIN. Neither may be the affected wallet owner, and the checker must differ from the maker. The maker's authorization is checked again at approval. Private tables have RLS and no direct client or service-role table grants. Only the service role can attest a provider result; ordinary callers cannot invent their own amount or verification timestamp.

Verification comes from the staging worker's signed one-use `verify_refund_for_accounting` action: GET Paystack refund, require processed/test/NGN with valid identity and integer amount, then call the dedicated service-only attestation RPC. The old `verify_refund` action remains read-only. Database attestation binds to a successful, matching test deposit. Verification and requests expire after 24 hours.

Approval locks participants, the original charge, the request and the wallet. Each provider refund can create only one request and one journal entry. Partial refunds share a cumulative cap equal to the original charge. The journal pairs an equal debit to customer liability and credit to refund clearing. Wallet changes, adjustment transaction, journal and approval audit commit together. This bounded journal is not a complete merchant general ledger or bank settlement reconciliation.

Insufficient funds, inactive/frozen wallet, expired verification, revoked maker, ledger mismatch or an exceeded charge cap produce manual review without a wallet mutation. Such requests cannot automatically retry when funds later arrive. The controlled manual-review resolution process is still to be implemented; do not bypass it with direct edits.

## Actual checks

- New `test_refund_accounting.mjs`: 15 passed, 0 failed.
- Existing 19 regression suites: 396 passing groups after reruns of the two schema-count checks below.
- Native PostgreSQL 18.6: 21 passed, 0 failed, including 16 simultaneous approvals, competing partial refunds and refund-versus-transfer races.
- All 20 migrations applied in isolated PGlite and native PostgreSQL.
- `git diff --check`: passed.

The first broad run found two outdated expectations (19 migrations and 10 private tables). The new schema has 20 migrations and 14 private tables. Updated those explicit expectations and reran both suites: migration/security 55/55, phase-one security 32/32. No financial failure was dismissed. The new handler test initially replaced the wrong mock binding; it was corrected to exercise the real SQL attestation instead, then reconciliation passed 36/36.

Native concurrency evidence directory: `work/native-postgres/midepay-isolated-pg-dbCtQg` in the Codex workspace. Broad-suite logs are in workspace `outputs/provider-cases/tests`; the initial summary there retains the initial count-expectation failures. The successful targeted reruns are reported here rather than silently rewriting that history.

## Staging state

- Applied migration `20261120142304_verified_refund_accounting.sql`; local filename matches hosted migration history.
- `reconcile-payments` version 6 active, retaining its own signed authorization and staging/test-only guard.
- pg_net request 2766 returned HTTP 200: refund `19221040`, payment receipt `6774684861`, NGN 100, processed, test domain.
- Saved verification ID `a906458d-cf11-47db-b5a6-1a09b89d11bb` with provider API provenance and server timestamp.
- Accounting enabled: **false**. Verification rows: **1**. Adjustment requests: **0**. Journal entries: **0**.
- Customer balance and ledger balance: **NGN 200**, unchanged.

Security advisors were reviewed before/after. New private tables have intentional deny-all RLS with no policies and no direct grants ([RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Authenticated definer RPC warnings are addressed by the tested actor gates ([definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)). Existing waitlist anonymous-definer and leaked-password-protection warnings remain; this is not a clean security certification.

## Release boundary and next work

NOT production ready. Keep accounting disabled until the operator review UI and two distinct staging executive accounts with working email and MFA have completed the approval journey. The current real refund has not been debited from the wallet. Fresh verification will be required again if it expires before that test.

Still required: auditable manual-review resolution/cancellation/reverification, operator queues/alerts, refund initiation and ambiguous provider-response handling, chargeback accounting, complete settlement/merchant ledger reconciliation and remaining security/operational release checks. No frontend deployment was made in this increment.
