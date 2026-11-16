/**
 * MidePay — Zero-Secret Vercel Production Build Script
 *
 * Injects public runtime config into `config.js` at build time from Vercel Environment Variables:
 * - APP_ENV (or MIDEPAY_ENV, defaults to 'production')
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 *
 * Security Guard: Rejects builds if a server secret key (`sb_secret_`, `sk_live_`, `FLWSECK`)
 * is accidentally supplied as `SUPABASE_ANON_KEY`.
 */

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.js');
let existingEnv = 'production';
let existingUrl = '';
let existingAnonKey = '';

try {
  if (fs.existsSync(configPath)) {
    const existing = fs.readFileSync(configPath, 'utf8');
    const envMatch = existing.match(/ENV:\s*['"]([^'"]+)['"]/);
    const urlMatch = existing.match(/url:\s*['"]([^'"]+)['"]/);
    const keyMatch = existing.match(/anonKey:\s*['"]([^'"]+)['"]/);
    if (envMatch && envMatch[1]) existingEnv = envMatch[1];
    if (urlMatch && urlMatch[1]) existingUrl = urlMatch[1];
    if (keyMatch && keyMatch[1]) existingAnonKey = keyMatch[1];
  }
} catch (e) {}

const appEnv = (process.env.APP_ENV || process.env.MIDEPAY_ENV || existingEnv || 'production').trim();
const supabaseUrl = (process.env.SUPABASE_URL || existingUrl || 'https://pxdzdehocjnmxbuvipxu.supabase.co').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || existingAnonKey || 'sb_publishable_5adXF0UhSQJ1n4F_IqLXEw_0naxL0wT').trim();

// Prevent accidental leakage of backend secret keys into browser config.js
if (/^(sb_secret_|sk_live_|sk_test_|FLWSECK)/i.test(supabaseAnonKey)) {
  console.error('❌ [Build Security Gate] Refusing to write secret server key into public config.js!');
  process.exit(1);
}

const configContent = `/**
 * MidePay — Supabase Live Production Configuration
 * Generated at build time by build.js (APP_ENV=${appEnv})
 */

window.MIDEPAY_SUPABASE_CONFIG = {
  ENV: ${JSON.stringify(appEnv)},
  url: ${JSON.stringify(supabaseUrl)},
  anonKey: ${JSON.stringify(supabaseAnonKey)}
};
`;

fs.writeFileSync(configPath, configContent, 'utf8');

console.log(`✅ [Vercel Build] config.js generated successfully (ENV=${appEnv}).`);
console.log(`⚡ Target Supabase Project: ${supabaseUrl}`);
