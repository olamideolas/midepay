/**
 * MidePay v4.1 — Supabase Edge Function: `init-payment`
 * Initializes authenticated Paystack or Flutterwave NGN wallet deposit sessions.
 *
 * Security & Compliance Guarantees:
 * 1. Validates caller's Supabase JWT (`Authorization: Bearer <token>`).
 * 2. Enforces `profiles.is_frozen === false` and CBN funding bounds (₦100 – ₦5,000,000).
 * 3. Generates a collision-resistant idempotent reference (`MDP-PSK-...` or `MDP-FLW-...`).
 * 4. Inserts a `'pending'` deposit row into `public.transactions` BEFORE calling the gateway.
 * 5. Initializes checkout with `PAYSTACK_SECRET_KEY` or `FLUTTERWAVE_SECRET_KEY` and returns
 *    `{ authorization_url, reference, provider }` with strict CORS headers.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

export type GatewayProvider = 'paystack' | 'flutterwave';

export interface InitPaymentRequest {
  provider: GatewayProvider;
  amount_ngn: number;
  callback_url?: string;
}

const MIN_DEPOSIT_NGN = 100;
const MAX_DEPOSIT_NGN = 5_000_000;

function getEnv(key: string): string {
  const denoEnv = (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
  if (denoEnv) return denoEnv.get(key) ?? '';
  const nodeEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return nodeEnv?.[key] ?? '';
}

export function buildCorsHeaders(req: Request): Record<string, string> {
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

export function generateDepositReference(provider: GatewayProvider): string {
  const prefix = provider === 'paystack' ? 'MDP-PSK' : 'MDP-FLW';
  const ts = Date.now().toString(36).toUpperCase();
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const randHex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${prefix}-${ts}-${randHex}`;
}

function isSafeCallbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

export async function handleInitPaymentRequest(req: Request): Promise<Response> {
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
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization Bearer token.' }), {
      status: 401,
      headers: corsHeaders
    });
  }

  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
  const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Supabase runtime environment variables are not configured.' }), {
      status: 500,
      headers: corsHeaders
    });
  }

  // 1. Validate caller's Supabase JWT
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authErr } = await userClient.auth.getUser();
  const user = authData?.user;
  if (authErr || !user || !user.id || !user.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized: invalid or expired Supabase session.' }), {
      status: 401,
      headers: corsHeaders
    });
  }
  if (!user.email_confirmed_at) {
    return new Response(
      JSON.stringify({ code: 'EMAIL_NOT_VERIFIED', error: 'Verify your 6-digit email OTP before funding your wallet.' }),
      { status: 403, headers: corsHeaders }
    );
  }

  // 2. Parse & validate request body
  let body: InitPaymentRequest;
  try {
    body = (await req.json()) as InitPaymentRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request payload.' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  const provider = String(body.provider ?? '').toLowerCase() as GatewayProvider;
  if (provider !== 'paystack' && provider !== 'flutterwave') {
    return new Response(JSON.stringify({ error: "Invalid provider. Must be 'paystack' or 'flutterwave'." }), {
      status: 400,
      headers: corsHeaders
    });
  }

  const amountNgn = Math.round(Number(body.amount_ngn) * 100) / 100;
  if (!Number.isFinite(amountNgn) || amountNgn < MIN_DEPOSIT_NGN || amountNgn > MAX_DEPOSIT_NGN) {
    return new Response(
      JSON.stringify({
        error: `Deposit amount must be between ₦${MIN_DEPOSIT_NGN.toLocaleString()} and ₦${MAX_DEPOSIT_NGN.toLocaleString()}.`
      }),
      { status: 400, headers: corsHeaders }
    );
  }

  const callbackUrl = body.callback_url?.trim() || req.headers.get('origin') || 'https://midepay.vercel.app';
  if (!isSafeCallbackUrl(callbackUrl)) {
    return new Response(JSON.stringify({ error: 'Invalid callback_url. Must be HTTPS (or localhost in dev).' }), {
      status: 400,
      headers: corsHeaders
    });
  }

  // 3. Check profile freeze state & resolve user's NGN wallet via service_role client
  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: profile, error: profErr } = await adminClient
    .from('profiles')
    .select('id, full_name, email, phone, is_frozen, frozen_by_admin, email_otp_verified_at, kyc_tier')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr || !profile) {
    return new Response(JSON.stringify({ error: 'User security profile not found.' }), {
      status: 404,
      headers: corsHeaders
    });
  }

  const { data: proof, error: proofError } = await userClient.rpc('get_email_verification_status');
  if (proofError || !proof?.verified || !profile.email_otp_verified_at) {
    return new Response(JSON.stringify({ code: 'EMAIL_NOT_VERIFIED' }), { status: 403, headers: corsHeaders });
  }
  if (profile.is_frozen === true || profile.frozen_by_admin === true) {
    return new Response(
      JSON.stringify({ error: 'Account is frozen per CBN AML/Fraud compliance. Wallet deposits are disabled.' }),
      { status: 403, headers: corsHeaders }
    );
  }

  let { data: wallet } = await adminClient
    .from('wallets')
    .select('id, nuban, balance')
    .eq('user_id', user.id)
    .eq('currency', 'NGN')
    .maybeSingle();

  if (!wallet) {
    const randBuf = new Uint32Array(1);
    crypto.getRandomValues(randBuf);
    const generatedNuban = '90' + String(randBuf[0] % 100000000).padStart(8, '0');
    const { data: createdWallet, error: createWalErr } = await adminClient
      .from('wallets')
      .insert({
        user_id: user.id,
        currency: 'NGN',
        balance: 0.0,
        ledger_balance: 0.0,
        nuban: generatedNuban,
        bank_name: 'Providus Bank'
      })
      .select('id, nuban, balance')
      .single();

    if (createWalErr || !createdWallet) {
      return new Response(JSON.stringify({ error: 'Unable to provision NGN wallet for deposit.' }), {
        status: 500,
        headers: corsHeaders
      });
    }
    wallet = createdWallet;
  }

  // 4. Insert idempotent 'pending' deposit record into public.transactions
  const reference = generateDepositReference(provider);
  const counterpartyLabel = provider === 'paystack' ? 'Paystack Checkout' : 'Flutterwave Checkout';

  const { data: pendingTx, error: txInsertErr } = await adminClient
    .from('transactions')
    .insert({
      wallet_id: wallet.id,
      user_id: user.id,
      type: 'inflow',
      category: 'deposit',
      amount: amountNgn,
      fee: 0.0,
      status: 'pending',
      counterparty_name: counterpartyLabel,
      counterparty_bank: counterpartyLabel,
      counterparty_tag_or_nuban: wallet.nuban ?? '9000000000',
      narration: `Wallet Funding via ${provider === 'paystack' ? 'Paystack' : 'Flutterwave'}`,
      reference,
      gateway_provider: provider,
      metadata: {
        initiated_at: new Date().toISOString(),
        callback_url: callbackUrl
      }
    })
    .select('id')
    .single();

  if (txInsertErr || !pendingTx) {
    return new Response(
      JSON.stringify({ error: txInsertErr?.message || 'Failed to create pending deposit record.' }),
      { status: 500, headers: corsHeaders }
    );
  }

  // 5. Call Paystack or Flutterwave Checkout Initialization API
  try {
    let authorizationUrl = '';
    let gatewayRef = reference;

    if (provider === 'paystack') {
      const paystackSecret = getEnv('PAYSTACK_SECRET_KEY');
      if (!paystackSecret) {
        throw new Error('PAYSTACK_SECRET_KEY is not configured in Edge Function secrets.');
      }

      const amountKobo = Math.round(amountNgn * 100);
      const pskRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: user.email,
          amount: amountKobo,
          currency: 'NGN',
          reference,
          callback_url: callbackUrl,
          channels: ['card', 'bank', 'ussd', 'bank_transfer'],
          metadata: {
            midepay_user_id: user.id,
            midepay_wallet_id: wallet.id,
            midepay_tx_id: pendingTx.id
          }
        })
      });

      const pskJson = (await pskRes.json()) as {
        status?: boolean;
        message?: string;
        data?: { authorization_url?: string; access_code?: string; reference?: string };
      };

      if (!pskRes.ok || !pskJson.status || !pskJson.data?.authorization_url) {
        throw new Error(pskJson.message || 'Paystack transaction initialization failed.');
      }

      authorizationUrl = pskJson.data.authorization_url;
      gatewayRef = pskJson.data.access_code || pskJson.data.reference || reference;
    } else {
      const flwSecret = getEnv('FLUTTERWAVE_SECRET_KEY');
      if (!flwSecret) {
        throw new Error('FLUTTERWAVE_SECRET_KEY is not configured in Edge Function secrets.');
      }

      const flwRes = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${flwSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tx_ref: reference,
          amount: amountNgn,
          currency: 'NGN',
          redirect_url: callbackUrl,
          payment_options: 'card,banktransfer,ussd',
          customer: {
            email: user.email,
            name: profile.full_name || user.email,
            phonenumber: profile.phone || ''
          },
          meta: {
            midepay_user_id: user.id,
            midepay_wallet_id: wallet.id,
            midepay_tx_id: pendingTx.id
          },
          customizations: {
            title: 'MidePay Digital Wallet',
            description: `Fund NGN Wallet (Ref: ${reference})`
          }
        })
      });

      const flwJson = (await flwRes.json()) as {
        status?: string;
        message?: string;
        data?: { link?: string };
      };

      if (!flwRes.ok || flwJson.status !== 'success' || !flwJson.data?.link) {
        throw new Error(flwJson.message || 'Flutterwave payment link initialization failed.');
      }

      authorizationUrl = flwJson.data.link;
    }

    await adminClient
      .from('transactions')
      .update({ gateway_reference: gatewayRef })
      .eq('id', pendingTx.id);

    return new Response(
      JSON.stringify({
        authorization_url: authorizationUrl,
        reference,
        provider,
        amount_ngn: amountNgn
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Payment gateway initialization error.';
    await adminClient
      .from('transactions')
      .update({
        metadata: { error: errMsg, failed_at: new Date().toISOString() }
      })
      .eq('id', pendingTx.id);

    return new Response(JSON.stringify({ error: errMsg }), {
      status: 502,
      headers: corsHeaders
    });
  }
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve?: (h: (r: Request) => Promise<Response>) => void } }).Deno;
if (denoRuntime && typeof denoRuntime.serve === 'function') {
  denoRuntime.serve(handleInitPaymentRequest);
}

