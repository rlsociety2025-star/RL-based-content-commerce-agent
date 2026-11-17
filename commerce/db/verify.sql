-- Read-only post-install checks. Zero unauthorized grants is expected.
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in ('cc_sources','cc_products','cc_runs','cc_reviews');
select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename like 'cc_%';
select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name like 'cc_%' and grantee in ('anon','authenticated') order by table_name,grantee,privilege_type;
select has_table_privilege('anon','public.cc_runs','SELECT') as anonymous_read_expected_false,
       has_table_privilege('authenticated','public.cc_runs','DELETE') as deletion_expected_false,
       has_column_privilege('authenticated','public.cc_sources','body','UPDATE') as source_rewrite_expected_false;
