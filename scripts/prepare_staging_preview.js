#!/usr/bin/env node
/** Build a staging-only upload directory without retargeting the source checkout. */
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const STAGING_URL='https://ajbhsmcosxgymrtawlmd.supabase.co';
const PRODUCTION_REF='pxdzdehocjnmxbuvipxu';
const assets=['refund-review.js','payment-review.css','payment-review.js',"assets/banks/opay.png","assets/banks/palmpay.png","assets/banks/kuda.png","assets/banks/moniepoint.png","assets/banks/gtbank.png","assets/banks/access.png","assets/banks/zenith.png","assets/banks/uba.png","assets/banks/firstbank.png","assets/banks/providus.png",'ui-polish.css','ui-polish.js','password-recovery.html','password-recovery.js','password-recovery.css','index.html','style.css','liquid-glass.css','loading-animation.css','liquid-glass.js','app.js','supabaseClient.js','sw.js','favicon.svg','logo.svg','manifest.json','midepay-icon.png','midepay-logo.jpg','midepay-logo.png','midepay-logo.svg','vendor/supabase.js','vendor/supabase.LICENSE.txt','vendor/supabase.version.json','api/config.js','build.js','config.js','vercel.json'];
function prepare({url,key,output}){
 if(url!==STAGING_URL)throw Error('Only the explicitly approved MidePay staging project is allowed.');
 if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key||''))throw Error('An enabled staging publishable key is required.');
 const out=path.resolve(output);if(out===ROOT || ROOT.startsWith(out+path.sep))throw Error('Output must not overwrite the source checkout.');
 const marker=path.join(out,'.midepay-staging-preview.json');
 if(fs.existsSync(out)&&fs.readdirSync(out).length&&!fs.existsSync(marker))throw Error('Refusing to overwrite an unrelated nonempty directory.');
 const oldKey=fs.readFileSync(path.join(ROOT,'config.js'),'utf8').match(/anonKey:\s*['"]([^'"]+)['"]/)?.[1];
 fs.mkdirSync(out,{recursive:true});
 for(const name of assets){const source=path.join(ROOT,name),dest=path.join(out,name);fs.mkdirSync(path.dirname(dest),{recursive:true});
  if(/\.(png|jpg|jpeg|ico)$/i.test(name)){fs.copyFileSync(source,dest);continue;}
  let text=fs.readFileSync(source,'utf8').replaceAll(PRODUCTION_REF,'ajbhsmcosxgymrtawlmd');if(oldKey)text=text.replaceAll(oldKey,key);
  // Public previews must not export the prototype's embedded member/ledger fixtures.
  if(name==='app.js'){
   text=text.replace(/const DEFAULT_DEMO_TRANSACTIONS = \[[\s\S]*?\r?\n\];/,'const DEFAULT_DEMO_TRANSACTIONS = [];')
    .replace(/const BUILTIN_REGISTERED_ACCOUNTS = \[[\s\S]*?\r?\n\];/,'const BUILTIN_REGISTERED_ACCOUNTS = [];')
    .replace('const DEFAULT_PREVIEW_USER = BUILTIN_REGISTERED_ACCOUNTS[0];','const DEFAULT_PREVIEW_USER = {};')
    .replace(/const demoRequests = \[[\s\S]*?\r?\n        \];/,'const demoRequests = [];')
    .replace(/adminWaitlistEntries = \[\s*\{ email:[\s\S]*?\r?\n      \];/,'adminWaitlistEntries = [];');
  }
  if(name==='app.js'||name==='index.html'){
   text=text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'sample@example.invalid')
    .replace(/\b\d{10,}\b/g,'0000000000')
    .replaceAll('Olamide Olasunkanmi','Sample Member').replaceAll('Chinedu Eze','Sample Recipient').replaceAll('Aisha Bello','Sample Member');
  }
  if(name==='build.js')text=`// Staging upload only: fail closed on an unexpected database target.\nconst approvedStagingUrl=${JSON.stringify(url)};\nif(process.env.SUPABASE_URL && process.env.SUPABASE_URL!==approvedStagingUrl)throw Error('Staging target mismatch');\nprocess.env.SUPABASE_URL=approvedStagingUrl;\nprocess.env.SUPABASE_ANON_KEY=${JSON.stringify(key)};\nprocess.env.APP_ENV='production';\nprocess.env.FINANCIAL_RPCS_LIVE='false';\n`+text;
  if(name==='api/config.js')text=text.replace(/const env = .*;/,"const env = 'production';").replace(/const url = .*;/,'const url = '+JSON.stringify(url)+';').replace(/const anonKey = .*;/,'const anonKey = '+JSON.stringify(key)+';').replace(/const financialRpcsLive = .*;/,'const financialRpcsLive = false;');
  if(name==='build.js')text="process.env.TEST_PAYSTACK_CHECKOUT='true';\n"+text;
  if(name==='api/config.js')text=text.replace(/const testPaystackCheckout = .*;/,'const testPaystackCheckout = true;');
  if(name==='config.js')text='window.MIDEPAY_SUPABASE_CONFIG = '+JSON.stringify({ENV:'production',FINANCIAL_RPCS_LIVE:false,TEST_PAYSTACK_CHECKOUT:true,url,anonKey:key},null,2)+';\n';
  fs.writeFileSync(dest,text);
 }
 fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({name:'midepay-staging-preview',version:'1.0.0',private:true,scripts:{build:'node build.js'},engines:{node:'>=22'}},null,2)+'\n');
 const config=JSON.parse(fs.readFileSync(path.join(out,'vercel.json'),'utf8'));config.installCommand='node -e "process.exit(0)"';fs.writeFileSync(path.join(out,'vercel.json'),JSON.stringify(config,null,2)+'\n');
 fs.writeFileSync(marker,JSON.stringify({target:'preview',supabaseUrl:url,sourceBranch:'fix-v46-migration-repair',financialOperationsEnabled:false},null,2)+'\n');
 return {output:out,files:assets.length+2,target:'preview',supabaseUrl:url};
}
if(require.main===module){try{const index=process.argv.indexOf('--output');const output=index>=0?process.argv[index+1]:path.join(ROOT,'work/staging-preview');console.log(JSON.stringify(prepare({url:process.env.STAGING_SUPABASE_URL,key:process.env.STAGING_SUPABASE_PUBLISHABLE_KEY,output})));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={prepare};
