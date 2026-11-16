-- ============================================================================
-- MidePay v4.6 — Email OTP Verification Gate, Mandatory PIN Lock & Login Audit
-- Migration: 20261116050000_auth_verification_gate.sql
--
-- Enforces:
-- 1. Strict Database Verification Guard across ALL financial RPCs:
--    - `(SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NOT NULL`
--    - `transaction_pin_hash IS NOT NULL` on `public.profiles`
--    verified BEFORE any wallet, card, vault, VTU bill, or payroll ledger movement.
-- 2. Canonical RPC entrypoints (`execute_p2p_transfer`, `fund_virtual_card`,
--    `pay_vtu_bill`, `manage_midesave_vault`, `execute_payroll_batch`) plus full
--    backward-compatible delegates (`fund_virtual_card_from_wallet`,
--    `pay_utility_bill`, `fund_savings_vault`, `withdraw_savings_vault`,
--    `execute_business_payroll`, `concept_topup_wallet`, `transfer_funds`,
--    `execute_external_bank_transfer`).
-- 3. Mandatory Post-OTP PIN Onboarding (`has_transaction_pin` status in
--    `ensure_my_profile_and_wallet`) & verified login audit logging
--    (`record_verified_login_session` -> `public.security_audit_logs`).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PROFILE LOGIN TELEMETRY COLUMNS & PIN HASH BACKFILL
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS transaction_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_device JSONB NOT NULL DEFAULT '{}'::JSONB;

UPDATE public.profiles
SET transaction_pin_hash = pin_hash
WHERE transaction_pin_hash IS NULL
  AND pin_hash IS NOT NULL;

-- ============================================================================
-- 2. CENTRAL AUTH EMAIL CONFIRMATION & MANDATORY PIN READINESS GATE
-- ============================================================================

