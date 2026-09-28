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
  dailySpent: 45000.00,
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
      desc: 'Send money instantly to any MideTag or Nigerian commercial bank account with ₦0 transfer fees.',
      tag: '₦0 Transfer Fees',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>`
    },
    {
      title: 'Virtual Dollar & Naira Cards',
      desc: 'Create secure multi-currency virtual cards for Spotify, Apple Music, AWS, Coursera, and international travel.',
      tag: 'Zero Decline Rate',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
        <line x1="1" y1="10" x2="23" y2="10"></line>
      </svg>`
    },
    {
      title: 'Automated Target Vaults',
      desc: 'Lock funds towards rent, school fees, or vacation. Earn simulated interest rates up to 14% p.a.',
      tag: 'Up to 14% p.a.',
      iconSvg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>`
    },
    {
      title: 'Smart Utilities & Cashback',
      desc: 'Pay for electricity (IKEDC, EKEDC), cable TV (DSTV, GOTV), and buy airtime with guaranteed 3% instant cashback.',
      tag: '3% Cashback',
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

// Generate Unique 10-Digit Nigerian NUBAN
function generateUserNuban(seed) {
  if (!seed) return '90' + Math.floor(10000000 + Math.random() * 90000000);
  let hash = 0;
  const str = String(seed).trim().toLowerCase();
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const pos = Math.abs(hash);
  const numPart = (pos % 90000000 + 10000000).toString();
  return '90' + numPart;
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
    <span class="toast-message">${message}</span>
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

// Ensure active session & balance for operations (Send, Airtime, Cable, Cards)
function ensureUserSession() {
  if (!state.user) {
    const defaultUser = findAccount('olasunkanmiolamide15@gmail.com') || BUILTIN_REGISTERED_ACCOUNTS[0];
    state.user = defaultUser;
    state.dashBalance = (defaultUser.balance !== undefined && Number(defaultUser.balance) > 0) ? Number(defaultUser.balance) : 850000.00;
    const localTxs = loadUserTransactions();
    state.transactions = (localTxs && localTxs.length > 0) ? localTxs : [...DEFAULT_DEMO_TRANSACTIONS];
    saveAccountToRegistry(defaultUser);
    localStorage.setItem('midepay_session', JSON.stringify({ email: defaultUser.email, loggedIn: true }));
    syncUserToDashboard();
    renderBalances();
    renderDashboardTransactions();
  } else if (!state.dashBalance || state.dashBalance <= 0) {
    state.dashBalance = (state.user.balance !== undefined && Number(state.user.balance) > 0) ? Number(state.user.balance) : 850000.00;
    renderBalances();
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
    if (dashDisplay) dashDisplay.textContent = formatNaira(state.dashBalance);
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
          showToast('🎯 Automated Target Vaults active in dashboard balance!');
        }
      } else {
        showView('admin');
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

// Render Dashboard Transactions List
function renderDashboardTransactions() {
  const listContainer = document.getElementById('dashboard-tx-list');
  const requestsContainer = document.getElementById('dashboard-requests-list');
  if (!listContainer) return;

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
      <div class="dash-tx-item" data-id="${tx.id}" role="button" tabindex="0" title="Click to view official receipt">
        <div class="dash-tx-left">
          <div class="tx-badge-icon ${isInflow ? 'tx-inflow' : 'tx-outflow'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              ${isInflow 
                ? '<polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>' 
                : '<polyline points="17 14 12 9 7 14"></polyline><line x1="12" y1="9" x2="12" y2="21"></line>'}
            </svg>
          </div>
          <div class="dash-tx-details">
            <span class="dash-tx-title">${tx.title}</span>
            <span class="dash-tx-meta">${tx.sender} • ${tx.date}</span>
          </div>
        </div>
        <div class="dash-tx-right">
          <div class="dash-tx-val ${isInflow ? 'tx-positive' : 'tx-negative'}">
            ${isInflow ? '+' : '-'}${formatNaira(tx.amount)}
          </div>
          <span class="dash-tx-status">${tx.status} • Receipt ↗</span>
        </div>
      </div>
    `;
  }).join('');

  // Attach click listeners to view receipt for each transaction item
  listContainer.querySelectorAll('.dash-tx-item').forEach(item => {
    item.addEventListener('click', () => {
      const txId = item.getAttribute('data-id');
      const found = state.transactions.find(t => t.id === txId);
      if (found) {
        openReceiptModal(found);
      }
    });
  });
}

// Global active receipt state
// Technical 30-digit NIBSS Session ID Generator (CBN NIP technical specification)
function generateNibssSessionId() {
  const switchCode = '999048'; // 999 = NIBSS switch prefix, 048 = MidePay routing code
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, ''); // 6 digits YYMMDD
  const timePart = Date.now().toString().slice(-6); // 6 digits
  const randPart = Math.floor(100000000000 + Math.random() * 900000000000).toString(); // 12 digits
  return `${switchCode}${datePart}${timePart}${randPart}`;
}

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

  if (elAmount) elAmount.textContent = formatNaira(receiptData.amount || 0);
  if (elDate) {
    if (receiptData.date === 'Just now' || !receiptData.date) {
      elDate.textContent = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
    } else {
      elDate.textContent = receiptData.date;
    }
  }
  if (elRef) elRef.textContent = receiptData.ref || ('MP-TX-' + Date.now().toString().slice(-8));
  if (elCategory) elCategory.textContent = receiptData.category || (receiptData.type === 'inflow' ? 'Deposit / Inflow' : 'Transfer Outflow');
  if (elSender) elSender.textContent = receiptData.sender || state.user?.fullName || 'Account Holder';
  if (elBeneficiary) elBeneficiary.textContent = receiptData.beneficiary || receiptData.title || 'MidePay Beneficiary';
  if (elNarration) elNarration.textContent = receiptData.narration || receiptData.title || 'MidePay Financial Transaction';
  const elSourceAcc = document.getElementById('receipt-source-account');
  if (elSourceAcc) elSourceAcc.textContent = `${state.user?.bank || 'Providus Bank'} • ${state.user?.nuban || '9000 0000 00'}`;

  // 20-digit Prepaid Electricity Token Container
  if (receiptData.token && tokenContainer) {
    tokenContainer.classList.remove('hidden');
    if (elTokenDigits) elTokenDigits.textContent = receiptData.token;
    if (elTokenUnits) elTokenUnits.textContent = receiptData.units || 'Estimated Units: Standard Tariff';
  } else if (tokenContainer) {
    tokenContainer.classList.add('hidden');
  }

  // CBN Standard: Mandatory 30-Digit NIBSS Session ID
  const elSessionId = document.getElementById('receipt-session-id');
  if (!receiptData.nibssSessionId) {
    receiptData.nibssSessionId = generateNibssSessionId();
  }
  if (elSessionId) elSessionId.textContent = receiptData.nibssSessionId;

  // Wire copy NIBSS Session ID button
  const btnCopySession = document.getElementById('btn-copy-session');
  if (btnCopySession) {
    btnCopySession.onclick = () => {
      navigator.clipboard.writeText(receiptData.nibssSessionId || '').then(() => {
        showToast('✓ NIBSS Session ID copied to clipboard!');
      });
    };
  }

  // CBN Standard: EMTL Levy (₦50 on electronic inflows >= ₦10,000 per Finance Act)
  const elEmtl = document.getElementById('receipt-emtl-levy');
  if (elEmtl) {
    if (receiptData.type === 'inflow' && (receiptData.amount || 0) >= 10000) {
      elEmtl.textContent = '₦50.00 (Statutory EMTL)';
    } else {
      elEmtl.textContent = '₦0.00 (Exempt)';
    }
  }

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
  if (greetingEl) greetingEl.textContent = `Welcome back, ${displayName} 👋`;

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
  if (receiptSourceAcc) receiptSourceAcc.textContent = `${user.bank || 'Providus Bank'} • ${displayNuban}`;

  // Keep saved in localStorage
  try {
    localStorage.setItem('midepay_user', JSON.stringify(user));
  } catch (e) {}
}

