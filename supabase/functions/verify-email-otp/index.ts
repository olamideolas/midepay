/** Verifies a fresh email OTP with Auth before recording server-only email proof.
 * No client session or client-supplied verification flag is accepted as proof.
 */
export interface EmailOtpDependencies {
  allowedOrigins?: string[];
  consumeAttempt?: (email: string) => Promise<{ allowed: boolean }>;
  verifyOtp?: (email: string, token: string) => Promise<{ data: any; error: unknown }>;
  attest?: (userId: string, email: string) => Promise<{ data: any; error: unknown }>;
}
function env(name: string): string { return (globalThis as any).Deno?.env?.get(name) ?? (globalThis as any).process?.env?.[name] ?? ''; }
export async function handleVerifyEmailOtp(req: Request, deps: EmailOtpDependencies = {}): Promise<Response> {
  const origin = req.headers.get('origin');
  const allowed = deps.allowedOrigins ?? env('ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean);
  const headers: Record<string,string> = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin']=origin;
  const respond=(status:number, body:unknown)=>new Response(JSON.stringify(body),{status,headers});
  if (origin && !allowed.includes(origin)) return respond(403,{error:'Origin not allowed.'});
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}});
  if (req.method!=='POST') return respond(405,{error:'POST required.'});
  if (Number(req.headers.get('content-length') || 0)>4096) return respond(413,{error:'Request too large.'});
  let body: any;
  try {const raw=await req.text();if(raw.length>4096)return respond(413,{error:'Request too large.'});body=JSON.parse(raw);} catch {return respond(400,{error:'Invalid JSON.'});}
  if (!body || typeof body!=='object' || Array.isArray(body)) return respond(400,{error:'Invalid request.'});
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  const token=typeof body.token==='string'?body.token:'';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !/^\d{6}$/.test(token)) return respond(400,{error:'Email and six-digit code required.'});
  try {
    let anon: any, admin: any;
    if (!deps.verifyOtp || !deps.attest || !deps.consumeAttempt) {
      const url=env('SUPABASE_URL'), anonKey=env('SUPABASE_ANON_KEY'), service=env('SUPABASE_SERVICE_ROLE_KEY');
      if (!url||!anonKey||!service) return respond(503,{error:'Verification unavailable.'});
      const {createClient}=await import('npm:@supabase/supabase-js@2');
      anon=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
      admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    }
    const consume=deps.consumeAttempt ?? (async (address:string)=>{const {data,error}=await admin.rpc('consume_email_otp_attempt',{p_email:address});if(error)throw error;return data;});
    if (!(await consume(email))?.allowed) return respond(429,{error:'Too many verification attempts. Try again later.'});
    const verify=deps.verifyOtp ?? ((address:string,code:string)=>anon.auth.verifyOtp({email:address,token:code,type:'email'}));
    const {data,error}=await verify(email,token);
    const user=data?.user, session=data?.session;
    if(error || !user?.id || String(user.email||'').toLowerCase()!==email || !user.email_confirmed_at ||
       !session?.access_token || !session?.refresh_token || session?.user?.id!==user.id || String(session?.user?.email||'').toLowerCase()!==email) {
      return respond(400,{error:'Invalid or expired email code.'});
    }
    const attest=deps.attest ?? ((id:string,address:string)=>admin.rpc('attest_verified_email',{p_user_id:id,p_email:address}));
    const proof=await attest(user.id,email);
    if(proof.error || proof.data?.success!==true) return respond(503,{error:'Verification could not be recorded. Request another code.'});
    return respond(200,{success:true,user,session:{access_token:session.access_token,refresh_token:session.refresh_token,expires_in:session.expires_in,expires_at:session.expires_at}});
  } catch {return respond(503,{error:'Verification temporarily unavailable.'});}
}
const runtime=(globalThis as any).Deno;
if(runtime?.serve) runtime.serve((req:Request)=>handleVerifyEmailOtp(req));
