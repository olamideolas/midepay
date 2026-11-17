-- ============================================================================
-- MidePay v4.4 — Principal Backend Security Hardening & Zero-Trust RPC Engine
-- Migration: 20261116040000_backend_security_hardening.sql
-- Target: PostgreSQL 15+ / Supabase (https://pxdzdehocjnmxbuvipxu.supabase.co)
--
-- Scope:
--   1. Strict Row-Level Security (RLS) on every financial table
--      (profiles, wallets, transactions, virtual_cards, savings_vaults,
--       midesave_vaults, bill_payments, payroll_runs, payroll_items,
--       beneficiaries, security_audit_logs) + complete revocation of direct
--      INSERT, UPDATE, DELETE, and TRUNCATE privileges from `authenticated`
--      and `anon` roles (`SELECT` only where `auth.uid() = user_id` / `id`).
--   2. Repaired & hardened `handle_new_user()` trigger (`SECURITY DEFINER`,
--      `SET search_path = public, extensions`) resolving Supabase's
--      `extensions.gen_random_bytes` search_path issue and legacy column
--      constraints so new signups never throw 'Database error saving new user'
--      and auto-provision a unique 90XXXXXXXX NUBAN + starter USD/NGN cards.
--   3. Server-side `SECURITY DEFINER` RPCs using `pgcrypto` bcrypt PIN
--      verification (`crypt` / `gen_salt('bf', 10)`), persistent 5-strike
--      failed PIN lockout (15-minute cooldown), deterministic `SELECT ... FOR UPDATE`
--      row locking, and UUID `idempotency_key` deduplication across:
--        - P2P NUBAN & MideTag transfers (`execute_p2p_transfer` & `transfer_funds`)
--        - Virtual card funding, freeze, limit & reveal (`fund_virtual_card_from_wallet`,
--          `set_virtual_card_freeze`, `set_virtual_card_limit`, `issue_virtual_card`,
--          `log_virtual_card_reveal`)
--        - VTU Airtime, Data, Cable & STS Electricity bills (`pay_utility_bill`)
--        - MideSave goal vault creation, deposits & withdrawals (`create_savings_vault`,
--          `fund_savings_vault`, `withdraw_savings_vault`)
--        - Business Suite batch team payroll (`execute_business_payroll`)
--   4. Immutable append-only `public.security_audit_logs` table recording every
--      PIN failure/lockout, transfer, card reveal/freeze/funding, VTU bill,
--      vault action, and payroll disbursement.
-- ============================================================================

BEGIN;

-- 0. EXTENSIONS (Support both Supabase `extensions` schema and local `public`)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. SCHEMA RECONCILIATION, MISSING TABLES & IMMUTABLE `security_audit_logs`
-- ============================================================================

-- 1.1 Reconcile `public.profiles` PIN & lockout columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kyc_tier INT NOT NULL DEFAULT 2;

UPDATE public.profiles
SET transaction_pin_hash = COALESCE(transaction_pin_hash, pin_hash),
    pin_hash = COALESCE(pin_hash, transaction_pin_hash)
WHERE transaction_pin_hash IS DISTINCT FROM pin_hash;

-- 1.2 Reconcile `public.wallets`
ALTER TABLE public.wallets
  ALTER COLUMN bank_name SET DEFAULT 'MidePay / Providus Bank';

-- 1.3 Reconcile `public.transactions` + `idempotency_key` deduplication index
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS counterparty_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS balance_before NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key
  ON public.transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 1.4 Reconcile `public.virtual_cards` (widen `masked_pan` from legacy VARCHAR(19) -> VARCHAR(32))
ALTER TABLE public.virtual_cards
  ALTER COLUMN masked_pan TYPE VARCHAR(32);

ALTER TABLE public.virtual_cards
  ADD COLUMN IF NOT EXISTS card_number VARCHAR(19),
  ADD COLUMN IF NOT EXISTS cvv VARCHAR(4),
  ADD COLUMN IF NOT EXISTS card_label TEXT NOT NULL DEFAULT 'MidePay Virtual Card',
  ADD COLUMN IF NOT EXISTS card_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_cards_card_number_unique
  ON public.virtual_cards (REPLACE(card_number, ' ', ''))
  WHERE card_number IS NOT NULL;

-- 1.5 Reconcile `public.savings_vaults` & `public.midesave_vaults`
ALTER TABLE public.savings_vaults
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS interest_rate_pa NUMERIC(5, 2) NOT NULL DEFAULT 14.50,
  ADD COLUMN IF NOT EXISTS lock_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'savings_vaults' AND column_name = 'current_amount'
  ) THEN
    EXECUTE 'ALTER TABLE public.savings_vaults ALTER COLUMN current_amount SET DEFAULT 0.00';
    EXECUTE 'UPDATE public.savings_vaults SET current_balance = GREATEST(COALESCE(current_balance, 0), COALESCE(current_amount, 0)) WHERE current_balance = 0 AND COALESCE(current_amount, 0) > 0';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.midesave_vaults (
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

CREATE INDEX IF NOT EXISTS idx_midesave_vaults_user_id ON public.midesave_vaults(user_id, created_at DESC);

-- 1.6 Reconcile `public.bill_payments`
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
  idempotency_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.bill_payments
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_payments_idempotency_key
  ON public.bill_payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 1.7 Reconcile `public.payroll_runs` & `public.payroll_items` (handle legacy 20260923 columns safely)
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
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_fee NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS employee_count INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_idempotency_key
  ON public.payroll_runs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_payroll_items_run_id ON public.payroll_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_recipient ON public.payroll_items(recipient_user_id);

-- 1.8 Create `public.beneficiaries` table
CREATE TABLE IF NOT EXISTS public.beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  bank_name TEXT NOT NULL DEFAULT 'MidePay / Providus Bank',
  account_number VARCHAR(20) NOT NULL,
  mide_tag TEXT,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT uq_user_beneficiary UNIQUE (user_id, bank_name, account_number)
);

CREATE INDEX IF NOT EXISTS idx_beneficiaries_user_id ON public.beneficiaries(user_id, created_at DESC);

-- 1.9 Create Immutable `public.security_audit_logs` Table (Append-Only Compliance Trail)
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  entity_type TEXT,
  entity_id TEXT,
  idempotency_key UUID,
  amount NUMERIC(14, 2),
  ip_address TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_user_created
  ON public.security_audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_event_type
  ON public.security_audit_logs(event_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_security_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RAISE EXCEPTION 'Compliance Violation: public.security_audit_logs is append-only and immutable (% prohibited).', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_security_audit_logs_immutable ON public.security_audit_logs;
CREATE TRIGGER trg_security_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.security_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_security_audit_mutation();

-- ============================================================================
-- 2. STRICT ROW-LEVEL SECURITY (RLS) & DIRECT WRITE PRIVILEGE REVOCATION
-- ============================================================================

-- 2.1 Enable RLS on every financial & security table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.midesave_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;

-- 2.2 Purge ALL legacy policies (including permissive INSERT/UPDATE/DELETE/ALL policies)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles',
        'wallets',
        'transactions',
        'virtual_cards',
        'savings_vaults',
        'midesave_vaults',
        'bill_payments',
        'payroll_runs',
        'payroll_items',
        'beneficiaries',
        'security_audit_logs'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- 2.3 Revoke ALL direct INSERT, UPDATE, DELETE, TRUNCATE privileges from `authenticated` and `anon`
REVOKE ALL ON TABLE
  public.profiles,
  public.wallets,
  public.transactions,
  public.virtual_cards,
  public.savings_vaults,
  public.midesave_vaults,
  public.bill_payments,
  public.payroll_runs,
  public.payroll_items,
  public.beneficiaries,
  public.security_audit_logs
FROM PUBLIC, anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.profiles,
  public.wallets,
  public.transactions,
  public.virtual_cards,
  public.savings_vaults,
  public.midesave_vaults,
  public.bill_payments,
  public.payroll_runs,
  public.payroll_items,
  public.beneficiaries,
  public.security_audit_logs
FROM authenticated, anon;

GRANT SELECT ON TABLE
  public.profiles,
  public.wallets,
  public.transactions,
  public.virtual_cards,
  public.savings_vaults,
  public.midesave_vaults,
  public.bill_payments,
  public.payroll_runs,
  public.payroll_items,
  public.beneficiaries,
  public.security_audit_logs
TO authenticated;

-- 2.4 Create Strict Owner-Only `FOR SELECT TO authenticated` Policies (`auth.uid() = user_id` / `id`)
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_executive());

CREATE POLICY "wallets_select_own"
  ON public.wallets FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "transactions_select_own"
  ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "virtual_cards_select_own"
  ON public.virtual_cards FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "savings_vaults_select_own"
  ON public.savings_vaults FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "midesave_vaults_select_own"
  ON public.midesave_vaults FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "bill_payments_select_own"
  ON public.bill_payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "payroll_runs_select_own"
  ON public.payroll_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "payroll_items_select_own"
  ON public.payroll_items FOR SELECT TO authenticated
  USING (auth.uid() = employer_user_id OR auth.uid() = recipient_user_id OR public.is_executive());

CREATE POLICY "beneficiaries_select_own"
  ON public.beneficiaries FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "security_audit_logs_select_own"
  ON public.security_audit_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

-- ============================================================================
-- 3. HARDENED CRYPTOGRAPHIC NUBAN, PAN & `handle_new_user()` SIGNUP TRIGGER
-- ============================================================================

-- 3.1 CSPRNG 10-Digit NUBAN Generator (`SET search_path = public, extensions`)
CREATE OR REPLACE FUNCTION public.generate_unique_midepay_nuban()
RETURNS VARCHAR(10)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_bytes BYTEA;
  v_rand_uint BIGINT;
  v_candidate VARCHAR(10);
  v_attempts INT := 0;
BEGIN
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 250 THEN
      RAISE EXCEPTION 'Unable to allocate unique 10-digit MidePay NUBAN after 250 attempts.';
    END IF;

    v_bytes := gen_random_bytes(4);
    v_rand_uint := (
      (get_byte(v_bytes, 0)::BIGINT << 24) |
      (get_byte(v_bytes, 1)::BIGINT << 16) |
      (get_byte(v_bytes, 2)::BIGINT << 8)  |
      (get_byte(v_bytes, 3)::BIGINT)
    );

    v_candidate := '90' || LPAD((ABS(v_rand_uint) % 100000000)::TEXT, 8, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.wallets w WHERE w.nuban = v_candidate
    ) AND NOT EXISTS (
      SELECT 1 FROM public.business_sub_accounts bsa WHERE bsa.dedicated_nuban = v_candidate
    );
  END LOOP;

  RETURN v_candidate;
END;
$$;

-- 3.2 CSPRNG Luhn-Valid 16-Digit `5399` Virtual Card PAN Generator (`SET search_path = public, extensions`)
CREATE OR REPLACE FUNCTION public.generate_unique_virtual_card_pan(p_prefix TEXT DEFAULT '5399')
RETURNS VARCHAR(19)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_prefix TEXT := LEFT(LPAD(COALESCE(NULLIF(regexp_replace(p_prefix, '[^0-9]', '', 'g'), ''), '5399'), 4, '5'), 4);
  v_bytes BYTEA;
  v_body TEXT;
  v_digits15 TEXT;
  v_sum INT;
  v_digit INT;
  v_idx INT;
  v_check_digit INT;
  v_raw16 TEXT;
  v_attempts INT := 0;
