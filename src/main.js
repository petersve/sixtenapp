import * as db from './db.js';
import { buildItems, evaluate, weekReport, counts, monthBonus, lectureWeekAmount, BONUS, LECTURE_MIN_SEC, LECTURE_REVIEW_DAYS, PASS_MIN, PREP_MIN, JOKERS_PER_MONTH, RESCUE_DAYS, isoWeek, weekStart } from './plan.js';
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
let ALLSESS = [];              // alla sessions för eleven, alla moduler
let LECTURES = [], REVIEWS = [];
const TAB_OF = { lecquiz: 'lectures', today: 'today', home: 'exams', exams: 'exams', flash: 'exams', quiz: 'exams', test: 'exams', map: 'exams', result: 'exams', goals: 'exams', lectures: 'lectures', bonus: 'bonus', coach: 'coach', settings: 'coach' };
const IMMERSIVE = ['auth', 'onboard', 'session', 'paper'];
let GOALS = [];                // betygsmål för eleven som visas
let RESULTS = [];              // utfall per prov
let SNOOZES = [];              // uppskjutna betygsfrågor (provet inte tillbaka än)
const GRADE_ORD = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
function resultFor(m) { return RESULTS.find(r => r.module_id === m.id) || null; }
function resultPill(m) { const r = resultFor(m); if (!r) return ''; const g = goalFor(m); const cls = !g ? '' : GRADE_ORD[r.grade] >= GRADE_ORD[g.goal] ? 'G' : 'H'; return `<span class="pill ${cls}" style="${cls === 'H' ? 'color:var(--bad)' : ''}">Fick ${r.grade}</span>`; }
const SUBJECTS = ['Engelska','Svenska','Matematik','Moderna språk','Biologi','Fysik','Kemi','Teknik','Historia','Samhällskunskap','Geografi','Religion','Bild','Musik','Slöjd','Hemkunskap','Idrott och hälsa'];
const GPTS = { A: 20, B: 17.5, C: 15, D: 12.5, E: 10 };
function goalFor(m) { if (!m || !m.goal_subject) return null; return GOALS.find(g => g.subject === m.goal_subject) || null; }
function goalPill(m) { const g = goalFor(m); return g ? `<span class="pill" style="color:var(--accent)">Mål ${g.goal}</span>` : ''; }

const byId = (arr, id) => arr.find(x => x.id === id);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = d => { const [y, m, dd] = d.split('-'); return `${+dd}/${+m}`; };
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2500); }

let PAPER = null;              // pappersdiagnos: {intro, parts:[{id,title,mins,calc,items:[{id,q}]}]}
function setModule(m) { MOD = m; const c = m.content || {}; CARDS = c.cards || []; QUIZ = c.quiz || []; BOSS = c.boss || []; TEST = c.test || null; PLAN = c.plan || []; PAPER = c.paper || null; try { localStorage.setItem('mod', m.id); } catch (e) {} }

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
  if (sess && type.startsWith('pass')) { s.detail = { ...(s.detail || {}), auto: { ...sess.auto } }; s.detail.counted = counts({ ...s, type: 'pass' }); }
  S.sessions.push(s); ALLSESS.push({ module_id: MOD.id, type: s.type, d: s.d, score: s.score, max: s.max, mins: s.mins, detail: s.detail });
  if (isStudent()) s.id = await db.insertSession(me.id, MOD.id, s).catch(() => null);
  return s;
}

