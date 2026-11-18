BEGIN;
CREATE TABLE private.payment_reconciliation_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 token_hash bytea NOT NULL CHECK(octet_length(token_hash)=32)
);
ALTER TABLE private.payment_reconciliation_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.payment_reconciliation_control FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.authorize_payment_reconciliation(p_token text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
 SELECT coalesce((SELECT enabled AND token_hash=digest(p_token,'sha256') FROM private.payment_reconciliation_control WHERE singleton),false)
$$;
REVOKE ALL ON FUNCTION public.authorize_payment_reconciliation(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_payment_reconciliation(text) TO service_role;
CREATE TABLE private.payment_reconciliation_jobs (
 transaction_id uuid PRIMARY KEY REFERENCES public.transactions(id),
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','leased','done','review')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 12),
 next_check_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 leased_until timestamptz,
 last_code text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='leased') = (lease_token IS NOT NULL AND leased_until IS NOT NULL))
);
ALTER TABLE private.payment_reconciliation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.payment_reconciliation_jobs FROM PUBLIC,anon,authenticated;
CREATE INDEX payment_reconciliation_due ON private.payment_reconciliation_jobs(next_check_at) WHERE state IN ('ready','leased');

CREATE FUNCTION public.claim_payment_reconciliation(p_limit integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>5 THEN RAISE EXCEPTION 'INVALID_BATCH_SIZE'; END IF;
 -- Discovery is repeatable: an interruption before a job is created cannot lose a pending payment.
 INSERT INTO private.payment_reconciliation_jobs(transaction_id)
 SELECT t.id FROM public.transactions t
 WHERE t.gateway_provider='paystack' AND t.status='pending'
 AND ((t.type='inflow' AND t.category='deposit') OR (t.type='outflow' AND t.category='transfer'))
 AND t.created_at<now()-interval '30 seconds'
 AND NOT EXISTS(SELECT 1 FROM private.payment_reconciliation_jobs j WHERE j.transaction_id=t.id)
 ORDER BY t.created_at,t.id LIMIT 500 ON CONFLICT DO NOTHING;

 UPDATE private.payment_reconciliation_jobs SET state='review',lease_token=NULL,leased_until=NULL,
 last_code='RETRIES_EXHAUSTED',updated_at=now()
 WHERE attempts>=12 AND state IN ('ready','leased') AND (leased_until IS NULL OR leased_until<=now());

 WITH due AS (
  SELECT j.transaction_id FROM private.payment_reconciliation_jobs j
  WHERE j.attempts<12 AND ((j.state='ready' AND j.next_check_at<=now()) OR (j.state='leased' AND j.leased_until<=now()))
  ORDER BY j.next_check_at,j.transaction_id LIMIT p_limit FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE private.payment_reconciliation_jobs j SET state='leased',attempts=j.attempts+1,
  lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes',updated_at=now()
  FROM due WHERE j.transaction_id=due.transaction_id RETURNING j.*
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'transaction_id',t.id,'lease_token',j.lease_token,'attempts',j.attempts,
  'reference',t.reference,'type',t.type,'category',t.category,'amount',t.amount,'status',t.status,
  'gateway_reference',t.gateway_reference,'bank_code',t.counterparty_bank,'account_number',t.counterparty_tag_or_nuban
 )), '[]'::jsonb) INTO v_result FROM claimed j JOIN public.transactions t ON t.id=j.transaction_id;
 RETURN v_result;
END;
$$;

CREATE FUNCTION public.finish_payment_reconciliation(p_transaction_id uuid,p_lease_token uuid,p_outcome text,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_job private.payment_reconciliation_jobs%ROWTYPE; v_tx public.transactions%ROWTYPE; v_state text;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('done','retry','review') OR p_code IS NULL OR p_code!~'^[A-Z0-9_]{1,64}$' THEN
  RAISE EXCEPTION 'INVALID_JOB_OUTCOME';
 END IF;
 SELECT * INTO v_job FROM private.payment_reconciliation_jobs WHERE transaction_id=p_transaction_id FOR UPDATE;
 IF NOT FOUND OR v_job.state<>'leased' OR v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.leased_until<=now() THEN
  RETURN jsonb_build_object('success',false,'code','STALE_LEASE');
 END IF;
 SELECT * INTO v_tx FROM public.transactions WHERE id=p_transaction_id;
 IF p_outcome='done' AND v_tx.status NOT IN ('successful','reversed') THEN RAISE EXCEPTION 'PAYMENT_NOT_TERMINAL'; END IF;
 v_state:=CASE WHEN p_outcome='retry' THEN CASE WHEN v_job.attempts>=12 THEN 'review' ELSE 'ready' END ELSE p_outcome END;
 UPDATE private.payment_reconciliation_jobs SET state=v_state,lease_token=NULL,leased_until=NULL,
 next_check_at=now()+make_interval(secs=>least(21600,60*power(2,least(v_job.attempts-1,9)))::integer),
 last_code=p_code,updated_at=now() WHERE transaction_id=p_transaction_id;
 INSERT INTO public.security_audit_logs(user_id,event_type,severity,entity_type,entity_id,metadata)
 VALUES(v_tx.user_id,'PAYMENT_RECONCILIATION',CASE WHEN v_state='review' THEN 'warning' ELSE 'info' END,
 'transactions',p_transaction_id::text,jsonb_build_object('outcome',v_state,'code',p_code,'attempt',v_job.attempts));
 RETURN jsonb_build_object('success',true,'state',v_state);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_payment_reconciliation(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_payment_reconciliation(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payment_reconciliation(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_payment_reconciliation(uuid,uuid,text,text) TO service_role;
-- Optional hosted scheduler support. Portable test clusters do not provide these extensions.
DO $scheduler_extensions$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron') THEN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_net') THEN
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
 END IF;
END;
$scheduler_extensions$;
COMMIT;
