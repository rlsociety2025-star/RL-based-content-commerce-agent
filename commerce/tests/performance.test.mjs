import test from 'node:test';
import assert from 'node:assert/strict';
import {reward7Days,performanceRoute} from '../performance.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const P={id:'p',published_at:'2026-11-18T12:44:00Z'};
test('unobserved and provisional zero rewards remain null',()=>{
 assert.equal(reward7Days(P,[],Date.parse('2026-12-01')).value,null);
 assert.equal(reward7Days(P,[{publication_id:'p',metric_day:'2026-11-18',daily_views:0,provisional:true,source_kind:'manual_official_ui',observed_at:'2026-11-18T14:30:00Z'}],Date.parse('2026-12-01')).value,null);
});
const rows=Array.from({length:7},(_,i)=>({publication_id:'p',metric_day:'2026-11-'+(18+i),daily_views:i,cumulative_views:999,provisional:false,source_kind:'manual_official_ui',observed_at:'2026-11-'+(19+i)+'T01:00:00Z'}));
test('seven finalized KST daily values sum once, never cumulative snapshots',()=>{
 const r=reward7Days(P,rows,Date.parse('2026-11-26'));assert.equal(r.value,21);assert.equal(r.complete_days,7);
 assert.equal(reward7Days(P,[...rows,...rows],Date.parse('2026-11-26')).value,21);
 assert.equal(reward7Days(P,rows,Date.parse('2026-11-20')).value,null);
});
test('latest provisional observation prevents silently using earlier final value',()=>{
 const revised=[...rows,{...rows[0],observed_at:'2026-11-26T01:00:00Z',provisional:true}];
 assert.equal(reward7Days(P,revised,Date.parse('2026-11-27')).value,null);
});
test('real finalized zero can be zero, fake sources and future observations cannot',()=>{
 assert.equal(reward7Days(P,rows.map(x=>({...x,daily_views:0})),Date.parse('2026-11-26')).value,0);
 assert.equal(reward7Days(P,rows.map(x=>({...x,source_kind:'fake'})),Date.parse('2026-11-26')).value,null);
});
const post={id:'p',created_by:'user',status:'published_operator_reported',log_no:'123',published_at:P.published_at};
const base={publication_id:'p',metric_day:'2026-11-18',daily_views:0,cumulative_views:0,observed_at:'2026-11-18T14:30:00Z',provisional:true,confirmed:true};
function helpers(){const calls=[];return {calls,db:async(_e,_t,path,method='GET',body)=>{calls.push({path,method,body});return method==='POST'?[{id:'obs',...body}]:[post];},id:x=>x,text:x=>x,fail:(_s,_c,m)=>{throw Error(m);}};}
test('manual observation computes official source URL and preserves provisional zero',async()=>{
 const h=helpers();const r=await performanceRoute('/api/performance/observations','POST',{...base,source_url:'evil'},{},{user:{id:'user'},token:'test'},h);
 assert.equal(r.observation.source_url,'https://blog.stat.naver.com/blog/article/123/cv');assert.equal(r.observation.daily_views,0);assert.equal(r.observation.provisional,true);
});
test('rejects invented future dates, missing confirmation, negative values and premature finalization',async()=>{
 for(const change of [{observed_at:'2099-01-01T00:00:00Z'},{confirmed:false},{daily_views:-1},{provisional:false},{metric_day:'2026-11-17'}]){
  const h=helpers();await assert.rejects(()=>performanceRoute('/api/performance/observations','POST',{...base,...change},{},{user:{id:'user'},token:'t'},h));assert.ok(!h.calls.some(c=>c.method==='POST'));
 }
});
const ctx={setTimeout,clearTimeout};vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../public/automation.js',import.meta.url),'utf8'),ctx);
function runner(reply){let calls=0,scheduled=0;const r=ctx.CommerceAutomation.createRunner({user:()=> 'u',api:async()=>{calls++;if(reply instanceof Error)throw reply;return reply;},schedule:()=>{scheduled++;},cancel:()=>{}});return {r,calls:()=>calls,scheduled:()=>scheduled};}
test('queue never runs before explicit start',()=>{const h=runner({job:null});assert.equal(h.calls(),0);assert.equal(h.r.isActive(),false);});
test('uncertain paid response stops without retry',async()=>{
 for(const reply of [new Error('timeout'),{job:{status:'needs_attention'}},{job:{status:'running'},needs_attention:true}]){
  const h=runner(reply);await h.r.start();await h.r.tick();assert.equal(h.calls(),1);assert.equal(h.scheduled(),0);assert.equal(h.r.isActive(),false);
 }
});
test('completed job permits next tick but empty queue stops',async()=>{
 const h=runner({job:{status:'completed'}});await h.r.start();assert.equal(h.scheduled(),1);h.r.stop();
 const empty=runner({job:null,reason:'disabled'});await empty.r.start();assert.equal(empty.scheduled(),0);
});
test('logged-out and hidden-tab runner makes no requests',async()=>{
 let calls=0;const hidden=ctx.CommerceAutomation.createRunner({user:()=> 'u',visible:()=>false,api:async()=>calls++});
 await hidden.start();assert.equal(calls,0);
 const out=ctx.CommerceAutomation.createRunner({user:()=>null,api:async()=>calls++});await assert.rejects(()=>out.start());assert.equal(calls,0);
});
