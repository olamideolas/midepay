-- Signed provider observations, not authority to debit a customer or issue a refund.
BEGIN;
CREATE TABLE private.payment_provider_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('refund','dispute')),
 provider_case_id text NOT NULL CHECK(provider_case_id ~ '^[1-9][0-9]{0,19}$'),
 domain text NOT NULL CHECK(domain IN ('test','live')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(kind,provider_case_id,domain)
);
CREATE TABLE private.payment_provider_case_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES private.payment_provider_cases(id),
 event_type text NOT NULL CHECK(event_type IN ('refund.pending','refund.processing','refund.processed','refund.failed','charge.dispute.create','charge.dispute.remind','charge.dispute.resolve')),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 transaction_id uuid REFERENCES public.transactions(id),
 provider_transaction_id text,
 transaction_reference text,
 amount_kobo bigint CHECK(amount_kobo BETWEEN 1 AND 99999999999999),
 currency text,
 reported_status text,
 reported_resolution text,
 match_state text NOT NULL CHECK(match_state IN ('matched','unmatched','identity_conflict')),
 amount_state text NOT NULL CHECK(amount_state IN ('known','missing','invalid')),
 exceeds_payment boolean NOT NULL DEFAULT false,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(case_id,digest)
);
CREATE INDEX provider_case_events_order ON private.payment_provider_case_events(case_id,received_at DESC,id DESC);
CREATE INDEX provider_case_events_transaction ON private.payment_provider_case_events(transaction_id);
CREATE INDEX provider_cases_order ON private.payment_provider_cases(created_at DESC,id DESC);
CREATE TABLE private.payment_charge_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 transaction_id uuid NOT NULL REFERENCES public.transactions(id),
 gateway_receipt text NOT NULL,
 domain text CHECK(domain IN ('test','live')),
 gross_kobo bigint NOT NULL CHECK(gross_kobo BETWEEN 1 AND 99999999999999),
 fee_kobo bigint CHECK(fee_kobo >= 0 AND fee_kobo <= gross_kobo),
 fee_state text NOT NULL CHECK(fee_state IN ('known','missing','invalid')),
 source text NOT NULL CHECK(source IN ('signed_webhook','paystack_verify_api','scheduled_paystack_verification','unspecified')),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((fee_state='known')=(fee_kobo IS NOT NULL)),
 UNIQUE(transaction_id,digest)
);
CREATE INDEX charge_observations_order ON private.payment_charge_observations(transaction_id,observed_at DESC,id DESC);
ALTER TABLE private.payment_provider_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.payment_provider_case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.payment_charge_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.payment_provider_cases,private.payment_provider_case_events,private.payment_charge_observations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.reject_provider_observation_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'PROVIDER_OBSERVATIONS_ARE_IMMUTABLE'; END;
$$;
CREATE TRIGGER immutable_provider_cases BEFORE UPDATE OR DELETE ON private.payment_provider_cases FOR EACH ROW EXECUTE FUNCTION private.reject_provider_observation_change();
CREATE TRIGGER immutable_provider_case_events BEFORE UPDATE OR DELETE ON private.payment_provider_case_events FOR EACH ROW EXECUTE FUNCTION private.reject_provider_observation_change();
CREATE TRIGGER immutable_charge_observations BEFORE UPDATE OR DELETE ON private.payment_charge_observations FOR EACH ROW EXECUTE FUNCTION private.reject_provider_observation_change();
REVOKE ALL ON FUNCTION private.reject_provider_observation_change() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_paystack_case_event(p_event text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_kind text;v_domain text;v_case_id uuid;v_case_ref text;v_hash text;v_row_id uuid;
 v_receipt text;v_reference text;v_currency text;v_amount numeric;v_amount_state text:='missing';
 v_match text:='unmatched';v_tx public.transactions%ROWTYPE;v_exceeds boolean:=false;
BEGIN
 IF p_event IS NULL OR p_event NOT IN ('refund.pending','refund.processing','refund.processed','refund.failed','charge.dispute.create','charge.dispute.remind','charge.dispute.resolve')
    OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>131072 THEN RAISE EXCEPTION 'INVALID_PROVIDER_CASE_EVENT'; END IF;
 v_kind:=CASE WHEN p_event LIKE 'refund.%' THEN 'refund' ELSE 'dispute' END;
 v_case_ref:=p_data->>'id';
 v_domain:=coalesce(p_data->>'domain',p_data#>>'{transaction,domain}');
 IF v_case_ref IS NULL OR v_case_ref !~ '^[1-9][0-9]{0,19}$' OR v_domain IS NULL OR v_domain NOT IN ('test','live') THEN RAISE EXCEPTION 'INVALID_PROVIDER_CASE_ID_OR_DOMAIN'; END IF;
 -- Refund reference identifies the refund, not the original charge.
 v_receipt:=CASE WHEN jsonb_typeof(p_data->'transaction')='object' THEN p_data#>>'{transaction,id}' ELSE p_data->>'transaction' END;
 IF v_receipt IS NOT NULL AND v_receipt !~ '^[1-9][0-9]{0,19}$' THEN v_receipt:=NULL; END IF;
 v_reference:=nullif(trim(coalesce(p_data#>>'{transaction,reference}',p_data->>'transaction_reference')),'');
 IF length(v_reference)>128 THEN v_reference:=NULL; END IF;
 v_currency:=coalesce(p_data->>'currency',p_data#>>'{transaction,currency}');
 IF v_currency IS NOT NULL AND v_currency !~ '^[A-Z]{3}$' THEN v_currency:=NULL; END IF;
 -- A dispute's refund_amount may be absent; never substitute the entire charge.
 IF (v_kind='refund' AND p_data ? 'amount') OR (v_kind='dispute' AND p_data ? 'refund_amount' AND p_data->'refund_amount'<>'null'::jsonb) THEN
  IF jsonb_typeof(CASE WHEN v_kind='refund' THEN p_data->'amount' ELSE p_data->'refund_amount' END)='number' THEN
   v_amount:=(CASE WHEN v_kind='refund' THEN p_data->>'amount' ELSE p_data->>'refund_amount' END)::numeric;
   IF v_amount>0 AND v_amount=trunc(v_amount) AND v_amount<=99999999999999 THEN v_amount_state:='known'; ELSE v_amount:=NULL;v_amount_state:='invalid'; END IF;
  ELSE v_amount_state:='invalid'; END IF;
 END IF;
 SELECT * INTO v_tx FROM public.transactions t WHERE t.gateway_provider='paystack' AND t.type='inflow' AND t.category='deposit'
  AND ((v_receipt IS NOT NULL AND t.gateway_reference=v_receipt) OR (v_reference IS NOT NULL AND t.reference=v_reference))
 ORDER BY t.id LIMIT 1;
 IF FOUND THEN
  IF (v_receipt IS NOT NULL AND v_tx.gateway_reference IS NOT NULL AND v_tx.gateway_reference<>v_receipt)
     OR (v_reference IS NOT NULL AND v_tx.reference<>v_reference)
     OR (v_tx.webhook_payload#>>'{data,domain}' IS NOT NULL AND v_tx.webhook_payload#>>'{data,domain}'<>v_domain) THEN
   v_match:='identity_conflict';v_tx.id:=NULL;
  ELSE v_match:='matched';v_exceeds:=v_amount>v_tx.amount*100; END IF;
 END IF;
 -- PostgreSQL jsonb key ordering makes equivalent JSON deliveries share a digest.
 v_hash:=encode(digest(p_event||':'||p_data::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtext('provider_case'),hashtext(v_kind||':'||v_domain||':'||v_case_ref));
 INSERT INTO private.payment_provider_cases(kind,provider_case_id,domain) VALUES(v_kind,v_case_ref,v_domain) ON CONFLICT DO NOTHING;
 SELECT id INTO v_case_id FROM private.payment_provider_cases WHERE kind=v_kind AND provider_case_id=v_case_ref AND domain=v_domain;
 INSERT INTO private.payment_provider_case_events(case_id,event_type,digest,transaction_id,provider_transaction_id,transaction_reference,amount_kobo,currency,reported_status,reported_resolution,match_state,amount_state,exceeds_payment)
 VALUES(v_case_id,p_event,v_hash,v_tx.id,v_receipt,v_reference,v_amount,v_currency,
  CASE WHEN p_data->>'status' ~ '^[A-Za-z0-9_-]{1,64}$' THEN p_data->>'status' END,
  CASE WHEN p_data->>'resolution' ~ '^[A-Za-z0-9_-]{1,64}$' THEN p_data->>'resolution' END,
  v_match,v_amount_state,coalesce(v_exceeds,false)) ON CONFLICT DO NOTHING RETURNING id INTO v_row_id;
 RETURN jsonb_build_object('success',true,'recorded',true,'duplicate',v_row_id IS NULL,'review_required',true,'wallet_changed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.record_paystack_case_event(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_paystack_case_event(text,jsonb) TO service_role;

CREATE FUNCTION private.observe_paystack_charge(p_transaction_id uuid,p_receipt text,p_gross numeric,p_payload jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public,extensions,pg_temp AS $$
DECLARE v_fee numeric;v_state text:='missing';v_source text;v_hash text;v_domain text;
BEGIN
 IF p_payload#>'{data,fees}' IS NOT NULL AND p_payload#>'{data,fees}'<>'null'::jsonb THEN
  v_state:='invalid';
  IF jsonb_typeof(p_payload#>'{data,fees}')='number' THEN
   v_fee:=(p_payload#>>'{data,fees}')::numeric;
   IF v_fee>=0 AND v_fee=trunc(v_fee) AND v_fee<=p_gross THEN v_state:='known'; ELSE v_fee:=NULL; END IF;
  END IF;
 END IF;
 v_source:=CASE WHEN p_payload->>'verification_source' IN ('paystack_verify_api','scheduled_paystack_verification') THEN p_payload->>'verification_source'
  WHEN p_payload->>'event'='charge.success' THEN 'signed_webhook' ELSE 'unspecified' END;
 v_domain:=CASE WHEN p_payload#>>'{data,domain}' IN ('test','live') THEN p_payload#>>'{data,domain}' END;
 v_hash:=encode(digest(concat_ws(':',p_receipt,p_gross,v_state,coalesce(v_fee::text,'unknown'),v_source,coalesce(v_domain,'unknown')),'sha256'),'hex');
 INSERT INTO private.payment_charge_observations(transaction_id,gateway_receipt,domain,gross_kobo,fee_kobo,fee_state,source,digest)
 VALUES(p_transaction_id,p_receipt,v_domain,p_gross,v_fee,v_state,v_source,v_hash) ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION private.observe_paystack_charge(uuid,text,numeric,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_operator_provider_review(p_view text DEFAULT 'cases',p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_gate jsonb;v_result jsonb;
BEGIN
 -- Reuse the existing verified executive + recent TOTP authorization boundary.
 v_gate:=public.get_operator_payment_review('all');
 IF NOT coalesce((v_gate->>'success')::boolean,false) THEN RETURN jsonb_build_object('success',false,'code',v_gate->>'code'); END IF;
 IF p_view IS NULL OR p_view NOT IN ('cases','charges') THEN RETURN jsonb_build_object('success',false,'code','INVALID_VIEW'); END IF;
 IF (p_before IS NULL)<>(p_before_id IS NULL) THEN RETURN jsonb_build_object('success',false,'code','INVALID_CURSOR'); END IF;
 IF p_view='cases' THEN
  WITH page AS (
   SELECT c.* FROM private.payment_provider_cases c WHERE p_before IS NULL OR (c.created_at,c.id)<(p_before,p_before_id)
   ORDER BY c.created_at DESC,c.id DESC LIMIT 26
  ), visible AS (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT 25), rows AS (
   SELECT c.id,c.kind,c.provider_case_id,c.domain,c.created_at,'needs_review'::text AS review_state,
    e.event_type AS last_received_event,e.reported_status,e.reported_resolution,e.amount_kobo,e.currency,e.amount_state,e.match_state,e.exceeds_payment,
    totals.observed_processed_refunds_kobo,
    coalesce(totals.observed_processed_refunds_kobo>t.amount*100,false) AS cumulative_refund_exceeds_payment,
    (SELECT count(*) FROM private.payment_provider_case_events x WHERE x.case_id=c.id) AS event_count,
    (SELECT count(DISTINCT amount_kobo)>1 OR count(DISTINCT provider_transaction_id)>1 OR count(DISTINCT transaction_reference)>1
     FROM private.payment_provider_case_events x WHERE x.case_id=c.id) AS conflicting_observations
   FROM visible c LEFT JOIN LATERAL (SELECT * FROM private.payment_provider_case_events x WHERE x.case_id=c.id ORDER BY received_at DESC,id DESC LIMIT 1) e ON true
   LEFT JOIN public.transactions t ON t.id=e.transaction_id
   LEFT JOIN LATERAL (
    -- Count each refund case once. This is reported exposure, not a verified
    -- refund journal or authority to debit. Conflicted amounts need review.
    SELECT sum(per_case.amount) AS observed_processed_refunds_kobo FROM (
     SELECT min(x.amount_kobo) AS amount FROM private.payment_provider_case_events x JOIN private.payment_provider_cases pc ON pc.id=x.case_id
     WHERE x.transaction_id=e.transaction_id AND pc.kind='refund' AND pc.domain=c.domain AND x.currency='NGN' AND x.match_state='matched'
     GROUP BY x.case_id HAVING bool_or(x.event_type='refund.processed') AND count(DISTINCT x.amount_kobo)=1
    ) per_case
   ) totals ON true
  ) SELECT jsonb_build_object('success',true,'access_expires_at',v_gate->'access_expires_at','rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY created_at DESC,id DESC) FROM rows r),'[]'::jsonb),
   'next_cursor',CASE WHEN (SELECT count(*) FROM page)>25 THEN (SELECT jsonb_build_object('before',created_at,'id',id) FROM visible ORDER BY created_at,id LIMIT 1) END) INTO v_result;
 ELSE
  WITH page AS (
   SELECT t.id,t.reference,t.created_at,t.amount FROM public.transactions t WHERE t.gateway_provider='paystack' AND t.type='inflow' AND t.category='deposit' AND t.status='successful'
    AND (p_before IS NULL OR (t.created_at,t.id)<(p_before,p_before_id)) ORDER BY created_at DESC,id DESC LIMIT 26
  ), visible AS (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT 25), rows AS (
   SELECT t.*,t.amount*100 AS gross_kobo,'NGN'::text AS currency,
    CASE WHEN s.known_count=1 AND NOT s.invalid THEN s.fee END AS provider_fee_kobo,
    CASE WHEN s.known_count>1 THEN 'conflict' WHEN s.invalid THEN 'invalid' WHEN s.known_count=1 THEN 'known' ELSE 'missing' END AS fee_state,
    CASE WHEN s.known_count=1 AND NOT s.invalid THEN t.amount*100-s.fee END AS expected_provider_net_kobo,
    false AS bank_settlement_verified
   FROM visible t LEFT JOIN LATERAL (SELECT count(DISTINCT fee_kobo) AS known_count,min(fee_kobo) AS fee,coalesce(bool_or(fee_state='invalid'),false) AS invalid
     FROM private.payment_charge_observations o WHERE o.transaction_id=t.id) s ON true
  ) SELECT jsonb_build_object('success',true,'access_expires_at',v_gate->'access_expires_at','rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY created_at DESC,id DESC) FROM rows r),'[]'::jsonb),
   'next_cursor',CASE WHEN (SELECT count(*) FROM page)>25 THEN (SELECT jsonb_build_object('before',created_at,'id',id) FROM visible ORDER BY created_at,id LIMIT 1) END) INTO v_result;
 END IF;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_operator_provider_review(text,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_operator_provider_review(text,timestamptz,uuid) TO authenticated;

-- Settlement replacement follows. No balances or historical payloads are rewritten.

CREATE OR REPLACE FUNCTION public.settle_gateway_deposit(
  p_reference TEXT,
  p_provider TEXT,
  p_amount_kobo_or_ngn NUMERIC,
  p_gateway_ref TEXT,
  p_raw_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean_ref TEXT := NULLIF(TRIM(COALESCE(p_reference, '')), '');
  v_clean_provider TEXT := LOWER(TRIM(COALESCE(p_provider, '')));
  v_tx RECORD;
  v_settled_ngn NUMERIC(14, 2);
  v_old_balance NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
BEGIN
  IF v_clean_ref IS NULL THEN
    RAISE EXCEPTION 'Transaction reference (p_reference) is required.';
  END IF;

  IF v_clean_provider NOT IN ('paystack', 'flutterwave') THEN
    RAISE EXCEPTION 'Unsupported gateway provider: %.', v_clean_provider;
  END IF;

  -- Validate raw units before NUMERIC(14,2) can round or overflow them.
  IF p_amount_kobo_or_ngn IS NULL OR p_amount_kobo_or_ngn::text IN ('NaN','Infinity','-Infinity')
     OR p_amount_kobo_or_ngn <= 0
     OR (v_clean_provider = 'paystack' AND (p_amount_kobo_or_ngn <> trunc(p_amount_kobo_or_ngn) OR p_amount_kobo_or_ngn > 99999999999999))
     OR (v_clean_provider = 'flutterwave' AND (p_amount_kobo_or_ngn <> round(p_amount_kobo_or_ngn,2) OR p_amount_kobo_or_ngn > 999999999999.99)) THEN
    RAISE EXCEPTION 'INVALID_GATEWAY_AMOUNT';
  END IF;

  v_settled_ngn := CASE
    WHEN v_clean_provider = 'paystack' THEN ROUND(p_amount_kobo_or_ngn / 100.0, 2)
    ELSE ROUND(p_amount_kobo_or_ngn, 2)
  END;

  SELECT id, wallet_id, user_id, type, category, amount, fee, status, gateway_provider, gateway_reference
  INTO v_tx
  FROM public.transactions
  WHERE reference = v_clean_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending deposit transaction not found for reference: %.', v_clean_ref;
  END IF;

  IF v_tx.type <> 'inflow' OR v_tx.category <> 'deposit' OR v_tx.gateway_provider IS DISTINCT FROM v_clean_provider THEN
    RAISE EXCEPTION 'GATEWAY_PROVIDER_OR_DEPOSIT_MISMATCH';
  END IF;
  IF NULLIF(TRIM(p_gateway_ref), '') IS NULL THEN
    RAISE EXCEPTION 'GATEWAY_RECEIPT_REQUIRED';
  END IF;
  IF p_amount_kobo_or_ngn::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'INVALID_GATEWAY_AMOUNT';
  END IF;
  IF v_settled_ngn IS DISTINCT FROM v_tx.amount THEN
    RAISE EXCEPTION 'Gateway amount mismatch for %: expected %, received %.', v_clean_ref, v_tx.amount, v_settled_ngn;
  END IF;
  -- Current checkout promises full credit and creates a zero customer fee.
  -- Merchant processing costs must not be silently charged to the customer.
  IF v_tx.fee IS DISTINCT FROM 0::numeric THEN
    RAISE EXCEPTION 'DEPOSIT_FEE_POLICY_UNSUPPORTED';
  END IF;
  IF v_tx.status = 'successful' AND v_tx.gateway_reference IS DISTINCT FROM trim(p_gateway_ref) THEN
    RAISE EXCEPTION 'GATEWAY_RECEIPT_CONFLICT';
  END IF;
  IF v_clean_provider='paystack' THEN
    PERFORM private.observe_paystack_charge(v_tx.id,trim(p_gateway_ref),p_amount_kobo_or_ngn,p_raw_payload);
  END IF;
  IF v_tx.status = 'successful' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_settled', true,
      'tx_id', v_tx.id,
      'reference', v_clean_ref,
      'provider', v_clean_provider
    );
  END IF;

  IF v_tx.type <> 'inflow' THEN
    RAISE EXCEPTION 'Transaction % is not an inflow deposit record.', v_clean_ref;
  END IF;

  IF v_tx.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % cannot be settled from status %.', v_clean_ref, v_tx.status;
  END IF;


  SELECT balance INTO v_old_balance
  FROM public.wallets
  WHERE id = v_tx.wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target wallet (%) not found for transaction %.', v_tx.wallet_id, v_clean_ref;
  END IF;

  v_new_balance := ROUND(v_old_balance + v_tx.amount, 2);

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = v_new_balance,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_tx.wallet_id;

  UPDATE public.transactions
  SET status = 'successful',
      gateway_provider = v_clean_provider,
      gateway_reference = COALESCE(NULLIF(TRIM(p_gateway_ref), ''), v_clean_ref),
      webhook_payload = COALESCE(p_raw_payload, '{}'::JSONB),
      balance_before = v_old_balance,
      balance_after = v_new_balance
  WHERE id = v_tx.id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    NULL, 'system', v_tx.user_id, 'SETTLE_GATEWAY_DEPOSIT', 'transactions', v_tx.id::TEXT,
    'Verified ' || INITCAP(v_clean_provider) || ' webhook deposit settlement',
    jsonb_build_object('status', v_tx.status, 'wallet_balance', v_old_balance),
    jsonb_build_object('status', 'successful', 'wallet_balance', v_new_balance, 'amount_ngn', v_tx.amount, 'settled_ngn', v_settled_ngn, 'provider', v_clean_provider, 'gateway_ref', p_gateway_ref, 'reference', v_clean_ref)
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_settled', false,
    'tx_id', v_tx.id,
    'wallet_id', v_tx.wallet_id,
    'user_id', v_tx.user_id,
    'reference', v_clean_ref,
    'provider', v_clean_provider,
    'credited_amount', v_tx.amount,
    'old_balance', v_old_balance,
    'new_balance', v_new_balance
  );
END;
$$;


COMMIT;
