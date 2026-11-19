/** Disposable PostgreSQL-compatible database; no hosted database or provider calls. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const moduleDir=[process.env.PGLITE_MODULE_DIR,path.join(root,'node_modules/@electric-sql/pglite'),'C:/Users/TestAdmin/.gemini/antigravity/brain/785ef751-b351-4fc4-b6e5-d3735bf5e0d6/scratch/pgtest/node_modules/@electric-sql/pglite'].find(p=>p&&fs.existsSync(path.join(p,'dist/index.js')));
if(!moduleDir)throw Error('Install the pinned PGlite dependency before running this test.');
const {PGlite}=await import(pathToFileURL(path.join(moduleDir,'dist/index.js')));
const {pgcrypto}=await import(pathToFileURL(path.join(moduleDir,'dist/contrib/pgcrypto.js')));
const {uuid_ossp}=await import(pathToFileURL(path.join(moduleDir,'dist/contrib/uuid_ossp.js')));
const db=new PGlite({extensions:{pgcrypto,uuid_ossp}});
let pass=0,fail=0;
async function test(name,fn){await db.exec('BEGIN');try{await fn();await db.exec('COMMIT');pass++;console.log('PASS '+name)}catch(e){await db.exec('ROLLBACK');fail++;console.error('FAIL '+name+': '+e.message)}}
async function rejects(fn,pattern){await db.exec('SAVEPOINT expected_failure');try{await assert.rejects(fn,pattern)}finally{await db.exec('ROLLBACK TO SAVEPOINT expected_failure; RELEASE SAVEPOINT expected_failure')}}
const user=crypto.randomUUID();
const settle=(ref,amount,receipt=ref,provider='paystack')=>db.query('SELECT settle_gateway_deposit($1,$2,$3,$4) AS result',[ref,provider,amount,receipt]);
const deposit=async(amount=100,fee=0)=>{const ref='ACCOUNTING-'+crypto.randomUUID();await db.query("INSERT INTO transactions(wallet_id,user_id,type,category,amount,fee,status,counterparty_name,reference,gateway_provider) SELECT id,user_id,'inflow','deposit',$2,$3,'pending','Synthetic accounting',$4,'paystack' FROM wallets WHERE user_id=$1",[user,amount,fee,ref]);return ref};
const payout=(ref,amount=100,fee=2.50)=>db.query("SELECT debit_wallet_for_payout($1,$2,$3,$4,'paystack','Synthetic','001','0000000000') AS result",[user,amount,fee,ref]);
const balances=async()=>(await db.query('SELECT balance,ledger_balance FROM wallets WHERE user_id=$1',[user])).rows[0];
const reconciles=async()=>assert.equal((await db.query('SELECT verify_wallet_ledger_reconciliation(id) AS result FROM wallets WHERE user_id=$1',[user])).rows[0].result.ok,true);
try{
 await db.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION "uuid-ossp";CREATE EXTENSION pgcrypto;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,phone text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user::text) $$;
 GRANT USAGE ON SCHEMA public,auth,extensions TO anon,authenticated,service_role;GRANT SELECT ON auth.users TO service_role;CREATE PUBLICATION supabase_realtime;`);
 for(const file of fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
 await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'accounting@example.invalid',now())",[user]);
 await db.query("SELECT attest_verified_email($1,'accounting@example.invalid')",[user]);
 await db.exec('SET ROLE service_role');
 await test('signed settlement amount must exactly match the pending deposit',async()=>{const ref=await deposit();const before=await balances();await rejects(()=>settle(ref,10001),/amount mismatch/i);assert.deepEqual(await balances(),before)});
 await test('direct settlement rejects fractional kobo before any rounding',async()=>{const ref=await deposit();const before=await balances();await rejects(()=>settle(ref,9999.9),/INVALID_GATEWAY_AMOUNT/);assert.deepEqual(await balances(),before)});
 await test('non-finite, null and nonpositive gateway amounts cannot settle',async()=>{const ref=await deposit();const before=await balances();for(const amount of ['NaN','Infinity','-Infinity',null,0,-100])await rejects(()=>settle(ref,amount));assert.deepEqual(await balances(),before)});
 await test('a deposit with an unsupported customer fee cannot corrupt reconciliation',async()=>{const ref=await deposit(100,1.5);const before=await balances();await rejects(()=>settle(ref,10000),/DEPOSIT_FEE_POLICY_UNSUPPORTED/);assert.deepEqual(await balances(),before)});
 const funded=await deposit(1000);
 await test('exact receipt settles the full customer amount once and reconciles',async()=>{await settle(funded,100000);const before=await balances();assert.equal(Number(before.balance),1000);assert.equal((await settle(funded,100000)).rows[0].result.already_settled,true);assert.deepEqual(await balances(),before);await reconciles()});
 await test('replay with a different receipt or amount is an idempotency conflict',async()=>{const before=await balances();await rejects(()=>settle(funded,100000,'different-receipt'),/GATEWAY_RECEIPT_CONFLICT/);await rejects(()=>settle(funded,100001),/amount mismatch/i);assert.deepEqual(await balances(),before)});
 await test('payout rejects negative and fractional fees instead of clamping or rounding',async()=>{const before=await balances();for(const fee of [-1,0.001,2.509,'NaN','Infinity','-Infinity'])await rejects(()=>payout('INVALID-'+crypto.randomUUID(),100,fee),/INVALID_PAYOUT_AMOUNT_OR_FEE/);assert.deepEqual(await balances(),before)});
 await test('payout rejects fractional principal before touching the wallet',async()=>{const before=await balances();await rejects(()=>payout('BAD-PRINCIPAL',100.001),/INVALID_PAYOUT_AMOUNT_OR_FEE/);assert.deepEqual(await balances(),before)});
 const ref='FEE-PAYOUT-'+crypto.randomUUID();
 await test('payout reserves principal plus fee and reconciles while pending',async()=>{await payout(ref);assert.equal(Number((await balances()).balance),897.5);await reconciles();await payout(ref);assert.equal(Number((await balances()).balance),897.5)});
 await test('a failed payout refunds principal and fee exactly once',async()=>{const payload=JSON.stringify({event:'transfer.failed'});for(let i=0;i<3;i++)await db.query('SELECT reverse_failed_payout($1,$2,$3)',[ref,'Synthetic test failure',payload]);assert.equal(Number((await balances()).balance),1000);await reconciles();assert.equal(Number((await db.query("SELECT count(*) AS n FROM audit_logs WHERE action='REVERSE_FAILED_PAYOUT'")).rows[0].n),1)});
 await test('reusing a payout reference with a different fee cannot debit again',async()=>{const before=await balances();await rejects(()=>payout(ref,100,3),/IDEMPOTENCY_CONFLICT/);assert.deepEqual(await balances(),before)});
 await test('wallet clients cannot call settlement or payout refund functions',async()=>{await db.exec('RESET ROLE');for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await rejects(()=>settle(funded,100000),/permission denied/);await rejects(()=>db.query('SELECT reverse_failed_payout($1)',[ref]),/permission denied/);await db.exec('RESET ROLE')}});
 console.log(`${pass} passed; ${fail} failed`);process.exitCode=fail?1:0;
}finally{await db.close()}