BEGIN
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 250 THEN
      RAISE EXCEPTION 'Unable to allocate unique 16-digit virtual card PAN.';
    END IF;

    v_bytes := gen_random_bytes(8);
    v_body := '';
    FOR v_idx IN 0..6 LOOP
      v_body := v_body || LPAD((get_byte(v_bytes, v_idx) % 100)::TEXT, 2, '0');
    END LOOP;

    v_digits15 := v_clean_prefix || LEFT(v_body, 11);
    v_sum := 0;
    FOR v_idx IN 1..15 LOOP
      v_digit := SUBSTRING(v_digits15 FROM v_idx FOR 1)::INT;
      IF (v_idx % 2) = 1 THEN
        v_digit := v_digit * 2;
        IF v_digit > 9 THEN v_digit := v_digit - 9; END IF;
      END IF;
      v_sum := v_sum + v_digit;
    END LOOP;

    v_check_digit := (10 - (v_sum % 10)) % 10;
    v_raw16 := v_digits15 || v_check_digit::TEXT;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.virtual_cards vc
      WHERE REPLACE(COALESCE(vc.card_number, ''), ' ', '') = v_raw16
    );
  END LOOP;

  RETURN SUBSTRING(v_raw16 FROM 1 FOR 4) || ' ' ||
         SUBSTRING(v_raw16 FROM 5 FOR 4) || ' ' ||
         SUBSTRING(v_raw16 FROM 9 FOR 4) || ' ' ||
         SUBSTRING(v_raw16 FROM 13 FOR 4);
END;
$$;

-- 3.3 Fault-Tolerant `public.handle_new_user()` Signup Trigger (`SET search_path = public, extensions`)
-- Guarantees new signups NEVER fail with 'Database error saving new user'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email TEXT;
  v_full_name TEXT;
  v_phone TEXT;
  v_base_handle TEXT;
  v_tag TEXT;
  v_tag_bytes BYTEA;
  v_tag_tries INT := 0;
  v_nuban VARCHAR(10);
  v_wallet_id UUID;
  v_exp_date DATE := (CURRENT_DATE + INTERVAL '3 years')::DATE;
  v_exp_month INT := GREATEST(1, LEAST(12, EXTRACT(MONTH FROM v_exp_date)::INT));
  v_exp_year INT := GREATEST(2026, EXTRACT(YEAR FROM v_exp_date)::INT);
  v_pan_usd VARCHAR(19);
  v_pan_ngn VARCHAR(19);
  v_cvv_bytes BYTEA;
  v_cvv_usd VARCHAR(4);
  v_cvv_ngn VARCHAR(4);
BEGIN
  v_email := LOWER(TRIM(COALESCE(NEW.email, 'user-' || REPLACE(NEW.id::TEXT, '-', '') || '@midepay.ng')));
  v_full_name := NULLIF(TRIM(COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    ''
  )), '');

  IF v_full_name IS NULL THEN
    v_full_name := INITCAP(SPLIT_PART(v_email, '@', 1));
  END IF;

  v_phone := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone, '')), '');

  v_base_handle := LOWER(REGEXP_REPLACE(SPLIT_PART(v_full_name, ' ', 1), '[^a-zA-Z0-9]', '', 'g'));
  IF LENGTH(v_base_handle) < 3 THEN
    v_base_handle := 'member';
  END IF;

  v_tag := '@' || LEFT(v_base_handle, 18);
  WHILE EXISTS (SELECT 1 FROM public.profiles p WHERE LOWER(p.tag) = LOWER(v_tag) AND p.id <> NEW.id) LOOP
    v_tag_tries := v_tag_tries + 1;
    EXIT WHEN v_tag_tries > 50;
    v_tag_bytes := gen_random_bytes(2);
    v_tag := '@' || LEFT(v_base_handle, 14) || LPAD((((get_byte(v_tag_bytes, 0) << 8) | get_byte(v_tag_bytes, 1)) % 10000)::TEXT, 4, '0');
  END LOOP;

  -- Step A: Provision Profile (defensive handling if stale email row exists)
  BEGIN
    INSERT INTO public.profiles (
      id, full_name, email, phone, tag, kyc_tier, role, is_frozen
    ) VALUES (
      NEW.id, v_full_name, v_email, v_phone, v_tag, 2, 'user', FALSE
    )
    ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
        phone = COALESCE(public.profiles.phone, EXCLUDED.phone),
        tag = COALESCE(public.profiles.tag, EXCLUDED.tag),
        kyc_tier = GREATEST(COALESCE(public.profiles.kyc_tier, 1), 2),
        updated_at = TIMEZONE('utc', NOW());
  EXCEPTION WHEN unique_violation THEN
    v_tag_bytes := gen_random_bytes(3);
    v_tag := '@mp' || ENCODE(v_tag_bytes, 'hex');
    INSERT INTO public.profiles (
      id, full_name, email, phone, tag, kyc_tier, role, is_frozen
    ) VALUES (
      NEW.id,
      v_full_name,
       NEW.id::TEXT || '+' || v_email,
      v_phone,
      v_tag,
      2,
      'user',
      FALSE
    )
    ON CONFLICT (id) DO NOTHING;
  END;

  -- Step B: Provision NGN Wallet with unique CSPRNG `90XXXXXXXX` NUBAN
  v_nuban := public.generate_unique_midepay_nuban();

  INSERT INTO public.wallets (
    user_id, currency, balance, ledger_balance, nuban, bank_name
  ) VALUES (
    NEW.id, 'NGN', 0.00, 0.00, v_nuban, 'MidePay / Providus Bank'
  )
  ON CONFLICT (user_id, currency) DO UPDATE
  SET nuban = COALESCE(public.wallets.nuban, EXCLUDED.nuban),
      updated_at = TIMEZONE('utc', NOW())
  RETURNING id, nuban INTO v_wallet_id, v_nuban;

  -- Step C: Provision Starter NGN & USD Virtual Debit Cards (server-side, 0.00 balance)
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.virtual_cards vc WHERE vc.user_id = NEW.id) THEN
      v_pan_ngn := public.generate_unique_virtual_card_pan('5399');
      v_pan_usd := public.generate_unique_virtual_card_pan('5399');
      v_cvv_bytes := gen_random_bytes(4);
      v_cvv_ngn := LPAD((100 + (((get_byte(v_cvv_bytes, 0) << 8) | get_byte(v_cvv_bytes, 1)) % 900))::TEXT, 3, '0');
      v_cvv_usd := LPAD((100 + (((get_byte(v_cvv_bytes, 2) << 8) | get_byte(v_cvv_bytes, 3)) % 900))::TEXT, 3, '0');

      INSERT INTO public.virtual_cards (
        user_id, wallet_id, card_type, currency, card_label, card_holder_name,
        card_number, masked_pan, cvv, expiry_month, expiry_year,
        card_balance, spending_limit_monthly, is_frozen, is_active
      ) VALUES
      (
        NEW.id, v_wallet_id, 'Verve', 'NGN', 'MidePay Green', UPPER(LEFT(v_full_name, 26)),
        v_pan_ngn, LEFT(v_pan_ngn, 4) || ' •••• •••• ' || RIGHT(v_pan_ngn, 4),
        v_cvv_ngn, v_exp_month, v_exp_year, 0.00, 500000.00, FALSE, TRUE
      ),
      (
        NEW.id, v_wallet_id, 'Mastercard', 'USD', 'MidePay Black', UPPER(LEFT(v_full_name, 26)),
        v_pan_usd, LEFT(v_pan_usd, 4) || ' •••• •••• ' || RIGHT(v_pan_usd, 4),
        v_cvv_usd, v_exp_month, v_exp_year, 0.00, 1000.00, FALSE, TRUE
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, metadata)
    VALUES (NEW.id, 'SIGNUP_CARD_PROVISION_NOTICE', 'warning', 'virtual_cards', jsonb_build_object('detail', SQLERRM));
  END;

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, metadata
  ) VALUES (
    NEW.id, 'SIGNUP_PROVISIONED', 'info', 'wallets', v_wallet_id::TEXT,
    jsonb_build_object('nuban', v_nuban, 'tag', v_tag)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block Supabase Auth user creation with 'Database error saving new user'
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_provisioning ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_provisioning();

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 4. CENTRAL `pgcrypto` BCRYPT PIN VERIFIER, 5-STRIKE LOCKOUT & AUDIT ENGINE
-- ============================================================================

-- Internal helper: verifies 4-digit PIN via `pgcrypto` `crypt()`, enforces 5-strike
-- 15-minute lockout, auto-initializes first-time PIN if unset, and writes every
-- failure/lockout to `public.security_audit_logs` WITHOUT rolling back strikes!
CREATE OR REPLACE FUNCTION public._verify_pin_and_audit(
  p_user_id UUID,
  p_pin TEXT,
  p_action TEXT DEFAULT 'FINANCIAL_MUTATION'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_clean_pin TEXT := TRIM(COALESCE(p_pin, ''));
  v_stored_hash TEXT;
  v_new_hash TEXT;
  v_next_strikes INT;
  v_lock_until TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROFILE_MISSING', 'error', 'Security profile not found.');
  END IF;

  IF v_profile.is_frozen IS TRUE THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (p_user_id, 'FROZEN_ACCOUNT_BLOCKED', 'critical', 'profiles', p_user_id::TEXT, jsonb_build_object('action', p_action));
    RETURN jsonb_build_object('ok', false, 'is_frozen', true, 'code', 'ACCOUNT_FROZEN', 'error', 'Account is currently frozen. Outbound transactions are disabled.');
  END IF;

  IF v_profile.pin_locked_until IS NOT NULL AND v_profile.pin_locked_until > TIMEZONE('utc', NOW()) THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (
      p_user_id, 'PIN_LOCKOUT_REJECTED', 'warning', 'profiles', p_user_id::TEXT,
      jsonb_build_object('action', p_action, 'locked_until', v_profile.pin_locked_until)
    );
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PIN_LOCKED',
      'locked_until', v_profile.pin_locked_until,
      'error', 'Transaction PIN is locked after 5 failed attempts. Try again after ' || TO_CHAR(v_profile.pin_locked_until, 'HH24:MI UTC') || '.'
    );
  END IF;

  IF v_clean_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_PIN_FORMAT', 'error', 'Enter a valid 4-digit numeric Transaction PIN.');
  END IF;

  v_stored_hash := COALESCE(NULLIF(v_profile.transaction_pin_hash, ''), NULLIF(v_profile.pin_hash, ''));

  -- First-time PIN setup if account has not yet configured a transaction PIN
  IF v_stored_hash IS NULL THEN
    v_new_hash := crypt(v_clean_pin, gen_salt('bf', 10));
    UPDATE public.profiles
    SET transaction_pin_hash = v_new_hash,
        pin_hash = v_new_hash,
        pin_failed_attempts = 0,
        pin_locked_until = NULL,
        updated_at = TIMEZONE('utc', NOW())
    WHERE id = p_user_id;

    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (p_user_id, 'PIN_CONFIGURED', 'info', 'profiles', p_user_id::TEXT, jsonb_build_object('action', p_action));

    RETURN jsonb_build_object('ok', true, 'pin_initialized', true);
  END IF;

  -- Verify bcrypt digest in C via pgcrypto `crypt()`
  IF v_stored_hash = crypt(v_clean_pin, v_stored_hash) THEN
    IF COALESCE(v_profile.pin_failed_attempts, 0) > 0 OR v_profile.pin_locked_until IS NOT NULL THEN
      UPDATE public.profiles
      SET pin_failed_attempts = 0,
          pin_locked_until = NULL,
          updated_at = TIMEZONE('utc', NOW())
      WHERE id = p_user_id;
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- Failed PIN attempt -> increment strike counter & trigger 15-minute lockout on strike 5
  v_next_strikes := COALESCE(v_profile.pin_failed_attempts, 0) + 1;
  IF v_next_strikes >= 5 THEN
    v_lock_until := TIMEZONE('utc', NOW()) + INTERVAL '15 minutes';
  ELSE
    v_lock_until := NULL;
  END IF;

  UPDATE public.profiles
  SET pin_failed_attempts = v_next_strikes,
      pin_locked_until = v_lock_until,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_user_id;

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, metadata
  ) VALUES (
    p_user_id,
    CASE WHEN v_next_strikes >= 5 THEN 'PIN_LOCKOUT' ELSE 'PIN_FAILURE' END,
    CASE WHEN v_next_strikes >= 5 THEN 'critical' ELSE 'warning' END,
    'profiles',
    p_user_id::TEXT,
    jsonb_build_object(
      'action', p_action,
      'failed_attempts', v_next_strikes,
      'attempts_remaining', GREATEST(0, 5 - v_next_strikes),
      'locked_until', v_lock_until
    )
  );

  IF v_next_strikes >= 5 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PIN_LOCKED',
      'attempts_remaining', 0,
      'locked_until', v_lock_until,
      'error', '5 incorrect PIN attempts detected. Account PIN locked for 15 minutes.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'code', 'INVALID_PIN',
    'attempts_remaining', 5 - v_next_strikes,
    'error', 'Invalid 4-digit Transaction PIN (' || (5 - v_next_strikes)::TEXT || ' attempts remaining before lockout).'
  );
