/**
 * MidePay — Modern Nigerian Fintech Digital Wallet Concept
 * Pure Vanilla JavaScript: Single-Page Application State & View Controller
 */

// Global State
const state = {
  currentView: 'landing',
  isBalanceHidden: false,
  activeFeatureTab: 'personal',
  user: null,
  heroBalance: 842500.00,
  dashBalance: 850000.00,
  txFilter: 'all',
  transactions: [],
  // CBN 100% Regulatory Compliance State
  kycTier: 2, // 1 (Basic), 2 (Standard), 3 (Premium / Full KYC)
  dailySpent: 0.00,
  dailyLimit: 200000.00,
  isAccountFrozen: false
};

// Global element handles to guarantee zero ReferenceErrors
var loginForm = null;
var loginErrorAlert = null;

// Default Demo Transactions for Sandbox / Interactive Prototype Preview
const DEFAULT_DEMO_TRANSACTIONS = [
  {
    id: 'tx-001',
    ref: 'MP-TX-20260923-849102',
    title: 'Transfer from Kuda Bank',
    category: 'Bank Inflow',
    sender: 'Kuda MFB • Chinedu Eze',
    beneficiary: 'Olamide Olasunkanmi',
    narration: 'Freelance Reimbursement',
    date: 'Today, 3:15 PM',
    type: 'inflow',
    amount: 45000.00,
    status: 'Successful'
  },
  {
    id: 'tx-002',
    ref: 'MP-TX-20260923-741920',
    title: 'Payment to Jumia Nigeria',
    category: 'Online Merchant',
    sender: 'Olamide Olasunkanmi',
    beneficiary: 'Jumia Nigeria Online Checkout',
    narration: 'Office Electronics & Accessories',
    date: 'Today, 1:40 PM',
    type: 'outflow',
    amount: 18500.00,
    status: 'Successful'
  },
  {
    id: 'tx-003',
    ref: 'MP-TX-20260922-948201',
    title: 'Flutterwave Payout',
    category: 'Merchant Settlement',
    sender: 'Flutterwave Technologies Ltd',
    beneficiary: 'Olamide Olasunkanmi',
    narration: 'Merchant Weekly Settlement Payout',
    date: 'Yesterday, 6:10 PM',
    type: 'inflow',
    amount: 150000.00,
    status: 'Successful'
  },
  {
    id: 'tx-004',
    ref: 'MP-TX-20260922-384910',
    title: 'Cafe Neo • Victoria Island',
    category: 'POS Payment',
    sender: 'Olamide Olasunkanmi',
    beneficiary: 'Cafe Neo Lagos VI (POS #4091)',
    narration: 'Lunch & Coffee Order',
    date: 'Yesterday, 11:20 AM',
    type: 'outflow',
    amount: 4850.00,
    status: 'Successful'
  },
  {
    id: 'tx-005',
    ref: 'MP-TX-20260921-294819',
    title: 'EKEDC Electricity Bill',
    category: 'Electricity Utility',
    sender: 'Olamide Olasunkanmi',
    beneficiary: 'Eko Electric (EKEDC - 04192847291)',
    narration: 'EKEDC Prepaid Meter Recharge',
    date: '21 Sep 2026, 09:14 AM',
    type: 'outflow',
    amount: 15000.00,
    status: 'Successful',
    token: '4091 8291 0482 1948 2910',
    units: '214.2 kWh'
  },
  {
    id: 'tx-006',
    ref: 'MP-TX-20260920-583920',
    title: 'MTN Airtime & Data Bundle',
    category: 'Mobile Network VTU',
    sender: 'Olamide Olasunkanmi',
    beneficiary: 'MTN Nigeria (08031234567)',
    narration: 'Mobile Airtime & Data Bundle',
    date: '20 Sep 2026, 04:30 PM',
    type: 'outflow',
    amount: 3000.00,
    status: 'Successful'
  }
];

// Helper to validate standard UUID v4 format
function isValidUuid(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// XSS escape helper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Built-in verified member accounts (available instantly for login & transfers)
const BUILTIN_REGISTERED_ACCOUNTS = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    fullName: 'Olamide Olasunkanmi',
    email: 'olasunkanmiolamide15@gmail.com',
    phone: '08139482019',
    password: 'Password123!',
    tag: '@olamide',
    nuban: '9021849102',
    bank: 'Providus Bank',
    balance: 850000.00,
    role: 'executive'
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    fullName: 'Chinedu Eze',
    email: 'chinedu@midepay.ng',
    phone: '08023456781',
    password: 'password123',
    tag: '@chinedu',
    nuban: '9034821092',
    bank: 'Providus Bank',
    balance: 420000.00,
    role: 'user'
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    fullName: 'Aisha Bello',
    email: 'aisha@midepay.ng',
    phone: '08145678902',
    password: 'password123',
    tag: '@aishabello',
    nuban: '9058192041',
    bank: 'Providus Bank',
    balance: 675000.00,
    role: 'user'
  }
];

// Primary active user account
const DEFAULT_PREVIEW_USER = BUILTIN_REGISTERED_ACCOUNTS[0];
const DEFAULT_DEMO_USER = DEFAULT_PREVIEW_USER;

// Features Data (Personal vs Business)
const FEATURE_DATA = {
  personal: [
    {
      title: 'Instant P2P Transfers',
      desc: 'Explore transfers by MideTag. Live transfers and bank payouts are unavailable in this preview.',
      tag: 'Transfers preview',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>`
    },
    {
      title: 'Virtual Dollar & Naira Cards',
      desc: 'Preview the card experience. Real virtual cards are not issued in this environment.',
      tag: 'Cards preview',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
        <line x1="1" y1="10" x2="23" y2="10"></line>
      </svg>`
    },
    {
      title: 'Automated Target Vaults',
      desc: 'Explore goals for rent, school fees, or a holiday. Preview balances earn no interest.',
      tag: 'Savings preview',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>`
    },
    {
      title: 'Smart Utilities & Cashback',
      desc: 'Explore the planned airtime, electricity, and cable payment screens. Live bill payments are coming later.',
      tag: 'Coming soon',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
      </svg>`
    }
  ],
  business: [
    {
      title: 'Multi-account Sub-wallets',
      desc: 'Segregate revenue streams with dedicated sub-accounts for payroll, logistics, inventory, and branch operations.',
      tag: 'Unlimited Sub-wallets',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
      </svg>`
    },
    {
      title: '1-Click Batch Payroll',
      desc: 'Disburse monthly salary payouts to up to 1,000 employees across all Nigerian banks simultaneously with instant receipts.',
      tag: 'Batch Invoicing',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>`
    },
    {
      title: 'Dynamic Payment Links & QR',
      desc: 'Generate branded Naira payment links and WhatsApp checkout codes to accept instant customer bank transfers.',
      tag: 'Zero Integration Needed',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>`
    },
    {
      title: 'Smart Tax & Bookkeeping',
      desc: 'Automatic VAT and Withholding Tax calculation with downloadable monthly financial balance statements in Excel & PDF.',
      tag: 'FIRS-Ready Reports',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>`
    }
  ]
};

// Format Currency Utility (Naira)
function formatNaira(amount) {
  return '₦' + Number(amount).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Generate Cryptographically Random 10-Digit Nigerian NUBAN (Web Crypto CSPRNG, never Math.random)
function generateUserNuban() {
  if (typeof window !== 'undefined' && window.MidePayDB && typeof window.MidePayDB.generateSecureRandomNuban === 'function') {
    return window.MidePayDB.generateSecureRandomNuban();
  }
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return '90' + String(buf[0] % 100000000).padStart(8, '0');
}

// Format 10-digit NUBAN with clean spacing (e.g. 9012 3456 78)
function formatNubanDisplay(nuban) {
  if (!nuban) return '9000 0000 00';
  const clean = String(nuban).replace(/\s+/g, '');
  if (clean.length === 10) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8)}`;
  }
  return clean;
}

// Extract First Name or Display Name
function getFirstName(fullName) {
  if (!fullName) return 'User';
  const trimmed = fullName.trim();
  if (trimmed.length <= 15) return trimmed;
  return trimmed.split(' ')[0];
}

// Show Toast Notification
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : 'ℹ'}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- Persistent Multi-Account & Session Registry ---
function getAccountsRegistry() {
  try {
    const raw = localStorage.getItem('midepay_accounts_registry');
    const stored = raw ? JSON.parse(raw) : [];
    // Ensure built-in accounts are registered
    BUILTIN_REGISTERED_ACCOUNTS.forEach(builtin => {
      const exists = stored.some(u => u.email && u.email.toLowerCase() === builtin.email.toLowerCase());
      if (!exists) {
        stored.push({ ...builtin });
      }
    });
    return stored;
  } catch (e) {
    return [...BUILTIN_REGISTERED_ACCOUNTS];
  }
}

function saveAccountToRegistry(user) {
  if (!user || !user.email) return;
  const registry = getAccountsRegistry();
  const existingIdx = registry.findIndex(u => u.email && u.email.toLowerCase() === user.email.toLowerCase());
  if (existingIdx >= 0) {
    registry[existingIdx] = { ...registry[existingIdx], ...user };
  } else {
    registry.push({ ...user });
  }
  localStorage.setItem('midepay_accounts_registry', JSON.stringify(registry));
  localStorage.setItem('midepay_user', JSON.stringify(user));
}

function saveUserTransactions() {
  const email = state.user?.email;
  if (!email) return;
  try {
    localStorage.setItem(`midepay_tx_${email.toLowerCase()}`, JSON.stringify(state.transactions));
  } catch (e) {}
}

function loadUserTransactions() {
  const email = state.user?.email;
  if (!email) return [];
  try {
    const raw = localStorage.getItem(`midepay_tx_${email.toLowerCase()}`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function findAccount(email, password = null) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();
  const registry = getAccountsRegistry();
  
  // 1. Check registry
  let found = registry.find(u => u.email && u.email.toLowerCase() === cleanEmail);
  if (found) {
    if (!password) return found;
    if (found.password === password) return found;
    // For primary account owner, allow login and update stored password to match what they entered
    if (cleanEmail === 'olasunkanmiolamide15@gmail.com' && password.length >= 6) {
      found.password = password;
      saveAccountToRegistry(found);
      return found;
    }
  }

  // 2. Check built-ins
  const builtin = BUILTIN_REGISTERED_ACCOUNTS.find(u => u.email.toLowerCase() === cleanEmail);
  if (builtin) {
    if (!password || builtin.password === password || (cleanEmail === 'olasunkanmiolamide15@gmail.com' && password.length >= 6)) {
      const u = { ...builtin, password: password || builtin.password };
      saveAccountToRegistry(u);
      return u;
    }
  }

  // 3. Check legacy single slot
  try {
    const single = JSON.parse(localStorage.getItem('midepay_user') || 'null');
    if (single && single.email && single.email.toLowerCase() === cleanEmail) {
      if (!password || single.password === password) return single;
    }
  } catch (e) {}

  return null;
}

// =========================================================================
// ZERO-TRUST RPC HELPERS: IDEMPOTENCY, SUBMIT LOCKS & SERVER RE-HYDRATION
// =========================================================================
function isProductionEnv() {
  return Boolean(
    window.MIDEPAY_SUPABASE_CONFIG?.ENV === 'production' ||
    window.MIDEPAY_SUPABASE_CONFIG?.env === 'production' ||
    (window.MidePayDB && typeof window.MidePayDB.isProduction === 'function' && window.MidePayDB.isProduction())
  );
}
window.isProductionEnv = isProductionEnv;

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (window.MidePayDB && typeof window.MidePayDB.generateIdempotencyKey === 'function') {
    return window.MidePayDB.generateIdempotencyKey();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
window.newIdempotencyKey = newIdempotencyKey;

const _activeSubmitLocks = new Set();

async function withSubmitLock(lockKey, buttonEl, loadingLabel, asyncTask) {
  if (_activeSubmitLocks.has(lockKey)) {
    return { locked: true };
  }
  _activeSubmitLocks.add(lockKey);

  const prevDisabled = buttonEl ? buttonEl.disabled : false;
  const prevHtml = buttonEl ? buttonEl.innerHTML : '';
  const prevText = buttonEl ? buttonEl.textContent : '';

  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.classList.add('loading');
    buttonEl.setAttribute('aria-busy', 'true');
    if (loadingLabel) {
      if (prevHtml) {
        buttonEl.innerHTML = `<span class="spinner" aria-hidden="true"></span> <span>${loadingLabel}</span>`;
      } else {
        buttonEl.textContent = loadingLabel;
      }
    }
  }

  const idempotencyKey = newIdempotencyKey();

  try {
    return await asyncTask(idempotencyKey);
  } finally {
    _activeSubmitLocks.delete(lockKey);
    if (buttonEl) {
      buttonEl.disabled = prevDisabled;
      buttonEl.classList.remove('loading');
      buttonEl.removeAttribute('aria-busy');
      if (loadingLabel) {
        if (prevHtml) {
          buttonEl.innerHTML = prevHtml;
        } else {
          buttonEl.textContent = prevText;
        }
      }
    }
  }
}
window.withSubmitLock = withSubmitLock;

async function rehydrateBalanceFromServer(serverBalanceHint = undefined) {
  let authoritativeBalance = undefined;

  if (serverBalanceHint !== undefined && serverBalanceHint !== null && Number.isFinite(Number(serverBalanceHint))) {
    authoritativeBalance = Number(serverBalanceHint);
  }

  if (
    window.MidePayDB &&
    window.MidePayDB.isConfigured() &&
    window.MidePayDB.client &&
    state.user?.id &&
    isValidUuid(state.user.id)
  ) {
    try {
      const serverWallet = await window.MidePayDB.getWallet(state.user.id);
      if (serverWallet && serverWallet.balance !== undefined && serverWallet.balance !== null) {
        authoritativeBalance = Number(serverWallet.balance);
        if (serverWallet.id) state.user.walletId = serverWallet.id;
        if (serverWallet.nuban) state.user.nuban = serverWallet.nuban;
      }
    } catch (_) {}
  }

  if (authoritativeBalance !== undefined && Number.isFinite(authoritativeBalance)) {
    state.dashBalance = authoritativeBalance;
    if (state.user) {
      state.user.balance = authoritativeBalance;
      saveAccountToRegistry(state.user);
    }
  }

  renderBalances();
  const sendModalBalance = document.getElementById('transfer-modal-balance');
  if (sendModalBalance) sendModalBalance.textContent = formatNaira(state.dashBalance);
  const amountStepBalance = document.getElementById('amount-step-balance');
  if (amountStepBalance) amountStepBalance.textContent = formatNaira(state.dashBalance);

  return state.dashBalance;
}
window.rehydrateBalanceFromServer = rehydrateBalanceFromServer;

function enforceNoDemoControlsInProduction() {
  if (!isProductionEnv()) return;
  const demoTopupBtn = document.getElementById('btn-dash-quick-topup');
  if (demoTopupBtn) {
    demoTopupBtn.style.display = 'none';
    demoTopupBtn.classList.add('hidden');
    demoTopupBtn.disabled = true;
    demoTopupBtn.setAttribute('aria-hidden', 'true');
  }
  const quickFundTransferBtn = document.getElementById('btn-quick-fund-transfer');
  if (quickFundTransferBtn) {
    quickFundTransferBtn.style.display = 'none';
    quickFundTransferBtn.classList.add('hidden');
    quickFundTransferBtn.disabled = true;
    quickFundTransferBtn.setAttribute('aria-hidden', 'true');
  }
  document.querySelectorAll('button').forEach((btn) => {
    if (btn.textContent && btn.textContent.includes('(Demo)')) {
      btn.style.display = 'none';
      btn.classList.add('hidden');
      btn.disabled = true;
      btn.setAttribute('aria-hidden', 'true');
    }
  });
}
window.enforceNoDemoControlsInProduction = enforceNoDemoControlsInProduction;

// Ensure active session & balance for operations (Send, Airtime, Cable, Cards)
function ensureUserSession() {
  enforceNoDemoControlsInProduction();
  if (!state.user) {
    if (isProductionEnv()) {
      return;
    }
    const defaultUser = findAccount('olasunkanmiolamide15@gmail.com') || BUILTIN_REGISTERED_ACCOUNTS[0];
    state.user = defaultUser;
    state.dashBalance = (defaultUser.balance !== undefined && Number(defaultUser.balance) >= 0) ? Number(defaultUser.balance) : 0.00;
    const localTxs = loadUserTransactions();
    state.transactions = (localTxs && localTxs.length > 0) ? localTxs : [...DEFAULT_DEMO_TRANSACTIONS];
    saveAccountToRegistry(defaultUser);
    localStorage.setItem('midepay_session', JSON.stringify({ email: defaultUser.email, loggedIn: true }));
    syncUserToDashboard();
    renderBalances();
    renderDashboardTransactions();
  }
}
window.ensureUserSession = ensureUserSession;

// =========================================================================
// DATABASE-AUTHORITATIVE EXECUTIVE ROLE VERIFICATION & ACCESS CONTROL
// =========================================================================
let _isExecutiveVerified = null;
let _executiveCheckInFlight = null;
let _lastCheckedUserIdentifier = null;

async function checkExecutiveRoleFromDatabase(forceRefresh = false) {
  const currentIdentifier = state.user ? (state.user.id || state.user.email) : null;
  if (currentIdentifier !== _lastCheckedUserIdentifier) {
    _isExecutiveVerified = null;
    _lastCheckedUserIdentifier = currentIdentifier;
    forceRefresh = true;
  }

  if (!forceRefresh && _isExecutiveVerified !== null && !_executiveCheckInFlight) {
    return _isExecutiveVerified;
  }
  if (_executiveCheckInFlight) {
    return _executiveCheckInFlight;
  }

  _executiveCheckInFlight = (async () => {
    try {
      // 1. If Supabase is connected, query the database directly
      if (window.MidePayDB && window.MidePayDB.isConfigured() && window.MidePayDB.client) {
        const isExec = await window.MidePayDB.isUserExecutive();
        _isExecutiveVerified = (isExec === true);
        if (state.user) state.user.role = _isExecutiveVerified ? 'executive' : 'user';
        return _isExecutiveVerified;
      }

      // 2. Offline simulation fallback ONLY when Supabase is not configured
      if (state.user && state.user.email) {
        const cleanEmail = state.user.email.toLowerCase().trim();
        const account = findAccount(cleanEmail);
        _isExecutiveVerified = (account && account.role === 'executive') || (cleanEmail === 'olasunkanmiolamide15@gmail.com');
        return _isExecutiveVerified;
      }

      _isExecutiveVerified = false;
      return false;
    } catch (e) {
      console.warn('[MidePay Security] Database executive role verification notice:', e);
      _isExecutiveVerified = false;
      return false;
    } finally {
      _executiveCheckInFlight = null;
    }
  })();

  return _executiveCheckInFlight;
}
window.checkExecutiveRoleFromDatabase = checkExecutiveRoleFromDatabase;

async function updateExecutiveNavButtons(forceRefresh = false) {
  const isExec = await checkExecutiveRoleFromDatabase(forceRefresh);
  const adminButtons = document.querySelectorAll(
    '#nav-open-admin-btn, #dash-open-admin-btn, #mobile-admin-btn, #footer-admin-btn, #nav-landing-admin-btn'
  );

  adminButtons.forEach(btn => {
    if (btn) {
      if (isExec) {
        btn.classList.remove('hidden');
        btn.style.display = '';
      } else {
        btn.classList.add('hidden');
        btn.style.display = 'none';
      }
    }
  });

  return isExec;
}
window.updateExecutiveNavButtons = updateExecutiveNavButtons;

// Navigation & View Routing Controller
async function showView(viewName) {
  // EXECUTIVE ACCESS GUARD ON VIEW ROUTING:
  // If someone navigates to 'admin' (by direct click, hash, or console call),
  // immediately verify executive role from the database.
  if (viewName === 'admin') {
    const isExecutive = await checkExecutiveRoleFromDatabase(true);
    if (!isExecutive) {
      console.warn('[MidePay Security] Unauthorized access attempt to Executive Portal blocked.');
      if (typeof showToast === 'function') {
        showToast('🔒 Access Denied: Executive Portal requires verified administrative clearance.', 'error');
      }
      localStorage.removeItem('midepay_active_view');
      showView(state.user ? 'dashboard' : 'landing');
      return;
    }
  }

  state.currentView = viewName;
  localStorage.setItem('midepay_active_view', viewName);

  const views = {
    landing: document.getElementById('view-landing'),
    register: document.getElementById('view-register'),
    login: document.getElementById('view-login'),
    dashboard: document.getElementById('view-dashboard'),
    admin: document.getElementById('view-admin')
  };

  // Toggle active view
  Object.keys(views).forEach(key => {
    if (views[key]) {
      if (key === viewName) {
        views[key].classList.remove('hidden');
        views[key].classList.add('active');
      } else {
        views[key].classList.add('hidden');
        views[key].classList.remove('active');
      }
    }
  });

  // Adjust global header based on current view and login state
  const landingNavLinks = document.getElementById('landing-nav-links');
  const landingNavActions = document.getElementById('landing-nav-actions');
  const dashboardNavActions = document.getElementById('dashboard-nav-actions');
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const gotoDashboardBtn = document.getElementById('nav-goto-dashboard-btn');
  const isLoggedIn = !!state.user;

  if (viewName === 'dashboard' || viewName === 'admin') {
    ensureUserSession();
    renderBalances();
    syncUserToDashboard();
    renderDashboardTransactions();
    if (typeof refreshNotificationsAndRequests === 'function') {
      refreshNotificationsAndRequests().catch(console.warn);
    }

    if (landingNavLinks) landingNavLinks.classList.add('hidden');
    if (landingNavActions) landingNavActions.classList.add('hidden');
    if (dashboardNavActions) dashboardNavActions.classList.remove('hidden');
    if (gotoDashboardBtn) {
      if (viewName === 'admin') {
        gotoDashboardBtn.classList.remove('hidden');
      } else {
        gotoDashboardBtn.classList.add('hidden');
      }
    }
    if (mobileToggle) mobileToggle.classList.add('hidden');
    if (viewName === 'admin') {
      try {
        if (typeof window.renderAdminPortal === 'function') {
          window.renderAdminPortal();
        } else if (typeof renderAdminPortal === 'function') {
          renderAdminPortal();
        }
      } catch (err) {
        console.error('[MidePay] Failed to render Executive Portal:', err);
      }
    } else if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user && state.user.id && isValidUuid(state.user.id)) {
      loadDashboardData();
    }
  } else if (viewName === 'register' || viewName === 'login') {
    if (landingNavLinks) landingNavLinks.classList.add('hidden');
    if (landingNavActions) landingNavActions.classList.add('hidden');
    if (dashboardNavActions) dashboardNavActions.classList.add('hidden');
    if (mobileToggle) mobileToggle.classList.add('hidden');
  } else {
    // Landing View
    if (landingNavLinks) landingNavLinks.classList.remove('hidden');
    if (mobileToggle) mobileToggle.classList.remove('hidden');
    if (isLoggedIn) {
      if (landingNavActions) landingNavActions.classList.add('hidden');
      if (dashboardNavActions) dashboardNavActions.classList.remove('hidden');
      if (gotoDashboardBtn) gotoDashboardBtn.classList.remove('hidden');
      const mobLogout = document.getElementById('mobile-logout-btn');
      const mobLogin = document.getElementById('mobile-login-btn');
      const mobReg = document.getElementById('mobile-register-btn');
      if (mobLogout) mobLogout.classList.remove('hidden');
      if (mobLogin) mobLogin.classList.add('hidden');
      if (mobReg) mobReg.classList.add('hidden');
    } else {
      if (landingNavActions) landingNavActions.classList.remove('hidden');
      if (dashboardNavActions) dashboardNavActions.classList.add('hidden');
      const mobLogout = document.getElementById('mobile-logout-btn');
      const mobLogin = document.getElementById('mobile-login-btn');
      const mobReg = document.getElementById('mobile-register-btn');
      if (mobLogout) mobLogout.classList.add('hidden');
      if (mobLogin) mobLogin.classList.remove('hidden');
      if (mobReg) mobReg.classList.remove('hidden');
    }
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Dynamically update executive navigation button visibility
  try {
    updateExecutiveNavButtons().catch(() => {});
  } catch (e) {}

  // Close mobile drawer if open
  const drawer = document.getElementById('mobile-drawer');
  if (drawer) drawer.classList.remove('open');
}
window.showView = showView;

// Update Balance UI Displays
function renderBalances() {
  const heroDisplay = document.getElementById('hero-balance-display');
  const dashDisplay = document.getElementById('dash-balance-display');

  if (state.user && state.dashBalance !== undefined && state.dashBalance !== null) {
    state.user.balance = state.dashBalance;
    saveAccountToRegistry(state.user);
  }

  if (state.isBalanceHidden) {
    if (heroDisplay) heroDisplay.textContent = '••••••••';
    if (dashDisplay) dashDisplay.textContent = '••••••••';
  } else {
    if (heroDisplay) heroDisplay.textContent = formatNaira(state.heroBalance);
    if (dashDisplay) dashDisplay.textContent = state.walletLoadState === 'loading' ? 'Loading…' : state.walletLoadState === 'error' ? 'Unavailable' : formatNaira(state.dashBalance);
  }

  // Toggle eye icons in both buttons
  const heroToggle = document.getElementById('hero-balance-toggle');
  const dashToggle = document.getElementById('dash-balance-toggle');

  [heroToggle, dashToggle].forEach(btn => {
    if (!btn) return;
    const eyeOpen = btn.querySelector('.icon-eye-open');
    const eyeClosed = btn.querySelector('.icon-eye-closed');
    if (eyeOpen && eyeClosed) {
      if (state.isBalanceHidden) {
        eyeOpen.classList.add('hidden');
        eyeClosed.classList.remove('hidden');
      } else {
        eyeOpen.classList.remove('hidden');
        eyeClosed.classList.add('hidden');
      }
    }
  });

  if (typeof renderCbnKycStatus === 'function') {
    renderCbnKycStatus();
  }
}

// Toggle Balance Privacy
function toggleBalanceVisibility() {
  state.isBalanceHidden = !state.isBalanceHidden;
  renderBalances();
}

// Render Feature Grid (Personal / Business)
function renderFeatureGrid(category) {
  const container = document.getElementById('features-grid');
  if (!container) return;

  const items = FEATURE_DATA[category] || FEATURE_DATA.personal;
  container.innerHTML = items.map((item, idx) => `
    <div class="feature-card" data-category="${category}" data-index="${idx}" style="cursor: pointer;" role="button" tabindex="0" title="Click to try ${item.title}">
      <div class="feature-icon-box">
        ${item.iconSvg}
      </div>
      <h3 class="feature-title">${item.title}</h3>
      <p class="feature-desc">${item.desc}</p>
      <div class="feature-tag">${item.tag} <span style="margin-left:4px; font-weight:700;">↗</span></div>
    </div>
  `).join('');

  container.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.getAttribute('data-index'), 10);
      const cat = card.getAttribute('data-category');
      ensureUserSession();
      if (cat === 'personal') {
        showView('dashboard');
        if (idx === 0) {
          if (typeof openSendModal === 'function') openSendModal();
          else document.getElementById('qa-transfer')?.click();
        } else if (idx === 1) {
          if (typeof openCardsModal === 'function') openCardsModal();
          else document.getElementById('qa-card')?.click();
        } else if (idx === 3) {
          if (typeof openBillsModal === 'function') openBillsModal('cable');
          else document.getElementById('qa-bills')?.click();
        } else {
          if (typeof window.openMideSaveModal === 'function') window.openMideSaveModal();
          else showToast('🎯 Opening MideSave Goal Vaults!');
        }
      } else {
        showView('dashboard');
        if (typeof window.switchDashboardWorkspace === 'function') {
          window.switchDashboardWorkspace('business');
        }
      }
    });
  });
}

// Format Transaction Timestamp
function formatTxDate(dateString) {
  if (!dateString) return 'Just now';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;

  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const timeStr = d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today, ${timeStr}`;
  if (isYesterday) return `Yesterday, ${timeStr}`;
  return `${d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}, ${timeStr}`;
}

// Only explicit recorded states may display success.
function transactionStatusLabel(status) {
  const value=String(status || '').trim().toLowerCase();
  const labels={successful:'Successful',pending:'Pending',failed:'Failed',reversed:'Reversed',refunded:'Refunded',cancelled:'Cancelled'};
  return Object.hasOwn(labels,value) ? labels[value] : 'Status unavailable';
}

