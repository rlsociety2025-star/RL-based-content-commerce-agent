import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {llmSettings} from '../worker.mjs';
test('fresh schema and upgrade explicitly allow the selected Claude model',()=>{
 const model=llmSettings({LLM_PROVIDER:'claude'}).model;
 for(const file of ['001_real_integrations.sql','002_claude_model.sql']){
  const sql=readFileSync(new URL('../db/'+file,import.meta.url),'utf8');
  assert.ok(sql.includes("model like 'gemma-%' or model = '"+model+"'"));
  assert.ok(!/model\s+like\s+'claude-%'/i.test(sql),'do not broaden Claude allowlist');
 }
});
test('Claude migration preserves data and authorization',()=>{
 const sql=readFileSync(new URL('../db/002_claude_model.sql',import.meta.url),'utf8');
 assert.match(sql,/begin;/i);assert.match(sql,/commit;/i);
 assert.ok(!/\b(delete from|truncate|drop table|disable row level security|grant|revoke)\b/i.test(sql));
 assert.match(sql,/drop constraint cc_runs_model_check/i);
 assert.match(sql,/add constraint cc_runs_model_check/i);
});
