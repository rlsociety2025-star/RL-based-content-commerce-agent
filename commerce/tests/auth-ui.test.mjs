import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function harness(approved=true){
 const c={session:{user:{id:'A'},access_token:'old'},approved,epoch:7,clears:0,scheduled:0};
 c.clear=()=>{c.clears++;c.approved=false;c.session=null;};
 c.authRefresh=()=>{};c.setTimeout=()=>{c.scheduled++;};
 vm.createContext(c);
 vm.runInContext(app.slice(app.indexOf('function onAuthChange('),app.indexOf('function button('))+';this.change=onAuthChange;',c);
 return c;
}
for(const event of ['TOKEN_REFRESHED','SIGNED_IN','USER_UPDATED']){
 test('same approved identity preserves draft and request epoch on '+event,()=>{
  const c=harness();c.change(event,{user:{id:'A'},access_token:'new'});
  assert.equal(c.clears,0);assert.equal(c.scheduled,0);assert.equal(c.epoch,7);assert.equal(c.session.access_token,'new');
 });
}
test('logout and account switch clear immediately and invalidate in-flight responses',()=>{
 for(const next of [null,{user:{id:'B'}}]){
  const c=harness();c.change(next?'SIGNED_IN':'SIGNED_OUT',next);
  assert.equal(c.clears,1);assert.equal(c.epoch,8);assert.equal(c.scheduled,1);assert.equal(c.approved,false);
 }
});
test('unapproved same user must still recheck approval',()=>{
 const c=harness(false);c.change('TOKEN_REFRESHED',{user:{id:'A'}});
 assert.equal(c.clears,1);assert.equal(c.scheduled,1);
});
test('auth subscription uses identity-aware event handler',()=>assert.ok(app.includes('client.auth.onAuthStateChange(onAuthChange)')));
test('saved history reopening renders stored run without generation call',()=>{
 const buttons=[];const viewed=[];const element=()=>({append(){},replaceChildren(){}});
 const run={id:'saved',query:'saved query',model:'claude-haiku-4-5-20251001',candidates:[{}],created_at:'2026-11-18T12:25:00Z'};
 const c={runs:[run],reviews:[],$:element,node:element,button:(label,fn)=>{buttons.push({label,fn});return {};},renderRun:r=>viewed.push(r),tab:name=>viewed.push(name),api:()=>{throw Error('no network allowed');}};
 vm.createContext(c);
 vm.runInContext(app.slice(app.indexOf('function renderHistory('),app.indexOf('async function reloadHistory('))+';renderHistory();',c);
 const open=buttons.find(b=>b.label==='저장 결과 열기');assert.ok(open);open.fn();
 assert.equal(viewed[0],run);assert.equal(viewed[1],'generate');
});
