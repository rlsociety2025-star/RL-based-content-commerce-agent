// Explicit opt-in queue; never runs on a timer/server cron and never retries paid work.
const own=(auth)=>'created_by=eq.'+auth.user.id;
export async function queueGet(env,auth,{db}){
 const [settings,jobs]=await Promise.all([
  db(env,auth.token,'cc_automation_settings?'+own(auth)+'&select=*&limit=1'),
  db(env,auth.token,'cc_automation_jobs?'+own(auth)+'&select=*&order=created_at.desc&limit=50')
 ]);
 return {settings:settings?.[0]||{enabled:false,daily_limit:null},jobs:jobs||[],
  notice:'하루 한도는 한국시간 기준 큐 작업 예약 횟수이며 금액 한도가 아닙니다. 실행 중/확인 필요 작업은 자동 재시도하지 않습니다.'};
}
export async function queuePost(env,auth,path,b,d){
 const {db,id,text,fail,indexSource,generate,getSource,qsettings,llmSettings}=d;
 const rpc=(action,data={})=>db(env,auth.token,'rpc/cc_automation','POST',{p_action:action,p_data:data});
 if(path==='/api/automation/settings'){
  if(typeof b.enabled!=='boolean'||!Number.isInteger(b.daily_limit)||b.daily_limit<1||b.daily_limit>5)fail(400,'QUEUE_SETTINGS','활성화 여부와 하루 큐 작업 한도 1~5회를 명시하세요.');
  return rpc('settings',{enabled:b.enabled,daily_limit:b.daily_limit});
 }
 if(path==='/api/automation/jobs'){
  if(!Array.isArray(b.product_ids)||b.product_ids.length<1||b.product_ids.length>3)fail(400,'PRODUCT_REQUIRED','실제 상품을 1~3개 선택하세요.');
  return rpc('enqueue',{request_id:id(b.request_id),source_id:id(b.source_id),query:text(b.query,'콘텐츠 주제',3,1200),product_ids:[...new Set(b.product_ids.map(id))]});
 }
 if(path==='/api/automation/cancel')return rpc('cancel',{job_id:id(b.job_id)});
 if(path==='/api/automation/reconcile'){
  // Read/finish only: can recover a saved run after response loss, NEVER regenerate.
  return rpc('finish',{job_id:id(b.job_id),error_code:'RESULT_UNCERTAIN'});
 }
 if(path!=='/api/automation/run-next')fail(404,'NOT_FOUND','자동화 요청 경로를 확인하세요.');
 if(env.AI_CALLS_ENABLED!=='true')fail(503,'AI_DISABLED','비용 발생 호출은 잠겨 있습니다.');
 if(!env.AI?.run||!env.AI_RATE_LIMITER?.limit)fail(503,'QUEUE_BINDING','AI와 호출 제한 바인딩이 필요합니다.');
 qsettings(env);const model=llmSettings(env);if(!model.key)fail(503,'MODEL_KEY','선택 모델의 런타임 키가 필요합니다.');
 const claim=await rpc('claim');
 if(!claim?.job)return claim||{job:null,reason:'empty'};
 const job=claim.job;
 // Claim is committed before any external call. The server must never requeue it.
 try{
  const source=await getSource(env,auth.token,job.source_id);
  if(source.status!=='verified'||source.content_hash!==job.source_hash)fail(409,'SOURCE_CHANGED','사람 검토 상태나 근거 버전이 바뀌어 큐를 중단했습니다.');
  await indexSource(env,auth,job.source_id);
  const settings=await db(env,auth.token,'cc_automation_settings?'+own(auth)+'&select=enabled&limit=1');
  if(settings?.[0]?.enabled!==true)fail(409,'QUEUE_STOPPED','중지 요청을 확인해 다음 생성 단계는 실행하지 않았습니다.');
  const current=await getSource(env,auth.token,job.source_id);
  if(current.status!=='verified'||current.content_hash!==job.source_hash)fail(409,'SOURCE_CHANGED','검토된 근거가 변경돼 생성을 중단했습니다.');
  await generate(env,auth,{query:job.query,product_ids:job.product_ids,request_id:job.id},job.source_id);
  return await rpc('finish',{job_id:job.id});
 }catch(e){
  const code=/^[A-Z0-9_]{1,80}$/.test(e?.code||'')?e.code:'QUEUE_ERROR';
  try{return await rpc('finish',{job_id:job.id,error_code:code});}
  catch{
   // Even if the state update fails, leave the persisted running reservation blocked.
   return {job:{...job,status:'running'},needs_attention:true,
    message:'결과 저장 상태를 확인할 수 없습니다. 자동 재실행하지 마세요. 저장 기록 확인만 수행하세요.'};
  }
 }
}

