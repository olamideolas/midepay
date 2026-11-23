BEGIN;
ALTER TABLE private.refund_adjustment_requests DROP CONSTRAINT refund_adjustment_requests_status_check;
ALTER TABLE private.refund_adjustment_requests ADD CONSTRAINT refund_adjustment_requests_status_check CHECK(status IN ('pending','applied','manual_review','cancelled'));
CREATE FUNCTION public.cancel_refund_adjustment(p_request_id uuid,p_reason text,p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE r private.refund_adjustment_requests%ROWTYPE;c jsonb;v_owner uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_executive() THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 SELECT * INTO r FROM private.refund_adjustment_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
 SELECT user_id INTO v_owner FROM transactions WHERE id=r.transaction_id;
 -- Same profile -> charge advisory lock -> request lock order as approval.
 PERFORM id FROM profiles WHERE id IN (auth.uid(),r.maker_id,v_owner) ORDER BY id FOR UPDATE;
 c:=public._treasury_actor_check(p_pin);
 IF NOT coalesce((c->>'ok')::boolean,false) THEN RETURN c||jsonb_build_object('success',false); END IF;
 IF auth.uid()<>r.maker_id OR auth.uid()=v_owner THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 5 AND 500 THEN RETURN jsonb_build_object('success',false,'code','INVALID_REASON'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('refund-accounting'),hashtext(r.transaction_id::text));
 SELECT * INTO r FROM private.refund_adjustment_requests WHERE id=p_request_id FOR UPDATE;
 IF r.status='cancelled' THEN RETURN jsonb_build_object('success',true,'status','duplicate','wallet_changed',false); END IF;
 IF r.status NOT IN ('pending','manual_review') OR EXISTS(SELECT 1 FROM private.refund_adjustment_journal WHERE request_id=r.id) THEN RETURN jsonb_build_object('success',false,'code','REQUEST_ALREADY_APPLIED'); END IF;
 UPDATE private.refund_adjustment_requests SET status='cancelled' WHERE id=r.id;
 INSERT INTO audit_logs(actor_id,actor_role,target_user_id,action,entity_type,entity_id,reason,old_data,new_data)
 VALUES(auth.uid(),'executive',v_owner,'REFUND_ADJUSTMENT_CANCELLED','refund_adjustment_requests',r.id::text,trim(p_reason),jsonb_build_object('status',r.status,'review_code',r.review_code),jsonb_build_object('status','cancelled','wallet_changed',false));
 RETURN jsonb_build_object('success',true,'status','cancelled','wallet_changed',false);
END;$$;
REVOKE ALL ON FUNCTION public.cancel_refund_adjustment(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_refund_adjustment(uuid,text,text) TO authenticated;
COMMIT;
