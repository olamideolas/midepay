BEGIN;
-- Keep existing verification, PIN, role and maker/checker logic behind session gates.
ALTER FUNCTION public._assert_verified_wallet_ready(uuid,text,boolean) SET SCHEMA private;
ALTER FUNCTION private._assert_verified_wallet_ready(uuid,text,boolean) RENAME TO wallet_ready_authorized;
REVOKE ALL ON FUNCTION private.wallet_ready_authorized(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._assert_verified_wallet_ready(p_user_id uuid,p_action text DEFAULT 'FINANCIAL_MUTATION',p_allow_self_frozen boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT private.has_active_auth_session() THEN RETURN jsonb_build_object('ok',false,'success',false,'code','SESSION_REQUIRED','error','Sign in again before continuing.'); END IF;
 RETURN private.wallet_ready_authorized(p_user_id,p_action,p_allow_self_frozen);
END;$$;
REVOKE ALL ON FUNCTION public._assert_verified_wallet_ready(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public._treasury_actor_check(text) SET SCHEMA private;
ALTER FUNCTION private._treasury_actor_check(text) RENAME TO treasury_actor_authorized;
REVOKE ALL ON FUNCTION private.treasury_actor_authorized(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._treasury_actor_check(p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT private.has_active_auth_session() THEN RETURN jsonb_build_object('ok',false,'success',false,'code','SESSION_REQUIRED','error','Sign in again before continuing.'); END IF;
 RETURN private.treasury_actor_authorized(p_pin);
END;$$;
REVOKE ALL ON FUNCTION public._treasury_actor_check(text) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.set_user_transaction_pin(text,text) SET SCHEMA private;
ALTER FUNCTION private.set_user_transaction_pin(text,text) RENAME TO set_transaction_pin_authorized;
REVOKE ALL ON FUNCTION private.set_transaction_pin_authorized(text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.set_user_transaction_pin(p_new_pin text,p_current_pin text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT private.has_active_auth_session() THEN RETURN jsonb_build_object('success',false,'code','SESSION_REQUIRED','error','Sign in again before continuing.'); END IF;
 RETURN private.set_transaction_pin_authorized(p_new_pin,p_current_pin);
END;$$;
REVOKE ALL ON FUNCTION public.set_user_transaction_pin(text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.set_user_transaction_pin(text,text) TO authenticated;

ALTER FUNCTION public.verify_user_transaction_pin(text) SET SCHEMA private;
ALTER FUNCTION private.verify_user_transaction_pin(text) RENAME TO verify_transaction_pin_authorized;
REVOKE ALL ON FUNCTION private.verify_transaction_pin_authorized(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.verify_user_transaction_pin(p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT private.has_active_auth_session() THEN RETURN jsonb_build_object('success',false,'code','SESSION_REQUIRED','error','Sign in again before continuing.'); END IF;
 RETURN private.verify_transaction_pin_authorized(p_pin);
END;$$;
REVOKE ALL ON FUNCTION public.verify_user_transaction_pin(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.verify_user_transaction_pin(text) TO authenticated;

ALTER FUNCTION public.record_verified_login_session(jsonb) SET SCHEMA private;
ALTER FUNCTION private.record_verified_login_session(jsonb) RENAME TO record_login_authorized;
REVOKE ALL ON FUNCTION private.record_login_authorized(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_verified_login_session(p_device_metadata jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT private.has_active_auth_session() THEN RETURN jsonb_build_object('success',false,'code','SESSION_REQUIRED','error','Sign in again before continuing.'); END IF;
 RETURN private.record_login_authorized(p_device_metadata);
END;$$;
REVOKE ALL ON FUNCTION public.record_verified_login_session(jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_verified_login_session(jsonb) TO authenticated;

-- Restrictive policy intersects, rather than replaces, all existing ownership rules.
-- Service-only jobs keep their established BYPASSRLS/service-role path.
DO $$ DECLARE relation record;
BEGIN
 FOR relation IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity LOOP
  EXECUTE format('CREATE POLICY midepay_active_session ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.has_current_auth_session())) WITH CHECK ((SELECT public.has_current_auth_session()))',relation.relname);
 END LOOP;
END;$$;
COMMIT;