// ============ RENDER ============
const app = document.getElementById('app');
function go(name, extra = {}) { view = { name, ...extra }; window.scrollTo(0, 0); render(); }
function after(f) { const prev = window._after; window._after = () => { if (prev) prev(); f(); }; return ''; }
function render() {
  const r = { auth, onboard, home, session, flash, quiz, test, map, coach, settings, goals, result, paper, today: todayView, exams, lectures, bonus, lecquiz }[view.name] || todayView;
  app.innerHTML = r() + (IMMERSIVE.includes(view.name) || !me ? '' : tabbar());
  app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  app.querySelectorAll('[data-mod]').forEach(b => b.onclick = () => switchModule(b.dataset.mod));
  app.querySelectorAll('[data-res]').forEach(b => b.onclick = () => go('result', { mod: b.dataset.res, from: view.name }));
  if (window._after) { const f = window._after; window._after = null; f(); }
}
function tabbar() {
  const cur = TAB_OF[view.name] || 'today';
  const tabs = [['today', 'Idag', '◉'], ['exams', 'Prov', '▤'], ['lectures', 'Lektioner', '♪'], ['bonus', 'Bonus', '★']];
  if (me.role === 'parent') tabs.push(['coach', 'Coach', '◎']);
  return `<nav class="tabbar">${tabs.map(([k, l, i]) => `<button class="${cur === k ? 'on' : ''}" data-go="${k}"><span class="ico">${i}</span>${l}</button>`).join('')}</nav>`;
}
function topbar(title, right = '') { return `<div class="topbar"><button class="back" data-go="${TAB_OF[view.name] === 'exams' && view.name !== 'home' ? 'home' : 'today'}">Tillbaka</button><div class="eyebrow">${esc(title)}</div><div>${right}</div></div>`; }

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
function testScore(t) { if (!TEST) return { pts: 0, max: 0, pct: 0, auto: 0, autoMax: 0, open: 0, pending: !(t.detail && t.detail.paper) }; const det = t.detail || {}; const answers = det.answers || {}; const auto = Object.values(answers).filter(Boolean).length, autoMax = Object.keys(answers).length; let open = 0, pending = false; (TEST.open || []).forEach(o => { const r = (det.open || {})[o.id]; if (r && typeof r.pts === 'number') open += r.pts; else pending = true; }); const max = autoMax + TEST.open.length * 3; const pts = auto + open; return { pts, max, pct: Math.round(pts / max * 100), auto, autoMax, open, pending }; }
const KIND = { prov: 'Prov', inlämning: 'Inlämning', redovisning: 'Redovisning', muntligt: 'Muntligt', np: 'Nationellt prov', diagnos: 'Diagnos', träning: 'Träning' };
const daysTo = d => Math.round((Date.parse(d) - Date.parse(today())) / 86400e3);
const daysLabel = n => n < 0 ? 'klar' : n === 0 ? 'idag' : n === 1 ? 'imorgon' : `om ${n} dagar`;
function scheduleList(forParent) {
  const t = today();
  const up = MODS.filter(m => m.exam_date && m.exam_date >= t);
  const past = MODS.filter(m => !m.exam_date || m.exam_date < t).reverse();
  const row = m => { const n = m.exam_date ? daysTo(m.exam_date) : null; const cur = MOD && m.id === MOD.id; const isPast = m.exam_date && m.exam_date < t;
    const tag = isPast ? (resultFor(m) ? resultPill(m) : `<span class="pill" style="color:var(--mid)">Ange betyg</span>`) : m.has_content ? `<span class="pill G">Material</span>` : `<span class="pill">${forParent ? 'Saknar material' : 'Inget material än'}</span>`;
    return `<button class="mod ${cur ? 'cur' : ''}" ${isPast ? `data-res="${m.id}"` : `data-mod="${m.id}"`} ${isPast || m.has_content ? '' : 'disabled'}><span style="min-width:0"><b>${esc(m.subject)}: ${esc(m.title)}</b><br><span class="muted">${KIND[m.kind] || esc(m.kind)}${m.exam_date ? ' · ' + fmtDate(m.exam_date) + ' · ' + daysLabel(n) : ''}${m.note ? ' · ' + esc(m.note) : ''}</span></span><span class="row" style="gap:6px;flex:none">${goalPill(m)}${tag}</span></button>`; };
  return `<div class="modlist">${up.length ? up.map(row).join('') : '<p class="muted">Inga kommande prov inlagda.</p>'}</div>${past.length ? `<details style="margin-top:10px" ${past.some(m => !resultFor(m)) ? 'open' : ''}><summary class="muted">Genomförda (${past.length}) · ${past.filter(resultFor).length} med betyg</summary><div class="modlist" style="margin-top:8px">${past.map(row).join('')}</div></details>` : ''}`;
}
function home() {
  const t = today();
  const who = me.role === 'parent' && MOD ? `<div class="fb ok" style="margin-bottom:4px"><b style="font-size:1rem">Du tittar som förälder</b>Det här är ${esc(studentName())}s vy. Passen räknas inte för dig. Gå till Coach för rättning och översikt.</div>` : '';
  const header = `<div class="topbar" style="padding-bottom:4px"><button class="back" data-go="exams">Prov</button><div class="eyebrow">${MOD ? esc(MOD.subject) : ''}</div><button class="btn small" data-go="settings" aria-label="Inställningar">⚙︎</button></div>`;
  const schedule = `<div class="card"><h3 style="margin-bottom:10px">Kommande prov</h3>${scheduleList(me.role === 'parent')}</div>`;
  const footer = '';
  if (!MOD) return `<div class="stack">${header}<p class="muted">När ett prov får material dyker det upp här som din to-do.</p>${schedule}${footer}</div>` + after(() => {});
  if (PAPER && !CARDS.length) {
    const done = S.sessions.filter(x => x.type === 'test').length; const dl = MOD.exam_date ? daysTo(MOD.exam_date) : null;
    return `<div class="stack">${header}${who}
      <div class="card stack" style="gap:10px"><div class="eyebrow">${esc(MOD.subject)} · ${KIND[MOD.kind] || esc(MOD.kind)}${MOD.exam_date ? ' · ' + fmtDate(MOD.exam_date) + (dl !== null ? ' · ' + daysLabel(dl) : '') : ''}</div><h2>${esc(MOD.title)}</h2>${goalFor(MOD) ? `<div class="muted">Betygsmål ${esc(MOD.goal_subject)}: <b style="color:var(--accent)">${goalFor(MOD).goal}</b></div>` : ''}
      <p>${esc(PAPER.intro || '')}</p>
      <div class="stack" style="gap:6px">${PAPER.parts.map(pt => `<div class="check"><span class="box"></span><span><b>Del ${esc(pt.id)} · ${pt.mins} min</b> · ${pt.calc ? 'räknare tillåten' : 'utan räknare'} · ${pt.items.length} uppgifter</span></div>`).join('')}</div>
      ${done ? `<div class="fb ok"><b>Inlämnad</b>Du har gjort den ${done} gång${done === 1 ? '' : 'er'}. Analysen kommer från dina föräldrar.</div>` : ''}</div>
      <button class="btn primary" data-go="paper">${done ? 'Visa uppgifterna igen' : 'Starta diagnosen'}</button>
      ${schedule}${footer}</div>`;
  }
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
      <div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="eyebrow">${esc(MOD.subject)} · ${MOD.exam_date ? fmtDate(MOD.exam_date) : ''}${dl !== null ? ' · ' + daysLabel(dl) : ''}</div><h2>${esc(MOD.title)}</h2>${goalFor(MOD) ? `<div class="muted" style="margin-top:4px">Betygsmål ${esc(MOD.goal_subject)}: <b style="color:var(--accent)">${goalFor(MOD).goal}</b> (${goalFor(MOD).points} p)</div>` : ''}</div><div class="streak" title="${st} dagar i rad">${[0, 1, 2, 3, 4].map(i => `<i class="${i < st ? 'on' : ''}"></i>`).join('')}</div></div>
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
async function refreshAll() { ALLSESS = await db.loadAllSessions(student); RESULTS = await db.loadResults(student); SNOOZES = await db.loadSnoozes(student); }

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
  sess = { start: Date.now(), step: warm.length >= 2 ? 0 : 1, warm, wi: 0, fresh, fi: 0, fphase: 'learn', mixQ: shuffle(mixQ), mi: 0, boss, score: 0, total: 0, auto: { score: 0, total: 0 }, learnMode, logged: false };
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
    sess.total++; sess.auto.total++; if (ok) { sess.score++; sess.auto.score++; rec(c.id, true); sess.fi++; sess.fphase = 'learn'; if (sess.fi >= sess.fresh.length) sess.step = 2; }
    else { rec(c.id, false); sess.tries++; sess.cq = sess.tries < 2 ? (pickQuestion(c.id, [q.id]) || q) : q; if (sess.tries >= 2) sess.fphase = 'learn'; }
    render();
  }, ok => ok ? 'Nästa' : (sess.tries < 2 ? 'Försök igen' : 'Läs kortet igen'));
}
function stepMix() {
  const q = sess.mixQ[sess.mi]; if (!q) { sess.step = 3; return stepBoss(); }
  return `<div class="muted">Blandat · ${sess.mi + 1} av ${sess.mixQ.length}</div>` + quizView(q, ok => { sess.total++; sess.auto.total++; if (ok) { sess.score++; sess.auto.score++; } rec(q.c, ok); sess.mi++; if (sess.mi >= sess.mixQ.length) sess.step = 3; render(); });
}
function stepBoss() {
  const b = sess.boss; if (!b) { sess.step = 4; logSession('pass'); sess.logged = true; return stepDone(); }
  return bossView(b, pts => { cs(b.c).bossAt = Date.now(); rec(b.c, pts >= 2); sess.total++; sess.auto.total++; if (pts >= 2) { sess.score++; sess.auto.score++; } sess.step = 4; sess.logged = true; logSession('pass'); render(); });
}
function stepDone() {
  const g = greens(); const pct = sess.total ? Math.round(sess.score / sess.total * 100) : 0;
  const newGreen = CARDS.filter(c => mastery(c.id) === 3 && S.cards[c.id].d[2] === today()).length;
  const apct = sess.auto.total ? Math.round(sess.auto.score / sess.auto.total * 100) : 100; const counted = sess.auto.total === 0 || sess.auto.score / sess.auto.total >= PASS_MIN;
  return `<div class="card stack" style="text-align:center;gap:10px">
    <div class="eyebrow">${counted ? 'Pass klart · räknas' : 'Pass klart · räknas inte än'}</div><div class="big num" style="${counted ? '' : 'color:var(--bad)'}">${apct}%</div>
    ${counted ? '' : `<div class="fb no" style="text-align:left"><b>Under ${Math.round(PASS_MIN * 100)} % rätt</b>Passet sparas men räknas inte mot veckan. Korten du såg sitter bättre nu, så kör ett till direkt så räknas det.</div>`}
    <div>${sess.score} av ${sess.total} rätt på ${Math.max(1, Math.round((Date.now() - sess.start) / 60000))} min</div><hr>
    <div><b>${g}/${CARDS.length}</b> kort gröna${newGreen ? ` · <span style="color:var(--good)">+${newGreen} idag</span>` : ''}</div>
    <div class="muted">${pct >= 80 ? 'Stabilt. Kom tillbaka imorgon, då räknas det igen.' : pct >= 60 ? 'Bra jobbat. De röda korten kommer tillbaka i nästa pass.' : 'Tufft pass, men varje fel du fick se facit på sitter bättre nu. Kör igen imorgon.'}</div>
  </div>${counted ? '' : '<button class="btn primary" id="again">Kör ett till nu</button>'}<button class="btn ${counted ? 'primary' : ''}" id="done">Klar</button>` + after(() => { document.getElementById('done').onclick = () => { sess = null; go('today'); }; const ag = document.getElementById('again'); if (ag) ag.onclick = () => startSession(); });
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

// ---------- IDAG ----------
function planState() { const t = today(); const items = buildItems(MODS, RESULTS, t, SNOOZES); const ev = evaluate(items, ALLSESS, RESULTS, t); return { t, ev, weeks: weekReport(ev, t) }; }
function itemAction(it) { return `data-act="${it.kind}" data-m="${it.moduleId}"`; }
function itemRow(it, cls = '') {
  const icon = it.status === 'done' ? '✓' : it.status === 'rescued' ? '✓' : it.status === 'missed' ? '✕' : '';
  const sub = it.status === 'missed' ? 'Missad, räknas inte längre' : it.status === 'late' ? `Missad – rädda den senast ${fmtDate(addD(it.date, RESCUE_DAYS))}` : it.status === 'rescued' ? `Gjord ${fmtDate(it.doneDay)} (joker)` : it.status === 'done' ? `Klar${it.doneDay && it.doneDay < it.date ? ' i förväg' : ''}` : it.date === today() ? 'Idag' : fmtDate(it.date) + ' · går att göra nu';
  const done = it.status === 'done' || it.status === 'rescued';
  return `<button class="check ${done ? 'on' : ''} ${cls}" ${done || it.status === 'missed' ? 'disabled' : itemAction(it)} style="padding:12px 14px"><span class="box" style="${it.status === 'missed' ? 'color:var(--bad);border-color:var(--bad)' : ''}">${icon}</span><span style="min-width:0"><b>${esc(it.label)}</b><br><span class="muted" style="font-size:.9rem">${esc(it.title)} · ${sub}</span></span></button>`;
}
const addD = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
function todayView() {
  const { t, ev, weeks } = planState();
  const late = ev.filter(i => i.status === 'late');
  const todays = ev.filter(i => (i.date === t && (i.status === 'open' || i.status === 'done' || i.status === 'rescued')) || (i.kind === 'grade' && i.status === 'open'));
  const upcoming = ev.filter(i => i.status === 'future' && i.kind !== 'grade').slice(0, 3);
  const wk = weeks.find(w => w.week === isoW(t));
  const allDone = todays.length && todays.every(i => i.status !== 'open') && !late.length;
  const st = streakAll();
  const light = wk ? wk.light : 'grey';
  return `<div class="stack">
    <div class="topbar" style="padding-bottom:4px"><div><div class="eyebrow">${esc(me.display_name || '')} · ${new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1>${allDone ? 'Klar för idag' : late.length ? 'Rädda det här först' : todays.length ? 'Dagens plan' : 'Inget planerat idag'}</h1></div><button class="btn small" data-go="settings" aria-label="Inställningar">⚙︎</button></div>
    ${me.role === 'parent' ? `<div class="muted" style="font-size:.9rem">Du ser ${esc(studentName())}s Idag-sida.</div>` : ''}
    ${isStudent() && pushState === 'off' ? `<button class="check" id="pushon" style="padding:12px 14px"><span class="box">🔔</span><span><b>Slå på notiser</b><br><span class="muted" style="font-size:.9rem">En knuff kl 17 om du glömt passet. Tar bort allt tjat från föräldrarna.</span></span></button>` : ''}
    <div class="row" style="justify-content:space-between"><div class="row" style="gap:8px"><span class="light ${light}"></span><span class="muted">Vecka ${isoW(t).slice(-2)}: ${wk ? `${wk.done + wk.rescued.length}/${wk.total} gjort${wk.jokersUsed ? ' · ' + wk.jokersUsed + ' joker' : ''}` : 'inga uppgifter'}</span></div><div class="streak" title="${st} dagar i rad">${[0, 1, 2, 3, 4].map(i => `<i class="${i < st ? 'on' : ''}"></i>`).join('')}</div></div>
    ${late.length ? `<div class="card stack" style="gap:8px;border-color:var(--bad)"><h3 style="color:var(--bad)">Missat · rädda med joker</h3>${late.map(i => itemRow(i)).join('')}<p class="muted" style="font-size:.85rem">Du har ${JOKERS_PER_MONTH} joker per månad. Gör den inom ${RESCUE_DAYS} dagar så räknas veckan fortfarande.</p></div>` : ''}
    ${(() => { const due = LECTURES.filter(l => (l.questions || []).length && !REVIEWS.some(r => r.lecture_id === l.id) && Date.parse(l.recorded_at) > Date.now() - 3 * 86400e3); return due.length ? `<div class="card stack" style="gap:8px"><h3>Dagens lektioner · 3 min var</h3>${due.map(l => `<button class="check" data-lq="${l.id}" style="padding:12px 14px"><span class="box"></span><span style="min-width:0"><b>Fem frågor: ${esc(l.title)}</b><br><span class="muted" style="font-size:.9rem">${esc(l.subject || '')} · ${new Date(l.recorded_at).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })} · fastnar bäst samma dag</span></span></button>`).join('')}</div>` : ''; })()}
    <div class="card stack" style="gap:8px"><h3>Idag</h3>${todays.length ? todays.map(i => itemRow(i)).join('') : `<p class="muted">Inget inplanerat. Ta något från listan nedan om du har en lucka.</p>`}</div>
    ${upcoming.length ? `<div class="card stack" style="gap:8px"><h3>Kan göras redan nu</h3>${upcoming.map(i => itemRow(i)).join('')}<p class="muted" style="font-size:.85rem">Gör du något i förväg räknas det som klart den dagen. Bra sätt att få en ledig kväll senare.</p></div>` : ''}
    ${!todays.length && !upcoming.length && !late.length ? `<div class="card"><p class="muted">Inga planer inlagda. Kolla fliken Prov.</p></div>` : ''}
  </div>` + after(() => {
    const po = document.getElementById('pushon'); if (po) po.onclick = enablePush;
    document.querySelectorAll('[data-lq]').forEach(b => b.onclick = () => { lq = null; go('lecquiz', { lec: b.dataset.lq }); });
    document.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const m = MODS.find(x => x.id === b.dataset.m); if (!m) return;
      if (b.dataset.act === 'grade') return go('result', { mod: m.id, from: 'today' });
      if (!MOD || MOD.id !== m.id) { setModule(await db.loadModule(m.id)); S = await db.loadProgress(student, MOD.id); }
      if (b.dataset.act === 'pass') return startSession();
      if (b.dataset.act === 'test') { tst = null; return go('test'); }
      if (b.dataset.act === 'paper') { pp = null; return go('paper'); }
    });
  });
}
function isoW(d) { const x = new Date(d + 'T00:00:00'); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day + 3); const first = new Date(x.getFullYear(), 0, 4); const w = 1 + Math.round(((x - first) / 86400e3 - 3 + ((first.getDay() + 6) % 7)) / 7); return `${x.getFullYear()}-W${String(w).padStart(2, '0')}`; }
function streakAll() { const days = new Set(ALLSESS.map(s => s.d)); let n = 0; const d = new Date(); for (let i = 0; i < 60; i++) { const k = d.toISOString().slice(0, 10); if (days.has(k)) n++; else if (i > 0) break; d.setDate(d.getDate() - 1); } return n; }

