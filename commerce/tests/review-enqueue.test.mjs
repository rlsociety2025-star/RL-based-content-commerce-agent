import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../public/automation.js',import.meta.url),'utf8');
const c={setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(script,c);
const S='22222222-2222-4222-a222-222222222222',P='33333333-3333-4333-a333-333333333333';
const source={id:S,content_hash:'a'.repeat(64),body:'Reviewed public fixture only',title:'Fixture',source_uri:'public.md',status:'draft'};
const input={source,product_ids:[P],query:'public topic',confirmed:true};
function fixture(options={}){
 let current={...source,...options.current},owner='owner',saved=null,ids=0;
 const calls=[];
 const api=async(path,b,expected)=>{
  calls.push({path,b,expected});
  if(path==='sources')return {items:[current]};
  if(path.endsWith('/verify')){if(options.verifyFail)throw Error('network');current={...current,status:'verified'};if(options.switchUser)owner='other';return {document:options.invalidReview?{...current,status:'draft'}:current};}
  if(path==='automation/jobs'){
   if(!saved)saved={job:{id:b.request_id,status:'pending'}};
   if(options.loseQueue){options.loseQueue=false;throw Error('response lost');}return saved;
  }
  throw Error('Forbidden side effect '+path);
 };
 const helper=c.CommerceAutomation.createReviewEnqueuer({api,user:()=>owner,uuid:()=> 'id-'+(++ids)});
 return {helper,calls,getCurrent:()=>current,getSaved:()=>saved};
}
test('explicit human confirmation and ready inputs required before any requests',async()=>{
 for(const change of [{confirmed:false},{product_ids:[]},{query:'x'}]){const f=fixture();await assert.rejects(()=>f.helper.submit({...input,...change}));assert.equal(f.calls.length,0);}
});
test('review success then enqueue only; no activation, indexing, generation or publication',async()=>{
 const f=fixture();const r=await f.helper.submit(input);assert.equal(r.reviewedNow,true);
 assert.deepEqual(f.calls.map(x=>x.path),['sources','sources/'+S+'/verify','automation/jobs']);
 assert.ok(f.calls.every(x=>x.expected==='owner'));assert.equal(f.calls[1].b.confirmed,true);
});
test('already verified source uses normal queue path without a new review operation',async()=>{
 const f=fixture({current:{status:'verified'}});const r=await f.helper.submit({...input,source:{...source,status:'verified'},confirmed:false});
 assert.equal(r.reviewedNow,false);assert.deepEqual(f.calls.map(x=>x.path),['sources','automation/jobs']);
});
test('failed or unconfirmed review must not enqueue',async()=>{
 for(const opt of [{verifyFail:true},{invalidReview:true}]){const f=fixture(opt);await assert.rejects(()=>f.helper.submit(input),e=>e.stage==='review_unknown');assert.ok(!f.calls.some(x=>x.path==='automation/jobs'));}
});
test('queue response loss preserves verified status, clearly reports partial outcome, retry same id',async()=>{
 const f=fixture({loseQueue:true});await assert.rejects(()=>f.helper.submit(input),e=>e.stage==='queue_unknown'&&e.message.includes('검토 완료는 확인'));
 assert.equal(f.getCurrent().status,'verified');const first=f.getSaved().job.id;
 const r=await f.helper.submit(input);assert.equal(r.job.id,first);
 const posts=f.calls.filter(x=>x.path==='automation/jobs');assert.equal(posts.length,2);assert.equal(posts[0].b.request_id,posts[1].b.request_id);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/verify')).length,1);
});
test('changed hash or original text requires a new human review',async()=>{
 for(const current of [{content_hash:'b'.repeat(64)},{body:'changed'},{status:'archived'}]){const f=fixture({current});await assert.rejects(()=>f.helper.submit(input),e=>e.stage==='revision');assert.equal(f.calls.length,1);}
});
test('account switch after review prevents enqueue',async()=>{
 const f=fixture({switchUser:true});await assert.rejects(()=>f.helper.submit(input),e=>e.stage==='auth');assert.ok(!f.calls.some(x=>x.path==='automation/jobs'));
});
test('double click has one in-flight operation',async()=>{
 let release,calls=0;const h=c.CommerceAutomation.createReviewEnqueuer({user:()=> 'owner',uuid:()=> 'id',api:async path=>{calls++;if(path==='sources')return new Promise(r=>release=()=>r({items:[{...source,status:'verified'}]}));return {job:{id:'id',status:'pending'}};}});
 const first=h.submit(input);await assert.rejects(()=>h.submit(input),e=>e.stage==='busy');release();await first;assert.equal(calls,2);
});
test('source choice and reload reset human checkbox and show original preview; logout clears it',()=>{
 assert.ok(script.includes("$('automation-source').onchange=showReviewSource"));
 assert.ok(script.includes("$('automation-reviewed').checked=false"));assert.ok(script.includes("['content_hash','body','title','source_uri']"));
 assert.ok(script.includes("$('automation-review-preview').textContent='';"));
});
