const STAGING='https://ajbhsmcosxgymrtawlmd.supabase.co';
const fields=['observed_at','project_ref','recovery_enabled','payout_dispatch_enabled','scheduler_count','scheduler_active','scheduler_successes_15m','scheduler_failures_15m','last_scheduler_success','expired_recovery_leases','overdue_recovery_jobs','expired_payout_leases'];
const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleStagingHealth(req,{projectUrl,token,readHealth}){
 if(req.method!=='POST')return respond(405,{error:'METHOD_NOT_ALLOWED'});
 if(req.headers.has('origin'))return respond(403,{error:'SERVER_ONLY'});
 if(projectUrl!==STAGING||!/^\b[a-f0-9]{64}$/.test(token||''))return respond(503,{error:'MONITOR_NOT_CONFIGURED'});
 const supplied=req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!supplied)return respond(401,{error:'UNAUTHORIZED'});
 const digest=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const [a,b]=await Promise.all([digest(token),digest(supplied)]);let diff=0;
 for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 if(diff!==0)return respond(401,{error:'UNAUTHORIZED'});
 try{
  const data=await readHealth();
  if(!data||data.project_ref!=='ajbhsmcosxgymrtawlmd')throw Error('invalid');
  const health=Object.fromEntries(fields.map(key=>[key,data[key]]));
  for(const key of ['recovery_queue','payout_queue']){
   if(!Array.isArray(data[key]))throw Error('invalid');
   health[key]=data[key].map(r=>({state:r.state,count:r.count}));
  }
  if(!Array.isArray(data.http_responses_15m_project_wide))throw Error('invalid');
  health.http_responses_15m_project_wide=data.http_responses_15m_project_wide.map(r=>({status_code:r.status_code,timed_out:r.timed_out,count:r.count}));
  return respond(200,{health});
 }catch{return respond(503,{error:'MONITOR_UNAVAILABLE'});}
}
