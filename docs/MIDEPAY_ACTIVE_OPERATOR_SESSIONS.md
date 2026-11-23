# Active operator session gate — local implementation

## Verified problem and fix

The local probe reproduced authorization of Payment Review after the synthetic Auth session was deleted. That probe supplied the same already-verified claim context before/after deletion; it did not forge a live JWT or use a real account.

New migration `20261123193055_active_operator_sessions.sql` adds a private, non-client-callable session predicate. It requires an authenticated user, a UUID `session_id` in the request claims, and a matching `auth.sessions` row owned by that user whose `not_after` is null or in the future. Missing or malformed session claims fail closed. No direct session-table privileges are granted to clients.

The existing Payment Review function is moved to a private helper, with all client execution revoked. The public function first checks the active session, then runs the original executive role, verified email, freeze, recent TOTP MFA, input validation and paging checks. Provider review and the refund queue inherit this guard through their existing Payment Review gate. The UI explains SESSION_REQUIRED as requiring a new sign-in.

## Validation

- Operator review: 14 passing groups, including deleted/expired/missing/malformed/wrong-owner session rejection, valid-session acceptance and private-helper access denial.
- Provider case review: 24 passing groups.
- Refund accounting: 19 passing groups.
- Migration/security: full 23-migration chain checked in the local PostgreSQL-compatible suite; final result recorded in the task output.
- JavaScript syntax and diff checks passed.

Fixtures now create explicit synthetic Auth session rows and pass their session IDs. They do not weaken production authorization or silently substitute a user ID in the actual session predicate.

## Scope and remaining blockers

LOCAL ONLY; not deployed to staging. No real session, credential, wallet or balance was modified. This migration does not add active-session enforcement to wallet mutations, treasury/refund actions, Edge Functions, all direct RLS reads, or ordinary account endpoints. Those paths remain separate work and the whole application is not yet protected from replay of a still-valid access token after sign-out. A hosted two-session recovery/revocation exercise remains required.

Supabase documents the relationship between the JWT session_id and auth.sessions: https://supabase.com/docs/guides/auth/sessions . This gate checks row existence and not_after; it does not implement additional inactivity or single-session policy beyond what Auth has recorded there.
