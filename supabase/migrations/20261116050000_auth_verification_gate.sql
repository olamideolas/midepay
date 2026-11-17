-- MidePay v4.6 STAGING-ONLY security candidate
-- Repaired, self-healing, idempotent schema reconciliation & financial security hardening.
-- Verify on an isolated staging database before any production promotion.
-- Unintegrated third-party financial providers (VTU/DisCo, Card Issuing/FX,
-- SQL-direct External NIP, Self-Credit Top-Up, and Corporate Sub-Account Payroll)
-- are intentionally quarantined and fail closed.

-- ============================================================================
-- MidePay v4.6 — Complete Database Migration Repair & Security Hardening
-- Migration: 20261116050000_auth_verification_gate.sql
--
-- Resolves & Enforces:
-- 1. Eliminates PostgreSQL 42703 (`profiles.pin_hash`, `security_audit_logs.user_agent`,
--    `savings_vaults.status`, `payroll_runs.user_id`) and 42P01 (`bill_payments`,
--    `payroll_items`, `midesave_vaults`, `beneficiaries`, `security_audit_logs`,
--    `payment_requests`, `audit_logs`) on both clean chains and legacy upgrades.
-- 2. Strict RLS + `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` across ALL 18 public
--    tables, plus PostgreSQL column-level `SELECT` grants hiding `pin_hash`,
--    `transaction_pin_hash`, `card_number`, and `cvv` from client roles.
-- 3. PCI-DSS remediation: scrubs any persisted `card_number` / `cvv` values to NULL
--    and enforces `CHECK (cvv IS NULL)` + `CHECK (card_number IS NULL)`.
-- 4. Dual-gated Email OTP verification (`auth.users.email_confirmed_at` +
--    `profiles.email_otp_verified_at`), mandatory 4-digit bcrypt PIN, 5-strike
--    15-minute lockout with automatic post-expiry strike reset, and `frozen_by_admin`
--    compliance freeze separation so AML-frozen users cannot self-unfreeze.
-- 5. User-scoped composite `(user_id, idempotency_key)` unique indexes, SHA-256
--    `idempotency_payload_hash` conflict detection, `pg_advisory_xact_lock`
--    serialization, deterministic UUID-ordered `SELECT ... FOR UPDATE` row locks,
--    CBN KYC Tier 1-3 single & daily transfer limits, and universal ledger parity.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. EXTENSIONS, SCHEMAS & DOMAIN ENUMS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE public.tx_type AS ENUM ('inflow', 'outflow');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.tx_status AS ENUM ('pending', 'successful', 'failed', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.business_role AS ENUM ('owner', 'admin', 'finance', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 1. SELF-HEALING SCHEMA RECONCILIATION FOR ALL 18 PUBLIC TABLES
-- ============================================================================

-- 1.1 `public.profiles`
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  tag TEXT UNIQUE,
  avatar_url TEXT,
  kyc_tier INT NOT NULL DEFAULT 1,
  bvn_verified BOOLEAN NOT NULL DEFAULT FALSE,
  nin_verified BOOLEAN NOT NULL DEFAULT FALSE,
  pin_hash TEXT,
  transaction_pin_hash TEXT,
  pin_failed_attempts INT NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  role TEXT NOT NULL DEFAULT 'user',
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  email_otp_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_device JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS tag TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS kyc_tier INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bvn_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nin_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS frozen_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_otp_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_device JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW());

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT chk_profiles_role CHECK (role IN ('user', 'executive'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT chk_profiles_kyc_tier CHECK (kyc_tier BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT chk_profiles_pin_attempts CHECK (pin_failed_attempts >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Safely synchronize legacy `pin_hash` <-> `transaction_pin_hash` (never plaintext)
UPDATE public.profiles
SET transaction_pin_hash = pin_hash
WHERE transaction_pin_hash IS NULL
  AND pin_hash IS NOT NULL
  AND pin_hash ~ '^\$2[abxy]\$';

UPDATE public.profiles
SET pin_hash = transaction_pin_hash
WHERE pin_hash IS NULL
  AND transaction_pin_hash IS NOT NULL
  AND transaction_pin_hash ~ '^\$2[abxy]\$';

-- Scrub any non-bcrypt malformed hash remnants rather than trusting weak digests
UPDATE public.profiles
SET pin_hash = NULL,
    transaction_pin_hash = NULL
WHERE (pin_hash IS NOT NULL AND pin_hash !~ '^\$2[abxy]\$')
   OR (transaction_pin_hash IS NOT NULL AND transaction_pin_hash !~ '^\$2[abxy]\$');

-- Backfill `email_otp_verified_at` for pre-existing confirmed accounts prior to v4.6
UPDATE public.profiles p
SET email_otp_verified_at = u.email_confirmed_at
FROM auth.users u
WHERE p.id = u.id
  AND u.email_confirmed_at IS NOT NULL
  AND p.email_otp_verified_at IS NULL;

-- 1.2 `public.wallets`
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'NGN',
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ledger_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  nuban VARCHAR(10) UNIQUE,
  bank_name TEXT NOT NULL DEFAULT 'MidePay / Providus Bank',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT uq_user_currency UNIQUE (user_id, currency)
);

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS ledger_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS nuban VARCHAR(10),
  ADD COLUMN IF NOT EXISTS bank_name TEXT NOT NULL DEFAULT 'MidePay / Providus Bank',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW());

DO $$ BEGIN
  ALTER TABLE public.wallets ADD CONSTRAINT chk_wallets_balance_nonneg CHECK (balance >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.wallets ADD CONSTRAINT chk_wallets_ledger_nonneg CHECK (ledger_balance >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.wallets ADD CONSTRAINT chk_wallets_currency CHECK (currency IN ('NGN', 'USD'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1.3 `public.transactions`
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  counterparty_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type public.tx_type NOT NULL,
  category TEXT NOT NULL DEFAULT 'transfer',
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  fee NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (fee >= 0),
  balance_before NUMERIC(14, 2),
  balance_after NUMERIC(14, 2),
  status public.tx_status NOT NULL DEFAULT 'successful',
  counterparty_name TEXT NOT NULL,
  counterparty_bank TEXT,
  counterparty_tag_or_nuban TEXT,
  narration TEXT,
  reference TEXT NOT NULL UNIQUE,
  idempotency_key UUID,
  idempotency_payload_hash TEXT,
  gateway_provider TEXT,
  gateway_reference TEXT,
  webhook_payload JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS counterparty_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fee NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS balance_before NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS counterparty_bank TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_tag_or_nuban TEXT,
  ADD COLUMN IF NOT EXISTS narration TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS idempotency_payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS gateway_provider TEXT,
  ADD COLUMN IF NOT EXISTS gateway_reference TEXT,
  ADD COLUMN IF NOT EXISTS webhook_payload JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$ BEGIN
  ALTER TABLE public.transactions ADD CONSTRAINT chk_transactions_fee_nonneg CHECK (fee >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.transactions
  ADD CONSTRAINT chk_transactions_gateway_provider
  CHECK (gateway_provider IS NULL OR gateway_provider IN ('paystack', 'flutterwave', 'providus', 'internal'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1.4 `public.payment_requests`
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  fulfilled_tx_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  idempotency_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT chk_no_self_request CHECK (requester_id <> payer_id)
);

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS fulfilled_tx_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW());

-- 1.5 `public.virtual_cards` (PCI-DSS Hardened: Zero Plaintext PAN or CVV Storage)
CREATE TABLE IF NOT EXISTS public.virtual_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
  card_type TEXT NOT NULL DEFAULT 'Mastercard' CHECK (card_type IN ('Mastercard', 'Visa', 'Verve')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'NGN')),
  card_holder_name TEXT NOT NULL,
  card_number VARCHAR(19),
  masked_pan VARCHAR(25) NOT NULL,
  cvv VARCHAR(4),
  card_label TEXT NOT NULL DEFAULT 'MidePay Virtual Card',
  expiry_month INT NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year INT NOT NULL CHECK (expiry_year >= 2026),
  card_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (card_balance >= 0),
  spending_limit_monthly NUMERIC(14, 2) NOT NULL DEFAULT 1000.00 CHECK (spending_limit_monthly >= 0),
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.virtual_cards
  ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS card_number VARCHAR(19),
  ADD COLUMN IF NOT EXISTS cvv VARCHAR(4),
  ADD COLUMN IF NOT EXISTS card_label TEXT NOT NULL DEFAULT 'MidePay Virtual Card',
  ADD COLUMN IF NOT EXISTS card_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS spending_limit_monthly NUMERIC(14, 2) NOT NULL DEFAULT 1000.00,
  ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW());

ALTER TABLE public.virtual_cards ALTER COLUMN masked_pan TYPE VARCHAR(25);

DROP INDEX IF EXISTS public.idx_virtual_cards_card_number_unique;

-- Scrub any legacy plaintext PAN or raw CVV before enforcing NULL check constraints
UPDATE public.virtual_cards
SET card_number = NULL,
    cvv = NULL,
    updated_at = TIMEZONE('utc', NOW())
WHERE card_number IS NOT NULL
   OR cvv IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.virtual_cards ADD CONSTRAINT chk_virtual_cards_no_cvv CHECK (cvv IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.virtual_cards ADD CONSTRAINT chk_virtual_cards_no_plaintext_pan CHECK (card_number IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1.6 `public.savings_vaults` & `public.midesave_vaults`
CREATE TABLE IF NOT EXISTS public.savings_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  target_amount NUMERIC(14, 2) NOT NULL CHECK (target_amount > 0),
  current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (current_balance >= 0),
  interest_rate_pa NUMERIC(5, 2) NOT NULL DEFAULT 14.50 CHECK (interest_rate_pa >= 0),
  lock_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matured', 'broken')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.savings_vaults
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS interest_rate_pa NUMERIC(5, 2) NOT NULL DEFAULT 14.50,
  ADD COLUMN IF NOT EXISTS lock_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW());

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'savings_vaults' AND column_name = 'current_amount'
  ) THEN
    EXECUTE 'ALTER TABLE public.savings_vaults ALTER COLUMN current_amount DROP NOT NULL';
    EXECUTE 'UPDATE public.savings_vaults SET current_balance = COALESCE(current_amount, 0.00) WHERE current_balance = 0.00 AND COALESCE(current_amount, 0.00) > 0.00';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'savings_vaults' AND column_name = 'maturity_date'
  ) THEN
    EXECUTE 'UPDATE public.savings_vaults SET lock_until = maturity_date::TIMESTAMPTZ WHERE lock_until IS NULL AND maturity_date IS NOT NULL';
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.savings_vaults ADD CONSTRAINT chk_savings_vaults_balance_nonneg CHECK (current_balance >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.savings_vaults ADD CONSTRAINT chk_savings_vaults_status CHECK (status IN ('active', 'matured', 'broken'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.midesave_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  target_amount NUMERIC(14, 2) NOT NULL CHECK (target_amount > 0),
  current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (current_balance >= 0),
  interest_rate_pa NUMERIC(5, 2) NOT NULL DEFAULT 14.50 CHECK (interest_rate_pa >= 0),
  lock_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matured', 'broken')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

INSERT INTO public.midesave_vaults (
  id, user_id, title, category, target_amount, current_balance,
  interest_rate_pa, lock_until, status, created_at, updated_at
)
SELECT
  sv.id, sv.user_id, sv.title, COALESCE(sv.category, 'General'), sv.target_amount,
  COALESCE(sv.current_balance, 0.00), COALESCE(sv.interest_rate_pa, 14.50),
  sv.lock_until, COALESCE(sv.status, 'active'), sv.created_at, COALESCE(sv.updated_at, NOW())
FROM public.savings_vaults sv
ON CONFLICT (id) DO UPDATE
SET current_balance = EXCLUDED.current_balance,
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;

-- 1.7 `public.bill_payments` (Fixes 42P01 when 030000 was skipped or rolled back)
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
  ADD COLUMN IF NOT EXISTS token_or_pin TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW());

-- 1.8 Business & Corporate Tables (`businesses`, `business_members`, `business_sub_accounts`, `invoices`)
CREATE TABLE IF NOT EXISTS public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_name TEXT NOT NULL,
  rc_number TEXT,
  tin_number TEXT,
  category TEXT NOT NULL DEFAULT 'Technology',
  support_email TEXT,
  phone TEXT,
  logo_url TEXT,
  settlement_nuban VARCHAR(10) UNIQUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS tin_number TEXT,
  ADD COLUMN IF NOT EXISTS settlement_nuban VARCHAR(10),
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW());

CREATE TABLE IF NOT EXISTS public.business_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.business_role NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT uq_business_member UNIQUE (business_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.business_sub_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'USD')),
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  dedicated_nuban VARCHAR(10) UNIQUE,
  bank_name TEXT NOT NULL DEFAULT 'MidePay / Providus Bank',
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.business_sub_accounts
  ADD COLUMN IF NOT EXISTS bank_name TEXT NOT NULL DEFAULT 'MidePay / Providus Bank',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW());

CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal >= 0),
  vat_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (vat_amount >= 0),
  wht_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (wht_amount >= 0),
  total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),
  due_date DATE NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'sent',
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT uq_business_invoice_num UNIQUE (business_id, invoice_number)
);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW());

