-- ============================================================================
-- MidePay v4.4 — MideSave Goal Vaults, Nigerian VTU Bills & Team Payroll
-- Migration: 20261116030000_midesave_bills_payroll.sql
-- Target: PostgreSQL 15+ / Supabase (https://pxdzdehocjnmxbuvipxu.supabase.co)
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. MIDESAVE GOAL-BASED SAVINGS VAULTS (`public.savings_vaults`)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.savings_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (LENGTH(TRIM(title)) >= 2),
  category TEXT NOT NULL DEFAULT 'General',
  target_amount NUMERIC(14, 2) NOT NULL CHECK (target_amount > 0),
  current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (current_balance >= 0),
  interest_rate_pa NUMERIC(5, 2) NOT NULL DEFAULT 14.50 CHECK (interest_rate_pa >= 0),
  lock_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matured', 'broken')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- Reconcile legacy 20260923 savings_vaults columns before creating indexes
ALTER TABLE public.savings_vaults
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS interest_rate_pa NUMERIC(5, 2) NOT NULL DEFAULT 14.50,
  ADD COLUMN IF NOT EXISTS lock_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'savings_vaults' AND column_name = 'current_amount'
  ) THEN
    EXECUTE 'ALTER TABLE public.savings_vaults ALTER COLUMN current_amount SET DEFAULT 0.00';
    EXECUTE 'UPDATE public.savings_vaults SET current_balance = GREATEST(COALESCE(current_balance, 0), COALESCE(current_amount, 0)) WHERE current_balance = 0 AND COALESCE(current_amount, 0) > 0';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_savings_vaults_user_id ON public.savings_vaults(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_savings_vaults_status ON public.savings_vaults(status);

ALTER TABLE public.savings_vaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own savings vaults" ON public.savings_vaults;
DROP POLICY IF EXISTS "Users can create own savings vaults" ON public.savings_vaults;
DROP POLICY IF EXISTS "Users can update own savings vaults" ON public.savings_vaults;
DROP POLICY IF EXISTS "Users can delete empty savings vaults" ON public.savings_vaults;

CREATE POLICY "Users can view own savings vaults"
  ON public.savings_vaults FOR SELECT
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "Users can create own savings vaults"
  ON public.savings_vaults FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own savings vaults"
  ON public.savings_vaults FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete empty savings vaults"
  ON public.savings_vaults FOR DELETE
  USING (auth.uid() = user_id AND current_balance = 0);

-- 1.1 Atomic RPC: fund_savings_vault(p_vault_id, p_amount)
CREATE OR REPLACE FUNCTION public.fund_savings_vault(
  p_vault_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_is_frozen BOOLEAN;
  v_wallet_id UUID;
  v_wallet_balance NUMERIC(14, 2);
  v_new_wallet_balance NUMERIC(14, 2);
  v_vault_title TEXT;
  v_vault_balance NUMERIC(14, 2);
  v_new_vault_balance NUMERIC(14, 2);
  v_lock_until TIMESTAMPTZ;
  v_next_status TEXT;
  v_ref TEXT;
  v_rand BYTEA;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required to fund a MideSave vault.';
  END IF;

  IF p_vault_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Valid vault ID and positive NGN deposit amount are required.';
  END IF;

  SELECT is_frozen INTO v_is_frozen
  FROM public.profiles
  WHERE id = v_caller;

  IF v_is_frozen IS TRUE THEN
    RAISE EXCEPTION 'Account is frozen per CBN security directives. Vault funding is disabled.';
  END IF;

  -- Lock caller NGN wallet FOR UPDATE
  SELECT id, balance INTO v_wallet_id, v_wallet_balance
  FROM public.wallets
  WHERE user_id = v_caller AND currency = 'NGN'
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Active NGN wallet not found for user.';
  END IF;

  IF v_wallet_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient NGN wallet balance (Available: ₦%).',
      TRIM(TO_CHAR(v_wallet_balance, 'FM999,999,990.00'));
  END IF;

  -- Lock target vault FOR UPDATE (strictly verifying user ownership)
  SELECT title, current_balance, lock_until
  INTO v_vault_title, v_vault_balance, v_lock_until
  FROM public.savings_vaults
  WHERE id = p_vault_id AND user_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MideSave vault not found or does not belong to authenticated user.';
  END IF;

  v_new_wallet_balance := ROUND(v_wallet_balance - p_amount, 2);
  v_new_vault_balance := ROUND(v_vault_balance + p_amount, 2);
  v_next_status := CASE
    WHEN v_lock_until IS NOT NULL AND v_lock_until <= NOW() THEN 'matured'
    ELSE 'active'
  END;

  UPDATE public.wallets
  SET balance = v_new_wallet_balance,
      ledger_balance = ledger_balance - p_amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_wallet_id;

  UPDATE public.savings_vaults
  SET current_balance = v_new_vault_balance,
      status = v_next_status,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_vault_id;

  v_rand := gen_random_bytes(2);
  v_ref := 'MDP-SAV-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' ||
           LPAD((((get_byte(v_rand, 0) << 8) | get_byte(v_rand, 1)) % 10000)::TEXT, 4, '0');

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, narration, reference, metadata
  ) VALUES (
    v_wallet_id, v_caller, 'outflow', 'savings', p_amount, 0.00,
    v_wallet_balance, v_new_wallet_balance, 'successful',
    'MideSave Vault: ' || v_vault_title, 'MideSave Treasury (14.5% p.a.)',
    'MideSave Deposit — ' || v_vault_title, v_ref,
    jsonb_build_object('vault_id', p_vault_id, 'vault_title', v_vault_title, 'action', 'fund_vault')
  );

  RETURN jsonb_build_object(
    'success', true,
    'vault_id', p_vault_id,
    'vault_title', v_vault_title,
    'vault_balance', v_new_vault_balance,
    'new_balance', v_new_wallet_balance,
    'reference', v_ref
  );
END;
$$;

-- 1.2 Atomic RPC: withdraw_savings_vault(p_vault_id, p_amount)
CREATE OR REPLACE FUNCTION public.withdraw_savings_vault(
  p_vault_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_is_frozen BOOLEAN;
  v_wallet_id UUID;
  v_wallet_balance NUMERIC(14, 2);
  v_new_wallet_balance NUMERIC(14, 2);
  v_vault_title TEXT;
  v_vault_balance NUMERIC(14, 2);
  v_new_vault_balance NUMERIC(14, 2);
  v_lock_until TIMESTAMPTZ;
  v_current_status TEXT;
  v_next_status TEXT;
  v_early_break_fee NUMERIC(14, 2) := 0.00;
  v_net_credit NUMERIC(14, 2);
  v_ref TEXT;
  v_rand BYTEA;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required to withdraw from a MideSave vault.';
  END IF;

  IF p_vault_id IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Valid vault ID and positive withdrawal amount are required.';
  END IF;

  SELECT is_frozen INTO v_is_frozen
  FROM public.profiles
  WHERE id = v_caller;

  IF v_is_frozen IS TRUE THEN
    RAISE EXCEPTION 'Account is frozen per CBN security directives. Withdrawals are disabled.';
  END IF;

  -- Lock wallet & vault FOR UPDATE
  SELECT id, balance INTO v_wallet_id, v_wallet_balance
  FROM public.wallets
  WHERE user_id = v_caller AND currency = 'NGN'
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Active NGN wallet not found for user.';
  END IF;

  SELECT title, current_balance, lock_until, status
  INTO v_vault_title, v_vault_balance, v_lock_until, v_current_status
  FROM public.savings_vaults
  WHERE id = p_vault_id AND user_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MideSave vault not found or does not belong to authenticated user.';
  END IF;

  IF v_vault_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient vault balance (Available in %: ₦%).',
      v_vault_title, TRIM(TO_CHAR(v_vault_balance, 'FM999,999,990.00'));
  END IF;

  -- Apply 1.5% early-break penalty ONLY if lock_until is set in the future
  IF v_lock_until IS NOT NULL AND v_lock_until > NOW() THEN
    v_early_break_fee := ROUND(p_amount * 0.015, 2);
    v_next_status := 'broken';
  ELSIF v_lock_until IS NOT NULL AND v_lock_until <= NOW() THEN
    v_early_break_fee := 0.00;
    v_next_status := 'matured';
  ELSE
    v_early_break_fee := 0.00;
    v_next_status := v_current_status;
  END IF;

  v_net_credit := ROUND(p_amount - v_early_break_fee, 2);
  v_new_vault_balance := ROUND(v_vault_balance - p_amount, 2);
  v_new_wallet_balance := ROUND(v_wallet_balance + v_net_credit, 2);

  UPDATE public.savings_vaults
  SET current_balance = v_new_vault_balance,
      status = v_next_status,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_vault_id;

  UPDATE public.wallets
  SET balance = v_new_wallet_balance,
      ledger_balance = ledger_balance + v_net_credit,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_wallet_id;

  v_rand := gen_random_bytes(2);
  v_ref := 'MDP-WDR-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' ||
           LPAD((((get_byte(v_rand, 0) << 8) | get_byte(v_rand, 1)) % 10000)::TEXT, 4, '0');

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, narration, reference, metadata
  ) VALUES (
    v_wallet_id, v_caller, 'inflow', 'savings', v_net_credit, v_early_break_fee,
    v_wallet_balance, v_new_wallet_balance, 'successful',
    'MideSave Vault: ' || v_vault_title, 'MideSave Treasury',
    CASE
      WHEN v_early_break_fee > 0 THEN 'MideSave Early-Break Withdrawal (1.5% Fee) — ' || v_vault_title
      ELSE 'MideSave Vault Withdrawal — ' || v_vault_title
    END,
    v_ref,
    jsonb_build_object(
      'vault_id', p_vault_id,
      'vault_title', v_vault_title,
      'gross_amount', p_amount,
      'early_break_fee', v_early_break_fee,
      'net_credited', v_net_credit
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'vault_id', p_vault_id,
    'vault_title', v_vault_title,
    'gross_withdrawn', p_amount,
    'early_break_fee', v_early_break_fee,
    'net_credited', v_net_credit,
    'vault_balance', v_new_vault_balance,
    'new_balance', v_new_wallet_balance,
    'status', v_next_status,
    'reference', v_ref
  );
END;
$$;

-- ============================================================================
-- 2. NIGERIAN AIRTIME, DATA & UTILITY BILLS (`public.bill_payments`)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL CHECK (service_type IN ('airtime', 'data', 'electricity', 'cable')),
  provider TEXT NOT NULL,
  customer_identifier TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  token_or_pin TEXT,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'successful' CHECK (status IN ('pending', 'successful', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_user_created ON public.bill_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_payments_service_type ON public.bill_payments(service_type);

ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own bill payments" ON public.bill_payments;
DROP POLICY IF EXISTS "Users can insert own bill payments" ON public.bill_payments;

CREATE POLICY "Users can view own bill payments"
  ON public.bill_payments FOR SELECT
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "Users can insert own bill payments"
  ON public.bill_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 2.1 Atomic RPC: pay_utility_bill(...)
CREATE OR REPLACE FUNCTION public.pay_utility_bill(
  p_service_type TEXT,
  p_provider TEXT,
  p_identifier TEXT,
  p_plan_name TEXT,
  p_amount NUMERIC,
  p_pin_verified BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_is_frozen BOOLEAN;
  v_service TEXT := LOWER(TRIM(COALESCE(p_service_type, '')));
  v_wallet_id UUID;
  v_wallet_balance NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
  v_token TEXT := NULL;
  v_token_bytes BYTEA;
  v_ref TEXT;
  v_rand BYTEA;
  v_bill_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required to pay utility bills.';
  END IF;

  IF p_pin_verified IS NOT TRUE THEN
    RAISE EXCEPTION '4-digit Transaction PIN verification is required before debiting wallet.';
  END IF;

  IF v_service NOT IN ('airtime', 'data', 'electricity', 'cable') THEN
    RAISE EXCEPTION 'Invalid service_type (%). Expected airtime, data, electricity, or cable.', p_service_type;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Bill payment amount must be strictly greater than zero.';
  END IF;

  SELECT is_frozen INTO v_is_frozen
  FROM public.profiles
  WHERE id = v_caller;

  IF v_is_frozen IS TRUE THEN
    RAISE EXCEPTION 'Account is frozen per CBN security directives. Bill payments are disabled.';
  END IF;

  SELECT id, balance INTO v_wallet_id, v_wallet_balance
  FROM public.wallets
  WHERE user_id = v_caller AND currency = 'NGN'
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Active NGN wallet not found.';
  END IF;

  IF v_wallet_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient NGN wallet balance (Available: ₦%).',
      TRIM(TO_CHAR(v_wallet_balance, 'FM999,999,990.00'));
  END IF;

  -- Generate realistic 20-digit STS prepaid meter token for electricity
  IF v_service = 'electricity' THEN
    v_token_bytes := gen_random_bytes(10);
    v_token :=
      LPAD((((get_byte(v_token_bytes, 0) << 8) | get_byte(v_token_bytes, 1)) % 10000)::TEXT, 4, '0') || ' ' ||
      LPAD((((get_byte(v_token_bytes, 2) << 8) | get_byte(v_token_bytes, 3)) % 10000)::TEXT, 4, '0') || ' ' ||
      LPAD((((get_byte(v_token_bytes, 4) << 8) | get_byte(v_token_bytes, 5)) % 10000)::TEXT, 4, '0') || ' ' ||
      LPAD((((get_byte(v_token_bytes, 6) << 8) | get_byte(v_token_bytes, 7)) % 10000)::TEXT, 4, '0') || ' ' ||
      LPAD((((get_byte(v_token_bytes, 8) << 8) | get_byte(v_token_bytes, 9)) % 10000)::TEXT, 4, '0');
  END IF;

  v_new_balance := ROUND(v_wallet_balance - p_amount, 2);

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = ledger_balance - p_amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_wallet_id;

  v_rand := gen_random_bytes(2);
  v_ref := 'MDP-BIL-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' ||
           LPAD((((get_byte(v_rand, 0) << 8) | get_byte(v_rand, 1)) % 10000)::TEXT, 4, '0');

  INSERT INTO public.bill_payments (
    user_id, service_type, provider, customer_identifier, plan_name,
    amount, token_or_pin, reference, status
  ) VALUES (
    v_caller, v_service, TRIM(p_provider), TRIM(p_identifier), TRIM(COALESCE(p_plan_name, p_provider)),
    p_amount, v_token, v_ref, 'successful'
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, metadata
  ) VALUES (
    v_wallet_id, v_caller, 'outflow', 'bills', p_amount, 0.00,
    v_wallet_balance, v_new_balance, 'successful',
    TRIM(p_provider) || ' (' || TRIM(p_identifier) || ')',
    'MidePay VTU & Utility Switch',
    TRIM(p_identifier),
    TRIM(p_provider) || ' — ' || TRIM(COALESCE(p_plan_name, v_service)),
    v_ref,
    jsonb_build_object(
      'bill_id', v_bill_id,
      'service_type', v_service,
      'provider', TRIM(p_provider),
      'identifier', TRIM(p_identifier),
      'token', v_token
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'bill_id', v_bill_id,
    'reference', v_ref,
    'token', v_token,
    'new_balance', v_new_balance
  );
END;
$$;

-- ============================================================================
-- 3. BUSINESS SUITE TEAM PAYROLL (`public.payroll_runs` & `public.payroll_items`)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount > 0),
  total_fee NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (total_fee >= 0),
  employee_count INT NOT NULL CHECK (employee_count > 0),
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'successful' CHECK (status IN ('pending', 'successful', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- Reconcile legacy 20260923 payroll_runs columns before creating indexes
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_runs' AND column_name = 'business_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.payroll_runs ALTER COLUMN business_id DROP NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_runs' AND column_name = 'total_recipients'
  ) THEN
    EXECUTE 'ALTER TABLE public.payroll_runs ALTER COLUMN total_recipients DROP NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_runs' AND column_name = 'total_payout'
  ) THEN
    EXECUTE 'ALTER TABLE public.payroll_runs ALTER COLUMN total_payout DROP NOT NULL';
  END IF;
END $$;

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_fee NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS employee_count INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reference TEXT;

CREATE TABLE IF NOT EXISTS public.payroll_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_name TEXT NOT NULL,
  employee_role TEXT,
  recipient_identifier TEXT NOT NULL,
  recipient_nuban VARCHAR(10),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'successful' CHECK (status IN ('pending', 'successful', 'failed')),
  tx_reference TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_user_created ON public.payroll_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_items_run_id ON public.payroll_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_recipient ON public.payroll_items(recipient_user_id);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employers can view own payroll runs" ON public.payroll_runs;
DROP POLICY IF EXISTS "Employers can insert own payroll runs" ON public.payroll_runs;
DROP POLICY IF EXISTS "Participants can view payroll items" ON public.payroll_items;

CREATE POLICY "Employers can view own payroll runs"
  ON public.payroll_runs FOR SELECT
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "Employers can insert own payroll runs"
  ON public.payroll_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Participants can view payroll items"
  ON public.payroll_items FOR SELECT
  USING (auth.uid() = employer_user_id OR auth.uid() = recipient_user_id OR public.is_executive());

-- 3.1 Atomic RPC: execute_business_payroll(p_business_id, p_title, p_items)
CREATE OR REPLACE FUNCTION public.execute_business_payroll(
  p_business_id UUID,
  p_title TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employer_id UUID := auth.uid();
  v_employer_name TEXT;
  v_employer_frozen BOOLEAN;
  v_employer_wallet_id UUID;
  v_employer_balance NUMERIC(14, 2);
  v_running_employer_bal NUMERIC(14, 2);
  v_clean_title TEXT := COALESCE(NULLIF(TRIM(p_title), ''), 'Monthly Team Payroll');
  v_total_payroll NUMERIC(14, 2) := 0.00;
  v_emp_count INT := 0;
  v_item JSONB;
  v_ident TEXT;
  v_digits TEXT;
  v_amt NUMERIC(14, 2);
  v_role TEXT;
  v_staff_id UUID;
  v_staff_name TEXT;
  v_staff_frozen BOOLEAN;
  v_staff_wallet_id UUID;
  v_staff_nuban VARCHAR(10);
  v_staff_bal NUMERIC(14, 2);
  v_new_staff_bal NUMERIC(14, 2);
  v_run_id UUID;
  v_run_ref TEXT;
  v_deb_ref TEXT;
  v_cre_ref TEXT;
  v_rand BYTEA;
BEGIN
  IF v_employer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to execute batch payroll.';
  END IF;

  IF p_business_id IS NOT NULL AND NOT public.has_business_write_role(p_business_id) THEN
    RAISE EXCEPTION 'Access Denied: Caller does not hold owner/admin/finance authority for this business.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Payroll items array must contain at least one employee disbursement.';
  END IF;

  SELECT full_name, is_frozen
  INTO v_employer_name, v_employer_frozen
  FROM public.profiles
  WHERE id = v_employer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employer profile not found.';
  END IF;

  IF v_employer_frozen IS TRUE THEN
    RAISE EXCEPTION 'Employer account is frozen per CBN directives. Payroll disbursement is blocked.';
  END IF;

  -- Pre-validate all employee identifiers & compute exact batch total
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_amt := ROUND(COALESCE((v_item->>'amount')::NUMERIC, 0), 2);
    v_ident := TRIM(COALESCE(v_item->>'identifier', ''));
    IF v_amt <= 0 OR v_ident = '' THEN
      RAISE EXCEPTION 'Every payroll row must specify a valid MidePay NUBAN/@tag and salary > ₦0.';
    END IF;
    v_total_payroll := v_total_payroll + v_amt;
    v_emp_count := v_emp_count + 1;
  END LOOP;

  -- Lock employer NGN wallet FOR UPDATE
  SELECT id, balance
  INTO v_employer_wallet_id, v_employer_balance
  FROM public.wallets
  WHERE user_id = v_employer_id AND currency = 'NGN'
  FOR UPDATE;

  IF v_employer_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Employer NGN wallet not found.';
  END IF;

  IF v_employer_balance < v_total_payroll THEN
    RAISE EXCEPTION 'Insufficient wallet balance for batch payroll: ₦% required, ₦% available.',
      TRIM(TO_CHAR(v_total_payroll, 'FM999,999,990.00')),
      TRIM(TO_CHAR(v_employer_balance, 'FM999,999,990.00'));
  END IF;

  v_rand := gen_random_bytes(2);
  v_run_ref := 'MDP-PAY-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' ||
               LPAD((((get_byte(v_rand, 0) << 8) | get_byte(v_rand, 1)) % 10000)::TEXT, 4, '0');

  INSERT INTO public.payroll_runs (
    user_id, business_id, title, total_amount, total_fee, employee_count, reference, status
  ) VALUES (
    v_employer_id, p_business_id, v_clean_title, v_total_payroll, 0.00, v_emp_count, v_run_ref, 'successful'
  ) RETURNING id INTO v_run_id;

  v_running_employer_bal := v_employer_balance;

  -- Disburse each employee salary atomically
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_amt := ROUND((v_item->>'amount')::NUMERIC, 2);
    v_ident := TRIM(v_item->>'identifier');
    v_role := NULLIF(TRIM(COALESCE(v_item->>'role', 'Team Member')), '');
    v_digits := REGEXP_REPLACE(v_ident, '[^0-9]', '', 'g');

    SELECT p.id, p.full_name, p.is_frozen, w.id, w.nuban
    INTO v_staff_id, v_staff_name, v_staff_frozen, v_staff_wallet_id, v_staff_nuban
    FROM public.profiles p
    LEFT JOIN public.wallets w ON w.user_id = p.id AND w.currency = 'NGN'
    WHERE (LENGTH(v_digits) = 10 AND w.nuban = v_digits)
       OR LOWER(p.tag) = LOWER(CASE WHEN LEFT(v_ident, 1) = '@' THEN v_ident ELSE '@' || v_ident END)
       OR LOWER(p.email) = LOWER(v_ident)
    LIMIT 1;

    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION 'Registered MidePay staff member not found for identifier "%".', v_ident;
    END IF;

    IF v_staff_id = v_employer_id THEN
      RAISE EXCEPTION 'Self-payroll transfer to employer account (%) is prohibited.', v_ident;
    END IF;

    IF v_staff_frozen IS TRUE THEN
      RAISE EXCEPTION 'Staff account "%" is currently restricted and cannot receive payroll.', v_staff_name;
    END IF;

    IF v_staff_wallet_id IS NULL THEN
      v_staff_nuban := public.generate_unique_midepay_nuban();
      INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
      VALUES (v_staff_id, 'NGN', 0.00, 0.00, v_staff_nuban, 'MidePay / Providus Bank')
      RETURNING id INTO v_staff_wallet_id;
    END IF;

    SELECT balance INTO v_staff_bal
    FROM public.wallets
    WHERE id = v_staff_wallet_id
    FOR UPDATE;

    v_new_staff_bal := ROUND(v_staff_bal + v_amt, 2);

    UPDATE public.wallets
    SET balance = v_new_staff_bal,
        ledger_balance = ledger_balance + v_amt,
        updated_at = TIMEZONE('utc', NOW())
    WHERE id = v_staff_wallet_id;

    v_rand := gen_random_bytes(4);
    v_deb_ref := 'MDP-PYD-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' ||
                 LPAD((((get_byte(v_rand, 0) << 8) | get_byte(v_rand, 1)) % 10000)::TEXT, 4, '0');
    v_cre_ref := 'MDP-PYC-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' ||
                 LPAD((((get_byte(v_rand, 2) << 8) | get_byte(v_rand, 3)) % 10000)::TEXT, 4, '0');

    -- Employer outflow ledger entry
    INSERT INTO public.transactions (
      wallet_id, user_id, counterparty_user_id, type, category, amount, fee,
      balance_before, balance_after, status,
      counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
      narration, reference, metadata
    ) VALUES (
      v_employer_wallet_id, v_employer_id, v_staff_id, 'outflow', 'payroll', v_amt, 0.00,
      v_running_employer_bal, ROUND(v_running_employer_bal - v_amt, 2), 'successful',
      v_staff_name, 'MidePay / Providus Bank', COALESCE(v_staff_nuban, v_ident),
      v_clean_title || ' — ' || COALESCE(v_role, 'Salary'),
      v_deb_ref,
      jsonb_build_object('payroll_run_id', v_run_id, 'paired_reference', v_cre_ref, 'role', v_role)
    );

    v_running_employer_bal := ROUND(v_running_employer_bal - v_amt, 2);

    -- Staff inflow ledger receipt
    INSERT INTO public.transactions (
      wallet_id, user_id, counterparty_user_id, type, category, amount, fee,
      balance_before, balance_after, status,
      counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
      narration, reference, metadata
    ) VALUES (
      v_staff_wallet_id, v_staff_id, v_employer_id, 'inflow', 'payroll', v_amt, 0.00,
      v_staff_bal, v_new_staff_bal, 'successful',
      v_employer_name, 'MidePay Business Payroll', v_run_ref,
      'Salary Credit: ' || v_clean_title,
      v_cre_ref,
      jsonb_build_object('payroll_run_id', v_run_id, 'paired_reference', v_deb_ref, 'role', v_role)
    );

    INSERT INTO public.payroll_items (
      payroll_run_id, employer_user_id, recipient_user_id,
      employee_name, employee_role, recipient_identifier, recipient_nuban,
      amount, status, tx_reference
    ) VALUES (
      v_run_id, v_employer_id, v_staff_id,
      v_staff_name, v_role, v_ident, v_staff_nuban,
      v_amt, 'successful', v_deb_ref
    );
  END LOOP;

  -- Final atomic employer wallet balance update
  UPDATE public.wallets
  SET balance = v_running_employer_bal,
      ledger_balance = ledger_balance - v_total_payroll,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_employer_wallet_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    v_employer_id,
    CASE WHEN public.is_executive() THEN 'executive' ELSE 'user' END,
    'EXECUTE_BUSINESS_PAYROLL',
    'payroll_runs',
    v_run_id::TEXT,
    v_clean_title,
    jsonb_build_object('employer_balance_before', v_employer_balance),
    jsonb_build_object(
      'employer_balance_after', v_running_employer_bal,
      'total_amount', v_total_payroll,
      'employee_count', v_emp_count,
      'reference', v_run_ref
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payroll_run_id', v_run_id,
    'reference', v_run_ref,
    'total_amount', v_total_payroll,
    'employee_count', v_emp_count,
    'new_balance', v_running_employer_bal
  );
END;
$$;

-- ============================================================================
-- 4. STRICT EXECUTION GRANTS
-- ============================================================================
REVOKE ALL ON FUNCTION public.fund_savings_vault(UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.withdraw_savings_vault(UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pay_utility_bill(TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_business_payroll(UUID, TEXT, JSONB) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fund_savings_vault(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_savings_vault(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_utility_bill(TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_business_payroll(UUID, TEXT, JSONB) TO authenticated;

COMMIT;

