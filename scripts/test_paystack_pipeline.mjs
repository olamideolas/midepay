/** Actual checkout/webhook handlers and all SQL migrations; isolated database and synthetic provider HTTP. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
import {handlePaymentWebhookRequest,computeHmacSha512Hex} from '../supabase/functions/payment-webhook/index.ts';
const root=path.resolve(import.meta.dirname,'..');
const moduleDir=[process.env.PGLITE_MODULE_DIR,path.join(root,'node_modules/@electric-sql/pglite'),'C:/Users/TestAdmin/.gemini/antigravity/brain/785ef751-b351-4fc4-b6e5-d3735bf5e0d6/scratch/pgtest/node_modules/@electric-sql/pglite'].find(p=>p&&fs.existsSync(path.join(p,'dist/index.js')));
if(!moduleDir)throw Error('Install the pinned PGlite dependency before running this test.');
const {PGlite}=await import(pathToFileURL(path.join(moduleDir,'dist/index.js')));
const {pgcrypto}=await import(pathToFileURL(path.join(moduleDir,'dist/contrib/pgcrypto.js')));
const {uuid_ossp}=await import(pathToFileURL(path.join(moduleDir,'dist/contrib/uuid_ossp.js')));
const db=new PGlite({extensions:{pgcrypto,uuid_ossp}});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'midepay-pipeline-')),entry=path.join(temp,'init.ts');
const envKeys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','PAYSTACK_SECRET_KEY','ALLOWED_ORIGINS'];
const oldEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]])),oldFetch=globalThis.fetch;
const origin='https://pipeline.example.invalid',secret='sk_test_pipeline_synthetic';
Object.assign(process.env,{SUPABASE_URL:'https://ajbhsmcosxgymrtawlmd.supabase.co',SUPABASE_ANON_KEY:'pipeline-public',SUPABASE_SERVICE_ROLE_KEY:'pipeline-service',PAYSTACK_SECRET_KEY:secret,ALLOWED_ORIGINS:origin});
let pass=0;
async function test(name,fn){await fn();pass++;console.log('PASS '+name)}
const user={id:crypto.randomUUID(),email:'pipeline@example.invalid',email_confirmed_at:new Date().toISOString()};
let proofVerified=true,settlementUnavailable=false;
const value=v=>v&&typeof v==='object'?JSON.stringify(v):v;
function queryBuilder(table){
 if(!['profiles','wallets','transactions'].includes(table))throw Error('Unexpected table');
 let filters=[],insertion,update;
 const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},insert(v){insertion=v;return q},update(v){update=v;return q},single:()=>execute(),maybeSingle:()=>execute(),then:(resolve,reject)=>execute().then(resolve,reject)};
 async function execute(){try{let sql,params=[];if(insertion){const keys=Object.keys(insertion);params=keys.map(k=>value(insertion[k]));sql=`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`;}else{
  const keys=update?Object.keys(update):[];params=keys.map(k=>value(update[k]));const where=filters.map(([k,v])=>{params.push(v);return `${k}=$${params.length}`}).join(' AND ');
  sql=update?`UPDATE public.${table} SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')} WHERE ${where} RETURNING *`:`SELECT * FROM public.${table} WHERE ${where} ORDER BY created_at DESC LIMIT 1`;
 }const r=await db.query(sql,params);return{data:r.rows[0]||null,error:null};}catch(e){return{data:null,error:{message:e.message}}}}
 return q;
}
const balance=async()=>Number((await db.query('SELECT balance FROM wallets WHERE user_id=$1',[user.id])).rows[0].balance);
const deps={paystackSecret:secret,settleDeposit:async args=>{try{return await db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');const r=await tx.query('SELECT settle_gateway_deposit($1,$2,$3,$4,$5) AS result',[args.p_reference,args.p_provider,args.p_amount_kobo_or_ngn,args.p_gateway_ref,JSON.stringify(args.p_raw_payload)]);return{data:r.rows[0].result,error:null}})}catch(e){return{data:null,error:{message:e.message}}}}};
const event=(reference,extra={})=>({event:'charge.success',data:{reference,status:'success',amount:100000,currency:'NGN',domain:'test',id:'pipeline-receipt',...extra}});
async function webhook(payload,{signature}={}){const raw=JSON.stringify(payload);return handlePaymentWebhookRequest(new Request('http://localhost/webhook',{method:'POST',headers:{'x-paystack-signature':signature??await computeHmacSha512Hex(raw,secret)},body:raw}),deps)}
let checkoutUrl='https://checkout.paystack.com/synthetic',checkoutReferenceOverride=null;
try{
 await db.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION "uuid-ossp";CREATE EXTENSION pgcrypto;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,phone text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user::text) $$;
 GRANT USAGE ON SCHEMA public,auth,extensions TO anon,authenticated,service_role;GRANT SELECT ON auth.users TO service_role;CREATE PUBLICATION supabase_realtime;`);
 for(const file of fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
 await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[user.id,user.email]);
 await db.query('SELECT attest_verified_email($1,$2)',[user.id,user.email]);
 globalThis.__pipelineClient=(_url,key)=>key==='pipeline-service'?{from:queryBuilder,rpc:async(name,args)=>{assert.equal(name,'settle_gateway_deposit');return settlementUnavailable?{data:null,error:{message:'synthetic outage'}}:deps.settleDeposit(args)}}:{auth:{getUser:async()=>({data:{user},error:null})},rpc:async()=>({data:{verified:proofVerified},error:null})};
 const source=fs.readFileSync(path.join(root,'supabase/functions/init-payment/index.ts'),'utf8').replace("import { createClient } from 'npm:@supabase/supabase-js@2.119.0';",'const createClient=globalThis.__pipelineClient;');fs.writeFileSync(entry,source);
 const {handleInitPaymentRequest:init}=await import(pathToFileURL(entry));
 let requestBody;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.paystack.co/transaction/initialize');assert.equal(options.headers.Authorization,'Bearer '+secret);requestBody=JSON.parse(options.body);return new Response(JSON.stringify({status:true,data:{authorization_url:checkoutUrl,access_code:'synthetic-access',reference:checkoutReferenceOverride||requestBody.reference}}),{status:200})};
 const initialize=()=>init(new Request('http://localhost/init',{method:'POST',headers:{authorization:'Bearer synthetic',origin,'content-type':'application/json'},body:JSON.stringify({provider:'paystack',amount_ngn:1000,callback_url:origin+'/return'})}));
 let reference;
 await test('checkout creates a pending deposit and cannot credit the wallet',async()=>{const r=await initialize();assert.equal(r.status,200);const body=await r.json();reference=body.reference;assert.equal(requestBody.amount,100000);assert.equal(requestBody.currency,'NGN');assert.equal(await balance(),0);assert.equal((await db.query('SELECT status FROM transactions WHERE reference=$1',[reference])).rows[0].status,'pending')});
 await test('staging checkout declares test mode explicitly',async()=>{const r=await initialize();assert.equal((await r.json()).mode,'test')});
 await test('signed matching NGN event credits exactly the expected amount',async()=>{assert.equal((await webhook(event(reference))).status,200);assert.equal(await balance(),1000)});
 await test('replaying the exact signed event cannot credit twice',async()=>{for(let i=0;i<3;i++){const r=await webhook(event(reference));assert.equal(r.status,200);assert.equal((await r.json()).settlement.already_settled,true)}assert.equal(await balance(),1000);assert.equal(Number((await db.query("SELECT count(*) AS n FROM audit_logs WHERE action='SETTLE_GATEWAY_DEPOSIT'")).rows[0].n),1)});
 await test('a forged signature cannot settle or alter balances',async()=>{assert.equal((await webhook(event(reference),{signature:'00'.repeat(64)})).status,401);assert.equal(await balance(),1000)});
 await test('an unknown signed reference cannot create a deposit',async()=>{assert.equal((await webhook(event('unregistered-reference',{id:'unknown-receipt'}))).status,500);assert.equal(await balance(),1000)});
 const pending=await (await initialize()).json();
 await test('a signed underpayment cannot credit a pending deposit',async()=>{assert.equal((await webhook(event(pending.reference,{amount:99999,id:'underpaid'}))).status,500);assert.equal(await balance(),1000)});
 await test('a signed overpayment cannot silently credit a different amount',async()=>{assert.equal((await webhook(event(pending.reference,{amount:100001,id:'overpaid'}))).status,500);assert.equal(await balance(),1000)});
 await test('a signed wrong-currency event cannot credit the wallet',async()=>{assert.equal((await webhook(event(pending.reference,{currency:'USD',id:'wrong-currency'}))).status,400);assert.equal(await balance(),1000)});
 await test('the same provider receipt cannot fund a second pending reference',async()=>{assert.equal((await webhook(event(pending.reference))).status,500);assert.equal(await balance(),1000)});
 await test('staging rejects a signed live-domain payment event',async()=>{assert.equal((await webhook(event(pending.reference,{domain:'live',id:'live-receipt'}))).status,400);assert.equal(await balance(),1000)});
 await test('fractional kobo cannot be silently rounded into a credit',async()=>{assert.equal((await webhook(event(pending.reference,{amount:100000.1,id:'fractional-receipt'}))).status,400);assert.equal(await balance(),1000)});
 await test('checkout rejects an untrusted redirect URL from the provider response',async()=>{checkoutUrl='https://untrusted.example.invalid/pay';assert.equal((await initialize()).status,502);checkoutUrl='https://checkout.paystack.com/synthetic'});
 await test('checkout rejects a mismatched provider reference',async()=>{checkoutReferenceOverride='different-reference';assert.equal((await initialize()).status,502);checkoutReferenceOverride=null});
 const recoveryTx=await (await initialize()).json();
 let verificationCalls=0,verificationOverrides={},transportFailure=false;
 globalThis.fetch=async(url,options)=>{verificationCalls++;if(transportFailure)throw Error('synthetic timeout');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer '+secret);const ref=decodeURIComponent(url.split('/').at(-1));return new Response(JSON.stringify({status:true,data:{status:'success',domain:'test',currency:'NGN',amount:100000,id:9002,reference:ref,...verificationOverrides}}),{status:200})};
 const recover=(reference=recoveryTx.reference)=>init(new Request('http://localhost/init',{method:'POST',headers:{authorization:'Bearer synthetic',origin,'content-type':'application/json'},body:JSON.stringify({action:'verify_payment',...(reference?{reference}:{})})}));
 await test('a missed webhook can be recovered only after server-side Paystack verification',async()=>{const r=await recover();assert.equal(r.status,200);assert.equal((await r.json()).success,true);assert.equal(await balance(),2000)});
 await test('repeating recovery and then receiving the real webhook cannot double-credit',async()=>{const r=await recover();assert.equal((await r.json()).already_settled,true);assert.equal((await webhook(event(recoveryTx.reference,{id:9002}))).status,200);assert.equal(await balance(),2000)});
 await test('unconfirmed provider status cannot authorize settlement',async()=>{verificationOverrides={status:'pending'};const r=await recover();assert.equal(r.status,200);assert.equal((await r.json()).success,false);verificationOverrides={};assert.equal(await balance(),2000)});
 await test('recovery rejects mismatched amount, currency, domain, receipt or reference',async()=>{for(const override of [{amount:99999},{amount:100001},{currency:'USD'},{domain:'live'},{reference:'other'},{id:null}]){verificationOverrides=override;assert.equal((await recover()).status,409)}verificationOverrides={};assert.equal(await balance(),2000)});
 await test('a different account cannot reconcile another user deposit',async()=>{const id=crypto.randomUUID(),ref='MDP-PSK-FOREIGN-DEPOSIT';await db.query("INSERT INTO auth.users(id,email) VALUES($1,'other@pipeline.invalid')",[id]);await db.query("INSERT INTO transactions(wallet_id,user_id,type,category,amount,fee,status,counterparty_name,reference,gateway_provider) SELECT id,user_id,'inflow','deposit',1000,0,'pending','Synthetic', $2,'paystack' FROM wallets WHERE user_id=$1",[id,ref]);const before=verificationCalls;assert.equal((await recover(ref)).status,404);assert.equal(verificationCalls,before);assert.equal(await balance(),2000)});
 await test('recovery requires independent email proof before contacting Paystack',async()=>{proofVerified=false;const before=verificationCalls;assert.equal((await recover()).status,403);assert.equal(verificationCalls,before);proofVerified=true});
 await test('provider timeouts cannot manufacture a settlement',async()=>{transportFailure=true;assert.equal((await recover()).status,503);transportFailure=false;assert.equal(await balance(),2000)});
 await test('recovery is unavailable outside the explicitly approved staging database',async()=>{process.env.SUPABASE_URL='https://other.example.invalid';assert.equal((await recover()).status,503);process.env.SUPABASE_URL='https://ajbhsmcosxgymrtawlmd.supabase.co'});
 await test('malformed recovery references are rejected before provider calls',async()=>{const before=verificationCalls;assert.equal((await recover('invalid/reference')).status,400);assert.equal(verificationCalls,before)});
 await test('failed database settlement is not reported as credited',async()=>{settlementUnavailable=true;assert.equal((await recover()).status,503);settlementUnavailable=false;assert.equal(await balance(),2000)});
 await test('latest-deposit lookup stays scoped to the authenticated user',async()=>{const r=await recover(null);assert.equal(r.status,200);assert.equal((await r.json()).reference,recoveryTx.reference);assert.equal(await balance(),2000)});
 await test('manual provider verification retains fees without changing the customer credit',async()=>{verificationOverrides={fees:1500};assert.equal((await recover()).status,200);verificationOverrides={};const rows=(await db.query("SELECT fee_kobo,source FROM private.payment_charge_observations WHERE gateway_receipt='9002' AND fee_state='known'")).rows;assert.ok(rows.some(r=>Number(r.fee_kobo)===1500&&r.source==='paystack_verify_api'));assert.equal(await balance(),2000)});
 console.log(`${pass} passed; 0 failed`);
}finally{await db.close();globalThis.fetch=oldFetch;delete globalThis.__pipelineClient;for(const k of envKeys){if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k]}fs.unlinkSync(entry);fs.rmdirSync(temp)}