// ---------- PROV (lista) ----------
function exams() {
  return `<div class="stack">
    <div class="topbar" style="padding-bottom:4px"><div><div class="eyebrow">Alla prov HT26</div><h1>Prov</h1></div></div>
    ${MOD ? `<button class="btn primary" data-go="home" style="font-size:1.2rem">Öppna ${esc(MOD.subject)}: ${esc(MOD.title)} ›</button>` : ''}
    <div class="card"><h3 style="margin-bottom:10px">Kommande</h3>${scheduleList(me.role === 'parent')}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn small" data-go="goals">Betygsmål</button></div>
  </div>`;
}

// ---------- LEKTIONER ----------
function md(s) { // minimal markdown → html (rubriker, listor, fet)
  return esc(s || '').split('\n').map(l => { l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\$(.+?)\$/g, '$1').replace(/\\times/g, '×'); if (/^#{1,4}\s/.test(l)) return `<div class="lbl" style="margin-top:10px">${l.replace(/^#+\s/, '')}</div>`; if (/^\s*[-*]\s/.test(l)) return `<div style="padding-left:14px">• ${l.replace(/^\s*[-*]\s/, '')}</div>`; if (/^\s*\d+\.\s/.test(l)) return `<div style="padding-left:14px">${l.trim()}</div>`; return l ? `<div>${l}</div>` : ''; }).join('');
}
function lectures() {
  const subjects = ['SO', 'NO', 'Matematik', 'Engelska', 'Svenska', 'Franska', 'Musik', 'HKK', 'Idrott', 'Bild', 'Annat'];
  return `<div class="stack">
    <div class="topbar" style="padding-bottom:4px"><div><div class="eyebrow">Inspelade med Pocket</div><h1>Lektioner</h1></div></div>
    ${LECTURES.length ? '' : '<div class="card"><p class="muted">Inga lektioner än. Spela in genomgången med Pocket, så dyker den upp här kvällen efter.</p></div>'}
    ${LECTURES.map(l => { const rv = REVIEWS.find(r => r.lecture_id === l.id); const qs = l.questions || []; return `<div class="card stack" style="gap:8px">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="eyebrow">${esc(l.subject || 'Ämne?')} · ${new Date(l.recorded_at).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })} · ${Math.round(l.duration / 60)} min</div><h2 style="font-size:1.3rem">${esc(l.title)}</h2></div>${me.role === 'parent' ? `<select data-lec="${l.id}" style="font:inherit;background:var(--surface2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:4px 8px"><option value="">Ämne</option>${subjects.map(sj => `<option ${l.subject === sj ? 'selected' : ''}>${sj}</option>`).join('')}</select>` : ''}</div>
      ${qs.length ? `<button class="btn ${rv ? '' : 'primary'}" data-lq="${l.id}" style="font-size:1.1rem;padding:12px">${rv ? `Repeterad ${rv.score}/${rv.max} · kör igen` : 'Fem frågor · 3 min'}</button>` : '<span class="pill">Frågor kommer</span>'}
      <details><summary class="muted" style="cursor:pointer">Sammanfattning</summary><div style="margin-top:8px;font-size:.98rem;line-height:1.5">${md(l.summary)}</div></details>
    </div>`; }).join('')}
  </div>` + after(() => {
    document.querySelectorAll('[data-lq]').forEach(b => b.onclick = () => { lq = null; go('lecquiz', { lec: b.dataset.lq }); });
    document.querySelectorAll('select[data-lec]').forEach(sel => sel.onchange = async () => { try { await db.setLectureSubject(sel.dataset.lec, sel.value || null); const l = LECTURES.find(x => x.id === sel.dataset.lec); if (l) l.subject = sel.value; toast('Sparat'); } catch (e) { toast('Kunde inte spara'); } });
  });
}

