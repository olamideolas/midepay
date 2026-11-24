BEGIN;
-- Preserve existing payment identities; only new queued references change.
CREATE OR REPLACE FUNCTION private.queue_payout_dispatch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
BEGIN
 IF NEW.gateway_provider='paystack' AND NEW.type='outflow' AND NEW.category='transfer' AND NEW.status='pending' AND NEW.reference~'^mdp-out-[a-f0-9]{40}$' THEN
  INSERT INTO private.payout_dispatch_outbox(transaction_id) VALUES(NEW.id);
 END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.enqueue_wallet_payout(p_user_id uuid,p_amount numeric,p_fee numeric,p_reference text,p_provider text,p_counterparty_name text,p_counterparty_bank text,p_counterparty_nuban text,p_narration text DEFAULT 'Transfer via MidePay')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_result jsonb; v_ref text; v_hash text;
BEGIN
 PERFORM 1 FROM private.payment_reconciliation_control WHERE singleton AND enabled AND payout_dispatch_enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYOUT_DISPATCH_DISABLED'; END IF;
 IF p_provider IS DISTINCT FROM 'paystack' THEN RAISE EXCEPTION 'PAYOUT_PROVIDER_NOT_SUPPORTED'; END IF;
 -- Keep existing legacy references idempotent; new requests use a bounded, opaque reference.
 IF nullif(trim(p_reference),'') IS NULL OR length(p_reference)>200 THEN RAISE EXCEPTION 'INVALID_PAYOUT_REFERENCE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('payout-request'),hashtext(p_reference));
 v_hash:=substr(encode(digest(p_reference,'sha256'),'hex'),1,40);
 -- Preserve existing reference identity, including the prior hashed format.
 v_ref:=CASE
 WHEN EXISTS(SELECT 1 FROM transactions WHERE reference=p_reference) THEN p_reference
 WHEN EXISTS(SELECT 1 FROM transactions WHERE reference='MDP-OUT-'||v_hash) THEN 'MDP-OUT-'||v_hash
 ELSE 'mdp-out-'||v_hash END;
 v_result:=public.debit_wallet_for_payout(p_user_id,p_amount,p_fee,v_ref,p_provider,p_counterparty_name,p_counterparty_bank,p_counterparty_nuban,p_narration);
 RETURN v_result||jsonb_build_object('dispatch_status',coalesce((SELECT o.state FROM private.payout_dispatch_outbox o JOIN transactions t ON t.id=o.transaction_id WHERE t.reference=v_ref),'legacy_review'));
END;
$$;

COMMIT;
