-- Pluggappen: schema v1
-- Moduler (ett prov = en modul) publiceras av föräldern/Claude. Progress skrivs av eleven.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('student','parent')) default 'student',
  family_id uuid not null default gen_random_uuid(),
  telegram_chat_id text,
  created_at timestamptz default now()
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  slug text not null,
  title text not null,
  subject text not null,
  exam_date date,
  content jsonb not null,          -- {plan, cards, quiz, boss, test} – samma format som content/*.json
  published boolean default true,
  created_at timestamptz default now(),
  unique (family_id, slug)
);

-- Per kort och elev: vilka dagar rätt, antal rätt/fel, svagt just nu
create table public.card_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  card_id text not null,
  days date[] not null default '{}',
  correct int not null default 0,
  wrong int not null default 0,
  weak boolean not null default false,
  boss_at timestamptz,
  last_at timestamptz default now(),
  primary key (user_id, module_id, card_id)
);

-- Pass, quiz, prov
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  kind text not null check (kind in ('pass','pass-avbrutet','quiz','test')),
  day date not null default current_date,
  score int not null default 0,
  max int not null default 0,
  minutes int,
  detail jsonb,                    -- för prov: answers + open-svar + rättning
  created_at timestamptz default now()
);

-- RLS: alla i samma familj läser allt; eleven skriver sin egen progress; föräldern publicerar moduler och rättar.
alter table public.profiles enable row level security;
alter table public.modules enable row level security;
alter table public.card_progress enable row level security;
alter table public.sessions enable row level security;

create or replace function public.my_family() returns uuid language sql stable security definer as
  $$ select family_id from public.profiles where id = auth.uid() $$;
create or replace function public.is_parent() returns boolean language sql stable security definer as
  $$ select coalesce((select role = 'parent' from public.profiles where id = auth.uid()), false) $$;

create policy "family reads profiles" on public.profiles for select using (family_id = public.my_family());
create policy "own profile" on public.profiles for all using (id = auth.uid());

create policy "family reads modules" on public.modules for select using (family_id = public.my_family());
create policy "parent writes modules" on public.modules for all using (family_id = public.my_family() and public.is_parent());

create policy "family reads progress" on public.card_progress for select
  using (exists (select 1 from public.profiles p where p.id = card_progress.user_id and p.family_id = public.my_family()));
create policy "student writes own progress" on public.card_progress for all using (user_id = auth.uid());

create policy "family reads sessions" on public.sessions for select
  using (exists (select 1 from public.profiles p where p.id = sessions.user_id and p.family_id = public.my_family()));
create policy "student writes own sessions" on public.sessions for insert with check (user_id = auth.uid());
create policy "parent grades sessions" on public.sessions for update
  using (public.is_parent() and exists (select 1 from public.profiles p where p.id = sessions.user_id and p.family_id = public.my_family()));

-- Realtime så förälderns vy uppdateras live
alter publication supabase_realtime add table public.card_progress, public.sessions;
