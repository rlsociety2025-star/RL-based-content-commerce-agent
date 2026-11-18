-- Reviewed SQL proposal for hfqqqetcjbkptipqhskx only.
-- Existing sources/products remain team-shared; these queue tables are own-read only.
-- No existing data, Naver records, or cc_runs reward rules change.
begin;
create table public.cc_automation_settings (
 created_by uuid primary key references auth.users(id),
 enabled boolean not null default false,
 daily_limit integer check(daily_limit between 1 and 5),
 updated_at timestamptz not null default now(),
 check(not enabled or daily_limit is not null)
);
create table public.cc_automation_jobs (
 id uuid primary key,
 created_by uuid not null references auth.users(id),
 source_id uuid not null references public.cc_sources(id),
 source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
 query text not null check(char_length(query) between 3 and 1200),
 product_ids uuid[] not null check(cardinality(product_ids) between 1 and 3),
 status text not null default 'pending' check(status in ('pending','running','completed','needs_attention','cancelled')),
 created_at timestamptz not null default now(),
 claimed_at timestamptz,
 finished_at timestamptz,
 run_id uuid,
 error_code text check(error_code is null or error_code ~ '^[A-Z0-9_]{1,80}$'),
 unique(created_by,fingerprint),
 check((status='pending' and claimed_at is null) or status<>'pending'),
 check(status<>'completed' or (run_id=id and finished_at is not null))
);
create index cc_automation_jobs_owner_created on public.cc_automation_jobs(created_by,created_at);
create index cc_automation_jobs_owner_claimed on public.cc_automation_jobs(created_by,claimed_at);
alter table public.cc_automation_settings enable row level security;
alter table public.cc_automation_jobs enable row level security;
revoke all on public.cc_automation_settings,public.cc_automation_jobs from public,anon,authenticated;
grant select on public.cc_automation_settings,public.cc_automation_jobs to authenticated;
create policy cc_automation_settings_own_read on public.cc_automation_settings for select to authenticated
 using(created_by=(select auth.uid()) and (select public.is_dashboard_member()));
create policy cc_automation_jobs_own_read on public.cc_automation_jobs for select to authenticated
 using(created_by=(select auth.uid()) and (select public.is_dashboard_member()));

