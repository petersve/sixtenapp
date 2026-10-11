import * as db from './db.js';
const { sb, today } = db;

// ============ STATE ============
let me = null;                 // profil
let MODS = [];                 // modullista
let MOD = null;                // aktiv modul {id,title,content:{plan,cards,quiz,boss,test}}
let CARDS = [], QUIZ = [], BOSS = [], TEST = null, PLAN = [];
let S = { cards: {}, sessions: [] };   // progress för eleven som visas
let student = null;            // vems progress S är (elev-id)
let view = { name: 'home' };
let sess = null;
let unsub = null;
let MEMBERS = [];

const byId = (arr, id) => arr.find(x => x.id === id);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = d => { const [y, m, dd] = d.split('-'); return `${+dd}/${+m}`; };
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2500); }

function setModule(m) { MOD = m; const c = m.content; CARDS = c.cards; QUIZ = c.quiz; BOSS = c.boss; TEST = c.test; PLAN = c.plan || []; try { localStorage.setItem('mod', m.id); } catch (e) {} }

// ============ MASTERY ============
const isStudent = () => me && me.role === 'student';
function cs(id) { return S.cards[id] || (S.cards[id] = { d: [], c: 0, w: 0, weak: false, last: 0, bossAt: 0 }); }
function mastery(id) { const c = S.cards[id]; return c ? Math.min(3, c.d.length) : 0; }
function seen(id) { const c = S.cards[id]; return !!c && (c.c + c.w) > 0; }
function doneToday(id) { const c = S.cards[id]; return !!c && c.d.includes(today()); }
function rec(id, ok) {
  const c = cs(id); c.last = Date.now();
  if (ok) { c.c++; c.weak = false; if (!c.d.includes(today())) c.d.push(today()); }
  else { c.w++; c.weak = true; }
  if (isStudent()) db.upsertCard(me.id, MOD.id, id, c).catch(() => toast('Kunde inte spara, kolla nätet'));
}
function priority(id) { const c = S.cards[id] || { d: [], weak: false, last: 0 }; return (c.weak ? -100 : 0) + c.d.length * 10 + (doneToday(id) ? 50 : 0) + (c.last / 1e13); }
function pickQuestion(cardId, exclude = []) { const pool = QUIZ.filter(q => q.c === cardId && !exclude.includes(q.id)); return pool.length ? pool[Math.floor(Math.random() * pool.length)] : QUIZ.find(q => q.c === cardId); }
function greens() { return CARDS.filter(c => mastery(c.id) === 3).length; }
function streak() { const days = new Set(S.sessions.map(s => s.d)); let n = 0; const d = new Date(); for (let i = 0; i < 10; i++) { const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); if (days.has(k)) n++; else if (i > 0) break; d.setDate(d.getDate() - 1); } return n; }
async function logSession(type, extra = {}) {
  const s = { d: today(), ts: Date.now(), type, score: sess ? sess.score : extra.score, max: sess ? sess.total : extra.max, mins: sess ? Math.round((Date.now() - sess.start) / 60000) : extra.mins, detail: extra.detail };
  S.sessions.push(s);
  if (isStudent()) s.id = await db.insertSession(me.id, MOD.id, s).catch(() => null);
  return s;
}

// ============ RENDER ============
const app = document.getElementById('app');
function go(name, extra = {}) { view = { name, ...extra }; window.scrollTo(0, 0); render(); }
function after(f) { const prev = window._after; window._after = () => { if (prev) prev(); f(); }; return ''; }
function render() {
  const r = { auth, onboard, home, session, flash, quiz, test, map, coach, settings }[view.name] || home;
  app.innerHTML = r();
  app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  app.querySelectorAll('[data-mod]').forEach(b => b.onclick = () => switchModule(b.dataset.mod));
  if (window._after) { const f = window._after; window._after = null; f(); }
}
function topbar(title, right = '') { return `<div class="topbar"><button class="back" data-go="home">Hem</button><div class="eyebrow">${esc(title)}</div><div>${right}</div></div>`; }

// ---------- AUTH ----------
function auth() {
  const mode = view.mode || 'login';
  return `<div class="stack" style="padding-top:30px">
    <div><div class="eyebrow">Pluggappen</div><h1>${mode === 'login' ? 'Logga in' : 'Skapa konto'}</h1></div>
    <form id="af" class="card stack" style="gap:12px">
      <div><label for="em">E-post</label><input type="email" id="em" autocomplete="email" required></div>
      <div><label for="pw">Lösenord</label><input type="password" id="pw" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="6" required></div>
      <div id="aerr"></div>
      <button class="btn primary" type="submit">${mode === 'login' ? 'Logga in' : 'Skapa konto'}</button>
    </form>
    <button class="btn" id="sw">${mode === 'login' ? 'Ny här? Skapa konto' : 'Har redan konto? Logga in'}</button>
  </div>` + after(() => {
    document.getElementById('sw').onclick = () => go('auth', { mode: mode === 'login' ? 'signup' : 'login' });
    document.getElementById('af').onsubmit = async e => {
      e.preventDefault(); const email = document.getElementById('em').value.trim(), password = document.getElementById('pw').value; const err = document.getElementById('aerr');
      const r = mode === 'login' ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password });
      if (r.error) { err.innerHTML = `<div class="fb no">${esc(r.error.message)}</div>`; return; }
      if (mode === 'signup' && !r.data.session) { err.innerHTML = `<div class="fb ok"><b>Kolla mejlen</b>Bekräfta adressen via länken, logga sedan in här.</div>`; return; }
      await boot();
    };
  });
}

