/** Staging-only Paystack recovery. Verifies existing payments; never creates or retries a transfer. */
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
const STAGING='https://ajbhsmcosxgymrtawlmd.supabase.co';
const env=(key: string): string => {
 const runtime=globalThis as unknown as {Deno?:{env:{get(k:string):string|undefined}},process?:{env:Record<string,string|undefined>}};
 return runtime.Deno?.env.get(key)??runtime.process?.env[key]??'';
};
type Job={transaction_id:string;lease_token:string;reference:string;type:string;category:string;amount:number|string;status:string;gateway_reference:string|null;bank_code:string;account_number:string};
type Decision={outcome:'done'|'retry'|'review';code:string};
type DispatchJob={transaction_id:string;lease_token:string;reference:string;amount:number|string;account_name:string;account_number:string;bank_code:string;narration:string};
export async function dispatchQueuedPayouts(rpc:(name:string,args:Record<string,unknown>)=>Promise<any>,secret:string):Promise<Record<string,number>>{
 const counts={dispatch_submitted:0,dispatch_cancelled:0,dispatch_retry:0,dispatch_review:0,dispatch_incomplete:0};
 let jobs:DispatchJob[];
 try{jobs=await rpc('claim_payout_dispatch',{});if(!Array.isArray(jobs)||jobs.length>1)throw Error('INVALID_DISPATCH_BATCH');}
 catch{counts.dispatch_incomplete++;return counts;}
 for(const job of jobs){
  let sending=false;
  const args={p_transaction_id:job.transaction_id,p_lease_token:job.lease_token};
  try{
   const kobo=Number(job.amount)*100;
   if(!/^MDP-OUT-[A-Za-z0-9-]+$/.test(job.reference)||!/^\d{10}$/.test(job.account_number)||!/^\d{3,10}$/.test(job.bank_code)||!Number.isSafeInteger(Math.round(kobo))||kobo<=0||Math.abs(kobo-Math.round(kobo))>0.0000001)throw Error('INVALID_STORED_PAYOUT');
   const recipientResponse=await fetch('https://api.paystack.co/transferrecipient',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),body:JSON.stringify({type:'nuban',name:job.account_name,account_number:job.account_number,bank_code:job.bank_code,currency:'NGN'})});
   const recipient=await recipientResponse.json();const d=recipient?.data;
   if(!recipientResponse.ok||recipient.status!==true||typeof d?.recipient_code!=='string'||!/^RCP_[A-Za-z0-9]+$/.test(d.recipient_code)||d.details?.account_number!==job.account_number||d.details?.bank_code!==job.bank_code||d.currency!=='NGN')throw Error('RECIPIENT_NOT_CONFIRMED');
   const gate=await rpc('begin_payout_dispatch',{...args,p_recipient_code:d.recipient_code});
   if(gate?.success!==true)throw Error('DISPATCH_NOT_AUTHORIZED');
   sending=true;
   const response=await fetch('https://api.paystack.co/transfer',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),body:JSON.stringify({source:'balance',amount:Math.round(kobo),recipient:d.recipient_code,reason:job.narration,reference:job.reference})});
   const result=await response.json();const transfer=result?.data;
   if(!response.ok||result.status!==true||transfer?.reference!==job.reference||typeof transfer.transfer_code!=='string'||!/^TRF_[A-Za-z0-9]+$/.test(transfer.transfer_code))throw Error('AMBIGUOUS_TRANSFER_RESPONSE');
   const ack=await rpc('finish_payout_dispatch',{...args,p_outcome:'submitted',p_gateway_reference:transfer.transfer_code});
   if(ack?.success!==true)throw Error('DISPATCH_ACKNOWLEDGEMENT_LOST');
   counts.dispatch_submitted++;
  }catch{
   try{const ack=await rpc('finish_payout_dispatch',{...args,p_outcome:sending?'ambiguous':'prepare_retry'});if(ack?.success!==true)throw Error('STALE_DISPATCH');counts[ack.dispatch_status==='cancelled'?'dispatch_cancelled':sending?'dispatch_review':'dispatch_retry']++;}
   catch{counts.dispatch_incomplete++;}
  }
 }
 return counts;
}
export async function handleReconciliation(req:Request):Promise<Response>{
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 if(req.headers.has('origin'))return reply(403,{code:'SERVER_ONLY'});
 const auth=req.headers.get('authorization')??'';
 if(!/^Bearer [0-9]{10}\.[a-f0-9]{64}$/.test(auth))return reply(401,{code:'UNAUTHORIZED'});
 if(env('SUPABASE_URL')!==STAGING||!env('PAYSTACK_SECRET_KEY').startsWith('sk_test_')||!env('SUPABASE_SERVICE_ROLE_KEY'))return reply(503,{code:'TEST_CONFIGURATION_REQUIRED'});
 const client=createClient(STAGING,env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await client.rpc(name,args);if(error||data?.success===false)throw Error('DATABASE_RETRY_REQUIRED');return data;};
 try{if(await rpc('authorize_payment_reconciliation',{p_token:auth.slice(7)})!==true)return reply(401,{code:'UNAUTHORIZED_OR_DISABLED'});}
 catch{return reply(503,{code:'WORKER_AUTH_UNAVAILABLE'});}
 let jobs:Job[];
 try{jobs=await rpc('claim_payment_reconciliation',{p_limit:3});if(!Array.isArray(jobs)||jobs.length>3)throw Error('INVALID_BATCH');}
 catch{return reply(503,{code:'QUEUE_UNAVAILABLE'});}
 const counts={processed:0,done:0,retry:0,review:0,incomplete:0};
 for(const job of jobs){
  let decision:Decision={outcome:'retry',code:'PROVIDER_UNAVAILABLE'};
  try{
   if(['successful','reversed'].includes(job.status))decision={outcome:'done',code:'ALREADY_TERMINAL'};
   else if(job.status!=='pending')decision={outcome:'review',code:'UNEXPECTED_TRANSACTION_STATE'};
   else{
    const deposit=job.type==='inflow'&&job.category==='deposit';
    const payout=job.type==='outflow'&&job.category==='transfer';
    const prefix=deposit?'MDP-PSK-':'MDP-OUT-';
    const expected=Number(job.amount)*100;
    if((!deposit&&!payout)||typeof job.reference!=='string'||!job.reference.startsWith(prefix)||!Number.isSafeInteger(Math.round(expected))||expected<=0||Math.abs(expected-Math.round(expected))>0.0000001){decision={outcome:'review',code:'INVALID_STORED_PAYMENT'};}
    else{
     const endpoint=deposit?'transaction':'transfer';
     const response=await fetch(`https://api.paystack.co/${endpoint}/verify/${encodeURIComponent(job.reference)}`,{method:'GET',headers:{Authorization:'Bearer '+env('PAYSTACK_SECRET_KEY')},signal:AbortSignal.timeout(8000)});
     let verified;
     try{verified=await response.json();}catch{verified=null;}
     if(response.ok&&verified?.status===true&&verified.data){
      const p=verified.data;
      const receipt=p.id;
      const validReceipt=/^[1-9][0-9]*$/.test(String(receipt??''))&&(typeof receipt!=='number'||Number.isSafeInteger(receipt));
      const matches=p.domain==='test'&&p.currency==='NGN'&&p.reference===job.reference&&Number.isSafeInteger(p.amount)&&p.amount===Math.round(expected)&&validReceipt;
      const recipientMatches=deposit||(p.recipient?.details?.account_number===job.account_number&&p.recipient?.details?.bank_code===job.bank_code&&typeof p.transfer_code==='string'&&/^TRF_[a-zA-Z0-9]+$/.test(p.transfer_code)&&(job.gateway_reference===null||job.gateway_reference===job.reference||job.gateway_reference===p.transfer_code));
      if(!matches||!recipientMatches)decision={outcome:'review',code:'PROVIDER_PAYMENT_MISMATCH'};
      else if(deposit&&p.status==='success'){
       const settled=await rpc('settle_gateway_deposit',{p_reference:job.reference,p_provider:'paystack',p_amount_kobo_or_ngn:p.amount,p_gateway_ref:String(receipt),p_raw_payload:{event:'charge.success',verification_source:'scheduled_paystack_verification',data:{id:receipt,reference:p.reference,status:p.status,domain:p.domain,currency:p.currency,amount:p.amount}}});
       decision=settled?.success===true?{outcome:'done',code:'DEPOSIT_SETTLED'}:{outcome:'retry',code:'SETTLEMENT_RETRY_REQUIRED'};
      }else if(payout&&['success','failed','reversed'].includes(p.status)){
       const success=p.status==='success';
       const payload={event:'transfer.'+p.status,verification_source:'scheduled_paystack_verification',data:{id:receipt,reference:p.reference,status:p.status,domain:p.domain,currency:p.currency,amount:p.amount,transfer_code:p.transfer_code}};
       const settled=await rpc(success?'finalize_payout_settlement':'reverse_failed_payout',success?{p_reference:job.reference,p_gateway_ref:p.transfer_code,p_raw_payload:payload}:{p_reference:job.reference,p_reason:'Provider-verified '+p.status+' payout',p_raw_payload:payload});
       decision=settled?.success===true?{outcome:'done',code:success?'PAYOUT_SETTLED':'PAYOUT_REFUNDED'}:{outcome:'retry',code:'SETTLEMENT_RETRY_REQUIRED'};
      }else decision={outcome:'retry',code:'PROVIDER_NOT_TERMINAL'};
     }
    }
   }
  }catch{decision={outcome:'retry',code:'VERIFICATION_RETRY_REQUIRED'};}
  try{const finish=await rpc('finish_payment_reconciliation',{p_transaction_id:job.transaction_id,p_lease_token:job.lease_token,p_outcome:decision.outcome,p_code:decision.code});counts.processed++;const final=finish.state==='ready'?'retry':finish.state;if(final==='done'||final==='retry'||final==='review')counts[final]++;else counts.incomplete++;}
  catch{counts.incomplete++;}
 }
 const dispatch=env('BANK_PAYOUTS_ENABLED')==='true'?await dispatchQueuedPayouts(rpc,env('PAYSTACK_SECRET_KEY')):{dispatch_submitted:0,dispatch_cancelled:0,dispatch_retry:0,dispatch_review:0,dispatch_incomplete:0};
 return reply(counts.incomplete||dispatch.dispatch_incomplete?503:200,{...counts,...dispatch});
}
const runtime=globalThis as unknown as {Deno?:{serve?:(h:(req:Request)=>Promise<Response>)=>void}};
if(runtime.Deno?.serve)runtime.Deno.serve(handleReconciliation);
