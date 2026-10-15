-- Lektioner från Pocket + kvällsrepetition. Pocket-nyckeln ligger i Vault (vault.create_secret(..., 'pocket_api_key_sixten')).
create table public.lectures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  family_id uuid,
  pocket_id text not null unique,
  title text, recorded_at timestamptz, duration int, state text,
  subject text, summary text, transcript text, key_points jsonb, questions jsonb,
  module_id uuid references public.modules(id) on delete set null,
  synced_at timestamptz default now()
);
alter table public.lectures enable row level security;
create policy "family reads lectures" on public.lectures for select using (family_id = public.my_family());
create policy "parent edits lectures" on public.lectures for update using (public.is_parent() and family_id = public.my_family());
create table public.lecture_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  day date not null default current_date, score int not null default 0, max int not null default 0,
  created_at timestamptz default now(), primary key (user_id, lecture_id)
);
alter table public.lecture_reviews enable row level security;
create policy "family reads reviews" on public.lecture_reviews for select
  using (exists (select 1 from public.profiles p where p.id = lecture_reviews.user_id and p.family_id = public.my_family()));
create policy "student writes own review" on public.lecture_reviews for all using (user_id = auth.uid());
create or replace function public.get_secret(p_name text) returns text
language sql security definer set search_path = public, vault as
  $$ select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1 $$;
revoke execute on function public.get_secret(text) from public, anon, authenticated;
select cron.schedule('pluggappen-pocket-sync', '30 15 * * *', $$
  select net.http_post(url := 'https://gsqpkizwuzpnyyeoeohj.supabase.co/functions/v1/pocket-sync', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"days": 7}'::jsonb, timeout_milliseconds := 60000);
$$);
