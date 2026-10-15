# Pluggappen

PWA för provplugg enligt successive relearning: korta pass, kontrollfrågor, flashcards, övningsprov och föräldravy.

## Stack
- Vite + vanilla JS, PWA (vite-plugin-pwa) → Vercel (Hobby)
- Supabase: Postgres + Auth (magic link) + Realtime + pg_cron + Edge Functions
- Påminnelser: Telegram-bot (edge function `remind`, körs dagligen via pg_cron)

## Innehållsformat
En modul = ett prov. Se `content/kemi-v42.json`. Fält: `cards` (fakta-atomer: q/a/why/ex, lvl G|H, t = tema), `quiz` (mc|txt, kopplade till `c` = card id), `boss` (rita/förklara med facit + checklista), `test` (part1/part2 = quiz-id:n, open = rubric-frågor), `plan` (dagar).

Nytt prov: ge Claude "inför provet"-dokumentet → Claude skriver `content/<slug>.json` och laddar upp till `modules` via Supabase.

## Miljövariabler (Vercel)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Supabase secrets (edge functions)
- `TELEGRAM_BOT_TOKEN`

## Publicera nytt innehåll
1. Lägg `content/<slug>.json` i repot (format: se befintliga filer) och pusha.
2. Kör i Supabase SQL: `select net.http_post(url := 'https://gsqpkizwuzpnyyeoeohj.supabase.co/functions/v1/import-module', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"slug":"<slug>"}'::jsonb);`
   Modulen måste finnas i `modules` (annars skicka `"create": {...}` i body).
