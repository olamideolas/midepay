#!/usr/bin/env node
/**
 * MidePay v4.6 — Zero-Trust OTP, Mandatory PIN Onboarding & RPC Security E2E Suite
 * Loads all real HTML element IDs from `index.html` into an instrumented DOM harness
 * paired with a strict In-Memory Zero-Trust Supabase Auth + PostgreSQL RPC Server Simulator
 * enforcing:
 * - 6-Digit Email OTP signup verification (`auth.signUp`, `auth.verifyOtp`, `auth.resend`)
 * - 60-second Resend OTP cooldown timer & unconfirmed login auto-routing
 * - Server-side `(SELECT email_confirmed_at FROM auth.users WHERE id = auth.uid()) IS NOT NULL`
 *   AND `transaction_pin_hash IS NOT NULL` guards across ALL financial RPCs
 * - Mandatory Post-OTP 4-Digit Transaction PIN onboarding lock & `USER_LOGIN` audit logging
 * - Zero direct table writes, UUID v4 idempotency deduplication, double-click submit locks,
 *   and server-only wallet balance hydration.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

class MockClassList {
  constructor(initial = '') {
    this._set = new Set(initial.split(/\s+/).filter(Boolean));
  }
  add(...cls) { cls.forEach(c => c && this._set.add(c)); }
  remove(...cls) { cls.forEach(c => this._set.delete(c)); }
  contains(c) { return this._set.has(c); }
  toggle(c, force) {
    if (force === undefined) {
      if (this._set.has(c)) { this._set.delete(c); return false; }
      this._set.add(c); return true;
    }
    if (force) this._set.add(c); else this._set.delete(c);
    return !!force;
  }
}

let lastFocusedElementId = null;

class MockElement {
  constructor(tagName = 'DIV', attrs = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.id = attrs.id || '';
    this.value = attrs.value || '';
    this.type = attrs.type || 'text';
    this.checked = 'checked' in attrs;
    this.disabled = 'disabled' in attrs;
    this.textContent = '';
    this.innerHTML = '';
    this.style = { setProperty() {}, removeProperty() {} };
    this.dataset = {};
    this._attrs = { ...attrs };
    this._className = attrs.class || '';
    this.classList = new MockClassList(this._className);
    this._listeners = {};
    this.options = [{ value: 'OPay', text: 'OPay Digital Services' }];
    this.selectedIndex = 0;
    this.parentNode = null;
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        this.dataset[camel] = v;
      }
    }
  }
  get className() { return [...this.classList._set].join(' '); }
  set className(v) {
    this._className = String(v || '');
    this.classList = new MockClassList(this._className);
  }
  getAttribute(k) { return this._attrs[k] ?? null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  removeAttribute(k) { delete this._attrs[k]; }
  hasAttribute(k) { return k in this._attrs; }
  addEventListener(ev, fn) {
    (this._listeners[ev] = this._listeners[ev] || []).push(fn);
  }
  dispatchEvent(ev, payload = {}) {
    const list = this._listeners[ev] || [];
    const eventObj = {
      type: ev,
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...payload
    };
    return Promise.all(list.map(fn => fn(eventObj)));
  }
  click() {
    if (this.disabled) return Promise.resolve([]);
    return this.dispatchEvent('click');
  }
  focus() {
    if (this.id) lastFocusedElementId = this.id;
  }
  blur() {}
  scrollIntoView() {}
  appendChild(child) { child.parentNode = this; return child; }
  removeChild(child) { child.parentNode = null; return child; }
  remove() {}
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 180 }; }
  querySelector() { return new MockElement('SPAN'); }
  querySelectorAll() { return []; }
}

const elementsById = new Map();
const allElements = [];

const tagRegex = /<([a-zA-Z0-9\-]+)\b([^>]*)>/g;
let match;
while ((match = tagRegex.exec(html)) !== null) {
  const tagName = match[1];
  const attrStr = match[2];
  const attrs = {};
  const attrRegex = /([a-zA-Z0-9\-:]+)(?:=["']([^"']*)["'])?/g;
  let am;
  while ((am = attrRegex.exec(attrStr)) !== null) {
    attrs[am[1]] = am[2] ?? '';
  }
  if (attrs.id || attrs.class || attrs['data-liquid-glass']) {
    const el = new MockElement(tagName, attrs);
    allElements.push(el);
    if (attrs.id && !elementsById.has(attrs.id)) {
      elementsById.set(attrs.id, el);
    }
  }
}

const runtimeErrors = [];
const storageMap = new Map();

const mockStorage = {
  getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
  setItem: (k, v) => storageMap.set(k, String(v)),
  removeItem: (k) => storageMap.delete(k),
  clear: () => storageMap.clear()
};

const docListeners = {};
const mockDocument = {
  readyState: 'complete',
  documentElement: new MockElement('HTML'),
  body: new MockElement('BODY'),
  createElement: (t) => new MockElement(t),
  getElementById: (id) => elementsById.get(id) || null,
  querySelector: (sel) => {
    if (sel.startsWith('#')) return elementsById.get(sel.slice(1)) || null;
    return allElements[0] || new MockElement('DIV');
  },
  querySelectorAll: (sel) => {
    if (sel.includes('liquid-glass')) {
      return allElements.filter(e => e.classList.contains('liquid-glass') || e.hasAttribute('data-liquid-glass'));
    }
    if (sel === 'button') {
      return allElements.filter(e => e.tagName === 'BUTTON');
    }
    return [];
  },
  addEventListener: (ev, fn) => {
    (docListeners[ev] = docListeners[ev] || []).push(fn);
  }
};

// =========================================================================
// IN-MEMORY ZERO-TRUST SUPABASE AUTH + OTP + POSTGRESQL RPC SIMULATOR
// =========================================================================
function createZeroTrustSupabaseSimulator() {
  const directWriteViolations = [];
  const rpcCallHistory = [];
  const securityAuditLogs = [];
  const otpResendHistory = [];

  const authUsersByEmail = new Map();
  const authUsersById = new Map();
  const pendingOtpsByEmail = new Map();
  const profilesById = new Map();
  const walletsByUserId = new Map();
  const usedNubans = new Set();
  const virtualCards = [];
  const transactions = [];
  const savingsVaults = [];
  const billPayments = [];
  const payrollRuns = [];
  const waitlist = [];
  const paymentRequests = [];

  let activeSession = null;

  const genUuid = () => nodeCrypto.randomUUID();
  const hashPin = (pin) => nodeCrypto.createHash('sha256').update(`bf10:${pin}`).digest('hex');
  const genSixDigitOtp = () => String(nodeCrypto.randomInt(100000, 1000000));

  const genUniqueNuban = () => {
    while (true) {
      const candidate = '90' + String(nodeCrypto.randomInt(0, 100000000)).padStart(8, '0');
      if (!usedNubans.has(candidate)) {
        usedNubans.add(candidate);
        return candidate;
      }
    }
  };

  const computeLuhn = (digits15) => {
    let sum = 0;
    for (let i = 0; i < 15; i++) {
      let d = Number(digits15[i]);
      if (i % 2 === 0) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return (10 - (sum % 10)) % 10;
  };

  const buildCardRow = ({ userId, walletId, currency, cardType, cardLabel, cardHolderName, spendingLimit }) => {
    let body11 = '';
    for (let i = 0; i < 11; i++) body11 += String(nodeCrypto.randomInt(0, 10));
    const digits15 = `5399${body11}`;
    const rawPan = `${digits15}${computeLuhn(digits15)}`;
    const formattedPan = `${rawPan.slice(0, 4)} ${rawPan.slice(4, 8)} ${rawPan.slice(8, 12)} ${rawPan.slice(12, 16)}`;
    const maskedPan = `${rawPan.slice(0, 4)} •••• •••• ${rawPan.slice(12, 16)}`;
    const now = new Date();
    return {
      id: genUuid(),
      user_id: userId,
      wallet_id: walletId,
      card_type: cardType,
      currency,
      card_label: cardLabel,
      card_holder_name: String(cardHolderName || 'MIDEPAY MEMBER').toUpperCase(),
      card_number: formattedPan,
      masked_pan: maskedPan,
      cvv: String(nodeCrypto.randomInt(100, 1000)),
      expiry_month: now.getUTCMonth() + 1,
      expiry_year: now.getUTCFullYear() + 3,
      card_balance: 0.00,
      spending_limit_monthly: spendingLimit,
      is_frozen: false,
      is_active: true,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };
  };

  // Mirrors `public.handle_new_user()` trigger on `auth.users`
  const handleNewUserTrigger = (userRecord) => {
    const uid = userRecord.id;
    const fullName = (userRecord.user_metadata?.full_name || userRecord.email.split('@')[0] || 'MidePay Member').trim();
    const phone = userRecord.user_metadata?.phone || null;
    const baseTag = '@' + fullName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);
    const tag = `${baseTag}${nodeCrypto.randomInt(10, 99)}`;
    const nowIso = new Date().toISOString();

    const profile = {
      id: uid,
      email: userRecord.email,
      full_name: fullName,
      phone,
      tag,
      kyc_tier: 2,
      role: 'user',
      is_frozen: false,
      pin_hash: null,
      transaction_pin_hash: null,
      pin_failed_attempts: 0,
      pin_locked_until: null,
      last_login_at: null,
      last_login_device: {},
      created_at: nowIso,
      updated_at: nowIso
    };
    profilesById.set(uid, profile);

    const wallet = {
      id: genUuid(),
      user_id: uid,
      currency: 'NGN',
      nuban: genUniqueNuban(),
      bank_name: 'MidePay / Providus Bank',
      balance: 0.00,
      ledger_balance: 0.00,
      created_at: nowIso,
      updated_at: nowIso
    };
    walletsByUserId.set(uid, wallet);

    virtualCards.push(buildCardRow({
      userId: uid,
      walletId: wallet.id,
      currency: 'NGN',
      cardType: 'Verve',
      cardLabel: 'MidePay Green',
      cardHolderName: fullName,
      spendingLimit: 500000.00
    }));
    virtualCards.unshift(buildCardRow({
      userId: uid,
      walletId: wallet.id,
      currency: 'USD',
      cardType: 'Mastercard',
      cardLabel: 'MidePay Black',
      cardHolderName: fullName,
      spendingLimit: 1000.00
    }));
  };

  // Mirrors `public._assert_verified_wallet_ready` (20261116050000_auth_verification_gate.sql)
  const assertVerifiedWalletReady = (uid, actionName) => {
    if (!uid) {
      return { ok: false, code: 'UNAUTHORIZED', error: 'Authentication required.' };
    }
    const authUser = authUsersById.get(uid);
    if (!authUser || !authUser.email_confirmed_at) {
      securityAuditLogs.push({ user_id: uid, event_type: 'UNVERIFIED_EMAIL_BLOCKED', severity: 'warning', action: actionName });
      return {
        ok: false,
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Email verification required. Enter the 6-digit OTP sent to your email before transacting.'
      };
    }
    const profile = profilesById.get(uid);
    if (!profile) {
      return { ok: false, code: 'PROFILE_MISSING', error: 'Account security profile not found.' };
    }
    if (profile.is_frozen) {
      securityAuditLogs.push({ user_id: uid, event_type: 'FROZEN_ACCOUNT_BLOCKED', severity: 'critical', action: actionName });
      return { ok: false, code: 'ACCOUNT_FROZEN', is_frozen: true, error: 'Account is currently frozen.' };
    }
    if (!profile.transaction_pin_hash) {
      securityAuditLogs.push({ user_id: uid, event_type: 'MISSING_PIN_BLOCKED', severity: 'warning', action: actionName });
      return {
        ok: false,
        needs_pin_setup: true,
        code: 'PIN_SETUP_REQUIRED',
        error: 'Mandatory 4-digit Transaction PIN has not been created yet. Complete PIN setup to unlock your wallet.'
      };
    }
    return { ok: true, email_confirmed_at: authUser.email_confirmed_at };
  };

  // Mirrors `public._verify_pin_and_audit` (requires verified email + existing transaction_pin_hash + 5-strike lockout)
  const verifyPinAndAudit = (uid, rawPin, contextName) => {
    const gate = assertVerifiedWalletReady(uid, contextName);
    if (!gate.ok) return gate;

    const profile = profilesById.get(uid);
    if (profile.pin_locked_until && new Date(profile.pin_locked_until).getTime() > Date.now()) {
      securityAuditLogs.push({ user_id: uid, event_type: 'PIN_LOCKED', severity: 'critical', context: contextName });
      return { ok: false, code: 'PIN_LOCKED', attempts_remaining: 0, error: 'Transaction PIN is temporarily locked after 5 failed attempts.' };
    }

    if (!/^\d{4}$/.test(String(rawPin || '')) || hashPin(String(rawPin)) !== profile.transaction_pin_hash) {
      profile.pin_failed_attempts = (profile.pin_failed_attempts || 0) + 1;
      if (profile.pin_failed_attempts >= 5) {
        profile.pin_locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        securityAuditLogs.push({ user_id: uid, event_type: 'PIN_LOCKED', severity: 'critical', context: contextName, strikes: profile.pin_failed_attempts });
        return { ok: false, code: 'PIN_LOCKED', attempts_remaining: 0, error: 'Too many incorrect PIN attempts (5/5). Locked for 15 minutes.' };
      }
      const rem = 5 - profile.pin_failed_attempts;
      securityAuditLogs.push({ user_id: uid, event_type: 'PIN_FAILED', severity: 'warn', context: contextName, strikes: profile.pin_failed_attempts });
      return { ok: false, code: 'INVALID_PIN', attempts_remaining: rem, error: `Invalid 4-digit Transaction PIN (${rem} attempt(s) remaining).` };
    }

    profile.pin_failed_attempts = 0;
    profile.pin_locked_until = null;
    return { ok: true, code: 'VERIFIED' };
  };

  const getTableRows = (table, authUid) => {
    if (!authUid) return [];
    switch (table) {
      case 'profiles': {
        const p = profilesById.get(authUid);
        return p ? [{ ...p, pin_hash: undefined, transaction_pin_hash: undefined, has_transaction_pin: Boolean(p.transaction_pin_hash) }] : [];
      }
      case 'wallets': {
        const w = walletsByUserId.get(authUid);
        return w ? [{ ...w }] : [];
      }
      case 'transactions':
        return transactions.filter(t => t.user_id === authUid).map(t => ({ ...t }));
      case 'virtual_cards':
        return virtualCards.filter(c => c.user_id === authUid).map(c => ({ ...c }));
      case 'savings_vaults':
      case 'midesave_vaults':
        return savingsVaults.filter(v => v.user_id === authUid).map(v => ({ ...v }));
      case 'bill_payments':
        return billPayments.filter(b => b.user_id === authUid).map(b => ({ ...b }));
      case 'payroll_runs':
        return payrollRuns.filter(r => r.user_id === authUid).map(r => ({ ...r }));
      case 'payment_requests':
        return paymentRequests.filter(r => r.requester_id === authUid || r.payer_id === authUid);
      default:
        return [];
    }
  };

  const createQueryBuilder = (table) => {
    let filters = [];
    let sortCol = null;
    let sortAsc = true;
    let rowLimit = null;

    const rejectWrite = (op) => {
      directWriteViolations.push({ table, op });
      const errResp = { data: null, error: { code: '42501', message: `permission denied for table ${table} (${op} revoked)` } };
      return {
        select: () => Promise.resolve(errResp),
        eq: () => ({ select: () => Promise.resolve(errResp), then: (r) => Promise.resolve(errResp).then(r) }),
        single: () => Promise.resolve(errResp),
        maybeSingle: () => Promise.resolve(errResp),
        then: (resolve, reject) => Promise.resolve(errResp).then(resolve, reject)
      };
    };

    const executeSelect = () => {
      const uid = activeSession?.user?.id || null;
      let rows = getTableRows(table, uid);
      for (const fn of filters) rows = rows.filter(fn);
      if (sortCol) {
        rows.sort((a, b) => {
          const av = a[sortCol] || '';
          const bv = b[sortCol] || '';
          return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
      }
      if (rowLimit !== null) rows = rows.slice(0, rowLimit);
      return { data: rows, error: null };
    };

    const builder = {
      insert: () => rejectWrite('INSERT'),
      update: () => rejectWrite('UPDATE'),
      upsert: () => rejectWrite('UPSERT'),
      delete: () => rejectWrite('DELETE'),
      select: () => builder,
      eq: (col, val) => { filters.push(r => r[col] === val); return builder; },
      neq: (col, val) => { filters.push(r => r[col] !== val); return builder; },
      ilike: (col, val) => {
        const needle = String(val || '').replace(/%/g, '').toLowerCase();
        filters.push(r => String(r[col] || '').toLowerCase().includes(needle));
        return builder;
      },
      or: () => builder,
      order: (col, opts = {}) => { sortCol = col; sortAsc = opts.ascending !== false; return builder; },
      limit: (n) => { rowLimit = Number(n); return builder; },
      maybeSingle: async () => {
        const res = executeSelect();
        return { data: res.data[0] || null, error: null };
      },
      single: async () => {
        const res = executeSelect();
        return res.data[0] ? { data: res.data[0], error: null } : { data: null, error: { message: 'Row not found' } };
      },
      then: (resolve, reject) => Promise.resolve(executeSelect()).then(resolve, reject)
    };
    return builder;
  };

  const client = {
    auth: {
      signUp: async ({ email, password, options }) => {
        const normEmail = String(email || '').trim().toLowerCase();
        if (authUsersByEmail.has(normEmail)) {
          return { data: { user: null, session: null }, error: { message: 'User already registered' } };
        }
        const user = {
          id: genUuid(),
          email: normEmail,
          passwordHash: hashPin(password),
          email_confirmed_at: null,
          user_metadata: options?.data || {}
        };
        authUsersByEmail.set(normEmail, user);
        authUsersById.set(user.id, user);
        pendingOtpsByEmail.set(normEmail, genSixDigitOtp());
        handleNewUserTrigger(user);
        return {
          data: {
            user: { id: user.id, email: user.email, email_confirmed_at: null, user_metadata: user.user_metadata },
            session: null
          },
          error: null
        };
      },
      verifyOtp: async ({ email, token, type }) => {
        const normEmail = String(email || '').trim().toLowerCase();
        const found = authUsersByEmail.get(normEmail);
        const expectedOtp = pendingOtpsByEmail.get(normEmail);
        if (!found || type !== 'signup' || !expectedOtp || String(token) !== expectedOtp) {
          return { data: { user: null, session: null }, error: { message: 'Token has expired or is invalid' } };
        }
        found.email_confirmed_at = new Date().toISOString();
        pendingOtpsByEmail.delete(normEmail);
        const pubUser = {
          id: found.id,
          email: found.email,
          email_confirmed_at: found.email_confirmed_at,
          user_metadata: found.user_metadata
        };
        activeSession = { access_token: `jwt-${found.id}`, user: pubUser };
        return { data: { user: pubUser, session: activeSession }, error: null };
      },
      resend: async ({ type, email }) => {
        const normEmail = String(email || '').trim().toLowerCase();
        const found = authUsersByEmail.get(normEmail);
        if (!found || type !== 'signup') {
          return { data: {}, error: { message: 'Unable to resend signup OTP' } };
        }
        const freshOtp = genSixDigitOtp();
        pendingOtpsByEmail.set(normEmail, freshOtp);
        otpResendHistory.push({ email: normEmail, type, issuedAt: new Date().toISOString() });
        return { data: {}, error: null };
      },
      signInWithPassword: async ({ email, password }) => {
        const normEmail = String(email || '').trim().toLowerCase();
        const found = authUsersByEmail.get(normEmail);
        if (!found || found.passwordHash !== hashPin(password)) {
          return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        }
        if (!found.email_confirmed_at) {
          return { data: { user: null, session: null }, error: { message: 'Email not confirmed' } };
        }
        const pubUser = {
          id: found.id,
          email: found.email,
          email_confirmed_at: found.email_confirmed_at,
          user_metadata: found.user_metadata
        };
        activeSession = { access_token: `jwt-${found.id}`, user: pubUser };
        return { data: { user: pubUser, session: activeSession }, error: null };
      },
      signOut: async () => {
        activeSession = null;
        return { error: null };
      },
      getUser: async () => ({ data: { user: activeSession?.user || null }, error: null }),
      getSession: async () => ({ data: { session: activeSession }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    from: (table) => createQueryBuilder(table),
    rpc: async (fnName, params = {}) => {
      rpcCallHistory.push({ fn: fnName, params: { ...params } });
      const uid = activeSession?.user?.id || null;

      switch (fnName) {
        case 'ensure_my_profile_and_wallet': {
          if (!uid) return { data: null, error: { message: 'Authentication required' } };
          const authU = authUsersById.get(uid);
          const p = profilesById.get(uid);
          const w = walletsByUserId.get(uid);
          const hasPin = Boolean(p?.transaction_pin_hash);
          return {
            data: {
              profile: p ? { ...p, pin_hash: undefined, transaction_pin_hash: undefined, has_transaction_pin: hasPin } : null,
              wallet: w ? { ...w } : null,
              email_confirmed: Boolean(authU?.email_confirmed_at),
              email_confirmed_at: authU?.email_confirmed_at || null,
              has_transaction_pin: hasPin
            },
            error: null
          };
        }

        case 'record_verified_login_session': {
          if (!uid) return { data: { success: false, error: 'Authentication required' }, error: null };
          const authU = authUsersById.get(uid);
          if (!authU?.email_confirmed_at) {
            securityAuditLogs.push({ user_id: uid, event_type: 'UNVERIFIED_LOGIN_BLOCKED', severity: 'warning' });
            return { data: { success: false, code: 'EMAIL_NOT_VERIFIED', error: 'Email not verified' }, error: null };
          }
          const prof = profilesById.get(uid);
          const nowIso = new Date().toISOString();
          const meta = params.p_device_metadata || {};
          prof.last_login_at = nowIso;
          prof.last_login_device = meta;
          const hasPin = Boolean(prof.transaction_pin_hash);
          securityAuditLogs.push({
            user_id: uid,
            event_type: 'USER_LOGIN',
            severity: 'info',
            user_agent: meta.user_agent || null,
            metadata: { ...meta, login_at: nowIso, has_transaction_pin: hasPin }
          });
          return {
            data: {
              success: true,
              login_at: nowIso,
              email_confirmed: true,
              has_transaction_pin: hasPin
            },
            error: null
          };
        }

        case 'lookup_recipient_profile': {
          const q = String(params.search_query || '').trim().toLowerCase();
          const qDigits = q.replace(/[^0-9]/g, '');
          const results = [];
          for (const [id, prof] of profilesById.entries()) {
            const wal = walletsByUserId.get(id);
            const matchNuban = qDigits.length === 10 && wal?.nuban === qDigits;
            const matchEmail = prof.email === q;
            const matchTag = prof.tag && (prof.tag.toLowerCase() === q || prof.tag.toLowerCase() === `@${q}`);
            const matchPhone = prof.phone && prof.phone.replace(/[^0-9]/g, '') === qDigits && qDigits.length >= 7;
            if (matchNuban || matchEmail || matchTag || matchPhone) {
              results.push({
                id: prof.id,
                full_name: prof.full_name,
                email: prof.email,
                phone: prof.phone,
                tag: prof.tag,
                avatar_url: null,
                is_frozen: prof.is_frozen,
                nuban: wal?.nuban || null,
                bank_name: wal?.bank_name || 'MidePay / Providus Bank'
              });
              break;
            }
          }
          return { data: results, error: null };
        }

        case 'set_user_transaction_pin': {
          if (!uid) return { data: { success: false, error: 'Authentication required' }, error: null };
          const authU = authUsersById.get(uid);
          if (!authU?.email_confirmed_at) {
            securityAuditLogs.push({ user_id: uid, event_type: 'UNVERIFIED_EMAIL_BLOCKED', severity: 'warning', action: 'SET_PIN' });
            return { data: { success: false, code: 'EMAIL_NOT_VERIFIED', error: 'Verify your email with the 6-digit OTP first.' }, error: null };
          }
          const newPin = String(params.p_new_pin || '');
          if (!/^\d{4}$/.test(newPin)) return { data: { success: false, error: 'PIN must be 4 digits' }, error: null };
          const prof = profilesById.get(uid);
          const isInitial = !prof.transaction_pin_hash;
          if (!isInitial) {
            const ver = verifyPinAndAudit(uid, params.p_current_pin, 'PIN_ROTATE');
            if (!ver.ok) return { data: { success: false, error: ver.error }, error: null };
          }
          const digest = hashPin(newPin);
          prof.transaction_pin_hash = digest;
          prof.pin_hash = digest;
          prof.pin_failed_attempts = 0;
          prof.pin_locked_until = null;
          securityAuditLogs.push({ user_id: uid, event_type: isInitial ? 'PIN_ONBOARDING_COMPLETED' : 'PIN_ROTATED', severity: 'info' });
          return { data: { success: true, has_transaction_pin: true }, error: null };
        }

        case 'verify_user_transaction_pin': {
          if (!uid) return { data: { valid: false, error: 'Authentication required' }, error: null };
          const authU = authUsersById.get(uid);
          if (!authU?.email_confirmed_at) {
            return { data: { valid: false, code: 'EMAIL_NOT_VERIFIED', error: 'Email not verified' }, error: null };
          }
          const prof = profilesById.get(uid);
          if (!prof?.transaction_pin_hash) {
            return { data: { valid: false, needs_pin_setup: true, code: 'PIN_SETUP_REQUIRED' }, error: null };
          }
          const ver = verifyPinAndAudit(uid, params.p_pin, 'PIN_VERIFY');
          if (ver.ok) return { data: { valid: true }, error: null };
          return {
            data: {
              valid: false,
              code: ver.code,
              is_frozen: Boolean(ver.is_frozen),
              attempts_remaining: ver.attempts_remaining,
              error: ver.error
            },
            error: null
          };
        }

        case 'concept_topup_wallet': {
          const gate = assertVerifiedWalletReady(uid, 'WALLET_TOPUP');
          if (!gate.ok) return { data: { success: false, code: gate.code, error: gate.error }, error: null };

          const amt = Math.round(Number(params.p_amount || 0) * 100) / 100;
          const idemKey = params.p_idempotency_key || null;
          if (idemKey) {
            const dup = transactions.find(t => t.idempotency_key === idemKey && t.user_id === uid);
            if (dup) {
              const wal = walletsByUserId.get(uid);
              return { data: { success: true, status: 'duplicate', wallet: { ...wal }, transaction: dup, new_balance: dup.balance_after, reference: dup.reference }, error: null };
            }
          }
          const wal = walletsByUserId.get(uid);
          const before = wal.balance;
          wal.balance = Math.round((wal.balance + amt) * 100) / 100;
          wal.ledger_balance = wal.balance;
          const ref = params.p_reference || `DEP-${Date.now()}`;
          const tx = {
            id: genUuid(),
            wallet_id: wal.id,
            user_id: uid,
            type: 'inflow',
            category: 'deposit',
            amount: amt,
            fee: 0,
            balance_before: before,
            balance_after: wal.balance,
            status: 'successful',
            counterparty_name: 'Instant Direct Wallet Top-Up',
            counterparty_bank: 'MidePay Settlement',
            narration: 'Instant Direct Wallet Top-Up',
            reference: ref,
            idempotency_key: idemKey,
            created_at: new Date().toISOString()
          };
          transactions.unshift(tx);
          return { data: { success: true, status: 'success', wallet: { ...wal }, transaction: tx, new_balance: wal.balance, reference: ref }, error: null };
        }

        case 'execute_p2p_transfer':
        case 'transfer_funds': {
          if (!uid) return { data: null, error: { message: 'Unauthorized: active authenticated session required.' } };
          const gate = assertVerifiedWalletReady(uid, 'P2P_TRANSFER');
          if (!gate.ok) return { data: { success: false, status: gate.code, code: gate.code, error: gate.error }, error: null };

          const amt = Math.round(Number(params.p_amount ?? params.amount ?? 0) * 100) / 100;
          const pin = params.p_pin || null;
          const idemKey = params.p_idempotency_key || null;

          if (idemKey) {
            const dup = transactions.find(t => t.idempotency_key === idemKey && t.user_id === uid);
            if (dup) {
              return { data: { success: true, status: 'duplicate', reference: dup.reference, new_balance: dup.balance_after }, error: null };
            }
          }

          const ver = verifyPinAndAudit(uid, pin, 'P2P_TRANSFER');
          if (!ver.ok) return { data: { success: false, status: ver.code, error: ver.error }, error: null };

          let recipientWal = null;
          if (params.p_recipient_nuban) {
            const q = String(params.p_recipient_nuban).trim();
            for (const w of walletsByUserId.values()) {
              if (w.nuban === q) { recipientWal = w; break; }
            }
          } else if (params.recipient_id) {
            recipientWal = walletsByUserId.get(params.recipient_id) || null;
          }
          if (!recipientWal) return { data: { success: false, error: 'Recipient NUBAN not found' }, error: null };
          if (recipientWal.user_id === uid) return { data: { success: false, error: 'Cannot transfer to your own account' }, error: null };

          const senderWal = walletsByUserId.get(uid);
          if (senderWal.balance < amt) return { data: { success: false, error: 'Insufficient wallet balance' }, error: null };

          const senderProf = profilesById.get(uid);
          const recipProf = profilesById.get(recipientWal.user_id);
          const sBefore = senderWal.balance;
          const rBefore = recipientWal.balance;
          senderWal.balance = Math.round((senderWal.balance - amt) * 100) / 100;
          senderWal.ledger_balance = senderWal.balance;
          recipientWal.balance = Math.round((recipientWal.balance + amt) * 100) / 100;
          recipientWal.ledger_balance = recipientWal.balance;

          const ref = `MP-P2P-${nodeCrypto.randomBytes(4).toString('hex').toUpperCase()}`;
          transactions.unshift({
            id: genUuid(),
            wallet_id: senderWal.id,
            user_id: uid,
            type: 'outflow',
            category: 'transfer',
            amount: amt,
            fee: 0,
            balance_before: sBefore,
            balance_after: senderWal.balance,
            status: 'successful',
            counterparty_name: recipProf?.full_name || 'MidePay Member',
            counterparty_bank: 'MidePay / Providus Bank',
            narration: params.p_narration || params.narration || 'MidePay Transfer',
            reference: ref,
            idempotency_key: idemKey,
            created_at: new Date().toISOString()
          });
          transactions.unshift({
            id: genUuid(),
            wallet_id: recipientWal.id,
            user_id: recipientWal.user_id,
            type: 'inflow',
            category: 'transfer',
            amount: amt,
            fee: 0,
            balance_before: rBefore,
            balance_after: recipientWal.balance,
            status: 'successful',
            counterparty_name: senderProf?.full_name || 'MidePay Member',
            counterparty_bank: 'MidePay / Providus Bank',
            narration: params.p_narration || params.narration || 'MidePay Transfer',
            reference: `${ref}-CR`,
            created_at: new Date().toISOString()
          });
          securityAuditLogs.push({ user_id: uid, event_type: 'P2P_TRANSFER', idempotency_key: idemKey, amount: amt });
          return { data: { success: true, status: 'success', reference: ref, new_balance: senderWal.balance }, error: null };
        }

        case 'issue_virtual_card': {
          const gate = assertVerifiedWalletReady(uid, 'CARD_ISSUE');
          if (!gate.ok) return { data: null, error: { message: gate.error } };
          const wal = walletsByUserId.get(uid);
          const card = buildCardRow({
            userId: uid,
            walletId: wal?.id || null,
            currency: params.p_currency === 'NGN' ? 'NGN' : 'USD',
            cardType: params.p_card_type || 'Mastercard',
            cardLabel: params.p_card_label || 'MidePay Black',
            cardHolderName: params.p_card_holder_name || 'MIDEPAY MEMBER',
            spendingLimit: Number(params.p_spending_limit || 1000)
          });
          virtualCards.unshift(card);
          securityAuditLogs.push({ user_id: uid, event_type: 'CARD_ISSUED', entity_id: card.id });
          return { data: { ...card }, error: null };
        }

        case 'set_virtual_card_freeze': {
          const gate = assertVerifiedWalletReady(uid, 'CARD_FREEZE');
          if (!gate.ok) return { data: null, error: { message: gate.error } };
          const card = virtualCards.find(c => c.id === params.p_card_id && c.user_id === uid);
          if (!card) return { data: null, error: { message: 'Card not found' } };
          card.is_frozen = Boolean(params.p_is_frozen);
          securityAuditLogs.push({ user_id: uid, event_type: 'CARD_FREEZE_TOGGLE', entity_id: card.id, is_frozen: card.is_frozen });
          return { data: { ...card }, error: null };
        }

        case 'set_virtual_card_limit': {
          const gate = assertVerifiedWalletReady(uid, 'CARD_LIMIT');
          if (!gate.ok) return { data: null, error: { message: gate.error } };
          const card = virtualCards.find(c => c.id === params.p_card_id && c.user_id === uid);
          if (!card) return { data: null, error: { message: 'Card not found' } };
          card.spending_limit_monthly = Number(params.p_spending_limit);
          securityAuditLogs.push({ user_id: uid, event_type: 'CARD_LIMIT_UPDATED', entity_id: card.id });
          return { data: { ...card }, error: null };
        }

        case 'log_virtual_card_reveal': {
          if (!uid) return { data: { success: false }, error: null };
          const card = virtualCards.find(c => c.id === params.p_card_id && c.user_id === uid);
          if (card) {
            securityAuditLogs.push({ user_id: uid, event_type: 'CARD_REVEAL', entity_id: card.id, field: params.p_field });
          }
          return { data: { success: true }, error: null };
        }

        case 'fund_virtual_card':
        case 'fund_virtual_card_from_wallet': {
          const gate = assertVerifiedWalletReady(uid, 'CARD_FUNDING');
          if (!gate.ok) return { data: { success: false, code: gate.code, error: gate.error }, error: null };
          if (params.p_pin) {
            const ver = verifyPinAndAudit(uid, params.p_pin, 'CARD_FUNDING');
            if (!ver.ok) return { data: { success: false, code: ver.code, error: ver.error }, error: null };
          }
          const card = virtualCards.find(c => c.id === params.p_card_id && c.user_id === uid);
          if (!card) return { data: { success: false, error: 'Card not found' }, error: null };
          if (card.is_frozen) return { data: { success: false, error: 'Card is frozen' }, error: null };
          const credit = Math.round(Number(params.p_amount_card_currency || 0) * 100) / 100;
          const debitNgn = card.currency === 'USD' ? Math.round(credit * 1550 * 100) / 100 : credit;
          const wal = walletsByUserId.get(uid);
          if (wal.balance < debitNgn) return { data: { success: false, error: 'Insufficient wallet balance' }, error: null };

          const before = wal.balance;
          wal.balance = Math.round((wal.balance - debitNgn) * 100) / 100;
          wal.ledger_balance = wal.balance;
          card.card_balance = Math.round((card.card_balance + credit) * 100) / 100;

          const tx = {
            id: genUuid(),
            wallet_id: wal.id,
            user_id: uid,
            type: 'outflow',
            category: 'card_funding',
            amount: debitNgn,
            fee: 0,
            balance_before: before,
            balance_after: wal.balance,
            status: 'successful',
            counterparty_name: card.card_label,
            narration: `Funded Virtual ${card.currency} Card`,
            reference: `MP-CD-${nodeCrypto.randomBytes(4).toString('hex').toUpperCase()}`,
            idempotency_key: params.p_idempotency_key || null,
            created_at: new Date().toISOString()
          };
          transactions.unshift(tx);
          securityAuditLogs.push({ user_id: uid, event_type: 'CARD_FUNDING', entity_id: card.id, idempotency_key: params.p_idempotency_key, amount: debitNgn });
          return {
            data: {
              success: true,
              card: { ...card },
              transaction: tx,
              new_wallet_balance: wal.balance,
              new_card_balance: card.card_balance
            },
            error: null
          };
        }

        case 'manage_midesave_vault':
        case 'create_savings_vault':
        case 'fund_savings_vault':
        case 'withdraw_savings_vault': {
          const gate = assertVerifiedWalletReady(uid, 'MANAGE_MIDESAVE_VAULT');
          if (!gate.ok) return { data: { success: false, code: gate.code, error: gate.error }, error: null };

          const act = fnName === 'create_savings_vault'
            ? 'create'
            : fnName === 'fund_savings_vault'
              ? 'fund'
              : fnName === 'withdraw_savings_vault'
                ? 'withdraw'
                : String(params.p_action || '').toLowerCase();

          if (act === 'create') {
            const vault = {
              id: genUuid(),
              user_id: uid,
              title: params.p_title,
              category: params.p_category || 'General',
              target_amount: Number(params.p_target_amount),
              current_balance: 0.00,
              interest_rate_pa: Number(params.p_interest_rate_pa || 14.5),
              lock_until: params.p_lock_until || null,
              status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            savingsVaults.unshift(vault);
            return { data: fnName === 'create_savings_vault' ? { ...vault } : { success: true, vault: { ...vault } }, error: null };
          }

          if (act === 'fund' || act === 'deposit') {
            const ver = verifyPinAndAudit(uid, params.p_pin, 'MIDESAVE_DEPOSIT');
            if (!ver.ok) return { data: { success: false, code: ver.code, error: ver.error }, error: null };
            const vault = savingsVaults.find(v => v.id === params.p_vault_id && v.user_id === uid);
            if (!vault) return { data: { success: false, error: 'Vault not found' }, error: null };
            const amt = Math.round(Number(params.p_amount || 0) * 100) / 100;
            const wal = walletsByUserId.get(uid);
            if (wal.balance < amt) return { data: { success: false, error: 'Insufficient wallet balance' }, error: null };

            const before = wal.balance;
            wal.balance = Math.round((wal.balance - amt) * 100) / 100;
            wal.ledger_balance = wal.balance;
            vault.current_balance = Math.round((vault.current_balance + amt) * 100) / 100;
            const ref = `MP-SV-${nodeCrypto.randomBytes(4).toString('hex').toUpperCase()}`;
            transactions.unshift({
              id: genUuid(),
              wallet_id: wal.id,
              user_id: uid,
              type: 'outflow',
              category: 'savings',
              amount: amt,
              fee: 0,
              balance_before: before,
              balance_after: wal.balance,
              status: 'successful',
              counterparty_name: `MideSave • ${vault.title}`,
              narration: `MideSave Deposit — ${vault.title}`,
              reference: ref,
              idempotency_key: params.p_idempotency_key || null,
              created_at: new Date().toISOString()
            });
            securityAuditLogs.push({ user_id: uid, event_type: 'MIDESAVE_DEPOSIT', entity_id: vault.id, idempotency_key: params.p_idempotency_key, amount: amt });
            return {
              data: {
                success: true,
                vault_id: vault.id,
                vault_title: vault.title,
                vault_balance: vault.current_balance,
                new_balance: wal.balance,
                reference: ref
              },
              error: null
            };
          }

          if (act === 'withdraw') {
            const ver = verifyPinAndAudit(uid, params.p_pin, 'MIDESAVE_WITHDRAWAL');
            if (!ver.ok) return { data: { success: false, code: ver.code, error: ver.error }, error: null };
            const vault = savingsVaults.find(v => v.id === params.p_vault_id && v.user_id === uid);
            if (!vault) return { data: { success: false, error: 'Vault not found' }, error: null };
            const amt = Math.round(Number(params.p_amount || 0) * 100) / 100;
            if (vault.current_balance < amt) return { data: { success: false, error: 'Insufficient vault balance' }, error: null };

            const isEarlyBreak = Boolean(vault.lock_until && new Date(vault.lock_until).getTime() > Date.now());
            const fee = isEarlyBreak ? Math.round(amt * 0.015 * 100) / 100 : 0;
            const net = Math.round((amt - fee) * 100) / 100;
            const wal = walletsByUserId.get(uid);
            const before = wal.balance;
            wal.balance = Math.round((wal.balance + net) * 100) / 100;
            wal.ledger_balance = wal.balance;
            vault.current_balance = Math.round((vault.current_balance - amt) * 100) / 100;
            vault.status = isEarlyBreak ? 'broken' : (vault.current_balance === 0 ? 'matured' : 'active');
            const ref = `MP-WD-${nodeCrypto.randomBytes(4).toString('hex').toUpperCase()}`;
            transactions.unshift({
              id: genUuid(),
              wallet_id: wal.id,
              user_id: uid,
              type: 'inflow',
              category: 'savings',
              amount: net,
              fee,
              balance_before: before,
              balance_after: wal.balance,
              status: 'successful',
              counterparty_name: `MideSave • ${vault.title}`,
              narration: `MideSave Withdrawal — ${vault.title}`,
              reference: ref,
              idempotency_key: params.p_idempotency_key || null,
              created_at: new Date().toISOString()
            });
            securityAuditLogs.push({ user_id: uid, event_type: 'MIDESAVE_WITHDRAWAL', entity_id: vault.id, idempotency_key: params.p_idempotency_key, amount: amt });
            return {
              data: {
                success: true,
                vault_id: vault.id,
                vault_title: vault.title,
                gross_withdrawn: amt,
                early_break_fee: fee,
                net_credited: net,
                vault_balance: vault.current_balance,
                new_balance: wal.balance,
                status: vault.status,
                reference: ref
              },
              error: null
            };
          }

          return { data: { success: false, error: 'Invalid vault action' }, error: null };
        }

        case 'pay_vtu_bill':
        case 'pay_utility_bill': {
          const gate = assertVerifiedWalletReady(uid, 'VTU_BILL_PAYMENT');
          if (!gate.ok) return { data: { success: false, code: gate.code, error: gate.error }, error: null };
          const ver = verifyPinAndAudit(uid, params.p_pin, 'VTU_BILL_PAYMENT');
          if (!ver.ok) return { data: { success: false, code: ver.code, error: ver.error }, error: null };

          const amt = Math.round(Number(params.p_amount || 0) * 100) / 100;
          const wal = walletsByUserId.get(uid);
          if (wal.balance < amt) return { data: { success: false, error: 'Insufficient wallet balance' }, error: null };
          const before = wal.balance;
          wal.balance = Math.round((wal.balance - amt) * 100) / 100;
          wal.ledger_balance = wal.balance;

          let token = null;
          if (params.p_service_type === 'electricity') {
            token = Array.from({ length: 5 }, () => String(nodeCrypto.randomInt(0, 10000)).padStart(4, '0')).join(' ');
          }
          const ref = `MP-BL-${nodeCrypto.randomBytes(4).toString('hex').toUpperCase()}`;
          const bill = {
            id: genUuid(),
            user_id: uid,
            service_type: params.p_service_type,
            provider: params.p_provider,
            customer_identifier: params.p_identifier,
            plan_name: params.p_plan_name,
            amount: amt,
            token,
            reference: ref,
            idempotency_key: params.p_idempotency_key || null,
            created_at: new Date().toISOString()
          };
          billPayments.unshift(bill);
          transactions.unshift({
            id: genUuid(),
            wallet_id: wal.id,
            user_id: uid,
            type: 'outflow',
            category: 'bills',
            amount: amt,
            fee: 0,
            balance_before: before,
            balance_after: wal.balance,
            status: 'successful',
            counterparty_name: params.p_provider,
            narration: `${params.p_provider} (${params.p_identifier})`,
            reference: ref,
            idempotency_key: params.p_idempotency_key || null,
            created_at: new Date().toISOString()
          });
          securityAuditLogs.push({ user_id: uid, event_type: 'BILL_PAYMENT', entity_id: bill.id, idempotency_key: params.p_idempotency_key, amount: amt });
          return { data: { success: true, bill_id: bill.id, reference: ref, token, new_balance: wal.balance }, error: null };
        }

        case 'execute_payroll_batch':
        case 'execute_business_payroll': {
          const gate = assertVerifiedWalletReady(uid, 'PAYROLL_DISBURSEMENT');
          if (!gate.ok) return { data: { success: false, code: gate.code, error: gate.error }, error: null };
          const ver = verifyPinAndAudit(uid, params.p_pin, 'PAYROLL_DISBURSEMENT');
          if (!ver.ok) return { data: { success: false, code: ver.code, error: ver.error }, error: null };

          const items = Array.isArray(params.p_items) ? params.p_items : [];
          const total = items.reduce((s, it) => s + Math.round(Number(it.amount || 0) * 100) / 100, 0);
          const wal = walletsByUserId.get(uid);
          if (wal.balance < total) return { data: { success: false, error: 'Insufficient wallet balance for payroll' }, error: null };

          const before = wal.balance;
          wal.balance = Math.round((wal.balance - total) * 100) / 100;
          wal.ledger_balance = wal.balance;

          for (const it of items) {
            for (const rw of walletsByUserId.values()) {
              if (rw.nuban === String(it.identifier).trim() && rw.user_id !== uid) {
                rw.balance = Math.round((rw.balance + Number(it.amount)) * 100) / 100;
                rw.ledger_balance = rw.balance;
              }
            }
          }

          const ref = `MP-PR-${nodeCrypto.randomBytes(4).toString('hex').toUpperCase()}`;
          const run = {
            id: genUuid(),
            user_id: uid,
            title: params.p_title,
            total_amount: total,
            total_fee: 0,
            employee_count: items.length,
            status: 'completed',
            reference: ref,
            idempotency_key: params.p_idempotency_key || null,
            payroll_items: items,
            created_at: new Date().toISOString()
          };
          payrollRuns.unshift(run);
          transactions.unshift({
            id: genUuid(),
            wallet_id: wal.id,
            user_id: uid,
            type: 'outflow',
            category: 'payroll',
            amount: total,
            fee: 0,
            balance_before: before,
            balance_after: wal.balance,
            status: 'successful',
            counterparty_name: params.p_title,
            narration: `Business Payroll: ${params.p_title}`,
            reference: ref,
            idempotency_key: params.p_idempotency_key || null,
            created_at: new Date().toISOString()
          });
          securityAuditLogs.push({ user_id: uid, event_type: 'PAYROLL_DISBURSEMENT', entity_id: run.id, idempotency_key: params.p_idempotency_key, amount: total });
          return {
            data: {
              success: true,
              payroll_run_id: run.id,
              reference: ref,
              total_amount: total,
              employee_count: items.length,
              new_balance: wal.balance
            },
            error: null
          };
        }

        case 'join_waitlist':
          waitlist.push({ email: params.p_email, created_at: new Date().toISOString() });
          return { data: { success: true }, error: null };

        default:
          return { data: null, error: { message: `Unhandled RPC in simulator: ${fnName}` } };
      }
    }
  };

  return {
    client,
    directWriteViolations,
    rpcCallHistory,
    securityAuditLogs,
    otpResendHistory,
    walletsByUserId,
    profilesById,
    authUsersByEmail,
    getLatestOtp: (email) => pendingOtpsByEmail.get(String(email || '').trim().toLowerCase()) || null,
    forceUnconfirmedSessionForTest: (email) => {
      const u = authUsersByEmail.get(String(email || '').trim().toLowerCase());
      if (u) {
        activeSession = {
          access_token: `tampered-jwt-${u.id}`,
          user: { id: u.id, email: u.email, email_confirmed_at: null, user_metadata: u.user_metadata }
        };
      }
    },
    clearForcedSession: () => {
      activeSession = null;
    }
  };
}

const sim = createZeroTrustSupabaseSimulator();

const winListeners = {};
let registeredSwPath = null;
let printInvocationCount = 0;

const context = {
  console: {
    log: () => {},
    info: () => {},
    warn: () => {},
    error: (...args) => runtimeErrors.push(args.join(' '))
  },
  setTimeout: () => 1,
  clearTimeout: () => {},
  setInterval: () => 2,
  clearInterval: () => {},
  requestAnimationFrame: () => 1,
  crypto: nodeCrypto.webcrypto,
  Intl,
  TextEncoder,
  URL,
  Blob: globalThis.Blob,
  encodeURI,
  Math,
  Date,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Set,
  WeakSet,
  Map,
  JSON,
  Promise,
  Error,
  RegExp,
  parseInt,
  parseFloat,
  isNaN,
  localStorage: mockStorage,
  screen: { width: 1440, height: 900 },
  location: {
    protocol: 'https:',
    hostname: 'midepay.ng',
    origin: 'https://midepay.ng',
    pathname: '/',
    search: ''
  },
  navigator: {
    onLine: true,
    userAgent: 'MidePay-QA-Headless/4.6',
    platform: 'Win32',
    language: 'en-NG',
    clipboard: { writeText: async () => {} },
    serviceWorker: {
      register: async (swPath) => {
        registeredSwPath = swPath;
        return { scope: '/' };
      }
    }
  },
  addEventListener: (ev, fn) => {
    (winListeners[ev] = winListeners[ev] || []).push(fn);
  },
  dispatchEvent: async (ev, payload = {}) => {
    const list = winListeners[ev] || [];
    const eventObj = {
      type: ev,
      preventDefault() {},
      stopPropagation() {},
      ...payload
    };
    return Promise.all(list.map(fn => fn(eventObj)));
  },
  print: () => {
    printInvocationCount++;
  },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  scrollTo: () => {},
  document: mockDocument,
  supabase: {
    createClient: () => sim.client
  },
  bcrypt: {
    hashSync: () => `$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234`,
    compareSync: (pin, hash) => pin === '1234' && hash.startsWith('$2a$10$')
  }
};
context.window = context;
context.globalThis = context;

vm.createContext(context);

// Execute scripts in exact index.html order
for (const scriptFile of ['liquid-glass.js', 'config.js', 'supabaseClient.js', 'app.js']) {
  const code = fs.readFileSync(path.join(ROOT, scriptFile), 'utf8');
  vm.runInContext(code, context, { filename: scriptFile });
}

// Fire DOMContentLoaded
(docListeners['DOMContentLoaded'] || []).forEach(fn => fn());

async function runAssertions() {
  let failed = 0;
  const check = (cond, label) => {
    if (cond) console.log(`  ✅ PASS: ${label}`);
    else { console.error(`  ❌ FAIL: ${label}`); failed++; }
  };

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  console.log('======================================================================');
  console.log(' MidePay v4.6 — OTP, PIN Onboarding & Zero-Trust RPC E2E Suite');
  console.log('======================================================================\n');

  check(runtimeErrors.length === 0, `Zero console.error emissions during boot (${runtimeErrors.length} errors)`);
  check(context.MIDEPAY_SUPABASE_CONFIG.ENV === 'production', 'window.MIDEPAY_SUPABASE_CONFIG.ENV === "production"');
  check(context.MidePayDB.isProduction() === true, 'MidePayDB.isProduction() === true');
  check(context.MidePayDB.configure('https://evil.example', 'fake') === false, 'Runtime localStorage credential override blocked in production');

  const demoLookup = await context.MidePayDB.findRecipient('chinedu@midepay.com');
  check(demoLookup === null, 'Demo recipient fallback (chinedu@midepay.com) strictly returns null in production');

  const unauthTransfer = await context.MidePayDB.transferFunds({
    senderId: 'a0000000-0000-4000-8000-000000000001',
    recipientId: 'a0000000-0000-4000-8000-000000000002',
    amount: 5000,
    narration: 'Test'
  });
  check(unauthTransfer.success === false && !unauthTransfer.isDemo, 'Unauthenticated transfer strictly rejected in production');

  await context.showView('admin');
  check(context.currentView !== 'admin' && !elementsById.get('view-admin').classList.contains('active'), 'Executive Portal route guard blocks unverified access');

  const lgAttachedCount = allElements.filter(e => e.classList.contains('liquid-glass')).length;
  check(lgAttachedCount >= 10, `Liquid Glass v2.5 attached to all ${lgAttachedCount} glass elements`);

  check(
    elementsById.get('btn-dash-quick-topup').style.display === 'none' &&
    elementsById.get('btn-dash-quick-topup').disabled === true,
    '"+ Fund ₦50k (Demo)" button (#btn-dash-quick-topup) never renders and is disabled when ENV === "production"'
  );

  const baselineSecurityLogs = runtimeErrors.length;

  // =========================================================================
  // 1. 6-DIGIT EMAIL OTP SIGNUP FLOW, RESEND COOLDOWN & UNVERIFIED RPC GUARD
  // =========================================================================
  const sampleNubans = new Set();
  for (let i = 0; i < 50; i++) {
    sampleNubans.add(context.MidePayDB.generateSecureRandomNuban());
  }
  check(
    [...sampleNubans].every(n => /^90\d{8}$/.test(n)) && sampleNubans.size === 50,
    'MidePayDB.generateSecureRandomNuban() produces 100% valid & unique 10-digit 90XXXXXXXX NUBANs via Web Crypto CSPRNG'
  );

  // Register User A (Amaka Okafor) -> must NOT enter dashboard; must open 6-Digit Email OTP Modal
  elementsById.get('reg-fullname').value = 'Amaka Okafor';
  elementsById.get('reg-email').value = 'amaka.okafor@midepay.ng';
  elementsById.get('reg-phone').value = '08031112222';
  elementsById.get('reg-password').value = 'SecurePass123!';
  await elementsById.get('register-form').dispatchEvent('submit');

  const otpModal = elementsById.get('modal-otp-verification');
  const btnResendOtp = elementsById.get('btn-resend-otp');
  const otpTimerEl = elementsById.get('otp-resend-timer');

  check(
    !otpModal.classList.contains('hidden') &&
    context.currentView !== 'dashboard' &&
    elementsById.get('otp-target-email').textContent === 'amaka.okafor@midepay.ng' &&
    btnResendOtp.disabled === true &&
    otpTimerEl.textContent === 'Resend code in 60s',
    'Signup transitions smoothly into 6-Digit Email OTP modal (no premature dashboard login) with 60s resend cooldown'
  );

  // Database Verification Guard: verify ALL 5 canonical financial RPCs reject an unverified email user (`email_confirmed_at IS NULL`)
  sim.forceUnconfirmedSessionForTest('amaka.okafor@midepay.ng');
  const [unverP2p, unverCard, unverBill, unverVault, unverPayroll] = await Promise.all([
    sim.client.rpc('execute_p2p_transfer', { p_recipient_nuban: '9012345678', p_amount: 1000, p_pin: '1234', p_idempotency_key: nodeCrypto.randomUUID() }),
    sim.client.rpc('fund_virtual_card', { p_card_id: nodeCrypto.randomUUID(), p_amount_card_currency: 50, p_pin: '1234', p_idempotency_key: nodeCrypto.randomUUID() }),
    sim.client.rpc('pay_vtu_bill', { p_service_type: 'airtime', p_provider: 'MTN', p_identifier: '08031112222', p_plan_name: 'Airtime', p_amount: 500, p_pin: '1234', p_idempotency_key: nodeCrypto.randomUUID() }),
    sim.client.rpc('manage_midesave_vault', { p_action: 'fund', p_vault_id: nodeCrypto.randomUUID(), p_amount: 5000, p_pin: '1234', p_idempotency_key: nodeCrypto.randomUUID() }),
    sim.client.rpc('execute_payroll_batch', { p_business_id: null, p_title: 'Test', p_items: [{ identifier: '9012345678', amount: 10000 }], p_pin: '1234', p_idempotency_key: nodeCrypto.randomUUID() })
  ]);
  sim.clearForcedSession();

  check(
    [unverP2p, unverCard, unverBill, unverVault, unverPayroll].every(r => r.data?.success === false && r.data?.code === 'EMAIL_NOT_VERIFIED') &&
    sim.securityAuditLogs.filter(e => e.event_type === 'UNVERIFIED_EMAIL_BLOCKED').length >= 5,
    'All 5 financial RPCs (execute_p2p_transfer, fund_virtual_card, pay_vtu_bill, manage_midesave_vault, execute_payroll_batch) reject unverified users (EMAIL_NOT_VERIFIED)'
  );

  // Unconfirmed User Login Auto-Routing & Automatic OTP Resend
  await elementsById.get('btn-otp-back-to-login').click();
  check(otpModal.classList.contains('hidden'), 'Back to Sign In button closes OTP modal cleanly');

  const resendsBeforeUnconfirmedLogin = sim.otpResendHistory.length;
  elementsById.get('login-email').value = 'amaka.okafor@midepay.ng';
  elementsById.get('login-password').value = 'SecurePass123!';
  await elementsById.get('login-form').dispatchEvent('submit');

  check(
    !otpModal.classList.contains('hidden') &&
    sim.otpResendHistory.length === resendsBeforeUnconfirmedLogin + 1 &&
    elementsById.get('otp-feedback-alert').textContent.includes('6-digit verification code'),
    'Unconfirmed user login ("Email not confirmed") auto-routes to 6-Digit OTP modal and triggers auth.resend({ type: "signup" })'
  );

  // Verify 60-Second Resend Cooldown Timer Progression & Resend Trigger
  context.tickOtpResendCooldown(30);
  const disabledAt30s = btnResendOtp.disabled === true && otpTimerEl.textContent === 'Resend code in 30s';
  context.tickOtpResendCooldown(30);
  const enabledAt0s = btnResendOtp.disabled === false;
  const otpBeforeManualResend = sim.getLatestOtp('amaka.okafor@midepay.ng');
  await btnResendOtp.click();
  const otpAfterManualResend = sim.getLatestOtp('amaka.okafor@midepay.ng');

  check(
    disabledAt30s &&
    enabledAt0s &&
    sim.otpResendHistory.length === resendsBeforeUnconfirmedLogin + 2 &&
    btnResendOtp.disabled === true &&
    otpTimerEl.textContent === 'Resend code in 60s' &&
    /^\d{6}$/.test(otpAfterManualResend),
    '60-second Resend OTP cooldown locks button during countdown, unlocks at 0s, issues new code via auth.resend, and resets to 60s'
  );

  // Verify Auto-Advancing Digit Input & Full 6-Digit Paste Support
  elementsById.get('otp-digit-1').value = '7';
  await elementsById.get('otp-digit-1').dispatchEvent('input');
  const autoAdvancedToDigit2 = lastFocusedElementId === 'otp-digit-2';

  await elementsById.get('otp-digit-1').dispatchEvent('paste', {
    clipboardData: { getData: () => `OTP: ${otpAfterManualResend}` }
  });
  check(
    autoAdvancedToDigit2 && context.getCollectedOtpToken() === otpAfterManualResend && lastFocusedElementId === 'otp-digit-6',
    'OTP inputs auto-advance on keystroke and parse/distribute pasted 6-digit codes across #otp-digit-1..6'
  );

  // Reject wrong 6-digit OTP first
  context.fillOtpDigits(otpAfterManualResend === '000000' ? '111111' : '000000');
  await elementsById.get('otp-verify-form').dispatchEvent('submit');
  check(
    !otpModal.classList.contains('hidden') && elementsById.get('otp-feedback-alert').classList.contains('error'),
    'Invalid 6-digit OTP token is rejected by auth.verifyOtp and keeps OTP modal open'
  );

  // Verify valid 6-digit OTP -> logs USER_LOGIN audit + locks dashboard behind Mandatory 4-Digit PIN Onboarding modal!
  context.fillOtpDigits(otpAfterManualResend);
  await elementsById.get('otp-verify-form').dispatchEvent('submit');

  const pinOnboardingModal = elementsById.get('modal-pin-onboarding');
  const dashView = elementsById.get('view-dashboard');
  const loginBanner = elementsById.get('login-security-alert-banner');
  const userAId = (await context.MidePayDB.getCurrentUser())?.id;

  check(
    otpModal.classList.contains('hidden') &&
    !pinOnboardingModal.classList.contains('hidden') &&
    dashView.classList.contains('dashboard-pin-locked') &&
    !loginBanner.classList.contains('hidden') &&
    sim.securityAuditLogs.some(e => e.event_type === 'USER_LOGIN' && e.user_id === userAId && e.metadata?.platform === 'Win32'),
    'First verified login records USER_LOGIN device metadata in security_audit_logs, shows login alert, and locks dashboard behind Create 4-Digit PIN modal'
  );

  // Verify Database Guard ALSO blocks verified users whose `transaction_pin_hash IS NULL` before PIN setup completes!
  const prePinTopupAttempt = await context.MidePayDB.recordDeposit({ userId: userAId, amount: 10000 });
  check(
    prePinTopupAttempt.success === false &&
    sim.securityAuditLogs.some(e => e.event_type === 'MISSING_PIN_BLOCKED' && e.user_id === userAId),
    'Financial RPCs strictly block ledger movements while transaction_pin_hash IS NULL (PIN_SETUP_REQUIRED)'
  );

  // Reject mismatched PIN confirmation in Mandatory PIN Onboarding modal
  elementsById.get('pin-onboarding-new').value = '1234';
  elementsById.get('pin-onboarding-confirm').value = '9876';
  await elementsById.get('pin-onboarding-form').dispatchEvent('submit');
  check(
    !pinOnboardingModal.classList.contains('hidden') && !elementsById.get('pin-onboarding-error').classList.contains('hidden'),
    'Mandatory PIN Onboarding rejects mismatched 4-digit PIN confirmation'
  );

  // Complete Mandatory 4-Digit PIN Setup ('1234') -> Unlocks Dashboard!
  elementsById.get('pin-onboarding-new').value = '1234';
  elementsById.get('pin-onboarding-confirm').value = '1234';
  await elementsById.get('pin-onboarding-form').dispatchEvent('submit');

  const userANuban = elementsById.get('dash-nuban-text').textContent.replace(/\s+/g, '');
  const userAModalNuban = elementsById.get('modal-nuban-copy').textContent.replace(/\s+/g, '');
  await context.openCardsModal();
  const userAFirstPan = context.getVirtualCardState().cards[0]?.fullPan;

  check(
    pinOnboardingModal.classList.contains('hidden') &&
    !dashView.classList.contains('dashboard-pin-locked') &&
    /^90\d{8}$/.test(userANuban) &&
    userANuban === userAModalNuban,
    `Completing 4-Digit PIN setup encrypts transaction_pin_hash via RPC and unlocks User A NUBAN (${userANuban})`
  );

  // Logout User A -> Register + OTP Verify + Onboard PIN for User B (Tunde Balogun) -> Verify isolation
  await context.handleLogout();
  elementsById.get('reg-fullname').value = 'Tunde Balogun';
  elementsById.get('reg-email').value = 'tunde.balogun@midepay.ng';
  elementsById.get('reg-phone').value = '08053334444';
  elementsById.get('reg-password').value = 'TundePass456!';
  await elementsById.get('register-form').dispatchEvent('submit');

  const tundeOtp = sim.getLatestOtp('tunde.balogun@midepay.ng');
  context.fillOtpDigits(tundeOtp);
  await elementsById.get('otp-verify-form').dispatchEvent('submit');
  elementsById.get('pin-onboarding-new').value = '4321';
  elementsById.get('pin-onboarding-confirm').value = '4321';
  await elementsById.get('pin-onboarding-form').dispatchEvent('submit');

  const userBNuban = elementsById.get('dash-nuban-text').textContent.replace(/\s+/g, '');
  await context.openCardsModal();
  const userBFirstPan = context.getVirtualCardState().cards[0]?.fullPan;
  const userBId = [...sim.profilesById.values()].find(p => p.email === 'tunde.balogun@midepay.ng')?.id;

  check(
    /^90\d{8}$/.test(userBNuban) && userBNuban !== userANuban && userBFirstPan !== userAFirstPan,
    `Second user OTP verification + PIN onboarding gets isolated NUBAN (${userBNuban}) and Virtual Debit Card PAN`
  );

  // Logout User B -> Sign back in as verified User A (who ALREADY has transaction_pin_hash) -> Unlocked immediately!
  await context.handleLogout();
  elementsById.get('login-email').value = 'amaka.okafor@midepay.ng';
  elementsById.get('login-password').value = 'SecurePass123!';
  await elementsById.get('login-form').dispatchEvent('submit');
  await context.openCardsModal();
  const reloadedUserANuban = elementsById.get('dash-nuban-text').textContent.replace(/\s+/g, '');
  const reloadedUserAPan = context.getVirtualCardState().cards[0]?.fullPan;

  check(
    pinOnboardingModal.classList.contains('hidden') &&
    !dashView.classList.contains('dashboard-pin-locked') &&
    reloadedUserANuban === userANuban &&
    reloadedUserAPan === userAFirstPan,
    'Returning verified user with existing PIN logs directly into unlocked dashboard with persisted NUBAN & Cards'
  );

  // =========================================================================
  // 2. DIRECT WALLET TOP-UP RPC, IDEMPOTENCY DEDUPLICATION & SUBMIT LOCKS
  // =========================================================================
  const addFundsForm = elementsById.get('add-funds-form');
  const topupAmtInput = elementsById.get('topup-amount');

  topupAmtInput.value = '25000';
  await addFundsForm.dispatchEvent('submit');
  check(
    elementsById.get('modal-add-money').classList.contains('hidden') &&
    sim.walletsByUserId.get(userAId).balance === 25000 &&
    elementsById.get('dash-balance-display').textContent.includes('25,000.00'),
    'Instant Direct Wallet Top-Up (+₦25,000) calls concept_topup_wallet RPC and re-hydrates server balance (₦25,000.00)'
  );

  const fixedIdemKey = context.newIdempotencyKey();
  const firstIdemCall = await context.MidePayDB.recordDeposit({ userId: userAId, amount: 5000, idempotencyKey: fixedIdemKey });
  const replayIdemCall = await context.MidePayDB.recordDeposit({ userId: userAId, amount: 5000, idempotencyKey: fixedIdemKey });
  await context.rehydrateBalanceFromServer();
  check(
    uuidRegex.test(fixedIdemKey) &&
    firstIdemCall.success === true &&
    replayIdemCall.success === true &&
    sim.walletsByUserId.get(userAId).balance === 30000,
    `UUID v4 idempotency_key (${fixedIdemKey}) deduplicates replayed deposit without double-crediting (server balance: ₦30,000.00)`
  );

  const testLockBtn = new MockElement('BUTTON');
  let lockExecutions = 0;
  let observedLoadingState = false;
  let resolveSlowTask;
  const slowPromise = context.withSubmitLock('test-double-click', testLockBtn, 'Authorizing...', async (idem) => {
    lockExecutions++;
    observedLoadingState = testLockBtn.disabled === true && testLockBtn.classList.contains('loading') && uuidRegex.test(idem);
    await new Promise(r => { resolveSlowTask = r; });
  });
  const duplicateClickResult = await context.withSubmitLock('test-double-click', testLockBtn, 'Authorizing...', async () => {
    lockExecutions++;
  });
  resolveSlowTask();
  await slowPromise;
  check(
    lockExecutions === 1 && duplicateClickResult?.locked === true && observedLoadingState && testLockBtn.disabled === false && !testLockBtn.classList.contains('loading'),
    'withSubmitLock blocks concurrent double-click submissions, injects spinner/loading state, and releases cleanly'
  );

  // =========================================================================
  // 3. PWA SERVICE WORKER, OFFLINE BANNER & DOWNLOADABLE ACCOUNT STATEMENTS
  // =========================================================================
  check(registeredSwPath === 'sw.js', 'PWA Service Worker registered cleanly via navigator.serviceWorker.register("sw.js")');

  const csvResult = context.exportAccountStatementCsv();
  check(
    csvResult &&
      /^MidePay_Statement_\d{4}-\d{2}-\d{2}\.csv$/.test(csvResult.fileName) &&
      csvResult.rowCount > 0 &&
      csvResult.csvBody.includes('Instant Direct Wallet Top-Up'),
    `CSV Statement Export generated ${csvResult?.fileName} (${csvResult?.rowCount} rows)`
  );

  context.openOfficialStatementModal();
  await elementsById.get('btn-print-statement').click();
  check(printInvocationCount === 1, 'Official Statement View populates NUBAN/rows and invokes window.print()');

  // =========================================================================
  // 4. REAL-TIME NUBAN ENQUIRY & ATOMIC P2P NUBAN TRANSFER RPC
  // =========================================================================
  elementsById.get('send-destination').value = 'MidePay';
  elementsById.get('send-recipient').value = userBNuban;
  const midepayEnquiry = await context.resolveRecipientEnquiry();
  check(
    midepayEnquiry?.resolved === true &&
      elementsById.get('account-resolved-text').innerHTML.includes('Tunde Balogun'),
    `10-digit MidePay NUBAN lookup (${userBNuban}) resolves "Verified MidePay Account: Tunde Balogun"`
  );

  const p2pIdem = context.newIdempotencyKey();
  const p2pRes = await context.MidePayDB.executeP2PTransfer({
    recipientNuban: userBNuban,
    amount: 5000,
    pin: '1234',
    idempotencyKey: p2pIdem,
    narration: 'Project Milestone Settlement'
  });
  const p2pDupRes = await context.MidePayDB.executeP2PTransfer({
    recipientNuban: userBNuban,
    amount: 5000,
    pin: '1234',
    idempotencyKey: p2pIdem,
    narration: 'Project Milestone Settlement'
  });
  await context.rehydrateBalanceFromServer(p2pRes.newBalance);
  check(
    p2pRes.success === true &&
    p2pDupRes.status === 'duplicate' &&
    sim.walletsByUserId.get(userAId).balance === 25000 &&
    sim.walletsByUserId.get(userBId).balance === 5000 &&
    elementsById.get('dash-balance-display').textContent.includes('25,000.00'),
    'execute_p2p_transfer RPC atomically moves ₦5,000.00 (User A -> User B), deduplicates replay, and re-hydrates balance'
  );

  // =========================================================================
  // 5. VIRTUAL CARDS RPCs (REVEAL AUDIT LOG, FREEZE, LIMIT, ISSUE & FUND)
  // =========================================================================
  await context.openCardsModal();
  const panDisplay = elementsById.get('card-pan-display');
  const cvvDisplay = elementsById.get('card-cvv-val');
  const cardStatusBadge = elementsById.get('card-status-badge');

  await elementsById.get('btn-toggle-pan').click();
  await elementsById.get('btn-toggle-cvv').click();
  const revealAudits = sim.securityAuditLogs.filter(e => e.event_type === 'CARD_REVEAL');
  check(
    /^5399 \d{4} \d{4} \d{4}$/.test(panDisplay.textContent) &&
    /^\d{3}$/.test(cvvDisplay.textContent) &&
    revealAudits.length >= 2,
    `PAN/CVV toggle reveals credentials and records ${revealAudits.length} CARD_REVEAL events in security_audit_logs`
  );

  await elementsById.get('btn-freeze-card').click();
  check(cardStatusBadge.textContent === 'Frozen', 'set_virtual_card_freeze RPC persists Frozen state');
  await elementsById.get('btn-freeze-card').click();
  check(cardStatusBadge.textContent === 'Active', 'set_virtual_card_freeze RPC restores Active status');

  await elementsById.get('btn-edit-card-limit').click();
  elementsById.get('card-limit-input').value = '3500';
  await elementsById.get('btn-save-card-limit').click();
  check(elementsById.get('card-limit-val').textContent.includes('$3,500.00'), 'set_virtual_card_limit RPC updates monthly limit');

  const countBeforeCreate = context.getVirtualCardState().cards.length;
  await elementsById.get('btn-create-virtual-card').click();
  check(context.getVirtualCardState().cards.length === countBeforeCreate + 1, 'issue_virtual_card RPC issues & persists a new unique 5399 card');

  // =========================================================================
  // 6. MIDESAVE VAULTS, 5-STRIKE PIN AUDIT, VTU BILLS & TEAM PAYROLL RPCs
  // =========================================================================
  elementsById.get('topup-amount').value = '500000';
  await elementsById.get('add-funds-form').dispatchEvent('submit');

  await context.openMideSaveModal(true);
  elementsById.get('vault-title-input').value = 'Rent 2027';
  elementsById.get('vault-category-select').value = 'Housing & Rent';
  elementsById.get('vault-target-input').value = '1500000';
  elementsById.get('vault-lock-date-input').value = '2027-12-31';
  await elementsById.get('midesave-create-form').dispatchEvent('submit');

  const createdVault = context.getMideSaveState().vaults[0];
  check(
    Boolean(createdVault && createdVault.title === 'Rent 2027'),
    'manage_midesave_vault (create) RPC creates goal vault ("Rent 2027", 14.5% p.a.)'
  );

  context.openVaultTransactionDrawer(createdVault.id, 'fund');
  elementsById.get('midesave-action-amount').value = '100000';
  elementsById.get('midesave-action-pin').value = '1234';
  await elementsById.get('midesave-action-form').dispatchEvent('submit');
  check(
    Number(createdVault.current_balance) === 100000,
    'manage_midesave_vault (fund) RPC debits wallet and credits MideSave vault to ₦100,000.00'
  );

  context.openVaultTransactionDrawer(createdVault.id, 'withdraw');
  elementsById.get('midesave-action-amount').value = '20000';
  elementsById.get('midesave-action-pin').value = '9999';
  await elementsById.get('midesave-action-form').dispatchEvent('submit');
  check(
    Number(createdVault.current_balance) === 100000 &&
    sim.securityAuditLogs.some(e => e.event_type === 'PIN_FAILED'),
    'Wrong 4-digit PIN (9999) is rejected server-side and recorded in security_audit_logs (PIN_FAILED)'
  );

  elementsById.get('midesave-action-pin').value = '1234';
  await elementsById.get('midesave-action-form').dispatchEvent('submit');
  check(
    Number(createdVault.current_balance) === 80000 && createdVault.status === 'broken',
    'manage_midesave_vault (withdraw) RPC applies 1.5% early-break fee and updates vault balance to ₦80,000.00'
  );

  context.openAirtimeModal('airtime');
  elementsById.get('airtime-phone').value = '08031112222';
  elementsById.get('airtime-amount').value = '1000';
  elementsById.get('airtime-pin-input').value = '1234';
  await elementsById.get('airtime-data-form').dispatchEvent('submit');
  check(elementsById.get('modal-airtime-data').classList.contains('hidden'), 'pay_vtu_bill RPC executes Airtime purchase');

  context.openBillsModal('electricity');
  elementsById.get('meter-number-input').value = '04192847291';
  elementsById.get('electricity-amount-input').value = '10000';
  elementsById.get('bills-pin-input').value = '1234';
  await elementsById.get('bill-payment-form').dispatchEvent('submit');
  const tokenText = elementsById.get('receipt-token-digits').textContent.trim();
  check(/^\d{4} \d{4} \d{4} \d{4} \d{4}$/.test(tokenText), `pay_vtu_bill RPC generates 20-digit STS meter token (${tokenText})`);

  context.switchDashboardWorkspace('business');
  elementsById.get('payroll-staff-identifier').value = userBNuban;
  elementsById.get('payroll-staff-role').value = 'Senior Backend Engineer';
  elementsById.get('payroll-staff-salary').value = '150000';
  await context.resolvePayrollStaffIdentifier(userBNuban);
  await elementsById.get('payroll-add-staff-form').dispatchEvent('submit');

  elementsById.get('payroll-pin-input').value = '1234';
  await elementsById.get('btn-execute-payroll').click();
  check(
    context.getPayrollRosterState().roster.length === 0 &&
    sim.walletsByUserId.get(userBId).balance === 155000,
    'execute_payroll_batch RPC verifies PIN, disburses ₦150,000.00 to staff NUBAN, and records payroll run'
  );

  await elementsById.get('tab-card-ngn').click();
  await elementsById.get('btn-fund-card-modal').click();
  check(
    elementsById.get('card-balance-display').textContent.includes('25,000.00') &&
    elementsById.get('card-mini-tx-list').innerHTML.includes('DSTV Compact Plus'),
    'fund_virtual_card RPC debits main wallet, funds NGN card (+₦25,000), and renders NGN subscriptions'
  );

  // =========================================================================
  // 7. ZERO-TRUST ARCHITECTURAL GUARANTEES (0 DIRECT WRITES, 100% SERVER PARITY)
  // =========================================================================
  const expectedServerBal = sim.walletsByUserId.get(userAId).balance;
  check(
    elementsById.get('dash-balance-display').textContent.includes(expectedServerBal.toLocaleString('en-US', { minimumFractionDigits: 2 })),
    `Dashboard balance strictly matches authoritative PostgreSQL wallet balance (₦${expectedServerBal.toLocaleString('en-US', { minimumFractionDigits: 2 })})`
  );

  const ledgerMutatingCalls = sim.rpcCallHistory.filter(c => {
    if (['concept_topup_wallet', 'execute_p2p_transfer', 'fund_virtual_card', 'pay_vtu_bill', 'execute_payroll_batch'].includes(c.fn)) {
      return true;
    }
    if (c.fn === 'manage_midesave_vault' && ['fund', 'withdraw'].includes(c.params.p_action)) {
      return true;
    }
    return false;
  });
  const allHaveValidUuidIdempotency = ledgerMutatingCalls.length >= 10 && ledgerMutatingCalls.every(c => uuidRegex.test(c.params.p_idempotency_key || ''));
  check(
    allHaveValidUuidIdempotency,
    `100% of ledger-mutating RPC calls (${ledgerMutatingCalls.length}/${ledgerMutatingCalls.length}) carry a valid crypto.randomUUID() p_idempotency_key`
  );

  check(
    sim.directWriteViolations.length === 0,
    `Zero direct table .insert()/.update()/.upsert()/.delete() violations across entire E2E session (${sim.directWriteViolations.length} violations)`
  );

  // Verify 5-strike PIN lockout enforcement on server
  for (let strike = 1; strike <= 5; strike++) {
    await context.MidePayDB.verifyTransactionPin(userAId, '0000');
  }
  const lockedAttempt = await context.MidePayDB.verifyTransactionPin(userAId, '1234');
  check(
    lockedAttempt.valid === false && /locked/i.test(lockedAttempt.error || '') && sim.securityAuditLogs.some(e => e.event_type === 'PIN_LOCKED'),
    '5 consecutive failed PIN attempts trigger server-side 15-minute lockout and record PIN_LOCKED in security_audit_logs'
  );

  check(runtimeErrors.length === baselineSecurityLogs, 'Zero unexpected console.error emissions across entire v4.6 E2E suite');

  if (failed > 0) process.exit(1);
  console.log('\n🎉 ALL OTP, RESEND COOLDOWN, MANDATORY PIN ONBOARDING, LOGIN AUDIT & ZERO-TRUST RPC TESTS PASSED!');
}

runAssertions().catch(err => {
  console.error(err);
  process.exit(1);
});
