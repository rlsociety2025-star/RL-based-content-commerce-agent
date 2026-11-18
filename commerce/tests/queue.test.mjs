import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {queueGet,queuePost} from '../queue.mjs';
const U='11111111-1111-4111-a111-111111111111',S='22222222-2222-4222-a222-222222222222',J='33333333-3333-4333-a333-333333333333',P='44444444-4444-4444-a444-444444444444';
const auth={user:{id:U},token:'fake-test'};
const env={AI_CALLS_ENABLED:'true',AI:{run(){}},AI_RATE_LIMITER:{limit(){}}};
function fixture(opts={}){
 const calls=[];let claimed=false;
 const job={id:J,source_id:S,source_hash:'a'.repeat(64),query:'public product topic',product_ids:[P],status:'running'};
 const d={
  db:async(_e,_t,path,method,body)=>{
   calls.push(['db',path,body]);
   if(path==='rpc/cc_automation'){
    if(body.p_action==='claim'){
     if(opts.none)return {job:null,reason:opts.none};
     if(claimed)return {job:null,reason:'running_or_attention'};
     claimed=true;return {job};
    }
    if(body.p_action==='finish'){
     if(opts.finishFail)throw Error('DB unavailable');
     return {job:{...job,status:body.p_data.error_code?'needs_attention':'completed',error_code:body.p_data.error_code}};
    }
    return {[body.p_action==='settings'?'settings':'job']:body.p_data};
   }
   if(path.startsWith('cc_automation_settings'))return opts.emptySettings?[]:[{enabled:!opts.stopped,daily_limit:1}];
   if(path.startsWith('cc_automation_jobs'))return [];
   throw Error('Unexpected path '+path);
  },
  id:x=>{if(typeof x!=='string'||!x.includes('-'))throw Error('id');return x;},
  text:(x,_n,min,max)=>{if(typeof x!=='string'||x.trim().length<min||x.trim().length>max)throw Error('text');return x.trim();},
  fail:(status,code,message)=>{throw Object.assign(Error(message),{status,code});},
  indexSource:async(...x)=>{calls.push(['index',...x]);if(opts.indexFail)throw Object.assign(Error('network uncertain'),{code:'UPSTREAM_UNAVAILABLE'});},
  generate:async(...x)=>{calls.push(['generate',...x]);if(opts.generateFail)throw Object.assign(Error('save failed'),{code:'SAVE_FAILED'});return {run:{id:J}};},
  getSource:async()=>({id:S,status:opts.draft?'draft':'verified',content_hash:opts.changed?'b'.repeat(64):job.source_hash}),
  qsettings:()=>({}),llmSettings:()=>({key:opts.noKey?null:'fake-key'})
 };return {d,calls};
}
const run=(d,e=env)=>queuePost(e,auth,'/api/automation/run-next',{},d);
test('automation defaults off without settings; own-filtered lists',async()=>{
 const {d,calls}=fixture({emptySettings:true});const r=await queueGet(env,auth,d);assert.deepEqual(r.settings,{enabled:false,daily_limit:null});
 assert.ok(calls.every(c=>c[1].includes('created_by=eq.'+U)));
});
test('settings need explicit bool and integer count1..5',async()=>{
 const {d}=fixture();for(const b of [{},{enabled:true,daily_limit:0},{enabled:true,daily_limit:6},{enabled:'true',daily_limit:1},{enabled:true,daily_limit:1.5}])
 await assert.rejects(()=>queuePost(env,auth,'/api/automation/settings',b,d));
});
test('enqueue forwards only canonical fields and no approval flag',async()=>{
 const {d,calls}=fixture();await queuePost(env,auth,'/api/automation/jobs',{source_id:S,request_id:J,query:' public topic ',product_ids:[P,P],verified:true},d);
 const p=calls[0][2].p_data;assert.deepEqual(p.product_ids,[P]);assert.equal(p.query,'public topic');assert.ok(!('verified'in p));
});
test('disabled cost gate or missing key rejects before reservation',async()=>{
 for(const opts of [{env:{...env,AI_CALLS_ENABLED:'false'}},{noKey:true}]){
  const {d,calls}=fixture(opts);await assert.rejects(()=>run(d,opts.env||env));assert.equal(calls.length,0);
 }
});
test('disabled, limit, empty and uncertain claim reasons trigger no paid work',async()=>{
 for(const none of ['disabled','daily_limit','empty','running_or_attention']){
  const {d,calls}=fixture({none});assert.equal((await run(d)).reason,none);assert.equal(calls.length,1);
 }
});
test('queue claims once then indexes, rechecks enabled, generates selected source and finishes',async()=>{
 const {d,calls}=fixture();const r=await run(d);assert.equal(r.job.status,'completed');
 assert.equal(calls[0][2].p_action,'claim');const g=calls.find(c=>c[0]==='generate');assert.equal(g[3].request_id,J);assert.equal(g[4],S);
 assert.ok(calls.findIndex(c=>c[0]==='index')<calls.findIndex(c=>c[0]==='generate'));
 assert.equal(calls.at(-1)[2].p_action,'finish');
});
test('draft or changed source is blocked before indexing and stays needs_attention',async()=>{
 for(const opts of [{draft:true},{changed:true}]){
  const {d,calls}=fixture(opts);assert.equal((await run(d)).job.status,'needs_attention');assert.ok(!calls.some(c=>c[0]==='index'||c[0]==='generate'));
 }
});
test('stop after indexing prevents generation',async()=>{
 const {d,calls}=fixture({stopped:true});assert.equal((await run(d)).job.status,'needs_attention');assert.equal(calls.filter(c=>c[0]==='index').length,1);assert.ok(!calls.some(c=>c[0]==='generate'));
});
test('uncertain indexing or generation never retries and blocks next job',async()=>{
 for(const opts of [{indexFail:true},{generateFail:true}]){
  const {d,calls}=fixture(opts);assert.equal((await run(d)).job.status,'needs_attention');assert.equal((await run(d)).reason,'running_or_attention');
  assert.equal(calls.filter(c=>c[0]==='index').length,1);assert.ok(calls.filter(c=>c[0]==='generate').length<=1);
 }
});
test('state-write failure retains running reservation with attention flag',async()=>{
 const {d,calls}=fixture({generateFail:true,finishFail:true});const r=await run(d);assert.equal(r.job.status,'running');assert.equal(r.needs_attention,true);assert.equal(calls.filter(c=>c[0]==='generate').length,1);
});
test('reconcile only finishes existing reservation without paid work',async()=>{
 const {d,calls}=fixture();await queuePost(env,auth,'/api/automation/reconcile',{job_id:J},d);assert.equal(calls.length,1);assert.equal(calls[0][2].p_action,'finish');
});
test('SQL keeps writes behind private authenticated atomic state machine',()=>{
 const sql=readFileSync(new URL('../db/004_verified_automation.sql',import.meta.url),'utf8');
 assert.match(sql,/private\.cc_automation_rpc/);assert.match(sql,/security definer set search_path=''/);assert.match(sql,/security invoker set search_path=''/);
 assert.match(sql,/auth\.uid\(\)/);assert.match(sql,/public\.is_dashboard_member\(\)/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/unique\(created_by,fingerprint\)/);assert.match(sql,/fingerprint=fp/);assert.match(sql,/j.status not in \('running','needs_attention'\)/);
 assert.match(sql,/claimed_at>=day_start/);assert.match(sql,/Asia\/Seoul/);assert.match(sql,/daily_limit between 1 and 5/);
 assert.ok(!/grant (insert|update|delete|all) on public\.cc_automation/i.test(sql));
 assert.ok(!/set status='pending'/i.test(sql));assert.ok(!/alter table public\.cc_runs/i.test(sql));
});

test('SQL structural integrity: one transaction, one state machine, complete hashes',()=>{
 const sql=readFileSync(new URL('../db/004_verified_automation.sql',import.meta.url),'utf8');
 const count=re=>[...sql.matchAll(re)].length;
 assert.equal(count(/^begin;$/gm),1);
 assert.equal(count(/^commit;$/gm),1);
 assert.equal(count(/^create function private\.cc_automation_rpc\(/gm),1);
 assert.equal(count(/^create function public\.cc_automation\(/gm),1);
 assert.equal(count(/^create table public\.cc_automation_settings \(/gm),1);
 assert.equal(count(/^create table public\.cc_automation_jobs \(/gm),1);
 assert.equal(count(/\$\$/g),4);
 assert.ok(sql.includes("source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),"));
 assert.ok(sql.includes("fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),"));
 assert.ok(sql.trimEnd().endsWith('commit;'));
 assert.ok(sql.length<15000,'Unexpected duplicated SQL payload');
});

