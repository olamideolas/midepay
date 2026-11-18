-- STAGING ONLY: run only against project ajbhsmcosxgymrtawlmd after all three recovery migrations and worker v2.
-- Never paste a key here. Signing material is generated inside the private database and never returned.
BEGIN;
INSERT INTO private.payment_reconciliation_control(singleton,enabled,signing_key)
VALUES(true,true,gen_random_bytes(32)) ON CONFLICT(singleton) DO UPDATE SET enabled=true;
SELECT cron.schedule('midepay-staging-reconcile-payments','* * * * *',$scheduled_reconciliation$
 SELECT net.http_post(
  url:='https://ajbhsmcosxgymrtawlmd.supabase.co/functions/v1/reconcile-payments',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization',private.build_reconciliation_authorization()),
  body:='{}'::jsonb,timeout_milliseconds:=55000);
$scheduled_reconciliation$);
COMMIT;
-- Stop new invocations (an already authorized batch may still finish):
-- UPDATE private.payment_reconciliation_control SET enabled=false WHERE singleton;
-- SELECT cron.unschedule('midepay-staging-reconcile-payments');
