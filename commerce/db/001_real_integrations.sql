-- Apply once, ONLY to hfqqqetcjbkptipqhskx after reviewing.
-- Additive schema: existing dashboard tables/policies and data are not changed.
-- This file was NOT applied during preparation: management SQL timed out.
begin;
do $$ begin
 if to_regclass('public.dashboard_access') is null or to_regprocedure('public.is_dashboard_member()') is null then
  raise exception 'Existing approved-member dashboard schema is required.';
 end if;
end $$;
create schema if not exists private;

create table public.cc_sources (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(title) between 1 and 160),
 body text not null check(char_length(body) between 20 and 12000),
 source_uri text not null check(char_length(source_uri) between 1 and 500),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 status text not null default 'draft' check(status in ('draft','verified','archived')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 verified_by uuid references auth.users(id), verified_at timestamptz, indexed_at timestamptz,
 check((status='verified' and verified_by is not null and verified_at is not null) or status<>'verified')
);
create table public.cc_products (
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(name) between 1 and 160),
 description text not null check(char_length(description) between 10 and 3000),
 price numeric check(price>=0 and price<=10000000000),
 affiliate_url text check(affiliate_url is null or affiliate_url like 'https://%'),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.cc_runs (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 query text not null check(char_length(query) between 3 and 1200),
 model text not null check(model like 'gemma-%'),
 embedding_model text not null check(embedding_model='@cf/baai/bge-m3'),
 candidates jsonb not null check(jsonb_typeof(candidates)='array' and jsonb_array_length(candidates) between 1 and 3),
 retrieved_sources jsonb not null check(jsonb_typeof(retrieved_sources)='array' and jsonb_array_length(retrieved_sources) between 1 and 5),
 product_snapshot jsonb not null check(jsonb_typeof(product_snapshot)='array'),
 kind text not null default 'integration' check(kind='integration'),
 reward numeric check(reward is null)
);
create table public.cc_reviews (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.cc_runs(id),
 candidate_index integer not null check(candidate_index between 0 and 2),
 decision text not null check(decision in ('approved','rejected')),
 note text not null default '' check(char_length(note)<=2000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);

create function private.cc_source_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.updated_at=now();
 if tg_op='INSERT' then
  new.status='draft';new.verified_at=null;new.verified_by=null;new.indexed_at=null;
  new.content_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(new.body,'UTF8')),'hex');
 else
  if new.id<>old.id or new.body<>old.body or new.title<>old.title or new.source_uri<>old.source_uri or new.content_hash<>old.content_hash or new.created_by<>old.created_by then
   raise exception 'Source revisions are immutable. Register a new source instead.';
  end if;
  if new.status='verified' and old.status<>'verified' then
   new.verified_by=auth.uid();new.verified_at=now();new.indexed_at=null;
  elsif new.status<>'verified' then
   new.verified_by=null;new.verified_at=null;new.indexed_at=null;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.cc_source_guard() from public, anon, authenticated;
create trigger cc_source_guard before insert or update on public.cc_sources for each row execute function private.cc_source_guard();

create function private.cc_review_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 select jsonb_array_length(candidates) into n from public.cc_runs where id=new.run_id;
 if n is null or new.candidate_index>=n then raise exception 'Candidate not found'; end if;
 return new;
end $$;
revoke all on function private.cc_review_guard() from public, anon, authenticated;
create trigger cc_review_guard before insert on public.cc_reviews for each row execute function private.cc_review_guard();

do $$ declare t text; begin
 foreach t in array array['cc_sources','cc_products','cc_runs','cc_reviews'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy cc_member_read on public.%I for select to authenticated using ((select public.is_dashboard_member()))',t);
  execute format('create policy cc_member_insert on public.%I for insert to authenticated with check ((select public.is_dashboard_member()) and created_by=(select auth.uid()))',t);
  execute format('create index on public.%I (created_by)',t);
  execute format('create index on public.%I (created_at desc)',t);
 end loop;
end $$;
-- Explicit column grants are required; no DELETE and no self-approval grants.
grant insert(title,body,source_uri,content_hash,status,created_by) on public.cc_sources to authenticated;
grant update(status,indexed_at) on public.cc_sources to authenticated;
create policy cc_member_update on public.cc_sources for update to authenticated
 using ((select public.is_dashboard_member())) with check ((select public.is_dashboard_member()));
grant insert(name,description,price,affiliate_url,created_by) on public.cc_products to authenticated;
grant insert(id,created_by,query,model,embedding_model,candidates,retrieved_sources,product_snapshot,kind,reward) on public.cc_runs to authenticated;
grant insert(run_id,candidate_index,decision,note,created_by) on public.cc_reviews to authenticated;
create index cc_sources_status_idx on public.cc_sources(status);
create index cc_sources_verified_by_idx on public.cc_sources(verified_by);
create index cc_reviews_run_idx on public.cc_reviews(run_id);
comment on table public.cc_runs is 'Real API integration results, NOT real sales results. reward is always null; do not import simulation rewards here.';
comment on table public.cc_sources is 'Immutable document revisions. Reviewer approval controls eligibility for indexing. Canonical status is checked after Qdrant search.';
commit;
