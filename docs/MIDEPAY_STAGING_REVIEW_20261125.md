# MidePay staging review — 25 November 2026

**Verdict: suitable for continued controlled staging evaluation; not approved for real-money launch.**

Reviewed source: `b6da81c`, branch `fix-v46-migration-repair`. Staging frontend: https://midepay-staging-ola-f90f.vercel.app/. Deployment: `dpl_5epvf9hqjujSuHUk4CacWC1b54xe`. Database: staging project `ajbhsmcosxgymrtawlmd` only. Production was not accessed, changed or deployed.

## Actual results

- **27/27 local regression suites passed** on the current source. Coverage includes migration compatibility, database authorization, webhook verification, payment boundaries/reconciliation, account recovery, operator authorization, refund accounting, statement totals, service-worker updates, controlled payout client, wallet identity guards and the new display/loading/export regressions.
- The first run was 26/27: `test_independent_webhook.mjs` could not create its temporary fixture because the checkout lacked write permission. After filesystem access was granted, that suite passed on rerun. The original attempt and rerun evidence were preserved; this was not hidden or counted as a product success on its failed attempt.
- Results are recorded in `MIDEPAY_REGRESSION_RESULTS_20261125.json`. Full logs: Codex workspace `work/release-check-20261125/`, including `first-attempt-results.json` and the webhook `.rerun.log`.
- These tests use synthetic accounts and provider mocks where applicable. Static scripts with production-readiness banners do not constitute launch approval. Native PostgreSQL concurrency was not rerun in this review; the previously documented 22-group isolated run remains historical evidence.

## Browser evidence and limitations

- Signed-in dashboard displayed the recorded NGN 5,000 balance and matching Paystack test deposit. Refresh showed Loading before the recorded balance/activity returned.
- Prior signed-in receipt/statement review on this date confirmed matching amount, reference and date. Statement successful inflow was NGN 5,000, outflow NGN 0 and fees NGN 0 for the loaded history. No new payment was submitted.
- Payment Review displayed a recent-authenticator requirement and withheld operation records until verification. No code was requested or entered by the agent, and no approval or refund was executed.
- Signup, login and recovery pages were rendered and checked at mobile width in the preceding UI pass. This review did not create a new hosted account, send recovery mail, reset a password or complete MFA. Those hosted round trips remain unproven by this run.
- No new Paystack payout, provider settlement, browser network-failure injection, physical-device test, screen-reader audit or complete browser download/print exercise was performed.

## Current staging safety snapshot

Read-only staging query confirmed **27 recorded migrations**, **zero public tables with RLS disabled**, and **payout_dispatch_enabled=false**. RLS enabled is not proof that every policy is correct. The server environment payout flag was not re-read in this snapshot; the database dispatch gate is the verified off switch. Do not infer both switches are off from this report.

Security advisor results remain:

| Notice | Level | Findings | Assessment |
|---|---|---:|---|
| RLS enabled with no policy | INFO | 15 | Private service-only tables can intentionally deny client access; do not add blanket policies. |
| Anonymous privileged function executable | WARN | 1 | Review the intended waitlist endpoint and abuse protection; retain only justified access. |
| Authenticated privileged functions executable | WARN | 37 | Review each callable function's ownership, role, input and session checks; legitimate RPC access must not be blindly revoked. |
| Leaked-password protection disabled | WARN | 1 | Enable an appropriate compromised-password control before launch and verify its operation. |

References: [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous privileged functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated privileged functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Remaining launch blockers, in order

1. **Keep bank payouts disabled.** The owner skipped the controlled hosted payout. Provider transfer permission, one-debit settlement, webhook replay, ambiguous outcomes and failure/reversal recovery still need a completed hosted TEST round trip. Prior deposit success does not prove payout readiness.
2. **Finish authorization and session review.** Active-session checks are not yet comprehensive across every sensitive mutation and direct read. Overlapping dashboard refreshes and session/account switching need adversarial coverage. Review all privileged function grants and the disabled leaked-password control.
3. **Complete hosted account/security exercises.** Fresh-account email verification, recovery, sign-out/revocation, abuse limits and recent-MFA operator flows need controlled end-to-end evidence. Staging Gmail delivery is not production email assurance; sender domain and transactional email configuration remain unfinished.
4. **Independent approval and refund operations.** Only one executive account was selected. Keep treasury/refund adjustments off until a separately authorized approver and the full approval/failure/cancellation process are proven. Insufficient refund funds require manual review, as selected by the owner.
5. **Provider and compliance arrangements.** Real identity verification, bank account provisioning, safeguarding/licensing/partner approvals, actual fees and support policies remain external prerequisites. Cards, bills and payroll remain previews until integrated and verified.
6. **Operations and accounting.** Perform backup restoration, alerting/monitoring, incident and reconciliation exercises, realistic failure/load tests and provider fee/refund/chargeback accounting review. Existing tests do not certify a complete general ledger.
7. **Finish product QA.** Review legacy secondary-screen wording, explicit terms/privacy consent, accessible keyboard/tab behavior, mobile devices and screen readers; complete download/print verification. Prototype promises must not appear as live capabilities.

No production promotion is authorized by a green local test result. The next safe work is authorization/session coverage and controlled staging QA while provider features remain disabled.