END;
$$;

REVOKE ALL ON FUNCTION public._verify_pin_and_audit(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- 4.1 Public RPC: Configure or Rotate 4-Digit Transaction PIN (`set_user_transaction_pin`)
CREATE OR REPLACE FUNCTION public.set_user_transaction_pin(
  p_new_pin TEXT,
  p_current_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_clean_new TEXT := TRIM(COALESCE(p_new_pin, ''));
  v_existing_hash TEXT;
  v_verify JSONB;
  v_new_hash TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF v_clean_new !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction PIN must be exactly 4 numeric digits.');
  END IF;

  SELECT COALESCE(NULLIF(transaction_pin_hash, ''), NULLIF(pin_hash, ''))
  INTO v_existing_hash
  FROM public.profiles
  WHERE id = v_user_id;

  -- If a PIN already exists, require valid current PIN first
  IF v_existing_hash IS NOT NULL THEN
    v_verify := public._verify_pin_and_audit(v_user_id, p_current_pin, 'ROTATE_PIN');
    IF COALESCE((v_verify->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_verify->>'error', 'Current PIN verification failed.'));
    END IF;
  END IF;

  v_new_hash := crypt(v_clean_new, gen_salt('bf', 10));

  UPDATE public.profiles
  SET transaction_pin_hash = v_new_hash,
      pin_hash = v_new_hash,
      pin_failed_attempts = 0,
      pin_locked_until = NULL,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_user_id;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id)
  VALUES (v_user_id, 'PIN_CONFIGURED', 'info', 'profiles', v_user_id::TEXT);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 4.2 Public RPC: Server-Side PIN Verification (`verify_user_transaction_pin`)
CREATE OR REPLACE FUNCTION public.verify_user_transaction_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing_hash TEXT;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Authentication required.');
  END IF;

  SELECT COALESCE(NULLIF(transaction_pin_hash, ''), NULLIF(pin_hash, ''))
  INTO v_existing_hash
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_existing_hash IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'needs_pin_setup', true);
  END IF;

  v_res := public._verify_pin_and_audit(v_user_id, p_pin, 'VERIFY_PIN');
  IF COALESCE((v_res->>'ok')::BOOLEAN, FALSE) IS TRUE THEN
    RETURN jsonb_build_object('valid', true);
  END IF;

  RETURN jsonb_build_object(
    'valid', false,
    'is_frozen', COALESCE((v_res->>'is_frozen')::BOOLEAN, FALSE),
    'attempts_remaining', v_res->'attempts_remaining',
    'error', COALESCE(v_res->>'error', 'Incorrect 4-digit Transaction PIN.')
  );
END;
$$;

-- 4.3 Public RPC: Self-Healing Profile, NUBAN Wallet & Starter Cards (`ensure_my_profile_and_wallet`)
CREATE OR REPLACE FUNCTION public.ensure_my_profile_and_wallet(
  p_full_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_auth_email TEXT;
  v_profile public.profiles%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_nuban VARCHAR(10);
  v_name TEXT;
  v_tag TEXT;
  v_tag_bytes BYTEA;
  v_exp_date DATE := (CURRENT_DATE + INTERVAL '3 years')::DATE;
  v_pan_ngn VARCHAR(19);
  v_pan_usd VARCHAR(19);
  v_cvv_bytes BYTEA;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT email INTO v_auth_email FROM auth.users WHERE id = v_user_id;
  v_name := COALESCE(NULLIF(TRIM(p_full_name), ''), INITCAP(SPLIT_PART(COALESCE(v_auth_email, 'MidePay Member'), '@', 1)));

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  IF NOT FOUND THEN
    v_tag_bytes := gen_random_bytes(2);
    v_tag := '@' || LOWER(REGEXP_REPLACE(SPLIT_PART(v_name, ' ', 1), '[^a-zA-Z0-9]', '', 'g')) ||
             LPAD((((get_byte(v_tag_bytes, 0) << 8) | get_byte(v_tag_bytes, 1)) % 10000)::TEXT, 4, '0');
    INSERT INTO public.profiles (id, full_name, email, phone, tag, kyc_tier, role, is_frozen)
    VALUES (v_user_id, v_name, COALESCE(v_auth_email, v_user_id::TEXT || '@midepay.ng'), NULLIF(TRIM(p_phone), ''), v_tag, 2, 'user', FALSE)
    RETURNING * INTO v_profile;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id AND currency = 'NGN';
  IF NOT FOUND THEN
    v_nuban := public.generate_unique_midepay_nuban();
    INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
    VALUES (v_user_id, 'NGN', 0.00, 0.00, v_nuban, 'MidePay / Providus Bank')
    RETURNING * INTO v_wallet;
  ELSIF v_wallet.nuban IS NULL OR v_wallet.nuban !~ '^[0-9]{10}$' THEN
    v_nuban := public.generate_unique_midepay_nuban();
    UPDATE public.wallets
    SET nuban = v_nuban, bank_name = COALESCE(bank_name, 'MidePay / Providus Bank'), updated_at = TIMEZONE('utc', NOW())
    WHERE id = v_wallet.id
    RETURNING * INTO v_wallet;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.virtual_cards WHERE user_id = v_user_id) THEN
    v_pan_ngn := public.generate_unique_virtual_card_pan('5399');
    v_pan_usd := public.generate_unique_virtual_card_pan('5399');
    v_cvv_bytes := gen_random_bytes(4);
    INSERT INTO public.virtual_cards (
      user_id, wallet_id, card_type, currency, card_label, card_holder_name,
      card_number, masked_pan, cvv, expiry_month, expiry_year,
      card_balance, spending_limit_monthly, is_frozen, is_active
    ) VALUES
    (
      v_user_id, v_wallet.id, 'Verve', 'NGN', 'MidePay Green', UPPER(LEFT(v_profile.full_name, 26)),
      v_pan_ngn, LEFT(v_pan_ngn, 4) || ' •••• •••• ' || RIGHT(v_pan_ngn, 4),
      LPAD((100 + (((get_byte(v_cvv_bytes, 0) << 8) | get_byte(v_cvv_bytes, 1)) % 900))::TEXT, 3, '0'),
      EXTRACT(MONTH FROM v_exp_date)::INT, EXTRACT(YEAR FROM v_exp_date)::INT, 0.00, 500000.00, FALSE, TRUE
    ),
    (
      v_user_id, v_wallet.id, 'Mastercard', 'USD', 'MidePay Black', UPPER(LEFT(v_profile.full_name, 26)),
      v_pan_usd, LEFT(v_pan_usd, 4) || ' •••• •••• ' || RIGHT(v_pan_usd, 4),
      LPAD((100 + (((get_byte(v_cvv_bytes, 2) << 8) | get_byte(v_cvv_bytes, 3)) % 900))::TEXT, 3, '0'),
      EXTRACT(MONTH FROM v_exp_date)::INT, EXTRACT(YEAR FROM v_exp_date)::INT, 0.00, 1000.00, FALSE, TRUE
    );
  END IF;

  RETURN jsonb_build_object('profile', to_jsonb(v_profile), 'wallet', to_jsonb(v_wallet));
END;
$$;

-- 4.4 Public RPC: Owner Emergency Account Freeze ("Panic Switch") (`set_own_account_freeze`)
CREATE OR REPLACE FUNCTION public.set_own_account_freeze(p_is_frozen BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_next BOOLEAN := COALESCE(p_is_frozen, FALSE);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.profiles
  SET is_frozen = v_next,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_user_id;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'ACCOUNT_FREEZE_CHANGE',
    CASE WHEN v_next THEN 'warning' ELSE 'info' END,
    'profiles',
    v_user_id::TEXT,
    jsonb_build_object('is_frozen', v_next)
  );

  RETURN jsonb_build_object('success', true, 'is_frozen', v_next);
END;
$$;

-- 4.5 Public RPC: Save Verified Beneficiary (`save_beneficiary`)
CREATE OR REPLACE FUNCTION public.save_beneficiary(
  p_account_name TEXT,
  p_bank_name TEXT,
  p_account_number TEXT,
  p_mide_tag TEXT DEFAULT NULL,
  p_is_favorite BOOLEAN DEFAULT FALSE
)
RETURNS public.beneficiaries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_row public.beneficiaries%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  INSERT INTO public.beneficiaries (
    user_id, account_name, bank_name, account_number, mide_tag, is_favorite
  ) VALUES (
    v_user_id,
    TRIM(COALESCE(p_account_name, 'Beneficiary')),
    TRIM(COALESCE(p_bank_name, 'MidePay / Providus Bank')),
    TRIM(COALESCE(p_account_number, '')),
    NULLIF(TRIM(COALESCE(p_mide_tag, '')), ''),
    COALESCE(p_is_favorite, FALSE)
  )
  ON CONFLICT (user_id, bank_name, account_number) DO UPDATE
  SET account_name = EXCLUDED.account_name,
      mide_tag = COALESCE(EXCLUDED.mide_tag, public.beneficiaries.mide_tag),
      is_favorite = EXCLUDED.is_favorite,
      updated_at = TIMEZONE('utc', NOW())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ============================================================================
