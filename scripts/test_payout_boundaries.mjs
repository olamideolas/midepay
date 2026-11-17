import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const source=fs.readFileSync(new URL('../supabase/functions/bank-payout/index.ts',import.meta.url),'utf8');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'midepay-payout-test-')),file=path.join(dir,'bank.ts');
fs.writeFileSync(file,source.replace("import { createClient } from 'npm:@supabase/supabase-js@2.119.0';",'const createClient=globalThis.__midepayBoundaryClient;'));
const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','BANK_PAYOUTS_ENABLED','PAYSTACK_SECRET_KEY','ALLOWED_ORIGINS'];
const original=Object.fromEntries(keys.map(k=>[k,process.env[k]])),oldFetch=globalThis.fetch;
let debitResult,updateError,fetches,debits;
const reset=()=>{Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:9',SUPABASE_ANON_KEY:'test-public',SUPABASE_SERVICE_ROLE_KEY:'test-service',BANK_PAYOUTS_ENABLED:'true',PAYSTACK_SECRET_KEY:'sk_test_placeholder',ALLOWED_ORIGINS:'https://staging.example.invalid'});debitResult={success:true,new_balance:9000};updateError=null;fetches=[];debits=0;};
globalThis.__midepayBoundaryClient=(_url,key)=>key==='test-service'?{
 from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'test',email_otp_verified_at:'2026-01-01',kyc_tier:1,is_frozen:false},error:null}),update(){return this},then(resolve){resolve({error:updateError})}}),
 rpc:async()=>{debits++;return{data:debitResult,error:null}}
}:{auth:{getUser:async()=>({data:{user:{id:'a0000000-0000-4000-8000-000000000001',email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01'}},error:null})},rpc:async()=>({data:{valid:true,verified:true},error:null})};
globalThis.fetch=async(url,options)=>{fetches.push({url,options});return new Response(JSON.stringify({status:true,data:url.includes('transferrecipient')?{recipient_code:'RCP_test'}:{transfer_code:'TRF_test',status:'pending'}}),{status:200})};
const body={action:'initiate_payout',provider:'paystack',account_number:'0000000000',bank_code:'001',account_name:'Synthetic test',amount_ngn:1000,pin:'4829',idempotency_key:'b0000000-0000-4000-8000-000000000001'};
const req=(payload=body,headers={})=>new Request('http://localhost/payout',{method:'POST',headers:{authorization:'Bearer synthetic',...headers},body:JSON.stringify(payload)});
let pass=0,fail=0;
async function test(label,fn){reset();try{await fn();pass++;console.log('PASS '+label)}catch(e){fail++;console.log('FAIL '+label+': '+e.message)}}
try{
 const {handleBankPayoutRequest:handle}=await import(pathToFileURL(file));
 await test('non-object payloads are rejected without throwing',async()=>{for(const value of [null,[],42,'invalid'])assert.equal((await handle(req(value))).status,400);assert.equal(debits,0);assert.equal(fetches.length,0)});
 await test('unknown payout provider cannot silently route to Paystack',async()=>{assert.equal((await handle(req({...body,provider:'unknown'}))).status,400);assert.equal(debits,0);assert.equal(fetches.length,0)});
 await test('unapproved browser origin is rejected before database or gateway work',async()=>{assert.equal((await handle(req(body,{origin:'https://unapproved.example.invalid'}))).status,403);assert.equal(debits,0);assert.equal(fetches.length,0)});
 await test('missing origin configuration fails closed for browser requests',async()=>{delete process.env.ALLOWED_ORIGINS;assert.equal((await handle(req(body,{origin:'https://staging.example.invalid'}))).status,403);assert.equal(fetches.length,0)});
 await test('absent provider credentials cannot strand a newly debited wallet',async()=>{delete process.env.PAYSTACK_SECRET_KEY;assert.equal((await handle(req())).status,503);assert.equal(debits,0);assert.equal(fetches.length,0)});
 await test('staging cannot dispatch with a Paystack live secret',async()=>{process.env.SUPABASE_URL='https://ajbhsmcosxgymrtawlmd.supabase.co';process.env.PAYSTACK_SECRET_KEY='sk_live_placeholder';assert.equal((await handle(req())).status,503);assert.equal(debits,0);assert.equal(fetches.length,0)});
 await test('unconfirmed debit responses never dispatch external money',async()=>{for(const value of [null,{},false,{success:false},{success:'true'}]){debitResult=value;assert.equal((await handle(req())).status,503)}assert.equal(fetches.length,0)});
 await test('duplicate ledger debit never dispatches an additional transfer',async()=>{debitResult={success:true,already_debited:true,status:'pending'};assert.equal((await handle(req())).status,200);assert.equal(fetches.length,0)});
 await test('amount must be numeric and exactly representable in kobo',async()=>{for(const value of ['1000',true,1000.001,1000.009])assert.equal((await handle(req({...body,amount_ngn:value}))).status,400);assert.equal(debits,0);assert.equal(fetches.length,0)});
 await test('accepted transfer with failed gateway reference write requires reconciliation',async()=>{updateError={message:'synthetic database outage'};const r=await handle(req());assert.equal(r.status,202);assert.equal((await r.json()).reconciliation_required,true);assert.equal(debits,1);assert.equal(fetches.length,2)});
 await test('valid dispatch uses the same deterministic reference and stays pending',async()=>{const r=await handle(req(body,{origin:'https://staging.example.invalid'}));assert.equal(r.status,200);const result=await r.json();assert.equal(result.status,'pending');assert.equal(debits,1);assert.equal(fetches.length,2);assert.equal(JSON.parse(fetches[1].options.body).reference,result.reference)});
 const initFile=path.join(dir,'init.ts');
 fs.writeFileSync(initFile,fs.readFileSync(new URL('../supabase/functions/init-payment/index.ts',import.meta.url),'utf8').replace("import { createClient } from 'npm:@supabase/supabase-js@2.119.0';",'const createClient=globalThis.__midepayBoundaryClient;'));
 try{
  const {handleInitPaymentRequest:init}=await import(pathToFileURL(initFile));
  const deposit={provider:'paystack',amount_ngn:1000,callback_url:'https://staging.example.invalid/return'};
  await test('deposit rejects non-object JSON payloads',async()=>{for(const value of [null,[],true])assert.equal((await init(req(value))).status,400);assert.equal(fetches.length,0)});
  await test('deposit rejects unapproved browser origins',async()=>{assert.equal((await init(req(deposit,{origin:'https://unapproved.example.invalid'}))).status,403);assert.equal(fetches.length,0)});
  await test('deposit requires configured origins for browser requests',async()=>{delete process.env.ALLOWED_ORIGINS;assert.equal((await init(req(deposit,{origin:'https://staging.example.invalid'}))).status,403);assert.equal(fetches.length,0)});
  await test('deposit rejects live keys in the staging project',async()=>{process.env.SUPABASE_URL='https://ajbhsmcosxgymrtawlmd.supabase.co';process.env.PAYSTACK_SECRET_KEY='sk_live_placeholder';assert.equal((await init(req(deposit))).status,503);assert.equal(fetches.length,0)});
  await test('deposit rejects silent rounding or coercion of money',async()=>{for(const amount_ngn of ['1000',true,1000.001])assert.equal((await init(req({...deposit,amount_ngn}))).status,400);assert.equal(fetches.length,0)});
  await test('deposit callback cannot redirect to an arbitrary external origin',async()=>{for(const callback_url of ['https://unapproved.example.invalid/',42,'https://user:password@staging.example.invalid/'])assert.equal((await init(req({...deposit,callback_url}))).status,400);assert.equal(fetches.length,0)});
 }finally{fs.unlinkSync(initFile)}
}finally{globalThis.fetch=oldFetch;delete globalThis.__midepayBoundaryClient;for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k]}fs.unlinkSync(file);fs.rmdirSync(dir)}
console.log(`${pass} passed; ${fail} failed`);process.exitCode=fail?1:0;

