-- Apply to hfqqqetcjbkptipqhskx before enabling folder import.
-- Existing manual notes, rows, grants and RLS remain unchanged.
begin;
create unique index if not exists cc_sources_inbox_revision_unique
 on public.cc_sources (created_by, source_uri)
 where source_uri like 'obsidian-inbox:ContentCommerce-Inbox/%';
commit;
