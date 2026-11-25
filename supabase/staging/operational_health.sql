-- STAGING ONLY: ajbhsmcosxgymrtawlmd. Privileged read-only diagnostic.
-- No secrets, customer identifiers, response bodies, or worker invocations.
BEGIN TRANSACTION READ ONLY;
WITH scheduler AS (
 SELECT jobid,active FROM cron.job WHERE jobname='midepay-staging-reconcile-payments'
), runs AS (
 SELECT d.status,d.start_time FROM cron.job_run_details d
 JOIN scheduler s ON s.jobid=d.jobid
 WHERE d.start_time>now()-interval '15 minutes'
), recovery AS (
 SELECT state,last_code,count(*) AS count
 FROM private.payment_reconciliation_jobs GROUP BY state,last_code
), payouts AS (
 SELECT state,last_code,count(*) AS count
 FROM private.payout_dispatch_outbox GROUP BY state,last_code
)
SELECT jsonb_build_object(
 'observed_at',now(),
 'recovery_enabled',(SELECT enabled FROM private.payment_reconciliation_control WHERE singleton),
 'payout_dispatch_enabled',(SELECT payout_dispatch_enabled FROM private.payment_reconciliation_control WHERE singleton),
 'scheduler_count',(SELECT count(*) FROM scheduler),
 'scheduler_active',coalesce((SELECT bool_and(active) FROM scheduler),false),
 'scheduler_successes_15m',(SELECT count(*) FROM runs WHERE status='succeeded'),
 'scheduler_failures_15m',(SELECT count(*) FROM runs WHERE status='failed'),
 'last_scheduler_success',(SELECT max(start_time) FROM runs WHERE status='succeeded'),
 'recovery_queue',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM recovery r),'[]'::jsonb),
 'expired_recovery_leases',(SELECT count(*) FROM private.payment_reconciliation_jobs WHERE state='leased' AND leased_until<=now()),
 'overdue_recovery_jobs',(SELECT count(*) FROM private.payment_reconciliation_jobs WHERE state='ready' AND next_check_at<now()-interval '5 minutes'),
 'payout_queue',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM payouts p),'[]'::jsonb),
 'expired_payout_leases',(SELECT count(*) FROM private.payout_dispatch_outbox WHERE state IN ('preparing','sending') AND leased_until<=now()),
 'http_responses_15m_project_wide',coalesce((SELECT jsonb_agg(to_jsonb(h)) FROM (
 SELECT status_code,timed_out,count(*) AS count FROM net._http_response
 WHERE created>now()-interval '15 minutes' GROUP BY status_code,timed_out
 ) h),'[]'::jsonb)
) AS health;
COMMIT;
