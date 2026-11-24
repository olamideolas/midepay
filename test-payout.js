/* Separate staging-only test. Server authorization is authoritative. */
(function(root){
 'use strict';
 const STAGING='https://ajbhsmcosxgymrtawlmd.supabase.co';
 const USER='0ab403d2-47c2-492d-877c-e84ac65a61de';
 const TEST_ID='6f2e6402-10b0-4a14-b0a8-7a3b139b7e52';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function createFlow({client,storage,crypto,config}){
  if(config?.url!==STAGING)throw Error('This test is available only on MidePay staging.');
  let recipient=null,busy=false,attempted=false;
  async function identity(){const r=await client.auth.getUser();if(r.error||r.data?.user?.id!==USER)throw Error('Sign in with the designated test account on MidePay first.');return r.data.user;}
  async function reference(){await identity();const key='midepay-test-payout:'+USER;let id=storage.getItem(key);if(id&&(!UUID.test(id)||id!==TEST_ID))throw Error('Saved test identity is invalid. Stop and contact support.');if(!id){id=TEST_ID;storage.setItem(key,id);}const bytes=new TextEncoder().encode('MDP-OUT-'+USER+'-'+id.toLowerCase());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');return{id,reference:'mdp-out-'+hash.slice(0,40)};}
  async function resolve(){await identity();const r=await client.functions.invoke('bank-payout',{body:{action:'resolve_account',provider:'paystack',account_number:'1000000001',bank_code:'057'}});const d=r.data;if(r.error||d?.success!==true||d.account_number!=='1000000001'||d.bank_code!=='057'||typeof d.account_name!=='string'||!d.account_name.trim())throw Error('Test recipient could not be verified. No transfer was requested.');recipient=d.account_name.trim();return recipient;}
  const rejectionMessages={PAYOUTS_QUARANTINED:'The test window is closed. No payout was queued by this rejected request.',SESSION_REQUIRED:'Your session has ended. Sign in again before continuing.',TEST_PAYOUT_SCOPE_REQUIRED:'This account or destination is not approved for the controlled test.',PIN_LOCKED:'Your PIN is temporarily locked. Wait before trying again.',PIN_NOT_VERIFIED:'Your PIN could not be verified. Check it before trying again.',EMAIL_NOT_VERIFIED:'Verify your email before continuing.'};
  async function readiness(){await identity();let r;try{r=await client.functions.invoke('bank-payout',{body:{action:'inspect_test_payout',provider:'paystack',account_number:'1000000001',bank_code:'057'}});}catch{throw Error('Readiness check is unavailable. No transfer was requested.');}if(r.error||r.data?.success!==true||typeof r.data.ready!=='boolean')throw Error('Readiness check is unavailable. No transfer was requested.');if(!r.data.ready)throw Error(rejectionMessages[r.data.code]||'The controlled test is not available. No transfer was requested.');return true;}
  async function submit(pin,consent){
   if(busy||attempted)throw Error('This request was already attempted. Check its status before doing anything else.');
   if(!recipient||consent!==true||!/^\d{4}$/.test(pin))throw Error('Verify the recipient, approve the test and enter your four-digit PIN.');
   busy=true;
   try{await readiness();const saved=await reference();attempted=true;let r;
    try{r=await client.functions.invoke('bank-payout',{body:{action:'initiate_payout',provider:'paystack',account_number:'1000000001',bank_code:'057',account_name:recipient,amount_ngn:100,pin,idempotency_key:saved.id,narration:'Controlled MidePay staging test'}});}catch{return{state:'unknown',reference:saved.reference};}
    let rejected=r.data;
    if(r.error?.context&&typeof r.error.context.clone==='function'){try{rejected=await r.error.context.clone().json();}catch{}}
    if(rejected?.code&&rejectionMessages[rejected.code]){attempted=false;return{state:'rejected',message:rejectionMessages[rejected.code],reference:saved.reference};}
    if(r.error||r.data?.success!==true||r.data.reference!==saved.reference)return{state:'unknown',reference:saved.reference};
    return{state:'pending',reference:saved.reference};
   }finally{busy=false;}
  }
  async function status(){const saved=await reference();const r=await client.from('transactions').select('reference,status,amount,gateway_provider').eq('reference',saved.reference).eq('user_id',USER).maybeSingle();if(r.error)throw Error('Status is unavailable. Do not start another transfer.');if(!r.data)return{state:'not_found',reference:saved.reference};const d=r.data;if(d.reference!==saved.reference||Number(d.amount)!==100||d.gateway_provider!=='paystack'||!['pending','successful','reversed','failed'].includes(d.status))throw Error('Unexpected payment record. Stop and request review.');return{state:d.status,reference:saved.reference};}
  return{resolve,submit,status,readiness,canSubmit:()=>!busy&&!attempted};
 }
 if(typeof module!=='undefined')module.exports={createFlow};
 if(!root?.document)return;
 const $=id=>root.document.getElementById(id),message=text=>{$('test-payout-status').textContent=text;};
 const labels={pending:'Request recorded; provider settlement is still pending.',unknown:'Outcome unknown. Check this test’s status; do not start another transfer.',not_found:'No record is visible yet. This does not prove an earlier request failed. Wait and check again.',successful:'The server records this test transfer as successful.',reversed:'The server records this test transfer as reversed.',failed:'The server records this test transfer as failed.'};
 let flow;
 try{const cfg=root.MIDEPAY_SUPABASE_CONFIG;if(cfg?.url!==STAGING)throw Error('This page runs only on MidePay staging.');const client=root.supabase.createClient(cfg.url,cfg.anonKey);flow=createFlow({client,storage:root.localStorage,crypto:root.crypto,config:cfg});}catch(e){message(e.message);$('resolve-test-recipient').disabled=true;$('check-test-payout').disabled=true;return;}
 $('resolve-test-recipient').addEventListener('click',async()=>{const b=$('resolve-test-recipient');b.disabled=true;try{$('test-payout-form').hidden=true;await flow.readiness();$('test-recipient-name').textContent='Verified recipient: '+await flow.resolve();$('test-payout-form').hidden=false;message('Review the fixed recipient and amount. Enter your PIN yourself.');}catch(e){message(e.message);}finally{b.disabled=false;}});
 $('test-payout-form').addEventListener('submit',async e=>{e.preventDefault();const b=$('submit-test-payout'),input=$('test-payout-pin');if(b.disabled)return;b.disabled=true;try{const result=await flow.submit(input.value,$('test-payout-consent').checked);message(result.message||labels[result.state]);$('test-payout-reference').textContent='Reference: '+result.reference;}catch(e){message(e.message);}finally{input.value='';b.disabled=!flow.canSubmit();}});
 $('check-test-payout').addEventListener('click',async()=>{const b=$('check-test-payout');b.disabled=true;try{const result=await flow.status();message(labels[result.state]);$('test-payout-reference').textContent='Reference: '+result.reference;}catch(e){message(e.message);}finally{b.disabled=false;}});
})(typeof window==='undefined'?null:window);
