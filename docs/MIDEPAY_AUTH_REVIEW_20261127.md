# Authentication review and logout repair — 27 November 2026

Staging only. Production Supabase was not accessed or changed. Monitoring token setup remains pending separately at the owner's request. No real email/code/password/PIN was submitted during this review, and the existing signed-in browser account was not logged out.

## Verified defect

The main logout handler deleted `sb-*` browser storage before calling the SDK's asynchronous sign-out method. The installed Auth client loads its session from that storage to obtain the bearer token for `/logout`. Removing it first could make the SDK complete a local no-session sign-out without issuing server revocation. The app also discarded returned Auth errors and always displayed a success toast. Direct button listeners plus delegated click handling could call logout twice.

## Repair

`MidePayDB.signOut()` checks for an existing Auth session, explicitly attempts global sign-out while the token is still available, and reports `sessionsRevoked` independently from local-storage cleanup. Missing sessions and returned/thrown errors cannot claim server revocation. When global sign-out cannot be confirmed, local-scope SDK cleanup is attempted and browser tokens are cleared. Upstream error details are not logged or shown by this path.

The main handler awaits the service result before removing SDK storage, blocks overlapping logout calls, temporarily disables logout controls and reports failed server revocation or failed storage cleanup honestly. User/wallet/history state is cleared on completion. The scope remains global as before; this change does not silently change logout into current-device-only behavior.

## Actual verification

- **10/10 selected local suites passed**: logout security, password recovery, OTP handlers, runtime flows, security penetration fixtures, wallet-session validation, browser SDK, dashboard loading, staging packaging and the static validator.
- **10 new logout groups passed**, including the actual installed Supabase SDK with a synthetic stored JWT and mocked HTTP. The test verifies that the real SDK sends `/logout?scope=global` with the original bearer token before storage removal. Other cases cover returned errors, exceptions, no-session no-op, local cleanup failure, duplicate click handling and accurate UI warnings.
- Existing recovery tests: **19 passed**. Existing OTP handler tests: **12 passed**. Provider calls in these tests are synthetic; these are not hosted mailbox acceptance results.
- Evidence: Codex workspace `work/auth-review-20261127/results.json` and per-suite logs. The logout suite was rerun after adding the application-marker cleanup failure case and passed all 10 groups.
- Browser: the existing authenticated staging wallet displayed NGN 5,000.00. The isolated recovery page opened with no persistent Auth session; an empty email submission remained invalid and focused the required email field. No verification email was requested. The temporary recovery tab was closed.
- Sanitized Vercel preview **dpl_6E7LK92CgxV1stBwPnBSq2ap2wPb** reached READY with target null (preview), then only `midepay-staging-ola-f90f.vercel.app` was assigned to it. Unique URL: `midepay-2rs9x6lju-ola-f90f.vercel.app`. After a browser refresh the existing test balance/activity loaded and Statement/Log out controls were enabled. Logout was not clicked against the owner's account.
- The first deployment request was rejected because the API does not accept literal `target: preview`; after checking the current API documentation, the target was omitted to request a preview. No production deployment or promotion was made.

Code commit: `6c7de0c`, on `fix-v46-migration-repair`.

## Remaining acceptance work

Perform fresh signup, email delivery/resend/expiry, wrong-password handling, successful recovery, old-password rejection and multi-device session revocation with a designated staging account and the owner's private interaction. Password entry/change and real OTP/PIN handling remain with the owner. No claim of a successful hosted password reset or global sign-out is made by this increment.

The SDK's success/error classification is still relied on; its handling of some 401/403/404 responses may classify an already-missing session as signed out. Global sign-out does not invalidate every unexpired JWT cryptographically; the application's active-session database guards remain important. Concurrent account switches, cross-tab UI synchronization, network delays and pending asynchronous dashboard reads need further hosted exercises. Passing the static validator is not production approval.

See [Supabase sign-out scopes and limitations](https://supabase.com/docs/reference/javascript/auth-signout). Production email/domain, independent approvals, provider/payment recovery, operational monitoring delivery and the other release blockers remain open.
