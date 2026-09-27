-- ============================================================================
-- MidePay: Executive Role & Row Level Security (RLS) Access Control
-- Migration: 20260927000000_executive_role_and_rls.sql
-- ============================================================================

-- 1. ADD ROLE COLUMN TO PROFILES TABLE
-- Default role is 'user'. Permitted values: 'user', 'executive'.
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' NOT NULL;

-- Ensure check constraint on role column
DO $$ BEGIN
  ALTER TABLE public.profiles 
  ADD CONSTRAINT chk_profiles_role CHECK (role IN ('user', 'executive'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create index for fast role lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- 2. SECURITY DEFINER HELPER FUNCTION TO CHECK IF AUTHENTICATED USER IS EXECUTIVE
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
  );
$$;

-- Grant execution permission to authenticated users
GRANT EXECUTE ON FUNCTION public.is_executive() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_executive() TO anon;

-- 3. ROW LEVEL SECURITY (RLS) POLICIES FOR EXECUTIVE ACCESS

-- (a) PROFILES: Regular users can view own; Executives can view all member profiles
DROP POLICY IF EXISTS "Executives can view all profiles" ON public.profiles;
CREATE POLICY "Executives can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_executive());

-- (b) WALLETS: Regular users can view own wallet; Executives can view all wallets
DROP POLICY IF EXISTS "Executives can view all wallets" ON public.wallets;
CREATE POLICY "Executives can view all wallets"
  ON public.wallets FOR SELECT
  USING (public.is_executive());

-- (c) TRANSACTIONS: Regular users can view own transactions; Executives can audit network ledger
DROP POLICY IF EXISTS "Executives can view all transactions" ON public.transactions;
CREATE POLICY "Executives can view all transactions"
  ON public.transactions FOR SELECT
  USING (public.is_executive());

-- (d) WAITLIST: Regular users cannot read waitlist; Executives can view leads
DROP POLICY IF EXISTS "Executives can view waitlist" ON public.waitlist;
CREATE POLICY "Executives can view waitlist"
  ON public.waitlist FOR SELECT
  USING (public.is_executive());
