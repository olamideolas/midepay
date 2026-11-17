-- Phase 1: trusted email proof and funded maker/checker treasury transfers.
-- LOCAL/STAGING ONLY until hosted Auth/MFA and independent-session gates pass.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE private.email_verification_proofs (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  auth_confirmed_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE private.email_verification_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.email_verification_proofs FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE private.email_otp_attempts (
 email_hash TEXT PRIMARY KEY,
 window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
 attempts INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE private.email_otp_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.email_otp_attempts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.consume_email_otp_attempt(p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp AS $$
DECLARE v_attempts INTEGER;
BEGIN
 INSERT INTO private.email_otp_attempts(email_hash,attempts) VALUES(encode(digest(lower(trim(p_email)),'sha256'),'hex'),1)
 ON CONFLICT(email_hash) DO UPDATE SET
 attempts=CASE WHEN private.email_otp_attempts.window_start<=now()-INTERVAL '10 minutes' THEN 1 ELSE least(private.email_otp_attempts.attempts+1,6) END,
 window_start=CASE WHEN private.email_otp_attempts.window_start<=now()-INTERVAL '10 minutes' THEN now() ELSE private.email_otp_attempts.window_start END
 RETURNING attempts INTO v_attempts;
 RETURN jsonb_build_object('allowed',v_attempts<=5);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_email_otp_attempt(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_email_otp_attempt(TEXT) TO service_role;

-- Prior client-attested timestamps are not independent email proof. Require re-verification.
UPDATE public.profiles SET email_otp_verified_at = NULL WHERE email_otp_verified_at IS NOT NULL;

CREATE FUNCTION public._has_verified_email_proof(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM private.email_verification_proofs p JOIN auth.users u ON u.id=p.user_id
 WHERE p.user_id=p_user_id AND lower(p.email)=lower(u.email)
   AND p.auth_confirmed_at=u.email_confirmed_at AND u.email_confirmed_at IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public._has_verified_email_proof(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- Only the email-code Edge verifier may call this using its server credential.
-- Caller-provided user IDs, timestamps and device metadata are never accepted as proof in client RPCs.
CREATE FUNCTION public.attest_verified_email(p_user_id UUID, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
DECLARE v_email TEXT; v_confirmed TIMESTAMPTZ;
BEGIN
 SELECT email,email_confirmed_at INTO v_email,v_confirmed FROM auth.users WHERE id=p_user_id FOR SHARE;
 IF NOT FOUND OR v_confirmed IS NULL OR lower(v_email) IS DISTINCT FROM lower(trim(p_email)) THEN
   RAISE EXCEPTION 'EMAIL_VERIFICATION_IDENTITY_MISMATCH';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id) THEN RAISE EXCEPTION 'PROFILE_MISSING'; END IF;
 DELETE FROM private.email_otp_attempts WHERE email_hash=encode(digest(lower(v_email),'sha256'),'hex');
 INSERT INTO private.email_verification_proofs(user_id,email,auth_confirmed_at)
 VALUES(p_user_id,lower(v_email),v_confirmed)
 ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email,auth_confirmed_at=EXCLUDED.auth_confirmed_at,verified_at=now();
 UPDATE public.profiles SET email_otp_verified_at=now() WHERE id=p_user_id;
 INSERT INTO public.security_audit_logs(user_id,event_type,severity,entity_type,entity_id,metadata)
 VALUES(p_user_id,'EMAIL_CODE_VERIFIED','info','profiles',p_user_id::text,'{"source":"server_email_otp_verifier"}');
 RETURN jsonb_build_object('success',true);
END;
$$;
REVOKE ALL ON FUNCTION public.attest_verified_email(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attest_verified_email(UUID,TEXT) TO service_role;

CREATE FUNCTION public.get_email_verification_status()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('verified',public._has_verified_email_proof(auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.get_email_verification_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_email_verification_status() TO authenticated,service_role;

-- Treasury wallets must be explicitly designated by a database owner following institutional
-- account review. No wallet is allowlisted or funded by this migration. Browser/service roles
-- cannot mutate this allowlist or the request table directly. Requests reserve nothing until approval.
CREATE TABLE private.treasury_wallets (
 wallet_id UUID PRIMARY KEY REFERENCES public.wallets(id),
 label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 2 AND 80),
 enabled BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE private.treasury_credit_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 maker_id UUID NOT NULL REFERENCES auth.users(id),
 checker_id UUID REFERENCES auth.users(id),
 source_wallet_id UUID NOT NULL REFERENCES public.wallets(id),
 target_user_id UUID NOT NULL REFERENCES auth.users(id),
 amount NUMERIC(14,2) NOT NULL CHECK(amount>0 AND amount<=10000000),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 5 AND 500),
 idempotency_key UUID NOT NULL,
 payload_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','cancelled')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+INTERVAL '24 hours',
 settled_at TIMESTAMPTZ,
 reference TEXT UNIQUE,
 UNIQUE(maker_id,idempotency_key),
 CHECK(maker_id IS DISTINCT FROM checker_id),
 CHECK(target_user_id<>maker_id AND target_user_id IS DISTINCT FROM checker_id)
);
ALTER TABLE private.treasury_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.treasury_credit_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.treasury_wallets,private.treasury_credit_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._treasury_actor_check(p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp AS $$
DECLARE v_claims JSONB; v_amr JSONB; v_stamp NUMERIC; v_recent BOOLEAN:=false;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_executive() THEN
   RETURN jsonb_build_object('ok',false,'code','FORBIDDEN','error','Executive authorization required.');
 END IF;
 v_claims:=COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 IF v_claims->>'aal' IS DISTINCT FROM 'aal2' OR jsonb_typeof(v_claims->'amr') IS DISTINCT FROM 'array' THEN
   RETURN jsonb_build_object('ok',false,'code','MFA_REQUIRED','error','Verify an authenticator code before treasury actions.');
 END IF;
 FOR v_amr IN SELECT value FROM jsonb_array_elements(v_claims->'amr') LOOP
   IF v_amr->>'method' IN ('totp','mfa/totp') AND (v_amr->>'timestamp') ~ '^[0-9]{1,12}$' THEN
     v_stamp:=(v_amr->>'timestamp')::numeric;
     IF v_stamp BETWEEN extract(epoch FROM now())-600 AND extract(epoch FROM now())+30 THEN v_recent:=true; END IF;
   END IF;
 END LOOP;
 IF NOT v_recent THEN RETURN jsonb_build_object('ok',false,'code','MFA_REQUIRED','error','Authenticator verification must be within 10 minutes.'); END IF;
 RETURN public._verify_pin_and_audit(auth.uid(),p_pin,'TREASURY_AUTHORIZATION',false);
END;
$$;
REVOKE ALL ON FUNCTION public._treasury_actor_check(TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.request_treasury_credit(
 p_source_wallet_id UUID,p_target_user_id UUID,p_amount NUMERIC,p_reason TEXT,p_idempotency_key UUID,p_pin TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp AS $$
DECLARE v_check JSONB; v_existing private.treasury_credit_requests%ROWTYPE; v_hash TEXT; v_id UUID; v_amt NUMERIC(14,2); v_reason TEXT:=trim(p_reason);
BEGIN
 v_check:=public._treasury_actor_check(p_pin);
 IF NOT COALESCE((v_check->>'ok')::boolean,false) THEN RETURN v_check||jsonb_build_object('success',false); END IF;
 IF p_idempotency_key IS NULL OR p_source_wallet_id IS NULL OR p_target_user_id IS NULL THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST','error','Source, recipient and stable UUID are required.'); END IF;
 IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<=0 OR p_amount>10000000 OR p_amount<>round(p_amount,2)
 OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 5 AND 500 THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_REQUEST','error','Use a positive amount with at most two decimals and a 5-500 character reason.'); END IF;
 v_amt:=p_amount;
 IF NOT EXISTS(SELECT 1 FROM private.treasury_wallets t JOIN public.wallets w ON w.id=t.wallet_id
   WHERE t.wallet_id=p_source_wallet_id AND t.enabled AND w.currency='NGN' AND w.user_id<>auth.uid() AND w.user_id<>p_target_user_id) THEN
 RETURN jsonb_build_object('success',false,'code','TREASURY_SOURCE_DISABLED','error','Designated institutional treasury wallet required.'); END IF;
 IF EXISTS(SELECT 1 FROM private.treasury_wallets t JOIN public.wallets w ON w.id=t.wallet_id WHERE w.user_id=p_target_user_id)
 OR p_target_user_id=auth.uid() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_target_user_id AND role<>'executive' AND NOT is_frozen AND NOT frozen_by_admin)
 OR NOT EXISTS(SELECT 1 FROM public.wallets WHERE user_id=p_target_user_id AND currency='NGN') THEN
 RETURN jsonb_build_object('success',false,'code','INVALID_RECIPIENT','error','An active non-executive recipient wallet is required.'); END IF;
 v_hash:=encode(digest(concat_ws(':','TREASURY',p_source_wallet_id,p_target_user_id,v_amt,v_reason),'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext(p_idempotency_key::text));
 SELECT * INTO v_existing FROM private.treasury_credit_requests WHERE maker_id=auth.uid() AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
 IF v_existing.payload_hash<>v_hash THEN RETURN jsonb_build_object('success',false,'code','IDEMPOTENCY_CONFLICT','error','Key was used for a different request.'); END IF;
 RETURN jsonb_build_object('success',true,'status','duplicate','request_id',v_existing.id,'request_status',v_existing.status);
 END IF;
 INSERT INTO private.treasury_credit_requests(maker_id,source_wallet_id,target_user_id,amount,reason,idempotency_key,payload_hash)
 VALUES(auth.uid(),p_source_wallet_id,p_target_user_id,v_amt,v_reason,p_idempotency_key,v_hash) RETURNING id INTO v_id;
 INSERT INTO public.security_audit_logs(user_id,event_type,severity,entity_type,entity_id,amount,metadata)
 VALUES(auth.uid(),'TREASURY_CREDIT_REQUESTED','warning','treasury_credit_requests',v_id::text,v_amt,jsonb_build_object('source_wallet_id',p_source_wallet_id,'target_user_id',p_target_user_id));
 RETURN jsonb_build_object('success',true,'status','pending','request_id',v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.request_treasury_credit(UUID,UUID,NUMERIC,TEXT,UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_treasury_credit(UUID,UUID,NUMERIC,TEXT,UUID,TEXT) TO authenticated;

CREATE FUNCTION public.approve_treasury_credit(p_request_id UUID,p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp AS $$
DECLARE v_check JSONB; v_req private.treasury_credit_requests%ROWTYPE; v_source public.wallets%ROWTYPE; v_target public.wallets%ROWTYPE; v_target_id UUID; v_ref TEXT;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_executive() THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 SELECT * INTO v_req FROM private.treasury_credit_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
 -- Consistent profile -> request -> wallet lock order. Lock all approval participants
 -- before PIN verification so freeze/revocation cannot race settlement.
 PERFORM id FROM public.profiles WHERE id IN (auth.uid(),v_req.maker_id,v_req.target_user_id,
   (SELECT user_id FROM public.wallets WHERE id=v_req.source_wallet_id)) ORDER BY id FOR UPDATE;
 v_check:=public._treasury_actor_check(p_pin);
 IF NOT COALESCE((v_check->>'ok')::boolean,false) THEN RETURN v_check||jsonb_build_object('success',false); END IF;
 SELECT * INTO v_req FROM private.treasury_credit_requests WHERE id=p_request_id FOR UPDATE;
 IF v_req.maker_id=auth.uid() OR v_req.target_user_id=auth.uid() THEN RETURN jsonb_build_object('success',false,'code','SEPARATION_OF_DUTIES','error','A different executive must approve.'); END IF;
 IF v_req.status='approved' THEN RETURN jsonb_build_object('success',true,'status','duplicate','reference',v_req.reference); END IF;
 IF v_req.status<>'pending' OR v_req.expires_at<=now() THEN RETURN jsonb_build_object('success',false,'code','REQUEST_NOT_PENDING'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_req.maker_id AND role='executive' AND NOT is_frozen AND NOT frozen_by_admin)
 OR NOT public._has_verified_email_proof(v_req.maker_id) THEN RETURN jsonb_build_object('success',false,'code','MAKER_NOT_AUTHORIZED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM private.treasury_wallets WHERE wallet_id=v_req.source_wallet_id AND enabled) THEN RETURN jsonb_build_object('success',false,'code','TREASURY_SOURCE_DISABLED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_req.target_user_id AND NOT is_frozen AND NOT frozen_by_admin AND role<>'executive') THEN RETURN jsonb_build_object('success',false,'code','INVALID_RECIPIENT'); END IF;
 SELECT id INTO v_target_id FROM public.wallets WHERE user_id=v_req.target_user_id AND currency='NGN';
 IF v_target_id IS NULL OR v_target_id=v_req.source_wallet_id THEN RETURN jsonb_build_object('success',false,'code','INVALID_RECIPIENT'); END IF;
 PERFORM id FROM public.wallets WHERE id IN (v_req.source_wallet_id,v_target_id) ORDER BY id FOR UPDATE;
 SELECT * INTO v_source FROM public.wallets WHERE id=v_req.source_wallet_id;
 SELECT * INTO v_target FROM public.wallets WHERE id=v_target_id;
 IF v_source.currency<>'NGN' OR v_source.user_id IN (auth.uid(),v_req.maker_id,v_req.target_user_id)
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_source.user_id AND NOT is_frozen AND NOT frozen_by_admin) THEN RETURN jsonb_build_object('success',false,'code','TREASURY_SOURCE_DISABLED'); END IF;
 IF NOT COALESCE((public.verify_wallet_ledger_reconciliation(v_source.id)->>'ok')::boolean,false)
 OR NOT COALESCE((public.verify_wallet_ledger_reconciliation(v_target.id)->>'ok')::boolean,false) THEN
 RETURN jsonb_build_object('success',false,'code','LEDGER_RECONCILIATION_REQUIRED'); END IF;
 IF v_source.balance<v_req.amount THEN RETURN jsonb_build_object('success',false,'code','INSUFFICIENT_TREASURY_FUNDS','error','Treasury wallet has insufficient settled funds.'); END IF;
 v_ref:='MDP-TRS-'||v_req.id::text;
 UPDATE public.wallets SET balance=balance-v_req.amount,ledger_balance=ledger_balance-v_req.amount,updated_at=now() WHERE id=v_source.id;
 UPDATE public.wallets SET balance=balance+v_req.amount,ledger_balance=ledger_balance+v_req.amount,updated_at=now() WHERE id=v_target.id;
 INSERT INTO public.transactions(wallet_id,user_id,counterparty_user_id,type,category,amount,fee,balance_before,balance_after,status,counterparty_name,reference,gateway_provider,metadata)
 VALUES(v_source.id,v_source.user_id,v_target.user_id,'outflow','transfer',v_req.amount,0,v_source.balance,v_source.balance-v_req.amount,'successful','Treasury disbursement',v_ref||'-OUT','internal',jsonb_build_object('treasury_request_id',v_req.id,'paired_reference',v_ref||'-IN')),
 (v_target.id,v_target.user_id,v_source.user_id,'inflow','admin_credit',v_req.amount,0,v_target.balance,v_target.balance+v_req.amount,'successful','Treasury transfer',v_ref||'-IN','internal',jsonb_build_object('treasury_request_id',v_req.id,'paired_reference',v_ref||'-OUT'));
 UPDATE private.treasury_credit_requests SET status='approved',checker_id=auth.uid(),settled_at=now(),reference=v_ref WHERE id=v_req.id;
 INSERT INTO public.audit_logs(actor_id,actor_role,target_user_id,action,entity_type,entity_id,reason,old_data,new_data)
 VALUES(auth.uid(),'executive',v_target.user_id,'TREASURY_CREDIT_APPROVED','treasury_credit_requests',v_req.id::text,v_req.reason,
 jsonb_build_object('source_balance',v_source.balance,'target_balance',v_target.balance),
 jsonb_build_object('maker_id',v_req.maker_id,'checker_id',auth.uid(),'amount',v_req.amount,'reference',v_ref,'source_balance',v_source.balance-v_req.amount,'target_balance',v_target.balance+v_req.amount));
 INSERT INTO public.security_audit_logs(user_id,event_type,severity,entity_type,entity_id,amount,metadata)
 VALUES(auth.uid(),'TREASURY_CREDIT_APPROVED','warning','treasury_credit_requests',v_req.id::text,v_req.amount,jsonb_build_object('maker_id',v_req.maker_id,'reference',v_ref));
 RETURN jsonb_build_object('success',true,'status','approved','reference',v_ref,'new_balance',v_target.balance+v_req.amount);
END;
$$;
REVOKE ALL ON FUNCTION public.approve_treasury_credit(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_treasury_credit(UUID,TEXT) TO authenticated;

CREATE FUNCTION public.cancel_treasury_credit(p_request_id UUID,p_pin TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp AS $$
DECLARE v_check JSONB; v_id UUID;
BEGIN
 v_check:=public._treasury_actor_check(p_pin);
 IF NOT COALESCE((v_check->>'ok')::boolean,false) THEN RETURN v_check||jsonb_build_object('success',false); END IF;
 UPDATE private.treasury_credit_requests SET status='cancelled' WHERE id=p_request_id AND maker_id=auth.uid() AND status='pending' RETURNING id INTO v_id;
 IF v_id IS NULL THEN RETURN jsonb_build_object('success',false,'code','NOT_PENDING_OR_NOT_MAKER'); END IF;
 INSERT INTO public.security_audit_logs(user_id,event_type,severity,entity_type,entity_id,metadata)
 VALUES(auth.uid(),'TREASURY_CREDIT_CANCELLED','info','treasury_credit_requests',v_id::text,'{}');
 RETURN jsonb_build_object('success',true,'status','cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_treasury_credit(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_treasury_credit(UUID,TEXT) TO authenticated;

CREATE FUNCTION public.get_treasury_credit_queue()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT public.is_executive() OR NOT public._has_verified_email_proof(auth.uid()) THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 RETURN jsonb_build_object('success',true,'wallets',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.wallet_id,'label',t.label,'balance',w.balance)) FROM private.treasury_wallets t JOIN public.wallets w ON w.id=t.wallet_id WHERE t.enabled),'[]'),
 'requests',COALESCE((SELECT jsonb_agg(to_jsonb(q) - 'payload_hash' - 'idempotency_key') FROM (SELECT * FROM private.treasury_credit_requests ORDER BY created_at DESC LIMIT 100) q),'[]'));
END;
$$;
REVOKE ALL ON FUNCTION public.get_treasury_credit_queue() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_treasury_credit_queue() TO authenticated;

-- Retain the legacy signature for diagnostics but never allow it to mint money.
CREATE OR REPLACE FUNCTION public.admin_credit_wallet(target_user_id UUID,amount NUMERIC,reason TEXT,p_idempotency_key UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp AS $$
BEGIN RETURN jsonb_build_object('success',false,'code','TREASURY_APPROVAL_REQUIRED','error','Use the funded treasury request and independent approval workflow.'); END;
$$;
REVOKE ALL ON FUNCTION public.admin_credit_wallet(UUID,NUMERIC,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._assert_verified_wallet_ready(
  p_user_id UUID,
  p_action TEXT DEFAULT 'FINANCIAL_MUTATION',
  p_allow_self_frozen BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_email_confirmed_at TIMESTAMPTZ;
  v_otp_verified_at TIMESTAMPTZ;
  v_tx_pin_hash TEXT;
  v_is_frozen BOOLEAN := FALSE;
  v_frozen_by_admin BOOLEAN := FALSE;
BEGIN
  IF v_caller IS NULL OR p_user_id IS NULL OR v_caller <> p_user_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'UNAUTHORIZED',
      'error', 'Active authenticated session required.'
    );
  END IF;

  IF EXISTS(SELECT 1 FROM private.treasury_wallets t JOIN public.wallets w ON w.id=t.wallet_id WHERE w.user_id=p_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','TREASURY_ACCOUNT_RESTRICTED','error','Institutional treasury funds require independent approval.');
  END IF;
  -- Gate 1A: Supabase Auth Email Confirmation Timestamp Check
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (v_caller, 'UNVERIFIED_EMAIL_BLOCKED', 'warning', 'auth.users', v_caller::TEXT, jsonb_build_object('action', p_action));
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Email verification required. Enter the 6-digit OTP sent to your email before transacting.'
    );
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed_at
  FROM auth.users
  WHERE id = v_caller;

  -- Gate 1B & Gate 2: Profile Existence, OTP Attestation, Freeze Interlock & Mandatory PIN
  SELECT transaction_pin_hash,
         COALESCE(is_frozen, FALSE),
         COALESCE(frozen_by_admin, FALSE),
         email_otp_verified_at
  INTO v_tx_pin_hash, v_is_frozen, v_frozen_by_admin, v_otp_verified_at
  FROM public.profiles
  WHERE id = v_caller;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PROFILE_MISSING',
      'error', 'Account security profile not found.'
    );
  END IF;

  IF v_otp_verified_at IS NULL OR NOT public._has_verified_email_proof(v_caller) THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (
      v_caller, 'UNVERIFIED_EMAIL_BLOCKED', 'warning', 'profiles', v_caller::TEXT,
      jsonb_build_object('action', p_action, 'reason', 'email_otp_session_not_attested')
    );
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Complete 6-digit Email OTP verification before transacting.'
    );
  END IF;

  IF v_frozen_by_admin IS TRUE OR (v_is_frozen IS TRUE AND p_allow_self_frozen IS NOT TRUE) THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (
      v_caller, 'FROZEN_ACCOUNT_BLOCKED', 'critical', 'profiles', v_caller::TEXT,
      jsonb_build_object('action', p_action, 'frozen_by_admin', v_frozen_by_admin)
    );
    RETURN jsonb_build_object(
      'ok', false,
      'is_frozen', true,
      'frozen_by_admin', v_frozen_by_admin,
      'code', 'ACCOUNT_FROZEN',
      'error', 'Account is currently frozen per CBN security directives. Outbound transactions are disabled.'
    );
  END IF;

  IF v_tx_pin_hash IS NULL OR NULLIF(TRIM(v_tx_pin_hash), '') IS NULL THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (v_caller, 'MISSING_PIN_BLOCKED', 'warning', 'profiles', v_caller::TEXT, jsonb_build_object('action', p_action));
    RETURN jsonb_build_object(
      'ok', false,
      'needs_pin_setup', true,
      'code', 'PIN_SETUP_REQUIRED',
      'error', 'Mandatory 4-digit Transaction PIN has not been created yet. Complete PIN setup to unlock your wallet.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'email_confirmed_at', v_email_confirmed_at,
    'email_otp_verified_at', v_otp_verified_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_transaction_pin(
  p_new_pin TEXT,
  p_current_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email_confirmed_at TIMESTAMPTZ;
  v_clean_new TEXT := TRIM(COALESCE(p_new_pin, ''));
  v_profile public.profiles%ROWTYPE;
  v_verify JSONB;
  v_new_hash TEXT;
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed_at
  FROM auth.users
  WHERE id = auth.uid();

  IF v_email_confirmed_at IS NULL THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (v_user_id, 'UNVERIFIED_EMAIL_BLOCKED', 'warning', 'auth.users', v_user_id::TEXT, jsonb_build_object('action', 'SET_PIN'));
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Verify your email with the 6-digit OTP before setting a Transaction PIN.'
    );
  END IF;

  IF v_clean_new !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction PIN must be exactly 4 numeric digits.');
  END IF;

  -- Lock profile row FOR UPDATE to prevent concurrent first-time PIN setup overwrite
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'PROFILE_MISSING', 'error', 'Account profile not found.');
  END IF;

  IF v_profile.is_frozen IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_FROZEN', 'error', 'Account is currently frozen. PIN changes are disabled.');
  END IF;

  IF v_profile.email_otp_verified_at IS NULL OR NOT public._has_verified_email_proof(v_user_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Complete 6-digit Email OTP login attestation before configuring a Transaction PIN.'
    );
  END IF;

  IF v_profile.transaction_pin_hash IS NOT NULL THEN
    v_verify := public._verify_pin_and_audit(v_user_id, p_current_pin, 'ROTATE_PIN', FALSE);
    IF COALESCE((v_verify->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', v_verify->>'code',
        'error', COALESCE(v_verify->>'error', 'Current PIN verification failed.')
      );
    END IF;
  END IF;

  v_new_hash := crypt(v_clean_new, gen_salt('bf', 10));

  UPDATE public.profiles
  SET transaction_pin_hash = v_new_hash,
      pin_hash = v_new_hash,
      pin_failed_attempts = 0,
      pin_locked_until = NULL,
      updated_at = v_now
  WHERE id = v_user_id;

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, metadata
  ) VALUES (
    v_user_id,
    CASE WHEN v_profile.transaction_pin_hash IS NULL THEN 'PIN_ONBOARDING_COMPLETED' ELSE 'PIN_ROTATED' END,
    'info',
    'profiles',
    v_user_id::TEXT,
    jsonb_build_object('is_initial_setup', (v_profile.transaction_pin_hash IS NULL))
  );

  RETURN jsonb_build_object('success', true, 'has_transaction_pin', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_verified_login_session(p_device_metadata JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email_confirmed_at TIMESTAMPTZ;
  v_user_created_at TIMESTAMPTZ;
  v_has_pin BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
  v_meta JSONB := COALESCE(p_device_metadata, '{}'::JSONB);
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT email_confirmed_at, created_at
  INTO v_email_confirmed_at, v_user_created_at
  FROM auth.users
  WHERE id = v_user_id;

  IF v_email_confirmed_at IS NULL THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (v_user_id, 'UNVERIFIED_LOGIN_BLOCKED', 'warning', 'auth.users', v_user_id::TEXT, v_meta);
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'email_confirmed', false,
      'error', 'Email address is not yet verified.'
    );
  END IF;

  IF NOT public._has_verified_email_proof(v_user_id) THEN
    RETURN jsonb_build_object('success',false,'code','EMAIL_OTP_REQUIRED','error','Verify a fresh email code before continuing.');
  END IF;
  UPDATE public.profiles
  SET last_login_at = v_now,
      last_login_device = v_meta,
      updated_at = v_now
  WHERE id = v_user_id
  RETURNING (
    transaction_pin_hash IS NOT NULL
    AND NULLIF(TRIM(transaction_pin_hash), '') IS NOT NULL
  ) INTO v_has_pin;

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, user_agent, metadata
  ) VALUES (
    v_user_id,
    'USER_LOGIN',
    'info',
    'profiles',
    v_user_id::TEXT,
    NULLIF(TRIM(COALESCE(v_meta->>'user_agent', '')), ''),
    v_meta || jsonb_build_object(
      'login_at', v_now,
      'email_confirmed_at', v_email_confirmed_at,
      'autoconfirm_suspected', (v_email_confirmed_at = v_user_created_at),
      'has_transaction_pin', COALESCE(v_has_pin, FALSE)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'login_at', v_now,
    'email_confirmed', true,
    'has_transaction_pin', COALESCE(v_has_pin, FALSE)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.debit_wallet_for_payout(
  p_user_id UUID,
  p_amount NUMERIC,
  p_fee NUMERIC,
  p_reference TEXT,
  p_provider TEXT,
  p_counterparty_name TEXT,
  p_counterparty_bank TEXT,
  p_counterparty_nuban TEXT,
  p_narration TEXT DEFAULT 'Transfer via MidePay'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_wallet_id UUID;
  v_old_balance NUMERIC(14, 2);
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_fee NUMERIC(14, 2) := GREATEST(0.00, ROUND(COALESCE(p_fee, 0), 2));
  v_total_debit NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
  v_tx_id UUID;
  v_is_frozen BOOLEAN;
  v_profile public.profiles%ROWTYPE;
  v_existing public.transactions%ROWTYPE;
  v_daily NUMERIC;
  v_single NUMERIC;
  v_limit NUMERIC;
BEGIN
  IF p_user_id IS NULL OR v_amt <= 0 OR v_amt::text IN ('NaN','Infinity','-Infinity') OR p_fee::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Valid user_id and positive payout amount are required.';
  END IF;

  IF NULLIF(TRIM(p_reference), '') IS NULL OR p_provider NOT IN ('paystack','flutterwave') THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_REFERENCE_OR_PROVIDER';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payout'), hashtext(p_reference));
  SELECT * INTO v_existing FROM public.transactions WHERE reference = p_reference;
  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id OR v_existing.type <> 'outflow'
       OR v_existing.category <> 'transfer' OR v_existing.amount IS DISTINCT FROM v_amt
       OR v_existing.fee IS DISTINCT FROM v_fee OR v_existing.gateway_provider IS DISTINCT FROM p_provider
       OR v_existing.counterparty_bank IS DISTINCT FROM p_counterparty_bank
       OR v_existing.counterparty_tag_or_nuban IS DISTINCT FROM p_counterparty_nuban THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('success',true,'already_debited',true,'reference',p_reference,'status',v_existing.status,'new_balance',v_existing.balance_after);
  END IF;
  IF EXISTS(SELECT 1 FROM private.treasury_wallets t JOIN public.wallets w ON w.id=t.wallet_id WHERE w.user_id=p_user_id) THEN
    RAISE EXCEPTION 'TREASURY_ACCOUNT_RESTRICTED';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.email_otp_verified_at IS NULL OR NOT public._has_verified_email_proof(p_user_id)
     OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'EMAIL_NOT_VERIFIED';
  END IF;
  IF v_profile.frozen_by_admin THEN RAISE EXCEPTION 'ACCOUNT_FROZEN'; END IF;
  v_single := CASE v_profile.kyc_tier WHEN 3 THEN 5000000 WHEN 2 THEN 250000 ELSE 50000 END;
  v_limit := CASE v_profile.kyc_tier WHEN 3 THEN 25000000 WHEN 2 THEN 1000000 ELSE 300000 END;
  IF v_amt > v_single THEN RAISE EXCEPTION 'KYC_SINGLE_LIMIT_EXCEEDED'; END IF;
  SELECT COALESCE(is_frozen, FALSE) INTO v_is_frozen
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  IF v_is_frozen THEN
    RAISE EXCEPTION 'Account is frozen per CBN AML/Fraud directives.';
  END IF;

  v_total_debit := ROUND(v_amt + v_fee, 2);

  SELECT id, balance INTO v_wallet_id, v_old_balance
  FROM public.wallets
  WHERE user_id = p_user_id AND currency = 'NGN'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active NGN wallet not found.';
  END IF;

  SELECT COALESCE(SUM(amount+fee),0) INTO v_daily FROM public.transactions
  WHERE wallet_id=v_wallet_id AND type='outflow' AND category='transfer'
    AND status IN ('pending','successful') AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC');
  IF v_daily + v_total_debit > v_limit THEN RAISE EXCEPTION 'KYC_DAILY_LIMIT_EXCEEDED'; END IF;
  IF v_old_balance < v_total_debit THEN
    RAISE EXCEPTION 'Insufficient wallet balance: available ₦%, required ₦%.',
      TRIM(TO_CHAR(v_old_balance, 'FM999,999,990.00')),
      TRIM(TO_CHAR(v_total_debit, 'FM999,999,990.00'));
  END IF;

  v_new_balance := ROUND(v_old_balance - v_total_debit, 2);

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = v_new_balance,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_wallet_id;

  -- Strictly enters ledger as `'pending'` until verified gateway settlement webhook!
  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, gateway_provider
  ) VALUES (
    v_wallet_id, p_user_id, 'outflow', 'transfer', v_amt, v_fee,
    v_old_balance, v_new_balance, 'pending',
    p_counterparty_name, p_counterparty_bank, p_counterparty_nuban,
    COALESCE(NULLIF(TRIM(p_narration), ''), 'Transfer via MidePay'),
    p_reference, LOWER(TRIM(p_provider))
  ) RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'tx_id', v_tx_id,
    'wallet_id', v_wallet_id,
    'reference', p_reference,
    'status', 'pending',
    'old_balance', v_old_balance,
    'new_balance', v_new_balance
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.ensure_my_profile_and_wallet(
  p_full_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_auth_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_profile public.profiles%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_nuban VARCHAR(10);
  v_name TEXT;
  v_tag TEXT;
  v_tag_bytes BYTEA;
  v_has_pin BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT email, email_confirmed_at
  INTO v_auth_email, v_email_confirmed_at
  FROM auth.users
  WHERE id = v_user_id;

  v_name := COALESCE(
    NULLIF(TRIM(p_full_name), ''),
    INITCAP(SPLIT_PART(COALESCE(v_auth_email, 'MidePay Member'), '@', 1))
  );

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    v_tag_bytes := gen_random_bytes(2);
    v_tag := '@' || LOWER(REGEXP_REPLACE(SPLIT_PART(v_name, ' ', 1), '[^a-zA-Z0-9]', '', 'g')) ||
             LPAD((((get_byte(v_tag_bytes, 0) << 8) | get_byte(v_tag_bytes, 1)) % 10000)::TEXT, 4, '0');

    INSERT INTO public.profiles (
      id, full_name, email, phone, tag, kyc_tier, role, is_frozen, frozen_by_admin
    ) VALUES (
      v_user_id,
      v_name,
      COALESCE(v_auth_email, v_user_id::TEXT || '@midepay.ng'),
      NULLIF(TRIM(p_phone), ''),
      v_tag,
      1,
      'user',
      FALSE,
      FALSE
    ) RETURNING * INTO v_profile;
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_user_id AND currency = 'NGN';

  IF NOT FOUND THEN
    v_nuban := public.generate_unique_midepay_nuban();
    INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
    VALUES (v_user_id, 'NGN', 0.00, 0.00, v_nuban, 'MidePay / Providus Bank')
    RETURNING * INTO v_wallet;
  ELSIF v_wallet.nuban IS NULL OR v_wallet.nuban !~ '^[0-9]{10}$' THEN
    v_nuban := public.generate_unique_midepay_nuban();
    UPDATE public.wallets
    SET nuban = v_nuban,
        bank_name = COALESCE(bank_name, 'MidePay / Providus Bank'),
        updated_at = TIMEZONE('utc', NOW())
    WHERE id = v_wallet.id
    RETURNING * INTO v_wallet;
  END IF;

  v_has_pin := (
    v_profile.transaction_pin_hash IS NOT NULL
    AND NULLIF(TRIM(v_profile.transaction_pin_hash), '') IS NOT NULL
  );

  RETURN jsonb_build_object(
    'profile', (to_jsonb(v_profile) - 'pin_hash' - 'transaction_pin_hash') || jsonb_build_object('has_transaction_pin', v_has_pin),
    'wallet', to_jsonb(v_wallet),
    'email_confirmed', (v_email_confirmed_at IS NOT NULL AND v_profile.email_otp_verified_at IS NOT NULL AND public._has_verified_email_proof(v_user_id)),
    'email_confirmed_at', v_email_confirmed_at,
    'email_otp_verified_at', v_profile.email_otp_verified_at,
    'has_transaction_pin', v_has_pin
  );
END;
$$;
ALTER FUNCTION public.prevent_security_audit_mutation() SET search_path TO public, extensions, pg_temp;
COMMIT;
