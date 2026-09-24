/**
 * MidePay — Supabase Client Setup & API Integration Layer
 * Powered by @supabase/supabase-js
 * 
 * Instructions:
 * 1. Create a project at https://supabase.com
 * 2. Run the SQL schema in `supabase/migrations/20260923000000_initial_midepay_schema.sql`
 * 3. Replace the SUPABASE_URL and SUPABASE_ANON_KEY placeholders below (or set them via window.MIDEPAY_SUPABASE_CONFIG)
 */

(function (window) {
  // Configuration defaults
  const DEFAULT_CONFIG = {
    url: 'https://YOUR_PROJECT_ID.supabase.co',
    anonKey: 'YOUR_SUPABASE_ANON_KEY'
  };

  // Support environment/runtime overrides
  const userConfig = window.MIDEPAY_SUPABASE_CONFIG || {};
  if (userConfig.anonKey && !userConfig.anonKey.includes('...')) {
    localStorage.setItem('midepay_supabase_anon_key', userConfig.anonKey);
  }
  if (userConfig.url && !userConfig.url.includes('YOUR_PROJECT_ID')) {
    localStorage.setItem('midepay_supabase_url', userConfig.url);
  }
  const SUPABASE_URL = userConfig.url || localStorage.getItem('midepay_supabase_url') || DEFAULT_CONFIG.url;
  const SUPABASE_ANON_KEY = userConfig.anonKey || localStorage.getItem('midepay_supabase_anon_key') || DEFAULT_CONFIG.anonKey;

  // Determine if actual valid Supabase credentials have been supplied
  const isSupabaseConfigured = () => {
    return (
      SUPABASE_URL && 
      !SUPABASE_URL.includes('YOUR_PROJECT_ID') &&
      SUPABASE_ANON_KEY && 
      !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY') &&
      !SUPABASE_ANON_KEY.includes('...') &&
      SUPABASE_ANON_KEY.length >= 40
    );
  };

  // Immediate Startup Check
  (function runStartupCheck() {
    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === DEFAULT_CONFIG.anonKey) {
      console.info('ℹ️ [MidePay] Supabase placeholder detected. Running in seamless client simulation mode.');
      return;
    }

    if (SUPABASE_ANON_KEY.includes('...')) {
      console.warn(
        '⚠️ [MidePay Startup Warning] The Supabase API key in config.js is TRUNCATED with literal "..."!\n' +
        'Currently stored value: "' + SUPABASE_ANON_KEY + '"\n' +
        'Please copy and paste the complete, untruncated key from your Supabase dashboard (Project Settings > API).'
      );
    } else if (SUPABASE_ANON_KEY.length < 40) {
      console.warn(
        '⚠️ [MidePay Startup Warning] The Supabase API key in config.js is shorter than 40 characters (' + SUPABASE_ANON_KEY.length + ' chars)!\n' +
        'Currently stored value: "' + SUPABASE_ANON_KEY + '"\n' +
        'A valid Supabase key is typically 40+ characters (legacy anon JWTs are ~150-200+ characters). Please verify your key.'
      );
    }
  })();

  // Initialize Supabase Client if library is loaded
  let client = null;
  if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    if (isSupabaseConfigured()) {
      try {
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        console.log('✅ [MidePay] Supabase client initialized with live backend:', SUPABASE_URL);

        // Auto-test connection
        client.from('waitlist').select('count', { count: 'exact', head: true })
          .then(({ error }) => {
            if (error && error.code !== '42501' && error.code !== 'PGRST116') {
              console.warn('⚠️ [MidePay] Database check returned:', error.message);
            } else {
              console.log('⚡ [MidePay] Live Supabase database connection verified! No demo fallback active.');
            }
          })
          .catch(err => console.warn('⚠️ [MidePay] Connection check error:', err));
      } catch (e) {
        console.error('❌ [MidePay] Failed to initialize Supabase client:', e);
      }
    }
  }

  /**
   * MidePay API Service
   */
  const MidePayDB = {
    client,
    isConfigured: isSupabaseConfigured,

    /**
     * Configure credentials dynamically from console or UI settings
     */
    configure(url, anonKey) {
      localStorage.setItem('midepay_supabase_url', url);
      localStorage.setItem('midepay_supabase_anon_key', anonKey);
      if (typeof window.supabase !== 'undefined') {
        this.client = window.supabase.createClient(url, anonKey);
        console.log('✅ [MidePay] Supabase configured successfully:', url);
      }
    },

    // =========================================================================
    // AUTHENTICATION FLOWS
    // =========================================================================

    /**
     * Register a new user with Supabase Auth
     * Trigger automatically provisions profile + starter wallet in Postgres
     */
    async signUp({ email, password, fullName, phone }) {
      if (!this.isConfigured() || !this.client) {
        // Fallback to local simulation
        return {
          user: { id: 'local-' + Date.now(), email, user_metadata: { full_name: fullName, phone } },
          error: null
        };
      }

      const { data, error } = await this.client.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone: phone
          }
        }
      });

      if (error) return { user: null, error };
      return { user: data.user, error: null };
    },

    /**
     * Login existing user with Supabase Auth
     */
    async signIn({ email, password }) {
      if (!this.isConfigured() || !this.client) {
        return { session: null, error: null, isDemo: true };
      }

      const { data, error } = await this.client.auth.signInWithPassword({
        email,
        password
      });

      if (error) return { session: null, error };
      return { session: data.session, user: data.user, error: null };
    },

    /**
     * Logout current session
     */
    async signOut() {
      if (this.isConfigured() && this.client) {
        await this.client.auth.signOut();
      }
    },

    /**
     * Get current active session user
     */
    async getCurrentUser() {
      if (!this.isConfigured() || !this.client) return null;
      const { data } = await this.client.auth.getUser();
      return data?.user || null;
    },

    // =========================================================================
    // WALLET & PROFILES
    // =========================================================================

    /**
     * Fetch user profile (RLS protected: auth.uid() = id)
     */
    async getProfile(userId) {
      if (!this.isConfigured() || !this.client) return null;

      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Error fetching profile:', error.message);
        return null;
      }
      return data;
    },

    /**
     * Fetch primary NGN wallet (RLS protected: auth.uid() = user_id)
     */
    async getWallet(userId) {
      if (!this.isConfigured() || !this.client) return null;

      const { data, error } = await this.client
        .from('wallets')
        .select('*')
        .eq('user_id', userId)
        .eq('currency', 'NGN')
        .maybeSingle();

      if (error) {
        console.warn('Error fetching wallet:', error.message);
        return null;
      }
      return data;
    },

    // =========================================================================
    // TRANSACTIONS
    // =========================================================================

    /**
     * Fetch transactions for user (RLS protected: auth.uid() = user_id)
     */
    async getTransactions(userId, limit = 10) {
      if (!this.isConfigured() || !this.client) return [];

      const { data, error } = await this.client
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.warn('Error fetching transactions:', error.message);
        return [];
      }
      return data;
    },

    /**
     * Record a Send Money transfer transaction
     */
    async recordTransfer({ walletId, userId, amount, recipient, destinationBank, narration }) {
      if (!this.isConfigured() || !this.client) {
        return { success: true, isDemo: true };
      }

      const reference = 'MP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

      // Insert transaction record
      const { data: tx, error: txError } = await this.client
        .from('transactions')
        .insert({
          wallet_id: walletId,
          user_id: userId,
          type: 'outflow',
          category: 'transfer',
          amount: amount,
          fee: 0.00,
          status: 'successful',
          counterparty_name: recipient,
          counterparty_bank: destinationBank,
          narration: narration || 'Transfer via MidePay',
          reference: reference
        })
        .select()
        .single();

      if (txError) return { success: false, error: txError };

      // Update wallet balance
      const { data: wallet } = await this.client
        .from('wallets')
        .select('balance')
        .eq('id', walletId)
        .single();

      if (wallet) {
        const newBalance = Math.max(0, Number(wallet.balance) - Number(amount));
        await this.client
          .from('wallets')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', walletId);
      }

      return { success: true, transaction: tx };
    },

    /**
     * Record a Deposit / Funding transaction
     */
    async recordDeposit({ walletId, userId, amount }) {
      if (!this.isConfigured() || !this.client) {
        return { success: true, isDemo: true };
      }

      const reference = 'DEP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

      const { data: tx, error: txError } = await this.client
        .from('transactions')
        .insert({
          wallet_id: walletId,
          user_id: userId,
          type: 'inflow',
          category: 'deposit',
          amount: amount,
          fee: 0.00,
          status: 'successful',
          counterparty_name: 'Providus Bank Transfer',
          counterparty_bank: 'Providus Bank',
          narration: 'Wallet top-up deposit',
          reference: reference
        })
        .select()
        .single();

      if (txError) return { success: false, error: txError };

      // Increment wallet balance
      const { data: wallet } = await this.client
        .from('wallets')
        .select('balance')
        .eq('id', walletId)
        .single();

      if (wallet) {
        const newBalance = Number(wallet.balance) + Number(amount);
        await this.client
          .from('wallets')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', walletId);
      }

      return { success: true, transaction: tx };
    },

    // =========================================================================
    // WAITLIST
    // =========================================================================

    /**
     * Submit waitlist email (Public insert enabled via RLS)
     */
    async joinWaitlist(email) {
      if (!this.isConfigured() || !this.client) {
        return { success: true, isDemo: true };
      }

      const { data, error } = await this.client
        .from('waitlist')
        .insert([{ email: email.trim().toLowerCase() }]);

      if (error && error.code !== '23505') { // 23505 is unique violation, which is fine
        return { success: false, error };
      }
      return { success: true, data };
    },

    // =========================================================================
    // BUSINESS TABLES (RLS Protected: is_business_member(business_id))
    // =========================================================================

    /**
     * Fetch businesses where auth.uid() is an active member
     */
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
        console.warn('Error fetching businesses:', error.message);
        return [];
      }
      return data;
    },

    /**
     * Fetch business sub-accounts
     */
    async getBusinessSubAccounts(businessId) {
      if (!this.isConfigured() || !this.client) return [];

      const { data, error } = await this.client
        .from('business_sub_accounts')
        .select('*')
        .eq('business_id', businessId);

      if (error) {
        console.warn('Error fetching sub accounts:', error.message);
        return [];
      }
      return data;
    },

    /**
     * Fetch business invoices
     */
    async getBusinessInvoices(businessId) {
      if (!this.isConfigured() || !this.client) return [];

      const { data, error } = await this.client
        .from('invoices')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Error fetching invoices:', error.message);
        return [];
      }
      return data;
    }
  };

  // Expose to window
  window.MidePayDB = MidePayDB;
})(window);
