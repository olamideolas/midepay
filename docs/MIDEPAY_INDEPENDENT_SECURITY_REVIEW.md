# MidePay independent code, migration and security review

> Follow-up, 17 November 2026: authentication and treasury remediation is documented in MIDEPAY_PHASE1_AUTH_TREASURY.md. The findings below describe the earlier audit snapshot; local fixes do not constitute deployment approval.


Date: 16 November 2026 (Europe/London)
Repository: `C:\Users\TestAdmin\Downloads\midepay`
Branch: `fix-v46-migration-repair`
Starting HEAD: `2ac49b5` (feature branch, substantial pre-existing uncommitted changes)
Decision: **NOT READY for production financial traffic. Local/staging verification only.**

## Scope and safety boundary

Reviewed the three supplied v4.6 reports as claims to verify, rather than as instructions authorizing deployment. Inspected the working tree and recent Git history, the original ten SQL migrations, final database catalogs, all three Edge Functions, frontend authentication/payment/admin integrations, runtime configuration, build guard, service worker, CSP, and the supplied test implementations. Implemented corrections in the existing branch without resetting, switching branches, committing, or deploying.

No production Supabase queries, writes, CLI linking, migration pushes, Edge Function deployments, or real payment-provider requests were performed. All SQL execution used disposable in-memory PGlite databases. Handler tests substituted provider/SDK transport with test doubles. Production credentials were not needed. The repository's configuration still points to production by default; no application browser was opened against it.

This is a source and isolated-runtime audit, not a certification of production state, regulatory compliance, PCI scope, or real provider settlement. Hosted Auth/PostgREST configuration, real JWT verification, provider credentials, live balances, deployed migrations, secrets rotation, fraud operations and infrastructure cannot be verified from this checkout.

## Independent verification of the claimed 124 tests

All five supplied suites passed when first run, including **55/55** PostgreSQL checks. However, **124 is not the count emitted by the supplied working tree**: its five suites emit 146 PASS groups (30 + 11 + 37 + 13 + 55), versus the report's 26 + 11 + 19 + 13 + 55. The report appears out of sync with the supplied tests. PASS groups are not standardized individual assertions or equivalent levels of assurance.

Important limitations discovered by reading the tests:

- `test_e2e_runtime.js` uses an instrumented DOM and a simulated Auth/RPC server, not a browser connected to Supabase.
- Much of `test_security_penetration.js` uses a JavaScript implementation of the intended database behavior. Passing it does not execute the production SQL or prove RLS safety.
- The static validator mostly checks strings and structure. Its statements about every financial RPC being quarantined do not match the real final grants: internal P2P/savings RPCs are intentionally executable by authenticated users.
- PGlite executes real PostgreSQL SQL, constraints and role changes, but its single database connection serializes submitted transactions. `Promise.all` on that connection does not prove multi-session race safety or deadlock freedom.
- Node's TypeScript syntax parser does not type-check Deno code or resolve Supabase deployment imports.

Independent SQL regressions initially produced **3 passes and 6 failures** against the original ten migrations. The saved baseline log demonstrates that the supplied green suites missed meaningful issues. After the incremental migration, these cases pass.

## Final actual test results

All commands ran under Node v22.23.2. Exit codes below come from child processes, not from PowerShell's final command status.

| Command | PASS groups | Exit | Nature |
|---|---:|---:|---|
| `node scripts/validate_production.js` | 30 | 0 | Static assets, syntax and structural checks |
| `node scripts/test_payment_webhook.js` | 11 | 0 | Handler crypto/dispatch and TS syntax |
| `node scripts/test_e2e_runtime.js` | 37 | 0 | DOM/Auth/RPC simulation |
| `node scripts/test_security_penetration.js` | 13 | 0 | Static checks, webhook handler and simulated security engine |
| `node scripts/test_v46_postgres_migration.mjs` | 55 | 0 | Actual isolated PostgreSQL SQL and role checks |
| `node scripts/test_independent_database.mjs` | 11 | 0 | Additional actual SQL regressions |
| `node scripts/test_independent_webhook.mjs` | 15 | 0 | Actual handler/render functions, mocked transport |
| **Total** | **172** | **all 0** | **Does not establish production readiness** |