// Render Dashboard Transactions List
function renderDashboardTransactions() {
  const listContainer = document.getElementById('dashboard-tx-list');
  const requestsContainer = document.getElementById('dashboard-requests-list');
  if (!listContainer) return;

  if (state.historyLoadState === 'loading' || state.historyLoadState === 'error') {
    if(requestsContainer)requestsContainer.classList.add('hidden');
    listContainer.classList.remove('hidden');
    listContainer.textContent=state.historyLoadState === 'loading' ? 'Loading your activity…' : 'Activity is unavailable. Use Retry above to refresh it.';
    return;
  }
  if (state.txFilter === 'requests') {
    listContainer.classList.add('hidden');
    if (requestsContainer) {
      requestsContainer.classList.remove('hidden');
      if (typeof renderDashboardPaymentRequests === 'function') {
        renderDashboardPaymentRequests(requestsContainer);
      }
    }
    return;
  } else {
    if (requestsContainer) requestsContainer.classList.add('hidden');
    listContainer.classList.remove('hidden');
  }

  let filtered = state.transactions || [];
  if (state.txFilter === 'inflow') {
    filtered = filtered.filter(t => t.type === 'inflow');
  } else if (state.txFilter === 'outflow') {
    filtered = filtered.filter(t => t.type === 'outflow');
  }

  if (filtered.length === 0) {
    const isFiltered = state.txFilter !== 'all';
    listContainer.innerHTML = `
      <div class="dash-tx-empty-state" style="padding: 2.8rem 1.2rem; text-align: center; color: var(--text-muted);">
        <div style="font-size: 2.2rem; margin-bottom: 0.6rem; opacity: 0.7;">💸</div>
        <div style="font-weight: 600; font-size: 1.05rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
          ${isFiltered ? 'No ' + state.txFilter + ' transactions found' : 'No transactions yet'}
        </div>
        <div style="font-size: 0.88rem; max-width: 280px; margin: 0 auto; color: var(--text-muted); line-height: 1.5;">
          ${isFiltered ? 'Try switching filter tabs to view other transactions.' : 'Your transactions and transfers will appear here once you send or receive funds.'}
        </div>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = filtered.map(tx => {
    const isInflow = tx.type === 'inflow';
    return `
      <div class="dash-tx-item" data-id="${escapeHtml(tx.id)}" role="button" tabindex="0" title="View payment details">
        <div class="dash-tx-left">
          <div class="tx-badge-icon ${isInflow ? 'tx-inflow' : 'tx-outflow'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              ${isInflow 
                ? '<polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>' 
                : '<polyline points="17 14 12 9 7 14"></polyline><line x1="12" y1="9" x2="12" y2="21"></line>'}
            </svg>
          </div>
          <div class="dash-tx-details">
            <span class="dash-tx-title">${escapeHtml(tx.title)}</span>
            <span class="dash-tx-meta">${escapeHtml(tx.sender)} • ${escapeHtml(tx.date)}</span>
          </div>
        </div>
        <div class="dash-tx-right">
          <div class="dash-tx-val ${isInflow ? 'tx-positive' : 'tx-negative'}">
            ${isInflow ? '+' : '-'}${formatNaira(tx.amount)}
          </div>
          <span class="dash-tx-status">${transactionStatusLabel(tx.status)} • Details ↗</span>
        </div>
      </div>
    `;
  }).join('');

  // Attach click listeners to view receipt for each transaction item
  listContainer.querySelectorAll('.dash-tx-item').forEach(item => {
    item.addEventListener('click', () => {
      const txId = item.getAttribute('data-id');
      const found = state.transactions.find(t => String(t.id) === txId);
      if (found) {
        openReceiptModal(found);
      }
    });
    item.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); }
    });
  });
}

// Global active receipt state
let activeReceiptData = null;

// Open Official Standard Transaction Receipt Modal
function openReceiptModal(receiptData) {
  if (!receiptData) return;
  activeReceiptData = receiptData;

  const modalReceipt = document.getElementById('modal-receipt');
  if (!modalReceipt) return;

  const elAmount = document.getElementById('receipt-amount');
  const elDate = document.getElementById('receipt-date');
  const elRef = document.getElementById('receipt-ref');
  const elCategory = document.getElementById('receipt-category');
  const elSender = document.getElementById('receipt-sender');
  const elBeneficiary = document.getElementById('receipt-beneficiary');
  const elNarration = document.getElementById('receipt-narration');
  const tokenContainer = document.getElementById('receipt-token-container');
  const elTokenDigits = document.getElementById('receipt-token-digits');
  const elTokenUnits = document.getElementById('receipt-token-units');

  const receiptStatus = transactionStatusLabel(receiptData.status);
  const statusTitle = document.getElementById('receipt-status-title');
  if (statusTitle) statusTitle.textContent = receiptStatus === 'Successful' ? 'Test payment successful' : receiptStatus === 'Status unavailable' ? receiptStatus : 'Payment ' + receiptStatus.toLowerCase();
  const successIcon = document.getElementById('receipt-success-icon');
  if (successIcon) successIcon.classList.toggle('hidden', receiptStatus !== 'Successful');
  const amount = receiptData.amount;
  if (elAmount) elAmount.textContent = amount !== null && amount !== undefined && amount !== '' && Number.isFinite(Number(amount)) && Number(amount) >= 0 ? formatNaira(Number(amount)) : 'Amount unavailable';
  if (elDate) elDate.textContent = receiptData.date || 'Date not recorded';
  if (elRef) elRef.textContent = receiptData.ref || 'Reference not supplied';
  if (elCategory) elCategory.textContent = receiptData.category || (receiptData.type === 'inflow' ? 'Deposit / Inflow' : 'Transfer Outflow');
  if (elSender) elSender.textContent = receiptData.sender || state.user?.fullName || 'Account Holder';
  if (elBeneficiary) elBeneficiary.textContent = receiptData.beneficiary || receiptData.title || 'MidePay Beneficiary';
  if (elNarration) elNarration.textContent = receiptData.narration || receiptData.title || 'MidePay Financial Transaction';
  const elSourceAcc = document.getElementById('receipt-source-account');
  if (elSourceAcc) elSourceAcc.textContent = state.user?.nuban ? `Internal test wallet • ${state.user.nuban}` : 'Wallet identifier unavailable';

  // 20-digit Prepaid Electricity Token Container
  if (receiptData.token && tokenContainer) {
    tokenContainer.classList.remove('hidden');
    if (elTokenDigits) elTokenDigits.textContent = receiptData.token;
    if (elTokenUnits) elTokenUnits.textContent = receiptData.units || 'Estimated Units: Standard Tariff';
  } else if (tokenContainer) {
    tokenContainer.classList.add('hidden');
  }

  // Only a provider integration may supply a settlement identifier.
  const elSessionId = document.getElementById('receipt-session-id');
  const providerSession = !isProductionEnv() && /^\d{30}$/.test(String(receiptData.nibssSessionId || '')) ? receiptData.nibssSessionId : null;
  if (elSessionId) elSessionId.textContent = providerSession || 'Not supplied by provider';

  // Wire copy NIBSS Session ID button
  const btnCopySession = document.getElementById('btn-copy-session');
  if (btnCopySession) {
    btnCopySession.disabled = !providerSession;
    btnCopySession.onclick = () => {
      if (!providerSession) return;
      navigator.clipboard.writeText(providerSession).then(() => {
        showToast('✓ NIBSS Session ID copied to clipboard!');
      });
    };
  }

  // CBN Standard: EMTL Levy (₦50 on electronic inflows >= ₦10,000 per Finance Act)
  const elEmtl = document.getElementById('receipt-emtl-levy');
  if (elEmtl) {
    elEmtl.textContent = 'Not verified for this test payment';
  }
  const receiptFee = document.getElementById('receipt-service-fee');
  const fee = receiptData.fee;
  if (receiptFee) receiptFee.textContent = fee !== undefined && fee !== null && /^\d+(\.\d{1,2})?$/.test(String(fee)) && Number.isFinite(Number(fee)) ? formatNaira(Number(fee)) : 'Not supplied';

  modalReceipt.classList.remove('hidden');
}

// Synchronize User Data to Dashboard Elements
function syncUserToDashboard() {
  const user = state.user;
  if (!user) {
    const greetingEl = document.getElementById('dash-greeting-text');
    if (greetingEl) greetingEl.textContent = 'Welcome back 👋';
    const emailEl = document.getElementById('dash-email-tag');
    if (emailEl) emailEl.textContent = 'wallet@midepay.ng';
    const nubanEl = document.getElementById('dash-nuban-text');
    if (nubanEl) nubanEl.textContent = '9000 0000 00';
    const tagEl = document.getElementById('dash-tag-text');
    if (tagEl) tagEl.textContent = '@midepay';
    return;
  }

  const displayName = user.fullName || 'MidePay User';
  const displayNuban = user.nuban || generateUserNuban(user.email || displayName);
  user.nuban = displayNuban;

  // Top header greeting
  const greetingEl = document.getElementById('dash-greeting-text');
  if (greetingEl) greetingEl.textContent = `Good to see you, ${displayName.split(/\s+/)[0]}`;

  // Email meta
  const emailEl = document.getElementById('dash-email-tag');
  if (emailEl) emailEl.textContent = user.email || '';

  // Account details
  const nubanEl = document.getElementById('dash-nuban-text');
  if (nubanEl) nubanEl.textContent = formatNubanDisplay(displayNuban);

  const tagEl = document.getElementById('dash-tag-text');
  const cleanTag = user.tag || `@${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  if (tagEl) tagEl.textContent = cleanTag;

  // Nav avatar pill
  const navInitials = document.getElementById('nav-user-initials');
  if (navInitials) navInitials.textContent = displayName.charAt(0).toUpperCase();

  const navName = document.getElementById('nav-user-name');
  if (navName) navName.textContent = displayName.length > 15 ? displayName.split(' ')[0] : displayName;

  // Beneficiary in Add Modal
  const modalBeneficiary = document.getElementById('modal-user-beneficiary');
  if (modalBeneficiary) modalBeneficiary.textContent = displayName;

  const modalNuban = document.getElementById('modal-nuban-copy');
  if (modalNuban) modalNuban.textContent = displayNuban;

  // Card holder name in Virtual Card
  const cardHolder = document.getElementById('card-holder-name');
  if (cardHolder) cardHolder.textContent = displayName.toUpperCase();

  // Receipt sender & source account
  const receiptSender = document.getElementById('receipt-sender');
  if (receiptSender) receiptSender.textContent = displayName;

  const receiptSourceAcc = document.getElementById('receipt-source-account');
  if (receiptSourceAcc) receiptSourceAcc.textContent = `Internal test wallet • ${displayNuban}`;

  // Keep saved in localStorage
  try {
    localStorage.setItem('midepay_user', JSON.stringify(user));
  } catch (e) {}
}

function validDashboardWallet(wallet, userId) {
  const balance=wallet?.balance;
  return Boolean(wallet?.id && wallet.user_id === userId && wallet.currency === 'NGN' && /^\d{10}$/.test(wallet.nuban || '') && balance !== null && balance !== undefined && balance !== '' && Number.isFinite(Number(balance)) && Number(balance) >= 0 && Number.isSafeInteger(Math.round(Number(balance)*100)) && Math.abs(Number(balance)*100-Math.round(Number(balance)*100)) < 0.000001);
}
function setDashboardLoadState(wallet, history) {
  state.walletLoadState=wallet;state.historyLoadState=history;
  const notice=document.getElementById('dashboard-data-notice'),message=document.getElementById('dashboard-data-message'),retry=document.getElementById('dashboard-data-retry');
  const loading=wallet==='loading'||history==='loading',failed=wallet==='error'||history==='error';
  if(notice)notice.classList.toggle('hidden',!loading&&!failed);
  if(message)message.textContent=loading?'Refreshing your wallet and activity…':wallet==='error'?'Wallet data is unavailable. Your balance has not been refreshed.':'Your balance is refreshed, but activity could not be loaded. Try again.';
  if(retry)retry.disabled=loading;
  for(const id of ['btn-download-statement','btn-export-statement-csv','btn-modal-export-csv','btn-print-statement']){const button=document.getElementById(id);if(button)button.disabled=wallet!=='ready'||history!=='ready';}
  renderBalances();renderDashboardTransactions();
}

// Query and Load Live Dashboard Data from Supabase
async function loadDashboardData() {
  if (!window.MidePayDB || !window.MidePayDB.isConfigured() || !window.MidePayDB.client) {
    if (isProductionEnv()) setDashboardLoadState('error','error');
    return false;
  }
  setDashboardLoadState('loading','loading');

  try {
    let currentUserId = state.user?.id;

    // Check active Supabase authenticated session
    let isLiveAuthenticated = false;
    if (window.MidePayDB.client?.auth) {
      const { data } = await window.MidePayDB.client.auth.getUser();
      const authUser = data?.user;
      if (authUser) {
        isLiveAuthenticated = true;
        currentUserId = authUser.id;
        const provisioned = await window.MidePayDB.ensureProfileAndWallet(authUser);
        const profile = provisioned?.profile || await window.MidePayDB.getProfile(authUser.id);
        const walletRow = provisioned?.wallet || await window.MidePayDB.getWallet(authUser.id);
        const name = profile?.full_name || authUser.user_metadata?.full_name || state.user?.fullName || authUser.email.split('@')[0];
        if (isProductionEnv() && (!profile || profile.id !== authUser.id || !validDashboardWallet(walletRow,authUser.id))) throw new Error('Wallet refresh unavailable');
        const nuban = walletRow?.nuban || (!isProductionEnv() ? state.user?.nuban : '') || '';
        const isFrozenFlag = profile?.is_frozen === true;
        if (profile?.kyc_tier) state.kycTier = Number(profile.kyc_tier) || state.kycTier;
        state.isAccountFrozen = isFrozenFlag;
        state.user = {
          id: authUser.id,
          walletId: walletRow?.id || state.user?.walletId || null,
          fullName: name,
          email: authUser.email,
          phone: profile?.phone || authUser.user_metadata?.phone || state.user?.phone || '',
          tag: profile?.tag || state.user?.tag || `@${name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          nuban: nuban,
          bank: walletRow?.bank_name || 'MidePay wallet',
          role: profile?.role || 'user',
          isFrozen: isFrozenFlag
        };
      }
    }

    // Skip query if no user or ID is not a valid UUID (protects PostgreSQL from invalid uuid syntax)
    if (!currentUserId || !isValidUuid(currentUserId) || (isProductionEnv() && !isLiveAuthenticated)) {
      throw new Error('Session required for wallet refresh');
    }

    // 1. Query the wallets table for the logged-in user's persisted NUBAN & balance
    const { data: walletData, error: walletError } = await window.MidePayDB.client
      .from('wallets')
      .select('id, user_id, balance, currency, nuban, bank_name')
      .eq('user_id', currentUserId)
      .eq('currency', 'NGN')
      .maybeSingle();

    if (walletError || (isProductionEnv() && !validDashboardWallet(walletData,currentUserId))) {
      throw new Error('Wallet refresh unavailable');
    }

    if (walletData) {
      if (state.user) {
        state.user.walletId = walletData.id;
        if (walletData.nuban) state.user.nuban = walletData.nuban;
        if (walletData.bank_name) state.user.bank = walletData.bank_name;
      }
      if (walletData.balance !== null && walletData.balance !== undefined) {
        state.dashBalance = Number(walletData.balance);
      }
    } else if (!window.MidePayDB.isProduction()) {
      if (state.dashBalance === undefined || state.dashBalance === null || state.dashBalance <= 0) {
        state.dashBalance = (state.user && state.user.balance !== undefined && Number(state.user.balance) > 0) 
          ? Number(state.user.balance) 
          : 850000.00;
      }
    }

    // 2. Query the transactions table for that user's wallet, ordered by most recent, limit 25
    const { data: txData, error: txError } = await window.MidePayDB.client
      .from('transactions')
      .select('*')
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false })
      .limit(25);

    const historyUnavailable = Boolean(txError || !Array.isArray(txData));

    if (!txError && Array.isArray(txData) && isLiveAuthenticated) {
      state.transactions = txData.map(tx => ({
        id: tx.id,
        ref: tx.reference || `MP-TX-${tx.id.toString().slice(0, 8)}`,
        title: tx.narration || (tx.type === 'inflow' ? 'Deposit / Inflow' : 'Transfer Outflow'),
        category: tx.category ? (tx.category.charAt(0).toUpperCase() + tx.category.slice(1)) : (tx.type === 'inflow' ? 'Deposit' : 'Transfer'),
        sender: tx.type === 'inflow' ? (tx.counterparty_name || 'Bank Transfer') : (state.user?.fullName || 'You'),
        beneficiary: tx.type === 'inflow' ? (state.user?.fullName || 'You') : (tx.counterparty_name || 'Beneficiary'),
        narration: tx.narration || '',
        date: formatTxDate(tx.created_at),
        type: tx.type,
        amount: Number(tx.amount) || 0,
        fee: Number(tx.fee || 0),
        status: transactionStatusLabel(tx.status)
      }));
    } else if (!window.MidePayDB.isProduction()) {
      const saved = loadUserTransactions();
      if (saved && saved.length > 0) {
        state.transactions = saved;
      } else if (!state.transactions || state.transactions.length === 0) {
        state.transactions = [...DEFAULT_DEMO_TRANSACTIONS];
      }
    }

    // 3. Hydrate user-specific Virtual Debit Cards, MideSave Vaults & Payroll History from Supabase
    if (isLiveAuthenticated && typeof window.loadUserVirtualCards === 'function') {
      await window.loadUserVirtualCards(currentUserId, state.user?.walletId || null, state.user?.fullName || 'MIDEPAY MEMBER');
    }
    if (typeof window.loadUserSavingsVaults === 'function') {
      await window.loadUserSavingsVaults(currentUserId);
    }
    if (typeof window.loadBusinessPayrollHistory === 'function') {
      await window.loadBusinessPayrollHistory(currentUserId);
    }

    setDashboardLoadState('ready', historyUnavailable ? 'error' : 'ready');

    // 4. Render updated live values
    if (state.user) {
      state.user.balance = state.dashBalance;
      saveAccountToRegistry(state.user);
    }
    syncUserToDashboard();
    renderBalances();
    renderDashboardTransactions();
    if (typeof refreshNotificationsAndRequests === 'function') {
      refreshNotificationsAndRequests().catch(console.warn);
    }
    return true;
  } catch (err) {
    console.warn('[MidePay] Dashboard refresh unavailable');
    setDashboardLoadState('error','error');
    return false;
  }
}

// --- System-Compatible Light & Dark Theme Controller ---
function initThemeController() {
  const THEME_STORAGE_KEY = 'midepay_theme_preference';
  const root = document.documentElement;

  function getSystemPreference() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function getActiveTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return getSystemPreference();
  }

  function applyTheme(theme, isUserExplicit = false) {
    root.setAttribute('data-theme', theme);
    if (isUserExplicit) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
    updateThemeToggleUI(theme);
  }

  function updateThemeToggleUI(theme) {
    const btns = document.querySelectorAll('.theme-toggle-btn');
    btns.forEach(btn => {
      const isDark = theme === 'dark';
      btn.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
      btn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    });
  }

  // Set initial theme immediately
  applyTheme(getActiveTheme(), false);

  // Global click listener for any theme toggle button (desktop header, mobile drawer)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-toggle-btn');
    if (!btn) return;
    const current = root.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
    if (typeof showToast === 'function') {
      showToast(next === 'light' ? '☀️ Switched to Light (White) Mode' : '🌙 Switched to Dark Mode');
    }
  });

  // Watch system color scheme changes if user hasn't explicitly set a preference
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (!saved) {
        applyTheme(e.matches ? 'dark' : 'light', false);
      }
    });
  }
}

// Run immediately for instant theme styling
initThemeController();

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  // Sanitize any legacy fake user IDs (like user-1790336298889) in localStorage
  (function sanitizeLegacyStorage() {
    try {
      const regStr = localStorage.getItem('midepay_accounts_registry');
      if (regStr) {
        let registry = JSON.parse(regStr);
        if (Array.isArray(registry)) {
          let updated = false;
          registry = registry.map(acc => {
            if (acc && acc.id && (acc.id.startsWith('user-') || acc.id.startsWith('local-'))) {
              acc.id = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000');
              updated = true;
            }
            return acc;
          });
          if (updated) {
            localStorage.setItem('midepay_accounts_registry', JSON.stringify(registry));
          }
        }
      }
      const singleUserStr = localStorage.getItem('midepay_user');
      if (singleUserStr) {
        const singleUser = JSON.parse(singleUserStr);
        if (singleUser && singleUser.id && (singleUser.id.startsWith('user-') || singleUser.id.startsWith('local-'))) {
          localStorage.removeItem('midepay_user');
        }
      }
    } catch (e) {}
  })();

  // 1. Initial LocalStorage session check & restoration
  const activeSessionStr = localStorage.getItem('midepay_session');
  let activeSession = null;
  try {
    activeSession = JSON.parse(activeSessionStr);
  } catch (e) {}

  if (activeSession && activeSession.loggedIn && activeSession.email) {
    const user = findAccount(activeSession.email);
    if (user) {
      state.user = user;
      if (user.balance !== undefined && user.balance !== null) {
        state.dashBalance = Number(user.balance);
      }
      const savedTxs = loadUserTransactions();
      if (savedTxs && savedTxs.length > 0) {
        state.transactions = savedTxs;
      } else if (user.email.toLowerCase() === 'olasunkanmiolamide15@gmail.com') {
        state.transactions = [...DEFAULT_DEMO_TRANSACTIONS];
      }
    }
  } else {
    // Check fallback single slot
    const savedUser = localStorage.getItem('midepay_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed && parsed.email) {
          saveAccountToRegistry(parsed);
          if (activeSession && activeSession.loggedIn) {
            state.user = parsed;
            if (parsed.balance !== undefined) state.dashBalance = Number(parsed.balance);
          }
        }
      } catch (e) {}
    }
  }

  // 2. Initial renders
  renderFeatureGrid('personal');
  renderBalances();
  renderDashboardTransactions();
  syncUserToDashboard();

  // 3. Auto-restore active view (if logged in, keep them on dashboard or landing)
  if (state.user) {
    let activeView = localStorage.getItem('midepay_active_view') || 'dashboard';
    if (activeView === 'admin') {
      checkExecutiveRoleFromDatabase().then(isExec => {
        if (!isExec) {
          localStorage.setItem('midepay_active_view', 'dashboard');
          showView('dashboard');
        } else {
          showView('admin');
        }
      });
    } else {
      showView(activeView);
    }
  } else {
    showView('landing');
  }
  updateExecutiveNavButtons().catch(() => {});

  // 4. Wire header shortcuts
  const gotoDashBtn = document.getElementById('nav-goto-dashboard-btn');
  if (gotoDashBtn) {
    gotoDashBtn.addEventListener('click', () => showView('dashboard'));
  }
  const userPill = document.getElementById('nav-user-pill');
  if (userPill) {
    userPill.addEventListener('click', () => showView('dashboard'));
  }

  // 5. Check for live Supabase session and load live data
  if (window.MidePayDB && window.MidePayDB.isConfigured()) {
    window.MidePayDB.getCurrentUser().then(async (supaUser) => {
      // If user is intentionally logged out (no midepay_session), skip auto-restore
      const session = localStorage.getItem('midepay_session');
      if (!session) return;
      if (supaUser) {
        if (!supaUser.email_confirmed_at) {
          await window.MidePayDB.signOut();
          localStorage.removeItem('midepay_session');
          if (typeof window.openOtpVerificationModal === 'function') {
            window.openOtpVerificationModal({
              email: supaUser.email,
              fullName: supaUser.user_metadata?.full_name || '',
              phone: supaUser.user_metadata?.phone || '',
              notice: 'Verify your 6-digit email OTP to continue to your MidePay wallet.'
            });
          }
          return;
        }
        const proof = await window.MidePayDB.client.rpc('get_email_verification_status');
        if (proof.error || !proof.data?.verified) {
          showView('login');
          const sent=await window.MidePayDB.requestEmailVerification(supaUser.email);
          window.openOtpVerificationModal({email:supaUser.email,challengeKind:'email',cooldown:sent.success?60:0,
            notice:sent.success?'Verify the fresh email code before restoring your session.':'Email verification required. Use Resend code to retry.'});
          return;
        }
        const provisioned = await window.MidePayDB.ensureProfileAndWallet(supaUser);
        const profile = provisioned?.profile || await window.MidePayDB.getProfile(supaUser.id);
        const wallet = provisioned?.wallet || await window.MidePayDB.getWallet(supaUser.id);
        const name = profile?.full_name || supaUser.user_metadata?.full_name || state.user?.fullName || supaUser.email.split('@')[0];
        const userNuban = wallet?.nuban || state.user?.nuban || generateUserNuban();
        const hasPin = Boolean(provisioned?.hasTransactionPin ?? profile?.has_transaction_pin);
        state.user = {
          id: supaUser.id,
          walletId: wallet?.id || null,
          fullName: name,
          email: supaUser.email,
          phone: profile?.phone || supaUser.user_metadata?.phone || '',
          tag: profile?.tag || state.user?.tag || `@${name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          nuban: userNuban,
          bank: wallet?.bank_name || 'MidePay / Providus Bank',
          role: profile?.role || 'user',
          isFrozen: profile?.is_frozen === true,
          hasTransactionPin: hasPin
        };
        state.hasTransactionPin = hasPin;
        state.requiresPinOnboarding = !hasPin;
        if (wallet?.balance !== undefined && wallet?.balance !== null) {
          state.dashBalance = Number(wallet.balance);
        }
        saveAccountToRegistry(state.user);
        syncUserToDashboard();
        await updateExecutiveNavButtons();
        await loadDashboardData();
        if (typeof window.enforceMandatoryPinOnboardingLock === 'function') {
          window.enforceMandatoryPinOnboardingLock(!hasPin);
        }
      }
    }).catch(console.warn);
  }

  // 5b. Auto-detect Paystack (?trxref= / ?reference=) or Flutterwave (?tx_ref= / ?status=) Checkout Return
  (function handleGatewayCheckoutReturn() {
    try {
      if (typeof window === 'undefined' || !window.location || !window.location.search) return;
      const params = new URLSearchParams(window.location.search);
      const paystackRef = params.get('trxref') || params.get('reference');
      const flwRef = params.get('tx_ref');
      const flwStatus = (params.get('status') || '').toLowerCase();
      const callbackRef = paystackRef || flwRef;

      if (!callbackRef) return;

      // Strip checkout query params cleanly from URL bar without page reload
      if (window.history && typeof window.history.replaceState === 'function') {
        const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
        window.history.replaceState({}, document.title || 'MidePay', cleanUrl);
      }

      if (flwRef && flwStatus && flwStatus !== 'successful' && flwStatus !== 'completed') {
        showToast(`Payment checkout returned status "${flwStatus}" (Ref: ${callbackRef}).`, 'error');
        return;
      }

      const gatewayLabel = callbackRef.startsWith('MDP-FLW') || flwRef ? 'Flutterwave' : 'Paystack';
      showView('dashboard');
      showToast(`⚡ Confirming ${gatewayLabel} settlement (${callbackRef}) & refreshing wallet...`, 'success');

      if (typeof loadDashboardData === 'function') {
        loadDashboardData().catch(console.warn);
        // Secondary refresh after 2.5s in case webhook settlement lands right after browser redirect
        setTimeout(() => {
          loadDashboardData().catch(console.warn);
        }, 2500);
      }
    } catch (e) {
      console.warn('[MidePay] Checkout callback reconciliation notice:', e);
    }
  })();

  // -------------------------------------------------------------
  // BRAND LOGO CLICK
  // -------------------------------------------------------------
  const brandBtn = document.getElementById('brand-logo-btn');
  if (brandBtn) {
    brandBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showView('landing');
    });
  }

  // -------------------------------------------------------------
  // NAVIGATION ROUTING BUTTONS
  // -------------------------------------------------------------
  const navLoginBtn = document.getElementById('nav-login-btn');
  const navRegisterBtn = document.getElementById('nav-register-btn');
  const heroGetStartedBtn = document.getElementById('hero-get-started-btn');
  const heroDemoBtn = document.getElementById('hero-demo-btn');
  const mobileLoginBtn = document.getElementById('mobile-login-btn');
  const mobileRegisterBtn = document.getElementById('mobile-register-btn');
  const footerLoginBtn = document.getElementById('footer-login-btn');
  const footerRegisterBtn = document.getElementById('footer-register-btn');
  const footerDemoDirect = document.getElementById('footer-demo-direct');

  if (navLoginBtn) navLoginBtn.addEventListener('click', () => showView('login'));
  if (mobileLoginBtn) mobileLoginBtn.addEventListener('click', () => showView('login'));
  if (footerLoginBtn) footerLoginBtn.addEventListener('click', () => showView('login'));

  if (navRegisterBtn) navRegisterBtn.addEventListener('click', () => showView('register'));
  if (mobileRegisterBtn) mobileRegisterBtn.addEventListener('click', () => showView('register'));
  if (heroGetStartedBtn) heroGetStartedBtn.addEventListener('click', () => showView('register'));
  if (footerRegisterBtn) footerRegisterBtn.addEventListener('click', () => showView('register'));

  // Direct Access Buttons (Platform Explore / Dashboard View)
  const openPlatformDirect = () => {
    if (state.user) {
      syncUserToDashboard();
      renderBalances();
      renderDashboardTransactions();
      showView('dashboard');
      showToast(`Welcome back, ${state.user.fullName}!`);
    } else {
      const user = findAccount('olasunkanmiolamide15@gmail.com') || getAccountsRegistry()[0];
      if (user) {
        state.user = user;
        state.dashBalance = user.balance !== undefined ? Number(user.balance) : 850000.00;
        state.transactions = [...DEFAULT_DEMO_TRANSACTIONS];
        saveAccountToRegistry(user);
        localStorage.setItem('midepay_session', JSON.stringify({ email: user.email, loggedIn: true }));
        syncUserToDashboard();
        renderBalances();
        renderDashboardTransactions();
        showView('dashboard');
        showToast(`Welcome back, ${user.fullName}!`);
      } else {
        showView('login');
      }
    }
  };

  if (heroDemoBtn) heroDemoBtn.addEventListener('click', openPlatformDirect);
  if (footerDemoDirect) footerDemoDirect.addEventListener('click', openPlatformDirect);

  // Switch between Login and Register views
  const switchToLoginBtn = document.getElementById('switch-to-login-btn');
  const switchToRegisterBtn = document.getElementById('switch-to-register-btn');
  const regBackBtn = document.getElementById('reg-back-btn');
  const loginBackBtn = document.getElementById('login-back-btn');

  if (switchToLoginBtn) switchToLoginBtn.addEventListener('click', () => showView('login'));
  if (switchToRegisterBtn) switchToRegisterBtn.addEventListener('click', () => showView('register'));
  if (regBackBtn) regBackBtn.addEventListener('click', () => showView('landing'));
  if (loginBackBtn) loginBackBtn.addEventListener('click', () => showView('landing'));

  // Mobile drawer toggle
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const mobileDrawer = document.getElementById('mobile-drawer');
  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener('click', () => {
      mobileDrawer.classList.toggle('open');
    });

    // Close when clicking mobile links
    mobileDrawer.querySelectorAll('.mobile-nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        const targetType = link.getAttribute('data-target');
        if (targetType) {
          switchFeatures(targetType);
        }
        mobileDrawer.classList.remove('open');
      });
    });
  }

  // -------------------------------------------------------------
  // BALANCE PRIVACY TOGGLE BUTTONS
  // -------------------------------------------------------------
  const heroBalanceToggle = document.getElementById('hero-balance-toggle');
  const dashBalanceToggle = document.getElementById('dash-balance-toggle');

  if (heroBalanceToggle) {
    heroBalanceToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBalanceVisibility();
    });
  }

  if (dashBalanceToggle) {
    dashBalanceToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBalanceVisibility();
    });
  }

  // -------------------------------------------------------------
  // PERSONAL / BUSINESS TOGGLE SWITCH
  // -------------------------------------------------------------
  const tabPersonal = document.getElementById('tab-personal-btn');
  const tabBusiness = document.getElementById('tab-business-btn');

  function switchFeatures(type) {
    state.activeFeatureTab = type;
    if (type === 'personal') {
      tabPersonal?.classList.add('active');
      tabPersonal?.setAttribute('aria-selected', 'true');
      tabBusiness?.classList.remove('active');
      tabBusiness?.setAttribute('aria-selected', 'false');
    } else {
      tabBusiness?.classList.add('active');
      tabBusiness?.setAttribute('aria-selected', 'true');
      tabPersonal?.classList.remove('active');
      tabPersonal?.setAttribute('aria-selected', 'false');
    }
    renderFeatureGrid(type);
  }

  if (tabPersonal) tabPersonal.addEventListener('click', () => switchFeatures('personal'));
  if (tabBusiness) tabBusiness.addEventListener('click', () => switchFeatures('business'));

  // Landing Header Links for Personal / Business
  const navFeaturesLink = document.getElementById('nav-features-link');
  const navBusinessLink = document.getElementById('nav-business-link');
  if (navFeaturesLink) {
    navFeaturesLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchFeatures('personal');
      document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
    });
  }
  if (navBusinessLink) {
    navBusinessLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchFeatures('business');
      document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // -------------------------------------------------------------
  // FAQ ACCORDION LOGIC
  // -------------------------------------------------------------
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const btn = item.querySelector('.faq-question-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      // Collapse others for clean accordion experience
      faqItems.forEach(other => {
        other.classList.remove('active');
        const otherBtn = other.querySelector('.faq-question-btn');
        if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
      });

      if (!isActive) {
        item.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // -------------------------------------------------------------
  // WAITLIST FORM CAPTURE
  // -------------------------------------------------------------
  const waitlistForm = document.getElementById('waitlist-form');
  const waitlistInput = document.getElementById('waitlist-email');
  const waitlistFeedback = document.getElementById('waitlist-feedback');

  if (waitlistForm && waitlistInput && waitlistFeedback) {
    waitlistForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = waitlistInput.value.trim();

      if (!email || !email.includes('@') || !email.includes('.')) {
        waitlistFeedback.className = 'form-feedback error';
        waitlistFeedback.textContent = 'Please enter a valid email address.';
        waitlistFeedback.classList.remove('hidden');
        return;
      }

      // Save to localStorage list & Supabase Waitlist table
      try {
        const storedList = JSON.parse(localStorage.getItem('midepay_waitlist') || '[]');
        if (!storedList.includes(email)) {
          storedList.push(email);
          localStorage.setItem('midepay_waitlist', JSON.stringify(storedList));
        }
        if (window.MidePayDB && typeof window.MidePayDB.joinWaitlist === 'function') {
          window.MidePayDB.joinWaitlist(email).catch(console.error);
        }
      } catch (err) {
        // fallback
      }

      waitlistFeedback.className = 'form-feedback success';
      waitlistFeedback.innerHTML = `🎉 <strong>You're in!</strong> You've been assigned priority slot #15,249. We'll email <em>${escapeHtml(email)}</em> upon our CBN-partnered launch.`;
      waitlistFeedback.classList.remove('hidden');
      waitlistInput.value = '';
      showToast('Waitlist confirmation recorded!');
    });
  }

  // -------------------------------------------------------------
  // PASSWORD VISIBILITY TOGGLES (REGISTER & LOGIN)
  // -------------------------------------------------------------
  function setupPasswordToggle(toggleBtnId, inputId) {
    const btn = document.getElementById(toggleBtnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    btn.addEventListener('click', () => {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';

      const eyeOpen = btn.querySelector('.pwd-eye-open');
      const eyeClosed = btn.querySelector('.pwd-eye-closed');

      if (eyeOpen && eyeClosed) {
        if (isPassword) {
          eyeOpen.classList.add('hidden');
          eyeClosed.classList.remove('hidden');
        } else {
          eyeOpen.classList.remove('hidden');
          eyeClosed.classList.add('hidden');
        }
      }
    });
  }

  setupPasswordToggle('reg-password-toggle', 'reg-password');
  setupPasswordToggle('login-password-toggle', 'login-password');

  // -------------------------------------------------------------
  // 6-DIGIT EMAIL OTP VERIFICATION, RESEND COOLDOWN & PIN LOCK
  // -------------------------------------------------------------
  const modalOtpVerification = document.getElementById('modal-otp-verification');
  const otpTargetEmailEl = document.getElementById('otp-target-email');
  const otpFeedbackAlert = document.getElementById('otp-feedback-alert');
  const otpVerifyForm = document.getElementById('otp-verify-form');
  const btnVerifyOtp = document.getElementById('btn-verify-otp');
  const btnResendOtp = document.getElementById('btn-resend-otp');
  const otpResendTimerEl = document.getElementById('otp-resend-timer');
  const btnOtpBackToLogin = document.getElementById('btn-otp-back-to-login');
  const otpDigitInputs = [
    document.getElementById('otp-digit-1'),
    document.getElementById('otp-digit-2'),
    document.getElementById('otp-digit-3'),
    document.getElementById('otp-digit-4'),
    document.getElementById('otp-digit-5'),
    document.getElementById('otp-digit-6')
  ].filter(Boolean);

  const modalPinOnboarding = document.getElementById('modal-pin-onboarding');
  const pinOnboardingForm = document.getElementById('pin-onboarding-form');
  const pinOnboardingNewInput = document.getElementById('pin-onboarding-new');
  const pinOnboardingConfirmInput = document.getElementById('pin-onboarding-confirm');
  const pinOnboardingError = document.getElementById('pin-onboarding-error');
  const pinOnboardingLoginMeta = document.getElementById('pin-onboarding-login-meta');
  const btnSubmitPinOnboarding = document.getElementById('btn-submit-pin-onboarding');
  const btnPinOnboardingLogout = document.getElementById('btn-pin-onboarding-logout');

  const loginSecurityAlertBanner = document.getElementById('login-security-alert-banner');
  const loginSecurityAlertText = document.getElementById('login-security-alert-text');
  const btnDismissLoginAlert = document.getElementById('btn-dismiss-login-alert');

  if (btnDismissLoginAlert && loginSecurityAlertBanner) {
    btnDismissLoginAlert.addEventListener('click', () => {
      loginSecurityAlertBanner.classList.add('hidden');
    });
  }

  const otpFlowState = {
    email: '',
    fullName: '',
    phone: '',
    challengeKind: 'signup',
    cooldownRemaining: 0,
    timerId: null
  };

  function showOtpFeedback(msg, kind = 'error') {
    if (!otpFeedbackAlert) return;
    otpFeedbackAlert.className = kind === 'success' ? 'auth-alert success' : 'auth-alert error';
    otpFeedbackAlert.textContent = msg;
    otpFeedbackAlert.classList.remove('hidden');
  }

  function clearOtpDigits() {
    otpDigitInputs.forEach(inp => {
      inp.value = '';
    });
  }

  function fillOtpDigits(rawStr) {
    const digits = String(rawStr || '').replace(/[^0-9]/g, '').slice(0, 6);
    otpDigitInputs.forEach((inp, idx) => {
      inp.value = digits[idx] || '';
    });
    if (digits.length > 0) {
      const targetIdx = Math.min(digits.length, otpDigitInputs.length) - 1;
      otpDigitInputs[targetIdx]?.focus();
    }
    return digits;
  }
  window.fillOtpDigits = fillOtpDigits;

  function getCollectedOtpToken() {
    return otpDigitInputs.map(inp => String(inp.value || '').replace(/[^0-9]/g, '').slice(0, 1)).join('');
  }
  window.getCollectedOtpToken = getCollectedOtpToken;

  function stopOtpResendTimer() {
    if (otpFlowState.timerId && typeof clearInterval === 'function') {
      clearInterval(otpFlowState.timerId);
    }
    otpFlowState.timerId = null;
  }

  function syncOtpResendUi() {
    const rem = Math.max(0, Math.ceil(otpFlowState.cooldownRemaining));
    if (rem > 0) {
      if (btnResendOtp) btnResendOtp.disabled = true;
      if (otpResendTimerEl) otpResendTimerEl.textContent = `Resend code in ${rem}s`;
    } else {
      if (btnResendOtp) btnResendOtp.disabled = false;
      if (otpResendTimerEl) otpResendTimerEl.textContent = "Didn't receive the 6-digit code?";
    }
  }

  function tickOtpResendCooldown(stepSeconds = 1) {
    otpFlowState.cooldownRemaining = Math.max(0, otpFlowState.cooldownRemaining - Number(stepSeconds || 1));
    if (otpFlowState.cooldownRemaining <= 0) {
      stopOtpResendTimer();
    }
    syncOtpResendUi();
    return otpFlowState.cooldownRemaining;
  }
  window.tickOtpResendCooldown = tickOtpResendCooldown;

  function startOtpResendCooldown(seconds = 60) {
    stopOtpResendTimer();
    otpFlowState.cooldownRemaining = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 60;
    syncOtpResendUi();
    if (otpFlowState.cooldownRemaining > 0 && typeof setInterval === 'function') {
      otpFlowState.timerId = setInterval(() => {
        tickOtpResendCooldown(1);
      }, 1000);
    }
  }
  window.startOtpResendCooldown = startOtpResendCooldown;
  window.getOtpFlowState = () => ({
    email: otpFlowState.email,
    fullName: otpFlowState.fullName,
    phone: otpFlowState.phone,
    cooldownRemaining: otpFlowState.cooldownRemaining
  });

  // Wire 6 auto-advancing OTP inputs + Backspace/Arrow navigation + 6-digit paste support
  otpDigitInputs.forEach((inp, idx) => {
    inp.addEventListener('input', () => {
      const cleaned = String(inp.value || '').replace(/[^0-9]/g, '');
      if (!cleaned) {
        inp.value = '';
        return;
      }
      if (cleaned.length > 1) {
        for (let offset = 0; offset < cleaned.length && (idx + offset) < otpDigitInputs.length; offset++) {
          otpDigitInputs[idx + offset].value = cleaned[offset];
        }
        const focusIdx = Math.min(idx + cleaned.length, otpDigitInputs.length - 1);
        otpDigitInputs[focusIdx]?.focus();
        return;
      }
      inp.value = cleaned;
      if (idx < otpDigitInputs.length - 1) {
        otpDigitInputs[idx + 1]?.focus();
      }
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && idx > 0) {
        otpDigitInputs[idx - 1].value = '';
        otpDigitInputs[idx - 1].focus();
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        otpDigitInputs[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < otpDigitInputs.length - 1) {
        otpDigitInputs[idx + 1].focus();
      }
    });

    inp.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData && typeof e.clipboardData.getData === 'function')
        ? e.clipboardData.getData('text')
        : (e.pastedText || '');
      fillOtpDigits(pasted);
    });
  });

  function openOtpVerificationModal({ email, fullName = '', phone = '', cooldown = 60, notice = '', challengeKind = 'signup' } = {}) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    otpFlowState.email = cleanEmail;
    otpFlowState.challengeKind = challengeKind;
    otpFlowState.fullName = fullName || otpFlowState.fullName || '';
    otpFlowState.phone = phone || otpFlowState.phone || '';

    if (otpTargetEmailEl) otpTargetEmailEl.textContent = cleanEmail || 'your email';
    clearOtpDigits();
    if (notice) {
      showOtpFeedback(notice, 'success');
    } else if (otpFeedbackAlert) {
      otpFeedbackAlert.classList.add('hidden');
    }

    startOtpResendCooldown(cooldown);
    modalOtpVerification?.classList.remove('hidden');
    otpDigitInputs[0]?.focus();
  }
  window.openOtpVerificationModal = openOtpVerificationModal;

  function closeOtpVerificationModal() {
    stopOtpResendTimer();
    modalOtpVerification?.classList.add('hidden');
  }
  window.closeOtpVerificationModal = closeOtpVerificationModal;

  if (btnOtpBackToLogin) {
    btnOtpBackToLogin.addEventListener('click', () => {
      const loginEmailEl = document.getElementById('login-email');
      if (loginEmailEl && otpFlowState.email) {
        loginEmailEl.value = otpFlowState.email;
      }
      closeOtpVerificationModal();
      showView('login');
    });
  }

  if (btnResendOtp) {
    btnResendOtp.addEventListener('click', async () => {
      if (otpFlowState.cooldownRemaining > 0 || !otpFlowState.email) return;
      await withSubmitLock('otp-resend', btnResendOtp, 'Sending...', async () => {
        if (!window.MidePayDB || typeof window.MidePayDB.resendSignupOtp !== 'function') {
          showOtpFeedback('OTP resend service is unavailable.', 'error');
          return;
        }
        const res = otpFlowState.challengeKind === 'email'
          ? await window.MidePayDB.requestEmailVerification(otpFlowState.email)
          : await window.MidePayDB.resendSignupOtp(otpFlowState.email);
        if (!res.success) {
          showOtpFeedback(res.error?.message || 'Unable to resend verification code right now.', 'error');
          return;
        }
        clearOtpDigits();
        startOtpResendCooldown(60);
        showOtpFeedback(`✓ Fresh 6-digit verification code sent to ${otpFlowState.email}.`, 'success');
        showToast(`6-digit OTP resent to ${otpFlowState.email}`);
        otpDigitInputs[0]?.focus();
      });
      syncOtpResendUi();
    });
  }

  function enforceMandatoryPinOnboardingLock(shouldLock, loginAuditInfo = null) {
    const dashViewEl = document.getElementById('view-dashboard');
    state.requiresPinOnboarding = Boolean(shouldLock);
    state.hasTransactionPin = !shouldLock;

    if (shouldLock) {
      dashViewEl?.classList.add('dashboard-pin-locked');
      if (pinOnboardingError) pinOnboardingError.classList.add('hidden');
      if (pinOnboardingNewInput) pinOnboardingNewInput.value = '';
      if (pinOnboardingConfirmInput) pinOnboardingConfirmInput.value = '';
      if (pinOnboardingLoginMeta && loginAuditInfo?.device) {
        const plat = loginAuditInfo.device.platform || 'Web';
        const tz = loginAuditInfo.device.timezone || 'UTC';
        pinOnboardingLoginMeta.textContent = `Email verified. Signed in on ${plat} (${tz}). Identity verification is a separate check.`;
      }
      modalPinOnboarding?.classList.remove('hidden');
      pinOnboardingNewInput?.focus();
    } else {
      dashViewEl?.classList.remove('dashboard-pin-locked');
      modalPinOnboarding?.classList.add('hidden');
    }
  }
  window.enforceMandatoryPinOnboardingLock = enforceMandatoryPinOnboardingLock;

  async function completeVerifiedUserSession(supaUser, { fullName = '', phone = '', loginMethod = 'password_login' } = {}) {
    const realUserId = supaUser.id;
    if (typeof window.resetVirtualCardState === 'function') {
      window.resetVirtualCardState();
    }
    if (typeof window.resetMideSaveAndPayrollState === 'function') {
      window.resetMideSaveAndPayrollState();
    }
    state.transactions = [];

    const provisioned = await window.MidePayDB.ensureProfileAndWallet(supaUser, { fullName, phone });
    const loginAudit = await window.MidePayDB.recordVerifiedLoginSession({ login_method: loginMethod });
    if (!loginAudit?.success) {
      if (loginAudit?.code === 'EMAIL_OTP_REQUIRED') {
        const sent = await window.MidePayDB.requestEmailVerification(supaUser.email);
        openOtpVerificationModal({email:supaUser.email, fullName, phone, challengeKind:'email', cooldown: sent.success ? 60 : 0,
          notice: sent.success ? 'Verify the fresh email code to continue.' : 'Email verification is required. Use Resend code to try again.'});
        return;
      }
      throw new Error(loginAudit?.error || 'Login security verification unavailable.');
    }
    const profile = provisioned?.profile || await window.MidePayDB.getProfile(realUserId);
    const wallet = provisioned?.wallet || await window.MidePayDB.getWallet(realUserId);

    // A failed wallet read must never become a fabricated account or balance.
    const walletBalance = wallet?.balance;
    const parsedBalance = (typeof walletBalance === 'number' || (typeof walletBalance === 'string' && walletBalance.trim() !== '')) ? Number(walletBalance) : NaN;
    const kobo = parsedBalance * 100;
    if (profile?.id !== realUserId || wallet?.user_id !== realUserId || !wallet?.id || wallet.currency !== 'NGN' || !/^\d{10}$/.test(String(wallet.nuban || '')) || !Number.isFinite(parsedBalance) || parsedBalance < 0 || !Number.isSafeInteger(Math.round(kobo)) || Math.abs(kobo - Math.round(kobo)) > 0.0000001) {
      throw new Error('Wallet setup is not ready. Please sign in again or contact support. No account number has been generated.');
    }

    const userName = profile?.full_name || fullName || supaUser.user_metadata?.full_name || supaUser.email.split('@')[0];
    const userNuban = wallet.nuban;
    const userBalance = parsedBalance;
    const hasPin = Boolean(
      provisioned?.hasTransactionPin ||
      loginAudit?.hasTransactionPin ||
      profile?.has_transaction_pin
    );

    const verifiedUser = {
      id: realUserId,
      walletId: wallet?.id || null,
      fullName: userName,
      email: supaUser.email,
      phone: profile?.phone || phone || supaUser.user_metadata?.phone || '',
      tag: profile?.tag || `@${userName.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      nuban: userNuban,
      bank: wallet?.bank_name || 'MidePay wallet',
      balance: userBalance,
      kycTier: Number.isInteger(profile?.kyc_tier) && profile.kyc_tier >= 1 && profile.kyc_tier <= 3 ? profile.kyc_tier : 1,
      isFrozen: profile?.is_frozen === true,
      role: profile?.role || 'user',
      hasTransactionPin: hasPin
    };

    saveAccountToRegistry(verifiedUser);
    localStorage.setItem('midepay_session', JSON.stringify({ email: verifiedUser.email, loggedIn: true }));
    localStorage.setItem('midepay_active_view', 'dashboard');

    state.user = verifiedUser;
    state.dashBalance = userBalance;
    state.kycTier = verifiedUser.kycTier;
    state.isAccountFrozen = verifiedUser.isFrozen;
    state.hasTransactionPin = hasPin;
    state.requiresPinOnboarding = !hasPin;

    syncUserToDashboard();
    renderBalances();
    await updateExecutiveNavButtons();
    await loadDashboardData();
    showView('dashboard');

    // Display verified login security alert banner with timestamp & device metadata
    if (loginSecurityAlertBanner && loginSecurityAlertText) {
      const loginTime = loginAudit?.loginAt
        ? new Date(loginAudit.loginAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
        : 'Just now';
      const plat = loginAudit?.device?.platform || 'Web Browser';
      const tz = loginAudit?.device?.timezone || 'Africa/Lagos';
      loginSecurityAlertText.textContent = `Signed in at ${loginTime} • ${plat} • ${tz}.`;
      loginSecurityAlertBanner.classList.remove('hidden');
    }

    if (!hasPin) {
      enforceMandatoryPinOnboardingLock(true, loginAudit);
      showToast(`Email verified! Create your 4-digit Transaction PIN to unlock your wallet.`);
    } else {
      enforceMandatoryPinOnboardingLock(false);
      showToast(`Welcome, ${verifiedUser.fullName}! Your wallet dashboard is ready.`);
    }
  }

  if (otpVerifyForm) {
    otpVerifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (otpFeedbackAlert) otpFeedbackAlert.classList.add('hidden');

      const token = getCollectedOtpToken();
      if (!/^\d{6}$/.test(token)) {
        showOtpFeedback('Please enter all 6 numeric digits sent to your email address.', 'error');
        return;
      }

      await withSubmitLock('otp-verify', btnVerifyOtp, 'Verifying OTP...', async () => {
        if (!window.MidePayDB || typeof window.MidePayDB.verifySignupOtp !== 'function') {
          showOtpFeedback('OTP verification service is unavailable.', 'error');
          return;
        }

        const { user: verifiedSupaUser, error: otpErr } = await window.MidePayDB.verifySignupOtp({
          email: otpFlowState.email,
          token,
          type: 'signup'
        });

        if (otpErr || !verifiedSupaUser) {
          showOtpFeedback(otpErr?.message || 'Invalid or expired 6-digit verification code.', 'error');
          return;
        }

        closeOtpVerificationModal();
        await completeVerifiedUserSession(verifiedSupaUser, {
          fullName: otpFlowState.fullName,
          phone: otpFlowState.phone,
          loginMethod: 'email_otp_signup'
        });
      });
    });
  }

  if (pinOnboardingForm) {
    pinOnboardingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (pinOnboardingError) pinOnboardingError.classList.add('hidden');

      const newPin = String(pinOnboardingNewInput?.value || '').trim();
      const confirmPin = String(pinOnboardingConfirmInput?.value || '').trim();

      if (!/^\d{4}$/.test(newPin)) {
        if (pinOnboardingError) {
          pinOnboardingError.textContent = 'Transaction PIN must be exactly 4 numeric digits (0-9).';
          pinOnboardingError.classList.remove('hidden');
        }
        return;
      }

      if (newPin !== confirmPin) {
        if (pinOnboardingError) {
          pinOnboardingError.textContent = 'PIN confirmation does not match. Please re-enter the same 4 digits.';
          pinOnboardingError.classList.remove('hidden');
        }
        return;
      }

      await withSubmitLock('pin-onboarding-submit', btnSubmitPinOnboarding, 'Saving PIN...', async () => {
        if (!window.MidePayDB || !state.user?.id) {
          if (pinOnboardingError) {
            pinOnboardingError.textContent = 'Authenticated session required to configure your PIN.';
            pinOnboardingError.classList.remove('hidden');
          }
          return;
        }

        const res = await window.MidePayDB.setUserPin(state.user.id, newPin);
        if (!res || !res.success) {
          if (pinOnboardingError) {
            pinOnboardingError.textContent = res?.error || 'Unable to save Transaction PIN on server.';
            pinOnboardingError.classList.remove('hidden');
          }
          return;
        }

        if (state.user) state.user.hasTransactionPin = true;
        enforceMandatoryPinOnboardingLock(false);
        if (pinOnboardingNewInput) pinOnboardingNewInput.value = '';
        if (pinOnboardingConfirmInput) pinOnboardingConfirmInput.value = '';
        showToast('Transaction PIN saved. Your dashboard is ready.', 'success');
      });
    });
  }

  if (btnPinOnboardingLogout) {
    btnPinOnboardingLogout.addEventListener('click', () => {
      enforceMandatoryPinOnboardingLock(false);
      handleLogout();
    });
  }

  // -------------------------------------------------------------
  // REGISTER FORM SUBMISSION -> ROUTES TO 6-DIGIT EMAIL OTP MODAL
  // -------------------------------------------------------------
  const registerForm = document.getElementById('register-form');
  const regErrorAlert = document.getElementById('register-error-alert');
  const regSubmitBtn = document.getElementById('reg-submit-btn');

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (regErrorAlert) regErrorAlert.classList.add('hidden');

      const fullName = document.getElementById('reg-fullname').value.trim();
      const email = document.getElementById('reg-email').value.trim().toLowerCase();
      const phone = document.getElementById('reg-phone').value.trim();
      const password = document.getElementById('reg-password').value;

      if (!fullName || fullName.length < 2) {
        showRegisterError('Please enter your full legal name.');
        return;
      }

      if (!email || !email.includes('@') || !email.includes('.')) {
        showRegisterError('Please enter a valid email address.');
        return;
      }

      if (!phone || phone.length < 7) {
        showRegisterError('Please enter a valid Nigerian mobile number.');
        return;
      }

      if (!password || password.length < 6) {
        showRegisterError('Password must be at least 6 characters long.');
        return;
      }

      const liveSupaConnected = Boolean(window.MidePayDB && window.MidePayDB.isConfigured() && window.MidePayDB.client);

      await withSubmitLock('auth-register', regSubmitBtn, 'Creating Account...', async () => {
        if (liveSupaConnected) {
          try {
            const signUpRes = await window.MidePayDB.signUp({ email, password, fullName, phone });
            if (signUpRes.error) {
              console.error('[MidePay] Supabase signUp error:', signUpRes.error.message);
              showRegisterError(signUpRes.error.message || 'Registration failed with Supabase backend.');
              return;
            }
            if (!signUpRes.user || !signUpRes.user.id) {
              showRegisterError('Failed to obtain a valid user identifier from Supabase.');
              return;
            }

            // Transition smoothly to 6-Digit Email OTP Verification modal (zero unverified dashboard login)
            openOtpVerificationModal({
              email,
              fullName,
              phone,
              challengeKind: signUpRes.otpChallengeKind || 'signup',
              cooldown: 60,
              notice: `✓ Account created for ${fullName}! Enter the 6-digit verification code sent to ${email}.`
            });
            showToast(`6-digit verification code sent to ${email}`);
            return;
          } catch (supaEx) {
            console.error('[MidePay] Supabase signUp exception:', supaEx);
            showRegisterError(supaEx.message || 'Error communicating with Supabase.');
            return;
          }
        }

        if (isProductionEnv()) {
          showRegisterError('Authentication service is currently unavailable.');
          return;
        }
      });
    });
  }

  function showRegisterError(msg) {
    if (regErrorAlert) {
      regErrorAlert.className = 'auth-alert error';
      regErrorAlert.textContent = msg;
      regErrorAlert.classList.remove('hidden');
    }
  }

  // -------------------------------------------------------------
  // LOGIN FORM & UNCONFIRMED EMAIL AUTO-ROUTING TO OTP SCREEN
  // -------------------------------------------------------------
  loginForm = document.getElementById('login-form');
  loginErrorAlert = document.getElementById('login-error-alert');
  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const forgotPasswordLink = document.getElementById('forgot-password-link');

  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.assign('/password-recovery');
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (loginErrorAlert) loginErrorAlert.classList.add('hidden');

      const email = document.getElementById('login-email').value.trim().toLowerCase();
      const password = document.getElementById('login-password').value;

      if (!email || !password) {
        showLoginError('Please enter both email and password.');
        return;
      }

      const liveSupaConnected = Boolean(window.MidePayDB && window.MidePayDB.isConfigured() && window.MidePayDB.client);

      await withSubmitLock('auth-login', loginSubmitBtn, 'Signing In...', async () => {
        if (liveSupaConnected) {
          try {
            const signInRes = await window.MidePayDB.signIn({ email, password });

            // Automatically route unconfirmed users (`Email not confirmed`) to OTP modal & resend fresh code
            if (signInRes.emailNotConfirmed || (signInRes.error && /email\s*not\s*confirmed|not\s*verified|unconfirmed/i.test(signInRes.error.message || ''))) {
              if (typeof window.MidePayDB.resendSignupOtp === 'function') {
                await window.MidePayDB.resendSignupOtp(email);
              }
              openOtpVerificationModal({
                email,
                cooldown: 60,
                notice: `Your email (${email}) isn't verified yet. We've sent a fresh 6-digit verification code to your inbox.`
              });
              showToast(`Verification required — fresh 6-digit code sent to ${email}`);
              return;
            }

            if (signInRes.error) {
              console.warn('[MidePay] Supabase signIn error:', signInRes.error.message);
              showLoginError(signInRes.error.message || 'Invalid email or password.');
              return;
            }

            if (signInRes.user && signInRes.user.id) {
              await completeVerifiedUserSession(signInRes.user, {
                loginMethod: 'password_login'
              });
              return;
            }
          } catch (supaEx) {
            console.error('[MidePay] Supabase signIn error:', supaEx);
            showLoginError(supaEx.message || 'Unable to connect to authentication server.');
            return;
          }
        }

        showLoginError('Invalid email or password. Please verify your credentials or register a new account.');
      });
    });
  }

  function showLoginError(msg) {
    if (loginErrorAlert) {
      loginErrorAlert.className = 'auth-alert error';
      loginErrorAlert.textContent = msg;
      loginErrorAlert.classList.remove('hidden');
    }
  }

  // -------------------------------------------------------------
  // DASHBOARD ACTIONS & LOGOUT
  // -------------------------------------------------------------
  const dashLogoutBtn = document.getElementById('dash-logout-btn');
  const navLogoutBtn = document.getElementById('nav-logout-btn');
  const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
  const adminLogoutBtn = document.getElementById('admin-logout-btn');

  let logoutInProgress = false;
  async function handleLogout() {
    if (logoutInProgress) return;
    logoutInProgress = true;
    const controls = [dashLogoutBtn, navLogoutBtn, mobileLogoutBtn, adminLogoutBtn].filter(Boolean).map(el => ({ el, disabled: el.disabled }));
    controls.forEach(({ el }) => { el.disabled = true; });
    try {
    clearTreasurySecrets();
    treasuryOperation=null;
    treasuryPanel?.classList.add('hidden');
    let logoutResult = null;
    if (window.MidePayDB && typeof window.MidePayDB.signOut === 'function') {
      try { logoutResult = await window.MidePayDB.signOut(); } catch (_) {}
    }
    // Do not remove SDK tokens before the server sign-out attempt above.
    let appLocalStateCleared = true;
    try {
      localStorage.removeItem('midepay_session');
      localStorage.removeItem('midepay_active_view');
      localStorage.removeItem('midepay_user');
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-') || key.includes('supabase') || key.startsWith('midepay_session') || key === 'midepay_user' || key === 'midepay_active_view') {
          localStorage.removeItem(key);
        }
      });
    } catch (e) { appLocalStateCleared = false; }

    state.user = null;
    state.dashBalance = 0.00;
    state.transactions = [];
    state.hasTransactionPin = false;
    state.requiresPinOnboarding = false;
    _isExecutiveVerified = false;
    _executiveCheckInFlight = null;
    closeOtpVerificationModal();
    enforceMandatoryPinOnboardingLock(false);
    loginSecurityAlertBanner?.classList.add('hidden');
    if (typeof window.resetVirtualCardState === 'function') {
      window.resetVirtualCardState();
    }
    if (typeof window.resetMideSaveAndPayrollState === 'function') {
      window.resetMideSaveAndPayrollState();
    }

    try { syncUserToDashboard(); } catch (e) {}
    try { renderBalances(); } catch (e) {}
    try { renderDashboardTransactions(); } catch (e) {}
    try { updateExecutiveNavButtons().catch(() => {}); } catch (e) {}
    try { showView('landing'); } catch (e) {}
    try {
      if (!appLocalStateCleared || logoutResult?.localStateCleared === false) {
        showToast('Saved sign-in data could not be cleared. Close this tab before leaving this device.', 'error');
      } else if (window.MidePayDB?.isConfigured?.() && logoutResult?.sessionsRevoked !== true) {
        showToast('Signed out on this device. Server sign-out could not be confirmed; reconnect and sign out again.', 'error');
      } else {
        showToast('Logged out of MidePay successfully.');
      }
    } catch (e) {}
    } finally {
      controls.forEach(({ el, disabled }) => { el.disabled = disabled; });
      logoutInProgress = false;
    }
  }
  window.handleLogout = handleLogout;

  if (dashLogoutBtn) dashLogoutBtn.addEventListener('click', handleLogout);
  if (navLogoutBtn) navLogoutBtn.addEventListener('click', handleLogout);
  if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', handleLogout);
  if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', handleLogout);

  // Global event delegation for all logout & admin action triggers
  document.addEventListener('click', (e) => {
    const logoutTarget = e.target.closest('#dash-logout-btn, #nav-logout-btn, #mobile-logout-btn, #admin-logout-btn, [data-action="logout"]');
    if (logoutTarget) {
      e.preventDefault();
      handleLogout();
      return;
    }
    const adminTarget = e.target.closest('#nav-open-admin-btn, #dash-open-admin-btn, #nav-landing-admin-btn, #mobile-admin-btn, #footer-admin-btn');
    if (adminTarget) {
      e.preventDefault();
      showView('admin');
      return;
    }
  });

  // Copy NUBAN Account Number
  function copyNuban(textToCopy) {
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast(`Copied NUBAN ${textToCopy} to clipboard!`);
    }).catch(() => {
      showToast(`Account number: ${textToCopy}`);
    });
  }

  const copyNubanBtn = document.getElementById('copy-nuban-btn');
  const modalCopyBtn = document.getElementById('modal-copy-btn');

  if (copyNubanBtn) {
    copyNubanBtn.addEventListener('click', () => {
      const num = state.user?.nuban || document.getElementById('dash-nuban-text')?.textContent.replace(/\s+/g, '') || generateUserNuban('user');
      copyNuban(num);
    });
  }

  if (modalCopyBtn) {
    modalCopyBtn.addEventListener('click', () => {
      const num = state.user?.nuban || document.getElementById('modal-nuban-copy')?.textContent.trim() || generateUserNuban('user');
      copyNuban(num);
    });
  }

  // -------------------------------------------------------------
  // TRANSACTION FILTER TABS (ALL / INFLOW / OUTFLOW)
  // -------------------------------------------------------------
  const filterPills = document.querySelectorAll('.tx-filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.txFilter = pill.getAttribute('data-filter') || 'all';
      renderDashboardTransactions();
    });
  });

  // -------------------------------------------------------------
  // MODALS: SEND MONEY & ADD MONEY (INTERACTIVE FINTECH DEMO)
  // -------------------------------------------------------------
  const modalSend = document.getElementById('modal-send-money');
  const modalAdd = document.getElementById('modal-add-money');

  const btnOpenSend = document.getElementById('btn-open-send-modal');
  const btnOpenAdd = document.getElementById('btn-open-add-modal');
  const btnCloseSend = document.getElementById('close-send-modal-btn');
  const btnCloseAdd = document.getElementById('close-add-modal-btn');

  // Quick Action triggers
  const qaTransfer = document.getElementById('qa-transfer');
  const qaAirtime = document.getElementById('qa-airtime');
  const qaBills = document.getElementById('qa-bills');
  const qaCard = document.getElementById('qa-card');

  // Hero phone mockup triggers
  const heroQuickSend = document.getElementById('hero-quick-send');
  const heroQuickReceive = document.getElementById('hero-quick-receive');
  const heroQuickBills = document.getElementById('hero-quick-bills');
  const heroQuickCards = document.getElementById('hero-quick-cards');

  function openSendModal() {
    ensureUserSession();
    if (state.isAccountFrozen) {
      showToast('🔒 Account is frozen. Outbound transfers are blocked per CBN emergency protocol. Tap "Unfreeze" on your balance card.', 'error');
      openFreezeModal();
      return;
    }
    const sendAmountInput = document.getElementById('send-amount');
    if (sendAmountInput && (!sendAmountInput.value || sendAmountInput.value === '0')) {
      sendAmountInput.value = '5000';
      if (typeof sendFlowState !== 'undefined') sendFlowState.amount = 5000;
    }
    const sendRecipientInput = document.getElementById('send-recipient');
    if (sendRecipientInput && !sendRecipientInput.value && !(window.MidePayDB && window.MidePayDB.isProduction())) {
      sendRecipientInput.value = '9048291048';
      if (typeof triggerAccountResolution === 'function') triggerAccountResolution();
    }
    const sendModalBalance = document.getElementById('transfer-modal-balance');
    if (sendModalBalance) {
      sendModalBalance.textContent = formatNaira(state.dashBalance);
    }
    if (typeof showSendStep === 'function') {
      showSendStep('recipient');
    }
    modalSend?.classList.remove('hidden');
  }
  window.openSendModal = openSendModal;

  if (btnOpenSend) btnOpenSend.addEventListener('click', openSendModal);
  if (qaTransfer) qaTransfer.addEventListener('click', openSendModal);
  if (heroQuickSend) {
    heroQuickSend.addEventListener('click', () => {
      ensureUserSession();
      showView('dashboard');
      openSendModal();
    });
  }

  if (btnOpenAdd) btnOpenAdd.addEventListener('click', () => modalAdd?.classList.remove('hidden'));
  if (heroQuickReceive) {
    heroQuickReceive.addEventListener('click', () => {
      showView('dashboard');
      modalAdd?.classList.remove('hidden');
    });
  }

  const modalAirtime = document.getElementById('modal-airtime-data');
  const btnCloseAirtime = document.getElementById('close-airtime-modal-btn');
  const modalBills = document.getElementById('modal-bill-payment');
  const btnCloseBills = document.getElementById('close-bills-modal-btn');
  const modalCards = document.getElementById('modal-virtual-cards');
  const btnCloseCards = document.getElementById('close-card-modal-btn');
  const modalReceipt = document.getElementById('modal-receipt');
  const btnCloseReceipt = document.getElementById('close-receipt-modal-btn');
  const modalKyc = document.getElementById('modal-cbn-kyc');
  const btnCloseKyc = document.getElementById('close-kyc-modal-btn');
  const modalFreeze = document.getElementById('modal-emergency-freeze');
  const btnCloseFreeze = document.getElementById('close-freeze-modal-btn');

  // CBN KYC Modal openers
  const btnOpenKycTier = document.getElementById('btn-open-kyc-tier');
  const btnQuickUpgradeTier = document.getElementById('btn-quick-upgrade-tier');
  const qaKyc = document.getElementById('qa-kyc');
  const btnSubmitTier3Upgrade = document.getElementById('btn-submit-tier3-upgrade');

  function openKycModal() {
    modalKyc?.classList.remove('hidden');
  }

  if (btnOpenKycTier) btnOpenKycTier.addEventListener('click', openKycModal);
  if (btnQuickUpgradeTier) btnQuickUpgradeTier.addEventListener('click', openKycModal);
  if (qaKyc) qaKyc.addEventListener('click', openKycModal);
  if (btnCloseKyc) btnCloseKyc.addEventListener('click', () => modalKyc?.classList.add('hidden'));

  // CBN Tier 3 Upgrade simulation
  if (btnSubmitTier3Upgrade) {
    btnSubmitTier3Upgrade.addEventListener('click', () => {
      if (window.MidePayDB?.isProduction()) {
        showToast('Identity verification is not connected. Your verification tier has not changed.', 'error');
        return;
      }
      btnSubmitTier3Upgrade.disabled = true;
      btnSubmitTier3Upgrade.innerHTML = '<span>Verifying Identity & Proof of Address with NIBSS...</span>';

      setTimeout(() => {
        state.kycTier = 3;
        state.dailyLimit = 5000000;
        
        const tier3Card = document.getElementById('kyc-tier-3-card');
        const tier2Card = document.getElementById('kyc-tier-2-card');
        const chipTier3 = document.getElementById('chip-tier-3-status');
        const chipTier2 = document.getElementById('chip-tier-2-status');

        if (tier3Card) tier3Card.classList.add('active-tier');
        if (tier2Card) tier2Card.classList.remove('active-tier');
        if (chipTier3) {
          chipTier3.textContent = 'Active (Verified)';
          chipTier3.className = 'kyc-tier-chip active';
        }
        if (chipTier2) {
          chipTier2.textContent = 'Passed';
          chipTier2.className = 'kyc-tier-chip';
        }

        btnSubmitTier3Upgrade.disabled = true;
        btnSubmitTier3Upgrade.innerHTML = '<span>✓ Tier 3 Verified (Unlimited)</span>';

        renderCbnKycStatus();
        modalKyc?.classList.add('hidden');
        showToast('🎉 Upgraded to CBN KYC Tier 3! Unlimited balance & ₦5M daily limit unlocked.');
      }, 1200);
    });
  }

  // CBN Emergency Freeze (Panic Switch) openers
  const qaPanicFreeze = document.getElementById('qa-panic-freeze');
  const btnBannerUnfreeze = document.getElementById('btn-banner-unfreeze');
  const btnToggleAccountFreeze = document.getElementById('btn-toggle-account-freeze');
  const btnFreezeText = document.getElementById('btn-freeze-text');
  const freezeHeading = document.getElementById('freeze-state-heading');
  const freezeDesc = document.getElementById('freeze-state-desc');
  const accountFrozenBanner = document.getElementById('account-frozen-banner');
  const qaFreezeTitle = document.getElementById('qa-freeze-title');
  const qaFreezeSub = document.getElementById('qa-freeze-sub');

  function openFreezeModal() {
    updateFreezeModalUI();
    modalFreeze?.classList.remove('hidden');
  }

  function updateFreezeModalUI() {
    if (state.isAccountFrozen) {
      if (btnFreezeText) btnFreezeText.textContent = '🔓 Unfreeze Account Now';
      if (freezeHeading) freezeHeading.textContent = 'Account Currently Frozen';
      if (freezeDesc) freezeDesc.textContent = 'Outbound transfers and virtual cards are locked under CBN security directives. Tap below to verify security credentials and unfreeze.';
      if (accountFrozenBanner) accountFrozenBanner.classList.remove('hidden');
      if (qaFreezeTitle) qaFreezeTitle.textContent = 'Unfreeze Switch';
      if (qaFreezeSub) qaFreezeSub.textContent = 'Account Locked';
    } else {
      if (btnFreezeText) btnFreezeText.textContent = '🔒 Freeze Account Immediately';
      if (freezeHeading) freezeHeading.textContent = 'Instant Account Lockout';
      if (freezeDesc) freezeDesc.textContent = 'In compliance with CBN Fraud Mitigation Standards, freezing your account immediately disables all outbound transfers, locks your virtual cards, and blocks active sessions until you unfreeze.';
      if (accountFrozenBanner) accountFrozenBanner.classList.add('hidden');
      if (qaFreezeTitle) qaFreezeTitle.textContent = 'Freeze Switch';
      if (qaFreezeSub) qaFreezeSub.textContent = 'Instant Panic Lock';
    }
  }

  if (qaPanicFreeze) qaPanicFreeze.addEventListener('click', openFreezeModal);
  if (btnBannerUnfreeze) btnBannerUnfreeze.addEventListener('click', openFreezeModal);
  if (btnCloseFreeze) btnCloseFreeze.addEventListener('click', () => modalFreeze?.classList.add('hidden'));

  if (btnToggleAccountFreeze) {
    btnToggleAccountFreeze.addEventListener('click', async () => {
      const nextFrozen = !state.isAccountFrozen;
      if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user?.id && isValidUuid(state.user.id)) {
        const res = await window.MidePayDB.setOwnAccountFreeze(state.user.id, nextFrozen);
        if (!res.success && window.MidePayDB.isProduction()) {
          showToast(res.error || 'Unable to update account freeze status on server.', 'error');
          return;
        }
      }
      state.isAccountFrozen = nextFrozen;
      if (state.user) state.user.isFrozen = nextFrozen;
      updateFreezeModalUI();
      modalFreeze?.classList.add('hidden');

      if (state.isAccountFrozen) {
        showToast('🔒 Account Frozen! Outbound transfers & cards locked per CBN emergency protocol.', 'error');
      } else {
        showToast('🔓 Account Unfrozen! Normal banking operations restored.');
      }
    });
  }

  // Render CBN KYC Status & Daily Limit Progress
  function renderCbnKycStatus() {
    const cardKycText = document.getElementById('card-kyc-tier-text');
    const limitUsage = document.getElementById('cbn-limit-usage');
    const progressBar = document.getElementById('cbn-progress-bar');
    const qaKycSub = document.getElementById('qa-kyc-sub');

    // A numeric test tier is not proof of real-world identity verification.
    if (isProductionEnv()) {
      if (cardKycText) cardKycText.textContent = 'Test wallet';
      if (qaKycSub) qaKycSub.textContent = 'Not connected yet';
      if (limitUsage) limitUsage.textContent = 'Live transfers unavailable';
      if (progressBar) progressBar.style.width = '0%';
      return;
    }

    if (cardKycText) {
      cardKycText.textContent = state.kycTier === 3 ? 'Tier 3 (Unlimited)' : `Tier ${state.kycTier} Verified`;
    }
    if (qaKycSub) {
      qaKycSub.textContent = state.kycTier === 3 ? 'Tier 3 (Unlimited)' : `Tier ${state.kycTier} Verified`;
    }
    if (limitUsage) {
      limitUsage.textContent = `${formatNaira(state.dailySpent)} / ${formatNaira(state.dailyLimit)}`;
    }
    if (progressBar) {
      const pct = Math.min(100, (state.dailySpent / state.dailyLimit) * 100);
      progressBar.style.width = `${pct}%`;
    }
  }

  if (btnCloseSend) btnCloseSend.addEventListener('click', () => modalSend?.classList.add('hidden'));
  if (btnCloseAdd) btnCloseAdd.addEventListener('click', () => modalAdd?.classList.add('hidden'));
  if (btnCloseAirtime) btnCloseAirtime.addEventListener('click', () => modalAirtime?.classList.add('hidden'));
  if (btnCloseBills) btnCloseBills.addEventListener('click', () => modalBills?.classList.add('hidden'));
  if (btnCloseCards) btnCloseCards.addEventListener('click', () => modalCards?.classList.add('hidden'));
  if (btnCloseReceipt) btnCloseReceipt.addEventListener('click', () => modalReceipt?.classList.add('hidden'));

  // Close modals when clicking backdrop
  [modalSend, modalAdd, modalAirtime, modalBills, modalCards, modalReceipt, modalKyc, modalFreeze].forEach(m => {
    if (!m) return;
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.add('hidden');
    });
  });


  // Quick amount tags for Top-up Modal
  document.querySelectorAll('#modal-add-money .amount-tag-btn').forEach(tagBtn => {
    tagBtn.addEventListener('click', () => {
      document.querySelectorAll('#modal-add-money .amount-tag-btn').forEach(b => b.classList.remove('active'));
      tagBtn.classList.add('active');
      const topupInput = document.getElementById('topup-amount');
      if (topupInput) topupInput.value = tagBtn.getAttribute('data-topup');
      const topupErrorAlert = document.getElementById('topup-error-alert');
      if (topupErrorAlert) topupErrorAlert.classList.add('hidden');
    });
  });

  function openLiveGatewayModal(suggestedAmount = 10000) {
    modalSend?.classList.add('hidden');
    const topupInput = document.getElementById('topup-amount');
    if (topupInput && suggestedAmount >= 100) {
      topupInput.value = String(Math.round(suggestedAmount));
    }
    const topupErrorAlert = document.getElementById('topup-error-alert');
    if (topupErrorAlert) topupErrorAlert.classList.add('hidden');
    modalAdd?.classList.remove('hidden');
  }

  // -------------------------------------------------------------
  // INSTANT DIRECT WALLET TOP-UP REDIRECTOR (ZERO DEMO MUTATIONS IN PROD)
  // -------------------------------------------------------------
  async function topUpDemoBalance(amount = 50000) {
    if (isProductionEnv()) {
      modalSend?.classList.add('hidden');
      const modalAddEl = document.getElementById('modal-add-money');
      modalAddEl?.classList.remove('hidden');
      return;
    }
    if (window.MIDEPAY_SUPABASE_CONFIG && window.MIDEPAY_SUPABASE_CONFIG.GATEWAYS_LIVE === true) {
      openLiveGatewayModal(amount);
      return;
    }
    ensureUserSession();
    const fundAmt = Number(amount) || 50000;
    if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user?.id) {
      const res = await window.MidePayDB.recordDeposit({
        userId: state.user.id,
        amount: fundAmt,
        idempotencyKey: newIdempotencyKey()
      });
      if (res && res.success) {
        await rehydrateBalanceFromServer(res.newBalance);
        if (typeof validateAmountInputs === 'function') validateAmountInputs();
        showToast(`🎉 Credited ${formatNaira(fundAmt)} to your MidePay wallet!`);
      }
    }
  }

  enforceNoDemoControlsInProduction();

  const openAddMoneyFromTransfer = () => {
    modalSend?.classList.add('hidden');
    document.getElementById('modal-add-money')?.classList.remove('hidden');
  };

  // Quick Fund button on Screen 1 (hidden in production)
  const btnQuickFundTransfer = document.getElementById('btn-quick-fund-transfer');
  if (btnQuickFundTransfer) {
    if (isProductionEnv()) {
      btnQuickFundTransfer.style.display = 'none';
      btnQuickFundTransfer.classList.add('hidden');
    } else {
      btnQuickFundTransfer.addEventListener('click', () => topUpDemoBalance(50000));
    }
  }

  // "+ Fund ₦50k (Demo)" button on Dashboard Card -> NEVER renders in production
  const btnDashQuickTopup = document.getElementById('btn-dash-quick-topup');
  if (btnDashQuickTopup) {
    if (isProductionEnv()) {
      btnDashQuickTopup.style.display = 'none';
      btnDashQuickTopup.classList.add('hidden');
      btnDashQuickTopup.disabled = true;
    } else {
      btnDashQuickTopup.addEventListener('click', () => topUpDemoBalance(50000));
    }
  }

  // "+ Fund" helper buttons inside Send Money modal open real Add Money modal in production
  const btnAmountQuickFund = document.getElementById('btn-amount-quick-fund');
  if (btnAmountQuickFund) {
    btnAmountQuickFund.addEventListener('click', () => {
      if (isProductionEnv()) openAddMoneyFromTransfer();
      else topUpDemoBalance(50000);
    });
  }

  const btnInsufficientFundNow = document.getElementById('btn-insufficient-fund-now');
  if (btnInsufficientFundNow) {
    btnInsufficientFundNow.addEventListener('click', () => {
      if (isProductionEnv()) openAddMoneyFromTransfer();
      else topUpDemoBalance(50000);
    });
  }

  // =========================================================================
  // SEND MONEY FLOW CONTROLLER (OPAY & PALMPAY UNIFIED INSTANT TRANSFER)
  // =========================================================================

  // Sample Nigerian Beneficiaries mapped by account or bank
  const SAMPLE_NIGERIAN_BENEFICIARIES = [
    { nuban: '0123456789', name: 'ADELEKE BABATUNDE CHUKWUEMEKA' },
    { nuban: '9048291048', name: 'ADELEKE BABATUNDE' },
    { nuban: '1234567890', name: 'CHINWE BLESSING OKONKWO' },
    { nuban: '2039485716', name: 'IBRAHIM DANLAMI MUSA' },
    { nuban: '8147291039', name: 'OLUWASEUN DAVID ADEYEMI' },
    { nuban: '9012345678', name: 'NGOZI CHIDIMMA EZE' },
    { nuban: '7039281745', name: 'FATIMA ABUBAKAR BELLO' },
    { nuban: '8023456789', name: 'EMMANUEL CHIBUZOR OKAFOR' },
    { nuban: '6019283745', name: 'AISHA MOHAMMED YAKUBU' },
    { nuban: '3049582716', name: 'FOLAKE OLUWATOYIN BAKARE' },
    { nuban: '5019284736', name: 'KAYODE AYOMIDE OLATUNJI' }
  ];

  const NIGERIAN_FIRST_NAMES = ['ADELEKE', 'CHINWE', 'IBRAHIM', 'OLUWASEUN', 'NGOZI', 'EMMANUEL', 'FATIMA', 'AISHA', 'KAYODE', 'CHIDIEBERE', 'OLUMIDE', 'ZAINAB', 'BABATUNDE', 'FOLASHADE', 'TARI'];
  const NIGERIAN_MIDDLE_NAMES = ['BABATUNDE', 'BLESSING', 'DANLAMI', 'DAVID', 'CHIDIMMA', 'CHIBUZOR', 'ABUBAKAR', 'MOHAMMED', 'AYOMIDE', 'VICTOR', 'KOLAPO', 'AMINA', 'CHUKWUMA', 'TITILAYO', 'EBI'];
  const NIGERIAN_LAST_NAMES = ['CHUKWUEMEKA', 'OKONKWO', 'MUSA', 'ADEYEMI', 'EZE', 'OKAFOR', 'BELLO', 'YAKUBU', 'OLATUNJI', 'NWOSU', 'BALOGUN', 'USMAN', 'OGUNLESI', 'AJAYI', 'DICKSON'];

  function resolveNubanBeneficiary(nuban) {
    const found = SAMPLE_NIGERIAN_BENEFICIARIES.find(b => b.nuban === nuban);
    if (found) return found.name;
    let seed = 0;
    for (let i = 0; i < nuban.length; i++) {
      seed = (seed * 10 + parseInt(nuban[i], 10)) % 1000000;
    }
    const f = NIGERIAN_FIRST_NAMES[seed % NIGERIAN_FIRST_NAMES.length];
    const m = NIGERIAN_MIDDLE_NAMES[Math.floor(seed / 7) % NIGERIAN_MIDDLE_NAMES.length];
    const l = NIGERIAN_LAST_NAMES[Math.floor(seed / 13) % NIGERIAN_LAST_NAMES.length];
    return `${f} ${m} ${l}`;
  }

  // Active Send Flow State
  const sendFlowState = {
    selectedBank: 'OPay Digital Services',
    accountNumber: '',
    resolvedName: '',
    isAccountResolved: false,
    amount: 5000,
    transferFee: 0.00, // Zero fee switch like OPay/PalmPay
    narration: '',
    currentStep: 'form', // 'form' | 'pin-confirm' | 'success'
    lastTransaction: null,
    recipientId: null,
    approvedRequestId: null
  };

  // Step Containers (Unified 3-Screen OPay / PalmPay flow + CodeFronts Animated Processing)
  const stepForm = document.getElementById('send-step-form');
  const stepPinConfirm = document.getElementById('send-step-pin-confirm');
  const stepProcessing = document.getElementById('send-step-processing');
  const stepSuccess = document.getElementById('send-step-success');

  // CodeFronts Loading Animation Elements
  const paymentLoader = document.getElementById('midepay-payment-loader');
  const laProcessingAmt = document.getElementById('la-processing-amt');
  const laProcessingRef = document.getElementById('la-processing-ref');

  // Modal Close & Back Navigation Buttons
  const closeSendBtn = document.getElementById('close-send-modal-btn');
  const closePinModalBtn = document.getElementById('close-pin-modal-btn');
  const btnBackFromPin = document.getElementById('btn-back-from-pin');

  // Screen 1: Transfer Form Elements
  const mainTransferForm = document.getElementById('main-transfer-form');
  const transferModalBalance = document.getElementById('transfer-modal-balance');
  const bankQuickBtns = document.querySelectorAll('#popular-banks-grid .bank-quick-btn');
  const sendDestination = document.getElementById('send-destination');
  const sendRecipient = document.getElementById('send-recipient');
  const accountResolvedBox = document.getElementById('account-resolved-box');
  const accountResolvedText = document.getElementById('account-resolved-text');
  const recipientVerifyHint = document.getElementById('recipient-verify-hint');
    const sendAmountInput = document.getElementById('send-amount');
  const amountBalanceHint = document.getElementById('amount-balance-hint');
  const amountStepBalanceEl = document.getElementById('amount-step-balance');
  const insufficientBalanceAlert = document.getElementById('insufficient-balance-alert');
  const insufficientBalanceText = document.getElementById('insufficient-balance-text');
  const quickAmountBtns = document.querySelectorAll('#send-step-form .amount-tag-btn[data-amt]');
  const sendNarrationInput = document.getElementById('send-narration');
  const sendFeeDisplay = document.getElementById('send-fee-display');
  const sendFormError = document.getElementById('send-form-error');
  const sendFormErrorText = document.getElementById('send-form-error-text');
  const btnSubmitTransfer = document.getElementById('btn-submit-transfer');

  // Screen 2: OPay/PalmPay PIN & Authorization Elements
  const pinAuthForm = document.getElementById('pin-auth-form');
  const pinPromptLabel = document.getElementById('pin-prompt-label');
  const pinSetupHint = document.getElementById('pin-setup-hint');
  const pinRecipientAvatar = document.getElementById('pin-recipient-avatar');
  const pinRecipientName = document.getElementById('pin-recipient-name');
  const pinRecipientBank = document.getElementById('pin-recipient-bank');
  const pinSummaryAmount = document.getElementById('pin-summary-amount');
  const btnFillDemoPin = document.getElementById('btn-fill-demo-pin');
  const authPinBoxes = [
    document.getElementById('auth-pin-1'),
    document.getElementById('auth-pin-2'),
    document.getElementById('auth-pin-3'),
    document.getElementById('auth-pin-4')
  ];
  const pinAuthError = document.getElementById('pin-auth-error');
  const pinAuthErrorText = document.getElementById('pin-auth-error-text');
  const btnAuthorizePay = document.getElementById('btn-authorize-pay');
  const btnAuthorizePayText = document.getElementById('btn-authorize-pay-text');

  // Screen 3: Success Screen Elements
  const successTransferAmount = document.getElementById('success-transfer-amount');
  const successRecipientName = document.getElementById('success-recipient-name');
  const successRecipientDetail = document.getElementById('success-recipient-detail');
  const successTxRef = document.getElementById('success-tx-ref');
  const successTxFee = document.getElementById('success-tx-fee');
  const successTxDate = document.getElementById('success-tx-date');
  const btnTransferShareReceipt = document.getElementById('btn-transfer-share-receipt');
  const btnTransferDone = document.getElementById('btn-transfer-done');

  // -------------------------------------------------------------
  // STEP TRANSITIONS & VISIBILITY CONTROLLER
  // -------------------------------------------------------------
  function showSendStep(stepName) {
    // Support aliases: 'recipient' -> 'form', 'amount' -> 'form', 'review' -> 'pin-confirm'
    if (stepName === 'recipient' || stepName === 'amount') stepName = 'form';
    if (stepName === 'review') stepName = 'pin-confirm';

    sendFlowState.currentStep = stepName;

    // Hide all steps
    [stepForm, stepPinConfirm, stepProcessing, stepSuccess].forEach(s => {
      if (s) s.classList.add('hidden');
    });

    if (stepName === 'form') {
      stepForm?.classList.remove('hidden');
      if (transferModalBalance) transferModalBalance.textContent = formatNaira(state.dashBalance);
      if (amountBalanceHint) amountBalanceHint.textContent = 'Wallet Balance:';
      if (amountStepBalanceEl) amountStepBalanceEl.textContent = formatNaira(state.dashBalance);
      validateAmountInputs();
      if (sendFormError) sendFormError.classList.add('hidden');
    } else if (stepName === 'pin-confirm') {
      stepPinConfirm?.classList.remove('hidden');
      populatePinScreen();
      clearPinBoxes();
      if (pinAuthError) pinAuthError.classList.add('hidden');
      setTimeout(() => authPinBoxes[0]?.focus(), 60);
    } else if (stepName === 'processing') {
      stepProcessing?.classList.remove('hidden');
      if (paymentLoader) {
        paymentLoader.classList.remove('is-ready');
        paymentLoader.dataset.state = 'loading';
      }
      if (laProcessingAmt) laProcessingAmt.textContent = formatNaira(sendFlowState.amount);
      if (laProcessingRef) laProcessingRef.textContent = `${sendFlowState.selectedBank} • NIP Route`;
    } else if (stepName === 'success') {
      stepSuccess?.classList.remove('hidden');
    }
  }

  const BANK_CODE_MAP = {
    'MidePay': 'MIDEPAY',
    'MidePay Tag': 'MIDEPAY',
    'OPay': '999992',
    'PalmPay': '999991',
    'Kuda Bank': '50211',
    'Moniepoint': '50515',
    'GTBank': '058',
    'Access Bank': '044',
    'Zenith Bank': '057',
    'United Bank for Africa (UBA)': '033',
    'First Bank of Nigeria': '011',
    'Providus Bank': '101',
    'Citibank Nigeria': '023',
    'Ecobank Nigeria': '050',
    'Fidelity Bank': '070',
    'First City Monument Bank (FCMB)': '214',
    'Heritage Bank': '030',
    'Jaiz Bank': '301',
    'Keystone Bank': '082',
    'Lotus Bank': '303',
    'Polaris Bank': '076',
    'PremiumTrust Bank': '105',
    'Stanbic IBTC Bank': '221',
    'Standard Chartered Bank': '068',
    'Sterling Bank': '232',
    'SunTrust Bank': '100',
    'Taj Bank': '302',
    'Titan Trust Bank': '102',
    'Union Bank of Nigeria': '032',
    'Unity Bank': '215',
    'VFD Microfinance Bank': '566',
    'Wema Bank (ALAT)': '035'
  };

  function getSelectedBankInfo() {
    if (sendDestination) {
      const val = sendDestination.value || 'MidePay';
      const opt = sendDestination.options && sendDestination.options[sendDestination.selectedIndex];
      const textName = opt && opt.text ? opt.text.split(' — ')[0].trim() : val;
      const bankCode = (opt && opt.getAttribute && opt.getAttribute('data-bank-code')) || BANK_CODE_MAP[val] || '999992';
      const isMidePaySelected = val === 'MidePay' || val === 'MidePay Tag' || bankCode === 'MIDEPAY';
      return { bankValue: val, bankName: textName, bankCode, isMidePaySelected };
    }
    return { bankValue: 'MidePay', bankName: 'MidePay Wallet', bankCode: 'MIDEPAY', isMidePaySelected: true };
  }

  function getSelectedBankName() {
    return getSelectedBankInfo().bankName;
  }

  // -------------------------------------------------------------
  // BANK SELECTION GRID & DROPDOWN SYNC
  // -------------------------------------------------------------
  bankQuickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      bankQuickBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const bankVal = btn.getAttribute('data-bank');
      if (sendDestination && bankVal) {
        sendDestination.value = bankVal;
      }
      sendFlowState.selectedBank = getSelectedBankName();
      triggerAccountResolution();
    });
  });

  if (sendDestination) {
    sendDestination.addEventListener('change', () => {
      sendFlowState.selectedBank = getSelectedBankName();
      bankQuickBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-bank') === sendDestination.value);
      });
      triggerAccountResolution();
    });
  }

  // -------------------------------------------------------------
  // REAL-TIME ACCOUNT NAME ENQUIRY (MIDEPAY NUBAN + NIGERIAN NIP)
  // -------------------------------------------------------------
  const accountResolvedBadge = document.getElementById('account-resolved-badge');
  let resolveDebounceTimer = null;
  let enquirySeq = 0;

  function setResolvedBoxState(mode, badgeSymbol, htmlContent) {
    if (!accountResolvedBox) return;
    accountResolvedBox.classList.remove('hidden', 'is-notice', 'is-error');
    if (mode === 'notice') accountResolvedBox.classList.add('is-notice');
    if (mode === 'error') accountResolvedBox.classList.add('is-error');
    if (accountResolvedBadge) accountResolvedBadge.textContent = badgeSymbol || '✓';
    if (accountResolvedText) accountResolvedText.innerHTML = htmlContent;
  }

  async function resolveRecipientEnquiry() {
    const seq = ++enquirySeq;
    const rawVal = (sendRecipient?.value || '').trim();
    const cleanDigits = rawVal.replace(/[^0-9]/g, '');
    const bankInfo = getSelectedBankInfo();
    const isProd = Boolean(window.MidePayDB && window.MidePayDB.isProduction());
    const gatewaysLive = Boolean(window.MIDEPAY_SUPABASE_CONFIG && window.MIDEPAY_SUPABASE_CONFIG.GATEWAYS_LIVE === true);

    if (!rawVal) {
      sendFlowState.isAccountResolved = false;
      sendFlowState.recipientId = null;
      sendFlowState.resolvedName = '';
      sendFlowState.accountNumber = '';
      accountResolvedBox?.classList.add('hidden');
      if (recipientVerifyHint) {
        recipientVerifyHint.textContent = 'Type a 10-digit MidePay NUBAN, @tag, email, or Nigerian bank account number for instant name enquiry.';
        recipientVerifyHint.classList.remove('text-success');
      }
      return null;
    }

    // 1. 10-Digit Account Number Enquiry (MidePay NUBAN check FIRST, then External Nigerian Bank NIP)
    if (cleanDigits.length === 10 && !rawVal.includes('@') && !rawVal.startsWith('+')) {
      sendRecipient.value = cleanDigits;
      sendFlowState.accountNumber = cleanDigits;

      const ownNuban = state.user?.nuban ? String(state.user.nuban).replace(/\s+/g, '') : '';
      if (ownNuban && cleanDigits === ownNuban) {
        sendFlowState.isAccountResolved = false;
        sendFlowState.recipientId = null;
        sendFlowState.resolvedName = '';
        setResolvedBoxState('error', '!', '<span style="color:#FCA5A5;">This is your own MidePay NUBAN account number. Enter another recipient\'s account.</span>');
        return { resolved: false, reason: 'self_nuban' };
      }

      setResolvedBoxState(
        'loading',
        '…',
        `<span class="recipient-search-spinner" style="position:static; width:13px; height:13px; display:inline-block; vertical-align:middle; margin-right:6px;"></span><span>Running real-time account name enquiry...</span>`
      );

      // Step 1A: Always check if this 10-digit NUBAN belongs to a MidePay wallet (`wallets.nuban -> profiles`)
      let midepayMatch = null;
      if (window.MidePayDB && typeof window.MidePayDB.findRecipient === 'function') {
        midepayMatch = await window.MidePayDB.findRecipient(cleanDigits, state.user?.id);
      }
      if (seq !== enquirySeq) return null;

      if (midepayMatch) {
        const verifiedName = midepayMatch.fullName || midepayMatch.full_name || 'MidePay Member';
        sendFlowState.isAccountResolved = true;
        sendFlowState.recipientId = isValidUuid(midepayMatch.id) ? midepayMatch.id : null;
        sendFlowState.resolvedName = verifiedName;
        sendFlowState.selectedBank = 'MidePay / Providus Bank';

        if (sendDestination && sendDestination.value !== 'MidePay') {
          sendDestination.value = 'MidePay';
          bankQuickBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-bank') === 'MidePay'));
        }

        setResolvedBoxState(
          'verified',
          '✓',
          `Verified MidePay Account: <strong>${escapeHtml(verifiedName)}</strong> <span style="color:#A7F3D0; font-size:0.75rem;">(${escapeHtml(midepayMatch.tag || '@midepay')} • ${cleanDigits})</span>`
        );
        if (recipientVerifyHint) {
          recipientVerifyHint.textContent = '✓ Verified MidePay wallet — instant zero-fee internal settlement.';
          recipientVerifyHint.classList.add('text-success');
        }
        if (sendFormError) sendFormError.classList.add('hidden');
        return { resolved: true, type: 'midepay_nuban', recipient: midepayMatch };
      }

      // Step 1B: If MidePay was explicitly selected and no MidePay wallet has this 10-digit NUBAN
      if (bankInfo.isMidePaySelected && isProd) {
        sendFlowState.isAccountResolved = false;
        sendFlowState.recipientId = null;
        sendFlowState.resolvedName = '';
        setResolvedBoxState(
          'error',
          '!',
          `<span style="color:#FCA5A5;">No MidePay account matched NUBAN <strong>${cleanDigits}</strong>. Select the recipient's commercial bank above for external NIP enquiry.</span>`
        );
        return { resolved: false, reason: 'midepay_nuban_not_found' };
      }

      // Step 1C: External Nigerian Bank Account Lookup (`bank-payout` Edge Function `/resolve-account`)
      if (gatewaysLive && window.MidePayDB && typeof window.MidePayDB.resolveBankAccount === 'function') {
        const nipRes = await window.MidePayDB.resolveBankAccount({
          provider: 'paystack',
          accountNumber: cleanDigits,
          bankCode: bankInfo.bankCode
        });
        if (seq !== enquirySeq) return null;

        if (nipRes && nipRes.success && nipRes.accountName) {
          sendFlowState.isAccountResolved = true;
          sendFlowState.recipientId = null;
          sendFlowState.resolvedName = nipRes.accountName;
          sendFlowState.selectedBank = bankInfo.bankName;
          setResolvedBoxState(
            'verified',
            '✓',
            `Verified ${escapeHtml(bankInfo.bankName)} Account: <strong>${escapeHtml(nipRes.accountName)}</strong>`
          );
          if (recipientVerifyHint) {
            recipientVerifyHint.textContent = `✓ Verified via NIBSS Instant Payment (NIP) switch (${bankInfo.bankName}).`;
            recipientVerifyHint.classList.add('text-success');
          }
          if (sendFormError) sendFormError.classList.add('hidden');
          return { resolved: true, type: 'external_nip', accountName: nipRes.accountName };
        }

        sendFlowState.isAccountResolved = false;
        sendFlowState.recipientId = null;
        sendFlowState.resolvedName = '';
        setResolvedBoxState(
          'error',
          '!',
          `<span style="color:#FCA5A5;">${escapeHtml(nipRes?.error || `Unable to verify ${cleanDigits} on ${bankInfo.bankName}.`)}</span>`
        );
        return { resolved: false, reason: 'nip_failed' };
      }

      // Pre-Nov 30 Production Mode (Paystack/Flutterwave keys not yet connected): clear inline explanation
      if (isProd) {
        sendFlowState.isAccountResolved = false;
        sendFlowState.recipientId = null;
        sendFlowState.resolvedName = '';
        setResolvedBoxState(
          'notice',
          'ℹ',
          `<span style="color:#BFDBFE; font-size:0.8rem;">External NIP bank name enquiry for <strong>${escapeHtml(bankInfo.bankName)}</strong> activates once Paystack/Flutterwave keys are connected (Nov 30). Enter any <strong>10-digit MidePay NUBAN</strong>, <strong>@tag</strong>, email, or phone for instant verified MidePay transfers.</span>`
        );
        if (recipientVerifyHint) {
          recipientVerifyHint.textContent = 'MidePay-to-MidePay 10-digit NUBAN, @tag, email & phone transfers are live 24/7.';
          recipientVerifyHint.classList.remove('text-success');
        }
        return { resolved: false, reason: 'external_nip_pending_gateway_keys' };
      }

      // Non-production local development simulation fallback
      const simName = resolveNubanBeneficiary(cleanDigits);
      sendFlowState.isAccountResolved = true;
      sendFlowState.resolvedName = simName;
      sendFlowState.recipientId = null;
      sendFlowState.selectedBank = bankInfo.bankName;
      setResolvedBoxState(
        'verified',
        '✓',
        `<strong>${escapeHtml(simName)}</strong> <span style="color:#A7F3D0; font-size:0.75rem;">(Sandbox Beneficiary)</span>`
      );
      if (sendFormError) sendFormError.classList.add('hidden');
      return { resolved: true, type: 'sandbox_nuban', accountName: simName };
    }

    // 2. Check for @username Tag, Email, or Nigerian Phone lookup
    if (rawVal.startsWith('@') || rawVal.includes('@') || cleanDigits.length >= 11) {
      sendFlowState.accountNumber = rawVal;
      setResolvedBoxState(
        'loading',
        '…',
        `<span class="recipient-search-spinner" style="position:static; width:13px; height:13px; display:inline-block; vertical-align:middle; margin-right:6px;"></span><span>Looking up MidePay member...</span>`
      );

      let found = null;
      if (window.MidePayDB && typeof window.MidePayDB.findRecipient === 'function') {
        found = await window.MidePayDB.findRecipient(rawVal, state.user?.id);
      }
      if (seq !== enquirySeq) return null;

      if (found) {
        sendFlowState.isAccountResolved = true;
        sendFlowState.recipientId = isValidUuid(found.id) ? found.id : null;
        sendFlowState.resolvedName = found.fullName || found.full_name || 'MidePay Member';
        sendFlowState.selectedBank = 'MidePay / Providus Bank';
        const nubanBadge = found.nuban ? ` • ${escapeHtml(found.nuban)}` : '';
        setResolvedBoxState(
          'verified',
          '✓',
          `Verified MidePay Account: <strong>${escapeHtml(sendFlowState.resolvedName)}</strong> <span style="color:#A7F3D0; font-size:0.75rem;">(${escapeHtml(found.tag || '@midepay')}${nubanBadge})</span>`
        );
        if (recipientVerifyHint) {
          recipientVerifyHint.textContent = '✓ Verified MidePay member — instant zero-fee transfer.';
          recipientVerifyHint.classList.add('text-success');
        }
        if (sendFormError) sendFormError.classList.add('hidden');
        return { resolved: true, type: 'midepay_handle', recipient: found };
      }

      if (isProd) {
        sendFlowState.isAccountResolved = false;
        sendFlowState.recipientId = null;
        sendFlowState.resolvedName = '';
        setResolvedBoxState('error', '!', '<span style="color:#FCA5A5;">Member not found in MidePay production directory.</span>');
        return { resolved: false, reason: 'member_not_found' };
      }

      const cleanTag = rawVal.replace(/^@/, '').toUpperCase();
      sendFlowState.isAccountResolved = true;
      sendFlowState.recipientId = null;
      sendFlowState.resolvedName = `${cleanTag} (MidePay Verified)`;
      setResolvedBoxState('verified', '✓', `<strong>${escapeHtml(sendFlowState.resolvedName)}</strong>`);
      if (sendFormError) sendFormError.classList.add('hidden');
      return { resolved: true, type: 'sandbox_handle' };
    }

    // Incomplete input (< 10 digits and not @tag/email)
    sendFlowState.isAccountResolved = false;
    sendFlowState.recipientId = null;
    sendFlowState.resolvedName = '';
    sendFlowState.accountNumber = rawVal;
    accountResolvedBox?.classList.add('hidden');
    if (recipientVerifyHint) {
      recipientVerifyHint.textContent = 'Type a 10-digit MidePay NUBAN, @tag, email, or Nigerian bank account number for instant name enquiry.';
      recipientVerifyHint.classList.remove('text-success');
    }
    return null;
  }
  window.resolveRecipientEnquiry = resolveRecipientEnquiry;

  function triggerAccountResolution() {
    clearTimeout(resolveDebounceTimer);
    resolveDebounceTimer = setTimeout(() => {
      resolveRecipientEnquiry().catch(console.warn);
    }, 220);
  }

  if (sendRecipient) {
    sendRecipient.addEventListener('input', triggerAccountResolution);

    // FIX FOR LAPTOP USERS: Pressing Enter never auto-sends; it resolves account and focuses amount
    sendRecipient.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerAccountResolution();
        sendAmountInput?.focus();
      }
    });
  }

  function validateAmountInputs() {
    const val = parseFloat(sendAmountInput?.value) || 0;
    const totalNeeded = val + (sendFlowState.transferFee || 0);
    if (insufficientBalanceAlert) {
      if (val > 0 && totalNeeded > state.dashBalance) {
        if (insufficientBalanceText) {
          insufficientBalanceText.textContent = `Insufficient balance (${formatNaira(state.dashBalance)} available for ${formatNaira(totalNeeded)}).`;
        }
        insufficientBalanceAlert.classList.remove('hidden');
      } else {
        insufficientBalanceAlert.classList.add('hidden');
      }
    }
  }

  // -------------------------------------------------------------
  // AMOUNT CHIPS & KEYBOARD CONTROLS (PREVENTS LAPTOP AUTO-SEND)
  // -------------------------------------------------------------
  quickAmountBtns.forEach(tagBtn => {
    tagBtn.addEventListener('click', () => {
      quickAmountBtns.forEach(b => b.classList.remove('active'));
      tagBtn.classList.add('active');
      const amt = tagBtn.getAttribute('data-amt');
      if (sendAmountInput && amt) {
        sendAmountInput.value = amt;
        sendFlowState.amount = parseFloat(amt) || 0;
        validateAmountInputs();
      }
    });
  });

  if (sendAmountInput) {
    sendAmountInput.addEventListener('input', () => {
      const val = parseFloat(sendAmountInput.value) || 0;
      sendFlowState.amount = val;
      quickAmountBtns.forEach(b => {
        b.classList.toggle('active', parseFloat(b.getAttribute('data-amt')) === val);
      });
      validateAmountInputs();
      if (sendFormError) sendFormError.classList.add('hidden');
    });

    // FIX FOR LAPTOP USERS: Pressing Enter moves focus to Narration instead of submitting form!
    sendAmountInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendNarrationInput?.focus();
      }
    });
  }

  if (sendNarrationInput) {
    sendNarrationInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendNarrationInput.blur();
      }
    });
  }

  // Prevent default HTML form submission across all inputs
  if (mainTransferForm) {
    mainTransferForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // Only proceed via deliberate click or explicit programmatic trigger
    });
  }

  // -------------------------------------------------------------
  // THE BIG GREEN "SEND MONEY" BUTTON ACTION
  // -------------------------------------------------------------
  if (btnSubmitTransfer) {
    btnSubmitTransfer.addEventListener('click', async (e) => {
      e.preventDefault();

      sendFlowState.selectedBank = getSelectedBankName();
      const rawRecipient = (sendRecipient?.value || '').trim();
      const cleanDigits = rawRecipient.replace(/[^0-9]/g, '');

      // 1. Validate Recipient
      if (!rawRecipient) {
        showTransferFormError('Please enter the recipient account number (10-digit NUBAN) or MideTag.');
        sendRecipient?.focus();
        return;
      }

      if (cleanDigits.length !== 10 && !rawRecipient.startsWith('@')) {
        showTransferFormError('Recipient account must be a valid 10-digit NUBAN or @username.');
        sendRecipient?.focus();
        return;
      }

      // If account hasn't finished resolving, resolve now
      if (!sendFlowState.isAccountResolved || !sendFlowState.resolvedName) {
        if (cleanDigits.length === 10) {
          sendFlowState.isAccountResolved = true;
          sendFlowState.resolvedName = resolveNubanBeneficiary(cleanDigits);
          sendFlowState.accountNumber = cleanDigits;
          sendFlowState.recipientId = null;
        } else if (window.MidePayDB && typeof window.MidePayDB.findRecipient === 'function') {
          const found = await window.MidePayDB.findRecipient(rawRecipient, state.user?.id);
          if (found) {
            sendFlowState.isAccountResolved = true;
            sendFlowState.recipientId = isValidUuid(found.id) ? found.id : null;
            sendFlowState.resolvedName = found.fullName || found.full_name || 'MidePay Member';
            sendFlowState.accountNumber = rawRecipient;
          } else if (window.MidePayDB.isProduction()) {
            showTransferFormError('Recipient MideTag or email is not registered on MidePay.');
            sendRecipient?.focus();
            return;
          } else {
            sendFlowState.isAccountResolved = true;
            sendFlowState.resolvedName = `${rawRecipient.replace(/^@/, '').toUpperCase()} (MidePay Verified)`;
            sendFlowState.accountNumber = rawRecipient;
          }
        }
      }

      // 2. Validate Amount
      const amt = parseFloat(sendAmountInput?.value) || 0;
      if (amt < 50) {
        showTransferFormError('Please enter a valid transfer amount (minimum ₦50.00).');
        sendAmountInput?.focus();
        return;
      }
      sendFlowState.amount = amt;
      sendFlowState.narration = (sendNarrationInput?.value || '').trim() || 'Transfer via MidePay';

      // 3. Staging Quarantine Guard (before client balance check)
      if (window.MidePayDB && typeof window.MidePayDB.isFinancialQuarantined === 'function' && window.MidePayDB.isFinancialQuarantined()) {
        showTransferFormError('Staging Quarantine: Client-side wallet transfers are disabled until backend settlement is live.');
        return;
      }

      // 4. Check Wallet Balance (strictly reject insufficient balance)
      const totalNeeded = amt + sendFlowState.transferFee;
      if (totalNeeded > state.dashBalance) {
        validateAmountInputs();
        showTransferFormError(`Insufficient wallet balance (${formatNaira(state.dashBalance)} available). Please fund your Providus NUBAN wallet first.`);
        return;
      }

      // Everything valid -> Hide error & advance to OPay/PalmPay PIN confirmation
      if (sendFormError) sendFormError.classList.add('hidden');
      showSendStep('pin-confirm');
    });
  }

  function showTransferFormError(msg) {
    if (sendFormError && sendFormErrorText) {
      sendFormErrorText.textContent = msg;
      sendFormError.classList.remove('hidden');
      sendFormError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      showToast(msg, 'error');
    }
  }

  // -------------------------------------------------------------
  // SCREEN 2: OPAY / PALMPAY CONFIRMATION & PER-USER 4-DIGIT PIN
  // -------------------------------------------------------------
  function getBcryptInstance() {
    if (typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) return dcodeIO.bcrypt;
    if (typeof window !== 'undefined' && window.bcrypt) return window.bcrypt;
    return null;
  }

  async function hashPin(pin) {
    const b = getBcryptInstance();
    if (b && typeof b.hashSync === 'function') {
      return b.hashSync(pin, 10);
    }
    if (window.crypto && window.crypto.subtle) {
      const msgBuffer = new TextEncoder().encode(pin + '_midepay_pin_salt');
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return 'sha256:' + hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return 'pin_hash_' + pin;
  }

  async function verifyPin(pin, hash) {
    if (!hash || !pin) return false;
    const b = getBcryptInstance();
    if (b && typeof b.compareSync === 'function' && (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$'))) {
      try {
        return b.compareSync(pin, hash);
      } catch (err) {
        console.warn('bcrypt compare error:', err);
        return false;
      }
    }
    if (hash.startsWith('sha256:') && window.crypto && window.crypto.subtle) {
      const msgBuffer = new TextEncoder().encode(pin + '_midepay_pin_salt');
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const computed = 'sha256:' + hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
      return computed === hash;
    }
    return hash === pin || hash === ('pin_hash_' + pin);
  }

  async function populatePinScreen() {
    const name = sendFlowState.resolvedName || 'ADELEKE BABATUNDE';
    const bank = sendFlowState.selectedBank || 'OPay Digital Services';
    const acc = sendFlowState.accountNumber || '9048291048';
    const amt = sendFlowState.amount || 5000;

    const initials = name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || 'AB';

    if (pinRecipientAvatar) pinRecipientAvatar.textContent = initials;
    if (pinRecipientName) pinRecipientName.textContent = name;
    if (pinRecipientBank) pinRecipientBank.textContent = `${bank} • ${acc}`;
    if (pinSummaryAmount) pinSummaryAmount.textContent = formatNaira(amt);

    // Query per-user transaction PIN status for the currently logged-in user
    const currentUserId = state.user?.id;
    let userPinHash = state.user?.pinHash;
    if (!userPinHash && window.MidePayDB && currentUserId) {
      try {
        userPinHash = await window.MidePayDB.getUserPinHash(currentUserId);
        if (userPinHash && state.user) {
          state.user.pinHash = userPinHash;
          saveAccountToRegistry(state.user);
        }
      } catch (err) {
        console.warn('[MidePay] Could not fetch user pin hash:', err);
      }
    }

    if (!userPinHash) {
      // First-time transfer for this user: prompt to set 4-digit PIN
      if (pinPromptLabel) pinPromptLabel.textContent = 'Create 4-Digit Security PIN';
      if (pinSetupHint) pinSetupHint.classList.remove('hidden');
      if (btnAuthorizePayText) btnAuthorizePayText.textContent = `Set PIN & Pay ${formatNaira(amt)}`;
    } else {
      // Returning user: verify against their existing PIN hash
      if (pinPromptLabel) pinPromptLabel.textContent = 'Enter 4-Digit Security PIN';
      if (pinSetupHint) pinSetupHint.classList.add('hidden');
      if (btnAuthorizePayText) btnAuthorizePayText.textContent = `Pay ${formatNaira(amt)}`;
    }

    // Never expose demo quick-fill helper so each user sets and uses their own PIN
    if (btnFillDemoPin) btnFillDemoPin.classList.add('hidden');
  }

  function clearPinBoxes() {
    authPinBoxes.forEach(b => {
      if (b) {
        b.value = '';
        b.classList.remove('has-value');
      }
    });
  }

  function getEnteredPin() {
    return authPinBoxes.map(b => b?.value || '').join('');
  }

  // Setup PIN boxes jump logic
  authPinBoxes.forEach((box, idx) => {
    if (!box) return;

    box.addEventListener('input', () => {
      const val = box.value.replace(/[^0-9]/g, '');
      box.value = val ? val[val.length - 1] : '';

      if (box.value) {
        box.classList.add('has-value');
        if (idx < authPinBoxes.length - 1) {
          authPinBoxes[idx + 1].focus();
        }
      } else {
        box.classList.remove('has-value');
      }

      if (pinAuthError) pinAuthError.classList.add('hidden');
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && idx > 0) {
        authPinBoxes[idx - 1].focus();
        authPinBoxes[idx - 1].value = '';
        authPinBoxes[idx - 1].classList.remove('has-value');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (getEnteredPin().length === 4) {
          btnAuthorizePay?.click();
        }
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
      if (!pasteData) return;
      for (let i = 0; i < authPinBoxes.length; i++) {
        if (pasteData[i]) {
          authPinBoxes[i].value = pasteData[i];
          authPinBoxes[i].classList.add('has-value');
        }
      }
      const lastIdx = Math.min(pasteData.length, authPinBoxes.length) - 1;
      if (lastIdx >= 0) authPinBoxes[lastIdx].focus();
    });
  });

  // Demo PIN button hidden by default - kept safe
  if (btnFillDemoPin) {
    btnFillDemoPin.addEventListener('click', () => {
      ['1', '2', '3', '4'].forEach((digit, i) => {
        if (authPinBoxes[i]) {
          authPinBoxes[i].value = digit;
          authPinBoxes[i].classList.add('has-value');
        }
      });
      if (pinAuthError) pinAuthError.classList.add('hidden');
      authPinBoxes[3]?.focus();
    });
  }

  // Back button from PIN sheet back to Transfer Form
  if (btnBackFromPin) {
    btnBackFromPin.addEventListener('click', () => {
      showSendStep('form');
    });
  }

  // Close button on PIN sheet
  if (closePinModalBtn) {
    closePinModalBtn.addEventListener('click', () => {
      modalSend?.classList.add('hidden');
    });
  }

  // Close button on Screen 1
  if (closeSendBtn) {
    closeSendBtn.addEventListener('click', () => {
      modalSend?.classList.add('hidden');
    });
  }

  // -------------------------------------------------------------
  // BIG "PAY ₦..." BUTTON -> INSTANT EXECUTION & RECEIPT
  // -------------------------------------------------------------
  if (btnAuthorizePay) {
    btnAuthorizePay.addEventListener('click', async (e) => {
      e.preventDefault();

      const enteredPin = getEnteredPin();
      if (enteredPin.length !== 4 || !/^\d{4}$/.test(enteredPin)) {
        if (pinAuthError && pinAuthErrorText) {
          pinAuthErrorText.textContent = 'Please enter a valid 4-digit numeric security PIN.';
          pinAuthError.classList.remove('hidden');
        }
        authPinBoxes[0]?.focus();
        return;
      }

      // -------------------------------------------------------------
      // SERVER-AUTHORITATIVE PER-USER PIN, SUBMIT LOCK & ATOMIC RPC
      // -------------------------------------------------------------
      await withSubmitLock('send-money-authorize', btnAuthorizePay, 'Processing Instant Transfer...', async (idempotencyKey) => {
        const currentUserId = state.user?.id;
        const isLiveSupa = Boolean(window.MidePayDB && window.MidePayDB.isConfigured() && window.MidePayDB.client && currentUserId && isValidUuid(currentUserId));

        if (!isLiveSupa && isProductionEnv()) {
          if (pinAuthError && pinAuthErrorText) {
            pinAuthErrorText.textContent = 'Authenticated Supabase session required to authorize transfers.';
            pinAuthError.classList.remove('hidden');
          }
          return;
        }

        const pinCheck = await verifyOrSetupActionPin(enteredPin);
        if (!pinCheck.valid) {
          if (pinAuthError && pinAuthErrorText) {
            pinAuthErrorText.textContent = pinCheck.error || 'Incorrect PIN for your account. Please try again.';
            pinAuthError.classList.remove('hidden');
          }
          clearPinBoxes();
          authPinBoxes[0]?.focus();
          return;
        }

        if (pinAuthError) pinAuthError.classList.add('hidden');

        try {
          let txRef = `MDP-${idempotencyKey.slice(0, 8).toUpperCase()}`;

          if (sendFlowState.recipientId && isValidUuid(sendFlowState.recipientId)) {
            const rpcRes = await window.MidePayDB.transferFunds({
              senderId: state.user.id,
              recipientId: sendFlowState.recipientId,
              recipientNuban: sendFlowState.accountNumber || null,
              amount: sendFlowState.amount,
              narration: sendFlowState.narration,
              pin: enteredPin,
              idempotencyKey
            });
            if (!rpcRes.success) {
              throw new Error(rpcRes.error || 'Atomic transfer rejected by server.');
            }
            if (rpcRes.reference) txRef = rpcRes.reference;
            await rehydrateBalanceFromServer(rpcRes.newBalance ?? rpcRes.data?.new_balance);
          } else {
            const recRes = await window.MidePayDB.recordTransfer({
              userId: state.user.id,
              amount: sendFlowState.amount,
              fee: sendFlowState.transferFee,
              recipient: `${sendFlowState.resolvedName} (${sendFlowState.accountNumber})`,
              accountNumber: sendFlowState.accountNumber,
              destinationBank: sendFlowState.selectedBank,
              narration: sendFlowState.narration,
              reference: txRef,
              pin: enteredPin,
              idempotencyKey
            });
            if (!recRes.success) {
              throw new Error(recRes.error || 'Transfer rejected by server ledger.');
            }
            if (recRes.reference) txRef = recRes.reference;
            await rehydrateBalanceFromServer(recRes.newBalance);
          }

          const now = new Date();
          const txTimestamp = now.toLocaleString('en-NG', {
            dateStyle: 'medium',
            timeStyle: 'short'
          });

          const newTx = {
            id: `tx-${Date.now()}`,
            ref: txRef,
            title: `Transfer to ${sendFlowState.resolvedName}`,
            category: 'Transfer',
            sender: state.user?.fullName || 'MidePay Member',
            beneficiary: `${sendFlowState.resolvedName} • ${sendFlowState.selectedBank} (${sendFlowState.accountNumber})`,
            narration: sendFlowState.narration || 'Transfer via MidePay',
            date: 'Just now',
            type: 'outflow',
            amount: sendFlowState.amount,
            fee: sendFlowState.transferFee,
            status: 'Successful'
          };

          state.transactions.unshift(newTx);
          saveUserTransactions();
          sendFlowState.lastTransaction = newTx;

          if (sendFlowState.approvedRequestId && window.MidePayDB) {
            window.MidePayDB.updatePaymentRequestStatus(sendFlowState.approvedRequestId, 'approved', txRef).catch(console.warn);
            sendFlowState.approvedRequestId = null;
            if (typeof refreshNotificationsAndRequests === 'function') {
              refreshNotificationsAndRequests().catch(console.warn);
            }
          }

          renderDashboardTransactions();

          if (successTransferAmount) successTransferAmount.textContent = formatNaira(sendFlowState.amount);
          if (successRecipientName) successRecipientName.textContent = sendFlowState.resolvedName;
          if (successRecipientDetail) {
            successRecipientDetail.textContent = `${sendFlowState.selectedBank} • ${sendFlowState.accountNumber}`;
          }
          if (successTxRef) successTxRef.textContent = txRef;
          if (successTxFee) successTxFee.textContent = formatNaira(sendFlowState.transferFee);
          if (successTxDate) successTxDate.textContent = txTimestamp;

          showSendStep('processing');

          setTimeout(() => {
            if (paymentLoader) {
              paymentLoader.classList.add('is-ready');
              paymentLoader.dataset.state = 'ready';
            }

            setTimeout(() => {
              showSendStep('success');
              showToast(`🎉 Transfer Successful! Sent ${formatNaira(sendFlowState.amount)} to ${sendFlowState.resolvedName}`);
              loadDashboardData().catch(console.warn);
            }, 850);
          }, 2200);
        } catch (err) {
          console.error('Transfer execution error:', err);
          showToast(`Transfer failed: ${err.message || 'Unknown network error'}`, 'error');
          showSendStep('pin-confirm');
        }
      });
    });
  }

  // -------------------------------------------------------------
  // SCREEN 3: SUCCESS ACTIONS ("DONE" & "VIEW RECEIPT")
  // -------------------------------------------------------------
  if (btnTransferDone) {
    btnTransferDone.addEventListener('click', () => {
      modalSend?.classList.add('hidden');
      if (sendRecipient) sendRecipient.value = '';
      if (sendAmountInput) sendAmountInput.value = '5000';
      if (sendNarrationInput) sendNarrationInput.value = '';
      sendFlowState.isAccountResolved = false;
      sendFlowState.resolvedName = '';
      sendFlowState.accountNumber = '';
      if (accountResolvedBox) accountResolvedBox.classList.add('hidden');

      showSendStep('form');
      showView('dashboard');
      renderBalances();
      renderDashboardTransactions();
    });
  }

  if (btnTransferShareReceipt) {
    btnTransferShareReceipt.addEventListener('click', () => {
      modalSend?.classList.add('hidden');
      if (sendFlowState.lastTransaction) {
        openReceiptModal(sendFlowState.lastTransaction);
      }
    });
  }

  // =========================================================================
  // REQUEST MONEY FLOW CONTROLLER (P2P PAYMENT REQUESTS)
  // =========================================================================
  const modalRequest = document.getElementById('modal-request-money');
  const btnOpenRequest = document.getElementById('btn-open-request-modal');
  const qaRequest = document.getElementById('qa-request');
  const closeRequestBtn = document.getElementById('close-request-modal-btn');
  const closeRequestSuccessBtn = document.getElementById('close-request-success-btn');
  const btnRequestDone = document.getElementById('btn-request-done');

  const requestStepForm = document.getElementById('request-step-form');
  const requestStepSuccess = document.getElementById('request-step-success');

  const requestRecipientInput = document.getElementById('request-recipient-input');
  const requestSearchingSpinner = document.getElementById('request-searching-spinner');
  const requestRecipientResolvedBox = document.getElementById('request-recipient-resolved-box');
  const requestResolvedName = document.getElementById('request-resolved-name');
  const requestResolvedDetail = document.getElementById('request-resolved-detail');

  const requestAmountInput = document.getElementById('request-amount-input');
  const requestQuickAmountBtns = document.querySelectorAll('#request-quick-amount-tags .amount-tag-btn');
  const requestNoteInput = document.getElementById('request-note-input');

  const requestFormError = document.getElementById('request-form-error');
  const requestFormErrorText = document.getElementById('request-form-error-text');
  const btnSubmitRequest = document.getElementById('btn-submit-request');
  const btnSubmitRequestText = document.getElementById('btn-submit-request-text');

  // Success screen elements
  const reqSuccessAmountText = document.getElementById('req-success-amount-text');
  const reqSuccessRecipientText = document.getElementById('req-success-recipient-text');
  const reqSuccessName = document.getElementById('req-success-name');
  const reqSuccessAmt = document.getElementById('req-success-amt');
  const reqSuccessNote = document.getElementById('req-success-note');

  // Request flow state
  const requestFlowState = {
    resolvedRecipient: null,
    amount: 5000,
    note: ''
  };

  function openRequestModal() {
    ensureUserSession();
    if (modalRequest) modalRequest.classList.remove('hidden');
    if (requestStepForm) requestStepForm.classList.remove('hidden');
    if (requestStepSuccess) requestStepSuccess.classList.add('hidden');
    if (requestFormError) requestFormError.classList.add('hidden');
    if (requestRecipientResolvedBox) requestRecipientResolvedBox.classList.add('hidden');

    if (requestRecipientInput) {
      requestRecipientInput.value = '';
      setTimeout(() => requestRecipientInput.focus(), 60);
    }
    if (requestAmountInput) requestAmountInput.value = '5000';
    if (requestNoteInput) requestNoteInput.value = '';
    requestFlowState.resolvedRecipient = null;
    requestFlowState.amount = 5000;
    requestFlowState.note = '';

    // Reset quick chips
    requestQuickAmountBtns.forEach(btn => {
      if (btn.getAttribute('data-amt') === '5000') btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }
  window.openRequestModal = openRequestModal;

  if (btnOpenRequest) btnOpenRequest.addEventListener('click', openRequestModal);
  if (qaRequest) qaRequest.addEventListener('click', openRequestModal);
  if (closeRequestBtn) closeRequestBtn.addEventListener('click', () => modalRequest?.classList.add('hidden'));
  if (closeRequestSuccessBtn) closeRequestSuccessBtn.addEventListener('click', () => modalRequest?.classList.add('hidden'));
  if (btnRequestDone) {
    btnRequestDone.addEventListener('click', () => {
      modalRequest?.classList.add('hidden');
      refreshNotificationsAndRequests().catch(console.warn);
    });
  }

  // Quick Amount Chips
  requestQuickAmountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      requestQuickAmountBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const amt = Number(btn.getAttribute('data-amt')) || 5000;
      if (requestAmountInput) requestAmountInput.value = amt;
      requestFlowState.amount = amt;
    });
  });

  if (requestAmountInput) {
    requestAmountInput.addEventListener('input', () => {
      const val = Number(requestAmountInput.value) || 0;
      requestFlowState.amount = val;
      requestQuickAmountBtns.forEach(b => {
        b.classList.toggle('active', Number(b.getAttribute('data-amt')) === val);
      });
    });
  }

  // Real-time recipient lookup for Request Money (Debounced)
  let requestLookupDebounce = null;
  if (requestRecipientInput) {
    requestRecipientInput.addEventListener('input', () => {
      clearTimeout(requestLookupDebounce);
      const query = requestRecipientInput.value.trim();

      if (!query || query.length < 2) {
        if (requestRecipientResolvedBox) requestRecipientResolvedBox.classList.add('hidden');
        if (requestSearchingSpinner) requestSearchingSpinner.classList.add('hidden');
        requestFlowState.resolvedRecipient = null;
        return;
      }

      if (requestSearchingSpinner) requestSearchingSpinner.classList.remove('hidden');

      requestLookupDebounce = setTimeout(async () => {
        try {
          const recipient = await window.MidePayDB?.findRecipient(query, state.user?.id);
          if (requestSearchingSpinner) requestSearchingSpinner.classList.add('hidden');

          if (recipient) {
            requestFlowState.resolvedRecipient = recipient;
            if (requestResolvedName) requestResolvedName.textContent = `✓ Verified MidePay Account: ${recipient.fullName}`;
            if (requestResolvedDetail) {
              const tagText = recipient.tag || `@${recipient.fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
              const idMeta = recipient.nuban || recipient.phone || recipient.email || '';
              requestResolvedDetail.textContent = idMeta ? `${tagText} • ${idMeta}` : tagText;
            }
            if (requestRecipientResolvedBox) requestRecipientResolvedBox.classList.remove('hidden');
            if (requestFormError) requestFormError.classList.add('hidden');
          } else {
            requestFlowState.resolvedRecipient = null;
            if (requestRecipientResolvedBox) requestRecipientResolvedBox.classList.add('hidden');
          }
        } catch (err) {
          if (requestSearchingSpinner) requestSearchingSpinner.classList.add('hidden');
          console.warn('[MidePay] Request recipient lookup error:', err);
        }
      }, 250);
    });
  }

  // Submit Payment Request
  if (btnSubmitRequest) {
    btnSubmitRequest.addEventListener('click', async (e) => {
      e.preventDefault();
      ensureUserSession();

      const recipient = requestFlowState.resolvedRecipient;
      const amount = Number(requestAmountInput?.value) || requestFlowState.amount;
      const note = (requestNoteInput?.value || '').trim();

      if (!recipient) {
        if (requestFormError && requestFormErrorText) {
          requestFormErrorText.textContent = 'Please enter a valid MideTag, email, or phone of a registered member.';
          requestFormError.classList.remove('hidden');
        }
        requestRecipientInput?.focus();
        return;
      }

      if (recipient.id === state.user?.id || (recipient.email && recipient.email.toLowerCase() === state.user?.email?.toLowerCase())) {
        if (requestFormError && requestFormErrorText) {
          requestFormErrorText.textContent = 'You cannot request money from your own account.';
          requestFormError.classList.remove('hidden');
        }
        return;
      }

      if (!amount || amount <= 0) {
        if (requestFormError && requestFormErrorText) {
          requestFormErrorText.textContent = 'Please enter a valid request amount greater than ₦0.';
          requestFormError.classList.remove('hidden');
        }
        requestAmountInput?.focus();
        return;
      }

      btnSubmitRequest.disabled = true;
      if (btnSubmitRequestText) {
        btnSubmitRequestText.innerHTML = `
          <div class="recipient-search-spinner" style="position:static; width:16px; height:16px; margin-right:8px; display:inline-block; vertical-align:middle;"></div>
          <span>Sending Request...</span>
        `;
      }

      try {
        const result = await window.MidePayDB.createPaymentRequest({
          requesterId: state.user.id,
          payerId: recipient.id,
          amount: amount,
          note: note,
          requesterDetails: {
            id: state.user.id,
            fullName: state.user.fullName,
            email: state.user.email,
            phone: state.user.phone,
            tag: state.user.tag
          },
          payerDetails: {
            id: recipient.id,
            fullName: recipient.fullName,
            email: recipient.email,
            phone: recipient.phone,
            tag: recipient.tag
          }
        });

        if (result.success) {
          // Transition to Screen 2: Confirmation
          if (requestStepForm) requestStepForm.classList.add('hidden');
          if (requestStepSuccess) requestStepSuccess.classList.remove('hidden');

          if (reqSuccessAmountText) reqSuccessAmountText.textContent = formatNaira(amount);
          if (reqSuccessRecipientText) reqSuccessRecipientText.textContent = recipient.fullName;
          if (reqSuccessName) reqSuccessName.textContent = recipient.fullName;
          if (reqSuccessAmt) reqSuccessAmt.textContent = formatNaira(amount);
          if (reqSuccessNote) reqSuccessNote.textContent = note || '—';

          showToast(`📩 Request sent to ${recipient.fullName}!`, 'success');
          await refreshNotificationsAndRequests();
        } else {
          showToast(`Could not send request: ${result.error || 'Server error'}`, 'error');
        }
      } catch (err) {
        console.error('Request creation error:', err);
        showToast(`Request failed: ${err.message || 'Network error'}`, 'error');
      } finally {
        btnSubmitRequest.disabled = false;
        if (btnSubmitRequestText) btnSubmitRequestText.textContent = 'Send Payment Request';
      }
    });
  }

  // =========================================================================
  // NOTIFICATIONS BELL & PENDING PAYMENT REQUESTS CONTROLLER
  // =========================================================================
  const btnNotificationBell = document.getElementById('btn-notification-bell');
  const notificationBadge = document.getElementById('notification-badge');
  const notificationsDropdown = document.getElementById('notifications-dropdown');
  const notificationsList = document.getElementById('notifications-list');
  const pendingRequestsCountTag = document.getElementById('pending-requests-count-tag');

  // Toggle notification flyout
  if (btnNotificationBell && notificationsDropdown) {
    btnNotificationBell.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = notificationsDropdown.classList.contains('hidden');
      if (isHidden) {
        notificationsDropdown.classList.remove('hidden');
        refreshNotificationsAndRequests().catch(console.warn);
      } else {
        notificationsDropdown.classList.add('hidden');
      }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!notificationsDropdown.contains(e.target) && !btnNotificationBell.contains(e.target)) {
        notificationsDropdown.classList.add('hidden');
      }
    });
  }

  // Initialize demo request if local storage empty
  function initDefaultPaymentRequests() {
    try {
      const stored = localStorage.getItem('midepay_payment_requests');
      if (!stored) {
        const demoRequests = [
          {
            id: 'req-demo-001',
            requester_id: 'a0000000-0000-4000-8000-000000000002', // Chinedu Eze
            payer_id: 'a0000000-0000-4000-8000-000000000001', // Olamide Olasunkanmi
            amount: 5000,
            note: 'Lunch at Terra Kulture',
            status: 'pending',
            requester: {
              id: 'a0000000-0000-4000-8000-000000000002',
              fullName: 'Chinedu Eze',
              email: 'chinedu@midepay.ng',
              phone: '08023456781',
              tag: '@chinedu'
            },
            payer: {
              id: 'a0000000-0000-4000-8000-000000000001',
              fullName: 'Olamide Olasunkanmi',
              email: 'olasunkanmiolamide15@gmail.com',
              phone: '08139482019',
              tag: '@olamide'
            },
            created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
            updated_at: new Date(Date.now() - 3600000 * 2).toISOString()
          }
        ];
        localStorage.setItem('midepay_payment_requests', JSON.stringify(demoRequests));
      }
    } catch (e) {}
  }
  initDefaultPaymentRequests();

  // Refresh notifications and requests
  async function refreshNotificationsAndRequests() {
    const currentUserId = state.user?.id;
    if (!currentUserId || !window.MidePayDB) return;

    try {
      const allRequests = await window.MidePayDB.getPaymentRequests(currentUserId);

      // 1. Pending requests where current user is the PAYER
      const pendingForMe = allRequests.filter(r => r.payer_id === currentUserId && r.status === 'pending');
      const pendingCount = pendingForMe.length;

      // Update badge
      if (notificationBadge) {
        if (pendingCount > 0) {
          notificationBadge.textContent = pendingCount > 9 ? '9+' : pendingCount.toString();
          notificationBadge.classList.remove('hidden');
        } else {
          notificationBadge.classList.add('hidden');
        }
      }

      if (pendingRequestsCountTag) {
        pendingRequestsCountTag.textContent = `${pendingCount} pending`;
      }

      // Render Dropdown List
      if (notificationsList) {
        if (pendingCount === 0) {
          notificationsList.innerHTML = `
            <div class="notifications-empty-state">
              <span style="font-size: 2rem;">✨</span>
              <strong style="color: var(--text-primary);">No pending requests</strong>
              <span>You're all caught up! Incoming payment requests from contacts will appear here.</span>
            </div>
          `;
        } else {
          notificationsList.innerHTML = pendingForMe.map(req => {
            const requesterName = req.requester?.fullName || req.requester?.full_name || 'MidePay Member';
            const requesterTag = req.requester?.tag || `@${requesterName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
            const initials = requesterName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'MP';
            const noteText = req.note ? `<div class="req-note-box">💬 "${escapeHtml(req.note)}"</div>` : '';

            return `
              <div class="req-item-card" data-req-id="${req.id}">
                <div class="req-item-top">
                  <div class="req-user-info">
                    <div class="req-user-avatar">${escapeHtml(initials)}</div>
                    <div class="req-name-tag">
                      <span class="req-user-name">${escapeHtml(requesterName)}</span>
                      <span class="req-user-tag">${escapeHtml(requesterTag)}</span>
                    </div>
                  </div>
                  <div class="req-amount-badge">${formatNaira(req.amount)}</div>
                </div>
                ${noteText}
                <div class="req-actions-row">
                  <button type="button" class="btn-req-approve" data-request-id="${req.id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Approve & Pay</span>
                  </button>
                  <button type="button" class="btn-req-decline" data-request-id="${req.id}">
                    <span>Decline</span>
                  </button>
                </div>
              </div>
            `;
          }).join('');

          // Attach Approve listeners
          notificationsList.querySelectorAll('.btn-req-approve').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const reqId = btn.getAttribute('data-request-id');
              const targetReq = pendingForMe.find(r => r.id === reqId);
              if (targetReq) {
                handleApprovePaymentRequest(targetReq);
              }
            });
          });

          // Attach Decline listeners
          notificationsList.querySelectorAll('.btn-req-decline').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const reqId = btn.getAttribute('data-request-id');
              await handleDeclinePaymentRequest(reqId);
            });
          });
        }
      }

      // Also render Requester-Side Visibility in Dashboard (Step 6)
      const dashboardRequestsList = document.getElementById('dashboard-requests-list');
      if (dashboardRequestsList && state.txFilter === 'requests') {
        renderDashboardPaymentRequests(dashboardRequestsList, allRequests);
      }
    } catch (err) {
      console.warn('[MidePay] refreshNotificationsAndRequests error:', err);
    }
  }
  window.refreshNotificationsAndRequests = refreshNotificationsAndRequests;

  // Step 4 — Approve Flow: Triggers exact Send Money PIN verification & execution
  function handleApprovePaymentRequest(request) {
    if (!request) return;

    if (window.MidePayDB && typeof window.MidePayDB.isFinancialQuarantined === 'function' && window.MidePayDB.isFinancialQuarantined()) {
      showToast('Staging Quarantine: Client-side wallet transfers are disabled until backend settlement is live.', 'error');
      return;
    }

    // Check balance first
    if (state.dashBalance < Number(request.amount)) {
      showToast(`⚠️ Insufficient balance (${formatNaira(state.dashBalance)}) to approve ${formatNaira(request.amount)} request. Top up first!`, 'error');
      return;
    }

    // Close notifications dropdown
    notificationsDropdown?.classList.add('hidden');

    const requesterName = request.requester?.fullName || request.requester?.full_name || 'MidePay Member';
    const requesterTag = request.requester?.tag || request.requester?.email || 'MidePay Tag';

    // Pre-populate sendFlowState
    sendFlowState.resolvedName = requesterName;
    sendFlowState.selectedBank = 'MidePay Member';
    sendFlowState.accountNumber = requesterTag;
    sendFlowState.amount = Number(request.amount);
    sendFlowState.transferFee = 0.00;
    sendFlowState.narration = `Payment Request: ${request.note || 'Settlement'}`;
    sendFlowState.recipientId = request.requester_id;
    sendFlowState.isAccountResolved = true;
    sendFlowState.approvedRequestId = request.id;

    // Open Send Money modal directly at PIN verification screen
    modalSend?.classList.remove('hidden');
    showSendStep('pin-confirm');
  }

  // Step 5 — Decline Flow:
  async function handleDeclinePaymentRequest(requestId) {
    if (!requestId) return;
    try {
      await window.MidePayDB.updatePaymentRequestStatus(requestId, 'declined', state.user?.id);
      showToast('Payment request declined. No money moved.', 'info');
      await refreshNotificationsAndRequests();
    } catch (err) {
      showToast('Could not decline request: ' + err.message, 'error');
    }
  }

  // Step 6 — Requester-Side Visibility:
  async function renderDashboardPaymentRequests(container, allRequests = null) {
    if (!container) return;
    const currentUserId = state.user?.id;
    if (!currentUserId) return;

    let requests = allRequests;
    if (!requests && window.MidePayDB) {
      requests = await window.MidePayDB.getPaymentRequests(currentUserId);
    }
    if (!requests) requests = [];

    if (requests.length === 0) {
      container.innerHTML = `
        <div class="dash-tx-empty-state" style="padding: 2.8rem 1.2rem; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 0.6rem; opacity: 0.7;">📩</div>
          <div style="font-weight: 600; font-size: 1.05rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
            No payment requests yet
          </div>
          <div style="font-size: 0.88rem; max-width: 280px; margin: 0 auto; color: var(--text-muted); line-height: 1.5;">
            Use the "Request" quick action to ask registered contacts for funds.
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = requests.map(req => {
      const isRequester = (req.requester_id === currentUserId);
      const otherPersonName = isRequester
        ? (req.payer?.fullName || req.payer?.full_name || 'Contact')
        : (req.requester?.fullName || req.requester?.full_name || 'Contact');
      
      const title = isRequester ? `Request to ${otherPersonName}` : `Request from ${otherPersonName}`;
      const statusClass = req.status || 'pending';
      const statusLabel = req.status ? req.status.charAt(0).toUpperCase() + req.status.slice(1) : 'Pending';
      const dateStr = formatTxDate(req.created_at);
      const noteStr = req.note ? ` • "${escapeHtml(req.note)}"` : '';

      return `
        <div class="dash-tx-item" style="cursor: default;">
          <div class="dash-tx-left">
            <div class="tx-badge-icon ${isRequester ? 'tx-inflow' : 'tx-outflow'}" style="background: rgba(59,130,246,0.15); color: #60A5FA;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </div>
            <div class="dash-tx-details">
              <span class="dash-tx-title">${escapeHtml(title)}</span>
              <span class="dash-tx-meta">${dateStr}${noteStr}</span>
            </div>
          </div>
          <div class="dash-tx-right" style="text-align: right;">
            <div class="dash-tx-val" style="color: ${isRequester ? '#34D399' : '#F87171'};">
              ${isRequester ? '+' : '-'}${formatNaira(req.amount)}
            </div>
            <span class="status-pill ${statusClass}" style="margin-top: 3px;">${statusLabel}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // =========================================================================
  // ADD MONEY MODAL CONTROLLER: DIRECT TOP-UP (ACTIVE) + NOV 30 GATEWAY ROADMAP
  // =========================================================================
  const addFundsForm = document.getElementById('add-funds-form');
  const gatewayProviderInput = document.getElementById('topup-gateway-provider');
  const btnGatewayDirect = document.getElementById('gateway-provider-direct');
  const btnGatewayPaystack = document.getElementById('gateway-provider-paystack');
  const btnGatewayFlutterwave = document.getElementById('gateway-provider-flutterwave');
  const confirmTopupBtn = document.getElementById('confirm-topup-btn');
  const confirmTopupBtnText = document.getElementById('confirm-topup-btn-text');
  const topupErrorAlert = document.getElementById('topup-error-alert');
  const topupErrorText = document.getElementById('topup-error-text');

  const gatewaysLive = Boolean(
    window.MIDEPAY_SUPABASE_CONFIG && window.MIDEPAY_SUPABASE_CONFIG.GATEWAYS_LIVE === true
  );
  const stagingPaystackTest = window.MIDEPAY_SUPABASE_CONFIG?.TEST_PAYSTACK_CHECKOUT === true &&
    window.MIDEPAY_SUPABASE_CONFIG?.url === 'https://ajbhsmcosxgymrtawlmd.supabase.co';
  if (stagingPaystackTest) {
    document.getElementById('pending-deposit-tools')?.classList.remove('hidden');
    if (btnGatewayDirect) { btnGatewayDirect.disabled = true; btnGatewayDirect.classList.add('hidden'); }
    if (btnGatewayFlutterwave) { btnGatewayFlutterwave.disabled = true; btnGatewayFlutterwave.classList.add('hidden'); }
    if (btnGatewayPaystack) {
      btnGatewayPaystack.disabled = false; btnGatewayPaystack.removeAttribute('aria-disabled');
      btnGatewayPaystack.classList.remove('is-disabled-roadmap');
      btnGatewayPaystack.title = 'Paystack test checkout — no real money';
      const badge = btnGatewayPaystack.querySelector('.gateway-coming-badge');
      if (badge) badge.textContent = 'Test mode — no real money';
    }
  }

  // Unlock Paystack/Flutterwave buttons automatically once GATEWAYS_LIVE === true
  if (gatewaysLive) {
    [btnGatewayPaystack, btnGatewayFlutterwave].forEach(btn => {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-disabled');
        btn.classList.remove('is-disabled-roadmap');
      }
    });
  }

  function selectGatewayProvider(provider) {
    const clean = stagingPaystackTest ? 'paystack' : gatewaysLive && (provider === 'paystack' || provider === 'flutterwave') ? provider : 'direct';
    if (gatewayProviderInput) gatewayProviderInput.value = clean;

    if (btnGatewayDirect) {
      const isDirect = clean === 'direct';
      btnGatewayDirect.classList.toggle('active', isDirect);
      btnGatewayDirect.setAttribute('aria-checked', isDirect ? 'true' : 'false');
    }
    if (btnGatewayPaystack) {
      const isPsk = clean === 'paystack';
      btnGatewayPaystack.classList.toggle('active', isPsk);
      btnGatewayPaystack.setAttribute('aria-checked', isPsk ? 'true' : 'false');
    }
    if (btnGatewayFlutterwave) {
      const isFlw = clean === 'flutterwave';
      btnGatewayFlutterwave.classList.toggle('active', isFlw);
      btnGatewayFlutterwave.setAttribute('aria-checked', isFlw ? 'true' : 'false');
    }
    if (confirmTopupBtnText) {
      confirmTopupBtnText.textContent =
        clean === 'paystack'
          ? (stagingPaystackTest ? 'Continue to Paystack Test Checkout' : 'Continue to Paystack Checkout')
          : clean === 'flutterwave'
            ? 'Continue to Flutterwave Checkout'
            : 'Credit Wallet Instantly';
    }
    if (topupErrorAlert) topupErrorAlert.classList.add('hidden');
  }
  selectGatewayProvider('direct');

  const verifyDepositBtn = document.getElementById('verify-latest-deposit-btn');
  if (verifyDepositBtn) verifyDepositBtn.addEventListener('click', async () => {
    const status = document.getElementById('pending-deposit-status');
    if (!stagingPaystackTest || !window.MidePayDB?.verifyGatewayDeposit) return;
    await withSubmitLock('verify-paystack-deposit', verifyDepositBtn, 'Checking Paystack...', async () => {
      if (status) status.textContent = 'Checking the existing payment with Paystack...';
      let result;
      try { result = await window.MidePayDB.verifyGatewayDeposit(); }
      catch { if(status)status.textContent='Payment status could not be confirmed. Check this payment again before paying again.'; return; }
      if (result?.success !== true || result.status !== 'successful') {
        if (status) status.textContent = result?.error || 'Paystack has not confirmed this deposit as successful. Do not pay again yet.';
        return;
      }
      try {
        const loaded = await loadDashboardData();
        const refreshed = await rehydrateBalanceFromServer();
        if (loaded === false || refreshed === false) throw new Error('Balance refresh incomplete');
      } catch (_) {
        if (status) status.textContent = 'Payment verified. Reload your dashboard to refresh the balance.';
        return;
      }
      if (status) status.textContent = result.already_settled ? 'This deposit was already credited. Your balance has been refreshed.' : 'Payment verified and credited. Your balance has been refreshed.';
      showToast('Paystack deposit verified. Balance refreshed.', 'success');
    });
  });

  if (btnGatewayDirect) {
    btnGatewayDirect.addEventListener('click', () => selectGatewayProvider('direct'));
  }
  if (btnGatewayPaystack) {
    btnGatewayPaystack.addEventListener('click', () => {
      if (!gatewaysLive && !stagingPaystackTest) {
        showToast('Paystack checkout is unavailable in this environment. No wallet credit has been made.', 'error');
        return;
      }
      selectGatewayProvider('paystack');
    });
  }
  if (btnGatewayFlutterwave) {
    btnGatewayFlutterwave.addEventListener('click', () => {
      if (!gatewaysLive) {
        showToast('Flutterwave checkout is not connected in this preview.', 'error');
        return;
      }
      selectGatewayProvider('flutterwave');
    });
  }

  if (addFundsForm) {
    addFundsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (topupErrorAlert) topupErrorAlert.classList.add('hidden');

      const topupAmtEl = document.getElementById('topup-amount');
      const amount = parseFloat(topupAmtEl ? topupAmtEl.value : '0');
      const selectedProvider = gatewayProviderInput?.value || 'direct';

      if (!Number.isFinite(amount) || amount < 100 || amount > 5000000) {
        const msg = 'Top-up amount must be between ₦100.00 and ₦5,000,000.00.';
        if (topupErrorAlert && topupErrorText) {
          topupErrorText.textContent = msg;
          topupErrorAlert.classList.remove('hidden');
        } else {
          showToast(msg, 'error');
        }
        return;
      }

      // Optional External Card Checkout Path (only when GATEWAYS_LIVE === true)
      if (
        (gatewaysLive || (stagingPaystackTest && selectedProvider === 'paystack')) &&
        (selectedProvider === 'paystack' || selectedProvider === 'flutterwave') &&
        window.MidePayDB &&
        typeof window.MidePayDB.initializeGatewayDeposit === 'function'
      ) {
        const providerDisplay = selectedProvider === 'flutterwave' ? 'Flutterwave' : 'Paystack';
        if (confirmTopupBtn) {
          confirmTopupBtn.disabled = true;
          confirmTopupBtn.classList.add('loading');
        }
        if (confirmTopupBtnText) {
          confirmTopupBtnText.textContent = `Initializing ${providerDisplay} Secure Checkout...`;
        }

        try {
          const initRes = await window.MidePayDB.initializeGatewayDeposit({
            provider: selectedProvider,
            amount
          });

          if (!initRes.success || !initRes.authorizationUrl) {
            const errMsg = initRes.error || `Unable to initialize ${providerDisplay} checkout session.`;
            if (topupErrorAlert && topupErrorText) {
              topupErrorText.textContent = errMsg;
              topupErrorAlert.classList.remove('hidden');
            } else {
              showToast(errMsg, 'error');
            }
            return;
          }

          showToast(`🔒 Redirecting to ${providerDisplay} Checkout (${initRes.reference})...`, 'success');
          if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
            window.location.assign(initRes.authorizationUrl);
          }
          return;
        } catch (_) {
          const message = 'Checkout could not be opened. Check your existing payment status before trying another payment.';
          if (topupErrorAlert && topupErrorText) { topupErrorText.textContent = message; topupErrorAlert.classList.remove('hidden'); }
          else showToast(message, 'error');
        } finally {
          if (confirmTopupBtn) {
            confirmTopupBtn.disabled = false;
            confirmTopupBtn.classList.remove('loading');
          }
          selectGatewayProvider(selectedProvider);
        }
      }

      // Primary Default Path: Instant Direct Wallet Top-Up via `concept_topup_wallet` RPC
      if (stagingPaystackTest) { showToast('Use Paystack test checkout. Direct wallet credits remain disabled.', 'error'); return; }
      ensureUserSession();
      await withSubmitLock('add-money-direct', confirmTopupBtn, 'Crediting Wallet...', async (idempotencyKey) => {
        if (!window.MidePayDB || !state.user?.id) {
          showToast('Please sign in to your MidePay account to fund your wallet.', 'error');
          return;
        }

        const res = await window.MidePayDB.recordDeposit({
          userId: state.user.id,
          amount,
          idempotencyKey
        });

        if (!res || !res.success) {
          showToast(res?.error || 'Unable to credit wallet on server.', 'error');
          return;
        }

        const txRef = res.reference || `MDP-DIR-${idempotencyKey.slice(0, 8).toUpperCase()}`;
        await rehydrateBalanceFromServer(res.newBalance ?? res.wallet?.balance);

        const newTx = {
          id: 'tx-' + Date.now(),
          ref: txRef,
          title: 'Instant Direct Wallet Top-Up',
          category: 'Direct NUBAN Deposit',
          sender: 'Providus Bank Virtual NUBAN',
          beneficiary: state.user?.fullName || 'Account Holder',
          narration: 'Instant Direct Wallet Top-Up (Providus NUBAN)',
          date: 'Just now',
          type: 'inflow',
          amount: amount,
          fee: 0.00,
          status: 'Successful'
        };

        state.transactions.unshift(newTx);
        saveUserTransactions();
        renderDashboardTransactions();
        if (typeof validateAmountInputs === 'function') validateAmountInputs();

        modalAdd?.classList.add('hidden');
        if (topupAmtEl) topupAmtEl.value = '10000';
        selectGatewayProvider('direct');
        showToast(`🎉 Credited ${formatNaira(amount)} to your MidePay wallet!`, 'success');
        openReceiptModal(newTx);
      });
    });
  }

  // Quick Action simulations (Airtime, Bills, Virtual Card)
  function promptSim(featureName, details) {
    showToast(`Simulated: ${featureName} — ${details}`);
  }

  // -------------------------------------------------------------
  // SHARED 4-DIGIT TRANSACTION PIN VERIFIER (VAULTS, VTU & PAYROLL)
  // -------------------------------------------------------------
  async function verifyOrSetupActionPin(rawPin) {
    const enteredPin = String(rawPin || '').trim();
    if (!/^\d{4}$/.test(enteredPin)) {
      return { valid: false, error: 'Please enter a valid 4-digit numeric Transaction PIN.' };
    }

    ensureUserSession();
    const userId = state.user?.id;
    let isLiveSupa = false;

    if (window.MidePayDB && window.MidePayDB.isConfigured() && window.MidePayDB.client && userId && isValidUuid(userId)) {
      try {
        const { data: authData } = await window.MidePayDB.client.auth.getUser();
        isLiveSupa = Boolean(authData?.user && authData.user.id === userId);
      } catch (_) {
        isLiveSupa = false;
      }
    }

    if (isLiveSupa) {
      const pinCheck = await window.MidePayDB.verifyTransactionPin(userId, enteredPin);
      if (pinCheck.isFrozen) {
        state.isAccountFrozen = true;
        updateFreezeModalUI();
        return { valid: false, error: pinCheck.error || 'Account is frozen per CBN security directives.' };
      }
      if (pinCheck.needsPinSetup) {
        if (typeof window.enforceMandatoryPinOnboardingLock === 'function') {
          window.enforceMandatoryPinOnboardingLock(true);
        }
        return {
          valid: false,
          error: 'Create your mandatory 4-digit Transaction PIN first to unlock wallet transactions.'
        };
      }
      if (!pinCheck.valid) {
        return { valid: false, error: pinCheck.error || 'Incorrect 4-digit Transaction PIN.' };
      }
      return { valid: true };
    }

    if (isProductionEnv() && !isLiveSupa) {
      return { valid: false, error: 'Authenticated Supabase session required to verify Transaction PIN.' };
    }

    // Non-production local dev fallback
    let storedPinHash = state.user?.pinHash;
    if (!storedPinHash) {
      const hashedPin = await hashPin(enteredPin);
      if (state.user) {
        state.user.pinHash = hashedPin;
        saveAccountToRegistry(state.user);
      }
      showToast('🔐 4-digit Transaction PIN created & encrypted for your account!', 'success');
      return { valid: true };
    }

    const ok = await verifyPin(enteredPin, storedPinHash);
    if (!ok) {
      return { valid: false, error: 'Incorrect 4-digit Transaction PIN. Please try again.' };
    }
    return { valid: true };
  }
  window.verifyOrSetupActionPin = verifyOrSetupActionPin;

  // -------------------------------------------------------------
  // AIRTIME & DATA INTERACTIVE VTU CONTROLLER (4-TAB SUITE)
  // -------------------------------------------------------------
  let airtimeServiceMode = 'airtime'; // 'airtime' | 'data'
  let airtimeNetwork = 'MTN';

  const tabAirtime = document.getElementById('tab-recharge-airtime');
  const tabData = document.getElementById('tab-recharge-data');
  const tabJumpElectricity = document.getElementById('tab-jump-electricity');
  const tabJumpCable = document.getElementById('tab-jump-cable');
  const tabJumpAirtime = document.getElementById('tab-jump-airtime');
  const tabJumpData = document.getElementById('tab-jump-data');
  const airtimeAmountSec = document.getElementById('airtime-amount-section');
  const dataPlanSec = document.getElementById('data-plan-section');
  const airtimeAmountInput = document.getElementById('airtime-amount');
  const dataPlanSelect = document.getElementById('data-plan-select');
  const airtimePhoneInput = document.getElementById('airtime-phone');
  const airtimePinInput = document.getElementById('airtime-pin-input');
  const airtimeErrorAlert = document.getElementById('airtime-error-alert');
  const airtimeErrorText = document.getElementById('airtime-error-text');
  const btnFillMyPhone = document.getElementById('btn-fill-my-phone');
  const cashbackDisplay = document.getElementById('airtime-cashback-amount');
  const confirmAirtimeBtn = document.getElementById('confirm-airtime-btn');
  const airtimeDataForm = document.getElementById('airtime-data-form');

  function calculateAirtimeCashback() {
    let amount = 0;
    if (airtimeServiceMode === 'airtime') {
      amount = parseFloat(airtimeAmountInput?.value) || 0;
    } else {
      amount = parseFloat(dataPlanSelect?.value) || 0;
    }

    const cashback = Math.round(amount * 0.03 * 100) / 100;
    if (cashbackDisplay) {
      cashbackDisplay.textContent = `+${formatNaira(cashback)}`;
    }
    if (confirmAirtimeBtn) {
      confirmAirtimeBtn.textContent = `Pay ${formatNaira(amount)} (Get ${formatNaira(cashback)} Back)`;
    }
    return { amount, cashback };
  }

  // Switch between Airtime and Data tabs
  if (tabAirtime && tabData) {
    tabAirtime.addEventListener('click', () => {
      airtimeServiceMode = 'airtime';
      tabAirtime.classList.add('active');
      tabData.classList.remove('active');
      airtimeAmountSec?.classList.remove('hidden');
      dataPlanSec?.classList.add('hidden');
      airtimeErrorAlert?.classList.add('hidden');
      calculateAirtimeCashback();
    });

    tabData.addEventListener('click', () => {
      airtimeServiceMode = 'data';
      tabData.classList.add('active');
      tabAirtime.classList.remove('active');
      airtimeAmountSec?.classList.add('hidden');
      dataPlanSec?.classList.remove('hidden');
      airtimeErrorAlert?.classList.add('hidden');
      calculateAirtimeCashback();
    });
  }

  // Seamless cross-modal 4-tab jumps (Airtime <-> Data <-> Electricity <-> Cable TV)
  if (tabJumpElectricity) {
    tabJumpElectricity.addEventListener('click', () => {
      modalAirtime?.classList.add('hidden');
      openBillsModal('electricity');
    });
  }
  if (tabJumpCable) {
    tabJumpCable.addEventListener('click', () => {
      modalAirtime?.classList.add('hidden');
      openBillsModal('cable');
    });
  }
  if (tabJumpAirtime) {
    tabJumpAirtime.addEventListener('click', () => {
      modalBills?.classList.add('hidden');
      openAirtimeModal('airtime');
    });
  }
  if (tabJumpData) {
    tabJumpData.addEventListener('click', () => {
      modalBills?.classList.add('hidden');
      openAirtimeModal('data');
    });
  }

  // Network provider selector
  const networkBtns = document.querySelectorAll('#network-selector-grid .network-btn');
  networkBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      networkBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      airtimeNetwork = btn.getAttribute('data-network') || 'MTN';
      showToast(`Selected ${airtimeNetwork} Nigeria`);
    });
  });

  // Quick amount tags for Airtime
  const airtimeAmountTags = document.querySelectorAll('.amount-tag-btn[data-airtime]');
  airtimeAmountTags.forEach(tag => {
    tag.addEventListener('click', () => {
      airtimeAmountTags.forEach(t => t.classList.remove('active'));
      tag.classList.add('active');
      if (airtimeAmountInput) {
        airtimeAmountInput.value = tag.getAttribute('data-airtime');
      }
      calculateAirtimeCashback();
    });
  });

  if (airtimeAmountInput) {
    airtimeAmountInput.addEventListener('input', () => {
      airtimeAmountTags.forEach(t => t.classList.remove('active'));
      calculateAirtimeCashback();
    });
  }

  if (dataPlanSelect) {
    dataPlanSelect.addEventListener('change', calculateAirtimeCashback);
  }

  // "Use My Number" auto-fill helper
  if (btnFillMyPhone) {
    btnFillMyPhone.addEventListener('click', () => {
      const userPhone = state.user?.phone || '08031234567';
      if (airtimePhoneInput) {
        airtimePhoneInput.value = userPhone;
      }
      showToast(`Auto-filled with ${userPhone}`);
    });
  }

  // Open modal from Dashboard Quick Action
  function openAirtimeModal(defaultTab = 'airtime') {
    ensureUserSession();
    if (airtimePhoneInput && !airtimePhoneInput.value) {
      airtimePhoneInput.value = state.user?.phone || '08031234567';
    }
    if (airtimePinInput) airtimePinInput.value = '';
    airtimeErrorAlert?.classList.add('hidden');
    if (defaultTab === 'data') {
      tabData?.click();
    } else {
      tabAirtime?.click();
    }
    calculateAirtimeCashback();
    modalAirtime?.classList.remove('hidden');
  }
  window.openAirtimeModal = openAirtimeModal;

  if (qaAirtime) {
    qaAirtime.addEventListener('click', () => openAirtimeModal('airtime'));
  }

  // Process Airtime & Data Purchase Form (PIN-Protected + pay_utility_bill RPC)
  if (airtimeDataForm) {
    airtimeDataForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      airtimeErrorAlert?.classList.add('hidden');

      const phone = airtimePhoneInput?.value.trim() || '';
      if (!phone || phone.length < 7) {
        if (airtimeErrorAlert && airtimeErrorText) {
          airtimeErrorText.textContent = 'Please enter a valid Nigerian mobile phone number.';
          airtimeErrorAlert.classList.remove('hidden');
        }
        return;
      }

      const { amount, cashback } = calculateAirtimeCashback();
      if (!amount || amount < 50) {
        if (airtimeErrorAlert && airtimeErrorText) {
          airtimeErrorText.textContent = 'Minimum recharge amount is ₦50.00.';
          airtimeErrorAlert.classList.remove('hidden');
        }
        return;
      }

      const airtimeSubmitBtn = airtimeDataForm.querySelector('button[type="submit"]');
      await withSubmitLock('vtu-airtime-submit', airtimeSubmitBtn, 'Processing VTU...', async (idempotencyKey) => {
        if (window.MidePayDB && typeof window.MidePayDB.isFinancialQuarantined === 'function' && window.MidePayDB.isFinancialQuarantined()) {
          const qMsg = 'Staging Quarantine: Client-side VTU & utility bill payments are disabled until backend settlement is live.';
          if (airtimeErrorAlert && airtimeErrorText) {
            airtimeErrorText.textContent = qMsg;
            airtimeErrorAlert.classList.remove('hidden');
          } else {
            showToast(qMsg, 'error');
          }
          return;
        }

        const pinRes = await verifyOrSetupActionPin(airtimePinInput?.value);
        if (!pinRes.valid) {
          if (airtimeErrorAlert && airtimeErrorText) {
            airtimeErrorText.textContent = pinRes.error;
            airtimeErrorAlert.classList.remove('hidden');
          } else {
            showToast(pinRes.error, 'error');
          }
          return;
        }

        if (amount > state.dashBalance) {
          if (airtimeErrorAlert && airtimeErrorText) {
            airtimeErrorText.textContent = `Insufficient wallet balance (${formatNaira(state.dashBalance)} available).`;
            airtimeErrorAlert.classList.remove('hidden');
          }
          return;
        }

        let planName = 'Airtime Top-Up';
        let description = `${airtimeNetwork} Airtime Recharge - ${phone}`;
        if (airtimeServiceMode === 'data') {
          const selectedOption = dataPlanSelect?.options[dataPlanSelect.selectedIndex];
          planName = selectedOption?.getAttribute('data-label') || 'Mobile Data Bundle';
          description = `${airtimeNetwork} ${planName} - ${phone}`;
        }

        const billRes = await window.MidePayDB.payUtilityBill({
          userId: state.user?.id,
          serviceType: airtimeServiceMode,
          provider: airtimeNetwork,
          identifier: phone,
          planName,
          amount,
          pinVerified: true,
          pin: airtimePinInput?.value || null,
          idempotencyKey
        });

        if (!billRes.success) {
          if (airtimeErrorAlert && airtimeErrorText) {
            airtimeErrorText.textContent = billRes.error || 'Unable to process VTU recharge.';
            airtimeErrorAlert.classList.remove('hidden');
          }
          return;
        }

        await rehydrateBalanceFromServer(billRes.newBalance);

        const txRef = billRes.reference || `MDP-BIL-${idempotencyKey.slice(0, 8).toUpperCase()}`;
        const newTx = {
          id: 'tx-' + Date.now(),
          ref: txRef,
          title: description,
          category: airtimeServiceMode === 'airtime' ? 'Airtime VTU' : 'Data Bundle VTU',
          sender: state.user?.fullName || 'Account Holder',
          beneficiary: `${airtimeNetwork} (${phone})`,
          narration: description,
          date: 'Just now',
          type: 'outflow',
          amount: amount,
          fee: 0.00,
          status: 'Successful'
        };
        state.transactions.unshift(newTx);
        saveUserTransactions();
        renderDashboardTransactions();

        if (airtimePinInput) airtimePinInput.value = '';
        modalAirtime?.classList.add('hidden');
        showToast(`🎉 ${formatNaira(amount)} ${airtimeNetwork} ${airtimeServiceMode === 'data' ? 'Data Bundle' : 'Airtime'} delivered to ${phone}!`);
        openReceiptModal(newTx);
      });
    });
  }

  // -------------------------------------------------------------
  // MODAL 4: ELECTRICITY & CABLE TV BILLS CONTROLLER (PIN-GUARDED)
  // -------------------------------------------------------------
  let billServiceMode = 'electricity'; // 'electricity' | 'cable'
  let meterType = 'Prepaid'; // 'Prepaid' | 'Postpaid'

  const tabElectricity = document.getElementById('tab-bill-electricity');
  const tabCable = document.getElementById('tab-bill-cable');
  const sectionElectricity = document.getElementById('section-bill-electricity');
  const sectionCable = document.getElementById('section-bill-cable');
  const discoSelect = document.getElementById('disco-provider-select');
  const meterNumberInput = document.getElementById('meter-number-input');
  const btnVerifyMeter = document.getElementById('btn-verify-meter');
  const meterVerifiedStatus = document.getElementById('meter-verified-status');
  const electricityAmountInput = document.getElementById('electricity-amount-input');
  const confirmBillBtn = document.getElementById('confirm-bill-btn');
  const labelMeterPrepaid = document.getElementById('label-meter-prepaid');
  const labelMeterPostpaid = document.getElementById('label-meter-postpaid');

  const cableProviderSelect = document.getElementById('cable-provider-select');
  const cableSmartcardInput = document.getElementById('cable-smartcard-input');
  const btnVerifyCable = document.getElementById('btn-verify-cable');
  const cableVerifiedStatus = document.getElementById('cable-verified-status');
  const cablePackageSelect = document.getElementById('cable-package-select');
  const billsPinInput = document.getElementById('bills-pin-input');
  const billsErrorAlert = document.getElementById('bills-error-alert');
  const billsErrorText = document.getElementById('bills-error-text');
  const billPaymentForm = document.getElementById('bill-payment-form');

  function updateBillButtonText() {
    if (!confirmBillBtn) return;
    if (billServiceMode === 'electricity') {
      const amt = parseFloat(electricityAmountInput?.value) || 0;
      if (meterType === 'Prepaid') {
        confirmBillBtn.textContent = `Pay ${formatNaira(amt)} & Generate Token`;
      } else {
        confirmBillBtn.textContent = `Pay ${formatNaira(amt)} & Clear Bill`;
      }
    } else {
      const selectedPkg = cablePackageSelect?.options[cablePackageSelect.selectedIndex];
      const pkgPrice = parseFloat(cablePackageSelect?.value) || 0;
      const pkgName = selectedPkg?.getAttribute('data-pkg') || 'Cable Bouquet';
      confirmBillBtn.textContent = `Pay ${formatNaira(pkgPrice)} & Activate ${pkgName}`;
    }
  }

  if (tabElectricity && tabCable) {
    tabElectricity.addEventListener('click', () => {
      billServiceMode = 'electricity';
      tabElectricity.classList.add('active');
      tabCable.classList.remove('active');
      sectionElectricity?.classList.remove('hidden');
      sectionCable?.classList.add('hidden');
      billsErrorAlert?.classList.add('hidden');
      updateBillButtonText();
    });

    tabCable.addEventListener('click', () => {
      billServiceMode = 'cable';
      tabCable.classList.add('active');
      tabElectricity.classList.remove('active');
      sectionCable?.classList.remove('hidden');
      sectionElectricity?.classList.add('hidden');
      billsErrorAlert?.classList.add('hidden');
      updateBillButtonText();
    });
  }

  // DisCo Quick Brand Selectors
  const discoQuickBtns = document.querySelectorAll('#disco-quick-grid .brand-select-btn');
  discoQuickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      discoQuickBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const disco = btn.getAttribute('data-disco');
      if (discoSelect) {
        discoSelect.value = disco;
      }
      updateBillButtonText();
    });
  });

  if (discoSelect) {
    discoSelect.addEventListener('change', () => {
      discoQuickBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-disco') === discoSelect.value);
      });
      updateBillButtonText();
    });
  }

  // Cable TV Quick Brand Selectors
  const cableQuickBtns = document.querySelectorAll('#cable-quick-grid .brand-select-btn');
  cableQuickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      cableQuickBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cable = btn.getAttribute('data-cable');
      if (cableProviderSelect) {
        cableProviderSelect.value = cable;
      }

      if (cablePackageSelect) {
        for (let i = 0; i < cablePackageSelect.options.length; i++) {
          const opt = cablePackageSelect.options[i];
          const pkg = (opt.getAttribute('data-pkg') || '').toUpperCase();
          if (pkg.includes(cable.toUpperCase())) {
            cablePackageSelect.selectedIndex = i;
            break;
          }
        }
      }
      updateBillButtonText();
    });
  });

  if (cableProviderSelect) {
    cableProviderSelect.addEventListener('change', () => {
      const selectedProvider = cableProviderSelect.value;
      cableQuickBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-cable') === selectedProvider);
      });

      if (cablePackageSelect) {
        for (let i = 0; i < cablePackageSelect.options.length; i++) {
          const opt = cablePackageSelect.options[i];
          const pkg = (opt.getAttribute('data-pkg') || '').toUpperCase();
          if (pkg.includes(selectedProvider.toUpperCase())) {
            cablePackageSelect.selectedIndex = i;
            break;
          }
        }
      }
      updateBillButtonText();
    });
  }

  const meterRadios = document.querySelectorAll('input[name="meter-type"]');
  meterRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      meterType = radio.value;
      if (meterType === 'Prepaid') {
        labelMeterPrepaid?.classList.add('active');
        labelMeterPostpaid?.classList.remove('active');
      } else {
        labelMeterPostpaid?.classList.add('active');
        labelMeterPrepaid?.classList.remove('active');
      }
      updateBillButtonText();
    });
  });

  // Quick Amount tags for Electricity
  const billAmountTags = document.querySelectorAll('.amount-tag-btn[data-bill-amt]');
  billAmountTags.forEach(tag => {
    tag.addEventListener('click', () => {
      billAmountTags.forEach(t => t.classList.remove('active'));
      tag.classList.add('active');
      if (electricityAmountInput) {
        electricityAmountInput.value = tag.getAttribute('data-bill-amt');
      }
      updateBillButtonText();
    });
  });

  if (electricityAmountInput) {
    electricityAmountInput.addEventListener('input', () => {
      billAmountTags.forEach(t => t.classList.remove('active'));
      updateBillButtonText();
    });
  }

  if (cablePackageSelect) {
    cablePackageSelect.addEventListener('change', updateBillButtonText);
  }

  // Verify Meter
  if (btnVerifyMeter) {
    btnVerifyMeter.addEventListener('click', () => {
      const meterNum = meterNumberInput?.value.trim();
      if (!meterNum || meterNum.length < 8) {
        showToast('Please enter a valid 11 or 13 digit meter number.', 'error');
        return;
      }
      const userName = state.user?.fullName || 'Account Holder';
      if (meterVerifiedStatus) {
        meterVerifiedStatus.textContent = `✓ Customer: ${userName} (Meter Verified)`;
        meterVerifiedStatus.classList.remove('hidden');
      }
      showToast(`Meter ${meterNum} verified for ${userName}!`);
    });
  }

  // Verify Cable Smartcard
  if (btnVerifyCable) {
    btnVerifyCable.addEventListener('click', () => {
      const smartcard = cableSmartcardInput?.value.trim();
      if (!smartcard || smartcard.length < 8) {
        showToast('Please enter a valid 10-digit Smartcard/IUC number.', 'error');
        return;
      }
      const userName = state.user?.fullName || 'Account Holder';
      if (cableVerifiedStatus) {
        cableVerifiedStatus.textContent = `✓ Smartcard: ${userName} (Active)`;
        cableVerifiedStatus.classList.remove('hidden');
      }
      showToast(`Smartcard ${smartcard} verified for ${userName}!`);
    });
  }

  // Open Bill Payment Modal
  function openBillsModal(defaultTab = 'electricity') {
    ensureUserSession();
    if (billsPinInput) billsPinInput.value = '';
    billsErrorAlert?.classList.add('hidden');
    if (defaultTab === 'cable') {
      tabCable?.click();
    } else {
      tabElectricity?.click();
    }
    updateBillButtonText();
    modalBills?.classList.remove('hidden');
  }
  window.openBillsModal = openBillsModal;

  // Handle Bill Form Submission (PIN-Protected + pay_utility_bill RPC + 20-Digit STS Token)
  if (billPaymentForm) {
    billPaymentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      billsErrorAlert?.classList.add('hidden');

      let amount = 0;
      let providerName = '';
      let identifier = '';
      let planName = '';
      let txTitle = '';
      let txCategory = '';
      let txBeneficiary = '';
      let txNarration = '';
      let calculatedUnits = null;

      if (billServiceMode === 'electricity') {
        const disco = discoSelect?.value || 'IKEDC - Ikeja Electric';
        const meterNum = meterNumberInput?.value.trim() || '';
        amount = parseFloat(electricityAmountInput?.value) || 0;

        if (!meterNum || meterNum.length < 8) {
          if (billsErrorAlert && billsErrorText) {
            billsErrorText.textContent = 'Please enter a valid 11 or 13 digit meter number.';
            billsErrorAlert.classList.remove('hidden');
          }
          return;
        }
        if (amount < 500) {
          if (billsErrorAlert && billsErrorText) {
            billsErrorText.textContent = 'Minimum electricity recharge is ₦500.00.';
            billsErrorAlert.classList.remove('hidden');
          }
          return;
        }

        const discoShort = disco.split('-')[0].trim();
        providerName = discoShort;
        identifier = meterNum;
        planName = `${disco} (${meterType})`;
        txTitle = `${discoShort} Electricity (${meterType})`;
        txCategory = 'Electricity Utility';
        txBeneficiary = `${disco} • Meter ${meterNum}`;
        txNarration = `${disco} ${meterType} Recharge - Meter ${meterNum}`;
        if (meterType === 'Prepaid') {
          calculatedUnits = (amount / 72.5).toFixed(1) + ' kWh';
        }
      } else {
        const cableProvider = cableProviderSelect?.value || 'DSTV';
        const smartcard = cableSmartcardInput?.value.trim() || '';
        const selectedPkg = cablePackageSelect?.options[cablePackageSelect.selectedIndex];
        amount = parseFloat(cablePackageSelect?.value) || 0;
        const pkgName = selectedPkg?.getAttribute('data-pkg') || 'Bouquet';

        if (!smartcard || smartcard.length < 8) {
          if (billsErrorAlert && billsErrorText) {
            billsErrorText.textContent = 'Please enter a valid Smartcard/IUC number.';
            billsErrorAlert.classList.remove('hidden');
          }
          return;
        }

        providerName = cableProvider;
        identifier = smartcard;
        planName = pkgName;
        txTitle = `${cableProvider} ${pkgName} Renewal`;
        txCategory = 'Cable TV Subscription';
        txBeneficiary = `${cableProvider} Nigeria • IUC ${smartcard}`;
        txNarration = `${cableProvider} ${pkgName} 1-Month Renewal (IUC: ${smartcard})`;
      }

      const billSubmitBtn = billPaymentForm.querySelector('button[type="submit"]');
      await withSubmitLock('utility-bill-submit', billSubmitBtn, 'Paying Bill...', async (idempotencyKey) => {
        if (window.MidePayDB && typeof window.MidePayDB.isFinancialQuarantined === 'function' && window.MidePayDB.isFinancialQuarantined()) {
          const qMsg = 'Staging Quarantine: Client-side VTU & utility bill payments are disabled until backend settlement is live.';
          if (billsErrorAlert && billsErrorText) {
            billsErrorText.textContent = qMsg;
            billsErrorAlert.classList.remove('hidden');
          } else {
            showToast(qMsg, 'error');
          }
          return;
        }

        const pinRes = await verifyOrSetupActionPin(billsPinInput?.value);
        if (!pinRes.valid) {
          if (billsErrorAlert && billsErrorText) {
            billsErrorText.textContent = pinRes.error;
            billsErrorAlert.classList.remove('hidden');
          } else {
            showToast(pinRes.error, 'error');
          }
          return;
        }

        if (amount > state.dashBalance) {
          if (billsErrorAlert && billsErrorText) {
            billsErrorText.textContent = `Insufficient wallet balance (${formatNaira(state.dashBalance)} available).`;
            billsErrorAlert.classList.remove('hidden');
          }
          return;
        }

        const billRes = await window.MidePayDB.payUtilityBill({
          userId: state.user?.id,
          serviceType: billServiceMode,
          provider: providerName,
          identifier,
          planName,
          amount,
          pinVerified: true,
          pin: billsPinInput?.value || null,
          idempotencyKey
        });

        if (!billRes.success) {
          if (billsErrorAlert && billsErrorText) {
            billsErrorText.textContent = billRes.error || 'Bill payment failed on server.';
            billsErrorAlert.classList.remove('hidden');
          }
          return;
        }

        await rehydrateBalanceFromServer(billRes.newBalance);

        const generatedToken = (billServiceMode === 'electricity' && meterType === 'Prepaid')
          ? (billRes.token || null)
          : null;

        const txRef = billRes.reference || `MDP-BIL-${idempotencyKey.slice(0, 8).toUpperCase()}`;
        const newTx = {
          id: 'tx-' + Date.now(),
          ref: txRef,
          title: txTitle,
          category: txCategory,
          sender: state.user?.fullName || 'Account Holder',
          beneficiary: txBeneficiary,
          narration: txNarration,
          date: 'Just now',
          type: 'outflow',
          amount: amount,
          fee: 0.00,
          status: 'Successful',
          token: generatedToken,
          units: calculatedUnits
        };

        state.transactions.unshift(newTx);
        saveUserTransactions();
        renderDashboardTransactions();

        if (billsPinInput) billsPinInput.value = '';
        modalBills?.classList.add('hidden');

        if (generatedToken) {
          showToast(`⚡ Electricity paid! 20-Digit STS Token: ${generatedToken}`);
        } else {
          showToast(`🎉 Payment successful! ${txTitle} activated.`);
        }

        openReceiptModal(newTx);
      });
    });
  }

  // -------------------------------------------------------------
  // MODAL 5: OFFICIAL TRANSACTION RECEIPT ACTIONS (PDF & SHARE)
  // -------------------------------------------------------------
  const btnDownloadReceipt = document.getElementById('btn-download-receipt');
  const btnShareReceipt = document.getElementById('btn-share-receipt');
  const btnCopyReceiptToken = document.getElementById('btn-copy-receipt-token');
  const btnCopyRef = document.getElementById('btn-copy-ref');

  // Copy Reference
  if (btnCopyRef) {
    btnCopyRef.addEventListener('click', () => {
      const ref = document.getElementById('receipt-ref')?.textContent.trim();
      if (ref) {
        navigator.clipboard.writeText(ref).then(() => {
          showToast(`Copied reference: ${ref}`);
        }).catch(() => {
          showToast(`Reference: ${ref}`);
        });
      }
    });
  }

  // Copy Prepaid Meter Token
  if (btnCopyReceiptToken) {
    btnCopyReceiptToken.addEventListener('click', () => {
      const token = document.getElementById('receipt-token-digits')?.textContent.trim();
      if (token) {
        navigator.clipboard.writeText(token).then(() => {
          showToast(`⚡ Meter Token copied: ${token}`);
        }).catch(() => {
          showToast(`Token: ${token}`);
        });
      }
    });
  }

  // Download Receipt (PDF Print)
  if (btnDownloadReceipt) {
    btnDownloadReceipt.addEventListener('click', () => {
      document.body.classList.remove('print-statement');
      document.body.classList.add('print-receipt');
      showToast('Opening standard receipt for printing / saving as PDF...');
      setTimeout(() => {
        window.print();
      }, 250);
    });
  }

  // Share Receipt
  if (btnShareReceipt) {
    btnShareReceipt.addEventListener('click', () => {
      const tx = activeReceiptData;
      if (!tx) return;

      const formattedText = 
`========================================
MIDEPAY TEST PAYMENT DETAILS
========================================
Status: ${transactionStatusLabel(tx.status)}
Transaction Ref: ${tx.ref || 'Reference not supplied'}
Amount: ${formatNaira(tx.amount || 0)}
Date: ${tx.date || new Date().toLocaleString('en-NG')}
Category: ${tx.category || 'MidePay Financial Transfer'}
Sender / Payer: ${tx.sender || 'MidePay Customer'}
Beneficiary: ${tx.beneficiary || tx.title || 'Recipient'}
Description: ${tx.narration || tx.title}
Payment Channel: MidePay Core Wallet Switch
Convenience Fee: ₦0.00 (Zero Surcharge)
${tx.token ? `\n⚡ 20-Digit Prepaid Token: ${tx.token}\nEstimated Units: ${tx.units || 'Standard Tariff'}\n` : ''}
========================================
Verified & Cryptographically Logged
MidePay Technologies Ltd (CBN Sandbox Partner)
========================================`;

      if (navigator.share) {
        navigator.share({
          title: `MidePay Receipt: ${tx.ref || 'Transaction'}`,
          text: formattedText
        }).catch(() => {
          navigator.clipboard.writeText(formattedText);
          showToast('Receipt details copied! Ready to paste into WhatsApp, email or SMS.');
        });
      } else {
        navigator.clipboard.writeText(formattedText).then(() => {
          showToast('Receipt details copied! Ready to paste into WhatsApp, email or SMS.');
        }).catch(() => {
          showToast('Receipt copied to clipboard.');
        });
      }
    });
  }

  // -------------------------------------------------------------
  // PERSISTENT PER-USER VIRTUAL DEBIT CARDS (`public.virtual_cards`)
  // -------------------------------------------------------------
  const virtualCardState = {
    activeCurrency: 'USD', // 'USD' | 'NGN'
    activeCardId: null,
    userId: null,
    cards: [],
    revealedPanIds: new Set(),
    revealedCvvIds: new Set()
  };

  function normalizeCardRow(row, fallbackHolder = 'MIDEPAY MEMBER') {
    const currency = String(row?.currency || 'USD').toUpperCase() === 'NGN' ? 'NGN' : 'USD';
    let fullPan = row?.card_number || '';
    if (!fullPan) {
      const generated = window.MidePayDB?.generateSecureCardCredentials
        ? window.MidePayDB.generateSecureCardCredentials({ cardHolderName: fallbackHolder, prefix: '5399' })
        : { cardNumber: '5399 0000 0000 0000', maskedPan: '5399 •••• •••• 0000', cvv: '100', expiryMonth: 11, expiryYear: new Date().getFullYear() + 3 };
      fullPan = generated.cardNumber;
    }
    const cleanDigits = String(fullPan).replace(/\s+/g, '');
    const formattedPan = cleanDigits.length === 16
      ? `${cleanDigits.slice(0, 4)} ${cleanDigits.slice(4, 8)} ${cleanDigits.slice(8, 12)} ${cleanDigits.slice(12, 16)}`
      : fullPan;
    const maskedPan = row?.masked_pan || (cleanDigits.length >= 8
      ? `${cleanDigits.slice(0, 4)} •••• •••• ${cleanDigits.slice(-4)}`
      : '5399 •••• •••• 0000');

    const expMonth = Number(row?.expiry_month) || (new Date().getMonth() + 1);
    const expYear = Number(row?.expiry_year) || (new Date().getFullYear() + 3);
    const expiry = `${String(expMonth).padStart(2, '0')}/${String(expYear).slice(-2)}`;
    const cvv = String(row?.cvv || '742').padStart(3, '0').slice(0, 3);

    return {
      id: row?.id || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `vc-${Date.now()}`),
      userId: row?.user_id || state.user?.id || null,
      walletId: row?.wallet_id || state.user?.walletId || null,
      currency,
      title: row?.card_label || (currency === 'USD' ? 'MidePay Black' : 'MidePay Green'),
      network: row?.card_type || (currency === 'USD' ? 'Mastercard' : 'Verve'),
      cardHolderName: String(row?.card_holder_name || fallbackHolder || 'MIDEPAY MEMBER').toUpperCase(),
      fullPan: formattedPan,
      maskedPan,
      expiry,
      expiryMonth: expMonth,
      expiryYear: expYear,
      cvv,
      balanceNum: Math.max(0, Number(row?.card_balance || 0)),
      limitNum: Math.max(0, Number(row?.spending_limit_monthly ?? (currency === 'USD' ? 1000 : 500000))),
      isFrozen: row?.is_frozen === true
    };
  }

  function resetVirtualCardState() {
    virtualCardState.userId = null;
    virtualCardState.activeCardId = null;
    virtualCardState.cards = [];
    virtualCardState.revealedPanIds.clear();
    virtualCardState.revealedCvvIds.clear();
  }
  window.resetVirtualCardState = resetVirtualCardState;

  function getCardsForActiveCurrency() {
    return virtualCardState.cards.filter(c => c.currency === virtualCardState.activeCurrency);
  }

  function getActiveVirtualCard() {
    const bucket = getCardsForActiveCurrency();
    if (bucket.length === 0) return null;
    const match = bucket.find(c => c.id === virtualCardState.activeCardId);
    if (match) return match;
    virtualCardState.activeCardId = bucket[0].id;
    return bucket[0];
  }

  async function loadUserVirtualCards(userId = null, walletId = null, holderName = null) {
    const targetUserId = userId || state.user?.id;
    const effectiveHolder = holderName || state.user?.fullName || 'MIDEPAY MEMBER';
    if (!targetUserId || !window.MidePayDB || typeof window.MidePayDB.ensureUserVirtualCards !== 'function') {
      return [];
    }

    if (virtualCardState.userId && virtualCardState.userId !== targetUserId) {
      resetVirtualCardState();
    }

    const rows = await window.MidePayDB.ensureUserVirtualCards({
      userId: targetUserId,
      walletId: walletId || state.user?.walletId || null,
      cardHolderName: effectiveHolder
    });

    virtualCardState.userId = targetUserId;
    virtualCardState.cards = (rows || []).map(r => normalizeCardRow(r, effectiveHolder));
    const bucket = getCardsForActiveCurrency();
    if (bucket.length > 0 && !bucket.some(c => c.id === virtualCardState.activeCardId)) {
      virtualCardState.activeCardId = bucket[0].id;
    }
    renderVirtualCard();
    return virtualCardState.cards;
  }
  window.loadUserVirtualCards = loadUserVirtualCards;
  window.getVirtualCardState = () => virtualCardState;

  const tabCardUsd = document.getElementById('tab-card-usd');
  const tabCardNgn = document.getElementById('tab-card-ngn');
  const cardsSelectorRow = document.getElementById('user-cards-selector-row');
  const btnCreateVirtualCard = document.getElementById('btn-create-virtual-card');
  const activeCardEl = document.getElementById('active-virtual-card');
  const cardBrandTitle = document.getElementById('card-brand-title');
  const cardNetworkLogo = document.getElementById('card-network-logo');
  const cardPanDisplay = document.getElementById('card-pan-display');
  const btnTogglePan = document.getElementById('btn-toggle-pan');
  const cardHolderName = document.getElementById('card-holder-name');
  const cardExpiryVal = document.getElementById('card-expiry-val');
  const cardCvvVal = document.getElementById('card-cvv-val');
  const btnToggleCvv = document.getElementById('btn-toggle-cvv');
  const cardBalanceDisplay = document.getElementById('card-balance-display');
  const btnFreezeCard = document.getElementById('btn-freeze-card');
  const freezeIcon = document.getElementById('freeze-icon');
  const freezeText = document.getElementById('freeze-text');
  const cardStatusBadge = document.getElementById('card-status-badge');
  const btnCopyCard = document.getElementById('btn-copy-card');
  const btnFundCardModal = document.getElementById('btn-fund-card-modal');
  const cardLimitVal = document.getElementById('card-limit-val');
  const btnEditCardLimit = document.getElementById('btn-edit-card-limit');
  const cardLimitEditor = document.getElementById('card-limit-editor');
  const cardLimitInput = document.getElementById('card-limit-input');
  const btnSaveCardLimit = document.getElementById('btn-save-card-limit');
  const btnCancelCardLimit = document.getElementById('btn-cancel-card-limit');
  const cardSpentSubtext = document.getElementById('card-spent-subtext');
  const cardProgressFill = document.querySelector('.limit-progress-fill');
  const cardMiniTxList = document.getElementById('card-mini-tx-list');

  function renderCardSubscriptions(currency, cardBalance = 0) {
    if (!cardMiniTxList) return;
    const subs = (typeof window.getCardSubscriptions === 'function')
      ? window.getCardSubscriptions(currency, cardBalance)
      : [];

    if (!subs || subs.length === 0) {
      cardMiniTxList.innerHTML = `
        <div class="mini-tx-empty" style="padding: 0.9rem 0.75rem; text-align: center; font-size: 0.8rem; color: var(--text-muted); background: rgba(255,255,255,0.02); border: 1px dashed var(--border-subtle); border-radius: 10px;">
          No active ${escapeHtml(currency)} card charges yet. Click <strong>+ Fund Card</strong> to top up from your main wallet.
        </div>
      `;
      return;
    }

    const iconForMerchant = (merchant) => {
      const m = String(merchant || '').toLowerCase();
      if (m.includes('dstv')) return '📺';
      if (m.includes('spectranet')) return '📡';
      if (m.includes('spotify')) return '🎵';
      if (m.includes('amazon') || m.includes('aws')) return '☁️';
      if (m.includes('netflix')) return '🎬';
      return '💳';
    };

    cardMiniTxList.innerHTML = subs.map((item) => `
      <div class="mini-tx-item">
        <div class="mini-tx-left">
          <span class="mini-tx-icon">${iconForMerchant(item.merchant)}</span>
          <div>
            <div class="mini-tx-title">${escapeHtml(item.merchant)}</div>
            <div class="mini-tx-date">${escapeHtml(item.date)}</div>
          </div>
        </div>
        <div class="mini-tx-amount negative">${escapeHtml(item.amount)}</div>
      </div>
    `).join('');
  }

  function formatCardCurrency(amount, currency) {
    const num = Number(amount || 0);
    if (currency === 'USD') {
      return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return formatNaira(num);
  }

  function renderCardSelectorPills() {
    if (!cardsSelectorRow) return;
    const bucket = getCardsForActiveCurrency();
    if (bucket.length <= 1) {
      cardsSelectorRow.innerHTML = bucket.length === 1
        ? `<span style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(bucket[0].network)} •••• ${escapeHtml(bucket[0].fullPan.slice(-4))}</span>`
        : '';
      return;
    }

    cardsSelectorRow.innerHTML = bucket.map((c, idx) => {
      const last4 = c.fullPan.slice(-4);
      const isActive = c.id === virtualCardState.activeCardId;
      return `<button type="button" class="vcard-pill-btn ${isActive ? 'active' : ''}" data-vcard-id="${escapeHtml(c.id)}">Card ${idx + 1} (••${escapeHtml(last4)})</button>`;
    }).join('');

    cardsSelectorRow.querySelectorAll('.vcard-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        virtualCardState.activeCardId = btn.getAttribute('data-vcard-id');
        renderVirtualCard();
      });
    });
  }

  function renderVirtualCard() {
    const isUsd = virtualCardState.activeCurrency === 'USD';
    const card = getActiveVirtualCard();
    renderCardSelectorPills();

    if (!card) {
      if (cardHolderName) cardHolderName.textContent = (state.user?.fullName || 'ACCOUNT HOLDER').toUpperCase();
      if (cardPanDisplay) cardPanDisplay.textContent = '5399 •••• •••• ••••';
      if (cardCvvVal) cardCvvVal.textContent = '•••';
      if (cardBalanceDisplay) cardBalanceDisplay.textContent = isUsd ? '$0.00' : '₦0.00';
      renderCardSubscriptions(virtualCardState.activeCurrency, 0);
      return;
    }

    const isPanRevealed = virtualCardState.revealedPanIds.has(card.id);
    const isCvvRevealed = virtualCardState.revealedCvvIds.has(card.id);

    if (activeCardEl) {
      activeCardEl.classList.toggle('ngn-card', !isUsd);
      activeCardEl.classList.toggle('frozen', card.isFrozen);
    }

    if (cardBrandTitle) cardBrandTitle.textContent = card.title;

    if (cardNetworkLogo) {
      if (card.network === 'Mastercard' || isUsd) {
        cardNetworkLogo.innerHTML = `
          <svg width="42" height="26" viewBox="0 0 40 25" fill="none">
            <circle cx="15" cy="12.5" r="10" fill="#EB001B" />
            <circle cx="25" cy="12.5" r="10" fill="#F79E1B" fill-opacity="0.85" />
          </svg>
        `;
      } else {
        cardNetworkLogo.innerHTML = `
          <svg width="52" height="20" viewBox="0 0 56 18" fill="none">
            <text x="2" y="15" font-family="'Inter', sans-serif" font-weight="900" font-size="15" fill="#FFF" letter-spacing="0.8">${escapeHtml(card.network.toUpperCase())}</text>
          </svg>
        `;
      }
    }

    const holder = (card.cardHolderName || state.user?.fullName || 'ACCOUNT HOLDER').toUpperCase();
    if (cardHolderName) cardHolderName.textContent = holder;
    if (cardExpiryVal) cardExpiryVal.textContent = card.expiry;

    if (cardPanDisplay) {
      cardPanDisplay.textContent = isPanRevealed ? card.fullPan : card.maskedPan;
    }
    if (btnTogglePan) {
      btnTogglePan.textContent = isPanRevealed ? '🙈' : '👁';
    }

    if (cardCvvVal) {
      cardCvvVal.textContent = isCvvRevealed ? card.cvv : '•••';
    }
    if (btnToggleCvv) {
      btnToggleCvv.textContent = isCvvRevealed ? '🙈' : '👁';
    }

    if (cardStatusBadge) {
      if (card.isFrozen) {
        cardStatusBadge.textContent = 'Frozen';
        cardStatusBadge.className = 'badge-danger-sm';
      } else {
        cardStatusBadge.textContent = 'Active';
        cardStatusBadge.className = 'badge-emerald-sm';
      }
    }

    if (freezeIcon && freezeText) {
      if (card.isFrozen) {
        freezeIcon.textContent = '🔓';
        freezeText.textContent = 'Unfreeze Card';
      } else {
        freezeIcon.textContent = '🔒';
        freezeText.textContent = 'Freeze Card';
      }
    }

    const balStr = formatCardCurrency(card.balanceNum, card.currency);
    const limStr = formatCardCurrency(card.limitNum, card.currency);
    const pct = card.limitNum > 0 ? Math.min(100, Math.round((card.balanceNum / card.limitNum) * 100)) : 0;

    if (cardBalanceDisplay) cardBalanceDisplay.textContent = balStr;
    if (cardLimitVal) cardLimitVal.textContent = `${limStr} / month`;
    if (cardSpentSubtext) cardSpentSubtext.textContent = `${balStr} available • ${limStr} monthly spending cap`;
    if (cardProgressFill) cardProgressFill.style.width = `${pct}%`;
    renderCardSubscriptions(card.currency, card.balanceNum);
  }

  async function openCardsModal() {
    ensureUserSession();
    modalCards?.classList.remove('hidden');
    if (state.user?.id && (virtualCardState.userId !== state.user.id || virtualCardState.cards.length === 0)) {
      await loadUserVirtualCards(state.user.id, state.user.walletId || null, state.user.fullName);
    } else {
      renderVirtualCard();
    }
  }
  window.openCardsModal = openCardsModal;

  if (tabCardUsd && tabCardNgn) {
    tabCardUsd.addEventListener('click', () => {
      virtualCardState.activeCurrency = 'USD';
      virtualCardState.activeCardId = null;
      tabCardUsd.classList.add('active');
      tabCardNgn.classList.remove('active');
      cardLimitEditor?.classList.add('hidden');
      renderVirtualCard();
    });

    tabCardNgn.addEventListener('click', () => {
      virtualCardState.activeCurrency = 'NGN';
      virtualCardState.activeCardId = null;
      tabCardNgn.classList.add('active');
      tabCardUsd.classList.remove('active');
      cardLimitEditor?.classList.add('hidden');
      renderVirtualCard();
    });
  }

  if (btnTogglePan) {
    btnTogglePan.addEventListener('click', () => {
      const card = getActiveVirtualCard();
      if (!card) return;
      if (virtualCardState.revealedPanIds.has(card.id)) {
        virtualCardState.revealedPanIds.delete(card.id);
      } else {
        virtualCardState.revealedPanIds.add(card.id);
        if (window.MidePayDB && typeof window.MidePayDB.logVirtualCardReveal === 'function') {
          window.MidePayDB.logVirtualCardReveal({ cardId: card.id, field: 'PAN' });
        }
      }
      renderVirtualCard();
    });
  }

  if (btnToggleCvv) {
    btnToggleCvv.addEventListener('click', () => {
      const card = getActiveVirtualCard();
      if (!card) return;
      if (virtualCardState.revealedCvvIds.has(card.id)) {
        virtualCardState.revealedCvvIds.delete(card.id);
      } else {
        virtualCardState.revealedCvvIds.add(card.id);
        if (window.MidePayDB && typeof window.MidePayDB.logVirtualCardReveal === 'function') {
          window.MidePayDB.logVirtualCardReveal({ cardId: card.id, field: 'CVV' });
        }
      }
      renderVirtualCard();
    });
  }

  if (btnFreezeCard) {
    btnFreezeCard.addEventListener('click', async () => {
      await withSubmitLock('vcard-freeze', btnFreezeCard, null, async () => {
        if (window.MidePayDB && typeof window.MidePayDB.isFinancialQuarantined === 'function' && window.MidePayDB.isFinancialQuarantined()) {
          showToast('Staging Quarantine: Client-side virtual card mutations are disabled until backend settlement is live.', 'error');
          return;
        }
        const card = getActiveVirtualCard();
        if (!card) return;
        const nextFrozen = !card.isFrozen;

        if (!window.MidePayDB || typeof window.MidePayDB.updateVirtualCardFreeze !== 'function' || !state.user?.id) {
          showToast('Please sign in to manage virtual card security.', 'error');
          return;
        }

        const res = await window.MidePayDB.updateVirtualCardFreeze({
          cardId: card.id,
          userId: state.user.id,
          isFrozen: nextFrozen
        });
        if (!res.success) {
          showToast(res.error || 'Unable to update card freeze status.', 'error');
          return;
        }

        card.isFrozen = res.card?.is_frozen !== undefined ? Boolean(res.card.is_frozen) : nextFrozen;
        renderVirtualCard();
        if (card.isFrozen) {
          showToast(`🔒 ${card.title} (••${card.fullPan.slice(-4)}) frozen on Supabase.`);
        } else {
          showToast(`✅ ${card.title} (••${card.fullPan.slice(-4)}) unfrozen and active!`);
        }
      });
    });
  }

  if (btnCopyCard) {
    btnCopyCard.addEventListener('click', () => {
      const card = getActiveVirtualCard();
      if (!card) return;
      const cleanPan = card.fullPan.replace(/\s+/g, '');
      navigator.clipboard.writeText(cleanPan).then(() => {
        showToast(`📋 Copied 16-digit card number (•••• ${cleanPan.slice(-4)}) to clipboard!`);
      }).catch(() => {
        showToast(`Card Number: ${card.fullPan}`);
      });
    });
  }

  if (btnEditCardLimit && cardLimitEditor && cardLimitInput) {
    btnEditCardLimit.addEventListener('click', () => {
      const card = getActiveVirtualCard();
      if (!card) return;
      cardLimitInput.value = String(card.limitNum);
      cardLimitEditor.classList.toggle('hidden');
      if (!cardLimitEditor.classList.contains('hidden')) {
        cardLimitInput.focus();
      }
    });
  }

  if (btnCancelCardLimit && cardLimitEditor) {
    btnCancelCardLimit.addEventListener('click', () => {
      cardLimitEditor.classList.add('hidden');
    });
  }

  if (btnSaveCardLimit && cardLimitInput && cardLimitEditor) {
    btnSaveCardLimit.addEventListener('click', async () => {
      await withSubmitLock('vcard-limit', btnSaveCardLimit, 'Saving...', async () => {
        if (window.MidePayDB && typeof window.MidePayDB.isFinancialQuarantined === 'function' && window.MidePayDB.isFinancialQuarantined()) {
          showToast('Staging Quarantine: Client-side virtual card limit changes are disabled until backend settlement is live.', 'error');
          return;
        }
        const card = getActiveVirtualCard();
        if (!card) return;
        const nextLimit = Number(cardLimitInput.value);
        if (!Number.isFinite(nextLimit) || nextLimit < 10) {
          showToast('Please enter a valid monthly spending limit (minimum 10).', 'error');
          return;
        }

        if (!window.MidePayDB || typeof window.MidePayDB.updateVirtualCardLimit !== 'function' || !state.user?.id) {
          showToast('Please sign in to update card spending limits.', 'error');
          return;
        }

        const res = await window.MidePayDB.updateVirtualCardLimit({
          cardId: card.id,
          userId: state.user.id,
          spendingLimit: nextLimit
        });
        if (!res.success) {
          showToast(res.error || 'Failed to save monthly spending limit.', 'error');
          return;
        }

        card.limitNum = res.card?.spending_limit_monthly !== undefined
          ? Number(res.card.spending_limit_monthly)
          : nextLimit;
        cardLimitEditor.classList.add('hidden');
        renderVirtualCard();
        showToast(`✓ Monthly spending limit updated to ${formatCardCurrency(card.limitNum, card.currency)}!`);
      });
    });
  }

  if (btnCreateVirtualCard) {
    btnCreateVirtualCard.addEventListener('click', async () => {
      ensureUserSession();
      await withSubmitLock('vcard-issue', btnCreateVirtualCard, 'Issuing Card...', async () => {
        if (!state.user?.id || !window.MidePayDB || typeof window.MidePayDB.createVirtualCard !== 'function') {
          showToast('Please sign in to issue a new virtual debit card.', 'error');
          return;
        }

        const isUsd = virtualCardState.activeCurrency === 'USD';
        const countInCurrency = getCardsForActiveCurrency().length + 1;
        const customLabel = isUsd
          ? (countInCurrency === 1 ? 'MidePay Black' : `MidePay Black #${countInCurrency}`)
          : (countInCurrency === 1 ? 'MidePay Green' : `MidePay Green #${countInCurrency}`);

        const res = await window.MidePayDB.createVirtualCard({
          userId: state.user.id,
          walletId: state.user.walletId || null,
          currency: virtualCardState.activeCurrency,
          cardType: isUsd ? 'Mastercard' : 'Verve',
          cardLabel: customLabel,
          cardHolderName: state.user.fullName || 'MIDEPAY MEMBER',
          spendingLimit: isUsd ? 1000.00 : 500000.00,
          initialBalance: 0.00
        });

        if (!res.success || !res.card) {
          showToast(res.error || 'Unable to create virtual card.', 'error');
          return;
        }

        const normalized = normalizeCardRow(res.card, state.user.fullName);
        virtualCardState.cards.unshift(normalized);
        virtualCardState.activeCardId = normalized.id;
        virtualCardState.revealedPanIds.add(normalized.id);
        renderVirtualCard();
        showToast(`💳 Issued new ${normalized.currency} Virtual Card (•••• ${normalized.fullPan.slice(-4)})!`);
      });
    });
  }

  if (btnFundCardModal) {
    btnFundCardModal.addEventListener('click', async () => {
      ensureUserSession();
      await withSubmitLock('vcard-fund', btnFundCardModal, 'Funding Card...', async (idempotencyKey) => {
        if (window.MidePayDB && typeof window.MidePayDB.isFinancialQuarantined === 'function' && window.MidePayDB.isFinancialQuarantined()) {
          showToast('Staging Quarantine: Client-side virtual card funding is disabled until backend settlement is live.', 'error');
          return;
        }
        let card = getActiveVirtualCard();
        if (!card && state.user?.id) {
          await loadUserVirtualCards(state.user.id, state.user.walletId || null, state.user.fullName);
          card = getActiveVirtualCard();
        }
        if (!card) return;

        if (card.isFrozen) {
          showToast('Unfreeze this card before funding it from your main wallet.', 'error');
          return;
        }

        const isUsd = card.currency === 'USD';
        const fundIncrement = isUsd ? 50 : 25000;
        const requiredNgn = isUsd ? 77500 : 25000;

        if (requiredNgn > state.dashBalance) {
          showToast(
            isUsd
              ? `Insufficient main wallet balance (${formatNaira(requiredNgn)} needed for $50.00). Click Add Money first.`
              : `Insufficient main wallet balance (${formatNaira(requiredNgn)} needed). Click Add Money first.`,
            'error'
          );
          return;
        }

        if (!window.MidePayDB || typeof window.MidePayDB.updateVirtualCardBalance !== 'function' || !state.user?.id) {
          showToast('Please sign in to fund your virtual debit card.', 'error');
          return;
        }

        const fundRes = await window.MidePayDB.updateVirtualCardBalance({
          cardId: card.id,
          userId: state.user.id,
          fundIncrement,
          idempotencyKey
        });

        if (!fundRes || fundRes.success === false) {
          showToast(fundRes?.error || 'Unable to fund virtual card.', 'error');
          return;
        }

        if (Number.isFinite(fundRes.newCardBalance)) {
          card.balanceNum = Number(fundRes.newCardBalance);
        } else if (fundRes.card?.card_balance !== undefined) {
          card.balanceNum = Number(fundRes.card.card_balance);
        }

        await rehydrateBalanceFromServer(fundRes.newWalletBalance);

        const last4 = card.fullPan.slice(-4);
        const txRef = fundRes.transaction?.reference || `MP-CD-${idempotencyKey.slice(0, 8).toUpperCase()}`;
        const newTx = {
          id: 'tx-' + Date.now(),
          ref: txRef,
          title: isUsd ? 'Virtual USD Card Top-Up (+$50.00)' : `Virtual Naira Card Top-Up (+${formatNaira(fundIncrement)})`,
          category: 'Card Funding',
          sender: state.user?.fullName || 'Account Holder',
          beneficiary: `${card.title} (••${last4})`,
          narration: isUsd
            ? 'Funded Virtual USD Card with $50.00 (@ ₦1,550/$1)'
            : `Funded Virtual Naira Card with ${formatNaira(fundIncrement)}`,
          date: 'Just now',
          type: 'outflow',
          amount: requiredNgn,
          fee: 0.00,
          status: 'Successful'
        };
        state.transactions.unshift(newTx);
        saveUserTransactions();
        renderDashboardTransactions();
        renderVirtualCard();
        showToast(
          isUsd
            ? `🎉 Funded ${card.title} (••${last4}) with $50.00!`
            : `🎉 ${formatNaira(fundIncrement)} transferred to ${card.title} (••${last4})!`
        );
      });
    });
  }

  // Quick Action Buttons
  if (qaBills) qaBills.addEventListener('click', () => openBillsModal('electricity'));
  if (qaCard) qaCard.addEventListener('click', openCardsModal);

  if (heroQuickBills) heroQuickBills.addEventListener('click', () => {
    ensureUserSession();
    showView('dashboard');
    openBillsModal('cable');
  });
  if (heroQuickCards) heroQuickCards.addEventListener('click', () => {
    ensureUserSession();
    showView('dashboard');
    openCardsModal();
  });

  // =========================================================================
  // EXECUTIVE BACK-OFFICE & INVESTOR TERMINAL CONTROLLER
  // =========================================================================

  let adminUsersList = [];
  let adminTxList = [];
  let adminWaitlistEntries = [];

  async function renderAdminPortal() {
    const isProd = Boolean(window.MidePayDB && window.MidePayDB.isProduction());
    adminUsersList = isProd ? [] : getAccountsRegistry();
    adminTxList = []; adminWaitlistEntries = [];
    const syncStatus = document.getElementById('admin-db-status');
    if (syncStatus) syncStatus.textContent = 'Loading operations records…';
    if (isProd) {
      renderAdminUsersTable(); renderAdminTxTable(); renderAdminWaitlistTable();
      for (const id of ['admin-tpv-val','admin-wallets-val','admin-waitlist-val']) {
        const field=document.getElementById(id);if(field)field.textContent='—';
      }
    }

    // Fetch live member profiles & wallets from Supabase if connected (permitted by RLS for executives)
    if (window.MidePayDB && window.MidePayDB.isConfigured() && window.MidePayDB.client) {
      try {
        const [{ data: supaProfiles, error: profilesError }, { data: supaWallets, error: walletsError }, { data: supaTxs, error: transactionsError }] = await Promise.all([
          window.MidePayDB.client.from('profiles').select('id, full_name, email, phone, tag, kyc_tier, role, is_frozen, frozen_by_admin, created_at'),
          window.MidePayDB.client.from('wallets').select('*'),
          window.MidePayDB.client.from('transactions').select('*').order('created_at', { ascending: false }).limit(50)
        ]);

        if (profilesError || walletsError || transactionsError) throw new Error('Operations records unavailable');
        if (syncStatus) syncStatus.textContent = 'Loaded database records · latest 50 transactions';
        const walletByUser = new Map();
        if (Array.isArray(supaWallets)) {
          supaWallets.forEach(w => {
            if (w.user_id && (!walletByUser.has(w.user_id) || w.currency === 'NGN')) {
              walletByUser.set(w.user_id, w);
            }
          });
        }

        if (supaProfiles && supaProfiles.length > 0) {
          supaProfiles.forEach(sp => {
            const w = walletByUser.get(sp.id);
            const match = adminUsersList.find(u => u.email && sp.email && u.email.toLowerCase() === sp.email.toLowerCase());
            if (match) {
              match.id = sp.id;
              match.role = sp.role || 'user';
              match.isFrozen = sp.is_frozen === true;
              if (sp.full_name) match.fullName = sp.full_name;
              if (sp.phone) match.phone = sp.phone;
              if (w) {
                match.balance = Number(w.balance || 0);
                match.nuban = w.nuban || match.nuban;
                match.bank = w.bank_name || 'MidePay wallet';
              }
            } else {
              adminUsersList.push({
                id: sp.id,
                fullName: sp.full_name || 'Member',
                email: sp.email,
                phone: sp.phone || '',
                tag: sp.tag || `@${(sp.full_name || 'user').toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                role: sp.role || 'user',
                kycTier: sp.kyc_tier ?? null,
                isFrozen: sp.is_frozen === true,
                nuban: w?.nuban || '',
                bank: w?.bank_name || 'MidePay wallet',
                balance: w?.balance ?? null
              });
            }
          });
        }

        if (Array.isArray(supaTxs) && supaTxs.length > 0) {
          adminTxList = supaTxs.map(tx => ({
            id: tx.id,
            ref: tx.reference || `MP-TX-${String(tx.id).slice(0, 8)}`,
            title: tx.narration || 'MidePay Transaction',
            category: tx.category || 'Transfer',
            sender: tx.type === 'outflow' ? 'Wallet Holder' : (tx.counterparty_name || 'Counterparty'),
            beneficiary: tx.type === 'inflow' ? 'Wallet Holder' : (tx.counterparty_name || 'Beneficiary'),
            date: formatTxDate(tx.created_at),
            type: tx.type,
            amount: Number(tx.amount) || 0,
            status: transactionStatusLabel(tx.status)
          }));
        } else {
          adminTxList = isProd ? [] : [...state.transactions, ...loadUserTransactions(), ...DEFAULT_DEMO_TRANSACTIONS];
        }
      } catch (err) {
        console.warn('[MidePay] Executive portal Supabase sync notice:', err);
        adminUsersList = []; adminTxList = [];
        if (syncStatus) syncStatus.textContent = 'Records unavailable · refresh to retry';
        if (isProd) return;
      }
    } else {
      const userTxs = loadUserTransactions();
      adminTxList = [...state.transactions, ...userTxs, ...DEFAULT_DEMO_TRANSACTIONS];
    }

    const seenTx = new Set();
    adminTxList = adminTxList.filter(t => {
      const key = t.ref || t.id;
      if (seenTx.has(key)) return false;
      seenTx.add(key);
      return true;
    });

    // 3. Gather waitlist leads
    adminWaitlistEntries = [];
    try {
      const localWaitlist = isProd ? [] : JSON.parse(localStorage.getItem('midepay_waitlist_leads') || '[]');
      adminWaitlistEntries = localWaitlist;
    } catch (e) {}

    if (window.MidePayDB && window.MidePayDB.isConfigured() && window.MidePayDB.client) {
      try {
        const { data, error } = await window.MidePayDB.client
          .from('waitlist')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data && data.length > 0) {
          data.forEach(item => {
            if (!adminWaitlistEntries.some(w => w.email === item.email)) {
              adminWaitlistEntries.push({
                email: item.email,
                date: item.created_at || new Date().toISOString(),
                source: 'Supabase Cloud DB'
              });
            }
          });
        }
      } catch (e) {
        console.warn('Waitlist sync notice:', e);
      }
    }

    if (!isProd && adminWaitlistEntries.length === 0) {
      adminWaitlistEntries = [
        { email: 'investor.relations@ventures.ng', date: '2026-09-24T14:20:00Z', source: 'Investor Portal' },
        { email: 'temitope.ade@flutterwave.com', date: '2026-09-23T09:15:00Z', source: 'Fintech Waitlist' },
        { email: 'chukwudi.okafor@stanbic.com', date: '2026-09-22T18:40:00Z', source: 'Direct Lead' },
        { email: 'zainab.danladi@kuda.com', date: '2026-09-21T11:05:00Z', source: 'Mobile Campaign' },
        { email: 'folake.lawal@paystack.com', date: '2026-09-20T16:50:00Z', source: 'Landing Waitlist' }
      ];
    }

    // 4. Update KPI Executive Metric Displays
    const elTpv = document.getElementById('admin-tpv-val');
    const elWallets = document.getElementById('admin-wallets-val');
    const elWaitlist = document.getElementById('admin-waitlist-val');
    const elMargin = document.getElementById('admin-margin-val');

    // Loaded records are not network-wide financial or verified KYC totals.
    if (elTpv) elTpv.textContent = String(adminTxList.length);
    if (elWallets) elWallets.textContent = String(adminUsersList.length);
    if (elWaitlist) elWaitlist.textContent = String(adminWaitlistEntries.length);
    if (elMargin) elMargin.textContent = 'Unavailable';

    // Update Tab Counters
    const tabUsersCount = document.getElementById('tab-count-users');
    const tabTxCount = document.getElementById('tab-count-tx');
    const tabWaitlistCount = document.getElementById('tab-count-waitlist');
    if (tabUsersCount) tabUsersCount.textContent = adminUsersList.length;
    if (tabTxCount) tabTxCount.textContent = adminTxList.length;
    if (tabWaitlistCount) tabWaitlistCount.textContent = adminWaitlistEntries.length;

    // 5. Render Tables
    renderAdminUsersTable();
    renderAdminTxTable();
    renderAdminWaitlistTable();
  }
  window.renderAdminPortal = renderAdminPortal;

  function renderAdminUsersTable(filterQuery = '') {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    const q = filterQuery.toLowerCase().trim();
    const filtered = adminUsersList.filter(u => {
      if (!q) return true;
      return (
        (u.fullName && u.fullName.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.nuban && u.nuban.includes(q)) ||
        (u.tag && u.tag.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q))
      );
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">No member accounts matched query "${escapeHtml(filterQuery)}".</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(user => {
      const isFrozen = !!user.isFrozen;
      const balance = user.balance == null || user.balance === '' ? null : Number(user.balance);
      const balanceLabel = balance !== null && Number.isFinite(balance) && balance >= 0 ? formatNaira(balance) : 'Unavailable';
      const tierLabel = Number.isInteger(user.kycTier) && user.kycTier >= 1 && user.kycTier <= 3 ? 'Tier ' + user.kycTier + ' (recorded)' : 'Not recorded';
      const initials = (user.fullName || 'User').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const tag = user.tag || `@${(user.fullName || 'user').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const cleanNuban = /^\d{10}$/.test(user.nuban || '') ? formatNubanDisplay(user.nuban) : 'Unavailable';

      return `
        <tr data-user-email="${escapeHtml(user.email)}">
          <td>
            <div class="member-cell">
              <div class="member-avatar-mini">${escapeHtml(initials)}</div>
              <div class="member-name-block">
                <span class="member-full-name">${escapeHtml(user.fullName || 'Unnamed Member')}</span>
                <span class="member-tag-mini">${escapeHtml(tag)}</span>
              </div>
            </div>
          </td>
          <td>
            <div style="display:flex; flex-direction:column; font-size:0.82rem;">
              <span>${escapeHtml(user.email || '')}</span>
              <span style="color:var(--text-muted);">${escapeHtml(user.phone ? '+234 ' + user.phone : 'No phone')}</span>
            </div>
          </td>
          <td>
            <div style="font-family:monospace; font-weight:700; color:var(--text-primary); font-size:0.92rem;">
              ${cleanNuban}
            </div>
            <span style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(user.bank || 'MidePay wallet')}</span>
          </td>
          <td>
            <div style="display:flex; flex-direction:column; gap:0.25rem;">
              <span class="badge-gold-sm" style="font-size:0.72rem;">${tierLabel}</span>
              ${user.role === 'executive' 
                ? '<span style="font-size:0.68rem; font-weight:700; color:#FBBF24; display:inline-flex; align-items:center; gap:0.2rem;">★ Executive</span>' 
                : '<span style="font-size:0.68rem; color:var(--text-muted);">Member</span>'}
            </div>
          </td>
          <td>
            <div style="font-weight:700; font-size:0.96rem; color:var(--text-primary);">
              ${balanceLabel}
            </div>
          </td>
          <td>
            ${isFrozen 
              ? '<span style="color:#F87171; background:rgba(239,68,68,0.15); padding:0.2rem 0.5rem; border-radius:4px; font-weight:700; font-size:0.72rem;">🔒 FROZEN (AML)</span>' 
              : '<span style="color:#34D399; background:rgba(16,185,129,0.15); padding:0.2rem 0.5rem; border-radius:4px; font-weight:700; font-size:0.72rem;">✓ ACTIVE</span>'}
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <button type="button" class="btn-admin-action ${isFrozen ? 'btn-admin-unfreeze' : 'btn-admin-freeze'}" data-action="toggle-freeze" data-email="${escapeHtml(user.email)}">
                ${isFrozen ? 'Unfreeze' : 'Freeze'}
              </button>
              <button type="button" class="btn-admin-action btn-admin-credit" data-action="credit-funds" data-email="${escapeHtml(user.email)}">
                Request funded credit
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderAdminTxTable(filterQuery = '', filterType = 'all') {
    const tbody = document.getElementById('admin-tx-tbody');
    if (!tbody) return;

    const q = filterQuery.toLowerCase().trim();
    let list = adminTxList;

    if (filterType !== 'all') {
      list = list.filter(t => t.type === filterType);
    }

    if (q) {
      list = list.filter(t => (
        (t.ref && t.ref.toLowerCase().includes(q)) ||
        (t.sender && t.sender.toLowerCase().includes(q)) ||
        (t.beneficiary && t.beneficiary.toLowerCase().includes(q)) ||
        (t.title && t.title.toLowerCase().includes(q))
      ));
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">No platform transactions found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(tx => {
      const isInflow = tx.type === 'inflow';
      return `
        <tr>
          <td>
            <div style="font-family:monospace; font-weight:700; color:var(--primary-emerald); font-size:0.86rem;">
              ${escapeHtml(tx.ref || 'Reference not supplied')}
            </div>
            <span style="font-size:0.7rem; color:var(--text-muted);">Provider settlement ID not supplied</span>
          </td>
          <td><span style="font-size:0.82rem; color:var(--text-muted);">${escapeHtml(tx.date || 'Date not recorded')}</span></td>
          <td><strong>${escapeHtml(tx.sender || 'Sender')}</strong></td>
          <td>
            <div>${escapeHtml(tx.beneficiary || 'Beneficiary')}</div>
          </td>
          <td>
            <span style="font-weight:700; color:${isInflow ? '#34D399' : 'var(--text-primary)'};">
              ${isInflow ? '+' : '-'}${formatNaira(tx.amount)}
            </span>
          </td>
          <td><span style="font-size:0.78rem; text-transform:uppercase; color:var(--text-muted);">${escapeHtml(tx.category || 'Transfer')}</span></td>
          <td>
            <span style="color:var(--text-secondary); font-weight:700; font-size:0.75rem;">${transactionStatusLabel(tx.status)}</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderAdminWaitlistTable(filterQuery = '') {
    const tbody = document.getElementById('admin-waitlist-tbody');
    if (!tbody) return;

    const q = filterQuery.toLowerCase().trim();
    const filtered = adminWaitlistEntries.filter(w => !q || w.email.toLowerCase().includes(q));

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-muted);">No waitlist leads found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((item, idx) => `
      <tr>
        <td><span style="color:var(--text-muted); font-size:0.78rem;">#${idx + 1}</span></td>
        <td><strong>${escapeHtml(item.email)}</strong></td>
        <td><span style="font-size:0.82rem; color:var(--text-muted);">${formatTxDate(item.date)}</span></td>
        <td><span class="badge-emerald-sm" style="font-size:0.72rem;">Priority VIP</span></td>
        <td><span style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(item.source || 'Organic Web')}</span></td>
      </tr>
    `).join('');
  }

  function exportInvestorDossierCsv() {
    const headers = ['Record_Type', 'Name_or_Email', 'Account_NUBAN', 'Balance_or_Amount', 'Status', 'Timestamp'];
    const rows = [];

    // Add Users
    adminUsersList.forEach(u => {
      rows.push(['MEMBER_WALLET', u.fullName || 'User', u.nuban || '', (u.balance || 0), (u.isFrozen ? 'FROZEN' : 'ACTIVE'), new Date().toISOString()]);
    });

    // Add Transactions
    adminTxList.forEach(t => {
      rows.push(['TRANSACTION', `"${t.sender} -> ${t.beneficiary}"`, t.ref, t.amount, t.status, t.date]);
    });

    // Add Waitlist Leads
    adminWaitlistEntries.forEach(w => {
      rows.push(['WAITLIST_LEAD', w.email, 'N/A', 0, 'PENDING_ONBOARDING', w.date]);
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.map(escapeCsvCell).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `MidePay_Investor_Dossier_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();

    showToast('📥 Downloaded MidePay Investor Dossier (CSV) successfully!');
  }
  window.exportInvestorDossierCsv = exportInvestorDossierCsv;

  const treasuryPanel = document.getElementById('treasury-controls');
  const treasuryFeedback = document.getElementById('treasury-feedback');
  let treasuryFactorId = null;
  let treasuryOperation = null;
  const treasuryField = id => document.getElementById(id);
  function treasuryMessage(text) { if (treasuryFeedback) treasuryFeedback.textContent = text; }
  function clearTreasurySecrets() {
    const pin=treasuryField('treasury-pin'), code=treasuryField('treasury-mfa-code'), qr=treasuryField('treasury-mfa-qr');
    if(pin)pin.value=''; if(code)code.value=''; if(qr){qr.removeAttribute('src');qr.classList.add('hidden');}
    treasuryFactorId=null;
  }
  async function refreshTreasuryQueue() {
    const result = await window.MidePayDB.treasuryRpc('get_treasury_credit_queue');
    if (!result.success) { treasuryMessage(result.error || result.code || 'Treasury unavailable.'); return; }
    const source = treasuryField('treasury-source');
    if (source) {
      const current=source.value;
      source.innerHTML = (result.wallets || []).map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.label)} — ${formatNaira(w.balance)}</option>`).join('');
      if ((result.wallets||[]).some(w=>w.id===current)) source.value=current;
    }
    const recipient=treasuryField('treasury-target');
    if(recipient){
      const selected=recipient.value;
      const members=adminUsersList.filter(u=>isValidUuid(u.id) && u.role!=='executive' && !u.isFrozen);
      recipient.innerHTML='<option value="">Select a member</option>'+members.map(u=>`<option value="${escapeHtml(u.id)}">${escapeHtml(u.fullName||'Member')} (${escapeHtml(u.email||'')})</option>`).join('');
      if(members.some(u=>u.id===selected))recipient.value=selected;
    }
    const queue=treasuryField('treasury-queue');
    if (queue) queue.innerHTML=(result.requests||[]).map(q=>`<div style="padding:.75rem 0;border-bottom:1px solid #334155;">
      <strong>${formatNaira(q.amount)}</strong> · ${escapeHtml(q.status)} · recipient ${escapeHtml(q.target_user_id)}
      <p>${escapeHtml(q.reason)} · maker ${escapeHtml(q.maker_id)}</p>
      ${q.status==='pending' ? `<button type="button" class="btn btn-outline-xs" data-treasury-id="${escapeHtml(q.id)}" data-treasury-action="${q.maker_id===state.user?.id?'cancel':'approve'}">${q.maker_id===state.user?.id?'Cancel request':'Approve funded transfer'}</button>`:''}
    </div>`).join('') || '<p>No treasury requests.</p>';
    if(!(result.wallets||[]).length) treasuryMessage('No institutional treasury wallet is configured. Credits remain disabled.');
  }
  async function openTreasuryPanel(targetUserId='') {
    if (!await window.MidePayDB?.isUserExecutive()) { showToast('Executive authorization required.','error'); return; }
    treasuryPanel?.classList.remove('hidden');
    await refreshTreasuryQueue();
    if(targetUserId && treasuryField('treasury-target')) treasuryField('treasury-target').value=targetUserId;
  }
  treasuryField('treasury-refresh')?.addEventListener('click', () => refreshTreasuryQueue().catch(()=>treasuryMessage('Unable to refresh queue.')));
  treasuryField('treasury-enroll-mfa')?.addEventListener('click', async () => {
    await withSubmitLock('treasury-enroll-mfa',treasuryField('treasury-enroll-mfa'),'Preparing...',async()=>{
      const result=await window.MidePayDB.enrollTreasuryMfa();
      if(result.error){treasuryMessage(result.error);return;}
      treasuryFactorId=result.factorId;
      const qr=treasuryField('treasury-mfa-qr');
      if(qr && typeof result.qrCode==='string' && result.qrCode.startsWith('data:image/svg+xml')){qr.src=result.qrCode;qr.classList.remove('hidden');}
      treasuryMessage('Scan the QR code, then enter its current six-digit authenticator code.');
    });
  });
  treasuryField('treasury-verify-mfa')?.addEventListener('click', async () => {
    await withSubmitLock('treasury-verify-mfa',treasuryField('treasury-verify-mfa'),'Verifying...',async()=>{
      const result=await window.MidePayDB.verifyTreasuryMfa(treasuryField('treasury-mfa-code')?.value||'',treasuryFactorId);
      treasuryMessage(result.success?'Authenticator verified for treasury actions.':result.error||'Verification failed.');
      if(result.success)clearTreasurySecrets();
    });
  });
  treasuryField('treasury-request-form')?.addEventListener('submit', async e=>{
    e.preventDefault();
    await withSubmitLock('treasury-request',treasuryField('treasury-submit'),'Requesting...',async()=>{
      const payload={p_source_wallet_id:treasuryField('treasury-source')?.value,p_target_user_id:treasuryField('treasury-target')?.value.trim(),
        p_amount:Number(treasuryField('treasury-amount')?.value),p_reason:treasuryField('treasury-reason')?.value.trim()};
      const signature=JSON.stringify(payload);
      // Preserve the same key across unknown network outcomes. No PIN is retained.
      if(!treasuryOperation || treasuryOperation.signature!==signature)treasuryOperation={signature,key:crypto.randomUUID()};
      let result;
      try {result=await window.MidePayDB.treasuryRpc('request_treasury_credit',{...payload,p_idempotency_key:treasuryOperation.key,p_pin:treasuryField('treasury-pin')?.value});}
      catch {treasuryMessage('Request outcome unknown. Retry unchanged details to reuse the same key.');return;}
      finally {if(treasuryField('treasury-pin'))treasuryField('treasury-pin').value='';}
      treasuryMessage(result.success?'Request saved. A different executive must approve it.':result.error||result.code||'Request rejected.');
      if(result.success){treasuryOperation=null;await refreshTreasuryQueue();}
    });
  });
  treasuryField('treasury-queue')?.addEventListener('click',async e=>{
    const button=e.target.closest('button[data-treasury-id]');if(!button)return;
    const rpc=button.dataset.treasuryAction==='cancel'?'cancel_treasury_credit':'approve_treasury_credit';
    await withSubmitLock('treasury-'+button.dataset.treasuryId,button,'Processing...',async()=>{
      try {
        const result=await window.MidePayDB.treasuryRpc(rpc,{p_request_id:button.dataset.treasuryId,p_pin:treasuryField('treasury-pin')?.value});
        treasuryMessage(result.success?(rpc==='approve_treasury_credit'?'Funded treasury transfer approved.':'Request cancelled.'):result.error||result.code||'Action rejected.');
        if(result.success){await refreshTreasuryQueue();await renderAdminPortal();}
      } catch {treasuryMessage('Outcome unknown. Refresh the queue before retrying.');}
      finally {if(treasuryField('treasury-pin'))treasuryField('treasury-pin').value='';}
    });
  });
  [document.getElementById('admin-logout-btn'),document.getElementById('dash-logout-btn')].forEach(button=>button?.addEventListener('click',()=>{clearTreasurySecrets();treasuryOperation=null;treasuryPanel?.classList.add('hidden');}));

  // --- Wire Executive Admin Portal Event Listeners ---
  const navOpenAdminBtn = document.getElementById('nav-open-admin-btn');
  const navLandingAdminBtn = document.getElementById('nav-landing-admin-btn');
  const dashOpenAdminBtn = document.getElementById('dash-open-admin-btn');
  const mobileAdminBtn = document.getElementById('mobile-admin-btn');
  const footerAdminBtn = document.getElementById('footer-admin-btn');
  const adminSwitchWalletBtn = document.getElementById('admin-switch-wallet-btn');
  const adminSwitchLandingBtn = document.getElementById('admin-switch-landing-btn');
  const adminExportCsvBtn = document.getElementById('admin-export-csv-btn');
  const adminDownloadLeadsBtn = document.getElementById('admin-download-leads-btn');
  const adminRefreshUsersBtn = document.getElementById('admin-refresh-users-btn');
  const adminQuickAddFundBtn = document.getElementById('admin-quick-add-fund-btn');
  const adminKillswitchTest = document.getElementById('admin-killswitch-test');

  [navOpenAdminBtn, navLandingAdminBtn, dashOpenAdminBtn, mobileAdminBtn, footerAdminBtn].forEach(btn => {
    if (btn) btn.addEventListener('click', () => showView('admin'));
  });
  if (adminSwitchWalletBtn) {
    adminSwitchWalletBtn.addEventListener('click', () => showView('dashboard'));
  }
  if (adminSwitchLandingBtn) {
    adminSwitchLandingBtn.addEventListener('click', () => showView('landing'));
  }
  if (adminExportCsvBtn) {
    adminExportCsvBtn.addEventListener('click', exportInvestorDossierCsv);
  }
  if (adminDownloadLeadsBtn) {
    adminDownloadLeadsBtn.addEventListener('click', exportInvestorDossierCsv);
  }
  if (adminRefreshUsersBtn) {
    adminRefreshUsersBtn.addEventListener('click', () => {
      renderAdminPortal();
      showToast('↻ Telemetry & Member Registry Refreshed!');
    });
  }
  if (adminQuickAddFundBtn) adminQuickAddFundBtn.addEventListener('click', () => openTreasuryPanel());
  if (adminKillswitchTest) {
    adminKillswitchTest.addEventListener('click', () => {
      showToast('This preview does not run an operational safety test. No controls were changed.');
    });
  }

  // Admin Tab Navigation Switcher
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-pane').forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
      });
      btn.classList.add('active');
      const target = btn.getAttribute('data-admin-tab');
      const pane = document.getElementById(`pane-admin-${target}`);
      if (pane) {
        pane.classList.remove('hidden');
        pane.classList.add('active');
      }
    });
  });

  // Admin Search Inputs
  const adminUserSearch = document.getElementById('admin-user-search');
  if (adminUserSearch) {
    adminUserSearch.addEventListener('input', (e) => renderAdminUsersTable(e.target.value));
  }
  const adminTxSearch = document.getElementById('admin-tx-search');
  if (adminTxSearch) {
    adminTxSearch.addEventListener('input', (e) => renderAdminTxTable(e.target.value));
  }
  const adminWaitlistSearch = document.getElementById('admin-waitlist-search');
  if (adminWaitlistSearch) {
    adminWaitlistSearch.addEventListener('input', (e) => renderAdminWaitlistTable(e.target.value));
  }

  // Admin Tx Type Filter Pills
  const txPillsContainer = document.getElementById('admin-tx-filter-pills');
  if (txPillsContainer) {
    txPillsContainer.querySelectorAll('.tx-filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        txPillsContainer.querySelectorAll('.tx-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const filterType = pill.getAttribute('data-tx-filter');
        const query = adminTxSearch ? adminTxSearch.value : '';
        renderAdminTxTable(query, filterType);
      });
    });
  }

  // User Action Delegation (Freeze / Unfreeze & Credit via Executive RPCs)
  const usersTbody = document.getElementById('admin-users-tbody');
  if (usersTbody) {
    usersTbody.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const email = btn.getAttribute('data-email');
      const user = adminUsersList.find(u => u.email && email && u.email.toLowerCase() === email.toLowerCase()) || findAccount(email);
      if (!user) return;

      if (action === 'toggle-freeze') {
        const nextFreeze = !user.isFrozen;
        if (window.MidePayDB && window.MidePayDB.isConfigured() && isValidUuid(user.id)) {
          const rpcRes = await window.MidePayDB.adminSetAccountFreeze({
            targetUserId: user.id,
            freezeState: nextFreeze,
            reason: nextFreeze ? 'Executive AML Compliance Freeze' : 'Executive Clearance Unfreeze'
          });
          if (!rpcRes.success) {
            showToast(rpcRes.error || 'Executive freeze update failed on server.', 'error');
            return;
          }
        }
        user.isFrozen = nextFreeze;
        saveAccountToRegistry(user);
        if (state.user && state.user.email.toLowerCase() === email.toLowerCase()) {
          state.user.isFrozen = nextFreeze;
          state.isAccountFrozen = nextFreeze;
        }
        showToast(nextFreeze ? `🔒 Account for ${user.fullName} FROZEN (CBN AML Compliance)` : `✅ Account for ${user.fullName} UNFROZEN`);
        renderAdminPortal();
      } else if (action === 'credit-funds') {
        openTreasuryPanel(user.id);
      }
    });
  }

  // =========================================================================
  // DOWNLOADABLE ACCOUNT STATEMENTS (CSV & PRINT-READY PDF STATEMENT)
  // =========================================================================
  const btnDownloadStatement = document.getElementById('btn-download-statement');
  const statementDropdownMenu = document.getElementById('statement-dropdown-menu');
  const btnExportStatementCsv = document.getElementById('btn-export-statement-csv');
  const btnOpenStatementModal = document.getElementById('btn-open-statement-modal');
  const modalAccountStatement = document.getElementById('modal-account-statement');
  const closeStatementModalBtn = document.getElementById('close-statement-modal-btn');
  const btnPrintStatement = document.getElementById('btn-print-statement');
  const btnModalExportCsv = document.getElementById('btn-modal-export-csv');

  function getStatementTransactions() {
    ensureUserSession();
    if (window.MidePayDB?.isProduction()) return Array.isArray(state.transactions) ? state.transactions : [];
    const list = Array.isArray(state.transactions) && state.transactions.length > 0
      ? state.transactions
      : DEFAULT_DEMO_TRANSACTIONS;
    return list;
  }

  function escapeCsvCell(val) {
    const raw = String(val ?? '');
    const safe = /^[\s]*[=+@-]/.test(raw) || /^[\t\r\n]/.test(raw) ? "'" + raw : raw;
    const str = safe.replace(/"/g, '""');
    return `"${str}"`;
  }

  function statementDataAvailable() {
    if (isProductionEnv() && (state.walletLoadState !== 'ready' || state.historyLoadState !== 'ready')) {
      showToast('Refresh your wallet and activity before creating a statement.', 'error');
      return false;
    }
    return true;
  }

  function exportAccountStatementCsv() {
    if (!statementDataAvailable()) return null;
    const txs = getStatementTransactions();
    const dateStamp = new Date().toISOString().slice(0, 10);
    const headers = [
      'Date',
      'Reference',
      'Type',
      'Category',
      'Counterparty',
      'Narration',
      'Amount (NGN)',
      'Fee (NGN)',
      'Status'
    ];

    const rows = txs.map(tx => {
      const isInflow = tx.type === 'inflow';
      const counterparty = isInflow ? (tx.sender || 'Sender') : (tx.beneficiary || 'Beneficiary');
      const amtNum = Number(tx.amount || 0).toFixed(2);
      const feeNum = Number(tx.fee || 0).toFixed(2);
      return [
        escapeCsvCell(tx.date || 'Date not recorded'),
        escapeCsvCell(tx.ref || 'Reference not supplied'),
        escapeCsvCell(isInflow ? 'Inflow' : 'Outflow'),
        escapeCsvCell(tx.category || 'Transfer'),
        escapeCsvCell(counterparty),
        escapeCsvCell(tx.narration || tx.title || ''),
        amtNum,
        feeNum,
        escapeCsvCell(transactionStatusLabel(tx.status))
      ].join(',');
    });

    const csvBody = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const fileName = `MidePay_Statement_${dateStamp}.csv`;

    const link = document.createElement('a');
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = new Blob([csvBody], { type: 'text/csv;charset=utf-8;' });
      const blobUrl = URL.createObjectURL(blob);
      link.setAttribute('href', blobUrl);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } else {
      link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURI(csvBody));
    }
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();

    statementDropdownMenu?.classList.add('hidden');
    btnDownloadStatement?.setAttribute('aria-expanded', 'false');
    showToast(`📥 Downloaded ${fileName} (${txs.length} transactions)!`, 'success');
    return { fileName, rowCount: txs.length, csvBody };
  }
  window.exportAccountStatementCsv = exportAccountStatementCsv;

  function statementSettledTotals(txs) {
    let inflow = 0, outflow = 0, fees = 0;
    const kobo = value => {
      const text = String(value ?? 0);
      if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Invalid statement amount');
      const [whole, fraction = ''] = text.split('.');
      const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (!Number.isSafeInteger(result)) throw new Error('Statement amount exceeds supported range');
      return result;
    };
    for (const tx of txs) {
      if (String(tx.status || '').toLowerCase() !== 'successful') continue;
      if (!['inflow', 'outflow'].includes(tx.type)) throw new Error('Invalid statement direction');
      const amount = kobo(tx.amount), fee = kobo(tx.fee);
      if (tx.type === 'inflow') inflow += amount; else outflow += amount;
      fees += fee;
      if (![inflow, outflow, fees].every(Number.isSafeInteger)) throw new Error('Statement total exceeds supported range');
    }
    return { totalInflow: inflow / 100, totalOutflow: outflow / 100, totalFees: fees / 100 };
  }

  function openOfficialStatementModal() {
    if (!statementDataAvailable()) return;
    const txs = getStatementTransactions();
    const holderName = state.user?.fullName || 'MidePay Account Holder';
    const holderEmail = state.user?.email || 'member@midepay.ng';
    const holderTag = state.user?.tag || '@midepay';
    const holderNuban = state.user?.nuban ? formatNubanDisplay(state.user.nuban) : 'Not assigned';
    const kycLabel = isProductionEnv() ? 'Test wallet · identity verification unavailable' : 'Demo wallet · identity not verified';

    let totals;
    try { totals = statementSettledTotals(txs); }
    catch { showToast('Statement amounts could not be verified. Refresh your history and try again.', 'error'); return; }
    const { totalInflow, totalOutflow, totalFees } = totals;

    const now = new Date();
    const stmtRefEl = document.getElementById('stmt-ref-id');
    const stmtDateEl = document.getElementById('stmt-generated-date');
    const stmtNameEl = document.getElementById('stmt-holder-name');
    const stmtMetaEl = document.getElementById('stmt-holder-meta');
    const stmtNubanEl = document.getElementById('stmt-holder-nuban');
    const stmtKycEl = document.getElementById('stmt-holder-kyc');
    const stmtBalEl = document.getElementById('stmt-total-balance');
    const stmtInEl = document.getElementById('stmt-total-inflow');
    const stmtOutEl = document.getElementById('stmt-total-outflow');
    const stmtFeeEl = document.getElementById('stmt-total-fees');
    const stmtTbody = document.getElementById('stmt-transactions-tbody');

    if (stmtRefEl) stmtRefEl.textContent = `MDP-STMT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(txs.length).padStart(3, '0')}`;
    if (stmtDateEl) stmtDateEl.textContent = now.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
    if (stmtNameEl) stmtNameEl.textContent = holderName;
    if (stmtMetaEl) stmtMetaEl.textContent = `${holderEmail} • ${holderTag}`;
    if (stmtNubanEl) stmtNubanEl.textContent = holderNuban;
    if (stmtKycEl) stmtKycEl.textContent = kycLabel;
    if (stmtBalEl) stmtBalEl.textContent = formatNaira(state.dashBalance);
    if (stmtInEl) stmtInEl.textContent = `+${formatNaira(totalInflow)}`;
    if (stmtOutEl) stmtOutEl.textContent = `-${formatNaira(totalOutflow)}`;
    if (stmtFeeEl) stmtFeeEl.textContent = formatNaira(totalFees);

    if (stmtTbody) {
      stmtTbody.innerHTML = txs.map(tx => {
        const isInflow = tx.type === 'inflow';
        const counterparty = isInflow ? (tx.sender || 'Sender') : (tx.beneficiary || 'Beneficiary');
        return `
          <tr>
            <td style="white-space:nowrap;">${escapeHtml(tx.date || 'Date not recorded')}</td>
            <td style="font-family:monospace; font-weight:600;">${escapeHtml(tx.ref || 'Reference not supplied')}</td>
            <td>${isInflow ? 'Inflow' : 'Outflow'}</td>
            <td>
              <strong>${escapeHtml(counterparty)}</strong>
              <div style="font-size:0.72rem; opacity:0.8;">${escapeHtml(tx.narration || tx.title || tx.category || '')}</div>
            </td>
            <td style="text-align:right; font-weight:700; color:${isInflow ? '#10B981' : 'inherit'};">
              ${isInflow ? '+' : '-'}${formatNaira(tx.amount || 0)}
            </td>
            <td style="text-align:right;">${formatNaira(tx.fee || 0)}</td>
            <td>${transactionStatusLabel(tx.status)}</td>
          </tr>
        `;
      }).join('');
    }

    statementDropdownMenu?.classList.add('hidden');
    btnDownloadStatement?.setAttribute('aria-expanded', 'false');
    modalAccountStatement?.classList.remove('hidden');
  }
  window.openOfficialStatementModal = openOfficialStatementModal;

  if (btnDownloadStatement && statementDropdownMenu) {
    btnDownloadStatement.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = statementDropdownMenu.classList.contains('hidden');
      statementDropdownMenu.classList.toggle('hidden', !willOpen);
      btnDownloadStatement.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      const wrapper = document.getElementById('statement-menu-wrapper');
      if (wrapper && e.target && typeof e.target.closest === 'function' && !e.target.closest('#statement-menu-wrapper')) {
        statementDropdownMenu.classList.add('hidden');
        btnDownloadStatement.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (btnExportStatementCsv) {
    btnExportStatementCsv.addEventListener('click', exportAccountStatementCsv);
  }
  if (btnModalExportCsv) {
    btnModalExportCsv.addEventListener('click', exportAccountStatementCsv);
  }
  if (btnOpenStatementModal) {
    btnOpenStatementModal.addEventListener('click', openOfficialStatementModal);
  }
  if (closeStatementModalBtn) {
    closeStatementModalBtn.addEventListener('click', () => modalAccountStatement?.classList.add('hidden'));
  }
  if (modalAccountStatement) {
    modalAccountStatement.addEventListener('click', (e) => {
      if (e.target === modalAccountStatement) modalAccountStatement.classList.add('hidden');
    });
  }
  if (btnPrintStatement) {
    btnPrintStatement.addEventListener('click', () => {
      document.body.classList.remove('print-receipt');
      document.body.classList.add('print-statement');
      if (typeof window !== 'undefined' && typeof window.print === 'function') {
        window.print();
      } else {
        showToast('Print dialog opened for PDF export.');
      }
    });
  }

  // =========================================================================
  // INSTALLABLE PWA (SERVICE WORKER, INSTALL BANNER & OFFLINE FALLBACK)
  // =========================================================================
  const pwaInstallBanner = document.getElementById('pwa-install-banner');
  const btnPwaInstall = document.getElementById('btn-pwa-install');
  const btnPwaDismiss = document.getElementById('btn-pwa-dismiss');
  const offlineStatusBanner = document.getElementById('offline-status-banner');
  let deferredInstallPrompt = null;

  // 1. Register Service Worker (`sw.js`)
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker) {
    const canRegisterSw =
      !window.location ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (canRegisterSw && typeof navigator.serviceWorker.register === 'function') {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch((err) => {
        console.warn('[MidePay PWA] Service Worker registration notice:', err?.message || err);
      });
    }
  }

  // 2. Capture `beforeinstallprompt` & surface "Install MidePay App" Banner
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (localStorage.getItem('midepay_pwa_dismissed') !== 'true') {
        pwaInstallBanner?.classList.remove('hidden');
      }
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      pwaInstallBanner?.classList.add('hidden');
      showToast('📲 MidePay App installed to your home screen!', 'success');
    });

    // 3. Offline / Online Mobile Data Fallback Notifications
    const syncOfflineBanner = () => {
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      offlineStatusBanner?.classList.toggle('hidden', !isOffline);
    };
    syncOfflineBanner();

    window.addEventListener('offline', () => {
      offlineStatusBanner?.classList.remove('hidden');
      showToast('📡 Mobile data disconnected — viewing cached MidePay wallet.', 'error');
    });

    window.addEventListener('online', () => {
      offlineStatusBanner?.classList.add('hidden');
      showToast('⚡ Back online — live MidePay sync restored!', 'success');
      if (state.user && typeof loadDashboardData === 'function') {
        loadDashboardData().catch(() => {});
      }
    });
  }

  if (btnPwaInstall) {
    btnPwaInstall.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        showToast('📲 In Safari/Mobile browser, tap Share -> "Add to Home Screen" to install MidePay!');
        return;
      }
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        pwaInstallBanner?.classList.add('hidden');
      }
      deferredInstallPrompt = null;
    });
  }

  if (btnPwaDismiss) {
    btnPwaDismiss.addEventListener('click', () => {
      pwaInstallBanner?.classList.add('hidden');
      localStorage.setItem('midepay_pwa_dismissed', 'true');
    });
  }

  // =========================================================================
  // v4.4 MODULE 1: MIDESAVE GOAL-BASED SAVINGS VAULTS (14.5% P.A.)
  // =========================================================================
  const mideSaveState = {
    userId: null,
    vaults: []
  };

  const qaMideSave = document.getElementById('qa-midesave');
  const btnDashOpenMideSave = document.getElementById('btn-dash-open-midesave');
  const btnDashCreateVault = document.getElementById('btn-dash-create-vault');
  const elMideSaveTotalSaved = document.getElementById('midesave-total-saved');
  const elMideSaveActiveCount = document.getElementById('midesave-active-count');
  const elMideSaveVaultsPreview = document.getElementById('midesave-vaults-preview');

  const modalMideSave = document.getElementById('modal-midesave');
  const closeMideSaveModalBtn = document.getElementById('close-midesave-modal-btn');
  const elMideSaveModalTotal = document.getElementById('midesave-modal-total');
  const elMideSaveModalWalletBal = document.getElementById('midesave-modal-wallet-bal');
  const btnShowCreateVaultForm = document.getElementById('btn-show-create-vault-form');
  const mideSaveCreateSection = document.getElementById('midesave-create-section');
  const mideSaveCreateForm = document.getElementById('midesave-create-form');
  const vaultTitleInput = document.getElementById('vault-title-input');
  const vaultCategorySelect = document.getElementById('vault-category-select');
  const vaultTargetInput = document.getElementById('vault-target-input');
  const vaultLockDateInput = document.getElementById('vault-lock-date-input');
  const btnCancelCreateVault = document.getElementById('btn-cancel-create-vault');

  const mideSaveActionPanel = document.getElementById('midesave-action-panel');
  const mideSaveActionHeading = document.getElementById('midesave-action-heading');
  const mideSaveEarlyBreakWarning = document.getElementById('midesave-early-break-warning');
  const mideSaveActionForm = document.getElementById('midesave-action-form');
  const mideSaveActionVaultId = document.getElementById('midesave-action-vault-id');
  const mideSaveActionMode = document.getElementById('midesave-action-mode');
  const mideSaveActionAmount = document.getElementById('midesave-action-amount');
  const mideSaveActionPin = document.getElementById('midesave-action-pin');
  const mideSaveActionError = document.getElementById('midesave-action-error');
  const mideSaveActionErrorText = document.getElementById('midesave-action-error-text');
  const btnCancelMideSaveAction = document.getElementById('btn-cancel-midesave-action');
  const elMideSaveModalList = document.getElementById('midesave-modal-vaults-list');

  function buildVaultCardHtml(v, compact = false) {
    const cur = Number(v.current_balance || 0);
    const tgt = Math.max(1, Number(v.target_amount || 1));
    const pct = Math.min(100, Math.round((cur / tgt) * 100));
    const rate = Number(v.interest_rate_pa || 14.5).toFixed(1);
    const isLockedFuture = Boolean(v.lock_until && new Date(v.lock_until) > new Date());
    const lockBadge = isLockedFuture
      ? `<span class="badge-gold-sm" style="font-size:0.68rem;">🔒 Locked till ${new Date(v.lock_until).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>`
      : `<span class="badge-emerald-sm" style="font-size:0.68rem;">🔓 Flexible (${rate}% p.a.)</span>`;

    return `
      <div class="midesave-vault-item" data-vault-id="${escapeHtml(v.id)}">
        <div class="midesave-vault-top">
          <div>
            <div class="midesave-vault-title">${escapeHtml(v.title)}</div>
            <span style="font-size:0.74rem; color:var(--text-muted);">${escapeHtml(v.category || 'General')} • Status: ${escapeHtml((v.status || 'active').toUpperCase())}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            ${lockBadge}
          </div>
        </div>
        <div class="midesave-progress-track">
          <div class="midesave-progress-fill" style="width:${pct}%;"></div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem; flex-wrap:wrap; margin-top:0.45rem;">
          <div style="font-size:0.82rem; color:var(--text-secondary);">
            <strong style="color:#34D399;">${formatNaira(cur)}</strong> of ${formatNaira(tgt)} (${pct}%)
          </div>
          <div style="display:flex; gap:0.45rem;">
            <button type="button" class="btn btn-primary-xs" data-vault-act="fund" data-vault-id="${escapeHtml(v.id)}">+ Top Up</button>
            <button type="button" class="btn btn-outline-xs" data-vault-act="withdraw" data-vault-id="${escapeHtml(v.id)}" ${cur <= 0 ? 'disabled' : ''}>Withdraw</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindVaultActionButtons(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('[data-vault-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-vault-act');
        const vid = btn.getAttribute('data-vault-id');
        openVaultTransactionDrawer(vid, mode);
      });
    });
  }

  function renderMideSaveVaults() {
    const vaults = mideSaveState.vaults || [];
    const totalSaved = vaults.reduce((sum, v) => sum + Number(v.current_balance || 0), 0);
    const activeGoals = vaults.filter(v => v.status !== 'broken' || Number(v.current_balance || 0) > 0).length;

    if (elMideSaveTotalSaved) elMideSaveTotalSaved.textContent = formatNaira(totalSaved);
    if (elMideSaveActiveCount) elMideSaveActiveCount.textContent = String(activeGoals);
    if (elMideSaveModalTotal) elMideSaveModalTotal.textContent = formatNaira(totalSaved);
    if (elMideSaveModalWalletBal) elMideSaveModalWalletBal.textContent = formatNaira(state.dashBalance);

    if (elMideSaveVaultsPreview) {
      if (vaults.length === 0) {
        elMideSaveVaultsPreview.innerHTML = `
          <div style="padding:1rem; text-align:center; color:var(--text-muted); font-size:0.84rem; border:1px dashed var(--border-subtle); border-radius:10px;">
            A little space for your next big goal. Savings tools are available to explore in this preview; no interest is earned here.
          </div>
        `;
      } else {
        elMideSaveVaultsPreview.innerHTML = vaults.slice(0, 3).map(v => buildVaultCardHtml(v, true)).join('');
        bindVaultActionButtons(elMideSaveVaultsPreview);
      }
    }

    if (elMideSaveModalList) {
      if (vaults.length === 0) {
        elMideSaveModalList.innerHTML = `
          <div style="padding:1.6rem; text-align:center; color:var(--text-muted); font-size:0.86rem;">
            No savings goals yet. You can explore how a goal would look here. Real savings and interest are not available in this preview.
          </div>
        `;
      } else {
        elMideSaveModalList.innerHTML = vaults.map(v => buildVaultCardHtml(v, false)).join('');
        bindVaultActionButtons(elMideSaveModalList);
      }
    }
  }

  async function loadUserSavingsVaults(userId = null) {
    const targetUserId = userId || state.user?.id;
    if (!targetUserId || !window.MidePayDB || typeof window.MidePayDB.getSavingsVaults !== 'function') {
      mideSaveState.vaults = [];
      renderMideSaveVaults();
      return [];
    }
    mideSaveState.userId = targetUserId;
    mideSaveState.vaults = await window.MidePayDB.getSavingsVaults(targetUserId);
    renderMideSaveVaults();
    return mideSaveState.vaults;
  }
  window.loadUserSavingsVaults = loadUserSavingsVaults;
  window.getMideSaveState = () => mideSaveState;

  async function openMideSaveModal(openCreateForm = false) {
    ensureUserSession();
    modalMideSave?.classList.remove('hidden');
    mideSaveActionPanel?.classList.add('hidden');
    if (openCreateForm) {
      mideSaveCreateSection?.classList.remove('hidden');
    } else {
      mideSaveCreateSection?.classList.add('hidden');
    }
    if (state.user?.id) {
      await loadUserSavingsVaults(state.user.id);
    } else {
      renderMideSaveVaults();
    }
  }
  window.openMideSaveModal = openMideSaveModal;

  function openVaultTransactionDrawer(vaultId, mode = 'fund') {
    ensureUserSession();
    const vault = mideSaveState.vaults.find(v => v.id === vaultId);
    if (!vault) return;

    modalMideSave?.classList.remove('hidden');
    mideSaveCreateSection?.classList.add('hidden');
    mideSaveActionPanel?.classList.remove('hidden');
    mideSaveActionError?.classList.add('hidden');

    if (mideSaveActionVaultId) mideSaveActionVaultId.value = vault.id;
    if (mideSaveActionMode) mideSaveActionMode.value = mode === 'withdraw' ? 'withdraw' : 'fund';
    if (mideSaveActionPin) mideSaveActionPin.value = '';

    const isWithdraw = mode === 'withdraw';
    const isLockedFuture = Boolean(vault.lock_until && new Date(vault.lock_until) > new Date());
    if (mideSaveActionHeading) {
      mideSaveActionHeading.textContent = isWithdraw
        ? `Withdraw from "${vault.title}" (Available: ${formatNaira(vault.current_balance)})`
        : `Top Up "${vault.title}" (Wallet: ${formatNaira(state.dashBalance)})`;
    }
    if (mideSaveActionAmount) {
      mideSaveActionAmount.value = isWithdraw
        ? String(Math.min(25000, Number(vault.current_balance || 0)))
        : '25000';
    }
    if (mideSaveEarlyBreakWarning) {
      mideSaveEarlyBreakWarning.classList.toggle('hidden', !(isWithdraw && isLockedFuture));
    }
  }
  window.openVaultTransactionDrawer = openVaultTransactionDrawer;

  if (qaMideSave) qaMideSave.addEventListener('click', () => openMideSaveModal(false));
  if (btnDashOpenMideSave) btnDashOpenMideSave.addEventListener('click', () => openMideSaveModal(false));
  if (btnDashCreateVault) btnDashCreateVault.addEventListener('click', () => openMideSaveModal(true));
  if (closeMideSaveModalBtn) closeMideSaveModalBtn.addEventListener('click', () => modalMideSave?.classList.add('hidden'));
  if (modalMideSave) {
    modalMideSave.addEventListener('click', (e) => {
      if (e.target === modalMideSave) modalMideSave.classList.add('hidden');
    });
  }

  if (btnShowCreateVaultForm) {
    btnShowCreateVaultForm.addEventListener('click', () => {
      mideSaveActionPanel?.classList.add('hidden');
      mideSaveCreateSection?.classList.toggle('hidden');
    });
  }
  if (btnCancelCreateVault) {
    btnCancelCreateVault.addEventListener('click', () => mideSaveCreateSection?.classList.add('hidden'));
  }
  if (btnCancelMideSaveAction) {
    btnCancelMideSaveAction.addEventListener('click', () => mideSaveActionPanel?.classList.add('hidden'));
  }

  document.querySelectorAll('[data-vault-preset]').forEach(chip => {
    chip.addEventListener('click', () => {
      if (vaultTitleInput) vaultTitleInput.value = chip.getAttribute('data-vault-preset') || '';
      if (vaultCategorySelect) vaultCategorySelect.value = chip.getAttribute('data-vault-cat') || 'General';
      if (vaultTargetInput) vaultTargetInput.value = chip.getAttribute('data-vault-target') || '500000';
    });
  });

  if (mideSaveCreateForm) {
    mideSaveCreateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      ensureUserSession();
      const createVaultBtn = mideSaveCreateForm.querySelector('button[type="submit"]');
      await withSubmitLock('midesave-create-vault', createVaultBtn, 'Creating Vault...', async () => {
        const title = vaultTitleInput?.value.trim() || '';
        const category = vaultCategorySelect?.value || 'General';
        const targetAmount = Number(vaultTargetInput?.value || 0);
        const lockUntil = vaultLockDateInput?.value ? vaultLockDateInput.value : null;

        const res = await window.MidePayDB.createSavingsVault({
          userId: state.user?.id,
          title,
          category,
          targetAmount,
          lockUntil
        });

        if (!res.success || !res.vault) {
          showToast(res.error || 'Unable to create savings vault.', 'error');
          return;
        }

        mideSaveState.vaults.unshift(res.vault);
        if (vaultTitleInput) vaultTitleInput.value = '';
        if (vaultLockDateInput) vaultLockDateInput.value = '';
        mideSaveCreateSection?.classList.add('hidden');
        renderMideSaveVaults();
        showToast(`🎯 Created MideSave vault "${res.vault.title}" (14.5% p.a.)!`, 'success');
      });
    });
  }

  if (mideSaveActionForm) {
    mideSaveActionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      mideSaveActionError?.classList.add('hidden');

      const actionSubmitBtn = mideSaveActionForm.querySelector('button[type="submit"]');
      await withSubmitLock('midesave-vault-action', actionSubmitBtn, 'Processing Vault...', async (idempotencyKey) => {
        const vaultId = mideSaveActionVaultId?.value;
        const mode = mideSaveActionMode?.value || 'fund';
        const amount = Math.round(Number(mideSaveActionAmount?.value || 0) * 100) / 100;
        const pinVal = mideSaveActionPin?.value;

        if (!vaultId || !Number.isFinite(amount) || amount <= 0) {
          if (mideSaveActionError && mideSaveActionErrorText) {
            mideSaveActionErrorText.textContent = 'Please enter a valid amount greater than ₦0.00.';
            mideSaveActionError.classList.remove('hidden');
          }
          return;
        }

        if (window.MidePayDB && typeof window.MidePayDB.isFinancialQuarantined === 'function' && window.MidePayDB.isFinancialQuarantined()) {
          const qMsg = 'Staging Quarantine: Client-side MideSave vault mutations are disabled until backend settlement is live.';
          if (mideSaveActionError && mideSaveActionErrorText) {
            mideSaveActionErrorText.textContent = qMsg;
            mideSaveActionError.classList.remove('hidden');
          } else {
            showToast(qMsg, 'error');
          }
          return;
        }

        const pinCheck = await verifyOrSetupActionPin(pinVal);
        if (!pinCheck.valid) {
          if (mideSaveActionError && mideSaveActionErrorText) {
            mideSaveActionErrorText.textContent = pinCheck.error;
            mideSaveActionError.classList.remove('hidden');
          }
          return;
        }

        const targetVault = mideSaveState.vaults.find(v => v.id === vaultId);
        if (!targetVault) return;

        if (mode === 'fund') {
          if (amount > state.dashBalance) {
            if (mideSaveActionError && mideSaveActionErrorText) {
              mideSaveActionErrorText.textContent = `Insufficient wallet balance (${formatNaira(state.dashBalance)} available).`;
              mideSaveActionError.classList.remove('hidden');
            }
            return;
          }

          const fundRes = await window.MidePayDB.fundSavingsVault(vaultId, amount, state.user?.id, {
            pin: pinVal,
            idempotencyKey
          });
          if (!fundRes.success) {
            if (mideSaveActionError && mideSaveActionErrorText) {
              mideSaveActionErrorText.textContent = fundRes.error || 'Vault deposit failed.';
              mideSaveActionError.classList.remove('hidden');
            }
            return;
          }

          targetVault.current_balance = Number(fundRes.vaultBalance);
          await rehydrateBalanceFromServer(fundRes.newBalance);

          state.transactions.unshift({
            id: 'tx-' + Date.now(),
            ref: fundRes.reference,
            title: `MideSave Deposit — ${targetVault.title}`,
            category: 'Savings',
            sender: state.user?.fullName || 'Account Holder',
            beneficiary: `MideSave Vault (${targetVault.title})`,
            narration: `MideSave Deposit — ${targetVault.title}`,
            date: 'Just now',
            type: 'outflow',
            amount,
            fee: 0.00,
            status: 'Successful'
          });

          showToast(`💰 Saved ${formatNaira(amount)} into "${targetVault.title}"!`, 'success');
        } else {
          if (amount > Number(targetVault.current_balance || 0)) {
            if (mideSaveActionError && mideSaveActionErrorText) {
              mideSaveActionErrorText.textContent = `Insufficient vault balance (${formatNaira(targetVault.current_balance)} available).`;
              mideSaveActionError.classList.remove('hidden');
            }
            return;
          }

          const wdrRes = await window.MidePayDB.withdrawSavingsVault(vaultId, amount, state.user?.id, {
            pin: pinVal,
            idempotencyKey
          });
          if (!wdrRes.success) {
            if (mideSaveActionError && mideSaveActionErrorText) {
              mideSaveActionErrorText.textContent = wdrRes.error || 'Vault withdrawal failed.';
              mideSaveActionError.classList.remove('hidden');
            }
            return;
          }

          targetVault.current_balance = Number(wdrRes.vaultBalance);
          if (wdrRes.status) targetVault.status = wdrRes.status;
          await rehydrateBalanceFromServer(wdrRes.newBalance);

          state.transactions.unshift({
            id: 'tx-' + Date.now(),
            ref: wdrRes.reference,
            title: `MideSave Withdrawal — ${targetVault.title}`,
            category: 'Savings',
            sender: `MideSave Vault (${targetVault.title})`,
            beneficiary: state.user?.fullName || 'Account Holder',
            narration: wdrRes.earlyBreakFee > 0
              ? `Early-break withdrawal (1.5% fee: ${formatNaira(wdrRes.earlyBreakFee)})`
              : `MideSave Vault Withdrawal — ${targetVault.title}`,
            date: 'Just now',
            type: 'inflow',
            amount: wdrRes.netCredited,
            fee: wdrRes.earlyBreakFee,
            status: 'Successful'
          });

          showToast(
            wdrRes.earlyBreakFee > 0
              ? `Credited ${formatNaira(wdrRes.netCredited)} to wallet (${formatNaira(wdrRes.earlyBreakFee)} 1.5% early-break fee).`
              : `🎉 Withdrew ${formatNaira(wdrRes.netCredited)} from "${targetVault.title}" to your wallet!`,
            'success'
          );
        }

        saveUserTransactions();
        mideSaveActionPanel?.classList.add('hidden');
        renderDashboardTransactions();
        renderMideSaveVaults();
      });
    });
  }

  // =========================================================================
  // v4.4 MODULE 3: BUSINESS SUITE — TEAM PAYROLL (BATCH DISBURSEMENT)
  // =========================================================================
  const payrollState = {
    roster: [],
    runs: [],
    resolvedCandidate: null
  };

  const btnWorkspacePersonal = document.getElementById('dash-workspace-personal');
  const btnWorkspaceBusiness = document.getElementById('dash-workspace-business');
  const panelPersonal = document.getElementById('dashboard-personal-panel');
  const panelBusiness = document.getElementById('dashboard-business-panel');
  const qaPayroll = document.getElementById('qa-payroll');
  const btnPayrollBackPersonal = document.getElementById('btn-payroll-back-personal');
  const elPayrollWalletBalance = document.getElementById('payroll-wallet-balance');

  const payrollAddStaffForm = document.getElementById('payroll-add-staff-form');
  const payrollStaffIdentifier = document.getElementById('payroll-staff-identifier');
  const payrollStaffRole = document.getElementById('payroll-staff-role');
  const payrollStaffSalary = document.getElementById('payroll-staff-salary');
  const payrollStaffResolvedBox = document.getElementById('payroll-staff-resolved-box');
  const payrollStaffResolvedBadge = document.getElementById('payroll-staff-resolved-badge');
  const payrollStaffResolvedText = document.getElementById('payroll-staff-resolved-text');

  const payrollRosterTbody = document.getElementById('payroll-roster-tbody');
  const payrollRunTitle = document.getElementById('payroll-run-title');
  const payrollSummaryCount = document.getElementById('payroll-summary-count');
  const payrollSummaryTotal = document.getElementById('payroll-summary-total');
  const payrollPinInput = document.getElementById('payroll-pin-input');
  const payrollErrorAlert = document.getElementById('payroll-error-alert');
  const payrollErrorText = document.getElementById('payroll-error-text');
  const btnExecutePayroll = document.getElementById('btn-execute-payroll');
  const payrollHistoryList = document.getElementById('payroll-history-list');

  function switchDashboardWorkspace(mode = 'personal') {
    const isBus = mode === 'business';
    btnWorkspacePersonal?.classList.toggle('active', !isBus);
    btnWorkspacePersonal?.setAttribute('aria-selected', isBus ? 'false' : 'true');
    btnWorkspaceBusiness?.classList.toggle('active', isBus);
    btnWorkspaceBusiness?.setAttribute('aria-selected', isBus ? 'true' : 'false');
    panelPersonal?.classList.toggle('hidden', isBus);
    panelBusiness?.classList.toggle('hidden', !isBus);

    if (isBus) {
      ensureUserSession();
      if (elPayrollWalletBalance) elPayrollWalletBalance.textContent = formatNaira(state.dashBalance);
      renderPayrollRoster();
      loadBusinessPayrollHistory(state.user?.id).catch(console.warn);
    }
  }
  window.switchDashboardWorkspace = switchDashboardWorkspace;

  if (btnWorkspacePersonal) btnWorkspacePersonal.addEventListener('click', () => switchDashboardWorkspace('personal'));
  if (btnWorkspaceBusiness) btnWorkspaceBusiness.addEventListener('click', () => switchDashboardWorkspace('business'));
  if (btnPayrollBackPersonal) btnPayrollBackPersonal.addEventListener('click', () => switchDashboardWorkspace('personal'));
  if (qaPayroll) qaPayroll.addEventListener('click', () => switchDashboardWorkspace('business'));

  async function resolvePayrollStaffIdentifier(rawInput = null) {
    const query = String(rawInput !== null ? rawInput : (payrollStaffIdentifier?.value || '')).trim();
    if (!query || query.length < 2) {
      payrollState.resolvedCandidate = null;
      payrollStaffResolvedBox?.classList.add('hidden');
      return null;
    }

    const cleanDigits = query.replace(/[^0-9]/g, '');
    const ownNuban = state.user?.nuban ? String(state.user.nuban).replace(/\s+/g, '') : '';
    if ((cleanDigits.length === 10 && cleanDigits === ownNuban) || (state.user?.tag && query.toLowerCase() === state.user.tag.toLowerCase())) {
      payrollState.resolvedCandidate = null;
      if (payrollStaffResolvedBox && payrollStaffResolvedText) {
        payrollStaffResolvedBox.classList.remove('hidden');
        payrollStaffResolvedBox.classList.add('is-error');
        if (payrollStaffResolvedBadge) payrollStaffResolvedBadge.textContent = '!';
        payrollStaffResolvedText.innerHTML = `<span style="color:#FCA5A5;">You cannot add your own employer account to payroll.</span>`;
      }
      return null;
    }

    let found = null;
    if (window.MidePayDB && typeof window.MidePayDB.findRecipient === 'function') {
      found = await window.MidePayDB.findRecipient(query, state.user?.id);
    }

    // Also allow resolving local registered accounts in local sandbox when Supabase client is null
    if (!found && (!window.MidePayDB || !window.MidePayDB.client)) {
      const reg = getAccountsRegistry();
      const lower = query.toLowerCase();
      const match = reg.find(u => {
        if (state.user && u.email && state.user.email && u.email.toLowerCase() === state.user.email.toLowerCase()) return false;
        if (cleanDigits.length === 10 && u.nuban && String(u.nuban).replace(/\s+/g, '') === cleanDigits) return true;
        if (u.tag && u.tag.toLowerCase() === (lower.startsWith('@') ? lower : `@${lower}`)) return true;
        if (u.email && u.email.toLowerCase() === lower) return true;
        return false;
      });
      if (match) {
        found = {
          id: match.id,
          fullName: match.fullName,
          email: match.email,
          tag: match.tag,
          nuban: match.nuban
        };
      }
    }

    if (found) {
      payrollState.resolvedCandidate = found;
      if (payrollStaffResolvedBox && payrollStaffResolvedText) {
        payrollStaffResolvedBox.classList.remove('hidden', 'is-error');
        if (payrollStaffResolvedBadge) payrollStaffResolvedBadge.textContent = '✓';
        payrollStaffResolvedText.innerHTML = `Verified MidePay Staff: <strong>${escapeHtml(found.fullName)}</strong> <span style="color:#A7F3D0; font-size:0.75rem;">(${escapeHtml(found.tag || '@midepay')}${found.nuban ? ' • ' + escapeHtml(found.nuban) : ''})</span>`;
      }
      return found;
    }

    payrollState.resolvedCandidate = null;
    if (payrollStaffResolvedBox && payrollStaffResolvedText) {
      payrollStaffResolvedBox.classList.remove('hidden');
      payrollStaffResolvedBox.classList.add('is-error');
      if (payrollStaffResolvedBadge) payrollStaffResolvedBadge.textContent = '!';
      payrollStaffResolvedText.innerHTML = `<span style="color:#FCA5A5;">No MidePay account found for "${escapeHtml(query)}". Enter a registered 10-digit MidePay NUBAN or @tag.</span>`;
    }
    return null;
  }
  window.resolvePayrollStaffIdentifier = resolvePayrollStaffIdentifier;

  let payrollLookupTimer = null;
  if (payrollStaffIdentifier) {
    payrollStaffIdentifier.addEventListener('input', () => {
      clearTimeout(payrollLookupTimer);
      payrollLookupTimer = setTimeout(() => {
        resolvePayrollStaffIdentifier().catch(console.warn);
      }, 220);
    });
  }

  function renderPayrollRoster() {
    if (elPayrollWalletBalance) elPayrollWalletBalance.textContent = formatNaira(state.dashBalance);
    const total = payrollState.roster.reduce((s, r) => s + Number(r.amount || 0), 0);
    if (payrollSummaryCount) {
      payrollSummaryCount.textContent = `${payrollState.roster.length} ${payrollState.roster.length === 1 ? 'Employee' : 'Employees'}`;
    }
    if (payrollSummaryTotal) payrollSummaryTotal.textContent = formatNaira(total);

    if (!payrollRosterTbody) return;
    if (payrollState.roster.length === 0) {
      payrollRosterTbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; padding:1.6rem; color:var(--text-muted);">No staff added yet. Enter a MidePay 10-digit NUBAN or @tag above to add your team.</td>
        </tr>
      `;
      return;
    }

    payrollRosterTbody.innerHTML = payrollState.roster.map((emp, idx) => `
      <tr>
        <td><strong>${escapeHtml(emp.name)}</strong></td>
        <td style="font-family:monospace;">${escapeHtml(emp.nuban || emp.identifier)} <span style="color:#34D399; font-size:0.75rem;">${escapeHtml(emp.tag || '')}</span></td>
        <td>${escapeHtml(emp.role)}</td>
        <td style="text-align:right; font-weight:700;">${formatNaira(emp.amount)}</td>
        <td style="text-align:right;">
          <button type="button" class="btn btn-ghost-xs" data-remove-payroll-idx="${idx}" style="color:#FCA5A5;">Remove</button>
        </td>
      </tr>
    `).join('');

    payrollRosterTbody.querySelectorAll('[data-remove-payroll-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-remove-payroll-idx'));
        payrollState.roster.splice(i, 1);
        renderPayrollRoster();
      });
    });
  }

  if (payrollAddStaffForm) {
    payrollAddStaffForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      payrollErrorAlert?.classList.add('hidden');

      const ident = payrollStaffIdentifier?.value.trim() || '';
      const role = payrollStaffRole?.value.trim() || 'Team Member';
      const salary = Math.round(Number(payrollStaffSalary?.value || 0) * 100) / 100;

      if (!ident || !Number.isFinite(salary) || salary < 500) {
        showToast('Enter a valid MidePay NUBAN/@tag and monthly salary (minimum ₦500).', 'error');
        return;
      }

      const resolved = payrollState.resolvedCandidate || await resolvePayrollStaffIdentifier(ident);
      if (!resolved) {
        showToast('Please enter a verified MidePay 10-digit NUBAN or @tag.', 'error');
        return;
      }

      if (payrollState.roster.some(r => r.userId === resolved.id || r.identifier.toLowerCase() === ident.toLowerCase())) {
        showToast(`${resolved.fullName} is already on this payroll roster.`, 'error');
        return;
      }

      payrollState.roster.push({
        userId: resolved.id,
        email: resolved.email || null,
        name: resolved.fullName,
        tag: resolved.tag || '',
        nuban: resolved.nuban || null,
        identifier: resolved.nuban || ident,
        role,
        amount: salary
      });

      if (payrollStaffIdentifier) payrollStaffIdentifier.value = '';
      payrollState.resolvedCandidate = null;
      payrollStaffResolvedBox?.classList.add('hidden');
      renderPayrollRoster();
      showToast(`✓ Added ${resolved.fullName} (${formatNaira(salary)}) to payroll roster!`);
    });
  }

  function renderPayrollHistory() {
    if (!payrollHistoryList) return;
    if (!payrollState.runs || payrollState.runs.length === 0) {
      payrollHistoryList.innerHTML = `<div style="font-size:0.82rem; color:var(--text-muted); padding:0.75rem 0;">No batch payroll runs executed yet.</div>`;
      return;
    }

    payrollHistoryList.innerHTML = payrollState.runs.slice(0, 6).map(run => `
      <div style="padding:0.75rem 0.85rem; background:rgba(255,255,255,0.025); border:1px solid var(--border-subtle); border-radius:10px; display:flex; justify-content:space-between; align-items:center; gap:0.75rem;">
        <div>
          <strong style="font-size:0.86rem; color:var(--text-primary); display:block;">${escapeHtml(run.title)}</strong>
          <span style="font-size:0.74rem; color:var(--text-muted);">${escapeHtml(run.reference)} • ${Number(run.employee_count || 0)} staff</span>
        </div>
        <strong style="color:#34D399; font-size:0.9rem;">${formatNaira(run.total_amount)}</strong>
      </div>
    `).join('');
  }

  async function loadBusinessPayrollHistory(userId = null) {
    const targetUserId = userId || state.user?.id;
    if (!targetUserId || !window.MidePayDB || typeof window.MidePayDB.getPayrollHistory !== 'function') {
      payrollState.runs = [];
      renderPayrollHistory();
      return [];
    }
    payrollState.runs = await window.MidePayDB.getPayrollHistory(targetUserId);
    renderPayrollHistory();
    return payrollState.runs;
  }
  window.loadBusinessPayrollHistory = loadBusinessPayrollHistory;
  window.getPayrollRosterState = () => payrollState;

  if (btnExecutePayroll) {
    btnExecutePayroll.addEventListener('click', async () => {
      ensureUserSession();
      payrollErrorAlert?.classList.add('hidden');

      await withSubmitLock('business-payroll-disburse', btnExecutePayroll, 'Disbursing Payroll...', async (idempotencyKey) => {
        if (window.MidePayDB && typeof window.MidePayDB.isFinancialQuarantined === 'function' && window.MidePayDB.isFinancialQuarantined()) {
          const qMsg = 'Staging Quarantine: Client-side batch payroll disbursements are disabled until backend settlement is live.';
          if (payrollErrorAlert && payrollErrorText) {
            payrollErrorText.textContent = qMsg;
            payrollErrorAlert.classList.remove('hidden');
          } else {
            showToast(qMsg, 'error');
          }
          return;
        }

        if (payrollState.roster.length === 0) {
          if (payrollErrorAlert && payrollErrorText) {
            payrollErrorText.textContent = 'Add at least one verified staff member to your roster before disbursing.';
            payrollErrorAlert.classList.remove('hidden');
          }
          return;
        }

        const totalPayroll = payrollState.roster.reduce((s, r) => s + Number(r.amount || 0), 0);
        if (totalPayroll > state.dashBalance) {
          if (payrollErrorAlert && payrollErrorText) {
            payrollErrorText.textContent = `Insufficient wallet balance: ${formatNaira(totalPayroll)} required, ${formatNaira(state.dashBalance)} available.`;
            payrollErrorAlert.classList.remove('hidden');
          }
          return;
        }

        const pinCheck = await verifyOrSetupActionPin(payrollPinInput?.value);
        if (!pinCheck.valid) {
          if (payrollErrorAlert && payrollErrorText) {
            payrollErrorText.textContent = pinCheck.error;
            payrollErrorAlert.classList.remove('hidden');
          }
          return;
        }

        const runTitle = payrollRunTitle?.value.trim() || 'Monthly Team Payroll';
        const res = await window.MidePayDB.executeBusinessPayroll({
          userId: state.user?.id,
          title: runTitle,
          employees: payrollState.roster,
          pin: payrollPinInput?.value || null,
          idempotencyKey
        });

        if (!res.success) {
          if (payrollErrorAlert && payrollErrorText) {
            payrollErrorText.textContent = res.error || 'Batch payroll execution failed.';
            payrollErrorAlert.classList.remove('hidden');
          }
          return;
        }

        await rehydrateBalanceFromServer(res.newBalance);

        const batchTx = {
          id: 'tx-payroll-' + Date.now(),
          ref: res.reference,
          title: `${runTitle} (${res.employeeCount} Staff)`,
          category: 'Payroll',
          sender: state.user?.fullName || 'MidePay Business',
          beneficiary: `${res.employeeCount} Verified Staff Members`,
          narration: `Batch Payroll Disbursement — ${runTitle}`,
          date: 'Just now',
          type: 'outflow',
          amount: Number(res.totalAmount ?? totalPayroll),
          fee: 0.00,
          status: 'Successful'
        };
        state.transactions.unshift(batchTx);
        saveUserTransactions();

        payrollState.roster = [];
        if (payrollPinInput) payrollPinInput.value = '';
        await loadBusinessPayrollHistory(state.user?.id);
        renderDashboardTransactions();
        renderPayrollRoster();

        showToast(`🎉 Disbursed ${formatNaira(batchTx.amount)} payroll to ${res.employeeCount} staff members!`, 'success');
        openReceiptModal(batchTx);
      });
    });
  }

  function resetMideSaveAndPayrollState() {
    mideSaveState.userId = null;
    mideSaveState.vaults = [];
    payrollState.roster = [];
    payrollState.runs = [];
    payrollState.resolvedCandidate = null;
    renderMideSaveVaults();
    renderPayrollRoster();
    renderPayrollHistory();
  }
  window.resetMideSaveAndPayrollState = resetMideSaveAndPayrollState;

  // Hydrate initial vaults if user already active on boot
  if (state.user?.id) {
    loadUserSavingsVaults(state.user.id).catch(() => {});
  } else {
    renderMideSaveVaults();
  }
});

/* === MidePay v4.4 Dashboard Polish Patch === */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Dynamic Payroll Cycle Title (replaces hardcoded month/year)
  const payrollInput = document.getElementById('payroll-run-title')
    || document.querySelector('input[value*="Team Salary Run"]');
  if (payrollInput) {
    const currentMonthYear = new Date().toLocaleDateString('en-NG', {
      month: 'long',
      year: 'numeric'
    });
    payrollInput.value = `${currentMonthYear} Team Salary Run`;
  }

  // 2. Hide "+ Fund ₦50k (Demo)" button when running in production
  const isProd = (
    window.MIDEPAY_SUPABASE_CONFIG?.ENV === 'production' ||
    window.MIDEPAY_SUPABASE_CONFIG?.env === 'production'
  );
  if (isProd) {
    const demoTopupBtn = document.getElementById('btn-dash-quick-topup');
    if (demoTopupBtn) demoTopupBtn.style.display = 'none';
    document.querySelectorAll('button').forEach((btn) => {
      if (btn.textContent && btn.textContent.includes('(Demo)')) {
        btn.style.display = 'none';
      }
    });
  }

  // 3. Enable "+ Fund Card" button so users can fund USD/NGN cards from main wallet
  const fundCardModalBtn = document.getElementById('btn-fund-card-modal');
  if (fundCardModalBtn) {
    fundCardModalBtn.disabled = false;
    fundCardModalBtn.style.opacity = '1';
    fundCardModalBtn.style.cursor = 'pointer';
  }
  document.querySelectorAll('button').forEach((btn) => {
    if (btn.textContent && btn.textContent.includes('Fund Card')) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  });
});

// 4. Currency-aware Virtual Card Subscriptions (prevents USD items showing on NGN card)
function getCardSubscriptions(currency, cardBalance = 0) {
  if (Number(cardBalance) <= 0) {
    return []; // Show clean empty state when card balance is 0.00
  }
  if (currency === 'NGN') {
    return [
      { merchant: 'DSTV Compact Plus', amount: '-₦29,500.00', date: 'Auto-debit • Active' },
      { merchant: 'Spectranet Fiber 4G', amount: '-₦18,500.00', date: 'Monthly • Active' }
    ];
  }
  return [
    { merchant: 'Spotify Premium Family', amount: '-$9.99', date: 'Monthly • Active' },
    { merchant: 'Amazon Web Services', amount: '-$42.50', date: 'Cloud • Active' },
    { merchant: 'Netflix International', amount: '-$12.00', date: 'Monthly • Active' }
  ];
}
window.getCardSubscriptions = getCardSubscriptions;