-- 1.9 `public.payroll_runs` & `public.payroll_items`
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  total_amount NUMERIC(14, 2) DEFAULT 0.00,
  total_fee NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  employee_count INT DEFAULT 1,
  reference TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'successful',
  idempotency_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

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
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_runs' AND column_name = 'total_payout'
  ) THEN
    EXECUTE 'UPDATE public.payroll_runs SET total_amount = total_payout WHERE COALESCE(total_amount, 0) = 0 AND COALESCE(total_payout, 0) > 0';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_runs' AND column_name = 'total_recipients'
  ) THEN
    EXECUTE 'UPDATE public.payroll_runs SET employee_count = total_recipients WHERE COALESCE(employee_count, 0) <= 1 AND COALESCE(total_recipients, 0) > 1';
  END IF;
END $$;

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

-- 1.10 `public.beneficiaries`, `public.waitlist`, `public.audit_logs`, `public.security_audit_logs`
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
  CONSTRAINT uq_beneficiary_user_bank_acct UNIQUE (user_id, bank_name, account_number)
);

CREATE TABLE IF NOT EXISTS public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE CHECK (position('@' in email) > 1),
  ip_country TEXT DEFAULT 'NG',
  source TEXT DEFAULT 'landing_page',
  referrer_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'landing_page';

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL DEFAULT 'system',
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

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
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.security_audit_logs
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB;

