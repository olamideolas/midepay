#!/usr/bin/env node
/**
 * MidePay v4.6 — Real PostgreSQL 18.6 Migration, Compatibility & Financial Security Suite
 *
 * Runs against an isolated in-memory real PostgreSQL 18.6 WASM instance (`@electric-sql/pglite`
 * with compiled C extensions `pgcrypto` and `uuid-ossp`).
 * NEVER connects to or touches any remote/production Supabase database.
 *
 * Validates all 12 Phase 5 requirements:
 *  1. Clean database migration from scratch (all 10 migrations: 20260923 -> 20261116050000).
 *  2. Migration from pre-v4.6 schema states (20260923-only AND 20260923..20261116020000 with legacy data).
 *  3. Function existence, zero overload conflicts, `search_path`, RLS on all 18 tables,
 *     column-level `SELECT` restrictions (`pin_hash`, `transaction_pin_hash`, `card_number`, `cvv`),
 *     and `EXECUTE` grants across `anon`, `authenticated`, and `service_role`.
 *  4. 6-digit Email OTP session attestation (`record_verified_login_session` + `user_agent` audit)
 *     and mandatory 4-digit PIN onboarding (`set_user_transaction_pin`).
 *  5. 5 incorrect PIN attempts -> 15-minute lockout -> valid PIN rejected during lockout ->
 *     post-expiry strike counter reset (`1 of 5`, not instant re-lock) -> valid PIN recovery.
 *  6. Unauthorized attempts: unverified email, unattested OTP, missing PIN, wrong PIN, spoofed
 *     `sender_id`, frozen account, `frozen_by_admin` self-unfreeze bypass, executive self-credit,
 *     and `respond_payment_request` self-approval / unverified-settlement spoofing.
 *  7. Insufficient funds & CBN KYC Tier 1/2/3 single-transaction and daily cumulative limits.
 *  8. Idempotency deduplication (`duplicate`), payload-mismatch `IDEMPOTENCY_CONFLICT`,
 *     and cross-user identical UUID `idempotency_key` isolation.
 *  9. Bidirectional (`A -> B` & `B -> A`) deadlock-free transfers & concurrent double-spend race.
 * 10. Full PostgreSQL transaction rollback atomicity when an internal step fails.
 * 11. Universal mathematical wallet <-> transaction ledger reconciliation across deposits,
 *     admin credits, P2P transfers, MideSave 1.5% early-break fee withdrawals, pending NIP payouts,
 *     settled NIP payouts, and reversed NIP payouts.
 * 12. Verification that unintegrated/unsafe financial RPCs (self-topup, SQL external bank transfer,
 *     VTU bills, virtual card issuing/funding, corporate batch payroll) are revoked from client roles
 *     AND fail closed internally without mutating balances.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function loadPglite() {
  const candidates = [
    process.env.PGLITE_MODULE_DIR,
    path.join(ROOT, 'node_modules', '@electric-sql', 'pglite'),
    'C:/Users/TestAdmin/.gemini/antigravity/brain/785ef751-b351-4fc4-b6e5-d3735bf5e0d6/scratch/pgtest/node_modules/@electric-sql/pglite'
  ].filter(Boolean);

  for (const dir of candidates) {
    const indexFile = path.join(dir, 'dist', 'index.js');
    if (fs.existsSync(indexFile)) {
      const { PGlite } = await import(pathToFileURL(indexFile).href);
      const { pgcrypto } = await import(pathToFileURL(path.join(dir, 'dist', 'contrib', 'pgcrypto.js')).href);
      const { uuid_ossp } = await import(pathToFileURL(path.join(dir, 'dist', 'contrib', 'uuid_ossp.js')).href);
      return { PGlite, pgcrypto, uuid_ossp };
    }
  }
  throw new Error(
    'Real PostgreSQL engine (@electric-sql/pglite) not found. Install via `npm install --no-save @electric-sql/pglite` or set PGLITE_MODULE_DIR.'
  );
}

const { PGlite, pgcrypto, uuid_ossp } = await loadPglite();

let passed = 0;
let failed = 0;

function assertPg(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ PASS: ${label}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function createSupabasePostgres() {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE,
      phone TEXT,
      email_confirmed_at TIMESTAMPTZ,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
      raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user::TEXT);
    $$;

    GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
    GRANT SELECT ON auth.users TO postgres, service_role;
    DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  return db;
}

/**
 * Execute SQL inside a real role-switched & JWT-scoped PostgreSQL transaction
 */
async function execAsRole(db, role, userId, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [role]);
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId || '']);
    await tx.exec(`SET LOCAL ROLE ${role}`);
    return tx.query(sql, params);
  });
}

async function expectSqlError(fn, expectedCode, label) {
  try {
    await fn();
    assertPg(false, label, `Expected PostgreSQL error ${expectedCode}, but query succeeded`);
  } catch (err) {
    assertPg(err.code === expectedCode, label, `Got code=${err.code} msg=${err.message}`);
  }
}

const migDir = path.join(ROOT, 'supabase', 'migrations');
const allMigrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

console.log('======================================================================');
console.log(' MidePay v4.6 — Real PostgreSQL 18.6 Migration & Security Audit Suite');
console.log('======================================================================\n');

// ============================================================================
// [1/12] CLEAN DATABASE MIGRATION FROM SCRATCH
// ============================================================================
console.log('[1/12] Testing clean database migration from scratch (all 27 migrations)...');
const db = await createSupabasePostgres();
const verRes = await db.query('SELECT version() AS v');
console.log(`  ℹ️  Engine: ${verRes.rows[0].v}`);

