// Planlogik: vad ska göras per dag, vad är gjort, missat eller räddat (joker). Ren funktion utan DOM.
// items: [{key, date, moduleId, title, kind:'pass'|'test'|'paper'|'grade', label}]
// sessions: [{module_id, type, d}] – type 'pass' | 'pass-avbrutet' | 'quiz' | 'test'
// results: [{module_id}] – betyg inlagt

export const RESCUE_DAYS = 2;      // en missad dag får räddas inom så många dagar
export const JOKERS_PER_MONTH = 1; // antal räddningar per kalendermånad utan att veckan faller
export const PASS_MIN = 0.6;       // andel rätt på automatiskt rättade frågor för att ett pass ska räknas
export const TEST_MIN = 0.5;       // andel rätt för att ett övningsprov ska räknas
export const PREP_MIN = 0.8;       // andel gröna kort dagen före provet = "preppen var grön"

// Bonusmodell (kr/månad). Max = FLOOR + PROCESS + RESULT + 4 veckor lektioner = 3 000.
export const BONUS = { FLOOR: 500, PROCESS: 1500, YELLOW_PENALTY: 100, RESULT: 700, LECTURES: 300, LECTURE_WEEK: 75, LECTURE_GOAL: 4 };
export const LECTURE_MIN_SEC = 1200;   // en lektion räknas från 20 min
export const LECTURE_REVIEW_DAYS = 1;  // ...och om frågorna är svarade senast dagen efter
export const lectureWeekAmount = n => n >= 4 ? 75 : n === 3 ? 50 : n === 2 ? 25 : 0;
export const GRADE_ORD = { F: 0, E: 1, D: 2, C: 3, B: 4, A: 5 };

// Månadsutfall. weeks: veckor vars start ligger i månaden (från weekReport). exams: [{title, grade|null, goal|null, prep: {green,total}|null}].
// lectureWeeks: [{week, start, end, n}] – genomförda lektioner per vecka i månaden.
// Returnerar {floor, process, result, lectures, total, max, pending, weekAmount, rows}
export function monthBonus(weeks, exams, todayStr, lectureWeeks = []) {
  const n = weeks.length || 1; const weekAmount = Math.round(BONUS.PROCESS / n);
  let process = 0; const rows = [];
  for (const w of weeks) {
    const amt = w.light === 'green' ? weekAmount : w.light === 'yellow' ? weekAmount - BONUS.YELLOW_PENALTY : 0;
    const finished = w.end < todayStr || w.light === 'green' || w.light === 'yellow' || w.light === 'red';
    process += amt; rows.push({ kind: 'week', week: w.week, light: w.light, amount: amt, pending: !finished });
  }
  const finishedWeeks = weeks.filter(w => w.light !== 'open' && w.light !== 'grey');
  const greenWeeks = finishedWeeks.filter(w => w.light === 'green' || w.light === 'yellow').length;
  let result = 0, pending = false;
  const graded = exams.filter(e => e.goal);
  if (graded.length) {
    const share = BONUS.RESULT / graded.length;
    for (const e of graded) {
      if (!e.grade) { pending = true; rows.push({ kind: 'exam', title: e.title, amount: 0, pending: true }); continue; }
      const hit = GRADE_ORD[e.grade] >= GRADE_ORD[e.goal]; const prepOk = e.prep && e.prep.total && e.prep.green / e.prep.total >= PREP_MIN;
      const amt = hit ? share : prepOk ? share / 2 : 0; result += amt;
      rows.push({ kind: 'exam', title: e.title, amount: Math.round(amt), hit, prepOk, grade: e.grade, goal: e.goal });
    }
  } else if (weeks.length) {
    result = finishedWeeks.length ? BONUS.RESULT * greenWeeks / finishedWeeks.length : 0;
    if (finishedWeeks.length < weeks.length) pending = true;
    rows.push({ kind: 'noexam', amount: Math.round(result), green: greenWeeks, total: finishedWeeks.length });
  }
  let lectures = 0;
  for (const lw of lectureWeeks) { const amt = lectureWeekAmount(lw.n); lectures += amt; rows.push({ kind: 'lectures', week: lw.week, start: lw.start, end: lw.end, n: lw.n, amount: amt, pending: lw.end >= todayStr }); }
  lectures = Math.min(lectures, BONUS.LECTURES);
  const total = Math.round(BONUS.FLOOR + process + result + lectures);
  return { floor: BONUS.FLOOR, process, result: Math.round(result), lectures, total, max: BONUS.FLOOR + BONUS.PROCESS + BONUS.RESULT + BONUS.LECTURES, pending: pending || weeks.some(w => w.light === 'open'), weekAmount, rows };
}

// Räknas passet/provet mot planen? Gamla sessioner utan detaljer räknas (de loggades innan regeln fanns).
export function counts(s) {
  if (s.type === 'pass') {
    const a = s.detail && s.detail.auto;
    if (a && a.total > 0) return a.score / a.total >= PASS_MIN;
    return !s.max || s.score / s.max >= PASS_MIN;
  }
  if (s.type === 'test') {
    if (s.detail && s.detail.paper) return true;
    return !s.max || s.score / s.max >= TEST_MIN;
  }
  return false;
}

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
export const isoWeek = d => { const x = new Date(d + 'T00:00:00'); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day + 3); const first = new Date(x.getFullYear(), 0, 4); const w = 1 + Math.round(((x - first) / 86400e3 - 3 + ((first.getDay() + 6) % 7)) / 7); return `${x.getFullYear()}-W${String(w).padStart(2, '0')}`; };
export const weekStart = d => { const x = new Date(d + 'T00:00:00'); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x.toISOString().slice(0, 10); };