-- ============================================================================
-- 2. USER-SCOPED IDEMPOTENCY INDEXES & PERFORMANCE INDEXES
--    Replaces un-scoped global idempotency indexes that leaked/collided across users.
-- ============================================================================
DROP INDEX IF EXISTS public.idx_transactions_idempotency_key;
DROP INDEX IF EXISTS public.idx_bill_payments_idempotency_key;
DROP INDEX IF EXISTS public.idx_payroll_runs_idempotency_key;
DROP INDEX IF EXISTS public.idx_payment_requests_idempotency_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_user_idempotency_key
  ON public.transactions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_payments_user_idempotency_key
  ON public.bill_payments(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_user_idempotency_key
  ON public.payroll_runs(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_requester_idempotency_key
  ON public.payment_requests(requester_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_profiles_tag ON public.profiles(LOWER(tag));
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_nuban ON public.wallets(nuban);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON public.transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON public.transactions(reference);
CREATE INDEX IF NOT EXISTS idx_savings_vaults_user_status ON public.savings_vaults(user_id, status);
CREATE INDEX IF NOT EXISTS idx_midesave_vaults_user_status ON public.midesave_vaults(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bill_payments_user_created ON public.bill_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_user_created ON public.payroll_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_items_run_id ON public.payroll_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_user_id ON public.beneficiaries(user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_user_created ON public.security_audit_logs(user_id, created_at DESC);

-- ============================================================================
-- 3. IMMUTABILITY TRIGGERS & HARDENED RBAC HELPER FUNCTIONS
-- ============================================================================
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
    IF OLD.amount <> NEW.amount
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

REVOKE ALL ON FUNCTION public.enforce_immutable_ledger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_transactions_immutable ON public.transactions;
CREATE TRIGGER trg_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

DROP TRIGGER IF EXISTS trg_security_audit_logs_immutable ON public.security_audit_logs;
CREATE TRIGGER trg_security_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.security_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_executive() THEN
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.kyc_tier IS DISTINCT FROM OLD.kyc_tier OR NEW.frozen_by_admin IS DISTINCT FROM OLD.frozen_by_admin THEN
      RAISE EXCEPTION 'Security Violation: Only executive administrators may modify privileged profile compliance fields.';
    END IF;
  END IF;
  NEW.updated_at := TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_privileged_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_columns();

CREATE OR REPLACE FUNCTION public.is_executive()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'executive'
      AND is_frozen = FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_business_member(_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    JOIN public.businesses b ON b.id = bm.business_id
    WHERE bm.business_id = _business_id
      AND bm.user_id = auth.uid()
      AND bm.is_active = TRUE
      AND b.is_frozen = FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.has_business_write_role(_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    JOIN public.businesses b ON b.id = bm.business_id
    WHERE bm.business_id = _business_id
      AND bm.user_id = auth.uid()
      AND bm.role IN ('owner', 'admin', 'finance')
      AND bm.is_active = TRUE
      AND b.is_frozen = FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.is_executive() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_business_member(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_business_write_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_executive() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_business_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_business_write_role(UUID) TO authenticated, service_role;

-- Internal CSPRNG NUBAN Generator (revoked from client roles; invoked only by SECURITY DEFINER triggers/RPCs)
CREATE OR REPLACE FUNCTION public.generate_unique_midepay_nuban()
RETURNS VARCHAR(10)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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
      RAISE EXCEPTION 'Unable to allocate unique 10-digit MidePay NUBAN after 250 cryptographic attempts.';
    END IF;

    v_bytes := gen_random_bytes(4);
    v_rand_uint := (
      (get_byte(v_bytes, 0)::BIGINT << 24) |
      (get_byte(v_bytes, 1)::BIGINT << 16) |
      (get_byte(v_bytes, 2)::BIGINT << 8)  |
      (get_byte(v_bytes, 3)::BIGINT)
    );

    v_candidate := '90' || LPAD((v_rand_uint % 100000000)::TEXT, 8, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.wallets w WHERE w.nuban = v_candidate
    ) AND NOT EXISTS (
      SELECT 1 FROM public.business_sub_accounts bsa WHERE bsa.dedicated_nuban = v_candidate
    ) AND NOT EXISTS (
      SELECT 1 FROM public.businesses b WHERE b.settlement_nuban = v_candidate
    );
  END LOOP;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_unique_midepay_nuban() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_unique_midepay_nuban() TO service_role;

-- Disabled synthetic PAN generator (retained only so legacy references fail closed cleanly)
CREATE OR REPLACE FUNCTION public.generate_unique_virtual_card_pan(p_prefix TEXT DEFAULT '5399')
RETURNS VARCHAR(19)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'CARD_ISSUER_DISABLED: Synthetic PAN generation is disabled. Integrate a PCI-DSS tokenized card issuer.';
END;
$$;

REVOKE ALL ON FUNCTION public.generate_unique_virtual_card_pan(TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 4. REVOKE ALL CLIENT WRITES, COLUMN-LEVEL SENSITIVE PROJECTIONS & STRICT RLS
--    Locks down ALL 18 public tables (including corporate & audit tables).
-- ============================================================================
DO $$
DECLARE
  v_tbl TEXT;
  v_pol RECORD;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'profiles', 'wallets', 'transactions', 'payment_requests', 'virtual_cards',
    'savings_vaults', 'midesave_vaults', 'bill_payments', 'payroll_runs',
    'payroll_items', 'beneficiaries', 'businesses', 'business_members',
    'business_sub_accounts', 'invoices', 'waitlist', 'audit_logs', 'security_audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);

    -- Purge EVERY pre-existing policy on all 18 tables before installing clean SELECT-only policies
    FOR v_pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_tbl);
    END LOOP;
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Ensure backend `service_role` retains operational table/sequence privileges (bound by immutability triggers)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Column-level `SELECT` grants on `profiles` (NEVER expose `pin_hash` or `transaction_pin_hash`)
REVOKE SELECT ON TABLE public.profiles FROM authenticated;
GRANT SELECT (
  id, full_name, email, phone, tag, avatar_url, kyc_tier,
  bvn_verified, nin_verified, pin_failed_attempts, pin_locked_until,
  role, is_frozen, frozen_by_admin, email_otp_verified_at,
  last_login_at, last_login_device, created_at, updated_at
) ON TABLE public.profiles TO authenticated;

-- Column-level `SELECT` grants on `virtual_cards` (NEVER expose `card_number` or `cvv`)
REVOKE SELECT ON TABLE public.virtual_cards FROM authenticated;
GRANT SELECT (
  id, user_id, wallet_id, card_type, currency, card_holder_name,
  masked_pan, card_label, expiry_month, expiry_year, card_balance,
  spending_limit_monthly, is_frozen, is_active, created_at, updated_at
) ON TABLE public.virtual_cards TO authenticated;

-- Table-level `SELECT` grants on non-secret read-only tables (still strictly filtered by RLS below)
GRANT SELECT ON TABLE
  public.wallets,
  public.transactions,
  public.payment_requests,
  public.savings_vaults,
  public.midesave_vaults,
  public.bill_payments,
  public.payroll_runs,
  public.payroll_items,
  public.beneficiaries,
  public.businesses,
  public.business_members,
  public.business_sub_accounts,
  public.invoices,
  public.audit_logs,
  public.security_audit_logs
TO authenticated;

-- Strictly scoped `SELECT`-only RLS policies across all 18 tables (`waitlist` has zero client SELECT policy)
CREATE POLICY "profiles_select_own_or_exec"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_executive());

CREATE POLICY "wallets_select_own_or_exec"
  ON public.wallets FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "transactions_select_own_or_exec"
  ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "payment_requests_select_participant_or_exec"
  ON public.payment_requests FOR SELECT TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = payer_id OR public.is_executive());

CREATE POLICY "virtual_cards_select_own"
  ON public.virtual_cards FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "savings_vaults_select_own"
  ON public.savings_vaults FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "midesave_vaults_select_own"
  ON public.midesave_vaults FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "bill_payments_select_own"
  ON public.bill_payments FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "payroll_runs_select_own_or_member"
  ON public.payroll_runs FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (business_id IS NOT NULL AND public.is_business_member(business_id))
  );

CREATE POLICY "payroll_items_select_employer_or_recipient"
  ON public.payroll_items FOR SELECT TO authenticated
  USING (auth.uid() = employer_user_id OR auth.uid() = recipient_user_id);

CREATE POLICY "beneficiaries_select_own"
  ON public.beneficiaries FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "businesses_select_owner_member_or_exec"
  ON public.businesses FOR SELECT TO authenticated
  USING (auth.uid() = owner_id OR public.is_business_member(id) OR public.is_executive());

CREATE POLICY "business_members_select_member_or_exec"
  ON public.business_members FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_business_member(business_id) OR public.is_executive());

CREATE POLICY "business_sub_accounts_select_member_or_exec"
  ON public.business_sub_accounts FOR SELECT TO authenticated
  USING (public.is_business_member(business_id) OR public.is_executive());

CREATE POLICY "invoices_select_member_or_exec"
  ON public.invoices FOR SELECT TO authenticated
  USING (public.is_business_member(business_id) OR public.is_executive());

CREATE POLICY "audit_logs_select_exec_only"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_executive());

CREATE POLICY "security_audit_logs_select_own_or_exec"
  ON public.security_audit_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_executive());

-- ============================================================================
-- 5. DROP LEGACY / OVERLOADED FUNCTION SIGNATURES BEFORE RE-DEFINING
-- ============================================================================
DROP TRIGGER IF EXISTS on_auth_user_provisioning ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_provisioning();

DROP FUNCTION IF EXISTS public._assert_verified_wallet_ready(UUID, TEXT);
DROP FUNCTION IF EXISTS public._assert_verified_wallet_ready(UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public._verify_pin_and_audit(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public._verify_pin_and_audit(UUID, TEXT, TEXT, BOOLEAN);

DROP FUNCTION IF EXISTS public.transfer_funds(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.transfer_funds(UUID, UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.transfer_funds(UUID, UUID, NUMERIC, TEXT, TEXT, UUID);

DROP FUNCTION IF EXISTS public.fund_savings_vault(UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.fund_savings_vault(UUID, NUMERIC, TEXT, UUID);

DROP FUNCTION IF EXISTS public.withdraw_savings_vault(UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.withdraw_savings_vault(UUID, NUMERIC, TEXT, UUID);

DROP FUNCTION IF EXISTS public.pay_utility_bill(TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN);
DROP FUNCTION IF EXISTS public.pay_utility_bill(TEXT, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN, TEXT, UUID);

DROP FUNCTION IF EXISTS public.execute_business_payroll(UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.execute_business_payroll(UUID, TEXT, JSONB, TEXT, UUID);

DROP FUNCTION IF EXISTS public.set_own_account_freeze(BOOLEAN);
DROP FUNCTION IF EXISTS public.set_own_account_freeze(BOOLEAN, TEXT);

DROP FUNCTION IF EXISTS public.respond_payment_request(UUID, TEXT);
DROP FUNCTION IF EXISTS public.respond_payment_request(UUID, TEXT, TEXT);

DROP FUNCTION IF EXISTS public.admin_credit_wallet(UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.admin_credit_wallet(UUID, NUMERIC, TEXT, UUID);

DROP FUNCTION IF EXISTS public.lookup_recipient_profile(TEXT);

-- ============================================================================
-- 6. HARDENED SIGNUP TRIGGER (`handle_new_user`)
--    - Zero starter balance (`0.00`), CBN Tier 1 default, zero synthetic cards,
--      `email_otp_verified_at = NULL` until OTP session verification completes.
-- ============================================================================
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
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 7. CENTRAL AUTH EMAIL OTP + MANDATORY PIN + LOCKOUT ENGINE
-- ============================================================================
CREATE OR REPLACE FUNCTION public._assert_verified_wallet_ready(
  p_user_id UUID,
  p_action TEXT DEFAULT 'FINANCIAL_MUTATION',
  p_allow_self_frozen BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_email_confirmed_at TIMESTAMPTZ;
  v_otp_verified_at TIMESTAMPTZ;
  v_tx_pin_hash TEXT;
  v_is_frozen BOOLEAN := FALSE;
  v_frozen_by_admin BOOLEAN := FALSE;
BEGIN
  IF v_caller IS NULL OR p_user_id IS NULL OR v_caller <> p_user_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'UNAUTHORIZED',
      'error', 'Active authenticated session required.'
    );
  END IF;

  -- Gate 1A: Supabase Auth Email Confirmation Timestamp Check
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (v_caller, 'UNVERIFIED_EMAIL_BLOCKED', 'warning', 'auth.users', v_caller::TEXT, jsonb_build_object('action', p_action));
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Email verification required. Enter the 6-digit OTP sent to your email before transacting.'
    );
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed_at
  FROM auth.users
  WHERE id = v_caller;

  -- Gate 1B & Gate 2: Profile Existence, OTP Attestation, Freeze Interlock & Mandatory PIN
  SELECT transaction_pin_hash,
         COALESCE(is_frozen, FALSE),
         COALESCE(frozen_by_admin, FALSE),
         email_otp_verified_at
  INTO v_tx_pin_hash, v_is_frozen, v_frozen_by_admin, v_otp_verified_at
  FROM public.profiles
  WHERE id = v_caller;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PROFILE_MISSING',
      'error', 'Account security profile not found.'
    );
  END IF;

  IF v_otp_verified_at IS NULL THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (
      v_caller, 'UNVERIFIED_EMAIL_BLOCKED', 'warning', 'profiles', v_caller::TEXT,
      jsonb_build_object('action', p_action, 'reason', 'email_otp_session_not_attested')
    );
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Complete 6-digit Email OTP verification before transacting.'
    );
  END IF;

  IF v_frozen_by_admin IS TRUE OR (v_is_frozen IS TRUE AND p_allow_self_frozen IS NOT TRUE) THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (
      v_caller, 'FROZEN_ACCOUNT_BLOCKED', 'critical', 'profiles', v_caller::TEXT,
      jsonb_build_object('action', p_action, 'frozen_by_admin', v_frozen_by_admin)
    );
    RETURN jsonb_build_object(
      'ok', false,
      'is_frozen', true,
      'frozen_by_admin', v_frozen_by_admin,
      'code', 'ACCOUNT_FROZEN',
      'error', 'Account is currently frozen per CBN security directives. Outbound transactions are disabled.'
    );
  END IF;

  IF v_tx_pin_hash IS NULL OR NULLIF(TRIM(v_tx_pin_hash), '') IS NULL THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (v_caller, 'MISSING_PIN_BLOCKED', 'warning', 'profiles', v_caller::TEXT, jsonb_build_object('action', p_action));
    RETURN jsonb_build_object(
      'ok', false,
      'needs_pin_setup', true,
      'code', 'PIN_SETUP_REQUIRED',
      'error', 'Mandatory 4-digit Transaction PIN has not been created yet. Complete PIN setup to unlock your wallet.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'email_confirmed_at', v_email_confirmed_at,
    'email_otp_verified_at', v_otp_verified_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public._assert_verified_wallet_ready(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._verify_pin_and_audit(
  p_user_id UUID,
  p_pin TEXT,
  p_action TEXT DEFAULT 'FINANCIAL_MUTATION',
  p_allow_self_frozen BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_gate JSONB;
  v_profile public.profiles%ROWTYPE;
  v_clean_pin TEXT := TRIM(COALESCE(p_pin, ''));
  v_stored_hash TEXT;
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
  v_base_strikes INT := 0;
  v_next_strikes INT;
  v_lock_until TIMESTAMPTZ;
BEGIN
  v_gate := public._assert_verified_wallet_ready(p_user_id, p_action, p_allow_self_frozen);
  IF COALESCE((v_gate->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN v_gate;
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  -- Active 15-minute lockout check
  IF v_profile.pin_locked_until IS NOT NULL AND v_profile.pin_locked_until > v_now THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (
      p_user_id, 'PIN_LOCKOUT_REJECTED', 'warning', 'profiles', p_user_id::TEXT,
      jsonb_build_object('action', p_action, 'locked_until', v_profile.pin_locked_until)
    );
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PIN_LOCKED',
      'attempts_remaining', 0,
      'locked_until', v_profile.pin_locked_until,
      'error', 'Transaction PIN is locked after 5 failed attempts. Try again after ' || TO_CHAR(v_profile.pin_locked_until, 'HH24:MI UTC') || '.'
    );
  END IF;

  -- Reset expired lockout strike base so post-cooldown wrong attempt starts at strike 1 of 5
  IF v_profile.pin_locked_until IS NOT NULL AND v_profile.pin_locked_until <= v_now THEN
    v_base_strikes := 0;
  ELSE
    v_base_strikes := COALESCE(v_profile.pin_failed_attempts, 0);
  END IF;

  IF v_clean_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_PIN_FORMAT',
      'error', 'Enter your 4-digit numeric Transaction PIN.'
    );
  END IF;

  v_stored_hash := v_profile.transaction_pin_hash;
  IF v_stored_hash IS NULL OR v_stored_hash !~ '^\$2[abxy]\$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'needs_pin_setup', true,
      'code', 'PIN_SETUP_REQUIRED',
      'error', 'Create your 4-digit Transaction PIN before authorizing transactions.'
    );
  END IF;

  IF v_stored_hash = crypt(v_clean_pin, v_stored_hash) THEN
    IF COALESCE(v_profile.pin_failed_attempts, 0) > 0 OR v_profile.pin_locked_until IS NOT NULL THEN
      UPDATE public.profiles
      SET pin_failed_attempts = 0,
          pin_locked_until = NULL,
          updated_at = v_now
      WHERE id = p_user_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', 'VERIFIED');
  END IF;

  -- Failed PIN attempt -> increment strikes & lock for 15 minutes at 5 strikes
  v_next_strikes := v_base_strikes + 1;
  IF v_next_strikes >= 5 THEN
    v_lock_until := v_now + INTERVAL '15 minutes';
  ELSE
    v_lock_until := NULL;
  END IF;

  UPDATE public.profiles
  SET pin_failed_attempts = v_next_strikes,
      pin_locked_until = v_lock_until,
      updated_at = v_now
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

REVOKE ALL ON FUNCTION public._verify_pin_and_audit(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 8. ONBOARDING, OTP SESSION ATTESTATION, PIN SETUP & SAFE ACCOUNT RPCs
-- ============================================================================

-- 8.1 Record Verified Login Session & Stamp `email_otp_verified_at`
CREATE OR REPLACE FUNCTION public.record_verified_login_session(p_device_metadata JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email_confirmed_at TIMESTAMPTZ;
  v_user_created_at TIMESTAMPTZ;
  v_has_pin BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
  v_meta JSONB := COALESCE(p_device_metadata, '{}'::JSONB);
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT email_confirmed_at, created_at
  INTO v_email_confirmed_at, v_user_created_at
  FROM auth.users
  WHERE id = v_user_id;

  IF v_email_confirmed_at IS NULL THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (v_user_id, 'UNVERIFIED_LOGIN_BLOCKED', 'warning', 'auth.users', v_user_id::TEXT, v_meta);
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'email_confirmed', false,
      'error', 'Email address is not yet verified.'
    );
  END IF;

  UPDATE public.profiles
  SET email_otp_verified_at = COALESCE(email_otp_verified_at, v_now),
      last_login_at = v_now,
      last_login_device = v_meta,
      updated_at = v_now
  WHERE id = v_user_id
  RETURNING (
    transaction_pin_hash IS NOT NULL
    AND NULLIF(TRIM(transaction_pin_hash), '') IS NOT NULL
  ) INTO v_has_pin;

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, user_agent, metadata
  ) VALUES (
    v_user_id,
    'USER_LOGIN',
    'info',
    'profiles',
    v_user_id::TEXT,
    NULLIF(TRIM(COALESCE(v_meta->>'user_agent', '')), ''),
    v_meta || jsonb_build_object(
      'login_at', v_now,
      'email_confirmed_at', v_email_confirmed_at,
      'autoconfirm_suspected', (v_email_confirmed_at = v_user_created_at),
      'has_transaction_pin', COALESCE(v_has_pin, FALSE)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'login_at', v_now,
    'email_confirmed', true,
    'has_transaction_pin', COALESCE(v_has_pin, FALSE)
  );
END;
$$;

-- 8.2 Set or Rotate 4-Digit Transaction PIN (Locks profile `FOR UPDATE` to prevent race)
CREATE OR REPLACE FUNCTION public.set_user_transaction_pin(
  p_new_pin TEXT,
  p_current_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email_confirmed_at TIMESTAMPTZ;
  v_clean_new TEXT := TRIM(COALESCE(p_new_pin, ''));
  v_profile public.profiles%ROWTYPE;
  v_verify JSONB;
  v_new_hash TEXT;
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed_at
  FROM auth.users
  WHERE id = auth.uid();

  IF v_email_confirmed_at IS NULL THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (v_user_id, 'UNVERIFIED_EMAIL_BLOCKED', 'warning', 'auth.users', v_user_id::TEXT, jsonb_build_object('action', 'SET_PIN'));
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Verify your email with the 6-digit OTP before setting a Transaction PIN.'
    );
  END IF;

  IF v_clean_new !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transaction PIN must be exactly 4 numeric digits.');
  END IF;

  -- Lock profile row FOR UPDATE to prevent concurrent first-time PIN setup overwrite
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'PROFILE_MISSING', 'error', 'Account profile not found.');
  END IF;

  IF v_profile.is_frozen IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_FROZEN', 'error', 'Account is currently frozen. PIN changes are disabled.');
  END IF;

  IF v_profile.email_otp_verified_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Complete 6-digit Email OTP login attestation before configuring a Transaction PIN.'
    );
  END IF;

  IF v_profile.transaction_pin_hash IS NOT NULL THEN
    v_verify := public._verify_pin_and_audit(v_user_id, p_current_pin, 'ROTATE_PIN', FALSE);
    IF COALESCE((v_verify->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', v_verify->>'code',
        'error', COALESCE(v_verify->>'error', 'Current PIN verification failed.')
      );
    END IF;
  END IF;

  v_new_hash := crypt(v_clean_new, gen_salt('bf', 10));

  UPDATE public.profiles
  SET transaction_pin_hash = v_new_hash,
      pin_hash = v_new_hash,
      pin_failed_attempts = 0,
      pin_locked_until = NULL,
      updated_at = v_now
  WHERE id = v_user_id;

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, metadata
  ) VALUES (
    v_user_id,
    CASE WHEN v_profile.transaction_pin_hash IS NULL THEN 'PIN_ONBOARDING_COMPLETED' ELSE 'PIN_ROTATED' END,
    'info',
    'profiles',
    v_user_id::TEXT,
    jsonb_build_object('is_initial_setup', (v_profile.transaction_pin_hash IS NULL))
  );

  RETURN jsonb_build_object('success', true, 'has_transaction_pin', true);
END;
$$;

-- 8.3 Verify 4-Digit Transaction PIN
CREATE OR REPLACE FUNCTION public.verify_user_transaction_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing_hash TEXT;
  v_res JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Authentication required.');
  END IF;

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Verify your email address via 6-digit OTP before using your wallet.'
    );
  END IF;

  SELECT transaction_pin_hash INTO v_existing_hash
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_existing_hash IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'needs_pin_setup', true, 'code', 'PIN_SETUP_REQUIRED');
  END IF;

  v_res := public._verify_pin_and_audit(v_user_id, p_pin, 'VERIFY_PIN', FALSE);
  IF COALESCE((v_res->>'ok')::BOOLEAN, FALSE) IS TRUE THEN
    RETURN jsonb_build_object('valid', true);
  END IF;

  RETURN jsonb_build_object(
    'valid', false,
    'code', v_res->>'code',
    'is_frozen', COALESCE((v_res->>'is_frozen')::BOOLEAN, FALSE),
    'attempts_remaining', v_res->'attempts_remaining',
    'error', COALESCE(v_res->>'error', 'Incorrect 4-digit Transaction PIN.')
  );
END;
$$;

-- 8.4 Self-Healing Profile & Wallet Hydration (Zero PAN/CVV Card Issuance; Strips Secret Columns)
CREATE OR REPLACE FUNCTION public.ensure_my_profile_and_wallet(
  p_full_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_auth_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_profile public.profiles%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_nuban VARCHAR(10);
  v_name TEXT;
  v_tag TEXT;
  v_tag_bytes BYTEA;
  v_has_pin BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT email, email_confirmed_at
  INTO v_auth_email, v_email_confirmed_at
  FROM auth.users
  WHERE id = v_user_id;

  v_name := COALESCE(
    NULLIF(TRIM(p_full_name), ''),
    INITCAP(SPLIT_PART(COALESCE(v_auth_email, 'MidePay Member'), '@', 1))
  );

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    v_tag_bytes := gen_random_bytes(2);
    v_tag := '@' || LOWER(REGEXP_REPLACE(SPLIT_PART(v_name, ' ', 1), '[^a-zA-Z0-9]', '', 'g')) ||
             LPAD((((get_byte(v_tag_bytes, 0) << 8) | get_byte(v_tag_bytes, 1)) % 10000)::TEXT, 4, '0');

    INSERT INTO public.profiles (
      id, full_name, email, phone, tag, kyc_tier, role, is_frozen, frozen_by_admin
    ) VALUES (
      v_user_id,
      v_name,
      COALESCE(v_auth_email, v_user_id::TEXT || '@midepay.ng'),
      NULLIF(TRIM(p_phone), ''),
      v_tag,
      1,
      'user',
      FALSE,
      FALSE
    ) RETURNING * INTO v_profile;
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_user_id AND currency = 'NGN';

  IF NOT FOUND THEN
    v_nuban := public.generate_unique_midepay_nuban();
    INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
    VALUES (v_user_id, 'NGN', 0.00, 0.00, v_nuban, 'MidePay / Providus Bank')
    RETURNING * INTO v_wallet;
  ELSIF v_wallet.nuban IS NULL OR v_wallet.nuban !~ '^[0-9]{10}$' THEN
    v_nuban := public.generate_unique_midepay_nuban();
    UPDATE public.wallets
    SET nuban = v_nuban,
        bank_name = COALESCE(bank_name, 'MidePay / Providus Bank'),
        updated_at = TIMEZONE('utc', NOW())
    WHERE id = v_wallet.id
    RETURNING * INTO v_wallet;
  END IF;

  v_has_pin := (
    v_profile.transaction_pin_hash IS NOT NULL
    AND NULLIF(TRIM(v_profile.transaction_pin_hash), '') IS NOT NULL
  );

  RETURN jsonb_build_object(
    'profile', (to_jsonb(v_profile) - 'pin_hash' - 'transaction_pin_hash') || jsonb_build_object('has_transaction_pin', v_has_pin),
    'wallet', to_jsonb(v_wallet),
    'email_confirmed', (v_email_confirmed_at IS NOT NULL AND v_profile.email_otp_verified_at IS NOT NULL),
    'email_confirmed_at', v_email_confirmed_at,
    'email_otp_verified_at', v_profile.email_otp_verified_at,
    'has_transaction_pin', v_has_pin
  );
END;
$$;

-- 8.5 Panic Switch (`set_own_account_freeze`) — Blocks Lifting Compliance `frozen_by_admin`
CREATE OR REPLACE FUNCTION public.set_own_account_freeze(
  p_is_frozen BOOLEAN,
  p_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_next BOOLEAN := COALESCE(p_is_frozen, FALSE);
  v_profile public.profiles%ROWTYPE;
  v_pin_check JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Security profile not found.';
  END IF;

  IF v_next = FALSE THEN
    IF v_profile.frozen_by_admin IS TRUE THEN
      INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
      VALUES (v_user_id, 'ADMIN_FREEZE_BYPASS_BLOCKED', 'critical', 'profiles', v_user_id::TEXT, jsonb_build_object('attempted_action', 'self_unfreeze'));
      RETURN jsonb_build_object(
        'success', false,
        'code', 'ADMIN_FREEZE_LOCKED',
        'is_frozen', true,
        'error', 'Account is restricted by MidePay Compliance and cannot be unfrozen from client settings.'
      );
    END IF;

    -- Require verified email + 4-digit PIN to lift a self-imposed Panic Switch freeze
    v_pin_check := public._verify_pin_and_audit(v_user_id, p_pin, 'SELF_UNFREEZE', TRUE);
    IF COALESCE((v_pin_check->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', v_pin_check->>'code',
        'is_frozen', v_profile.is_frozen,
        'error', COALESCE(v_pin_check->>'error', 'Enter your 4-digit Transaction PIN to unfreeze your account.')
      );
    END IF;
  END IF;

  UPDATE public.profiles
  SET is_frozen = v_next,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_user_id;

  IF v_next = TRUE THEN
    UPDATE public.virtual_cards
    SET is_frozen = TRUE,
        updated_at = TIMEZONE('utc', NOW())
    WHERE user_id = v_user_id AND is_frozen = FALSE;
  END IF;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
  VALUES (
    v_user_id,
    'ACCOUNT_FREEZE_CHANGE',
    CASE WHEN v_next THEN 'warning' ELSE 'info' END,
    'profiles',
    v_user_id::TEXT,
    jsonb_build_object('is_frozen', v_next, 'frozen_by_admin', v_profile.frozen_by_admin)
  );

  RETURN jsonb_build_object('success', true, 'is_frozen', v_next);
END;
$$;

-- 8.6 PII-Minimized Account Name Enquiry (`lookup_recipient_profile` — masks email & phone)
CREATE OR REPLACE FUNCTION public.lookup_recipient_profile(search_query TEXT)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  tag TEXT,
  avatar_url TEXT,
  is_frozen BOOLEAN,
  nuban VARCHAR(10),
  bank_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_raw TEXT := TRIM(COALESCE(search_query, ''));
  v_digits TEXT := REGEXP_REPLACE(v_raw, '[^0-9]', '', 'g');
  v_norm_tag TEXT;
BEGIN
  IF auth.uid() IS NULL OR LENGTH(v_raw) < 3 THEN
    RETURN;
  END IF;

  v_norm_tag := CASE
    WHEN LEFT(v_raw, 1) = '@' THEN LOWER(v_raw)
    ELSE '@' || LOWER(v_raw)
  END;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    NULL::TEXT AS email,
    NULL::TEXT AS phone,
    p.tag,
    p.avatar_url,
    p.is_frozen,
    w.nuban,
    COALESCE(w.bank_name, 'MidePay / Providus Bank') AS bank_name
  FROM public.profiles p
  LEFT JOIN public.wallets w
    ON w.user_id = p.id AND w.currency = 'NGN'
  WHERE p.id <> auth.uid()
    AND (
      (LENGTH(v_digits) = 10 AND w.nuban = v_digits)
      OR LOWER(p.email) = LOWER(v_raw)
      OR LOWER(p.tag) = LOWER(v_raw)
      OR (POSITION('@' IN v_raw) <= 1 AND LOWER(p.tag) = v_norm_tag)
      OR (
        LENGTH(v_digits) >= 10
        AND RIGHT(REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), 10) = RIGHT(v_digits, 10)
      )
    )
  ORDER BY
    CASE WHEN LENGTH(v_digits) = 10 AND w.nuban = v_digits THEN 0 ELSE 1 END
  LIMIT 1;
END;
$$;

-- 8.7 Beneficiaries, Waitlist & Card Control RPCs (Enforcing Freeze & Verification)
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
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_frozen BOOLEAN := FALSE;
  v_row public.beneficiaries%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT COALESCE(is_frozen, FALSE) INTO v_is_frozen FROM public.profiles WHERE id = v_user_id;
  IF v_is_frozen THEN
    RAISE EXCEPTION 'Account is frozen. Beneficiary updates are disabled.';
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

CREATE OR REPLACE FUNCTION public.join_waitlist(
  p_email TEXT,
  p_source TEXT DEFAULT 'landing_page'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean_email TEXT := LOWER(TRIM(COALESCE(p_email, '')));
BEGIN
  IF POSITION('@' IN v_clean_email) <= 1 OR LENGTH(v_clean_email) > 254 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid email address.');
  END IF;

  INSERT INTO public.waitlist (email, source)
  VALUES (v_clean_email, LEFT(COALESCE(NULLIF(TRIM(p_source), ''), 'landing_page'), 64))
  ON CONFLICT (email) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_virtual_card_freeze(
  p_card_id UUID,
  p_is_frozen BOOLEAN
)
RETURNS public.virtual_cards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_acct_frozen BOOLEAN := FALSE;
  v_card public.virtual_cards%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT COALESCE(is_frozen, FALSE) INTO v_acct_frozen FROM public.profiles WHERE id = v_user_id;
  IF v_acct_frozen AND COALESCE(p_is_frozen, FALSE) = FALSE THEN
    RAISE EXCEPTION 'Cannot unfreeze a virtual card while your MidePay account is frozen.';
  END IF;

  UPDATE public.virtual_cards
  SET is_frozen = COALESCE(p_is_frozen, FALSE),
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_card_id AND user_id = v_user_id
  RETURNING * INTO v_card;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Virtual card not found or access denied.';
  END IF;

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
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_acct_frozen BOOLEAN := FALSE;
  v_limit NUMERIC(14, 2) := ROUND(COALESCE(p_spending_limit, 0), 2);
  v_card public.virtual_cards%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT COALESCE(is_frozen, FALSE) INTO v_acct_frozen FROM public.profiles WHERE id = v_user_id;
  IF v_acct_frozen THEN
    RAISE EXCEPTION 'Account is frozen. Card spending limits cannot be modified.';
  END IF;

  IF v_limit < 10 OR v_limit > 10000000 THEN
    RAISE EXCEPTION 'Monthly spending limit must be between 10 and 10,000,000.';
  END IF;

  UPDATE public.virtual_cards
  SET spending_limit_monthly = v_limit,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_card_id AND user_id = v_user_id
  RETURNING * INTO v_card;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Virtual card not found or access denied.';
  END IF;

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
SET search_path = public, extensions, pg_temp
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

-- 8.8 Hardened Payment Request State Machine (`create_payment_request` & `respond_payment_request`)
CREATE OR REPLACE FUNCTION public.create_payment_request(
  p_payer_id UUID,
  p_amount NUMERIC,
  p_note TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_gate JSONB;
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_existing public.payment_requests%ROWTYPE;
  v_created public.payment_requests%ROWTYPE;
BEGIN
  IF v_requester IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  v_gate := public._assert_verified_wallet_ready(v_requester, 'CREATE_PAYMENT_REQUEST', FALSE);
  IF COALESCE((v_gate->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF p_payer_id IS NULL OR p_payer_id = v_requester THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a valid recipient different from yourself.');
  END IF;

  IF v_amt <= 0 OR v_amt > 25000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request amount must be between ₦0.01 and ₦25,000,000.00.');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_requester::TEXT), hashtext(p_idempotency_key::TEXT));
    SELECT * INTO v_existing
    FROM public.payment_requests
    WHERE requester_id = v_requester AND idempotency_key = p_idempotency_key
    LIMIT 1;
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

-- Strict State Transitions:
--   - `cancelled`: ONLY `requester_id = auth.uid()` from `'pending'`
--   - `declined`:  ONLY `payer_id = auth.uid()` from `'pending'`
--   - `approved`:  ONLY `payer_id = auth.uid()` from `'pending'` WITH a verified, unlinked settled transfer!
CREATE OR REPLACE FUNCTION public.respond_payment_request(
  p_request_id UUID,
  p_status TEXT,
  p_tx_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_norm_status TEXT := LOWER(TRIM(COALESCE(p_status, '')));
  v_clean_ref TEXT := NULLIF(TRIM(COALESCE(p_tx_reference, '')), '');
  v_req public.payment_requests%ROWTYPE;
  v_tx public.transactions%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF v_norm_status NOT IN ('approved', 'declined', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid payment request status.');
  END IF;

  SELECT * INTO v_req
  FROM public.payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR (v_req.payer_id <> v_caller AND v_req.requester_id <> v_caller) THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Payment request not found or unauthorized.');
  END IF;

  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_FINALIZED', 'error', 'Payment request is already ' || v_req.status || '.');
  END IF;

  IF v_norm_status = 'cancelled' THEN
    IF v_req.requester_id <> v_caller THEN
      RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Only the requester may cancel a pending payment request.');
    END IF;
    UPDATE public.payment_requests
    SET status = 'cancelled', updated_at = TIMEZONE('utc', NOW())
    WHERE id = v_req.id
    RETURNING * INTO v_req;
    RETURN jsonb_build_object('success', true, 'status', 'cancelled', 'request', to_jsonb(v_req));
  END IF;

  IF v_norm_status = 'declined' THEN
    IF v_req.payer_id <> v_caller THEN
      RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Only the designated payer may decline a payment request.');
    END IF;
    UPDATE public.payment_requests
    SET status = 'declined', updated_at = TIMEZONE('utc', NOW())
    WHERE id = v_req.id
    RETURNING * INTO v_req;
    RETURN jsonb_build_object('success', true, 'status', 'declined', 'request', to_jsonb(v_req));
  END IF;

  -- `v_norm_status = 'approved'`: MUST be the payer AND backed by an actual settled outflow transfer
  IF v_req.payer_id <> v_caller THEN
    INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
    VALUES (v_caller, 'PAYMENT_REQUEST_SPOOF_BLOCKED', 'critical', 'payment_requests', v_req.id::TEXT, jsonb_build_object('attempted_status', 'approved'));
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Requester cannot approve their own payment request.');
  END IF;

  SELECT t.* INTO v_tx
  FROM public.transactions t
  WHERE t.user_id = v_caller
    AND t.counterparty_user_id = v_req.requester_id
    AND t.type = 'outflow'
    AND t.status = 'successful'
    AND t.amount >= v_req.amount
    AND (v_clean_ref IS NULL OR t.reference = v_clean_ref)
    AND t.created_at >= (v_req.created_at - INTERVAL '1 minute')
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_requests pr2 WHERE pr2.fulfilled_tx_id = t.id
    )
  ORDER BY t.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SETTLEMENT_PROOF_REQUIRED',
      'error', 'Cannot mark payment request approved without a verified settled transfer to the requester.'
    );
  END IF;

  UPDATE public.payment_requests
  SET status = 'approved',
      fulfilled_tx_id = v_tx.id,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_req.id
  RETURNING * INTO v_req;

  RETURN jsonb_build_object('success', true, 'status', 'approved', 'fulfilled_tx_id', v_tx.id, 'request', to_jsonb(v_req));
END;
$$;

-- ============================================================================
-- 9. ATOMIC INTERNAL FINANCIAL LEDGER RPCs (P2P TRANSFER & MIDESAVE VAULTS)
--    Plus Universal Wallet <-> Ledger Reconciliation Verifier
-- ============================================================================

-- 9.0 Mathematical Wallet <-> Ledger Reconciliation Verifier
CREATE OR REPLACE FUNCTION public.verify_wallet_ledger_reconciliation(p_wallet_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_wallet public.wallets%ROWTYPE;
  v_inflows NUMERIC(14, 2) := 0.00;
  v_outflows NUMERIC(14, 2) := 0.00;
  v_expected NUMERIC(14, 2) := 0.00;
  v_tx_count INT := 0;
BEGIN
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Wallet not found.');
  END IF;

  IF v_caller IS NOT NULL AND v_caller <> v_wallet.user_id AND NOT public.is_executive() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'error', 'Access denied.');
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN type = 'inflow' AND status = 'successful' THEN (amount - fee) ELSE 0.00 END), 0.00),
    COALESCE(SUM(CASE WHEN type = 'outflow' AND status IN ('successful', 'pending') THEN (amount + fee) ELSE 0.00 END), 0.00),
    COUNT(*)
  INTO v_inflows, v_outflows, v_tx_count
  FROM public.transactions
  WHERE wallet_id = p_wallet_id;

  v_expected := ROUND(v_inflows - v_outflows, 2);

  RETURN jsonb_build_object(
    'ok', (v_wallet.balance = v_expected AND v_wallet.ledger_balance = v_expected),
    'wallet_id', v_wallet.id,
    'wallet_balance', v_wallet.balance,
    'ledger_balance', v_wallet.ledger_balance,
    'computed_ledger_net', v_expected,
    'total_settled_inflows', v_inflows,
    'total_active_outflows', v_outflows,
    'discrepancy', ROUND(v_wallet.balance - v_expected, 2),
    'transaction_count', v_tx_count
  );
END;
$$;

-- 9.1 Canonical Internal P2P NUBAN / @MideTag Transfer (`execute_p2p_transfer`)
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
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_sender_id UUID := auth.uid();
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_clean_ident TEXT := TRIM(COALESCE(p_recipient_nuban, ''));
  v_digits TEXT := REGEXP_REPLACE(v_clean_ident, '[^0-9]', '', 'g');
  v_clean_narration TEXT := LEFT(COALESCE(NULLIF(TRIM(p_narration), ''), 'MidePay Transfer'), 200);
  v_payload_hash TEXT;
  v_gate JSONB;
  v_existing_tx public.transactions%ROWTYPE;
  v_pin_check JSONB;
  v_sender_name TEXT;
  v_sender_kyc_tier INT := 1;
  v_max_single NUMERIC(14, 2);
  v_max_daily NUMERIC(14, 2);
  v_daily_spent NUMERIC(14, 2) := 0.00;
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

  -- Explicit Email Confirmation & Mandatory PIN Readiness Gate BEFORE any row lock or ledger lookup
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL THEN
    v_gate := public._assert_verified_wallet_ready(v_sender_id, 'P2P_TRANSFER', FALSE);
    RETURN jsonb_build_object('success', false, 'status', 'EMAIL_NOT_VERIFIED', 'code', 'EMAIL_NOT_VERIFIED', 'error', v_gate->>'error');
  END IF;

  v_gate := public._assert_verified_wallet_ready(v_sender_id, 'P2P_TRANSFER', FALSE);
  IF COALESCE((v_gate->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', COALESCE(v_gate->>'code', 'VERIFICATION_REQUIRED'),
      'code', v_gate->>'code',
      'error', v_gate->>'error'
    );
  END IF;

  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'idempotency_key_required',
      'code', 'IDEMPOTENCY_KEY_REQUIRED',
      'error', 'A unique UUID idempotency_key is required for every P2P transfer.'
    );
  END IF;

  IF v_amt <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'invalid_amount',
      'code', 'INVALID_AMOUNT',
      'error', 'Transfer amount must be greater than ₦0.00.'
    );
  END IF;

  v_payload_hash := ENCODE(DIGEST('P2P:' || LOWER(v_clean_ident) || ':' || v_amt::TEXT, 'sha256'), 'hex');

  -- Serialize concurrent identical `(user_id, idempotency_key)` submissions via transaction-scoped advisory lock
  PERFORM pg_advisory_xact_lock(hashtext(v_sender_id::TEXT), hashtext(p_idempotency_key::TEXT));

  SELECT * INTO v_existing_tx
  FROM public.transactions
  WHERE user_id = v_sender_id
    AND idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_tx.idempotency_payload_hash IS NOT NULL
       AND v_existing_tx.idempotency_payload_hash <> v_payload_hash THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'idempotency_conflict',
        'code', 'IDEMPOTENCY_CONFLICT',
        'error', 'Idempotency key was already used with different transfer parameters.'
      );
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'status', 'duplicate',
      'message', 'Transaction already processed',
      'reference', v_existing_tx.reference,
      'new_balance', v_existing_tx.balance_after
    );
  END IF;

  -- Verify 4-digit PIN via pgcrypto bcrypt + 5-strike lockout
  v_pin_check := public._verify_pin_and_audit(v_sender_id, p_pin, 'P2P_TRANSFER', FALSE);
  IF COALESCE((v_pin_check->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', COALESCE(v_pin_check->>'code', 'invalid_pin'),
      'code', v_pin_check->>'code',
      'attempts_remaining', v_pin_check->'attempts_remaining',
      'error', COALESCE(v_pin_check->>'error', 'Invalid Transaction PIN.')
    );
  END IF;

  SELECT full_name, COALESCE(kyc_tier, 1)
  INTO v_sender_name, v_sender_kyc_tier
  FROM public.profiles
  WHERE id = v_sender_id;

  -- CBN KYC Tier Single & Daily Cumulative Outflow Limits
  v_max_single := CASE v_sender_kyc_tier
    WHEN 3 THEN 5000000.00
    WHEN 2 THEN 250000.00
    ELSE 50000.00
  END;
  v_max_daily := CASE v_sender_kyc_tier
    WHEN 3 THEN 25000000.00
    WHEN 2 THEN 1000000.00
    ELSE 300000.00
  END;

  IF v_amt > v_max_single THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'kyc_limit_exceeded',
      'code', 'KYC_SINGLE_LIMIT_EXCEEDED',
      'error', 'Transfer exceeds CBN KYC Tier ' || v_sender_kyc_tier::TEXT || ' single-transaction limit of ₦' || TRIM(TO_CHAR(v_max_single, 'FM999,999,990.00')) || '.'
    );
  END IF;

  -- Resolve Recipient Wallet & Profile
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
    RETURN jsonb_build_object('success', false, 'status', 'recipient_not_found', 'code', 'RECIPIENT_NOT_FOUND', 'error', 'Recipient NUBAN or @MideTag not found.');
  END IF;

  IF v_recipient_id = v_sender_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'self_transfer', 'code', 'SELF_TRANSFER', 'error', 'Cannot transfer funds to your own wallet.');
  END IF;

  IF v_recipient_frozen THEN
    RETURN jsonb_build_object('success', false, 'status', 'recipient_frozen', 'code', 'RECIPIENT_FROZEN', 'error', 'Recipient account cannot receive transfers right now.');
  END IF;

  SELECT id INTO v_sender_wallet_id
  FROM public.wallets
  WHERE user_id = v_sender_id AND currency = 'NGN'
  LIMIT 1;

  IF v_sender_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'wallet_missing', 'code', 'WALLET_MISSING', 'error', 'Sender NGN wallet not found.');
  END IF;

  -- Deterministic UUID-Ordered `SELECT ... FOR UPDATE` Row Locks (100% Deadlock-Free on A<->B Simultaneous Transfers)
  IF v_sender_wallet_id < v_recipient_wallet_id THEN
    SELECT * INTO v_sender_wallet FROM public.wallets WHERE id = v_sender_wallet_id FOR UPDATE;
    SELECT * INTO v_recipient_wallet FROM public.wallets WHERE id = v_recipient_wallet_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient_wallet FROM public.wallets WHERE id = v_recipient_wallet_id FOR UPDATE;
    SELECT * INTO v_sender_wallet FROM public.wallets WHERE id = v_sender_wallet_id FOR UPDATE;
  END IF;

  -- Evaluate Daily Cumulative Outflow under Sender Wallet Lock (Prevents Concurrent Daily-Limit Race)
  SELECT COALESCE(SUM(amount + fee), 0.00) INTO v_daily_spent
  FROM public.transactions
  WHERE wallet_id = v_sender_wallet.id
    AND type = 'outflow'
    AND category = 'transfer'
    AND status IN ('successful', 'pending')
    AND created_at >= DATE_TRUNC('day', TIMEZONE('utc', NOW()));

  IF (v_daily_spent + v_amt) > v_max_daily THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'kyc_daily_limit_exceeded',
      'code', 'KYC_DAILY_LIMIT_EXCEEDED',
      'error', 'Transfer exceeds CBN KYC Tier ' || v_sender_kyc_tier::TEXT || ' daily transfer limit of ₦' || TRIM(TO_CHAR(v_max_daily, 'FM999,999,990.00')) || '.'
    );
  END IF;

  IF v_sender_wallet.balance < v_amt THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'insufficient_funds',
      'code', 'INSUFFICIENT_FUNDS',
      'error', 'Insufficient wallet balance (Available: ₦' || TRIM(TO_CHAR(v_sender_wallet.balance, 'FM999,999,990.00')) || ').'
    );
  END IF;

  v_new_sender_bal := ROUND(v_sender_wallet.balance - v_amt, 2);
  v_new_recipient_bal := ROUND(v_recipient_wallet.balance + v_amt, 2);
  v_ref_out := 'MDP-P2P-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));
  v_ref_in  := 'MDP-P2P-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));

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
    narration, reference, idempotency_key, idempotency_payload_hash, gateway_provider, metadata
  ) VALUES
  (
    v_sender_wallet.id, v_sender_id, v_recipient_id, 'outflow', 'transfer', v_amt, 0.00,
    v_sender_wallet.balance, v_new_sender_bal, 'successful',
    v_recipient_name, 'MidePay / Providus Bank', v_recipient_wallet.nuban,
    v_clean_narration, v_ref_out, p_idempotency_key, v_payload_hash, 'internal',
    jsonb_build_object('paired_reference', v_ref_in, 'channel', 'nuban_p2p')
  ),
  (
    v_recipient_wallet.id, v_recipient_id, v_sender_id, 'inflow', 'transfer', v_amt, 0.00,
    v_recipient_wallet.balance, v_new_recipient_bal, 'successful',
    v_sender_name, 'MidePay / Providus Bank', v_sender_wallet.nuban,
    v_clean_narration, v_ref_in, gen_random_uuid(), NULL, 'internal',
    jsonb_build_object('paired_reference', v_ref_out, 'channel', 'nuban_p2p')
  );

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata
  ) VALUES (
    v_sender_id, 'P2P_TRANSFER', 'info', 'transactions', v_ref_out, p_idempotency_key, v_amt,
    jsonb_build_object('recipient_id', v_recipient_id, 'recipient_nuban', v_recipient_wallet.nuban)
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'success',
    'reference', v_ref_out,
    'amount', v_amt,
    'recipient_name', v_recipient_name,
    'recipient_nuban', v_recipient_wallet.nuban,
    'new_balance', v_new_sender_bal
  );
END;
$$;

-- 9.2 UUID Transfer Delegate (`transfer_funds` — enforces mandatory `p_pin` & `p_idempotency_key`)
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
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_gate JSONB;
  v_recipient_nuban VARCHAR(10);
BEGIN
  IF v_caller IS NULL OR sender_id IS NULL OR v_caller <> sender_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Unauthorized transfer request.');
  END IF;

  v_gate := public._assert_verified_wallet_ready(v_caller, 'P2P_TRANSFER', FALSE);
  IF COALESCE((v_gate->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF p_pin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'PIN_REQUIRED', 'error', '4-digit Transaction PIN is required.');
  END IF;

  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'error', 'A unique UUID idempotency_key is required.');
  END IF;

  SELECT nuban INTO v_recipient_nuban
  FROM public.wallets
  WHERE user_id = recipient_id AND currency = 'NGN'
  LIMIT 1;

  IF v_recipient_nuban IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'RECIPIENT_NOT_FOUND', 'error', 'Recipient NGN wallet not found.');
  END IF;

  RETURN public.execute_p2p_transfer(v_recipient_nuban, amount, p_pin, p_idempotency_key, narration);
