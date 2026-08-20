// 端末内の保存。サーバーには何も送らない。

const KEY_SETTINGS = 'repgate.settings.v1';
const KEY_HISTORY = 'repgate.history.v1';
const KEY_STATE = 'repgate.state.v1';

export const DEFAULT_SETTINGS = {
  exercise: 'situp',
  targetReps: 10,
  lockStart: '21:00',
  lockEnd: '02:00',
  intervalMin: 60,
  facing: 'user',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('保存できませんでした', err);
  }
}

export const loadSettings = () => read(KEY_SETTINGS, DEFAULT_SETTINGS);
export const saveSettings = (s) => write(KEY_SETTINGS, s);

/** { unlockedUntil: epoch ms, snoozeUntil: epoch ms } */
export const loadState = () => read(KEY_STATE, { unlockedUntil: 0, snoozeUntil: 0 });
export const saveState = (s) => write(KEY_STATE, s);

/** 記録は新しい順の配列。1セッション1件。 */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY_HISTORY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addSession(session) {
  const history = loadHistory();
  history.unshift(session);
  write(KEY_HISTORY, history.slice(0, 500));
  return history;
}

export function clearAll() {
  [KEY_SETTINGS, KEY_HISTORY, KEY_STATE].forEach((k) => localStorage.removeItem(k));
}

/** ローカル時刻の YYYY-MM-DD。UTC にすると日付がずれるので自前で組む。 */
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayReps(history = loadHistory()) {
  const key = dateKey();
  return history.filter((s) => s.date === key).reduce((sum, s) => sum + s.reps, 0);
}

export function totalReps(history = loadHistory()) {
  return history.reduce((sum, s) => sum + s.reps, 0);
}

/**
 * 連続日数。今日やっていれば今日から、まだなら昨日から遡って数える。
 * 「今日まだやっていない」だけで連続が切れた表示にならないようにするため。
 */
export function streakDays(history = loadHistory()) {
  const days = new Set(history.map((s) => s.date));
  if (days.size === 0) return 0;

  const cursor = new Date();
  if (!days.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dateKey(cursor))) return 0;
  }

  let count = 0;
  while (days.has(dateKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/** 日ごとの合計（新しい順）。記録画面用。 */
export function byDay(history = loadHistory()) {
  const map = new Map();
  for (const s of history) {
    const cur = map.get(s.date) ?? { date: s.date, reps: 0, sessions: 0 };
    cur.reps += s.reps;
    cur.sessions += 1;
    map.set(s.date, cur);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}
