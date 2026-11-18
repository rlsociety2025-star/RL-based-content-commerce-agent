(()=>{'use strict';
const FOLDER='ContentCommerce-Inbox';
async function entries(handle){
 if(handle?.kind!=='directory'||handle.name!==FOLDER)throw Error('ContentCommerce-Inbox 전용 폴더를 선택하세요. 볼트 전체는 선택할 수 없습니다.');
 const files=[];let count=0;
 for await(const [name,h]of handle.entries()){
  if(++count>200)throw Error('전용 폴더 항목이 너무 많습니다. 최대 200개로 나누세요.');
  if(name.toLowerCase()==='.obsidian')throw Error('옵시디언 볼트 루트는 가져올 수 없습니다. 전용 하위 폴더를 선택하세요.');
  if(h.kind==='file'&&!name.startsWith('.')&&/\.md$/i.test(name)&&!/[\\/:]/.test(name)&&name.length<=160)files.push({name,handle:h});
 }
 if(files.length>50)throw Error('한 전용 폴더에는 Markdown 파일을 50개 이하로 두세요.');
 return files.sort((a,b)=>a.name.localeCompare(b.name));
}
function normalize(body){return body.replace(/\r\n?/g,'\n').trim();}
function createSync({api,user,visible=()=>true,changed=async()=>{},status=()=>{},stateChanged=()=>{},schedule=setTimeout,cancel=clearTimeout}){
 let folder=null,owner=null,active=false,busy=false,timer=null,generation=0,seen=new Map();
 let state='unselected';
 const labels={unselected:'미연결',ready:'시작 전',running:'실행 중',paused:'일시정지',stopped:'중지'};
 function report(next,message){state=next;status('['+labels[next]+'] '+message);stateChanged(next);}
 const allowed=n=>active&&n===generation&&owner&&user()===owner;
 function stop(message='새 노트는 수집하지 않습니다. 다시 시작을 누르면 중지 중 추가된 노트도 확인합니다. 이미 전송한 요청은 완료될 수 있습니다.'){active=false;generation++;if(timer)cancel(timer);timer=null;report(folder?'stopped':'unselected',message);}
 async function choose(handle){stop('폴더 확인 중');const list=await entries(handle);folder=handle;seen=new Map();report('ready',FOLDER+' · 대상 '+list.length+'개 (.md, 최상위만). 아직 전송하지 않았습니다.');return list;}
 async function start(){if(!folder)throw Error('전용 폴더를 먼저 선택하세요.');const current=user();if(!current)throw Error('승인된 팀 계정으로 로그인하세요.');if(active)return;if(busy)throw Error('진행 중 요청이 끝난 뒤 다시 시작하세요.');owner=current;active=true;generation++;report('running','폴더 변경을 확인합니다.');await tick();}
 async function tick(){
  if(!active||busy)return;
  const n=generation;
  if(!allowed(n)){stop('로그인 계정이 바뀌어 중지했습니다.');return;}
  busy=true;let saved=0,reused=0,errors=[];
  try{
   if(!visible()){report('paused','탭이 숨겨져 일시정지 중입니다. 탭으로 돌아오면 다시 확인합니다.');return;}
   if(await folder.queryPermission({mode:'read'})!=='granted'){stop('폴더 읽기 권한이 없어 중지했습니다. 다시 선택하세요.');return;}
   const files=await entries(folder);
   for(const item of files){
    if(!allowed(n))break;
    try{
     const file=await item.handle.getFile();
     if(!allowed(n))break;
     if(file.size>100000)throw Error('100KB 초과');
     const body=normalize(await file.text());
     if(!allowed(n))break;
     if(body.length<20||body.length>12000)throw Error('본문 20~12,000자 필요');
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),x=>x.toString(16).padStart(2,'0')).join('');
     if(!allowed(n))break;
     if(seen.get(item.name)===hash)continue;
     const result=await api('import-source',{folder:FOLDER,filename:item.name,body},owner);
     if(!allowed(n))break;
     if(!result?.document?.id)throw Error('서버 저장 확인 실패');
     seen.set(item.name,hash);if(result.reused)reused++;else saved++;
    }catch(e){errors.push(item.name+': '+(e.message||'읽기/저장 실패'));if(!allowed(n))break;}
   }
   if(allowed(n)){
    report('running','마지막 확인 '+new Date().toLocaleTimeString('ko-KR')+' · 대상 '+files.length+'개 · 새 초안 '+saved+' · 기존 동일본 '+reused+(errors.length?' · 오류 '+errors.join(' / '):' · 15초마다 확인'));
    if(saved||reused)await changed();
   }
  }catch(e){if(allowed(n))report('running','확인 실패: '+e.message+' · 전송 실패 파일은 다음 확인 때 재시도합니다.');}
  finally{busy=false;if(active&&n===generation&&user()!==owner)stop('로그인 계정이 바뀌어 중지했습니다.');if(allowed(n))timer=schedule(tick,15000);}
 }
 return {choose,start,stop,tick,isActive:()=>active,getState:()=>state};
}
function mount({api,user,changed}){
 const el=id=>document.getElementById(id),status=t=>{el('inbox-status').textContent=t;};
 const sync=createSync({api,user,changed,status,stateChanged:state=>{el('inbox-start').textContent=state==='stopped'?'가져오기 다시 시작':state==='running'||state==='paused'?'가져오기 실행 중':'자동 가져오기 시작';},visible:()=>!document.hidden});
 let selected=false;
 el('inbox-select').onclick=async()=>{try{
  if(!user())throw Error('승인된 팀 계정으로 로그인하세요.');
  if(!window.showDirectoryPicker)throw Error('데스크톱 Chrome 또는 Edge에서 여세요. 일반 파일 업로드도 사용할 수 있습니다.');
  const handle=await window.showDirectoryPicker({id:'commerce-inbox',mode:'read'});
  const list=await sync.choose(handle);selected=true;el('inbox-files').textContent=list.map(f=>f.name).join('\n')||'현재 대상 파일 없음';
 }catch(e){if(e.name!=='AbortError'){selected=false;sync.stop(e.message);}}};
 el('inbox-start').onclick=async()=>{try{
  if(!selected)throw Error('전용 폴더를 먼저 선택하세요.');
  if(sync.isActive())return;
  if(!confirm('선택한 ContentCommerce-Inbox의 최상위 .md 본문과 파일명을 Supabase 팀 공간에 검토 전 초안으로 가져옵니다. 이후 이 폴더에 추가·수정한 .md도 탭이 열려 있는 동안 전송합니다. 개인 노트·비밀키를 넣지 마세요. 자동 검토·색인·AI 생성·발행은 하지 않습니다. 시작할까요?'))return;
  await sync.start();
 }catch(e){status(e.message);}};
 el('inbox-stop').onclick=()=>sync.stop();
 window.addEventListener('pagehide',()=>sync.stop());
 window.addEventListener('offline',()=>sync.stop('오프라인으로 중지했습니다. 연결 후 시작을 다시 누르세요.'));
 if(!window.showDirectoryPicker)status('자동 폴더 가져오기는 데스크톱 Chrome/Edge가 필요합니다. 아래 파일 불러오기는 계속 사용할 수 있습니다.');
 return sync;
}
globalThis.CommerceInbox={entries,normalize,createSync,mount};
})();