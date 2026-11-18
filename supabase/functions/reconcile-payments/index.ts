/** Staging-only Paystack recovery. Verifies existing payments; never creates or retries a transfer. */
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
const STAGING='https://ajbhsmcosxgymrtawlmd.supabase.co';
const env=(key: string): string => {
 const runtime=globalThis as unknown as {Deno?:{env:{get(k:string):string|undefined}},process?:{env:Record<string,string|undefined>}};
 return runtime.Deno?.env.get(key)??runtime.process?.env[key]??'';
};
type Job={transaction_id:string;lease_token:string;reference:string;type:string;category:string;amount:number|string;status:string;gateway_reference:string|null;bank_code:string;account_number:string};
type Decision={outcome:'done'|'retry'|'review';code:string};
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
 try{jobs=await rpc('claim_payment_reconciliation',{p_limit:5});if(!Array.isArray(jobs)||jobs.length>5)throw Error('INVALID_BATCH');}
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
     const response=await fetch(`https://api.paystack.co/${endpoint}/verify/${encodeURIComponent(job.reference)}`,{method:'GET',headers:{Authorization:'Bearer '+env('PAYSTACK_SECRET_KEY')},signal:AbortSignal.timeout(10000)});
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
 return reply(counts.incomplete?503:200,counts);
}
const runtime=globalThis as unknown as {Deno?:{serve?:(h:(req:Request)=>Promise<Response>)=>void}};
if(runtime.Deno?.serve)runtime.Deno.serve(handleReconciliation);
