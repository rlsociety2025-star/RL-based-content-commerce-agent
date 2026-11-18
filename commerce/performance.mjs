// Manual publication records and official-UI observations. No Naver requests or publishing.
export function reward7Days(post,observations,now=Date.now()){
 if(!post.published_at)return {value:null,status:'not_published',metric:'post_views_7_kst_calendar_days'};
 const start=new Date(new Date(post.published_at).getTime()+9*3600000).toISOString().slice(0,10);
 const startMs=Date.parse(start+'T00:00:00+09:00'),end=startMs+7*86400000;
 const latest=new Map();
 for(const o of observations){
  if(o.publication_id!==post.id||o.source_kind!=='manual_official_ui'||Date.parse(o.observed_at)>now)continue;
  const previous=latest.get(o.metric_day);if(!previous||Date.parse(o.observed_at)>Date.parse(previous.observed_at))latest.set(o.metric_day,o);
 }
 let total=0,complete=0;
 for(let i=0;i<7;i++){
  const day=new Date(startMs+i*86400000+9*3600000).toISOString().slice(0,10),o=latest.get(day);
  if(o&&!o.provisional&&Number.isSafeInteger(Number(o.daily_views))&&Number(o.daily_views)>=0&&Date.parse(o.observed_at)>=startMs+(i+1)*86400000){complete++;total+=Number(o.daily_views);}
 }
 return {value:now>=end&&complete===7&&Number.isSafeInteger(total)?total:null,status:now<end?'window_open':complete<7?'missing_final_daily_observations':!Number.isSafeInteger(total)?'value_out_of_range':'operator_reported_complete',complete_days:complete,window_start:start,window_end_exclusive:new Date(end).toISOString(),metric:'post_views_7_kst_calendar_days',verification:'operator_reported_not_api_verified'};
}
export async function performanceRoute(path,method,b,env,auth,{db,fail,id,text}){
 const owner='created_by=eq.'+auth.user.id;
 const readPosts=()=>db(env,auth.token,'cc_publication_queue?'+owner+'&select=*&order=recorded_at.desc&limit=100');
 async function postById(value){const rows=await db(env,auth.token,'cc_publication_queue?id=eq.'+id(value)+'&'+owner+'&select=*&limit=1');if(!rows?.length)fail(404,'PUBLICATION_NOT_FOUND','본인의 발행 대기 기록이 없습니다.');return rows[0];}
 if(path==='/api/performance'&&method==='GET'){
  const [posts,observations]=await Promise.all([readPosts(),db(env,auth.token,'cc_view_observations?'+owner+'&select=*&order=observed_at.desc&limit=2000')]);
  return {posts,observations,rewards:posts.map(p=>({publication_id:p.id,...reward7Days(p,observations)})),publishing:'not_connected',collection:'manual_official_ui',observations_limit:2000};
 }
 if(method!=='POST')fail(404,'NOT_FOUND','요청 경로를 확인하세요.');
 if(path==='/api/performance/queue'){
  const run_id=id(b.run_id),candidate_index=b.candidate_index;
  if(!Number.isInteger(candidate_index)||candidate_index<0||candidate_index>2)fail(400,'CANDIDATE','후보를 선택하세요.');
  const runs=await db(env,auth.token,'cc_runs?id=eq.'+run_id+'&'+owner+'&select=*&limit=1');
  if(!runs?.[0]?.candidates?.[candidate_index])fail(404,'CANDIDATE','저장된 후보가 없습니다.');
  const query='cc_publication_queue?'+owner+'&run_id=eq.'+run_id+'&candidate_index=eq.'+candidate_index+'&select=*&limit=1';
  let existing=await db(env,auth.token,query);if(existing.length)return {publication:existing[0],reused:true};
  try{const rows=await db(env,auth.token,'cc_publication_queue','POST',{created_by:auth.user.id,run_id,candidate_index});return {publication:rows[0]};}
  catch(e){existing=await db(env,auth.token,query);if(existing.length)return {publication:existing[0],reused:true};throw e;}
 }
 if(path==='/api/performance/published'){
  if(b.confirmed!==true||b.disclosure_confirmed!==true)fail(400,'CONFIRM_REQUIRED','실제 발행과 필요한 제휴 표시를 직접 확인하세요.');
  const post=await postById(b.publication_id);if(post.status!=='waiting')fail(409,'ALREADY_RECORDED','이미 발행 메타데이터를 기록했습니다. 기존 기록을 덮어쓰지 않습니다.');
  if(!/^[A-Za-z0-9_-]{1,60}$/.test(b.blog_id||'')||!/^[0-9]{1,30}$/.test(b.log_no||''))fail(400,'POST_ID','실제 블로그 ID와 글 번호를 입력하세요.');
  const at=Date.parse(b.published_at);if(!Number.isFinite(at)||at>Date.now())fail(400,'POST_DATE','실제 발행일시를 확인하세요.');
  const rows=await db(env,auth.token,'cc_publication_queue?id=eq.'+post.id+'&'+owner+'&status=eq.waiting','PATCH',{status:'published_operator_reported',blog_id:b.blog_id,log_no:b.log_no,title:text(b.title,'실제 글 제목',1,200),published_at:new Date(at).toISOString(),published_precision:'minute',manually_edited:b.manually_edited===true,disclosure_confirmed:true});
  if(!rows?.length)fail(409,'POST_CHANGED','발행 기록 상태가 변경됐습니다. 다시 조회하세요.');
  return {publication:rows[0]};
 }
 if(path==='/api/performance/observations'){
  if(b.confirmed!==true)fail(400,'CONFIRM_REQUIRED','공식 글 통계에서 직접 본 숫자만 기록하세요.');
  const post=await postById(b.publication_id);if(post.status!=='published_operator_reported')fail(409,'NOT_PUBLISHED','실제 발행 기록이 먼저 필요합니다.');
  const day=b.metric_day,at=Date.parse(b.observed_at),start=Date.parse(day+'T00:00:00+09:00');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!Number.isFinite(start)||new Date(start+9*3600000).toISOString().slice(0,10)!==day||!Number.isFinite(at)||at<start||at<Date.parse(post.published_at)||day<new Date(Date.parse(post.published_at)+9*3600000).toISOString().slice(0,10)||at>Date.now()+300000)fail(400,'OBSERVATION_DATE','대상 날짜와 실제 관측시각을 확인하세요.');
  const views=b.daily_views,cumulative=b.cumulative_views??null;
  if(!Number.isSafeInteger(views)||views<0||(cumulative!==null&&(!Number.isSafeInteger(cumulative)||cumulative<views)))fail(400,'VIEWS','실제 확인한 0 이상의 정수 조회수를 입력하세요.');
  const provisional=b.provisional!==false;
  if(!provisional&&at<start+86400000)fail(400,'PROVISIONAL','진행 중인 날짜는 잠정 관측으로 저장하세요.');
  const record={created_by:auth.user.id,publication_id:post.id,metric_day:day,daily_views:views,cumulative_views:cumulative,observed_at:new Date(at).toISOString(),provisional,source_kind:'manual_official_ui',source_url:'https://blog.stat.naver.com/blog/article/'+post.log_no+'/cv'};
  const rows=await db(env,auth.token,'cc_view_observations','POST',record);return {observation:rows[0]};
 }
 fail(404,'NOT_FOUND','요청 경로를 확인하세요.');
}