// ---------- ONBOARDING (familj) ----------
function onboard() {
  const mode = view.mode || 'join';
  return `<div class="stack" style="padding-top:30px">
    <div><div class="eyebrow">Nästan klart</div><h1>Vem är du?</h1></div>
    <div class="grid2"><button class="btn ${mode === 'join' ? 'primary' : ''}" id="mj" style="font-size:1.1rem">Elev</button><button class="btn ${mode === 'create' ? 'primary' : ''}" id="mc" style="font-size:1.1rem">Förälder</button></div>
    <form id="of" class="card stack" style="gap:12px">
      <div><label for="nm">Ditt namn</label><input type="text" id="nm" required placeholder="${mode === 'join' ? 'Sixten' : 'Peter'}"></div>
      ${mode === 'join' ? `<div><label for="cd">Familjekod (får du av din förälder)</label><input type="text" id="cd" required autocapitalize="characters" placeholder="A1B2C3" style="letter-spacing:.2em;text-transform:uppercase"></div>`
                        : `<div><label for="cd">Har din partner redan skapat familjen? Skriv familjekoden</label><input type="text" id="cd" autocapitalize="characters" placeholder="A1B2C3" style="letter-spacing:.2em;text-transform:uppercase"></div><div class="muted" style="text-align:center">eller</div><div><label for="fn">Skapa ny familj – namn</label><input type="text" id="fn" placeholder="Familjen Svensson"></div>`}
      <div id="oerr"></div>
      <button class="btn primary" type="submit">${mode === 'join' ? 'Gå med' : 'Skapa familj'}</button>
    </form>
    <button class="btn small" id="lo">Logga ut</button>
  </div>` + after(() => {
    document.getElementById('mj').onclick = () => go('onboard', { mode: 'join' });
    document.getElementById('mc').onclick = () => go('onboard', { mode: 'create' });
    document.getElementById('lo').onclick = logout;
    document.getElementById('of').onsubmit = async e => {
      e.preventDefault(); const nm = document.getElementById('nm').value.trim(); const err = document.getElementById('oerr');
      try {
        if (mode === 'join') { const ok = await db.joinFamily(document.getElementById('cd').value, nm); if (!ok) { err.innerHTML = '<div class="fb no">Fel kod. Kolla med din förälder.</div>'; return; } }
        else {
          const cd = document.getElementById('cd').value.trim(), fn = document.getElementById('fn').value.trim();
          if (cd) { const ok = await db.joinFamily(cd, nm, 'parent'); if (!ok) { err.innerHTML = '<div class="fb no">Fel kod.</div>'; return; } }
          else if (fn) { const code = await db.createFamily(fn, nm); toast('Familjekod: ' + code); }
          else { err.innerHTML = '<div class="fb no">Fyll i en familjekod eller ett namn på ny familj.</div>'; return; }
        }
        await boot();
      } catch (ex) { err.innerHTML = `<div class="fb no">${esc(ex.message)}</div>`; }
    };
  });
}
async function logout() { await sb.auth.signOut(); me = null; go('auth'); }

// ---------- HEM ----------
function testScore(t) { const det = t.detail || {}; const answers = det.answers || {}; const auto = Object.values(answers).filter(Boolean).length, autoMax = Object.keys(answers).length; let open = 0, pending = false; (TEST.open || []).forEach(o => { const r = (det.open || {})[o.id]; if (r && typeof r.pts === 'number') open += r.pts; else pending = true; }); const max = autoMax + TEST.open.length * 3; const pts = auto + open; return { pts, max, pct: Math.round(pts / max * 100), auto, autoMax, open, pending }; }
const KIND = { prov: 'Prov', inlämning: 'Inlämning', redovisning: 'Redovisning', muntligt: 'Muntligt', np: 'Nationellt prov' };
const daysTo = d => Math.round((Date.parse(d) - Date.parse(today())) / 86400e3);
const daysLabel = n => n < 0 ? 'klar' : n === 0 ? 'idag' : n === 1 ? 'imorgon' : `om ${n} dagar`;
function scheduleList(forParent) {
  const t = today();
  const up = MODS.filter(m => m.exam_date && m.exam_date >= t);
  const past = MODS.filter(m => !m.exam_date || m.exam_date < t).reverse();
  const row = m => { const n = m.exam_date ? daysTo(m.exam_date) : null; const cur = MOD && m.id === MOD.id; const tag = m.has_content ? `<span class="pill G">Material</span>` : `<span class="pill">${forParent ? 'Saknar material' : 'Inget material än'}</span>`;
    return `<button class="mod ${cur ? 'cur' : ''}" data-mod="${m.id}" ${m.has_content ? '' : 'disabled'}><span style="min-width:0"><b>${esc(m.subject)}: ${esc(m.title)}</b><br><span class="muted">${KIND[m.kind] || esc(m.kind)}${m.exam_date ? ' · ' + fmtDate(m.exam_date) + ' · ' + daysLabel(n) : ''}${m.note ? ' · ' + esc(m.note) : ''}</span></span>${tag}</button>`; };
  return `<div class="modlist">${up.length ? up.map(row).join('') : '<p class="muted">Inga kommande prov inlagda.</p>'}</div>${past.length ? `<details style="margin-top:10px"><summary class="muted">Klara (${past.length})</summary><div class="modlist" style="margin-top:8px">${past.map(row).join('')}</div></details>` : ''}`;
}
function home() {
  const t = today();
  const who = me.role === 'parent' && MOD ? `<div class="fb ok" style="margin-bottom:4px"><b style="font-size:1rem">Du tittar som förälder</b>Det här är ${esc(studentName())}s vy. Passen räknas inte för dig. Gå till Coach för rättning och översikt.</div>` : '';
  const header = `<div class="topbar" style="padding-bottom:4px"><div><div class="eyebrow">Pluggappen · ${esc(me.display_name || '')}</div><h1>${MOD ? 'Nästa prov' : 'Inga prov med material'}</h1></div><button class="btn small" data-go="settings" aria-label="Inställningar">⚙︎</button></div>`;
  const schedule = `<div class="card"><h3 style="margin-bottom:10px">Kommande prov</h3>${scheduleList(me.role === 'parent')}</div>`;
  const footer = `<div class="row" style="justify-content:space-between"><span class="muted" style="font-size:.85rem">${me.role === 'parent' ? 'förälder' : 'elev'}</span>${me.role === 'parent' ? '<button class="btn small" data-go="coach">Coach-vy</button>' : ''}</div>`;
  if (!MOD) return `<div class="stack">${header}<p class="muted">När ett prov får material dyker det upp här som din to-do.</p>${schedule}${footer}</div>` + after(() => {});
  const g = greens(), n = CARDS.length, st = streak();
  const sessToday = S.sessions.filter(s => s.d === t && s.type.startsWith('pass')).length;
  const tests = S.sessions.filter(s => s.type === 'test'); const lastTest = tests[tests.length - 1];
  const dl = MOD.exam_date ? daysTo(MOD.exam_date) : null;
  const planHtml = PLAN.map(p => { const done = S.sessions.filter(s => s.d === p.date && s.type.startsWith('pass')).length, testDone = S.sessions.some(x => x.d === p.date && x.type === 'test'); let k = 0; return `<div class="day"><div class="dl">${esc(p.label)}</div><div>${p.items.map(it => { const isTest = /prov/i.test(it); const ok = isTest ? testDone : (k++ < done); return `<div class="it ${ok ? 'done' : ''} ${p.date === t ? 'today' : ''}">${esc(it)}</div>`; }).join('')}</div></div>`; }).join('');
  const todo = [
    { ok: sessToday > 0, txt: sessToday > 0 ? 'Dagens pass gjort' : 'Gör dagens pass (15 min)' },
    { ok: g === n, txt: `${g}/${n} kort gröna` },
    { ok: tests.length > 0, txt: tests.length ? `Övningsprov skrivet (${testScore(lastTest).pct}%)` : 'Skriv övningsprovet dagen före' },
  ];
  return `<div class="stack">
    ${header}${who}
    <div class="card stack" style="gap:10px">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="eyebrow">${esc(MOD.subject)} · ${MOD.exam_date ? fmtDate(MOD.exam_date) : ''}${dl !== null ? ' · ' + daysLabel(dl) : ''}</div><h2>${esc(MOD.title)}</h2></div><div class="streak" title="${st} dagar i rad">${[0, 1, 2, 3, 4].map(i => `<i class="${i < st ? 'on' : ''}"></i>`).join('')}</div></div>
      <div class="stack" style="gap:6px">${todo.map(x => `<div class="check ${x.ok ? 'on' : ''}" style="padding:10px 12px"><span class="box">${x.ok ? '✓' : ''}</span><span>${esc(x.txt)}</span></div>`).join('')}</div>
      <div class="bar good"><i style="width:${g / n * 100}%"></i></div>
      <div class="dots">${CARDS.map(c => `<span class="dot sm m${mastery(c.id)}" title="${esc(c.q)}"></span>`).join('')}</div>
      <div class="muted" style="font-size:.8rem">grå = inte börjat · röd = 1 dag · gul = 2 dagar · grön = kan (rätt 3 olika dagar)</div>
    </div>
    <button class="btn primary" id="start">${sessToday === 0 ? 'Starta dagens pass' : 'Kör ett pass till'} · 15 min</button>
    <div class="grid2">
      <button class="btn" data-go="flash">Flashcards</button>
      <button class="btn" data-go="quiz">Snabbquiz 10</button>
      <button class="btn" data-go="test">Övningsprov</button>
      <button class="btn" data-go="map">Kunskapskartan</button>
    </div>
    ${PLAN.length ? `<div class="card"><h3 style="margin-bottom:10px">Planen</h3><div class="plan">${planHtml}</div></div>` : ''}
    ${schedule}
    ${footer}
  </div>` + after(() => {
    document.getElementById('start').onclick = startSession;
  });
}
function studentName() { const s = MEMBERS.find(m => m.id === student); return s ? s.display_name : 'eleven'; }
async function switchModule(id) { if (MOD && MOD.id === id) return; const m = await db.loadModule(id); setModule(m); S = await db.loadProgress(student, MOD.id); go(view.name === 'coach' ? 'coach' : 'home'); }

