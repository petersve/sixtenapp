// Web push till appen. Anropas av pg_cron (dagliga påminnelser) eller manuellt.
// POST {"mode":"evening"|"lectures"|"custom", "user": uuid?, "title"?, "body"?, "url"?}
// evening: elever utan pass idag → motiverande knuff. lectures: oreviderade lektioner med frågor från idag/igår.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APP_URL = "https://sixtenapp-rosy.vercel.app";
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const todayStr = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);

// ---- Copy. Kort, rak, ingen moralkaka. Varieras så det inte blir tapet. ----
const EVENING = (mod: { subject: string; title: string }, daysLeft: number, green: number, total: number, weak: number, streak: number) => {
  const left = daysLeft === 0 ? "idag" : daysLeft === 1 ? "imorgon" : `om ${daysLeft} dagar`;
  const titles = [
    `15 minuter. Sen är du fri.`, `Dagens pass väntar`, `${mod.subject} ${left}. Kör nu?`, `Snabbt pass, lång kväll`, `Ett pass. Grön dag.`,
  ];
  const bodies = [
    total ? `${green} av ${total} kort gröna. ${weak ? weak + " röda som vill ha en chans." : "Håll det så."}` : `${mod.subject}: ${mod.title}. Första passet är det lättaste.`,
    streak >= 2 ? `${streak} dagar i rad. Bryt inte serien nu.` : `Gör det nu så slipper du tänka på det ikväll.`,
    total ? `Passet väljer självt det du är sämst på. Du behöver bara trycka start.` : `Tre nya kort, tio frågor, en boss. Klart på 15.`,
    `Provet i ${mod.subject} är ${left}. Varje pass idag är värt dubbelt mot ett i panik.`,
  ];
  return { title: pick(titles), body: pick(bodies) };
};
const LECTURE = (l: { title: string; subject: string | null }) => ({
  title: pick([`Fem frågor på dagens ${l.subject || "lektion"}`, `3 minuter: ${l.subject || "dagens lektion"}`, `Du var där. Kolla att det fastnade.`]),
  body: pick([`"${l.title}". Fem frågor, tar tre minuter, och det du hörde idag stannar kvar.`, `Det du repeterar samma dag sitter i veckor. Det du inte repeterar är borta på fredag.`, `Snabbast sättet att slippa plugga senare: fem frågor nu.`]),
});
const MISSED = (label: string, subject: string) => ({
  title: pick([`Joker-läge: rädda gårdagen`, `Du kan fortfarande få veckan grön`, `En missad dag är inte en missad vecka`]),
  body: `${label} (${subject}) blev inte gjord. Gör den idag så räknas veckan ändå.`,
});

async function sendTo(userId: string, payload: { title: string; body: string; url?: string; tag?: string }, kind: string) {
  const { data: subs } = await admin.from("push_subscriptions").select("id,endpoint,keys").eq("user_id", userId);
  let n = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ ...payload, url: payload.url || APP_URL }), { TTL: 6 * 3600 });
      await admin.from("push_subscriptions").update({ last_ok: new Date().toISOString(), failures: 0 }).eq("id", s.id); n++;
    } catch (e) {
      const code = (e as any)?.statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      else await admin.from("push_subscriptions").update({ failures: 1 }).eq("id", s.id);
    }
  }
  if (n) await admin.from("push_log").insert({ user_id: userId, kind, title: payload.title });
  return n;
}

Deno.serve(async (req) => {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const [{ data: priv }, { data: pub }] = await Promise.all([admin.rpc("get_secret", { p_name: "vapid_private_key" }), admin.rpc("get_secret", { p_name: "vapid_public_key" })]);
  if (!priv || !pub) return new Response(JSON.stringify({ error: "no vapid keys" }), { status: 500 });
  webpush.setVapidDetails("mailto:peter@agentmama.ai", pub, priv);
  const today = todayStr(); let sent = 0;
  const mode = body.mode || "evening";

  if (mode === "custom" && body.user) sent += await sendTo(body.user, { title: body.title || "Pluggappen", body: body.body || "", url: body.url }, "custom");

  if (mode === "evening") {
    const { data: students } = await admin.from("profiles").select("id,family_id").eq("role", "student");
    for (const s of students ?? []) {
      const { data: mods } = await admin.from("modules").select("id,title,subject,exam_date,kind").eq("published", true).not("content", "is", null).neq("kind", "diagnos").or(`family_id.is.null,family_id.eq.${s.family_id}`).gte("exam_date", today).order("exam_date").limit(1);
      const mod = mods?.[0]; if (!mod) continue;
      const { count } = await admin.from("sessions").select("id", { count: "exact", head: true }).eq("user_id", s.id).eq("day", today).like("kind", "pass%");
      if ((count ?? 0) > 0) continue;
      const { data: cp } = await admin.from("card_progress").select("days,weak").eq("user_id", s.id).eq("module_id", mod.id);
      const total = (cp ?? []).length, green = (cp ?? []).filter((c) => (c.days ?? []).length >= 3).length, weak = (cp ?? []).filter((c) => c.weak).length;
      const { data: days } = await admin.from("sessions").select("day").eq("user_id", s.id).order("day", { ascending: false }).limit(30);
      const set = new Set((days ?? []).map((d) => d.day)); let streak = 0; const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() - 1);
      while (set.has(d.toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1); }
      const daysLeft = Math.round((Date.parse(mod.exam_date) - Date.parse(today)) / 86400e3);
      sent += await sendTo(s.id, { ...EVENING(mod, daysLeft, green, total, weak, streak), tag: "evening" }, "evening");
    }
  }

  if (mode === "lectures") {
    const since = new Date(Date.now() - 36 * 3600e3).toISOString();
    const { data: lecs } = await admin.from("lectures").select("id,user_id,title,subject,questions,recorded_at").gte("recorded_at", since).not("questions", "is", null);
    for (const l of lecs ?? []) {
      if (!(l.questions as any[])?.length) continue;
      const { data: rv } = await admin.from("lecture_reviews").select("lecture_id").eq("user_id", l.user_id).eq("lecture_id", l.id).maybeSingle();
      if (rv) continue;
      sent += await sendTo(l.user_id, { ...LECTURE(l), tag: "lecture-" + l.id }, "lecture");
    }
  }
  return new Response(JSON.stringify({ sent, mode }), { headers: { "Content-Type": "application/json" } });
});