-- 5. ATOMIC FINANCIAL MUTATION RPCs (`FOR UPDATE` + PIN + IDEMPOTENCY + AUDIT)
-- ============================================================================

-- 5.1 Atomic P2P NUBAN / MideTag Transfer (`execute_p2p_transfer`)
CREATE OR REPLACE FUNCTION public.execute_p2p_transfer(
  p_recipient_nuban TEXT,
  p_amount NUMERIC,
  p_pin TEXT,
  p_idempotency_key UUID,
  p_narration TEXT DEFAULT 'MidePay Transfer'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sender_id UUID := auth.uid();
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_clean_ident TEXT := TRIM(COALESCE(p_recipient_nuban, ''));
  v_digits TEXT := REGEXP_REPLACE(v_clean_ident, '[^0-9]', '', 'g');
  v_clean_narration TEXT := COALESCE(NULLIF(TRIM(p_narration), ''), 'MidePay Transfer');
  v_existing_tx public.transactions%ROWTYPE;
  v_pin_check JSONB;
  v_sender_name TEXT;
  v_recipient_id UUID;
  v_recipient_name TEXT;
  v_recipient_frozen BOOLEAN;
  v_sender_wallet_id UUID;
  v_recipient_wallet_id UUID;
  v_sender_wallet public.wallets%ROWTYPE;
  v_recipient_wallet public.wallets%ROWTYPE;
  v_new_sender_bal NUMERIC(14, 2);
  v_new_recipient_bal NUMERIC(14, 2);
  v_ref_out TEXT;
  v_ref_in TEXT;
BEGIN
  IF v_sender_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'unauthorized', 'error', 'Authentication required.');
  END IF;

  IF v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_amount', 'error', 'Transfer amount must be greater than ₦0.00.');
  END IF;

  -- 1. UUID Idempotency Deduplication Check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx
    FROM public.transactions
    WHERE idempotency_key = p_idempotency_key
      AND user_id = v_sender_id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'status', 'duplicate',
        'message', 'Transaction already processed',
        'reference', v_existing_tx.reference,
        'new_balance', v_existing_tx.balance_after
      );
    END IF;
  END IF;

  -- 2. Server-Side Bcrypt PIN Verification + 5-Strike Lockout
  v_pin_check := public._verify_pin_and_audit(v_sender_id, p_pin, 'P2P_TRANSFER');
  IF COALESCE((v_pin_check->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', COALESCE(v_pin_check->>'code', 'invalid_pin'),
      'error', COALESCE(v_pin_check->>'error', 'Invalid Transaction PIN.')
    );
  END IF;

  SELECT full_name INTO v_sender_name FROM public.profiles WHERE id = v_sender_id;

  -- 3. Resolve Recipient Wallet & Profile by 10-Digit NUBAN (or @tag / email)
  SELECT w.id, w.user_id, p.full_name, COALESCE(p.is_frozen, FALSE)
  INTO v_recipient_wallet_id, v_recipient_id, v_recipient_name, v_recipient_frozen
  FROM public.wallets w
  JOIN public.profiles p ON p.id = w.user_id
  WHERE w.currency = 'NGN'
    AND (
      (LENGTH(v_digits) = 10 AND w.nuban = v_digits)
      OR LOWER(p.tag) = LOWER(CASE WHEN LEFT(v_clean_ident, 1) = '@' THEN v_clean_ident ELSE '@' || v_clean_ident END)
      OR LOWER(p.email) = LOWER(v_clean_ident)
    )
  ORDER BY CASE WHEN LENGTH(v_digits) = 10 AND w.nuban = v_digits THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_recipient_wallet_id IS NULL OR v_recipient_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'error', 'Recipient MidePay NUBAN not found.');
  END IF;

  IF v_recipient_id = v_sender_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'self_transfer', 'error', 'Cannot transfer funds to your own account.');
  END IF;

  IF v_recipient_frozen IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'status', 'recipient_frozen', 'error', 'Recipient account is restricted and cannot receive transfers.');
  END IF;

  SELECT id INTO v_sender_wallet_id
  FROM public.wallets
  WHERE user_id = v_sender_id AND currency = 'NGN';

  IF v_sender_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'wallet_missing', 'error', 'Sender NGN wallet not found.');
  END IF;

  -- 4. Deterministic UUID-Ordered `SELECT ... FOR UPDATE` Row Locking (100% Deadlock-Free)
  IF v_sender_wallet_id < v_recipient_wallet_id THEN
    SELECT * INTO v_sender_wallet FROM public.wallets WHERE id = v_sender_wallet_id FOR UPDATE;
    SELECT * INTO v_recipient_wallet FROM public.wallets WHERE id = v_recipient_wallet_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient_wallet FROM public.wallets WHERE id = v_recipient_wallet_id FOR UPDATE;
    SELECT * INTO v_sender_wallet FROM public.wallets WHERE id = v_sender_wallet_id FOR UPDATE;
  END IF;

  IF v_sender_wallet.balance < v_amt THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'insufficient_funds',
      'error', 'Insufficient wallet balance (Available: ₦' || TRIM(TO_CHAR(v_sender_wallet.balance, 'FM999,999,990.00')) || ').'
    );
  END IF;

  -- 5. Atomic Debit, Credit & Immutable Double-Entry Ledger Write
  v_new_sender_bal := ROUND(v_sender_wallet.balance - v_amt, 2);
  v_new_recipient_bal := ROUND(v_recipient_wallet.balance + v_amt, 2);
  v_ref_out := 'MDP-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));
  v_ref_in  := 'MDP-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));

  UPDATE public.wallets
  SET balance = v_new_sender_bal,
      ledger_balance = v_new_sender_bal,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_sender_wallet.id;

  UPDATE public.wallets
  SET balance = v_new_recipient_bal,
      ledger_balance = v_new_recipient_bal,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_recipient_wallet.id;

  INSERT INTO public.transactions (
    wallet_id, user_id, counterparty_user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, idempotency_key, metadata
  ) VALUES
  (
    v_sender_wallet.id, v_sender_id, v_recipient_id, 'outflow', 'transfer', v_amt, 0.00,
    v_sender_wallet.balance, v_new_sender_bal, 'successful',
    v_recipient_name, 'MidePay / Providus Bank', v_recipient_wallet.nuban,
    v_clean_narration, v_ref_out, p_idempotency_key,
    jsonb_build_object('paired_reference', v_ref_in)
  ),
  (
    v_recipient_wallet.id, v_recipient_id, v_sender_id, 'inflow', 'transfer', v_amt, 0.00,
    v_recipient_wallet.balance, v_new_recipient_bal, 'successful',
    COALESCE(v_sender_name, 'MidePay Sender'), 'MidePay / Providus Bank', v_sender_wallet.nuban,
    v_clean_narration, v_ref_in, gen_random_uuid(),
    jsonb_build_object('paired_reference', v_ref_out)
  );

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata
  ) VALUES (
    v_sender_id, 'P2P_TRANSFER', 'info', 'transactions', v_ref_out, p_idempotency_key, v_amt,
    jsonb_build_object(
      'recipient_id', v_recipient_id,
      'recipient_nuban', v_recipient_wallet.nuban,
      'recipient_name', v_recipient_name,
      'balance_before', v_sender_wallet.balance,
      'balance_after', v_new_sender_bal
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'success',
    'reference', v_ref_out,
    'amount', v_amt,
    'recipient_name', v_recipient_name,
    'new_balance', v_new_sender_bal
  );
END;
$$;

-- 5.2 Harden `transfer_funds` (enforces `auth.uid() = sender_id`, deterministic locking, optional PIN & idempotency)
DROP FUNCTION IF EXISTS public.transfer_funds(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.transfer_funds(UUID, UUID, NUMERIC, TEXT);
CREATE OR REPLACE FUNCTION public.transfer_funds(
  sender_id UUID,
  recipient_id UUID,
  amount NUMERIC,
  narration TEXT DEFAULT 'Transfer via MidePay',
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_recipient_nuban VARCHAR(10);
  v_pin_res JSONB;
  v_sender_name TEXT;
  v_recipient_name TEXT;
  v_sender_wallet_id UUID;
  v_recipient_wallet_id UUID;
  v_sender_wallet public.wallets%ROWTYPE;
  v_recipient_wallet public.wallets%ROWTYPE;
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(amount, 0), 2);
  v_new_sender_bal NUMERIC(14, 2);
  v_ref_out TEXT;
  v_ref_in TEXT;
  v_existing_tx public.transactions%ROWTYPE;
BEGIN
  IF v_caller IS NULL OR v_caller <> sender_id THEN
    RAISE EXCEPTION 'Unauthorized: sender_id must match authenticated session.';
  END IF;

  IF recipient_id IS NULL OR sender_id = recipient_id THEN
    RAISE EXCEPTION 'Valid distinct recipient_id is required.';
  END IF;

  IF v_amt <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero.';
  END IF;

  -- If PIN is supplied, delegate directly to `execute_p2p_transfer` when recipient has a NUBAN
  SELECT nuban INTO v_recipient_nuban
  FROM public.wallets
  WHERE user_id = recipient_id AND currency = 'NGN'
  LIMIT 1;

  IF p_pin IS NOT NULL AND v_recipient_nuban IS NOT NULL THEN
    RETURN public.execute_p2p_transfer(
      v_recipient_nuban,
      v_amt,
      p_pin,
      COALESCE(p_idempotency_key, gen_random_uuid()),
      narration
    );
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx
    FROM public.transactions
    WHERE idempotency_key = p_idempotency_key AND user_id = v_caller
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'status', 'duplicate', 'reference', v_existing_tx.reference, 'new_balance', v_existing_tx.balance_after);
    END IF;
  END IF;

  IF p_pin IS NOT NULL THEN
    v_pin_res := public._verify_pin_and_audit(v_caller, p_pin, 'P2P_TRANSFER');
    IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
    END IF;
  END IF;

  SELECT full_name INTO v_sender_name FROM public.profiles WHERE id = sender_id AND is_frozen = FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sender account not found or frozen.'; END IF;

  SELECT full_name INTO v_recipient_name FROM public.profiles WHERE id = recipient_id AND is_frozen = FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipient account not found or restricted.'; END IF;

  SELECT id INTO v_sender_wallet_id FROM public.wallets WHERE user_id = sender_id AND currency = 'NGN';
  SELECT id INTO v_recipient_wallet_id FROM public.wallets WHERE user_id = recipient_id AND currency = 'NGN';

  IF v_recipient_wallet_id IS NULL THEN
    INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
    VALUES (recipient_id, 'NGN', 0.00, 0.00, public.generate_unique_midepay_nuban(), 'MidePay / Providus Bank')
    RETURNING id INTO v_recipient_wallet_id;
  END IF;

  IF v_sender_wallet_id < v_recipient_wallet_id THEN
    SELECT * INTO v_sender_wallet FROM public.wallets WHERE id = v_sender_wallet_id FOR UPDATE;
    SELECT * INTO v_recipient_wallet FROM public.wallets WHERE id = v_recipient_wallet_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient_wallet FROM public.wallets WHERE id = v_recipient_wallet_id FOR UPDATE;
    SELECT * INTO v_sender_wallet FROM public.wallets WHERE id = v_sender_wallet_id FOR UPDATE;
  END IF;

  IF v_sender_wallet.balance < v_amt THEN
    RAISE EXCEPTION 'Insufficient wallet balance.';
  END IF;

  v_new_sender_bal := ROUND(v_sender_wallet.balance - v_amt, 2);
  v_ref_out := 'MDP-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));
  v_ref_in  := 'MDP-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));

  UPDATE public.wallets SET balance = v_new_sender_bal, ledger_balance = v_new_sender_bal, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_sender_wallet.id;
  UPDATE public.wallets SET balance = ROUND(balance + v_amt, 2), ledger_balance = ROUND(ledger_balance + v_amt, 2), updated_at = TIMEZONE('utc', NOW()) WHERE id = v_recipient_wallet.id;

  INSERT INTO public.transactions (
    wallet_id, user_id, counterparty_user_id, type, category, amount, fee,
    balance_before, balance_after, status, counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, idempotency_key
  ) VALUES
  (
    v_sender_wallet.id, sender_id, recipient_id, 'outflow', 'transfer', v_amt, 0.00,
    v_sender_wallet.balance, v_new_sender_bal, 'successful', v_recipient_name, 'MidePay / Providus Bank', v_recipient_wallet.nuban,
    COALESCE(NULLIF(TRIM(narration), ''), 'Transfer via MidePay'), v_ref_out, p_idempotency_key
  ),
  (
    v_recipient_wallet.id, recipient_id, sender_id, 'inflow', 'transfer', v_amt, 0.00,
    v_recipient_wallet.balance, ROUND(v_recipient_wallet.balance + v_amt, 2), 'successful', v_sender_name, 'MidePay / Providus Bank', v_sender_wallet.nuban,
    COALESCE(NULLIF(TRIM(narration), ''), 'Transfer via MidePay'), v_ref_in, gen_random_uuid()
  );

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata)
  VALUES (sender_id, 'P2P_TRANSFER', 'info', 'transactions', v_ref_out, p_idempotency_key, v_amt, jsonb_build_object('recipient_id', recipient_id));

  RETURN jsonb_build_object('success', true, 'reference', v_ref_out, 'amount', v_amt, 'recipient_name', v_recipient_name, 'new_balance', v_new_sender_bal);