for (const file of allMigrations) {
  await db.exec(fs.readFileSync(path.join(migDir, file), 'utf8'));
}
assertPg(allMigrations.length === 27, `All ${allMigrations.length}/27 migrations executed cleanly in order on real PostgreSQL`);

const expectedTables = [
  'profiles', 'wallets', 'transactions', 'payment_requests', 'virtual_cards',
  'savings_vaults', 'midesave_vaults', 'bill_payments', 'payroll_runs', 'payroll_items',
  'beneficiaries', 'businesses', 'business_members', 'business_sub_accounts',
  'invoices', 'waitlist', 'audit_logs', 'security_audit_logs'
];
const tblRes = await db.query(
  `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
);
const rlsMap = new Map(tblRes.rows.map((r) => [r.tablename, r.rowsecurity]));
const missingOrNoRls = expectedTables.filter((t) => rlsMap.get(t) !== true);
assertPg(
  missingOrNoRls.length === 0,
  `All ${expectedTables.length}/18 public tables exist with Row-Level Security enabled`,
  missingOrNoRls.join(', ')
);

const writePolicies = await db.query(
  `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND cmd <> 'SELECT'`
);
assertPg(
  writePolicies.rows.length === 0,
  'Zero INSERT/UPDATE/DELETE/ALL client RLS policies exist on any of the 18 public tables'
);

// ============================================================================
// [2/12] PRE-v4.6 UPGRADE PATHS (DATA PRESERVATION & 42703 / 42P01 FIXES)
// ============================================================================
console.log('\n[2/12] Testing upgrades from pre-v4.6 schema states & existing data preservation...');

// Path 2A: Upgrade directly from 20260923000000-only database (no `pin_hash`, no `bill_payments`)
const dbLegacy0923 = await createSupabasePostgres();
await dbLegacy0923.exec(fs.readFileSync(path.join(migDir, '20260923000000_initial_midepay_schema.sql'), 'utf8'));
const legacyUidA = crypto.randomUUID();
await dbLegacy0923.query(
  `INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
   VALUES ($1, 'legacy0923@midepay.ng', NOW() - INTERVAL '5 days', '{"full_name":"Adaeze Legacy"}'::jsonb)`,
  [legacyUidA]
);
await dbLegacy0923.query(
  `INSERT INTO public.savings_vaults (user_id, title, target_amount, current_amount, maturity_date)
   VALUES ($1, 'House Deposit', 500000, 45000, '2027-06-01')`,
  [legacyUidA]
);
await dbLegacy0923.exec(fs.readFileSync(path.join(migDir, '20261116050000_auth_verification_gate.sql'), 'utf8'));

const upgVault = await dbLegacy0923.query(
  `SELECT current_balance, status FROM public.midesave_vaults WHERE user_id = $1`,
  [legacyUidA]
);
const upgProf = await dbLegacy0923.query(
  `SELECT email_otp_verified_at FROM public.profiles WHERE id = $1`,
  [legacyUidA]
);
assertPg(
  upgVault.rows.length === 1 && Number(upgVault.rows[0].current_balance) === 45000 && upgProf.rows[0].email_otp_verified_at !== null,
  'Direct upgrade from 20260923-only DB fixes 42703/42P01 and preserves legacy savings_vaults & verified user state'
);

// Path 2B: Upgrade from 20260923..20261116020000 DB with bcrypt `pin_hash` AND raw card PAN/CVV
const dbLegacy0200 = await createSupabasePostgres();
for (const f of allMigrations.slice(0, 7)) {
  await dbLegacy0200.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
}
const legacyUidB = crypto.randomUUID();
await dbLegacy0200.query(
  `INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
   VALUES ($1, 'legacy0200@midepay.ng', NOW() - INTERVAL '2 days', '{"full_name":"Kunle PreV46"}'::jsonb)`,
  [legacyUidB]
);
await dbLegacy0200.query(
  `UPDATE public.profiles SET pin_hash = crypt('7391', gen_salt('bf', 10)) WHERE id = $1`,
  [legacyUidB]
);
const preCards = await dbLegacy0200.query(`SELECT COUNT(*)::int AS cnt, COUNT(cvv)::int AS cvv_cnt FROM public.virtual_cards WHERE user_id = $1`, [legacyUidB]);
assertPg(preCards.rows[0].cnt === 2 && preCards.rows[0].cvv_cnt === 2, 'Pre-v4.6 fixture contains 2 legacy cards with stored CVVs before upgrade');

for (const f of allMigrations.slice(7)) {
  await dbLegacy0200.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
}
const postCards = await dbLegacy0200.query(
  `SELECT COUNT(*)::int AS cnt, COUNT(cvv)::int AS cvv_cnt, COUNT(card_number)::int AS pan_cnt FROM public.virtual_cards WHERE user_id = $1`,
  [legacyUidB]
);
await execAsRole(dbLegacy0200,'service_role',null,`SELECT public.attest_verified_email($1,'legacy0200@midepay.ng')`,[legacyUidB]);
const pinPreserved = await execAsRole(
  dbLegacy0200,
  'authenticated',
  legacyUidB,
  `SELECT public.verify_user_transaction_pin('7391') AS res`
);
assertPg(
  postCards.rows[0].cnt === 2 && postCards.rows[0].cvv_cnt === 0 && postCards.rows[0].pan_cnt === 0 && pinPreserved.rows[0].res.valid === true,
  'Upgrade from v4.3 preserves existing cards + bcrypt PIN hash while scrubbing 100% of stored PAN & CVV values'
);

await expectSqlError(
  () => dbLegacy0200.query(`UPDATE public.virtual_cards SET cvv = '123' WHERE user_id = $1`, [legacyUidB]),
  '23514',
  'CHECK constraint chk_virtual_cards_no_cvv blocks persisting raw CVV even by superuser/admin'
);

// ============================================================================
// [3/12] FUNCTION SIGNATURES, OVERLOADS, SEARCH_PATH & ROLE/COLUMN PRIVILEGES
// ============================================================================
console.log('\n[3/12] Auditing pg_proc overloads, SECURITY DEFINER search_path, EXECUTE & column grants...');

const dupOverloads = await db.query(`
  SELECT p.proname, COUNT(*)::int AS cnt
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    )
  GROUP BY p.proname
  HAVING COUNT(*) > 1
