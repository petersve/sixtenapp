// Telegram-webhook: tar emot "/start <user_id>" från deep-länken i appen och kopplar chat-id till profilen.
// GET ?setup=1 registrerar webhooken hos Telegram (kör en gång).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${TOKEN}`;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function send(chat: string | number, text: string) {
  await fetch(`${API}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }) });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("setup")) {
    const hook = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook`;
    const r = await fetch(`${API}/setWebhook?url=${encodeURIComponent(hook)}`);
    return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
  }
  if (req.method !== "POST") return new Response("ok");
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text) return new Response("ok");
  const chat = String(msg.chat.id);
  const m = msg.text.match(/^\/start\s+([0-9a-f-]{36})/i);
  if (m) {
    const { error } = await admin.rpc("link_telegram", { p_user: m[1], p_chat: chat });
    await send(chat, error ? "Kunde inte koppla kontot. Försök igen från appen." : "Kopplat! Jag säger till när det är dags att plugga. 💪");
  } else {
    await send(chat, "Hej! Koppla mig via knappen under Inställningar i Pluggappen.");
  }
  return new Response("ok");
});
