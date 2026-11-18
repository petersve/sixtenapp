-- Övningar utanför appen (papper, Pocket, med förälder) och pappersövningsprov.
-- Eleven markerar som gjord (pending), förälder rättar och godkänner. Först då räknas punkten.
create table public.offline_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  item_key text not null,
  label text not null,
  is_test boolean not null default false,
  submitted_day date not null,
  submitted_at timestamptz default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  score int, max int, comment text,
  reviewed_by uuid, reviewed_at timestamptz,
  unique (user_id, item_key)
);
alter table public.offline_checks enable row level security;
create policy "family reads checks" on public.offline_checks for select
  using (exists (select 1 from public.profiles p where p.id = offline_checks.user_id and p.family_id = public.my_family()));
create policy "student submits own" on public.offline_checks for insert with check (user_id = auth.uid());
create policy "student resubmits own pending or rejected" on public.offline_checks for update
  using (user_id = auth.uid() and status <> 'approved') with check (user_id = auth.uid() and status = 'pending');
create policy "parent reviews" on public.offline_checks for update
  using (public.is_parent() and exists (select 1 from public.profiles p where p.id = offline_checks.user_id and p.family_id = public.my_family()));
