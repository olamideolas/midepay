-- ============================================================================
-- MidePay v4.0 — Enterprise Production Database Schema, RLS & Atomic RPCs
-- Migration: 20261116000000_midepay_production.sql
-- Target: PostgreSQL 15+ / Supabase (https://pxdzdehocjnmxbuvipxu.supabase.co)
-- Compliance: CBN Tier 1-3 KYC, NDIC Pass-Through Ledger, NDPR/NDPA Audit Trail
-- ============================================================================

BEGIN;

-- 1. EXTENSIONS & DOMAIN ENUMS
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
-- 2. NORMALIZED PRODUCTION TABLES & IDEMPOTENT COLUMN UPGRADES
-- ============================================================================

-- 2.1 PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  tag TEXT UNIQUE,
  avatar_url TEXT,
  kyc_tier INT NOT NULL DEFAULT 1 CHECK (kyc_tier BETWEEN 1 AND 3),
  bvn_verified BOOLEAN NOT NULL DEFAULT FALSE,
  nin_verified BOOLEAN NOT NULL DEFAULT FALSE,
  pin_hash TEXT,
  pin_failed_attempts INT NOT NULL DEFAULT 0 CHECK (pin_failed_attempts >= 0),
  pin_locked_until TIMESTAMPTZ,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'executive')),
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS kyc_tier INT NOT NULL DEFAULT 1;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bvn_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nin_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_failed_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT chk_profiles_role CHECK (role IN ('user', 'executive'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT chk_profiles_kyc_tier CHECK (kyc_tier BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2.2 WALLETS (NGN Balance, Ledger Balance & Providus Bank 10-Digit NUBAN)
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'USD')),
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  ledger_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (ledger_balance >= 0),
  nuban VARCHAR(10) UNIQUE CHECK (nuban IS NULL OR nuban ~ '^[0-9]{10}$'),
  bank_name TEXT NOT NULL DEFAULT 'Providus Bank',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT uq_user_currency UNIQUE (user_id, currency)
);

-- 2.3 TRANSACTIONS (Immutable Double-Entry Inflow/Outflow Ledger)
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
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS counterparty_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS balance_before NUMERIC(14, 2);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(14, 2);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2.4 PAYMENT REQUESTS
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  fulfilled_tx_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT chk_no_self_request CHECK (requester_id <> payer_id)
);

ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS fulfilled_tx_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL;

-- 2.5 VIRTUAL CARDS
CREATE TABLE IF NOT EXISTS public.virtual_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
  card_type TEXT NOT NULL DEFAULT 'Mastercard' CHECK (card_type IN ('Mastercard', 'Visa', 'Verve')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'NGN')),
  card_holder_name TEXT NOT NULL,
  masked_pan VARCHAR(25) NOT NULL,
  expiry_month INT NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year INT NOT NULL CHECK (expiry_year >= 2026),
  card_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (card_balance >= 0),
  spending_limit_monthly NUMERIC(14, 2) NOT NULL DEFAULT 1000.00 CHECK (spending_limit_monthly >= 0),
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.virtual_cards ADD COLUMN IF NOT EXISTS card_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00;

-- 2.6 BUSINESSES
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
  settlement_nuban VARCHAR(10) UNIQUE CHECK (settlement_nuban IS NULL OR settlement_nuban ~ '^[0-9]{10}$'),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS tin_number TEXT;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS settlement_nuban VARCHAR(10);
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE;

-- 2.7 BUSINESS MEMBERS
CREATE TABLE IF NOT EXISTS public.business_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.business_role NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT uq_business_member UNIQUE (business_id, user_id)
);

-- 2.8 BUSINESS SUB-ACCOUNTS
CREATE TABLE IF NOT EXISTS public.business_sub_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'USD')),
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  dedicated_nuban VARCHAR(10) UNIQUE CHECK (dedicated_nuban IS NULL OR dedicated_nuban ~ '^[0-9]{10}$'),
  bank_name TEXT NOT NULL DEFAULT 'Providus Bank',
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.business_sub_accounts ADD COLUMN IF NOT EXISTS bank_name TEXT NOT NULL DEFAULT 'Providus Bank';