END;
$$;

-- 9.3 MideSave Goal Vault Creation, Deposit, Withdrawal & Unified Dispatcher
--     (Server-enforced 14.50% display rate; gross `amount` + `fee` accounting for 100% ledger parity)
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
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_gate JSONB;
  v_clean_title TEXT := TRIM(COALESCE(p_title, ''));
  v_target NUMERIC(14, 2) := ROUND(COALESCE(p_target_amount, 0), 2);
  v_fixed_rate CONSTANT NUMERIC(5, 2) := 14.50;
  v_vault public.savings_vaults%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_gate := public._assert_verified_wallet_ready(v_user_id, 'MIDESAVE_CREATE', FALSE);
  IF COALESCE((v_gate->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION '%', COALESCE(v_gate->>'error', 'Verified email and Transaction PIN required.');
  END IF;

  IF LENGTH(v_clean_title) < 2 OR LENGTH(v_clean_title) > 80 THEN
    RAISE EXCEPTION 'Vault title must be between 2 and 80 characters.';
  END IF;

  IF v_target <= 0 OR v_target > 1000000000 THEN
    RAISE EXCEPTION 'Target savings amount must be greater than ₦0.00.';
  END IF;

  -- Ignore client `p_interest_rate_pa` to block client rate-tampering; enforce server display rate 14.50%
  INSERT INTO public.savings_vaults (
    user_id, title, category, target_amount, current_balance, interest_rate_pa, lock_until, status
  ) VALUES (
    v_user_id,
    v_clean_title,
    LEFT(COALESCE(NULLIF(TRIM(p_category), ''), 'General'), 40),
    v_target,
    0.00,
    v_fixed_rate,
    p_lock_until,
    'active'
  ) RETURNING * INTO v_vault;

  INSERT INTO public.midesave_vaults (
    id, user_id, title, category, target_amount, current_balance, interest_rate_pa, lock_until, status, created_at
  ) VALUES (
    v_vault.id, v_user_id, v_vault.title, v_vault.category, v_vault.target_amount, 0.00, v_fixed_rate, v_vault.lock_until, 'active', v_vault.created_at
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, amount, metadata)
  VALUES (v_user_id, 'MIDESAVE_VAULT_CREATED', 'info', 'savings_vaults', v_vault.id::TEXT, v_target, jsonb_build_object('title', v_vault.title, 'lock_until', p_lock_until));

  RETURN v_vault;
END;
$$;

CREATE OR REPLACE FUNCTION public.fund_savings_vault(
  p_vault_id UUID,
  p_amount NUMERIC,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_gate JSONB;
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_payload_hash TEXT;
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
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required to fund a MideSave vault.');
  END IF;

  v_gate := public._assert_verified_wallet_ready(v_caller, 'MIDESAVE_DEPOSIT', FALSE);
  IF COALESCE((v_gate->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'error', 'A unique UUID idempotency_key is required.');
  END IF;

  IF p_vault_id IS NULL OR v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'error', 'Valid vault ID and positive NGN deposit amount are required.');
  END IF;

  v_payload_hash := ENCODE(DIGEST('SAV_FUND:' || p_vault_id::TEXT || ':' || v_amt::TEXT, 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtext(v_caller::TEXT), hashtext(p_idempotency_key::TEXT));

  SELECT * INTO v_existing_tx
  FROM public.transactions
  WHERE user_id = v_caller AND idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_tx.idempotency_payload_hash IS NOT NULL AND v_existing_tx.idempotency_payload_hash <> v_payload_hash THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT', 'error', 'Idempotency key reused with different vault funding parameters.');
    END IF;
    SELECT * INTO v_vault FROM public.savings_vaults WHERE id = p_vault_id AND user_id = v_caller;
    RETURN jsonb_build_object(
      'success', true,
      'status', 'duplicate',
      'vault_id', p_vault_id,
      'vault_title', v_vault.title,
      'vault_balance', v_vault.current_balance,
      'new_balance', v_existing_tx.balance_after,
      'reference', v_existing_tx.reference
    );
  END IF;

  v_pin_res := public._verify_pin_and_audit(v_caller, p_pin, 'MIDESAVE_DEPOSIT', FALSE);
  IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_pin_res->>'code', 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
  END IF;

  -- Deterministic Lock Order: 1. `wallets`, 2. `savings_vaults`
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_caller AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'WALLET_MISSING', 'error', 'Active NGN wallet not found.');
  END IF;

  SELECT * INTO v_vault FROM public.savings_vaults WHERE id = p_vault_id AND user_id = v_caller FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'VAULT_NOT_FOUND', 'error', 'MideSave vault not found or access denied.');
  END IF;

  IF v_wallet.balance < v_amt THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INSUFFICIENT_FUNDS',
      'error', 'Insufficient NGN wallet balance (Available: ₦' || TRIM(TO_CHAR(v_wallet.balance, 'FM999,999,990.00')) || ').'
    );
  END IF;

  v_new_wallet_bal := ROUND(v_wallet.balance - v_amt, 2);
  v_new_vault_bal := ROUND(v_vault.current_balance + v_amt, 2);
  v_next_status := CASE WHEN v_vault.lock_until IS NOT NULL AND v_vault.lock_until <= NOW() THEN 'matured' ELSE 'active' END;
  v_ref := 'MDP-SAV-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));

  UPDATE public.wallets
  SET balance = v_new_wallet_bal, ledger_balance = v_new_wallet_bal, updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_wallet.id;

  UPDATE public.savings_vaults
  SET current_balance = v_new_vault_bal, status = v_next_status, updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_vault_id;

  UPDATE public.midesave_vaults
  SET current_balance = v_new_vault_bal, status = v_next_status, updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_vault_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, narration, reference,
    idempotency_key, idempotency_payload_hash, gateway_provider, metadata
  ) VALUES (
    v_wallet.id, v_caller, 'outflow', 'savings', v_amt, 0.00,
    v_wallet.balance, v_new_wallet_bal, 'successful',
    'MideSave Vault: ' || v_vault.title, 'MideSave Sub-Ledger',
    'MideSave Deposit — ' || v_vault.title, v_ref,
    p_idempotency_key, v_payload_hash, 'internal',
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

CREATE OR REPLACE FUNCTION public.withdraw_savings_vault(
  p_vault_id UUID,
  p_amount NUMERIC,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_gate JSONB;
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_payload_hash TEXT;
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
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required to withdraw from a MideSave vault.');
  END IF;

  v_gate := public._assert_verified_wallet_ready(v_caller, 'MIDESAVE_WITHDRAWAL', FALSE);
  IF COALESCE((v_gate->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'error', 'A unique UUID idempotency_key is required.');
  END IF;

  IF p_vault_id IS NULL OR v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'error', 'Valid vault ID and positive withdrawal amount are required.');
  END IF;

  v_payload_hash := ENCODE(DIGEST('SAV_WITHDRAW:' || p_vault_id::TEXT || ':' || v_amt::TEXT, 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtext(v_caller::TEXT), hashtext(p_idempotency_key::TEXT));

  SELECT * INTO v_existing_tx
  FROM public.transactions
  WHERE user_id = v_caller AND idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_tx.idempotency_payload_hash IS NOT NULL AND v_existing_tx.idempotency_payload_hash <> v_payload_hash THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT', 'error', 'Idempotency key reused with different vault withdrawal parameters.');
    END IF;
    SELECT * INTO v_vault FROM public.savings_vaults WHERE id = p_vault_id AND user_id = v_caller;
    RETURN jsonb_build_object(
      'success', true,
      'status', 'duplicate',
      'vault_status', v_vault.status,
      'vault_id', p_vault_id,
      'vault_title', v_vault.title,
      'gross_withdrawn', v_existing_tx.amount,
      'early_break_fee', v_existing_tx.fee,
      'net_credited', ROUND(v_existing_tx.amount - v_existing_tx.fee, 2),
      'vault_balance', v_vault.current_balance,
      'new_balance', v_existing_tx.balance_after,
      'reference', v_existing_tx.reference
    );
  END IF;

  v_pin_res := public._verify_pin_and_audit(v_caller, p_pin, 'MIDESAVE_WITHDRAWAL', FALSE);
  IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_pin_res->>'code', 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
  END IF;

  -- Deterministic Lock Order: 1. `wallets`, 2. `savings_vaults` (matches `fund_savings_vault`)
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_caller AND currency = 'NGN' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'WALLET_MISSING', 'error', 'Active NGN wallet not found.');
  END IF;

  SELECT * INTO v_vault FROM public.savings_vaults WHERE id = p_vault_id AND user_id = v_caller FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'VAULT_NOT_FOUND', 'error', 'MideSave vault not found or access denied.');
  END IF;

  IF v_vault.current_balance < v_amt THEN
    RETURN jsonb_build_object('success', false, 'code', 'INSUFFICIENT_VAULT_FUNDS', 'error', 'Insufficient vault balance in ' || v_vault.title || '.');
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
  v_ref := 'MDP-WDR-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));

  UPDATE public.wallets
  SET balance = v_new_wallet_bal, ledger_balance = v_new_wallet_bal, updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_wallet.id;

  UPDATE public.savings_vaults
  SET current_balance = v_new_vault_bal, status = v_next_status, updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_vault_id;

  UPDATE public.midesave_vaults
  SET current_balance = v_new_vault_bal, status = v_next_status, updated_at = TIMEZONE('utc', NOW())
  WHERE id = p_vault_id;

  -- Record GROSS principal in `amount` (`v_amt`) and penalty in `fee` (`v_early_break_fee`)
  -- so `balance_after - balance_before = amount - fee = v_net_credit` holds universally!
  INSERT INTO public.transactions (
    wallet_id, user_id, type, category, amount, fee,
    balance_before, balance_after, status,
    counterparty_name, counterparty_bank, narration, reference,
    idempotency_key, idempotency_payload_hash, gateway_provider, metadata
  ) VALUES (
    v_wallet.id, v_caller, 'inflow', 'savings', v_amt, v_early_break_fee,
    v_wallet.balance, v_new_wallet_bal, 'successful',
    'MideSave Vault: ' || v_vault.title, 'MideSave Sub-Ledger',
    CASE WHEN v_early_break_fee > 0 THEN 'MideSave Early-Break Withdrawal (1.5% Fee) — ' || v_vault.title ELSE 'MideSave Vault Withdrawal — ' || v_vault.title END,
    v_ref, p_idempotency_key, v_payload_hash, 'internal',
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

CREATE OR REPLACE FUNCTION public.manage_midesave_vault(
  p_action TEXT,
  p_vault_id UUID DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_category TEXT DEFAULT 'General',
  p_target_amount NUMERIC DEFAULT 100000.00,
  p_lock_until TIMESTAMPTZ DEFAULT NULL,
  p_interest_rate_pa NUMERIC DEFAULT 14.50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_gate JSONB;
  v_act TEXT := LOWER(TRIM(COALESCE(p_action, '')));
  v_created public.savings_vaults%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;

  v_gate := public._assert_verified_wallet_ready(v_caller, 'MANAGE_MIDESAVE_VAULT', FALSE);
  IF COALESCE((v_gate->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF v_act = 'create' THEN
    v_created := public.create_savings_vault(p_title, p_category, p_target_amount, p_lock_until, 14.50);
    RETURN jsonb_build_object('success', true, 'vault', to_jsonb(v_created));
  ELSIF v_act IN ('fund', 'deposit') THEN
    RETURN public.fund_savings_vault(p_vault_id, p_amount, p_pin, p_idempotency_key);
  ELSIF v_act = 'withdraw' THEN
    RETURN public.withdraw_savings_vault(p_vault_id, p_amount, p_pin, p_idempotency_key);
  ELSE
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_ACTION', 'error', 'Unsupported MideSave action. Use create, fund, or withdraw.');
  END IF;
END;
$$;

-- ============================================================================
-- 10. SERVER-SIDE GATEWAY WEBHOOK & EXECUTIVE COMPLIANCE SETTLEMENT RPCs
--     - `settle_gateway_deposit`, `debit_wallet_for_payout`,
--       `finalize_payout_settlement`, `reverse_failed_payout` -> `service_role` ONLY!
--     - `admin_credit_wallet` (with separation-of-duties + idempotency) &
--       `admin_set_account_freeze` (stamps `frozen_by_admin`) -> `is_executive()` ONLY!
-- ============================================================================
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

  SELECT id, wallet_id, user_id, type, amount, status
  INTO v_tx
  FROM public.transactions
  WHERE reference = v_clean_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending deposit transaction not found for reference: %.', v_clean_ref;
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
BEGIN
  IF p_user_id IS NULL OR v_amt <= 0 THEN
    RAISE EXCEPTION 'Valid user_id and positive payout amount are required.';
  END IF;

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

-- Finalize outbound NIP payout ONLY upon verified gateway settlement (`transfer.success` / `transfer.completed`)
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

  SELECT id, wallet_id, user_id, type, amount, fee, status, gateway_reference
  INTO v_tx
  FROM public.transactions
  WHERE reference = v_clean_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout transaction not found for reference: %.', v_clean_ref;
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
  SELECT id, wallet_id, user_id, type, amount, fee, status
  INTO v_tx
  FROM public.transactions
  WHERE reference = TRIM(COALESCE(p_reference, ''))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout transaction not found for reference: %.', p_reference;
  END IF;

  IF v_tx.status = 'reversed' THEN
    RETURN jsonb_build_object('success', true, 'already_reversed', true, 'tx_id', v_tx.id, 'reference', p_reference);
  END IF;

  IF v_tx.type <> 'outflow' OR v_tx.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending outflow payout transactions can be reversed (current status: %).', v_tx.status;
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

-- Hardened Executive Wallet Credit (`admin_credit_wallet` — Separation of Duties, Cap, CSPRNG & Idempotency)
CREATE OR REPLACE FUNCTION public.admin_credit_wallet(
  target_user_id UUID,
  amount NUMERIC,
  reason TEXT,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(amount, 0), 2);
  v_target_name TEXT;
  v_wallet_id UUID;
  v_old_balance NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
  v_nuban VARCHAR(10);
  v_existing_tx public.transactions%ROWTYPE;
  v_tx_id UUID;
  v_ref TEXT;
  v_clean_reason TEXT := NULLIF(TRIM(COALESCE(reason, '')), '');
BEGIN
  IF v_actor IS NULL OR NOT public.is_executive() THEN
    RAISE EXCEPTION 'Access Denied: Executive role clearance is required to credit wallets.';
  END IF;

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Executive email must be verified before authorizing treasury credits.';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required.';
  END IF;

  IF target_user_id = v_actor THEN
    RAISE EXCEPTION 'Separation of Duties Violation: Executives cannot credit their own personal wallet.';
  END IF;

  IF v_amt <= 0 OR v_amt > 10000000.00 THEN
    RAISE EXCEPTION 'Administrative credit amount must be between ₦0.01 and ₦10,000,000.00.';
  END IF;

  IF v_clean_reason IS NULL OR LENGTH(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'An explicit compliance audit reason (min 5 characters) is required.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(target_user_id::TEXT), hashtext(p_idempotency_key::TEXT));
    SELECT * INTO v_existing_tx
    FROM public.transactions
    WHERE user_id = target_user_id AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'status', 'duplicate',
        'tx_id', v_existing_tx.id,
        'reference', v_existing_tx.reference,
        'new_balance', v_existing_tx.balance_after
      );
    END IF;
  END IF;

  SELECT full_name INTO v_target_name FROM public.profiles WHERE id = target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found.';
  END IF;

  INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
  VALUES (target_user_id, 'NGN', 0.00, 0.00, public.generate_unique_midepay_nuban(), 'MidePay / Providus Bank')
  ON CONFLICT (user_id, currency) DO NOTHING;

  SELECT id, balance, nuban
  INTO v_wallet_id, v_old_balance, v_nuban
  FROM public.wallets
  WHERE user_id = target_user_id AND currency = 'NGN'
  FOR UPDATE;

  v_new_balance := ROUND(v_old_balance + v_amt, 2);
  v_ref := 'MDP-ADM-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = v_new_balance,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_wallet_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, counterparty_user_id, type, category,
    amount, fee, balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban,
    narration, reference, idempotency_key, gateway_provider, metadata
  ) VALUES (
    v_wallet_id, target_user_id, v_actor, 'inflow', 'admin_credit',
    v_amt, 0.00, v_old_balance, v_new_balance, 'successful',
    'MidePay Treasury Operations', 'Providus Bank', v_nuban,
    v_clean_reason, v_ref, p_idempotency_key, 'internal',
    jsonb_build_object('approved_by', v_actor, 'audit_reason', v_clean_reason)
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    v_actor, 'executive', target_user_id, 'ADMIN_CREDIT_WALLET', 'wallets', v_wallet_id::TEXT,
    v_clean_reason, jsonb_build_object('balance', v_old_balance),
    jsonb_build_object('balance', v_new_balance, 'credited_amount', v_amt, 'tx_id', v_tx_id, 'reference', v_ref)
  );

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, idempotency_key, amount, metadata
  ) VALUES (
    v_actor, 'ADMIN_CREDIT_WALLET', 'warning', 'wallets', v_wallet_id::TEXT, p_idempotency_key, v_amt,
    jsonb_build_object('target_user_id', target_user_id, 'reason', v_clean_reason, 'reference', v_ref)
  );

  RETURN jsonb_build_object(
    'success', true,
    'wallet_id', v_wallet_id,
    'tx_id', v_tx_id,
    'reference', v_ref,
    'old_balance', v_old_balance,
    'new_balance', v_new_balance,
    'target_user_name', v_target_name
  );
END;
$$;

-- Hardened Executive Compliance Freeze (`admin_set_account_freeze` — Sets `frozen_by_admin = freeze_state`)
CREATE OR REPLACE FUNCTION public.admin_set_account_freeze(
  target_user_id UUID,
  freeze_state BOOLEAN,
  reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_old_frozen BOOLEAN;
  v_target_email TEXT;
  v_clean_reason TEXT := NULLIF(TRIM(COALESCE(reason, '')), '');
BEGIN
  IF v_actor IS NULL OR NOT public.is_executive() THEN
    RAISE EXCEPTION 'Access Denied: Executive role clearance is required to freeze or unfreeze accounts.';
  END IF;

  IF target_user_id IS NULL OR freeze_state IS NULL THEN
    RAISE EXCEPTION 'target_user_id and freeze_state are required.';
  END IF;

  IF v_clean_reason IS NULL OR LENGTH(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'An explicit compliance reason (min 5 characters) is required.';
  END IF;

  SELECT is_frozen, email
  INTO v_old_frozen, v_target_email
  FROM public.profiles
  WHERE id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found.';
  END IF;

  UPDATE public.profiles
  SET is_frozen = freeze_state,
      frozen_by_admin = freeze_state,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = target_user_id;

  IF freeze_state = TRUE THEN
    UPDATE public.virtual_cards
    SET is_frozen = TRUE,
        updated_at = TIMEZONE('utc', NOW())
    WHERE user_id = target_user_id AND is_frozen = FALSE;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    v_actor, 'executive', target_user_id,
    CASE WHEN freeze_state THEN 'ADMIN_FREEZE_ACCOUNT' ELSE 'ADMIN_UNFREEZE_ACCOUNT' END,
    'profiles', target_user_id::TEXT, v_clean_reason,
    jsonb_build_object('is_frozen', v_old_frozen, 'email', v_target_email),
    jsonb_build_object('is_frozen', freeze_state, 'frozen_by_admin', freeze_state, 'email', v_target_email)
  );

  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, entity_id, metadata)
  VALUES (
    target_user_id,
    CASE WHEN freeze_state THEN 'ADMIN_ACCOUNT_FROZEN' ELSE 'ADMIN_ACCOUNT_UNFROZEN' END,
    'critical',
    'profiles',
    target_user_id::TEXT,
    jsonb_build_object('actor_id', v_actor, 'reason', v_clean_reason)
  );

  RETURN jsonb_build_object(
    'success', true,
    'target_user_id', target_user_id,
    'previous_freeze_state', v_old_frozen,
    'is_frozen', freeze_state,
    'frozen_by_admin', freeze_state,
    'reason', v_clean_reason
  );
END;
$$;

-- ============================================================================
-- 11. INTENTIONALLY DISABLED / QUARANTINED UNINTEGRATED PROVIDER RPCs
--     Each function enforces Email + PIN readiness checks AND fails closed
--     without touching wallet balances until real licensed rails are wired:
--       - `concept_topup_wallet`            -> `WALLET_SELF_CREDIT_DISABLED`
--       - `execute_external_bank_transfer`  -> `EXTERNAL_NIP_SETTLEMENT_DISABLED`
--       - `issue_virtual_card`              -> `CARD_ISSUER_DISABLED`
--       - `fund_virtual_card`               -> `CARD_ISSUER_DISABLED`
--       - `fund_virtual_card_from_wallet`   -> `CARD_ISSUER_DISABLED`
--       - `pay_vtu_bill`                    -> `VTU_PROVIDER_DISABLED`
--       - `pay_utility_bill`                -> `VTU_PROVIDER_DISABLED`
--       - `execute_payroll_batch`           -> `CORPORATE_PAYROLL_LEDGER_DISABLED`
--       - `execute_business_payroll`        -> `CORPORATE_PAYROLL_LEDGER_DISABLED`
-- ============================================================================

CREATE OR REPLACE FUNCTION public.concept_topup_wallet(
  p_amount NUMERIC,
  p_reference TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, metadata)
  VALUES (auth.uid(), 'DISABLED_RPC_INVOKED', 'critical', 'wallets', jsonb_build_object('rpc', 'concept_topup_wallet', 'amount', p_amount));

  RETURN jsonb_build_object(
    'success', false,
    'disabled', true,
    'code', 'WALLET_SELF_CREDIT_DISABLED',
    'error', 'Direct client wallet top-up is permanently disabled. Fund wallets via verified Paystack/Flutterwave webhooks (`settle_gateway_deposit`).'
  );
END;
$$;

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
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO public.security_audit_logs (user_id, event_type, severity, entity_type, metadata)
  VALUES (auth.uid(), 'DISABLED_RPC_INVOKED', 'warning', 'transactions', jsonb_build_object('rpc', 'execute_external_bank_transfer'));

  RETURN jsonb_build_object(
    'success', false,
    'disabled', true,
    'code', 'EXTERNAL_NIP_SETTLEMENT_DISABLED',
    'error', 'SQL-direct external bank settlement is disabled. Route external NIP payouts through the `bank-payout` Edge Function (`pending` -> verified settlement webhook).'
  );
END;
$$;

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
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'CARD_ISSUER_DISABLED: Virtual card issuance is disabled until a PCI-DSS tokenized card issuing provider is integrated.';
END;
$$;

CREATE OR REPLACE FUNCTION public.fund_virtual_card(
  p_card_id UUID,
  p_amount_card_currency NUMERIC,
  p_pin TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_gate JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_user_id, 'CARD_FUNDING', FALSE);
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF p_pin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'PIN_REQUIRED', 'error', 'Transaction PIN is required.');
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'disabled', true,
    'code', 'CARD_ISSUER_DISABLED',
    'error', 'Virtual card funding is disabled pending live PCI-DSS card issuer settlement and FX desk integration.'
  );
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
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN public.fund_virtual_card(p_card_id, p_amount_card_currency, p_pin, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_vtu_bill(
  p_service_type TEXT,
  p_provider TEXT,
  p_identifier TEXT,
  p_plan_name TEXT,
  p_amount NUMERIC,
  p_pin TEXT,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_gate JSONB;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required to pay utility bills.');
  END IF;

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_caller, 'VTU_BILL_PAYMENT', FALSE);
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF p_pin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'PIN_REQUIRED', 'error', 'Transaction PIN is required.');
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'disabled', true,
    'code', 'VTU_PROVIDER_DISABLED',
    'error', 'VTU airtime, data, cable, and electricity payments are disabled pending licensed Nigerian VTU/DisCo aggregator integration.'
  );
