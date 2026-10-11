// Daglig påminnelse: körs av pg_cron. Elever med Telegram kopplat som inte gjort något pass idag får en knuff.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const APP_URL = Deno.env.get("APP_URL") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function send(chat: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }) });
}
const todayStr = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10); // ~Stockholm

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  const today = todayStr();
  const { data: students } = await admin.from("profiles").select("id,display_name,telegram_chat_id,family_id,last_reminded").eq("role", "student").not("telegram_chat_id", "is", null);
  let sent = 0;
  for (const s of students ?? []) {
    if (s.last_reminded === today) continue; // max en påminnelse per dag, även om endpointen anropas flera gånger
    // Närmaste kommande prov för familjen (eller delat)
    const { data: mods } = await admin.from("modules").select("id,title,subject,exam_date").eq("published", true).not("content", "is", null).or(`family_id.is.null,family_id.eq.${s.family_id}`).gte("exam_date", today).order("exam_date").limit(1);
    const mod = mods?.[0];
    if (!mod) continue;
    const { count } = await admin.from("sessions").select("id", { count: "exact", head: true }).eq("user_id", s.id).eq("module_id", mod.id).eq("day", today).like("kind", "pass%");
    if ((count ?? 0) > 0) continue;
    const { data: cp } = await admin.from("card_progress").select("days,weak").eq("user_id", s.id).eq("module_id", mod.id);
    const total = (cp ?? []).length, green = (cp ?? []).filter((c) => (c.days ?? []).length >= 3).length, weak = (cp ?? []).filter((c) => c.weak).length;
    const daysLeft = Math.round((Date.parse(mod.exam_date) - Date.parse(today)) / 86400e3);
    const line = total ? `${green} gröna, ${weak} röda.` : `Inget påbörjat ännu.`;
    await send(s.telegram_chat_id, `🧪 <b>${mod.subject}: ${mod.title}</b> om ${daysLeft} dag${daysLeft === 1 ? "" : "ar"}.\nInget pass idag ännu. ${line}\n15 minuter räcker: ${APP_URL}`);
    await admin.from("profiles").update({ last_reminded: today }).eq("id", s.id);
    sent++;
  }
  // Föräldrar: prov utan material inom 5 dagar
  const { data: parents } = await admin.from("profiles").select("id,telegram_chat_id,family_id,last_reminded").eq("role", "parent").not("telegram_chat_id", "is", null);
  for (const p of parents ?? []) {
    if (p.last_reminded === today) continue;
    const limit = new Date(Date.parse(today) + 5 * 86400e3).toISOString().slice(0, 10);
    const { data: missing } = await admin.from("modules").select("title,subject,exam_date").eq("published", true).is("content", null).or(`family_id.is.null,family_id.eq.${p.family_id}`).gte("exam_date", today).lte("exam_date", limit).order("exam_date");
    if (!missing?.length) continue;
    await send(p.telegram_chat_id, `📚 <b>Saknar material</b> inom 5 dagar:\n` + missing.map((m) => `• ${m.subject}: ${m.title} (${m.exam_date.slice(5).replace("-", "/")})`).join("\n") + `\nSkicka "inför provet"-dokumentet till Claude.`);
    await admin.from("profiles").update({ last_reminded: today }).eq("id", p.id);
    sent++;
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
