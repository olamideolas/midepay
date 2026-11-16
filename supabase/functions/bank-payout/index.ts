/**
 * MidePay v4.1 — Supabase Edge Function: `bank-payout`
 * Handles Nigerian NIP Bank Account Inquiry & Outbound Bank Transfers via
 * Paystack Transfer API or Flutterwave Transfers API.
 *
 * Security & Compliance Guarantees:
 * 1. Validates caller's Supabase JWT (`Authorization: Bearer <token>`).
 * 2. Supports `action: 'resolve_account'` (10-digit NUBAN beneficiary inquiry).
 * 3. Supports `action: 'initiate_payout'`:
 *    - Enforces `profiles.is_frozen === false` and PIN lockout window (`pin_locked_until`).
 *    - Verifies 4-digit transaction PIN against `profiles.pin_hash` (`bcryptjs`),
 *      locking PIN for 15 minutes after 5 consecutive failed attempts.
 *    - Enforces CBN Tier 1–3 single-transfer limits (₦50k / ₦100k / ₦5M).
 *    - Atomically debits wallet via `debit_wallet_for_payout` RPC BEFORE calling gateway.
 *    - Automatically refunds wallet via `reverse_failed_payout` RPC if gateway call fails.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import bcrypt from 'npm:bcryptjs@2.4.3';

export type PayoutProvider = 'paystack' | 'flutterwave';

export interface BankPayoutRequest {
  action: 'resolve_account' | 'initiate_payout';
  provider?: PayoutProvider;
  account_number: string;
  bank_code: string;
  account_name?: string;
  amount_ngn?: number;
  pin?: string;
  narration?: string;
}

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 15;

function getEnv(key: string): string {
  const denoEnv = (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
  if (denoEnv) return denoEnv.get(key) ?? '';
  const nodeEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return nodeEnv?.[key] ?? '';
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const allowedList = getEnv('ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const reqOrigin = req.headers.get('origin') ?? '';
  const allowOrigin =
    allowedList.length === 0
      ? reqOrigin || '*'
      : allowedList.includes(reqOrigin)
        ? reqOrigin
        : allowedList[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function generatePayoutReference(provider: PayoutProvider): string {
  const prefix = provider === 'paystack' ? 'MDP-OUT-PSK' : 'MDP-OUT-FLW';
  const ts = Date.now().toString(36).toUpperCase();
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const randHex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${prefix}-${ts}-${randHex}`;
}

async function resolveNubanAccount(
  provider: PayoutProvider,
  accountNumber: string,
  bankCode: string
): Promise<{ account_name: string; account_number: string; bank_code: string }> {
  if (provider === 'paystack') {
    const secret = getEnv('PAYSTACK_SECRET_KEY');
    if (!secret) throw new Error('PAYSTACK_SECRET_KEY is not configured.');

    const url = `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` }
    });
    const json = (await res.json()) as {
      status?: boolean;
      message?: string;
      data?: { account_name?: string; account_number?: string };
    };
    if (!res.ok || !json.status || !json.data?.account_name) {
      throw new Error(json.message || 'Unable to resolve NUBAN via Paystack NIP.');
    }
    return {
      account_name: json.data.account_name,
      account_number: json.data.account_number || accountNumber,
      bank_code: bankCode
    };
  }

  const secret = getEnv('FLUTTERWAVE_SECRET_KEY');
  if (!secret) throw new Error('FLUTTERWAVE_SECRET_KEY is not configured.');

  const res = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      account_number: accountNumber,
      account_bank: bankCode
    })
  });
  const json = (await res.json()) as {
    status?: string;
    message?: string;
    data?: { account_name?: string; account_number?: string };
  };
  if (!res.ok || json.status !== 'success' || !json.data?.account_name) {
    throw new Error(json.message || 'Unable to resolve NUBAN via Flutterwave NIP.');
  }
  return {
    account_name: json.data.account_name,
    account_number: json.data.account_number || accountNumber,
    bank_code: bankCode
  };
}

export async function handleBankPayoutRequest(req: Request): Promise<Response> {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Expected POST.' }), {
      status: 405,
      headers: corsHeaders
    });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing Authorization Bearer token.' }), {
      status: 401,
      headers: corsHeaders
    });
  }

  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
  const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Supabase environment variables missing.' }), {
      status: 500,
      headers: corsHeaders
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authErr } = await userClient.auth.getUser();
  const user = authData?.user;
  if (authErr || !user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized session.' }), {
      status: 401,
      headers: corsHeaders
    });
  }

  let body: BankPayoutRequest;
  try {
    body = (await req.json()) as BankPayoutRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request payload.' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  const provider: PayoutProvider = body.provider === 'flutterwave' ? 'flutterwave' : 'paystack';
  const accountNumber = String(body.account_number ?? '').trim();
  const bankCode = String(body.bank_code ?? '').trim();

  if (!/^\d{10}$/.test(accountNumber) || !bankCode) {
    return new Response(JSON.stringify({ error: 'Valid 10-digit NUBAN account_number and bank_code are required.' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  // ACTION 1: NIP Account Name Inquiry
  if (body.action === 'resolve_account') {
    try {
      const resolved = await resolveNubanAccount(provider, accountNumber, bankCode);
      return new Response(JSON.stringify({ success: true, provider, ...resolved }), {
        status: 200,
        headers: corsHeaders
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'NIP account inquiry failed.';
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
    }
  }

  if (body.action !== 'initiate_payout') {
    return new Response(JSON.stringify({ error: "Invalid action. Expected 'resolve_account' or 'initiate_payout'." }), {
      status: 400,
      headers: corsHeaders
    });
  }

  // ACTION 2: PIN-Verified Outbound Bank Transfer
  const amountNgn = Math.round(Number(body.amount_ngn ?? 0) * 100) / 100;
  const rawPin = String(body.pin ?? '').trim();
  const narration = String(body.narration ?? 'Transfer via MidePay').trim().slice(0, 60) || 'Transfer via MidePay';

  if (!Number.isFinite(amountNgn) || amountNgn < 50) {
    return new Response(JSON.stringify({ error: 'Minimum bank transfer amount is ₦50.00.' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  if (!/^\d{4}$/.test(rawPin)) {
    return new Response(JSON.stringify({ error: 'A valid 4-digit numeric transaction PIN is required.' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: profile, error: profErr } = await adminClient
    .from('profiles')
    .select('id, full_name, pin_hash, pin_failed_attempts, pin_locked_until, is_frozen, kyc_tier')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr || !profile) {
    return new Response(JSON.stringify({ error: 'User profile not found.' }), {
      status: 404,
      headers: corsHeaders
    });
  }

  if (profile.is_frozen === true) {
    return new Response(
      JSON.stringify({ error: 'Account is frozen per CBN AML/Fraud directives. Outbound payouts are blocked.' }),
      { status: 403, headers: corsHeaders }
    );
  }

  if (profile.pin_locked_until && new Date(profile.pin_locked_until) > new Date()) {
    return new Response(
      JSON.stringify({ error: 'Transaction PIN is temporarily locked due to repeated failed attempts.' }),
      { status: 429, headers: corsHeaders }
    );
  }

  if (!profile.pin_hash || !/^\$2[aby]\$\d{2}\$/.test(profile.pin_hash)) {
    return new Response(
      JSON.stringify({ error: 'Transaction PIN not configured. Please set up your 4-digit security PIN first.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const isPinValid = bcrypt.compareSync(rawPin, profile.pin_hash);
  if (!isPinValid) {
    const nextAttempts = Number(profile.pin_failed_attempts ?? 0) + 1;
    const lockUntil =
      nextAttempts >= MAX_PIN_ATTEMPTS
        ? new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;

    await adminClient
      .from('profiles')
      .update({
        pin_failed_attempts: nextAttempts,
        pin_locked_until: lockUntil,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    return new Response(
      JSON.stringify({
        error: lockUntil
          ? `Incorrect PIN. Maximum attempts reached; PIN locked for ${PIN_LOCKOUT_MINUTES} minutes.`
          : 'Incorrect 4-digit transaction PIN.'
      }),
      { status: 401, headers: corsHeaders }
    );
  }

  if (Number(profile.pin_failed_attempts ?? 0) > 0) {
    await adminClient
      .from('profiles')
      .update({ pin_failed_attempts: 0, pin_locked_until: null })
      .eq('id', user.id);
  }

  // Enforce CBN Tier 1-3 single-transfer cap
  const kycTier = Number(profile.kyc_tier ?? 1);
  const singleLimit = kycTier === 1 ? 50_000 : kycTier === 2 ? 100_000 : 5_000_000;
  if (amountNgn > singleLimit) {
    return new Response(
      JSON.stringify({
        error: `Amount (₦${amountNgn.toLocaleString()}) exceeds CBN KYC Tier ${kycTier} single-transfer limit of ₦${singleLimit.toLocaleString()}.`
      }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Resolve beneficiary name on gateway if not already verified
  let beneficiaryName = body.account_name?.trim() || '';
  if (!beneficiaryName) {
    try {
      const resolved = await resolveNubanAccount(provider, accountNumber, bankCode);
      beneficiaryName = resolved.account_name;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to verify recipient NUBAN.';
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
    }
  }

  const reference = generatePayoutReference(provider);
  const payoutFee = 0.0;

  // Atomically lock & debit sender's NGN wallet before external network call
  const { data: debitResult, error: debitErr } = await adminClient.rpc('debit_wallet_for_payout', {
    p_user_id: user.id,
    p_amount: amountNgn,
    p_fee: payoutFee,
    p_reference: reference,
    p_provider: provider,
    p_counterparty_name: beneficiaryName,
    p_counterparty_bank: bankCode,
    p_counterparty_nuban: accountNumber,
    p_narration: narration
  });

  if (debitErr) {
    return new Response(JSON.stringify({ error: debitErr.message }), {
      status: 400,
      headers: corsHeaders
    });
  }

  // Dispatch outbound NIP payout via Paystack or Flutterwave
  try {
    let gatewayRef = reference;

    if (provider === 'paystack') {
      const secret = getEnv('PAYSTACK_SECRET_KEY');
      if (!secret) throw new Error('PAYSTACK_SECRET_KEY is not configured.');

      // Step A: Create Transfer Recipient
      const rcptRes = await fetch('https://api.paystack.co/transferrecipient', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'nuban',
          name: beneficiaryName,
          account_number: accountNumber,
          bank_code: bankCode,
          currency: 'NGN'
        })
      });
      const rcptJson = (await rcptRes.json()) as {
        status?: boolean;
        message?: string;
        data?: { recipient_code?: string };
      };
      if (!rcptRes.ok || !rcptJson.status || !rcptJson.data?.recipient_code) {
        throw new Error(rcptJson.message || 'Paystack transfer recipient creation failed.');
      }

      // Step B: Initiate Transfer (kobo)
      const trfRes = await fetch('https://api.paystack.co/transfer', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: 'balance',
          amount: Math.round(amountNgn * 100),
          recipient: rcptJson.data.recipient_code,
          reason: narration,
          reference
        })
      });
      const trfJson = (await trfRes.json()) as {
        status?: boolean;
        message?: string;
        data?: { transfer_code?: string; status?: string };
      };
      if (!trfRes.ok || !trfJson.status) {
        throw new Error(trfJson.message || 'Paystack NIP transfer initiation failed.');
      }
      gatewayRef = trfJson.data?.transfer_code || reference;
    } else {
      const secret = getEnv('FLUTTERWAVE_SECRET_KEY');
      if (!secret) throw new Error('FLUTTERWAVE_SECRET_KEY is not configured.');

      const flwRes = await fetch('https://api.flutterwave.com/v3/transfers', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          account_bank: bankCode,
          account_number: accountNumber,
          amount: amountNgn,
          narration,
          currency: 'NGN',
          reference,
          debit_currency: 'NGN'
        })
      });
      const flwJson = (await flwRes.json()) as {
        status?: string;
        message?: string;
        data?: { id?: number | string };
      };
      if (!flwRes.ok || flwJson.status !== 'success') {
        throw new Error(flwJson.message || 'Flutterwave NIP transfer initiation failed.');
      }
      gatewayRef = String(flwJson.data?.id ?? reference);
    }

    await adminClient
      .from('transactions')
      .update({ status: 'successful', gateway_reference: gatewayRef })
      .eq('reference', reference);

    return new Response(
      JSON.stringify({
        success: true,
        provider,
        reference,
        gateway_reference: gatewayRef,
        beneficiary_name: beneficiaryName,
        amount_ngn: amountNgn,
        new_balance: (debitResult as { new_balance?: number })?.new_balance
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Outbound gateway transfer failed.';
    // Automatically reverse wallet debit so customer funds are never stranded
    await adminClient.rpc('reverse_failed_payout', {
      p_reference: reference,
      p_reason: errMsg,
      p_raw_payload: { error: errMsg }
    });

    return new Response(JSON.stringify({ error: errMsg, reversed: true, reference }), {
      status: 502,
      headers: corsHeaders
    });
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve?: (h: (r: Request) => Promise<Response>) => void } }).Deno;
if (denoRuntime && typeof denoRuntime.serve === 'function') {
  denoRuntime.serve(handleBankPayoutRequest);
}

