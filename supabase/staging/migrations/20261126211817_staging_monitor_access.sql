-- STAGING ONLY: ajbhsmcosxgymrtawlmd. Infrastructure configuration, not an app migration.
-- Run once by the staging owner. The new role cannot log in until privately configured.
BEGIN;
CREATE ROLE midepay_monitor_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE midepay_monitor_reader SET default_transaction_read_only=on;
ALTER ROLE midepay_monitor_reader SET statement_timeout='15s';
ALTER ROLE midepay_monitor_reader SET idle_in_transaction_session_timeout='15s';
CREATE SCHEMA midepay_monitor;
REVOKE ALL ON SCHEMA midepay_monitor FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA midepay_monitor TO midepay_monitor_reader;
CREATE FUNCTION midepay_monitor.get_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $monitor$
WITH scheduler AS (
 SELECT jobid,active FROM cron.job WHERE jobname='midepay-staging-reconcile-payments'
), runs AS (
 SELECT d.status,d.start_time FROM cron.job_run_details d
 JOIN scheduler s ON s.jobid=d.jobid
 WHERE d.start_time>now()-interval '15 minutes'
), recovery AS (
 SELECT state,count(*) AS count
 FROM private.payment_reconciliation_jobs GROUP BY state
), payouts AS (
 SELECT state,count(*) AS count
 FROM private.payout_dispatch_outbox GROUP BY state
)
SELECT jsonb_build_object(
 'project_ref','ajbhsmcosxgymrtawlmd',
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
$monitor$;
REVOKE ALL ON FUNCTION midepay_monitor.get_health() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION midepay_monitor.get_health() TO midepay_monitor_reader;
COMMIT;