CREATE OR REPLACE FUNCTION public._assert_verified_wallet_ready(
  p_user_id UUID,
  p_action TEXT DEFAULT 'FINANCIAL_MUTATION'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_email_confirmed_at TIMESTAMPTZ;
  v_tx_pin_hash TEXT;
  v_is_frozen BOOLEAN := FALSE;
BEGIN
  IF v_caller IS NULL OR p_user_id IS NULL OR v_caller <> p_user_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'UNAUTHORIZED',
      'error', 'Active authenticated session required.'
    );
  END IF;

  -- Gate 1: Strict Supabase Auth 6-Digit Email OTP Confirmation Check
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL THEN
    INSERT INTO public.security_audit_logs (
      user_id, event_type, severity, entity_type, entity_id, metadata
    ) VALUES (
      v_caller,
      'UNVERIFIED_EMAIL_BLOCKED',
      'warning',
      'auth.users',
      v_caller::TEXT,
      jsonb_build_object('action', p_action)
    );

    RETURN jsonb_build_object(
      'ok', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Email verification required. Enter the 6-digit OTP sent to your email before transacting.'
    );
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed_at
  FROM auth.users
  WHERE id = v_caller;

  -- Gate 2: Profile Existence, CBN Freeze Interlock & Mandatory `transaction_pin_hash IS NOT NULL`
  SELECT transaction_pin_hash, COALESCE(is_frozen, FALSE)
  INTO v_tx_pin_hash, v_is_frozen
  FROM public.profiles
  WHERE id = v_caller;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PROFILE_MISSING',
      'error', 'Account security profile not found.'
    );
  END IF;

  IF v_is_frozen IS TRUE THEN
    INSERT INTO public.security_audit_logs (
      user_id, event_type, severity, entity_type, entity_id, metadata
    ) VALUES (
      v_caller,
      'FROZEN_ACCOUNT_BLOCKED',
      'critical',
      'profiles',
      v_caller::TEXT,
      jsonb_build_object('action', p_action)
    );

    RETURN jsonb_build_object(
      'ok', false,
      'is_frozen', true,
      'code', 'ACCOUNT_FROZEN',
      'error', 'Account is currently frozen per CBN security directives. Outbound transactions are disabled.'
    );
  END IF;

  IF v_tx_pin_hash IS NULL OR NULLIF(TRIM(v_tx_pin_hash), '') IS NULL THEN
    INSERT INTO public.security_audit_logs (
      user_id, event_type, severity, entity_type, entity_id, metadata
    ) VALUES (
      v_caller,
      'MISSING_PIN_BLOCKED',
      'warning',
      'profiles',
      v_caller::TEXT,
      jsonb_build_object('action', p_action)
    );

    RETURN jsonb_build_object(
      'ok', false,
      'needs_pin_setup', true,
      'code', 'PIN_SETUP_REQUIRED',
      'error', 'Mandatory 4-digit Transaction PIN has not been created yet. Complete PIN setup to unlock your wallet.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'email_confirmed_at', v_email_confirmed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public._assert_verified_wallet_ready(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. HARDENED `pgcrypto` PIN VERIFIER (NO AUTO-INIT; REQUIRES VERIFIED EMAIL + PIN)
-- ============================================================================

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
  v_gate JSONB;
  v_profile public.profiles%ROWTYPE;
  v_clean_pin TEXT := TRIM(COALESCE(p_pin, ''));
  v_stored_hash TEXT;
  v_next_strikes INT;
  v_lock_until TIMESTAMPTZ;
BEGIN
  v_gate := public._assert_verified_wallet_ready(p_user_id, p_action);
  IF COALESCE((v_gate->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN v_gate;
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_profile.pin_locked_until IS NOT NULL AND v_profile.pin_locked_until > TIMEZONE('utc', NOW()) THEN
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

  IF v_clean_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_PIN_FORMAT',
      'error', 'Enter your 4-digit numeric Transaction PIN.'
    );
  END IF;

  v_stored_hash := v_profile.transaction_pin_hash;

  IF v_stored_hash IS NULL THEN
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
          updated_at = TIMEZONE('utc', NOW())
      WHERE id = p_user_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', 'VERIFIED');
  END IF;

  -- Failed PIN attempt -> increment strike counter & lock for 15 minutes at 5 strikes
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

-- ============================================================================
-- 4. PIN ONBOARDING, SESSION STATUS & LOGIN AUDIT RPCs
-- ============================================================================

-- 4.1 Set or Rotate 4-Digit Transaction PIN (requires verified email)
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

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL THEN
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

  SELECT transaction_pin_hash
  INTO v_existing_hash
  FROM public.profiles
  WHERE id = v_user_id;

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

  INSERT INTO public.security_audit_logs (
    user_id, event_type, severity, entity_type, entity_id, metadata
  ) VALUES (
    v_user_id,
    CASE WHEN v_existing_hash IS NULL THEN 'PIN_ONBOARDING_COMPLETED' ELSE 'PIN_ROTATED' END,
    'info',
    'profiles',
    v_user_id::TEXT,
    jsonb_build_object('is_initial_setup', (v_existing_hash IS NULL))
  );

  RETURN jsonb_build_object('success', true, 'has_transaction_pin', true);
END;
$$;

-- 4.2 Verify 4-Digit Transaction PIN
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

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'error', 'Verify your email address via 6-digit OTP before using your wallet.'
    );
  END IF;

  SELECT transaction_pin_hash
  INTO v_existing_hash
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_existing_hash IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'needs_pin_setup', true, 'code', 'PIN_SETUP_REQUIRED');
  END IF;

  v_res := public._verify_pin_and_audit(v_user_id, p_pin, 'VERIFY_PIN');
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

-- 4.3 Self-Healing Profile & Wallet Hydration with `email_confirmed` & `has_transaction_pin`
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
  v_email_confirmed_at TIMESTAMPTZ;
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
  v_has_pin BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT email, email_confirmed_at
  INTO v_auth_email, v_email_confirmed_at
  FROM auth.users
  WHERE id = v_user_id;

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

  v_has_pin := (v_profile.transaction_pin_hash IS NOT NULL AND NULLIF(TRIM(v_profile.transaction_pin_hash), '') IS NOT NULL);

  RETURN jsonb_build_object(
    'profile', (to_jsonb(v_profile) - 'pin_hash' - 'transaction_pin_hash') || jsonb_build_object('has_transaction_pin', v_has_pin),
    'wallet', to_jsonb(v_wallet),
    'email_confirmed', (v_email_confirmed_at IS NOT NULL),
    'email_confirmed_at', v_email_confirmed_at,
    'has_transaction_pin', v_has_pin
  );
END;
$$;