// ---------- PASSET ----------
function startSession() {
  const warm = CARDS.filter(c => seen(c.id) && mastery(c.id) < 3 && !doneToday(c.id)).sort((a, b) => priority(a.id) - priority(b.id)).slice(0, 5);
  let fresh = CARDS.filter(c => !seen(c.id)); fresh = [...fresh.filter(c => c.lvl === 'G'), ...fresh.filter(c => c.lvl === 'H')].slice(0, 3);
  const learnMode = fresh.length > 0;
  if (!learnMode) fresh = CARDS.filter(c => mastery(c.id) < 3).sort((a, b) => priority(a.id) - priority(b.id)).slice(0, 3);
  const pool = new Set([...CARDS.filter(c => seen(c.id)).map(c => c.id), ...fresh.map(c => c.id)]);
  const ids = [...pool].sort((a, b) => priority(a) - priority(b));
  const mixQ = []; const used = new Set();
  for (let i = 0; mixQ.length < 10 && i < 40 && ids.length; i++) { const id = ids[i % ids.length]; const q = pickQuestion(id, [...used]); if (q && !used.has(q.id)) { used.add(q.id); mixQ.push(q); } }
  const bossPool = BOSS.filter(b => pool.has(b.c)); const boss = bossPool.length ? bossPool.sort((a, b) => ((S.cards[a.c] || {}).bossAt || 0) - ((S.cards[b.c] || {}).bossAt || 0))[0] : BOSS[0];
  sess = { start: Date.now(), step: warm.length >= 2 ? 0 : 1, warm, wi: 0, fresh, fi: 0, fphase: 'learn', mixQ: shuffle(mixQ), mi: 0, boss, score: 0, total: 0, learnMode, logged: false };
  go('session');
}
function sessHeader() {
  const names = ['Värm upp', 'Lär 3 nya', 'Blanda', 'Boss']; if (!sess.learnMode) names[1] = 'Repetera 3';
  const mins = Math.floor((Date.now() - sess.start) / 60000);
  return `<div class="topbar"><button class="back" id="quit">Avbryt</button><div class="timer num">${mins} min</div><div class="muted num" style="font-weight:600">${sess.score}/${sess.total} rätt</div></div>
  <div class="steps">${names.map((n, i) => `<div class="${i < sess.step ? 'done' : i === sess.step ? 'on' : ''}">${n}</div>`).join('')}</div>`;
}
function session() {
  if (!sess) return home();
  window._after = () => { const q = document.getElementById('quit'); if (q) q.onclick = () => { if (sess.total > 0 && !sess.logged) logSession('pass-avbrutet'); sess = null; go('home'); }; };
  let body = '';
  if (sess.step === 0) body = stepWarm(); else if (sess.step === 1) body = stepLearn(); else if (sess.step === 2) body = stepMix(); else if (sess.step === 3) body = stepBoss(); else body = stepDone();
  return `<div class="stack">${sessHeader()}${body}</div>`;
}
function stepWarm() {
  const c = sess.warm[sess.wi]; if (!c) { sess.step = 1; return stepLearn(); }
  return `<div class="muted">Gårdagens kort · ${sess.wi + 1} av ${sess.warm.length}. Tänk svaret, vänd, var ärlig.</div>` + flashCard(c, ok => { rec(c.id, ok); sess.total++; if (ok) sess.score++; sess.wi++; if (sess.wi >= sess.warm.length) sess.step = 1; render(); });
}
function stepLearn() {
  const c = sess.fresh[sess.fi]; if (!c) { sess.step = 2; return stepMix(); }
  if (sess.fphase === 'learn') {
    return `<div class="muted">${sess.learnMode ? 'Nytt kort' : 'Repetera'} ${sess.fi + 1} av ${sess.fresh.length}. Läs långsamt. Sen kommer en kontrollfråga direkt.</div>
    <div class="card learn stack" style="gap:14px">
      <div><span class="pill ${c.lvl}">${c.lvl === 'G' ? 'Grund' : 'Högre'} · ${esc(c.t)}</span></div>
      <div><div class="lbl">Fråga</div><div class="q">${esc(c.q)}</div></div>
      <div><div class="lbl">Svar</div><div class="a">${esc(c.a)}</div></div>
      ${c.why ? `<div><div class="lbl">Varför</div><div>${esc(c.why)}</div></div>` : ''}
      ${c.ex ? `<div><div class="lbl">Exempel</div><div>${esc(c.ex)}</div></div>` : ''}
    </div>
    <button class="btn primary" id="gotit">Jag har läst · testa mig</button>` + after(() => { document.getElementById('gotit').onclick = () => { sess.fphase = 'check'; sess.cq = pickQuestion(c.id); sess.tries = 0; render(); }; });
  }
  const q = sess.cq;
  if (!q) { rec(c.id, true); sess.fi++; sess.fphase = 'learn'; return stepLearn(); }
  return `<div class="muted">Kontrollfråga på kortet du just läste.</div>` + quizView(q, ok => {
    sess.total++; if (ok) { sess.score++; rec(c.id, true); sess.fi++; sess.fphase = 'learn'; if (sess.fi >= sess.fresh.length) sess.step = 2; }
    else { rec(c.id, false); sess.tries++; sess.cq = sess.tries < 2 ? (pickQuestion(c.id, [q.id]) || q) : q; if (sess.tries >= 2) sess.fphase = 'learn'; }
    render();
  }, ok => ok ? 'Nästa' : (sess.tries < 2 ? 'Försök igen' : 'Läs kortet igen'));
}
function stepMix() {
  const q = sess.mixQ[sess.mi]; if (!q) { sess.step = 3; return stepBoss(); }
  return `<div class="muted">Blandat · ${sess.mi + 1} av ${sess.mixQ.length}</div>` + quizView(q, ok => { sess.total++; if (ok) sess.score++; rec(q.c, ok); sess.mi++; if (sess.mi >= sess.mixQ.length) sess.step = 3; render(); });
}
function stepBoss() {
  const b = sess.boss; if (!b) { sess.step = 4; logSession('pass'); sess.logged = true; return stepDone(); }
  return bossView(b, pts => { cs(b.c).bossAt = Date.now(); rec(b.c, pts >= 2); sess.total++; if (pts >= 2) sess.score++; sess.step = 4; sess.logged = true; logSession('pass'); render(); });
}
function stepDone() {
  const g = greens(); const pct = sess.total ? Math.round(sess.score / sess.total * 100) : 0;
  const newGreen = CARDS.filter(c => mastery(c.id) === 3 && S.cards[c.id].d[2] === today()).length;
  return `<div class="card stack" style="text-align:center;gap:10px">
    <div class="eyebrow">Pass klart</div><div class="big num">${pct}%</div>
    <div>${sess.score} av ${sess.total} rätt på ${Math.max(1, Math.round((Date.now() - sess.start) / 60000))} min</div><hr>
    <div><b>${g}/${CARDS.length}</b> kort gröna${newGreen ? ` · <span style="color:var(--good)">+${newGreen} idag</span>` : ''}</div>
    <div class="muted">${pct >= 80 ? 'Stabilt. Kom tillbaka imorgon, då räknas det igen.' : pct >= 60 ? 'Bra jobbat. De röda korten kommer tillbaka i nästa pass.' : 'Tufft pass, men varje fel du fick se facit på sitter bättre nu. Kör igen imorgon.'}</div>
  </div><button class="btn primary" id="done">Klar</button>` + after(() => { document.getElementById('done').onclick = () => { sess = null; go('home'); }; });
}