// ---------- LEKTIONSREPETITION (fem frågor) ----------
let lq = null;
function lecquiz() {
  const l = LECTURES.find(x => x.id === view.lec); if (!l || !(l.questions || []).length) return lectures();
  if (!lq || lq.id !== l.id) lq = { id: l.id, i: 0, ok: 0, qs: l.questions.map((q, i) => ({ ...q, id: 'lq' + i, type: 'mc', lvl: 'G', c: null })) };
  const q = lq.qs[lq.i];
  if (!q) {
    if (!lq.saved) { lq.saved = true; const r = REVIEWS.find(x => x.lecture_id === l.id); if (r) { r.score = lq.ok; r.max = lq.qs.length; } else REVIEWS.push({ lecture_id: l.id, day: today(), score: lq.ok, max: lq.qs.length }); if (isStudent()) db.saveLectureReview(me.id, l.id, lq.ok, lq.qs.length).catch(() => toast('Kunde inte spara')); }
    return `<div class="stack">${topbar('Lektion')}<div class="card" style="text-align:center"><div class="eyebrow">${esc(l.title)}</div><div class="big num">${lq.ok}/${lq.qs.length}</div><div class="muted">${lq.ok === lq.qs.length ? 'Allt satt. Det här fastnar nu.' : 'Läs sammanfattningen på det du missade, det tar två minuter.'}</div></div><button class="btn primary" id="done2">Klar</button></div>` + after(() => { document.getElementById('done2').onclick = () => { lq = null; go('today'); }; });
  }
  return `<div class="stack"><div class="topbar"><button class="back" id="q2">Avbryt</button><div class="eyebrow">${esc(l.subject || 'Lektion')} · fråga ${lq.i + 1}/${lq.qs.length}</div><div></div></div><div class="bar"><i style="width:${lq.i / lq.qs.length * 100}%"></i></div>` + quizView(q, ok => { if (ok) lq.ok++; lq.i++; render(); }) + `</div>` + after(() => { document.getElementById('q2').onclick = () => { lq = null; go('lectures'); }; });
}