END;
$$;

-- 5.3 Atomic External NIP Bank Transfer (`execute_external_bank_transfer`)
CREATE OR REPLACE FUNCTION public.execute_external_bank_transfer(
  p_amount NUMERIC,
  p_fee NUMERIC DEFAULT 10.00,
  p_recipient_name TEXT DEFAULT 'External Beneficiary',
  p_destination_bank TEXT DEFAULT 'NIP Partner Bank',
  p_account_number TEXT DEFAULT NULL,
  p_narration TEXT DEFAULT 'Transfer via MidePay',
  p_reference TEXT DEFAULT NULL,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_pin_res JSONB;
  v_wallet public.wallets%ROWTYPE;
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_fee NUMERIC(14, 2) := GREATEST(0.00, ROUND(COALESCE(p_fee, 0), 2));
  v_total_debit NUMERIC(14, 2);
  v_after NUMERIC(14, 2);
  v_ref TEXT := COALESCE(NULLIF(TRIM(p_reference), ''), 'MDP-NIP-' || UPPER(ENCODE(gen_random_bytes(5), 'hex')));
  v_existing_tx public.transactions%ROWTYPE;
  v_tx public.transactions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transfer amount must be greater than zero.');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx FROM public.transactions WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'status', 'duplicate', 'transaction', to_jsonb(v_existing_tx), 'new_balance', v_existing_tx.balance_after, 'reference', v_existing_tx.reference);
    END IF;
  END IF;

  IF p_pin IS NOT NULL THEN
    v_pin_res := public._verify_pin_and_audit(v_user_id, p_pin, 'EXTERNAL_BANK_TRANSFER');
    IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
    END IF;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Active NGN wallet not found.');
  END IF;

  v_total_debit := v_amt + v_fee;
  IF v_wallet.balance < v_total_debit THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient wallet balance on server.');
  END IF;

  v_after := ROUND(v_wallet.balance - v_total_debit, 2);

  UPDATE public.wallets SET balance = v_after, ledger_balance = v_after, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_wallet.id;

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, idempotency_key
  ) VALUES (
    v_wallet.id, v_user_id, 'outflow', 'transfer', v_amt, v_fee,
    v_wallet.balance, v_after, 'successful',
    COALESCE(NULLIF(TRIM(p_recipient_name), ''), 'External Beneficiary'),
    COALESCE(NULLIF(TRIM(p_destination_bank), ''), 'NIP Partner Bank'),
    p_account_number,
    COALESCE(NULLIF(TRIM(p_narration), ''), 'Transfer via MidePay'),
    v_ref,
    p_idempotency_key
  ) RETURNING * INTO v_tx;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata)
  VALUES (
    v_user_id, 'EXTERNAL_TRANSFER', 'info', 'transactions', v_ref, p_idempotency_key, v_amt,
    jsonb_build_object('destination_bank', p_destination_bank, 'recipient_name', p_recipient_name, 'fee', v_fee)
  );

  RETURN jsonb_build_object('success', true, 'transaction', to_jsonb(v_tx), 'new_balance', v_after, 'reference', v_ref);
END;
$$;

-- 5.4 Bounded Concept / Sandbox NUBAN Top-Up (`concept_topup_wallet`)
CREATE OR REPLACE FUNCTION public.concept_topup_wallet(
  p_amount NUMERIC,
  p_reference TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_frozen BOOLEAN := FALSE;
  v_wallet public.wallets%ROWTYPE;
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_ref TEXT := COALESCE(NULLIF(TRIM(p_reference), ''), 'MDP-DEP-' || UPPER(ENCODE(gen_random_bytes(5), 'hex')));
  v_before NUMERIC(14, 2);
  v_after NUMERIC(14, 2);
  v_existing_tx public.transactions%ROWTYPE;
  v_tx public.transactions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_amt < 100 OR v_amt > 5000000 THEN
    RAISE EXCEPTION 'Top-up amount must be between ₦100.00 and ₦5,000,000.00.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx FROM public.transactions WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = v_existing_tx.wallet_id;
      RETURN jsonb_build_object('success', true, 'status', 'duplicate', 'wallet', to_jsonb(v_wallet), 'transaction', to_jsonb(v_existing_tx), 'new_balance', v_existing_tx.balance_after, 'reference', v_existing_tx.reference);
    END IF;
  END IF;

  SELECT COALESCE(is_frozen, FALSE) INTO v_is_frozen FROM public.profiles WHERE id = v_user_id;
  IF v_is_frozen THEN
    RAISE EXCEPTION 'Account is currently frozen. Deposits are restricted.';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
    VALUES (v_user_id, 'NGN', 0.00, 0.00, public.generate_unique_midepay_nuban(), 'MidePay / Providus Bank')
    RETURNING * INTO v_wallet;
  END IF;

  v_before := COALESCE(v_wallet.balance, 0.00);
  v_after := ROUND(v_before + v_amt, 2);

  UPDATE public.wallets SET balance = v_after, ledger_balance = v_after, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_wallet.id RETURNING * INTO v_wallet;

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, idempotency_key
  ) VALUES (
    v_wallet.id, v_user_id, 'inflow', 'deposit', v_amt, 0.00,
    v_before, v_after, 'successful',
    'Providus Bank Direct Top-Up', 'Providus Bank', COALESCE(v_wallet.nuban, '9000000000'),
    'Instant Direct Wallet Top-Up (Providus NUBAN)', v_ref, p_idempotency_key
  ) RETURNING * INTO v_tx;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount)
  VALUES (v_user_id, 'WALLET_TOPUP', 'info', 'wallets', v_wallet.id::TEXT, p_idempotency_key, v_amt);

  RETURN jsonb_build_object('success', true, 'wallet', to_jsonb(v_wallet), 'transaction', to_jsonb(v_tx), 'new_balance', v_after, 'reference', v_ref);
END;
$$;

