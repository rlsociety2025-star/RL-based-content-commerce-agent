/* Team dashboard v4. Identity: Supabase Auth. Authorization: dashboard_access + RLS.
   Shared records are never stored in localStorage. Only the SDK persists its session. */
(() => {
  'use strict';
  const PROJECT_URL='https://hfqqqetcjbkptipqhskx.supabase.co';
  const PUBLIC_KEY='sb_publishable_UBPXMQMjhyoRYZaC09hiVQ_IATX2d2-';
  const SITE_URL='https://rlsociety2025-star.github.io/RL-based-content-commerce-agent/';
  const $=(q,root=document)=>root.querySelector(q), $$=(q,root=document)=>[...root.querySelectorAll(q)];
  const tabs=['tab-overview','tab-pairs','tab-wbs'];
  const labels=['Project overview','Team & collaboration','Schedule & deliverables'];
  const states=['not_started','in_progress','blocked','done'];
  const selector='[data-member],[data-check-id],[data-wbs-status],[data-wbs-progress]';
  const initial={
    team_members:$$('[data-member]').map(el=>({role_code:el.dataset.member,display_name:el.textContent.trim()})),
    checklist_items:$$('[data-check-id]').map(el=>({check_id:Number(el.dataset.checkId),checked:el.checked})),
    wbs_tasks:$$('[data-wbs-status]').map(el=>({wbs_code:el.dataset.wbsStatus,status:el.value,progress:Number($('[data-wbs-progress="'+el.dataset.wbsStatus+'"]').value)}))
  };
  const spec={team_members:{key:'role_code',fields:'role_code,display_name,updated_at'},checklist_items:{key:'check_id',fields:'check_id,checked,updated_at'},wbs_tasks:{key:'wbs_code',fields:'wbs_code,status,progress,updated_at'}};
  const records={team_members:new Map(),checklist_items:new Map(),wbs_tasks:new Map()};
  let sb=null,user=null,approved=false,loaded=false,online=navigator.onLine;
  let epoch=0,channel=null,realtime=false,pending=0,refreshing=false,refreshAgain=false,authBusy=false;
  let toastTimer,refreshTimer,authTimer,dirtyEditor=null;
  for(const key of ['contentCommerceDashboard.v3.sharedFallback','contentCommerceDashboard.supabaseConfig']){try{localStorage.removeItem(key);}catch(_){}}
  function notice(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),5500);}
  function feedback(message,error=false){$('#auth-feedback').textContent=message;$('#auth-feedback').classList.toggle('error',error);}
  function sync(mode,text){$('#sync-indicator').className='sync-indicator'+(mode?' '+mode:'');$('#sync-label').textContent=text;}
  function render(table,row){
    if(table==='team_members')$$('[data-member]').filter(el=>el.dataset.member===row.role_code).forEach(el=>{if(el!==dirtyEditor)el.textContent=row.display_name;});
    if(table==='checklist_items'){const el=$('[data-check-id="'+Number(row.check_id)+'"]');if(el)el.checked=!!row.checked;}
    if(table==='wbs_tasks'){
      const el=$$('[data-wbs-status]').find(el=>el.dataset.wbsStatus===row.wbs_code);if(!el)return;
      const p=$('[data-wbs-progress="'+el.dataset.wbsStatus+'"]'),v=$('[data-wbs-progress-value="'+el.dataset.wbsStatus+'"]');
      if(states.includes(row.status))el.value=row.status;p.value=Math.min(100,Math.max(0,Number(row.progress)||0));if(v)v.textContent=p.value+'%';
    }
  }
  function resetPublic(){dirtyEditor=null;loaded=false;Object.values(records).forEach(m=>m.clear());Object.entries(initial).forEach(([table,rows])=>rows.forEach(r=>render(table,r)));}
  function updateUI(){
    const editable=approved&&loaded&&online&&!pending;
    $$(selector).forEach(el=>{if(el.hasAttribute('data-member')){el.contentEditable=String(editable);el.setAttribute('aria-readonly',String(!editable));el.tabIndex=editable?0:-1;}else el.disabled=!editable;});
    $('#auth-label').textContent=user?(approved?'팀원 계정':'승인 대기'):'로그인';$('#auth-user').textContent=user?'로그인: '+user.email:'로그인되지 않음';
    $('#sign-out').hidden=!user;$('#sign-in').hidden=!!user;$('#sign-up').hidden=!!user;$('#resend-email').hidden=!!user;
    $('#auth-email').disabled=!!user;$('#auth-password').disabled=!!user;
    const banner=$('#access-banner');banner.className='access-banner';
    if(!online){banner.classList.add('problem');$('#access-title').textContent='인터넷 연결 끊김';$('#access-message').textContent='공용 편집을 잠갔습니다. 인터넷 연결 후 서버 상태를 다시 확인합니다.';sync('error','OFFLINE');}
    else if(!sb){banner.classList.add('problem');$('#access-title').textContent='연결 모듈 확인 필요';$('#access-message').textContent='Supabase 연결 모듈을 확인하고 새로고침하세요. 공개 계획만 표시됩니다.';sync('error','SDK ERROR');}
    else if(!user){$('#access-title').textContent='공개 계획 보기';$('#access-message').textContent='공용 담당자·체크리스트·진행률은 로그인과 운영자 승인 후 확인할 수 있습니다.';sync('','로그인 필요');}
    else if(!approved){$('#access-title').textContent='운영자 승인 대기';$('#access-message').textContent='가입은 완료됐지만 공용 데이터 권한은 아직 없습니다. 운영자에게 가입 이메일을 전달하세요.';sync('pending','승인 대기');}
    else if(!loaded){$('#access-title').textContent='공용 데이터 확인 중';$('#access-message').textContent='서버 데이터를 확인하기 전까지 편집을 잠급니다. 연결 실패 시 다시 확인을 눌러 주세요.';sync('syncing','확인 중');}
    else{banner.classList.add('approved');$('#access-title').textContent='승인된 팀원 · 공용 작업공간';$('#access-message').textContent='변경은 Supabase에 저장됩니다. '+(realtime?'실시간 동기화 중입니다.':'실시간 연결을 확인하며 30초마다 갱신합니다.');sync(pending?'syncing':'online',pending?'저장 중':realtime?'LIVE':'공용 연결');}
    $('#access-action').textContent=user?'승인·연결 다시 확인':'로그인 / 가입';$('#save-state').textContent=pending?'서버 저장 중':loaded?'서버에서 확인한 값':'공개 계획 · 읽기 전용';$('#save-state').classList.toggle('saved',loaded&&!pending);
  }
  function stopRealtime(){const old=channel;channel=null;realtime=false;if(old&&sb)sb.removeChannel(old).catch(()=>{});}
  function invalidate(){epoch++;approved=false;stopRealtime();resetPublic();updateUI();}
  function schedule(delay=150){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshAccess,delay);}
  async function timed(promise,ms=15000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('서버 응답 시간 초과')),ms);})]);}finally{clearTimeout(timer);}}
  function subscribe(){
    if(channel||!user||!approved||!loaded)return;const version=epoch,next=sb.channel('dashboard-'+user.id);
    Object.keys(spec).forEach(table=>next.on('postgres_changes',{event:'UPDATE',schema:'public',table},()=>{if(version===epoch&&approved)schedule();}));
    channel=next;next.subscribe(status=>{if(channel!==next||version!==epoch)return;realtime=status==='SUBSCRIBED';updateUI();if(realtime)schedule();if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')schedule(1000);});
  }
  async function refreshAccess(){
    if(!sb||!user||!navigator.onLine)return;if(refreshing){refreshAgain=true;return;}if(pending||dirtyEditor){schedule(1000);return;}
    refreshing=true;const id=user.id,version=epoch;
    try{
      const membership=await timed(sb.from('dashboard_access').select('active').eq('user_id',id).maybeSingle());
      if(version!==epoch||id!==user?.id)return;if(membership.error)throw new Error('승인 상태 조회 실패: '+membership.error.message);
      if(membership.data?.active!==true){approved=false;stopRealtime();resetPublic();updateUI();return;}
      approved=true;
      const result=await timed(Promise.all(Object.entries(spec).map(async([table,def])=>[table,await sb.from(table).select(def.fields)])));
      if(version!==epoch||id!==user?.id)return;
      for(const [table,r] of result){if(r.error)throw new Error(table+' 조회 실패: '+r.error.message);if(!r.data?.length)throw new Error('공용 데이터가 비어 있거나 승인 권한이 변경됐습니다.');}
      if(pending||dirtyEditor){refreshAgain=true;return;}
      for(const [table,r] of result){records[table]=new Map(r.data.map(row=>[String(row[spec[table].key]),row]));r.data.forEach(row=>render(table,row));}
      loaded=true;online=navigator.onLine;updateUI();subscribe();
    }catch(error){if(version===epoch){stopRealtime();resetPublic();updateUI();sync('error','연결 확인 필요');$('#access-message').textContent=error.message+' 다시 확인을 눌러 주세요.';}}
    finally{refreshing=false;if(refreshAgain){refreshAgain=false;schedule(700);}}
  }
  async function acceptAuth(session){
    const candidate=session?.user||null;if(candidate?.id!==user?.id){invalidate();user=candidate;}updateUI();if(!candidate)return;const version=epoch;
    try{const r=await timed(sb.auth.getUser());if(version!==epoch)return;if(r.error||!r.data.user){user=null;invalidate();feedback('로그인 상태를 확인하지 못했습니다. 다시 로그인하세요.',true);return;}user=r.data.user;updateUI();await refreshAccess();}
    catch(error){if(version===epoch){invalidate();feedback(error.message,true);}}
  }
  async function write(table,id,patch){
    const before=records[table].get(String(id));if(!approved||!loaded||!user||!navigator.onLine||pending){if(before)render(table,before);notice('승인·로그인·연결 상태를 먼저 확인해 주세요.');return;}
    if(!before){notice('서버의 최신 값을 먼저 불러와 주세요.');schedule();return;}
    const version=epoch,actor=user.id;pending++;updateUI();
    try{
      // Optimistic concurrency: do not silently overwrite another member's change.
      const r=await timed(sb.from(table).update({...patch,updated_by:actor}).eq(spec[table].key,id).eq('updated_at',before.updated_at).select(spec[table].fields).maybeSingle());
      if(version!==epoch||actor!==user?.id)return;if(r.error)throw new Error(r.error.message);if(!r.data)throw new Error('다른 팀원이 먼저 수정했거나 승인 권한이 변경됐습니다. 최신 값을 확인하고 다시 수정하세요.');
      records[table].set(String(id),r.data);render(table,r.data);notice('공용 DB에 저장했습니다.');
    }catch(error){if(version===epoch){render(table,before);loaded=false;notice('저장 미확인: '+error.message);}}
    finally{pending--;updateUI();schedule(100);}
  }
  function makeTOC(pane){const nav=$('#section-nav');nav.replaceChildren();$$('.section',pane).forEach(section=>{const h=$('h2',section);if(!h)return;const a=document.createElement('a');a.href='#'+section.id;a.textContent=h.textContent.replace(/^\d+\.\s*/,'');a.addEventListener('click',e=>{e.preventDefault();section.scrollIntoView({behavior:'smooth'});});nav.append(a);});}
  function activateTab(id,scroll=true){
    if(!tabs.includes(id))id=tabs[0];$$('[data-tab]').forEach(b=>{const on=b.dataset.tab===id;b.classList.toggle('active',on);if(b.getAttribute('role')==='tab'){b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}});$$('.tab-pane').forEach(p=>p.classList.toggle('active',p.id===id));$('#breadcrumb-current').textContent=labels[tabs.indexOf(id)];makeTOC(document.getElementById(id));
    if(!/[#?](?:access_token|error|code)=/.test(location.href)){try{history.replaceState(null,'','#view='+id.replace('tab-',''));}catch(_){}}
    if(scroll)window.scrollTo({top:0,behavior:'smooth'});
  }
  $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tab)));
  $$('.tab-btn').forEach(b=>b.addEventListener('keydown',e=>{let i=tabs.indexOf(b.dataset.tab);if(e.key==='ArrowRight')i=(i+1)%tabs.length;else if(e.key==='ArrowLeft')i=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')i=0;else if(e.key==='End')i=tabs.length-1;else return;e.preventDefault();activateTab(tabs[i],false);$('#nav-'+tabs[i]).focus();}));
  window.addEventListener('hashchange',()=>{const id='tab-'+location.hash.replace(/^#view=/,'');if(tabs.includes(id))activateTab(id);});
  $$('[data-member]').forEach(el=>{
    el.addEventListener('focus',()=>{if(approved&&loaded)dirtyEditor=el;});
    el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();el.blur();}if(e.key==='Escape'){el.textContent=records.team_members.get(el.dataset.member)?.display_name||el.textContent;el.blur();}});
    el.addEventListener('paste',e=>{e.preventDefault();if(approved&&loaded)el.textContent=(e.clipboardData.getData('text/plain')||'').replace(/[\n\r]/g,' ').slice(0,40);});
    el.addEventListener('blur',()=>{if(dirtyEditor!==el)return;dirtyEditor=null;const id=el.dataset.member,before=records.team_members.get(id),name=el.textContent.replace(/[\n\r]/g,' ').trim().slice(0,40);if(!name){if(before)render('team_members',before);return;}if(name===before?.display_name){schedule();return;}write('team_members',id,{display_name:name});});
  });
  $$('[data-check-id]').forEach(el=>el.addEventListener('change',()=>write('checklist_items',Number(el.dataset.checkId),{checked:el.checked})));
  $$('[data-wbs-status]').forEach(el=>el.addEventListener('change',()=>{if(states.includes(el.value))write('wbs_tasks',el.dataset.wbsStatus,{status:el.value});}));
  $$('[data-wbs-progress]').forEach(el=>{el.addEventListener('input',()=>{$('[data-wbs-progress-value="'+el.dataset.wbsProgress+'"]').textContent=el.value+'%';});el.addEventListener('change',()=>write('wbs_tasks',el.dataset.wbsProgress,{progress:Math.min(100,Math.max(0,Math.round(Number(el.value))))}));});
  function showWBS(n){const el=document.getElementById('wbs-'+n);if(el){el.open=true;el.scrollIntoView({behavior:'smooth',block:'start'});}}
  $$('[data-wbs]').forEach(el=>{el.addEventListener('click',e=>{if(!e.target.closest('select,input'))showWBS(el.dataset.wbs);});if(el.tagName!=='BUTTON')el.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('select,input')){e.preventDefault();showWBS(el.dataset.wbs);}});});
  $$('[data-details]').forEach(el=>el.addEventListener('click',()=>$$('.wbs-item').forEach(d=>d.open=el.dataset.details==='open')));
  $('#presentation-btn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(_){notice('브라우저 전체 화면 기능을 사용하세요.');}});
  let printState=[];window.addEventListener('beforeprint',()=>{printState=$$('.wbs-item').map(d=>d.open);$$('.wbs-item').forEach(d=>d.open=true);});window.addEventListener('afterprint',()=>$$('.wbs-item').forEach((d,i)=>d.open=printState[i]??false));$$('.print-trigger').forEach(b=>b.addEventListener('click',()=>window.print()));
  $('#export-btn').addEventListener('click',async()=>{
    if(pending||dirtyEditor){notice('수정을 저장한 후 백업해 주세요.');return;}
    try{
      const r=await fetch('./dashboard.css',{cache:'no-cache'});if(!r.ok)throw new Error('스타일 파일 읽기 실패');const css=await r.text(),clone=document.documentElement.cloneNode(true);
      $$('script,link[rel=stylesheet],#workspace-modal,#toast,.top-actions,.access-banner',clone).forEach(el=>el.remove());$('meta[http-equiv="Content-Security-Policy"]',clone)?.remove();$$('[data-member]',clone).forEach(el=>el.contentEditable='false');
      $$('[data-check-id]',clone).forEach(el=>{el.disabled=true;el.toggleAttribute('checked',$('[data-check-id="'+el.dataset.checkId+'"]').checked);});
      $$('[data-wbs-status]',clone).forEach(el=>{el.disabled=true;const value=$('[data-wbs-status="'+el.dataset.wbsStatus+'"]').value;[...el.options].forEach(o=>o.toggleAttribute('selected',o.value===value));});
      $$('[data-wbs-progress]',clone).forEach(el=>{el.disabled=true;el.setAttribute('value',$('[data-wbs-progress="'+el.dataset.wbsProgress+'"]').value);});$$('.wbs-item',clone).forEach(d=>d.open=true);
      const style=document.createElement('style');style.textContent=css+'\n.tab-pane{display:block!important;margin-bottom:35px}.sidebar,.tabs-wrap,.topbar{display:none!important}.app-main{margin-left:0!important}';$('head',clone).append(style);
      const blob=new Blob(['<!doctype html>\n'+clone.outerHTML],{type:'text/html;charset=utf-8'}),url=window.URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='content_commerce_readonly_snapshot.html';a.click();setTimeout(()=>window.URL.revokeObjectURL(url),4000);notice('읽기 전용 백업입니다. 현재 표시된 팀 정보가 포함됩니다.');
    }catch(error){notice('백업 실패: '+error.message);}
  });
  const dialog=$('#workspace-modal');function openDialog(){if(!dialog.open)dialog.showModal();updateUI();if(!user)$('#auth-email').focus();}
  $('#modal-close').addEventListener('click',()=>{dialog.close();$('#auth-password').value='';});dialog.addEventListener('close',()=>{$('#auth-password').value='';});
  $('#settings-button').addEventListener('click',openDialog);$('#auth-button').addEventListener('click',openDialog);$('#access-action').addEventListener('click',()=>user?refreshAccess():openDialog());
  $('#refresh-access').addEventListener('click',()=>{if(user){feedback('승인 상태를 확인합니다.');refreshAccess();}else feedback('먼저 로그인해 주세요.');});$('#connection-info').textContent='프로젝트: hfqqqetcjbkptipqhskx · publishable key · 권한은 DB의 RLS로 검사';
  async function authTask(fn){if(!sb||!navigator.onLine){feedback('인터넷과 Supabase 연결을 확인하세요.',true);return;}if(authBusy)return;authBusy=true;$$('#auth-form button,#resend-email').forEach(b=>b.disabled=true);try{await fn();}catch(error){feedback(error.message,true);}finally{authBusy=false;$$('#auth-form button,#resend-email').forEach(b=>b.disabled=false);$('#auth-password').value='';}}
  $('#auth-form').addEventListener('submit',e=>{e.preventDefault();authTask(async()=>{const email=$('#auth-email').value.trim(),password=$('#auth-password').value;if(!email||!password)throw new Error('이메일과 비밀번호를 입력하세요.');feedback('로그인 중입니다.');const r=await timed(sb.auth.signInWithPassword({email,password}));if(r.error)throw r.error;feedback('로그인했습니다. 운영자 승인을 확인하는 중입니다.');});});
  $('#sign-up').addEventListener('click',()=>authTask(async()=>{if(!$('#auth-form').reportValidity())return;feedback('계정을 만드는 중입니다.');const email=$('#auth-email').value.trim(),password=$('#auth-password').value;const r=await timed(sb.auth.signUp({email,password,options:{emailRedirectTo:SITE_URL}}));if(r.error)throw r.error;feedback('계정 생성 요청을 접수했습니다. 인증 메일 확인 후 로그인하고, 운영자에게 팀원 승인을 요청하세요.');}));
  $('#resend-email').addEventListener('click',()=>authTask(async()=>{const email=$('#auth-email').value.trim();if(!email||!$('#auth-email').reportValidity())return;const r=await timed(sb.auth.resend({type:'signup',email,options:{emailRedirectTo:SITE_URL}}));if(r.error)throw r.error;feedback('인증 메일 재발송을 요청했습니다. 메일함과 스팸함을 확인하세요.');}));
  $('#sign-out').addEventListener('click',()=>authTask(async()=>{const r=await timed(sb.auth.signOut({scope:'local'}));if(r.error)throw r.error;user=null;invalidate();feedback('로그아웃했습니다. 공용 데이터는 화면에서 지웠습니다.');}));
  window.addEventListener('offline',()=>{online=false;invalidate();});window.addEventListener('online',()=>{online=true;updateUI();schedule();});window.addEventListener('focus',()=>schedule());document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});setInterval(()=>{if(!document.hidden)schedule(0);},30000);window.addEventListener('beforeunload',stopRealtime);
  activateTab('tab-'+location.hash.replace(/^#view=/,''),false);updateUI();
  if(!window.supabase?.createClient){feedback('Supabase SDK 파일을 불러오지 못했습니다. 새로고침하세요.',true);return;}
  try{sb=window.supabase.createClient(PROJECT_URL,PUBLIC_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    // Defer work outside the Auth callback to avoid the SDK auth lock.
    sb.auth.onAuthStateChange((_event,session)=>{clearTimeout(authTimer);authTimer=setTimeout(()=>acceptAuth(session),0);});updateUI();
  }catch(error){feedback('연결 실패: '+error.message,true);updateUI();}
})();
