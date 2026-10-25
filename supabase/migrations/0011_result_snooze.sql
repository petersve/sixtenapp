-- "Har inte fått tillbaka provet än": skjut upp frågan om betyg. Hela familjen får läsa och sätta.
create table public.result_snooze (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  until date not null,
  set_by uuid,
  set_at timestamptz default now(),
  primary key (user_id, module_id)
);
alter table public.result_snooze enable row level security;
create policy "family reads snooze" on public.result_snooze for select
  using (exists (select 1 from public.profiles p where p.id = result_snooze.user_id and p.family_id = public.my_family()));
create policy "family sets snooze" on public.result_snooze for insert
  with check (exists (select 1 from public.profiles p where p.id = result_snooze.user_id and p.family_id = public.my_family()));
create policy "family updates snooze" on public.result_snooze for update
  using (exists (select 1 from public.profiles p where p.id = result_snooze.user_id and p.family_id = public.my_family()));
