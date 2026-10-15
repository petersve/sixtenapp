// Hämtar Sixtens inspelningar från Pocket (public API) till tabellen lectures.
// Nyckeln ligger i Supabase Vault (pocket_api_key_sixten) och läses via public.get_secret (service role).
// POST {"days": 30, "student": "<user uuid>"} – körs av pg_cron varje kväll och kan triggas manuellt.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const API = "https://public.heypocketai.com/api/v1/public";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function pocket(path: string, key: string) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${key}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`Pocket ${r.status} ${path}: ${j.error || ""}`);
  return j;
}
function summaryText(s: unknown): string | null {
  // Pocket returnerar summarizations som objekt/array med metadata; vi plockar den längsta textsträngen (markdown-sammanfattningen).
  const strs: string[] = [];
  const walk = (v: unknown) => { if (typeof v === "string") strs.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v as object).forEach(walk); };
  walk(s);
  const best = strs.filter((t) => t.length > 80 && /\s/.test(t)).sort((a, b) => b.length - a.length)[0];
  return best ? best.replace(/<pocket:chart[^>]*>[\s\S]*?<\/pocket:chart>/g, (m) => m.replace(/<[^>]+>/g, "").trim()).trim() : null;
}
function guessSubject(title: string): string | null {
  const t = (title || "").toLowerCase();
  const map: [RegExp, string][] = [[/kemi|fysik|biologi|teknik|\bno\b/, "NO"], [/historia|samh|geografi|religion|\bso\b/, "SO"], [/matte|matematik|ekvation|bråk|procent/, "Matematik"], [/engelska|english/, "Engelska"], [/svenska/, "Svenska"], [/franska|french/, "Franska"], [/musik/, "Musik"], [/hkk|hemkunskap/, "HKK"], [/idrott/, "Idrott"], [/bild/, "Bild"]];
  for (const [re, s] of map) if (re.test(t)) return s;
  return null;
}

Deno.serve(async (req) => {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const days = Number(body.days ?? 30);
  const { data: key, error: kerr } = await admin.rpc("get_secret", { p_name: "pocket_api_key_sixten" });
  if (kerr || !key) return new Response(JSON.stringify({ error: "no key", detail: kerr?.message }), { status: 500 });
  // Elev + familj
  let studentId = body.student as string | undefined;
  if (!studentId) { const { data: s } = await admin.from("profiles").select("id").eq("role", "student").limit(1).maybeSingle(); studentId = s?.id; }
  const { data: prof } = await admin.from("profiles").select("family_id").eq("id", studentId!).maybeSingle();
  const start = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const list = await pocket(`/recordings?start_date=${start}&limit=100`, key);
  const recs: any[] = list.data ?? [];
  const { data: have } = await admin.from("lectures").select("pocket_id,state").in("pocket_id", recs.map((r) => r.id));
  const haveMap = new Map((have ?? []).map((h: any) => [h.pocket_id, h.state]));
  let upserted = 0; const errors: string[] = [];
  for (const r of recs) {
    const prev = haveMap.get(r.id);
    if (prev && prev === r.state && r.state !== "processing") continue; // redan synkad och oförändrad
    try {
      const d = (await pocket(`/recordings/${r.id}?include_transcript=true&include_summarizations=true`, key)).data ?? {};
      const segs = d.transcript?.segments ?? [];
      const transcript = segs.map((s: any) => s.text).join(" ").trim() || null;
      const summary = summaryText(d.summarizations);
      await admin.from("lectures").upsert({
        pocket_id: r.id, user_id: studentId, family_id: prof?.family_id ?? null, title: r.title, recorded_at: r.recording_at || r.created_at, duration: r.duration, state: r.state,
        subject: guessSubject(r.title), summary, transcript, synced_at: new Date().toISOString(),
      }, { onConflict: "pocket_id" });
      upserted++;
    } catch (e) { errors.push(`${r.id}: ${(e as Error).message}`); }
  }
  return new Response(JSON.stringify({ found: recs.length, upserted, errors, sample: recs.slice(0, 3).map((r) => ({ id: r.id, title: r.title, state: r.state, at: r.recording_at, dur: r.duration })) }), { headers: { "Content-Type": "application/json" } });
});
