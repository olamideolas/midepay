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
  dashBalance: 0.00,
  txFilter: 'all',
  transactions: []
};

// Default Demo Transactions for Sandbox / Interactive Prototype Preview
const DEFAULT_DEMO_TRANSACTIONS = [
  {
    id: 'tx-001',
    ref: 'MP-TX-20260923-849102',
    title: 'Transfer from Kuda Bank',
    category: 'Bank Inflow',
    sender: 'Kuda MFB • Chinedu Eze',
    beneficiary: 'Demo Account',
    narration: 'Freelance Design Reimbursement',
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
    sender: 'Demo Account',
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
    beneficiary: 'Demo Account',
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
    sender: 'Demo Account',
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
    sender: 'Demo Account',
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
    sender: 'Demo Account',
    beneficiary: 'MTN Nigeria (08031234567)',
    narration: 'Mobile Airtime & Data Bundle',
    date: '20 Sep 2026, 04:30 PM',
    type: 'outflow',
    amount: 3000.00,
    status: 'Successful'
  }
];

// Default Demo User for instant preview / fallback
const DEFAULT_DEMO_USER = {
  fullName: 'MidePay Demo',
  email: 'demo@midepay.ng',
  phone: '8031234567',
  password: 'password123',
  tag: '@midepaydemo',
  nuban: '9021849102',
  bank: 'Providus Bank'
};

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