-- 4.4 Record Verified Login Timestamp & Device Metadata (`record_verified_login_session`)
CREATE OR REPLACE FUNCTION public.record_verified_login_session(
  p_device_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email_confirmed_at TIMESTAMPTZ;
  v_has_pin BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := TIMEZONE('utc', NOW());
  v_meta JSONB := COALESCE(p_device_metadata, '{}'::JSONB);
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  SELECT email_confirmed_at INTO v_email_confirmed_at
  FROM auth.users
  WHERE id = v_user_id;

  IF v_email_confirmed_at IS NULL THEN
    INSERT INTO public.security_audit_logs (
      user_id, event_type, severity, entity_type, entity_id, metadata
    ) VALUES (
      v_user_id, 'UNVERIFIED_LOGIN_BLOCKED', 'warning', 'auth.users', v_user_id::TEXT, v_meta
    );
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EMAIL_NOT_VERIFIED',
      'email_confirmed', false,
      'error', 'Email address is not yet verified.'
    );
  END IF;

  UPDATE public.profiles
  SET last_login_at = v_now,
      last_login_device = v_meta,
      updated_at = v_now
  WHERE id = v_user_id
  RETURNING (transaction_pin_hash IS NOT NULL AND NULLIF(TRIM(transaction_pin_hash), '') IS NOT NULL)
  INTO v_has_pin;

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

-- ============================================================================
-- 5. VERIFICATION-GATED ATOMIC FINANCIAL RPCs
--    Every RPC checks `(SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NOT NULL`
--    AND `transaction_pin_hash IS NOT NULL` BEFORE any ledger movement.
-- ============================================================================

-- 5.1 P2P NUBAN / MideTag Transfer (`execute_p2p_transfer`)
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
  v_gate JSONB;
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

  -- Explicit Auth Email Confirmation & Mandatory PIN Hash Guard BEFORE any ledger lookup/movement
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL THEN
    v_gate := public._assert_verified_wallet_ready(v_sender_id, 'P2P_TRANSFER');
    RETURN jsonb_build_object('success', false, 'status', 'EMAIL_NOT_VERIFIED', 'error', v_gate->>'error');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_sender_id AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_sender_id, 'P2P_TRANSFER');
    RETURN jsonb_build_object('success', false, 'status', 'PIN_SETUP_REQUIRED', 'error', v_gate->>'error');
  END IF;

  IF v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_amount', 'error', 'Transfer amount must be greater than ₦0.00.');
  END IF;

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

  v_pin_check := public._verify_pin_and_audit(v_sender_id, p_pin, 'P2P_TRANSFER');
  IF COALESCE((v_pin_check->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', COALESCE(v_pin_check->>'code', 'invalid_pin'),
      'error', COALESCE(v_pin_check->>'error', 'Invalid Transaction PIN.')
    );
  END IF;

  SELECT full_name INTO v_sender_name FROM public.profiles WHERE id = v_sender_id;

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
  LIMIT 1;

  IF v_recipient_wallet_id IS NULL OR v_recipient_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'recipient_not_found', 'error', 'Recipient NUBAN or @MideTag not found.');
  END IF;

  IF v_recipient_id = v_sender_id THEN
    RETURN jsonb_build_object('success', false, 'status', 'self_transfer', 'error', 'Cannot transfer funds to your own wallet.');
  END IF;

  IF v_recipient_frozen THEN
    RETURN jsonb_build_object('success', false, 'status', 'recipient_frozen', 'error', 'Recipient account cannot receive transfers right now.');
  END IF;

  SELECT id INTO v_sender_wallet_id
  FROM public.wallets
  WHERE user_id = v_sender_id AND currency = 'NGN'
  LIMIT 1;

  IF v_sender_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'wallet_missing', 'error', 'Sender NGN wallet not found.');
  END IF;

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

  v_new_sender_bal := ROUND(v_sender_wallet.balance - v_amt, 2);
  v_new_recipient_bal := ROUND(v_recipient_wallet.balance + v_amt, 2);
  v_ref_out := 'MDP-P2P-' || UPPER(ENCODE(gen_random_bytes(5), 'hex'));
  v_ref_in  := 'MDP-P2P-' || UPPER(ENCODE(gen_random_bytes(5), 'hex'));

  UPDATE public.wallets SET balance = v_new_sender_bal, ledger_balance = v_new_sender_bal, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_sender_wallet.id;
  UPDATE public.wallets SET balance = v_new_recipient_bal, ledger_balance = v_new_recipient_bal, updated_at = TIMEZONE('utc', NOW()) WHERE id = v_recipient_wallet.id;

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
    jsonb_build_object('paired_reference', v_ref_in, 'channel', 'nuban_p2p')
  ),
  (
    v_recipient_wallet.id, v_recipient_id, v_sender_id, 'inflow', 'transfer', v_amt, 0.00,
    v_recipient_wallet.balance, v_new_recipient_bal, 'successful',
    v_sender_name, 'MidePay / Providus Bank', v_sender_wallet.nuban,
    v_clean_narration, v_ref_in, gen_random_uuid(),
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

-- 5.2 UUID Transfer Wrapper (`transfer_funds`)
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
  v_gate JSONB;
  v_recipient_nuban VARCHAR(10);
BEGIN
  IF v_caller IS NULL OR sender_id IS NULL OR v_caller <> sender_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized transfer request.');
  END IF;

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_caller, 'P2P_TRANSFER');
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  SELECT nuban INTO v_recipient_nuban
  FROM public.wallets
  WHERE user_id = recipient_id AND currency = 'NGN'
  LIMIT 1;

  IF v_recipient_nuban IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Recipient NGN wallet not found.');
  END IF;

  RETURN public.execute_p2p_transfer(
    v_recipient_nuban,
    amount,
    p_pin,
    COALESCE(p_idempotency_key, gen_random_uuid()),
    narration
  );