// ---------- BONUS ----------
function bonus() {
  const { t, weeks } = planState();
  const past = weeks.filter(w => w.start <= t);
  const months = [...new Set([...past.map(w => w.start.slice(0, 7)), t.slice(0, 7)])].sort().reverse();
  const green = past.filter(w => w.light === 'green' || w.light === 'yellow').length;
  const hits = MODS.filter(m => resultFor(m) && goalFor(m) && GRADE_ORD[resultFor(m).grade] >= GRADE_ORD[goalFor(m).goal]).length;
  const graded = MODS.filter(m => resultFor(m) && goalFor(m)).length;
  const monthName = ym => new Date(ym + '-01T00:00:00').toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
  const kr = n => Math.round(n).toLocaleString('sv-SE') + ' kr';
  const examsIn = ym => MODS.filter(m => m.exam_date && m.exam_date.slice(0, 7) === ym && m.exam_date <= t && goalFor(m) && !['diagnos', 'träning'].includes(m.kind));
  // Genomförda lektioner per vecka: minst 20 min och frågorna svarade senast dagen efter
  const lecDone = LECTURES.filter(l => l.duration >= LECTURE_MIN_SEC && REVIEWS.some(r => r.lecture_id === l.id && r.day <= addD(l.recorded_at.slice(0, 10), LECTURE_REVIEW_DAYS)));
  const lectureWeeks = ym => { const out = []; let d = weekStart(ym + '-01'); if (d.slice(0, 7) < ym) d = addD(d, 7); for (; d.slice(0, 7) === ym && d <= t; d = addD(d, 7)) { const w = isoWeek(d); out.push({ week: w, start: d, end: addD(d, 6), n: lecDone.filter(l => isoWeek(l.recorded_at.slice(0, 10)) === w).length }); } return out; };
  const calc = ym => { const ws = past.filter(w => w.start.slice(0, 7) === ym); const ex = examsIn(ym); ex.forEach(loadPrep); return { ws, mb: monthBonus(ws, ex.map(m => ({ title: m.title, grade: resultFor(m) ? resultFor(m).grade : null, goal: goalFor(m).goal, prep: PREP[m.id] || null })), t, lectureWeeks(ym)) }; };
  const cur = calc(t.slice(0, 7));
  return `<div class="stack">
    <div class="topbar" style="padding-bottom:4px"><div><div class="eyebrow">${monthName(t.slice(0, 7))}</div><h1>Bonus</h1></div></div>
    <div class="card stack" style="gap:8px"><div class="row" style="justify-content:space-between;align-items:flex-end"><div><div class="big num" style="color:var(--accent)">${kr(cur.mb.total)}</div><div class="muted">hittills den här månaden · max ${kr(cur.mb.max)}</div></div><div class="num muted" style="text-align:right">${green} gröna veckor<br>${hits}/${graded} prov på mål</div></div>
      <div class="bar"><i style="width:${Math.round(cur.mb.total / cur.mb.max * 100)}%"></i></div>
      <div class="grid2" style="margin-top:4px">
        <div><div class="muted" style="font-size:.85rem">Golv</div><b class="num">${kr(cur.mb.floor)}</b></div>
        <div><div class="muted" style="font-size:.85rem">Pass i tid</div><b class="num">${kr(cur.mb.process)} <span class="muted" style="font-weight:400">/ ${kr(BONUS.PROCESS)}</span></b></div>
        <div><div class="muted" style="font-size:.85rem">Prov mot mål</div><b class="num">${kr(cur.mb.result)} <span class="muted" style="font-weight:400">/ ${kr(BONUS.RESULT)}</span></b></div>
        <div><div class="muted" style="font-size:.85rem">Lektioner</div><b class="num">${kr(cur.mb.lectures)} <span class="muted" style="font-weight:400">/ ${kr(BONUS.LECTURES)}</span></b></div>
      </div></div>
    <div class="card stack" style="gap:6px"><h3>Så funkar det</h3>
      <div class="row" style="gap:10px"><span class="light green"></span><span>Allt i planen gjort senast söndag. <b>${kr(cur.mb.weekAmount)} den veckan.</b></span></div>
      <div class="row" style="gap:10px"><span class="light yellow"></span><span>En dag missad men räddad inom ${RESCUE_DAYS} dagar med din joker (${JOKERS_PER_MONTH} per månad). <b>${kr(cur.mb.weekAmount - BONUS.YELLOW_PENALTY)}.</b></span></div>
      <div class="row" style="gap:10px"><span class="light red"></span><span>Något missat utan joker. <b>0 kr den veckan, aldrig minus.</b></span></div>
      <div class="row" style="gap:10px;align-items:flex-start"><span class="light" style="background:var(--accent);margin-top:4px"></span><span>Ett pass räknas när du har minst <b>${Math.round(PASS_MIN * 100)} % rätt</b> på frågorna appen rättar. Under det: kör ett till. Övningsprov räknas från 50 %.</span></div>
      <p class="muted" style="font-size:.9rem;margin-top:4px"><b>Prov:</b> ${kr(BONUS.RESULT)} delas på månadens prov. Nått målet = hela andelen. Under målet men minst ${Math.round(PREP_MIN * 100)} % gröna kort dagen före = halva. Månad utan prov: provdelen följer veckorna.<br><b>Lektioner:</b> spela in och svara på de fem frågorna senast dagen efter. ${BONUS.LECTURE_GOAL} lektioner i veckan = ${kr(lectureWeekAmount(4))}, 3 = ${kr(lectureWeekAmount(3))}, 2 = ${kr(lectureWeekAmount(2))}. Inspelningar under 20 min räknas inte.<br>Golvet ${kr(BONUS.FLOOR)} får du alltid.</p></div>
    ${months.map(ym => { const { ws, mb } = calc(ym); if (!ws.length && !mb.rows.length) return ''; return `<div class="card stack" style="gap:8px"><div class="row" style="justify-content:space-between"><h3>${monthName(ym)}</h3><b class="num" style="color:var(--accent)">${kr(mb.total)}${mb.pending ? ' <span class="muted" style="font-weight:400">pågår</span>' : ''}</b></div>
      ${ws.map(w => `<div class="row" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)"><div class="row" style="gap:10px"><span class="light ${w.light}"></span><span>Vecka ${w.week.slice(-2)} <span class="muted">${fmtDate(w.start)}–${fmtDate(w.end)}</span></span></div><div class="row" style="gap:10px"><span class="num muted">${w.done + w.rescued.length}/${w.total}</span><b class="num" style="min-width:60px;text-align:right">${w.light === 'open' ? '…' : kr(w.light === 'green' ? mb.weekAmount : w.light === 'yellow' ? mb.weekAmount - BONUS.YELLOW_PENALTY : 0)}</b></div></div>`).join('')}
      ${mb.rows.filter(r => r.kind === 'lectures').map(r => `<div class="row" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)"><div class="row" style="gap:10px"><span class="light ${r.n >= BONUS.LECTURE_GOAL ? 'green' : r.n >= 2 ? 'yellow' : r.pending ? 'open' : 'red'}"></span><span>Lektioner v.${r.week.slice(-2)} <span class="muted">${r.n} av ${BONUS.LECTURE_GOAL}${r.pending ? ' · pågår' : ''}</span></span></div><b class="num">${kr(r.amount)}</b></div>`).join('')}
      ${mb.rows.filter(r => r.kind !== 'week' && r.kind !== 'lectures').map(r => r.kind === 'noexam' ? `<div class="row" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)"><span>Inga prov · provdelen följer veckorna (${r.green}/${r.total} gröna)</span><b class="num">${kr(r.amount)}</b></div>` : `<div class="row" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)"><div class="row" style="gap:10px"><span class="light ${r.pending ? 'open' : r.hit ? 'green' : r.prepOk ? 'yellow' : 'red'}"></span><span>${esc(r.title)} ${r.pending ? '<span class="muted">väntar på betyg</span>' : `<span class="muted">${r.grade} mot mål ${r.goal}${r.prepOk && !r.hit ? ' · grön prepp' : ''}</span>`}</span></div><b class="num">${r.pending ? '…' : kr(r.amount)}</b></div>`).join('')}
      <div class="row" style="justify-content:space-between;margin-top:4px;border-top:1px solid var(--line);padding-top:8px"><span class="muted">Golv ${kr(mb.floor)} + pass ${kr(mb.process)} + prov ${kr(mb.result)} + lektioner ${kr(mb.lectures)}</span><b class="num">${kr(mb.total)}</b></div></div>`; }).join('') || '<div class="card"><p class="muted">Första veckan börjar när en plan finns.</p></div>'}
  </div>`;
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
      ${tests.map(x => (x.t.detail && x.t.detail.paper) ? `<hr><div class="row" style="justify-content:space-between"><b>Diagnos ${x.i + 1} · ${fmtDate(x.t.d)}</b><span class="muted num">${x.t.mins || 0} min · på papper, skicka foton till Claude för analys</span></div>` : `<hr><div class="row" style="justify-content:space-between"><b>Prov ${x.i + 1} · ${fmtDate(x.t.d)}</b><span class="num">${x.sc.pts}/${x.sc.max} p${x.sc.pending ? ' · <span style="color:var(--mid)">rätta</span>' : ''}</span></div>
        <div class="muted num">Del 1+2: ${x.sc.auto}/${x.sc.autoMax} automatiskt rättat</div>
        ${TEST.open.map(o => { const r = ((x.t.detail || {}).open || {})[o.id] || {}; const graded = typeof r.pts === 'number'; return `<div style="margin-top:10px"><div style="font-weight:600">${esc(o.q)}</div><div class="muted" style="white-space:pre-wrap;margin:4px 0">${r.text ? esc(r.text) : '<i>(inget skrivet, titta på pappret)</i>'}</div>
          <div class="rub">${o.rub.map((rb, k) => `<button class="check ${graded && r.marks && r.marks[k] ? 'on' : ''}" data-t="${x.i}" data-o="${o.id}" data-k="${k}"><span class="box">${graded && r.marks && r.marks[k] ? '✓' : ''}</span><span>${esc(rb)}</span></button>`).join('')}</div>
          <div class="muted num" style="margin-top:4px">${graded ? `${r.pts}/3 p` : 'Bocka av för att rätta'}</div></div>`; }).join('')}`).join('')}
    </div>
    ${(() => { const past = MODS.filter(m => m.exam_date && m.exam_date < today()); const withR = past.filter(resultFor); const hits = withR.filter(m => { const g = goalFor(m), r = resultFor(m); return g && GRADE_ORD[r.grade] >= GRADE_ORD[g.goal]; }).length; return `<div class="card"><h3>Utfall hittills</h3><div class="row" style="gap:20px;margin-top:8px"><div><div class="big num" style="font-size:2.4rem">${withR.length}/${past.length}</div><div class="muted">prov med betyg</div></div><div><div class="big num" style="font-size:2.4rem;color:var(--good)">${hits}</div><div class="muted">nådde målet</div></div><div><div class="big num" style="font-size:2.4rem;color:var(--bad)">${withR.length - hits}</div><div class="muted">under målet</div></div></div>${past.length - withR.length ? `<p class="muted" style="margin-top:8px">${past.length - withR.length} genomförda prov saknar betyg. Tryck på dem i schemat nedan.</p>` : ''}</div>`; })()}
    <div class="card"><div class="row" style="justify-content:space-between"><h3>Betygsmål</h3><button class="btn small" data-go="goals">Visa / ändra</button></div><div class="row" style="gap:6px;margin-top:8px">${GOALS.map(g => `<span class="pill">${esc(g.subject)} <b style="color:var(--accent)">${g.goal}</b></span>`).join('') || '<span class="muted">Inga mål satta</span>'}</div></div>
    <div class="card"><h3>Provschema</h3><p class="muted" style="margin:6px 0 10px">Prov utan material behöver fyllas på i tid. Skicka "inför provet"-dokumentet till Claude så läggs det in.</p>${scheduleList(true)}</div>
    <div class="card"><h3>Så funkar det</h3><p class="muted" style="margin-top:6px">Ett kort blir grönt när eleven svarat rätt på det <b>tre olika dagar</b>. Att läsa räknas inte. Rött = fel senast. Passet väljer själv de svagaste korten. Vyn uppdateras live när eleven pluggar.</p></div>
  </div>` + after(() => {
    document.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => { student = b.dataset.st; S = MOD ? await db.loadProgress(student, MOD.id) : S; GOALS = await db.loadGoals(student); await refreshAll(); [LECTURES, REVIEWS] = await Promise.all([db.loadLectures(student), db.loadLectureReviews(student)]); render(); });
    document.querySelectorAll('.rub .check').forEach(b => b.onclick = async () => {
      const t = S.sessions.filter(s => s.type === 'test')[+b.dataset.t]; const det = t.detail || (t.detail = { answers: {}, open: {} }); det.open = det.open || {};
      const r = det.open[b.dataset.o] || (det.open[b.dataset.o] = { text: '' }); r.marks = r.marks || [false, false, false]; r.marks[+b.dataset.k] = !r.marks[+b.dataset.k]; r.pts = r.marks.filter(Boolean).length;
      if (t.id) await db.updateSessionDetail(t.id, det); render();
    });
  });
}

// ---------- BETYGSMÅL ----------
function goals() {
  const canEdit = me.role === 'parent';
  const tot = GOALS.reduce((a, g) => a + Number(g.points), 0);
  const rows = SUBJECTS.map(sub => { const g = GOALS.find(x => x.subject === sub); return `<div class="row" style="justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)"><span>${esc(sub)}</span><span class="row" style="gap:8px">${g ? `<span class="muted num" style="font-size:.85rem">${g.points} p</span>` : ''}${canEdit ? `<select data-sub="${esc(sub)}" style="font:inherit;background:var(--surface2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:6px 10px"><option value="">–</option>${['A','B','C','D','E'].map(l => `<option ${g && g.goal === l ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<b style="font-family:var(--display);font-size:1.4rem;color:var(--accent);min-width:1.2em;text-align:right">${g ? g.goal : '–'}</b>`}</span></div>`; }).join('');
  return `<div class="stack">${topbar('Betygsmål')}
    <div class="card"><div class="eyebrow">${esc(studentName())} · slutmål åk 9</div><div class="row" style="justify-content:space-between;align-items:flex-end;margin-top:6px"><div><div class="big num" style="font-size:2.6rem">${tot}</div><div class="muted">meritpoäng om alla mål nås (max ${SUBJECTS.length * 20})</div></div></div></div>
    <div class="card">${rows}<p class="muted" style="margin-top:10px;font-size:.9rem">${canEdit ? 'Ändringar sparas direkt. Målen är kopplade till kommande bonus, så bara föräldrar kan ändra dem.' : 'Målen sätts av dina föräldrar och styr nivån på varje prov.'}</p></div>
  </div>` + after(() => {
    document.querySelectorAll('select[data-sub]').forEach(sel => sel.onchange = async () => { if (!sel.value) return; try { await db.setGoal(student, sel.dataset.sub, sel.value); GOALS = await db.loadGoals(student); render(); toast('Sparat'); } catch (e) { toast('Kunde inte spara'); } });
  });
}

