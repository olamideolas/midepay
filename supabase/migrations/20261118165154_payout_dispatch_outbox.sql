BEGIN;
ALTER TABLE private.payment_reconciliation_control ADD COLUMN payout_dispatch_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE private.payout_dispatch_outbox (
 transaction_id uuid PRIMARY KEY REFERENCES public.transactions(id),
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','preparing','sending','submitted','review','cancelled','resolved')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 lease_token uuid,leased_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 dispatch_started_at timestamptz,recipient_code text,gateway_reference text,last_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.payout_dispatch_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.payout_dispatch_outbox FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX payout_dispatch_due ON private.payout_dispatch_outbox(next_attempt_at) WHERE state IN ('ready','preparing');
CREATE FUNCTION private.queue_payout_dispatch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.gateway_provider='paystack' AND NEW.type='outflow' AND NEW.category='transfer' AND NEW.status='pending' AND NEW.reference~'^MDP-OUT-[a-f0-9]{40}$' THEN
  INSERT INTO private.payout_dispatch_outbox(transaction_id) VALUES(NEW.id);
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.queue_payout_dispatch() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payout_dispatch_on_insert AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION private.queue_payout_dispatch();
-- Deliberately no backfill: pre-migration payouts may already have been sent.

CREATE FUNCTION public.enqueue_wallet_payout(p_user_id uuid,p_amount numeric,p_fee numeric,p_reference text,p_provider text,p_counterparty_name text,p_counterparty_bank text,p_counterparty_nuban text,p_narration text DEFAULT 'Transfer via MidePay')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_result jsonb; v_ref text;
BEGIN
 PERFORM 1 FROM private.payment_reconciliation_control WHERE singleton AND enabled AND payout_dispatch_enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYOUT_DISPATCH_DISABLED'; END IF;
 IF p_provider IS DISTINCT FROM 'paystack' THEN RAISE EXCEPTION 'PAYOUT_PROVIDER_NOT_SUPPORTED'; END IF;
 -- Keep existing legacy references idempotent; new requests use a bounded, opaque reference.
 IF nullif(trim(p_reference),'') IS NULL OR length(p_reference)>200 THEN RAISE EXCEPTION 'INVALID_PAYOUT_REFERENCE'; END IF;
 v_ref:=CASE WHEN EXISTS(SELECT 1 FROM transactions WHERE reference=p_reference) THEN p_reference ELSE 'MDP-OUT-'||substr(encode(digest(p_reference,'sha256'),'hex'),1,40) END;
 v_result:=public.debit_wallet_for_payout(p_user_id,p_amount,p_fee,v_ref,p_provider,p_counterparty_name,p_counterparty_bank,p_counterparty_nuban,p_narration);
 RETURN v_result||jsonb_build_object('dispatch_status',coalesce((SELECT o.state FROM private.payout_dispatch_outbox o JOIN transactions t ON t.id=o.transaction_id WHERE t.reference=v_ref),'legacy_review'));
END;
$$;

CREATE FUNCTION public.cancel_undispatched_payout(p_transaction_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_job private.payout_dispatch_outbox%ROWTYPE; v_ref text; v_result jsonb;
BEGIN
 SELECT * INTO v_job FROM private.payout_dispatch_outbox WHERE transaction_id=p_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','OUTBOX_NOT_FOUND'); END IF;
 IF v_job.state='cancelled' THEN RETURN jsonb_build_object('success',true,'already_cancelled',true); END IF;
 IF v_job.dispatch_started_at IS NOT NULL OR v_job.state NOT IN ('ready','preparing') THEN
  RETURN jsonb_build_object('success',false,'code','PAYOUT_MAY_HAVE_BEEN_SENT');
 END IF;
 SELECT reference INTO v_ref FROM transactions WHERE id=p_transaction_id AND status='pending';
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PAYOUT_NOT_PENDING'); END IF;
 v_result:=public.reverse_failed_payout(v_ref,'Cancelled before any transfer dispatch',jsonb_build_object('event','transfer.failed','verification_source','local_outbox_no_dispatch'));
 UPDATE private.payout_dispatch_outbox SET state='cancelled',lease_token=NULL,leased_until=NULL,last_code='CANCELLED_BEFORE_DISPATCH',updated_at=now() WHERE transaction_id=p_transaction_id;
 RETURN v_result||jsonb_build_object('dispatch_status','cancelled');
END;
$$;

CREATE FUNCTION public.claim_payout_dispatch() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_id uuid; v_result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.payment_reconciliation_control WHERE singleton AND enabled AND payout_dispatch_enabled) THEN RETURN '[]'::jsonb; END IF;
 UPDATE private.payout_dispatch_outbox o SET state='resolved',lease_token=NULL,leased_until=NULL,updated_at=now()
 FROM transactions t WHERE t.id=o.transaction_id AND t.status IN ('successful','reversed') AND o.state NOT IN ('resolved','cancelled');
 -- Sending is never reclaimed for dispatch, even when its lease expires.
 UPDATE private.payout_dispatch_outbox SET state='review',last_code='AMBIGUOUS_DISPATCH',updated_at=now()
 WHERE state='sending' AND leased_until<=now();
 FOR v_id IN SELECT transaction_id FROM private.payout_dispatch_outbox
 WHERE attempts>=5 AND dispatch_started_at IS NULL AND (state='ready' OR (state='preparing' AND leased_until<=now())) FOR UPDATE SKIP LOCKED
 LOOP PERFORM public.cancel_undispatched_payout(v_id); END LOOP;
 WITH due AS (
  SELECT o.transaction_id FROM private.payout_dispatch_outbox o JOIN transactions t ON t.id=o.transaction_id
  WHERE t.status='pending' AND o.attempts<5 AND o.dispatch_started_at IS NULL
  AND ((o.state='ready' AND o.next_attempt_at<=now()) OR (o.state='preparing' AND o.leased_until<=now()))
  ORDER BY o.next_attempt_at,o.transaction_id LIMIT 1 FOR UPDATE OF o SKIP LOCKED
 ), claimed AS (
  UPDATE private.payout_dispatch_outbox o SET state='preparing',attempts=attempts+1,
  lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes',updated_at=now()
  FROM due WHERE o.transaction_id=due.transaction_id RETURNING o.*
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('transaction_id',t.id,'lease_token',o.lease_token,'reference',t.reference,
 'amount',t.amount,'account_name',t.counterparty_name,'bank_code',t.counterparty_bank,'account_number',t.counterparty_tag_or_nuban,'narration',t.narration)), '[]'::jsonb)
 INTO v_result FROM claimed o JOIN transactions t ON t.id=o.transaction_id;
 RETURN v_result;