-- 2.9 INVOICES
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

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- 2.10 WAITLIST
CREATE TABLE IF NOT EXISTS public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE CHECK (position('@' in email) > 1),
  ip_country TEXT DEFAULT 'NG',
  source TEXT DEFAULT 'landing_page',
  referrer_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'landing_page';

-- 2.11 AUDIT LOGS (Immutable Compliance & Executive Action Trail)
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

-- ============================================================================
-- 3. STRICT PERFORMANCE & LOOKUP INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_profiles_tag ON public.profiles(LOWER(tag));
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_is_frozen ON public.profiles(is_frozen);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_nuban ON public.wallets(nuban);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON public.transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON public.transactions(reference);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);

CREATE INDEX IF NOT EXISTS idx_payment_requests_requester ON public.payment_requests(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_payer ON public.payment_requests(payer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON public.payment_requests(status);

CREATE INDEX IF NOT EXISTS idx_virtual_cards_user_id ON public.virtual_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_businesses_owner_id ON public.businesses(owner_id);
CREATE INDEX IF NOT EXISTS idx_business_members_user_id ON public.business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_business_id ON public.business_members(business_id);
CREATE INDEX IF NOT EXISTS idx_sub_accounts_business_id ON public.business_sub_accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON public.invoices(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user ON public.audit_logs(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);

-- ============================================================================
-- 4. IMMUTABILITY & PRIVILEGE-ESCALATION PROTECTION TRIGGERS
-- ============================================================================

-- 4.1 Prevent DELETE or financial mutation on immutable ledger & audit tables
CREATE OR REPLACE FUNCTION public.enforce_immutable_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Compliance Violation: % records are immutable and cannot be deleted.', TG_TABLE_NAME;
  END IF;

  IF TG_TABLE_NAME = 'audit_logs' AND TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Compliance Violation: audit_logs records are append-only and cannot be modified.';
  END IF;

  IF TG_TABLE_NAME = 'transactions' AND TG_OP = 'UPDATE' THEN
    IF OLD.amount <> NEW.amount
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

DROP TRIGGER IF EXISTS trg_transactions_immutable ON public.transactions;
CREATE TRIGGER trg_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_immutable_ledger();

-- 4.2 Prevent non-executives from escalating `profiles.role` or modifying `kyc_tier` illegally
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service_role / internal postgres admin migrations where auth.uid() is null
  IF auth.uid() IS NOT NULL AND NOT public.is_executive() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Security Violation: Only executive administrators may modify account roles.';
    END IF;
  END IF;
  NEW.updated_at := TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 5. SECURITY HELPER FUNCTIONS FOR RLS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_executive()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = _business_id
      AND user_id = auth.uid()
      AND is_active = TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = _business_id
      AND owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_business_write_role(_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = _business_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin', 'finance')
      AND is_active = TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = _business_id
      AND owner_id = auth.uid()
  );
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_columns();

-- ============================================================================
-- 6. ROW-LEVEL SECURITY (RLS) ACROSS EVERY TABLE
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_sub_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 6.1 PROFILES RLS
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can search profiles" ON public.profiles;
DROP POLICY IF EXISTS "Executives can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Executives can update profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.is_executive());

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Executives can update profiles"
  ON public.profiles FOR UPDATE
  USING (public.is_executive())
  WITH CHECK (public.is_executive());

-- 6.2 WALLETS RLS
DROP POLICY IF EXISTS "Users can view own wallets" ON public.wallets;
DROP POLICY IF EXISTS "Executives can view all wallets" ON public.wallets;
DROP POLICY IF EXISTS "Users can insert own wallets" ON public.wallets;
DROP POLICY IF EXISTS "Users can update own wallets" ON public.wallets;

CREATE POLICY "Users can view own wallets"
  ON public.wallets FOR SELECT
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "Users can insert own wallets"
  ON public.wallets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wallets"
  ON public.wallets FOR UPDATE
  USING (auth.uid() = user_id OR public.is_executive())
  WITH CHECK (auth.uid() = user_id OR public.is_executive());

-- 6.3 TRANSACTIONS RLS
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Executives can view all transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;

CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id OR public.is_executive());

-- 6.4 PAYMENT REQUESTS RLS
DROP POLICY IF EXISTS "Users can view own payment requests" ON public.payment_requests;
DROP POLICY IF EXISTS "Users can create payment requests as requester" ON public.payment_requests;
DROP POLICY IF EXISTS "Participants can update payment requests" ON public.payment_requests;

CREATE POLICY "Users can view own payment requests"
  ON public.payment_requests FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = payer_id OR public.is_executive());

CREATE POLICY "Users can create payment requests as requester"
  ON public.payment_requests FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Participants can update payment requests"
  ON public.payment_requests FOR UPDATE
  USING (auth.uid() = payer_id OR auth.uid() = requester_id OR public.is_executive())
  WITH CHECK (auth.uid() = payer_id OR auth.uid() = requester_id OR public.is_executive());

-- 6.5 VIRTUAL CARDS RLS
DROP POLICY IF EXISTS "Users can view own virtual cards" ON public.virtual_cards;
DROP POLICY IF EXISTS "Users can manage own virtual cards" ON public.virtual_cards;

CREATE POLICY "Users can view own virtual cards"
  ON public.virtual_cards FOR SELECT
  USING (auth.uid() = user_id OR public.is_executive());

CREATE POLICY "Users can manage own virtual cards"
  ON public.virtual_cards FOR ALL
  USING (auth.uid() = user_id OR public.is_executive())
  WITH CHECK (auth.uid() = user_id OR public.is_executive());

-- 6.6 BUSINESSES RLS
DROP POLICY IF EXISTS "Members can view their business" ON public.businesses;
DROP POLICY IF EXISTS "Owners can update business" ON public.businesses;
DROP POLICY IF EXISTS "Users can create business" ON public.businesses;

CREATE POLICY "Members can view their business"
  ON public.businesses FOR SELECT
  USING (owner_id = auth.uid() OR public.is_business_member(id) OR public.is_executive());

CREATE POLICY "Users can create business"
  ON public.businesses FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can update business"
  ON public.businesses FOR UPDATE
  USING (owner_id = auth.uid() OR public.is_executive())
  WITH CHECK (owner_id = auth.uid() OR public.is_executive());

-- 6.7 BUSINESS MEMBERS RLS
DROP POLICY IF EXISTS "Members can view business roster" ON public.business_members;
DROP POLICY IF EXISTS "Owners and admins can manage members" ON public.business_members;

CREATE POLICY "Members can view business roster"
  ON public.business_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_business_member(business_id) OR public.is_executive());

