#!/usr/bin/env node
/** Independent SQL regressions. Uses the existing local Supabase role/auth fixture only. */

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

    CREATE TABLE IF NOT EXISTS auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz);
    CREATE OR REPLACE FUNCTION auth.create_fixture_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO auth.sessions(id,user_id) VALUES(NEW.id,NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
    CREATE TRIGGER fixture_session AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION auth.create_fixture_session();

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
    await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:userId,role,session_id:userId})]);
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
const allMigrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql') && (!process.env.AUDIT_ORIGINAL_ONLY || f < '20261116060000')).sort();


const assert = (await import('node:assert/strict')).default;
let checks=0, failures=0;
async function test(label, fn) {try {await fn(); console.log('PASS '+label); checks++;} catch(e) {console.log('FAIL '+label+': '+e.message); failures++;}}
const db=await createSupabasePostgres();
if(process.env.AUDIT_EXTENSIONS_SCHEMA){await db.exec('DROP EXTENSION pgcrypto; DROP EXTENSION "uuid-ossp"; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; SET search_path=public,extensions,pg_temp;');}
for(const f of allMigrations) await db.exec(fs.readFileSync(path.join(migDir,f),'utf8'));
const uid=crypto.randomUUID();
await db.query("INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,'independent@example.test',now(),'{}')",[uid]);
const wallet=(await db.query('SELECT id FROM wallets WHERE user_id=$1',[uid])).rows[0].id;
if (!process.env.AUDIT_ORIGINAL_ONLY) await execAsRole(db,'service_role',null,"SELECT attest_verified_email($1,'independent@example.test')",[uid]);
await execAsRole(db,'authenticated',uid,"SELECT record_verified_login_session('{}')");
await execAsRole(db,'authenticated',uid,"SELECT set_user_transaction_pin('4829')");
async function pending(ref,provider='paystack') {await db.query("INSERT INTO transactions(wallet_id,user_id,type,category,amount,fee,status,reference,gateway_provider,counterparty_name) VALUES($1,$2,'inflow','deposit',1000,0,'pending',$3,$4,'Test')",[wallet,uid,ref,provider]);}
await pending('provider-confusion');
await test('deposit rejects mismatched provider without credit',async()=> {await assert.rejects(()=>execAsRole(db,'service_role',null,"SELECT settle_gateway_deposit('provider-confusion','flutterwave',1000,'gw-confusion','{}')"));});
await pending('valid-deposit');
await test('valid deposit and exact replay credit once',async()=> {await execAsRole(db,'service_role',null,"SELECT settle_gateway_deposit('valid-deposit','paystack',100000,'gw-valid','{}')"); const r=await execAsRole(db,'service_role',null,"SELECT settle_gateway_deposit('valid-deposit','paystack',100000,'gw-valid','{}') AS r"); assert.equal(r.rows[0].r.already_settled,true);});
await pending('reused-gateway');
await test('same gateway receipt cannot fund a second reference',async()=> {await assert.rejects(()=>execAsRole(db,'service_role',null,"SELECT settle_gateway_deposit('reused-gateway','paystack',100000,'gw-valid','{}')"));});
await test('bank payout SQL enforces single transfer limit',async()=> {await db.query('UPDATE wallets SET balance=100000,ledger_balance=100000 WHERE id=$1',[wallet]); await assert.rejects(()=>execAsRole(db,'service_role',null,"SELECT debit_wallet_for_payout($1,60000,0,'over-limit','paystack','Test','001','1234567890')",[uid]));});
await test('bank payout reference replay is idempotent',async()=> {await execAsRole(db,'service_role',null,"SELECT debit_wallet_for_payout($1,1000,0,'retry-safe','paystack','Test','001','1234567890')",[uid]); const before=(await db.query('SELECT balance FROM wallets WHERE id=$1',[wallet])).rows[0].balance; const r=await execAsRole(db,'service_role',null,"SELECT debit_wallet_for_payout($1,1000,0,'retry-safe','paystack','Test','001','1234567890') AS r",[uid]); assert.equal(r.rows[0].r.already_debited,true); assert.equal((await db.query('SELECT balance FROM wallets WHERE id=$1',[wallet])).rows[0].balance,before);});
await test('payout reference rejects changed payload',async()=> {await assert.rejects(()=>execAsRole(db,'service_role',null,"SELECT debit_wallet_for_payout($1,2000,0,'retry-safe','paystack','Test','001','1234567890')",[uid]));});
await test('wallet rejects SQL NaN',async()=> {await assert.rejects(()=>db.query("UPDATE wallets SET balance='NaN'::numeric WHERE id=$1",[wallet]));});
await test('transaction category is immutable',async()=> {await assert.rejects(()=>db.query("UPDATE transactions SET category='admin_credit' WHERE reference='retry-safe'"));});
await test('cross-user reads are filtered by actual RLS',async()=> {const other=crypto.randomUUID(); await db.query("INSERT INTO auth.users(id,email) VALUES($1,'other@example.test')",[other]); const r=await execAsRole(db,'authenticated',other,'SELECT id FROM wallets WHERE user_id=$1',[uid]); assert.equal(r.rows.length,0);});

await test('payout settlement rejects the wrong provider event',async()=>{await assert.rejects(()=>execAsRole(db,'service_role',null,"SELECT finalize_payout_settlement('retry-safe','gw','{\"event\":\"transfer.completed\"}')"));});
await test('settled payout can be reversed exactly once',async()=>{await execAsRole(db,'service_role',null,"SELECT finalize_payout_settlement('retry-safe','gw','{\"event\":\"transfer.success\"}')");await assert.rejects(()=>execAsRole(db,'service_role',null,"SELECT reverse_failed_payout('retry-safe','stale failure','{\"event\":\"transfer.failed\"}')"));const before=Number((await db.query('SELECT balance FROM wallets WHERE id=$1',[wallet])).rows[0].balance);await execAsRole(db,'service_role',null,"SELECT reverse_failed_payout('retry-safe','verified reversal','{\"event\":\"transfer.reversed\"}')");await execAsRole(db,'service_role',null,"SELECT reverse_failed_payout('retry-safe','verified reversal','{\"event\":\"transfer.reversed\"}')");assert.equal(Number((await db.query('SELECT balance FROM wallets WHERE id=$1',[wallet])).rows[0].balance),before+1000);});
if(process.env.AUDIT_CATALOG_PATH){const catalog={};for(const [name,sql] of Object.entries({tables:"SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename",columns:"SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",functions:"SELECT p.oid::regprocedure::text AS signature,p.prosecdef,p.proconfig,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY signature",policies:"SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",triggers:"SELECT event_object_table,trigger_name,event_manipulation,action_statement FROM information_schema.triggers WHERE trigger_schema='public' ORDER BY event_object_table,trigger_name",constraints:"SELECT c.conrelid::regclass::text AS table_name,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY table_name,c.conname"})){catalog[name]=(await db.query(sql)).rows;}fs.writeFileSync(process.env.AUDIT_CATALOG_PATH,JSON.stringify(catalog,null,2));}

await db.close();
console.log(checks+' passed; '+failures+' failed'); process.exitCode=failures?1:0;
