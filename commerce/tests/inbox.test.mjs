import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker,{inboxInput} from '../worker.mjs';
const source=readFileSync(new URL('../public/inbox.js',import.meta.url),'utf8');
const ctx={TextEncoder,crypto,setTimeout,clearTimeout,Date};vm.createContext(ctx);vm.runInContext(source,ctx);
const {entries,createSync}=ctx.CommerceInbox;
const U='11111111-1111-4111-a111-111111111111';
const BODY='출처를 사람이 직접 검토해야 하는 공개 상품 정보 테스트 본문입니다.';
function file(name,body=BODY){return [name,{kind:'file',getFile:async()=>({size:body.length*3,text:async()=>body})}];}
function folder(items=[],name='ContentCommerce-Inbox'){return {kind:'directory',name,queryPermission:async()=> 'granted',async *entries(){yield*items;}};}
function client(options={}){
 const calls=[];let who=U,changes=0;
 const s=createSync({api:async(...args)=>{calls.push(args);return {document:{id:'saved'},reused:false};},user:()=>who,changed:async()=>{changes++;},schedule:()=>0,cancel:()=>{},...options});
 return {s,calls,setUser:v=>who=v,changes:()=>changes};
}
test('rejects wrong folder and vault root before reading or sending',async()=>{
 await assert.rejects(()=>entries(folder([],'COCOA')));
 await assert.rejects(()=>entries(folder([file('first.md'),['.obsidian',{kind:'directory'}]])));
});
test('only direct visible md is eligible; never traverses directories',async()=>{
 const list=await entries(folder([file('good.md'),file('.secret.md'),file('x.txt'),['nested',{kind:'directory',entries:()=>{throw Error('never recurse');}}]]));
 assert.deepEqual(Array.from(list,x=>x.name),['good.md']);
});
test('selection sends nothing; start imports draft route; identical rescan skips',async()=>{
 const c=client();await c.s.choose(folder([file('note.md')]));assert.equal(c.calls.length,0);
 await c.s.start();await c.s.tick();assert.equal(c.calls.length,1);
 assert.equal(c.calls[0][0],'import-source');assert.equal(c.calls[0][2],U);
});
test('edited content imports new revision; previous file is never modified',async()=>{
 let body=BODY;const h=folder([['note.md',{kind:'file',getFile:async()=>({size:100,text:async()=>body})}]]);
 const c=client();await c.s.choose(h);await c.s.start();body=BODY+' 추가 설명';await c.s.tick();assert.equal(c.calls.length,2);
 assert.notEqual(c.calls[0][1].body,c.calls[1][1].body);
});
test('failure is retried without marking failed content as seen',async()=>{
 let count=0;const c=client({api:async()=>{if(++count===1)throw Error('network');return {document:{id:'saved'},reused:true};}});
 await c.s.choose(folder([file('x.md')]));await c.s.start();await c.s.tick();await c.s.tick();assert.equal(count,2);
});
test('logout or account switch before sending stops transmission',async()=>{
 for(const who of [null,'another-user']){const c=client();await c.s.choose(folder([file('x.md')]));c.setUser(who);if(!who)await assert.rejects(()=>c.s.start());else{await c.s.start();c.setUser(U);await c.s.tick();assert.equal(c.calls.length,1);assert.equal(c.s.isActive(),false);}}
 const c=client();const h=folder([['x.md',{kind:'file',getFile:async()=>{c.setUser(null);return {size:100,text:async()=>BODY};}}]]);
 await c.s.choose(h);await c.s.start();assert.equal(c.calls.length,0);
});
test('overlapping loops do not send duplicate requests',async()=>{
 let release;const c=client({api:async()=>new Promise(r=>{release=()=>r({document:{id:'saved'}});})});
 await c.s.choose(folder([file('x.md')]));const first=c.s.start();
 while(!release)await new Promise(r=>setTimeout(r,1));
 await c.s.tick();release();await first;assert.equal(c.changes(),1);
});
test('oversized files and hidden tabs do not transmit',async()=>{
 const c=client();await c.s.choose(folder([file('big.md','가'.repeat(40000))]));await c.s.start();assert.equal(c.calls.length,0);
 const d=client({visible:()=>false});await d.s.choose(folder([file('x.md')]));await d.s.start();assert.equal(d.calls.length,0);
});
test('server normalizes and rejects out-of-scope filenames',()=>{
 assert.equal(inboxInput({folder:'ContentCommerce-Inbox',filename:'x.md',body:'  '+BODY+'\r\n  '}).body,BODY);
 for(const name of ['.hidden.md','../a.md','sub\\a.md','a.txt'])assert.throws(()=>inboxInput({folder:'ContentCommerce-Inbox',filename:name,body:BODY}));
 assert.throws(()=>inboxInput({folder:'COCOA',filename:'x.md',body:BODY}));
});
const E={SUPABASE_URL:'https://hfqqqetcjbkptipqhskx.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test'};
const req=b=>new Request('https://test.workers.dev/api/import-source',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json',origin:'https://test.workers.dev'},body:JSON.stringify(b)});
function backend({lost=false,unapproved=false}={}){
 const records=[];let posts=0;globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);let out,status=200;
  if(u.pathname==='/auth/v1/user')out={id:U};
  else if(u.pathname.endsWith('/dashboard_access'))out=unapproved?[]:[{user_id:U}];
  else if(u.pathname.endsWith('/cc_sources')){
   if(init.method==='POST'){
    posts++;const row=JSON.parse(init.body);
    if(records.some(r=>r.created_by===row.created_by&&r.source_uri===row.source_uri)){status=409;out={};}
    else{row.id='saved-'+posts;records.push(row);out=[row];if(lost){status=500;lost=false;}}
   }else{const uri=u.searchParams.get('source_uri')?.slice(3);out=records.filter(r=>r.source_uri===uri&&r.created_by===U);}
  }else throw Error('No other network or AI permitted');
  return new Response(JSON.stringify(out),{status});
 };
 return {records,posts:()=>posts};
}
const input={folder:'ContentCommerce-Inbox',filename:'공개.md',body:BODY,status:'verified',source_uri:'evil',content_hash:'evil'};
test('server first import draft, repeat no duplicate, edited new draft preserves verified original',async()=>{
 const b=backend();const one=await worker.fetch(req(input),E);assert.equal(one.status,200);assert.equal((await one.json()).document.status,'draft');
 assert.equal(b.posts(),1);b.records[0].status='verified';
 const two=await worker.fetch(req({...input,body:' '+BODY+'\r\n'}),E);assert.equal((await two.json()).reused,true);assert.equal(b.posts(),1);
 await worker.fetch(req({...input,body:BODY+' 수정 버전'}),E);
 assert.equal(b.records.length,2);assert.equal(b.records[0].status,'verified');assert.equal(b.records[1].status,'draft');
 assert.ok(b.records[0].source_uri.startsWith('obsidian-inbox:ContentCommerce-Inbox/'));assert.notEqual(b.records[0].content_hash,'evil');
});
test('lost POST response recovers same record without duplicate write',async()=>{
 const b=backend({lost:true});const r=await worker.fetch(req(input),E);assert.equal(r.status,200);assert.equal((await r.json()).reused,true);
 assert.equal(b.records.length,1);assert.equal(b.posts(),1);
});
test('unapproved import is denied without inserting',async()=>{
 const b=backend({unapproved:true});assert.equal((await worker.fetch(req(input),E)).status,403);assert.equal(b.posts(),0);
});

