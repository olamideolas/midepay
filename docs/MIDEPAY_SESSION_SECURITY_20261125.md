# Session and authorization hardening — 25 November 2026

**Status: deployed to staging only; real-money launch remains blocked.** This report supersedes the session-coverage snapshot in the earlier staging review. Production Supabase was neither accessed nor changed. The existing feature branch remains `fix-v46-migration-repair`.

## Verified problem and repairs

An unexpired JWT could outlive its server session. Several financial and administrative entrypoints checked identity, role, email and PIN without checking that the session still existed. Direct table policies also accepted the identity claim without a session-existence restriction.

The implementation follows the documented [Supabase session model](https://supabase.com/docs/guides/auth/sessions): correlate the JWT session_id with auth.sessions and the authenticated user. The existing helper also rejects a missing/malformed session ID, mismatched owner and an expired not_after timestamp.

Applied migrations:

- `20261125160748_sensitive_session_guards.sql`: session gates in the shared financial and treasury checks, PIN setup/verification and verified-login recording; 18 restrictive public-table policies. Restrictive policies intersect existing ownership rules rather than grant new access. Private original implementations have no anonymous/authenticated execution rights.
- `20261125212643_authenticated_rpc_session_guards.sql`: guards 13 additional record/administrative entrypoints, including recipient lookup, beneficiary/card mutations, provisioning, payment-request response, treasury/review queues and ledger reconciliation. Existing default arguments and result shapes are retained. Table-returning lookup returns no rows when the session is absent; composite mutations raise SESSION_REQUIRED; JSON endpoints return a structured rejection.

Existing service-role execution rights were preserved only where they already existed. The service exception checks the actual selected database role, not a user-supplied role claim. Original business checks still run. Anonymous waitlist intake, service settlement APIs and boolean membership helpers were not converted into these wrappers.

## Actual test results

| Check | Result |
|---|---|
| Full local suite set on the 29-migration chain | 28/28 suites passed after fixture corrections and rerun |
| Session-specific suite | 15 groups passed |
| Native PostgreSQL 18.6 concurrent financial checks | 22/22 groups passed; disposable database stopped |
| Existing proof/treasury suite | 32 groups passed |
| Existing refund accounting suite | 19 groups passed |
| Staging catalog | 29 migrations; 18 restrictive session policies; 13 private RPC cores inaccessible to clients |
| Staging no-session role test | Zero visible wallets/recipients; login/provisioning/treasury return SESSION_REQUIRED |
| Current signed-in browser | Dashboard refresh returned NGN 5,000 and the original deposit; statement control re-enabled after loading |
| Payout dispatch | Database switch remains false |

Session regressions cover missing, malformed, unknown, cross-user, expired and revoked sessions; PIN/setup/login/P2P/refund rejections; recipient and composite RPC paths; cross-user RLS; private-function bypass attempts; service reconciliation continuity; and forged service-role claims from an authenticated caller.

Older synthetic login fixtures lacked session rows/claims; they were upgraded to model Supabase sessions. Older ledger assertions invoked a now-session-protected user endpoint as an unauthenticated schema owner; those assertions now use the intended service role. They still check the same balanced ledger and conservation outcomes. Missing-session rejection cases use a separate fixture with independently generated session IDs and were not replaced with automatic valid sessions.

The initial final native run reached the refund/transfer race but failed at its unauthenticated ledger assertion. After that fixture correction, a fresh native run passed all 22 groups. The database was stopped in both runs. This history is retained rather than presenting the first attempt as green.

Evidence: Codex workspace `work/session-hardening-20261125/` (results and rerun logs), `work/native-security-final.log` (failed fixture assertion), `work/native-security-final-rerun.log` and exit code 0; final native directory `work/native-postgres/midepay-isolated-pg-mIjtbl`. Machine-readable local suite results are committed as `MIDEPAY_SESSION_REGRESSION_RESULTS_20261125.json`. Local provider tests remain mocked where applicable.

## Remaining limits and launch blockers

- This is a session-existence check at database statement/transaction visibility. It does not cancel an already-authorized request, eliminate revocation races across separate Edge/service calls, or enforce every possible configured inactivity-timeout policy. Hosted sign-out/recovery/device and account-switch exercises still need completion.
- Future tables and endpoints need explicit policy/guard review. Existing caller-specific ownership, role, MFA and input rules remain necessary. Privileged-function advisories must not be dismissed simply because a session gate exists.
- Post-change security advisor: 14 informational no-policy findings, 1 anonymous privileged-function warning, 37 authenticated privileged-function warnings and 1 disabled leaked-password-protection warning. Private service-only tables can intentionally have no client policies. These notices are not a clean security bill of health. [Privileged-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- The controlled hosted payout was skipped by the owner and remains unverified. Payout dispatch stays disabled. No new payment or refund was submitted during this work.
- Production sender domain/email, compromised-password controls and abuse/recovery operations remain unfinished. A second independent executive is still absent; refund/treasury adjustments remain off.
- Backups and restore drills, monitoring/alerts, incident procedures, realistic load/failure exercises, full fee/refund/chargeback accounting and accessible physical-device QA remain open.
- Banking/provider approval, safeguarding/licensing arrangements, real identity verification and live bank provisioning remain business/provider prerequisites. Cards, bills and payroll remain previews.

The next safe engineering work is operational recovery/monitoring and the remaining hosted account/session exercises, while real-money features remain off. A green test run is not production approval.
