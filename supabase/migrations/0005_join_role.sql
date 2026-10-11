create or replace function public.join_family(p_code text, p_display_name text, p_role text default 'student')
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_role not in ('student','parent') then p_role := 'student'; end if;
  select id into v_id from families where code = upper(trim(p_code));
  if v_id is null then return false; end if;
  insert into profiles(id,display_name,role,family_id) values (auth.uid(),p_display_name,p_role,v_id)
    on conflict (id) do update set display_name=excluded.display_name, role=excluded.role, family_id=excluded.family_id;
  return true;
end $$;