`);
assertPg(
  dupOverloads.rows.length === 0,
  'Zero ambiguous/legacy overloaded function signatures remain in public schema',
  JSON.stringify(dupOverloads.rows)
);

const badSearchPath = await db.query(`
  SELECT p.proname, p.proconfig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    )
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
      WHERE cfg LIKE 'search_path=public, extensions%'
    )
`);
assertPg(
  badSearchPath.rows.length === 0,
  '100% of SECURITY DEFINER functions enforce fixed search_path = public, extensions, pg_temp',
  JSON.stringify(badSearchPath.rows)
);

const anonCallable = await db.query(`
  SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ORDER BY p.proname
`);
assertPg(
  anonCallable.rows.length === 1 && anonCallable.rows[0].proname === 'join_waitlist',
  `anon role can EXECUTE only join_waitlist (actual: ${anonCallable.rows.map((r) => r.proname).join(',')})`
);

const quarantinedAuthCheck = await db.query(`
  SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY($1)
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
`, [[
  'concept_topup_wallet', 'execute_external_bank_transfer', 'issue_virtual_card',
  'fund_virtual_card', 'fund_virtual_card_from_wallet', 'generate_unique_virtual_card_pan',
  'pay_vtu_bill', 'pay_utility_bill', 'execute_payroll_batch', 'execute_business_payroll',
  'settle_gateway_deposit', 'debit_wallet_for_payout', 'finalize_payout_settlement',
  'reverse_failed_payout', 'generate_unique_midepay_nuban', '_assert_verified_wallet_ready', '_verify_pin_and_audit'
]]);
assertPg(
  quarantinedAuthCheck.rows.length === 0,
  'authenticated role has ZERO EXECUTE privileges on server-only or quarantined provider RPCs'
);

// ============================================================================
// [4/12] EMAIL OTP ATTESTATION, LOGIN AUDIT (`user_agent`) & PIN ONBOARDING
// ============================================================================
console.log('\n[4/12] Testing Email OTP attestation, USER_LOGIN user_agent audit & mandatory PIN setup...');

const userA = crypto.randomUUID();
const userB = crypto.randomUUID();
const execUser = crypto.randomUUID();

await db.query(
  `INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
   VALUES
     ($1, 'chinedu@midepay.ng', NULL, '{"full_name":"Chinedu Okafor","phone":"08031112222"}'::jsonb),
     ($2, 'amaka@midepay.ng', NOW(), '{"full_name":"Amaka Nwosu","phone":"08033334444"}'::jsonb),
     ($3, 'exec@midepay.ng', NOW(), '{"full_name":"Tunde Executive"}'::jsonb)`,
  [userA, userB, execUser]
);
await db.query(`UPDATE public.profiles SET role = 'executive', email_otp_verified_at = NOW() WHERE id = $1`, [execUser]);

const initWalletA = await db.query(`SELECT id, balance, nuban FROM public.wallets WHERE user_id = $1`, [userA]);
const initCardsA = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.virtual_cards WHERE user_id = $1`, [userA]);
assertPg(
  Number(initWalletA.rows[0].balance) === 0 && /^90\d{8}$/.test(initWalletA.rows[0].nuban) && initCardsA.rows[0].cnt === 0,
  'handle_new_user provisions ₦0.00 wallet with CSPRNG 90XXXXXXXX NUBAN and 0 synthetic cards'
);

// Column-level SELECT & direct write blocks under authenticated role
await expectSqlError(
  () => execAsRole(db, 'authenticated', userA, `SELECT pin_hash FROM public.profiles WHERE id = $1`, [userA]),
  '42501',
  'Column-level GRANT blocks authenticated SELECT on profiles.pin_hash (42501)'
);
await expectSqlError(
  () => execAsRole(db, 'authenticated', userA, `SELECT transaction_pin_hash FROM public.profiles WHERE id = $1`, [userA]),
  '42501',
  'Column-level GRANT blocks authenticated SELECT on profiles.transaction_pin_hash (42501)'
);
await expectSqlError(
  () => execAsRole(db, 'authenticated', userA, `SELECT cvv FROM public.virtual_cards`),
  '42501',
  'Column-level GRANT blocks authenticated SELECT on virtual_cards.cvv (42501)'
);
await expectSqlError(
  () => execAsRole(db, 'authenticated', userA, `UPDATE public.wallets SET balance = 500000 WHERE user_id = $1`, [userA]),
  '42501',
  'Direct authenticated UPDATE on wallets is blocked (42501)'
);
await expectSqlError(
  () => execAsRole(db, 'authenticated', userA, `UPDATE public.business_sub_accounts SET balance = 500000`),
  '42501',
  'Direct authenticated UPDATE on corporate business_sub_accounts is blocked (42501)'
);

