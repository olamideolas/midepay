/** Staging-only aggregate collector. Dry-run by default; never changes database state. */
import {pathToFileURL} from 'node:url';
import {evaluateHealth} from './evaluate_staging_health.mjs';
export const RECIPIENT='olamidesunkanmi727@gmail.com';
const PROJECT='ajbhsmcosxgymrtawlmd';
export async function collectSnapshot(env,{request=fetch}={}){
 const token=env.STAGING_MONITOR_TOKEN||'';
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('STAGING_MONITOR_TOKEN_REQUIRED');
 const response=await request(`https://${PROJECT}.supabase.co/functions/v1/staging-health`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('MONITOR_UNAVAILABLE');
 const data=await response.json();
 if(!data?.health)throw Error('INVALID_SNAPSHOT');
 return data.health;
}
export function smtpConfig(env){
 const user=env.MIDEPAY_ALERT_SMTP_USER||'';
 const pass=(env.MIDEPAY_ALERT_SMTP_APP_PASSWORD||'').replaceAll(' ','');
 if(!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(user)||!/^[a-z]{16}$/.test(pass))throw Error('SMTP_CONFIGURATION_REQUIRED');
 return {host:'smtp.gmail.com',port:465,secure:true,auth:{user,pass},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,logger:false,debug:false};
}
export async function deliverAlert(env,report,{createTransport}={}){
 if(!createTransport){const {default:nodemailer}=await import('nodemailer');createTransport=nodemailer.createTransport.bind(nodemailer);}
 const config=smtpConfig(env);
 const transport=createTransport(config);
 try{
  const result=await transport.sendMail({from:{name:'MidePay Staging Monitor',address:config.auth.user},to:RECIPIENT,subject:'MidePay staging needs attention',text:['Staging only. No money was moved by this monitor.','',...report.alerts.map(a=>`${a.severity.toUpperCase()}: ${a.code}`),'','Review Payment Review and the operational guide. Do not retry an ambiguous payment as a new send.'].join('\n'),disableFileAccess:true,disableUrlAccess:true});
  if(!result.accepted?.some(x=>String(x).toLowerCase()===RECIPIENT)||result.rejected?.length)throw Error('SMTP_NOT_ACCEPTED');
 }finally{transport.close();}
}
export async function runMonitor({env={},send=false,collect=collectSnapshot,deliver=deliverAlert,now=Date.now()}={}){
 let report;
 try{report=evaluateHealth(await collect(env),{now});}
 catch{report={status:'invalid',exitCode:2,alerts:[{code:'MONITOR_COLLECTION_FAILED',severity:'critical'}]};}
 if(!send)return {...report,delivery:'dry_run'};
 if(env.MIDEPAY_STAGING_ALERTS_ENABLED!=='true')return {...report,exitCode:2,delivery:'disabled'};
 if(report.status==='healthy')return {...report,delivery:'not_needed'};
 try{await deliver(env,report);return {...report,delivery:'smtp_accepted'};}
 catch{return {...report,exitCode:2,delivery:'failed'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);
 if(args.some(a=>a!=='--send')||args.length>1){console.log(JSON.stringify({status:'invalid',exitCode:2,delivery:'disabled'}));process.exitCode=2;}
 else{const result=await runMonitor({env:process.env,send:args[0]==='--send'});console.log(JSON.stringify(result,null,2));process.exitCode=result.exitCode;}
}
