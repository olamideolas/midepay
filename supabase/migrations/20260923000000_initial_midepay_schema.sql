-- ============================================================================
-- MidePay: Modern Nigerian Fintech Digital Wallet Schema & RLS Policies
-- Target Database: PostgreSQL 15+ / Supabase
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ENUMS & DOMAIN TYPES
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE public.tx_type AS ENUM ('inflow', 'outflow');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.tx_status AS ENUM ('pending', 'successful', 'failed', 'reversed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.business_role AS ENUM ('owner', 'admin', 'finance', 'viewer');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 2. PERSONAL TABLES (LINKED TO auth.uid() -> user_id)
-- ============================================================================

-- PROFILES: Extends Supabase auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  tag TEXT UNIQUE, -- e.g. @babatunde
  avatar_url TEXT,
  kyc_tier INT DEFAULT 1 CHECK (kyc_tier BETWEEN 1 AND 3),
  bvn_verified BOOLEAN DEFAULT FALSE,
  nin_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- WALLETS: Holds multi-currency balances and dedicated Nigerian NUBAN
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency TEXT DEFAULT 'NGN' NOT NULL,
  balance NUMERIC(14, 2) DEFAULT 0.00 NOT NULL CHECK (balance >= 0),
  ledger_balance NUMERIC(14, 2) DEFAULT 0.00 NOT NULL,
  nuban VARCHAR(10) UNIQUE, -- 10-digit Nigerian NUBAN
  bank_name TEXT DEFAULT 'Providus Bank' NOT NULL,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  CONSTRAINT uq_user_currency UNIQUE (user_id, currency)
);

-- TRANSACTIONS: Inflows and Outflows for personal accounts
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.tx_type NOT NULL,
  category TEXT DEFAULT 'transfer' NOT NULL, -- transfer, airtime, utilities, deposit, card
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  fee NUMERIC(14, 2) DEFAULT 0.00 NOT NULL,
  status public.tx_status DEFAULT 'successful' NOT NULL,
  counterparty_name TEXT NOT NULL,
  counterparty_bank TEXT,
  counterparty_tag_or_nuban TEXT,
  narration TEXT,
  reference TEXT UNIQUE NOT NULL, -- e.g. MP-20260923-XXXX
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- VIRTUAL CARDS: USD and NGN virtual cards
CREATE TABLE IF NOT EXISTS public.virtual_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
  card_type TEXT DEFAULT 'Mastercard' NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL CHECK (currency IN ('USD', 'NGN')),
  card_holder_name TEXT NOT NULL,
  masked_pan VARCHAR(19) NOT NULL, -- e.g. 5399 •••• •••• 4091
  expiry_month INT NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year INT NOT NULL CHECK (expiry_year >= 2026),
  spending_limit_monthly NUMERIC(14, 2) DEFAULT 1000.00 NOT NULL,
  is_frozen BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- SAVINGS VAULTS: Automated locked and target savings
CREATE TABLE IF NOT EXISTS public.savings_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target_amount NUMERIC(14, 2) NOT NULL CHECK (target_amount > 0),
  current_amount NUMERIC(14, 2) DEFAULT 0.00 NOT NULL CHECK (current_amount >= 0),
  interest_rate_pa NUMERIC(5, 2) DEFAULT 14.00 NOT NULL, -- 14% p.a. simulation
  maturity_date DATE,
  is_locked BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- WAITLIST: Early access leads from landing page
CREATE TABLE IF NOT EXISTS public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  ip_country TEXT DEFAULT 'NG',
  referrer_tag TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- ============================================================================
-- 3. BUSINESS & MERCHANT TABLES (LINKED VIA business_id)
-- ============================================================================

-- BUSINESSES: Merchant entities
CREATE TABLE IF NOT EXISTS public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_name TEXT NOT NULL,
  rc_number TEXT, -- CAC Registration number
  category TEXT DEFAULT 'Technology' NOT NULL,
  support_email TEXT,
  phone TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- BUSINESS MEMBERS (TEAM): Role-based team members
