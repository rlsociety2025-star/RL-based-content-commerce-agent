-- Additional own-only manual publication/observations; old monetary reports stay untouched.
begin;
create table public.cc_publication_queue (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null references auth.users(id),
 run_id uuid not null references public.cc_runs(id),
 candidate_index integer not null check(candidate_index between 0 and 2),
 status text not null default 'waiting' check(status in ('waiting','published_operator_reported')),
 blog_id text, log_no text, title text, published_at timestamptz,
 published_precision text check(published_precision='minute'),
 manually_edited boolean not null default false,
 disclosure_confirmed boolean not null default false,
 recorded_at timestamptz not null default now(),
 unique(created_by,run_id,candidate_index),
 check(status='waiting' or (blog_id is not null and log_no is not null and blog_id ~ '^[A-Za-z0-9_-]{1,60}$' and log_no ~ '^[0-9]{1,30}$' and title is not null and published_at is not null and published_precision is not null and disclosure_confirmed))
);
create unique index cc_publication_post_unique on public.cc_publication_queue(created_by,blog_id,log_no) where log_no is not null;
create table public.cc_view_observations (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null references auth.users(id),
 publication_id uuid not null references public.cc_publication_queue(id),
 metric_day date not null,
 daily_views bigint not null check(daily_views between 0 and 9007199254740991),
 cumulative_views bigint check(cumulative_views between 0 and 9007199254740991),
 observed_at timestamptz not null,
 provisional boolean not null default true,
 source_kind text not null default 'manual_official_ui' check(source_kind='manual_official_ui'),
 source_url text not null,
 recorded_at timestamptz not null default now(),
 unique(publication_id,metric_day,observed_at),
 check(cumulative_views is null or cumulative_views>=daily_views),
 check(provisional or observed_at >= ((metric_day+1)::timestamp at time zone 'Asia/Seoul'))
);
alter table public.cc_publication_queue enable row level security;
alter table public.cc_view_observations enable row level security;
revoke all on public.cc_publication_queue,public.cc_view_observations from public,anon,authenticated;
grant select on public.cc_publication_queue,public.cc_view_observations to authenticated;
grant insert(created_by,run_id,candidate_index) on public.cc_publication_queue to authenticated;
grant update(status,blog_id,log_no,title,published_at,published_precision,manually_edited,disclosure_confirmed) on public.cc_publication_queue to authenticated;
grant insert(created_by,publication_id,metric_day,daily_views,cumulative_views,observed_at,provisional,source_kind,source_url) on public.cc_view_observations to authenticated;
create policy cc_publication_own_read on public.cc_publication_queue for select to authenticated using(created_by=(select auth.uid()) and (select public.is_dashboard_member()));
create policy cc_publication_own_insert on public.cc_publication_queue for insert to authenticated with check(created_by=(select auth.uid()) and (select public.is_dashboard_member()) and exists(select 1 from public.cc_runs r where r.id=run_id and r.created_by=(select auth.uid()) and candidate_index < jsonb_array_length(r.candidates)));
create policy cc_publication_own_update on public.cc_publication_queue for update to authenticated using(status='waiting' and created_by=(select auth.uid()) and (select public.is_dashboard_member())) with check(created_by=(select auth.uid()) and (select public.is_dashboard_member()));
create policy cc_views_own_read on public.cc_view_observations for select to authenticated using(created_by=(select auth.uid()) and (select public.is_dashboard_member()));
create policy cc_views_own_insert on public.cc_view_observations for insert to authenticated with check(created_by=(select auth.uid()) and (select public.is_dashboard_member()) and exists(select 1 from public.cc_publication_queue p where p.id=publication_id and p.created_by=(select auth.uid()) and p.status='published_operator_reported' and source_url='https://blog.stat.naver.com/blog/article/'||p.log_no||'/cv' and observed_at>=p.published_at and observed_at<=now()+interval '5 minutes' and metric_day>=(p.published_at at time zone 'Asia/Seoul')::date and metric_day<=(observed_at at time zone 'Asia/Seoul')::date));
create index cc_views_publication_day on public.cc_view_observations(publication_id,metric_day,observed_at desc);
comment on table public.cc_view_observations is 'Operator-reported official UI observations, not independently API-verified; provisional zero is not final reward.';
commit;
