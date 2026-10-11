-- Familjer, inbjudningskod, delade moduler (family_id null = alla), Telegram-koppling
create table public.families (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  created_at timestamptz default now()
);
alter table public.families enable row level security;
create policy "members read family" on public.families for select using (id = public.my_family());

alter table public.profiles alter column family_id drop default;
alter table public.profiles alter column family_id drop not null;
alter table public.modules alter column family_id drop not null;

create policy "shared modules readable" on public.modules for select using (family_id is null);

create or replace function public.create_family(p_name text, p_display_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid;
begin
  v_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into families(code,name) values (v_code,p_name) returning id into v_id;
  insert into profiles(id,display_name,role,family_id) values (auth.uid(),p_display_name,'parent',v_id)
    on conflict (id) do update set display_name=excluded.display_name, role='parent', family_id=excluded.family_id;
  return v_code;
end $$;

create or replace function public.join_family(p_code text, p_display_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from families where code = upper(trim(p_code));
  if v_id is null then return false; end if;
  insert into profiles(id,display_name,role,family_id) values (auth.uid(),p_display_name,'student',v_id)
    on conflict (id) do update set display_name=excluded.display_name, family_id=excluded.family_id;
  return true;
end $$;

create or replace function public.my_family_code()
returns text language sql stable security definer set search_path = public as
  $$ select f.code from families f where f.id = public.my_family() $$;

create or replace function public.link_telegram(p_user uuid, p_chat text)
returns void language sql security definer set search_path = public as
  $$ update profiles set telegram_chat_id = p_chat where id = p_user $$;
revoke execute on function public.link_telegram from anon, authenticated;