END;
$$;

CREATE FUNCTION public.begin_payout_dispatch(p_transaction_id uuid,p_lease_token uuid,p_recipient_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_job private.payout_dispatch_outbox%ROWTYPE; v_tx transactions%ROWTYPE;
BEGIN
 SELECT * INTO v_job FROM private.payout_dispatch_outbox WHERE transaction_id=p_transaction_id FOR UPDATE;
 IF NOT FOUND OR v_job.state<>'preparing' OR v_job.lease_token IS DISTINCT FROM p_lease_token OR v_job.leased_until<=now() OR v_job.dispatch_started_at IS NOT NULL THEN
  RETURN jsonb_build_object('success',false,'code','STALE_DISPATCH_LEASE');
 END IF;
 IF p_recipient_code IS NULL OR p_recipient_code!~'^RCP_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'INVALID_RECIPIENT_CODE'; END IF;
 PERFORM 1 FROM private.payment_reconciliation_control WHERE singleton AND enabled AND payout_dispatch_enabled FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','PAYOUT_DISPATCH_DISABLED'); END IF;
 SELECT * INTO v_tx FROM transactions WHERE id=p_transaction_id FOR UPDATE;
 IF v_tx.status<>'pending' OR v_tx.gateway_provider<>'paystack' THEN RETURN jsonb_build_object('success',false,'code','PAYOUT_NOT_PENDING'); END IF;
 PERFORM 1 FROM profiles WHERE id=v_tx.user_id AND NOT is_frozen AND NOT frozen_by_admin FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','ACCOUNT_FROZEN'); END IF;
 UPDATE private.payout_dispatch_outbox SET state='sending',dispatch_started_at=now(),recipient_code=p_recipient_code,updated_at=now() WHERE transaction_id=p_transaction_id;
 INSERT INTO security_audit_logs(user_id,event_type,severity,entity_type,entity_id,metadata) VALUES(v_tx.user_id,'PAYOUT_DISPATCH_STARTED','info','transactions',p_transaction_id::text,jsonb_build_object('attempt',v_job.attempts));
 RETURN jsonb_build_object('success',true);
END;
$$;

CREATE FUNCTION public.finish_payout_dispatch(p_transaction_id uuid,p_lease_token uuid,p_outcome text,p_gateway_reference text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_job private.payout_dispatch_outbox%ROWTYPE;
BEGIN
 SELECT * INTO v_job FROM private.payout_dispatch_outbox WHERE transaction_id=p_transaction_id FOR UPDATE;
 IF NOT FOUND OR v_job.lease_token IS DISTINCT FROM p_lease_token THEN RETURN jsonb_build_object('success',false,'code','STALE_DISPATCH_LEASE'); END IF;
 IF p_outcome='prepare_retry' AND v_job.state='preparing' AND v_job.dispatch_started_at IS NULL THEN
  IF v_job.attempts>=5 THEN RETURN public.cancel_undispatched_payout(p_transaction_id); END IF;
  UPDATE private.payout_dispatch_outbox SET state='ready',lease_token=NULL,leased_until=NULL,next_attempt_at=now()+make_interval(secs=>60*power(2,attempts-1)::integer),last_code='PREPARATION_RETRY',updated_at=now() WHERE transaction_id=p_transaction_id;
 ELSIF p_outcome IN ('submitted','ambiguous') AND v_job.state='sending' THEN
  IF p_outcome='submitted' AND (p_gateway_reference IS NULL OR p_gateway_reference!~'^TRF_[A-Za-z0-9]+$') THEN RAISE EXCEPTION 'INVALID_TRANSFER_CODE'; END IF;
  UPDATE private.payout_dispatch_outbox SET state=CASE p_outcome WHEN 'submitted' THEN 'submitted' ELSE 'review' END,
  gateway_reference=p_gateway_reference,last_code=CASE p_outcome WHEN 'submitted' THEN 'AWAITING_VERIFICATION' ELSE 'AMBIGUOUS_DISPATCH' END,updated_at=now() WHERE transaction_id=p_transaction_id;
  IF p_outcome='submitted' THEN UPDATE transactions SET gateway_reference=p_gateway_reference WHERE id=p_transaction_id AND status='pending'; END IF;
 ELSE RETURN jsonb_build_object('success',false,'code','INVALID_DISPATCH_TRANSITION');
 END IF;
 INSERT INTO security_audit_logs(user_id,event_type,severity,entity_type,entity_id,metadata) SELECT user_id,'PAYOUT_DISPATCH_RESULT',CASE WHEN p_outcome='ambiguous' THEN 'warning' ELSE 'info' END,'transactions',p_transaction_id::text,jsonb_build_object('outcome',p_outcome,'attempt',v_job.attempts) FROM transactions WHERE id=p_transaction_id;
 RETURN jsonb_build_object('success',true);
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_wallet_payout(uuid,numeric,numeric,text,text,text,text,text,text),public.cancel_undispatched_payout(uuid),public.claim_payout_dispatch(),public.begin_payout_dispatch(uuid,uuid,text),public.finish_payout_dispatch(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_wallet_payout(uuid,numeric,numeric,text,text,text,text,text,text),public.cancel_undispatched_payout(uuid),public.claim_payout_dispatch(),public.begin_payout_dispatch(uuid,uuid,text),public.finish_payout_dispatch(uuid,uuid,text,text) TO service_role;
COMMIT;
