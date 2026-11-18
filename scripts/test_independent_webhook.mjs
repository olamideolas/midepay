import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {handlePaymentWebhookRequest as handle,computeHmacSha512Hex} from '../supabase/functions/payment-webhook/index.ts';
let passed=0;
async function test(name, fn){await fn(); console.log('PASS '+name); passed++;}
const secret='test-only-secret';
async function pay(data,deps={}) {const body=JSON.stringify({event:'charge.success',data}); return handle(new Request('http://localhost/webhook',{method:'POST',headers:{'x-paystack-signature':await computeHmacSha512Hex(body,secret)},body}),{paystackSecret:secret,...deps});}
await test('Paystack rejects foreign currency before settlement',async()=> {let calls=0;const r=await pay({reference:'ref',status:'success',amount:100000,currency:'USD'},{settleDeposit:async()=>{calls++;return{data:{},error:null}}});assert.equal(r.status,400);assert.equal(calls,0)});
await test('Paystack NGN settles normally',async()=>{let calls=0;const r=await pay({reference:'ref',status:'success',amount:100000,currency:'NGN'},{settleDeposit:async()=>{calls++;return{data:{},error:null}}});assert.equal(r.status,200);assert.equal(calls,1)});
const realFetch=globalThis.fetch;
async function flutter(verifiedData,eventData){globalThis.fetch=async()=>new Response(JSON.stringify({status:'success',data:verifiedData}),{status:200});try {let calls=0;const r=await handle(new Request('http://localhost/webhook',{method:'POST',headers:{'verif-hash':'hash'},body:JSON.stringify({event:'charge.completed',data:{id:1,tx_ref:'expected',amount:1000,status:'successful',...eventData}})}),{flutterwaveWebhookHash:'hash',flutterwaveSecretKey:'test-only',settleDeposit:async()=>{calls++;return{data:{},error:null}}});return {r,calls};}finally{globalThis.fetch=realFetch}}
await test('Flutterwave missing verified reference fails closed',async()=>{const {r,calls}=await flutter({status:'successful',currency:'NGN',amount:1000});assert.equal(r.status,400);assert.equal(calls,0)});
await test('Flutterwave missing verified amount fails closed',async()=>{const {r,calls}=await flutter({status:'successful',currency:'NGN',tx_ref:'expected'});assert.equal(r.status,400);assert.equal(calls,0)});
await test('Flutterwave verified matching payment succeeds',async()=>{const {r,calls}=await flutter({status:'successful',currency:'NGN',amount:1000,tx_ref:'expected'});assert.equal(r.status,200);assert.equal(calls,1)});
await test('unverified Flutterwave failure cannot refund a payout',async()=>{let calls=0;const r=await handle(new Request('http://localhost/webhook',{method:'POST',headers:{'verif-hash':'hash'},body:JSON.stringify({event:'transfer.completed',data:{reference:'out',id:3,status:'failed'}})}),{flutterwaveWebhookHash:'hash',reversePayout:async()=>{calls++;return{data:{},error:null}}});assert.equal(r.status,503);assert.equal(calls,0)});
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
await test('stored HTML in executive member fields is escaped by renderer',async()=>{const start=app.indexOf('  function renderAdminUsersTable(');let end=app.indexOf('  function ',start+12);assert.ok(start>=0);let html='';const payload='<img src=x onerror=alert(1)>';const tbody={set innerHTML(v){html=v},get innerHTML(){return html}};const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const context={document:{getElementById:()=>tbody},adminUsersList:[{email:payload,fullName:payload,phone:payload,bank:payload}],escapeHtml,formatNubanDisplay:s=>s,formatNaira:s=>String(s)};vm.createContext(context);vm.runInContext(app.slice(start,end)+';renderAdminUsersTable();',context);assert.ok(!html.includes(payload));assert.ok(html.includes('&lt;img'));});

