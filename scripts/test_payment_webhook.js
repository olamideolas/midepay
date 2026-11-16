#!/usr/bin/env node
/**
 * MidePay v4.1 — Edge Function TypeScript Syntax & Cryptographic Webhook Test Suite
 * 1. Validates TypeScript syntax across `init-payment`, `payment-webhook`, and `bank-payout`
 *    using Node 22 native TypeScript parser (`--experimental-strip-types --check`).
 * 2. Directly imports `supabase/functions/payment-webhook/index.ts` and tests:
 *    - Pre-parse HTTP 401 rejection on missing signature (even with invalid JSON body)
 *    - HTTP 401 rejection on tampered Paystack HMAC-SHA512 (`x-paystack-signature`)
 *    - HTTP 401 rejection on invalid Flutterwave `verif-hash`
 *    - Valid Paystack `charge.success` HMAC-SHA512 verification & `settle_gateway_deposit` dispatch
 *    - Duplicate webhook idempotency (`already_settled: true`, zero double-credit)
 *    - Valid Flutterwave `charge.completed` verification & settlement dispatch
 *    - Outbound payout `transfer.reversed` automatic refund dispatch
 */

const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function pass(msg) {
  console.log(`  ✅ PASS: ${msg}`);
}

function fail(msg) {
  console.error(`  ❌ FAIL: ${msg}`);
  failures++;
}

