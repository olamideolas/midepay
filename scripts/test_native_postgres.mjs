/** Disposable native PostgreSQL concurrency tests. Never accepts a remote database URL. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.env.MIDEPAY_PG_BIN;
if(!bin)throw Error('Set MIDEPAY_PG_BIN to a native PostgreSQL bin directory.');
const exe=n=>path.join(bin,n+(process.platform==='win32'?'.exe':''));
const base=process.env.MIDEPAY_PG_TEST_ROOT||os.tmpdir();
fs.mkdirSync(base,{recursive:true});
const dir=fs.mkdtempSync(path.join(base,'midepay-isolated-pg-'));
const data=path.join(dir,'data'),log=path.join(dir,'server.log');
const server=net.createServer();await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok)});
const port=server.address().port;await new Promise(ok=>server.close(ok));
const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGDATABASE:'postgres',PGPASSWORD:'',PGSERVICE:'',PGSERVICEFILE:path.join(dir,'no-service'),PGPASSFILE:path.join(dir,'no-passfile'),PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=10000'};
function run(name,args){const r=spawnSync(exe(name),args,{env,encoding:'utf8',timeout:60000,windowsHide:true});if(r.status!==0)throw Error(`${name}: ${r.error?.message||r.stderr||r.stdout}`);return r.stdout;}
function sql(text,{allowError=false}={}){return new Promise((resolve,reject)=>{const child=spawn(exe('psql'),['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,windowsHide:true});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code&&!allowError?reject(Error(err)):resolve({code,out:out.trim(),err}));child.stdin.end(text);});}
const scalar=async text=>(await sql(text)).out.split('\n').at(-1);
const user='a0000000-0000-4000-8000-000000000001';
const asService=text=>`BEGIN;SET LOCAL ROLE service_role;${text};COMMIT;`;
const debit=ref=>asService(`SELECT debit_wallet_for_payout('${user}',1000,0,'${ref}','paystack','Test','001','0000000000')`);
let checks=0,started=false;
async function test(label,fn){await fn();checks++;console.log('PASS '+label)}
try{
 run('initdb',['-D',data,'-U','postgres','-A','trust','--encoding=UTF8','--no-locale']);
 run('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port} -c max_connections=40 -c wal_level=logical`,'-w','start']);started=true;
 console.log('Native '+await scalar('SHOW server_version;'));
 await sql(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth;CREATE SCHEMA extensions;
 CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 ALTER DATABASE postgres SET search_path=public,extensions,pg_temp;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,phone text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user::text) $$;
 GRANT USAGE ON SCHEMA public,auth,extensions TO anon,authenticated,service_role;GRANT SELECT ON auth.users TO service_role;
 CREATE PUBLICATION supabase_realtime;`);
 await test('every migration applies to native PostgreSQL with extensions in a separate schema',async()=>{
  const migrations=path.join(root,'supabase/migrations');
  for(const file of fs.readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort())await sql(fs.readFileSync(path.join(migrations,file),'utf8'));
 });
 await sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${user}','concurrency@example.invalid',now());SELECT attest_verified_email('${user}','concurrency@example.invalid');`);
 const balance=()=>scalar(`SELECT balance::text FROM wallets WHERE user_id='${user}' AND currency='NGN';`);
 // Synthetic local-only funding to isolate locking from provider behavior.
 const fund=amount=>sql(`UPDATE wallets SET balance=${amount},ledger_balance=${amount} WHERE user_id='${user}';`);
 await test('16 simultaneous requests with one payout reference debit exactly once',async()=>{
  await fund(10000);await Promise.all(Array.from({length:16},()=>sql(debit('native-same'))));
  assert.equal(await balance(),'9000.00');assert.equal(await scalar("SELECT count(*) FROM transactions WHERE reference='native-same';"),'1');
 });
 await test('20 simultaneous distinct payouts cannot overdraw a 10000 wallet',async()=>{
  await fund(10000);const results=await Promise.all(Array.from({length:20},(_,i)=>sql(debit('native-distinct-'+i),{allowError:true})));
  assert.equal(results.filter(r=>r.code===0).length,10);assert.equal(results.filter(r=>r.code!==0&&r.err.includes('Insufficient wallet balance')).length,10);
  assert.equal(await balance(),'0.00');assert.equal(await scalar("SELECT count(*) FROM transactions WHERE reference LIKE 'native-distinct-%';"),'10');
 });
 await test('16 simultaneous duplicate deposit events credit exactly once',async()=>{
  await sql(`INSERT INTO transactions(wallet_id,user_id,type,category,amount,fee,status,counterparty_name,reference,gateway_provider) SELECT id,user_id,'inflow','deposit',1000,0,'pending','Test','native-deposit','paystack' FROM wallets WHERE user_id='${user}';`);
  await Promise.all(Array.from({length:16},()=>sql(asService("SELECT settle_gateway_deposit('native-deposit','paystack',100000,'native-receipt','{}')"))));
  assert.equal(await balance(),'1000.00');
 });
 await test('16 simultaneous verified payout reversals refund exactly once',async()=>{
  await Promise.all(Array.from({length:16},()=>sql(asService(`SELECT reverse_failed_payout('native-same','test','{"event":"transfer.failed"}')`))));
  assert.equal(await balance(),'2000.00');
 });
 await test('changed payload under a concurrent idempotency key cannot replace the original debit',async()=>{
  const r=await sql(asService(`SELECT debit_wallet_for_payout('${user}',2000,0,'native-same','paystack','Test','001','0000000000')`),{allowError:true});
  assert.notEqual(r.code,0);assert.match(r.err,/IDEMPOTENCY_CONFLICT/);assert.equal(await balance(),'2000.00');
 });
 await test('client roles cannot call service-only financial settlement APIs',async()=>{
  for(const role of ['anon','authenticated']){const r=await sql(`SET ROLE ${role};SELECT settle_gateway_deposit('native-deposit','paystack',100000,'native-receipt','{}');`,{allowError:true});assert.notEqual(r.code,0);assert.match(r.err,/permission denied/);}
 });
 console.log(`${checks} passed; 0 failed`);
}finally{
 if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
 console.log((started?'Isolated database stopped':'Database did not start')+'; evidence directory: '+dir);
}