An additional run of the 11 independent SQL checks passed with `pgcrypto` and `uuid-ossp` installed in `extensions`, instead of `public`. This is a second configuration run of the same checks, not 11 additional unique tests.

A native PostgreSQL 15 installation was discovered and a new local cluster was attempted at `work/pgdata`, bound only to `127.0.0.1:55486`. Both `initdb.exe` and `pg_ctl.exe` failed before startup with Windows `{Illegal System DLL Relocation}`. No native cluster was started and true multi-session tests remain unexecuted. No existing database server was contacted.

`git diff --check` completed successfully. Deno type/deployment checks, a full Supabase local stack, real browser integration and provider sandbox tests were not run.

## Migration and catalog verification

The original ten migrations applied in filename order without SQL errors in the isolated clean database. The supplied legacy fixtures also passed: initial-schema-to-v4.6 reconciliation and the earlier card/PIN schema upgrade. Their success does not prove compatibility with arbitrary drift or real production data.

| Original migration | Isolated result and review |
|---|---|
| `20260923000000_initial_midepay_schema.sql` | Applied; establishes legacy layouts, permissive writes and synthetic opening funds later superseded by hardening. Never expose a partially migrated database. |
| `20260924000000_send_money_transfer_funds.sql` | Applied; legacy transfer overload and anonymous grant must be superseded by the final migration. |
| `20260927000000_executive_role_and_rls.sql` | Applied; final role/ownership controls inspected through final catalogs. |
| `20260928000000_payment_requests.sql` | Applied; publication handling works in the provided fixture. |
| `20261116000000_midepay_production.sql` | Applied; later reconciliation is required for earlier table definitions. |
| `20261116010000_payment_gateways.sql` | Applied; original settlement checks were insufficiently bound to provider/receipt. Corrected by the new migration. |
| `20261116020000_nuban_and_cards_production.sql` | Applied; extension resolution tested in both schemas; later migration removes synthetic card secrets. |
| `20261116030000_midesave_bills_payroll.sql` | Applied; supplied legacy savings/payroll compatibility fixes passed fixtures. Provider-backed operations remain disabled. |
| `20261116040000_backend_security_hardening.sql` | Applied; supplied payroll-items compatibility fix passed; later migration supersedes security behavior. |
| `20261116050000_auth_verification_gate.sql` | Applied; baseline catalog/grant/PIN/ledger tests passed, but independent tests exposed additional defects below. |

Added **`20261116060000_independent_review_hardening.sql`**, preserving the original ten migration files. The clean eleven-migration chain and final grant checks pass. `supabase/schema.sql` now includes the new migration using `\ir`; this master file requires psql preprocessing and cannot be pasted unchanged into the Supabase SQL editor.

The saved final catalog contains:

- 18 public tables, all with RLS enabled; 230 column entries.
- 17 SELECT policies; zero client write policies.
- 46 non-extension application functions; no duplicate application names in the supplied checks; all SECURITY DEFINER functions have an explicit search path.
- 254 catalog constraint entries, including PostgreSQL-generated constraints; 7 public trigger-event rows. Trigger-event rows are not a count of distinct trigger objects.
- Anonymous application execution limited to `join_waitlist`; client execution denied on settlement and disabled provider functions.
- Real role tests deny PIN-hash/CVV reads and direct wallet/sub-account writes. The independent RLS test filters another user's wallet. These checks do not constitute an exhaustive row-by-row authorization matrix for every business role.

No remaining clean-chain SQL syntax error was observed. **Data-dependent migration blockers remain possible:** the new receipt and payment-request unique indexes reject existing duplicates, and finite-value constraints reject existing NaN values. Such data must be identified and reconciled in staging before promotion. Do not delete or silently rewrite financial history to make a migration pass.

Earlier migrations have already been edited in the supplied working tree. Supabase will not automatically rerun an already-recorded historical migration. The new follow-up repairs the reviewed v4.6 function definitions, but does not establish the actual migration-history state of an unknown deployed database.

