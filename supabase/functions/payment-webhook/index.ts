/**
 * MidePay v4.1 — Supabase Edge Function: `payment-webhook`
 * Unified, idempotent cryptographic webhook processor for Paystack & Flutterwave.
 * Deploy with: `supabase functions deploy payment-webhook --no-verify-jwt`
 *
 * Cryptographic & Transactional Guarantees:
 * 1. Verifies `x-paystack-signature` (HMAC-SHA512 over raw request body) or
 *    Flutterwave `verif-hash` in constant time BEFORE parsing any JSON payload.
 * 2. Immediately rejects missing or invalid signatures with HTTP `401 Unauthorized`.
 * 3. Invokes atomic PostgreSQL `SECURITY DEFINER` RPC `settle_gateway_deposit(...)`
 *    (which locks the transaction row `FOR UPDATE`, prevents duplicate credits,
 *    credits `wallets.balance` & `wallets.ledger_balance`, and writes `audit_logs`).
 * 4. Processes `transfer.failed` / `transfer.reversed` webhooks via `reverse_failed_payout(...)`
 *    so failed outbound bank payouts automatically refund the user's wallet.
 */

export interface WebhookDependencies {
  paystackSecret?: string;
  flutterwaveWebhookHash?: string;
  flutterwaveSecretKey?: string;
  settleDeposit?: (args: {
    p_reference: string;
    p_provider: 'paystack' | 'flutterwave';
    p_amount_kobo_or_ngn: number;
    p_gateway_ref: string;
    p_raw_payload: Record<string, unknown>;
  }) => Promise<{ data: unknown; error: { message: string } | null }>;
  reversePayout?: (args: {
    p_reference: string;
    p_reason: string;
    p_raw_payload: Record<string, unknown>;
  }) => Promise<{ data: unknown; error: { message: string } | null }>;
  verifyFlutterwaveTx?: (txId: string | number, secretKey: string) => Promise<boolean>;
}

function getEnv(key: string): string {
  const denoEnv = (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
  if (denoEnv) return denoEnv.get(key) ?? '';
  const nodeEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return nodeEnv?.[key] ?? '';
}

/**
 * Constant-time string comparison (prevents timing side-channel attacks on HMAC digests)
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

/**
 * Compute HMAC-SHA512 hex digest of raw UTF-8 body using Web Crypto API
 */
export async function computeHmacSha512Hex(rawBody: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(rawBody));
  return Array.from(new Uint8Array(sigBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string,
  secretKey: string
): Promise<boolean> {
  if (!signatureHeader || !secretKey) return false;
  const expectedHex = await computeHmacSha512Hex(rawBody, secretKey);
  return timingSafeEqualStrings(expectedHex.toLowerCase(), signatureHeader.trim().toLowerCase());
}

export function verifyFlutterwaveSignature(verifHashHeader: string, expectedSecretHash: string): boolean {
  if (!verifHashHeader || !expectedSecretHash) return false;
  return timingSafeEqualStrings(verifHashHeader.trim(), expectedSecretHash.trim());
}

async function defaultVerifyFlutterwaveTx(txId: string | number, secretKey: string): Promise<boolean> {
  if (!secretKey) return true;
  try {
    const res = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(String(txId))}/verify`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secretKey}` }
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { status?: string; data?: { status?: string; currency?: string } };
    return json.status === 'success' && json.data?.status === 'successful' && json.data?.currency === 'NGN';
  } catch {
    return false;
  }
}