// ---------- KOMPONENTER ----------
function flashCard(c, onGrade) {
  const uid = 'f' + Math.random().toString(36).slice(2, 7);
  return `<div class="flash" id="${uid}" role="button" tabindex="0"><span class="pill ${c.lvl}">${c.lvl === 'G' ? 'Grund' : 'Högre'} · ${esc(c.t)}</span><div class="q">${esc(c.q)}</div><div class="a muted" id="${uid}a" hidden>${esc(c.a)}</div><div class="muted" id="${uid}h" style="font-size:.9rem">Tryck för att vända</div></div>
  <div class="grid2" id="${uid}g" hidden><button class="btn bad" id="${uid}n">Fel / osäker</button><button class="btn good" id="${uid}y">Rätt</button></div>` + after(() => {
    const el = document.getElementById(uid); if (!el) return;
    const flip = () => { document.getElementById(uid + 'a').hidden = false; document.getElementById(uid + 'h').hidden = true; document.getElementById(uid + 'g').hidden = false; };
    el.onclick = flip; el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') flip(); };
    document.getElementById(uid + 'y').onclick = () => onGrade(true);
    document.getElementById(uid + 'n').onclick = () => onGrade(false);
  });
}
function norm(s) { return String(s).toLowerCase().replace(/\s+/g, '').replace(/[.;:!?]/g, '').replace(/−/g, '-'); }
function checkTxt(q, val) { const v = norm(val); if (!v) return false; return q.acc.some(a => { const n = norm(a); return v === n || (n.length >= 3 && v.includes(n)); }); }
function quizView(q, onDone, nextLabel) {
  const uid = 'z' + Math.random().toString(36).slice(2, 7);
  let html = `<div class="card stack" style="gap:14px"><div><span class="pill ${q.lvl}">${q.lvl === 'G' ? 'Grund' : 'Högre'}</span></div><div class="q">${esc(q.q)}</div>`;
  if (q.type === 'mc') html += `<div class="opts" id="${uid}o">${q.opts.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join('')}</div>`;
  else html += `<form id="${uid}f" class="stack" style="gap:10px"><input type="text" id="${uid}i" autocomplete="off" autocapitalize="off" placeholder="Skriv ditt svar"><button class="btn primary" type="submit" style="font-size:1.2rem;padding:14px">Svara</button></form>`;
  html += `<div id="${uid}fb"></div></div>`;
  return html + after(() => {
    const fb = document.getElementById(uid + 'fb');
    const finish = ok => { fb.innerHTML = `<div class="fb ${ok ? 'ok' : 'no'}"><b>${ok ? 'Rätt!' : 'Inte riktigt.'}</b>${esc(q.exp)}</div><button class="btn ${ok ? 'good' : ''}" id="${uid}n" style="margin-top:10px">${nextLabel ? nextLabel(ok) : 'Nästa'}</button>`; const b = document.getElementById(uid + 'n'); b.onclick = () => onDone(ok); b.focus(); };
    if (q.type === 'mc') {
      document.querySelectorAll(`#${uid}o .opt`).forEach(b => b.onclick = () => { const i = +b.dataset.i, ok = i === q.ans; document.querySelectorAll(`#${uid}o .opt`).forEach(x => { x.disabled = true; if (+x.dataset.i === q.ans) x.classList.add('right'); }); if (!ok) b.classList.add('wrong'); finish(ok); });
    } else {
      const f = document.getElementById(uid + 'f'), inp = document.getElementById(uid + 'i'); inp.focus();
      f.onsubmit = e => { e.preventDefault(); const ok = checkTxt(q, inp.value); inp.disabled = true; f.querySelector('button').disabled = true; finish(ok); };
    }
  });
}
function bossView(b, onDone) {
  const uid = 'b' + Math.random().toString(36).slice(2, 7);
  return `<div class="card stack" style="gap:14px">
    <div class="row" style="justify-content:space-between"><span class="eyebrow">Boss · rita på papper</span><span class="pill ${b.lvl}">${b.lvl === 'G' ? 'Grund' : 'Högre'}</span></div>
    <div class="q">${esc(b.q)}</div>
    <div class="muted">Gör uppgiften på papper först. Tryck sen på facit och bocka av det du fick med.</div>
    <button class="btn" id="${uid}s">Visa facit</button>
    <div id="${uid}f" hidden class="stack" style="gap:10px">
      <div class="fb ok"><b>Facit</b>${esc(b.facit)}</div><div class="muted">Vad fick du med?</div>
      ${b.check.map((c, i) => `<button class="check" data-i="${i}"><span class="box"></span><span>${esc(c)}</span></button>`).join('')}
      <button class="btn primary" id="${uid}d" style="font-size:1.2rem">Klar · <span id="${uid}p">0</span>/${b.check.length}</button>
    </div></div>` + after(() => {
      document.getElementById(uid + 's').onclick = () => { document.getElementById(uid + 'f').hidden = false; document.getElementById(uid + 's').hidden = true; };
      let pts = 0;
      document.querySelectorAll(`#${uid}f .check`).forEach(c => c.onclick = () => { c.classList.toggle('on'); c.querySelector('.box').textContent = c.classList.contains('on') ? '✓' : ''; pts = document.querySelectorAll(`#${uid}f .check.on`).length; document.getElementById(uid + 'p').textContent = pts; });
      document.getElementById(uid + 'd').onclick = () => onDone(pts);
    });
}

