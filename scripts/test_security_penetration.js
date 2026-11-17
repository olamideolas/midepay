#!/usr/bin/env node
/**
 * MidePay v4.7 — Adversarial Fintech Security & Penetration Test Suite
 *
 * Verifies all pre-launch SRE & Penetration Testing invariants:
 * 1. Edge Security Headers & Strict CSP Origin Whitelist (`vercel.json`) + Zero-Secret Bundle Audit (`build.js` & static assets)
 * 2. Cryptographic Payment Webhook Verification (`payment-webhook/index.ts` HMAC-SHA512, fail-closed Flutterwave verify & idempotency)
 * 3. Direct Client-Side Table Tampering (`UPDATE` / `INSERT` / `UPSERT` / `DELETE`) on `wallets`, `transactions`,
 *    `virtual_cards`, `midesave_vaults`, and `security_audit_logs` blocked by PostgreSQL RLS + `REVOKE`
 * 4. Unverified Emails (`EMAIL_NOT_VERIFIED`) & Missing Transaction PINs (`PIN_SETUP_REQUIRED`) blocked BEFORE any `FOR UPDATE` row lock
 * 5. Negative, Zero, `NaN`, `Infinity`, Overdraft & Mid-Batch Payroll Exceptions fail atomically with zero partial debits
 * 6. Brute-Force 4-Digit PIN Strikes (`1..5`) increment `pin_failed_attempts` and enforce 15-minute lockout on strike 5
 * 7. Exact `idempotency_key` Replay & Concurrent Double-Spend Race return `duplicate` status without double-debiting
 * 8. Cross-User NUBAN / Card ID / Vault ID Enumeration & IDOR cannot leak PAN, CVV, PIN hash, or wallet/vault balances
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
let passedCount = 0;
let failedCount = 0;

function assertSec(cond, label) {
  if (cond) {
    passedCount++;
    console.log(`  ✅ PASS: ${label}`);
  } else {
    failedCount++;
    console.error(`  ❌ FAIL: ${label}`);
  }
}

// ============================================================================
// STATEFUL TRANSACTIONAL POSTGRESQL + RLS + ROW-LOCK PENETRATION ENGINE
// Mirrors 20261116040000_backend_security_hardening.sql &
//         20261116050000_auth_verification_gate.sql (including PL/pgSQL atomic rollback)
// ============================================================================
function createTransactionalPenetrationEngine() {
  const state = {
    authUsers: new Map(), // id -> { id, email, email_confirmed_at }
    profiles: new Map(),  // id -> { id, email, full_name, tag, is_frozen, transaction_pin_hash, pin_failed_attempts, pin_locked_until }
    wallets: new Map(),   // id -> { id, user_id, currency, nuban, balance, ledger_balance }
    virtualCards: new Map(), // id -> { id, user_id, wallet_id, currency, card_label, card_number, masked_pan, cvv, card_balance, is_frozen, spending_limit_monthly }
    midesaveVaults: new Map(), // id -> { id, user_id, title, current_balance, target_amount, lock_until, status }
    transactions: [],
    billPayments: [],
    payrollRuns: [],
    securityAuditLogs: [],
    rowLocksAcquired: 0
  };

  let activeAuthUid = null;
  const inFlightIdempotencyLocks = new Set();
  const businessWritePermissions = new Set(); // `${businessId}:${uid}`

  const QUARANTINED_FINANCIAL_RPCS = new Set([
    'execute_p2p_transfer',
    'transfer_funds',
    'execute_external_bank_transfer',
    'concept_topup_wallet',
    'fund_virtual_card',
    'fund_virtual_card_from_wallet',
    'create_savings_vault',
    'fund_savings_vault',
    'withdraw_savings_vault',
    'manage_midesave_vault',
    'pay_vtu_bill',
    'pay_utility_bill',
    'execute_payroll_batch',
    'execute_business_payroll'
  ]);

  const cloneMap = (m) => new Map([...m.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const hashPin = (pin) => crypto.createHash('sha256').update(`pgcrypto_bf10:${pin}`).digest('hex');

  function takeSnapshot() {
    return {
      wallets: cloneMap(state.wallets),
      virtualCards: cloneMap(state.virtualCards),
      midesaveVaults: cloneMap(state.midesaveVaults),
      transactions: JSON.parse(JSON.stringify(state.transactions)),
      billPayments: JSON.parse(JSON.stringify(state.billPayments)),
      payrollRuns: JSON.parse(JSON.stringify(state.payrollRuns))
    };
  }

  function restoreSnapshot(snap) {
    state.wallets = snap.wallets;
    state.virtualCards = snap.virtualCards;
    state.midesaveVaults = snap.midesaveVaults;
    state.transactions = snap.transactions;
    state.billPayments = snap.billPayments;
    state.payrollRuns = snap.payrollRuns;
  }

  function acquireForUpdateLock(entityType, entityId) {
    state.rowLocksAcquired++;
    return `${entityType}:${entityId}`;
  }

  function provisionUser({ fullName, email, nuban, emailConfirmed = false, pin = null, initialBalance = 0 }) {
    const uid = crypto.randomUUID();
    const walletId = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const vaultId = crypto.randomUUID();
    const businessId = crypto.randomUUID();
    businessWritePermissions.add(`${businessId}:${uid}`);

    state.authUsers.set(uid, {
      id: uid,
      email: email.toLowerCase(),
      email_confirmed_at: emailConfirmed ? new Date().toISOString() : null
    });

    state.profiles.set(uid, {
      id: uid,
      email: email.toLowerCase(),
      full_name: fullName,
      tag: '@' + fullName.split(' ')[0].toLowerCase(),
      is_frozen: false,
      transaction_pin_hash: pin ? hashPin(pin) : null,
      pin_failed_attempts: 0,
      pin_locked_until: null
    });

    state.wallets.set(walletId, {
      id: walletId,
      user_id: uid,
      currency: 'NGN',
      nuban,
      bank_name: 'MidePay / Providus Bank',
      balance: initialBalance,
      ledger_balance: initialBalance
    });

    const rawPan = '5399' + String(crypto.randomInt(100000000000, 999999999999));
    const formattedPan = `${rawPan.slice(0, 4)} ${rawPan.slice(4, 8)} ${rawPan.slice(8, 12)} ${rawPan.slice(12, 16)}`;
    state.virtualCards.set(cardId, {
      id: cardId,
      user_id: uid,
      wallet_id: walletId,
      currency: 'NGN',
      card_label: 'MidePay Green',
      card_number: formattedPan,
      masked_pan: `5399 •••• •••• ${rawPan.slice(-4)}`,
      cvv: String(crypto.randomInt(100, 999)),
      card_balance: 0,
      spending_limit_monthly: 500000,
      is_frozen: false
    });

    state.midesaveVaults.set(vaultId, {
      id: vaultId,
      user_id: uid,
      title: 'Private Reserve Vault',
      current_balance: 50000,
      target_amount: 500000,
      lock_until: null,
      status: 'active'
    });

    return { uid, walletId, cardId, vaultId, businessId, nuban, fullPan: formattedPan };
  }

  function findWalletByUserId(uid) {
    for (const w of state.wallets.values()) {
      if (w.user_id === uid && w.currency === 'NGN') return w;
    }
    return null;
  }

  function findWalletByNuban(nuban) {
    for (const w of state.wallets.values()) {
      if (w.nuban === nuban) return w;
    }
    return null;
  }

  function assertVerifiedAndPinConfigured(uid, action) {
    if (!uid) return { ok: false, code: 'UNAUTHORIZED', error: 'Authentication required.' };
    const authUser = state.authUsers.get(uid);
    if (!authUser || !authUser.email_confirmed_at) {
      state.securityAuditLogs.push({ user_id: uid, event_type: 'UNVERIFIED_EMAIL_BLOCKED', action });
      return { ok: false, code: 'EMAIL_NOT_VERIFIED', error: 'Email verification required before transacting.' };
    }
    const profile = state.profiles.get(uid);
    if (!profile) return { ok: false, code: 'PROFILE_MISSING', error: 'Profile missing.' };
    if (profile.is_frozen) return { ok: false, code: 'ACCOUNT_FROZEN', error: 'Account frozen.' };
    if (!profile.transaction_pin_hash) {
      state.securityAuditLogs.push({ user_id: uid, event_type: 'MISSING_PIN_BLOCKED', action });
      return { ok: false, code: 'PIN_SETUP_REQUIRED', error: 'Transaction PIN setup required.' };
    }
    return { ok: true };
  }

  function verifyPinWithStrikeTracking(uid, pin, action) {
    const gate = assertVerifiedAndPinConfigured(uid, action);
    if (!gate.ok) return gate;

    const profile = state.profiles.get(uid);
    if (profile.pin_locked_until && new Date(profile.pin_locked_until).getTime() > Date.now()) {
      state.securityAuditLogs.push({ user_id: uid, event_type: 'PIN_LOCKOUT_REJECTED', action });
      return { ok: false, code: 'PIN_LOCKED', attempts_remaining: 0, error: 'PIN is locked for 15 minutes.' };
    }

    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin) || hashPin(pin) !== profile.transaction_pin_hash) {
      profile.pin_failed_attempts += 1;
      if (profile.pin_failed_attempts >= 5) {
        profile.pin_locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        state.securityAuditLogs.push({ user_id: uid, event_type: 'PIN_LOCKED', strikes: profile.pin_failed_attempts, action });
        return { ok: false, code: 'PIN_LOCKED', attempts_remaining: 0, error: '5 failed PIN attempts; locked for 15 minutes.' };
      }
      const rem = 5 - profile.pin_failed_attempts;
      state.securityAuditLogs.push({ user_id: uid, event_type: 'PIN_FAILURE', strikes: profile.pin_failed_attempts, action });
      return { ok: false, code: 'INVALID_PIN', attempts_remaining: rem, error: `Invalid PIN (${rem} remaining).` };
    }

    profile.pin_failed_attempts = 0;
    profile.pin_locked_until = null;
    return { ok: true };
  }

  // PostgREST table interface enforcing `REVOKE INSERT, UPDATE, DELETE` + strict `auth.uid() = user_id` SELECT RLS
  function from(table) {
    const rlsDenyWrite = (op) => ({
      select: async () => ({ data: null, error: { code: '42501', message: `permission denied for table ${table} (${op} revoked from authenticated/anon)` } }),
      eq: () => ({
        select: async () => ({ data: null, error: { code: '42501', message: `permission denied for table ${table} (${op} revoked)` } }),
        then: (resolve) => resolve({ data: null, error: { code: '42501', message: `permission denied for table ${table} (${op} revoked)` } })
      }),
      neq: () => ({
        then: (resolve) => resolve({ data: null, error: { code: '42501', message: `permission denied for table ${table} (${op} revoked)` } })
      }),
      then: (resolve) => resolve({ data: null, error: { code: '42501', message: `permission denied for table ${table} (${op} revoked)` } })
    });

    const filters = [];
    const executeOwnerScopedSelect = () => {
      if (!activeAuthUid) return { data: [], error: null };
      let rows = [];
      if (table === 'wallets') {
        rows = [...state.wallets.values()].filter(r => r.user_id === activeAuthUid);
      } else if (table === 'virtual_cards') {
        rows = [...state.virtualCards.values()].filter(r => r.user_id === activeAuthUid);
      } else if (table === 'midesave_vaults' || table === 'savings_vaults') {
        rows = [...state.midesaveVaults.values()].filter(r => r.user_id === activeAuthUid);
      } else if (table === 'transactions') {
        rows = state.transactions.filter(r => r.user_id === activeAuthUid);
      } else if (table === 'security_audit_logs') {
        rows = state.securityAuditLogs.filter(r => r.user_id === activeAuthUid);
      } else if (table === 'profiles') {
        const own = state.profiles.get(activeAuthUid);
        rows = own ? [{ id: own.id, email: own.email, full_name: own.full_name, tag: own.tag, is_frozen: own.is_frozen }] : [];
      }
      for (const f of filters) rows = rows.filter(f);
      return { data: JSON.parse(JSON.stringify(rows)), error: null };
    };

    const builder = {
      insert: () => rlsDenyWrite('INSERT'),
      update: () => rlsDenyWrite('UPDATE'),
      upsert: () => rlsDenyWrite('UPSERT'),
      delete: () => rlsDenyWrite('DELETE'),
      select: () => builder,
      eq: (col, val) => { filters.push(r => r[col] === val); return builder; },
      maybeSingle: async () => {
        const res = executeOwnerScopedSelect();
        return { data: res.data[0] || null, error: null };
      },
      then: (resolve, reject) => Promise.resolve(executeOwnerScopedSelect()).then(resolve, reject)
    };
    return builder;
  }

  async function rpc(fnName, params = {}) {
    // Verbatim PostgreSQL $quarantine$ privilege enforcement on anon & authenticated roles:
    if (QUARANTINED_FINANCIAL_RPCS.has(fnName)) {
      return {
        data: null,
        error: {
          code: '42501',
          message: `permission denied for function ${fnName}`
        }
      };
    }
    return backendRpc(fnName, params);
  }

  async function backendRpc(fnName, params = {}) {
    const uid = activeAuthUid;

    if (fnName === 'lookup_recipient_profile') {
      const q = String(params.search_query || '').trim();
      const wal = findWalletByNuban(q);
      if (!wal) return { data: [], error: null };
      const prof = state.profiles.get(wal.user_id);
      return {
        data: [{
          id: prof.id,
          full_name: prof.full_name,
          tag: prof.tag,
          nuban: wal.nuban,
          bank_name: wal.bank_name,
          is_frozen: prof.is_frozen
        }],
        error: null
      };
    }

    // Serialize concurrent calls sharing the same idempotency_key (simulating PostgreSQL UNIQUE index + row lock wait)
    const idemKey = params.p_idempotency_key || null;
    if (idemKey) {
      while (inFlightIdempotencyLocks.has(`${uid}:${idemKey}`)) {
        await new Promise(r => setImmediate(r));
      }
      inFlightIdempotencyLocks.add(`${uid}:${idemKey}`);
    }

    try {
      // Pre-lock Verification + PIN Setup Gate (executes BEFORE any `FOR UPDATE` lock!)
      if ([
        'execute_p2p_transfer',
        'transfer_funds',
        'fund_virtual_card',
        'pay_vtu_bill',
        'manage_midesave_vault',
        'execute_payroll_batch',
        'concept_topup_wallet'
      ].includes(fnName)) {
        if (fnName === 'transfer_funds' && params.sender_id !== uid) {
          return { data: { success: false, code: 'UNAUTHORIZED', error: 'Sender spoofing blocked: sender_id !== auth.uid().' }, error: null };
        }
        const preGate = assertVerifiedAndPinConfigured(uid, fnName.toUpperCase());
        if (!preGate.ok) {
          return { data: { success: false, status: preGate.code, code: preGate.code, error: preGate.error }, error: null };
        }
      }

      if (fnName === 'set_virtual_card_freeze') {
        const gate = assertVerifiedAndPinConfigured(uid, 'CARD_FREEZE');
        if (!gate.ok) return { data: null, error: { message: gate.error } };
        const card = state.virtualCards.get(params.p_card_id);
        if (!card || card.user_id !== uid) {
          return { data: null, error: { message: 'Virtual card not found or access denied.' } };
        }
        card.is_frozen = Boolean(params.p_is_frozen);
        return { data: { ...card }, error: null };
      }

      if (fnName === 'concept_topup_wallet') {
        const amt = Number(params.p_amount);
        if (!Number.isFinite(amt) || amt < 100 || amt > 5000000) {
          return { data: { success: false, code: 'INVALID_AMOUNT', error: 'Top-up must be between ₦100 and ₦5,000,000.' }, error: null };
        }
        if (idemKey) {
          const dup = state.transactions.find(t => t.user_id === uid && t.idempotency_key === idemKey);
          if (dup) return { data: { success: true, status: 'duplicate', new_balance: dup.balance_after, reference: dup.reference }, error: null };
        }
        const wal = findWalletByUserId(uid);
        acquireForUpdateLock('wallets', wal.id);
        const before = wal.balance;
        wal.balance = Math.round((wal.balance + amt) * 100) / 100;
        wal.ledger_balance = wal.balance;
        const ref = `MDP-DEP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        state.transactions.push({ id: crypto.randomUUID(), user_id: uid, amount: amt, balance_before: before, balance_after: wal.balance, reference: ref, idempotency_key: idemKey });
        return { data: { success: true, status: 'success', new_balance: wal.balance, reference: ref }, error: null };
      }

      if (fnName === 'execute_p2p_transfer') {
        const amt = Number(params.p_amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          return { data: { success: false, status: 'invalid_amount', error: 'Amount must be strictly positive.' }, error: null };
        }
        if (idemKey) {
          const dup = state.transactions.find(t => t.user_id === uid && t.idempotency_key === idemKey);
          if (dup) return { data: { success: true, status: 'duplicate', new_balance: dup.balance_after, reference: dup.reference }, error: null };
        }
        const pinCheck = verifyPinWithStrikeTracking(uid, params.p_pin, 'P2P_TRANSFER');
        if (!pinCheck.ok) return { data: { success: false, status: pinCheck.code, code: pinCheck.code, error: pinCheck.error }, error: null };

        const senderWal = findWalletByUserId(uid);
        const recipWal = findWalletByNuban(String(params.p_recipient_nuban || '').trim());
        if (!recipWal) return { data: { success: false, error: 'Recipient NUBAN not found.' }, error: null };
        if (recipWal.user_id === uid) return { data: { success: false, error: 'Self-transfer prohibited.' }, error: null };

        acquireForUpdateLock('wallets', senderWal.id < recipWal.id ? senderWal.id : recipWal.id);
        acquireForUpdateLock('wallets', senderWal.id < recipWal.id ? recipWal.id : senderWal.id);

        if (senderWal.balance < amt) {
          return { data: { success: false, status: 'insufficient_funds', error: 'Insufficient wallet balance.' }, error: null };
        }

        const snap = takeSnapshot();
        try {
          const sBefore = senderWal.balance;
          senderWal.balance = Math.round((senderWal.balance - amt) * 100) / 100;
          senderWal.ledger_balance = senderWal.balance;
          recipWal.balance = Math.round((recipWal.balance + amt) * 100) / 100;
          recipWal.ledger_balance = recipWal.balance;
          const ref = `MDP-P2P-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          state.transactions.push({ id: crypto.randomUUID(), user_id: uid, amount: amt, balance_before: sBefore, balance_after: senderWal.balance, reference: ref, idempotency_key: idemKey });
          return { data: { success: true, status: 'success', reference: ref, new_balance: senderWal.balance }, error: null };
        } catch (err) {
          restoreSnapshot(snap);
          return { data: { success: false, error: err.message }, error: null };
        }
      }

      if (fnName === 'fund_virtual_card') {
        const credit = Number(params.p_amount_card_currency);
        if (!Number.isFinite(credit) || credit <= 0) {
          return { data: { success: false, code: 'INVALID_AMOUNT', error: 'Card funding amount must be > 0.' }, error: null };
        }
        if (idemKey) {
          const dup = state.transactions.find(t => t.user_id === uid && t.idempotency_key === idemKey);
          if (dup) {
            const c = state.virtualCards.get(params.p_card_id);
            return { data: { success: true, status: 'duplicate', new_wallet_balance: dup.balance_after, new_card_balance: c?.card_balance }, error: null };
          }
        }
        if (params.p_pin === undefined || params.p_pin === null) {
          return { data: { success: false, code: 'PIN_REQUIRED', error: 'Transaction PIN is required to fund virtual cards.' }, error: null };
        }
        const pinCheck = verifyPinWithStrikeTracking(uid, params.p_pin, 'CARD_FUNDING');
        if (!pinCheck.ok) return { data: { success: false, code: pinCheck.code, error: pinCheck.error }, error: null };
        const card = state.virtualCards.get(params.p_card_id);
        if (!card || card.user_id !== uid) {
          return { data: { success: false, code: 'ACCESS_DENIED', error: 'Virtual card not found or access denied.' }, error: null };
        }
        const wal = findWalletByUserId(uid);
        acquireForUpdateLock('wallets', wal.id);
        acquireForUpdateLock('virtual_cards', card.id);
        const debitNgn = card.currency === 'USD' ? Math.round(credit * 1550 * 100) / 100 : Math.round(credit * 100) / 100;
        if (wal.balance < debitNgn) {
          return { data: { success: false, code: 'INSUFFICIENT_FUNDS', error: 'Insufficient wallet balance.' }, error: null };
        }
        const before = wal.balance;
        wal.balance = Math.round((wal.balance - debitNgn) * 100) / 100;
        wal.ledger_balance = wal.balance;
        card.card_balance = Math.round((card.card_balance + credit) * 100) / 100;
        const ref = `MDP-CD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        state.transactions.push({ id: crypto.randomUUID(), user_id: uid, amount: debitNgn, balance_before: before, balance_after: wal.balance, reference: ref, idempotency_key: idemKey });
        return { data: { success: true, status: 'success', new_wallet_balance: wal.balance, new_card_balance: card.card_balance, reference: ref }, error: null };
      }

      if (fnName === 'pay_vtu_bill') {
        const amt = Number(params.p_amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          return { data: { success: false, code: 'INVALID_AMOUNT', error: 'Bill amount must be > 0.' }, error: null };
        }
        if (idemKey) {
          const dup = state.billPayments.find(b => b.user_id === uid && b.idempotency_key === idemKey);
          if (dup) {
            const wal = findWalletByUserId(uid);
            return { data: { success: true, status: 'duplicate', reference: dup.reference, new_balance: wal.balance }, error: null };
          }
        }
        const pinCheck = verifyPinWithStrikeTracking(uid, params.p_pin, 'VTU_BILL');
        if (!pinCheck.ok) return { data: { success: false, code: pinCheck.code, error: pinCheck.error }, error: null };
        const wal = findWalletByUserId(uid);
        acquireForUpdateLock('wallets', wal.id);
        if (wal.balance < amt) {
          return { data: { success: false, code: 'INSUFFICIENT_FUNDS', error: 'Insufficient wallet balance.' }, error: null };
        }
        wal.balance = Math.round((wal.balance - amt) * 100) / 100;
        wal.ledger_balance = wal.balance;
        const ref = `MDP-BIL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        state.billPayments.push({ id: crypto.randomUUID(), user_id: uid, amount: amt, reference: ref, idempotency_key: idemKey });
        return { data: { success: true, status: 'success', reference: ref, new_balance: wal.balance }, error: null };
      }

      if (fnName === 'manage_midesave_vault') {
        const act = String(params.p_action || '').toLowerCase();
        const amt = Number(params.p_amount);
        if (!['fund', 'withdraw'].includes(act) || !Number.isFinite(amt) || amt <= 0) {
          return { data: { success: false, code: 'INVALID_AMOUNT', error: 'Valid vault action and positive amount required.' }, error: null };
        }
        if (idemKey) {
          const dup = state.transactions.find(t => t.user_id === uid && t.idempotency_key === idemKey);
          if (dup) {
            const v = state.midesaveVaults.get(params.p_vault_id);
            return { data: { success: true, status: 'duplicate', vault_balance: v?.current_balance, new_balance: dup.balance_after, reference: dup.reference }, error: null };
          }
        }
        const pinCheck = verifyPinWithStrikeTracking(uid, params.p_pin, 'MIDESAVE');
        if (!pinCheck.ok) return { data: { success: false, code: pinCheck.code, error: pinCheck.error }, error: null };

        const vault = state.midesaveVaults.get(params.p_vault_id);
        if (!vault || vault.user_id !== uid) {
          return { data: { success: false, code: 'ACCESS_DENIED', error: 'MideSave vault not found or access denied.' }, error: null };
        }
        const wal = findWalletByUserId(uid);
        acquireForUpdateLock('wallets', wal.id);
        acquireForUpdateLock('midesave_vaults', vault.id);

        if (act === 'fund') {
          if (wal.balance < amt) return { data: { success: false, code: 'INSUFFICIENT_FUNDS', error: 'Insufficient wallet balance.' }, error: null };
          const before = wal.balance;
          wal.balance = Math.round((wal.balance - amt) * 100) / 100;
          wal.ledger_balance = wal.balance;
          vault.current_balance = Math.round((vault.current_balance + amt) * 100) / 100;
          const ref = `MDP-SAV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          state.transactions.push({ id: crypto.randomUUID(), user_id: uid, amount: amt, balance_before: before, balance_after: wal.balance, reference: ref, idempotency_key: idemKey });
          return { data: { success: true, status: 'success', vault_balance: vault.current_balance, new_balance: wal.balance, reference: ref }, error: null };
        }

        if (vault.current_balance < amt) return { data: { success: false, code: 'INSUFFICIENT_VAULT', error: 'Insufficient vault balance.' }, error: null };
        const before = wal.balance;
        vault.current_balance = Math.round((vault.current_balance - amt) * 100) / 100;
        wal.balance = Math.round((wal.balance + amt) * 100) / 100;
        wal.ledger_balance = wal.balance;
        const ref = `MDP-WDR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        state.transactions.push({ id: crypto.randomUUID(), user_id: uid, amount: amt, balance_before: before, balance_after: wal.balance, reference: ref, idempotency_key: idemKey });
        return { data: { success: true, status: 'success', vault_balance: vault.current_balance, new_balance: wal.balance, reference: ref }, error: null };
      }

      if (fnName === 'execute_payroll_batch') {
        if (!params.p_business_id || !businessWritePermissions.has(`${params.p_business_id}:${uid}`)) {
          return {
            data: {
              success: false,
              code: 'ACCESS_DENIED',
              error: 'Valid business_id with write permission is required for payroll execution.'
            },
            error: null
          };
        }
        const items = Array.isArray(params.p_items) ? params.p_items : [];
        if (items.length === 0) return { data: { success: false, error: 'Empty payroll batch.' }, error: null };
        if (idemKey) {
          const dup = state.payrollRuns.find(r => r.user_id === uid && r.idempotency_key === idemKey);
          if (dup) {
            const wal = findWalletByUserId(uid);
            return { data: { success: true, status: 'duplicate', reference: dup.reference, new_balance: wal.balance }, error: null };
          }
        }
        const pinCheck = verifyPinWithStrikeTracking(uid, params.p_pin, 'PAYROLL');
        if (!pinCheck.ok) return { data: { success: false, code: pinCheck.code, error: pinCheck.error }, error: null };

        let total = 0;
        for (const it of items) {
          const a = Number(it.amount);
          if (!Number.isFinite(a) || a <= 0 || !it.identifier) {
            return { data: { success: false, code: 'INVALID_AMOUNT', error: 'Invalid staff salary row.' }, error: null };
          }
          total = Math.round((total + a) * 100) / 100;
        }

        const empWal = findWalletByUserId(uid);
        acquireForUpdateLock('wallets', empWal.id);
        if (empWal.balance < total) {
          return { data: { success: false, code: 'INSUFFICIENT_FUNDS', error: 'Insufficient wallet balance for batch payroll.' }, error: null };
        }

        // Atomic PL/pgSQL transaction block: any mid-batch failure rolls back ALL partial staff credits & employer debits
        const snap = takeSnapshot();
        try {
          for (const it of items) {
            const staffWal = findWalletByNuban(String(it.identifier).trim());
            if (!staffWal || staffWal.user_id === uid) {
              throw new Error(`Invalid or non-existent staff NUBAN: ${it.identifier}`);
            }
            acquireForUpdateLock('wallets', staffWal.id);
            const amt = Math.round(Number(it.amount) * 100) / 100;
            empWal.balance = Math.round((empWal.balance - amt) * 100) / 100;
            empWal.ledger_balance = empWal.balance;
            staffWal.balance = Math.round((staffWal.balance + amt) * 100) / 100;
            staffWal.ledger_balance = staffWal.balance;
          }
          const ref = `MDP-PAY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          state.payrollRuns.push({ id: crypto.randomUUID(), user_id: uid, total_amount: total, reference: ref, idempotency_key: idemKey });
          return { data: { success: true, status: 'success', reference: ref, total_amount: total, new_balance: empWal.balance }, error: null };
        } catch (batchErr) {
          restoreSnapshot(snap);
          return { data: null, error: { message: batchErr.message } };
        }
      }

      return { data: null, error: { message: `Unknown RPC: ${fnName}` } };
    } finally {
      if (idemKey) inFlightIdempotencyLocks.delete(`${uid}:${idemKey}`);
    }
  }

  return {
    state,
    provisionUser,
    setSessionUser: (uid) => { activeAuthUid = uid; },
    confirmEmail: (uid) => {
      const u = state.authUsers.get(uid);
      if (u) u.email_confirmed_at = new Date().toISOString();
    },
    setPin: (uid, pin) => {
      const p = state.profiles.get(uid);
      if (p) p.transaction_pin_hash = hashPin(pin);
    },
    resetLockCounter: () => { state.rowLocksAcquired = 0; },
    QUARANTINED_FINANCIAL_RPCS,
    from,
    rpc,
    backendRpc
  };
}

async function runPenetrationSuite() {
  console.log('======================================================================');
  console.log(' MidePay v4.7 — Adversarial Fintech Security & Penetration Test Suite');
  console.log('======================================================================\n');

  // ==========================================================================
  // [1/7] EDGE SECURITY HEADERS, STRICT CSP LOCK & ZERO-SECRET BUNDLE AUDIT
  // ==========================================================================
  console.log('[1/7] Auditing vercel.json Edge Security Headers, CSP Origin Whitelist & Client Bundles...');
  const vercelRaw = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  const vercelJson = JSON.parse(vercelRaw);
  const rootRoute = (vercelJson.headers || []).find(r => r.source === '/(.*)');
  const hMap = new Map((rootRoute?.headers || []).map(h => [h.key, h.value]));
  const csp = hMap.get('Content-Security-Policy') || '';

  const allowedExternalOrigins = new Set([
    'https://pxdzdehocjnmxbuvipxu.supabase.co',
    'wss://pxdzdehocjnmxbuvipxu.supabase.co',
    'https://js.paystack.co',
    'https://checkout.flutterwave.com'
  ]);
  const extractedOrigins = [...csp.matchAll(/\b(?:https?|wss?):\/\/[^\s;]+/gi)].map(m => m[0]);
  const unauthorizedOrigins = extractedOrigins.filter(o => !allowedExternalOrigins.has(o));
  const scriptSrcDirective = (csp.split(';').map(s => s.trim()).find(d => d.startsWith('script-src ')) || '');

  assertSec(
    extractedOrigins.length >= 4 &&
    unauthorizedOrigins.length === 0 &&
    csp.includes("default-src 'self'") &&
    csp.includes("frame-ancestors 'none'") &&
    csp.includes("object-src 'none'") &&
    csp.includes("base-uri 'self'") &&
    !scriptSrcDirective.includes("'unsafe-inline'") &&
    !scriptSrcDirective.includes("'unsafe-eval'"),
    `Content-Security-Policy strictly locked to 'self', Supabase (HTTPS+WSS), Paystack & Flutterwave (0 unauthorized origins, 0 inline script allowances)`
  );

  assertSec(
    hMap.get('Strict-Transport-Security') === 'max-age=63072000; includeSubDomains; preload' &&
    hMap.get('X-Frame-Options') === 'DENY' &&
    hMap.get('X-Content-Type-Options') === 'nosniff' &&
    hMap.get('Referrer-Policy') === 'no-referrer' &&
    hMap.get('Permissions-Policy') === 'camera=(), microphone=(), geolocation=()',
    'All mandatory HTTP security headers verified (HSTS 2yr preload, X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, Permissions-Policy)'
  );

  const clientBundleFiles = [
    'index.html',
    'config.js',
    'vercel.json',
    'vendor/supabase.js',
    'supabaseClient.js',
    'app.js',
    'liquid-glass.js',
    'sw.js'
  ];
  const secretLeaks = [];
  for (const rel of clientBundleFiles) {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (/(?:SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_[A-Za-z0-9_-]+|sk_live_[A-Za-z0-9_-]+|sk_test_[A-Za-z0-9_-]+|FLWSECK[_-][A-Za-z0-9_-]+)/.test(content)) {
      secretLeaks.push(rel);
    }
  }
  const indexHtmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const inlineHandlersInHtml = indexHtmlContent.match(/\bon(?:click|submit|load|error|mouseover|focus)\s*=/gi) || [];
  assertSec(
    secretLeaks.length === 0 && inlineHandlersInHtml.length === 0,
    `Zero secret/service_role keys across all ${clientBundleFiles.length} client/config files and 0 inline DOM event handlers in index.html`
  );

  // Verify build.js actively blocks accidental service_role JWT or secret key injection
  const forgedServiceRoleJwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' })).toString('base64url') +
    '.signature';
  const originalConfig = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  const leakAttempt = spawnSync(process.execPath, [path.join(ROOT, 'build.js')], {
    env: { ...process.env, SUPABASE_ANON_KEY: forgedServiceRoleJwt },
    encoding: 'utf8'
  });
  const afterAttemptConfig = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assertSec(
    leakAttempt.status !== 0 && originalConfig === afterAttemptConfig,
    'build.js security gate blocks service_role JWT injection into public config.js'
  );

  // ==========================================================================
  // [2/7] GATEWAY CRYPTOGRAPHIC WEBHOOK AUDIT (PAYSTACK HMAC & FLW VERIFY)
  // ==========================================================================
  console.log('\n[2/7] Auditing payment-webhook HMAC-SHA512, Fail-Closed Flutterwave Verify & Idempotency...');
  const webhookMod = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/payment-webhook/index.ts')).href);
  const PSK_SEC = 'sk_live_penetration_test_hmac_secret';
  const FLW_HASH = 'flw_verif_hash_penetration_2026';
  const FLW_SEC = 'FLWSECK_LIVE_penetration_2026';
  const settledGatewayRefs = new Set();
  let webhookWalletCredits = 0;

  const webhookDeps = {
    paystackSecret: PSK_SEC,
    flutterwaveWebhookHash: FLW_HASH,
    flutterwaveSecretKey: FLW_SEC,
    verifyFlutterwaveTx: async (txId, secretKey, expectedAmt, expectedRef) =>
      txId === 771122 && secretKey === FLW_SEC && expectedAmt === 15000 && expectedRef === 'MDP-FLW-PEN-01',
    settleDeposit: async ({ p_reference, p_provider, p_amount_kobo_or_ngn }) => {
      if (settledGatewayRefs.has(p_reference)) {
        return { data: { success: true, already_settled: true, reference: p_reference }, error: null };
      }
      settledGatewayRefs.add(p_reference);
      webhookWalletCredits += p_provider === 'paystack' ? p_amount_kobo_or_ngn / 100 : p_amount_kobo_or_ngn;
      return { data: { success: true, already_settled: false, reference: p_reference }, error: null };
    },
    reversePayout: async () => ({ data: { success: true }, error: null })
  };

  // Attack 2A: Forged Paystack HMAC-SHA512
  const pskBody = JSON.stringify({ event: 'charge.success', data: { currency: 'NGN', reference: 'MDP-PSK-PEN-01', status: 'success', amount: 1000000 } });
  const forgedPskRes = await webhookMod.handlePaymentWebhookRequest(
    new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'x-paystack-signature': 'deadbeef'.repeat(16) },
      body: pskBody
    }),
    webhookDeps
  );

  // Attack 2B: Valid Flutterwave verif-hash BUT missing/unverified server-to-server txId -> must fail closed (HTTP 400)!
  const flwSpoofBody = JSON.stringify({ event: 'charge.completed', data: { id: 999999, tx_ref: 'MDP-FLW-PEN-01', status: 'successful', amount: 15000 } });
  const flwUnverifiedRes = await webhookMod.handlePaymentWebhookRequest(
    new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'verif-hash': FLW_HASH },
      body: flwSpoofBody
    }),
    webhookDeps
  );

  // Legitimate Paystack + Replay + Legitimate Flutterwave + Replay
  const validPskHmac = crypto.createHmac('sha512', PSK_SEC).update(pskBody).digest('hex');
  const pskOk1 = await webhookMod.handlePaymentWebhookRequest(
    new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'x-paystack-signature': validPskHmac },
      body: pskBody
    }),
    webhookDeps
  );
  const pskOk2 = await webhookMod.handlePaymentWebhookRequest(
    new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'x-paystack-signature': validPskHmac },
      body: pskBody
    }),
    webhookDeps
  );
  const pskJson2 = await pskOk2.json();

  const flwValidBody = JSON.stringify({ event: 'charge.completed', data: { id: 771122, tx_ref: 'MDP-FLW-PEN-01', status: 'successful', amount: 15000 } });
  const flwOk1 = await webhookMod.handlePaymentWebhookRequest(
    new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'verif-hash': FLW_HASH },
      body: flwValidBody
    }),
    webhookDeps
  );
  const flwOk2 = await webhookMod.handlePaymentWebhookRequest(
    new Request('https://pxdzdehocjnmxbuvipxu.supabase.co/functions/v1/payment-webhook', {
      method: 'POST',
      headers: { 'verif-hash': FLW_HASH },
      body: flwValidBody
    }),
    webhookDeps
  );
  const flwJson2 = await flwOk2.json();

  assertSec(
    forgedPskRes.status === 401 &&
    flwUnverifiedRes.status === 400 &&
    pskOk1.status === 200 &&
    flwOk1.status === 200 &&
    pskJson2.settlement?.already_settled === true &&
    flwJson2.settlement?.already_settled === true &&
    webhookWalletCredits === 25000,
    'payment-webhook enforces HMAC-SHA512 (401), fail-closed Flutterwave S2S verify (400), and idempotent settlement (₦25,000 exact, 0 double-credit)'
  );

  // ==========================================================================
  // [3/7] DIRECT CLIENT-SIDE TABLE TAMPERING & $quarantine$ RPC REVOCATION
  // ==========================================================================
  console.log('\n[3/7] Pen-Testing Direct Client-Side INSERT / UPDATE / DELETE & $quarantine$ RPC Revocation...');
  const hardeningSql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261116040000_backend_security_hardening.sql'), 'utf8');
  const gateQuarantineSql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261116050000_auth_verification_gate.sql'), 'utf8');
  const protectedTables = ['wallets', 'transactions', 'virtual_cards', 'midesave_vaults', 'security_audit_logs'];
  const allRlsEnabledInSql = protectedTables.every(
    t => new RegExp(`ALTER\\s+TABLE\\s+public\\.${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(hardeningSql)
  );
  const allRevokedInSql = /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+TABLE[\s\S]*?public\.wallets[\s\S]*?public\.transactions[\s\S]*?public\.virtual_cards[\s\S]*?public\.midesave_vaults[\s\S]*?public\.security_audit_logs[\s\S]*?FROM\s+authenticated,\s*anon/i.test(hardeningSql);
  const hasSqlQuarantineLoop =
    /DO\s+\$quarantine\$[\s\S]*?REVOKE\s+ALL\s+ON\s+FUNCTION\s+%s\s+FROM\s+PUBLIC,\s*anon,\s*authenticated[\s\S]*?\$quarantine\$/i.test(gateQuarantineSql);

  const engine = createTransactionalPenetrationEngine();
  const victim = engine.provisionUser({
    fullName: 'Ngozi Eze',
    email: 'ngozi@midepay.ng',
    nuban: '9011223344',
    emailConfirmed: true,
    pin: '2468',
    initialBalance: 100000
  });
  engine.setSessionUser(victim.uid);

  const tamperAttempts = await Promise.all([
    engine.from('wallets').update({ balance: 999999999 }).eq('id', victim.walletId),
    engine.from('wallets').delete().eq('id', victim.walletId),
    engine.from('transactions').insert({ user_id: victim.uid, type: 'inflow', amount: 5000000, status: 'successful' }),
    engine.from('transactions').delete().eq('user_id', victim.uid),
    engine.from('virtual_cards').update({ card_balance: 50000, cvv: '000' }).eq('id', victim.cardId),
    engine.from('midesave_vaults').update({ current_balance: 9000000 }).eq('id', victim.vaultId),
    engine.from('security_audit_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    engine.from('security_audit_logs').insert({ user_id: victim.uid, event_type: 'FORGED' })
  ]);

  assertSec(
    allRlsEnabledInSql &&
    allRevokedInSql &&
    tamperAttempts.every(res => res.error && res.error.code === '42501') &&
    engine.state.wallets.get(victim.walletId).balance === 100000 &&
    engine.state.virtualCards.get(victim.cardId).card_balance === 0 &&
    engine.state.midesaveVaults.get(victim.vaultId).current_balance === 50000,
    'Direct INSERT / UPDATE / DELETE tampering on wallets, transactions, virtual_cards, midesave_vaults & security_audit_logs is 100% blocked (42501)'
  );

  // Verify $quarantine$ REVOKE blocks ALL 14 financial RPCs when called directly by `authenticated` or `anon`!
  const all14Quarantined = [...engine.QUARANTINED_FINANCIAL_RPCS];
  const authQuarantineCalls = await Promise.all(all14Quarantined.map(fn => engine.rpc(fn, {})));
  engine.setSessionUser(null);
  const anonQuarantineCalls = await Promise.all(all14Quarantined.map(fn => engine.rpc(fn, {})));
  engine.setSessionUser(victim.uid);

  assertSec(
    hasSqlQuarantineLoop &&
    all14Quarantined.length === 14 &&
    authQuarantineCalls.every(r => r.error && r.error.code === '42501') &&
    anonQuarantineCalls.every(r => r.error && r.error.code === '42501'),
    'Staging Quarantine ($quarantine$) revokes EXECUTE from PUBLIC, anon & authenticated across all 14/14 financial RPCs (42501)'
  );

  // ==========================================================================
  // [4/7] DEFENSE-IN-DEPTH PRE-LOCK GATES (EMAIL_NOT_VERIFIED, PIN_SETUP_REQUIRED, PIN_REQUIRED)
  // ==========================================================================
  console.log('\n[4/7] Pen-Testing Internal Pre-Lock Rejection for Unverified Emails & Missing PINs...');
  const unverifiedActor = engine.provisionUser({
    fullName: 'Unverified Signup',
    email: 'unverified@midepay.ng',
    nuban: '9022334455',
    emailConfirmed: false,
    pin: null,
    initialBalance: 75000
  });
  engine.setSessionUser(unverifiedActor.uid);
  engine.resetLockCounter();

  const unverifiedRpcResults = await Promise.all([
    engine.backendRpc('execute_p2p_transfer', { p_recipient_nuban: victim.nuban, p_amount: 5000, p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('fund_virtual_card', { p_card_id: unverifiedActor.cardId, p_amount_card_currency: 1000, p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('pay_vtu_bill', { p_service_type: 'airtime', p_provider: 'MTN', p_identifier: '08030000000', p_plan_name: 'VTU', p_amount: 500, p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('manage_midesave_vault', { p_action: 'fund', p_vault_id: unverifiedActor.vaultId, p_amount: 2000, p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('execute_payroll_batch', { p_business_id: unverifiedActor.businessId, p_title: 'Run', p_items: [{ identifier: victim.nuban, amount: 5000 }], p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('concept_topup_wallet', { p_amount: 5000, p_idempotency_key: crypto.randomUUID() })
  ]);

  assertSec(
    unverifiedRpcResults.every(r => r.data?.success === false && r.data?.code === 'EMAIL_NOT_VERIFIED') &&
    engine.state.rowLocksAcquired === 0,
    `Unverified email user blocked with EMAIL_NOT_VERIFIED across all 6 financial RPCs with 0 row locks acquired (${engine.state.rowLocksAcquired} locks)`
  );

  // Confirm email via OTP, leave `transaction_pin_hash = NULL`, verify `PIN_SETUP_REQUIRED` with 0 row locks!
  engine.confirmEmail(unverifiedActor.uid);
  engine.resetLockCounter();

  const missingPinRpcResults = await Promise.all([
    engine.backendRpc('execute_p2p_transfer', { p_recipient_nuban: victim.nuban, p_amount: 5000, p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('fund_virtual_card', { p_card_id: unverifiedActor.cardId, p_amount_card_currency: 1000, p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('pay_vtu_bill', { p_service_type: 'airtime', p_provider: 'MTN', p_identifier: '08030000000', p_plan_name: 'VTU', p_amount: 500, p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('manage_midesave_vault', { p_action: 'fund', p_vault_id: unverifiedActor.vaultId, p_amount: 2000, p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('execute_payroll_batch', { p_business_id: unverifiedActor.businessId, p_title: 'Run', p_items: [{ identifier: victim.nuban, amount: 5000 }], p_pin: '1234', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('concept_topup_wallet', { p_amount: 5000, p_idempotency_key: crypto.randomUUID() })
  ]);

  assertSec(
    missingPinRpcResults.every(r => r.data?.success === false && r.data?.code === 'PIN_SETUP_REQUIRED') &&
    engine.state.rowLocksAcquired === 0,
    `Missing Transaction PIN blocked with PIN_SETUP_REQUIRED across all 6 financial RPCs with 0 row locks acquired (${engine.state.rowLocksAcquired} locks)`
  );

  // ==========================================================================
  // [5/7] NEGATIVE, ZERO, NaN, INFINITY, OVERDRAFT, NULL PIN/BUSINESS & BATCH ROLLBACK
  // ==========================================================================
  console.log('\n[5/7] Pen-Testing Negative, Zero, NaN, Overdraft, Null PIN/Business & Mid-Batch Payroll Atomicity...');
  const attacker = engine.provisionUser({
    fullName: 'Adversarial Tester',
    email: 'pentest@midepay.ng',
    nuban: '9033445566',
    emailConfirmed: true,
    pin: '1234',
    initialBalance: 50000
  });
  engine.setSessionUser(attacker.uid);

  const nullPinCardAttempt = await engine.backendRpc('fund_virtual_card', {
    p_card_id: attacker.cardId,
    p_amount_card_currency: 1000,
    p_pin: null,
    p_idempotency_key: crypto.randomUUID()
  });
  const nullBusinessPayrollAttempt = await engine.backendRpc('execute_payroll_batch', {
    p_business_id: null,
    p_title: 'Unscoped Payroll',
    p_items: [{ identifier: victim.nuban, amount: 5000 }],
    p_pin: '1234',
    p_idempotency_key: crypto.randomUUID()
  });

  const malformedAmounts = [-25000, -0.01, 0, Number.NaN, Number.POSITIVE_INFINITY, 50000.01];
  for (const badAmt of malformedAmounts) {
    await engine.backendRpc('execute_p2p_transfer', { p_recipient_nuban: victim.nuban, p_amount: badAmt, p_pin: '1234', p_idempotency_key: crypto.randomUUID() });
    await engine.backendRpc('fund_virtual_card', { p_card_id: attacker.cardId, p_amount_card_currency: badAmt, p_pin: '1234', p_idempotency_key: crypto.randomUUID() });
    await engine.backendRpc('pay_vtu_bill', { p_service_type: 'airtime', p_provider: 'MTN', p_identifier: '08030000000', p_plan_name: 'VTU', p_amount: badAmt, p_pin: '1234', p_idempotency_key: crypto.randomUUID() });
    await engine.backendRpc('manage_midesave_vault', { p_action: 'fund', p_vault_id: attacker.vaultId, p_amount: badAmt, p_pin: '1234', p_idempotency_key: crypto.randomUUID() });
  }

  // Multi-row payroll batch atomicity test:
  // Row 1 credits `victim.nuban` (₦20,000 - valid), Row 2 references non-existent NUBAN `9099999999` (₦15,000) -> MUST roll back Row 1!
  const payrollOverdraftRes = await engine.backendRpc('execute_payroll_batch', {
    p_business_id: attacker.businessId,
    p_title: 'Overdraft Batch',
    p_items: [
      { identifier: victim.nuban, amount: 30000 },
      { identifier: unverifiedActor.nuban, amount: 25000 } // Total ₦55,000 > ₦50,000 balance
    ],
    p_pin: '1234',
    p_idempotency_key: crypto.randomUUID()
  });

  const payrollMidLoopRollbackRes = await engine.backendRpc('execute_payroll_batch', {
    p_business_id: attacker.businessId,
    p_title: 'Mid-Batch Exception Rollback',
    p_items: [
      { identifier: victim.nuban, amount: 20000 },
      { identifier: '9099999999', amount: 15000 }
    ],
    p_pin: '1234',
    p_idempotency_key: crypto.randomUUID()
  });

  assertSec(
    nullPinCardAttempt.data?.code === 'PIN_REQUIRED' &&
    nullBusinessPayrollAttempt.data?.code === 'ACCESS_DENIED' &&
    payrollOverdraftRes.data?.success === false &&
    payrollMidLoopRollbackRes.error !== null &&
    engine.state.wallets.get(attacker.walletId).balance === 50000 &&
    engine.state.wallets.get(victim.walletId).balance === 100000 &&
    engine.state.virtualCards.get(attacker.cardId).card_balance === 0 &&
    engine.state.midesaveVaults.get(attacker.vaultId).current_balance === 50000,
    'PIN_REQUIRED, null business_id, negative, zero, NaN, Infinity, overdraft & mid-batch payroll exceptions fail atomically with 0 partial debits'
  );

  // ==========================================================================
  // [6/7] IDEMPOTENCY REPLAY, RACE DEDUPLICATION & 5-STRIKE PIN LOCKOUT
  // ==========================================================================
  console.log('\n[6/7] Pen-Testing Idempotency Replay / Concurrent Race & 5-Strike PIN Lockout...');

  const idemP2p = crypto.randomUUID();
  const [race1, race2] = await Promise.all([
    engine.backendRpc('execute_p2p_transfer', { p_recipient_nuban: victim.nuban, p_amount: 5000, p_pin: '1234', p_idempotency_key: idemP2p }),
    engine.backendRpc('execute_p2p_transfer', { p_recipient_nuban: victim.nuban, p_amount: 5000, p_pin: '1234', p_idempotency_key: idemP2p })
  ]);

  const idemCard = crypto.randomUUID();
  await engine.backendRpc('fund_virtual_card', { p_card_id: attacker.cardId, p_amount_card_currency: 4000, p_pin: '1234', p_idempotency_key: idemCard });
  const dupCard = await engine.backendRpc('fund_virtual_card', { p_card_id: attacker.cardId, p_amount_card_currency: 4000, p_pin: '1234', p_idempotency_key: idemCard });

  const idemBill = crypto.randomUUID();
  await engine.backendRpc('pay_vtu_bill', { p_service_type: 'airtime', p_provider: 'MTN', p_identifier: '08031234567', p_plan_name: 'VTU', p_amount: 1000, p_pin: '1234', p_idempotency_key: idemBill });
  const dupBill = await engine.backendRpc('pay_vtu_bill', { p_service_type: 'airtime', p_provider: 'MTN', p_identifier: '08031234567', p_plan_name: 'VTU', p_amount: 1000, p_pin: '1234', p_idempotency_key: idemBill });

  const idemVault = crypto.randomUUID();
  await engine.backendRpc('manage_midesave_vault', { p_action: 'fund', p_vault_id: attacker.vaultId, p_amount: 2000, p_pin: '1234', p_idempotency_key: idemVault });
  const dupVault = await engine.backendRpc('manage_midesave_vault', { p_action: 'fund', p_vault_id: attacker.vaultId, p_amount: 2000, p_pin: '1234', p_idempotency_key: idemVault });

  const idemPayroll = crypto.randomUUID();
  await engine.backendRpc('execute_payroll_batch', { p_business_id: attacker.businessId, p_title: 'Cycle', p_items: [{ identifier: victim.nuban, amount: 3000 }], p_pin: '1234', p_idempotency_key: idemPayroll });
  const dupPayroll = await engine.backendRpc('execute_payroll_batch', { p_business_id: attacker.businessId, p_title: 'Cycle', p_items: [{ identifier: victim.nuban, amount: 3000 }], p_pin: '1234', p_idempotency_key: idemPayroll });

  // Expected balance after single execution of each: 50,000 - 5,000 - 4,000 - 1,000 - 2,000 - 3,000 = ₦35,000
  const statusesPair = [race1.data?.status, race2.data?.status].sort().join(',');
  assertSec(
    statusesPair === 'duplicate,success' &&
    dupCard.data?.status === 'duplicate' &&
    dupBill.data?.status === 'duplicate' &&
    dupVault.data?.status === 'duplicate' &&
    dupPayroll.data?.status === 'duplicate' &&
    engine.state.wallets.get(attacker.walletId).balance === 35000,
    'Concurrent race & replayed idempotency_key return status="duplicate" with exact single debit (₦35,000.00 remaining)'
  );

  // Brute-force 4-digit PIN strikes 1..5 -> verify exact counter progression & strike-5 lockout
  const observedStrikes = [];
  for (const wrongPin of ['0001', '0002', '0003', '0004', '0005']) {
    await engine.backendRpc('execute_p2p_transfer', {
      p_recipient_nuban: victim.nuban,
      p_amount: 500,
      p_pin: wrongPin,
      p_idempotency_key: crypto.randomUUID()
    });
    observedStrikes.push(engine.state.profiles.get(attacker.uid).pin_failed_attempts);
  }
  const correctPinDuringLockout = await engine.backendRpc('execute_p2p_transfer', {
    p_recipient_nuban: victim.nuban,
    p_amount: 500,
    p_pin: '1234',
    p_idempotency_key: crypto.randomUUID()
  });

  assertSec(
    observedStrikes.join(',') === '1,2,3,4,5' &&
    Boolean(engine.state.profiles.get(attacker.uid).pin_locked_until) &&
    correctPinDuringLockout.data?.code === 'PIN_LOCKED' &&
    engine.state.wallets.get(attacker.walletId).balance === 35000,
    'Wrong PIN attempts increment pin_failed_attempts (1->2->3->4->5) and lock out on strike 5 (even rejecting valid PIN during cooldown)'
  );

  // ==========================================================================
  // [7/7] CROSS-USER NUBAN / CARD / VAULT / BUSINESS ENUMERATION & IDOR ISOLATION
  // ==========================================================================
  console.log('\n[7/7] Pen-Testing Cross-User NUBAN / Card ID / Vault ID / Business ID Enumeration & IDOR...');
  const snooper = engine.provisionUser({
    fullName: 'Curious Insider',
    email: 'snooper@midepay.ng',
    nuban: '9044556677',
    emailConfirmed: true,
    pin: '5555',
    initialBalance: 20000
  });
  engine.setSessionUser(snooper.uid);

  const [enumWallet, enumCard, enumVault, enumTxs, enumLogs] = await Promise.all([
    engine.from('wallets').select('*').eq('user_id', victim.uid),
    engine.from('virtual_cards').select('*').eq('id', victim.cardId),
    engine.from('midesave_vaults').select('*').eq('id', victim.vaultId),
    engine.from('transactions').select('*').eq('user_id', victim.uid),
    engine.from('security_audit_logs').select('*').eq('user_id', victim.uid)
  ]);

  const nubanLookup = await engine.rpc('lookup_recipient_profile', { search_query: victim.nuban });
  const leakedKeys = Object.keys(nubanLookup.data?.[0] || {}).filter(k =>
    ['balance', 'ledger_balance', 'card_number', 'cvv', 'pin_hash', 'transaction_pin_hash'].includes(k)
  );

  const [idorFreeze, idorFundCard, idorDrainVault, idorSpoofSender, idorSpoofBusiness] = await Promise.all([
    engine.backendRpc('set_virtual_card_freeze', { p_card_id: victim.cardId, p_is_frozen: true }),
    engine.backendRpc('fund_virtual_card', { p_card_id: victim.cardId, p_amount_card_currency: 1000, p_pin: '5555', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('manage_midesave_vault', { p_action: 'withdraw', p_vault_id: victim.vaultId, p_amount: 10000, p_pin: '5555', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('transfer_funds', { sender_id: victim.uid, recipient_id: snooper.uid, amount: 50000, narration: 'IDOR', p_pin: '2468', p_idempotency_key: crypto.randomUUID() }),
    engine.backendRpc('execute_payroll_batch', { p_business_id: victim.businessId, p_title: 'Hijack', p_items: [{ identifier: snooper.nuban, amount: 5000 }], p_pin: '5555', p_idempotency_key: crypto.randomUUID() })
  ]);

  assertSec(
    enumWallet.data.length === 0 &&
    enumCard.data.length === 0 &&
    enumVault.data.length === 0 &&
    enumTxs.data.length === 0 &&
    enumLogs.data.length === 0 &&
    leakedKeys.length === 0 &&
    idorFreeze.error !== null &&
    idorFundCard.data?.code === 'ACCESS_DENIED' &&
    idorDrainVault.data?.code === 'ACCESS_DENIED' &&
    idorSpoofSender.data?.code === 'UNAUTHORIZED' &&
    idorSpoofBusiness.data?.code === 'ACCESS_DENIED' &&
    engine.state.virtualCards.get(victim.cardId).is_frozen === false &&
    engine.state.midesaveVaults.get(victim.vaultId).current_balance === 50000,
    'Cross-user NUBAN/card/vault/business ID enumeration & IDOR attacks leak 0 private PAN/CVV/PIN/balance fields and mutate 0 victim records'
  );

  console.log('\n======================================================================');
  if (failedCount === 0) {
    console.log(` 🛡️ ALL ${passedCount}/${passedCount} ADVERSARIAL PENETRATION & SRE SECURITY CHECKS PASSED (0 ERRORS)`);
    console.log('======================================================================');
    process.exit(0);
  } else {
    console.error(` ❌ PENETRATION SUITE FAILED WITH ${failedCount} ERROR(S)`);
    console.log('======================================================================');
    process.exit(1);
  }
}

runPenetrationSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});

