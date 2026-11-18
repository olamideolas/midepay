-- Network request queues can be visible on hosted pg_net. Never enqueue a reusable credential.
BEGIN;
ALTER TABLE private.payment_reconciliation_control RENAME COLUMN token_hash TO signing_key;
ALTER TABLE private.payment_reconciliation_control ADD COLUMN last_invocation_at bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION public.authorize_payment_reconciliation(p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_time bigint; v_signature bytea; v_ok boolean;
BEGIN
 IF p_token IS NULL OR p_token!~'^[0-9]{10}\.[a-f0-9]{64}$' THEN RETURN false; END IF;
 v_time:=split_part(p_token,'.',1)::bigint;
 IF abs(extract(epoch FROM clock_timestamp())-v_time)>60 THEN RETURN false; END IF;
 v_signature:=decode(split_part(p_token,'.',2),'hex');
 -- Atomic consumption: concurrent/replayed invocations cannot authorize twice.
 UPDATE private.payment_reconciliation_control SET last_invocation_at=v_time
 WHERE singleton AND enabled AND last_invocation_at<v_time
 AND hmac(convert_to('midepay-reconcile:v1:'||v_time::text,'UTF8'),signing_key,'sha256')=v_signature
 RETURNING true INTO v_ok;
 RETURN coalesce(v_ok,false);
END;
$$;
CREATE FUNCTION private.build_reconciliation_authorization() RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
 SELECT 'Bearer '||t.epoch::text||'.'||encode(hmac(convert_to('midepay-reconcile:v1:'||t.epoch::text,'UTF8'),c.signing_key,'sha256'),'hex')
 FROM private.payment_reconciliation_control c
 CROSS JOIN (SELECT floor(extract(epoch FROM clock_timestamp()))::bigint AS epoch) t
 WHERE c.singleton AND c.enabled
$$;
REVOKE ALL ON FUNCTION private.build_reconciliation_authorization() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.authorize_payment_reconciliation(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_payment_reconciliation(text) TO service_role;
COMMIT;