// Navigation & View Routing Controller
function showView(viewName) {
  state.currentView = viewName;

  const views = {
    landing: document.getElementById('view-landing'),
    register: document.getElementById('view-register'),
    login: document.getElementById('view-login'),
    dashboard: document.getElementById('view-dashboard')
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

  // Adjust global header based on current view
  const landingNavLinks = document.getElementById('landing-nav-links');
  const landingNavActions = document.getElementById('landing-nav-actions');
  const dashboardNavActions = document.getElementById('dashboard-nav-actions');
  const mobileToggle = document.getElementById('mobile-menu-toggle');

  if (viewName === 'dashboard') {
    if (landingNavLinks) landingNavLinks.classList.add('hidden');
    if (landingNavActions) landingNavActions.classList.add('hidden');
    if (dashboardNavActions) dashboardNavActions.classList.remove('hidden');
    if (mobileToggle) mobileToggle.classList.add('hidden');
    // Load live Supabase data on dashboard view
    if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user && state.user.id && !state.user.id.startsWith('local-')) {
      loadDashboardData();
    }
  } else if (viewName === 'register' || viewName === 'login') {
    if (landingNavLinks) landingNavLinks.classList.add('hidden');
    if (landingNavActions) landingNavActions.classList.add('hidden');
    if (dashboardNavActions) dashboardNavActions.classList.add('hidden');
    if (mobileToggle) mobileToggle.classList.add('hidden');
  } else {
    // Landing
    if (landingNavLinks) landingNavLinks.classList.remove('hidden');
    if (landingNavActions) landingNavActions.classList.remove('hidden');
    if (dashboardNavActions) dashboardNavActions.classList.add('hidden');
    if (mobileToggle) mobileToggle.classList.remove('hidden');
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Close mobile drawer if open
  const drawer = document.getElementById('mobile-drawer');
  if (drawer) drawer.classList.remove('open');
}

// Update Balance UI Displays
function renderBalances() {
  const heroDisplay = document.getElementById('hero-balance-display');
  const dashDisplay = document.getElementById('dash-balance-display');

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
  container.innerHTML = items.map(item => `
    <div class="feature-card">
      <div class="feature-icon-box">
        ${item.iconSvg}
      </div>
      <h3 class="feature-title">${item.title}</h3>
      <p class="feature-desc">${item.desc}</p>
      <div class="feature-tag">${item.tag}</div>
    </div>
  `).join('');
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
  if (!listContainer) return;

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

    // Skip query if no user or demo simulated account
    if (!currentUserId || currentUserId.startsWith('local-') || (state.user && state.user.email === DEFAULT_DEMO_USER.email && !state.user.id)) {
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
      state.dashBalance = (walletData.balance !== null && walletData.balance !== undefined) 
        ? Number(walletData.balance) 
        : 0.00;
    } else {
      // Gracefully handle new users with no wallet entry yet (₦0.00 balance)
      state.dashBalance = 0.00;
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
      // Gracefully handle new users with 0 transactions (empty list, not mock data)
      state.transactions = [];
    }

    // 3. Render updated live values
    syncUserToDashboard();
    renderBalances();
    renderDashboardTransactions();
    return true;
  } catch (err) {
    console.error('❌ [MidePay] Live dashboard load error:', err);
    return false;
  }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initial LocalStorage session check
  const savedUser = localStorage.getItem('midepay_user');
  const activeSession = localStorage.getItem('midepay_session');

  if (activeSession && savedUser) {
    try {
      state.user = JSON.parse(savedUser);
    } catch (e) {
      state.user = null;
    }
  }

  // 2. Initial renders
  renderFeatureGrid('personal');
  renderBalances();
  renderDashboardTransactions();
  syncUserToDashboard();

  // 3. Check for live Supabase session and load live data
  if (window.MidePayDB && window.MidePayDB.isConfigured()) {
    window.MidePayDB.getCurrentUser().then(async (supaUser) => {
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
          bank: 'Providus Bank'
        };
        localStorage.setItem('midepay_user', JSON.stringify(state.user));
        localStorage.setItem('midepay_session', JSON.stringify({ email: state.user.email, loggedIn: true }));
        syncUserToDashboard();
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

  // Direct Live Demo Buttons (bypass to Dashboard)
  const openDemoDashboard = () => {
    state.user = { ...DEFAULT_DEMO_USER };
    state.dashBalance = 485250.00;
    state.transactions = [...DEFAULT_DEMO_TRANSACTIONS];
    syncUserToDashboard();
    renderBalances();
    renderDashboardTransactions();
    showView('dashboard');
    showToast('Loaded MidePay Interactive Demo Dashboard 🇳🇬');
  };

  if (heroDemoBtn) heroDemoBtn.addEventListener('click', openDemoDashboard);
  if (footerDemoDirect) footerDemoDirect.addEventListener('click', openDemoDashboard);

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
      if (window.MidePayDB && window.MidePayDB.isConfigured()) {
        const { user: supaUser, error: supaErr } = await window.MidePayDB.signUp({ email, password, fullName, phone });
        if (supaErr) {
          showRegisterError(supaErr.message || 'Registration error with database.');
          return;
        }
        if (supaUser) supaUserId = supaUser.id;
      }

      const uniqueNuban = generateUserNuban(email || fullName);
      const cleanTag = `@${fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      const newUser = {
        id: supaUserId || 'user-' + Date.now(),
        fullName: fullName,
        email: email,
        phone: phone,
        password: password,
        tag: cleanTag,
        nuban: uniqueNuban,
        bank: 'Providus Bank',
        registeredAt: new Date().toISOString()
      };

      // Save user & set active session in localStorage
      localStorage.setItem('midepay_user', JSON.stringify(newUser));
      localStorage.setItem('midepay_session', JSON.stringify({ email: newUser.email, loggedIn: true }));

      state.user = newUser;
      state.dashBalance = 0.00;
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
      showToast(`Welcome to MidePay, ${fullName}! Your unique account is ready.`);
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
  const loginForm = document.getElementById('login-form');
  const loginErrorAlert = document.getElementById('login-error-alert');
  const quickFillDemoBtn = document.getElementById('quick-fill-demo-btn');

  // Quick fill helper
  if (quickFillDemoBtn) {
    quickFillDemoBtn.addEventListener('click', () => {
      const emailInput = document.getElementById('login-email');
      const passInput = document.getElementById('login-password');
      
      const saved = localStorage.getItem('midepay_user');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          emailInput.value = parsed.email;
          passInput.value = parsed.password;
          showToast('Filled with your registered account credentials');
          return;
        } catch (e) {}
      }

      emailInput.value = DEFAULT_DEMO_USER.email;
      passInput.value = DEFAULT_DEMO_USER.password;
      showToast('Filled with default demo credentials');
    });
  }

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

      // Check live Supabase authentication first if configured
      if (window.MidePayDB && window.MidePayDB.isConfigured()) {
        const { user: supaUser, error: supaErr } = await window.MidePayDB.signIn({ email, password });
        if (supaErr) {
          showLoginError(supaErr.message || 'Invalid credentials.');
          return;
        }
        if (supaUser) {
          const profile = await window.MidePayDB.getProfile(supaUser.id);
          const userName = profile?.full_name || supaUser.user_metadata?.full_name || state.user?.fullName || email.split('@')[0];
          const userNuban = state.user?.nuban || generateUserNuban(supaUser.email || supaUser.id);
          matchedUser = {
            id: supaUser.id,
            fullName: userName,
            email: supaUser.email,
            phone: profile?.phone || '',
            tag: profile?.tag || state.user?.tag || `@${userName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
            nuban: userNuban,
            bank: 'Providus Bank'
          };
          state.user = matchedUser;
          localStorage.setItem('midepay_user', JSON.stringify(matchedUser));
          localStorage.setItem('midepay_session', JSON.stringify({ email: matchedUser.email, loggedIn: true }));

          syncUserToDashboard();
          await loadDashboardData();
          showView('dashboard');
          showToast(`Welcome back, ${matchedUser.fullName}!`);
          return;
        }
      }

      // Check local storage for simulated account
      if (!matchedUser) {
        const stored = localStorage.getItem('midepay_user');
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed.email.toLowerCase() === email.toLowerCase() && parsed.password === password) {
              matchedUser = parsed;
            }
          } catch (e) {}
        }
      }

      // Check default demo credentials
      if (!matchedUser && email.toLowerCase() === DEFAULT_DEMO_USER.email.toLowerCase() && password === DEFAULT_DEMO_USER.password) {
        matchedUser = { ...DEFAULT_DEMO_USER };
      }

      if (matchedUser) {
        // Successful login
        state.user = matchedUser;
        if (!matchedUser.nuban) matchedUser.nuban = generateUserNuban(matchedUser.email);
        localStorage.setItem('midepay_user', JSON.stringify(matchedUser));
        localStorage.setItem('midepay_session', JSON.stringify({ email: matchedUser.email, loggedIn: true }));
        syncUserToDashboard();
        renderBalances();
        renderDashboardTransactions();
        showView('dashboard');
        showToast(`Welcome back, ${matchedUser.fullName}!`);
      } else {
        showLoginError('Invalid email or password. Use "Use Demo Account" or register a new wallet.');
      }
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

  function handleLogout() {
    localStorage.removeItem('midepay_session');
    localStorage.removeItem('midepay_user');
    state.user = null;
    state.dashBalance = 0.00;
    state.transactions = [];
    if (window.MidePayDB && typeof window.MidePayDB.signOut === 'function') {
      window.MidePayDB.signOut().catch(console.error);
    }
    syncUserToDashboard();
    renderBalances();
    renderDashboardTransactions();
    showView('landing');
    showToast('Logged out of MidePay successfully.');
  }

  if (dashLogoutBtn) dashLogoutBtn.addEventListener('click', handleLogout);
  if (navLogoutBtn) navLogoutBtn.addEventListener('click', handleLogout);

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
    const sendModalBalance = document.getElementById('transfer-modal-balance');
    if (sendModalBalance) {
      sendModalBalance.textContent = formatNaira(state.dashBalance);
    }
    if (typeof showSendStep === 'function') {
      showSendStep('recipient');
    }
    modalSend?.classList.remove('hidden');
  }

  if (btnOpenSend) btnOpenSend.addEventListener('click', openSendModal);
  if (qaTransfer) qaTransfer.addEventListener('click', openSendModal);
  if (heroQuickSend) {
    heroQuickSend.addEventListener('click', () => {
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

  if (btnCloseSend) btnCloseSend.addEventListener('click', () => modalSend?.classList.add('hidden'));
  if (btnCloseAdd) btnCloseAdd.addEventListener('click', () => modalAdd?.classList.add('hidden'));
  if (btnCloseAirtime) btnCloseAirtime.addEventListener('click', () => modalAirtime?.classList.add('hidden'));
  if (btnCloseBills) btnCloseBills.addEventListener('click', () => modalBills?.classList.add('hidden'));
  if (btnCloseCards) btnCloseCards.addEventListener('click', () => modalCards?.classList.add('hidden'));
  if (btnCloseReceipt) btnCloseReceipt.addEventListener('click', () => modalReceipt?.classList.add('hidden'));

  // Close modals when clicking backdrop
  [modalSend, modalAdd, modalAirtime, modalBills, modalCards, modalReceipt].forEach(m => {
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
    const fundAmt = Number(amount) || 50000;
    state.dashBalance += fundAmt;

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
      narration: 'Instant Demo Wallet Top-Up',
      date: 'Just now',
      type: 'inflow',
      amount: fundAmt,
      fee: 0.00,
      status: 'Successful'
    };
    state.transactions.unshift(newTx);
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
            state.dashBalance = Number(res.wallet.balance);
            renderBalances();
            if (sendModalBalance) sendModalBalance.textContent = formatNaira(state.dashBalance);
            if (amountStepBalance) amountStepBalance.textContent = formatNaira(state.dashBalance);
            if (typeof validateAmountInputs === 'function') {
              validateAmountInputs();
            }
          }
        }
      } catch (err) {
        console.warn('Supabase top-up sync error:', err);
      }
    }

    showToast(`🎉 Added ${formatNaira(fundAmt)} test credit to your MidePay wallet!`);
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
    lastTransaction: null
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

      // 3. Check Wallet Balance & Auto-Topup if Demo Testing
      const totalNeeded = amt + sendFlowState.transferFee;
      if (totalNeeded > state.dashBalance) {
        const fundCredit = Math.max(50000, Math.ceil(totalNeeded * 1.5));
        await topUpDemoBalance(fundCredit);
        showToast(`🎉 Added ${formatNaira(fundCredit)} demo test credit to your wallet!`);
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
  // SCREEN 2: OPAY / PALMPAY CONFIRMATION & 4-DIGIT PIN LOGIC
  // -------------------------------------------------------------
  function populatePinScreen() {
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
    if (btnAuthorizePayText) btnAuthorizePayText.textContent = `Pay ${formatNaira(amt)}`;
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

  // "⚡ Use PIN: 1234" Quick Fill Helper
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
      if (enteredPin.length !== 4) {
        if (pinAuthError && pinAuthErrorText) {
          pinAuthErrorText.textContent = 'Please enter your 4-digit security PIN (or click ⚡ Use PIN: 1234).';
          pinAuthError.classList.remove('hidden');
        }
        authPinBoxes[0]?.focus();
        return;
      }

      // Demo accepts 1234 or configured user PIN
      const storedPinHash = state.user?.pinHash;
      let isPinValid = (enteredPin === '1234');
      if (!isPinValid && storedPinHash) {
        isPinValid = (storedPinHash === enteredPin || storedPinHash.includes(enteredPin));
      }

      if (!isPinValid) {
        if (pinAuthError && pinAuthErrorText) {
          pinAuthErrorText.textContent = 'Incorrect PIN. For this demo, please click "⚡ Use PIN: 1234".';
          pinAuthError.classList.remove('hidden');
        }
        clearPinBoxes();
        authPinBoxes[0]?.focus();
        return;
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
          sender: state.user?.fullName || 'Demo Account',
          beneficiary: `${sendFlowState.resolvedName} • ${sendFlowState.selectedBank} (${sendFlowState.accountNumber})`,
          narration: sendFlowState.narration || 'Transfer via MidePay',
          date: 'Just now',
          type: 'outflow',
          amount: sendFlowState.amount,
          fee: sendFlowState.transferFee,
          status: 'Successful'
        };

        state.transactions.unshift(newTx);
        sendFlowState.lastTransaction = newTx;

        // Persist to Supabase if configured
        if (window.MidePayDB && window.MidePayDB.isConfigured() && state.user?.id) {
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
          btnAuthorizePayText.textContent = `Pay ${formatNaira(sendFlowState.amount)}`;
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
  if (qaAirtime) {
    qaAirtime.addEventListener('click', () => {
      if (airtimePhoneInput && !airtimePhoneInput.value && state.user?.phone) {
        airtimePhoneInput.value = state.user.phone;
      }
      calculateAirtimeCashback();
      modalAirtime?.classList.remove('hidden');
    });
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
        showToast(`Insufficient balance. You need ${formatNaira(amount)} to complete this transaction.`, 'error');
        return;
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
    if (defaultTab === 'cable') {
      tabCable?.click();
    } else {
      tabElectricity?.click();
    }
    updateBillButtonText();
    modalBills?.classList.remove('hidden');
  }

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
          showToast(`Insufficient balance. You need ${formatNaira(amount)} to pay this bill.`, 'error');
          return;
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
          showToast(`Insufficient balance. You need ${formatNaira(amount)} for this bouquet.`, 'error');
          return;
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
    renderVirtualCard();
    modalCards?.classList.remove('hidden');
  }

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
    btnFundCardModal.addEventListener('click', () => {
      const card = virtualCardState[virtualCardState.activeType];
      if (virtualCardState.activeType === 'usd') {
        card.balance = '$300.00';
        showToast(`Funding USD Card: $50.00 credited to your Virtual Mastercard!`);
      } else {
        if (state.dashBalance >= 20000) {
          state.dashBalance -= 20000;
          renderBalances();
        }
        card.balance = '₦170,000.00';
        showToast(`₦20,000.00 transferred from your main wallet to your Virtual Naira Card!`);
      }
      renderVirtualCard();
    });
  }

  // Quick Action Buttons
  if (qaBills) qaBills.addEventListener('click', () => openBillsModal('electricity'));
  if (qaCard) qaCard.addEventListener('click', openCardsModal);

  if (heroQuickBills) heroQuickBills.addEventListener('click', () => {
    showView('dashboard');
    openBillsModal('electricity');
  });
  if (heroQuickCards) heroQuickCards.addEventListener('click', () => {
    showView('dashboard');
    openCardsModal();
  });
});