// ---------- PAPPERSDIAGNOS ----------
let pp = null;
function paper() {
  if (!PAPER) return home();
  if (!pp) pp = { start: Date.now(), part: 0 };
  const pt = PAPER.parts[pp.part];
  if (!pt) {
    const mins = Math.round((Date.now() - pp.start) / 60000);
    return `<div class="stack">${topbar('Diagnos')}<div class="card" style="text-align:center"><div class="eyebrow">Klar</div><div class="big num">${mins} min</div><p>Fota alla papper och skicka till mamma eller pappa. Skriv uppgiftsnumret framför varje svar.</p></div><button class="btn primary" id="fin">Lämna in</button></div>` + after(() => { document.getElementById('fin').onclick = async () => { await logSession('test', { score: 0, max: 0, mins, detail: { paper: true } }); pp = null; toast('Inlämnad'); go('today'); }; });
  }
  const mins = Math.floor((Date.now() - pp.start) / 60000);
  return `<div class="stack"><div class="topbar"><button class="back" id="quit">Avbryt</button><div class="eyebrow">Del ${esc(pt.id)} · ${pt.mins} min · ${pt.calc ? 'räknare ok' : 'utan räknare'}</div><div class="timer num">${mins} min</div></div>
    <p class="muted">${esc(pt.hint || 'Svara på papper. Skriv numret framför varje svar.')}</p>
    <div class="card" style="gap:0;padding:4px 16px">${pt.items.map(it => `<div style="display:grid;grid-template-columns:40px 1fr;gap:8px;padding:12px 0;border-bottom:1px solid var(--line);align-items:baseline"><span style="font-family:var(--display);font-weight:800;color:var(--accent);font-size:1.15rem">${esc(it.id)}</span><span style="font-size:1.1rem;font-weight:500">${esc(it.q)}</span></div>`).join('')}</div>
    <button class="btn primary" id="next">${pp.part < PAPER.parts.length - 1 ? 'Klar med del ' + esc(pt.id) + ' · nästa del' : 'Klar med allt'}</button></div>` + after(() => {
      document.getElementById('next').onclick = () => { pp.part++; window.scrollTo(0, 0); render(); };
      document.getElementById('quit').onclick = () => { pp = null; go('home'); };
    });
}

