/**
 * MidePay — Production-Hardened Supabase Client & Financial Ledger Gateway
 * Powered by @supabase/supabase-js v2 + bcryptjs
 *
 * Security & Compliance Guarantees (ENV === 'production'):
 * 1. Zero unverified localStorage overrides for credentials, PIN hashes, freeze flags, or balances.
 * 2. Zero client-side demo recipient fallbacks (chinedu@midepay.com, etc.) or mock ledger mutations.
 * 3. Server-authoritative verification of `pin_hash` (bcryptjs), `is_frozen`, and `role === 'executive'`
 *    directly against `public.profiles` on Supabase PostgreSQL.
 * 4. Atomic `SECURITY DEFINER` RPC execution for `transfer_funds`, `admin_credit_wallet`, and `admin_set_account_freeze`.
 */

(function (window) {
  'use strict';

  const DEFAULT_CONFIG = {
    ENV: 'production',
    url: 'https://YOUR_PROJECT_ID.supabase.co',
    anonKey: 'YOUR_SUPABASE_ANON_KEY'
  };

  const userConfig = window.MIDEPAY_SUPABASE_CONFIG || {};
  const APP_ENV = String(userConfig.ENV || DEFAULT_CONFIG.ENV).trim().toLowerCase();
  const isProduction = () => APP_ENV === 'production';
  const isFinancialQuarantined = () => {
    const liveCfg = (typeof window !== 'undefined' && window.MIDEPAY_SUPABASE_CONFIG) || userConfig || {};
    return isProduction() && liveCfg.FINANCIAL_RPCS_LIVE !== true;
  };
  const buildQuarantineResult = (featureLabel = 'financial mutations') => ({
    success: false,
    quarantined: true,
    code: 'STAGING_QUARANTINE',
    error: `Staging Quarantine: Client-side ${featureLabel} are disabled until backend settlement is live.`
  });

  // In production, strictly ignore localStorage URL/key overrides to prevent client-side endpoint hijacking
  if (!isProduction()) {
    if (userConfig.anonKey && !userConfig.anonKey.includes('...')) {
      localStorage.setItem('midepay_supabase_anon_key', userConfig.anonKey);
    }
    if (userConfig.url && !userConfig.url.includes('YOUR_PROJECT_ID')) {
      localStorage.setItem('midepay_supabase_url', userConfig.url);
    }
  } else {
    try {
      localStorage.removeItem('midepay_supabase_url');
      localStorage.removeItem('midepay_supabase_anon_key');
    } catch (e) {}
  }

  const SUPABASE_URL = isProduction()
    ? (userConfig.url || DEFAULT_CONFIG.url)
    : (userConfig.url || localStorage.getItem('midepay_supabase_url') || DEFAULT_CONFIG.url);

  const SUPABASE_ANON_KEY = isProduction()
    ? (userConfig.anonKey || DEFAULT_CONFIG.anonKey)
    : (userConfig.anonKey || localStorage.getItem('midepay_supabase_anon_key') || DEFAULT_CONFIG.anonKey);

  const isSupabaseConfigured = () => {
    return Boolean(
      SUPABASE_URL &&
      !SUPABASE_URL.includes('YOUR_PROJECT_ID') &&
      SUPABASE_ANON_KEY &&
      !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY') &&
      !SUPABASE_ANON_KEY.includes('...') &&
      SUPABASE_ANON_KEY.length >= 40
    );
  };

  const isValidUuid = (id) => {
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  };

  const getBcrypt = () => {
    if (typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) return dcodeIO.bcrypt;
    if (typeof window !== 'undefined' && window.bcrypt) return window.bcrypt;
    return null;
  };

  const isBcryptHash = (hash) => {
    return typeof hash === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);
  };

  /**
   * Web Crypto CSPRNG helpers (strictly `crypto.getRandomValues` — zero pseudo-random PRNGs)
   */
  const csprngUint32 = () => {
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
      throw new Error('Web Crypto CSPRNG (crypto.getRandomValues) is required for MidePay financial identifiers.');
    }
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  };

  const generateSecureRandomNuban = () => {
    const eightDigits = String(csprngUint32() % 100000000).padStart(8, '0');
    return `90${eightDigits}`;
  };

  const generateIdempotencyKey = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  };

  const computeLuhnCheckDigit = (digits15) => {
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

  const generateSecureCardCredentials = ({ cardHolderName = 'MIDEPAY MEMBER', prefix = '5399' } = {}) => {
    const cleanPrefix = String(prefix || '5399').replace(/[^0-9]/g, '').padStart(4, '5').slice(0, 4);
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let body11 = '';
    for (let i = 0; i < 11; i++) {
      body11 += String(bytes[i] % 10);
    }
    const digits15 = `${cleanPrefix}${body11}`;
    const rawPan = `${digits15}${computeLuhnCheckDigit(digits15)}`;
    const formattedPan = `${rawPan.slice(0, 4)} ${rawPan.slice(4, 8)} ${rawPan.slice(8, 12)} ${rawPan.slice(12, 16)}`;
    const maskedPan = `${rawPan.slice(0, 4)} •••• •••• ${rawPan.slice(12, 16)}`;
    const cvv = String(100 + (csprngUint32() % 900));

    const now = new Date();
    const expiryMonth = now.getMonth() + 1;
    const expiryYear = now.getFullYear() + 3;
    const expiryDisplay = `${String(expiryMonth).padStart(2, '0')}/${String(expiryYear).slice(-2)}`;

    return {
      cardNumber: formattedPan,
      maskedPan,
      cvv,
      expiryMonth,
      expiryYear,
      expiryDisplay,
      cardHolderName: String(cardHolderName || 'MIDEPAY MEMBER').trim().toUpperCase()
    };
  };

  // Startup Telemetry & Environment Enforcement Check
  (function runStartupCheck() {
    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === DEFAULT_CONFIG.anonKey) {
      if (isProduction()) {
        console.error('❌ [MidePay Production] Missing Supabase credentials in config.js.');
      } else {
        console.info('ℹ️ [MidePay Dev] Supabase placeholder detected. Running in development simulation mode.');
      }
      return;
    }

    if (SUPABASE_ANON_KEY.includes('...') || SUPABASE_ANON_KEY.length < 40) {
      console.warn('⚠️ [MidePay Startup Warning] Supabase API key appears truncated or malformed.');
    }
  })();

  // Initialize Supabase JS Client
  let client = null;
  if (typeof window.supabase !== 'undefined' && window.supabase.createClient && isSupabaseConfigured()) {
    try {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      console.info(`✅ [MidePay] Supabase initialized (${APP_ENV.toUpperCase()}):`, SUPABASE_URL);
    } catch (e) {
      console.error('❌ [MidePay] Failed to initialize Supabase client:', e);
    }
  }

  /**
   * MidePay Enterprise Database & RPC Gateway
   */
  const MidePayDB = {
    ENV: APP_ENV,
    client,
    isProduction,
    isFinancialQuarantined,
    isConfigured: isSupabaseConfigured,
    generateSecureRandomNuban,
    generateSecureCardCredentials,

    /**
     * Dynamic credential configuration (permitted ONLY outside production)
     */
    configure(url, anonKey) {
      if (isProduction()) {
        console.error('🔒 [MidePay Security] Runtime credential override is disabled when ENV === "production".');
        return false;
      }
      localStorage.setItem('midepay_supabase_url', url);
      localStorage.setItem('midepay_supabase_anon_key', anonKey);
      if (typeof window.supabase !== 'undefined') {
        this.client = window.supabase.createClient(url, anonKey);
      }
      return true;
    },

    // =========================================================================
    // AUTHENTICATION FLOWS
    // =========================================================================

    async signUp({ email, password, fullName, phone }) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!this.isConfigured() || !this.client) {
        if (isProduction()) {
          return {
            user: null,
            session: null,
            error: new Error('Production authentication service is not configured.')
          };
        }
        const fallbackUuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : '00000000-0000-4000-8000-000000000000';
        return {
          user: { id: fallbackUuid, email: normalizedEmail, user_metadata: { full_name: fullName, phone } },
          session: null,
          error: null,
          requiresOtpVerification: true,
          emailConfirmationPending: true
        };
      }

      const { data, error } = await this.client.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: fullName,
            phone: phone
          }
        }
      });

      if (error) return { user: null, session: null, error };

      // Zero-Trust Session Hardening: Never auto-sign-in or expose an unverified session prior to 6-digit OTP verification
      if (data?.session) {
        try {
          await this.client.auth.signOut();
        } catch (_) {}
      }

      const otpChallengeKind = data?.user?.email_confirmed_at ? 'email' : 'signup';
      if (otpChallengeKind === 'email') {
        const sent=await this.requestEmailVerification(normalizedEmail);
        if (!sent.success) return {user:null,session:null,error:new Error('Account created, but a verification code could not be sent. Sign in to request another code.')};
      }
      return {
        user: data?.user || null,
        session: null,
        error: null,
        otpChallengeKind,
        requiresOtpVerification: true,
        emailConfirmationPending: true
      };
    },

    async verifySignupOtp({ email, token, type = 'signup' }) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const cleanToken = String(token || '').replace(/[^0-9]/g, '');

      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return { user: null, session: null, error: new Error('Enter a valid email address.') };
      }
      if (!/^\d{6}$/.test(cleanToken)) {
        return { user: null, session: null, error: new Error('Enter the complete 6-digit verification code.') };
      }
      if (!this.isConfigured() || !this.client) {
        return { user: null, session: null, error: new Error('Authentication verification service is unavailable.') };
      }

      const { data, error } = await this.client.functions.invoke('verify-email-otp', {
        body: { email: normalizedEmail, token: cleanToken }
      });
      if (error || !data?.success || !data?.session?.access_token || !data?.session?.refresh_token) {
        return { user: null, session: null, error: error || new Error(data?.error || 'Email verification failed.') };
      }
      const adopted = await this.client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
      if (adopted.error || adopted.data?.user?.id !== data.user?.id) {
        return { user: null, session: null, error: adopted.error || new Error('Verified session could not be established.') };
      }
      return { user: adopted.data.user, session: adopted.data.session, error: null };
    },

    async requestEmailVerification(email) {
      if (!this.client || !this.isConfigured()) return { success: false, error: new Error('Authentication unavailable.') };
      const { error } = await this.client.auth.signInWithOtp({
        email: String(email || '').trim().toLowerCase(), options: { shouldCreateUser: false }
      });
      return { success: !error, error };
    },

    async resendSignupOtp(email) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return { success: false, error: new Error('Enter a valid email address to resend OTP.') };
      }
      if (!this.isConfigured() || !this.client || typeof this.client.auth.resend !== 'function') {
        return { success: false, error: new Error('OTP resend service is unavailable.') };
      }

      const { error } = await this.client.auth.resend({
        type: 'signup',
        email: normalizedEmail
      });

      if (error) {
        return { success: false, error };
      }
      return { success: true, error: null };
    },

    async signIn({ email, password }) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!this.isConfigured() || !this.client) {
        if (isProduction()) {
          return {
            session: null,
            user: null,
            error: new Error('Production authentication service is unavailable.')
          };
        }
        return { session: null, error: null, isDemo: true };
      }

      const { data, error } = await this.client.auth.signInWithPassword({
        email: normalizedEmail,
        password
      });

      if (error) {
        const msg = String(error.message || '');
        if (/email\s*not\s*confirmed|not\s*verified|unconfirmed/i.test(msg)) {
          return {
            session: null,
            user: null,
            emailNotConfirmed: true,
            email: normalizedEmail,
            error
          };
        }
        return { session: null, user: null, error };
      }

      // Guard against relaxed Auth projects returning a session when `email_confirmed_at` is still null
      if (data?.user && !data.user.email_confirmed_at) {
        try {
          await this.client.auth.signOut();
        } catch (_) {}
        return {
          session: null,
          user: null,
          emailNotConfirmed: true,
          email: normalizedEmail,
          error: new Error('Email not confirmed')
        };
      }

      return { session: data.session, user: data.user, error: null };
    },

    async signOut() {
      if (this.isConfigured() && this.client) {
        try {
          await this.client.auth.signOut();
        } catch (e) {
          console.warn('[MidePay] Supabase signOut notice:', e);
        }
      }
      try {
        Object.keys(localStorage).forEach(key => {
          if (
            key.startsWith('sb-') ||
            key.includes('supabase') ||
            key.startsWith('midepay_pin_hash_')
          ) {
            localStorage.removeItem(key);
          }
        });
      } catch (e) {}
    },

    async getCurrentUser() {
      if (!this.isConfigured() || !this.client) return null;
      const { data, error } = await this.client.auth.getUser();
      if (error) return null;
      return data?.user || null;
    },

    // =========================================================================
    // PROFILES, ROLE CLEARANCE, FREEZE INTERLOCK & WALLETS
    // =========================================================================

    async getProfile(userId) {
      if (!this.isConfigured() || !this.client || !isValidUuid(userId)) return null;

      const { data, error } = await this.client
        .from('profiles')
        .select('id, full_name, email, phone, tag, avatar_url, kyc_tier, bvn_verified, nin_verified, pin_failed_attempts, pin_locked_until, role, is_frozen, frozen_by_admin, email_otp_verified_at, last_login_at, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('[MidePay] Error fetching profile:', error.message);
        return null;
      }
      return data || null;
    },

    /**
     * Server-authoritative check against `public.profiles` for `role === 'executive'`
     */
    async isUserExecutive() {
      if (!this.isConfigured() || !this.client) return false;
      try {
        const { data: userData, error: userErr } = await this.client.auth.getUser();
        const user = userData?.user;
        if (userErr || !user || !user.id || !isValidUuid(user.id)) return false;

        const { data, error } = await this.client
          .from('profiles')
          .select('id, role, is_frozen')
          .eq('id', user.id)
          .maybeSingle();

        if (error || !data) return false;
        return data.role === 'executive' && data.is_frozen !== true;
      } catch (err) {
        console.warn('[MidePay] Executive role check notice:', err);
        return false;
      }
    },

    /**
     * Server-authoritative check against `public.profiles` for `is_frozen`
     */
    async getAccountFreezeStatus(userId) {
      if (!this.isConfigured() || !this.client || !isValidUuid(userId)) {
        return { isFrozen: false, source: 'unavailable' };
      }
      try {
        const { data, error } = await this.client
          .from('profiles')
          .select('id, is_frozen, frozen_by_admin')
          .eq('id', userId)
          .maybeSingle();

        if (error || !data) return { isFrozen: false, source: 'supabase' };
        return { isFrozen: data.is_frozen === true, frozenByAdmin: data.frozen_by_admin === true, source: 'supabase' };
      } catch (e) {
        return { isFrozen: false, source: 'error' };
      }
    },

    /**
     * Allow authenticated user to toggle CBN Emergency Panic Freeze on their own account
     */
    async setOwnAccountFreeze(userId, freezeState, pin = null) {
      if (!this.isConfigured() || !this.client || !isValidUuid(userId)) {
        if (isProduction()) {
          return { success: false, error: 'Authenticated Supabase session required to update freeze state.' };
        }
        return { success: true, isFrozen: Boolean(freezeState), isDemo: true };
      }

      try {
        const { data: authData } = await this.client.auth.getUser();
        if (!authData?.user || authData.user.id !== userId) {
          return { success: false, error: 'Unauthorized account freeze request.' };
        }

        // Zero-Trust RPC ONLY: `set_own_account_freeze`
        const { data: rpcFreeze, error: rpcErr } = await this.client.rpc('set_own_account_freeze', {
          p_is_frozen: Boolean(freezeState),
          p_pin: pin ? String(pin).trim() : null
        });

        if (rpcErr || !rpcFreeze?.success) {
          return { success: false, error: rpcErr?.message || rpcFreeze?.error || 'Failed to update account freeze state.' };
        }

        return { success: true, isFrozen: Boolean(rpcFreeze.is_frozen) };
      } catch (e) {
        return { success: false, error: e.message || 'Failed to update account freeze state.' };
      }
    },

    async getWallet(userId) {
      if (!this.isConfigured() || !this.client || !isValidUuid(userId)) return null;

      const { data, error } = await this.client
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .eq('currency', 'NGN')
        .maybeSingle();

      if (error) {
        console.warn('[MidePay] Error fetching wallet:', error.message);
        return null;
      }
      return data || null;
    },

    async ensureProfileAndWallet(user, meta = {}) {
      if (!this.isConfigured() || !this.client || !user || !user.id || !isValidUuid(user.id)) return null;
      const userId = user.id;
      const fullName = (meta.fullName || user.user_metadata?.full_name || user.email?.split('@')[0] || 'MidePay Member').trim();
      const phone = meta.phone || user.user_metadata?.phone || null;

      try {
        // Zero-Trust RPC ONLY: Server-side self-healing RPC (`ensure_my_profile_and_wallet`)
        const { data: ensured, error: ensureErr } = await this.client.rpc('ensure_my_profile_and_wallet', {
          p_full_name: fullName,
          p_phone: phone
        });

        if (!ensureErr && ensured && ensured.profile && ensured.wallet) {
          return {
            profile: ensured.profile,
            wallet: ensured.wallet,
            emailConfirmed: ensured.email_confirmed !== undefined ? Boolean(ensured.email_confirmed) : Boolean(user.email_confirmed_at),
            hasTransactionPin: Boolean(ensured.has_transaction_pin ?? ensured.profile?.has_transaction_pin)
          };
        }

        const [profile, wallet] = await Promise.all([
          this.getProfile(userId),
          this.getWallet(userId)
        ]);
        return {
          profile,
          wallet,
          emailConfirmed: Boolean(user.email_confirmed_at),
          hasTransactionPin: Boolean(profile?.has_transaction_pin)
        };
      } catch (e) {
        console.warn('⚠️ [MidePay] ensureProfileAndWallet notice:', e.message);
        return null;
      }
    },

    async recordVerifiedLoginSession(extraMeta = {}) {
      if (!this.isConfigured() || !this.client) {
        return { success: false, error: 'Authentication audit service unavailable.' };
      }

      const nav = (typeof window !== 'undefined' && window.navigator) ? window.navigator : {};
      const scr = (typeof window !== 'undefined' && window.screen) ? window.screen : {};
      let tz = 'Africa/Lagos';
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos';
      } catch (_) {}

      const devicePayload = {
        user_agent: String(nav.userAgent || 'MidePay Web Client').slice(0, 280),
        platform: String(nav.platform || 'Web').slice(0, 64),
        language: String(nav.language || 'en-NG').slice(0, 24),
        timezone: tz,
        viewport: scr.width && scr.height ? `${scr.width}x${scr.height}` : 'responsive',
        client_timestamp: new Date().toISOString(),
        ...extraMeta
      };

      try {
        const { data, error } = await this.client.rpc('record_verified_login_session', {
          p_device_metadata: devicePayload
        });

        if (error || data?.success === false) {
          return {
            success: false,
            code: data?.code || null,
            error: error?.message || data?.error || 'Unable to record verified login session.'
          };
        }

        return {
          success: true,
          loginAt: data?.login_at || devicePayload.client_timestamp,
          emailConfirmed: Boolean(data?.email_confirmed),
          hasTransactionPin: Boolean(data?.has_transaction_pin),
          device: devicePayload
        };
      } catch (err) {
        return { success: false, error: err.message || 'Login session audit error.' };
      }
    },

    // =========================================================================
    // RECIPIENT DIRECTORY (10-DIGIT NUBAN, @TAG, EMAIL, PHONE) & PIN SECURITY
    // =========================================================================

    /**
     * Search registered MidePay recipient by 10-digit NUBAN, @tag, email, or phone.
     * In production, strictly queries Supabase (`lookup_recipient_profile` joining `wallets.nuban -> profiles`).
     */
    async findRecipient(query, currentUserId = null) {
      if (!query || typeof query !== 'string') return null;
      const clean = query.trim().toLowerCase();
      if (!clean) return null;
      const cleanDigits = clean.replace(/[^0-9]/g, '');

      // 1. Live Supabase Lookup (joins wallets.nuban -> profiles via SECURITY DEFINER lookup_recipient_profile RPC)
      if (this.isConfigured() && this.client) {
        try {
          const { data: rpcRows, error: rpcErr } = await this.client.rpc('lookup_recipient_profile', {
            search_query: clean
          });
          if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length > 0) {
            const r = rpcRows[0];
            return {
              id: r.id,
              fullName: r.full_name,
              email: r.email,
              phone: r.phone || '',
              tag: r.tag || `@${(r.full_name || 'member').toLowerCase().replace(/[^a-z0-9]/g, '')}`,
              nuban: r.nuban || null,
              bankName: r.bank_name || 'MidePay / Providus Bank',
              isMidePayNuban: Boolean(cleanDigits.length === 10 && r.nuban === cleanDigits),
              avatarUrl: r.avatar_url,
              isFrozen: r.is_frozen === true,
              isRegistered: true,
              source: 'supabase_rpc'
            };
          }
        } catch (e) {
          console.warn('⚠️ [MidePay] Recipient lookup error:', e.message);
        }
      }

      // STRICT PRODUCTION GATE: Never return unverified localStorage or hardcoded demo recipients in production
      if (isProduction()) {
        return null;
      }

      // Development-only fallbacks (when ENV !== 'production')
      try {
        const localRegistry = JSON.parse(localStorage.getItem('midepay_accounts_registry') || '[]');
        const cleanPhone = clean.replace(/[\s\-]/g, '');
        const localMatch = localRegistry.find(r => {
          if (currentUserId && (r.id === currentUserId || r.email === currentUserId)) return false;
          if (cleanDigits.length === 10 && r.nuban && String(r.nuban).replace(/\s+/g, '') === cleanDigits) return true;
          if (clean.includes('@') && !clean.startsWith('@')) return r.email && r.email.toLowerCase() === clean;
          if (clean.startsWith('@')) return r.tag && r.tag.toLowerCase() === clean;
          if (cleanPhone.length >= 7) {
            const p = (r.phone || '').replace(/[\s\-]/g, '');
            return p.endsWith(cleanPhone.slice(-8)) || cleanPhone.endsWith(p.slice(-8));
          }
          return false;
        });
        if (localMatch) {
          return {
            id: localMatch.id,
            fullName: localMatch.fullName,
            email: localMatch.email,
            phone: localMatch.phone,
            tag: localMatch.tag,
            nuban: localMatch.nuban || null,
            bankName: localMatch.bank || 'MidePay / Providus Bank',
            isMidePayNuban: Boolean(cleanDigits.length === 10 && localMatch.nuban === cleanDigits),
            isRegistered: true,
            source: 'dev-registry'
          };
        }
      } catch (e) {}

      return null;
    },

    /**
     * Configure or rotate 4-digit transaction PIN strictly via `set_user_transaction_pin` RPC
     * (zero direct table `.update()` calls; server hashes with pgcrypto `gen_salt('bf', 10)`)
     */
    async setUserPin(userId, pinPlainOrHash, currentPin = null) {
      if (!userId || !/^\d{4}$/.test(String(pinPlainOrHash || ''))) {
        return { success: false, error: 'Transaction PIN must be exactly 4 numeric digits.' };
      }

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: rpcPin, error: rpcPinErr } = await this.client.rpc('set_user_transaction_pin', {
            p_new_pin: String(pinPlainOrHash),
            p_current_pin: currentPin || null
          });

          if (rpcPinErr) {
            return { success: false, error: rpcPinErr.message || 'Failed to save transaction PIN on server.' };
          }
          if (rpcPin && rpcPin.success === false) {
            return { success: false, error: rpcPin.error || 'Failed to configure Transaction PIN.' };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message || 'Network error saving transaction PIN.' };
        }
      }

      if (isProduction()) {
        return { success: false, error: 'Authenticated Supabase session required to configure PIN.' };
      }

      const bcrypt = getBcrypt();
      if (bcrypt && typeof bcrypt.hashSync === 'function') {
        const digest = bcrypt.hashSync(String(pinPlainOrHash), 10);
        localStorage.setItem(`midepay_pin_hash_${userId}`, digest);
        return { success: true, pinHash: digest };
      }
      return { success: false, error: 'PIN service unavailable.' };
    },

    async getUserPinHash() {
      return null;
    },

    /**
     * Server-backed verification of 4-digit transaction PIN (`verify_user_transaction_pin` RPC)
     * Never compares PINs in JavaScript in production.
     */
    async verifyTransactionPin(userId, rawPin) {
      if (!userId || !/^\d{4}$/.test(String(rawPin || ''))) {
        return { valid: false, error: 'Enter a valid 4-digit numeric security PIN.' };
      }

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: rpcVer, error: rpcVerErr } = await this.client.rpc('verify_user_transaction_pin', {
            p_pin: String(rawPin)
          });

          if (rpcVerErr) {
            return { valid: false, error: rpcVerErr.message || 'Unable to verify security PIN on server.' };
          }
          if (rpcVer && typeof rpcVer === 'object') {
            if (rpcVer.needs_pin_setup) {
              return { valid: false, needsPinSetup: true };
            }
            if (rpcVer.valid === true) {
              return { valid: true, error: null };
            }
            return {
              valid: false,
              isFrozen: Boolean(rpcVer.is_frozen),
              attemptsRemaining: rpcVer.attempts_remaining,
              error: rpcVer.error || 'Incorrect 4-digit transaction PIN.'
            };
          }
        } catch (err) {
          return { valid: false, error: err.message || 'PIN verification network error.' };
        }
      }

      if (isProduction()) {
        return { valid: false, error: 'Production PIN verification requires an active Supabase session.' };
      }

      const cached = localStorage.getItem(`midepay_pin_hash_${userId}`);
      if (!cached) return { valid: false, needsPinSetup: true };
      const bcrypt = getBcrypt();
      if (bcrypt && isBcryptHash(cached)) {
        const ok = bcrypt.compareSync(String(rawPin), cached);
        return { valid: ok, error: ok ? null : 'Incorrect 4-digit transaction PIN.' };
      }
      return { valid: false, error: 'Unable to verify PIN.' };
    },

    // =========================================================================
    // ATOMIC LEDGER & TRANSFER OPERATIONS
    // =========================================================================

    generateIdempotencyKey() {
      return generateIdempotencyKey();
    },

    /**
     * Execute Atomic P2P NUBAN Transfer via `execute_p2p_transfer` RPC
     * (server-side pgcrypto PIN check, 5-strike lockout, FOR UPDATE locking & UUID idempotency)
     */
    async executeP2PTransfer({ recipientNuban, amount, pin, idempotencyKey = null, narration = 'MidePay Transfer' }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('P2P transfers');
      const cleanRecipient = String(recipientNuban || '').trim();
      const amt = Math.round(Number(amount) * 100) / 100;
      const idemKey = isValidUuid(idempotencyKey) ? idempotencyKey : generateIdempotencyKey();

      if (!cleanRecipient) return { success: false, error: 'Recipient NUBAN or @tag is required.' };
      if (!Number.isFinite(amt) || amt <= 0) return { success: false, error: 'Transfer amount must be greater than zero.' };
      if (!/^\d{4}$/.test(String(pin || ''))) return { success: false, error: 'Valid 4-digit Transaction PIN is required.' };

      if (this.isConfigured() && this.client) {
        try {
          const { data, error } = await this.client.rpc('execute_p2p_transfer', {
            p_recipient_nuban: cleanRecipient,
            p_amount: amt,
            p_pin: String(pin),
            p_idempotency_key: idemKey,
            p_narration: narration || 'MidePay Transfer'
          });

          if (error) {
            return { success: false, error: error.message || 'P2P transfer rejected by server.' };
          }
          if (data && (data.success === false || (data.status && !['success', 'duplicate'].includes(data.status)))) {
            return { success: false, error: data.error || 'P2P transfer rejected by server.' };
          }
          return {
            success: true,
            status: data?.status || 'success',
            data,
            reference: data?.reference || `MDP-${String(100000000 + (csprngUint32() % 900000000))}`,
            newBalance: data?.new_balance !== undefined ? Number(data.new_balance) : undefined
          };
        } catch (err) {
          return { success: false, error: err.message || 'Transfer service connection failed.' };
        }
      }

      if (isProduction()) {
        return { success: false, error: 'Production P2P transfers require an active Supabase session.' };
      }

      const reference = 'MP-TRF-' + String(10000000 + (csprngUint32() % 90000000));
      return { success: true, isDemo: true, reference, data: { success: true, reference, amount: amt } };
    },

    /**
     * Execute Atomic Transfer Funds via Postgres SECURITY DEFINER RPC:
     * transfer_funds(sender_id, recipient_id, amount, narration, p_pin, p_idempotency_key)
     */
    async transferFunds({ senderId, recipientId, recipientNuban = null, amount, narration, pin = null, idempotencyKey = null }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('wallet transfers');
      if (!senderId) return { success: false, error: 'Sender ID is required' };
      if (!recipientId && !recipientNuban) return { success: false, error: 'Recipient ID or NUBAN is required' };
      if (recipientId && senderId === recipientId) return { success: false, error: 'Cannot transfer funds to yourself' };
      if (!amount || Number(amount) <= 0) return { success: false, error: 'Transfer amount must be greater than zero' };

      const idemKey = isValidUuid(idempotencyKey) ? idempotencyKey : generateIdempotencyKey();

      if (this.isConfigured() && this.client && isValidUuid(senderId) && (isValidUuid(recipientId) || recipientNuban)) {
        if (recipientNuban && /^\d{4}$/.test(String(pin || ''))) {
          return this.executeP2PTransfer({
            recipientNuban,
            amount,
            pin,
            idempotencyKey: idemKey,
            narration
          });
        }

        const freezeCheck = await this.getAccountFreezeStatus(senderId);
        if (freezeCheck.isFrozen) {
          return {
            success: false,
            error: 'Account is frozen per CBN AML/Fraud compliance. Outbound transfers are blocked.'
          };
        }

        try {
          const rpcPayload = {
            sender_id: senderId,
            recipient_id: recipientId,
            amount: Number(amount),
            narration: narration || 'Transfer via MidePay',
            p_pin: pin || null,
            p_idempotency_key: idemKey
          };

          const { data, error } = await this.client.rpc('transfer_funds', rpcPayload);

          if (error) {
            const msg = error.message || error.details || 'Transfer failed on server';
            return { success: false, error: msg };
          }
          if (data && data.success === false) {
            return { success: false, error: data.error || 'Transfer rejected by server.' };
          }

          return {
            success: true,
            data: data,
            reference: data?.reference || `MP-TRF-${Date.now()}`
          };
        } catch (err) {
          return { success: false, error: err.message || 'Transfer service connection failed' };
        }
      }

      if (isProduction()) {
        return {
          success: false,
          error: 'Production transfers require verified MidePay UUID accounts and active Supabase connection.'
        };
      }

      const reference = 'MP-TRF-' + Date.now().toString().slice(-8);
      return {
        success: true,
        isDemo: true,
        reference,
        data: { success: true, reference, amount: Number(amount) }
      };
    },

    async getTransactions(userId, limit = 20) {
      if (!this.isConfigured() || !this.client || !isValidUuid(userId)) return [];

      const { data, error } = await this.client
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.warn('[MidePay] Error fetching transactions:', error.message);
        return [];
      }
      return data || [];
    },

    /**
     * Execute External Bank NIP Outflow Transfer strictly via `execute_external_bank_transfer` RPC
     * (zero client-side balance math or direct table writes)
     */
    async recordTransfer({ userId, amount, recipient, accountNumber = null, destinationBank, narration, fee = 0.00, reference = null, pin = null, idempotencyKey = null }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('external bank transfers');
      if (!this.isConfigured() || !this.client) {
        if (isProduction()) {
          return { success: false, error: 'Ledger service unavailable in production.' };
        }
        return { success: true, isDemo: true };
      }

      if (!isValidUuid(userId)) {
        return { success: false, error: 'Valid authenticated user UUID is required.' };
      }

      const txRef = reference || ('MDP-' + String(100000000 + (csprngUint32() % 900000000)));
      const idemKey = isValidUuid(idempotencyKey) ? idempotencyKey : generateIdempotencyKey();

      const { data: rpcRes, error: rpcErr } = await this.client.rpc('execute_external_bank_transfer', {
        p_amount: Number(amount),
        p_fee: Number(fee || 0),
        p_recipient_name: recipient,
        p_destination_bank: destinationBank,
        p_account_number: accountNumber,
        p_narration: narration || 'Transfer via MidePay',
        p_reference: txRef,
        p_pin: pin || null,
        p_idempotency_key: idemKey
      });

      if (rpcErr) {
        return { success: false, error: rpcErr.message || 'Outbound bank transfer rejected by server.' };
      }
      if (!rpcRes || rpcRes.success === false) {
        return { success: false, error: rpcRes?.error || 'Outbound bank transfer rejected by server.' };
      }

      return {
        success: true,
        transaction: rpcRes.transaction || null,
        reference: rpcRes.reference || txRef,
        newBalance: Number(rpcRes.new_balance)
      };
    },

    /**
     * Initialize Live Paystack or Flutterwave Deposit Session via `init-payment` Edge Function
     */
    async verifyGatewayDeposit(reference = null) {
      if (SUPABASE_URL !== 'https://ajbhsmcosxgymrtawlmd.supabase.co' || window.MIDEPAY_SUPABASE_CONFIG?.TEST_PAYSTACK_CHECKOUT !== true) return buildQuarantineResult('deposit verification');
      if (!this.isConfigured() || !this.client) return { success: false, error: 'Sign in before checking a deposit.' };
      try {
        const body = { action: 'verify_payment' };
        if (reference) body.reference = reference;
        const { data, error } = await this.client.functions.invoke('init-payment', { body });
        if (error) {
          let code = '';
          try { code = (await error.context?.json())?.code || ''; } catch (_) {}
          const messages = {
            DEPOSIT_NOT_FOUND: 'No Paystack deposit was found for your account.',
            EMAIL_NOT_VERIFIED: 'Verify your email before checking a deposit.',
            TEST_RECONCILIATION_UNAVAILABLE: 'The staging Paystack test key needs configuration.',
            PROVIDER_PAYMENT_MISMATCH: 'Paystack payment details do not match this deposit.'
          };
          return { success: false, error: messages[code] || 'Payment status could not be confirmed. Check this payment again shortly; do not start another payment yet.' };
        }
        return data || { success: false, error: 'Payment verification returned no result.' };
      } catch (_) { return { success: false, error: 'Connection lost while checking payment. Its outcome is still unknown. Check this payment again before paying again.' }; }
    },

    async initializeGatewayDeposit({ provider = 'paystack', amount, callbackUrl = null }) {
      const cleanProvider = String(provider || 'paystack').trim().toLowerCase();
      const testCheckout = window.MIDEPAY_SUPABASE_CONFIG?.TEST_PAYSTACK_CHECKOUT === true &&
        SUPABASE_URL === 'https://ajbhsmcosxgymrtawlmd.supabase.co' && cleanProvider === 'paystack';
      if (isFinancialQuarantined() && !testCheckout) return buildQuarantineResult('gateway deposits');
      if (cleanProvider !== 'paystack' && cleanProvider !== 'flutterwave') {
        return { success: false, error: "Unsupported payment gateway. Choose 'paystack' or 'flutterwave'." };
      }

      const scaledAmount = typeof amount === 'number' ? amount * 100 : NaN;
      if (!Number.isSafeInteger(Math.round(scaledAmount)) || Math.abs(scaledAmount - Math.round(scaledAmount)) > 0.0000001) {
        return { success: false, error: 'Enter a numeric amount with at most two decimal places.' };
      }
      const amountNgn = Math.round(scaledAmount) / 100;
      if (!Number.isFinite(amountNgn) || amountNgn < 100 || amountNgn > 5000000) {
        return { success: false, error: 'Deposit amount must be between ₦100.00 and ₦5,000,000.00.' };
      }

      if (!this.isConfigured() || !this.client) {
        if (isProduction()) {
          return { success: false, error: 'Supabase production gateway is not configured.' };
        }
        return {
          success: true,
          isDemo: true,
          provider: cleanProvider,
          reference: `MDP-${cleanProvider === 'paystack' ? 'PSK' : 'FLW'}-DEMO-${Date.now()}`
        };
      }

      try {
        const { data: sessionData } = await this.client.auth.getSession();
        if (!sessionData?.session?.access_token) {
          return {
            success: false,
            error: 'Please sign in to your MidePay account to launch live gateway funding.'
          };
        }

        const resolvedCallback =
          callbackUrl ||
          (typeof window !== 'undefined' && window.location
            ? `${window.location.origin}${window.location.pathname}`
            : 'https://midepay.vercel.app');

        const { data, error } = await this.client.functions.invoke('init-payment', {
          body: {
            provider: cleanProvider,
            amount_ngn: amountNgn,
            callback_url: resolvedCallback
          }
        });

        if (error) {
          return { success: false, error: error.message || 'Failed to initialize gateway checkout.' };
        }

        if (!data || !data.authorization_url) {
          return { success: false, error: data?.error || 'Gateway did not return an authorization URL.' };
        }
        const checkout = new URL(data.authorization_url);
        if (cleanProvider === 'paystack' && (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.paystack.com' || checkout.username || checkout.password)) {
          return { success: false, error: 'Checkout returned an untrusted payment address.' };
        }
        if (testCheckout && data.mode !== 'test') return { success: false, error: 'Staging requires a Paystack test checkout.' };

        return {
          success: true,
          authorizationUrl: data.authorization_url,
          reference: data.reference,
          provider: data.provider || cleanProvider,
          mode: data.mode,
          amountNgn: data.amount_ngn || amountNgn
        };
      } catch (err) {
        return { success: false, error: err.message || 'Network error contacting payment gateway.' };
      }
    },

    /**
     * Resolve 10-digit Nigerian NUBAN via `bank-payout` Edge Function (Paystack / Flutterwave NIP)
     */
    async resolveBankAccount({ provider = 'paystack', accountNumber, bankCode }) {
      if (!this.isConfigured() || !this.client) {
        return { success: false, error: 'Supabase backend connection is required.' };
      }
      try {
        const { data, error } = await this.client.functions.invoke('bank-payout', {
          body: {
            action: 'resolve_account',
            provider,
            account_number: String(accountNumber || '').trim(),
            bank_code: String(bankCode || '').trim()
          }
        });
        if (error || !data?.success) {
          return { success: false, error: data?.error || error?.message || 'Unable to resolve bank account.' };
        }
        return {
          success: true,
          accountName: data.account_name,
          accountNumber: data.account_number,
          bankCode: data.bank_code
        };
      } catch (err) {
        return { success: false, error: err.message || 'NIP resolution request failed.' };
      }
    },

    /**
     * Initiate PIN-Authenticated Outbound NIP Bank Payout via `bank-payout` Edge Function
     */
    async initiateBankPayout({ provider = 'paystack', accountNumber, bankCode, accountName, amount, pin, narration, idempotencyKey }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('outbound bank payouts');
      if (!this.isConfigured() || !this.client) {
        return { success: false, error: 'Supabase backend connection is required.' };
      }
      if (!isValidUuid(idempotencyKey)) return { success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', error: 'A stable UUID idempotency key is required.' };
      try {
        const { data, error } = await this.client.functions.invoke('bank-payout', {
          body: {
            action: 'initiate_payout',
            idempotency_key: idempotencyKey,
            provider,
            account_number: String(accountNumber || '').trim(),
            bank_code: String(bankCode || '').trim(),
            account_name: accountName,
            amount_ngn: Number(amount),
            pin: String(pin || '').trim(),
            narration: narration || 'Transfer via MidePay'
          }
        });
        if (error || !data?.success) {
          return { success: false, error: data?.error || error?.message || 'Bank payout failed.' };
        }
        return {
          success: true,
          reference: data.reference,
          gatewayReference: data.gateway_reference,
          beneficiaryName: data.beneficiary_name,
          newBalance: data.new_balance
        };
      } catch (err) {
        return { success: false, error: err.message || 'Outbound bank payout network error.' };
      }
    },

    /**
     * Record Instant Direct Wallet Top-Up strictly via `concept_topup_wallet` RPC
     * (zero client-side balance math or direct table writes)
     */
    async recordDeposit({ userId, amount, idempotencyKey = null }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('wallet top-ups');
      const depositAmount = Number(amount);
      if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
        return { success: false, error: 'Deposit amount must be greater than zero.' };
      }

      const reference = 'DEP-' + Date.now() + '-' + String(1000 + (csprngUint32() % 9000));
      const idemKey = isValidUuid(idempotencyKey) ? idempotencyKey : generateIdempotencyKey();

      if (!this.isConfigured() || !this.client || !userId || !isValidUuid(userId)) {
        if (isProduction()) {
          return { success: false, error: 'Authenticated Supabase session required to fund wallet.' };
        }
        return { success: true, isSandbox: true, reference };
      }

      try {
        const { data: authData } = await this.client.auth.getUser();
        if (!authData?.user || authData.user.id !== userId) {
          if (isProduction()) {
            return { success: false, error: 'Authenticated Supabase session required to fund wallet.' };
          }
          return { success: true, isSandbox: true, reference };
        }

        const { data: rpcTopup, error: rpcTopupErr } = await this.client.rpc('concept_topup_wallet', {
          p_amount: depositAmount,
          p_reference: reference,
          p_idempotency_key: idemKey
        });

        if (rpcTopupErr) {
          return { success: false, error: rpcTopupErr.message || 'Wallet top-up rejected by server.' };
        }
        if (!rpcTopup || rpcTopup.success === false) {
          return { success: false, error: rpcTopup?.error || 'Wallet top-up rejected by server.' };
        }

        return {
          success: true,
          wallet: rpcTopup.wallet || null,
          transaction: rpcTopup.transaction || null,
          newBalance: Number(rpcTopup.new_balance ?? rpcTopup.wallet?.balance),
          reference: rpcTopup.reference || reference
        };
      } catch (err) {
        return { success: false, error: err.message || 'Direct top-up network error.' };
      }
    },

    // =========================================================================
    // EXECUTIVE BACK-OFFICE ATOMIC RPCs (ROLE = 'executive' ENFORCED)
    // =========================================================================

    /**
     * Executive RPC: admin_credit_wallet(target_user_id, amount, reason)
     */
    async adminCreditWallet() {
      return { success: false, code: 'TREASURY_APPROVAL_REQUIRED', error: 'Use a funded treasury request and independent approval.' };
    },

    async enrollPaymentReviewMfa() {
      if(!this.client?.auth?.mfa)return {error:'MFA is unavailable.'};
      const {data,error}=await this.client.auth.mfa.enroll({factorType:'totp',friendlyName:'MidePay operations '+Date.now()});
      return error?{error:error.message}:{factorId:data.id,qrCode:data.totp.qr_code};
    },

    async getPaymentReview(filter='attention', cursor=null) {
      if(!this.isConfigured()||!this.client)return {success:false,code:'UNAVAILABLE'};
      const {data,error}=await this.client.rpc('get_operator_payment_review',{p_filter:filter,p_before:cursor?.before||null,p_before_id:cursor?.id||null});
      return error?{success:false,code:'UNAVAILABLE'}:(data||{success:false,code:'UNAVAILABLE'});
    },

    async treasuryRpc(name, args = {}) {
      if (!this.isConfigured() || !this.client) return { success: false, error: 'Authenticated backend required.' };
      const { data, error } = await this.client.rpc(name, args);
      return error ? { success: false, error: error.message } : (data || { success: false, error: 'Empty treasury response.' });
    },

    async enrollTreasuryMfa() {
      if (!this.client?.auth?.mfa) return { error: 'MFA is unavailable.' };
      const { data, error } = await this.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'MidePay treasury' });
      return error ? { error: error.message } : { factorId: data.id, qrCode: data.totp.qr_code };
    },

    async verifyTreasuryMfa(code, factorId = null) {
      if (!this.client?.auth?.mfa || !/^\d{6}$/.test(code)) return { success: false, error: 'Enter a six-digit authenticator code.' };
      if (!factorId) {
        const { data, error } = await this.client.auth.mfa.listFactors();
        if (error) return { success: false, error: error.message };
        factorId = data?.totp?.find(f => f.status === 'verified')?.id;
      }
      if (!factorId) return { success: false, error: 'Set up an authenticator first.' };
      const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId, code });
      return { success: !error, error: error?.message };
    },

    /**
     * Executive RPC: admin_set_account_freeze(target_user_id, freeze_state, reason)
     */
    async adminSetAccountFreeze({ targetUserId, freezeState, reason = 'CBN AML Compliance Action' }) {
      if (!this.isConfigured() || !this.client) {
        return { success: false, error: 'Supabase backend connection is required.' };
      }
      if (!isValidUuid(targetUserId)) {
        return { success: false, error: 'Valid target user UUID is required.' };
      }

      const isExec = await this.isUserExecutive();
      if (!isExec) {
        return { success: false, error: 'Access Denied: Verified executive role required.' };
      }

      const { data, error } = await this.client.rpc('admin_set_account_freeze', {
        target_user_id: targetUserId,
        freeze_state: Boolean(freezeState),
        reason: String(reason || 'CBN AML Compliance Action').trim()
      });

      if (error) {
        return { success: false, error: error.message || 'admin_set_account_freeze RPC failed.' };
      }
      return { success: true, data };
    },

    async getAuditLogs(limit = 50) {
      if (!this.isConfigured() || !this.client) return [];
      const isExec = await this.isUserExecutive();
      if (!isExec) return [];

      const { data, error } = await this.client
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) return [];
      return data || [];
    },

    // =========================================================================
    // WAITLIST, BUSINESS SUITE & PAYMENT REQUESTS
    // =========================================================================

    async joinWaitlist(email) {
      if (!this.isConfigured() || !this.client) {
        if (isProduction()) {
          return { success: false, error: 'Waitlist service unavailable.' };
        }
        return { success: true, isDemo: true };
      }

      const { data, error } = await this.client.rpc('join_waitlist', {
        p_email: String(email || '').trim().toLowerCase(),
        p_source: 'landing_page'
      });

      if (error || data?.success === false) {
        return { success: false, error: error?.message || data?.error || 'Unable to join waitlist.' };
      }
      return { success: true, data };
    },

    async getUserBusinesses() {
      if (!this.isConfigured() || !this.client) return [];

      const { data, error } = await this.client
        .from('businesses')
        .select(`
          id,
          business_name,
          rc_number,
          category,
          business_members!inner(role)
        `);

      if (error) {
        console.warn('[MidePay] Error fetching businesses:', error.message);
        return [];
      }
      return data || [];
    },

    async getBusinessSubAccounts(businessId) {
      if (!this.isConfigured() || !this.client || !isValidUuid(businessId)) return [];

      const { data, error } = await this.client
        .from('business_sub_accounts')
        .select('*')
        .eq('business_id', businessId);

      if (error) {
        console.warn('[MidePay] Error fetching sub accounts:', error.message);
        return [];
      }
      return data || [];
    },

    async getBusinessInvoices(businessId) {
      if (!this.isConfigured() || !this.client || !isValidUuid(businessId)) return [];

      const { data, error } = await this.client
        .from('invoices')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('[MidePay] Error fetching invoices:', error.message);
        return [];
      }
      return data || [];
    },

    _saveLocalPaymentRequest(request) {
      if (isProduction()) return;
      try {
        const stored = JSON.parse(localStorage.getItem('midepay_payment_requests') || '[]');
        const idx = stored.findIndex(r => r.id === request.id);
        if (idx >= 0) stored[idx] = { ...stored[idx], ...request };
        else stored.unshift(request);
        localStorage.setItem('midepay_payment_requests', JSON.stringify(stored));
      } catch (e) {}
    },

    async createPaymentRequest({ requesterId, payerId, amount, note = '', requesterDetails = null, payerDetails = null }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('payment requests');
      if (!requesterId || !payerId) return { success: false, error: 'Requester and Payer are required' };
      if (requesterId === payerId) return { success: false, error: 'Cannot request money from yourself' };
      if (!amount || Number(amount) <= 0) return { success: false, error: 'Request amount must be greater than zero' };

      const numAmount = Number(amount);

      if (this.isConfigured() && this.client && isValidUuid(requesterId) && isValidUuid(payerId)) {
        const freezeCheck = await this.getAccountFreezeStatus(requesterId);
        if (freezeCheck.isFrozen) {
          return { success: false, error: 'Account is frozen. Payment requests are temporarily disabled.' };
        }

        try {
          const idemKey = generateIdempotencyKey();
          const { data: rpcRes, error } = await this.client.rpc('create_payment_request', {
            p_payer_id: payerId,
            p_amount: numAmount,
            p_note: note || '',
            p_idempotency_key: idemKey
          });

          if (!error && rpcRes?.success && rpcRes.request) {
            const merged = { ...rpcRes.request, requester: requesterDetails, payer: payerDetails };
            this._saveLocalPaymentRequest(merged);
            return { success: true, data: merged };
          }
          if (error || rpcRes?.success === false) {
            return { success: false, error: error?.message || rpcRes?.error || 'Unable to create payment request.' };
          }
        } catch (err) {
          if (isProduction()) {
            return { success: false, error: err.message || 'Network error creating payment request.' };
          }
        }
      }

      if (isProduction()) {
        return { success: false, error: 'Production payment requests require registered MidePay member accounts.' };
      }

      const newRequest = {
        id: 'req-' + Date.now() + '-' + String(csprngUint32() % 1000),
        requester_id: requesterId,
        payer_id: payerId,
        amount: numAmount,
        note: note || '',
        status: 'pending',
        requester: requesterDetails,
        payer: payerDetails,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this._saveLocalPaymentRequest(newRequest);
      return { success: true, data: newRequest, isLocal: true };
    },

    // =========================================================================
    // PERSISTENT PER-USER VIRTUAL DEBIT CARDS (`public.virtual_cards`)
    // =========================================================================

    _readLocalVirtualCards(userId) {
      if (!userId) return [];
      try {
        const raw = localStorage.getItem(`midepay_vcards_${userId}`);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    },

    _writeLocalVirtualCards(userId, cards) {
      if (!userId) return;
      try {
        localStorage.setItem(`midepay_vcards_${userId}`, JSON.stringify(cards));
      } catch (e) {}
    },

    async getVirtualCards(userId) {
      if (!userId) return [];

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const { data, error } = await this.client
              .from('virtual_cards')
              .select('id, user_id, wallet_id, card_type, currency, card_holder_name, masked_pan, card_label, expiry_month, expiry_year, card_balance, spending_limit_monthly, is_frozen, is_active, created_at, updated_at')
              .eq('user_id', userId)
              .order('created_at', { ascending: false });

            if (!error && Array.isArray(data)) {
              return data.filter(c => c.is_active !== false);
            }
          }
        } catch (err) {
          console.warn('[MidePay] getVirtualCards sync notice:', err.message);
        }
      }

      if (isProduction()) return [];
      return this._readLocalVirtualCards(userId).filter(c => c.is_active !== false);
    },

    async createVirtualCard({
      userId,
      walletId = null,
      currency = 'USD',
      cardType = null,
      cardLabel = null,
      cardHolderName = 'MIDEPAY MEMBER',
      spendingLimit = null,
      initialBalance = 0.00
    }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('virtual card issuance');
      if (!userId) {
        return { success: false, error: 'User ID is required to issue a virtual debit card.' };
      }

      const normCurrency = String(currency || 'USD').toUpperCase() === 'NGN' ? 'NGN' : 'USD';
      const normType = cardType || (normCurrency === 'USD' ? 'Mastercard' : 'Verve');
      const normLabel = cardLabel || (normCurrency === 'USD' ? 'MidePay Black' : 'MidePay Green');
      const defaultLimit = spendingLimit !== null && spendingLimit !== undefined
        ? Math.max(0, Number(spendingLimit) || 0)
        : (normCurrency === 'USD' ? 1000.00 : 500000.00);

      const creds = generateSecureCardCredentials({ cardHolderName, prefix: '5399' });

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const { data: issuedCard, error: issueErr } = await this.client.rpc('issue_virtual_card', {
              p_currency: normCurrency,
              p_card_type: normType,
              p_card_label: normLabel,
              p_card_holder_name: creds.cardHolderName,
              p_spending_limit: defaultLimit
            });

            if (issueErr || !issuedCard) {
              return { success: false, error: issueErr?.message || 'Unable to issue virtual card on server.' };
            }

            return { success: true, card: issuedCard };
          }
        } catch (err) {
          return { success: false, error: err.message || 'Unable to issue virtual card on server.' };
        }
      }

      if (isProduction()) {
        return { success: false, error: 'Authenticated Supabase session required to issue virtual debit cards.' };
      }

      // Per-user isolated local card store when running without an authenticated Supabase JWT (e.g. local preview)
      const localCard = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `vc-${Date.now()}`,
        user_id: userId,
        wallet_id: walletId || null,
        card_type: normType,
        currency: normCurrency,
        card_label: normLabel,
        card_holder_name: creds.cardHolderName,
        card_number: creds.cardNumber,
        masked_pan: creds.maskedPan,
        cvv: creds.cvv,
        expiry_month: creds.expiryMonth,
        expiry_year: creds.expiryYear,
        card_balance: Math.max(0, Number(initialBalance) || 0),
        spending_limit_monthly: defaultLimit,
        is_frozen: false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const existing = this._readLocalVirtualCards(userId);
      existing.unshift(localCard);
      this._writeLocalVirtualCards(userId, existing);
      return { success: true, card: localCard, isSandbox: true };
    },

    async ensureUserVirtualCards({ userId, walletId = null, cardHolderName = 'MIDEPAY MEMBER' }) {
      if (!userId) return [];
      let cards = await this.getVirtualCards(userId);
      if (isFinancialQuarantined()) {
        return cards;
      }

      const hasUsd = cards.some(c => String(c.currency).toUpperCase() === 'USD');
      const hasNgn = cards.some(c => String(c.currency).toUpperCase() === 'NGN');

      if (!hasNgn) {
        const createdNgn = await this.createVirtualCard({
          userId,
          walletId,
          currency: 'NGN',
          cardType: 'Verve',
          cardLabel: 'MidePay Green',
          cardHolderName,
          spendingLimit: 500000.00,
          initialBalance: 0.00
        });
        if (createdNgn.success && createdNgn.card) cards.push(createdNgn.card);
      }

      if (!hasUsd) {
        const createdUsd = await this.createVirtualCard({
          userId,
          walletId,
          currency: 'USD',
          cardType: 'Mastercard',
          cardLabel: 'MidePay Black',
          cardHolderName,
          spendingLimit: 1000.00,
          initialBalance: 0.00
        });
        if (createdUsd.success && createdUsd.card) cards.unshift(createdUsd.card);
      }

      return cards;
    },

    async updateVirtualCardFreeze({ cardId, userId, isFrozen }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('virtual card mutations');
      if (!cardId || !userId) {
        return { success: false, error: 'Card ID and User ID are required.' };
      }

      if (this.isConfigured() && this.client && isValidUuid(cardId) && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const { data: rpcCard, error: rpcErr } = await this.client.rpc('set_virtual_card_freeze', {
              p_card_id: cardId,
              p_is_frozen: Boolean(isFrozen)
            });

            if (rpcErr || !rpcCard) {
              return { success: false, error: rpcErr?.message || 'Unable to update virtual card freeze state.' };
            }

            return { success: true, card: rpcCard };
          }
        } catch (err) {
          return { success: false, error: err.message || 'Unable to update virtual card freeze state.' };
        }
      }

      if (isProduction()) {
        return { success: false, error: 'Authenticated Supabase session required to freeze or unfreeze cards.' };
      }

      const localCards = this._readLocalVirtualCards(userId);
      const target = localCards.find(c => c.id === cardId);
      if (target) {
        target.is_frozen = Boolean(isFrozen);
        target.updated_at = new Date().toISOString();
        this._writeLocalVirtualCards(userId, localCards);
        return { success: true, card: target, isSandbox: true };
      }
      return { success: true, isSandbox: true };
    },

    async updateVirtualCardLimit({ cardId, userId, spendingLimit }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('virtual card limit changes');
      const numLimit = Number(spendingLimit);
      if (!cardId || !userId || !Number.isFinite(numLimit) || numLimit < 0) {
        return { success: false, error: 'Enter a valid monthly spending limit.' };
      }

      if (this.isConfigured() && this.client && isValidUuid(cardId) && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const { data: rpcCard, error: rpcErr } = await this.client.rpc('set_virtual_card_limit', {
              p_card_id: cardId,
              p_spending_limit: numLimit
            });

            if (rpcErr || !rpcCard) {
              return { success: false, error: rpcErr?.message || 'Unable to update monthly spending limit.' };
            }

            return { success: true, card: rpcCard };
          }
        } catch (err) {
          return { success: false, error: err.message || 'Unable to update monthly spending limit.' };
        }
      }

      if (isProduction()) {
        return { success: false, error: 'Authenticated Supabase session required to update card spending limits.' };
      }

      const localCards = this._readLocalVirtualCards(userId);
      const target = localCards.find(c => c.id === cardId);
      if (target) {
        target.spending_limit_monthly = numLimit;
        target.updated_at = new Date().toISOString();
        this._writeLocalVirtualCards(userId, localCards);
        return { success: true, card: target, isSandbox: true };
      }
      return { success: true, isSandbox: true };
    },

    async logVirtualCardReveal({ cardId, field = 'PAN' }) {
      if (!cardId || !this.isConfigured() || !this.client || !isValidUuid(cardId)) {
        return { success: true, isSandbox: true };
      }
      try {
        await this.client.rpc('log_virtual_card_reveal', {
          p_card_id: cardId,
          p_field: String(field || 'PAN').toUpperCase()
        });
      } catch (_) {}
      return { success: true };
    },

    async updateVirtualCardBalance({ cardId, userId, fundIncrement = null, pin = null, idempotencyKey = null }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('virtual card funding');
      const creditAmt = Math.round(Number(fundIncrement) * 100) / 100;
      if (!cardId || !userId || !Number.isFinite(creditAmt) || creditAmt <= 0) {
        return { success: false, error: 'Valid card ID, user ID, and positive funding amount are required.' };
      }

      if (this.isConfigured() && this.client && isValidUuid(cardId) && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const { data: rpcFund, error: rpcFundErr } = await this.client.rpc('fund_virtual_card', {
              p_card_id: cardId,
              p_amount_card_currency: creditAmt,
              p_pin: pin || null,
              p_idempotency_key: isValidUuid(idempotencyKey) ? idempotencyKey : generateIdempotencyKey()
            });

            if (rpcFundErr) {
              return { success: false, error: rpcFundErr.message || 'Card funding rejected by server.' };
            }
            if (!rpcFund || rpcFund.success === false) {
              return { success: false, error: rpcFund?.error || 'Card funding rejected by server.' };
            }

            return {
              success: true,
              card: rpcFund.card || null,
              transaction: rpcFund.transaction || null,
              newCardBalance: Number(rpcFund.new_card_balance ?? rpcFund.card?.card_balance),
              newWalletBalance: Number(rpcFund.new_wallet_balance)
            };
          }
        } catch (err) {
          return { success: false, error: err.message || 'Card funding network error.' };
        }
      }

      if (isProduction()) {
        return { success: false, error: 'Authenticated Supabase session required to fund virtual cards.' };
      }

      const localCards = this._readLocalVirtualCards(userId);
      const target = localCards.find(c => c.id === cardId);
      if (target) {
        target.card_balance = Math.round((Number(target.card_balance || 0) + creditAmt) * 100) / 100;
        target.updated_at = new Date().toISOString();
        this._writeLocalVirtualCards(userId, localCards);
        return { success: true, card: target, newCardBalance: target.card_balance, isSandbox: true };
      }
      return { success: false, error: 'Virtual card not found.' };
    },

    async getPaymentRequests(userId) {
      if (!userId) return [];
      let requests = [];

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data, error } = await this.client
            .from('payment_requests')
            .select(`
              *,
              requester:profiles!requester_id(id, full_name, email, phone, tag),
              payer:profiles!payer_id(id, full_name, email, phone, tag)
            `)
            .or(`requester_id.eq.${userId},payer_id.eq.${userId}`)
            .order('created_at', { ascending: false });

          if (!error && data) {
            requests = data;
          }
        } catch (e) {
          console.warn('⚠️ [MidePay] getPaymentRequests error:', e.message);
        }
      }

      if (!isProduction()) {
        try {
          const local = JSON.parse(localStorage.getItem('midepay_payment_requests') || '[]');
          const userLocal = local.filter(r => r.requester_id === userId || r.payer_id === userId);
          userLocal.forEach(locReq => {
            if (!requests.some(r => r.id === locReq.id)) {
              requests.push(locReq);
            }
          });
        } catch (e) {}
      }

      requests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return requests;
    },

    async updatePaymentRequestStatus(requestId, status, txReference = null) {
      if (isFinancialQuarantined()) return buildQuarantineResult('payment request settlements');
      if (!requestId || !status) return { success: false, error: 'Request ID and status required' };

      if (this.isConfigured() && this.client && isValidUuid(requestId)) {
        try {
          const { data: rpcRes, error } = await this.client.rpc('respond_payment_request', {
            p_request_id: requestId,
            p_status: String(status).toLowerCase(),
            p_tx_reference: txReference && typeof txReference === 'string' ? txReference.trim() : null
          });

          if (error || rpcRes?.success === false) {
            return { success: false, error: error?.message || rpcRes?.error || 'Unable to update payment request.' };
          }
          return { success: true, status: rpcRes?.status || status };
        } catch (e) {
          return { success: false, error: e.message || 'Payment request update error.' };
        }
      } else if (isProduction()) {
        return { success: false, error: 'Payment request service unavailable.' };
      }

      if (!isProduction()) {
        try {
          const stored = JSON.parse(localStorage.getItem('midepay_payment_requests') || '[]');
          const target = stored.find(r => r.id === requestId);
          if (target) {
            target.status = status;
            target.updated_at = new Date().toISOString();
            localStorage.setItem('midepay_payment_requests', JSON.stringify(stored));
          }
        } catch (e) {}
      }

      return { success: true, status };
    },

    // =========================================================================
    // MIDESAVE GOAL-BASED SAVINGS VAULTS (`public.savings_vaults`)
    // =========================================================================

    _readLocalVaults(userId) {
      if (!userId) return [];
      try {
        const raw = localStorage.getItem(`midepay_savings_vaults_${userId}`);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    },

    _writeLocalVaults(userId, vaults) {
      if (!userId) return;
      try {
        localStorage.setItem(`midepay_savings_vaults_${userId}`, JSON.stringify(vaults));
      } catch (e) {}
    },

    async getSavingsVaults(userId) {
      if (!userId) return [];

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const { data, error } = await this.client
              .from('savings_vaults')
              .select('*')
              .eq('user_id', userId)
              .order('created_at', { ascending: false });

            if (!error && Array.isArray(data)) {
              return data;
            }
          }
        } catch (err) {
          console.warn('[MidePay] getSavingsVaults notice:', err.message);
        }
      }

      if (isProduction()) return [];
      return this._readLocalVaults(userId);
    },

    async createSavingsVault({ userId, title, category = 'General', targetAmount, lockUntil = null, interestRatePa = 14.50 }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('MideSave vault creation');
      const cleanTitle = String(title || '').trim();
      const targetNum = Math.round(Number(targetAmount) * 100) / 100;
      if (!userId) return { success: false, error: 'User ID is required.' };
      if (cleanTitle.length < 2) return { success: false, error: 'Enter a vault goal title (at least 2 characters).' };
      if (!Number.isFinite(targetNum) || targetNum <= 0) {
        return { success: false, error: 'Target savings amount must be greater than ₦0.00.' };
      }

      const normLockUntil = lockUntil ? new Date(lockUntil).toISOString() : null;
      const rate = Number(interestRatePa) || 14.50;

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const { data: rpcRes, error: rpcErr } = await this.client.rpc('manage_midesave_vault', {
              p_action: 'create',
              p_title: cleanTitle,
              p_category: String(category || 'General').trim(),
              p_target_amount: targetNum,
              p_lock_until: normLockUntil,
              p_interest_rate_pa: rate
            });

            if (rpcErr || !rpcRes || rpcRes.success === false) {
              return { success: false, error: rpcErr?.message || rpcRes?.error || 'Unable to create savings vault on server.' };
            }

            return { success: true, vault: rpcRes.vault || rpcRes };
          }
        } catch (err) {
          return { success: false, error: err.message || 'Unable to create savings vault on server.' };
        }
      }

      if (isProduction()) {
        return { success: false, error: 'Authenticated Supabase session required to create MideSave vaults.' };
      }

      const localVault = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `vlt-${Date.now()}`,
        user_id: userId,
        title: cleanTitle,
        category: String(category || 'General').trim(),
        target_amount: targetNum,
        current_balance: 0.00,
        interest_rate_pa: rate,
        lock_until: normLockUntil,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const existing = this._readLocalVaults(userId);
      existing.unshift(localVault);
      this._writeLocalVaults(userId, existing);
      return { success: true, vault: localVault, isSandbox: true };
    },

    async fundSavingsVault(vaultId, amount, userId = null, options = {}) {
      if (isFinancialQuarantined()) return buildQuarantineResult('MideSave deposits');
      const amt = Math.round(Number(amount) * 100) / 100;
      if (!vaultId || !Number.isFinite(amt) || amt <= 0) {
        return { success: false, error: 'Valid vault ID and positive deposit amount are required.' };
      }

      if (this.isConfigured() && this.client && isValidUuid(vaultId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user) {
            const idemKey = isValidUuid(options?.idempotencyKey) ? options.idempotencyKey : generateIdempotencyKey();
            const { data, error } = await this.client.rpc('manage_midesave_vault', {
              p_action: 'fund',
              p_vault_id: vaultId,
              p_amount: amt,
              p_pin: options?.pin || null,
              p_idempotency_key: idemKey
            });
            if (error) {
              return { success: false, error: error.message || 'Failed to fund savings vault.' };
            }
            if (data && data.success === false) {
              return { success: false, error: data.error || 'Failed to fund savings vault.' };
            }
            if (data) {
              return {
                success: true,
                vaultId: data.vault_id,
                vaultTitle: data.vault_title,
                vaultBalance: Number(data.vault_balance),
                newBalance: Number(data.new_balance),
                reference: data.reference
              };
            }
          }
        } catch (err) {
          return { success: false, error: err.message || 'Failed to fund savings vault.' };
        }
      }

      return { success: false, error: 'Authenticated Supabase session required to fund MideSave vault.' };
    },

    async withdrawSavingsVault(vaultId, amount, userId = null, options = {}) {
      if (isFinancialQuarantined()) return buildQuarantineResult('MideSave withdrawals');
      const amt = Math.round(Number(amount) * 100) / 100;
      if (!vaultId || !Number.isFinite(amt) || amt <= 0) {
        return { success: false, error: 'Valid vault ID and positive withdrawal amount are required.' };
      }

      if (this.isConfigured() && this.client && isValidUuid(vaultId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user) {
            const idemKey = isValidUuid(options?.idempotencyKey) ? options.idempotencyKey : generateIdempotencyKey();
            const { data, error } = await this.client.rpc('manage_midesave_vault', {
              p_action: 'withdraw',
              p_vault_id: vaultId,
              p_amount: amt,
              p_pin: options?.pin || null,
              p_idempotency_key: idemKey
            });
            if (error) {
              return { success: false, error: error.message || 'Failed to withdraw from savings vault.' };
            }
            if (data && data.success === false) {
              return { success: false, error: data.error || 'Failed to withdraw from savings vault.' };
            }
            if (data) {
              return {
                success: true,
                vaultId: data.vault_id,
                vaultTitle: data.vault_title,
                grossWithdrawn: Number(data.gross_withdrawn),
                earlyBreakFee: Number(data.early_break_fee || 0),
                netCredited: Number(data.net_credited),
                vaultBalance: Number(data.vault_balance),
                newBalance: Number(data.new_balance),
                status: data.status,
                reference: data.reference
              };
            }
          }
        } catch (err) {
          return { success: false, error: err.message || 'Failed to withdraw from savings vault.' };
        }
      }

      return { success: false, error: 'Authenticated Supabase session required to withdraw from MideSave vault.' };
    },

    // =========================================================================
    // NIGERIAN AIRTIME, DATA & UTILITY BILLS (`public.bill_payments`)
    // =========================================================================

    generateStsMeterToken() {
      const blocks = [];
      for (let i = 0; i < 5; i++) {
        blocks.push(String(csprngUint32() % 10000).padStart(4, '0'));
      }
      return blocks.join(' ');
    },

    _readLocalBills(userId) {
      if (!userId) return [];
      try {
        const raw = localStorage.getItem(`midepay_bills_${userId}`);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    },

    _writeLocalBills(userId, list) {
      if (!userId) return;
      try {
        localStorage.setItem(`midepay_bills_${userId}`, JSON.stringify(list));
      } catch (e) {}
    },

    async getBillHistory(userId) {
      if (!userId) return [];

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const { data, error } = await this.client
              .from('bill_payments')
              .select('*')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(30);

            if (!error && Array.isArray(data)) {
              return data;
            }
          }
        } catch (err) {
          console.warn('[MidePay] getBillHistory notice:', err.message);
        }
      }

      if (isProduction()) return [];
      return this._readLocalBills(userId);
    },

    async payUtilityBill({ userId, serviceType, provider, identifier, planName, amount, pinVerified = true, pin = null, idempotencyKey = null }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('VTU & utility bill payments');
      const cleanService = String(serviceType || '').trim().toLowerCase();
      const amt = Math.round(Number(amount) * 100) / 100;
      if (!['airtime', 'data', 'electricity', 'cable'].includes(cleanService)) {
        return { success: false, error: 'Unsupported utility service type.' };
      }
      if (!provider || !identifier) {
        return { success: false, error: 'Provider and customer account/phone/meter identifier are required.' };
      }
      if (!Number.isFinite(amt) || amt <= 0) {
        return { success: false, error: 'Bill payment amount must be greater than ₦0.00.' };
      }
      if (!pinVerified && !pin) {
        return { success: false, error: '4-digit Transaction PIN verification is required.' };
      }

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const idemKey = isValidUuid(idempotencyKey) ? idempotencyKey : generateIdempotencyKey();
            const { data, error } = await this.client.rpc('pay_vtu_bill', {
              p_service_type: cleanService,
              p_provider: String(provider).trim(),
              p_identifier: String(identifier).trim(),
              p_plan_name: String(planName || provider).trim(),
              p_amount: amt,
              p_pin: pin || null,
              p_idempotency_key: idemKey
            });

            if (error) {
              return { success: false, error: error.message || 'Utility bill payment rejected by server.' };
            }
            if (data && data.success === false) {
              return { success: false, error: data.error || 'Utility bill payment rejected by server.' };
            }
            if (data) {
              return {
                success: true,
                billId: data.bill_id,
                reference: data.reference,
                token: data.token || null,
                newBalance: Number(data.new_balance)
              };
            }
          }
        } catch (err) {
          return { success: false, error: err.message || 'Utility bill payment network error.' };
        }
      }

      return { success: false, error: 'Authenticated Supabase session required to pay utility bills.' };
    },

    // =========================================================================
    // BUSINESS SUITE TEAM PAYROLL (`public.payroll_runs` & `public.payroll_items`)
    // =========================================================================

    _readLocalPayroll(userId) {
      if (!userId) return [];
      try {
        const raw = localStorage.getItem(`midepay_payroll_runs_${userId}`);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    },

    _writeLocalPayroll(userId, runs) {
      if (!userId) return;
      try {
        localStorage.setItem(`midepay_payroll_runs_${userId}`, JSON.stringify(runs));
      } catch (e) {}
    },

    async getPayrollHistory(userId) {
      if (!userId) return [];

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const { data, error } = await this.client
              .from('payroll_runs')
              .select('*, payroll_items(*)')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(20);

            if (!error && Array.isArray(data)) {
              return data;
            }
          }
        } catch (err) {
          console.warn('[MidePay] getPayrollHistory notice:', err.message);
        }
      }

      if (isProduction()) return [];
      return this._readLocalPayroll(userId);
    },

    async executeBusinessPayroll({ userId, businessId = null, title = 'Monthly Team Payroll', employees = [], pin = null, idempotencyKey = null }) {
      if (isFinancialQuarantined()) return buildQuarantineResult('batch payroll disbursements');
      if (!userId) return { success: false, error: 'Employer user ID is required.' };
      if (!Array.isArray(employees) || employees.length === 0) {
        return { success: false, error: 'Add at least one staff member to execute batch payroll.' };
      }

      const normalizedItems = [];

      for (const emp of employees) {
        const ident = String(emp.identifier || emp.nuban || emp.tag || '').trim();
        const amt = Math.round(Number(emp.amount || emp.salary || 0) * 100) / 100;
        if (!ident || !Number.isFinite(amt) || amt <= 0) {
          return { success: false, error: 'Every staff row requires a valid MidePay NUBAN/@tag and salary > ₦0.' };
        }
        normalizedItems.push({
          identifier: ident,
          name: String(emp.name || 'Team Member').trim(),
          role: String(emp.role || 'Staff').trim(),
          amount: amt
        });
      }

      if (this.isConfigured() && this.client && isValidUuid(userId)) {
        try {
          const { data: authData } = await this.client.auth.getUser();
          if (authData?.user && authData.user.id === userId) {
            const idemKey = isValidUuid(idempotencyKey) ? idempotencyKey : generateIdempotencyKey();
            const { data, error } = await this.client.rpc('execute_payroll_batch', {
              p_business_id: isValidUuid(businessId) ? businessId : null,
              p_title: String(title || 'Monthly Team Payroll').trim(),
              p_items: normalizedItems,
              p_pin: pin || null,
              p_idempotency_key: idemKey
            });

            if (error) {
              return { success: false, error: error.message || 'Batch payroll execution failed on server.' };
            }
            if (data && data.success === false) {
              return { success: false, error: data.error || 'Batch payroll execution failed on server.' };
            }
            if (data) {
              return {
                success: true,
                payrollRunId: data.payroll_run_id,
                reference: data.reference,
                totalAmount: Number(data.total_amount),
                employeeCount: Number(data.employee_count),
                newBalance: Number(data.new_balance)
              };
            }
          }
        } catch (err) {
          return { success: false, error: err.message || 'Batch payroll network error.' };
        }
      }

      return { success: false, error: 'Authenticated Supabase session required to disburse payroll.' };
    }
  };

  window.MidePayDB = MidePayDB;
})(window);
