# Refund manual-review cancellation

Local feature branch increment, 2026-11-23. Not deployed to staging or production.

An active executive who originally requested an adjustment may close a pending or manual-review request with a 5–500 character reason, fresh TOTP MFA and transaction PIN. Another executive, the wallet owner, anonymous callers and direct service-role callers cannot use this API to cancel. The UI offers the action only on the maker's pending/manual-review requests, including when accounting is disabled.

Cancellation never changes wallets, transactions or the immutable financial journal. It preserves the original review code and appends an audit entry containing the actor, reason and old/new status. Repeated cancellation returns a duplicate result without a second audit entry. Applied adjustments cannot be cancelled. A cancelled provider refund remains reserved by the original unique request: depositing money or replaying a proposal cannot reopen it.

The cancellation RPC follows the same profile/charge/request lock order as approval. A native concurrency regression races both actions and requires one terminal outcome and at most one financial journal entry.

Local refund accounting suite: 19 passed, 0 failed. Syntax and diff checks passed. Migration and native concurrency runs are recorded in the accompanying task result. New migration adds one allowed request state and one authenticated RPC, with direct private-table privileges unchanged.

Remaining manual-review work: independently approved reopening/reverification, recovery/deficit decisions and operational queues. This cancellation feature does not resolve a customer's refunded-payment liability or mark provider reconciliation complete. Actual browser cancellation and two-operator staging approval still require acceptance testing. Accounting remains disabled in staging.