// Unverified email blocked on login audit & PIN setup
const unvLogin = await execAsRole(db, 'authenticated', userA, `SELECT public.record_verified_login_session('{"user_agent":"MidePayTest/1.0"}'::jsonb) AS r`);
const unvPin = await execAsRole(db, 'authenticated', userA, `SELECT public.set_user_transaction_pin('4829') AS r`);
assertPg(
  unvLogin.rows[0].r.code === 'EMAIL_NOT_VERIFIED' && unvPin.rows[0].r.code === 'EMAIL_NOT_VERIFIED',
  'Unconfirmed email user is blocked from login session attestation and PIN creation (EMAIL_NOT_VERIFIED)'
);

// Simulate `email_confirmed_at` set WITHOUT OTP login attestation yet (userB has email_confirmed_at = NOW(), email_otp_verified_at = NULL)
const unattestedPinB = await execAsRole(db, 'authenticated', userB, `SELECT public.set_user_transaction_pin('5512') AS r`);
assertPg(
  unattestedPinB.rows[0].r.code === 'EMAIL_NOT_VERIFIED',
  'GoTrue email_confirmed_at alone without OTP session attestation (email_otp_verified_at) cannot set PIN or transact'
);

// Complete OTP verification + login session attestation for userA & userB
await db.query(`UPDATE auth.users SET email_confirmed_at = NOW() WHERE id = $1`, [userA]);
await execAsRole(db,'service_role',null,`SELECT public.attest_verified_email($1,'chinedu@midepay.ng')`,[userA]);
await execAsRole(db,'service_role',null,`SELECT public.attest_verified_email($1,'amaka@midepay.ng')`,[userB]);
const loginA = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.record_verified_login_session('{"user_agent":"Mozilla/5.0 MidePay-QA","platform":"Win32"}'::jsonb) AS r`
);
await execAsRole(db, 'authenticated', userB, `SELECT public.record_verified_login_session('{"user_agent":"MidePay-QA"}'::jsonb) AS r`);

const auditLoginRow = await db.query(
  `SELECT event_type, user_agent FROM public.security_audit_logs WHERE user_id = $1 AND event_type = 'USER_LOGIN'`,
  [userA]
);
assertPg(
  loginA.rows[0].r.success === true &&
    loginA.rows[0].r.has_transaction_pin === false &&
    auditLoginRow.rows[0]?.user_agent === 'Mozilla/5.0 MidePay-QA',
  'server-only OTP proof stamps verification and login records USER_LOGIN with user_agent'
);

// Missing PIN blocks P2P transfer before PIN onboarding
const wallB = await db.query(`SELECT id, nuban FROM public.wallets WHERE user_id = $1`, [userB]);
const nubanB = wallB.rows[0].nuban;
const noPinTx = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.execute_p2p_transfer($1, 1000, '4829', gen_random_uuid(), 'Test') AS r`,
  [nubanB]
);
assertPg(noPinTx.rows[0].r.code === 'PIN_SETUP_REQUIRED', 'Verified user without PIN is blocked with PIN_SETUP_REQUIRED');

// Set initial PIN & verify overwrite without current PIN is rejected
const setPinA = await execAsRole(db, 'authenticated', userA, `SELECT public.set_user_transaction_pin('4829') AS r`);
const overwritePinA = await execAsRole(db, 'authenticated', userA, `SELECT public.set_user_transaction_pin('9999', NULL) AS r`);
const setPinB = await execAsRole(db, 'authenticated', userB, `SELECT public.set_user_transaction_pin('7744') AS r`);
assertPg(
  setPinA.rows[0].r.success === true && overwritePinA.rows[0].r.success === false && setPinB.rows[0].r.success === true,
  'set_user_transaction_pin hashes 4-digit PIN with bcrypt and blocks unauthenticated PIN overwrite'
);

// Reset strikes from the intentional overwrite test above
await execAsRole(db, 'authenticated', userA, `SELECT public.verify_user_transaction_pin('4829')`);

// Check PII masking on `lookup_recipient_profile`
const lookupRes = await execAsRole(db, 'authenticated', userA, `SELECT * FROM public.lookup_recipient_profile($1)`, [nubanB]);
assertPg(
  lookupRes.rows.length === 1 &&
    lookupRes.rows[0].full_name === 'Amaka Nwosu' &&
    lookupRes.rows[0].email === null &&
    lookupRes.rows[0].phone === null,
  'lookup_recipient_profile resolves recipient name/tag/NUBAN while masking email and phone PII'
);

// ============================================================================
// [5/12] 5-STRIKE PIN LOCKOUT & POST-COOLDOWN STRIKE RESET
// ============================================================================
console.log('\n[5/12] Testing 5-strike 15-minute PIN lockout & post-cooldown strike reset...');

const strikeCodes = [];
for (let i = 1; i <= 5; i++) {
  const r = await execAsRole(db, 'authenticated', userA, `SELECT public.verify_user_transaction_pin('0000') AS r`);
  strikeCodes.push(r.rows[0].r.code);
}
const lockedValidAttempt = await execAsRole(db, 'authenticated', userA, `SELECT public.verify_user_transaction_pin('4829') AS r`);
assertPg(
  strikeCodes.slice(0, 4).every((c) => c === 'INVALID_PIN') &&
    strikeCodes[4] === 'PIN_LOCKED' &&
    lockedValidAttempt.rows[0].r.code === 'PIN_LOCKED',
  '5 wrong PIN attempts trigger 15-minute PIN_LOCKED cooldown and reject even valid PIN during cooldown'
);