END;
$$;

-- 5.3 External NIP Bank Transfer (`execute_external_bank_transfer`)
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
  v_gate JSONB;
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

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_user_id, 'EXTERNAL_BANK_TRANSFER');
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
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

  v_pin_res := public._verify_pin_and_audit(v_user_id, p_pin, 'EXTERNAL_BANK_TRANSFER');
  IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_pin_res->>'code', 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
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

-- 5.4 Direct Wallet Top-Up (`concept_topup_wallet`) — gated by verified email & mandatory PIN
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
  v_gate JSONB;
  v_wallet public.wallets%ROWTYPE;
  v_amt NUMERIC(14, 2) := ROUND(COALESCE(p_amount, 0), 2);
  v_ref TEXT := COALESCE(NULLIF(TRIM(p_reference), ''), 'MDP-DEP-' || UPPER(ENCODE(gen_random_bytes(5), 'hex')));
  v_before NUMERIC(14, 2);
  v_after NUMERIC(14, 2);
  v_existing_tx public.transactions%ROWTYPE;
  v_tx public.transactions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_user_id, 'WALLET_TOPUP');
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF v_amt < 100 OR v_amt > 5000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Top-up amount must be between ₦100.00 and ₦5,000,000.00.');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_tx FROM public.transactions WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = v_existing_tx.wallet_id;
      RETURN jsonb_build_object('success', true, 'status', 'duplicate', 'wallet', to_jsonb(v_wallet), 'transaction', to_jsonb(v_existing_tx), 'new_balance', v_existing_tx.balance_after, 'reference', v_existing_tx.reference);
    END IF;
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

-- 5.5 Virtual Card Funding (`fund_virtual_card` + `fund_virtual_card_from_wallet`)
CREATE OR REPLACE FUNCTION public.fund_virtual_card(
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
  v_gate JSONB;
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

  -- Explicit Email Confirmation + Mandatory PIN Hash Gate BEFORE any ledger movement
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_user_id, 'CARD_FUNDING');
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
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
      RETURN jsonb_build_object('success', false, 'code', v_pin_res->>'code', 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
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
BEGIN
  RETURN public.fund_virtual_card(p_card_id, p_amount_card_currency, p_pin, p_idempotency_key);
END;
$$;

-- 5.6 MideSave Goal Vault Management (`create_savings_vault`, `fund_savings_vault`, `withdraw_savings_vault`, `manage_midesave_vault`)
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
  v_gate JSONB;
  v_clean_title TEXT := TRIM(COALESCE(p_title, ''));
  v_target NUMERIC(14, 2) := ROUND(COALESCE(p_target_amount, 0), 2);
  v_vault public.savings_vaults%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_user_id, 'MIDESAVE_CREATE');
    RAISE EXCEPTION '%', COALESCE(v_gate->>'error', 'Verified email and Transaction PIN required.');
  END IF;

  IF LENGTH(v_clean_title) < 2 THEN RAISE EXCEPTION 'Vault title must be at least 2 characters.'; END IF;
  IF v_target <= 0 THEN RAISE EXCEPTION 'Target savings amount must be greater than ₦0.00.'; END IF;

  INSERT INTO public.savings_vaults (
    user_id, title, category, target_amount, current_balance, interest_rate_pa, lock_until, status
  ) VALUES (
    v_user_id, v_clean_title, COALESCE(NULLIF(TRIM(p_category), ''), 'General'),
    v_target, 0.00, COALESCE(p_interest_rate_pa, 14.50), p_lock_until, 'active'
  ) RETURNING * INTO v_vault;

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
  v_gate JSONB;
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

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_caller, 'MIDESAVE_DEPOSIT');
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
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

  v_pin_res := public._verify_pin_and_audit(v_caller, p_pin, 'MIDESAVE_DEPOSIT');
  IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_pin_res->>'code', 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
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
  v_gate JSONB;
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

  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_caller, 'MIDESAVE_WITHDRAWAL');
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
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

  v_pin_res := public._verify_pin_and_audit(v_caller, p_pin, 'MIDESAVE_WITHDRAWAL');
  IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_pin_res->>'code', 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
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

