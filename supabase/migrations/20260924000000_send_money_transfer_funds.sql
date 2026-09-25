-- ============================================================================
-- MidePay: Send Money & Atomic Transfer Funds RPC Migration
-- Target: PostgreSQL 15+ / Supabase
-- Description:
-- 1. Adds pin_hash column to profiles for transaction authorization.
-- 2. Enables authenticated users to search registered profiles by email or phone.
-- 3. Creates the atomic transfer_funds(sender_id, recipient_id, amount, narration)
--    Postgres function to safely transfer funds in a single database transaction.
-- ============================================================================

-- 1. Add pin_hash and security lockout columns to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

-- 2. Update RLS on profiles so authenticated users can search for recipients
-- (transfers only work between registered MidePay members)
DROP POLICY IF EXISTS "Authenticated users can search profiles" ON public.profiles;
CREATE POLICY "Authenticated users can search profiles"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 3. Atomic transfer_funds function
-- Executes in a single database transaction:
--   - Validates sender, recipient, amount, and self-transfer prevention
--   - Checks and locks sender wallet for sufficient balance
--   - Deducts from sender's wallet
--   - Credits recipient's wallet
--   - Inserts matching debit and credit transaction records
CREATE OR REPLACE FUNCTION public.transfer_funds(
  sender_id UUID,
  recipient_id UUID,
  amount NUMERIC,
  narration TEXT DEFAULT 'Transfer via MidePay'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name TEXT;
  v_recipient_name TEXT;
  v_sender_wallet_id UUID;
  v_recipient_wallet_id UUID;
  v_sender_balance NUMERIC(14, 2);
  v_recipient_balance NUMERIC(14, 2);
  v_sender_tx_id UUID;
  v_recipient_tx_id UUID;
  v_ref_sender TEXT;
  v_ref_recipient TEXT;
  v_clean_narration TEXT;
  v_new_balance NUMERIC(14, 2);
BEGIN
  -- A. Input Validations
  IF sender_id IS NULL THEN
    RAISE EXCEPTION 'Sender ID is required';
  END IF;

  IF recipient_id IS NULL THEN
    RAISE EXCEPTION 'Recipient ID is required';
  END IF;

  IF sender_id = recipient_id THEN
    RAISE EXCEPTION 'Cannot transfer funds to yourself';
  END IF;

  IF amount IS NULL OR amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;

  v_clean_narration := COALESCE(NULLIF(TRIM(narration), ''), 'Transfer via MidePay');

  -- B. Check sender profile
  SELECT full_name INTO v_sender_name
  FROM public.profiles
  WHERE id = sender_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sender profile not found';
  END IF;

  -- C. Check recipient profile (transfers only work between registered MidePay users)
  SELECT full_name INTO v_recipient_name
  FROM public.profiles
  WHERE id = recipient_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient not found. Transfers only work between registered MidePay members.';
  END IF;

  -- D. Lock sender's wallet and check balance
  SELECT id, balance INTO v_sender_wallet_id, v_sender_balance
  FROM public.wallets
  WHERE user_id = sender_id AND currency = 'NGN'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sender wallet not found';
  END IF;

  IF v_sender_balance < amount THEN
    RAISE EXCEPTION 'Insufficient balance: available balance is ₦%', TRIM(TO_CHAR(v_sender_balance, 'FM999,999,990.00'));
  END IF;

  -- E. Lock recipient's wallet (or provision if missing)
  SELECT id, balance INTO v_recipient_wallet_id, v_recipient_balance
  FROM public.wallets
  WHERE user_id = recipient_id AND currency = 'NGN'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wallets (
      user_id, currency, balance, ledger_balance, nuban, bank_name
    ) VALUES (
      recipient_id,
      'NGN',
      0.00,
      0.00,
      '90' || LPAD(FLOOR(random() * 100000000)::TEXT, 8, '0'),
      'Providus Bank'
    )
    RETURNING id, balance INTO v_recipient_wallet_id, v_recipient_balance;
  END IF;

  -- F. Atomic balance updates
  v_new_balance := v_sender_balance - amount;

  -- Deduct from sender
  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = ledger_balance - amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_sender_wallet_id;

  -- Credit to recipient
  UPDATE public.wallets
  SET balance = balance + amount,
      ledger_balance = ledger_balance + amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_recipient_wallet_id;

  -- G. Generate distinct references for debit & credit entries
  v_ref_sender := 'MP-DEB-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || LPAD(FLOOR(random() * 10000)::TEXT, 4, '0');
  v_ref_recipient := 'MP-CRE-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || LPAD(FLOOR(random() * 10000)::TEXT, 4, '0');

  -- H. Insert matching debit row for sender
  INSERT INTO public.transactions (
    wallet_id,
    user_id,
    type,
    category,
    amount,
    fee,
    status,
    counterparty_name,
    counterparty_bank,
    narration,
    reference,
    created_at
  ) VALUES (
    v_sender_wallet_id,
    sender_id,
    'outflow',
    'transfer',
    amount,
    0.00,
    'successful',
    v_recipient_name,
    'MidePay Wallet',
    v_clean_narration,
    v_ref_sender,
    TIMEZONE('utc', NOW())
  ) RETURNING id INTO v_sender_tx_id;

  -- I. Insert matching credit row for recipient
  INSERT INTO public.transactions (
    wallet_id,
    user_id,
    type,
    category,
    amount,
    fee,
    status,
    counterparty_name,
    counterparty_bank,
    narration,
    reference,
    created_at
  ) VALUES (
    v_recipient_wallet_id,
    recipient_id,
    'inflow',
    'transfer',
    amount,
    0.00,
    'successful',
    v_sender_name,
    'MidePay Wallet',
    v_clean_narration,
    v_ref_recipient,
    TIMEZONE('utc', NOW())
  ) RETURNING id INTO v_recipient_tx_id;

  -- J. Return transaction payload
  RETURN jsonb_build_object(
    'success', true,
    'sender_tx_id', v_sender_tx_id,
    'recipient_tx_id', v_recipient_tx_id,
    'reference', v_ref_sender,
    'amount', amount,
    'recipient_name', v_recipient_name,
    'sender_name', v_sender_name,
    'new_balance', v_new_balance
  );
END;
$$;

-- Overload transfer_funds with 3 arguments if called without narration
CREATE OR REPLACE FUNCTION public.transfer_funds(
  sender_id UUID,
  recipient_id UUID,
  amount NUMERIC
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.transfer_funds(sender_id, recipient_id, amount, 'Transfer via MidePay');
$$;

-- Grant execution permissions to authenticated and anon roles
GRANT EXECUTE ON FUNCTION public.transfer_funds(UUID, UUID, NUMERIC, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.transfer_funds(UUID, UUID, NUMERIC) TO authenticated, anon;