export async function handlePaymentWebhookRequest(
  req: Request,
  deps: WebhookDependencies = {}
): Promise<Response> {
  const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: jsonHeaders
    });
  }

  // 1. Read raw bytes BEFORE any JSON parsing
  const rawBody = await req.text();
  if (!rawBody) {
    return new Response(JSON.stringify({ error: 'Empty webhook body.' }), {
      status: 401,
      headers: jsonHeaders
    });
  }

  const paystackSig = req.headers.get('x-paystack-signature') ?? '';
  const flwVerifHash = req.headers.get('verif-hash') ?? '';

  const paystackSecret = deps.paystackSecret ?? getEnv('PAYSTACK_SECRET_KEY');
  const flwExpectedHash =
    deps.flutterwaveWebhookHash ?? (getEnv('FLUTTERWAVE_WEBHOOK_HASH') || getEnv('FLUTTERWAVE_SECRET_KEY'));
  const flwSecretKey = deps.flutterwaveSecretKey ?? getEnv('FLUTTERWAVE_SECRET_KEY');

  let verifiedProvider: 'paystack' | 'flutterwave' | null = null;

  // 2. Cryptographic Signature Verification Gate (strictly pre-parse)
  if (paystackSig) {
    const ok = await verifyPaystackSignature(rawBody, paystackSig, paystackSecret);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Invalid x-paystack-signature HMAC-SHA512 digest.' }), {
        status: 401,
        headers: jsonHeaders
      });
    }
    verifiedProvider = 'paystack';
  } else if (flwVerifHash) {
    const ok = verifyFlutterwaveSignature(flwVerifHash, flwExpectedHash);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Invalid Flutterwave verif-hash signature.' }), {
        status: 401,
        headers: jsonHeaders
      });
    }
    verifiedProvider = 'flutterwave';
  } else {
    return new Response(JSON.stringify({ error: 'Missing cryptographic webhook signature header.' }), {
      status: 401,
      headers: jsonHeaders
    });
  }

  // 3. Safe JSON parse ONLY after cryptographic authenticity is confirmed
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Malformed JSON payload.' }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  // Lazily construct Supabase service_role RPC callers unless injected (for unit tests)
  let settleDeposit = deps.settleDeposit;
  let reversePayout = deps.reversePayout;

  if (!settleDeposit || !reversePayout) {
    const supabaseUrl = getEnv('SUPABASE_URL');
    const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Supabase service credentials missing.' }), {
        status: 500,
        headers: jsonHeaders
      });
    }
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    settleDeposit =
      settleDeposit ??
      (async (rpcArgs) => {
        const { data, error } = await adminClient.rpc('settle_gateway_deposit', rpcArgs);
        return { data, error: error ? { message: error.message } : null };
      });
    reversePayout =
      reversePayout ??
      (async (rpcArgs) => {
        const { data, error } = await adminClient.rpc('reverse_failed_payout', rpcArgs);
        return { data, error: error ? { message: error.message } : null };
      });
  }

  // 4A. Process Paystack Webhook Events
  if (verifiedProvider === 'paystack') {
    const eventType = String(payload.event ?? '');
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const reference = String(data.reference ?? '').trim();

    if (eventType === 'charge.success' && data.status === 'success' && reference) {
      const amountKobo = Number(data.amount ?? 0);
      const gatewayRef = String(data.id ?? reference);

      const { data: rpcResult, error: rpcErr } = await settleDeposit({
        p_reference: reference,
        p_provider: 'paystack',
        p_amount_kobo_or_ngn: amountKobo,
        p_gateway_ref: gatewayRef,
        p_raw_payload: payload
      });

      if (rpcErr) {
        return new Response(JSON.stringify({ error: rpcErr.message }), { status: 500, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({ received: true, provider: 'paystack', settlement: rpcResult }), {
        status: 200,
        headers: jsonHeaders
      });
    }

    if ((eventType === 'transfer.failed' || eventType === 'transfer.reversed') && reference) {
      const { data: revResult, error: revErr } = await reversePayout({
        p_reference: reference,
        p_reason: `Paystack ${eventType}`,
        p_raw_payload: payload
      });
      if (revErr) {
        return new Response(JSON.stringify({ error: revErr.message }), { status: 500, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({ received: true, provider: 'paystack', reversal: revResult }), {
        status: 200,
        headers: jsonHeaders
      });
    }

    return new Response(JSON.stringify({ received: true, ignored_event: eventType }), {
      status: 200,
      headers: jsonHeaders
    });
  }

  // 4B. Process Flutterwave Webhook Events
  const eventType = String(payload.event ?? '');
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const txRef = String(data.tx_ref ?? data.reference ?? '').trim();
  const flwStatus = String(data.status ?? '').toLowerCase();

  if (eventType === 'charge.completed' && flwStatus === 'successful' && txRef) {
    const txId = data.id as string | number | undefined;
    const verifyFn = deps.verifyFlutterwaveTx ?? defaultVerifyFlutterwaveTx;
    if (txId !== undefined && flwSecretKey) {
      const verified = await verifyFn(txId, flwSecretKey);
      if (!verified) {
        return new Response(JSON.stringify({ error: 'Flutterwave secondary transaction verification failed.' }), {
          status: 400,
          headers: jsonHeaders
        });
      }
    }

    const amountNgn = Number(data.amount ?? 0);
    const gatewayRef = String(data.flw_ref ?? data.id ?? txRef);

    const { data: rpcResult, error: rpcErr } = await settleDeposit({
      p_reference: txRef,
      p_provider: 'flutterwave',
      p_amount_kobo_or_ngn: amountNgn,
      p_gateway_ref: gatewayRef,
      p_raw_payload: payload
    });

    if (rpcErr) {
      return new Response(JSON.stringify({ error: rpcErr.message }), { status: 500, headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ received: true, provider: 'flutterwave', settlement: rpcResult }), {
      status: 200,
      headers: jsonHeaders
    });
  }

  if (eventType === 'transfer.completed' && flwStatus === 'failed' && txRef) {
    const { data: revResult, error: revErr } = await reversePayout({
      p_reference: txRef,
      p_reason: 'Flutterwave transfer.completed failed',
      p_raw_payload: payload
    });
    if (revErr) {
      return new Response(JSON.stringify({ error: revErr.message }), { status: 500, headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ received: true, provider: 'flutterwave', reversal: revResult }), {
      status: 200,
      headers: jsonHeaders
    });
  }

  return new Response(JSON.stringify({ received: true, ignored_event: eventType }), {
    status: 200,
    headers: jsonHeaders
  });
}

const denoRuntime = (globalThis as unknown as { Deno?: { serve?: (h: (r: Request) => Promise<Response>) => void } }).Deno;
if (denoRuntime && typeof denoRuntime.serve === 'function') {
  denoRuntime.serve((req: Request) => handlePaymentWebhookRequest(req));
}
