/** Offline aggregate evaluator. No database access, secrets, network or financial actions. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const PROJECT='ajbhsmcosxgymrtawlmd';
const count=value=>Number.isSafeInteger(value)&&value>=0;
const stamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
export function evaluateHealth(input,{now=Date.now()}={}){
 const h=Array.isArray(input)&&input.length===1?input[0]?.health:input;
 const invalid=()=>({status:'invalid',exitCode:2,alerts:[{code:'INVALID_SNAPSHOT',severity:'critical'}]});
 if(!h||typeof h!=='object'||h.project_ref!==PROJECT||!stamp(h.observed_at)||!Number.isFinite(now))return invalid();
 for(const key of ['recovery_enabled','payout_dispatch_enabled','scheduler_active'])if(typeof h[key]!=='boolean')return invalid();
 for(const key of ['scheduler_count','scheduler_successes_15m','scheduler_failures_15m','expired_recovery_leases','overdue_recovery_jobs','expired_payout_leases'])if(!count(h[key]))return invalid();
 if(h.last_scheduler_success!==null&&!stamp(h.last_scheduler_success))return invalid();
 for(const [key,states] of [['recovery_queue',['ready','leased','done','review']],['payout_queue',['ready','preparing','sending','submitted','review','cancelled','resolved']]]){
  if(!Array.isArray(h[key])||h[key].some(r=>!r||!states.includes(r.state)||!count(r.count)))return invalid();
 }
 if(!Array.isArray(h.http_responses_15m_project_wide)||h.http_responses_15m_project_wide.some(r=>!r||!count(r.count)||typeof r.timed_out!=='boolean'||(r.status_code!==null&&(!Number.isInteger(r.status_code)||r.status_code<100||r.status_code>599))))return invalid();
 const observed=Date.parse(h.observed_at),last=h.last_scheduler_success===null?null:Date.parse(h.last_scheduler_success);
 if(last!==null&&last>observed+30000)return invalid();
 const alerts=[];
 const add=(code,severity='warning')=>alerts.push({code,severity});
 if(now-observed>300000||observed-now>30000)add('STALE_OR_FUTURE_SNAPSHOT','critical');
 if(!h.recovery_enabled)add('RECOVERY_DISABLED','critical');
 if(h.scheduler_count!==1||!h.scheduler_active)add('SCHEDULER_CONFIGURATION','critical');
 if(last===null||observed-last>300000||h.scheduler_successes_15m===0)add('SCHEDULER_NOT_PROGRESSING','critical');
 if(h.scheduler_failures_15m>0)add('SCHEDULER_FAILURE');
 if(h.payout_dispatch_enabled)add('UNEXPECTED_PAYOUT_DISPATCH','critical');
 if(h.recovery_queue.some(r=>r.state==='review'&&r.count>0))add('RECOVERY_MANUAL_REVIEW');
 if(h.payout_queue.some(r=>r.state==='review'&&r.count>0))add('PAYOUT_MANUAL_REVIEW');
 if(h.overdue_recovery_jobs>0)add('RECOVERY_OVERDUE_RECHECK');
 if(h.expired_recovery_leases>0||h.expired_payout_leases>0)add('EXPIRED_LEASE_RECHECK');
 if(h.http_responses_15m_project_wide.some(r=>r.count>0&&(r.timed_out||r.status_code===null||r.status_code<200||r.status_code>=300)))add('PROJECT_HTTP_FAILURE');
 if(h.http_responses_15m_project_wide.every(r=>r.count===0))add('HTTP_EVIDENCE_MISSING');
 return {status:alerts.length?'attention':'healthy',exitCode:alerts.length?1:0,alerts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let result;
 try{
  if(process.argv.length>3)throw Error('arguments');
  result=evaluateHealth(JSON.parse(fs.readFileSync(process.argv[2]||0,'utf8')));
 }catch{result={status:'invalid',exitCode:2,alerts:[{code:'INVALID_SNAPSHOT',severity:'critical'}]};}
 console.log(JSON.stringify(result,null,2));process.exitCode=result.exitCode;
}