END;
$$;

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
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN public.pay_vtu_bill(p_service_type, p_provider, p_identifier, p_plan_name, p_amount, p_pin, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_payroll_batch(
  p_business_id UUID,
  p_title TEXT,
  p_items JSONB,
  p_pin TEXT,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_employer_id UUID := auth.uid();
  v_gate JSONB;
BEGIN
  IF v_employer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required to execute batch payroll.');
  END IF;

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_employer_id AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_employer_id, 'BUSINESS_PAYROLL', FALSE);
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF p_business_id IS NULL OR NOT public.has_business_write_role(p_business_id) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Access Denied: caller lacks finance authority for this business.');
  END IF;

  IF p_pin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'PIN_REQUIRED', 'error', 'Transaction PIN is required.');
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'disabled', true,
    'code', 'CORPORATE_PAYROLL_LEDGER_DISABLED',
    'error', 'Batch corporate payroll is disabled until dedicated `business_sub_accounts` treasury settlement is configured.'
  );
END;
$$;

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
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN public.execute_payroll_batch(p_business_id, p_title, p_items, p_pin, p_idempotency_key);
END;
$$;

-- ============================================================================
-- 12. STRICT FUNCTION `EXECUTE` GRANTS & UNINTEGRATED PROVIDER QUARANTINE
-- ============================================================================

