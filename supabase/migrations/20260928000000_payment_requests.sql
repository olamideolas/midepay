-- ============================================================================
-- MidePay: Payment Requests (Request Money) Feature Migration
-- Migration: 20260928000000_payment_requests.sql
-- Description:
-- 1. Creates payment_requests table with foreign keys to profiles.
-- 2. Enforces status constraint ('pending', 'approved', 'declined').
-- 3. Enables RLS: users can only see requests where they are requester or payer.
-- 4. Enables authenticated users to create requests (as requester) and update
--    requests (payer approves/declines, requester can cancel).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT chk_no_self_request CHECK (requester_id <> payer_id)
);

-- Performance indices
CREATE INDEX IF NOT EXISTS idx_payment_requests_requester ON public.payment_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_payer ON public.payment_requests(payer_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON public.payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at ON public.payment_requests(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- 1. SELECT policy: Users can only see requests where they are either requester_id or payer_id
DROP POLICY IF EXISTS "Users can view own payment requests" ON public.payment_requests;
CREATE POLICY "Users can view own payment requests"
  ON public.payment_requests FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = payer_id);

-- 2. INSERT policy: Authenticated users can insert requests where they are the requester
DROP POLICY IF EXISTS "Users can create payment requests as requester" ON public.payment_requests;
CREATE POLICY "Users can create payment requests as requester"
  ON public.payment_requests FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

-- 3. UPDATE policy: Payer can approve or decline; Requester can update/cancel
DROP POLICY IF EXISTS "Participants can update payment requests" ON public.payment_requests;
CREATE POLICY "Participants can update payment requests"
  ON public.payment_requests FOR UPDATE
  USING (auth.uid() = payer_id OR auth.uid() = requester_id)
  WITH CHECK (auth.uid() = payer_id OR auth.uid() = requester_id);

-- 4. Realtime publication (safe if enabled)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_requests;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
