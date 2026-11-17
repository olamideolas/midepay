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
let existingFinancialLive = false;
let existingUrl = '';
let existingAnonKey = '';

try {
  if (fs.existsSync(configPath)) {
    const existing = fs.readFileSync(configPath, 'utf8');
    const envMatch = existing.match(/ENV:\s*['"]([^'"]+)['"]/);
    const finMatch = existing.match(/FINANCIAL_RPCS_LIVE:\s*(true|false)/);
    const urlMatch = existing.match(/url:\s*['"]([^'"]+)['"]/);
    const keyMatch = existing.match(/anonKey:\s*['"]([^'"]+)['"]/);
    if (envMatch && envMatch[1]) existingEnv = envMatch[1];
    if (finMatch && finMatch[1]) existingFinancialLive = finMatch[1] === 'true';
    if (urlMatch && urlMatch[1]) existingUrl = urlMatch[1];
    if (keyMatch && keyMatch[1]) existingAnonKey = keyMatch[1];
  }
} catch (e) {}

const appEnv = (process.env.APP_ENV || process.env.MIDEPAY_ENV || existingEnv || 'production').trim();
const financialRpcsLive = process.env.FINANCIAL_RPCS_LIVE !== undefined
  ? String(process.env.FINANCIAL_RPCS_LIVE).trim().toLowerCase() === 'true'
  : existingFinancialLive;
const supabaseUrl = (process.env.SUPABASE_URL || existingUrl || 'https://pxdzdehocjnmxbuvipxu.supabase.co').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || existingAnonKey || 'sb_publishable_5adXF0UhSQJ1n4F_IqLXEw_0naxL0wT').trim();

function containsServiceRoleJwt(rawKey) {
  if (typeof rawKey !== 'string' || !rawKey.startsWith('eyJ')) return false;
  try {
    const parts = rawKey.split('.');
    if (parts.length < 2) return false;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return /"role"\s*:\s*"service_role"/i.test(json);
  } catch (_) {
    return false;
  }
}

// Prevent accidental leakage of backend secret keys or service_role JWTs into browser config.js
if (
  /^(sb_secret_|sk_live_|sk_test_|FLWSECK|PAYSTACK_SECRET|FLUTTERWAVE_SECRET)/i.test(supabaseAnonKey) ||
  /service_role/i.test(supabaseAnonKey) ||
  containsServiceRoleJwt(supabaseAnonKey)
) {
  console.error('❌ [Build Security Gate] Refusing to write secret server key or service_role JWT into public config.js!');
  process.exit(1);
}

const configContent = `/**
 * MidePay — Supabase Staging Quarantine / Production Configuration
 * Generated at build time by build.js (APP_ENV=${appEnv}, FINANCIAL_RPCS_LIVE=${financialRpcsLive})
 */

window.MIDEPAY_SUPABASE_CONFIG = {
  ENV: ${JSON.stringify(appEnv)},
  FINANCIAL_RPCS_LIVE: ${JSON.stringify(financialRpcsLive)},
  url: ${JSON.stringify(supabaseUrl)},
  anonKey: ${JSON.stringify(supabaseAnonKey)}
};
`;

fs.writeFileSync(configPath, configContent, 'utf8');

console.log(`✅ [Vercel Build] config.js generated successfully (ENV=${appEnv}).`);
console.log(`⚡ Target Supabase Project: ${supabaseUrl}`);