-- Writes are confined to an authenticated atomic state-machine function.
-- Definer lives in non-exposed private schema; wrapper uses invoker rights.
create function private.cc_automation_rpc(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid();
 cfg public.cc_automation_settings%rowtype;
 j public.cc_automation_jobs%rowtype;
 src public.cc_sources%rowtype;
 ids uuid[]; q text; lim integer; en boolean; n integer; jid uuid; code text; fp text;
 day_start timestamptz:=date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
 if u is null or not coalesce(public.is_dashboard_member(),false) then
  raise exception 'Approved member required' using errcode='42501';
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' then
  raise exception 'Object required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,4157));

 if p_action='settings' then
  if jsonb_typeof(p_data->'enabled') is distinct from 'boolean'
    or jsonb_typeof(p_data->'daily_limit') is distinct from 'number' then
   raise exception 'Explicit settings required' using errcode='22023';
  end if;
  en:=(p_data->>'enabled')::boolean;
  lim:=(p_data->>'daily_limit')::integer;
  if lim<1 or lim>5 then
   raise exception 'Daily queue limit must be 1..5' using errcode='22023';
  end if;
  insert into public.cc_automation_settings(created_by,enabled,daily_limit) values(u,en,lim)
   on conflict(created_by) do update
   set enabled=excluded.enabled,daily_limit=excluded.daily_limit,updated_at=now()
   returning * into cfg;
  return jsonb_build_object('settings',to_jsonb(cfg));

 elsif p_action='enqueue' then
  jid:=(p_data->>'request_id')::uuid;
  q:=btrim(p_data->>'query');
  if jid is null or q is null or char_length(q)<3 or char_length(q)>1200
    or jsonb_typeof(p_data->'product_ids') is distinct from 'array' then
   raise exception 'Invalid queue input' using errcode='22023';
  end if;
  select array_agg(x::uuid order by x) into ids
   from (select distinct jsonb_array_elements_text(p_data->'product_ids') x) z;
  if coalesce(cardinality(ids),0)<1 or cardinality(ids)>3 then
   raise exception 'Select 1..3 products' using errcode='22023';
  end if;
  select * into j from public.cc_automation_jobs where id=jid;
  if found then
   if j.created_by<>u then raise exception 'Request id unavailable' using errcode='42501'; end if;
   if j.source_id is distinct from (p_data->>'source_id')::uuid
     or j.query is distinct from q or j.product_ids is distinct from ids then
    raise exception 'Request id already used for different input' using errcode='22023';
   end if;
   return jsonb_build_object('job',to_jsonb(j));
  end if;
  if exists(select 1 from public.cc_runs where id=jid) then
   raise exception 'Request id already belongs to a generation' using errcode='22023';
  end if;
  select * into src from public.cc_sources
   where id=(p_data->>'source_id')::uuid and status='verified';
  if not found then raise exception 'Human-verified source required' using errcode='22023'; end if;
  select count(*) into n from public.cc_products where id=any(ids);
  if n<>cardinality(ids) then raise exception 'Product not found' using errcode='22023'; end if;
  fp:=encode(sha256(convert_to(jsonb_build_object(
   'source_id',src.id,'source_hash',src.content_hash,'product_ids',ids,'query',q
  )::text,'UTF8')),'hex');
  select * into j from public.cc_automation_jobs where created_by=u and fingerprint=fp;
  if found then return jsonb_build_object('job',to_jsonb(j),'reused',true); end if;
  select count(*) into n from public.cc_automation_jobs where created_by=u and status='pending';
  if n>=50 then raise exception 'Pending queue limit reached' using errcode='22023'; end if;
  insert into public.cc_automation_jobs(id,created_by,source_id,source_hash,fingerprint,query,product_ids)
   values(jid,u,src.id,src.content_hash,fp,q,ids) returning * into j;
  return jsonb_build_object('job',to_jsonb(j));

 elsif p_action='claim' then
  select * into cfg from public.cc_automation_settings where created_by=u;
  if not found or not cfg.enabled then return jsonb_build_object('job',null,'reason','disabled'); end if;
  if exists(select 1 from public.cc_automation_jobs
    where created_by=u and status in ('running','needs_attention')) then
   return jsonb_build_object('job',null,'reason','running_or_attention');
  end if;
  select count(*) into n from public.cc_automation_jobs where created_by=u and claimed_at>=day_start;
  if n>=cfg.daily_limit then return jsonb_build_object('job',null,'reason','daily_limit'); end if;
  select * into j from public.cc_automation_jobs
   where created_by=u and status='pending' order by created_at,id limit 1 for update;
  if not found then return jsonb_build_object('job',null,'reason','empty'); end if;
  -- Reservation is committed before any external call and counts even on failure.
  update public.cc_automation_jobs set status='running',claimed_at=now(),run_id=id
   where id=j.id returning * into j;
  return jsonb_build_object('job',to_jsonb(j));

 elsif p_action='finish' then
  jid:=(p_data->>'job_id')::uuid;
  code:=p_data->>'error_code';
  if code is not null and code !~ '^[A-Z0-9_]{1,80}$' then code:='QUEUE_ERROR'; end if;
  select * into j from public.cc_automation_jobs where id=jid and created_by=u for update;
  if not found then raise exception 'Job not found' using errcode='42501'; end if;
  if j.status not in ('running','needs_attention') then return jsonb_build_object('job',to_jsonb(j)); end if;
  -- Reconciliation can discover a late successful save without generating again.
  if exists(select 1 from public.cc_runs where id=j.id and created_by=u) then
   update public.cc_automation_jobs set status='completed',finished_at=now(),error_code=null
    where id=j.id returning * into j;
  elsif j.status='running' then
   update public.cc_automation_jobs set status='needs_attention',finished_at=now(),
    error_code=coalesce(code,'RESULT_UNCERTAIN') where id=j.id returning * into j;
  end if;
  return jsonb_build_object('job',to_jsonb(j));

 elsif p_action='cancel' then
  jid:=(p_data->>'job_id')::uuid;
  update public.cc_automation_jobs set status='cancelled',finished_at=now()
   where id=jid and created_by=u and status='pending' returning * into j;
  if not found then raise exception 'Only pending own jobs can be cancelled' using errcode='22023'; end if;
  return jsonb_build_object('job',to_jsonb(j));

 else
  raise exception 'Unknown queue action' using errcode='22023';
 end if;
end $$;
revoke all on function private.cc_automation_rpc(text,jsonb) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.cc_automation_rpc(text,jsonb) to authenticated;
create function public.cc_automation(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.cc_automation_rpc(p_action,p_data);
$$;
revoke all on function public.cc_automation(text,jsonb) from public,anon,authenticated;
grant execute on function public.cc_automation(text,jsonb) to authenticated;
comment on table public.cc_automation_jobs is 'Explicit human-verified pilot queue. Daily reserved job-count limit is not a money cap. No automatic retry of claimed or uncertain jobs.';
commit;

