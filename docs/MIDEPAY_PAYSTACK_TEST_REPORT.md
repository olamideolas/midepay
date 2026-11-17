# Paystack staging integration — 17 November 2026

**Decision: test-checkout code is deployed; an actual Paystack sandbox payment is still pending user configuration. Not production-ready.**

Stable staging URL: https://midepay-staging-ola-f90f.vercel.app

This alias was created and verified to point to Preview deployment `dpl_9ErkAAYEces2rqA7LEFfuFbKziwD` (`midepay-d6gn0zrn0-ola-f90f.vercel.app`). It does not point to Production. The alias provides a stable address for future staging updates. No production Supabase access or deployment occurred; no database migration was added or applied.

## Changes

- Fixed the frontend integration gap: the app previously defaulted to an unavailable direct wallet credit while Paystack was a disabled roadmap option. The generated staging artifact now enables an explicit `TEST_PAYSTACK_CHECKOUT` flag only for `ajbhsmcosxgymrtawlmd`. Its funding UI selects Paystack test checkout, labels it as test mode, and disables direct top-up and Flutterwave. Other financial mutations stay quarantined (`FINANCIAL_RPCS_LIVE=false`). Browser flag changes cannot enable a server-side live checkout: the staging handler independently requires a Paystack test secret.
- The browser requires the checkout response to declare test mode and validates the HTTPS Paystack checkout hostname before redirecting. It rejects fractional-kobo and coerced money inputs.
- `init-payment` validates Paystack's returned checkout URL and matching payment reference, and returns an explicit test/live mode. Existing staging credentials, email proof, freeze checks, callback allowlist and minimum/maximum amounts still apply.
- `payment-webhook` requires test-mode events and a test secret on the exact staging project. It rejects noninteger kobo, verifies HMAC before any settlement, and delegates the atomic ledger mutation to the existing service-only SQL RPC.
- Preserved the original SQL migrations and the general financial quarantine. No direct minting, transfer, card funding, payroll or payout feature was enabled by this change.

Local feature-branch implementation commit: `520331f15b6ac3ecdf2466716c9085599c30a342`. The Preview uses a sanitized staging artifact generated from that commit, not the unsanitized raw Git checkout. Git push was not attempted in this round; earlier credential-helper problems remain unresolved.

## Actual verification

**15 suites passed, 293 PASS groups, zero failing suites.** Detailed exits and logs are in `test-results.json` and adjacent logs. The final client-only precision regression was rerun and its saved result was updated after the wider suite completed.

New pipeline tests execute the actual checkout handler, webhook handler and all twelve migrations in an isolated PGlite database. Only Auth identity and external Paystack HTTP calls are simulated. These checks establish:

1. Checkout creates a pending deposit without crediting the wallet.
2. The checkout response identifies test mode.
3. A signed matching NGN event credits exactly the expected amount.
4. Three exact signed-event replays do not credit again; only one settlement audit record is written.
5. Forged signatures, unknown references, underpayments and foreign currencies do not credit the wallet.
6. One gateway receipt cannot fund a second pending reference.
7. Staging rejects signed live-domain events and fractional kobo.
8. Checkout rejects an untrusted provider redirect and a mismatched reference.

The nine new client checks additionally cover the staging-only flag, preserved financial quarantine, blocked Flutterwave/direct credits, untrusted redirects, wrong checkout modes, money precision and test-only UI selection.

Hosted checks: `init-payment` is ACTIVE version 6 with JWT verification enabled; `payment-webhook` is ACTIVE version 4 with its own HMAC authentication. A forged-signature POST to the deployed webhook returned HTTP 401. The stable alias configuration and app JavaScript returned HTTP 200; configuration targets staging, enables test checkout and keeps other financial actions disabled. No production database reference was present in those deployed assets.

Before hosted testing, the user's staging wallet was independently checked at balance `0.00`, ledger balance `0.00`, and zero deposit transactions. No hosted deposit was created, no real or test provider payment was initiated by the agent, and no user wallet was credited during this round. The isolated fixture balances do not represent hosted or provider money.

## Required configuration and real sandbox test

The user supplied a screenshot with the Paystack test secret visible. The key is deliberately not reproduced here, stored in the source, or used to initiate a request. The user must regenerate the test secret in Paystack and update staging `PAYSTACK_SECRET_KEY`. No live credentials should be configured for this test.

The screenshot showed an empty Test Webhook URL. Save this exact URL in Paystack TEST-mode settings:

```text
https://ajbhsmcosxgymrtawlmd.supabase.co/functions/v1/payment-webhook
```

Add the stable preview origin in staging `ALLOWED_ORIGINS`, preserving the two previous previews:

```text
https://midepay-4as10yyqw-ola-f90f.vercel.app,https://midepay-c249dluhg-ola-f90f.vercel.app,https://midepay-staging-ola-f90f.vercel.app
```

Once those settings are saved, verify the stable origin preflight, have the user sign in, open Add Money and choose a small Paystack TEST checkout (for example NGN 1,000). Use provider test payment details only. Then inspect the hosted pending/successful transaction, wallet/ledger delta, reference and settlement audit; have Paystack resend the same test event and verify no second credit. This actual provider journey and hosted replay have not yet passed.

Remaining launch blockers include native simultaneous-session PostgreSQL tests, durable payout dispatch/reconciliation, failover handling and incomplete product integrations. Successful isolated settlement tests and a test checkout UI do not establish production readiness.