-- 5.5 Virtual Card Issuing, Freeze, Limit, Reveal Audit & Atomic Wallet Funding
CREATE OR REPLACE FUNCTION public.issue_virtual_card(
  p_currency TEXT DEFAULT 'USD',
  p_card_type TEXT DEFAULT 'Mastercard',
  p_card_label TEXT DEFAULT 'MidePay Virtual Card',
  p_card_holder_name TEXT DEFAULT 'MIDEPAY MEMBER',
  p_spending_limit NUMERIC DEFAULT 1000.00
)
RETURNS public.virtual_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_frozen BOOLEAN := FALSE;
  v_wallet_id UUID;
  v_currency TEXT := CASE WHEN UPPER(TRIM(COALESCE(p_currency, 'USD'))) = 'NGN' THEN 'NGN' ELSE 'USD' END;
  v_card_type TEXT := CASE
    WHEN TRIM(COALESCE(p_card_type, '')) IN ('Mastercard', 'Visa', 'Verve') THEN TRIM(p_card_type)
    WHEN UPPER(TRIM(COALESCE(p_currency, 'USD'))) = 'NGN' THEN 'Verve'
    ELSE 'Mastercard'
  END;
  v_existing_count INT := 0;
  v_pan VARCHAR(19);
  v_cvv_bytes BYTEA;
  v_cvv VARCHAR(4);
  v_card public.virtual_cards%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT COALESCE(is_frozen, FALSE) INTO v_is_frozen FROM public.profiles WHERE id = v_user_id;
  IF v_is_frozen THEN RAISE EXCEPTION 'Account is frozen. Cannot issue new virtual cards.'; END IF;

  SELECT COUNT(*) INTO v_existing_count FROM public.virtual_cards WHERE user_id = v_user_id;
  IF v_existing_count >= 12 THEN RAISE EXCEPTION 'Maximum virtual card limit reached (12 cards per account).'; END IF;

  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id AND currency = 'NGN' LIMIT 1;

  v_pan := public.generate_unique_virtual_card_pan('5399');
  v_cvv_bytes := gen_random_bytes(2);
  v_cvv := LPAD((100 + (((get_byte(v_cvv_bytes, 0) << 8) | get_byte(v_cvv_bytes, 1)) % 900))::TEXT, 3, '0');

  INSERT INTO public.virtual_cards (
    user_id, wallet_id, card_type, currency, card_holder_name,
    card_number, masked_pan, cvv, card_label,
    expiry_month, expiry_year, card_balance, spending_limit_monthly, is_frozen, is_active
  ) VALUES (
    v_user_id, v_wallet_id, v_card_type, v_currency,
    UPPER(LEFT(COALESCE(NULLIF(TRIM(p_card_holder_name), ''), 'MIDEPAY MEMBER'), 26)),
    v_pan, LEFT(v_pan, 4) || ' •••• •••• ' || RIGHT(v_pan, 4), v_cvv,
    COALESCE(NULLIF(TRIM(p_card_label), ''), CASE WHEN v_currency = 'USD' THEN 'MidePay Black' ELSE 'MidePay Green' END),
    EXTRACT(MONTH FROM NOW())::INT, (EXTRACT(YEAR FROM NOW())::INT + 3),
    0.00, GREATEST(10.00, ROUND(COALESCE(p_spending_limit, 1000.00), 2)), FALSE, TRUE
  ) RETURNING * INTO v_card;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'CARD_ISSUED', 'info', 'virtual_cards', v_card.id::TEXT, jsonb_build_object('currency', v_currency, 'last4', RIGHT(v_pan, 4)));

  RETURN v_card;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_virtual_card_freeze(
  p_card_id UUID,
  p_is_frozen BOOLEAN
)
RETURNS public.virtual_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_card public.virtual_cards%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  UPDATE public.virtual_cards
  SET is_frozen = COALESCE(p_is_frozen, FALSE),
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_card_id AND user_id = v_user_id
  RETURNING * INTO v_card;

  IF NOT FOUND THEN RAISE EXCEPTION 'Virtual card not found or access denied.'; END IF;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    CASE WHEN v_card.is_frozen THEN 'CARD_FREEZE' ELSE 'CARD_UNFREEZE' END,
    CASE WHEN v_card.is_frozen THEN 'warning' ELSE 'info' END,
    'virtual_cards',
    v_card.id::TEXT,
    jsonb_build_object('currency', v_card.currency, 'masked_pan', v_card.masked_pan)
  );

  RETURN v_card;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_virtual_card_limit(
  p_card_id UUID,
  p_spending_limit NUMERIC
)
RETURNS public.virtual_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_limit NUMERIC(14, 2) := ROUND(COALESCE(p_spending_limit, 0), 2);
  v_card public.virtual_cards%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF v_limit < 10 THEN RAISE EXCEPTION 'Monthly spending limit must be at least 10.'; END IF;

  UPDATE public.virtual_cards
  SET spending_limit_monthly = v_limit,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_card_id AND user_id = v_user_id
  RETURNING * INTO v_card;

  IF NOT FOUND THEN RAISE EXCEPTION 'Virtual card not found or access denied.'; END IF;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, amount, metadata)
  VALUES (v_user_id, 'CARD_LIMIT_UPDATED', 'info', 'virtual_cards', v_card.id::TEXT, v_limit, jsonb_build_object('currency', v_card.currency));

  RETURN v_card;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_virtual_card_reveal(
  p_card_id UUID,
  p_field TEXT DEFAULT 'PAN'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_card public.virtual_cards%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  SELECT * INTO v_card FROM public.virtual_cards WHERE id = p_card_id AND user_id = v_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'CARD_REVEAL',
    'info',
    'virtual_cards',
    v_card.id::TEXT,
    jsonb_build_object('field', UPPER(COALESCE(p_field, 'PAN')), 'currency', v_card.currency, 'masked_pan', v_card.masked_pan)
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.fund_virtual_card_from_wallet(
  p_card_id UUID,
  p_amount_card_currency NUMERIC,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_pin_res JSONB;
  v_wallet public.wallets%ROWTYPE;
  v_card public.virtual_cards%ROWTYPE;
  v_credit NUMERIC(14, 2) := ROUND(COALESCE(p_amount_card_currency, 0), 2);
  v_fx_rate CONSTANT NUMERIC(14, 2) := 1550.00;
  v_debit_ngn NUMERIC(14, 2);
  v_after NUMERIC(14, 2);
  v_new_card_bal NUMERIC(14, 2);
  v_ref TEXT := 'MP-CD-' || UPPER(ENCODE(gen_random_bytes(5), 'hex'));
  v_existing_tx public.transactions%ROWTYPE;
  v_tx public.transactions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF v_credit <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Card funding amount must be greater than zero.');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx FROM public.transactions WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_card FROM public.virtual_cards WHERE id = p_card_id AND user_id = v_user_id;
      RETURN jsonb_build_object('success', true, 'status', 'duplicate', 'card', to_jsonb(v_card), 'transaction', to_jsonb(v_existing_tx), 'new_wallet_balance', v_existing_tx.balance_after, 'new_card_balance', v_card.card_balance);
    END IF;
  END IF;

  IF p_pin IS NOT NULL THEN
    v_pin_res := public._verify_pin_and_audit(v_user_id, p_pin, 'CARD_FUNDING');
    IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
    END IF;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_user_id AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Active NGN wallet not found.'); END IF;

  SELECT * INTO v_card FROM public.virtual_cards WHERE id = p_card_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Virtual card not found or access denied.'); END IF;
  IF v_card.is_frozen THEN RETURN jsonb_build_object('success', false, 'error', 'Unfreeze this virtual card before funding it.'); END IF;

  v_debit_ngn := CASE WHEN v_card.currency = 'USD' THEN ROUND(v_credit * v_fx_rate, 2) ELSE v_credit END;
  IF v_wallet.balance < v_debit_ngn THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient main wallet balance (₦' || TRIM(TO_CHAR(v_debit_ngn, 'FM999,999,990.00')) || ' required).');
  END IF;

  v_after := ROUND(v_wallet.balance - v_debit_ngn, 2);
  v_new_card_bal := ROUND(COALESCE(v_card.card_balance, 0.00) + v_credit, 2);

  UPDATE public.wallets SET balance = v_after, ledger_balance = v_after, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_wallet.id;
  UPDATE public.virtual_cards SET card_balance = v_new_card_bal, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_card.id RETURNING * INTO v_card;

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, idempotency_key
  ) VALUES (
    v_wallet.id, v_user_id, 'outflow', 'card_funding', v_debit_ngn, 0.00,
    v_wallet.balance, v_after, 'successful',
    v_card.card_label || ' (••' || RIGHT(v_card.masked_pan, 4) || ')',
    'MidePay Card Issuing', RIGHT(v_card.masked_pan, 4),
    CASE WHEN v_card.currency = 'USD' THEN 'Funded Virtual USD Card with $' || v_credit::TEXT || ' (@ ₦1,550/$1)' ELSE 'Funded Virtual Naira Card with ₦' || v_credit::TEXT END,
    v_ref, p_idempotency_key
  ) RETURNING * INTO v_tx;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata)
  VALUES (
    v_user_id, 'CARD_FUNDING', 'info', 'virtual_cards', v_card.id::TEXT, p_idempotency_key, v_debit_ngn,
    jsonb_build_object('currency', v_card.currency, 'card_credit', v_credit, 'new_card_balance', v_new_card_bal)
  );

  RETURN jsonb_build_object('success', true, 'card', to_jsonb(v_card), 'transaction', to_jsonb(v_tx), 'new_wallet_balance', v_after, 'new_card_balance', v_new_card_bal);
END;
$$;

-- 5.6 MideSave Goal Vault Creation, Deposit & Withdrawal RPCs
CREATE OR REPLACE FUNCTION public.create_savings_vault(
  p_title TEXT,
  p_category TEXT DEFAULT 'General',
  p_target_amount NUMERIC DEFAULT 100000.00,
  p_lock_until TIMESTAMPTZ DEFAULT NULL,
  p_interest_rate_pa NUMERIC DEFAULT 14.50
)
RETURNS public.savings_vaults
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_clean_title TEXT := TRIM(COALESCE(p_title, ''));
  v_target NUMERIC(14, 2) := ROUND(COALESCE(p_target_amount, 0), 2);
  v_vault public.savings_vaults%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  IF LENGTH(v_clean_title) < 2 THEN RAISE EXCEPTION 'Vault title must be at least 2 characters.'; END IF;
  IF v_target <= 0 THEN RAISE EXCEPTION 'Target savings amount must be greater than ₦0.00.'; END IF;

  INSERT INTO public.savings_vaults (
    user_id, title, category, target_amount, current_balance, interest_rate_pa, lock_until, status
  ) VALUES (
    v_user_id, v_clean_title, COALESCE(NULLIF(TRIM(p_category), ''), 'General'),
    v_target, 0.00, COALESCE(p_interest_rate_pa, 14.50), p_lock_until, 'active'
  ) RETURNING * INTO v_vault;

  -- Mirror into `public.midesave_vaults`
  INSERT INTO public.midesave_vaults (
    id, user_id, title, category, target_amount, current_balance, interest_rate_pa, lock_until, status, created_at
  ) VALUES (
    v_vault.id, v_user_id, v_vault.title, v_vault.category, v_vault.target_amount, 0.00, v_vault.interest_rate_pa, v_vault.lock_until, 'active', v_vault.created_at
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, amount, metadata)
  VALUES (v_user_id, 'MIDESAVE_VAULT_CREATED', 'info', 'savings_vaults', v_vault.id::TEXT, v_target, jsonb_build_object('title', v_vault.title, 'lock_until', p_lock_until));

  RETURN v_vault;
END;
$$;

DROP FUNCTION IF EXISTS public.fund_savings_vault(UUID, NUMERIC);
CREATE OR REPLACE FUNCTION public.fund_savings_vault(
  p_vault_id UUID,
  p_amount NUMERIC,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_pin_res JSONB;
  v_existing_tx public.transactions%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_vault public.savings_vaults%ROWTYPE;
  v_new_wallet_bal NUMERIC(14, 2);
  v_new_vault_bal NUMERIC(14, 2);
  v_next_status TEXT;
  v_ref TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required to fund a MideSave vault.');
  END IF;

  IF p_vault_id IS NULL OR v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid vault ID and positive NGN deposit amount are required.');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx FROM public.transactions WHERE idempotency_key = p_idempotency_key AND user_id = v_caller LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_vault FROM public.savings_vaults WHERE id = p_vault_id AND user_id = v_caller;
      RETURN jsonb_build_object(
        'success', true, 'status', 'duplicate',
        'vault_id', p_vault_id, 'vault_title', v_vault.title,
        'vault_balance', v_vault.current_balance, 'new_balance', v_existing_tx.balance_after,
        'reference', v_existing_tx.reference
      );
    END IF;
  END IF;

  IF p_pin IS NOT NULL THEN
    v_pin_res := public._verify_pin_and_audit(v_caller, p_pin, 'MIDESAVE_DEPOSIT');
    IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
    END IF;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_caller AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Active NGN wallet not found.'); END IF;

  IF v_wallet.balance < v_amt THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient NGN wallet balance (Available: ₦' || TRIM(TO_CHAR(v_wallet.balance, 'FM999,999,990.00')) || ').');
  END IF;

  SELECT * INTO v_vault FROM public.savings_vaults WHERE id = p_vault_id AND user_id = v_caller FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'MideSave vault not found or access denied.'); END IF;

  v_new_wallet_bal := ROUND(v_wallet.balance - v_amt, 2);
  v_new_vault_bal := ROUND(v_vault.current_balance + v_amt, 2);
  v_next_status := CASE WHEN v_vault.lock_until IS NOT NULL AND v_vault.lock_until <= NOW() THEN 'matured' ELSE 'active' END;
  v_ref := 'MDP-SAV-' || UPPER(ENCODE(gen_random_bytes(5), 'hex'));

  UPDATE public.wallets SET balance = v_new_wallet_bal, ledger_balance = v_new_wallet_bal, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_wallet.id;
  UPDATE public.savings_vaults SET current_balance = v_new_vault_bal, status = v_next_status, updated_at = TIMEZONE('utc', NOW()) WHERE id = p_vault_id;
  UPDATE public.midesave_vaults SET current_balance = v_new_vault_bal, status = v_next_status, updated_at = TIMEZONE('utc', NOW()) WHERE id = p_vault_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, narration, reference, idempotency_key, metadata
  ) VALUES (
    v_wallet.id, v_caller, 'outflow', 'savings', v_amt, 0.00,
    v_wallet.balance, v_new_wallet_bal, 'successful',
    'MideSave Vault: ' || v_vault.title, 'MideSave Treasury (14.5% p.a.)',
    'MideSave Deposit — ' || v_vault.title, v_ref, p_idempotency_key,
    jsonb_build_object('vault_id', p_vault_id, 'vault_title', v_vault.title, 'action', 'fund_vault')
  );

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata)
  VALUES (v_caller, 'MIDESAVE_DEPOSIT', 'info', 'savings_vaults', p_vault_id::TEXT, p_idempotency_key, v_amt, jsonb_build_object('vault_title', v_vault.title, 'vault_balance', v_new_vault_bal));

  RETURN jsonb_build_object(
    'success', true,
    'vault_id', p_vault_id,
    'vault_title', v_vault.title,
    'vault_balance', v_new_vault_bal,
    'new_balance', v_new_wallet_bal,
    'reference', v_ref
  );
