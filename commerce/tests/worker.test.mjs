import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{sha,chunks,parseCandidates,embed,httpsUrl} from '../worker.mjs';
const U='11111111-1111-4111-a111-111111111111',D='22222222-2222-4222-a222-222222222222',P='33333333-3333-4333-a333-333333333333',R='44444444-4444-4444-a444-444444444444';
const body='검증한 출퇴근용 가방 선택 기준입니다. 노트북 수납 규격과 무게를 확인합니다.';
const hash=await sha(body);
const doc={id:D,title:'근거',body,source_uri:'guide.md',content_hash:hash,status:'verified'};
const product={id:P,name:'등록 상품',description:'사람이 확인한 상품 사양입니다.',price:10000};
const candidate={product_id:P,content_type:'guide',title:'선택 기준',body:'제공된 자료를 확인하고 작성한 초안입니다.',cta:'사양 확인',source_ids:[D]};
const env=()=>({SUPABASE_URL:'https://hfqqqetcjbkptipqhskx.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test',GEMINI_API_KEY:'PRIVATE-GOOGLE-TEST',QDRANT_API_KEY:'PRIVATE-QDRANT-TEST',QDRANT_URL:'https://test.cloud.qdrant.io:6333',AI_CALLS_ENABLED:'true',AI:{run:async(_m,{text})=>({data:text.map(()=>Array(1024).fill(.1))})},AI_RATE_LIMITER:{limit:async()=>({success:true})},ASSETS:{fetch:async()=>new Response('static')}});
const req=(path,body,auth=true)=>new Request('https://test.workers.dev/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(auth?{Authorization:'Bearer test-session'}:{}),'content-type':'application/json',Origin:'https://test.workers.dev'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
function mock(options={}) {const calls=[];globalThis.fetch=async(url,init={})=>{const u=new URL(String(url));calls.push({url:u.href,...init});let response,status=200;
 if(u.pathname==='/auth/v1/user'){if(options.badAuth)status=401;response={id:U,email:'test@example.invalid'};}
 else if(u.pathname.endsWith('/dashboard_access'))response=options.unapproved?[]:[{user_id:U}];
 else if(u.hostname.includes('supabase.co')){if(u.pathname.endsWith('/cc_sources')){if(init.method==='POST')response=[{...JSON.parse(init.body),id:D}];else if(init.method==='PATCH')response=options.changed?[]:[doc];else response=options.noDocs?[]:[{...doc,status:options.draft?'draft':'verified',content_hash:options.stale?'b'.repeat(64):hash}];}
 else if(u.pathname.endsWith('/cc_products'))response=[product];
 else if(u.pathname.endsWith('/cc_runs')){if(init.method==='POST'){if(options.saveFail)status=500;response=[{...JSON.parse(init.body),created_at:'2026-11-17T00:00:00Z'}];}else response=options.old?[{id:R,candidates:[candidate]}]:[];}
 else if(u.pathname.endsWith('/cc_reviews'))response=[];else throw Error('unexpected db '+u.pathname);}
 else if(u.hostname.includes('qdrant.io')){if(u.pathname.endsWith('/points/query'))response={result:{points:options.noHits?[]:[{score:.8,payload:{document_id:D,content_hash:hash,chunk_index:0}}]}};else if(u.pathname.endsWith('/index')||u.pathname.endsWith('/points'))response={result:{status:'completed'}};else{status=options.collectionMissing?404:200;response={result:{config:{params:{vectors:{size:options.badDimension?768:1024,distance:'Cosine'}}}}};}}
 else if(u.hostname==='generativelanguage.googleapis.com')response={candidates:[{content:{parts:[{text:options.badJSON?'not json':JSON.stringify({candidates:[candidate]})}]}}]};
 else throw Error('unexpected network '+u.href);
 return new Response(JSON.stringify(response),{status,headers:{'content-type':'application/json'}});};return calls;}
const generation={query:'출퇴근 백팩 선택 기준',product_ids:[P],request_id:R};
test('public config never returns secret values',async()=>{mock();const r=await worker.fetch(req('config',undefined,false),env());const s=await r.text();assert.equal(r.status,200);assert.ok(!s.includes('PRIVATE-'));assert.ok(s.includes('public-test'));});
test('anonymous private request is denied before network',async()=>{const calls=mock();const r=await worker.fetch(req('sources',undefined,false),env());assert.equal(r.status,401);assert.equal(calls.length,0);});
test('invalid session denied',async()=>{mock({badAuth:true});assert.equal((await worker.fetch(req('me'),env())).status,401);});
test('unapproved member denied before paid APIs',async()=>{const calls=mock({unapproved:true});assert.equal((await worker.fetch(req('generate',generation),env())).status,403);assert.equal(calls.length,2);});
test('cross-origin POST blocked',async()=>{const calls=mock();const r=req('sources',{});r.headers.set('Origin','https://evil.invalid');assert.equal((await worker.fetch(r,env())).status,403);assert.equal(calls.length,0);});
test('missing Qdrant fails; no fallback generation',async()=>{const calls=mock();const e=env();delete e.QDRANT_API_KEY;const r=await worker.fetch(req('generate',generation),e);assert.equal(r.status,503);assert.ok(!calls.some(c=>c.url.includes('googleapis')));});
test('AI calls require explicit enablement',async()=>{mock();const e=env();e.AI_CALLS_ENABLED='false';assert.equal((await worker.fetch(req('generate',generation),e)).status,503);});
test('per-user rate limiting',async()=>{mock();const e=env();e.AI_RATE_LIMITER.limit=async()=>({success:false});assert.equal((await worker.fetch(req('generate',generation),e)).status,429);});
test('draft cannot be indexed',async()=>{const calls=mock({draft:true});const r=await worker.fetch(req(`sources/${D}/index`,{}),env());assert.equal(r.status,409);assert.ok(!calls.some(c=>c.url.includes('qdrant.io')));});
test('verification requires explicit confirmation',async()=>{mock();assert.equal((await worker.fetch(req(`sources/${D}/verify`,{}),env())).status,400);});
test('vector dimension mismatch fails without changing collection',async()=>{const calls=mock({badDimension:true});const r=await worker.fetch(req(`sources/${D}/index`,{}),env());assert.equal(r.status,409);assert.ok(!calls.some(c=>c.method==='PUT'));});
test('wrong embedding dimensions rejected',async()=>{const e=env();e.AI.run=async()=>({data:[[1,2]]});await assert.rejects(()=>embed(e,['x']),/1024/);});
test('source indexing preserves canonical metadata',async()=>{const calls=mock();const r=await worker.fetch(req(`sources/${D}/index`,{}),env());assert.equal(r.status,200);const points=JSON.parse(calls.find(c=>c.url.includes('/points?')).body).points;assert.equal(points[0].vector.length,1024);assert.equal(points[0].payload.content_hash,hash);assert.equal(points[0].payload.status,'verified');});
test('stale Qdrant point is excluded using canonical DB hash',async()=>{mock({stale:true});const r=await worker.fetch(req('search',{query:'백팩'}),env());assert.equal(r.status,200);assert.equal((await r.json()).hits.length,0);});
test('zero evidence does not call Gemma',async()=>{const calls=mock({noHits:true});const r=await worker.fetch(req('generate',generation),env());assert.equal(r.status,409);assert.ok(!calls.some(c=>c.url.includes('googleapis')));});
test('real connector flow calls Qdrant, Gemma, then Supabase with reward null',async()=>{const calls=mock();const r=await worker.fetch(req('generate',generation),env());assert.equal(r.status,201);const data=await r.json();assert.equal(data.run.kind,'integration');assert.equal(data.run.reward,null);assert.equal(data.run.retrieved_sources[0].document_id,D);const g=calls.find(c=>c.url.includes('googleapis'));assert.equal(g.headers['x-goog-api-key'],'PRIVATE-GOOGLE-TEST');assert.ok(!g.url.includes('PRIVATE-'));assert.ok(calls.findIndex(c=>c.url.includes('googleapis'))<calls.findIndex(c=>c.url.endsWith('/cc_runs')&&c.method==='POST'));});
test('Gemma invalid JSON is not treated as success',async()=>{mock({badJSON:true});assert.equal((await worker.fetch(req('generate',generation),env())).status,502);});
test('DB save failure is not treated as completed generation',async()=>{mock({saveFail:true});assert.equal((await worker.fetch(req('generate',generation),env())).status,502);});
test('saved request replay does not call paid model',async()=>{const calls=mock({old:true});const r=await worker.fetch(req('generate',generation),env());assert.equal((await r.json()).reused,true);assert.ok(!calls.some(c=>c.url.includes('googleapis')));});
test('unknown evidence/product from model rejected',()=>{assert.throws(()=>parseCandidates(JSON.stringify({candidates:[{...candidate,source_ids:[U]}]}),[product],[{document_id:D}]),/근거/);});
test('plain empty/invalid input rejected',async()=>{mock();assert.equal((await worker.fetch(req('sources',null),env())).status,400);assert.equal((await worker.fetch(req('generate',{...generation,request_id:'../users'}),env())).status,400);});
test('external collection cannot be overwritten',async()=>{mock();const e=env();e.QDRANT_COLLECTION='my_existing_collection';assert.equal((await worker.fetch(req('search',{query:'백팩'}),e)).status,503);});
test('no arbitrary endpoint supplied in request',async()=>{mock();const e=env();e.QDRANT_URL='https://localhost/';assert.equal((await worker.fetch(req('search',{query:'백팩'}),e)).status,503);});
test('source creation is draft, not client-provided verified',async()=>{mock();const r=await worker.fetch(req('sources',{title:'노트',body,source_uri:'source.md',status:'verified'}),env());assert.equal(r.status,201);assert.equal((await r.json()).document.status,'draft');});
test('safe href validation and source chunk size',()=>{assert.throws(()=>httpsUrl('javascript:alert(1)'));assert.throws(()=>httpsUrl('https://a:b@example.com'));assert.equal(chunks('가'.repeat(3000)).length,3);assert.ok(chunks('가'.repeat(3000)).every(x=>x.length<=1400));});
test('static paths served without touching backend',async()=>{const calls=mock();const r=await worker.fetch(new Request('https://test.workers.dev/'),env());assert.equal(await r.text(),'static');assert.equal(calls.length,0);});