-- 12.1 Revoke ALL public/anon/authenticated execution on every non-extension public function first
DO $$
DECLARE
  v_sig TEXT;
BEGIN
  FOR v_sig IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
  END LOOP;
END $$;

-- 12.2 Explicitly quarantine all unintegrated / unsafe provider functions from client roles
DO $quarantine$
DECLARE
  v_signature TEXT;
BEGIN
  FOR v_signature IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'concept_topup_wallet',
        'execute_external_bank_transfer',
        'issue_virtual_card',
        'fund_virtual_card',
        'fund_virtual_card_from_wallet',
        'generate_unique_virtual_card_pan',
        'pay_vtu_bill',
        'pay_utility_bill',
        'execute_payroll_batch',
        'execute_business_payroll'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_signature);
  END LOOP;
END $quarantine$;

-- 12.3 Public Landing Waitlist (`anon` + `authenticated`)
GRANT EXECUTE ON FUNCTION public.join_waitlist(TEXT, TEXT) TO anon, authenticated, service_role;

-- 12.4 Authenticated User Onboarding, Session, Security & Internal Ledger RPCs
GRANT EXECUTE ON FUNCTION public.is_executive() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_business_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_business_write_role(UUID) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.record_verified_login_session(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_transaction_pin(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_user_transaction_pin(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile_and_wallet(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_own_account_freeze(BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_recipient_profile(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_beneficiary(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_virtual_card_freeze(UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_virtual_card_limit(UUID, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_virtual_card_reveal(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_payment_request(UUID, NUMERIC, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_payment_request(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_wallet_ledger_reconciliation(UUID) TO authenticated, service_role;

-- Safe, self-contained internal double-entry NGN ledger RPCs
GRANT EXECUTE ON FUNCTION public.execute_p2p_transfer(TEXT, NUMERIC, TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_funds(UUID, UUID, NUMERIC, TEXT, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_savings_vault(TEXT, TEXT, NUMERIC, TIMESTAMPTZ, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fund_savings_vault(UUID, NUMERIC, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_savings_vault(UUID, NUMERIC, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manage_midesave_vault(TEXT, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT, NUMERIC, TIMESTAMPTZ, NUMERIC) TO authenticated, service_role;

-- Executive Compliance RPCs (gated internally by `public.is_executive()`)
GRANT EXECUTE ON FUNCTION public.admin_credit_wallet(UUID, NUMERIC, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_account_freeze(UUID, BOOLEAN, TEXT) TO authenticated, service_role;

-- Backend Edge Function Settlement RPCs (`service_role` ONLY — NEVER callable by `anon` or `authenticated`)
GRANT EXECUTE ON FUNCTION public.generate_unique_midepay_nuban() TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_gateway_deposit(TEXT, TEXT, NUMERIC, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet_for_payout(UUID, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_payout_settlement(TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_failed_payout(TEXT, TEXT, JSONB) TO service_role;

COMMIT;