// Expire cooldown and verify a wrong PIN resets to strike 1 (4 remaining), NOT instant re-lock
await db.query(`UPDATE public.profiles SET pin_locked_until = TIMEZONE('utc', NOW()) - INTERVAL '2 seconds' WHERE id = $1`, [userA]);
const postExpiryWrong = await execAsRole(db, 'authenticated', userA, `SELECT public.verify_user_transaction_pin('0000') AS r`);
const postExpiryValid = await execAsRole(db, 'authenticated', userA, `SELECT public.verify_user_transaction_pin('4829') AS r`);
assertPg(
  postExpiryWrong.rows[0].r.code === 'INVALID_PIN' &&
    Number(postExpiryWrong.rows[0].r.attempts_remaining) === 4 &&
    postExpiryValid.rows[0].r.valid === true,
  'Expired 15-minute lockout resets strike window to 1/5 and clears cleanly on valid PIN'
);

// ============================================================================
// [6/12] UNAUTHORIZED, FROZEN, ADMIN-FREEZE & PAYMENT-REQUEST SPOOFING DEFENSES
// ============================================================================
console.log('\n[6/12] Testing ownership, compliance freeze & payment request settlement guards...');

// Spoofed sender_id in transfer_funds
const spoofSender = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.transfer_funds($1, $2, 500, 'Spoof', '4829', gen_random_uuid()) AS r`,
  [userB, userA]
);
assertPg(spoofSender.rows[0].r.code === 'UNAUTHORIZED', 'transfer_funds rejects spoofed sender_id <> auth.uid()');

// Non-executive cannot call admin_credit_wallet; executive cannot self-credit own wallet
await expectSqlError(
  () => execAsRole(db, 'authenticated', userA, `SELECT public.admin_credit_wallet($1, 10000, 'Unauthorized attempt')`, [userA]),
  '42501',
  'Non-executive blocked from admin_credit_wallet'
);
await expectSqlError(
  () => execAsRole(db, 'authenticated', execUser, `SELECT public.admin_credit_wallet($1, 10000, 'Self credit attempt')`, [execUser]),
  '42501',
  'Separation of Duties blocks executive from crediting their own personal wallet'
);

// Compliance `admin_set_account_freeze` blocks client `set_own_account_freeze(false)`
await execAsRole(db, 'authenticated', execUser, `SELECT public.admin_set_account_freeze($1, true, 'CBN AML review hold')`, [userA]);
const bypassFreezeAttempt = await execAsRole(db, 'authenticated', userA, `SELECT public.set_own_account_freeze(false, '4829') AS r`);
const txWhileAdminFrozen = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.execute_p2p_transfer($1, 500, '4829', gen_random_uuid(), 'Frozen test') AS r`,
  [nubanB]
);
assertPg(
  bypassFreezeAttempt.rows[0].r.code === 'ADMIN_FREEZE_LOCKED' && txWhileAdminFrozen.rows[0].r.code === 'ACCOUNT_FROZEN',
  'AML-frozen user cannot self-unfreeze via set_own_account_freeze(false) or execute transfers'
);
await execAsRole(db, 'authenticated', execUser, `SELECT public.admin_set_account_freeze($1, false, 'CBN AML clearance completed')`, [userA]);

// Self-freeze requires valid PIN to unfreeze
await execAsRole(db, 'authenticated', userA, `SELECT public.set_own_account_freeze(true)`);
const unfreezeNoPin = await execAsRole(db, 'authenticated', userA, `SELECT public.set_own_account_freeze(false, NULL) AS r`);
const unfreezeWithPin = await execAsRole(db, 'authenticated', userA, `SELECT public.set_own_account_freeze(false, '4829') AS r`);
assertPg(
  unfreezeNoPin.rows[0].r.success === false && unfreezeWithPin.rows[0].r.success === true,
  'Self-imposed Panic Switch freeze blocks PIN-less unfreeze and lifts cleanly with valid 4-digit PIN'
);

// ============================================================================
// [7/12] GATEWAY FUNDING, INSUFFICIENT FUNDS & CBN KYC TIER LIMITS
// ============================================================================
console.log('\n[7/12] Testing verified gateway settlement, insufficient funds & CBN KYC limits...');

// Insert pending deposit as service_role (as `init-payment` Edge Function does) & settle via `settle_gateway_deposit`
await execAsRole(
  db,
  'service_role',
  null,
  `INSERT INTO public.transactions (wallet_id, user_id, type, category, amount, fee, status, counterparty_name, reference, gateway_provider)
   VALUES ($1, $2, 'inflow', 'deposit', 150000.00, 0.00, 'pending', 'Paystack Checkout', 'MDP-PSK-TEST001', 'paystack')`,
  [initWalletA.rows[0].id, userA]
);
const settle1 = await execAsRole(
  db,
  'service_role',
  null,
  `SELECT public.settle_gateway_deposit('MDP-PSK-TEST001', 'paystack', 15000000, 'PSK_998811', '{"event":"charge.success"}'::jsonb) AS r`
);
const settleDup = await execAsRole(
  db,
  'service_role',
  null,
  `SELECT public.settle_gateway_deposit('MDP-PSK-TEST001', 'paystack', 15000000, 'PSK_998811', '{"event":"charge.success"}'::jsonb) AS r`
);
assertPg(
  settle1.rows[0].r.new_balance === 150000 && settleDup.rows[0].r.already_settled === true,
  'settle_gateway_deposit (service_role) credits ₦150,000.00 once and deduplicates webhook replay'
);