CREATE TABLE IF NOT EXISTS public.business_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.business_role DEFAULT 'viewer' NOT NULL,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  CONSTRAINT uq_business_member UNIQUE (business_id, user_id)
);

-- BUSINESS SUB-ACCOUNTS: Dedicated sub-wallets
CREATE TABLE IF NOT EXISTS public.business_sub_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  label TEXT NOT NULL, -- e.g. 'Payroll', 'Taxes', 'Inventory', 'Lagos Branch'
  currency TEXT DEFAULT 'NGN' NOT NULL,
  balance NUMERIC(14, 2) DEFAULT 0.00 NOT NULL CHECK (balance >= 0),
  dedicated_nuban VARCHAR(10) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- INVOICES: Merchant invoicing with VAT & WHT
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL, -- e.g. INV-2026-001
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal >= 0),
  vat_amount NUMERIC(14, 2) DEFAULT 0.00 NOT NULL CHECK (vat_amount >= 0),
  wht_amount NUMERIC(14, 2) DEFAULT 0.00 NOT NULL CHECK (wht_amount >= 0),
  total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),
  due_date DATE NOT NULL,
  status public.invoice_status DEFAULT 'sent' NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  CONSTRAINT uq_business_invoice_num UNIQUE (business_id, invoice_number)
);

-- PAYROLL RUNS: Batch payroll disbursement
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL, -- e.g. 'September 2026 Staff Salaries'
  total_recipients INT NOT NULL CHECK (total_recipients > 0),
  total_payout NUMERIC(14, 2) NOT NULL CHECK (total_payout > 0),
  status TEXT DEFAULT 'processed' NOT NULL, -- draft, scheduled, processed, failed
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- ============================================================================
-- 4. PERFORMANCE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON public.transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_virtual_cards_user_id ON public.virtual_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_savings_vaults_user_id ON public.savings_vaults(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_user_id ON public.business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_business_id ON public.business_members(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON public.invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_sub_accounts_business_id ON public.business_sub_accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_business_id ON public.payroll_runs(business_id);

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) HELPER FUNCTIONS
-- ============================================================================

-- Function: Check if auth.uid() is an active member of a business
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
  );
$$;

-- Function: Check if auth.uid() has write permissions in a business (owner, admin, or finance)
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
  );
$$;

-- ============================================================================
-- 6. ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_sub_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 7. RLS POLICIES: PERSONAL TABLES (auth.uid() = user_id / id)
-- ============================================================================

-- PROFILES
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- WALLETS
DROP POLICY IF EXISTS "Users can view own wallets" ON public.wallets;
CREATE POLICY "Users can view own wallets"
  ON public.wallets FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own wallets" ON public.wallets;
CREATE POLICY "Users can insert own wallets"
  ON public.wallets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own wallets" ON public.wallets;
CREATE POLICY "Users can update own wallets"
  ON public.wallets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- TRANSACTIONS
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- VIRTUAL CARDS
DROP POLICY IF EXISTS "Users can view own virtual cards" ON public.virtual_cards;
CREATE POLICY "Users can view own virtual cards"
  ON public.virtual_cards FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own virtual cards" ON public.virtual_cards;
CREATE POLICY "Users can manage own virtual cards"
  ON public.virtual_cards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- SAVINGS VAULTS
DROP POLICY IF EXISTS "Users can view own savings vaults" ON public.savings_vaults;
CREATE POLICY "Users can view own savings vaults"
  ON public.savings_vaults FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own savings vaults" ON public.savings_vaults;
CREATE POLICY "Users can manage own savings vaults"
  ON public.savings_vaults FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- WAITLIST (Public can insert, authenticated staff can view)
DROP POLICY IF EXISTS "Anyone can join waitlist" ON public.waitlist;
CREATE POLICY "Anyone can join waitlist"
  ON public.waitlist FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users cannot read waitlist entries" ON public.waitlist;
CREATE POLICY "Users cannot read waitlist entries"
  ON public.waitlist FOR SELECT
  USING (false);

-- ============================================================================
-- 8. RLS POLICIES: BUSINESS TABLES (LINKED VIA business_id)
-- ============================================================================

