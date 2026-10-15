// Importerar en moduls innehåll från repots content/-mapp (publikt på GitHub) till tabellen modules.
// POST {"slug": "...", "file": "....json", "create": {title,subject,kind,exam_date,goal_subject,note}?}
// Anropas via pg_net: select net.http_post(url := '.../functions/v1/import-module', headers := '{"Content-Type":"application/json"}', body := '{"slug":"..."}');
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RAW = "https://raw.githubusercontent.com/petersve/sixtenapp/main/content/";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || ""); const file = String(body.file || slug + ".json");
  if (!/^[a-z0-9-]+$/.test(slug) || !/^[a-z0-9-]+\.json$/.test(file)) return new Response(JSON.stringify({ error: "bad slug/file" }), { status: 400 });
  const r = await fetch(RAW + file, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) return new Response(JSON.stringify({ error: "fetch failed", status: r.status }), { status: 502 });
  const m = await r.json();
  const content = { plan: m.plan ?? [], cards: m.cards ?? [], quiz: m.quiz ?? [], boss: m.boss ?? [], test: m.test ?? null, paper: m.paper ?? null, intro: m.intro ?? null };
  const patch: Record<string, unknown> = { content };
  for (const k of ["title", "subject", "kind", "exam_date", "goal_subject", "note"]) if (m[k] != null) patch[k] = m[k];
  const { data: existing } = await admin.from("modules").select("id").eq("slug", slug).is("family_id", null).maybeSingle();
  let res;
  if (existing) res = await admin.from("modules").update(patch).eq("id", existing.id).select("id,slug").single();
  else if (body.create) res = await admin.from("modules").insert({ family_id: null, slug, published: true, ...body.create, ...patch }).select("id,slug").single();
  else return new Response(JSON.stringify({ error: "module not found and no create block" }), { status: 404 });
  if (res.error) return new Response(JSON.stringify({ error: res.error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, id: res.data.id, slug, cards: content.cards.length, quiz: content.quiz.length }), { headers: { "Content-Type": "application/json" } });
});