// ---------- FLASHCARDS ----------
let fl = { filter: 'weak', deck: [], i: 0, ok: 0 };
function buildDeck() { let d = CARDS; if (fl.filter === 'weak') d = CARDS.filter(c => mastery(c.id) < 3).sort((a, b) => priority(a.id) - priority(b.id)); else if (fl.filter !== 'all') d = CARDS.filter(c => c.lvl === fl.filter); fl.deck = fl.filter === 'weak' ? d.slice(0, 12) : shuffle(d); fl.i = 0; fl.ok = 0; }
function flash() {
  if (!view.init) { view.init = true; buildDeck(); }
  const c = fl.deck[fl.i];
  const filt = `<div class="row">${[['weak', 'Svaga'], ['all', 'Alla'], ['G', 'Grund'], ['H', 'Högre']].map(([k, l]) => `<button class="btn small ${fl.filter === k ? 'primary' : ''}" data-f="${k}">${l}</button>`).join('')}</div>`;
  const body = c ? `<div class="muted num">${fl.i + 1} av ${fl.deck.length} · ${fl.ok} rätt</div>` + flashCard(c, ok => { rec(c.id, ok); if (ok) fl.ok++; fl.i++; render(); })
    : `<div class="card" style="text-align:center"><div class="big num">${fl.ok}/${fl.deck.length}</div><div class="muted">${fl.deck.length ? 'Klart! Kör igen eller byt filter.' : 'Inga kort i det här filtret. Alla svaga är gröna, bra!'}</div><button class="btn primary" id="again" style="margin-top:12px">Kör igen</button></div>`;
  return `<div class="stack">${topbar('Flashcards')}${filt}${body}</div>` + after(() => {
    document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { fl.filter = b.dataset.f; buildDeck(); render(); });
    const a = document.getElementById('again'); if (a) a.onclick = () => { buildDeck(); render(); };
  });
}

