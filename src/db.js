// Dataåtkomst mot Supabase. All affärslogik ligger i main.js; här bara frågor.
import { createClient } from '@supabase/supabase-js';

export const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

export async function getSession() { const { data } = await sb.auth.getSession(); return data.session; }

export async function getProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  return data ? { ...data, email: user.email } : { id: user.id, email: user.email, family_id: null };
}

export async function familyCode() { const { data } = await sb.rpc('my_family_code'); return data; }
export async function createFamily(name, displayName) { const { data, error } = await sb.rpc('create_family', { p_name: name, p_display_name: displayName }); if (error) throw error; return data; }
export async function joinFamily(code, displayName, role = 'student') { const { data, error } = await sb.rpc('join_family', { p_code: code, p_display_name: displayName, p_role: role }); if (error) throw error; return data; }

export async function listModules() {
  const { data } = await sb.from('modules_list').select('*').eq('published', true).order('exam_date', { ascending: true });
  return data || [];
}
export async function loadModule(id) { const { data } = await sb.from('modules').select('*').eq('id', id).single(); return data; }

export async function familyMembers() { const { data } = await sb.from('profiles').select('id,display_name,role,telegram_chat_id'); return data || []; }

// Progress för en elev + modul → {cards:{cardId:{d,c,w,weak,bossAt}}, sessions:[...]}
export async function loadProgress(userId, moduleId) {
  const [{ data: cp }, { data: ss }] = await Promise.all([
    sb.from('card_progress').select('*').eq('user_id', userId).eq('module_id', moduleId),
    sb.from('sessions').select('*').eq('user_id', userId).eq('module_id', moduleId).order('created_at'),
  ]);
  const cards = {};
  (cp || []).forEach(r => { cards[r.card_id] = { d: r.days || [], c: r.correct, w: r.wrong, weak: r.weak, bossAt: r.boss_at ? Date.parse(r.boss_at) : 0, last: r.last_at ? Date.parse(r.last_at) : 0 }; });
  const sessions = (ss || []).map(s => ({ id: s.id, d: s.day, ts: Date.parse(s.created_at), type: s.kind, score: s.score, max: s.max, mins: s.minutes, detail: s.detail }));
  return { cards, sessions };
}

export async function upsertCard(userId, moduleId, cardId, c) {
  await sb.from('card_progress').upsert({ user_id: userId, module_id: moduleId, card_id: cardId, days: c.d, correct: c.c, wrong: c.w, weak: c.weak, boss_at: c.bossAt ? new Date(c.bossAt).toISOString() : null, last_at: new Date().toISOString() });
}
export async function insertSession(userId, moduleId, s) {
  const { data } = await sb.from('sessions').insert({ user_id: userId, module_id: moduleId, kind: s.type, day: s.d, score: s.score, max: s.max, minutes: s.mins, detail: s.detail || null }).select('id').single();
  return data?.id;
}
export async function updateSessionDetail(id, detail) { await sb.from('sessions').update({ detail }).eq('id', id); }

export function subscribeFamily(onChange) {
  const ch = sb.channel('family-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'card_progress' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, onChange)
    .subscribe();
  return () => sb.removeChannel(ch);
}

// Betygsmål per elev och årskurs. Bara föräldrar kan skriva (RLS).
export async function loadGoals(userId, grade = 9) { const { data } = await sb.from('grade_goals').select('subject,goal,points,updated_at').eq('user_id', userId).eq('grade', grade).order('subject'); return data || []; }
export async function setGoal(userId, subject, goal, grade = 9) { const { data: { user } } = await sb.auth.getUser(); const { error } = await sb.from('grade_goals').upsert({ user_id: userId, grade, subject, goal, updated_by: user?.id, updated_at: new Date().toISOString() }); if (error) throw error; }
