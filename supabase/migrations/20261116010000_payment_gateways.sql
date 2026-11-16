-- ============================================================================
-- MidePay v4.1 — Live Payment Gateways (Paystack & Flutterwave) & Webhook RPCs
-- Migration: 20261116010000_payment_gateways.sql
-- Target: PostgreSQL 15+ / Supabase (https://pxdzdehocjnmxbuvipxu.supabase.co)
-- ============================================================================

BEGIN;

-- 1. ADD GATEWAY COLUMNS & INDEXES TO `public.transactions`
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS gateway_provider TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS gateway_reference TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS webhook_payload JSONB;

DO $$ BEGIN
  ALTER TABLE public.transactions
  ADD CONSTRAINT chk_transactions_gateway_provider
  CHECK (gateway_provider IS NULL OR gateway_provider IN ('paystack', 'flutterwave', 'providus', 'internal'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_reference_idx
  ON public.transactions(reference);

CREATE INDEX IF NOT EXISTS idx_transactions_gateway_lookup
  ON public.transactions(gateway_provider, gateway_reference)
  WHERE gateway_provider IS NOT NULL;

-- ============================================================================
-- 2. ATOMIC `SECURITY DEFINER` WEBHOOK SETTLEMENT RPC (`settle_gateway_deposit`)
--    - Locks transaction row `FOR UPDATE`
--    - Enforces strict idempotency (never double-credits duplicate webhooks)
--    - Normalizes Paystack kobo vs Flutterwave NGN & validates paid >= expected
--    - Locks & credits `wallets.balance` and `wallets.ledger_balance`
--    - Writes append-only record to `public.audit_logs`
-- ============================================================================

CREATE OR REPLACE FUNCTION public.settle_gateway_deposit(
  p_reference TEXT,
  p_provider TEXT,
  p_amount_kobo_or_ngn NUMERIC,
  p_gateway_ref TEXT,
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- A. Normalize settled amount to NGN (Paystack sends kobo; Flutterwave sends NGN)
  IF v_clean_provider = 'paystack' THEN
    v_settled_ngn := ROUND(p_amount_kobo_or_ngn / 100.0, 2);
  ELSE
    v_settled_ngn := ROUND(p_amount_kobo_or_ngn, 2);
  END IF;

  -- B. Lock matching transaction row FOR UPDATE
  SELECT id, wallet_id, user_id, type, amount, status
  INTO v_tx
  FROM public.transactions
  WHERE reference = v_clean_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending deposit transaction not found for reference: %.', v_clean_ref;
  END IF;

  -- C. Strict Idempotency Guard: return immediately if already settled
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

  IF v_tx.status NOT IN ('pending') THEN
    RAISE EXCEPTION 'Transaction % cannot be settled from status %.', v_clean_ref, v_tx.status;
  END IF;

  -- D. Verify gateway settled amount covers expected deposit amount
  IF v_settled_ngn < v_tx.amount THEN
    RAISE EXCEPTION 'Gateway amount mismatch for %: expected ₦%, received ₦%.',
      v_clean_ref, v_tx.amount, v_settled_ngn;
  END IF;

  -- E. Lock & credit target wallet atomically
  SELECT balance INTO v_old_balance
  FROM public.wallets
  WHERE id = v_tx.wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target wallet (%) not found for transaction %.', v_tx.wallet_id, v_clean_ref;
  END IF;

  v_new_balance := v_old_balance + v_tx.amount;

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = ledger_balance + v_tx.amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_tx.wallet_id;

  -- F. Finalize transaction status & persist cryptographic webhook metadata
  UPDATE public.transactions
  SET status = 'successful',
      gateway_provider = v_clean_provider,
      gateway_reference = COALESCE(NULLIF(TRIM(p_gateway_ref), ''), v_clean_ref),
      webhook_payload = COALESCE(p_raw_payload, '{}'::jsonb),
      balance_before = v_old_balance,
      balance_after = v_new_balance
  WHERE id = v_tx.id;

  -- G. Record immutable compliance audit trail
  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    NULL,
    'system',
    v_tx.user_id,
    'SETTLE_GATEWAY_DEPOSIT',
    'transactions',
    v_tx.id::TEXT,
    'Verified ' || INITCAP(v_clean_provider) || ' webhook deposit settlement',
    jsonb_build_object('status', v_tx.status, 'wallet_balance', v_old_balance),
    jsonb_build_object(
      'status', 'successful',
      'wallet_balance', v_new_balance,
      'amount_ngn', v_tx.amount,
      'settled_ngn', v_settled_ngn,
      'provider', v_clean_provider,
      'gateway_ref', p_gateway_ref,
      'reference', v_clean_ref
    )
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

-- ============================================================================
-- 3. OUTBOUND BANK PAYOUT DEBIT & AUTOMATIC REVERSAL RPCs (`bank-payout`)
-- ============================================================================

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
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_old_balance NUMERIC(14, 2);
  v_total_debit NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
  v_tx_id UUID;
  v_is_frozen BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Valid user_id and positive payout amount are required.';
  END IF;

  SELECT is_frozen INTO v_is_frozen
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  IF v_is_frozen THEN
    RAISE EXCEPTION 'Account is frozen per CBN AML/Fraud directives.';
  END IF;

  v_total_debit := ROUND(p_amount + COALESCE(p_fee, 0), 2);

  SELECT id, balance INTO v_wallet_id, v_old_balance
  FROM public.wallets
  WHERE user_id = p_user_id AND currency = 'NGN'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active NGN wallet not found.';
  END IF;

  IF v_old_balance < v_total_debit THEN
    RAISE EXCEPTION 'Insufficient wallet balance: available ₦%, required ₦%.',
      TRIM(TO_CHAR(v_old_balance, 'FM999,999,990.00')),
      TRIM(TO_CHAR(v_total_debit, 'FM999,999,990.00'));
  END IF;

  v_new_balance := v_old_balance - v_total_debit;

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = ledger_balance - v_total_debit,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_wallet_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, gateway_provider
  ) VALUES (
    v_wallet_id, p_user_id, 'outflow', 'transfer', p_amount, COALESCE(p_fee, 0),
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
    'old_balance', v_old_balance,
    'new_balance', v_new_balance
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_failed_payout(
  p_reference TEXT,
  p_reason TEXT DEFAULT 'Downstream NIP bank payout reversed',
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx RECORD;
  v_old_balance NUMERIC(14, 2);
  v_refund_total NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
BEGIN
  SELECT id, wallet_id, user_id, type, amount, fee, status
  INTO v_tx
  FROM public.transactions
  WHERE reference = TRIM(COALESCE(p_reference, ''))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout transaction not found for reference: %.', p_reference;
  END IF;

  -- Idempotency guard: never refund twice
  IF v_tx.status = 'reversed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_reversed', true,
      'tx_id', v_tx.id,
      'reference', p_reference
    );
  END IF;

  IF v_tx.type <> 'outflow' THEN
    RAISE EXCEPTION 'Only outflow payout transactions can be reversed.';
  END IF;

  v_refund_total := ROUND(v_tx.amount + COALESCE(v_tx.fee, 0), 2);

  SELECT balance INTO v_old_balance
  FROM public.wallets
  WHERE id = v_tx.wallet_id
  FOR UPDATE;

  v_new_balance := v_old_balance + v_refund_total;

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = ledger_balance + v_refund_total,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_tx.wallet_id;

  UPDATE public.transactions
  SET status = 'reversed',
      webhook_payload = COALESCE(p_raw_payload, '{}'::jsonb)
  WHERE id = v_tx.id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    NULL,
    'system',
    v_tx.user_id,
    'REVERSE_FAILED_PAYOUT',
    'transactions',
    v_tx.id::TEXT,
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
    'new_balance', v_new_balance
  );
END;
$$;

-- ============================================================================
-- 4. STRICT SERVICE-ROLE EXECUTION ISOLATION
-- ============================================================================

REVOKE ALL ON FUNCTION public.settle_gateway_deposit(TEXT, TEXT, NUMERIC, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_wallet_for_payout(UUID, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_failed_payout(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.settle_gateway_deposit(TEXT, TEXT, NUMERIC, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet_for_payout(UUID, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_failed_payout(TEXT, TEXT, JSONB) TO service_role;

COMMIT;

