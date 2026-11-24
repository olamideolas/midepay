BEGIN;
CREATE FUNCTION private.has_active_auth_session() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE claims jsonb;sid text;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 BEGIN claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
 sid:=claims->>'session_id';
 IF sid IS NULL OR sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=sid::uuid AND s.user_id=auth.uid() AND (s.not_after IS NULL OR s.not_after>statement_timestamp()));
END;$$;
REVOKE ALL ON FUNCTION private.has_active_auth_session() FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the existing role/email/freeze/recent-MFA checks behind the new gate.
ALTER FUNCTION public.get_operator_payment_review(text,timestamptz,uuid) SET SCHEMA private;
ALTER FUNCTION private.get_operator_payment_review(text,timestamptz,uuid) RENAME TO operator_payment_review_authorized;
REVOKE ALL ON FUNCTION private.operator_payment_review_authorized(text,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_operator_payment_review(p_filter text DEFAULT 'attention',p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NOT private.has_active_auth_session() THEN RETURN jsonb_build_object('success',false,'code','SESSION_REQUIRED'); END IF;
 RETURN private.operator_payment_review_authorized(p_filter,p_before,p_before_id);
END;$$;
REVOKE ALL ON FUNCTION public.get_operator_payment_review(text,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_operator_payment_review(text,timestamptz,uuid) TO authenticated;
COMMIT;
