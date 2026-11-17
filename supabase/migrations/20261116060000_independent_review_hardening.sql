-- Independent review corrections. Apply only to an isolated staging database first.
-- Preserve the original ten migrations; this incremental migration also repairs existing v4.6 installs.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gateway_deposit_receipt
 ON public.transactions(gateway_provider,gateway_reference)
 WHERE type='inflow' AND category='deposit' AND status='successful' AND gateway_reference IS NOT NULL;
ALTER TABLE public.wallets ADD CONSTRAINT chk_wallet_finite
 CHECK(balance::text NOT IN ('NaN','Infinity','-Infinity') AND ledger_balance::text NOT IN ('NaN','Infinity','-Infinity'));
ALTER TABLE public.transactions ADD CONSTRAINT chk_transaction_finite
 CHECK(amount::text NOT IN ('NaN','Infinity','-Infinity') AND fee::text NOT IN ('NaN','Infinity','-Infinity'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_fulfilled_tx ON public.payment_requests(fulfilled_tx_id) WHERE fulfilled_tx_id IS NOT NULL;
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

  IF p_amount_kobo_or_ngn IS NULL OR p_amount_kobo_or_ngn <= 0 THEN
    RAISE EXCEPTION 'Settled gateway amount must be greater than zero.';
  END IF;

  v_settled_ngn := CASE
    WHEN v_clean_provider = 'paystack' THEN ROUND(p_amount_kobo_or_ngn / 100.0, 2)
    ELSE ROUND(p_amount_kobo_or_ngn, 2)
  END;

  SELECT id, wallet_id, user_id, type, category, amount, status, gateway_provider
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

  IF v_settled_ngn < v_tx.amount THEN
    RAISE EXCEPTION 'Gateway amount mismatch for %: expected ₦%, received ₦%.', v_clean_ref, v_tx.amount, v_settled_ngn;
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
  SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.email_otp_verified_at IS NULL
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

CREATE OR REPLACE FUNCTION public.enforce_immutable_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Compliance Violation: % records are immutable and cannot be deleted.', TG_TABLE_NAME;
  END IF;

  IF TG_TABLE_NAME IN ('audit_logs', 'security_audit_logs') AND TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Compliance Violation: % records are append-only and cannot be modified.', TG_TABLE_NAME;
  END IF;

  IF TG_TABLE_NAME = 'transactions' AND TG_OP = 'UPDATE' THEN
    IF OLD.category IS DISTINCT FROM NEW.category
       OR OLD.counterparty_user_id IS DISTINCT FROM NEW.counterparty_user_id
       OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
       OR OLD.idempotency_payload_hash IS DISTINCT FROM NEW.idempotency_payload_hash
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
       OR OLD.amount IS DISTINCT FROM NEW.amount
       OR OLD.fee <> NEW.fee
       OR OLD.wallet_id <> NEW.wallet_id
       OR OLD.user_id <> NEW.user_id
       OR OLD.type <> NEW.type
       OR OLD.reference <> NEW.reference THEN
      RAISE EXCEPTION 'Compliance Violation: Core financial fields on transactions are immutable.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_full_name TEXT;
  v_phone TEXT;
  v_base_handle TEXT;
  v_tag TEXT;
  v_tag_bytes BYTEA;
  v_nuban VARCHAR(10);
  v_wallet_id UUID;
BEGIN
  v_full_name := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '');
  IF v_full_name IS NULL THEN
    v_full_name := INITCAP(SPLIT_PART(COALESCE(NEW.email, 'MidePay Member'), '@', 1));
  END IF;

  v_phone := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'phone', '')), '');

  v_base_handle := LOWER(REGEXP_REPLACE(SPLIT_PART(v_full_name, ' ', 1), '[^a-zA-Z0-9]', '', 'g'));
  IF LENGTH(v_base_handle) < 3 THEN
    v_base_handle := 'member';
  END IF;

  v_tag := '@' || v_base_handle;
  WHILE EXISTS (SELECT 1 FROM public.profiles p WHERE LOWER(p.tag) = LOWER(v_tag) AND p.id <> NEW.id) LOOP
    v_tag_bytes := gen_random_bytes(2);
    v_tag := '@' || v_base_handle || LPAD((((get_byte(v_tag_bytes, 0) << 8) | get_byte(v_tag_bytes, 1)) % 10000)::TEXT, 4, '0');
  END LOOP;

  INSERT INTO public.profiles (
    id, full_name, email, phone, tag, kyc_tier, role, is_frozen, frozen_by_admin, email_otp_verified_at
  ) VALUES (
    NEW.id,
    v_full_name,
    COALESCE(NEW.email, NEW.id::TEXT || '@midepay.ng'),
    v_phone,
    v_tag,
    1,
    'user',
    FALSE,
    FALSE,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      phone = COALESCE(public.profiles.phone, EXCLUDED.phone),
      tag = COALESCE(public.profiles.tag, EXCLUDED.tag),
      updated_at = TIMEZONE('utc', NOW());

  v_nuban := public.generate_unique_midepay_nuban();

  INSERT INTO public.wallets (
    user_id, currency, balance, ledger_balance, nuban, bank_name
  ) VALUES (
    NEW.id, 'NGN', 0.00, 0.00, v_nuban, 'MidePay / Providus Bank'
  )
  ON CONFLICT (user_id, currency) DO UPDATE
  SET nuban = COALESCE(public.wallets.nuban, EXCLUDED.nuban),
      updated_at = TIMEZONE('utc', NOW())
  RETURNING id INTO v_wallet_id;

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, metadata
  ) VALUES (
    NEW.id, 'SIGNUP_PROVISIONED', 'info', 'wallets', v_wallet_id::TEXT,
    jsonb_build_object('nuban', v_nuban, 'tag', v_tag, 'kyc_tier', 1)
  );

  RETURN NEW;