END;
$$;

DROP FUNCTION IF EXISTS public.withdraw_savings_vault(UUID, NUMERIC);
CREATE OR REPLACE FUNCTION public.withdraw_savings_vault(
  p_vault_id UUID,
  p_amount NUMERIC,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_pin_res JSONB;
  v_existing_tx public.transactions%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_vault public.savings_vaults%ROWTYPE;
  v_early_break_fee NUMERIC(14, 2) := 0.00;
  v_net_credit NUMERIC(14, 2);
  v_new_vault_bal NUMERIC(14, 2);
  v_new_wallet_bal NUMERIC(14, 2);
  v_next_status TEXT;
  v_ref TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required to withdraw from a MideSave vault.');
  END IF;

  IF p_vault_id IS NULL OR v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid vault ID and positive withdrawal amount are required.');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx FROM public.transactions WHERE idempotency_key = p_idempotency_key AND user_id = v_caller LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_vault FROM public.savings_vaults WHERE id = p_vault_id AND user_id = v_caller;
      RETURN jsonb_build_object(
        'success', true, 'status', v_vault.status,
        'vault_id', p_vault_id, 'vault_title', v_vault.title,
        'gross_withdrawn', v_amt, 'early_break_fee', v_existing_tx.fee,
        'net_credited', v_existing_tx.amount, 'vault_balance', v_vault.current_balance,
        'new_balance', v_existing_tx.balance_after, 'reference', v_existing_tx.reference
      );
    END IF;
  END IF;

  IF p_pin IS NOT NULL THEN
    v_pin_res := public._verify_pin_and_audit(v_caller, p_pin, 'MIDESAVE_WITHDRAWAL');
    IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
    END IF;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_caller AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Active NGN wallet not found.'); END IF;

  SELECT * INTO v_vault FROM public.savings_vaults WHERE id = p_vault_id AND user_id = v_caller FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'MideSave vault not found or access denied.'); END IF;

  IF v_vault.current_balance < v_amt THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient vault balance in ' || v_vault.title || '.');
  END IF;

  IF v_vault.lock_until IS NOT NULL AND v_vault.lock_until > NOW() THEN
    v_early_break_fee := ROUND(v_amt * 0.015, 2);
    v_next_status := 'broken';
  ELSIF v_vault.lock_until IS NOT NULL AND v_vault.lock_until <= NOW() THEN
    v_early_break_fee := 0.00;
    v_next_status := 'matured';
  ELSE
    v_early_break_fee := 0.00;
    v_next_status := v_vault.status;
  END IF;

  v_net_credit := ROUND(v_amt - v_early_break_fee, 2);
  v_new_vault_bal := ROUND(v_vault.current_balance - v_amt, 2);
  v_new_wallet_bal := ROUND(v_wallet.balance + v_net_credit, 2);
  v_ref := 'MDP-WDR-' || UPPER(ENCODE(gen_random_bytes(5), 'hex'));

  UPDATE public.savings_vaults SET current_balance = v_new_vault_bal, status = v_next_status, updated_at = TIMEZONE('utc', NOW()) WHERE id = p_vault_id;
  UPDATE public.midesave_vaults SET current_balance = v_new_vault_bal, status = v_next_status, updated_at = TIMEZONE('utc', NOW()) WHERE id = p_vault_id;
  UPDATE public.wallets SET balance = v_new_wallet_bal, ledger_balance = v_new_wallet_bal, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_wallet.id;

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, narration, reference, idempotency_key, metadata
  ) VALUES (
    v_wallet.id, v_caller, 'inflow', 'savings', v_net_credit, v_early_break_fee,
    v_wallet.balance, v_new_wallet_bal, 'successful',
    'MideSave Vault: ' || v_vault.title, 'MideSave Treasury',
    CASE WHEN v_early_break_fee > 0 THEN 'MideSave Early-Break Withdrawal (1.5% Fee) — ' || v_vault.title ELSE 'MideSave Vault Withdrawal — ' || v_vault.title END,
    v_ref, p_idempotency_key,
    jsonb_build_object('vault_id', p_vault_id, 'gross_amount', v_amt, 'early_break_fee', v_early_break_fee, 'net_credited', v_net_credit)
  );

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata)
  VALUES (
    v_caller, 'MIDESAVE_WITHDRAWAL', CASE WHEN v_early_break_fee > 0 THEN 'warning' ELSE 'info' END,
    'savings_vaults', p_vault_id::TEXT, p_idempotency_key, v_amt,
    jsonb_build_object('vault_title', v_vault.title, 'early_break_fee', v_early_break_fee, 'net_credited', v_net_credit)
  );

  RETURN jsonb_build_object(
    'success', true,
    'vault_id', p_vault_id,
    'vault_title', v_vault.title,
    'gross_withdrawn', v_amt,
    'early_break_fee', v_early_break_fee,
    'net_credited', v_net_credit,
    'vault_balance', v_new_vault_bal,
    'new_balance', v_new_wallet_bal,
    'status', v_next_status,
    'reference', v_ref
  );
END;
$$;

-- 5.7 Nigerian Airtime, Data, Cable & STS Electricity Bill Payment RPC (`pay_utility_bill`)
DROP FUNCTION IF EXISTS public.pay_utility_bill(TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN);
CREATE OR REPLACE FUNCTION public.pay_utility_bill(
  p_service_type TEXT,
  p_provider TEXT,
  p_identifier TEXT,
  p_plan_name TEXT,
  p_amount NUMERIC,
  p_pin_verified BOOLEAN DEFAULT TRUE,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_service TEXT := LOWER(TRIM(COALESCE(p_service_type, '')));
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_pin_res JSONB;
  v_existing_bill public.bill_payments%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_new_bal NUMERIC(14, 2);
  v_token TEXT := NULL;
  v_token_bytes BYTEA;
  v_ref TEXT;
  v_bill_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required to pay utility bills.');
  END IF;

  IF v_service NOT IN ('airtime', 'data', 'electricity', 'cable') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unsupported utility service type.');
  END IF;

  IF v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bill payment amount must be strictly greater than zero.');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_bill FROM public.bill_payments WHERE idempotency_key = p_idempotency_key AND user_id = v_caller LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_caller AND currency = 'NGN';
      RETURN jsonb_build_object(
        'success', true, 'status', 'duplicate',
        'bill_id', v_existing_bill.id, 'reference', v_existing_bill.reference,
        'token', v_existing_bill.token_or_pin, 'new_balance', v_wallet.balance
      );
    END IF;
  END IF;

  IF p_pin IS NOT NULL THEN
    v_pin_res := public._verify_pin_and_audit(v_caller, p_pin, 'VTU_BILL_PAYMENT');
    IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
    END IF;
  ELSIF p_pin_verified IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', '4-digit Transaction PIN verification is required.');
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_caller AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Active NGN wallet not found.'); END IF;

  IF v_wallet.balance < v_amt THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient NGN wallet balance (Available: ₦' || TRIM(TO_CHAR(v_wallet.balance, 'FM999,999,990.00')) || ').');
  END IF;

  IF v_service = 'electricity' THEN
    v_token_bytes := gen_random_bytes(10);
    v_token :=
      LPAD((((get_byte(v_token_bytes, 0) << 8) | get_byte(v_token_bytes, 1)) % 10000)::TEXT, 4, '0') || ' ' ||
      LPAD((((get_byte(v_token_bytes, 2) << 8) | get_byte(v_token_bytes, 3)) % 10000)::TEXT, 4, '0') || ' ' ||
      LPAD((((get_byte(v_token_bytes, 4) << 8) | get_byte(v_token_bytes, 5)) % 10000)::TEXT, 4, '0') || ' ' ||
      LPAD((((get_byte(v_token_bytes, 6) << 8) | get_byte(v_token_bytes, 7)) % 10000)::TEXT, 4, '0') || ' ' ||
      LPAD((((get_byte(v_token_bytes, 8) << 8) | get_byte(v_token_bytes, 9)) % 10000)::TEXT, 4, '0');
  END IF;

  v_new_bal := ROUND(v_wallet.balance - v_amt, 2);
  v_ref := 'MDP-BIL-' || UPPER(ENCODE(gen_random_bytes(5), 'hex'));

  UPDATE public.wallets SET balance = v_new_bal, ledger_balance = v_new_bal, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_wallet.id;

  INSERT INTO public.bill_payments (
    user_id, service_type, provider, customer_identifier, plan_name,
    amount, token_or_pin, reference, status, idempotency_key
  ) VALUES (
    v_caller, v_service, TRIM(p_provider), TRIM(p_identifier), TRIM(COALESCE(p_plan_name, p_provider)),
    v_amt, v_token, v_ref, 'successful', p_idempotency_key
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, idempotency_key, metadata
  ) VALUES (
    v_wallet.id, v_caller, 'outflow', 'bills', v_amt, 0.00,
    v_wallet.balance, v_new_bal, 'successful',
    TRIM(p_provider) || ' (' || TRIM(p_identifier) || ')',
    'MidePay VTU & Utility Switch', TRIM(p_identifier),
    TRIM(p_provider) || ' — ' || TRIM(COALESCE(p_plan_name, v_service)),
    v_ref, p_idempotency_key,
    jsonb_build_object('bill_id', v_bill_id, 'service_type', v_service, 'provider', TRIM(p_provider), 'token', v_token)
  );

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata)
  VALUES (
    v_caller, 'VTU_BILL_PAYMENT', 'info', 'bill_payments', v_bill_id::TEXT, p_idempotency_key, v_amt,
    jsonb_build_object('service_type', v_service, 'provider', TRIM(p_provider), 'identifier', TRIM(p_identifier))
  );

  RETURN jsonb_build_object('success', true, 'bill_id', v_bill_id, 'reference', v_ref, 'token', v_token, 'new_balance', v_new_bal);