// ---------- SNABBQUIZ ----------
let qz = null;
function quiz() {
  if (!qz) { const ids = CARDS.map(c => c.id).sort((a, b) => priority(a) - priority(b)); const qs = []; const used = new Set(); for (let i = 0; qs.length < 10 && i < 60; i++) { const q = pickQuestion(ids[i % ids.length], [...used]); if (q && !used.has(q.id)) { used.add(q.id); qs.push(q); } } qz = { qs: shuffle(qs), i: 0, ok: 0, start: Date.now() }; }
  const q = qz.qs[qz.i];
  if (!q) {
    const pct = Math.round(qz.ok / qz.qs.length * 100);
    if (!qz.logged) { qz.logged = true; logSession('quiz', { score: qz.ok, max: qz.qs.length, mins: Math.round((Date.now() - qz.start) / 60000) }); }
    return `<div class="stack">${topbar('Snabbquiz')}<div class="card" style="text-align:center"><div class="big num">${pct}%</div><div>${qz.ok} av ${qz.qs.length} rätt</div></div><button class="btn primary" id="again">Ny omgång</button><button class="btn" data-go="home">Hem</button></div>` + after(() => { document.getElementById('again').onclick = () => { qz = null; render(); }; });
  }
  return `<div class="stack">${topbar('Snabbquiz', `<span class="muted num">${qz.i + 1}/${qz.qs.length}</span>`)}<div class="bar"><i style="width:${qz.i / qz.qs.length * 100}%"></i></div>` + quizView(q, ok => { rec(q.c, ok); if (ok) qz.ok++; qz.i++; render(); }) + `</div>`;
}

// ---------- ÖVNINGSPROV ----------
let tst = null;
function test() {
  const tests = S.sessions.filter(s => s.type === 'test');
  if (!tst) {
    return `<div class="stack">${topbar('Övningsprov')}
      <div class="card stack" style="gap:10px"><h2>Som på riktigt</h2>
      <p>Del 1: ${TEST.part1.length} grundfrågor. Del 2: ${TEST.part2.length} högre-frågor. Sen ${TEST.open.length} rita/förklara-uppgifter som du skriver här (eller på papper) och som en vuxen rättar.</p>
      <p class="muted">Inget facit förrän du är klar. Räkna med 25–30 minuter. Lägg undan allt annat.</p>
      ${tests.length ? `<p class="muted">Tidigare försök: ${tests.map(t => testScore(t).pct + '%').join(' · ')}</p>` : ''}</div>
      <button class="btn primary" id="begin">Starta provet</button></div>` + after(() => { document.getElementById('begin').onclick = () => { const qs = [...TEST.part1, ...TEST.part2].map(id => byId(QUIZ, id)).filter(Boolean); tst = { qs, i: 0, answers: {}, open: {}, start: Date.now(), phase: 'q' }; render(); }; });
  }
  if (tst.phase === 'q') {
    const q = tst.qs[tst.i];
    if (!q) { tst.phase = 'open'; tst.oi = 0; return test(); }
    const part = tst.i < TEST.part1.length ? 'Del 1 · Grund' : 'Del 2 · Högre'; const uid = 't' + tst.i;
    return `<div class="stack">${topbar('Övningsprov', `<span class="muted num">${tst.i + 1}/${tst.qs.length}</span>`)}<div class="bar"><i style="width:${tst.i / (tst.qs.length + TEST.open.length) * 100}%"></i></div>
      <div class="card stack" style="gap:14px"><div class="eyebrow">${part}</div><div class="q">${esc(q.q)}</div>
      ${q.type === 'mc' ? `<div class="opts">${q.opts.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join('')}</div>` : `<form id="${uid}f" class="stack" style="gap:10px"><input type="text" id="${uid}i" autocomplete="off" autocapitalize="off" placeholder="Skriv ditt svar"><button class="btn primary" type="submit" style="font-size:1.2rem;padding:14px">Nästa</button></form>`}
      </div></div>` + after(() => {
        if (q.type === 'mc') document.querySelectorAll('.opt').forEach(b => b.onclick = () => { tst.answers[q.id] = (+b.dataset.i === q.ans); tst.i++; render(); });
        else { const f = document.getElementById(uid + 'f'); document.getElementById(uid + 'i').focus(); f.onsubmit = e => { e.preventDefault(); tst.answers[q.id] = checkTxt(q, document.getElementById(uid + 'i').value); tst.i++; render(); }; }
      });
  }
  if (tst.phase === 'open') {
    const o = TEST.open[tst.oi];
    if (!o) {
      tst.phase = 'saving';
      const auto = Object.values(tst.answers).filter(Boolean).length;
      logSession('test', { score: auto, max: Object.keys(tst.answers).length, mins: Math.round((Date.now() - tst.start) / 60000), detail: { answers: tst.answers, open: tst.open } }).then(() => { tst.phase = 'done'; render(); });
      return `<div class="stack">${topbar('Övningsprov')}<div class="boot">Sparar…</div></div>`;
    }
    return `<div class="stack">${topbar('Övningsprov', `<span class="muted num">Rita ${tst.oi + 1}/${TEST.open.length}</span>`)}<div class="bar"><i style="width:${(tst.qs.length + tst.oi) / (tst.qs.length + TEST.open.length) * 100}%"></i></div>
      <div class="card stack" style="gap:14px"><div class="eyebrow">Del 3 · Rita och förklara (3 p)</div><div class="q">${esc(o.q)}</div>
      <p class="muted">Rita på papper. Skriv din förklaring här så den sparas till rättningen.</p>
      <textarea id="oa" placeholder="Min förklaring…"></textarea>
      <button class="btn primary" id="on" style="font-size:1.2rem;padding:14px">${tst.oi < TEST.open.length - 1 ? 'Nästa uppgift' : 'Lämna in provet'}</button></div></div>` + after(() => { document.getElementById('oa').focus(); document.getElementById('on').onclick = () => { tst.open[o.id] = { text: document.getElementById('oa').value }; tst.oi++; render(); }; });
  }
  if (tst.phase === 'saving') return `<div class="stack">${topbar('Övningsprov')}<div class="boot">Sparar…</div></div>`;
  const t = S.sessions.filter(s => s.type === 'test').slice(-1)[0]; const sc = testScore(t);
  const wrong = tst.qs.filter(q => !tst.answers[q.id]);
  return `<div class="stack">${topbar('Övningsprov')}
    <div class="card" style="text-align:center"><div class="eyebrow">Inlämnat</div><div class="big num">${sc.auto}<span class="muted" style="font-size:1.6rem">/${sc.autoMax}</span></div><div class="muted">rätt på del 1 + 2 · rita-uppgifterna rättas i Coach-vyn</div></div>
    ${wrong.length ? `<div class="card stack" style="gap:10px"><h3>Det här ska du nöta</h3>${wrong.map(q => `<div class="fb no"><b style="font-size:1rem">${esc(q.q)}</b>${esc(q.exp)}</div>`).join('')}</div>` : `<div class="fb ok"><b>Allt rätt på del 1 och 2.</b> Nu är det bara rita-uppgifterna kvar.</div>`}
    <button class="btn primary" id="fin">Klar</button></div>` + after(() => { document.getElementById('fin').onclick = () => { wrong.forEach(q => rec(q.c, false)); tst.qs.filter(q => tst.answers[q.id]).forEach(q => rec(q.c, true)); tst = null; go('home'); }; });
}

