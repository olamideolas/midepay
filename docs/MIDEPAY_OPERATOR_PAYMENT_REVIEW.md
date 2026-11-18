# MidePay operator payment review — 18 November 2026

Release decision: staging only. Production Supabase was not accessed, changed or deployed. No customer role was promoted, no payout switch was enabled and no money-moving action was added to the screen.

## Operator feature

Payment Review is a new section in the existing executive operations area. It shows Paystack deposits and bank payouts, four totals, filters for attention/pending/all, last checks, attempt counts, scheduled checks, masked destination accounts and older/newer pagination. Uncertain or legacy pending payouts carry a prominent instruction not to resend/refund until provider outcome is confirmed. Empty/error results never substitute demonstration payments.

The financial view is read-only. There are no resend, cancel, refund, settlement or enable-dispatch buttons. Authentication controls let the signed-in account owner enroll/verify an authenticator; those change that user's own Auth factor state, not wallets. No payment PIN is requested to read records.

The old investor KPI cards and unrelated export/sync badge are hidden while this section is open, so the review screen does not present prototype figures as operational totals. The shared executive heading now describes restricted operations accurately. Other prototype admin sections are not claimed fully redesigned by this change.

## Server authorization and data minimization

The new get_operator_payment_review RPC is STABLE and SECURITY DEFINER with a fixed search_path. Only authenticated callers have EXECUTE; anonymous and service-role callers do not. The function then requires a protected database executive role, non-frozen account, current server email proof and recent signed aal2/TOTP AMR claims (within ten minutes; future claims beyond 30 seconds rejected). Browser/user metadata cannot confer executive access.

It reads through a fixed Paystack-only projection and never grants client access to private jobs, outbox or signing tables. Returned fields omit customer names/emails, full destination accounts, provider payloads, lease tokens, signing material and transaction metadata. The intended operator still sees the full provider reference needed to investigate a payment.

Results are capped at 25 records, with a 26th row used only to signal a keyset cursor. Timestamp-plus-ID ordering handles ties. Invalid filters/cursor pairs return no data. Summary totals describe the eligible Paystack scope; the pending count includes payments needing attention.

The interface clears records on access errors, sign-out/account changes, leaving the view, document hiding and MFA expiry. Generation fencing ignores late responses from prior filters/sessions. It builds record content with textContent and DOM elements, not HTML interpolation. Pending MFA factor IDs are retained only in memory when switching to an authenticator app; codes and QR images are cleared. Setup uses a unique factor name and never silently removes another factor.

## Verification

All 17 regression suites passed: 354 PASS groups. The new SQL suite contributes 12 checks covering anonymous/customer rejection, metadata spoofing, missing email proof, MFA expiry/type/future/AMR cases, truthful empty results, attention classification, tied-timestamp pagination, field redaction, malformed filters/cursors, frozen/demoted operators, changed email and unchanged financial/queue state after reads. Existing suite expectations now include 17 migrations. After a small MFA setup UI refinement, syntax/static validation and browser checks were repeated; no new financial backend behavior was introduced by that refinement.

The native PostgreSQL 18.6 harness passed its existing 16 groups with all 17 migrations. This preserves the prior concurrent financial/dispatch checks; it is not a new hosted financial load test.

Real Chrome ran 36 browser checks across desktop/mobile and dark/light, with four screenshots. Checks cover record rendering, untrusted-reference HTML treated as text, no horizontal overflow/script errors, pagination, forbidden access clearing, mocked MFA enrollment/verification including switching to an authenticator app, stale asynchronous results, sign-out and expiry. Browser records/Auth are synthetic and all external networking is blocked. This does not claim successful real-account Supabase MFA enrollment or a hosted authorized-operator journey.

Evidence: Codex workspace outputs/payment-review, with native evidence under work/native-postgres/midepay-isolated-pg-jD6Q3K. The optional browser test uses PLAYWRIGHT_MODULE, CHROME_PATH and UI_TEST_OUTPUT; no browser dependency was added to the production app. The financial-safety workflow includes the new SQL suite, but this source still needs a user push and a fresh CI run.

## Staging and publication

Applied read-only migration: 20261118172733_operator_payment_review.sql. The local CLI-generated filename was aligned to the actual staging version; database migration history was not rewritten. Hosted checks confirm anonymous/service-role EXECUTE false, authenticated EXECUTE true, unauthenticated result FORBIDDEN, payout_dispatch_enabled=false, and existing customer test balance NGN200.00.

The existing security advisor category for authenticated SECURITY DEFINER entry points increases from 29 to 30 because this is an intentionally callable entry point with internal authorization. Its grant alone is not authorization; the SQL rejection tests above exercise the body. Other existing advisor warnings remain, including leaked-password protection. Guidance: https://supabase.com/docs/guides/database/database-linter and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

The sanitized staging artifact includes payment-review.js/css and excludes migrations, reports, credentials and test fixtures. Target preview: https://midepay-staging-ola-f90f.vercel.app . Actual publication/HTTP verification is recorded separately in the workspace outputs/payment-review/DEPLOYMENT.md. Source production configuration was not retargeted. The service-worker cache is versioned for the new assets; payment RPCs use POST and are not cached by the service worker.

## Access and remaining limits

Open Executive operations → Payment Review using an existing authorized executive account, verify its authenticator and choose a filter. A normal wallet account remains blocked. This work does not assign an operator account or promote the current test customer.

Still required before launch: an actual controlled Paystack TEST payout once the provider enables transfers, a real authorized-operator MFA journey, operational notifications/monitoring, documented manual resolution for ambiguous sends, fees/refunds/disputes accounting, broader hosted failure/load tests and provider/identity/legal readiness. This screen does not resolve an uncertain provider outcome and does not make the product production-ready.
