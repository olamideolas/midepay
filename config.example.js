/**
 * MidePay — Supabase Environment Configuration Example
 *
 * Copy to `config.js` and supply your Supabase project URL and publishable/anon key.
 * Set ENV: 'production' for strict server-side enforcement (disables all client demo fallbacks),
 * or ENV: 'development' for local sandbox prototyping.
 */

window.MIDEPAY_SUPABASE_CONFIG = {
  ENV: 'production',
  url: 'https://YOUR_PROJECT_ID.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_KEY'
};
