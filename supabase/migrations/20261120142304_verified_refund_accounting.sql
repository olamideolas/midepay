-- Test-mode refund accounting. Disabled until separately enabled after operational review.
BEGIN;
CREATE TABLE private.refund_accounting_control(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false);
INSERT INTO private.refund_accounting_control DEFAULT VALUES;
CREATE TABLE private.refund_verifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider_refund_id text NOT NULL CHECK(provider_refund_id ~ '^[1-9][0-9]{0,15}$'),
 transaction_id uuid NOT NULL REFERENCES public.transactions(id),amount_kobo bigint NOT NULL CHECK(amount_kobo BETWEEN 1 AND 99999999999999),
 domain text NOT NULL CHECK(domain='test'),source text NOT NULL DEFAULT 'paystack_refund_api' CHECK(source='paystack_refund_api'),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX refund_verifications_case ON private.refund_verifications(provider_refund_id);
CREATE TABLE private.refund_adjustment_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),verification_id uuid NOT NULL REFERENCES private.refund_verifications(id),
 provider_refund_id text NOT NULL UNIQUE,transaction_id uuid NOT NULL REFERENCES public.transactions(id),amount_kobo bigint NOT NULL,
 maker_id uuid NOT NULL REFERENCES public.profiles(id),checker_id uuid REFERENCES public.profiles(id),reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 500),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','manual_review')),review_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '24 hours'),
 CHECK(checker_id IS NULL OR checker_id<>maker_id)
);
CREATE TABLE private.refund_adjustment_journal(
 request_id uuid PRIMARY KEY REFERENCES private.refund_adjustment_requests(id),provider_refund_id text NOT NULL UNIQUE,
 original_transaction_id uuid NOT NULL REFERENCES public.transactions(id),adjustment_transaction_id uuid NOT NULL UNIQUE REFERENCES public.transactions(id),
 debit_customer_liability_kobo bigint NOT NULL CHECK(debit_customer_liability_kobo>0),
 credit_refund_clearing_kobo bigint NOT NULL CHECK(credit_refund_clearing_kobo=debit_customer_liability_kobo),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.refund_accounting_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.refund_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.refund_adjustment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.refund_adjustment_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.refund_accounting_control,private.refund_verifications,private.refund_adjustment_requests,private.refund_adjustment_journal FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_refund_verifications BEFORE UPDATE OR DELETE ON private.refund_verifications FOR EACH ROW EXECUTE FUNCTION private.reject_provider_observation_change();
CREATE TRIGGER immutable_refund_journal BEFORE UPDATE OR DELETE ON private.refund_adjustment_journal FOR EACH ROW EXECUTE FUNCTION private.reject_provider_observation_change();

-- Trusted server boundary: call only with a freshly validated Paystack GET response.
CREATE FUNCTION public.attest_processed_test_refund(p_refund_id text,p_receipt text,p_amount_kobo bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE t public.transactions%ROWTYPE;v_id uuid;
BEGIN
 IF p_refund_id IS NULL OR p_refund_id !~ '^[1-9][0-9]{0,15}$' OR p_receipt IS NULL OR p_receipt !~ '^[1-9][0-9]{0,19}$'
 OR p_amount_kobo IS NULL OR p_amount_kobo NOT BETWEEN 1 AND 99999999999999 THEN RAISE EXCEPTION 'INVALID_VERIFICATION'; END IF;
 SELECT * INTO t FROM transactions WHERE gateway_provider='paystack' AND gateway_reference=p_receipt AND type='inflow' AND category='deposit' AND status='successful';
 IF NOT FOUND OR t.webhook_payload#>>'{data,domain}' IS DISTINCT FROM 'test' OR p_amount_kobo>t.amount*100 THEN RAISE EXCEPTION 'REFUND_PAYMENT_MISMATCH'; END IF;
 -- Serializes verified evidence with approvals for this original charge.
 PERFORM pg_advisory_xact_lock(hashtext('refund-accounting'),hashtext(t.id::text));
 IF EXISTS(SELECT 1 FROM private.refund_verifications WHERE provider_refund_id=p_refund_id AND (transaction_id<>t.id OR amount_kobo<>p_amount_kobo)) THEN RAISE EXCEPTION 'REFUND_VERIFICATION_CONFLICT'; END IF;
 INSERT INTO private.refund_verifications(provider_refund_id,transaction_id,amount_kobo,domain) VALUES(p_refund_id,t.id,p_amount_kobo,'test') RETURNING id INTO v_id;
 RETURN v_id;
END;$$;
REVOKE ALL ON FUNCTION public.attest_processed_test_refund(text,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attest_processed_test_refund(text,text,bigint) TO service_role;

CREATE FUNCTION public.request_refund_adjustment(p_verification_id uuid,p_reason text,p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v private.refund_verifications%ROWTYPE;r private.refund_adjustment_requests%ROWTYPE;c jsonb;v_id uuid;t public.transactions%ROWTYPE;
BEGIN
 c:=public._treasury_actor_check(p_pin);IF NOT coalesce((c->>'ok')::boolean,false) THEN RETURN c||jsonb_build_object('success',false); END IF;
 IF NOT EXISTS(SELECT 1 FROM private.refund_accounting_control WHERE enabled) THEN RETURN jsonb_build_object('success',false,'code','REFUND_ACCOUNTING_DISABLED'); END IF;
 SELECT * INTO v FROM private.refund_verifications WHERE id=p_verification_id;
 IF NOT FOUND OR v.verified_at<now()-interval '24 hours' THEN RETURN jsonb_build_object('success',false,'code','FRESH_VERIFICATION_REQUIRED'); END IF;
 IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 5 AND 500 THEN RETURN jsonb_build_object('success',false,'code','INVALID_REASON'); END IF;
 SELECT * INTO t FROM transactions WHERE id=v.transaction_id;
 IF t.user_id=auth.uid() THEN RETURN jsonb_build_object('success',false,'code','SEPARATION_OF_DUTIES'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('refund-accounting'),hashtext(v.transaction_id::text));
 SELECT * INTO r FROM private.refund_adjustment_requests WHERE provider_refund_id=v.provider_refund_id;
 IF FOUND THEN RETURN jsonb_build_object('success',true,'status','duplicate','request_id',r.id,'request_status',r.status); END IF;
 INSERT INTO private.refund_adjustment_requests(verification_id,provider_refund_id,transaction_id,amount_kobo,maker_id,reason)
 VALUES(v.id,v.provider_refund_id,v.transaction_id,v.amount_kobo,auth.uid(),trim(p_reason)) RETURNING id INTO v_id;
 RETURN jsonb_build_object('success',true,'status','pending','request_id',v_id);
END;$$;
REVOKE ALL ON FUNCTION public.request_refund_adjustment(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.request_refund_adjustment(uuid,text,text) TO authenticated;

CREATE FUNCTION public.approve_refund_adjustment(p_request_id uuid,p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE r private.refund_adjustment_requests%ROWTYPE;t public.transactions%ROWTYPE;w public.wallets%ROWTYPE;v private.refund_verifications%ROWTYPE;
 c jsonb;v_code text;v_total numeric;v_amt numeric;v_tx uuid;v_ref text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_executive() THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 SELECT * INTO r FROM private.refund_adjustment_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO t FROM transactions WHERE id=r.transaction_id;
 -- Profile locks precede the charge lock and wallet lock, matching existing money paths.
 PERFORM id FROM profiles WHERE id IN (auth.uid(),r.maker_id,t.user_id) ORDER BY id FOR UPDATE;
 c:=public._treasury_actor_check(p_pin);IF NOT coalesce((c->>'ok')::boolean,false) THEN RETURN c||jsonb_build_object('success',false); END IF;
 IF NOT EXISTS(SELECT 1 FROM private.refund_accounting_control WHERE enabled) THEN RETURN jsonb_build_object('success',false,'code','REFUND_ACCOUNTING_DISABLED'); END IF;
 IF auth.uid() IN (r.maker_id,t.user_id) OR r.maker_id=t.user_id THEN RETURN jsonb_build_object('success',false,'code','SEPARATION_OF_DUTIES'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('refund-accounting'),hashtext(t.id::text));
 SELECT * INTO r FROM private.refund_adjustment_requests WHERE id=p_request_id FOR UPDATE;
 IF r.status='applied' THEN RETURN jsonb_build_object('success',true,'status','duplicate','request_id',r.id); END IF;
 IF r.status<>'pending' THEN RETURN jsonb_build_object('success',false,'code','MANUAL_REVIEW_REQUIRED'); END IF;
 SELECT * INTO v FROM private.refund_verifications WHERE id=r.verification_id;
 SELECT * INTO t FROM transactions WHERE id=r.transaction_id FOR UPDATE;
 SELECT * INTO w FROM wallets WHERE id=t.wallet_id FOR UPDATE;
 SELECT coalesce(sum(debit_customer_liability_kobo),0) INTO v_total FROM private.refund_adjustment_journal WHERE original_transaction_id=t.id;
 v_amt:=r.amount_kobo::numeric/100;
 IF r.expires_at<=now() OR v.verified_at<now()-interval '24 hours' THEN v_code:='FRESH_VERIFICATION_REQUIRED';
 ELSIF NOT EXISTS(SELECT 1 FROM profiles WHERE id=r.maker_id AND role='executive' AND NOT is_frozen AND NOT frozen_by_admin) OR NOT public._has_verified_email_proof(r.maker_id) THEN v_code:='MAKER_NOT_AUTHORIZED';
 ELSIF NOT w.is_active OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=t.user_id AND NOT is_frozen AND NOT frozen_by_admin) THEN v_code:='WALLET_RESTRICTED';
 ELSIF t.status<>'successful' OR t.type<>'inflow' OR t.category<>'deposit' OR t.gateway_provider<>'paystack' OR t.webhook_payload#>>'{data,domain}' IS DISTINCT FROM 'test' OR w.currency<>'NGN' THEN v_code:='REFUND_PAYMENT_MISMATCH';
 ELSIF v_total+r.amount_kobo>t.amount*100 THEN v_code:='REFUND_EXCEEDS_PAYMENT';
 ELSIF NOT coalesce((public.verify_wallet_ledger_reconciliation(w.id)->>'ok')::boolean,false) THEN v_code:='LEDGER_RECONCILIATION_REQUIRED';
 ELSIF w.balance<v_amt OR w.ledger_balance<v_amt THEN v_code:='INSUFFICIENT_FUNDS';
 END IF;
 IF v_code IS NOT NULL THEN
  UPDATE private.refund_adjustment_requests SET status='manual_review',review_code=v_code,checker_id=auth.uid() WHERE id=r.id;
  RETURN jsonb_build_object('success',false,'code',v_code,'status','manual_review','wallet_changed',false);
 END IF;
 v_ref:='MDP-RFA-'||r.id::text;
 UPDATE wallets SET balance=balance-v_amt,ledger_balance=ledger_balance-v_amt,updated_at=now() WHERE id=w.id;
 INSERT INTO transactions(wallet_id,user_id,type,category,amount,fee,balance_before,balance_after,status,counterparty_name,reference,gateway_provider,metadata)
 VALUES(w.id,w.user_id,'outflow','refund',v_amt,0,w.balance,w.balance-v_amt,'successful','Processed payment refund',v_ref,'internal',jsonb_build_object('refund_request_id',r.id,'original_transaction_id',t.id)) RETURNING id INTO v_tx;
 INSERT INTO private.refund_adjustment_journal(request_id,provider_refund_id,original_transaction_id,adjustment_transaction_id,debit_customer_liability_kobo,credit_refund_clearing_kobo)
 VALUES(r.id,r.provider_refund_id,t.id,v_tx,r.amount_kobo,r.amount_kobo);
 UPDATE private.refund_adjustment_requests SET status='applied',checker_id=auth.uid() WHERE id=r.id;
 INSERT INTO audit_logs(actor_id,actor_role,target_user_id,action,entity_type,entity_id,reason,old_data,new_data)
 VALUES(auth.uid(),'executive',w.user_id,'REFUND_ADJUSTMENT_APPLIED','refund_adjustment_requests',r.id::text,r.reason,jsonb_build_object('balance',w.balance),jsonb_build_object('balance',w.balance-v_amt,'maker_id',r.maker_id,'reference',v_ref));
 RETURN jsonb_build_object('success',true,'status','applied','reference',v_ref,'wallet_changed',true);
END;$$;
REVOKE ALL ON FUNCTION public.approve_refund_adjustment(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.approve_refund_adjustment(uuid,text) TO authenticated;
COMMIT;