// ---------- UTFALL ----------
// Preppnivå: andel kort som var gröna (rätt tre olika dagar) senast dagen före provet. Går inte att fejka genom att trycka.
const PREP = {};
function loadPrep(m) {
  if (PREP[m.id] !== undefined || !m.has_content || !m.exam_date) return;
  PREP[m.id] = null;
  Promise.all([db.loadProgress(student, m.id), db.loadModule(m.id)]).then(([p, mod]) => {
    const total = ((mod && mod.content && mod.content.cards) || []).length;
    const green = Object.values(p.cards).filter(c => (c.d || []).filter(d => d < m.exam_date).length >= 3).length;
    PREP[m.id] = { green, total }; render();
  }).catch(() => { PREP[m.id] = { green: 0, total: 0 }; });
}
function prepLine(m) {
  const p = PREP[m.id]; if (!p || !p.total) return '';
  const ok = p.green / p.total >= PREP_MIN;
  return `<div class="row" style="gap:10px;margin-top:4px"><span class="light ${ok ? 'green' : 'red'}"></span><span><b>Preppen: ${p.green} av ${p.total} kort gröna</b> dagen före provet${ok ? '. Jobbet var gjort.' : ` (krävs ${Math.round(PREP_MIN * 100)} %).`}</span></div>`;
}
function result() {
  const m = MODS.find(x => x.id === view.mod); if (!m) return home();
  loadPrep(m);
  const r = resultFor(m), g = goalFor(m);
  const canEdit = me.role === 'parent' || (!r && student === me.id);
  const hit = r && g ? (GRADE_ORD[r.grade] >= GRADE_ORD[g.goal]) : null;
  return `<div class="stack"><div class="topbar"><button class="back" id="bk">Tillbaka</button><div class="eyebrow">Utfall</div><div></div></div>
    <div class="card stack" style="gap:10px"><div><div class="eyebrow">${esc(m.subject)} · ${KIND[m.kind] || esc(m.kind)} · ${m.exam_date ? fmtDate(m.exam_date) : ''}</div><h2>${esc(m.title)}</h2>${m.note ? `<div class="muted">${esc(m.note)}</div>` : ''}</div>
      <div class="row" style="gap:20px"><div><div class="muted" style="font-size:.85rem">Mål ${g ? esc(m.goal_subject) : ''}</div><div class="big num" style="font-size:2.6rem;color:var(--accent)">${g ? g.goal : '–'}</div></div><div><div class="muted" style="font-size:.85rem">Fick</div><div class="big num" style="font-size:2.6rem;color:${hit === null ? 'var(--fg)' : hit ? 'var(--good)' : 'var(--bad)'}">${r ? r.grade : '–'}</div></div></div>
      ${prepLine(m)}
      ${r ? `<div class="fb ${hit === false ? 'no' : 'ok'}"><b>${hit === null ? 'Betyg inlagt' : hit ? 'Målet nått' : 'Under målet'}</b>${r.comment ? esc(r.comment) : ''}<div class="muted" style="font-size:.85rem;margin-top:4px">Inlagt ${new Date(r.entered_at).toLocaleDateString('sv-SE')}${r.entered_by === student ? ' av eleven' : ' av förälder'}</div></div>` : ''}
    </div>
    ${canEdit ? `<div class="card stack" style="gap:10px"><h3>${r ? 'Ändra betyg' : 'Ange betyg'}</h3>
      <div class="row">${['A','B','C','D','E','F'].map(l => `<button class="btn small ${r && r.grade === l ? 'primary' : ''}" data-g="${l}" style="min-width:52px;font-size:1.2rem">${l}</button>`).join('')}</div>
      <div><label for="rc">Kommentar (valfritt)</label><input type="text" id="rc" value="${r ? esc(r.comment || '') : ''}" placeholder="t.ex. 38/45 p, missade del 2"></div>
      <div id="rerr"></div></div>` : `<p class="muted">Betyget är inlagt. Vill du ändra, be en förälder.</p>`}
    ${!r ? `<button class="check" id="snz" style="padding:12px 14px"><span class="box">⏳</span><span style="min-width:0"><b>Har inte fått tillbaka provet än</b><br><span class="muted" style="font-size:.9rem">${(() => { const sn = SNOOZES.find(x => x.module_id === m.id); return sn && sn.until > today() ? `Frågar igen ${fmtDate(sn.until)}. Tryck för att skjuta upp 7 dagar till.` : 'Fråga igen om 7 dagar. Veckan påverkas inte.'; })()}</span></span></button>` : ''}
  </div>` + after(() => {
    document.getElementById('bk').onclick = () => go(view.from || 'exams');
    const sz = document.getElementById('snz'); if (sz) sz.onclick = async () => { try { const base = SNOOZES.find(x => x.module_id === m.id); const from = base && base.until > today() ? base.until : today(); await db.snoozeResult(student, m.id, addD(from, 7)); SNOOZES = await db.loadSnoozes(student); toast('Frågar igen om en vecka'); go(view.from || 'exams'); } catch (e) { toast('Kunde inte spara: ' + e.message); } };
    document.querySelectorAll('[data-g]').forEach(b => b.onclick = async () => { try { await db.setResult(student, m.id, b.dataset.g, document.getElementById('rc').value.trim()); RESULTS = await db.loadResults(student); toast('Sparat: ' + b.dataset.g); render(); } catch (e) { document.getElementById('rerr').innerHTML = `<div class="fb no">${esc(e.message)}</div>`; } });
  });
}