END;
$$;
CREATE OR REPLACE FUNCTION public.finalize_payout_settlement(
  p_reference TEXT,
  p_gateway_ref TEXT DEFAULT NULL,
  p_raw_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean_ref TEXT := NULLIF(TRIM(COALESCE(p_reference, '')), '');
  v_tx RECORD;
BEGIN
  IF v_clean_ref IS NULL THEN
    RAISE EXCEPTION 'Payout reference is required.';
  END IF;

  SELECT id, wallet_id, user_id, type, amount, fee, status, gateway_reference, gateway_provider, category
  INTO v_tx
  FROM public.transactions
  WHERE reference = v_clean_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout transaction not found for reference: %.', v_clean_ref;
  END IF;

  IF v_tx.category <> 'transfer' OR v_tx.gateway_provider IS DISTINCT FROM
     (CASE p_raw_payload->>'event' WHEN 'transfer.success' THEN 'paystack'
       WHEN 'transfer.failed' THEN 'paystack' WHEN 'transfer.reversed' THEN 'paystack'
       WHEN 'transfer.completed' THEN 'flutterwave' ELSE NULL END) THEN
    RAISE EXCEPTION 'PAYOUT_PROVIDER_MISMATCH';
  END IF;
  IF v_tx.status = 'successful' THEN
    RETURN jsonb_build_object('success', true, 'already_settled', true, 'tx_id', v_tx.id, 'reference', v_clean_ref);
  END IF;

  IF v_tx.type <> 'outflow' OR v_tx.status <> 'pending' THEN
    RAISE EXCEPTION 'Payout % cannot transition to successful from % (%).', v_clean_ref, v_tx.status, v_tx.type;
  END IF;

  UPDATE public.transactions
  SET status = 'successful',
      gateway_reference = COALESCE(NULLIF(TRIM(p_gateway_ref), ''), v_tx.gateway_reference),
      webhook_payload = COALESCE(p_raw_payload, '{}'::JSONB)
  WHERE id = v_tx.id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    NULL, 'system', v_tx.user_id, 'FINALIZE_PAYOUT_SETTLEMENT', 'transactions', v_tx.id::TEXT,
    'Verified downstream NIP payout settlement webhook',
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'successful', 'gateway_ref', p_gateway_ref, 'reference', v_clean_ref)
  );

  RETURN jsonb_build_object('success', true, 'already_settled', false, 'tx_id', v_tx.id, 'reference', v_clean_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_failed_payout(
  p_reference TEXT,
  p_reason TEXT DEFAULT 'Downstream NIP bank payout reversed',
  p_raw_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tx RECORD;
  v_old_balance NUMERIC(14, 2);
  v_refund_total NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
BEGIN
  SELECT id, wallet_id, user_id, type, amount, fee, status, gateway_provider, category
  INTO v_tx
  FROM public.transactions
  WHERE reference = TRIM(COALESCE(p_reference, ''))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout transaction not found for reference: %.', p_reference;
  END IF;

  IF v_tx.category <> 'transfer' OR v_tx.gateway_provider IS DISTINCT FROM
     (CASE p_raw_payload->>'event' WHEN 'transfer.success' THEN 'paystack'
       WHEN 'transfer.failed' THEN 'paystack' WHEN 'transfer.reversed' THEN 'paystack'
       WHEN 'transfer.completed' THEN 'flutterwave' ELSE NULL END) THEN
    RAISE EXCEPTION 'PAYOUT_PROVIDER_MISMATCH';
  END IF;
  IF p_raw_payload->>'event' NOT IN ('transfer.failed','transfer.reversed','transfer.completed')
     OR (v_tx.status = 'successful' AND p_raw_payload->>'event' <> 'transfer.reversed') THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_REVERSAL_EVENT';
  END IF;
  IF v_tx.status = 'reversed' THEN
    RETURN jsonb_build_object('success', true, 'already_reversed', true, 'tx_id', v_tx.id, 'reference', p_reference);
  END IF;

  IF v_tx.type <> 'outflow' OR v_tx.status NOT IN ('pending', 'successful') THEN
    RAISE EXCEPTION 'Only pending or successful outflow payout transactions can be reversed (current status: %).', v_tx.status;
  END IF;

  v_refund_total := ROUND(v_tx.amount + COALESCE(v_tx.fee, 0), 2);

  SELECT balance INTO v_old_balance
  FROM public.wallets
  WHERE id = v_tx.wallet_id
  FOR UPDATE;

  v_new_balance := ROUND(v_old_balance + v_refund_total, 2);

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = v_new_balance,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_tx.wallet_id;

  UPDATE public.transactions
  SET status = 'reversed',
      webhook_payload = COALESCE(p_raw_payload, '{}'::JSONB)
  WHERE id = v_tx.id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    NULL, 'system', v_tx.user_id, 'REVERSE_FAILED_PAYOUT', 'transactions', v_tx.id::TEXT,
    COALESCE(p_reason, 'Downstream NIP bank payout reversed'),
    jsonb_build_object('status', v_tx.status, 'wallet_balance', v_old_balance),
    jsonb_build_object('status', 'reversed', 'wallet_balance', v_new_balance, 'refunded_amount', v_refund_total)
  );

  RETURN jsonb_build_object(
    'success', true,
    'already_reversed', false,
    'tx_id', v_tx.id,
    'reference', p_reference,
    'refunded_amount', v_refund_total,
    'old_balance', v_old_balance,
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

COMMIT;