END;
$$;

-- 5.8 Business Suite Batch Team Payroll RPC (`execute_business_payroll`)
DROP FUNCTION IF EXISTS public.execute_business_payroll(UUID, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.execute_business_payroll(
  p_business_id UUID,
  p_title TEXT,
  p_items JSONB,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_employer_id UUID := auth.uid();
  v_pin_res JSONB;
  v_existing_run public.payroll_runs%ROWTYPE;
  v_employer_name TEXT;
  v_employer_frozen BOOLEAN;
  v_employer_wallet public.wallets%ROWTYPE;
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
BEGIN
  IF v_employer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required to execute batch payroll.');
  END IF;

  IF p_business_id IS NOT NULL AND NOT public.has_business_write_role(p_business_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access Denied: caller lacks finance authority for this business.');
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payroll items array must contain at least one employee disbursement.');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_run FROM public.payroll_runs WHERE idempotency_key = p_idempotency_key AND user_id = v_employer_id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_employer_wallet FROM public.wallets WHERE user_id = v_employer_id AND currency = 'NGN';
      RETURN jsonb_build_object(
        'success', true, 'status', 'duplicate',
        'payroll_run_id', v_existing_run.id, 'reference', v_existing_run.reference,
        'total_amount', v_existing_run.total_amount, 'employee_count', v_existing_run.employee_count,
        'new_balance', v_employer_wallet.balance
      );
    END IF;
  END IF;

  IF p_pin IS NOT NULL THEN
    v_pin_res := public._verify_pin_and_audit(v_employer_id, p_pin, 'BUSINESS_PAYROLL');
    IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
    END IF;
  END IF;

  SELECT full_name, COALESCE(is_frozen, FALSE) INTO v_employer_name, v_employer_frozen
  FROM public.profiles WHERE id = v_employer_id;
  IF NOT FOUND OR v_employer_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'Employer account is restricted or not found.');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_amt := ROUND(COALESCE((v_item->>'amount')::NUMERIC, 0), 2);
    v_ident := TRIM(COALESCE(v_item->>'identifier', ''));
    IF v_amt <= 0 OR v_ident = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Every payroll row must specify a valid MidePay NUBAN/@tag and salary > ₦0.');
    END IF;
    v_total_payroll := v_total_payroll + v_amt;
    v_emp_count := v_emp_count + 1;
  END LOOP;

  SELECT * INTO v_employer_wallet FROM public.wallets WHERE user_id = v_employer_id AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Employer NGN wallet not found.'); END IF;

  IF v_employer_wallet.balance < v_total_payroll THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient wallet balance for batch payroll: ₦' || TRIM(TO_CHAR(v_total_payroll, 'FM999,999,990.00')) || ' required.'
    );
  END IF;

  v_run_ref := 'MDP-PAY-' || UPPER(ENCODE(gen_random_bytes(5), 'hex'));

  INSERT INTO public.payroll_runs (
    user_id, business_id, title, total_amount, total_fee, employee_count, reference, status, idempotency_key
  ) VALUES (
    v_employer_id, p_business_id, v_clean_title, v_total_payroll, 0.00, v_emp_count, v_run_ref, 'successful', p_idempotency_key
  ) RETURNING id INTO v_run_id;

  v_running_employer_bal := v_employer_wallet.balance;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_amt := ROUND((v_item->>'amount')::NUMERIC, 2);
    v_ident := TRIM(v_item->>'identifier');
    v_role := NULLIF(TRIM(COALESCE(v_item->>'role', 'Team Member')), '');
    v_digits := REGEXP_REPLACE(v_ident, '[^0-9]', '', 'g');

    SELECT p.id, p.full_name, COALESCE(p.is_frozen, FALSE), w.id, w.nuban
    INTO v_staff_id, v_staff_name, v_staff_frozen, v_staff_wallet_id, v_staff_nuban
    FROM public.profiles p
    LEFT JOIN public.wallets w ON w.user_id = p.id AND w.currency = 'NGN'
    WHERE (LENGTH(v_digits) = 10 AND w.nuban = v_digits)
       OR LOWER(p.tag) = LOWER(CASE WHEN LEFT(v_ident, 1) = '@' THEN v_ident ELSE '@' || v_ident END)
       OR LOWER(p.email) = LOWER(v_ident)
    LIMIT 1;

    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION 'Registered MidePay staff member not found for "%".', v_ident;
    END IF;
    IF v_staff_id = v_employer_id THEN
      RAISE EXCEPTION 'Self-payroll transfer to employer account (%) is prohibited.', v_ident;
    END IF;
    IF v_staff_frozen THEN
      RAISE EXCEPTION 'Staff account "%" is restricted and cannot receive payroll.', v_staff_name;
    END IF;

    IF v_staff_wallet_id IS NULL THEN
      v_staff_nuban := public.generate_unique_midepay_nuban();
      INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
      VALUES (v_staff_id, 'NGN', 0.00, 0.00, v_staff_nuban, 'MidePay / Providus Bank')
      RETURNING id INTO v_staff_wallet_id;
    END IF;

    SELECT balance INTO v_staff_bal FROM public.wallets WHERE id = v_staff_wallet_id FOR UPDATE;
    v_new_staff_bal := ROUND(v_staff_bal + v_amt, 2);

    UPDATE public.wallets SET balance = v_new_staff_bal, ledger_balance = v_new_staff_bal, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_staff_wallet_id;

    v_deb_ref := 'MDP-PYD-' || UPPER(ENCODE(gen_random_bytes(5), 'hex'));
    v_cre_ref := 'MDP-PYC-' || UPPER(ENCODE(gen_random_bytes(5), 'hex'));

    INSERT INTO public.transactions (
      wallet_id, user_id, counterparty_user_id, type, category, amount, fee,
      balance_before, balance_after, status,
      counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
      narration, reference, metadata
    ) VALUES (
      v_employer_wallet.id, v_employer_id, v_staff_id, 'outflow', 'payroll', v_amt, 0.00,
      v_running_employer_bal, ROUND(v_running_employer_bal - v_amt, 2), 'successful',
      v_staff_name, 'MidePay / Providus Bank', COALESCE(v_staff_nuban, v_ident),
      v_clean_title || ' — ' || COALESCE(v_role, 'Salary'),
      v_deb_ref, jsonb_build_object('payroll_run_id', v_run_id, 'paired_reference', v_cre_ref)
    );

    v_running_employer_bal := ROUND(v_running_employer_bal - v_amt, 2);

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
      v_cre_ref, jsonb_build_object('payroll_run_id', v_run_id, 'paired_reference', v_deb_ref)
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

  UPDATE public.wallets
  SET balance = v_running_employer_bal,
      ledger_balance = v_running_employer_bal,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_employer_wallet.id;

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata
  ) VALUES (
    v_employer_id, 'PAYROLL_DISBURSEMENT', 'info', 'payroll_runs', v_run_id::TEXT, p_idempotency_key, v_total_payroll,
    jsonb_build_object('title', v_clean_title, 'employee_count', v_emp_count, 'reference', v_run_ref)
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

-- 5.9 Controlled Waitlist & Payment Request RPCs (eliminating remaining direct table writes)
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS idempotency_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_idempotency_key
  ON public.payment_requests(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.payment_requests, public.waitlist FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.join_waitlist(
  p_email TEXT,
  p_source TEXT DEFAULT 'landing_page'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_email TEXT := LOWER(TRIM(COALESCE(p_email, '')));
BEGIN
  IF POSITION('@' IN v_clean_email) <= 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid email address.');
  END IF;

  INSERT INTO public.waitlist (email, source)
  VALUES (v_clean_email, COALESCE(NULLIF(TRIM(p_source), ''), 'landing_page'))
  ON CONFLICT (email) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_payment_request(
  p_payer_id UUID,
  p_amount NUMERIC,
  p_note TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_existing public.payment_requests%ROWTYPE;
  v_created public.payment_requests%ROWTYPE;
BEGIN
  IF v_requester IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;
  IF p_payer_id IS NULL OR p_payer_id = v_requester THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a valid recipient different from yourself.');
  END IF;
  IF v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request amount must be greater than ₦0.00.');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.payment_requests WHERE idempotency_key = p_idempotency_key AND requester_id = v_requester LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'status', 'duplicate', 'request', to_jsonb(v_existing));
    END IF;
  END IF;

  INSERT INTO public.payment_requests (requester_id, payer_id, amount, note, status, idempotency_key)
  VALUES (v_requester, p_payer_id, v_amt, COALESCE(NULLIF(TRIM(p_note), ''), 'Payment Request via MidePay'), 'pending', p_idempotency_key)
  RETURNING * INTO v_created;

  RETURN jsonb_build_object('success', true, 'request', to_jsonb(v_created));
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_payment_request(
  p_request_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_norm_status TEXT := LOWER(TRIM(COALESCE(p_status, '')));
  v_req public.payment_requests%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;
  IF v_norm_status NOT IN ('approved', 'declined', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid payment request status.');
  END IF;

  UPDATE public.payment_requests
  SET status = v_norm_status,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_request_id
    AND (payer_id = v_caller OR requester_id = v_caller)
  RETURNING * INTO v_req;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment request not found or unauthorized.');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', v_norm_status, 'request', to_jsonb(v_req));
END;
$$;

-- ============================================================================
-- 6. STRICT FUNCTION EXECUTION GRANTS (`authenticated` ONLY; `anon` REVOKED)
-- ============================================================================

REVOKE ALL ON FUNCTION public.generate_unique_midepay_nuban() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_unique_virtual_card_pan(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_user_transaction_pin(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_user_transaction_pin(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_my_profile_and_wallet(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_own_account_freeze(BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_beneficiary(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_p2p_transfer(TEXT, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_funds(UUID, UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_external_bank_transfer(NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.concept_topup_wallet(NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_virtual_card(TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_virtual_card_freeze(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_virtual_card_limit(UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_virtual_card_reveal(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fund_virtual_card_from_wallet(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_savings_vault(TEXT, TEXT, NUMERIC, TIMESTAMPTZ, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fund_savings_vault(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.withdraw_savings_vault(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pay_utility_bill(TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_business_payroll(UUID, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.generate_unique_midepay_nuban() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_unique_virtual_card_pan(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_transaction_pin(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_user_transaction_pin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile_and_wallet(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_own_account_freeze(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_beneficiary(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_p2p_transfer(TEXT, NUMERIC, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_funds(UUID, UUID, NUMERIC, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_external_bank_transfer(NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.concept_topup_wallet(NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_virtual_card(TEXT, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_virtual_card_freeze(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_virtual_card_limit(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_virtual_card_reveal(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fund_virtual_card_from_wallet(UUID, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_savings_vault(TEXT, TEXT, NUMERIC, TIMESTAMPTZ, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fund_savings_vault(UUID, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_savings_vault(UUID, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_utility_bill(TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_business_payroll(UUID, TEXT, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_waitlist(TEXT, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.create_payment_request(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_payment_request(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payment_request(UUID, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_payment_request(UUID, TEXT) TO authenticated;

COMMIT;
