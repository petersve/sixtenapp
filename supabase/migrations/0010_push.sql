-- Web push. VAPID-nycklar i Vault: vapid_private_key, vapid_public_key. Publika nyckeln ligger även i src/db.js.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique, keys jsonb not null, ua text,
  created_at timestamptz default now(), last_ok timestamptz, failures int not null default 0
);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create table public.push_log (id bigserial primary key, user_id uuid, kind text, title text, sent_at timestamptz default now());
alter table public.push_log enable row level security;
select cron.schedule('pluggappen-push-evening', '0 16 * * *', $$ select net.http_post(url := 'https://gsqpkizwuzpnyyeoeohj.supabase.co/functions/v1/push-send', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"mode":"evening"}'::jsonb, timeout_milliseconds := 60000); $$);
select cron.schedule('pluggappen-push-lectures', '30 17 * * *', $$ select net.http_post(url := 'https://gsqpkizwuzpnyyeoeohj.supabase.co/functions/v1/push-send', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"mode":"lectures"}'::jsonb, timeout_milliseconds := 60000); $$);
