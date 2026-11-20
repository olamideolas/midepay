BEGIN;
CREATE FUNCTION public.get_refund_adjustment_queue() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE gate jsonb;result jsonb;
BEGIN
 gate:=public.get_operator_payment_review('attention');
 IF NOT coalesce((gate->>'success')::boolean,false) THEN RETURN gate; END IF;
 SELECT jsonb_build_object('success',true,'enabled',coalesce((SELECT enabled FROM private.refund_accounting_control),false),
 'access_expires_at',gate->'access_expires_at','viewer_id',auth.uid(),
 'verifications',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM (
 SELECT DISTINCT ON (v.provider_refund_id) v.id,v.provider_refund_id,v.amount_kobo,v.verified_at,t.reference,
 v.verified_at>now()-interval '24 hours' AS fresh,t.user_id=auth.uid() AS own_wallet
 FROM private.refund_verifications v JOIN transactions t ON t.id=v.transaction_id
 WHERE NOT EXISTS(SELECT 1 FROM private.refund_adjustment_requests r WHERE r.provider_refund_id=v.provider_refund_id)
 ORDER BY v.provider_refund_id,v.verified_at DESC,v.id DESC LIMIT 100) v),'[]'::jsonb),
 'requests',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (
 SELECT r.id,r.provider_refund_id,r.amount_kobo,r.status,r.review_code,r.maker_id,r.reason,r.created_at,r.expires_at,t.reference,
 (r.maker_id<>auth.uid() AND t.user_id<>auth.uid() AND r.status='pending' AND r.expires_at>now()) AS can_approve
 FROM private.refund_adjustment_requests r JOIN transactions t ON t.id=r.transaction_id ORDER BY r.created_at DESC,r.id DESC LIMIT 100) r),'[]'::jsonb)) INTO result;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.get_refund_adjustment_queue() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_refund_adjustment_queue() TO authenticated;
COMMIT;
