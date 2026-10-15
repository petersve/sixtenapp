create or replace view public.modules_list with (security_invoker = true) as
  select id, family_id, slug, title, subject, kind, note, exam_date, published, created_at, (content is not null) as has_content, goal_subject, content->'plan' as plan
  from public.modules;