-- Unified Canonical MideSave Vault Dispatcher (`manage_midesave_vault`)
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
SET search_path = public, extensions
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_gate JSONB;
  v_act TEXT := LOWER(TRIM(COALESCE(p_action, '')));
  v_created public.savings_vaults%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- Explicit Email Confirmation + Mandatory PIN Hash Guard BEFORE any vault action
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_caller, 'MANAGE_MIDESAVE_VAULT');
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
  END IF;

  IF v_act = 'create' THEN
    v_created := public.create_savings_vault(p_title, p_category, p_target_amount, p_lock_until, p_interest_rate_pa);
    RETURN jsonb_build_object('success', true, 'vault', to_jsonb(v_created));
  ELSIF v_act IN ('fund', 'deposit') THEN
    RETURN public.fund_savings_vault(p_vault_id, p_amount, p_pin, p_idempotency_key);
  ELSIF v_act = 'withdraw' THEN
    RETURN public.withdraw_savings_vault(p_vault_id, p_amount, p_pin, p_idempotency_key);
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Unsupported MideSave action. Use create, fund, or withdraw.');
  END IF;
END;
$$;

-- 5.7 VTU & Utility Bills (`pay_vtu_bill` + `pay_utility_bill`)
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
SET search_path = public, extensions
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_gate JSONB;
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

  -- Explicit Email Confirmation + Mandatory PIN Hash Guard BEFORE any ledger movement
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_caller, 'VTU_BILL_PAYMENT');
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
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

  v_pin_res := public._verify_pin_and_audit(v_caller, p_pin, 'VTU_BILL_PAYMENT');
  IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_pin_res->>'code', 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
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
BEGIN
  RETURN public.pay_vtu_bill(p_service_type, p_provider, p_identifier, p_plan_name, p_amount, p_pin, p_idempotency_key);
END;
$$;

-- 5.8 Business Payroll Batch (`execute_payroll_batch` + `execute_business_payroll`)
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
SET search_path = public, extensions
AS $$
DECLARE
  v_employer_id UUID := auth.uid();
  v_gate JSONB;
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

  -- Explicit Email Confirmation + Mandatory PIN Hash Guard BEFORE any ledger movement
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_employer_id AND transaction_pin_hash IS NOT NULL) THEN
    v_gate := public._assert_verified_wallet_ready(v_employer_id, 'BUSINESS_PAYROLL');
    RETURN jsonb_build_object('success', false, 'code', v_gate->>'code', 'error', v_gate->>'error');
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

  v_pin_res := public._verify_pin_and_audit(v_employer_id, p_pin, 'BUSINESS_PAYROLL');
  IF COALESCE((v_pin_res->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', v_pin_res->>'code', 'error', COALESCE(v_pin_res->>'error', 'Invalid Transaction PIN.'));
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
BEGIN
  RETURN public.execute_payroll_batch(p_business_id, p_title, p_items, p_pin, p_idempotency_key);
END;
$$;

-- ============================================================================
-- 6. STRICT EXECUTION PRIVILEGES (`authenticated` ONLY; `anon` REVOKED)
-- ============================================================================

REVOKE ALL ON FUNCTION public.record_verified_login_session(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fund_virtual_card(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pay_vtu_bill(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manage_midesave_vault(TEXT, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT, NUMERIC, TIMESTAMPTZ, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_payroll_batch(UUID, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_verified_login_session(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fund_virtual_card(UUID, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_vtu_bill(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_midesave_vault(TEXT, UUID, NUMERIC, TEXT, UUID, TEXT, TEXT, NUMERIC, TIMESTAMPTZ, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_payroll_batch(UUID, TEXT, JSONB, TEXT, UUID) TO authenticated;

COMMIT;