## Verified defects and corrections

### F01 — High: deposit settlement did not bind the stored provider

`settle_gateway_deposit` could settle a Paystack-intended pending deposit as Flutterwave. The real SQL regression reproduced the acceptance. The follow-up requires an inflow deposit with the expected stored provider, a nonempty receipt and a finite gateway amount. Provider mismatch is rejected before crediting.

### F02 — High: one gateway receipt could fund multiple local references

Two separate pending deposit references could settle with the same gateway receipt. Added a unique `(gateway_provider, gateway_reference)` index for successful deposit rows. A second credit fails atomically; exact replay of the original reference remains idempotent.

### F03 — High: payout PIN lockout used an unsafe Edge read/modify/write counter

Concurrent wrong guesses could overwrite the same strike count, and a successful guess could clear a concurrently established lockout. Removed Edge bcrypt/counter mutation. The real payout handler now calls `verify_user_transaction_pin` as the authenticated user, so the existing PostgreSQL row lock and persistent strike engine own verification. The handler no longer fetches PIN hashes. Handler regressions prove SQL delegation and no Edge counter writes.

### F04 — High: ambiguous gateway failure automatically refunded a potentially paid transfer

A provider may accept a payout even if the caller receives a timeout or malformed response. The old catch-all reversed the debit regardless. The handler now retains a pending debit and returns HTTP 202 with `reconciliation_required`; it does not claim a refund. This prevents an immediate free-payout path, but requires a reconciliation worker before enabling payouts.

### F05 — High: bank payout requests lacked stable operation idempotency

The handler generated a new reference on each request; the SQL helper's repeated reference failed with a unique-key error instead of returning the prior result. Added a required UUID v4 request key, a user-scoped deterministic reference, an advisory lock, and SQL replay/payload comparison. Duplicate handlers do not dispatch a second gateway request. The frontend helper now accepts and forwards the caller's stable key. Persistent recovery after a process crash still needs an outbox/reconciliation worker.

### F06 — High: payout limits were enforced only at the Edge

The service debit helper accepted amounts above the configured user tier, and did not enforce cumulative daily transfer limits. Added profile verification/freeze checks and configured single/daily limits in SQL; daily totals are checked under the wallet lock. The Edge tier-2 number now agrees with the P2P SQL value. These are application limits, not a regulatory certification.

### F07 — High: payout finalization/reversal did not bind the provider; settled reversal was unsupported

Finalization/reversal now require the transaction's provider to match the event family supplied by the authenticated webhook handler. A verified reversal can refund a previously successful payout exactly once, as well as a pending payout. Wrong-provider events fail, and a stale failure event cannot refund an already successful payout. Server-only grants remain intact.

### F08 — High: webhook verification could accept incomplete verification responses

Flutterwave verification previously skipped reference/amount comparison when those fields were absent. Missing verified transaction reference/amount or missing transfer reference now fails closed. Paystack deposits require `currency: NGN`. Verified Flutterwave *failure* handling is deliberately quarantined with HTTP 503 rather than trusting the shared webhook hash to refund money; independent failed-transfer verification/reconciliation is still required.

### F09 — Medium: PostgreSQL NaN passed nonnegative balance checks

SQL numeric NaN is different from JavaScript NaN. The real SQL test demonstrated that a wallet could store NaN despite a nonnegative check. Added finite-value checks to wallet balances and transaction principal/fees. The regression now rejects the update. Additional numeric metadata and historical-data validation remain part of staging review.

### F10 — Medium: financial classification and idempotency fields were mutable

The ledger trigger protected principal and ownership but allowed category, counterparty identity, creation time and idempotency identity/hash changes. Those can affect reconciliation, limits and payment proof. The follow-up makes these fields immutable with null-safe comparisons. Category mutation now fails in real SQL. Status/webhook fields remain mutable for server settlement; this is not a fully append-only event ledger.

### F11 — High: unescaped stored data entered the executive DOM