async function main() {
  console.log('======================================================================');
  console.log(' MidePay v4.1 — Edge Functions & Cryptographic Webhook Verification');
  console.log('======================================================================\n');

  // 1. Validate TypeScript syntax across all 3 Supabase Edge Functions
  console.log('[1/2] Validating TypeScript syntax across Supabase Edge Functions...');
  const edgeFunctions = [
    'supabase/functions/init-payment/index.ts',
    'supabase/functions/payment-webhook/index.ts',
    'supabase/functions/bank-payout/index.ts'
  ];

  for (const relPath of edgeFunctions) {
    const absPath = path.join(ROOT, relPath);
    try {
      execFileSync(process.execPath, ['--no-warnings', '--experimental-strip-types', '--check', absPath], {
        stdio: 'pipe'
      });
      pass(`${relPath} TypeScript syntax valid`);
    } catch (err) {
      fail(`${relPath} TypeScript syntax error: ${err.stderr?.toString() || err.message}`);
    }
  }

  // 2. Import and execute `payment-webhook/index.ts` cryptographic handlers
  console.log('\n[2/2] Testing HMAC-SHA512, verif-hash & Idempotent Settlement Logic...');
  const webhookModuleUrl = pathToFileURL(path.join(ROOT, 'supabase/functions/payment-webhook/index.ts')).href;
  const webhookMod = await import(webhookModuleUrl);

  const TEST_PSK_SECRET = 'sk_test_midepay_hmac_verification_secret_2026';
  const TEST_FLW_HASH = 'flw_wh_hash_midepay_2026_secure';
  const TEST_FLW_SECRET = 'FLWSECK_TEST-midepay-2026';

  // Simulated PostgreSQL ledger state backing `settle_gateway_deposit` & `reverse_failed_payout`
  const settledRefs = new Map();
  const reversedRefs = new Set();
  let walletBalance = 100000.0;

  const mockDeps = {
    paystackSecret: TEST_PSK_SECRET,
    flutterwaveWebhookHash: TEST_FLW_HASH,
    flutterwaveSecretKey: TEST_FLW_SECRET,
    verifyFlutterwaveTx: async (txId, secret) => txId === 99887766 && secret === TEST_FLW_SECRET,
    settleDeposit: async ({ p_reference, p_provider, p_amount_kobo_or_ngn, p_gateway_ref }) => {
      if (settledRefs.has(p_reference)) {
        return {
          data: { success: true, already_settled: true, reference: p_reference, wallet_balance: walletBalance },
          error: null
        };
      }
      const creditNgn = p_provider === 'paystack' ? p_amount_kobo_or_ngn / 100 : p_amount_kobo_or_ngn;
      walletBalance += creditNgn;
      settledRefs.set(p_reference, { provider: p_provider, creditNgn, gatewayRef: p_gateway_ref });
      return {
        data: {
          success: true,
          already_settled: false,
          reference: p_reference,
          credited_amount: creditNgn,
          new_balance: walletBalance
        },
        error: null
      };
    },
    reversePayout: async ({ p_reference, p_reason }) => {
      const already = reversedRefs.has(p_reference);
      if (!already) {
        reversedRefs.add(p_reference);
        walletBalance += 5000;
      }
      return {
        data: { success: true, already_reversed: already, reference: p_reference, reason: p_reason },
        error: null
      };
    }
  };

  // Test A: Missing signature header rejected BEFORE JSON.parse (even on malformed JSON!)
  {
    const req = new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{malformed-json-that-must-not-be-parsed-before-hmac'
    });
    const res = await webhookMod.handlePaymentWebhookRequest(req, mockDeps);
    if (res.status === 401) pass('Missing signature rejected with HTTP 401 BEFORE JSON parsing');
    else fail(`Expected HTTP 401 for missing signature, got ${res.status}`);
  }

  // Test B: Tampered Paystack HMAC-SHA512 signature rejected with HTTP 401
  {
    const bodyStr = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'MDP-PSK-TAMPERED', status: 'success', amount: 2500000 }
    });
    const wrongSig = crypto.createHmac('sha512', 'wrong_secret').update(bodyStr).digest('hex');
    const req = new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': wrongSig },
      body: bodyStr
    });
    const res = await webhookMod.handlePaymentWebhookRequest(req, mockDeps);
    if (res.status === 401 && !settledRefs.has('MDP-PSK-TAMPERED')) {
      pass('Tampered x-paystack-signature rejected with HTTP 401 (zero ledger mutation)');
    } else {
      fail(`Tampered Paystack signature was not rejected properly (status=${res.status})`);
    }
  }

  // Test C: Invalid Flutterwave `verif-hash` rejected with HTTP 401
  {
    const bodyStr = JSON.stringify({
      event: 'charge.completed',
      data: { tx_ref: 'MDP-FLW-TAMPERED', status: 'successful', amount: 15000 }
    });
    const req = new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'verif-hash': 'forged-hash' },
      body: bodyStr
    });
    const res = await webhookMod.handlePaymentWebhookRequest(req, mockDeps);
    if (res.status === 401 && !settledRefs.has('MDP-FLW-TAMPERED')) {
      pass('Forged Flutterwave verif-hash rejected with HTTP 401');
    } else {
      fail(`Forged Flutterwave verif-hash returned status ${res.status}`);
    }
  }

  // Test D: Valid Paystack `charge.success` (500,000 kobo = ₦5,000.00) + Duplicate Webhook Idempotency
  {
    const pskPayload = {
      event: 'charge.success',
      data: {
        id: 41092831,
        reference: 'MDP-PSK-LIVE-0001',
        status: 'success',
        amount: 500000, // ₦5,000.00 in kobo
        currency: 'NGN'
      }
    };
    const rawBody = JSON.stringify(pskPayload);
    const validHmac = crypto.createHmac('sha512', TEST_PSK_SECRET).update(rawBody).digest('hex');

    const req1 = new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': validHmac },
      body: rawBody
    });
    const res1 = await webhookMod.handlePaymentWebhookRequest(req1, mockDeps);
    const json1 = await res1.json();

    if (res1.status === 200 && json1.settlement?.credited_amount === 5000 && walletBalance === 105000) {
      pass('Valid Paystack HMAC-SHA512 verified & settled ₦5,000.00 (500,000 kobo -> NGN)');
    } else {
      fail(`Paystack settlement unexpected result: ${JSON.stringify(json1)}`);
    }

    // Replay exact same webhook to verify idempotency
    const req2 = new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': validHmac },
      body: rawBody
    });
    const res2 = await webhookMod.handlePaymentWebhookRequest(req2, mockDeps);
    const json2 = await res2.json();

    if (res2.status === 200 && json2.settlement?.already_settled === true && walletBalance === 105000) {
      pass('Duplicate Paystack webhook replay safely ignored (already_settled=true, zero double-credit)');
    } else {
      fail(`Idempotency check failed: ${JSON.stringify(json2)} | balance=${walletBalance}`);
    }
  }

  // Test E: Valid Flutterwave `charge.completed` (`verif-hash` + secondary tx verification)
  {
    const flwPayload = {
      event: 'charge.completed',
      data: {
        id: 99887766,
        tx_ref: 'MDP-FLW-LIVE-0002',
        flw_ref: 'FLW-MOCK-882910',
        status: 'successful',
        amount: 20000,
        currency: 'NGN'
      }
    };
    const req = new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'verif-hash': TEST_FLW_HASH },
      body: JSON.stringify(flwPayload)
    });
    const res = await webhookMod.handlePaymentWebhookRequest(req, mockDeps);
    const json = await res.json();

    if (res.status === 200 && json.settlement?.credited_amount === 20000 && walletBalance === 125000) {
      pass('Valid Flutterwave verif-hash + secondary verification settled ₦20,000.00');
    } else {
      fail(`Flutterwave settlement failed: ${JSON.stringify(json)}`);
    }
  }

  // Test F: Paystack `transfer.reversed` triggers automatic wallet refund
  {
    const revPayload = {
      event: 'transfer.reversed',
      data: { reference: 'MDP-OUT-PSK-9901', status: 'reversed', amount: 500000 }
    };
    const rawBody = JSON.stringify(revPayload);
    const validHmac = crypto.createHmac('sha512', TEST_PSK_SECRET).update(rawBody).digest('hex');

    const req = new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': validHmac },
      body: rawBody
    });
    const res = await webhookMod.handlePaymentWebhookRequest(req, mockDeps);
    const json = await res.json();

    if (res.status === 200 && json.reversal?.success === true && walletBalance === 130000) {
      pass('Paystack transfer.reversed webhook triggered automatic payout refund');
    } else {
      fail(`Payout reversal webhook failed: ${JSON.stringify(json)}`);
    }
  }

  console.log('\n======================================================================');
  if (failures === 0) {
    console.log(' 🎉 ALL EDGE FUNCTION TYPESCRIPT & WEBHOOK CRYPTO TESTS PASSED!');
    console.log('======================================================================');
    process.exit(0);
  } else {
    console.error(` ❌ WEBHOOK VERIFICATION FAILED WITH ${failures} ERROR(S)`);
    console.log('======================================================================');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