// ---------- KUNSKAPSKARTAN ----------
function map() {
  const topics = [...new Set(CARDS.map(c => c.t))];
  return `<div class="stack">${topbar('Kunskapskartan')}
    <p class="muted">Alla ${CARDS.length} kort. Tryck på ett för att se svaret. Färgen visar hur många olika dagar du svarat rätt.</p>
    ${topics.map(t => `<h3>${esc(t)}</h3><div class="toplist">${CARDS.filter(c => c.t === t).map(c => { const st = S.cards[c.id]; return `<button class="mapitem"><span class="dot m${mastery(c.id)}"></span><div class="body"><div style="font-weight:600">${esc(c.q)}</div><div class="muted" style="font-size:.85rem">${c.lvl === 'G' ? 'Grund' : 'Högre'}${st ? ` · ${st.c} rätt, ${st.w} fel` : ''}</div><div class="ans" hidden><div>${esc(c.a)}</div>${c.why ? `<div style="margin-top:6px"><i>Varför:</i> ${esc(c.why)}</div>` : ''}${c.ex ? `<div style="margin-top:4px"><i>Ex:</i> ${esc(c.ex)}</div>` : ''}</div></div></button>`; }).join('')}</div>`).join('')}
  </div>` + after(() => { document.querySelectorAll('.mapitem').forEach(b => b.onclick = () => { const a = b.querySelector('.ans'); a.hidden = !a.hidden; }); });
}

// ---------- COACH (förälder) ----------
function coach() {
  const members = MEMBERS;
  const students = members.filter(m => m.role === 'student');
  const days = PLAN.map(p => { const ss = S.sessions.filter(s => s.d === p.date); const ok = ss.reduce((a, s) => a + s.score, 0), mx = ss.reduce((a, s) => a + s.max, 0); return { p, ss, ok, mx }; });
  const weak = CARDS.filter(c => S.cards[c.id] && S.cards[c.id].weak).slice(0, 8);
  const tests = S.sessions.filter(s => s.type === 'test').map((t, i) => ({ t, i, sc: testScore(t) }));
  return `<div class="stack">${topbar('Coach')}
    ${students.length > 1 ? `<div class="row">${students.map(s => `<button class="btn small ${s.id === student ? 'primary' : ''}" data-st="${s.id}">${esc(s.display_name)}</button>`).join('')}</div>` : ''}
    ${!students.length ? `<div class="fb no"><b>Ingen elev ännu</b>Be eleven skapa konto och gå med i familjen med koden under Inställningar.</div>` : ''}
    ${MOD ? '' : '<div class="fb no"><b>Inget prov med material</b>Lägg in material så visas progress här.</div>'}
    <div class="card"><h3>${esc(studentName())} · ${esc(MOD ? MOD.title : '')}</h3><div class="row" style="gap:20px;margin-top:8px"><div><div class="big num" style="font-size:2.4rem">${greens()}/${CARDS.length}</div><div class="muted">gröna kort</div></div><div><div class="big num" style="font-size:2.4rem">${S.sessions.filter(s => s.type.startsWith('pass')).length}</div><div class="muted">pass gjorda</div></div><div><div class="big num" style="font-size:2.4rem">${streak()}</div><div class="muted">dagar i rad</div></div></div>
      <div class="dots" style="margin-top:12px">${CARDS.map(c => `<span class="dot sm m${mastery(c.id)}" title="${esc(c.q)}"></span>`).join('')}</div></div>
    ${PLAN.length ? `<div class="card"><h3>Per dag</h3><div class="plan" style="margin-top:8px">${days.map(d => `<div class="day"><div class="dl">${esc(d.p.label)}</div><div class="num">${d.ss.length ? `${d.ss.length} aktiviteter · ${d.ok}/${d.mx} rätt (${Math.round(d.ok / Math.max(1, d.mx) * 100)}%) · ${d.ss.reduce((a, s) => a + (s.mins || 0), 0)} min` : `<span class="muted">inget ännu</span>`}</div></div>`).join('')}</div></div>` : ''}
    ${weak.length ? `<div class="card"><h3>Svagast just nu</h3><div class="stack" style="gap:6px;margin-top:8px">${weak.map(c => `<div><span class="dot sm m${mastery(c.id)}" style="display:inline-block;vertical-align:middle;margin-right:8px"></span>${esc(c.q)} <span class="muted num">(${S.cards[c.id].c}/${S.cards[c.id].c + S.cards[c.id].w})</span></div>`).join('')}</div><p class="muted" style="margin-top:10px">Fråga muntligt om de här vid middagen. Att förklara högt för någon annan är den bästa kontrollen.</p></div>` : ''}
    <div class="card"><h3>Övningsprov</h3>
      ${tests.length ? `<div class="hist">${tests.map(x => `<div class="col"><i style="height:${Math.max(3, x.sc.pct)}%"></i><span>${x.sc.pct}%</span></div>`).join('')}</div>` : `<p class="muted" style="margin-top:8px">Inget prov skrivet ännu.</p>`}
      ${tests.map(x => `<hr><div class="row" style="justify-content:space-between"><b>Prov ${x.i + 1} · ${fmtDate(x.t.d)}</b><span class="num">${x.sc.pts}/${x.sc.max} p${x.sc.pending ? ' · <span style="color:var(--mid)">rätta</span>' : ''}</span></div>
        <div class="muted num">Del 1+2: ${x.sc.auto}/${x.sc.autoMax} automatiskt rättat</div>
        ${TEST.open.map(o => { const r = ((x.t.detail || {}).open || {})[o.id] || {}; const graded = typeof r.pts === 'number'; return `<div style="margin-top:10px"><div style="font-weight:600">${esc(o.q)}</div><div class="muted" style="white-space:pre-wrap;margin:4px 0">${r.text ? esc(r.text) : '<i>(inget skrivet, titta på pappret)</i>'}</div>
          <div class="rub">${o.rub.map((rb, k) => `<button class="check ${graded && r.marks && r.marks[k] ? 'on' : ''}" data-t="${x.i}" data-o="${o.id}" data-k="${k}"><span class="box">${graded && r.marks && r.marks[k] ? '✓' : ''}</span><span>${esc(rb)}</span></button>`).join('')}</div>
          <div class="muted num" style="margin-top:4px">${graded ? `${r.pts}/3 p` : 'Bocka av för att rätta'}</div></div>`; }).join('')}`).join('')}
    </div>
    <div class="card"><h3>Provschema</h3><p class="muted" style="margin:6px 0 10px">Prov utan material behöver fyllas på i tid. Skicka "inför provet"-dokumentet till Claude så läggs det in.</p>${scheduleList(true)}</div>
    <div class="card"><h3>Så funkar det</h3><p class="muted" style="margin-top:6px">Ett kort blir grönt när eleven svarat rätt på det <b>tre olika dagar</b>. Att läsa räknas inte. Rött = fel senast. Passet väljer själv de svagaste korten. Vyn uppdateras live när eleven pluggar.</p></div>
  </div>` + after(() => {
    document.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => { student = b.dataset.st; S = await db.loadProgress(student, MOD.id); render(); });
    document.querySelectorAll('.rub .check').forEach(b => b.onclick = async () => {
      const t = S.sessions.filter(s => s.type === 'test')[+b.dataset.t]; const det = t.detail || (t.detail = { answers: {}, open: {} }); det.open = det.open || {};
      const r = det.open[b.dataset.o] || (det.open[b.dataset.o] = { text: '' }); r.marks = r.marks || [false, false, false]; r.marks[+b.dataset.k] = !r.marks[+b.dataset.k]; r.pts = r.marks.filter(Boolean).length;
      if (t.id) await db.updateSessionDetail(t.id, det); render();
    });
  });
}