Member names, email/phone/bank fields, transaction fields and waitlist values were interpolated into HTML. Added escaping on the reviewed administrative sinks and toast/waitlist output. A renderer regression injects an HTML payload and verifies escaped output. This proves HTML injection remediation for those sinks, not browser script execution under the current CSP or universal DOM sanitization.

### F12 — High: dynamic config could disclose a server credential

`build.js` had a secret-key gate, but `api/config.js` returned its environment value directly. The endpoint now permits publishable keys or legacy JWTs explicitly carrying the `anon` role, rejects other keys without reflecting them, and disables caching. A service-role JWT disclosure regression passes.

### F13 — Medium: misleading security/recovery and statement behavior

The Antigravity working diff added a password-reset success toast without sending a reset. Replaced it with an explicit unavailable message. The production KYC upgrade simulation now stops before changing the displayed tier. Empty production statements no longer fall back to demo transactions. Statements still need real ledger pagination and correct status-aware totals before being treated as official financial statements.

### F14 — Medium: CSV cells could become formulas

Added quotation/escaping and formula neutralization to text cells in statement and investor exports. Formula-leading characters and line-control prefixes are neutralized. Numeric statement amount/fee columns remain numeric. Added a regression for formula text and embedded quotes.

### F15 — Medium: signup provisioning silently swallowed every exception

The final signup trigger returned success even if profile/wallet provisioning failed. Removed its catch-all exception suppression so signup and provisioning fail atomically. Also explicitly revoked client CREATE privilege on the public schema and added unique fulfillment proof for payment requests.

## Remaining risks and deployment blockers

| Priority | Remaining issue | Required resolution |
|---|---|---|
| High | **OTP attestation is not independent OTP proof.** `record_verified_login_session` stamps `email_otp_verified_at` based on `auth.users.email_confirmed_at`. Any authenticated session can call it. If Auth autoconfirms signup, both gates can be satisfied without email possession. The suspicious-timestamp log is detection, not prevention. | Verify staging Auth confirmation settings and real signup/verify flows. For a mandatory independent OTP policy, design an authenticated server proof tied to the verification event/session. Never infer proof from caller-supplied device metadata. |
| High | **No payout outbox/reconciliation worker.** A crash after debit, timeout after provider acceptance, early webhook, or rejected final response can leave an unresolved pending payout. Flutterwave failures are intentionally quarantined. | Add durable dispatch/recovery state, verified provider status polling, bounded retries, operational alerts and manual review. Keep `BANK_PAYOUTS_ENABLED` unset/false until these pass. |
| High | **Executive treasury credits remain a powerful mint capability.** Self-credit is blocked, but one executive can credit another user without PIN/MFA, dual approval or a verified reserve event. Its idempotency key is still optional and the UI does not provide one. | Define funding/treasury backing and maker-checker controls, enforce step-up authorization and mandatory payload-bound idempotency. Disable this capability for a public launch until reviewed. |
| High | **True concurrent sessions remain untested.** PGlite cannot establish cross-session deadlock/lock-wait behavior. Freeze/readiness checks also deserve overlapping-session tests. | Use a fresh native PostgreSQL or isolated Supabase stack and independent connections for same-key retry, A-to-B/B-to-A, freeze/debit, PIN guessing/rotation, limits and webhook/debit races. The attempted native cluster failed at binary startup. |
| High | **Hosted integration has not been verified.** The checkout contains production defaults and a CSP hardcoded to the production project. | Build a staging-only configuration/CSP, use test provider credentials, and verify GoTrue/PostgREST/Deno behavior without referencing production. |
| Medium | **External-transfer UI is not wired to the working payout path.** The main send flow still calls `recordTransfer`, which invokes the intentionally disabled `execute_external_bank_transfer`. The Edge helper exists separately. | Wire and test the actual provider selection/bank-code/key path, and show pending versus settled state correctly. Do not mark a pending initiation as a successful transfer. |
| Medium | **Payment-request profile embeds conflict with own-profile RLS.** The frontend embeds the other participant's profile, which RLS can filter, resulting in missing names. | Add a narrow participant-scoped projection/RPC returning only approved display fields; do not reopen global profile reads. |
| Medium | **Statements/administrative UI can misrepresent financial state.** Statement source is a limited recent-transaction list and totals do not fully model pending/reversed/failed statuses. Executive controls still contain local balance math and optimistic/demo fallbacks. | Use authoritative server snapshots, pagination and status-aware totals; remove production demo/admin fallbacks and display actual settlement state. |
| Medium | **Provider features remain disabled.** VTU, card issuing/funding and corporate payroll are not live financial integrations. Business writes revoked by hardening have no complete replacement workflow. Generated internal NUBANs are not evidence of provider-issued bank accounts. | Keep unavailable features hidden or explicitly disabled until provider-backed workflows and accounting contracts pass sandbox tests. |
| Medium | **Migration history and historical balances are unknown.** Legacy synthetic credits, card records, duplicated receipt/proof data, savings copies and inconsistent balances require reconciliation on a staging clone. | Validate migration-history records and all constraints on a sanitized staging snapshot. Do not manufacture balancing entries or silently discard history. |
| Medium | **Rate limits/anti-abuse and privilege containment are incomplete.** Waitlist/recipient discovery/login audit and provider enquiry endpoints lack a demonstrated server rate-limit layer. Service-role access remains broad. | Add server quotas/abuse controls, least-privilege operational boundaries and monitoring; exercise all business-role read/write cases. |
| Medium | **Dependency/deployment reproducibility is incomplete.** No committed npm lockfile; Edge imports use a major Supabase version rather than an exact version. | Lock/audit dependency versions, including the bundled browser SDK provenance; run Deno checks and the hosted staging build. The PGlite dev dependency is now declared as 0.5.10, but a lockfile was not fabricated or downloaded during this offline audit. |

