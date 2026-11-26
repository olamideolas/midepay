import {handleStagingHealth} from './handler.mjs';
Deno.serve((req: Request)=>handleStagingHealth(req,{
 projectUrl:Deno.env.get('SUPABASE_URL')||'',
 token:Deno.env.get('STAGING_MONITOR_TOKEN')||'',
 readHealth:async()=>{
  const url=Deno.env.get('SUPABASE_URL')||'';
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!key)throw Error('unconfigured');
  const response=await fetch(url+'/rest/v1/rpc/read_staging_monitor_health',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('unavailable');
  return response.json();
 }
}));
