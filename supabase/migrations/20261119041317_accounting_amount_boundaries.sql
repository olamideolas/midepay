-- Exact monetary units and immutable settlement receipts. No historical balance updates.
BEGIN;
CREATE OR REPLACE FUNCTION public.settle_gateway_deposit(
  p_reference TEXT,
  p_provider TEXT,
  p_amount_kobo_or_ngn NUMERIC,
  p_gateway_ref TEXT,
  p_raw_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean_ref TEXT := NULLIF(TRIM(COALESCE(p_reference, '')), '');
  v_clean_provider TEXT := LOWER(TRIM(COALESCE(p_provider, '')));
  v_tx RECORD;
  v_settled_ngn NUMERIC(14, 2);
  v_old_balance NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
BEGIN
  IF v_clean_ref IS NULL THEN
    RAISE EXCEPTION 'Transaction reference (p_reference) is required.';
  END IF;

  IF v_clean_provider NOT IN ('paystack', 'flutterwave') THEN
    RAISE EXCEPTION 'Unsupported gateway provider: %.', v_clean_provider;
  END IF;

  -- Validate raw units before NUMERIC(14,2) can round or overflow them.
  IF p_amount_kobo_or_ngn IS NULL OR p_amount_kobo_or_ngn::text IN ('NaN','Infinity','-Infinity')
     OR p_amount_kobo_or_ngn <= 0
     OR (v_clean_provider = 'paystack' AND (p_amount_kobo_or_ngn <> trunc(p_amount_kobo_or_ngn) OR p_amount_kobo_or_ngn > 99999999999999))
     OR (v_clean_provider = 'flutterwave' AND (p_amount_kobo_or_ngn <> round(p_amount_kobo_or_ngn,2) OR p_amount_kobo_or_ngn > 999999999999.99)) THEN
    RAISE EXCEPTION 'INVALID_GATEWAY_AMOUNT';
  END IF;

  v_settled_ngn := CASE
    WHEN v_clean_provider = 'paystack' THEN ROUND(p_amount_kobo_or_ngn / 100.0, 2)
    ELSE ROUND(p_amount_kobo_or_ngn, 2)
  END;

  SELECT id, wallet_id, user_id, type, category, amount, fee, status, gateway_provider, gateway_reference
  INTO v_tx
  FROM public.transactions
  WHERE reference = v_clean_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending deposit transaction not found for reference: %.', v_clean_ref;
  END IF;

  IF v_tx.type <> 'inflow' OR v_tx.category <> 'deposit' OR v_tx.gateway_provider IS DISTINCT FROM v_clean_provider THEN
    RAISE EXCEPTION 'GATEWAY_PROVIDER_OR_DEPOSIT_MISMATCH';
  END IF;
  IF NULLIF(TRIM(p_gateway_ref), '') IS NULL THEN
    RAISE EXCEPTION 'GATEWAY_RECEIPT_REQUIRED';
  END IF;
  IF p_amount_kobo_or_ngn::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'INVALID_GATEWAY_AMOUNT';
  END IF;
  IF v_settled_ngn IS DISTINCT FROM v_tx.amount THEN
    RAISE EXCEPTION 'Gateway amount mismatch for %: expected %, received %.', v_clean_ref, v_tx.amount, v_settled_ngn;
  END IF;
  -- Current checkout promises full credit and creates a zero customer fee.
  -- Merchant processing costs must not be silently charged to the customer.
  IF v_tx.fee IS DISTINCT FROM 0::numeric THEN
    RAISE EXCEPTION 'DEPOSIT_FEE_POLICY_UNSUPPORTED';
  END IF;
  IF v_tx.status = 'successful' AND v_tx.gateway_reference IS DISTINCT FROM trim(p_gateway_ref) THEN
    RAISE EXCEPTION 'GATEWAY_RECEIPT_CONFLICT';
  END IF;
  IF v_tx.status = 'successful' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_settled', true,
      'tx_id', v_tx.id,
      'reference', v_clean_ref,
      'provider', v_clean_provider
    );
  END IF;

  IF v_tx.type <> 'inflow' THEN
    RAISE EXCEPTION 'Transaction % is not an inflow deposit record.', v_clean_ref;
  END IF;

  IF v_tx.status <> 'pending' THEN
    RAISE EXCEPTION 'Transaction % cannot be settled from status %.', v_clean_ref, v_tx.status;
  END IF;


  SELECT balance INTO v_old_balance
  FROM public.wallets
  WHERE id = v_tx.wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target wallet (%) not found for transaction %.', v_tx.wallet_id, v_clean_ref;
  END IF;

  v_new_balance := ROUND(v_old_balance + v_tx.amount, 2);

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = v_new_balance,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_tx.wallet_id;

  UPDATE public.transactions
  SET status = 'successful',
      gateway_provider = v_clean_provider,
      gateway_reference = COALESCE(NULLIF(TRIM(p_gateway_ref), ''), v_clean_ref),
      webhook_payload = COALESCE(p_raw_payload, '{}'::JSONB),
      balance_before = v_old_balance,
      balance_after = v_new_balance
  WHERE id = v_tx.id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    NULL, 'system', v_tx.user_id, 'SETTLE_GATEWAY_DEPOSIT', 'transactions', v_tx.id::TEXT,
    'Verified ' || INITCAP(v_clean_provider) || ' webhook deposit settlement',
    jsonb_build_object('status', v_tx.status, 'wallet_balance', v_old_balance),
    jsonb_build_object('status', 'successful', 'wallet_balance', v_new_balance, 'amount_ngn', v_tx.amount, 'settled_ngn', v_settled_ngn, 'provider', v_clean_provider, 'gateway_ref', p_gateway_ref, 'reference', v_clean_ref)
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_settled', false,
    'tx_id', v_tx.id,
    'wallet_id', v_tx.wallet_id,
    'user_id', v_tx.user_id,
    'reference', v_clean_ref,
    'provider', v_clean_provider,
    'credited_amount', v_tx.amount,
    'old_balance', v_old_balance,
    'new_balance', v_new_balance
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
  v_amt NUMERIC(14, 2);
  v_fee NUMERIC(14, 2);
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
  IF p_user_id IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount <= 0 OR p_amount <> round(p_amount,2) OR p_amount > 999999999999.99
     OR coalesce(p_fee,0)::text IN ('NaN','Infinity','-Infinity')
     OR coalesce(p_fee,0) < 0 OR coalesce(p_fee,0) <> round(coalesce(p_fee,0),2)
     OR coalesce(p_fee,0) > 999999999999.99 OR p_amount + coalesce(p_fee,0) > 999999999999.99 THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_AMOUNT_OR_FEE';
  END IF;
  v_amt := p_amount;
  v_fee := coalesce(p_fee,0);

  IF NULLIF(TRIM(p_reference), '') IS NULL OR p_provider IS NULL OR p_provider NOT IN ('paystack','flutterwave') THEN
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

-- Keep the existing server-only execution boundary explicit.
REVOKE ALL ON FUNCTION public.settle_gateway_deposit(text,text,numeric,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_gateway_deposit(text,text,numeric,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.debit_wallet_for_payout(uuid,numeric,numeric,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_wallet_for_payout(uuid,numeric,numeric,text,text,text,text,text,text) TO service_role;
COMMIT;
