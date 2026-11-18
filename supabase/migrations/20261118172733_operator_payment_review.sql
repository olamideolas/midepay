BEGIN;
CREATE INDEX IF NOT EXISTS payment_review_order ON public.transactions(created_at DESC,id DESC) WHERE gateway_provider='paystack';
CREATE FUNCTION public.get_operator_payment_review(p_filter text DEFAULT 'attention',p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_claims jsonb;v_recent boolean:=false;v_amr jsonb;v_result jsonb;v_stamp numeric:=0;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_executive() OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND NOT is_frozen AND NOT frozen_by_admin) THEN
  RETURN jsonb_build_object('success',false,'code','FORBIDDEN');
 END IF;
 IF NOT public._has_verified_email_proof(auth.uid()) THEN RETURN jsonb_build_object('success',false,'code','EMAIL_VERIFICATION_REQUIRED'); END IF;
 v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 IF v_claims->>'aal'='aal2' AND jsonb_typeof(v_claims->'amr')='array' THEN
  FOR v_amr IN SELECT value FROM jsonb_array_elements(v_claims->'amr') LOOP
   IF v_amr->>'method' IN ('totp','mfa/totp') AND v_amr->>'timestamp'~'^[0-9]{1,12}$' THEN
    IF (v_amr->>'timestamp')::numeric BETWEEN extract(epoch FROM now())-600 AND extract(epoch FROM now())+30 THEN v_recent:=true;v_stamp:=greatest(v_stamp,(v_amr->>'timestamp')::numeric); END IF;
   END IF;
  END LOOP;
 END IF;
 IF NOT v_recent THEN RETURN jsonb_build_object('success',false,'code','MFA_REQUIRED'); END IF;
 IF p_filter IS NULL OR p_filter NOT IN ('attention','pending','all') THEN RETURN jsonb_build_object('success',false,'code','INVALID_FILTER'); END IF;
 IF (p_before IS NULL)<>(p_before_id IS NULL) THEN RETURN jsonb_build_object('success',false,'code','INVALID_CURSOR'); END IF;
 WITH scope AS (
  SELECT t.id,t.reference,t.created_at,t.amount,t.status,
   CASE WHEN t.type='inflow' THEN 'deposit' ELSE 'payout' END AS kind,
   CASE WHEN t.type='outflow' AND t.counterparty_tag_or_nuban~'^[0-9]{10}$' THEN '••••••'||right(t.counterparty_tag_or_nuban,4) ELSE NULL END AS masked_account,
   j.state AS recovery_state,coalesce(j.attempts,0) AS recovery_attempts,j.last_code AS recovery_code,j.next_check_at,
   o.state AS dispatch_state,coalesce(o.attempts,0) AS dispatch_attempts,o.last_code AS dispatch_code,
   o.dispatch_started_at IS NOT NULL AS may_have_been_sent,
   greatest(j.updated_at,o.updated_at) AS last_checked_at,
   (t.status='pending' AND (j.state='review' OR o.state='review' OR (t.type='outflow' AND o.transaction_id IS NULL))) IS TRUE AS needs_attention
  FROM transactions t LEFT JOIN private.payment_reconciliation_jobs j ON j.transaction_id=t.id
  LEFT JOIN private.payout_dispatch_outbox o ON o.transaction_id=t.id
  WHERE t.gateway_provider='paystack' AND ((t.type='inflow' AND t.category='deposit') OR (t.type='outflow' AND t.category='transfer'))
 ), filtered AS (
  SELECT * FROM scope WHERE p_filter='all' OR (p_filter='pending' AND status='pending') OR (p_filter='attention' AND needs_attention)
 ), page AS (
  SELECT * FROM filtered WHERE p_before IS NULL OR (created_at,id)<(p_before,p_before_id) ORDER BY created_at DESC,id DESC LIMIT 26
 ), visible AS (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT 25)
 SELECT jsonb_build_object('success',true,'checked_at',now(),'access_expires_at',to_timestamp(v_stamp+600),'summary',jsonb_build_object(
  'pending',(SELECT count(*) FROM scope WHERE status='pending'),'attention',(SELECT count(*) FROM scope WHERE needs_attention),
  'settled',(SELECT count(*) FROM scope WHERE status='successful'),'reversed',(SELECT count(*) FROM scope WHERE status='reversed')),
  'dispatch_enabled',coalesce((SELECT payout_dispatch_enabled FROM private.payment_reconciliation_control WHERE singleton),false),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC,v.id DESC) FROM visible v),'[]'::jsonb),
  'next_cursor',CASE WHEN (SELECT count(*) FROM page)>25 THEN (SELECT jsonb_build_object('before',created_at,'id',id) FROM visible ORDER BY created_at,id LIMIT 1) ELSE NULL END)
 INTO v_result;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_operator_payment_review(text,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_operator_payment_review(text,timestamptz,uuid) TO authenticated;
COMMIT;
