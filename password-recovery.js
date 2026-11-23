/** Password recovery by a fresh server-verified email login. No stored browser session is reused. */
(function(root){
 'use strict';
 function createRecovery(client){
  let busy=false;
  const emailOf=value=>String(value||'').trim().toLowerCase();
  const validEmail=value=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  return {
   async requestCode(address){
    const email=emailOf(address);
    if(!validEmail(email))throw Error('Enter a valid account email address.');
    if(busy)throw Error('Please wait for the current request.');
    busy=true;
    try{
     const result=await client.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
     if(result.error)throw Error('Could not send a code. Wait a minute and try again.');
    }catch(_){throw Error('Could not send a code. Wait a minute and try again.');}
    finally{busy=false;}
   },
   async resetPassword({email:address,token,password,confirmation}){
    const email=emailOf(address);
    if(!validEmail(email)||typeof token!=='string'||!/^\d{6}$/.test(token))throw Error('Enter your account email and complete six-digit code.');
    if(typeof password!=='string'||password.length<12||password.length>128||password!==confirmation)throw Error('Use matching passwords between 12 and 128 characters.');
    if(busy)throw Error('Please wait for the current request.');
    busy=true;
    try{
     // The endpoint checks Auth OTP validity and records independent email proof.
     const verified=await client.functions.invoke('verify-email-otp',{body:{email,token}});
     const data=verified.data;
     if(verified.error||data?.success!==true||!data.user?.id||emailOf(data.user.email)!==email||!data.session?.access_token||!data.session?.refresh_token)throw Error('Code verification failed. Request a new code and try again.');
     const adopted=await client.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
     if(adopted.error||adopted.data?.user?.id!==data.user.id||emailOf(adopted.data?.user?.email)!==email)throw Error('Could not establish your verified session. Request another code.');
     const updated=await client.auth.updateUser({password});
     if(updated.error||updated.data?.user?.id!==data.user.id)throw Error('Password could not be changed. Request a fresh code and try a different strong password.');
     let sessionsRevoked=false;
     try{sessionsRevoked=!(await client.auth.signOut({scope:'global'})).error;}catch(_){/* Password update succeeded; report revocation separately. */}
     return {success:true,sessionsRevoked};
    }catch(_){
     throw Error('Recovery could not be confirmed. If you already submitted a new password, try signing in with it before requesting another code.');
    }finally{
     try{await client.auth.signOut({scope:'local'});}catch(_){}
     busy=false;
    }
   }
  };
 }
 if(typeof module!=='undefined'&&module.exports){module.exports={createRecovery};return;}
 const doc=root.document,config=root.MIDEPAY_SUPABASE_CONFIG,status=doc.getElementById('recovery-status');
 const send=doc.getElementById('send-code'),save=doc.getElementById('save-password');
 if(config?.url!=='https://ajbhsmcosxgymrtawlmd.supabase.co'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config?.anonKey||'')||!root.supabase?.createClient){
  status.textContent='Staging recovery is unavailable. Please reload this page.';send.disabled=true;save.disabled=true;return;
 }
 const client=root.supabase.createClient(config.url,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const recovery=createRecovery(client),email=doc.getElementById('recovery-email'),code=doc.getElementById('recovery-code'),password=doc.getElementById('recovery-password'),confirm=doc.getElementById('recovery-confirm');
 let cooldownUntil=0,working=false;
 doc.getElementById('request-code').addEventListener('submit',async event=>{
  event.preventDefault();if(working||Date.now()<cooldownUntil)return;
  working=true;send.disabled=true;save.disabled=true;
  try{await recovery.requestCode(email.value);email.readOnly=true;doc.getElementById('reset-password').hidden=false;status.textContent='If this account can receive email, a verification code has been sent. Check your inbox and spam folder.';cooldownUntil=Date.now()+60000;code.focus();}
  catch(error){status.textContent=error.message;}
  finally{working=false;save.disabled=false;send.disabled=Date.now()<cooldownUntil;}
 });
 root.setInterval(()=>{if(!working){const seconds=Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000));send.disabled=seconds>0;send.textContent=seconds?'Resend code in '+seconds+'s':'Send verification code';}},1000);
 doc.getElementById('reset-password').addEventListener('submit',async event=>{
  event.preventDefault();if(working)return;working=true;send.disabled=true;save.disabled=true;
  try{
   const result=await recovery.resetPassword({email:email.value,token:code.value.trim(),password:password.value,confirmation:confirm.value});
   status.textContent=result.sessionsRevoked?'Password changed. Sign in with your new password.':'Password changed. Other sessions could not be signed out; review your account sessions after signing in.';
   doc.getElementById('request-code').hidden=true;doc.getElementById('reset-password').hidden=true;doc.getElementById('recovery-done').hidden=false;
  }catch(error){status.textContent=error.message;}
  finally{password.value='';confirm.value='';code.value='';working=false;save.disabled=false;send.disabled=Date.now()<cooldownUntil;}
 });
})(typeof window!=='undefined'?window:globalThis);