const bankSource=fs.readFileSync(new URL('../supabase/functions/bank-payout/index.ts',import.meta.url),'utf8');
// Execute the actual handler after substituting only its SDK import. No external connections.
const transformed=bankSource.replace("import { createClient } from 'npm:@supabase/supabase-js@2.119.0';",'const createClient = globalThis.__auditClientFactory;');
const temp=new URL('../scripts/.audit-bank-runtime.ts',import.meta.url);
const envKeys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','BANK_PAYOUTS_ENABLED','PAYSTACK_SECRET_KEY'];
const prior=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:9',SUPABASE_ANON_KEY:'audit-anon',SUPABASE_SERVICE_ROLE_KEY:'audit-service',PAYSTACK_SECRET_KEY:'audit-secret'});
let validPin=true, duplicate=false, rpcCalls=[], updates=0, fetches=0;
const service={from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'a',email_otp_verified_at:'2026-01-01',is_frozen:false,kyc_tier:1},error:null}),update(){updates++;return this},then(resolve){resolve({error:null})}}),rpc:async(name,args)=>{rpcCalls.push(name);return{data:{success:true,already_debited:duplicate,status:'pending'},error:null}}};
globalThis.__auditClientFactory=(_url,key)=>key==='audit-service'?service:{auth:{getUser:async()=>({data:{user:{id:'a0000000-0000-4000-8000-000000000001',email_confirmed_at:'2026-01-01'}},error:null})},rpc:async(name)=>{rpcCalls.push(name);return{data:{valid:validPin},error:null}}};
fs.writeFileSync(temp,transformed);
try {
 const {handleBankPayoutRequest:bank}=await import(temp.href+'?audit');
 const req=()=>new Request('http://localhost/payout',{method:'POST',headers:{authorization:'Bearer audit'},body:JSON.stringify({action:'initiate_payout',account_number:'1234567890',bank_code:'001',account_name:'Test',amount_ngn:1000,pin:'4829',idempotency_key:'b0000000-0000-4000-8000-000000000001'})});
 await test('payout quarantine is enforced by server',async()=>{delete process.env.BANK_PAYOUTS_ENABLED;rpcCalls=[];assert.equal((await bank(req())).status,503);assert.equal(rpcCalls.length,0)});
 process.env.BANK_PAYOUTS_ENABLED='true';
 await test('invalid payout PIN is delegated to SQL without Edge counter writes',async()=>{validPin=false;rpcCalls=[];updates=0;assert.equal((await bank(req())).status,401);assert.deepEqual(rpcCalls,['verify_user_transaction_pin']);assert.equal(updates,0)});
 validPin=true;globalThis.fetch=async(url)=>{if(url.includes('/bank/resolve'))return new Response(JSON.stringify({status:true,data:{account_name:'Verified Test',account_number:'1234567890'}}),{status:200});fetches++;throw Error('ambiguous timeout')};
 await test('bank request queues a payout without dispatching or refunding',async()=>{rpcCalls=[];fetches=0;const res=await bank(req());assert.equal(res.status,202);assert.equal((await res.json()).status,'pending');assert.ok(rpcCalls.includes('enqueue_wallet_payout'));assert.ok(!rpcCalls.includes('reverse_failed_payout'));assert.equal(fetches,0)});
 await test('payout retry does not dispatch another provider request',async()=>{duplicate=true;fetches=0;rpcCalls=[];const res=await bank(req());assert.equal(res.status,200);assert.equal(fetches,0)});
} finally {globalThis.fetch=realFetch;delete globalThis.__auditClientFactory;fs.unlinkSync(temp);for(const k of envKeys){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k]}}


const apiCode=fs.readFileSync(new URL('../api/config.js',import.meta.url),'utf8').replace('export default function handler','function handler');
await test('dynamic config rejects service-role credentials without disclosure',async()=>{let status,body;const secret='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.test';const context={Buffer,process:{env:{SUPABASE_ANON_KEY:secret}},res:{setHeader(){},status(v){status=v;return this},send(v){body=v}}};vm.createContext(context);vm.runInContext(apiCode+';handler({},res)',context);assert.equal(status,503);assert.ok(!body.includes(secret))});
await test('dynamic config serves public publishable keys',async()=>{let status,body;const context={Buffer,process:{env:{SUPABASE_ANON_KEY:'sb_publishable_audit'}},res:{setHeader(){},status(v){status=v;return this},send(v){body=v}}};vm.createContext(context);vm.runInContext(apiCode+';handler({},res)',context);assert.equal(status,200);assert.ok(body.includes('sb_publishable_audit'))});


await test('CSV text cannot become a spreadsheet formula',async()=>{const text=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const start=text.indexOf('  function escapeCsvCell('),end=text.indexOf('  function ',start+12);const ctx={};vm.createContext(ctx);vm.runInContext(text.slice(start,end)+';this.cell=escapeCsvCell;',ctx);assert.ok(ctx.cell('=1+1').startsWith('"\''));assert.equal(ctx.cell('A"B'),'"A""B"')});
await test('empty production statements never substitute demo transactions',async()=>{const text=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');const start=text.indexOf('  function getStatementTransactions('),end=text.indexOf('  function ',start+12);const ctx={window:{MidePayDB:{isProduction:()=>true}},ensureUserSession(){},state:{transactions:[]},DEFAULT_DEMO_TRANSACTIONS:[{amount:999}]};vm.createContext(ctx);vm.runInContext(text.slice(start,end)+';this.result=getStatementTransactions();',ctx);assert.equal(ctx.result.length,0)});

console.log(passed+' passed; 0 failed');
