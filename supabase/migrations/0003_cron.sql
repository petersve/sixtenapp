alter table public.profiles add column if not exists last_reminded date;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
-- Påminnelse varje dag kl 16:00 UTC (17 CET / 18 CEST)
select cron.schedule('pluggappen-remind', '0 16 * * *', $$
  select net.http_post(url := 'https://gsqpkizwuzpnyyeoeohj.supabase.co/functions/v1/remind', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
$$);
