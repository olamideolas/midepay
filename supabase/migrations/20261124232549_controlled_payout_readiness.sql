BEGIN;
CREATE FUNCTION public.get_test_payout_availability() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
 SELECT jsonb_build_object('session_active',private.has_active_auth_session(),
 'dispatch_enabled',EXISTS(SELECT 1 FROM private.payment_reconciliation_control WHERE singleton AND enabled AND payout_dispatch_enabled))
$$;
REVOKE ALL ON FUNCTION public.get_test_payout_availability() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_test_payout_availability() TO authenticated;
CREATE OR REPLACE FUNCTION public.authorize_scoped_test_payout(p_transaction_id uuid,p_test_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.transactions t
 WHERE t.id=p_transaction_id AND t.user_id=p_test_user_id AND t.type='outflow'
 AND t.category='transfer' AND t.gateway_provider='paystack' AND t.status='pending'
 AND t.amount>=50 AND t.fee>=0 AND t.amount+t.fee<=100
 AND t.counterparty_bank='057' AND t.counterparty_tag_or_nuban='1000000001'
 AND t.reference~'^mdp-out-[a-f0-9]{40}$')
$$;
COMMIT;