// ---------- INSTÄLLNINGAR ----------
function settings() {
  const bot = import.meta.env.VITE_TELEGRAM_BOT;
  return `<div class="stack">${topbar('Inställningar')}
    <div class="card stack" style="gap:8px"><h3>Konto</h3><div><b>${esc(me.display_name || '')}</b> · ${me.role === 'parent' ? 'förälder' : 'elev'}</div><div class="muted">${esc(me.email)}</div></div>
    ${me.role === 'parent' ? `<div class="card stack" style="gap:8px"><h3>Familjekod</h3><div class="code" id="fcode">…</div><p class="muted">Eleven skapar konto i appen, väljer Elev och skriver in koden.</p></div>` : ''}
    <div class="card stack" style="gap:8px"><h3>Påminnelser via Telegram</h3>
      ${me.telegram_chat_id ? `<div class="fb ok"><b>Kopplat</b>Du får en påminnelse kl 17 de dagar du inte gjort något pass.</div>` : bot ? `<p class="muted">Installera Telegram, tryck på knappen och sedan Start i chatten. Klart.</p><a class="btn" href="https://t.me/${esc(bot)}?start=${esc(me.id)}" target="_blank" rel="noopener">Koppla Telegram</a>` : `<p class="muted">Inte konfigurerat ännu.</p>`}
    </div>
    <div class="card stack" style="gap:8px"><h3>Lägg till på hemskärmen</h3><p class="muted">iPhone: Dela-knappen i Safari → "Lägg till på hemskärmen". Då funkar appen i fullskärm.</p></div>
    <button class="btn" id="lo">Logga ut</button>
  </div>` + after(async () => {
    document.getElementById('lo').onclick = logout;
    const fc = document.getElementById('fcode'); if (fc) fc.textContent = (await db.familyCode()) || '–';
  });
}

// ============ BOOT ============
async function boot() {
  if (unsub) { unsub(); unsub = null; }
  const session = await db.getSession();
  if (!session) { me = null; go('auth'); return; }
  me = await db.getProfile();
  if (!me || !me.family_id) { go('onboard', { mode: 'join' }); return; }
  MODS = await db.listModules();
  MEMBERS = await db.familyMembers(); const members = MEMBERS;
  student = me.role === 'student' ? me.id : (members.find(m => m.role === 'student') || {}).id || me.id;
  let want = null; try { want = localStorage.getItem('mod'); } catch (e) {}
  const withC = MODS.filter(m => m.has_content); const t0 = today();
  const first = withC.find(m => m.id === want) || withC.find(m => m.exam_date >= t0) || withC[withC.length - 1];
  if (first) { setModule(await db.loadModule(first.id)); S = await db.loadProgress(student, MOD.id); } else { MOD = null; S = { cards: {}, sessions: [] }; }
  if (me.role === 'parent') { let t = null; unsub = db.subscribeFamily(() => { clearTimeout(t); t = setTimeout(async () => { if (!MOD) return; S = await db.loadProgress(student, MOD.id); if (!sess) render(); }, 600); }); }
  go(me.role === "parent" ? "coach" : "home");
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { me = null; go('auth'); } });
boot();
