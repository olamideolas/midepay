# Active operator session gate — staging deployment

## Verified problem and fix

The local probe reproduced authorization of Payment Review after the synthetic Auth session was deleted. That probe supplied the same already-verified claim context before/after deletion; it did not forge a live JWT or use a real account.

New migration `20261123193538_active_operator_sessions.sql` adds a private, non-client-callable session predicate. It requires an authenticated user, a UUID `session_id` in the request claims, and a matching `auth.sessions` row owned by that user whose `not_after` is null or in the future. Missing or malformed session claims fail closed. No direct session-table privileges are granted to clients.

The existing Payment Review function is moved to a private helper, with all client execution revoked. The public function first checks the active session, then runs the original executive role, verified email, freeze, recent TOTP MFA, input validation and paging checks. Provider review and the refund queue inherit this guard through their existing Payment Review gate. The UI explains SESSION_REQUIRED as requiring a new sign-in.

## Validation

- Operator review: 14 passing groups, including deleted/expired/missing/malformed/wrong-owner session rejection, valid-session acceptance and private-helper access denial.
- Provider case review: 24 passing groups.
- Refund accounting: 19 passing groups.
- Migration/security: full 23-migration chain checked in the local PostgreSQL-compatible suite; 55 passing groups (112 targeted groups in total).
- JavaScript syntax and diff checks passed.

Fixtures now create explicit synthetic Auth session rows and pass their session IDs. They do not weaken production authorization or silently substitute a user ID in the actual session predicate.

## Scope and remaining blockers

Deployed to staging on 23 November 2026 as migration 20261123193538. No real session, credential, wallet or balance was modified. This migration does not add active-session enforcement to wallet mutations, treasury/refund actions, Edge Functions, all direct RLS reads, or ordinary account endpoints. Those paths remain separate work and the whole application is not yet protected from replay of a still-valid access token after sign-out. A hosted two-session recovery/revocation exercise remains required.

Supabase documents the relationship between the JWT session_id and auth.sessions: https://supabase.com/docs/guides/auth/sessions . This gate checks row existence and not_after; it does not implement additional inactivity or single-session policy beyond what Auth has recorded there.

## Staging verification — 23 November 2026

- Hosted migration history and private helper ACLs verified; neither helper is client-callable.
- Hosted call without a session returns SESSION_REQUIRED. Authenticated callers can execute the public gate; anonymous callers cannot.
- Refund adjustments remain disabled. No real session, wallet or balance was changed by these checks.
- Feature commit fec5a887bd465999ee4e00a8c89199383f756fa0 passed GitHub Actions run 45250176361.
- Matching UI preview deployment dpl_CiQ1M485ZSKXcZEBNT15iq2Skdfj reached READY and was assigned the stable staging alias.
- Security advisors still flag callable SECURITY DEFINER endpoints and disabled leaked-password protection. Private helpers added here are not exposed. Advisor output is not a clean security certification.
- Removed a stray trailing aX from the local SQL file before aligning its filename with the hosted version; the hosted migration was already valid.