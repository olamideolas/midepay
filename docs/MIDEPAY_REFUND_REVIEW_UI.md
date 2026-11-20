# Refund approval screen — local implementation

Added a refund queue to the executive Payment Review tab. It uses the existing authenticator setup/check flow. Refund amounts come from the protected backend queue. Operators select a verified refund and supply a reason and PIN; another executive can review and approve the resulting request. Server-calculated eligibility controls visible actions; backend authorization remains mandatory. Disabled accounting permits review only.

PIN input clears before network submission, duplicate clicks are locked, provider fields use textContent rather than HTML, and rows/selections clear on tab exit, logout, backgrounding or MFA expiry. Unknown outcomes instruct the operator to reload rather than claiming success. Manual-review requests have no financial action.

New migration `20261120230936_refund_operator_queue.sql` is LOCAL ONLY and has not been applied to staging. It adds a recent-MFA-protected, read-only queue with up to 100 unrequested verified cases and 100 requests. The queue reports disabled state and server-calculated approval eligibility. This bounded queue needs pagination before high-volume operation.

Checks: 16 refund-accounting groups passed, including queue authorization and separation of duties; 55 migration/security groups passed with all 21 migrations. JavaScript syntax and diff checks passed. Staging-preview packaging and runtime checks were also run. A live browser approval journey has not been tested; two staging executive accounts and the postponed email setup remain required. Frontend and migration are not deployed. Existing staging accounting remains disabled and the customer wallet has not been adjusted.