// Bygg planposter från modulerna (modules_list med plan) och passerade prov utan betyg.
export function buildItems(mods, results, todayStr, snoozes = []) {
  const items = [];
  for (const m of mods) {
    if (!m.has_content) continue;
    const plan = m.plan || [];
    for (const p of plan) {
      let passN = 0;
      for (const it of p.items) {
        const isTest = /övningsprov|diagnos/i.test(it) || m.kind === 'diagnos';
        const kind = m.kind === 'diagnos' ? 'paper' : isTest ? 'test' : 'pass';
        const key = `${m.id}:${p.date}:${kind}:${kind === 'pass' ? passN++ : 0}`;
        items.push({ key, date: p.date, moduleId: m.id, title: `${m.subject}: ${m.title}`, kind, label: it });
      }
    }
    if (m.kind === 'diagnos' && !plan.length && m.exam_date) items.push({ key: `${m.id}:${m.exam_date}:paper:0`, date: m.exam_date, moduleId: m.id, title: `${m.subject}: ${m.title}`, kind: 'paper', label: 'Gör diagnosen (40 min)' });
  }
  // betyg på passerade prov (inte diagnoser)
  for (const m of mods) {
    if (!m.exam_date || m.exam_date >= todayStr || m.kind === 'diagnos') continue;
    if (results.some(r => r.module_id === m.id)) continue;
    const sn = snoozes.find(s => s.module_id === m.id);
    const due = sn && sn.until > addDays(m.exam_date, 7) ? sn.until : addDays(m.exam_date, 7);
    items.push({ key: `${m.id}:grade`, date: due, moduleId: m.id, title: `${m.subject}: ${m.title}`, kind: 'grade', label: sn ? 'Fått tillbaka provet? Lägg in betyget' : 'Lägg in betyget du fick', snoozed: !!sn });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// Matcha planposter mot sessions. Returnerar items med status: done | rescued | missed | open | future, och doneDay.
export function evaluate(items, sessions, results, todayStr) {
  const pool = sessions.filter(s => (s.type === 'pass' || s.type === 'test') && counts(s)).map(s => ({ ...s, used: false })).sort((a, b) => a.d.localeCompare(b.d));
  const out = items.map(it => ({ ...it }));
  // först: poster i datumordning, varje tar den tidigaste passande oanvända sessionen inom [date-7, date+RESCUE]
  for (const it of out) {
    if (it.kind === 'grade') { const r = results.find(x => x.module_id === it.moduleId); it.status = r ? 'done' : it.date > todayStr ? 'future' : it.date < addDays(todayStr, -RESCUE_DAYS) ? 'missed' : 'open'; continue; }
    const want = it.kind === 'pass' ? 'pass' : 'test';
    const cand = pool.find(s => !s.used && s.module_id === it.moduleId && s.type === want && s.d >= addDays(it.date, -7) && s.d <= addDays(it.date, RESCUE_DAYS));
    if (cand) { cand.used = true; it.doneDay = cand.d; it.status = cand.d <= it.date ? 'done' : 'rescued'; }
    else it.status = it.date > todayStr ? 'future' : it.date === todayStr ? 'open' : (addDays(it.date, RESCUE_DAYS) >= todayStr ? 'late' : 'missed');
  }
  return out;
}

// Veckorapport: per ISO-vecka → {week, start, items, done, total, jokersUsed, missed, light:'green'|'yellow'|'red'|'grey'|'open'}
export function weekReport(evaluated, todayStr) {
  const byWeek = new Map();
  for (const it of evaluated) { const w = isoWeek(it.date); if (!byWeek.has(w)) byWeek.set(w, { week: w, start: weekStart(it.date), items: [] }); byWeek.get(w).items.push(it); }
  const jokersByMonth = new Map();
  const weeks = [...byWeek.values()].sort((a, b) => a.start.localeCompare(b.start));
  for (const w of weeks) {
    w.total = w.items.length;
    w.done = w.items.filter(i => i.status === 'done').length;
    w.rescued = w.items.filter(i => i.status === 'rescued');
    w.missed = w.items.filter(i => i.status === 'missed').length;
    w.open = w.items.filter(i => i.status === 'open' || i.status === 'late' || i.status === 'future').length;
    // jokrar per månad (veckans startmånad)
    const month = w.start.slice(0, 7); const used = jokersByMonth.get(month) || 0;
    w.jokersUsed = w.rescued.length; w.jokersOver = Math.max(0, used + w.rescued.length - JOKERS_PER_MONTH); jokersByMonth.set(month, used + w.rescued.length);
    const weekEnd = addDays(w.start, 6);
    if (w.total === 0) w.light = 'grey';
    else if (w.missed > 0 || w.jokersOver > 0) w.light = 'red';
    else if (w.open > 0) w.light = weekEnd < todayStr ? 'red' : 'open';
    else if (w.rescued.length > 0) w.light = 'yellow';
    else w.light = 'green';
    w.pct = w.total ? Math.round((w.done + w.rescued.length) / w.total * 100) : 0;
    w.end = weekEnd;
  }
  return weeks;
}