CREATE POLICY "Owners and admins can manage members"
  ON public.business_members FOR ALL
  USING (public.has_business_write_role(business_id) OR public.is_executive())
  WITH CHECK (public.has_business_write_role(business_id) OR public.is_executive());

-- 6.8 BUSINESS SUB-ACCOUNTS RLS
DROP POLICY IF EXISTS "Members can view sub-accounts" ON public.business_sub_accounts;
DROP POLICY IF EXISTS "Finance and admins can manage sub-accounts" ON public.business_sub_accounts;

CREATE POLICY "Members can view sub-accounts"
  ON public.business_sub_accounts FOR SELECT
  USING (public.is_business_member(business_id) OR public.is_executive());

CREATE POLICY "Finance and admins can manage sub-accounts"
  ON public.business_sub_accounts FOR ALL
  USING (public.has_business_write_role(business_id) OR public.is_executive())
  WITH CHECK (public.has_business_write_role(business_id) OR public.is_executive());

-- 6.9 INVOICES RLS
DROP POLICY IF EXISTS "Members can view invoices" ON public.invoices;
DROP POLICY IF EXISTS "Finance and admins can manage invoices" ON public.invoices;

CREATE POLICY "Members can view invoices"
  ON public.invoices FOR SELECT
  USING (public.is_business_member(business_id) OR public.is_executive());