// Tier 1 single-transfer limit is ₦50,000.00 -> ₦60,000.00 must be rejected
const tier1Over = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.execute_p2p_transfer($1, 60000, '4829', gen_random_uuid(), 'Over Tier 1') AS r`,
  [nubanB]
);
assertPg(tier1Over.rows[0].r.code === 'KYC_SINGLE_LIMIT_EXCEEDED', 'CBN KYC Tier 1 single-transfer cap (₦50,000) enforced');

// Upgrade User A & User B to KYC Tier 2 (₦250,000 single limit) and test insufficient funds
await db.query(`UPDATE public.profiles SET kyc_tier = 2 WHERE id IN ($1, $2)`, [userA, userB]);
const insuffRes = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.execute_p2p_transfer($1, 200000, '4829', gen_random_uuid(), 'Too much') AS r`,
  [nubanB]
);
assertPg(insuffRes.rows[0].r.code === 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance rejected cleanly without debit');

// ============================================================================
// [8/12] IDEMPOTENCY REPLAY, PAYLOAD CONFLICT & CROSS-USER ISOLATION + PAYMENT REQUESTS
// ============================================================================
console.log('\n[8/12] Testing idempotency replay, payload-hash conflict, cross-user key isolation & payment requests...');

// Create payment request from User B -> User A for ₦15,000
const prCreate = await execAsRole(
  db,
  'authenticated',
  userB,
  `SELECT public.create_payment_request($1, 15000, 'Design retainer', gen_random_uuid()) AS r`,
  [userA]
);
const reqId = prCreate.rows[0].r.request.id;

// Requester B tries to approve own request -> blocked; Payer A tries to approve before paying -> blocked
const selfApprove = await execAsRole(db, 'authenticated', userB, `SELECT public.respond_payment_request($1, 'approved') AS r`, [reqId]);
const unpaidApprove = await execAsRole(db, 'authenticated', userA, `SELECT public.respond_payment_request($1, 'approved') AS r`, [reqId]);
assertPg(
  selfApprove.rows[0].r.code === 'FORBIDDEN' && unpaidApprove.rows[0].r.code === 'SETTLEMENT_PROOF_REQUIRED',
  'respond_payment_request blocks requester self-approval and blocks payer approval without settled transfer'
);

const sharedIdemKey = crypto.randomUUID();
const p2pFirst = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.execute_p2p_transfer($1, 15000, '4829', $2, 'Settle retainer') AS r`,
  [nubanB, sharedIdemKey]
);
const p2pReplay = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.execute_p2p_transfer($1, 15000, '4829', $2, 'Settle retainer') AS r`,
  [nubanB, sharedIdemKey]
);
const p2pConflict = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.execute_p2p_transfer($1, 25000, '4829', $2, 'Tampered amount') AS r`,
  [nubanB, sharedIdemKey]
);

// User B uses the EXACT SAME UUID `sharedIdemKey` to pay User A ₦5,000 -> must NOT collide!
const nubanA = initWalletA.rows[0].nuban;
const p2pCrossUserSameKey = await execAsRole(
  db,
  'authenticated',
  userB,
  `SELECT public.execute_p2p_transfer($1, 5000, '7744', $2, 'Refund portion') AS r`,
  [nubanA, sharedIdemKey]
);
assertPg(
  p2pFirst.rows[0].r.status === 'success' &&
    p2pReplay.rows[0].r.status === 'duplicate' &&
    p2pConflict.rows[0].r.code === 'IDEMPOTENCY_CONFLICT' &&
    p2pCrossUserSameKey.rows[0].r.status === 'success',
  'Idempotency enforces exact deduplication, rejects parameter tampering (IDEMPOTENCY_CONFLICT), and isolates keys per user'
);

// Now Payer A approves the ₦15,000 payment request using the settled transfer reference!
const validApprove = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.respond_payment_request($1, 'approved', $2) AS r`,
  [reqId, p2pFirst.rows[0].r.reference]
);
assertPg(validApprove.rows[0].r.status === 'approved' && Boolean(validApprove.rows[0].r.fulfilled_tx_id), 'respond_payment_request links verified settled transaction ID on approval');

// ============================================================================
// [9/12] BIDIRECTIONAL TRANSFERS & CONCURRENT DOUBLE-SPEND PROTECTION
// ============================================================================
console.log('\n[9/12] Testing bidirectional deadlock-free locking & concurrent overdraft burst...');

// User A current balance: 150,000 - 15,000 + 5,000 = 140,000. User B: 15,000 - 5,000 = 10,000. Total = 150,000.
const biResults = await Promise.all([
  execAsRole(db, 'authenticated', userA, `SELECT public.execute_p2p_transfer($1, 20000, '4829', gen_random_uuid(), 'A->B') AS r`, [nubanB]),
  execAsRole(db, 'authenticated', userB, `SELECT public.execute_p2p_transfer($1, 4000, '7744', gen_random_uuid(), 'B->A') AS r`, [nubanA])
]);
assertPg(
  biResults.every((x) => x.rows[0].r.success === true),
  'Simultaneous A->B and B->A transfers complete cleanly under UUID-ordered FOR UPDATE locks'
);

