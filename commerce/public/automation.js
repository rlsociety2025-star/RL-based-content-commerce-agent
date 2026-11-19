(()=>{'use strict';
function createRunner({api,user,visible=()=>true,status=()=>{},refresh=async()=>{},schedule=setTimeout,cancel=clearTimeout}){
 let active=false,busy=false,owner=null,timer=null,revision=0;
 const stop=(message='실행 중지. 이미 시작한 1건은 완료될 수 있습니다.')=>{active=false;revision++;if(timer)cancel(timer);status(message);};
 async function tick(){
  if(!active||busy)return;
  if(!owner||user()!==owner||!visible()){stop('로그인 변경 또는 숨겨진 탭으로 큐 실행을 중지했습니다.');return;}
  busy=true;const n=revision;
  try{
   const result=await api('automation/run-next',{},owner);
   if(!active||n!==revision)return;
   await refresh();
   if(result.job?.status==='completed')status('1건 색인·생성 저장 완료. 다음 대기 작업을 확인합니다.');
   else{stop(result.job?.status==='needs_attention'?'확인 필요: 결과가 불확실한 작업은 자동 재호출하지 않습니다.':'큐 중지: '+(result.reason||'대기 작업 없음'));return;}
  }catch(e){stop('큐 오류: '+e.message+' · 유료 호출을 자동 재시도하지 않습니다.');}
  finally{busy=false;if(active&&n===revision)timer=schedule(tick,10000);}
 }
 async function start(){if(active)return;if(busy)throw Error('진행 중 요청이 끝난 뒤 시작하세요.');owner=user();if(!owner)throw Error('승인된 팀 계정으로 로그인하세요.');active=true;revision++;await tick();}
 return {start,stop,tick,isActive:()=>active};
}
function createReviewEnqueuer({api,user,uuid=()=>crypto.randomUUID()}){
 let busy=false;const attempts=new Map();
 const problem=(stage,message)=>Object.assign(Error(message),{stage});
 async function submit({source,product_ids,query,confirmed}){
  if(busy)throw problem('busy','이미 처리 중입니다. 완료될 때까지 기다리세요.');
  const owner=user();if(!owner)throw problem('auth','승인된 팀 계정으로 로그인하세요.');
  if(!source?.id||!source.content_hash)throw problem('input','근거 원문을 먼저 선택하세요.');
  const ids=[...new Set(product_ids||[])].sort(),topic=typeof query==='string'?query.trim():'';
  const validId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
  if(ids.length<1||ids.length>3||!ids.every(validId)||topic.length<3||topic.length>1200)throw problem('input','상품 1~3개와 3~1,200자 주제를 먼저 준비하세요.');
  if(source.status==='archived')throw problem('input','검색 제외 자료는 이 버튼으로 다시 승인하지 않습니다.');
  if(source.status!=='verified'&&confirmed!==true)throw problem('confirmation','원문과 출처를 직접 검토했다는 확인이 필요합니다.');
  const unchanged=()=>{if(user()!==owner)throw problem('auth','로그인 상태가 바뀌어 후속 대기열 등록을 중단했습니다.');};
  busy=true;
  try{
   const fresh=await api('sources',undefined,owner);unchanged();
   const current=fresh.items?.find(x=>x.id===source.id);
   if(!current||['content_hash','body','title','source_uri'].some(k=>current[k]!==source[k]))throw problem('revision','원문 버전이 달라졌습니다. 목록을 다시 읽고 원문을 재검토하세요.');
   if(current.status==='archived')throw problem('revision','자료가 검색 제외 상태로 바뀌었습니다. 대기열에 등록하지 않았습니다.');
   let reviewed=current,reviewedNow=false;
   if(current.status!=='verified'){
    if(confirmed!==true)throw problem('confirmation','현재 자료는 검토 전입니다. 원문을 다시 확인하고 체크하세요.');
    try{const r=await api('sources/'+source.id+'/verify',{confirmed:true},owner);unchanged();reviewed=r.document;
     if(reviewed?.id!==source.id||reviewed.status!=='verified'||reviewed.content_hash!==source.content_hash)throw Error('unconfirmed');
    }catch(e){if(e.stage==='auth')throw e;throw problem('review_unknown','검토 완료 여부를 확인하지 못했습니다. 대기열 등록은 요청하지 않았습니다. 목록에서 상태를 확인한 뒤 다시 시도하세요.');}
    reviewedNow=true;
   }
   unchanged();
   const key=JSON.stringify([owner,source.id,source.content_hash,ids,topic]);
   if(!attempts.has(key))attempts.set(key,uuid());
   let result;
   try{result=await api('automation/jobs',{source_id:source.id,product_ids:ids,query:topic,request_id:attempts.get(key)},owner);unchanged();
    if(!result?.job?.id)throw Error('unconfirmed');
   }catch(e){if(e.stage==='auth')throw e;throw problem('queue_unknown','검토 완료는 확인했지만 대기열 등록 결과는 확인하지 못했습니다. 검토 승인은 취소하지 않았습니다. 같은 입력으로 다시 시도하면 기존 작업을 재사용합니다.');}
   return {...result,reviewedNow};
  }finally{busy=false;}
 }
 return {submit,isBusy:()=>busy};
}

function mount({api,user}){
 const $=id=>document.getElementById(id),node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 let sources=[],runs=[],posts=[],enabled=false;
 const reviewEnqueuer=createReviewEnqueuer({api,user});
 const status=t=>{$('automation-status').textContent=t;};
 const runner=createRunner({api,user,status,visible:()=>!document.hidden,refresh:reload});
 const call=(path,body)=>{const owner=user();if(!owner)throw Error('승인된 팀 계정으로 로그인하세요.');return api(path,body,owner);};
 function options(id,items,label,value){const select=$(id),old=select.value;select.replaceChildren();for(const item of items){const o=node('option',label(item));o.value=value(item);select.append(o);}if([...select.options].some(o=>o.value===old))select.value=old;}
 function showReviewSource(){
  const d=sources.find(x=>x.id===$('automation-source').value);
  $('automation-reviewed').checked=false;$('automation-reviewed').disabled=!d||d.status==='verified';
  $('automation-review-preview').textContent=d?d.title+'\n출처: '+d.source_uri+'\n버전: '+d.content_hash+'\n상태: '+d.status+'\n\n'+d.body:'목록을 읽고 원문을 선택하세요.';
 }
 $('automation-source').onchange=showReviewSource;
 async function reload(){
  const [a,p,s,g,r]=await Promise.all([call('automation'),call('performance'),call('sources'),call('products'),call('runs')]);
  enabled=a.settings.enabled;$('automation-enabled').checked=enabled;$('automation-limit').value=a.settings.daily_limit||'';
  sources=s.items;runs=r.items.filter(x=>x.created_by===user());posts=p.posts;
  options('automation-source',sources,x=>x.title+' · '+x.status,x=>x.id);showReviewSource();
  options('automation-products',g.items,x=>x.name,x=>x.id);
  options('publication-candidate',runs.flatMap(r=>r.candidates.map((c,i)=>({r,c,i}))),x=>x.c.title,x=>x.r.id+':'+x.i);
  options('publication-pending',posts.filter(x=>x.status==='waiting'),x=>x.run_id+' · 후보 '+(x.candidate_index+1),x=>x.id);
  options('view-publication',posts.filter(x=>x.status==='published_operator_reported'),x=>x.title||x.log_no,x=>x.id);
  const jobs=$('automation-jobs');jobs.replaceChildren();
  for(const j of a.jobs){const row=node('div');row.append(node('p',j.query+' · '+j.status+(j.error_code?' · '+j.error_code:'')));if(j.status==='pending'||j.status==='running'||j.status==='needs_attention'){const b=node('button',j.status==='pending'?'대기 취소':'저장 결과만 재확인 · 추가 생성 없음');b.type='button';b.dataset.private='';b.onclick=()=>action(async()=>{await call(j.status==='pending'?'automation/cancel':'automation/reconcile',{job_id:j.id});await reload();});row.append(b);}jobs.append(row);}
  if(!a.jobs.length)jobs.append(node('p','대기 작업 없음. 자동 실행은 기본 꺼짐입니다.'));
  const out=$('performance-results');out.replaceChildren();
  for(const post of posts){
   const reward=p.rewards.find(x=>x.publication_id===post.id);
   const obs=p.observations.filter(x=>x.publication_id===post.id).sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at))[0];
   const card=node('div');card.className='item';
   card.append(node('strong',post.title||'발행 대기'),node('p',post.status==='waiting'?'실제 발행하지 않은 대기 기록':'운영자가 수동 발행 사실을 기록함 · API 검증 아님'));
   if(obs)card.append(node('p',obs.metric_day+' 일간 '+obs.daily_views+'회'+(obs.cumulative_views!==null?' · 누적 '+obs.cumulative_views+'회':'')+' · '+(obs.provisional?'잠정':'운영자 확정')+' · 관측 '+new Date(obs.observed_at).toLocaleString('ko-KR')));
   else card.append(node('p','조회수 미수집 (0으로 간주하지 않음)'));
   card.append(node('p','7일 조회수 보상: '+(reward?.value==null?'미확정':reward.value+'회')+' · '+(reward?.complete_days||0)+'/7일 확정 관측'));
   out.append(card);
  }
  if(!posts.length)out.append(node('p','발행 대기·조회수 기록 없음'));
 }
 async function action(fn){try{await fn();}catch(e){status(e.message);}}
 $('automation-refresh').onclick=()=>action(reload);
 $('automation-settings').onclick=()=>action(async()=>{
  const limit=Number($('automation-limit').value),on=$('automation-enabled').checked;
  if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('큐 일일한도를 1~5건 중 직접 정하세요.');
  if(on&&!confirm('승인된 근거의 색인·생성 큐를 허용합니다. KST 하루 최대 '+limit+'건을 예약하며 실패도 한도에 포함됩니다. 임베딩/Claude 비용과 외부 전송이 발생할 수 있습니다. 이 한도는 수동 생성이나 계정 전체 금액 상한이 아닙니다. 저장할까요?'))return;
  await call('automation/settings',{enabled:on,daily_limit:limit});if(!on)runner.stop();await reload();status('큐 설정 저장. 실제 실행은 실행 시작 버튼을 눌러야 합니다.');
 });
 $('automation-enqueue').onclick=()=>action(async()=>{
  const selected=sources.find(x=>x.id===$('automation-source').value);if(selected?.status!=='verified')throw Error('사람이 검토 완료한 근거만 큐에 넣을 수 있습니다.');
  await call('automation/jobs',{source_id:selected.id,product_ids:[...$('automation-products').selectedOptions].map(x=>x.value),query:$('automation-query').value,request_id:crypto.randomUUID()});await reload();status('큐에 추가했습니다. 아직 AI를 호출하지 않았습니다.');
 });
 $('automation-review-enqueue').onclick=()=>action(async()=>{
  const button=$('automation-review-enqueue');if(reviewEnqueuer.isBusy())return;
  button.disabled=true;
  try{
   const result=await reviewEnqueuer.submit({source:sources.find(x=>x.id===$('automation-source').value),product_ids:[...$('automation-products').selectedOptions].map(x=>x.value),query:$('automation-query').value,confirmed:$('automation-reviewed').checked});
   const message=(result.reviewedNow?'검토 완료 후 ':'기존 검토 완료 자료를 ')+(result.reused?'기존 작업으로 확인했습니다.':'대기열에서 작업을 확인했습니다.')+' 작업 상태: '+result.job.status+'. 이 버튼은 큐 활성화·실행·AI 호출·게시를 하지 않습니다.';
   try{await reload();status(message);}catch{status(message+' 목록 새로고침은 실패했으므로 다시 조회하세요.');}
  }finally{button.disabled=!user();}
 });
 $('automation-review-help').onclick=()=>action(async()=>{
  const d=sources.find(x=>x.id===$('automation-source').value);if(!d)throw Error('근거를 선택하세요.');
  $('review-help').textContent='기계 형식 점검(사실 검증 아님): 출처 '+(d.source_uri?'입력됨':'누락')+' · 본문 '+d.body.length+'자 · 상태 '+d.status+'. 출처 내용과 상품 주장 일치는 사람이 확인해야 합니다. 승인 상태는 변경하지 않았습니다.';
 });
 $('automation-start').onclick=()=>action(async()=>{if(!enabled)throw Error('일일한도를 정하고 큐 허용 설정을 먼저 저장하세요.');if(!confirm('대기 중인 승인 근거를 색인하고 Claude 초안을 생성합니다. 열린 활성 탭에서만 순차 실행합니다. 시작할까요?'))return;await runner.start();});
 $('automation-stop').onclick=()=>action(async()=>{runner.stop();await call('automation/settings',{enabled:false,daily_limit:Number($('automation-limit').value)||1});await reload();});
 $('publication-enqueue').onclick=()=>action(async()=>{
  const [run_id,index]=$('publication-candidate').value.split(':');await call('performance/queue',{run_id,candidate_index:Number(index)});await reload();status('발행 대기 기록만 만들었습니다. 네이버에 게시하지 않았습니다.');
 });
 const kst=v=>v?new Date(v+':00+09:00').toISOString():null;
 $('publication-record').onclick=()=>action(async()=>{
  if(!$('publication-confirm').checked)throw Error('실제 발행·제휴 표시 확인이 필요합니다.');
  await call('performance/published',{publication_id:$('publication-pending').value,blog_id:$('publication-blog').value.trim(),log_no:$('publication-log').value.trim(),title:$('publication-title').value.trim(),published_at:kst($('publication-at').value),confirmed:true,disclosure_confirmed:true,manually_edited:$('publication-edited').checked});
  await reload();status('운영자 수동 발행 기록을 저장했습니다. 자동 발행 성공으로 표시하지 않습니다.');
 });
 $('view-record').onclick=()=>action(async()=>{
  if(!$('view-confirm').checked)throw Error('공식 글별 통계에서 직접 확인한 값만 기록하세요.');
  if($('view-daily').value==='')throw Error('관측하지 않은 값을 0으로 저장할 수 없습니다.');
  await call('performance/observations',{publication_id:$('view-publication').value,metric_day:$('view-day').value,daily_views:Number($('view-daily').value),cumulative_views:$('view-cumulative').value===''?null:Number($('view-cumulative').value),observed_at:kst($('view-at').value),provisional:$('view-provisional').checked,confirmed:true});
  await reload();status('수동 관측값 저장. 잠정값은 7일 확정보상에 포함하지 않습니다.');
 });
 window.addEventListener('pagehide',()=>runner.stop());window.addEventListener('offline',()=>runner.stop('오프라인으로 실행 중지'));
 function reset(){runner.stop('로그인 상태 변경으로 큐를 중지했습니다.');sources=[];runs=[];posts=[];enabled=false;for(const id of ['automation-source','automation-products','publication-candidate','publication-pending','view-publication','automation-jobs','performance-results'])$(id).replaceChildren();for(const id of ['automation-query','publication-blog','publication-log','publication-title','publication-at','view-day','view-daily','view-cumulative','view-at','automation-limit'])$(id).value='';$('automation-enabled').checked=false;$('publication-confirm').checked=false;$('view-confirm').checked=false;$('view-provisional').checked=true;$('review-help').textContent='';$('automation-reviewed').checked=false;$('automation-review-preview').textContent='';}
 return {stop:runner.stop,reload,reset};
}
globalThis.CommerceAutomation={createRunner,createReviewEnqueuer,mount};
})();