No claim is made that all defects were introduced by Antigravity. The supplied checkout mixes a committed starting point with extensive uncommitted edits and new reports. The fake recovery message is visible in that working diff; profile-embedding incompatibility follows from the new restrictive RLS. Other findings are defects present in the submitted state, and authorship cannot be reliably assigned from that state alone.

## Deployment readiness

**Do not enable production financial traffic or promote this branch yet.** The new migration and Edge changes are reviewable local changes, not deployed changes. Keep the existing `FINANCIAL_RPCS_LIVE: false` and the new server payout quarantine in place. The browser flag is a UX control: changing it does not revoke database RPC grants and must never be treated as the security boundary.

Next verification must use an isolated staging project or local Supabase stack: confirm Auth behavior, apply the eleven migrations to clean and sanitized-upgrade states, reconcile existing balances, run independent-session tests, validate all business role matrices, then complete provider sandbox timeout/replay/failure/reversal testing and the frontend flows. Resolve the high-priority blockers before requesting a production deployment decision.

## Changes and evidence

New files in the feature checkout:

- `supabase/migrations/20261116060000_independent_review_hardening.sql`
- `scripts/test_independent_database.mjs`
- `scripts/test_independent_webhook.mjs`
- `docs/MIDEPAY_INDEPENDENT_SECURITY_REVIEW.md`

Existing files updated: the three Edge Functions, `app.js`, `supabaseClient.js`, `api/config.js`, `package.json`, `supabase/schema.sql`, the PostgreSQL suite's expected migration count, and the penetration suite's Paystack fixture (now supplies the required NGN currency). Existing source changes were retained. `package.json` now exposes `test:database` and `test:independent`.

Evidence alongside this report:

- `test-results.json`: final process exits, PASS groups and timings.
- Seven `*.js.log` / `*.mjs.log` files: final stdout/stderr.
- `baseline-independent-database.log`: initial six independently reproduced failures.
- `extensions-schema.log`: alternate extension-schema SQL run.
- `database-catalog.json`: final isolated tables, columns, functions/ACLs, policies, trigger events and constraints.

Run the new checks from the repository using `npm run test:independent`. A local `@electric-sql/pglite` installation or explicit `PGLITE_MODULE_DIR` is required. This machine used the existing PGlite 0.5.10 installation located by the supplied test harness; no production connection or dependency download was required.
