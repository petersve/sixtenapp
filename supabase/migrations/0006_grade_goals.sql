create table if not exists public.grade_goals (
  user_id uuid not null references auth.users(id) on delete cascade,
  grade int not null default 9,
  subject text not null,
  goal text not null check (goal in ('A','B','C','D','E')),
  points numeric generated always as (case goal when 'A' then 20 when 'B' then 17.5 when 'C' then 15 when 'D' then 12.5 else 10 end) stored,
  updated_by uuid,
  updated_at timestamptz default now(),
  primary key (user_id, grade, subject)
);
alter table public.grade_goals enable row level security;
create policy "family reads goals" on public.grade_goals for select
  using (exists (select 1 from public.profiles p where p.id = grade_goals.user_id and p.family_id = public.my_family()));
create policy "parent writes goals" on public.grade_goals for all
  using (public.is_parent() and exists (select 1 from public.profiles p where p.id = grade_goals.user_id and p.family_id = public.my_family()))
  with check (public.is_parent() and exists (select 1 from public.profiles p where p.id = grade_goals.user_id and p.family_id = public.my_family()));
alter table public.modules add column if not exists goal_subject text;
create or replace view public.modules_list with (security_invoker = true) as
  select id, family_id, slug, title, subject, kind, note, exam_date, published, created_at, (content is not null) as has_content, goal_subject
  from public.modules;
