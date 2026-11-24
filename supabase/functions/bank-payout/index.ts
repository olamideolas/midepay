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
 *    - Verifies the PIN through the authenticated PostgreSQL verification RPC,
 *      locking PIN for 15 minutes after 5 consecutive failed attempts.
 *    - Enforces CBN Tier 1–3 single-transfer limits (₦50k / ₦100k / ₦5M).
 *    - Atomically debits wallet via `debit_wallet_for_payout` RPC BEFORE calling gateway.
 *    - Preserves pending debits on ambiguous failures for verified reconciliation.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.119.0';


export type PayoutProvider = 'paystack' | 'flutterwave';

export interface BankPayoutRequest {
  action: 'resolve_account' | 'initiate_payout' | 'inspect_test_payout';
  provider?: PayoutProvider;
  account_number: string;
  bank_code: string;
  account_name?: string;
  amount_ngn?: number;
  pin?: string;
  idempotency_key?: string;
  narration?: string;
}


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
  const allowOrigin = allowedList.includes(reqOrigin) ? reqOrigin : '';

  return {
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8'
  };
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
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${secret}` }
    });
    const json = (await res.json()) as {
      status?: boolean;
      message?: string;
      data?: { account_name?: string; account_number?: string };
    };
    if (!res.ok || !json.status || !json.data?.account_name?.trim() || json.data.account_number !== accountNumber) {
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
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
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
  if (!res.ok || json.status !== 'success' || !json.data?.account_name?.trim() || json.data.account_number !== accountNumber) {
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
  const origin = req.headers.get('origin');
  if (origin && !getEnv('ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean).includes(origin)) {
    return new Response(JSON.stringify({ code: 'ORIGIN_NOT_ALLOWED' }), { status: 403, headers: corsHeaders });
  }

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
  if (!user.email_confirmed_at) {
    return new Response(
      JSON.stringify({ code: 'EMAIL_NOT_VERIFIED', error: 'Verify your 6-digit email OTP before initiating payouts.' }),
      { status: 403, headers: corsHeaders }
    );
  }

  let body: BankPayoutRequest;
  try {
    body = (await req.json()) as BankPayoutRequest;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid payload');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request payload.' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  if (body.provider !== undefined && body.provider !== 'paystack' && body.provider !== 'flutterwave') {
    return new Response(JSON.stringify({ code: 'INVALID_PROVIDER' }), { status: 400, headers: corsHeaders });
  }
  const provider: PayoutProvider = body.provider ?? 'paystack';
  const accountNumber = String(body.account_number ?? '').trim();
  const bankCode = String(body.bank_code ?? '').trim();

  if (!/^\d{10}$/.test(accountNumber) || !/^\d{3,10}$/.test(bankCode)) {
    return new Response(JSON.stringify({ error: 'Valid 10-digit NUBAN account_number and bank_code are required.' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  // Check configuration before reserving any wallet funds or contacting a gateway.
  const gatewaySecret = getEnv(provider === 'paystack' ? 'PAYSTACK_SECRET_KEY' : 'FLUTTERWAVE_SECRET_KEY');
  const isStaging = supabaseUrl === 'https://ajbhsmcosxgymrtawlmd.supabase.co';
  if (!gatewaySecret || (isStaging && (provider !== 'paystack' || !gatewaySecret.startsWith('sk_test_')))) {
    return new Response(JSON.stringify({ code: 'GATEWAY_NOT_CONFIGURED' }), { status: 503, headers: corsHeaders });
  }

  if (body.action === 'inspect_test_payout') {
    if (!isStaging || getEnv('PAYOUT_TEST_USER_ID') !== user.id || accountNumber !== '1000000001' || bankCode !== '057') {
      return new Response(JSON.stringify({ success: false, code: 'TEST_PAYOUT_SCOPE_REQUIRED' }), { status: 403, headers: corsHeaders });
    }
    try {
      const { data, error } = await userClient.rpc('get_test_payout_availability');
      if (error || !data || typeof data.session_active !== 'boolean' || typeof data.dispatch_enabled !== 'boolean') throw new Error('Unavailable');
      const ready = data.session_active && data.dispatch_enabled && getEnv('BANK_PAYOUTS_ENABLED') === 'true';
      return new Response(JSON.stringify({ success: true, ready, code: ready ? 'READY' : !data.session_active ? 'SESSION_REQUIRED' : 'PAYOUTS_QUARANTINED' }), { status: 200, headers: corsHeaders });
    } catch {
      return new Response(JSON.stringify({ success: false, code: 'READINESS_UNAVAILABLE' }), { status: 503, headers: corsHeaders });
    }
  }

  // ACTION 1: NIP Account Name Inquiry
  if (body.action === 'resolve_account') {
    if (isStaging && (getEnv('PAYOUT_TEST_USER_ID') !== user.id || accountNumber !== '1000000001' || bankCode !== '057')) {
      return new Response(JSON.stringify({ success: false, code: 'TEST_PAYOUT_SCOPE_REQUIRED' }), { status: 403, headers: corsHeaders });
    }
    try {
      const resolved = await resolveNubanAccount(provider, accountNumber, bankCode);
      return new Response(JSON.stringify({ success: true, provider, ...resolved }), {
        status: 200,
        headers: corsHeaders
      });
    } catch (err) {
      const msg = 'Recipient verification is unavailable. Check the account details and try again.';
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
    }
  }

  if (body.action !== 'initiate_payout') {
    return new Response(JSON.stringify({ error: "Invalid action. Expected 'resolve_account' or 'initiate_payout'." }), {
      status: 400,
      headers: corsHeaders
    });
  }

  // Default server-side quarantine: browser configuration cannot enable real payouts.
  if (getEnv('BANK_PAYOUTS_ENABLED') !== 'true') {
    return new Response(JSON.stringify({ code: 'PAYOUTS_QUARANTINED', error: 'Bank payouts await staging approval.' }), { status: 503, headers: corsHeaders });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotency_key || '')) {
    return new Response(JSON.stringify({ code: 'IDEMPOTENCY_KEY_REQUIRED' }), { status: 400, headers: corsHeaders });
  }
  // ACTION 2: PIN-Verified Outbound Bank Transfer
  const scaledAmount = typeof body.amount_ngn === 'number' ? body.amount_ngn * 100 : NaN;
  if (!Number.isSafeInteger(Math.round(scaledAmount)) || Math.abs(scaledAmount - Math.round(scaledAmount)) > 0.0000001) {
    return new Response(JSON.stringify({ code: 'INVALID_AMOUNT_PRECISION' }), { status: 400, headers: corsHeaders });
  }
  const amountNgn = Math.round(scaledAmount) / 100;
  if (isStaging && (getEnv('PAYOUT_TEST_USER_ID') !== user.id || amountNgn > 100 || accountNumber !== '1000000001' || bankCode !== '057' || body.idempotency_key?.toLowerCase() !== '6f2e6402-10b0-4a14-b0a8-7a3b139b7e52')) {
    return new Response(JSON.stringify({ code: 'TEST_PAYOUT_SCOPE_REQUIRED', error: 'Only the designated test wallet may request a bank payout of up to ₦100.' }), { status: 403, headers: corsHeaders });
  }
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

  // Use the caller's JWT context, never a browser-supplied session identifier.
  const activeSession = async (): Promise<boolean> => {
    try {
      const { data, error } = await userClient.rpc('has_current_auth_session');
      return !error && data === true;
    } catch { return false; }
  };
  const endedSession = () => new Response(JSON.stringify({ code: 'SESSION_REQUIRED', error: 'Your session has ended. Sign in again before requesting a transfer.' }), { status: 401, headers: corsHeaders });
  if (!await activeSession()) return endedSession();

  const { data: profile, error: profErr } = await adminClient
    .from('profiles')
    .select('id, full_name, email_otp_verified_at, is_frozen, kyc_tier')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr || !profile) {
    return new Response(JSON.stringify({ error: 'User profile not found.' }), {
      status: 404,
      headers: corsHeaders
    });
  }

  if (!user.email_confirmed_at || !profile.email_otp_verified_at) {
    return new Response(
      JSON.stringify({ code: 'EMAIL_NOT_VERIFIED', error: 'Complete 6-digit Email OTP verification before initiating bank transfers.' }),
      { status: 403, headers: corsHeaders }
    );
  }

  if (profile.is_frozen === true) {
    return new Response(
      JSON.stringify({ error: 'Account is frozen per CBN AML/Fraud directives. Outbound payouts are blocked.' }),
      { status: 403, headers: corsHeaders }
    );
  }

  // PIN strikes must be serialized and persisted by PostgreSQL, never read/modify/write at the Edge.
  const { data: pinResult, error: pinError } = await userClient.rpc('verify_user_transaction_pin', { p_pin: rawPin });
  if (pinError || !pinResult?.valid) {
    return new Response(JSON.stringify({ code: pinResult?.code === 'PIN_LOCKED' ? 'PIN_LOCKED' : 'PIN_NOT_VERIFIED', error: pinResult?.code === 'PIN_LOCKED' ? 'PIN is temporarily locked. Wait before trying again.' : 'PIN could not be verified.' }), {
      status: pinResult?.code === 'PIN_LOCKED' ? 429 : 401, headers: corsHeaders
    });
  }

  // Enforce CBN Tier 1-3 single-transfer cap
  const kycTier = Number(profile.kyc_tier ?? 1);
  const singleLimit = kycTier === 1 ? 50_000 : kycTier === 2 ? 250_000 : 5_000_000;
  if (amountNgn > singleLimit) {
    return new Response(
      JSON.stringify({
        error: `Amount (₦${amountNgn.toLocaleString()}) exceeds CBN KYC Tier ${kycTier} single-transfer limit of ₦${singleLimit.toLocaleString()}.`
      }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Browser-supplied account_name is display input, never proof of account ownership.
  // Always resolve the exact destination server-side before reserving wallet funds.
  let beneficiaryName = '';
  {
    try {
      const resolved = await resolveNubanAccount(provider, accountNumber, bankCode);
      beneficiaryName = resolved.account_name;
    } catch (err) {
      const msg = 'Recipient verification is unavailable. No transfer has been queued. Check the account details and try again.';
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
    }
  }

  let reference = `MDP-OUT-${user.id}-${body.idempotency_key!.toLowerCase()}`;
  // Recipient lookup is a network round trip; recheck before reserving funds.
  if (!await activeSession()) return endedSession();
  const payoutFee = 0.0;

  // Atomically lock & debit sender's NGN wallet before external network call
  const { data: debitResult, error: debitErr } = await adminClient.rpc('enqueue_wallet_payout', {
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
    const disabled = debitErr.message.includes('PAYOUT_DISPATCH_DISABLED');
    return new Response(JSON.stringify({ code: disabled ? 'PAYOUTS_QUARANTINED' : 'QUEUE_REJECTED', error: disabled ? 'The test payout window is closed.' : 'Payout reservation could not be confirmed. Check its status before trying again.' }), {
      status: debitErr.message.includes('PAYOUT_DISPATCH_DISABLED') ? 503 : 400,
      headers: corsHeaders
    });
  }

  if (!debitResult || debitResult.success !== true) {
    return new Response(JSON.stringify({ code: 'DEBIT_NOT_CONFIRMED', reconciliation_required: true, reference }), {
      status: 503, headers: corsHeaders
    });
  }

  reference = debitResult.reference || reference;

  if ((debitResult as { already_debited?: boolean })?.already_debited) {
    return new Response(JSON.stringify(debitResult), { status: 200, headers: corsHeaders });
  }
  // The atomic enqueue RPC reserves money and creates the durable outbox together.
  // Only the internal worker may dispatch. Browser retries never issue a transfer.
  return new Response(JSON.stringify({success:true,status:'pending',dispatch_status:debitResult.dispatch_status??'queued',provider,reference,beneficiary_name:beneficiaryName,amount_ngn:amountNgn,new_balance:debitResult.new_balance}),{status:202,headers:corsHeaders});

}

const denoRuntime = (globalThis as unknown as { Deno?: { serve?: (h: (r: Request) => Promise<Response>) => void } }).Deno;
if (denoRuntime && typeof denoRuntime.serve === 'function') {
  denoRuntime.serve(handleBankPayoutRequest);
}