// ---------- PUSH ----------
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let pushState = 'unknown'; // unknown | on | off | denied | unsupported | needs-home
async function checkPush() {
  if (!pushSupported()) { pushState = isStandalone() || !/iPhone|iPad/.test(navigator.userAgent) ? 'unsupported' : 'needs-home'; return; }
  if (Notification.permission === 'denied') { pushState = 'denied'; return; }
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); pushState = sub && await db.hasPushSubscription(sub.endpoint) ? 'on' : 'off'; } catch (e) { pushState = 'off'; }
}
function b64url(s) { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function enablePush() {
  try {
    const perm = await Notification.requestPermission(); if (perm !== 'granted') { pushState = perm === 'denied' ? 'denied' : 'off'; render(); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(db.VAPID_PUBLIC) });
    await db.savePushSubscription(me.id, sub); pushState = 'on'; toast('Notiser på'); render();
  } catch (e) { toast('Gick inte: ' + (e.message || e)); }
}
function pushCard() {
  if (pushState === 'on') return `<div class="fb ok"><b>Notiser på</b>En knuff kl 17 om dagens pass inte är gjort, och på kvällen när det finns frågor på en lektion.</div>`;
  if (pushState === 'needs-home') return `<div class="fb no"><b>Lägg appen på hemskärmen först</b>iPhone skickar bara notiser till appar på hemskärmen: Dela-knappen i Safari → "Lägg till på hemskärmen". Öppna sedan appen därifrån och slå på notiser här.</div>`;
  if (pushState === 'denied') return `<div class="fb no"><b>Notiser blockerade</b>Slå på dem i Inställningar → Notiser → Pluggappen, sedan ladda om.</div>`;
  if (pushState === 'unsupported') return `<p class="muted">Den här webbläsaren stödjer inte notiser.</p>`;
  return `<p class="muted">En knuff kl 17 om passet inte är gjort, och på kvällen när dagens lektion har frågor. Aldrig mer än två om dagen.</p><button class="btn primary" id="pushon" style="font-size:1.2rem">Slå på notiser</button>`;
}

// ---------- INSTÄLLNINGAR ----------
function settings() {
  if (pushState === 'unknown') checkPush().then(render);
  const bot = import.meta.env.VITE_TELEGRAM_BOT;
  return `<div class="stack">${topbar('Inställningar')}
    <div class="card stack" style="gap:8px"><h3>Konto</h3><div><b>${esc(me.display_name || '')}</b> · ${me.role === 'parent' ? 'förälder' : 'elev'}</div><div class="muted">${esc(me.email)}</div></div>
    ${me.role === 'parent' ? `<div class="card stack" style="gap:8px"><h3>Familjekod</h3><div class="code" id="fcode">…</div><p class="muted">Eleven skapar konto i appen, väljer Elev och skriver in koden.</p></div>` : ''}
    <div class="card stack" style="gap:8px"><h3>Notiser</h3>${pushCard()}</div>
    <div class="card stack" style="gap:8px"><h3>Lägg till på hemskärmen</h3><p class="muted">iPhone: Dela-knappen i Safari → "Lägg till på hemskärmen". Då funkar appen i fullskärm.</p></div>
    <button class="btn" id="lo">Logga ut</button>
  </div>` + after(async () => {
    document.getElementById('lo').onclick = logout;
    const po = document.getElementById('pushon'); if (po) po.onclick = enablePush;
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
  GOALS = student ? await db.loadGoals(student) : []; RESULTS = student ? await db.loadResults(student) : []; SNOOZES = student ? await db.loadSnoozes(student) : [];
  [ALLSESS, LECTURES, REVIEWS] = student ? await Promise.all([db.loadAllSessions(student), db.loadLectures(student), db.loadLectureReviews(student)]) : [[], [], []];
  const withC = MODS.filter(m => m.has_content); const t0 = today();
  const first = withC.find(m => m.id === want) || withC.find(m => m.exam_date >= t0) || withC[withC.length - 1];
  if (first) { setModule(await db.loadModule(first.id)); S = await db.loadProgress(student, MOD.id); } else { MOD = null; S = { cards: {}, sessions: [] }; }
  if (me.role === 'parent') { let t = null; unsub = db.subscribeFamily(() => { clearTimeout(t); t = setTimeout(async () => { if (!MOD) return; S = await db.loadProgress(student, MOD.id); await refreshAll(); if (!sess) render(); }, 600); }); }
  checkPush().then(() => { if (view.name === "today") render(); });
  go("today");
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { me = null; go('auth'); } });
boot();