// Query and Load Live Dashboard Data from Supabase
async function loadDashboardData() {
  if (!window.MidePayDB || !window.MidePayDB.isConfigured()) {
    return false;
  }

  try {
    let currentUserId = state.user?.id;

    // Check active Supabase authenticated session
    if (window.MidePayDB.client?.auth) {
      const { data } = await window.MidePayDB.client.auth.getUser();
      const authUser = data?.user;
      if (authUser) {
        currentUserId = authUser.id;
        const profile = await window.MidePayDB.getProfile(authUser.id);
        const name = profile?.full_name || authUser.user_metadata?.full_name || state.user?.fullName || authUser.email.split('@')[0];
        const nuban = state.user?.nuban || generateUserNuban(authUser.email || authUser.id);
        state.user = {
          id: authUser.id,
          fullName: name,
          email: authUser.email,
          phone: profile?.phone || authUser.user_metadata?.phone || state.user?.phone || '',
          tag: profile?.tag || state.user?.tag || `@${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          nuban: nuban,
          bank: 'Providus Bank'
        };
      }
    }

    // Skip query if no user or ID is not a valid UUID (protects PostgreSQL from invalid uuid syntax)
    if (!currentUserId || !isValidUuid(currentUserId)) {
      return false;
    }

    // 1. Query the wallets table for the logged-in user's balance
    // Query: SELECT balance, currency, nuban, bank_name FROM wallets WHERE user_id = auth.uid()
    const { data: walletData, error: walletError } = await window.MidePayDB.client
      .from('wallets')
      .select('id, user_id, balance, currency, nuban, bank_name')
      .eq('user_id', currentUserId)
      .maybeSingle();

    if (walletError) {
      console.warn('⚠️ [MidePay] Error querying wallets table:', walletError.message);
    }

    if (walletData) {
      if (state.user) {
        state.user.walletId = walletData.id;
        if (walletData.nuban) state.user.nuban = walletData.nuban;
        if (walletData.bank_name) state.user.bank = walletData.bank_name;
      }
      if (walletData.balance !== null && walletData.balance !== undefined) {
        const remoteBal = Number(walletData.balance);
        if (remoteBal > 0 || !state.dashBalance) {
          state.dashBalance = remoteBal;
        }
      }
    } else {
      // NOTE: DO NOT blindly zero out the balance if the user already has a valid local balance
      if (state.dashBalance === undefined || state.dashBalance === null || state.dashBalance <= 0) {
        state.dashBalance = (state.user && state.user.balance !== undefined && Number(state.user.balance) > 0) 
          ? Number(state.user.balance) 
          : 850000.00;
      }
    }

    // 2. Query the transactions table for that user's wallet, ordered by most recent, limit 10
    const { data: txData, error: txError } = await window.MidePayDB.client
      .from('transactions')
      .select('*')
      .eq('user_id', currentUserId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (txError) {
      console.warn('⚠️ [MidePay] Error querying transactions table:', txError.message);
    }

    if (txData && txData.length > 0) {
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
        status: tx.status ? (tx.status.charAt(0).toUpperCase() + tx.status.slice(1)) : 'Successful'
      }));
    } else {
      // Keep existing local transactions if Supabase returns none
      const saved = loadUserTransactions();
      if (saved && saved.length > 0) {
        state.transactions = saved;
      } else if (!state.transactions || state.transactions.length === 0) {
        state.transactions = [...DEFAULT_DEMO_TRANSACTIONS];
      }
    }

    // 3. Render updated live values
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
    console.error('❌ [MidePay] Live dashboard load error:', err);
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
        const profile = await window.MidePayDB.getProfile(supaUser.id);
        const name = profile?.full_name || supaUser.user_metadata?.full_name || state.user?.fullName || supaUser.email.split('@')[0];
        const userNuban = state.user?.nuban || generateUserNuban(supaUser.email || supaUser.id);
        state.user = {
          id: supaUser.id,
          fullName: name,
          email: supaUser.email,
          phone: profile?.phone || '',
          tag: profile?.tag || state.user?.tag || `@${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          nuban: userNuban,
          bank: 'Providus Bank',
          role: profile?.role || 'user'
        };
        saveAccountToRegistry(state.user);
        syncUserToDashboard();
        await updateExecutiveNavButtons();
        await loadDashboardData();
      }
    }).catch(console.warn);
  }

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
    navFeaturesLink.addEventListener('click', () => switchFeatures('personal'));
  }
  if (navBusinessLink) {
    navBusinessLink.addEventListener('click', () => switchFeatures('business'));
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
      waitlistFeedback.innerHTML = `🎉 <strong>You're in!</strong> You've been assigned priority slot #15,249. We'll email <em>${email}</em> upon our CBN-partnered launch.`;
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
  // REGISTER FORM SUBMISSION & LOCALSTORAGE / SUPABASE
  // -------------------------------------------------------------
  const registerForm = document.getElementById('register-form');
  const regErrorAlert = document.getElementById('register-error-alert');

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (regErrorAlert) regErrorAlert.classList.add('hidden');

      const fullName = document.getElementById('reg-fullname').value.trim();
      const email = document.getElementById('reg-email').value.trim();
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

      // Check if Supabase backend is configured and register user
      let supaUserId = null;
      const cleanTag = `@${fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const uniqueNuban = generateUserNuban(email || fullName);

      if (window.MidePayDB && window.MidePayDB.isConfigured()) {
        try {
          const { user: supaUser, error: supaErr } = await window.MidePayDB.signUp({ email, password, fullName, phone });
          if (supaErr) {
            console.error('[MidePay] Supabase signUp error:', supaErr.message);
            showRegisterError(supaErr.message || 'Registration failed with Supabase backend.');
            return; // Stop! Never create a fake fallback user ID if Supabase signup failed
          }
          if (supaUser && supaUser.id) {
            supaUserId = supaUser.id; // Real UUID from Supabase
            // Ensure profile and wallet rows are provisioned in Supabase with this UUID
            await window.MidePayDB.ensureProfileAndWallet(supaUser, { fullName, phone, tag: cleanTag, nuban: uniqueNuban });
          }
        } catch (supaEx) {
          console.error('[MidePay] Supabase signUp exception:', supaEx);
          showRegisterError(supaEx.message || 'Error communicating with Supabase.');
          return;
        }
      }

      if (window.MidePayDB && window.MidePayDB.isConfigured() && !supaUserId) {
        showRegisterError('Failed to obtain a valid user identifier from Supabase.');
        return;
      }

      // In local simulation mode (Supabase unconfigured), use valid UUID v4
      const finalUserId = supaUserId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000');

      const newUser = {
        id: finalUserId, // Real Supabase Auth UUID (never fake user- Date.now())
        fullName: fullName,
        email: email,
        phone: phone,
        password: password,
        tag: cleanTag,
        nuban: uniqueNuban,
        bank: 'Providus Bank',
        balance: 250000.00,
        registeredAt: new Date().toISOString()
      };

      // Save user to persistent accounts registry & set active session in localStorage
      saveAccountToRegistry(newUser);
      localStorage.setItem('midepay_session', JSON.stringify({ email: newUser.email, loggedIn: true }));
      localStorage.setItem('midepay_active_view', 'dashboard');

      state.user = newUser;
      state.dashBalance = 250000.00;
      state.transactions = [];

      // CRITICAL: Always immediately sync newly registered account to dashboard UI
      syncUserToDashboard();
      renderBalances();
      renderDashboardTransactions();

      if (supaUserId) {
        // Query live Supabase database for any existing wallet or data without blocking UI
        loadDashboardData().catch(console.warn);
      }

      showView('dashboard');
      showToast(`Welcome to MidePay, ${fullName}! Your account is active and ready.`);
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
  // LOGIN FORM & VALIDATION
  // -------------------------------------------------------------
  loginForm = document.getElementById('login-form');
  loginErrorAlert = document.getElementById('login-error-alert');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (loginErrorAlert) loginErrorAlert.classList.add('hidden');

      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      if (!email || !password) {
        showLoginError('Please enter both email and password.');
        return;
      }

      let matchedUser = null;

      // 1. Check live Supabase authentication first if configured
      if (window.MidePayDB && window.MidePayDB.isConfigured()) {
        try {
          const { user: supaUser, error: supaErr } = await window.MidePayDB.signIn({ email, password });
          if (supaErr) {
            console.warn('[MidePay] Supabase signIn error:', supaErr.message);
            showLoginError(supaErr.message || 'Invalid email or password.');
            return; // Stop! Never fall back to fake cached IDs on auth failure
          }
          if (supaUser && supaUser.id) {
            const realUserId = supaUser.id; // Real UUID from Supabase auth
            await window.MidePayDB.ensureProfileAndWallet(supaUser);
            const profile = await window.MidePayDB.getProfile(realUserId);
            const userName = profile?.full_name || supaUser.user_metadata?.full_name || email.split('@')[0];
            const userNuban = profile?.nuban || generateUserNuban(supaUser.email || realUserId);
            matchedUser = {
              id: realUserId, // ALWAYS real Supabase UUID
              fullName: userName,
              email: supaUser.email,
              phone: profile?.phone || supaUser.user_metadata?.phone || '',
              tag: profile?.tag || `@${userName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
              nuban: userNuban,
              bank: 'Providus Bank',
              password: password,
              role: profile?.role || 'user'
            };
            saveAccountToRegistry(matchedUser);
            localStorage.setItem('midepay_session', JSON.stringify({ email: matchedUser.email, loggedIn: true }));
            localStorage.setItem('midepay_active_view', 'dashboard');
            state.user = matchedUser;
            syncUserToDashboard();
            await updateExecutiveNavButtons();
            await loadDashboardData();
            showView('dashboard');
            showToast(`Welcome back, ${matchedUser.fullName}!`);
            return;
          }
        } catch (supaEx) {
          console.error('[MidePay] Supabase signIn error:', supaEx);
          showLoginError(supaEx.message || 'Unable to connect to authentication server.');
          return;
        }
      }

      // 2. Offline simulation fallback only if Supabase is NOT configured
      if (!matchedUser && (!window.MidePayDB || !window.MidePayDB.isConfigured())) {
        matchedUser = findAccount(email, password);
        if (matchedUser) {
          if (!isValidUuid(matchedUser.id)) {
            matchedUser.id = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000');
          }
          state.user = matchedUser;
          if (!matchedUser.nuban) matchedUser.nuban = generateUserNuban(matchedUser.email);
          if (matchedUser.balance !== undefined && matchedUser.balance !== null) {
            state.dashBalance = Number(matchedUser.balance);
          }
          saveAccountToRegistry(matchedUser);
          localStorage.setItem('midepay_session', JSON.stringify({ email: matchedUser.email, loggedIn: true }));
          localStorage.setItem('midepay_active_view', 'dashboard');
          syncUserToDashboard();
          renderBalances();
          renderDashboardTransactions();
          showView('dashboard');
          showToast(`Welcome back, ${matchedUser.fullName}!`);
          return;
        }
      }

      showLoginError('Invalid email or password. Please verify your credentials or register a new account.');
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

  async function handleLogout() {
    try {
      localStorage.removeItem('midepay_session');
      localStorage.removeItem('midepay_active_view');
      localStorage.removeItem('midepay_user');
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-') || key.includes('supabase') || key.startsWith('midepay_session') || key === 'midepay_user' || key === 'midepay_active_view') {
          localStorage.removeItem(key);
        }
      });
    } catch (e) {}

    state.user = null;
    state.dashBalance = 0.00;
    state.transactions = [];
    _isExecutiveVerified = false;
    _executiveCheckInFlight = null;

    if (window.MidePayDB && typeof window.MidePayDB.signOut === 'function') {
      try {
        window.MidePayDB.signOut().catch(console.warn);
      } catch (e) {}
    }

    try { syncUserToDashboard(); } catch (e) {}
    try { renderBalances(); } catch (e) {}
    try { renderDashboardTransactions(); } catch (e) {}
    try { updateExecutiveNavButtons().catch(() => {}); } catch (e) {}
    try { showView('landing'); } catch (e) {}
    try { showToast('Logged out of MidePay successfully.'); } catch (e) {}
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
    if (sendRecipientInput && !sendRecipientInput.value) {
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
    btnToggleAccountFreeze.addEventListener('click', () => {
      state.isAccountFrozen = !state.isAccountFrozen;
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
      const topupInput = document.getElementById('topup-amount');
      if (topupInput) topupInput.value = tagBtn.getAttribute('data-topup');
    });
  });

  // -------------------------------------------------------------
  // QUICK TEST FUND / DEMO TOP-UP CONTROLLER (SUPABASE + LOCAL)
  // -------------------------------------------------------------
  async function topUpDemoBalance(amount = 50000) {
    ensureUserSession();
    const fundAmt = Number(amount) || 50000;
    state.dashBalance += fundAmt;
    if (state.user) {
      state.user.balance = state.dashBalance;
      saveAccountToRegistry(state.user);
    }

    // Update balances on all visible elements
    renderBalances();
    const sendModalBalance = document.getElementById('transfer-modal-balance');
    if (sendModalBalance) sendModalBalance.textContent = formatNaira(state.dashBalance);
    const amountStepBalance = document.getElementById('amount-step-balance');
    if (amountStepBalance) amountStepBalance.textContent = formatNaira(state.dashBalance);

    // Re-check amount validity if currently on amount screen
    if (typeof validateAmountInputs === 'function') {
      validateAmountInputs();
    }

    // Add transaction to local history
    const txRef = 'DEP-' + Date.now().toString().slice(-8);
    const newTx = {
      id: 'tx-' + Date.now(),
      ref: txRef,
      title: 'Wallet Funding Deposit',
      category: 'Deposit',
      sender: 'Providus Bank Transfer',
      beneficiary: state.user?.fullName || 'Account Holder',
      narration: 'Instant Wallet Top-Up',
      date: 'Just now',
      type: 'inflow',
      amount: fundAmt,
      fee: 0.00,
      status: 'Successful'
    };
    state.transactions.unshift(newTx);
    saveUserTransactions();
    renderDashboardTransactions();

    // Persist directly to Supabase
    if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user?.id) {
      try {
        const res = await window.MidePayDB.recordDeposit({
          walletId: state.user.walletId,
          userId: state.user.id,
          amount: fundAmt
        });
        if (res && res.wallet) {
          state.user.walletId = res.wallet.id;
          if (res.wallet.balance !== undefined && res.wallet.balance !== null) {
            const remoteBal = Number(res.wallet.balance);
            if (remoteBal >= state.dashBalance) {
              state.dashBalance = remoteBal;
              if (state.user) {
                state.user.balance = state.dashBalance;
                saveAccountToRegistry(state.user);
              }
              renderBalances();
              if (sendModalBalance) sendModalBalance.textContent = formatNaira(state.dashBalance);
              if (amountStepBalance) amountStepBalance.textContent = formatNaira(state.dashBalance);
              if (typeof validateAmountInputs === 'function') {
                validateAmountInputs();
              }
            }
          }
        }
      } catch (err) {
        console.warn('Supabase top-up sync error:', err);
      }
    }

    showToast(`🎉 Credited ${formatNaira(fundAmt)} to your MidePay wallet!`);
  }

  // Quick Test Fund button on Screen 1 (Recipient)
  const btnQuickFundTransfer = document.getElementById('btn-quick-fund-transfer');
  if (btnQuickFundTransfer) {
    btnQuickFundTransfer.addEventListener('click', () => topUpDemoBalance(50000));
  }

  // Quick Test Fund button on Dashboard Card
  const btnDashQuickTopup = document.getElementById('btn-dash-quick-topup');
  if (btnDashQuickTopup) {
    btnDashQuickTopup.addEventListener('click', () => topUpDemoBalance(50000));
  }

  // Quick Test Fund button on Screen 2 (Amount)
  const btnAmountQuickFund = document.getElementById('btn-amount-quick-fund');
  if (btnAmountQuickFund) {
    btnAmountQuickFund.addEventListener('click', () => topUpDemoBalance(50000));
  }

  // Quick Test Fund button inside Insufficient Balance Alert
  const btnInsufficientFundNow = document.getElementById('btn-insufficient-fund-now');
  if (btnInsufficientFundNow) {
    btnInsufficientFundNow.addEventListener('click', () => topUpDemoBalance(50000));
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
      if (amountBalanceHint) amountBalanceHint.textContent = `Wallet Balance: ${formatNaira(state.dashBalance)}`;
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

  function getSelectedBankName() {
    if (sendDestination) {
      const opt = sendDestination.options[sendDestination.selectedIndex];
      return opt ? opt.text.split(' — ')[0].trim() : 'OPay Digital Services';
    }
    return 'OPay Digital Services';
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
  // REAL-TIME NUBAN ACCOUNT RESOLUTION (OPay / PalmPay Style)
  // -------------------------------------------------------------
  let resolveDebounceTimer = null;
  function triggerAccountResolution() {
    clearTimeout(resolveDebounceTimer);
    const rawVal = (sendRecipient?.value || '').trim();
    const cleanDigits = rawVal.replace(/[^0-9]/g, '');

    // 1. Check for 10-digit NUBAN
    if (cleanDigits.length === 10) {
      sendRecipient.value = cleanDigits;
      sendFlowState.accountNumber = cleanDigits;

      if (accountResolvedBox) {
        accountResolvedBox.classList.remove('hidden');
        if (accountResolvedText) {
          accountResolvedText.innerHTML = `
            <span class="recipient-search-spinner" style="position:static; width:13px; height:13px; display:inline-block; vertical-align:middle; margin-right:6px;"></span>
            <span>Verifying beneficiary on NIP switch...</span>
          `;
        }
      }

      resolveDebounceTimer = setTimeout(() => {
        const resolvedName = resolveNubanBeneficiary(cleanDigits);
        sendFlowState.isAccountResolved = true;
        sendFlowState.resolvedName = resolvedName;

        if (accountResolvedText) {
          accountResolvedText.innerHTML = `<strong>${resolvedName}</strong> <span style="color:#A7F3D0; font-size:0.75rem;">(Verified Beneficiary)</span>`;
        }
        if (recipientVerifyHint) {
          recipientVerifyHint.textContent = `✓ Account verified on Nigerian Inter-Bank Settlement System (NIBSS).`;
          recipientVerifyHint.classList.add('text-success');
        }
        if (sendFormError) sendFormError.classList.add('hidden');
      }, 250);
      return;
    }

    // 2. Check for @username Tag or Email lookup
    if (rawVal.startsWith('@') || rawVal.includes('@')) {
      sendFlowState.accountNumber = rawVal;
      if (accountResolvedBox) {
        accountResolvedBox.classList.remove('hidden');
        if (accountResolvedText) {
          accountResolvedText.innerHTML = `
            <span class="recipient-search-spinner" style="position:static; width:13px; height:13px; display:inline-block; vertical-align:middle; margin-right:6px;"></span>
            <span>Looking up MideTag...</span>
          `;
        }
      }

      resolveDebounceTimer = setTimeout(async () => {
        let found = null;
        if (window.MidePayDB && typeof window.MidePayDB.findRecipient === 'function') {
          found = await window.MidePayDB.findRecipient(rawVal, state.user?.id);
        }
        if (found) {
          sendFlowState.isAccountResolved = true;
          sendFlowState.resolvedName = found.fullName || found.full_name || 'MidePay Member';
          if (accountResolvedText) {
            accountResolvedText.innerHTML = `<strong>${sendFlowState.resolvedName}</strong> <span style="color:#A7F3D0; font-size:0.75rem;">(${found.tag || '@midepay'})</span>`;
          }
        } else {
          const cleanTag = rawVal.replace(/^@/, '').toUpperCase();
          sendFlowState.isAccountResolved = true;
          sendFlowState.resolvedName = `${cleanTag} (MidePay Verified)`;
          if (accountResolvedText) {
            accountResolvedText.innerHTML = `<strong>${sendFlowState.resolvedName}</strong>`;
          }
        }
        if (sendFormError) sendFormError.classList.add('hidden');
      }, 300);
      return;
    }

    // Incomplete
    sendFlowState.isAccountResolved = false;
    sendFlowState.resolvedName = '';
    sendFlowState.accountNumber = rawVal;
    if (accountResolvedBox) accountResolvedBox.classList.add('hidden');
    if (recipientVerifyHint) {
      recipientVerifyHint.textContent = 'Enter 10-digit NUBAN to verify account name automatically.';
      recipientVerifyHint.classList.remove('text-success');
    }
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
        const resolvedName = cleanDigits.length === 10 
          ? resolveNubanBeneficiary(cleanDigits) 
          : `${rawRecipient.replace(/^@/, '').toUpperCase()} (MidePay Verified)`;
        sendFlowState.isAccountResolved = true;
        sendFlowState.resolvedName = resolvedName;
        sendFlowState.accountNumber = cleanDigits || rawRecipient;
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

      // 3. Check Wallet Balance & Auto-Credit if Needed
      const totalNeeded = amt + sendFlowState.transferFee;
      if (totalNeeded > state.dashBalance) {
        const fundCredit = Math.max(50000, Math.ceil(totalNeeded * 1.5));
        await topUpDemoBalance(fundCredit);
        showToast(`🎉 Added ${formatNaira(fundCredit)} top-up credit to your wallet!`);
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
      // PER-USER PIN VERIFICATION (Not global or shared)
      // Strictly checks or sets PIN for THIS logged-in user (state.user.id)
      // -------------------------------------------------------------
      const currentUserId = state.user?.id;
      let storedPinHash = state.user?.pinHash;

      // Always query Supabase profiles table for the latest hash if connected
      if (window.MidePayDB && window.MidePayDB.isConfigured() && currentUserId) {
        try {
          const dbHash = await window.MidePayDB.getUserPinHash(currentUserId, true);
          if (dbHash) {
            storedPinHash = dbHash;
            if (state.user) {
              state.user.pinHash = dbHash;
              saveAccountToRegistry(state.user);
            }
          }
        } catch (err) {
          console.warn('[MidePay] Error querying profile pin_hash:', err);
        }
      }

      // FIRST-TIME TRANSFER: User sets their own PIN -> hash and store in DB per-user
      if (!storedPinHash) {
        const hashedPin = await hashPin(enteredPin);
        if (state.user) {
          state.user.pinHash = hashedPin;
          saveAccountToRegistry(state.user);
        }

        if (window.MidePayDB && currentUserId) {
          await window.MidePayDB.setUserPin(currentUserId, hashedPin);
        }

        showToast('🔐 4-digit transaction PIN created & encrypted for your account!', 'success');
      } else {
        // RETURNING TRANSFERS: Strictly verify entered PIN against THIS user's bcrypt hash
        const isPinValid = await verifyPin(enteredPin, storedPinHash);

        if (!isPinValid) {
          if (pinAuthError && pinAuthErrorText) {
            pinAuthErrorText.textContent = 'Incorrect PIN for your account. Please try again.';
            pinAuthError.classList.remove('hidden');
          }
          clearPinBoxes();
          authPinBoxes[0]?.focus();
          return;
        }
      }

      // Valid PIN -> Execute Transfer!
      if (pinAuthError) pinAuthError.classList.add('hidden');
      btnAuthorizePay.disabled = true;
      if (btnAuthorizePayText) {
        btnAuthorizePayText.innerHTML = `
          <div class="recipient-search-spinner" style="position:static; width:16px; height:16px; margin-right:8px; display:inline-block; vertical-align:middle;"></div>
          <span>Processing Instant Transfer...</span>
        `;
      }

      try {
        const totalDebit = sendFlowState.amount + sendFlowState.transferFee;

        // Deduct sender balance locally
        state.dashBalance = Math.max(0, state.dashBalance - totalDebit);

        // Generate Nigerian fintech reference
        const refDigits = Math.floor(100000000 + Math.random() * 900000000);
        const txRef = `MDP-${refDigits}`;
        const now = new Date();
        const txTimestamp = now.toLocaleString('en-NG', {
          dateStyle: 'medium',
          timeStyle: 'short'
        });

        // Record transaction
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
        if (state.user) {
          state.user.balance = state.dashBalance;
          saveAccountToRegistry(state.user);
        }
        saveUserTransactions();
        sendFlowState.lastTransaction = newTx;

        // Persist to Supabase if configured
        if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user?.id) {
          if (sendFlowState.recipientId && isValidUuid(sendFlowState.recipientId)) {
            window.MidePayDB.transferFunds({
              senderId: state.user.id,
              recipientId: sendFlowState.recipientId,
              amount: sendFlowState.amount,
              narration: sendFlowState.narration
            }).catch(console.warn);
          } else {
            window.MidePayDB.recordTransfer({
              walletId: state.user.walletId,
              userId: state.user.id,
              amount: totalDebit,
              fee: sendFlowState.transferFee,
              recipient: `${sendFlowState.resolvedName} (${sendFlowState.accountNumber})`,
              destinationBank: sendFlowState.selectedBank,
              narration: sendFlowState.narration,
              reference: txRef
            }).catch(console.warn);
          }
        }

        // If this transfer fulfills an approved payment request:
        if (sendFlowState.approvedRequestId && window.MidePayDB) {
          window.MidePayDB.updatePaymentRequestStatus(sendFlowState.approvedRequestId, 'approved', state.user?.id).catch(console.warn);
          sendFlowState.approvedRequestId = null;
          if (typeof refreshNotificationsAndRequests === 'function') {
            refreshNotificationsAndRequests().catch(console.warn);
          }
        }

        renderBalances();
        renderDashboardTransactions();

        // Populate Screen 3: Success Screen
        if (successTransferAmount) successTransferAmount.textContent = formatNaira(sendFlowState.amount);
        if (successRecipientName) successRecipientName.textContent = sendFlowState.resolvedName;
        if (successRecipientDetail) {
          successRecipientDetail.textContent = `${sendFlowState.selectedBank} • ${sendFlowState.accountNumber}`;
        }
        if (successTxRef) successTxRef.textContent = txRef;
        if (successTxFee) successTxFee.textContent = formatNaira(sendFlowState.transferFee);
        if (successTxDate) successTxDate.textContent = txTimestamp;

        // Switch to CodeFronts Processing Animation Stage
        showSendStep('processing');

        // Allow animation to narrate Payment -> NIP Switch -> Receipt
        setTimeout(() => {
          if (paymentLoader) {
            paymentLoader.classList.add('is-ready');
            paymentLoader.dataset.state = 'ready';
          }

          // Transition to full receipt success screen
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
      } finally {
        btnAuthorizePay.disabled = false;
        if (btnAuthorizePayText) {
          const hasPin = !!(state.user?.pinHash);
          btnAuthorizePayText.textContent = hasPin
            ? `Pay ${formatNaira(sendFlowState.amount)}`
            : `Set PIN & Pay ${formatNaira(sendFlowState.amount)}`;
        }
      }
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
            if (requestResolvedName) requestResolvedName.textContent = recipient.fullName;
            if (requestResolvedDetail) {
              const tagText = recipient.tag || `@${recipient.fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
              const phoneText = recipient.phone || recipient.email || '';
              requestResolvedDetail.textContent = `${tagText} • ${phoneText}`;
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
                    <div class="req-user-avatar">${initials}</div>
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

  // Add Money Form Simulation & Database Record
  const addFundsForm = document.getElementById('add-funds-form');
  if (addFundsForm) {
    addFundsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = parseFloat(document.getElementById('topup-amount').value);

      if (!amount || amount < 500) {
        showToast('Minimum deposit amount is ₦500.00', 'error');
        return;
      }

      // Add to balance
      state.dashBalance += amount;

      // Add to transaction list with rich receipt metadata
      const txRef = 'MP-DP-' + Date.now().toString().slice(-8);
      const newTx = {
        id: 'tx-' + Date.now(),
        ref: txRef,
        title: 'Wallet Funding Deposit',
        category: 'Card & Bank Funding',
        sender: 'Providus Bank Checkout',
        beneficiary: state.user?.fullName || 'Account Holder',
        narration: 'Instant Wallet Inflow via Providus Virtual NUBAN',
        date: 'Just now',
        type: 'inflow',
        amount: amount,
        status: 'Successful'
      };

      state.transactions.unshift(newTx);

      // Persist to Supabase if live
      if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user?.id) {
        window.MidePayDB.recordDeposit({
          walletId: state.user.walletId,
          userId: state.user.id,
          amount
        }).then((res) => {
          if (res?.wallet) {
            state.user.walletId = res.wallet.id;
            if (res.wallet.balance !== undefined && res.wallet.balance !== null) {
              state.dashBalance = Number(res.wallet.balance);
              renderBalances();
            }
          }
          loadDashboardData();
        }).catch(console.error);
      }

      renderBalances();
      renderDashboardTransactions();
      modalAdd.classList.add('hidden');
      addFundsForm.reset();
      showToast(`Deposited ${formatNaira(amount)} into your MidePay wallet!`);

      // Open official transaction receipt immediately
      openReceiptModal(newTx);
    });
  }

  // Quick Action simulations (Airtime, Bills, Virtual Card)
  function promptSim(featureName, details) {
    showToast(`Simulated: ${featureName} — ${details}`);
  }

  // -------------------------------------------------------------
  // AIRTIME & DATA INTERACTIVE CONTROLLER
  // -------------------------------------------------------------
  let airtimeServiceMode = 'airtime'; // 'airtime' | 'data'
  let airtimeNetwork = 'MTN';

  const tabAirtime = document.getElementById('tab-recharge-airtime');
  const tabData = document.getElementById('tab-recharge-data');
  const airtimeAmountSec = document.getElementById('airtime-amount-section');
  const dataPlanSec = document.getElementById('data-plan-section');
  const airtimeAmountInput = document.getElementById('airtime-amount');
  const dataPlanSelect = document.getElementById('data-plan-select');
  const airtimePhoneInput = document.getElementById('airtime-phone');
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
      calculateAirtimeCashback();
    });

    tabData.addEventListener('click', () => {
      airtimeServiceMode = 'data';
      tabData.classList.add('active');
      tabAirtime.classList.remove('active');
      airtimeAmountSec?.classList.add('hidden');
      dataPlanSec?.classList.remove('hidden');
      calculateAirtimeCashback();
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
      const userPhone = state.user?.phone || '8031234567';
      if (airtimePhoneInput) {
        airtimePhoneInput.value = userPhone;
      }
      showToast(`Auto-filled with ${userPhone}`);
    });
  }

  // Open modal from Dashboard Quick Action
  function openAirtimeModal() {
    ensureUserSession();
    if (airtimePhoneInput && !airtimePhoneInput.value) {
      airtimePhoneInput.value = state.user?.phone || '08031234567';
    }
    calculateAirtimeCashback();
    modalAirtime?.classList.remove('hidden');
  }
  window.openAirtimeModal = openAirtimeModal;

  if (qaAirtime) {
    qaAirtime.addEventListener('click', openAirtimeModal);
  }

  // Process Airtime & Data Purchase Form
  if (airtimeDataForm) {
    airtimeDataForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const phone = airtimePhoneInput?.value.trim() || '';
      if (!phone || phone.length < 7) {
        showToast('Please enter a valid Nigerian mobile phone number.', 'error');
        return;
      }

      const { amount, cashback } = calculateAirtimeCashback();

      if (!amount || amount < 50) {
        showToast('Minimum purchase amount is ₦50.00', 'error');
        return;
      }

      if (amount > state.dashBalance) {
        const fundCredit = Math.max(50000, Math.ceil(amount * 2));
        await topUpDemoBalance(fundCredit);
        showToast(`🎉 Added ${formatNaira(fundCredit)} top-up credit to your wallet!`);
      }

      let description = '';
      if (airtimeServiceMode === 'airtime') {
        description = `${airtimeNetwork} Airtime Recharge - ${phone}`;
      } else {
        const selectedOption = dataPlanSelect?.options[dataPlanSelect.selectedIndex];
        const planLabel = selectedOption?.getAttribute('data-label') || 'Data Bundle';
        description = `${airtimeNetwork} ${planLabel} - ${phone}`;
      }

      // 1. Deduct principal amount
      state.dashBalance -= amount;

      // Outflow transaction with rich receipt metadata
      const txRef = 'MP-VT-' + Date.now().toString().slice(-8);
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
        status: 'Successful'
      };
      state.transactions.unshift(newTx);

      // 2. Credit 3% Cashback instantly
      state.dashBalance += cashback;

      // Inflow cashback transaction
      state.transactions.unshift({
        id: 'tx-' + (Date.now() + 1),
        ref: 'MP-CB-' + Date.now().toString().slice(-8),
        title: `3% Airtime Cashback (${airtimeNetwork})`,
        category: 'Cashback Reward',
        sender: 'MidePay Loyalty Rewards',
        beneficiary: state.user?.fullName || 'Account Holder',
        narration: `3% instant cashback for ${description}`,
        date: 'Just now',
        type: 'inflow',
        amount: cashback,
        status: 'Successful'
      });

      if (state.user) {
        state.user.balance = state.dashBalance;
        saveAccountToRegistry(state.user);
      }
      saveUserTransactions();

      // Persist to Supabase if live backend is connected
      if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user?.id) {
        window.MidePayDB.recordTransfer({
          walletId: state.user.walletId,
          userId: state.user.id,
          amount: amount,
          recipient: `${airtimeNetwork} (${phone})`,
          destinationBank: 'Telco VTU',
          narration: description
        }).catch(console.error);

        window.MidePayDB.recordDeposit({
          walletId: state.user.walletId,
          userId: state.user.id,
          amount: cashback
        }).catch(console.error);
      }

      // Update UI displays
      renderBalances();
      renderDashboardTransactions();

      // Close modal
      modalAirtime?.classList.add('hidden');

      showToast(`🎉 Success! ${formatNaira(amount)} ${airtimeNetwork} recharge sent to ${phone}. Earned ${formatNaira(cashback)} cashback!`);

      // Open official transaction receipt
      openReceiptModal(newTx);
    });
  }

  // -------------------------------------------------------------
  // MODAL 4: ELECTRICITY & CABLE TV BILLS CONTROLLER
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
      updateBillButtonText();
    });

    tabCable.addEventListener('click', () => {
      billServiceMode = 'cable';
      tabCable.classList.add('active');
      tabElectricity.classList.remove('active');
      sectionCable?.classList.remove('hidden');
      sectionElectricity?.classList.add('hidden');
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

      // Automatically select first package matching the brand
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

  // Verify Meter Simulation
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

  // Verify Cable Smartcard Simulation
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
    if (defaultTab === 'cable') {
      tabCable?.click();
    } else {
      tabElectricity?.click();
    }
    updateBillButtonText();
    modalBills?.classList.remove('hidden');
  }
  window.openBillsModal = openBillsModal;

  // Handle Bill Form Submission
  if (billPaymentForm) {
    billPaymentForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      let amount = 0;
      let txTitle = '';
      let txCategory = '';
      let txBeneficiary = '';
      let txNarration = '';
      let generatedToken = null;
      let calculatedUnits = null;

      if (billServiceMode === 'electricity') {
        const disco = discoSelect?.value || 'IKEDC - Ikeja Electric';
        const meterNum = meterNumberInput?.value.trim();
        amount = parseFloat(electricityAmountInput?.value) || 0;

        if (!meterNum || meterNum.length < 8) {
          showToast('Please enter a valid meter number.', 'error');
          return;
        }

        if (amount < 500) {
          showToast('Minimum electricity recharge is ₦500.00', 'error');
          return;
        }

        if (amount > state.dashBalance) {
          const fundCredit = Math.max(50000, Math.ceil(amount * 1.5));
          await topUpDemoBalance(fundCredit);
          showToast(`🎉 Added ${formatNaira(fundCredit)} top-up credit to your wallet!`);
        }

        const discoShort = disco.split('-')[0].trim();
        txTitle = `${discoShort} Electricity (${meterType})`;
        txCategory = 'Electricity Utility';
        txBeneficiary = `${disco} • Meter ${meterNum}`;
        txNarration = `${disco} ${meterType} Recharge - Meter ${meterNum}`;

        if (meterType === 'Prepaid') {
          // Generate 20-digit token: 5 blocks of 4 digits
          const g1 = Math.floor(1000 + Math.random() * 9000);
          const g2 = Math.floor(1000 + Math.random() * 9000);
          const g3 = Math.floor(1000 + Math.random() * 9000);
          const g4 = Math.floor(1000 + Math.random() * 9000);
          const g5 = Math.floor(1000 + Math.random() * 9000);
          generatedToken = `${g1} ${g2} ${g3} ${g4} ${g5}`;
          calculatedUnits = (amount / 72.5).toFixed(1) + ' kWh';
        }
      } else {
        const cableProvider = cableProviderSelect?.value || 'DSTV';
        const smartcard = cableSmartcardInput?.value.trim();
        const selectedPkg = cablePackageSelect?.options[cablePackageSelect.selectedIndex];
        amount = parseFloat(cablePackageSelect?.value) || 0;
        const pkgName = selectedPkg?.getAttribute('data-pkg') || 'Bouquet';

        if (!smartcard || smartcard.length < 8) {
          showToast('Please enter a valid Smartcard/IUC number.', 'error');
          return;
        }

        if (amount > state.dashBalance) {
          const fundCredit = Math.max(50000, Math.ceil(amount * 1.5));
          await topUpDemoBalance(fundCredit);
          showToast(`🎉 Added ${formatNaira(fundCredit)} top-up credit to your wallet!`);
        }

        txTitle = `${cableProvider} ${pkgName} Renewal`;
        txCategory = 'Cable TV Subscription';
        txBeneficiary = `${cableProvider} Nigeria • IUC ${smartcard}`;
        txNarration = `${cableProvider} ${pkgName} 1-Month Renewal (IUC: ${smartcard})`;
      }

      // Deduct balance
      state.dashBalance -= amount;

      // Create transaction record
      const txRef = 'MP-BL-' + Date.now().toString().slice(-8);
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
        status: 'Successful',
        token: generatedToken,
        units: calculatedUnits
      };

      state.transactions.unshift(newTx);
      if (state.user) {
        state.user.balance = state.dashBalance;
        saveAccountToRegistry(state.user);
      }
      saveUserTransactions();

      // Persist to Supabase if live backend is connected
      if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user?.id) {
        window.MidePayDB.recordTransfer({
          walletId: state.user.walletId,
          userId: state.user.id,
          amount: amount,
          recipient: txBeneficiary,
          destinationBank: txCategory,
          narration: txNarration
        }).catch(console.error);
      }

      // Update UI displays
      renderBalances();
      renderDashboardTransactions();

      // Close bill modal
      modalBills?.classList.add('hidden');

      // Immediate notification
      if (generatedToken) {
        showToast(`⚡ Payment successful! Token: ${generatedToken}`);
      } else {
        showToast(`🎉 Payment successful! ${txTitle} processed.`);
      }

      // Open official standard receipt modal
      openReceiptModal(newTx);
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
MIDEPAY OFFICIAL TRANSACTION RECEIPT
========================================
Status: ${tx.status || 'Successful'}
Transaction Ref: ${tx.ref || 'MP-TX-STANDARD'}
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
  // VIRTUAL CARDS INTERACTIVE CONTROLLER (USD & NGN)
  // -------------------------------------------------------------
  const virtualCardState = {
    activeType: 'usd', // 'usd' | 'ngn'
    usd: {
      title: 'MidePay Black',
      network: 'Mastercard',
      fullPan: '5399 4120 8920 4091',
      maskedPan: '5399 •••• •••• 4091',
      expiry: '08/29',
      cvv: '834',
      balance: '$250.00',
      limit: '$1,000 / month',
      spentText: '$250.00 spent of $1,000.00 limit',
      progress: '25%',
      isFrozen: false,
      isPanRevealed: false,
      isCvvRevealed: false
    },
    ngn: {
      title: 'MidePay Green',
      network: 'Visa',
      fullPan: '5061 9840 2319 7820',
      maskedPan: '5061 •••• •••• 7820',
      expiry: '11/28',
      cvv: '492',
      balance: '₦150,000.00',
      limit: '₦500,000 / month',
      spentText: '₦150,000.00 spent of ₦500,000.00 limit',
      progress: '30%',
      isFrozen: false,
      isPanRevealed: false,
      isCvvRevealed: false
    }
  };

  const tabCardUsd = document.getElementById('tab-card-usd');
  const tabCardNgn = document.getElementById('tab-card-ngn');
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
  const cardSpentSubtext = document.getElementById('card-spent-subtext');
  const cardProgressFill = document.querySelector('.limit-progress-fill');

  function renderVirtualCard() {
    const card = virtualCardState[virtualCardState.activeType];
    const isUsd = virtualCardState.activeType === 'usd';

    if (activeCardEl) {
      if (isUsd) {
        activeCardEl.classList.remove('ngn-card');
      } else {
        activeCardEl.classList.add('ngn-card');
      }
      activeCardEl.classList.toggle('frozen', card.isFrozen);
    }

    if (cardBrandTitle) cardBrandTitle.textContent = card.title;

    if (cardNetworkLogo) {
      if (isUsd) {
        cardNetworkLogo.innerHTML = `
          <svg width="42" height="26" viewBox="0 0 40 25" fill="none">
            <circle cx="15" cy="12.5" r="10" fill="#EB001B" />
            <circle cx="25" cy="12.5" r="10" fill="#F79E1B" fill-opacity="0.85" />
          </svg>
        `;
      } else {
        cardNetworkLogo.innerHTML = `
          <svg width="46" height="20" viewBox="0 0 48 18" fill="none">
            <text x="2" y="16" font-family="'Inter', sans-serif" font-weight="900" font-size="18" fill="#FFF" letter-spacing="1">VISA</text>
          </svg>
        `;
      }
    }

    const currentUserName = (state.user?.fullName || 'ACCOUNT HOLDER').toUpperCase();
    if (cardHolderName) cardHolderName.textContent = currentUserName;
    if (cardExpiryVal) cardExpiryVal.textContent = card.expiry;

    // PAN reveal / mask
    if (cardPanDisplay) {
      cardPanDisplay.textContent = card.isPanRevealed ? card.fullPan : card.maskedPan;
    }
    if (btnTogglePan) {
      btnTogglePan.textContent = card.isPanRevealed ? '🙈' : '👁';
    }

    // CVV reveal / mask
    if (cardCvvVal) {
      cardCvvVal.textContent = card.isCvvRevealed ? card.cvv : '•••';
    }
    if (btnToggleCvv) {
      btnToggleCvv.textContent = card.isCvvRevealed ? '🙈' : '👁';
    }

    // Freeze state & badges
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

    // Metrics
    if (cardBalanceDisplay) cardBalanceDisplay.textContent = card.balance;
    if (cardLimitVal) cardLimitVal.textContent = card.limit;
    if (cardSpentSubtext) cardSpentSubtext.textContent = card.spentText;
    if (cardProgressFill) cardProgressFill.style.width = card.progress;
  }

  function openCardsModal() {
    ensureUserSession();
    renderVirtualCard();
    modalCards?.classList.remove('hidden');
  }
  window.openCardsModal = openCardsModal;

  if (tabCardUsd && tabCardNgn) {
    tabCardUsd.addEventListener('click', () => {
      virtualCardState.activeType = 'usd';
      tabCardUsd.classList.add('active');
      tabCardNgn.classList.remove('active');
      renderVirtualCard();
    });

    tabCardNgn.addEventListener('click', () => {
      virtualCardState.activeType = 'ngn';
      tabCardNgn.classList.add('active');
      tabCardUsd.classList.remove('active');
      renderVirtualCard();
    });
  }

  if (btnTogglePan) {
    btnTogglePan.addEventListener('click', () => {
      const card = virtualCardState[virtualCardState.activeType];
      card.isPanRevealed = !card.isPanRevealed;
      renderVirtualCard();
    });
  }

  if (btnToggleCvv) {
    btnToggleCvv.addEventListener('click', () => {
      const card = virtualCardState[virtualCardState.activeType];
      card.isCvvRevealed = !card.isCvvRevealed;
      renderVirtualCard();
    });
  }

  if (btnFreezeCard) {
    btnFreezeCard.addEventListener('click', () => {
      const card = virtualCardState[virtualCardState.activeType];
      card.isFrozen = !card.isFrozen;
      renderVirtualCard();
      if (card.isFrozen) {
        showToast(`🔒 ${card.title} frozen. All online authorizations temporarily locked.`);
      } else {
        showToast(`✅ ${card.title} unfrozen. Ready for payments!`);
      }
    });
  }

  if (btnCopyCard) {
    btnCopyCard.addEventListener('click', () => {
      const card = virtualCardState[virtualCardState.activeType];
      const holder = (state.user?.fullName || 'ACCOUNT HOLDER').toUpperCase();
      const cardDetails = `Card: ${card.title}\nNumber: ${card.fullPan}\nExpires: ${card.expiry}\nCVV: ${card.cvv}\nCardholder: ${holder}`;
      navigator.clipboard.writeText(cardDetails).then(() => {
        showToast(`📋 Copied ${card.title} details to clipboard!`);
      }).catch(() => {
        showToast(`Card: ${card.fullPan} | Exp: ${card.expiry} | CVV: ${card.cvv}`);
      });
    });
  }

  if (btnFundCardModal) {
    btnFundCardModal.addEventListener('click', async () => {
      ensureUserSession();
      const card = virtualCardState[virtualCardState.activeType];
      if (virtualCardState.activeType === 'usd') {
        const currentUsd = parseFloat((card.balance || '$250.00').replace(/[^0-9.]/g, '')) || 250;
        const newUsd = currentUsd + 50;
        card.balance = `$${newUsd.toFixed(2)}`;

        const ngnCost = 77500; // $50 @ ₦1,550/$1
        if (ngnCost > state.dashBalance) {
          await topUpDemoBalance(Math.max(100000, ngnCost));
        }
        state.dashBalance = Math.max(0, state.dashBalance - ngnCost);

        const txRef = 'MP-CD-' + Date.now().toString().slice(-8);
        const newTx = {
          id: 'tx-' + Date.now(),
          ref: txRef,
          title: 'Virtual USD Card Top-Up (+$50.00)',
          category: 'Card Funding',
          sender: state.user?.fullName || 'Account Holder',
          beneficiary: `${card.title} (••4091)`,
          narration: `Funded Virtual USD Card with $50.00 (@ ₦1,550/$1)`,
          date: 'Just now',
          type: 'outflow',
          amount: ngnCost,
          status: 'Successful'
        };
        state.transactions.unshift(newTx);
        if (state.user) {
          state.user.balance = state.dashBalance;
          saveAccountToRegistry(state.user);
        }
        saveUserTransactions();
        renderBalances();
        renderDashboardTransactions();
        showToast(`🎉 Successfully funded USD Card with $50.00 (₦${formatNaira(ngnCost)} debited from wallet)`);
      } else {
        const fundNgn = 25000;
        if (fundNgn > state.dashBalance) {
          await topUpDemoBalance(Math.max(50000, fundNgn * 2));
        }
        state.dashBalance = Math.max(0, state.dashBalance - fundNgn);

        const currentNgn = parseFloat((card.balance || '₦150,000.00').replace(/[^0-9.]/g, '')) || 150000;
        const newNgn = currentNgn + fundNgn;
        card.balance = formatNaira(newNgn);

        const txRef = 'MP-CD-' + Date.now().toString().slice(-8);
        const newTx = {
          id: 'tx-' + Date.now(),
          ref: txRef,
          title: `Virtual Naira Card Top-Up (+${formatNaira(fundNgn)})`,
          category: 'Card Funding',
          sender: state.user?.fullName || 'Account Holder',
          beneficiary: `${card.title} (••7820)`,
          narration: `Funded Virtual Naira Card with ${formatNaira(fundNgn)}`,
          date: 'Just now',
          type: 'outflow',
          amount: fundNgn,
          status: 'Successful'
        };
        state.transactions.unshift(newTx);
        if (state.user) {
          state.user.balance = state.dashBalance;
          saveAccountToRegistry(state.user);
        }
        saveUserTransactions();
        renderBalances();
        renderDashboardTransactions();
        showToast(`🎉 ${formatNaira(fundNgn)} transferred to your Virtual Naira Card!`);
      }
      renderVirtualCard();
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
    // 1. Gather all users from accounts registry
    adminUsersList = getAccountsRegistry();

    // Fetch live member profiles from Supabase if connected (permitted by RLS for executives)
    if (window.MidePayDB && window.MidePayDB.isConfigured() && window.MidePayDB.client) {
      try {
        const { data: supaProfiles } = await window.MidePayDB.client
          .from('profiles')
          .select('id, full_name, email, phone, tag, role, kyc_tier');
        if (supaProfiles && supaProfiles.length > 0) {
          supaProfiles.forEach(sp => {
            const match = adminUsersList.find(u => u.email && u.email.toLowerCase() === sp.email.toLowerCase());
            if (match) {
              match.role = sp.role || 'user';
              if (sp.full_name) match.fullName = sp.full_name;
              if (sp.phone) match.phone = sp.phone;
            } else {
              adminUsersList.push({
                id: sp.id,
                fullName: sp.full_name || 'Member',
                email: sp.email,
                phone: sp.phone || '',
                tag: sp.tag || `@${(sp.full_name || 'user').toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                role: sp.role || 'user',
                balance: 150000.00
              });
            }
          });
        }
      } catch (err) {
        console.warn('[MidePay] Profiles sync notice:', err);
      }
    }

    // 2. Gather transactions
    const userTxs = loadUserTransactions();
    adminTxList = [...state.transactions, ...userTxs, ...DEFAULT_DEMO_TRANSACTIONS];
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
      const localWaitlist = JSON.parse(localStorage.getItem('midepay_waitlist_leads') || '[]');
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

    if (adminWaitlistEntries.length === 0) {
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
    const elKyc2 = document.getElementById('admin-kyc2-count');

    const totalVolume = adminTxList.reduce((acc, t) => acc + (Number(t.amount) || 0), 48500000);
    if (elTpv) elTpv.textContent = formatNaira(totalVolume);
    if (elWallets) elWallets.textContent = `${adminUsersList.length + 1245} Users`;
    if (elKyc2) elKyc2.textContent = `${adminUsersList.length + 1238}`;
    if (elWaitlist) elWaitlist.textContent = `${adminWaitlistEntries.length + 480} Leads`;
    if (elMargin) elMargin.textContent = formatNaira(384150.00 + (adminTxList.length * 25));

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
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">No member accounts matched query "${filterQuery}".</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(user => {
      const isFrozen = !!user.isFrozen;
      const balance = user.balance !== undefined ? Number(user.balance) : 850000.00;
      const initials = (user.fullName || 'User').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const tag = user.tag || `@${(user.fullName || 'user').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const cleanNuban = formatNubanDisplay(user.nuban || '9021849102');

      return `
        <tr data-user-email="${user.email}">
          <td>
            <div class="member-cell">
              <div class="member-avatar-mini">${initials}</div>
              <div class="member-name-block">
                <span class="member-full-name">${user.fullName || 'Unnamed Member'}</span>
                <span class="member-tag-mini">${tag}</span>
              </div>
            </div>
          </td>
          <td>
            <div style="display:flex; flex-direction:column; font-size:0.82rem;">
              <span>${user.email || '—'}</span>
              <span style="color:var(--text-muted);">${user.phone ? '+234 ' + user.phone : 'No phone'}</span>
            </div>
          </td>
          <td>
            <div style="font-family:monospace; font-weight:700; color:var(--text-primary); font-size:0.92rem;">
              ${cleanNuban}
            </div>
            <span style="font-size:0.72rem; color:var(--text-muted);">${user.bank || 'Providus Bank'}</span>
          </td>
          <td>
            <div style="display:flex; flex-direction:column; gap:0.25rem;">
              <span class="badge-gold-sm" style="font-size:0.72rem;">Tier 2 (BVN/NIN)</span>
              ${user.role === 'executive' 
                ? '<span style="font-size:0.68rem; font-weight:700; color:#FBBF24; display:inline-flex; align-items:center; gap:0.2rem;">★ Executive</span>' 
                : '<span style="font-size:0.68rem; color:var(--text-muted);">Member</span>'}
            </div>
          </td>
          <td>
            <div style="font-weight:700; font-size:0.96rem; color:var(--text-primary);">
              ${formatNaira(balance)}
            </div>
          </td>
          <td>
            ${isFrozen 
              ? '<span style="color:#F87171; background:rgba(239,68,68,0.15); padding:0.2rem 0.5rem; border-radius:4px; font-weight:700; font-size:0.72rem;">🔒 FROZEN (AML)</span>' 
              : '<span style="color:#34D399; background:rgba(16,185,129,0.15); padding:0.2rem 0.5rem; border-radius:4px; font-weight:700; font-size:0.72rem;">✓ ACTIVE</span>'}
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <button type="button" class="btn-admin-action ${isFrozen ? 'btn-admin-unfreeze' : 'btn-admin-freeze'}" data-action="toggle-freeze" data-email="${user.email}">
                ${isFrozen ? 'Unfreeze' : 'Freeze'}
              </button>
              <button type="button" class="btn-admin-action btn-admin-credit" data-action="credit-funds" data-email="${user.email}">
                + Credit ₦50k
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
              ${tx.ref || 'MP-TX-20260924'}
            </div>
            <span style="font-size:0.7rem; color:var(--text-muted);">NIP Session: 999048...</span>
          </td>
          <td><span style="font-size:0.82rem; color:var(--text-muted);">${tx.date || 'Today'}</span></td>
          <td><strong>${tx.sender || 'Sender'}</strong></td>
          <td>
            <div>${tx.beneficiary || 'Beneficiary'}</div>
          </td>
          <td>
            <span style="font-weight:700; color:${isInflow ? '#34D399' : 'var(--text-primary)'};">
              ${isInflow ? '+' : '-'}${formatNaira(tx.amount)}
            </span>
          </td>
          <td><span style="font-size:0.78rem; text-transform:uppercase; color:var(--text-muted);">${tx.category || 'Transfer'}</span></td>
          <td>
            <span style="color:#34D399; font-weight:700; font-size:0.75rem;">✓ Successful</span>
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
        <td><strong>${item.email}</strong></td>
        <td><span style="font-size:0.82rem; color:var(--text-muted);">${formatTxDate(item.date)}</span></td>
        <td><span class="badge-emerald-sm" style="font-size:0.72rem;">Priority VIP</span></td>
        <td><span style="font-size:0.78rem; color:var(--text-muted);">${item.source || 'Organic Web'}</span></td>
      </tr>
    `).join('');
  }

  function exportInvestorDossierCsv() {
    const headers = ['Record_Type', 'Name_or_Email', 'Account_NUBAN', 'Balance_or_Amount', 'Status', 'Timestamp'];
    const rows = [];

    // Add Users
    adminUsersList.forEach(u => {
      rows.push(['MEMBER_WALLET', `"${u.fullName || 'User'}"`, `"${u.nuban || ''}"`, (u.balance || 0), (u.isFrozen ? 'FROZEN' : 'ACTIVE'), `"${new Date().toISOString()}"`]);
    });

    // Add Transactions
    adminTxList.forEach(t => {
      rows.push(['TRANSACTION', `"${t.sender} -> ${t.beneficiary}"`, `"${t.ref}"`, t.amount, t.status, `"${t.date}"`]);
    });

    // Add Waitlist Leads
    adminWaitlistEntries.forEach(w => {
      rows.push(['WAITLIST_LEAD', `"${w.email}"`, 'N/A', 0, 'PENDING_ONBOARDING', `"${w.date}"`]);
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
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
  if (adminQuickAddFundBtn) {
    adminQuickAddFundBtn.addEventListener('click', () => {
      const email = prompt('Enter the user email to credit funds (default: olasunkanmiolamide15@gmail.com):', 'olasunkanmiolamide15@gmail.com');
      if (!email) return;
      const amountStr = prompt('Enter amount to credit (₦):', '50000');
      const amt = parseFloat(amountStr) || 50000;
      const user = findAccount(email);
      if (user) {
        user.balance = (Number(user.balance) || 0) + amt;
        saveAccountToRegistry(user);
        if (state.user && state.user.email.toLowerCase() === email.toLowerCase()) {
          state.dashBalance = user.balance;
          renderBalances();
        }
        showToast(`🎉 Credited ${formatNaira(amt)} to ${user.fullName}'s wallet!`);
        renderAdminPortal();
      } else {
        showToast(`User ${email} not found.`, 'error');
      }
    });
  }
  if (adminKillswitchTest) {
    adminKillswitchTest.addEventListener('click', () => {
      showToast('🔒 CBN Emergency Interlock: Operational safety systems verified and armed.');
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

  // User Action Delegation (Freeze / Unfreeze & Credit)
  const usersTbody = document.getElementById('admin-users-tbody');
  if (usersTbody) {
    usersTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const email = btn.getAttribute('data-email');
      const user = findAccount(email);
      if (!user) return;

      if (action === 'toggle-freeze') {
        user.isFrozen = !user.isFrozen;
        saveAccountToRegistry(user);
        if (state.user && state.user.email.toLowerCase() === email.toLowerCase()) {
          state.user.isFrozen = user.isFrozen;
          state.isAccountFrozen = user.isFrozen;
        }
        showToast(user.isFrozen ? `🔒 Account for ${user.fullName} FROZEN (CBN AML Compliance)` : `✅ Account for ${user.fullName} UNFROZEN`);
        renderAdminPortal();
      } else if (action === 'credit-funds') {
        user.balance = (Number(user.balance) || 0) + 50000;
        saveAccountToRegistry(user);
        if (state.user && state.user.email.toLowerCase() === email.toLowerCase()) {
          state.dashBalance = user.balance;
          renderBalances();
        }
        showToast(`🎉 Credited ₦50,000.00 to ${user.fullName}'s wallet!`);
        renderAdminPortal();
      }
    });
  }
});
