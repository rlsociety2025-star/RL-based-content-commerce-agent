-- Run ONLY on hfqqqetcjbkptipqhskx; existing installation only.
-- Transactional model allowlist update. No rows, RLS, grants, or other constraints change.
begin;
alter table public.cc_runs drop constraint cc_runs_model_check;
alter table public.cc_runs add constraint cc_runs_model_check
 check (model like 'gemma-%' or model = 'claude-haiku-4-5-20251001');
commit;