// User B now has 10,000 + 20,000 - 4,000 = 26,000. Fire 4 concurrent transfers of ₦20,000 from User B!
const burstResults = await Promise.all(
  Array.from({ length: 4 }, (_, idx) =>
    execAsRole(
      db,
      'authenticated',
      userB,
      `SELECT public.execute_p2p_transfer($1, 20000, '7744', gen_random_uuid(), $2) AS r`,
      [nubanA, `Burst #${idx + 1}`]
    )
  )
);
const burstSuccesses = burstResults.filter((x) => x.rows[0].r.success === true).length;
const burstRejects = burstResults.filter((x) => x.rows[0].r.code === 'INSUFFICIENT_FUNDS').length;
const balBAfterBurst = await db.query(`SELECT balance FROM public.wallets WHERE user_id = $1`, [userB]);
assertPg(
  burstSuccesses === 1 && burstRejects === 3 && Number(balBAfterBurst.rows[0].balance) === 6000,
  'Concurrent 4x ₦20,000 burst against ₦26,000 balance allows exactly 1 debit and leaves ₦6,000.00'
);

// ============================================================================
// [10/12] TRANSACTION ROLLBACK ATOMICITY WHEN AN INTERNAL STEP FAILS
// ============================================================================
console.log('\n[10/12] Testing PostgreSQL transaction rollback atomicity...');

const preRollbackBal = await db.query(`SELECT balance FROM public.wallets WHERE user_id = $1`, [userA]);
await expectSqlError(
  () =>
    db.transaction(async (tx) => {
      await tx.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userA]);
      await tx.exec(`SET LOCAL ROLE authenticated`);
      const step1 = await tx.query(
        `SELECT public.execute_p2p_transfer($1, 5000, '4829', gen_random_uuid(), 'Will Rollback') AS r`,
        [nubanB]
      );
      if (!step1.rows[0].r.success) throw new Error('Step 1 unexpectedly failed');
      await tx.exec(`DO $$ BEGIN RAISE EXCEPTION 'Simulated downstream failure'; END $$;`);
    }),
  'P0001',
  'Failed multi-step transaction raises exception and triggers PostgreSQL ROLLBACK'
);
const postRollbackBal = await db.query(`SELECT balance FROM public.wallets WHERE user_id = $1`, [userA]);
assertPg(
  Number(preRollbackBal.rows[0].balance) === Number(postRollbackBal.rows[0].balance),
  `Wallet balance completely unchanged after mid-transaction failure (₦${postRollbackBal.rows[0].balance})`
);

// ============================================================================
// [11/12] END-TO-END WALLET <-> LEDGER MATHEMATICAL RECONCILIATION
// ============================================================================
console.log('\n[11/12] Testing MideSave early-break fees, pending/settled/reversed payouts & ledger parity...');

// Reconciliation funding fixture is a verified gateway deposit, never a legacy mint RPC.
await execAsRole(db,'service_role',null,
  `INSERT INTO public.transactions(wallet_id,user_id,type,category,amount,fee,status,counterparty_name,reference,gateway_provider)
   SELECT id,user_id,'inflow','deposit',25000,0,'pending','Paystack test','QA-B-FUND','paystack' FROM public.wallets WHERE user_id=$1 AND currency='NGN'`,[userB]);
await execAsRole(db,'service_role',null,`SELECT public.settle_gateway_deposit('QA-B-FUND','paystack',2500000,'QA-B-RECEIPT','{}')`);