-- BUSINESSES
DROP POLICY IF EXISTS "Members can view their business" ON public.businesses;
CREATE POLICY "Members can view their business"
  ON public.businesses FOR SELECT
  USING (
    owner_id = auth.uid() OR public.is_business_member(id)
  );

DROP POLICY IF EXISTS "Owners can update business" ON public.businesses;
CREATE POLICY "Owners can update business"
  ON public.businesses FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can create business" ON public.businesses;
CREATE POLICY "Users can create business"
  ON public.businesses FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- BUSINESS MEMBERS
DROP POLICY IF EXISTS "Members can view business roster" ON public.business_members;
CREATE POLICY "Members can view business roster"
  ON public.business_members FOR SELECT
  USING (
    user_id = auth.uid() OR public.is_business_member(business_id)
  );

DROP POLICY IF EXISTS "Owners and admins can manage members" ON public.business_members;
CREATE POLICY "Owners and admins can manage members"
  ON public.business_members FOR ALL
  USING (public.has_business_write_role(business_id))
  WITH CHECK (public.has_business_write_role(business_id));

-- BUSINESS SUB-ACCOUNTS
DROP POLICY IF EXISTS "Members can view sub-accounts" ON public.business_sub_accounts;
CREATE POLICY "Members can view sub-accounts"
  ON public.business_sub_accounts FOR SELECT
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS "Finance and admins can manage sub-accounts" ON public.business_sub_accounts;
CREATE POLICY "Finance and admins can manage sub-accounts"
  ON public.business_sub_accounts FOR ALL
  USING (public.has_business_write_role(business_id))
  WITH CHECK (public.has_business_write_role(business_id));

-- INVOICES
DROP POLICY IF EXISTS "Members can view invoices" ON public.invoices;
CREATE POLICY "Members can view invoices"
  ON public.invoices FOR SELECT
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS "Finance and admins can manage invoices" ON public.invoices;
CREATE POLICY "Finance and admins can manage invoices"
  ON public.invoices FOR ALL
  USING (public.has_business_write_role(business_id))
  WITH CHECK (public.has_business_write_role(business_id));

-- PAYROLL RUNS
DROP POLICY IF EXISTS "Members can view payroll runs" ON public.payroll_runs;
CREATE POLICY "Members can view payroll runs"
  ON public.payroll_runs FOR SELECT
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS "Finance and admins can manage payroll runs" ON public.payroll_runs;
CREATE POLICY "Finance and admins can manage payroll runs"
  ON public.payroll_runs FOR ALL
  USING (public.has_business_write_role(business_id))
  WITH CHECK (public.has_business_write_role(business_id));

-- ============================================================================
-- 9. AUTOMATIC PROFILE & WALLET PROVISIONING TRIGGER (ON auth.users signup)
-- ============================================================================

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
  -- Derive tag from full_name or email
  v_first_name := split_part(COALESCE(new.raw_user_meta_data->>'full_name', 'user'), ' ', 1);
  v_tag := '@' || lower(regexp_replace(v_first_name, '[^a-zA-Z0-9]', '', 'g')) || substr(md5(random()::text), 1, 3);
  
  -- Generate 10-digit Nigerian NUBAN simulation starting with 90
  v_nuban := '90' || LPAD(FLOOR(random() * 100000000)::TEXT, 8, '0');

  -- 1. Insert Profile
  INSERT INTO public.profiles (id, full_name, email, phone, tag, kyc_tier)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', 'MidePay User'),
    new.email,
    COALESCE(new.raw_user_meta_data->>'phone', NULL),
    v_tag,
    2
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Insert Default NGN Wallet
  INSERT INTO public.wallets (user_id, currency, balance, ledger_balance, nuban, bank_name)
  VALUES (
    new.id,
    'NGN',
    250000.00, -- Initial demo starter balance (₦250,000.00)
    250000.00,
    v_nuban,
    'Providus Bank'
  )
  ON CONFLICT (user_id, currency) DO NOTHING;

  RETURN new;
END;
$$;

-- Trigger execution on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
