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
const allMigrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql') && (!process.env.AUDIT_ORIGINAL_ONLY || f < '20261116060000')).sort();


﻿const assert=(await import('node:assert/strict')).default;
let pass=0;
async function test(name,fn){await fn();pass++;console.log('PASS '+name);}
const db=await createSupabasePostgres();
if(process.env.AUDIT_EXTENSIONS_SCHEMA) await db.exec('DROP EXTENSION pgcrypto; DROP EXTENSION "uuid-ossp"; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; SET search_path=public,extensions,pg_temp;');
const legacy=crypto.randomUUID();
for(const file of allMigrations) {
 if(file.startsWith('20261116070000')) {
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'legacy@phase1.test',now())",[legacy]);
  await execAsRole(db,'authenticated',legacy,"SELECT record_verified_login_session('{}')");
  await db.query("INSERT INTO transactions(wallet_id,user_id,type,category,amount,fee,status,counterparty_name,reference,gateway_provider) SELECT id,user_id,'inflow','deposit',2500,0,'pending','Gateway fixture','LEGACY-PHASE1-FUND','paystack' FROM wallets WHERE user_id=$1",[legacy]);
  await execAsRole(db,'service_role',null,"SELECT settle_gateway_deposit('LEGACY-PHASE1-FUND','paystack',250000,'LEGACY-RECEIPT','{}')");
 }
 await db.exec(fs.readFileSync(path.join(migDir,file),'utf8'));
}
await test('upgrade invalidates legacy self-attestation while preserving settled funds',async()=>{
 const row=(await db.query('SELECT p.email_otp_verified_at,w.balance FROM profiles p JOIN wallets w ON w.user_id=p.id WHERE p.id=$1',[legacy])).rows[0];
 assert.equal(row.email_otp_verified_at,null);assert.equal(row.balance,'2500.00');
 const r=await execAsRole(db,'authenticated',legacy,"SELECT record_verified_login_session('{}') AS r");assert.equal(r.rows[0].r.code,'EMAIL_OTP_REQUIRED');
});
const ids=Object.fromEntries(['maker','checker','target','treasury','outsider'].map(k=>[k,crypto.randomUUID()]));
for(const [name,id] of Object.entries(ids))await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",[id,name+'@phase1.test']);
async function call(name,sql,params=[],claims={}){return db.transaction(async tx=>{
 await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)",[ids[name],JSON.stringify({sub:ids[name],role:'authenticated',...claims})]);
 await tx.exec('SET LOCAL ROLE authenticated');return tx.query(sql,params);
});}
const fresh=()=>({aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]});
await test('autoconfirm and caller metadata cannot create email proof',async()=>{const r=await call('target',"SELECT record_verified_login_session('{\"verified\":true,\"otp_verified\":true}') AS r");assert.equal(r.rows[0].r.code,'EMAIL_OTP_REQUIRED');assert.equal((await db.query('SELECT email_otp_verified_at FROM profiles WHERE id=$1',[ids.target])).rows[0].email_otp_verified_at,null);});
await test('client cannot invoke the server email-attestation RPC',async()=>{await assert.rejects(()=>call('target',"SELECT attest_verified_email($1,'target@phase1.test')",[ids.target]),e=>e.code==='42501')});
await test('client cannot write private proof records',async()=>{await assert.rejects(()=>call('target','INSERT INTO private.email_verification_proofs(user_id,email,auth_confirmed_at) VALUES($1,$2,now())',[ids.target,'target@phase1.test']),e=>e.code==='42501')});
await test('PIN onboarding rejects confirmed email without proof',async()=>{const r=await call('target',"SELECT set_user_transaction_pin('4829') AS r");assert.equal(r.rows[0].r.code,'EMAIL_NOT_VERIFIED')});
await test('attestation rejects a mismatched verified email',async()=>{await assert.rejects(()=>execAsRole(db,'service_role',null,"SELECT attest_verified_email($1,'wrong@phase1.test')",[ids.target]),e=>e.message.includes('MISMATCH'))});
for(const [name,id] of Object.entries(ids))await execAsRole(db,'service_role',null,'SELECT attest_verified_email($1,$2)',[id,name+'@phase1.test']);
for(const name of ['maker','checker','outsider'])await call(name,"SELECT set_user_transaction_pin('4829')");
await db.query("UPDATE profiles SET role='executive' WHERE id IN ($1,$2)",[ids.maker,ids.checker]);
await test('server proof permits login and PIN onboarding',async()=>{assert.equal((await call('target',"SELECT record_verified_login_session('{}') AS r")).rows[0].r.success,true);assert.equal((await call('target',"SELECT set_user_transaction_pin('4829') AS r")).rows[0].r.success,true)});
await test('changing email invalidates proof despite an old profile timestamp',async()=>{await db.query("UPDATE auth.users SET email='changed@phase1.test' WHERE id=$1",[ids.target]);assert.equal((await call('target','SELECT get_email_verification_status() AS r')).rows[0].r.verified,false);assert.equal((await call('target',"SELECT verify_user_transaction_pin('4829') AS r")).rows[0].r.code,'EMAIL_NOT_VERIFIED');await db.query("UPDATE auth.users SET email='target@phase1.test' WHERE id=$1",[ids.target]);});
await test('email OTP limiter blocks the sixth attempt and resets after expiry',async()=>{for(let i=1;i<=6;i++){const r=await execAsRole(db,'service_role',null,"SELECT consume_email_otp_attempt('limit@phase1.test') AS r");assert.equal(r.rows[0].r.allowed,i<=5)}await db.exec("UPDATE private.email_otp_attempts SET window_start=now()-INTERVAL '11 minutes'");assert.equal((await execAsRole(db,'service_role',null,"SELECT consume_email_otp_attempt('limit@phase1.test') AS r")).rows[0].r.allowed,true)});
await test('client cannot invoke the email attempt limiter',async()=>{await assert.rejects(()=>call('target',"SELECT consume_email_otp_attempt('limit@phase1.test')"),e=>e.code==='42501')});
const wallets={};for(const [name,id]of Object.entries(ids))wallets[name]=(await db.query("SELECT id FROM wallets WHERE user_id=$1 AND currency='NGN'",[id])).rows[0].id;
await db.query("INSERT INTO transactions(wallet_id,user_id,type,category,amount,fee,status,counterparty_name,reference,gateway_provider) VALUES($1,$2,'inflow','deposit',20000,0,'pending','Test gateway','PHASE1-TREASURY-FUND','paystack')",[wallets.treasury,ids.treasury]);
await execAsRole(db,'service_role',null,"SELECT settle_gateway_deposit('PHASE1-TREASURY-FUND','paystack',2000000,'PHASE1-RECEIPT','{}')");
const reqSql='SELECT request_treasury_credit($1,$2,$3,$4,$5,$6) AS r';
async function request(name='maker',amount=1000,key=crypto.randomUUID(),claims=fresh(),pin='4829',source=wallets.treasury,target=ids.target,reason='Approved support adjustment'){return (await call(name,reqSql,[source,target,amount,reason,key,pin],claims)).rows[0].r;}
await test('legacy direct mint is denied even for executives and server role',async()=>{await assert.rejects(()=>call('maker',"SELECT admin_credit_wallet($1,1000,'unsafe mint',gen_random_uuid())",[ids.target],fresh()),e=>e.code==='42501');await assert.rejects(()=>execAsRole(db,'service_role',null,"SELECT admin_credit_wallet($1,1000,'unsafe mint',gen_random_uuid())",[ids.target]),e=>e.code==='42501');assert.equal((await db.query("SELECT admin_credit_wallet($1,1000,'owner bypass',gen_random_uuid()) AS r",[ids.target])).rows[0].r.code,'TREASURY_APPROVAL_REQUIRED')});
await test('treasury source is empty and unconfigured by default',async()=>{assert.equal((await request()).code,'TREASURY_SOURCE_DISABLED');assert.equal((await db.query('SELECT count(*)::int AS n FROM private.treasury_wallets')).rows[0].n,0)});
await db.query("INSERT INTO private.treasury_wallets(wallet_id,label) VALUES($1,'Dedicated test treasury')",[wallets.treasury]);
await test('designated treasury identity cannot bypass approval through personal APIs',async()=>{const pin=await call('treasury',"SELECT set_user_transaction_pin('4829') AS r");assert.equal(pin.rows[0].r.success,true);const rpc=await call('treasury',"SELECT execute_p2p_transfer($1,1000,'4829',gen_random_uuid()) AS r",[(await db.query('SELECT nuban FROM wallets WHERE id=$1',[wallets.target])).rows[0].nuban]);assert.equal(rpc.rows[0].r.code,'TREASURY_ACCOUNT_RESTRICTED');await assert.rejects(()=>execAsRole(db,'service_role',null,"SELECT debit_wallet_for_payout($1,1000,0,'BYPASS','paystack','Test','001','1234567890')",[ids.treasury]),e=>e.message.includes('TREASURY_ACCOUNT_RESTRICTED'))});
await test('ordinary account cannot request treasury credits',async()=>{assert.equal((await request('outsider')).code,'FORBIDDEN')});
await test('executive requires fresh signed authenticator evidence',async()=>{assert.equal((await request('maker',1000,crypto.randomUUID(),{aal:'aal1'})).code,'MFA_REQUIRED');assert.equal((await request('maker',1000,crypto.randomUUID(),{aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-601}]})).code,'MFA_REQUIRED');assert.equal((await request('maker',1000,crypto.randomUUID(),{aal:'aal2',amr:[{method:'otp',timestamp:Math.floor(Date.now()/1000)}]})).code,'MFA_REQUIRED');assert.equal((await request('maker',1000,crypto.randomUUID(),{aal:'aal2',amr:[{method:'totp',timestamp:'NaN'}]})).code,'MFA_REQUIRED')});
await test('treasury wrong PIN strikes persist without request or debit',async()=>{const before=(await db.query('SELECT balance FROM wallets WHERE id=$1',[wallets.treasury])).rows[0].balance;assert.equal((await request('maker',1000,crypto.randomUUID(),fresh(),'0000')).code,'INVALID_PIN');assert.equal((await db.query('SELECT pin_failed_attempts FROM profiles WHERE id=$1',[ids.maker])).rows[0].pin_failed_attempts,1);assert.equal((await db.query('SELECT balance FROM wallets WHERE id=$1',[wallets.treasury])).rows[0].balance,before)});
await test('self-credit and executive recipients are rejected',async()=>{assert.equal((await request('maker',1000,crypto.randomUUID(),fresh(),'4829',wallets.treasury,ids.maker)).code,'INVALID_RECIPIENT');assert.equal((await request('maker',1000,crypto.randomUUID(),fresh(),'4829',wallets.treasury,ids.checker)).code,'INVALID_RECIPIENT')});
await test('NaN, negative and fractional sub-kobo requests are rejected',async()=>{for(const amount of ['NaN',-1,0,0.001])assert.equal((await request('maker',amount)).code,'INVALID_REQUEST')});
const key=crypto.randomUUID();const pending=await request('maker',1000,key);assert.equal(pending.success,true);
await test('request key is mandatory, stable on replay and bound to payload',async()=>{assert.equal((await request('maker',1000,null)).code,'INVALID_REQUEST');const replay=await request('maker',1000,key);assert.equal(replay.status,'duplicate');assert.equal(replay.request_id,pending.request_id);assert.equal((await request('maker',2000,key)).code,'IDEMPOTENCY_CONFLICT');assert.equal((await db.query('SELECT balance FROM wallets WHERE id=$1',[wallets.target])).rows[0].balance,'0.00')});
const approve=(name,id,claims=fresh(),pin='4829')=>call(name,'SELECT approve_treasury_credit($1,$2) AS r',[id,pin],claims).then(r=>r.rows[0].r);
await test('maker cannot approve own request',async()=>{assert.equal((await approve('maker',pending.request_id)).code,'SEPARATION_OF_DUTIES')});
await test('checker must independently satisfy MFA and PIN',async()=>{assert.equal((await approve('checker',pending.request_id,{aal:'aal1'})).code,'MFA_REQUIRED');assert.equal((await approve('checker',pending.request_id,fresh(),'0000')).code,'INVALID_PIN')});
await test('approval moves funded money once and conserves ledger totals',async()=>{assert.equal((await approve('checker',pending.request_id)).status,'approved');assert.equal((await approve('checker',pending.request_id)).status,'duplicate');const src=(await db.query('SELECT balance,ledger_balance FROM wallets WHERE id=$1',[wallets.treasury])).rows[0];const dst=(await db.query('SELECT balance,ledger_balance FROM wallets WHERE id=$1',[wallets.target])).rows[0];assert.equal(Number(src.balance),19000);assert.equal(Number(dst.balance),1000);assert.equal(Number(src.balance)+Number(dst.balance),20000);for(const w of [wallets.treasury,wallets.target])assert.equal((await db.query('SELECT verify_wallet_ledger_reconciliation($1) AS r',[w])).rows[0].r.ok,true)});
await test('insufficient reserve cannot partially credit the recipient',async()=>{const q=await request('maker',20000);assert.equal((await approve('checker',q.request_id)).code,'INSUFFICIENT_TREASURY_FUNDS');assert.equal((await db.query('SELECT balance FROM wallets WHERE id=$1',[wallets.target])).rows[0].balance,'1000.00')});
await test('unreconciled treasury funds cannot be disbursed',async()=>{const q=await request();await db.query('UPDATE wallets SET balance=balance+1,ledger_balance=ledger_balance+1 WHERE id=$1',[wallets.treasury]);assert.equal((await approve('checker',q.request_id)).code,'LEDGER_RECONCILIATION_REQUIRED');await db.query('UPDATE wallets SET balance=balance-1,ledger_balance=ledger_balance-1 WHERE id=$1',[wallets.treasury])});
await test('disabled treasury source blocks pending approval',async()=>{const q=await request();await db.query('UPDATE private.treasury_wallets SET enabled=false');assert.equal((await approve('checker',q.request_id)).code,'TREASURY_SOURCE_DISABLED');await db.query('UPDATE private.treasury_wallets SET enabled=true')});
await test('expired requests cannot settle',async()=>{const q=await request();await db.query("UPDATE private.treasury_credit_requests SET expires_at=now()-INTERVAL '1 second' WHERE id=$1",[q.request_id]);assert.equal((await approve('checker',q.request_id)).code,'REQUEST_NOT_PENDING')});
await test('only maker can cancel and cancelled requests cannot settle',async()=>{const q=await request();assert.equal((await call('checker','SELECT cancel_treasury_credit($1,$2) AS r',[q.request_id,'4829'],fresh())).rows[0].r.code,'NOT_PENDING_OR_NOT_MAKER');assert.equal((await call('maker','SELECT cancel_treasury_credit($1,$2) AS r',[q.request_id,'4829'],fresh())).rows[0].r.status,'cancelled');assert.equal((await approve('checker',q.request_id)).code,'REQUEST_NOT_PENDING')});
await test('frozen maker is rechecked at approval',async()=>{const q=await request();await db.query('UPDATE profiles SET is_frozen=true WHERE id=$1',[ids.maker]);assert.equal((await approve('checker',q.request_id)).code,'MAKER_NOT_AUTHORIZED');await db.query('UPDATE profiles SET is_frozen=false WHERE id=$1',[ids.maker])});
await test('compliance freeze flags cannot be bypassed by inconsistent legacy booleans',async()=>{const q=await request();await db.query('UPDATE profiles SET frozen_by_admin=true,is_frozen=false WHERE id=$1',[ids.maker]);assert.equal((await approve('checker',q.request_id)).code,'MAKER_NOT_AUTHORIZED');await db.query('UPDATE profiles SET frozen_by_admin=false WHERE id=$1',[ids.maker]);await db.query('UPDATE profiles SET frozen_by_admin=true,is_frozen=false WHERE id=$1',[ids.target]);assert.equal((await approve('checker',q.request_id)).code,'INVALID_RECIPIENT');await db.query('UPDATE profiles SET frozen_by_admin=false WHERE id=$1',[ids.target])});
await test('treasury queue is restricted and strips idempotency payloads',async()=>{assert.equal((await call('target','SELECT get_treasury_credit_queue() AS r')).rows[0].r.code,'FORBIDDEN');const r=(await call('maker','SELECT get_treasury_credit_queue() AS r')).rows[0].r;assert.equal(r.success,true);assert.ok(r.requests.length>0);assert.equal(r.requests[0].payload_hash,undefined);assert.equal(r.requests[0].idempotency_key,undefined)});
await test('client cannot mutate treasury allowlist or request table',async()=>{for(const table of ['treasury_wallets','treasury_credit_requests'])await assert.rejects(()=>call('maker',`DELETE FROM private.${table}`),e=>e.code==='42501')});
await test('all proof and treasury SECURITY DEFINER functions pin their search path',async()=>{const result=await db.query("SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND prosecdef AND NOT ('search_path=public, extensions, pg_temp'=ANY(COALESCE(proconfig,ARRAY[]::text[])))");assert.equal(result.rows.length,0,JSON.stringify(result.rows))});
if(process.env.AUDIT_PRIVATE_CATALOG_PATH){const tables=(await db.query("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='private' ORDER BY tablename")).rows;assert.equal(tables.length,4);assert.ok(tables.every(t=>t.rowsecurity));const privileges=(await db.query("SELECT c.relname,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS client_access,has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS server_direct_access FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relkind='r'")).rows;assert.ok(privileges.every(t=>!t.client_access&&!t.server_direct_access));fs.writeFileSync(process.env.AUDIT_PRIVATE_CATALOG_PATH,JSON.stringify({tables,privileges},null,2));}
await db.close();console.log(`${pass} passed; 0 failed`);
