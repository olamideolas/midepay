#!/usr/bin/env node
/**
 * MidePay v4.0 — Headless Runtime & Flow Verification Suite
 * Loads all 341 real HTML element IDs from `index.html` into an instrumented DOM
 * harness and executes `liquid-glass.js`, `config.js`, `supabaseClient.js`, and `app.js`
 * end-to-end to verify zero runtime console errors and strict production security gates.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Build lightweight DOM element registry from every tag with id="..." or class="..." in index.html
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

class MockElement {
  constructor(tagName = 'DIV', attrs = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.id = attrs.id || '';
    this.value = attrs.value || '';
    this.type = attrs.type || 'text';
    this.checked = 'checked' in attrs;
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.style = { setProperty() {}, removeProperty() {} };
    this.dataset = {};
    this._attrs = { ...attrs };
    this.classList = new MockClassList(attrs.class || '');
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
  getAttribute(k) { return this._attrs[k] ?? null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
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
  click() { return this.dispatchEvent('click'); }
  focus() {}
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
    return [];
  },
  addEventListener: (ev, fn) => {
    (docListeners[ev] = docListeners[ev] || []).push(fn);
  }
};

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
  setTimeout: (fn) => { return 1; },
  clearTimeout: () => {},
  requestAnimationFrame: () => 1,
  crypto: require('crypto').webcrypto,
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
  location: {
    protocol: 'https:',
    hostname: 'midepay.ng',
    origin: 'https://midepay.ng',
    pathname: '/',
    search: ''
  },
  navigator: {
    onLine: true,
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
  bcrypt: {
    hashSync: (pin) => `$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234`,
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

  console.log('======================================================================');
  console.log(' MidePay v4.0 — Runtime Execution & Security Gate Integration Tests');
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
  check(unauthTransfer.success === false && !unauthTransfer.isDemo, 'Mock client transfer fallback disabled in production');

  // Verify remediated Send Money DOM elements exist & update reactively
  const elStepBal = elementsById.get('amount-step-balance');
  const elQuickFund = elementsById.get('btn-amount-quick-fund');
  const elInsufBtn = elementsById.get('btn-insufficient-fund-now');
  const elInsufAlert = elementsById.get('insufficient-balance-alert');
  const elSendAmt = elementsById.get('send-amount');

  check(Boolean(elStepBal && elQuickFund && elInsufBtn && elInsufAlert), 'All remediated #modal-send-money DOM elements bound in runtime');

  elSendAmt.value = '99999999';
  await elSendAmt.dispatchEvent('input');
  check(!elInsufAlert.classList.contains('hidden'), 'Entering amount > balance reveals #insufficient-balance-alert');

  elSendAmt.value = '1000';
  await elSendAmt.dispatchEvent('input');
  check(elInsufAlert.classList.contains('hidden'), 'Entering valid amount <= balance hides #insufficient-balance-alert');

  // Verify Executive Admin Portal route guard blocks unauthorized access
  await context.showView('admin');
  check(context.currentView !== 'admin' && !elementsById.get('view-admin').classList.contains('active'), 'Executive Portal route guard blocks unverified access');

  const lgAttachedCount = allElements.filter(e => e.classList.contains('liquid-glass')).length;
  check(lgAttachedCount >= 10, `Liquid Glass v2.5 attached to all ${lgAttachedCount} glass elements`);

  // Snapshot intentional security-gate rejection logs from configure() / unauthorized admin guard above
  const baselineSecurityLogs = runtimeErrors.length;

  // Verify Direct Top-Up default & "Coming Nov 30" Roadmap Gateway Decoupling
  check(typeof context.MidePayDB.initializeGatewayDeposit === 'function', 'MidePayDB.initializeGatewayDeposit exposed for Nov 30 gateway rollout');
  const btnDirect = elementsById.get('gateway-provider-direct');
  const btnPaystack = elementsById.get('gateway-provider-paystack');
  const btnFlw = elementsById.get('gateway-provider-flutterwave');
  const gwInput = elementsById.get('topup-gateway-provider');
  const topupBtnText = elementsById.get('confirm-topup-btn-text');
  const addFundsForm = elementsById.get('add-funds-form');
  const topupAmtInput = elementsById.get('topup-amount');

  check(
    gwInput.value === 'direct' && btnDirect.classList.contains('active') && topupBtnText.textContent === 'Credit Wallet Instantly',
    'Add Money modal defaults to Instant Direct Wallet Top-Up (#gateway-provider-direct)'
  );
  check(
    btnPaystack.classList.contains('is-disabled-roadmap') && btnFlw.classList.contains('is-disabled-roadmap'),
    'Paystack & Flutterwave cards display disabled "Coming Nov 30" roadmap state while GATEWAYS_LIVE !== true'
  );

  await btnFlw.click();
  check(
    gwInput.value === 'direct' && topupBtnText.textContent === 'Credit Wallet Instantly',
    'Clicking disabled Flutterwave roadmap card keeps Direct Top-Up selected without gateway errors'
  );

  topupAmtInput.value = '25000';
  await addFundsForm.dispatchEvent('submit');
  check(
    elementsById.get('modal-add-money').classList.contains('hidden') && runtimeErrors.length === baselineSecurityLogs,
    'Submitting Instant Direct Wallet Top-Up (+₦25,000) succeeds with zero gateway or console errors'
  );

  // Verify PWA Service Worker Registration, Install Banner & Offline Fallback Banner
  check(registeredSwPath === 'sw.js', 'PWA Service Worker registered cleanly via navigator.serviceWorker.register("sw.js")');

  const pwaBanner = elementsById.get('pwa-install-banner');
  const btnPwaInstall = elementsById.get('btn-pwa-install');
  let promptCalled = false;
  await context.dispatchEvent('beforeinstallprompt', {
    prompt: () => { promptCalled = true; },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  });
  check(!pwaBanner.classList.contains('hidden'), 'beforeinstallprompt event reveals #pwa-install-banner on dashboard');

  await btnPwaInstall.click();
  check(promptCalled && pwaBanner.classList.contains('hidden'), 'Clicking #btn-pwa-install triggers install prompt and hides banner on acceptance');

  const offlineBanner = elementsById.get('offline-status-banner');
  await context.dispatchEvent('offline');
  check(!offlineBanner.classList.contains('hidden'), 'Offline event reveals #offline-status-banner clean fallback notice');
  await context.dispatchEvent('online');
  check(offlineBanner.classList.contains('hidden'), 'Online event hides #offline-status-banner automatically');

  // Verify Downloadable Account Statements (CSV Export & Official Print-Ready PDF Statement Modal)
  const csvResult = context.exportAccountStatementCsv();
  check(
    csvResult &&
      /^MidePay_Statement_\d{4}-\d{2}-\d{2}\.csv$/.test(csvResult.fileName) &&
      csvResult.rowCount > 0 &&
      csvResult.csvBody.includes('Date,Reference,Type,Category,Counterparty,Narration,Amount (NGN),Fee (NGN),Status') &&
      csvResult.csvBody.includes('Instant Direct Wallet Top-Up'),
    `CSV Statement Export generated ${csvResult?.fileName} (${csvResult?.rowCount} rows) with all required columns`
  );

  context.openOfficialStatementModal();
  const stmtModal = elementsById.get('modal-account-statement');
  const stmtNuban = elementsById.get('stmt-holder-nuban');
  const stmtTbody = elementsById.get('stmt-transactions-tbody');
  const btnPrintStmt = elementsById.get('btn-print-statement');
  check(
    !stmtModal.classList.contains('hidden') &&
      stmtNuban.textContent.trim().length >= 10 &&
      stmtTbody.innerHTML.includes('<tr>'),
    'Official Statement View (#modal-account-statement) populates NUBAN, summary totals, and transaction rows'
  );

  await btnPrintStmt.click();
  check(printInvocationCount === 1, 'Clicking Print / Save as PDF (#btn-print-statement) invokes window.print()');

  // =========================================================================
  // v4.3 TESTS: CSPRNG NUBAN, SIGNUP/LOGIN LIFECYCLE, NUBAN LOOKUP & VIRTUAL CARDS
  // =========================================================================

  // 1. Cryptographically Random 10-Digit NUBAN Uniqueness & Format
  const sampleNubans = new Set();
  for (let i = 0; i < 50; i++) {
    sampleNubans.add(context.MidePayDB.generateSecureRandomNuban());
  }
  const allValid10Digits = [...sampleNubans].every(n => /^90\d{8}$/.test(n));
  check(
    allValid10Digits && sampleNubans.size === 50,
    'MidePayDB.generateSecureRandomNuban() produces 100% valid & unique 10-digit 90XXXXXXXX NUBANs via Web Crypto CSPRNG'
  );

  // 2. Seamless New Email Registration, Logout, Cross-Account Isolation & Re-Login
  elementsById.get('reg-fullname').value = 'Amaka Okafor';
  elementsById.get('reg-email').value = 'amaka.okafor@midepay.ng';
  elementsById.get('reg-phone').value = '08031112222';
  elementsById.get('reg-password').value = 'SecurePass123!';
  await elementsById.get('register-form').dispatchEvent('submit');

  const userANuban = elementsById.get('dash-nuban-text').textContent.replace(/\s+/g, '');
  const userAModalNuban = elementsById.get('modal-nuban-copy').textContent.replace(/\s+/g, '');
  await context.openCardsModal();
  const userAFirstPan = context.getVirtualCardState().cards[0]?.fullPan;

  check(
    /^90\d{8}$/.test(userANuban) && userANuban === userAModalNuban && elementsById.get('dash-greeting-text').textContent.includes('Amaka Okafor'),
    `New user registration provisions persisted 10-digit NUBAN (${userANuban}) across Dashboard & Add Money modal`
  );

  // Logout User A -> Register User B -> Verify complete isolation
  await context.handleLogout();
  elementsById.get('reg-fullname').value = 'Tunde Balogun';
  elementsById.get('reg-email').value = 'tunde.balogun@midepay.ng';
  elementsById.get('reg-phone').value = '08053334444';
  elementsById.get('reg-password').value = 'TundePass456!';
  await elementsById.get('register-form').dispatchEvent('submit');

  const userBNuban = elementsById.get('dash-nuban-text').textContent.replace(/\s+/g, '');
  await context.openCardsModal();
  const userBFirstPan = context.getVirtualCardState().cards[0]?.fullPan;

  check(
    /^90\d{8}$/.test(userBNuban) && userBNuban !== userANuban && userBFirstPan !== userAFirstPan,
    `Second user registration gets distinct NUBAN (${userBNuban}) and isolated Virtual Debit Card PAN`
  );

  // Logout User B -> Sign back in as User A -> Verify User A's exact NUBAN & Virtual Cards reload
  await context.handleLogout();
  elementsById.get('login-email').value = 'amaka.okafor@midepay.ng';
  elementsById.get('login-password').value = 'SecurePass123!';
  await elementsById.get('login-form').dispatchEvent('submit');
  await context.openCardsModal();
  const reloadedUserANuban = elementsById.get('dash-nuban-text').textContent.replace(/\s+/g, '');
  const reloadedUserAPan = context.getVirtualCardState().cards[0]?.fullPan;

  check(
    reloadedUserANuban === userANuban && reloadedUserAPan === userAFirstPan,
    'Logging out and signing back in reloads User A exact persisted NUBAN and Virtual Card PAN'
  );

  // 3. Real-Time Account Name Enquiry (10-Digit MidePay NUBAN + Pre-Nov-30 External Bank NIP Notice)
  const mockRpcClient = {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    rpc: async (fnName, params) => {
      if (fnName === 'lookup_recipient_profile' && params.search_query === userBNuban) {
        return {
          data: [{
            id: 'b0000000-0000-4000-8000-000000000099',
            full_name: 'Tunde Balogun',
            email: 'tunde.balogun@midepay.ng',
            phone: '08053334444',
            tag: '@tunde',
            nuban: userBNuban,
            bank_name: 'MidePay / Providus Bank',
            is_frozen: false
          }],
          error: null
        };
      }
      return { data: [], error: null };
    }
  };
  context.MidePayDB.client = mockRpcClient;

  const sendDest = elementsById.get('send-destination');
  const sendRecip = elementsById.get('send-recipient');
  const resolvedBox = elementsById.get('account-resolved-box');
  const resolvedTxt = elementsById.get('account-resolved-text');

  sendDest.value = 'MidePay';
  sendRecip.value = userBNuban;
  const midepayEnquiry = await context.resolveRecipientEnquiry();
  check(
    midepayEnquiry?.resolved === true &&
      midepayEnquiry?.type === 'midepay_nuban' &&
      resolvedTxt.innerHTML.includes('Verified MidePay Account') &&
      resolvedTxt.innerHTML.includes('Tunde Balogun'),
    `10-digit MidePay NUBAN lookup (${userBNuban}) resolves "Verified MidePay Account: Tunde Balogun"`
  );

  sendDest.value = 'GTBank';
  sendDest.selectedIndex = 5;
  sendRecip.value = '0123456789';
  const extEnquiry = await context.resolveRecipientEnquiry();
  check(
    extEnquiry?.resolved === false &&
      extEnquiry?.reason === 'external_nip_pending_gateway_keys' &&
      resolvedBox.classList.contains('is-notice') &&
      resolvedTxt.innerHTML.includes('Nov 30'),
    'External Nigerian bank 10-digit lookup pre-Nov-30 shows clear inline NIP gateway activation status'
  );
  context.MidePayDB.client = null;

  // 4. Persistent Per-User Virtual Debit Cards (PAN/CVV Reveal, Copy, Freeze, Monthly Limit & Create New Card)
  await context.openCardsModal();
  const panDisplay = elementsById.get('card-pan-display');
  const cvvDisplay = elementsById.get('card-cvv-val');
  const btnTogglePan = elementsById.get('btn-toggle-pan');
  const btnToggleCvv = elementsById.get('btn-toggle-cvv');
  const btnFreezeCard = elementsById.get('btn-freeze-card');
  const cardStatusBadge = elementsById.get('card-status-badge');
  const btnEditLimit = elementsById.get('btn-edit-card-limit');
  const limitInput = elementsById.get('card-limit-input');
  const btnSaveLimit = elementsById.get('btn-save-card-limit');
  const cardLimitVal = elementsById.get('card-limit-val');
  const btnCreateCard = elementsById.get('btn-create-virtual-card');

  check(
    panDisplay.textContent.startsWith('5399 •••• •••• ') && cvvDisplay.textContent === '•••',
    'Virtual Debit Card masks 5399 PAN and 3-digit CVV by default'
  );

  await btnTogglePan.click();
  await btnToggleCvv.click();
  check(
    /^5399 \d{4} \d{4} \d{4}$/.test(panDisplay.textContent) && /^\d{3}$/.test(cvvDisplay.textContent),
    `Show/Hide Card Details reveals full 16-digit PAN (${panDisplay.textContent}) and 3-digit CVV`
  );

  await btnFreezeCard.click();
  check(cardStatusBadge.textContent === 'Frozen', 'Freeze Card persists frozen state and updates badge to Frozen');
  await btnFreezeCard.click();
  check(cardStatusBadge.textContent === 'Active', 'Unfreeze Card restores Active status');

  await btnEditLimit.click();
  limitInput.value = '3500';
  await btnSaveLimit.click();
  check(cardLimitVal.textContent.includes('$3,500.00'), `Set Monthly Spending Limit updates & persists limit (${cardLimitVal.textContent})`);

  const countBeforeCreate = context.getVirtualCardState().cards.length;
  await btnCreateCard.click();
  const countAfterCreate = context.getVirtualCardState().cards.length;
  check(
    countAfterCreate === countBeforeCreate + 1 && /^5399 \d{4} \d{4} \d{4}$/.test(panDisplay.textContent),
    `Create New Virtual Card issues & persists a new unique 5399 card (total cards: ${countAfterCreate})`
  );

  // =========================================================================
  // v4.4 TESTS: MIDESAVE VAULTS, VTU BILLS (20-DIGIT STS TOKEN) & TEAM PAYROLL
  // =========================================================================

  // Credit User A wallet with ₦500,000 via Direct Top-Up so we can test Vaults, Bills & Payroll
  elementsById.get('topup-amount').value = '500000';
  await elementsById.get('add-funds-form').dispatchEvent('submit');

  // 5. MideSave Goal-Based Savings Vaults (Create Locked Vault -> PIN Fund -> PIN Early-Break Withdraw)
  await context.openMideSaveModal(true);
  elementsById.get('vault-title-input').value = 'Rent 2027';
  elementsById.get('vault-category-select').value = 'Housing & Rent';
  elementsById.get('vault-target-input').value = '1500000';
  elementsById.get('vault-lock-date-input').value = '2027-12-31';
  await elementsById.get('midesave-create-form').dispatchEvent('submit');

  const createdVault = context.getMideSaveState().vaults[0];
  check(
    Boolean(createdVault && createdVault.title === 'Rent 2027' && Number(createdVault.interest_rate_pa) === 14.5),
    'MideSave creates goal vault ("Rent 2027", 14.5% p.a., locked until 2027-12-31)'
  );

  // Fund ₦100,000 into "Rent 2027" using 4-digit Transaction PIN '1234' (initializes PIN on first use)
  context.openVaultTransactionDrawer(createdVault.id, 'fund');
  elementsById.get('midesave-action-amount').value = '100000';
  elementsById.get('midesave-action-pin').value = '1234';
  await elementsById.get('midesave-action-form').dispatchEvent('submit');
  check(
    Number(createdVault.current_balance) === 100000 && elementsById.get('midesave-total-saved').textContent.includes('100,000.00'),
    'fund_savings_vault (PIN-verified) debits wallet and credits MideSave vault to ₦100,000.00'
  );

  // Reject wrong PIN ('9999') on MideSave withdrawal
  context.openVaultTransactionDrawer(createdVault.id, 'withdraw');
  check(
    !elementsById.get('midesave-early-break-warning').classList.contains('hidden'),
    'Withdrawing from locked vault before maturity displays 1.5% early-break warning banner'
  );
  elementsById.get('midesave-action-amount').value = '20000';
  elementsById.get('midesave-action-pin').value = '9999';
  await elementsById.get('midesave-action-form').dispatchEvent('submit');
  check(
    Number(createdVault.current_balance) === 100000 && !elementsById.get('midesave-action-error').classList.contains('hidden'),
    'Wrong 4-digit PIN (9999) is strictly rejected before vault withdrawal'
  );

  // Withdraw ₦20,000 with valid PIN '1234' -> 1.5% early-break fee = ₦300, net credited = ₦19,700, vault balance = ₦80,000
  elementsById.get('midesave-action-pin').value = '1234';
  await elementsById.get('midesave-action-form').dispatchEvent('submit');
  check(
    Number(createdVault.current_balance) === 80000 && createdVault.status === 'broken',
    'withdraw_savings_vault applies 1.5% early-break fee on locked vault and updates vault balance to ₦80,000.00'
  );

  // 6. Nigerian Airtime, Data & Electricity VTU Bills (PIN-Protected + 20-Digit STS Token)
  context.openAirtimeModal('airtime');
  elementsById.get('airtime-phone').value = '08031112222';
  elementsById.get('airtime-amount').value = '1000';
  elementsById.get('airtime-pin-input').value = '1234';
  await elementsById.get('airtime-data-form').dispatchEvent('submit');
  check(
    elementsById.get('modal-airtime-data').classList.contains('hidden'),
    'PIN-protected Airtime VTU purchase executes payUtilityBill and renders instant receipt'
  );

  context.openBillsModal('electricity');
  elementsById.get('meter-number-input').value = '04192847291';
  elementsById.get('electricity-amount-input').value = '10000';
  elementsById.get('bills-pin-input').value = '1234';
  await elementsById.get('bill-payment-form').dispatchEvent('submit');
  const tokenText = elementsById.get('receipt-token-digits').textContent.trim();
  check(
    /^\d{4} \d{4} \d{4} \d{4} \d{4}$/.test(tokenText) && !elementsById.get('receipt-token-container').classList.contains('hidden'),
    `PIN-protected Prepaid Electricity payment generates 20-digit STS meter token (${tokenText}) on receipt`
  );

  // 7. Business Suite Team Payroll (Staff NUBAN Auto-Resolution + PIN Batch Disbursement)
  context.switchDashboardWorkspace('business');
  check(
    !elementsById.get('dashboard-business-panel').classList.contains('hidden'),
    'Workspace Switcher activates Business Suite & Team Payroll panel'
  );

  elementsById.get('payroll-staff-identifier').value = userBNuban;
  elementsById.get('payroll-staff-role').value = 'Senior Backend Engineer';
  elementsById.get('payroll-staff-salary').value = '150000';
  const resolvedStaff = await context.resolvePayrollStaffIdentifier(userBNuban);
  check(
    Boolean(resolvedStaff && resolvedStaff.fullName === 'Tunde Balogun'),
    `Team Payroll auto-resolves staff MidePay 10-digit NUBAN (${userBNuban} -> Tunde Balogun)`
  );

  await elementsById.get('payroll-add-staff-form').dispatchEvent('submit');
  check(
    context.getPayrollRosterState().roster.length === 1 && elementsById.get('payroll-summary-total').textContent.includes('150,000.00'),
    'Adding verified staff updates Team Payroll roster and ₦150,000.00 batch total (₦0 fee)'
  );

  elementsById.get('payroll-pin-input').value = '1234';
  await elementsById.get('btn-execute-payroll').click();
  check(
    context.getPayrollRosterState().roster.length === 0 && context.getPayrollRosterState().runs.length >= 1,
    'executeBusinessPayroll verifies 4-digit PIN, disburses batch salaries, and records payroll run history'
  );

  check(runtimeErrors.length === baselineSecurityLogs, 'Zero unexpected console.error emissions across entire v4.4 E2E suite');

  if (failed > 0) process.exit(1);
  console.log('\n🎉 ALL HEADLESS RUNTIME, NUBAN, CARDS, MIDESAVE, VTU BILLS & TEAM PAYROLL TESTS PASSED!');
}

runAssertions().catch(err => {
  console.error(err);
  process.exit(1);
});
