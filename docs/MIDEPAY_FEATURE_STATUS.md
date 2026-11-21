# Feature status and work order — 2026-11-21

This is a source-based inventory combined with explicitly observed staging journeys. It is not a new full security certification or proof that every browser action works. Production Supabase remains outside the scope of this work.

| Feature | Evidence / current state | Next required work |
|---|---|---|
| Signup, email verification, PIN | Owner completed the executive signup journey after SMTP repair; database email proof and PIN presence checked | Test another recipient, resend, expiry and email-change journeys; transactional mail before launch |
| Executive access and MFA | Owner role provisioned with audit entry; TOTP verified; payment and refund review displayed in browser | Second independent operator; account recovery and revocation journey |
| Paystack test deposit | Processed NGN 100 payments observed; owner confirmed credit and no duplicate; webhook and recovery regression coverage | Decline, abandonment, delayed callback and webhook loss browser journeys |
| Refund review | Refund 19221040 verified against Paystack, matched and displayed; adjustments disabled | Independent approval; operator manual-review resolution; fresh verification after expiry |
| Refund accounting | Local SQL and native concurrency tests passed; staging backend disabled | Two-operator browser journey before enabling; complete merchant accounting |
| P2P and external transfers | Client financial quarantine blocks execution; local money-safety tests exist | Approved staging enablement, provider test payouts and ambiguous outcomes |
| Cards | Card issuance/funding quarantined; preview UI | Actual issuer integration, lifecycle, authorization and reconciliation |
| Bills and payroll | Client methods quarantined | Provider integration and end-to-end settlement/rollback tests |
| Savings | Preview; real interest unavailable | Product rules, accounting, authorization and provider/operational arrangements |
| Bank account numbers / identity | Database test wallet identity is not provider-issued identity or BVN/NIN verification | Real provider provisioning and identity verification; verify every displayed claim |
| Statements | Unsupported verification claims removed; fallback account number removed | Compare exported totals/fees/refunds against actual ledger; browser export review |
| Executive summaries | Fabricated offsets removed; labels explicitly describe loaded records | Protected aggregate RPCs and paging; distinguish empty, partial and failed data loads |
| Monitoring / launch | No complete release evidence | Restore exercise, alerts, reconciliation operations, provider/legal readiness and final independent audit |

## Work order

1. Complete dashboard loading/error and session-expiry browser checks. Current runtime checks do not simulate all failed database responses or concurrent refresh races.
2. Review statements and exports using synthetic deposits, transfers, fees and refund adjustments. Verify user-visible totals and avoid counting internal transfer legs as external payment volume.
3. Complete customer mobile layout and disabled-feature messaging; remove unsupported dates and claims. Two unapproved November 30 checkout launch tooltips were removed in this inventory increment.
4. Resolve refund manual-review lifecycle and add queue paging. Keep adjustment enabled=false until a second real executive completes approval tests.
5. Run test-mode payout/refund/dispute journeys, then reconcile merchant journal, provider reports and bank settlement evidence.
6. Finish operational and security release gates. Passing CI is necessary but does not authorize production use.

## Known interface limitations requiring follow-up

Executive record loading still uses direct protected database reads and a latest-50 transaction page. It is not a network-wide analytics report. Some failure states, browser rendering, account/session changes and concurrent refresh behavior remain to be exercised. The current frontend checks must not be described as a complete browser acceptance test.

Staging SMTP now delivered enough email for the owner signup, but Gmail is not a completed transactional-email launch setup. The account password, SMTP app password, PIN, MFA QR and codes must remain outside reports and commits.
