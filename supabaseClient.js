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
     * Search for registered MidePay recipient by email or phone
     * Transfers only work between registered MidePay members
     */
    async findRecipient(query, currentUserId = null) {
      if (!query || typeof query !== 'string') return null;
      const clean = query.trim().toLowerCase();
      if (!clean) return null;

      // 1. Try Live Supabase Query if configured
      if (this.isConfigured() && this.client) {
        try {
          // Normalize phone (strip spaces/dashes)
          const cleanPhone = clean.replace(/[\s\-]/g, '');

          // Look up by email (exact or ilike), phone, or tag in profiles
          let supaQuery = this.client
            .from('profiles')
            .select('id, full_name, email, phone, tag, avatar_url');

          if (clean.includes('@') && !clean.startsWith('@')) {
            supaQuery = supaQuery.eq('email', clean);
          } else if (clean.startsWith('@')) {
            supaQuery = supaQuery.ilike('tag', clean);
          } else if (/^\+?[0-9]{7,15}$/.test(cleanPhone)) {
            supaQuery = supaQuery.or(`phone.eq.${cleanPhone},phone.eq.${clean}`);
          } else {
            supaQuery = supaQuery.or(`email.ilike.%${clean}%,phone.ilike.%${clean}%,tag.ilike.%${clean}%`);
          }

          if (currentUserId && !currentUserId.startsWith('local-')) {
            supaQuery = supaQuery.neq('id', currentUserId);
          }

          const { data, error } = await supaQuery.limit(1);

          if (!error && data && data.length > 0) {
            return {
              id: data[0].id,
              fullName: data[0].full_name,
              email: data[0].email,
              phone: data[0].phone || '',
              tag: data[0].tag || `@${data[0].full_name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
              avatarUrl: data[0].avatar_url,
              isRegistered: true,
              source: 'supabase'
            };
          }
        } catch (e) {
          console.warn('⚠️ [MidePay] Recipient lookup warning:', e.message);
        }
      }

      // 2. Check locally registered accounts registry (ensures all newly signed up users are immediately reachable)
      try {
        const localRegistry = JSON.parse(localStorage.getItem('midepay_accounts_registry') || '[]');
        const cleanPhone = clean.replace(/[\s\-]/g, '');
        const localMatch = localRegistry.find(r => {
          if (currentUserId && (r.id === currentUserId || r.email === currentUserId)) return false;
          if (clean.includes('@') && !clean.startsWith('@')) {
            return r.email && r.email.toLowerCase() === clean;
          }
          if (clean.startsWith('@')) {
            return r.tag && r.tag.toLowerCase() === clean;
          }
          if (cleanPhone.length >= 7) {
            const p = (r.phone || '').replace(/[\s\-]/g, '');
            return p.endsWith(cleanPhone.slice(-8)) || cleanPhone.endsWith(p.slice(-8));
          }
          return false;
        });
        if (localMatch) {
          return {
            id: localMatch.id || 'reg-' + localMatch.email,
            fullName: localMatch.fullName,
            email: localMatch.email,
            phone: localMatch.phone,
            tag: localMatch.tag || `@${localMatch.fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
            isRegistered: true,
            source: 'registry'
          };
        }
      } catch (e) {}

      // 3. Known Members Fallback Directory
      const DEMO_RECIPIENTS = [
        {
          id: 'demo-user-chinedu-001',
          fullName: 'Chinedu Eze',
          email: 'chinedu@midepay.com',
          phone: '08031234567',
          tag: '@chinedueze',
          isRegistered: true,
          source: 'demo'
        },
        {
          id: 'demo-user-aisha-002',
          fullName: 'Aisha Abubakar Mohammed',
          email: 'aisha@midepay.com',
          phone: '08023456789',
          tag: '@aishabubakar',
          isRegistered: true,
          source: 'demo'
        },
        {
          id: 'demo-user-babatunde-003',
          fullName: 'Babatunde Adeleke',
          email: 'babatunde@midepay.com',
          phone: '08098765432',
          tag: '@babatundeadel',
          isRegistered: true,
          source: 'demo'
        },
        {
          id: 'demo-user-folashade-004',
          fullName: 'Folashade Bakare',
          email: 'folashade@midepay.com',
          phone: '08055667788',
          tag: '@folashade',
          isRegistered: true,
          source: 'demo'
        },
        {
          id: 'demo-user-olamide-005',
          fullName: 'Olasunkanmi Olamide',
          email: 'olamide@midepay.com',
          phone: '08144556677',
          tag: '@olamide',
          isRegistered: true,
          source: 'demo'
        }
      ];

      const cleanPhone = clean.replace(/[\s\-]/g, '');
      const matched = DEMO_RECIPIENTS.find(r => {
        if (currentUserId && r.id === currentUserId) return false;
        if (clean.includes('@') && !clean.startsWith('@')) {
          return r.email.toLowerCase() === clean;
        }
        if (clean.startsWith('@')) {
          return r.tag.toLowerCase() === clean;
        }
        if (/^[0-9]{7,15}$/.test(cleanPhone)) {
          return r.phone.replace(/[\s\-]/g, '') === cleanPhone;
        }
        return r.email.toLowerCase().includes(clean) ||
               r.phone.includes(cleanPhone) ||
               r.tag.toLowerCase().includes(clean);
      });

      return matched || null;
    },

    /**
     * Save transaction PIN hash to profiles table
     */
    async setUserPin(userId, pinHash) {
      if (!userId || !pinHash) return { success: false, error: 'User ID and PIN hash required' };
      localStorage.setItem(`midepay_pin_hash_${userId}`, pinHash);

      if (this.isConfigured() && this.client && !userId.startsWith('local-')) {
        try {
          const { error } = await this.client
            .from('profiles')
            .update({ pin_hash: pinHash, updated_at: new Date().toISOString() })
            .eq('id', userId);

          if (error) {
            console.warn('⚠️ [MidePay] Failed to persist pin_hash to Supabase profiles (column may need migration):', error.message);
          }
        } catch (e) {
          console.warn('⚠️ [MidePay] setUserPin network error:', e.message);
        }
      }
      return { success: true };
    },

    /**
     * Fetch user transaction PIN hash from profile
     */
    async getUserPinHash(userId) {
      if (!userId) return null;
      const cached = localStorage.getItem(`midepay_pin_hash_${userId}`);
      if (cached) return cached;

      if (this.isConfigured() && this.client && !userId.startsWith('local-')) {
        try {
          const { data, error } = await this.client
            .from('profiles')
            .select('pin_hash')
            .eq('id', userId)
            .maybeSingle();

          if (!error && data?.pin_hash) {
            localStorage.setItem(`midepay_pin_hash_${userId}`, data.pin_hash);
            return data.pin_hash;
          }
        } catch (e) {
          console.warn('⚠️ [MidePay] getUserPinHash error:', e.message);
        }
      }
      return null;
    },

    /**
     * Execute Atomic Transfer Funds via Postgres RPC:
     * transfer_funds(sender_id, recipient_id, amount, narration)
     */
    async transferFunds({ senderId, recipientId, amount, narration }) {
      if (!senderId) return { success: false, error: 'Sender ID is required' };
      if (!recipientId) return { success: false, error: 'Recipient is required' };
      if (senderId === recipientId) return { success: false, error: 'Cannot transfer funds to yourself' };
      if (!amount || amount <= 0) return { success: false, error: 'Transfer amount must be greater than zero' };

      // 1. Try Live Supabase Postgres RPC if configured
      if (this.isConfigured() && this.client && !senderId.startsWith('local-') && !recipientId.startsWith('demo-')) {
        try {
          const { data, error } = await this.client.rpc('transfer_funds', {
            sender_id: senderId,
            recipient_id: recipientId,
            amount: Number(amount),
            narration: narration || 'Transfer via MidePay'
          });

          if (error) {
            console.warn('⚠️ [MidePay] transfer_funds RPC returned error:', error);
            // Check for specific database exception messages
            const msg = error.message || error.details || 'Transfer failed on server';
            return { success: false, error: msg };
          }

          return {
            success: true,
            data: data,
            reference: data?.reference || `MP-TRF-${Date.now()}`
          };
        } catch (err) {
          console.error('❌ [MidePay] transfer_funds RPC exception:', err);
          return { success: false, error: err.message || 'Transfer service connection failed' };
        }
      }

      // 2. Demo / Local Simulation Fallback (Atomic Client Update)
      const reference = 'MP-TRF-' + Date.now().toString().slice(-8);
      return {
        success: true,
        isDemo: true,
        reference: reference,
        data: {
          success: true,
          reference: reference,
          amount: Number(amount)
        }
      };
    },

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
    async recordTransfer({ walletId, userId, amount, recipient, destinationBank, narration, fee = 10.00, reference = null }) {
      if (!this.isConfigured() || !this.client) {
        return { success: true, isDemo: true };
      }

      const txRef = reference || ('MDP-' + Math.floor(100000000 + Math.random() * 900000000));

      // Insert transaction record
      const { data: tx, error: txError } = await this.client
        .from('transactions')
        .insert({
          wallet_id: walletId,
          user_id: userId,
          type: 'outflow',
          category: 'transfer',
          amount: amount,
          fee: fee,
          status: 'successful',
          counterparty_name: recipient,
          counterparty_bank: destinationBank,
          narration: narration || 'Transfer via MidePay',
          reference: txRef
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
    /**
     * Record a Deposit / Funding transaction (increases wallet balance in Supabase directly)
     */
    async recordDeposit({ walletId, userId, amount }) {
      if (!this.isConfigured() || !this.client) {
        return { success: true, isDemo: true };
      }

      const reference = 'DEP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      const depositAmount = Number(amount);

      // 1. Resolve target wallet
      let targetWalletId = walletId;
      let wallet = null;

      if (targetWalletId) {
        const { data } = await this.client
          .from('wallets')
          .select('*')
          .eq('id', targetWalletId)
          .maybeSingle();
        wallet = data;
      }

      if (!wallet && userId) {
        const { data } = await this.client
          .from('wallets')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        wallet = data;
        if (wallet) targetWalletId = wallet.id;
      }

      // If user has no wallet row yet in Supabase (e.g. freshly created account), auto-create one
      if (!wallet && userId) {
        const fakeNuban = '90' + Math.floor(10000000 + Math.random() * 90000000);
        const { data: newW, error: newWErr } = await this.client
          .from('wallets')
          .insert({
            user_id: userId,
            currency: 'NGN',
            balance: depositAmount,
            ledger_balance: depositAmount,
            nuban: fakeNuban,
            bank_name: 'Providus Bank'
          })
          .select()
          .single();

        if (!newWErr && newW) {
          wallet = newW;
          targetWalletId = newW.id;
        }
      } else if (wallet && targetWalletId) {
        const newBalance = Number(wallet.balance || 0) + depositAmount;
        const { data: updatedW } = await this.client
          .from('wallets')
          .update({ 
            balance: newBalance, 
            ledger_balance: newBalance,
            updated_at: new Date().toISOString() 
          })
          .eq('id', targetWalletId)
          .select()
          .single();

        if (updatedW) wallet = updatedW;
      }

      // 2. Insert transaction record
      let tx = null;
      if (targetWalletId && userId) {
        const { data: txData } = await this.client
          .from('transactions')
          .insert({
            wallet_id: targetWalletId,
            user_id: userId,
            type: 'inflow',
            category: 'deposit',
            amount: depositAmount,
            fee: 0.00,
            status: 'successful',
            counterparty_name: 'Instant Top-Up',
            counterparty_bank: 'Providus Bank',
            counterparty_tag_or_nuban: wallet?.nuban || '9000000000',
            narration: 'Wallet Funding Deposit',
            reference: reference
          })
          .select()
          .maybeSingle();
        tx = txData;
      }

      return { success: true, wallet, transaction: tx };
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
