/** Disposable native PostgreSQL concurrency tests. Never accepts a remote database URL. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const pgModule=await import(process.env.MIDEPAY_PG_MODULE ? pathToFileURL(process.env.MIDEPAY_PG_MODULE).href : 'pg');
const {Client}=pgModule.default||pgModule;
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
function run(name,args){const r=spawnSync(exe(name),args,{env,encoding:'utf8',timeout:60000,windowsHide:true});if(r.status!==0){const serverLog=name==='pg_ctl'&&fs.existsSync(log)?'\n'+fs.readFileSync(log,'utf8'):'';throw Error(`${name}: ${r.error?.message||r.stderr||r.stdout}${serverLog}`);}return r.stdout;}
async function sql(text,{allowError=false}={}){
 const client=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,options:'-c lock_timeout=10000'});
 try{await client.connect();const raw=await client.query(text);const results=Array.isArray(raw)?raw:[raw];const out=results.flatMap(r=>r.rows||[]).map(row=>Object.values(row).map(v=>v===null?'':typeof v==='object'?JSON.stringify(v):String(v)).join('|')).join('\n');return{code:0,out,err:''};}
 catch(e){if(!allowError)throw e;return{code:1,out:'',err:e.message};}
 finally{await client.end().catch(()=>{});}
}
const scalar=async text=>(await sql(text)).out.split('\n').at(-1);
const user='a0000000-0000-4000-8000-000000000001';
const asService=text=>`BEGIN;SET LOCAL ROLE service_role;${text};COMMIT;`;
const debit=ref=>asService(`SELECT debit_wallet_for_payout('${user}',1000,0,'${ref}','paystack','Test','001','0000000000')`);
let checks=0,started=false;
async function test(label,fn){await fn();checks++;console.log('PASS '+label)}
try{
 run('initdb',['-D',data,'-U','postgres','-A','trust','--encoding=UTF8','--no-locale']);
 // Linux packages default to a system-owned Unix socket directory. All tests use TCP.
 const socketOption=process.platform==='win32'?'':" -c unix_socket_directories=''";
 run('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port} -c max_connections=40 -c wal_level=logical${socketOption}`,'-w','start']);started=true;
 console.log('Native '+await scalar('SHOW server_version;'));
 await test('independent PostgreSQL sessions actually overlap',async()=>{
  const probes=await Promise.all(Array.from({length:8},()=>sql("SELECT json_build_object('pid',pg_backend_pid(),'started',clock_timestamp())::text;SELECT pg_sleep(0.5);SELECT clock_timestamp()::text;")));
  const windows=probes.map(r=>{const lines=r.out.split('\n');const a=JSON.parse(lines[0]);return{pid:a.pid,start:Date.parse(a.started),end:Date.parse(lines.at(-1))}});
  assert.equal(new Set(windows.map(x=>x.pid)).size,8);
  assert.ok(windows.some((a,i)=>windows.some((b,j)=>i!==j&&Math.max(a.start,b.start)<Math.min(a.end,b.end))));
  fs.writeFileSync(path.join(dir,'overlap-evidence.json'),JSON.stringify(windows,null,2));
 });
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
  await fund(10000);
  const blocker=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:5000});
  await blocker.connect();let pending;let observed=0;
  try{
   await blocker.query(`BEGIN;SELECT id FROM wallets WHERE user_id='${user}' FOR UPDATE;`);
   pending=Promise.all(Array.from({length:16},()=>sql(debit('native-same'))));
   // Attach rejection handling immediately while the coordinator inspects lock waits.
   pending.catch(()=>{});
   for(let i=0;i<100;i++){
    observed=Number(await scalar("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE '%native-same%' AND state='active' AND wait_event_type='Lock';"));
    if(observed>=2)break;
    await new Promise(resolve=>setTimeout(resolve,25));
   }
   fs.writeFileSync(path.join(dir,'financial-lock-evidence.json'),JSON.stringify({blockedFinancialSessions:observed}));
  }finally{await blocker.query('ROLLBACK').catch(()=>{});await blocker.end();}
  await pending;assert.ok(observed>=2,'Financial calls must demonstrably wait concurrently on PostgreSQL locks');
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
 await test('16 simultaneous refund deliveries retain exactly one case and event without wallet changes',async()=>{
  const before=await balance();
  const payload=JSON.stringify({id:90001,domain:'test',transaction:{reference:'native-deposit'},currency:'NGN',amount:1000,status:'processed'});
  await Promise.all(Array.from({length:16},()=>sql(asService(`SELECT record_paystack_case_event('refund.processed','${payload}'::jsonb)`))));
  assert.equal(await scalar("SELECT count(*) FROM private.payment_provider_cases WHERE provider_case_id='90001';"),'1');
  assert.equal(await scalar("SELECT count(*) FROM private.payment_provider_case_events e JOIN private.payment_provider_cases c ON c.id=e.case_id WHERE c.provider_case_id='90001';"),'1');
  assert.equal(await balance(),before);
 });
 await test('16 concurrent verified fee observations deduplicate without crediting again',async()=>{
  const before=await balance();
  await Promise.all(Array.from({length:16},()=>sql(asService(`SELECT settle_gateway_deposit('native-deposit','paystack',100000,'native-receipt','{"event":"charge.success","data":{"domain":"test","fees":1500}}')`))));
  assert.equal(await scalar("SELECT count(*) FROM private.payment_charge_observations WHERE gateway_receipt='native-receipt' AND fee_kobo=1500;"),'1');
  assert.equal(await balance(),before);
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

 const alice='b0000000-0000-4000-8000-000000000001',bob='b0000000-0000-4000-8000-000000000002';
 for(const [id,email] of [[alice,'alice@example.invalid'],[bob,'bob@example.invalid']]){
  await sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${id}','${email}',now());SELECT attest_verified_email('${id}','${email}');`);
  const setup=await sql(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${id}';SELECT set_user_transaction_pin('4829');COMMIT;`);
  assert.ok(setup.out.includes('"success":true'));
 }
 const p2p=(sender,recipient,key)=>`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${sender}';SELECT transfer_funds('${sender}','${recipient}',1000,'Native test','4829','${key}');COMMIT;`;
 const bal=id=>scalar(`SELECT balance::text FROM wallets WHERE user_id='${id}' AND currency='NGN';`);
 const reset=()=>sql(`UPDATE wallets SET balance=10000,ledger_balance=10000 WHERE user_id IN ('${alice}','${bob}');`);
 const result=r=>JSON.parse(r.out.split('\n').at(-1));
 await test('16 duplicate P2P requests create exactly one paired transfer',async()=>{
  await reset();const key='c0000000-0000-4000-8000-000000000001';
  const rows=await Promise.all(Array.from({length:16},()=>sql(p2p(alice,bob,key))));
  assert.ok(rows.every(r=>result(r).success===true));assert.equal(await bal(alice),'9000.00');assert.equal(await bal(bob),'11000.00');
  assert.equal(await scalar(`SELECT count(*) FROM transactions WHERE idempotency_key='${key}';`),'1');
  assert.equal(await scalar(`SELECT count(*) FROM transactions WHERE user_id IN ('${alice}','${bob}');`),'2');
 });
 await test('20 distinct P2P requests cannot overspend the sender wallet',async()=>{
  await reset();const rows=await Promise.all(Array.from({length:20},(_,i)=>sql(p2p(alice,bob,'d0000000-0000-4000-8000-'+String(i+1).padStart(12,'0')))));
  const values=rows.map(result);assert.equal(values.filter(r=>r.success===true).length,10);assert.equal(values.filter(r=>r.code==='INSUFFICIENT_FUNDS').length,10);
  assert.equal(await bal(alice),'0.00');assert.equal(await bal(bob),'20000.00');
 });
 await test('opposing P2P transfers complete without deadlocks and conserve money',async()=>{
  await reset();const rows=await Promise.all(Array.from({length:20},(_,i)=>sql(p2p(i%2?alice:bob,i%2?bob:alice,'e0000000-0000-4000-8000-'+String(i+1).padStart(12,'0')),{allowError:true})));
  fs.writeFileSync(path.join(dir,'opposing-p2p-results.json'),JSON.stringify(rows,null,2));
  assert.ok(rows.every(r=>r.code===0&&result(r).success===true),JSON.stringify(rows.filter(r=>r.code!==0||!result(r).success)));
  assert.equal(await bal(alice),'10000.00');assert.equal(await bal(bob),'10000.00');
  assert.equal(await scalar(`SELECT count(*) FROM wallets WHERE user_id IN ('${alice}','${bob}') AND (balance<0 OR balance<>ledger_balance);`),'0');
 });

 await test('parallel recovery workers claim every synthetic job at most once',async()=>{
  for(let i=0;i<10;i++)await sql(`INSERT INTO transactions(wallet_id,user_id,type,category,amount,fee,status,counterparty_name,reference,gateway_provider,created_at) SELECT id,user_id,'inflow','deposit',1000,0,'pending','Synthetic','MDP-PSK-NATIVE-RECOVERY-${i}','paystack',now()-interval '1 minute' FROM wallets WHERE user_id='${user}';`);
  const results=await Promise.all(Array.from({length:8},()=>sql(asService('SELECT claim_payment_reconciliation(5)'))));
  const claimed=results.flatMap(r=>JSON.parse(r.out.split('\n').at(-1)));
  assert.equal(new Set(claimed.map(j=>j.transaction_id)).size,claimed.length);
  const targets=claimed.filter(j=>j.reference.startsWith('MDP-PSK-NATIVE-RECOVERY-'));assert.equal(targets.length,10);
  fs.writeFileSync(path.join(dir,'recovery-claim-evidence.json'),JSON.stringify(claimed,null,2));
  const job=targets[0];await sql(`UPDATE private.payment_reconciliation_jobs SET leased_until=now()-interval '1 second' WHERE transaction_id='${job.transaction_id}';`);
  const next=JSON.parse((await sql(asService('SELECT claim_payment_reconciliation(5)'))).out.split('\n').at(-1));
  assert.ok(next.some(j=>j.transaction_id===job.transaction_id&&j.lease_token!==job.lease_token));
  const stale=JSON.parse((await sql(asService(`SELECT finish_payment_reconciliation('${job.transaction_id}','${job.lease_token}','retry','TEST')`))).out.split('\n').at(-1));assert.equal(stale.code,'STALE_LEASE');
 });
 await test('client roles cannot authorize or claim recovery jobs',async()=>{
  for(const role of ['anon','authenticated'])for(const call of ["authorize_payment_reconciliation('wrong')",'claim_payment_reconciliation(5)']){
   const r=await sql(`SET ROLE ${role};SELECT ${call};`,{allowError:true});assert.notEqual(r.code,0);assert.match(r.err,/permission denied/);
  }
 });

 await sql("INSERT INTO private.payment_reconciliation_control(singleton,enabled,signing_key,payout_dispatch_enabled) VALUES(true,true,gen_random_bytes(32),true) ON CONFLICT(singleton) DO UPDATE SET enabled=true,payout_dispatch_enabled=true;");
 const nativeEnqueue=async suffix=>{
  await fund(10000);const result=JSON.parse((await sql(asService(`SELECT enqueue_wallet_payout('${user}',1000,0,'MDP-OUT-NATIVE-${suffix}','paystack','Test','001','0000000000')`))).out.split('\n').at(-1));
  const jobs=JSON.parse((await sql(asService('SELECT claim_payout_dispatch()'))).out.split('\n').at(-1));return jobs.find(j=>j.transaction_id===result.tx_id);
 };
 await test('parallel dispatch claims grant exactly one worker a payout',async()=>{
  await fund(10000);await sql(asService(`SELECT enqueue_wallet_payout('${user}',1000,0,'MDP-OUT-NATIVE-CLAIM','paystack','Test','001','0000000000')`));
  const rows=await Promise.all(Array.from({length:8},()=>sql(asService('SELECT claim_payout_dispatch()'))));const jobs=rows.flatMap(r=>JSON.parse(r.out.split('\n').at(-1)));
  assert.equal(jobs.length,1);const job=jobs[0];
  const gates=await Promise.all(Array.from({length:16},()=>sql(asService(`SELECT begin_payout_dispatch('${job.transaction_id}','${job.lease_token}','RCP_NATIVE')`))));
  assert.equal(gates.map(r=>JSON.parse(r.out.split('\n').at(-1))).filter(r=>r.success===true).length,1);
 });
 await test('cancellation racing dispatch cannot both refund and authorize a send',async()=>{
  const job=await nativeEnqueue('RACE');assert.ok(job);
  const rows=await Promise.all([sql(asService(`SELECT cancel_undispatched_payout('${job.transaction_id}')`)),sql(asService(`SELECT begin_payout_dispatch('${job.transaction_id}','${job.lease_token}','RCP_NATIVE')`))]);
  const values=rows.map(r=>JSON.parse(r.out.split('\n').at(-1)));assert.equal(values.filter(r=>r.success===true).length,1);assert.equal(await balance(),values[0].success?'10000.00':'9000.00');
  fs.writeFileSync(path.join(dir,'dispatch-cancellation-evidence.json'),JSON.stringify(values,null,2));
 });
 await test('an expired preparation lease cannot authorize an old dispatch worker',async()=>{
  const job=await nativeEnqueue('STALE');assert.ok(job);await sql(`UPDATE private.payout_dispatch_outbox SET leased_until=now()-interval '1 second' WHERE transaction_id='${job.transaction_id}';`);
  const replacement=JSON.parse((await sql(asService('SELECT claim_payout_dispatch()'))).out.split('\n').at(-1));assert.equal(replacement.length,1);assert.notEqual(replacement[0].lease_token,job.lease_token);
  const old=JSON.parse((await sql(asService(`SELECT begin_payout_dispatch('${job.transaction_id}','${job.lease_token}','RCP_NATIVE')`))).out.split('\n').at(-1));assert.equal(old.success,false);
 });
 const refundActors=['f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000004'];
 const [refundMember,refundMaker,refundChecker,refundRecipient]=refundActors;
 for(const [i,id] of refundActors.entries()){
  await sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${id}','refund${i}@native.invalid',now());SELECT attest_verified_email('${id}','refund${i}@native.invalid');`);
  await sql(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${id}';SELECT set_user_transaction_pin('4829');COMMIT;`);
 }
 await sql(`UPDATE profiles SET role='executive' WHERE id IN ('${refundMaker}','${refundChecker}');UPDATE private.refund_accounting_control SET enabled=true;`);
 const asRefundOperator=(who,statement)=>`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${who}';SET LOCAL request.jwt.claims='${JSON.stringify({aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)}]})}';${statement};COMMIT;`;
 let refundSequence=8000;
 const refundFund=async()=>{const receipt=String(++refundSequence);await sql(`INSERT INTO transactions(wallet_id,user_id,type,category,amount,fee,status,counterparty_name,reference,gateway_provider) SELECT id,user_id,'inflow','deposit',100,0,'pending','Synthetic','REFUND-${receipt}','paystack' FROM wallets WHERE user_id='${refundMember}';`);await sql(asService(`SELECT settle_gateway_deposit('REFUND-${receipt}','paystack',10000,'${receipt}','{"data":{"domain":"test","currency":"NGN","amount":10000}}')`));return receipt};
 const refundRequest=async(receipt,amount=10000)=>{const v=await scalar(asService(`SELECT attest_processed_test_refund('${++refundSequence}','${receipt}',${amount})`));return result(await sql(asRefundOperator(refundMaker,`SELECT request_refund_adjustment('${v}','Native verified refund','4829')`))).request_id};
 const refundApprove=id=>sql(asRefundOperator(refundChecker,`SELECT approve_refund_adjustment('${id}','4829')`));
 await test('16 simultaneous refund approvals debit once with one balanced journal',async()=>{
  const id=await refundRequest(await refundFund());const values=(await Promise.all(Array.from({length:16},()=>refundApprove(id)))).map(result);
  assert.equal(values.filter(v=>v.status==='applied').length,1);assert.equal(values.filter(v=>v.status==='duplicate').length,15);
  assert.equal(await bal(refundMember),'0.00');assert.equal(await scalar(`SELECT count(*) FROM private.refund_adjustment_journal WHERE request_id='${id}';`),'1');
 });
 await test('parallel partial refunds cannot exceed their original charge',async()=>{
  const receipt=await refundFund(),a=await refundRequest(receipt,6000),b=await refundRequest(receipt,6000);
  const values=(await Promise.all([refundApprove(a),refundApprove(b)])).map(result);
  assert.equal(values.filter(v=>v.status==='applied').length,1);assert.equal(values.filter(v=>v.code==='REFUND_EXCEEDS_PAYMENT').length,1);assert.equal(await bal(refundMember),'40.00');
 });
 await test('refund racing a customer transfer cannot overspend the wallet',async()=>{
  const receipt=await refundFund(),id=await refundRequest(receipt); // Existing 40 plus fresh 100; competing 100 operations cannot both win.
  const transfer=`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${refundMember}';SELECT transfer_funds('${refundMember}','${refundRecipient}',100,'Native refund race','4829','f2000000-0000-4000-8000-000000000001');COMMIT;`;
  const values=(await Promise.all([refundApprove(id),sql(transfer)])).map(result);
  assert.equal(values.filter(v=>v.success===true).length,1);assert.equal(await bal(refundMember),'40.00');
  assert.equal(await scalar(`SELECT verify_wallet_ledger_reconciliation(id)->>'ok' FROM wallets WHERE user_id='${refundMember}';`),'true');
  fs.writeFileSync(path.join(dir,'refund-race-evidence.json'),JSON.stringify(values,null,2));
 });
 console.log(`${checks} passed; 0 failed`);
}finally{
 if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);
 console.log((started?'Isolated database stopped':'Database did not start')+'; evidence directory: '+dir);
}
