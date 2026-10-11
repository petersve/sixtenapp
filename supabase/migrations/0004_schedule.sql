alter table public.modules alter column content drop not null;
alter table public.modules add column if not exists kind text not null default 'prov';
alter table public.modules add column if not exists note text;
create or replace view public.modules_list with (security_invoker = true) as
  select id, family_id, slug, title, subject, kind, note, exam_date, published, created_at, (content is not null) as has_content
  from public.modules;