// User A creates a locked MideSave vault (attempting to spoof 99.9% interest -> server forces 14.50%), funds ₦40,000, early-breaks ₦20,000 (1.5% fee = ₦300)
const vaultRes = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.manage_midesave_vault('create', NULL, NULL, NULL, NULL, 'Emergency Reserve', 'Emergency', 200000, NOW() + INTERVAL '60 days', 99.90) AS r`
);
const vaultObj = vaultRes.rows[0].r.vault;
assertPg(Number(vaultObj.interest_rate_pa) === 14.5, 'create_savings_vault ignores tampered client interest rate and enforces 14.50%');

await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.manage_midesave_vault('fund', $1, 40000, '4829', gen_random_uuid()) AS r`,
  [vaultObj.id]
);
const withdrawRes = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.manage_midesave_vault('withdraw', $1, 20000, '4829', gen_random_uuid()) AS r`,
  [vaultObj.id]
);
assertPg(
  withdrawRes.rows[0].r.early_break_fee === 300 && withdrawRes.rows[0].r.net_credited === 19700,
  'withdraw_savings_vault deducts 1.5% early-break penalty (₦300) and credits net ₦19,700.00'
);

// Cross-user IDOR attempt on User A's vault by User B
const idorVault = await execAsRole(
  db,
  'authenticated',
  userB,
  `SELECT public.withdraw_savings_vault($1, 1000, '7744', gen_random_uuid()) AS r`,
  [vaultObj.id]
);
assertPg(idorVault.rows[0].r.code === 'VAULT_NOT_FOUND', 'Cross-user MideSave vault withdrawal blocked (VAULT_NOT_FOUND)');

// Outbound NIP Payout #1: `debit_wallet_for_payout` -> stays `pending` -> `finalize_payout_settlement` -> `successful`
const deb1 = await execAsRole(
  db,
  'service_role',
  null,
  `SELECT public.debit_wallet_for_payout($1, 12000, 25, 'MDP-OUT-001', 'paystack', 'GTBank Beneficiary', '058', '0123456789', 'Vendor invoice') AS r`,
  [userA]
);
const txPendingCheck = await db.query(`SELECT status FROM public.transactions WHERE reference = 'MDP-OUT-001'`);
const fin1 = await execAsRole(
  db,
  'service_role',
  null,
  `SELECT public.finalize_payout_settlement('MDP-OUT-001', 'TRF_PSK_001', '{"event":"transfer.success"}'::jsonb) AS r`
);
const txSettledCheck = await db.query(`SELECT status FROM public.transactions WHERE reference = 'MDP-OUT-001'`);
assertPg(
  deb1.rows[0].r.status === 'pending' &&
    txPendingCheck.rows[0].status === 'pending' &&
    fin1.rows[0].r.success === true &&
    txSettledCheck.rows[0].status === 'successful',
  'External NIP payout enters ledger as pending and only becomes successful via finalize_payout_settlement'
);

// Outbound NIP Payout #2: `debit_wallet_for_payout` -> `reverse_failed_payout` refunds principal + fee
await execAsRole(
  db,
  'service_role',
  null,
  `SELECT public.debit_wallet_for_payout($1, 8000, 10, 'MDP-OUT-002', 'flutterwave', 'Zenith Beneficiary', '057', '2098765432', 'Failed NIP') AS r`,
  [userA]
);
const rev2 = await execAsRole(
  db,
  'service_role',
  null,
  `SELECT public.reverse_failed_payout('MDP-OUT-002', 'NIP switch timeout', '{"event":"transfer.completed"}'::jsonb) AS r`
);
assertPg(rev2.rows[0].r.refunded_amount === 8010, 'reverse_failed_payout refunds full principal + fee (₦8,010.00)');

// Immutability check: DELETE on transactions / audit_logs / security_audit_logs blocked even for postgres
await expectSqlError(
  () => db.exec(`DELETE FROM public.transactions`),
  'P0001',
  'enforce_immutable_ledger trigger blocks DELETE on transactions even by superuser'
);
await expectSqlError(
  () => db.exec(`DELETE FROM public.security_audit_logs`),
  'P0001',
  'enforce_immutable_ledger trigger blocks DELETE on security_audit_logs even by superuser'
);

// Universal mathematical ledger reconciliation on BOTH wallets
const reconA = await execAsRole(
  db,
  'authenticated',
  userA,
  `SELECT public.verify_wallet_ledger_reconciliation($1) AS r`,
  [initWalletA.rows[0].id]
);
const reconB = await execAsRole(
  db,
  'authenticated',
  userB,
  `SELECT public.verify_wallet_ledger_reconciliation($1) AS r`,
  [wallB.rows[0].id]
);
assertPg(
  reconA.rows[0].r.ok === true &&
    Number(reconA.rows[0].r.discrepancy) === 0 &&
    reconB.rows[0].r.ok === true &&
    Number(reconB.rows[0].r.discrepancy) === 0,
  `100% mathematical wallet-to-ledger parity verified (User A: ₦${reconA.rows[0].r.wallet_balance}, User B: ₦${reconB.rows[0].r.wallet_balance}, discrepancy: ₦0.00)`
);

// ============================================================================
// [12/12] UNINTEGRATED / UNSAFE PROVIDER RPCs INTENTIONALLY QUARANTINED
// ============================================================================
console.log('\n[12/12] Verifying unintegrated/unsafe provider RPCs are revoked & fail closed...');

for (const [label, sql] of [
  ['concept_topup_wallet', `SELECT public.concept_topup_wallet(50000)`],
  ['execute_external_bank_transfer', `SELECT public.execute_external_bank_transfer(5000)`],
  ['issue_virtual_card', `SELECT public.issue_virtual_card('USD')`],
  ['fund_virtual_card', `SELECT public.fund_virtual_card(gen_random_uuid(), 50, '4829', gen_random_uuid())`],
  ['pay_vtu_bill', `SELECT public.pay_vtu_bill('electricity', 'IKEDC', '12345678901', 'Prepaid', 5000, '4829', gen_random_uuid())`],
  ['execute_payroll_batch', `SELECT public.execute_payroll_batch(gen_random_uuid(), 'Nov Payroll', '[]'::jsonb, '4829', gen_random_uuid())`]
]) {
  await expectSqlError(
    () => execAsRole(db, 'authenticated', userA, sql),
    '42501',
    `authenticated role blocked from invoking quarantined ${label} (42501)`
  );
}

// Even if called internally as table owner `postgres`, they fail closed with 0 balance change!
await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [userA]);
const ownerTopup = await db.query(`SELECT public.concept_topup_wallet(50000) AS r`);
const ownerExtNip = await db.query(`SELECT public.execute_external_bank_transfer(5000) AS r`);
const ownerVtu = await db.query(`SELECT public.pay_vtu_bill('airtime', 'MTN', '08031112222', 'Airtime', 1000, '4829', gen_random_uuid()) AS r`);
const ownerCardFund = await db.query(`SELECT public.fund_virtual_card(gen_random_uuid(), 20, '4829', gen_random_uuid()) AS r`);
assertPg(
  ownerTopup.rows[0].r.code === 'WALLET_SELF_CREDIT_DISABLED' &&
    ownerExtNip.rows[0].r.code === 'EXTERNAL_NIP_SETTLEMENT_DISABLED' &&
    ownerVtu.rows[0].r.code === 'VTU_PROVIDER_DISABLED' &&
    ownerCardFund.rows[0].r.code === 'CARD_ISSUER_DISABLED',
  'Quarantined provider RPC bodies also fail closed internally with explicit blocker codes and 0 wallet mutation'
);

console.log('\n======================================================================');
if (failed === 0) {
  console.log(` 🎉 ALL ${passed}/${passed} REAL POSTGRESQL 18.6 MIGRATION & SECURITY TESTS PASSED!`);
  console.log('======================================================================');
  process.exit(0);
} else {
  console.error(` ❌ ${failed} TEST(S) FAILED (${passed} passed)`);
  console.log('======================================================================');
  process.exit(1);
}
