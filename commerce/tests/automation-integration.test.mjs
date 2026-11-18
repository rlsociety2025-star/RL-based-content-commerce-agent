import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
const env={SUPABASE_URL:'https://hfqqqetcjbkptipqhskx.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test'};
const U='11111111-1111-4111-a111-111111111111';
test('new endpoints remain private before any network',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};
 for(const path of ['performance','automation'])assert.equal((await worker.fetch(new Request('https://test.workers.dev/api/'+path),env)).status,401);
 assert.equal(calls,0);
});
test('reading automation and views does not generate, index, publish or infer missing values',async()=>{
 const calls=[];globalThis.fetch=async(url)=>{calls.push(String(url));const u=new URL(url);let data;
 if(u.pathname.endsWith('/auth/v1/user'))data={id:U};
 else if(u.pathname.endsWith('/dashboard_access'))data=[{user_id:U}];
 else if(['/cc_automation_settings','/cc_automation_jobs','/cc_publication_queue','/cc_view_observations'].some(x=>u.pathname.endsWith(x)))data=[];
 else throw Error('Unexpected external action');
 return new Response(JSON.stringify(data));};
 const request=path=>new Request('https://test.workers.dev/api/'+path,{headers:{Authorization:'Bearer test'}});
 const a=await (await worker.fetch(request('automation'),env)).json();assert.equal(a.settings.enabled,false);
 const p=await (await worker.fetch(request('performance'),env)).json();assert.deepEqual(p.rewards,[]);assert.equal(p.publishing,'not_connected');assert.equal(p.collection,'manual_official_ui');
 assert.ok(calls.every(x=>new URL(x).hostname.endsWith('.supabase.co')));
});
