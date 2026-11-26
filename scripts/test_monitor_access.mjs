import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {uuid_ossp} from '@electric-sql/pglite/contrib/uuid_ossp';
const root=path.resolve(import.meta.dirname,'..');
const db=new PGlite({extensions:{pgcrypto,uuid_ossp}});let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
const asRole=(role,statement)=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE '+role);return tx.query(statement);});
try{
 await db.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto;CREATE EXTENSION "uuid-ossp";
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,phone text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_user::text$$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;CREATE PUBLICATION supabase_realtime;
 CREATE SCHEMA cron;CREATE SCHEMA net;
 CREATE TABLE cron.job(jobid bigint,jobname text,active boolean);
 CREATE TABLE cron.job_run_details(jobid bigint,status text,start_time timestamptz);
 CREATE TABLE net._http_response(status_code integer,timed_out boolean,created timestamptz);
 INSERT INTO cron.job VALUES(1,'midepay-staging-reconcile-payments',true);
 INSERT INTO cron.job_run_details VALUES(1,'succeeded',now()),(2,'failed',now());
 INSERT INTO net._http_response VALUES(200,false,now());`);
 for(const file of fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/staging/monitor_access.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/staging/monitor_endpoint_access.sql'),'utf8'));
 await test('dedicated role starts without login or privileged attributes',async()=>{const r=(await db.query("SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit,rolconnlimit FROM pg_roles WHERE rolname='midepay_monitor_reader'")).rows[0];assert.deepEqual(r,{rolcanlogin:false,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolbypassrls:false,rolinherit:false,rolconnlimit:2});});
 await test('monitor has no membership in client or service roles',async()=>{for(const role of ['authenticated','anon','service_role'])assert.equal((await db.query(`SELECT pg_has_role('midepay_monitor_reader','${role}','MEMBER') AS member`)).rows[0].member,false);});
 await test('service wrapper can retrieve only expected aggregate shape',async()=>{const h=(await asRole('service_role','SELECT public.read_staging_monitor_health() AS health')).rows[0].health;assert.equal(h.project_ref,'ajbhsmcosxgymrtawlmd');assert.equal(h.scheduler_count,1);assert.equal(h.scheduler_failures_15m,0);assert.equal(h.scheduler_successes_15m,1);assert.deepEqual(h.recovery_queue,[]);assert.ok(!JSON.stringify(h).includes('signing_key'));});
 await test('browser and dormant monitor roles cannot call service wrapper',async()=>{for(const role of ['anon','authenticated','midepay_monitor_reader'])await assert.rejects(()=>asRole(role,'SELECT public.read_staging_monitor_health()'),e=>e.code==='42501');});
 await test('direct wallet, customer, private control, scheduler and HTTP reads rejected',async()=>{for(const table of ['public.wallets','public.profiles','private.payment_reconciliation_control','cron.job','net._http_response'])await assert.rejects(()=>asRole('midepay_monitor_reader','SELECT * FROM '+table),e=>e.code==='42501');});
 await test('monitor cannot call any financial security-definer function',async()=>{const r=await db.query("SELECT count(*)::int AS total FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prosecdef AND has_function_privilege('midepay_monitor_reader',p.oid,'EXECUTE')");assert.equal(r.rows[0].total,0);await assert.rejects(()=>asRole('midepay_monitor_reader',"SELECT settle_gateway_deposit('test','paystack',100,'test','{}')"),e=>e.code==='42501');});
 await test('monitor cannot change payout controls even if transaction defaults overridden',async()=>{await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE midepay_monitor_reader;SET LOCAL default_transaction_read_only=off');await tx.exec('UPDATE private.payment_reconciliation_control SET payout_dispatch_enabled=true');}),e=>e.code==='42501');});
 await test('monitor cannot replace its function or create persistent objects',async()=>{await assert.rejects(()=>asRole('midepay_monitor_reader','CREATE TABLE midepay_monitor.bypass(id int)'),e=>e.code==='42501');await assert.rejects(()=>asRole('midepay_monitor_reader','DROP FUNCTION midepay_monitor.get_health()'),e=>e.code==='42501');});
 await test('browser and service roles cannot call monitor aggregate endpoint',async()=>{for(const role of ['anon','authenticated','service_role'])await assert.rejects(()=>asRole(role,'SELECT midepay_monitor.get_health()'),e=>e.code==='42501');});
 await test('function has pinned safe search path and no dynamic or mutating SQL',async()=>{const p=(await db.query("SELECT proconfig,prosrc FROM pg_proc WHERE oid='midepay_monitor.get_health()'::regprocedure")).rows[0];assert.deepEqual(p.proconfig,['search_path=pg_catalog']);assert.doesNotMatch(p.prosrc,/\b(?:EXECUTE|INSERT|UPDATE|DELETE|signing_key|token_hash|last_code)\b/i);});
 console.log(passed+' monitor access groups passed');
}finally{await db.close();}
