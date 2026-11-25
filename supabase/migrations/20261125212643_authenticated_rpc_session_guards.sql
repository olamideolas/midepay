BEGIN;
-- Session-guard remaining authenticated-only record/administration entrypoints.
-- Explicit allowlist: never wrap anonymous waitlist intake or service settlement jobs.
DO $migration$
DECLARE fn record; identity_args text; declaration_args text; call_args text; return_type text; core_name text; gate text; statement text; wrapped integer:=0; service_allowed boolean;
BEGIN
 FOR fn IN SELECT p.*,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
 'admin_set_account_freeze','ensure_my_profile_and_wallet','get_email_verification_status',
 'get_operator_provider_review','get_refund_adjustment_queue','get_treasury_credit_queue',
 'log_virtual_card_reveal','lookup_recipient_profile','respond_payment_request',
 'save_beneficiary','set_virtual_card_freeze','set_virtual_card_limit','verify_wallet_ledger_reconciliation'])
 LOOP
  IF NOT fn.prosecdef OR NOT has_function_privilege('authenticated',fn.oid,'EXECUTE') OR has_function_privilege('anon',fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'Unexpected RPC privileges: %',fn.proname; END IF;
  service_allowed:=has_function_privilege('service_role',fn.oid,'EXECUTE');
  wrapped:=wrapped+1;
  identity_args:=pg_get_function_identity_arguments(fn.oid);
  declaration_args:=pg_get_function_arguments(fn.oid);
  return_type:=pg_get_function_result(fn.oid);
  SELECT coalesce(string_agg(format('%I',fn.proargnames[i]),',' ORDER BY i),'') INTO call_args FROM generate_series(1,fn.pronargs) AS i;
  core_name:='session_guarded_'||fn.proname;
  -- Rename first so an existing private function with the public name cannot collide.
  EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I',fn.proname,identity_args,core_name);
  EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA private',core_name,identity_args);
  EXECUTE format('REVOKE ALL ON FUNCTION private.%I(%s) FROM PUBLIC,anon,authenticated,service_role',core_name,identity_args);
  IF fn.prorettype='jsonb'::regtype THEN
   gate:='RETURN jsonb_build_object(''success'',false,''code'',''SESSION_REQUIRED'',''error'',''Sign in again before continuing.'');';
   statement:=format('RETURN private.%I(%s);',core_name,call_args);
  ELSIF fn.proretset THEN
   gate:='RETURN;'; statement:=format('RETURN QUERY SELECT * FROM private.%I(%s);',core_name,call_args);
  ELSE
   gate:='RAISE EXCEPTION ''SESSION_REQUIRED'' USING ERRCODE=''42501'';';
   statement:=format('RETURN private.%I(%s);',core_name,call_args);
  END IF;
  EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql %s SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $guard$ BEGIN IF NOT (coalesce(current_setting(''role'',true),'''')=''service_role'' AND %s) AND NOT private.has_active_auth_session() THEN %s END IF; %s END; $guard$',fn.proname,declaration_args,return_type,CASE WHEN fn.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,CASE WHEN service_allowed THEN 'TRUE' ELSE 'FALSE' END,gate,statement);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,service_role',fn.proname,identity_args);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',fn.proname,identity_args);
  IF service_allowed THEN EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',fn.proname,identity_args); END IF;
 END LOOP;
 IF wrapped<>13 THEN RAISE EXCEPTION 'Expected 13 authenticated RPCs; found %',wrapped; END IF;
END;
$migration$;
COMMIT;
