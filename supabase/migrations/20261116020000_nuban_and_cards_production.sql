-- ============================================================================
-- MidePay v4.3 — Cryptographic NUBAN Provisioning, Recipient NUBAN Lookup
--                & Persistent Per-User Virtual Debit Cards
-- Migration: 20261116020000_nuban_and_cards_production.sql
-- Target: PostgreSQL 15+ / Supabase (https://pxdzdehocjnmxbuvipxu.supabase.co)
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. CRYPTOGRAPHICALLY RANDOM, 100% UNIQUE 10-DIGIT NUBAN GENERATOR
-- ============================================================================
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

    -- Extract 32 bits of cryptographic entropy via pgcrypto gen_random_bytes(4)
    v_bytes := gen_random_bytes(4);
    v_rand_uint := (
      (get_byte(v_bytes, 0)::BIGINT << 24) |
      (get_byte(v_bytes, 1)::BIGINT << 16) |
      (get_byte(v_bytes, 2)::BIGINT << 8)  |
      (get_byte(v_bytes, 3)::BIGINT)
    );

    -- Prefix '90' + 8 unbiased random digits (00000000 - 99999999)
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

REVOKE ALL ON FUNCTION public.generate_unique_midepay_nuban() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_unique_midepay_nuban() TO authenticated, service_role;

-- Update default bank_name on public.wallets to 'MidePay / Providus Bank'
ALTER TABLE public.wallets ALTER COLUMN bank_name SET DEFAULT 'MidePay / Providus Bank';

-- Backfill any existing wallet rows missing a 10-digit NUBAN
UPDATE public.wallets
SET nuban = public.generate_unique_midepay_nuban(),
    updated_at = TIMEZONE('utc', NOW())
WHERE nuban IS NULL OR nuban !~ '^[0-9]{10}$';

-- ============================================================================
-- 2. PERSISTENT PER-USER VIRTUAL DEBIT CARDS SCHEMA & CRYPTOGRAPHIC GENERATOR
-- ============================================================================
ALTER TABLE public.virtual_cards
  ADD COLUMN IF NOT EXISTS card_number VARCHAR(19),
  ADD COLUMN IF NOT EXISTS cvv VARCHAR(4),
  ADD COLUMN IF NOT EXISTS card_label TEXT NOT NULL DEFAULT 'MidePay Virtual Card',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_cards_card_number_unique
  ON public.virtual_cards (REPLACE(card_number, ' ', ''))
  WHERE card_number IS NOT NULL;

-- Enforce strict owner-only RLS (auth.uid() = user_id) on public.virtual_cards
ALTER TABLE public.virtual_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own virtual cards" ON public.virtual_cards;
DROP POLICY IF EXISTS "Users can manage own virtual cards" ON public.virtual_cards;
DROP POLICY IF EXISTS "Users can insert own virtual cards" ON public.virtual_cards;
DROP POLICY IF EXISTS "Users can update own virtual cards" ON public.virtual_cards;
DROP POLICY IF EXISTS "Users can delete own virtual cards" ON public.virtual_cards;

CREATE POLICY "Users can view own virtual cards"
  ON public.virtual_cards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own virtual cards"
  ON public.virtual_cards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own virtual cards"
  ON public.virtual_cards FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own virtual cards"
  ON public.virtual_cards FOR DELETE
  USING (auth.uid() = user_id);

-- Cryptographic 16-Digit Luhn-Valid Card PAN Generator (5399 XXXX XXXX XXXX)
CREATE OR REPLACE FUNCTION public.generate_unique_virtual_card_pan(p_prefix TEXT DEFAULT '5399')
RETURNS VARCHAR(19)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean_prefix TEXT := COALESCE(NULLIF(regexp_replace(p_prefix, '[^0-9]', '', 'g'), ''), '5399');
  v_bytes BYTEA;
  v_body TEXT;
  v_digits15 TEXT;
  v_sum INT;
  v_digit INT;
  v_idx INT;
  v_check_digit INT;
  v_raw16 TEXT;
  v_formatted VARCHAR(19);
  v_attempts INT := 0;
BEGIN
  v_clean_prefix := LEFT(LPAD(v_clean_prefix, 4, '5'), 4);

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

    -- Compute ISO/IEC 7812 Luhn check digit for 16th digit
    v_sum := 0;
    FOR v_idx IN 1..15 LOOP
      v_digit := SUBSTRING(v_digits15 FROM v_idx FOR 1)::INT;
      IF (v_idx % 2) = 1 THEN
        v_digit := v_digit * 2;
        IF v_digit > 9 THEN
          v_digit := v_digit - 9;
        END IF;
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

  v_formatted := SUBSTRING(v_raw16 FROM 1 FOR 4) || ' ' ||
                 SUBSTRING(v_raw16 FROM 5 FOR 4) || ' ' ||
                 SUBSTRING(v_raw16 FROM 9 FOR 4) || ' ' ||
                 SUBSTRING(v_raw16 FROM 13 FOR 4);
  RETURN v_formatted;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_unique_virtual_card_pan(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_unique_virtual_card_pan(TEXT) TO authenticated, service_role;

-- ============================================================================
-- 3. AUTOMATIC NEW USER PROVISIONING TRIGGER ON `auth.users`
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_provisioning()
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
  v_exp_date DATE := (CURRENT_DATE + INTERVAL '3 years')::DATE;
  v_exp_month INT := EXTRACT(MONTH FROM v_exp_date)::INT;
  v_exp_year INT := EXTRACT(YEAR FROM v_exp_date)::INT;
  v_pan_usd VARCHAR(19);
  v_pan_ngn VARCHAR(19);
  v_cvv_bytes BYTEA;
  v_cvv_usd VARCHAR(4);
  v_cvv_ngn VARCHAR(4);
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

  -- 1. Provision Profile (CBN KYC Tier 2 default on verified email registration)
  INSERT INTO public.profiles (
    id, full_name, email, phone, tag, kyc_tier, role, is_frozen
  ) VALUES (
    NEW.id,
    v_full_name,
    NEW.email,
    v_phone,
    v_tag,
    2,
    'user',
    FALSE
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      phone = COALESCE(public.profiles.phone, EXCLUDED.phone),
      tag = COALESCE(public.profiles.tag, EXCLUDED.tag),
      kyc_tier = GREATEST(public.profiles.kyc_tier, 2),
      updated_at = TIMEZONE('utc', NOW());

  -- 2. Provision NGN Wallet with 100% unique CSPRNG 10-digit NUBAN
  v_nuban := public.generate_unique_midepay_nuban();

  INSERT INTO public.wallets (
    user_id, currency, balance, ledger_balance, nuban, bank_name
  ) VALUES (
    NEW.id,
    'NGN',
    0.00,
    0.00,
    v_nuban,
    'MidePay / Providus Bank'
  )
  ON CONFLICT (user_id, currency) DO UPDATE
  SET nuban = COALESCE(public.wallets.nuban, EXCLUDED.nuban),
      updated_at = TIMEZONE('utc', NOW())
  RETURNING id INTO v_wallet_id;

  -- 3. Provision Persistent Starter USD & NGN Virtual Debit Cards (5399 prefix)
  IF NOT EXISTS (SELECT 1 FROM public.virtual_cards vc WHERE vc.user_id = NEW.id) THEN
    v_pan_usd := public.generate_unique_virtual_card_pan('5399');
    v_pan_ngn := public.generate_unique_virtual_card_pan('5399');
    v_cvv_bytes := gen_random_bytes(4);
    v_cvv_usd := LPAD((100 + (((get_byte(v_cvv_bytes, 0) << 8) | get_byte(v_cvv_bytes, 1)) % 900))::TEXT, 3, '0');
    v_cvv_ngn := LPAD((100 + (((get_byte(v_cvv_bytes, 2) << 8) | get_byte(v_cvv_bytes, 3)) % 900))::TEXT, 3, '0');

    INSERT INTO public.virtual_cards (
      user_id, wallet_id, card_type, currency, card_label, card_holder_name,
      card_number, masked_pan, cvv, expiry_month, expiry_year,
      card_balance, spending_limit_monthly, is_frozen, is_active
    ) VALUES
    (
      NEW.id,
      v_wallet_id,
      'Mastercard',
      'USD',
      'MidePay Black',
      UPPER(v_full_name),
      v_pan_usd,
      LEFT(v_pan_usd, 4) || ' •••• •••• ' || RIGHT(v_pan_usd, 4),
      v_cvv_usd,
      v_exp_month,
      v_exp_year,
      0.00,
      1000.00,
      FALSE,
      TRUE
    ),
    (
      NEW.id,
      v_wallet_id,
      'Verve',
      'NGN',
      'MidePay Green',
      UPPER(v_full_name),
      v_pan_ngn,
      LEFT(v_pan_ngn, 4) || ' •••• •••• ' || RIGHT(v_pan_ngn, 4),
      v_cvv_ngn,
      v_exp_month,
      v_exp_year,
      0.00,
      500000.00,
      FALSE,
      TRUE
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_provisioning ON auth.users;
CREATE TRIGGER on_auth_user_provisioning
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_provisioning();

-- ============================================================================
-- 4. REAL-TIME ACCOUNT NAME ENQUIRY RPC (10-DIGIT NUBAN + @TAG + EMAIL + PHONE)
-- ============================================================================
DROP FUNCTION IF EXISTS public.lookup_recipient_profile(TEXT);

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
SET search_path = public
AS $$
DECLARE
  v_raw TEXT := TRIM(COALESCE(search_query, ''));
  v_digits TEXT := REGEXP_REPLACE(v_raw, '[^0-9]', '', 'g');
  v_norm_tag TEXT;
BEGIN
  IF auth.uid() IS NULL OR v_raw = '' THEN
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
    p.email,
    p.phone,
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
      -- 1. Exact 10-digit MidePay NUBAN Account Number Match
      (LENGTH(v_digits) = 10 AND w.nuban = v_digits)
      -- 2. Exact Email Match
      OR LOWER(p.email) = LOWER(v_raw)
      -- 3. Exact @tag Match (with or without leading '@')
      OR LOWER(p.tag) = LOWER(v_raw)
      OR (POSITION('@' IN v_raw) <= 1 AND LOWER(p.tag) = v_norm_tag)
      -- 4. Nigerian Phone Number Match (exact digits or trailing 10 digits e.g. 0803... vs +234803...)
      OR (
        LENGTH(v_digits) >= 10
        AND LENGTH(REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g')) >= 10
        AND RIGHT(REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g'), 10) = RIGHT(v_digits, 10)
      )
    )
  ORDER BY
    CASE WHEN LENGTH(v_digits) = 10 AND w.nuban = v_digits THEN 0 ELSE 1 END
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_recipient_profile(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_recipient_profile(TEXT) TO authenticated;

COMMIT;