test('stopping then restarting collects notes added during stop without reimporting seen content',async()=>{
 const items=[file('first.md')],c=client();await c.s.choose(folder(items));await c.s.start();
 c.s.stop();items.push(file('second.md',BODY+' 새 노트'));await c.s.tick();assert.equal(c.calls.length,1);
 await c.s.start();assert.equal(c.calls.length,2);assert.equal(c.calls[1][1].filename,'second.md');
});
test('page reload starts disconnected; explicit reselect/start deduplicates against server',async()=>{
 const b=backend(),items=[file('first.md')];
 const make=()=>client({api:async(_path,payload)=>{const response=await worker.fetch(req(payload),E);if(!response.ok)throw Error('save');return response.json();}});
 const first=make();await first.s.choose(folder(items));await first.s.start();first.s.stop();
 items.push(file('second.md',BODY+' 두 번째'));
 const reloaded=make();assert.equal(reloaded.s.getState(),'unselected');assert.equal(reloaded.s.isActive(),false);
 await reloaded.s.tick();assert.equal(b.records.length,1);
 await reloaded.s.choose(folder(items));assert.equal(b.records.length,1);
 await reloaded.s.start();assert.equal(b.records.length,2);assert.equal(b.posts(),2);
 assert.ok(b.records.every(r=>r.status==='draft'));
});
test('state labels distinguish ready running hidden-tab pause and explicit stop',async()=>{
 let visible=false;const messages=[];const c=client({visible:()=>visible,status:s=>messages.push(s)});
 assert.equal(c.s.getState(),'unselected');await c.s.choose(folder());assert.equal(c.s.getState(),'ready');
 await c.s.start();assert.equal(c.s.getState(),'paused');assert.equal(c.s.isActive(),true);
 visible=true;await c.s.tick();assert.equal(c.s.getState(),'running');c.s.stop();assert.equal(c.s.getState(),'stopped');
 assert.ok(messages.some(s=>s.startsWith('[일시정지]')));assert.ok(messages.at(-1).includes('다시 시작'));
});