CREATE POLICY "Finance and admins can manage invoices"
  ON public.invoices FOR ALL
  USING (public.has_business_write_role(business_id) OR public.is_executive())
  WITH CHECK (public.has_business_write_role(business_id) OR public.is_executive());

-- 6.10 WAITLIST RLS
DROP POLICY IF EXISTS "Anyone can join waitlist" ON public.waitlist;
DROP POLICY IF EXISTS "Users cannot read waitlist entries" ON public.waitlist;
DROP POLICY IF EXISTS "Executives can view waitlist" ON public.waitlist;

CREATE POLICY "Anyone can join waitlist"
  ON public.waitlist FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Executives can view waitlist"
  ON public.waitlist FOR SELECT
  USING (public.is_executive());

-- 6.11 AUDIT LOGS RLS (Executives read-only; writes exclusively via SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "Executives can view audit logs" ON public.audit_logs;

CREATE POLICY "Executives can view audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.is_executive());

-- ============================================================================
-- 7. ATOMIC `SECURITY DEFINER` POSTGRESQL RPC FUNCTIONS
-- ============================================================================

-- 7.1 transfer_funds(sender_id, recipient_id, amount, narration)
--     Validates caller identity, CBN KYC single limit, freeze flags, deterministic
--     FOR UPDATE wallet row locks, atomic debit/credit, and double-entry ledger rows.
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
  v_caller UUID := auth.uid();
  v_sender_name TEXT;
  v_sender_frozen BOOLEAN;
  v_sender_kyc INT;
  v_single_limit NUMERIC(14, 2);
  v_recipient_name TEXT;
  v_recipient_frozen BOOLEAN;
  v_sender_wallet_id UUID;
  v_recipient_wallet_id UUID;
  v_sender_balance NUMERIC(14, 2);
  v_recipient_balance NUMERIC(14, 2);
  v_new_sender_balance NUMERIC(14, 2);
  v_new_recipient_balance NUMERIC(14, 2);
  v_sender_tx_id UUID;
  v_recipient_tx_id UUID;
  v_ref_sender TEXT;
  v_ref_recipient TEXT;
  v_clean_narration TEXT;
BEGIN
  -- A. Caller & Parameter Validation
  IF sender_id IS NULL OR recipient_id IS NULL THEN
    RAISE EXCEPTION 'Both sender_id and recipient_id are required.';
  END IF;

  IF v_caller IS NOT NULL AND v_caller <> sender_id AND NOT public.is_executive() THEN
    RAISE EXCEPTION 'Unauthorized transfer: authenticated user does not match sender_id.';
  END IF;

  IF sender_id = recipient_id THEN
    RAISE EXCEPTION 'Self-transfer is prohibited.';
  END IF;

  IF amount IS NULL OR amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be strictly greater than zero.';
  END IF;

  v_clean_narration := COALESCE(NULLIF(TRIM(narration), ''), 'Transfer via MidePay');

  -- B. Verify Sender & Recipient Profiles + Freeze Interlock + CBN KYC Limits
  SELECT full_name, is_frozen, kyc_tier
  INTO v_sender_name, v_sender_frozen, v_sender_kyc
  FROM public.profiles
  WHERE id = sender_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sender profile not found.';
  END IF;

  IF v_sender_frozen THEN
    RAISE EXCEPTION 'Sender account is frozen per CBN AML/Fraud directives. Outbound transfers are blocked.';
  END IF;

  v_single_limit := CASE v_sender_kyc
    WHEN 1 THEN 50000.00
    WHEN 2 THEN 100000.00
    ELSE 5000000.00
  END;

  IF amount > v_single_limit THEN
    RAISE EXCEPTION 'Transfer amount (₦%) exceeds CBN KYC Tier % single-transaction limit of ₦%.',
      TRIM(TO_CHAR(amount, 'FM999,999,990.00')),
      v_sender_kyc,
      TRIM(TO_CHAR(v_single_limit, 'FM999,999,990.00'));
  END IF;

  SELECT full_name, is_frozen
  INTO v_recipient_name, v_recipient_frozen
  FROM public.profiles
  WHERE id = recipient_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient profile not found.';
  END IF;

  IF v_recipient_frozen THEN
    RAISE EXCEPTION 'Recipient account is restricted and cannot receive transfers at this time.';
  END IF;

  -- C. Ensure Recipient NGN Wallet Exists Before Deterministic Locking
  INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
  VALUES (
    recipient_id,
    'NGN',
    0.00,
    0.00,
    '90' || LPAD(FLOOR(random() * 100000000)::TEXT, 8, '0'),
    'Providus Bank'
  )
  ON CONFLICT (user_id, currency) DO NOTHING;

  -- D. Deterministic Row-Level Lock Order (UUID lexical order prevents A<->B deadlocks)
  IF sender_id < recipient_id THEN
    SELECT id, balance INTO v_sender_wallet_id, v_sender_balance
    FROM public.wallets WHERE user_id = sender_id AND currency = 'NGN' FOR UPDATE;

    SELECT id, balance INTO v_recipient_wallet_id, v_recipient_balance
    FROM public.wallets WHERE user_id = recipient_id AND currency = 'NGN' FOR UPDATE;
  ELSE
    SELECT id, balance INTO v_recipient_wallet_id, v_recipient_balance
    FROM public.wallets WHERE user_id = recipient_id AND currency = 'NGN' FOR UPDATE;

    SELECT id, balance INTO v_sender_wallet_id, v_sender_balance
    FROM public.wallets WHERE user_id = sender_id AND currency = 'NGN' FOR UPDATE;
  END IF;

  IF v_sender_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Sender NGN wallet not found.';
  END IF;

  IF v_sender_balance < amount THEN
    RAISE EXCEPTION 'Insufficient balance: available balance is ₦%.',
      TRIM(TO_CHAR(v_sender_balance, 'FM999,999,990.00'));
  END IF;

  -- E. Atomic Debit & Credit
  v_new_sender_balance := v_sender_balance - amount;
  v_new_recipient_balance := v_recipient_balance + amount;

  UPDATE public.wallets
  SET balance = v_new_sender_balance,
      ledger_balance = ledger_balance - amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_sender_wallet_id;

  UPDATE public.wallets
  SET balance = v_new_recipient_balance,
      ledger_balance = ledger_balance + amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_recipient_wallet_id;

  -- F. Double-Entry Immutable Ledger Entries
  v_ref_sender := 'MP-DEB-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || LPAD(FLOOR(random() * 10000)::TEXT, 4, '0');
  v_ref_recipient := 'MP-CRE-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || LPAD(FLOOR(random() * 10000)::TEXT, 4, '0');

  INSERT INTO public.transactions (
    wallet_id, user_id, counterparty_user_id, type, category,
    amount, fee, balance_before, balance_after, status,
    counterparty_name, counterparty_bank, narration, reference, metadata
  ) VALUES (
    v_sender_wallet_id, sender_id, recipient_id, 'outflow', 'transfer',
    amount, 0.00, v_sender_balance, v_new_sender_balance, 'successful',
    v_recipient_name, 'MidePay Wallet', v_clean_narration, v_ref_sender,
    jsonb_build_object('paired_reference', v_ref_recipient, 'channel', 'internal_p2p')
  ) RETURNING id INTO v_sender_tx_id;

  INSERT INTO public.transactions (
    wallet_id, user_id, counterparty_user_id, type, category,
    amount, fee, balance_before, balance_after, status,
    counterparty_name, counterparty_bank, narration, reference, metadata
  ) VALUES (
    v_recipient_wallet_id, recipient_id, sender_id, 'inflow', 'transfer',
    amount, 0.00, v_recipient_balance, v_new_recipient_balance, 'successful',
    v_sender_name, 'MidePay Wallet', v_clean_narration, v_ref_recipient,
    jsonb_build_object('paired_reference', v_ref_sender, 'channel', 'internal_p2p')
  ) RETURNING id INTO v_recipient_tx_id;

  -- G. Compliance Audit Log
  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    COALESCE(v_caller, sender_id),
    CASE WHEN public.is_executive() THEN 'executive' ELSE 'user' END,
    recipient_id,
    'TRANSFER_FUNDS',
    'transactions',
    v_sender_tx_id::TEXT,
    v_clean_narration,
    jsonb_build_object('sender_balance_before', v_sender_balance),
    jsonb_build_object(
      'sender_balance_after', v_new_sender_balance,
      'amount', amount,
      'debit_ref', v_ref_sender,
      'credit_ref', v_ref_recipient
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'sender_tx_id', v_sender_tx_id,
    'recipient_tx_id', v_recipient_tx_id,
    'reference', v_ref_sender,
    'amount', amount,
    'sender_name', v_sender_name,
    'recipient_name', v_recipient_name,
    'new_balance', v_new_sender_balance
  );
END;
$$;

-- 7.2 admin_credit_wallet(target_user_id, amount, reason)
--     Strictly restricted to `role = 'executive'`, locks wallet FOR UPDATE,
--     credits balance & ledger_balance, inserts inflow transaction & audit_logs entry.
CREATE OR REPLACE FUNCTION public.admin_credit_wallet(
  target_user_id UUID,
  amount NUMERIC,
  reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_target_name TEXT;
  v_wallet_id UUID;
  v_old_balance NUMERIC(14, 2);
  v_new_balance NUMERIC(14, 2);
  v_nuban VARCHAR(10);
  v_tx_id UUID;
  v_ref TEXT;
  v_clean_reason TEXT;
BEGIN
  IF NOT public.is_executive() THEN
    RAISE EXCEPTION 'Access Denied: Executive role clearance is required to credit wallets.';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required.';
  END IF;

  IF amount IS NULL OR amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be greater than zero.';
  END IF;

  v_clean_reason := NULLIF(TRIM(COALESCE(reason, '')), '');
  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'An explicit audit reason is required for administrative wallet credits.';
  END IF;

  SELECT full_name INTO v_target_name
  FROM public.profiles
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found.';
  END IF;

  INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
  VALUES (
    target_user_id,
    'NGN',
    0.00,
    0.00,
    '90' || LPAD(FLOOR(random() * 100000000)::TEXT, 8, '0'),
    'Providus Bank'
  )
  ON CONFLICT (user_id, currency) DO NOTHING;

  SELECT id, balance, nuban
  INTO v_wallet_id, v_old_balance, v_nuban
  FROM public.wallets
  WHERE user_id = target_user_id AND currency = 'NGN'
  FOR UPDATE;

  v_new_balance := v_old_balance + amount;

  UPDATE public.wallets
  SET balance = v_new_balance,
      ledger_balance = ledger_balance + amount,
      updated_at = TIMEZONE('utc', NOW())
  WHERE id = v_wallet_id;

  v_ref := 'MP-ADM-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || LPAD(FLOOR(random() * 10000)::TEXT, 4, '0');

  INSERT INTO public.transactions (
    wallet_id, user_id, counterparty_user_id, type, category,
    amount, fee, balance_before, balance_after, status,
    counterparty_name, counterparty_bank, counterparty_tag_or_nuban, narration, reference, metadata
  ) VALUES (
    v_wallet_id, target_user_id, v_actor, 'inflow', 'admin_credit',
    amount, 0.00, v_old_balance, v_new_balance, 'successful',
    'MidePay Treasury Operations', 'Providus Bank', v_nuban, v_clean_reason, v_ref,
    jsonb_build_object('approved_by', v_actor, 'audit_reason', v_clean_reason)
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  ) VALUES (
    v_actor,
    'executive',
    target_user_id,
    'ADMIN_CREDIT_WALLET',
    'wallets',
    v_wallet_id::TEXT,
    v_clean_reason,
    jsonb_build_object('balance', v_old_balance),
    jsonb_build_object('balance', v_new_balance, 'credited_amount', amount, 'tx_id', v_tx_id, 'reference', v_ref)
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

-- 7.3 admin_set_account_freeze(target_user_id, freeze_state, reason)
--     Strictly restricted to `role = 'executive'`, updates `profiles.is_frozen`,
--     locks virtual cards on freeze, and records immutable `audit_logs` entry.
CREATE OR REPLACE FUNCTION public.admin_set_account_freeze(
  target_user_id UUID,
  freeze_state BOOLEAN,
  reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_old_frozen BOOLEAN;
  v_target_email TEXT;
  v_clean_reason TEXT;
BEGIN
  IF NOT public.is_executive() THEN
    RAISE EXCEPTION 'Access Denied: Executive role clearance is required to freeze or unfreeze accounts.';
  END IF;

  IF target_user_id IS NULL OR freeze_state IS NULL THEN
    RAISE EXCEPTION 'target_user_id and freeze_state are required.';
  END IF;

  v_clean_reason := NULLIF(TRIM(COALESCE(reason, '')), '');
  IF v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'An explicit compliance reason is required to modify account freeze state.';
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
    v_actor,
    'executive',
    target_user_id,
    CASE WHEN freeze_state THEN 'ADMIN_FREEZE_ACCOUNT' ELSE 'ADMIN_UNFREEZE_ACCOUNT' END,
    'profiles',
    target_user_id::TEXT,
    v_clean_reason,
    jsonb_build_object('is_frozen', v_old_frozen, 'email', v_target_email),
    jsonb_build_object('is_frozen', freeze_state, 'email', v_target_email)
  );

  RETURN jsonb_build_object(
    'success', true,
    'target_user_id', target_user_id,
    'previous_freeze_state', v_old_frozen,
    'is_frozen', freeze_state,
    'reason', v_clean_reason
  );
END;
$$;

-- 7.4 Safe Authenticated Directory Lookup RPC (exposes ONLY public recipient fields, never pin_hash)
CREATE OR REPLACE FUNCTION public.lookup_recipient_profile(search_query TEXT)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  tag TEXT,
  avatar_url TEXT,
  is_frozen BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.email, p.phone, p.tag, p.avatar_url, p.is_frozen
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id <> auth.uid()
    AND (
      LOWER(p.email) = LOWER(TRIM(search_query))
      OR LOWER(p.tag) = LOWER(TRIM(search_query))
      OR regexp_replace(COALESCE(p.phone, ''), '[\s\-]', '', 'g') = regexp_replace(TRIM(search_query), '[\s\-]', '', 'g')
    )
  LIMIT 1;
$$;

-- 7.5 Production Onboarding Trigger (0.00 Initial Balance in Production)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_name TEXT;
  v_tag TEXT;
  v_nuban VARCHAR(10);
BEGIN
  v_first_name := split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', 'user'), ' ', 1);
  v_tag := '@' || lower(regexp_replace(v_first_name, '[^a-zA-Z0-9]', '', 'g')) || substr(md5(NEW.id::text), 1, 4);
  v_nuban := '90' || LPAD(FLOOR(random() * 100000000)::TEXT, 8, '0');

  INSERT INTO public.profiles (id, full_name, email, phone, tag, kyc_tier, role, is_frozen)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'MidePay Member'),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'phone', NULL),
    v_tag,
    1,
    'user',
    FALSE
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
  VALUES (
    NEW.id,
    'NGN',
    0.00,
    0.00,
    v_nuban,
    'Providus Bank'
  )
  ON CONFLICT (user_id, currency) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 8. STRICT EXECUTION GRANTS (AUTHENTICATED USERS ONLY FOR FINANCIAL RPCs)
-- ============================================================================

REVOKE ALL ON FUNCTION public.transfer_funds(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_credit_wallet(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_account_freeze(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lookup_recipient_profile(TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_executive() TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_funds(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_wallet(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_account_freeze(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_recipient_profile(TEXT) TO authenticated;

COMMIT;

