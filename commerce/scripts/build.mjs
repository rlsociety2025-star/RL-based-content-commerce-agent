import {cp,mkdir,rm,readFile,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
for(const file of ['worker.mjs','public/app.js','public/inbox.js']){
 const r=spawnSync(process.execPath,['--check',resolve(root,file)],{stdio:'inherit'});
 if(r.status!==0)process.exit(r.status||1);
}
await rm(resolve(root,'dist'),{recursive:true,force:true});
await cp(resolve(root,'public'),resolve(root,'dist'),{recursive:true});
// Preserve the existing project dashboard without modifying its sources.
await mkdir(resolve(root,'dist/project'),{recursive:true});
for(const file of ['index.html','dashboard.css','dashboard.js']){
 try{await cp(resolve(root,'..',file),resolve(root,'dist/project',file));}catch{ /* Optional for standalone ZIP. */ }
}
try{await cp(resolve(root,'../vendor'),resolve(root,'dist/vendor'),{recursive:true});await cp(resolve(root,'../vendor'),resolve(root,'dist/project/vendor'),{recursive:true});}catch{
 console.error('Missing ../vendor/supabase.js. Run from the existing content-commerce repository.');process.exit(1);
}
await access(resolve(root,'dist/vendor/supabase.js'));
const html=await readFile(resolve(root,'dist/index.html'),'utf8');
for(const name of ['/app.js','/inbox.js','/style.css','/vendor/supabase.js'])if(!html.includes(name))throw Error('Missing asset '+name);
await writeFile(resolve(root,'dist/build-info.json'),JSON.stringify({version:'0.1.0',builtAt:new Date().toISOString(),scope:'real-connectors; no Naver execution; no real reward training'},null,2));
console.log('Cloudflare assets ready. Secrets are not copied to dist.');
