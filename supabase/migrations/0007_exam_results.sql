create table public.exam_results (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  grade text not null check (grade in ('A','B','C','D','E','F')),
  comment text,
  entered_by uuid,
  entered_at timestamptz default now(),
  primary key (user_id, module_id)
);
alter table public.exam_results enable row level security;
create policy "family reads results" on public.exam_results for select
  using (exists (select 1 from public.profiles p where p.id = exam_results.user_id and p.family_id = public.my_family()));
create policy "student enters own result" on public.exam_results for insert with check (user_id = auth.uid());
create policy "parent manages results" on public.exam_results for all
  using (public.is_parent() and exists (select 1 from public.profiles p where p.id = exam_results.user_id and p.family_id = public.my_family()))
  with check (public.is_parent() and exists (select 1 from public.profiles p where p.id = exam_results.user_id and p.family_id = public.my_family()));
