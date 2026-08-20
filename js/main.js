// 画面のつなぎこみ。カメラ、計測ループ、ゲートの判定をここで束ねる。

import { createLandmarker, detect, drawSkeleton, LM_NAME } from './pose.js';
import { EXERCISES, EXERCISE_LIST, RepCounter, checkSetup, SETUP_HOLD_MS } from './exercises.js';
import * as store from './store.js';
import { drawResult, shareCanvas, downloadCanvas } from './result.js';

const $ = (id) => document.getElementById(id);

const els = {
  body: document.body,
  video: $('video'), overlay: $('overlay'),
  video2: $('video2'), overlay2: $('overlay2'),
  guideTitle: $('guideTitle'), guideBody: $('guideBody'),
  setupLead: $('setupLead'), checklist: $('checklist'), beginWorkout: $('beginWorkout'),
  repCount: $('repCount'), repTarget: $('repTarget'), hudMsg: $('hudMsg'),
  meterFill: $('meterFill'), debugLine: $('debugLine'),
  todayReps: $('todayReps'), streak: $('streak'), totalReps: $('totalReps'),
  nextGate: $('nextGate'), requirement: $('requirement'),
  exerciseSeg: $('exerciseSeg'), exerciseHint: $('exerciseHint'),
  targetReps: $('targetReps'), lockStart: $('lockStart'), lockEnd: $('lockEnd'),
  intervalMin: $('intervalMin'), notifyState: $('notifyState'), cameraSeg: $('cameraSeg'),
  resultCanvas: $('resultCanvas'), ratioSeg: $('ratioSeg'), sessionStats: $('sessionStats'),
  historyList: $('historyList'),
  gate: $('gate'), gateReq: $('gateReq'),
};

let settings = store.loadSettings();
let stream = null;
let rafId = null;
let mode = null;             // 'setup' | 'workout'
let counter = null;
let lastResult = null;
let lastVideoTime = -1;
let setupOkSince = 0;
let sessionStartedAt = 0;
let lastSession = null;
let ratio = '4:5';
let messageTimer = 0;

/* ============================ 画面遷移 ============================ */

function setView(name) {
  els.body.dataset.view = name;
  if (name !== 'setup' && name !== 'workout') stopLoop();
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => setView('home'));
});

$('toSettings').addEventListener('click', () => setView('settings'));
$('toHistory').addEventListener('click', () => setView('history'));

/* ============================ ホーム ============================ */

function renderHome() {
  const history = store.loadHistory();
  els.todayReps.textContent = store.todayReps(history);
  els.streak.textContent = store.streakDays(history);
  els.totalReps.textContent = store.totalReps(history);
  els.requirement.textContent = requirementText();
  els.nextGate.textContent = describeNextGate();
}

function requirementText() {
  const def = EXERCISES[settings.exercise] ?? EXERCISES.situp;
  return `${def.name} ${settings.targetReps}回`;
}

/* ============================ 設定 ============================ */

function buildExerciseSeg() {
  els.exerciseSeg.innerHTML = '';
  for (const def of EXERCISE_LIST) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.exercise = def.id;
    b.textContent = def.name;
    b.addEventListener('click', () => {
      settings.exercise = def.id;
      store.saveSettings(settings);
      syncSettingsUI();
    });
    els.exerciseSeg.appendChild(b);
  }
}

function syncSettingsUI() {
  els.exerciseSeg.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.exercise === settings.exercise));
  });
  els.cameraSeg.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.facing === settings.facing));
  });
  els.exerciseHint.textContent = (EXERCISES[settings.exercise] ?? EXERCISES.situp).setupHint;
  els.targetReps.value = settings.targetReps;
  els.lockStart.value = settings.lockStart;
  els.lockEnd.value = settings.lockEnd;
  els.intervalMin.value = settings.intervalMin;
  els.body.dataset.facing = settings.facing;
  renderNotifyState();
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

els.targetReps.addEventListener('change', () => {
  settings.targetReps = clampInt(els.targetReps.value, 1, 100, 10);
  store.saveSettings(settings);
  syncSettingsUI();
});

els.intervalMin.addEventListener('change', () => {
  settings.intervalMin = clampInt(els.intervalMin.value, 1, 720, 60);
  store.saveSettings(settings);
  syncSettingsUI();
});

document.querySelectorAll('[data-step]').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.targetReps = clampInt(settings.targetReps + Number(btn.dataset.step), 1, 100, 10);
    store.saveSettings(settings);
    syncSettingsUI();
  });
});

document.querySelectorAll('[data-step-min]').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.intervalMin = clampInt(settings.intervalMin + Number(btn.dataset.stepMin), 1, 720, 60);
    store.saveSettings(settings);
    syncSettingsUI();
  });
});

els.lockStart.addEventListener('change', () => {
  settings.lockStart = els.lockStart.value || '21:00';
  store.saveSettings(settings);
});

els.lockEnd.addEventListener('change', () => {
  settings.lockEnd = els.lockEnd.value || '02:00';
  store.saveSettings(settings);
});

els.cameraSeg.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    settings.facing = b.dataset.facing;
    store.saveSettings(settings);
    syncSettingsUI();
  });
});

$('resetAll').addEventListener('click', () => {
  if (!confirm('記録と設定をすべて消します。元に戻せません。')) return;
  store.clearAll();
  settings = store.loadSettings();
  syncSettingsUI();
  setView('home');
});

function renderNotifyState() {
  if (!('Notification' in window)) {
    els.notifyState.textContent = 'この環境では通知を出せません。';
    return;
  }
  const map = { granted: '許可されています。', denied: '拒否されています。ブラウザの設定から変更できます。', default: 'まだ許可していません。' };
  els.notifyState.textContent = map[Notification.permission] ?? '';
}

$('askNotify').addEventListener('click', async () => {
  if (!('Notification' in window)) return renderNotifyState();
  await Notification.requestPermission();
  renderNotifyState();
});

/* ============================ ゲートの判定 ============================ */

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** その時刻がロック時間帯に入っているか。開始と終了が同じなら24時間有効。 */
function inLockWindow(date) {
  const start = minutesOf(settings.lockStart);
  const end = minutesOf(settings.lockEnd);
  const t = date.getHours() * 60 + date.getMinutes();
  if (start === end) return true;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

function wouldGateClose(epochMs, state) {
  if (epochMs < state.unlockedUntil) return false;
  if (epochMs < state.snoozeUntil) return false;
  return inLockWindow(new Date(epochMs));
}

function gateShouldBeClosed(now = Date.now()) {
  return wouldGateClose(now, store.loadState());
}

/** 次にゲートが閉じる時刻。1分刻みで48時間先まで探す。 */
function describeNextGate() {
  const state = store.loadState();
  const now = Date.now();
  if (wouldGateClose(now, state)) return 'いま（ゲート中）';

  for (let i = 1; i <= 60 * 48; i += 1) {
    const t = now + i * 60000;
    if (wouldGateClose(t, state)) {
      const d = new Date(t);
      const p = (n) => String(n).padStart(2, '0');
      const sameDay = d.toDateString() === new Date(now).toDateString();
      const mins = Math.round((t - now) / 60000);
      const when = `${sameDay ? '' : '明日 '}${p(d.getHours())}:${p(d.getMinutes())}`;
      return mins < 60 ? `${when}（あと${mins}分）` : when;
    }
  }
  return '設定なし';
}

function openGate() {
  if (!els.gate.hidden) return;
  els.gate.hidden = false;
  els.gateReq.textContent = requirementText();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('RepGate', { body: `${requirementText()}で解除できます`, tag: 'repgate-gate' });
    } catch { /* 通知が出せなくても動作は続ける */ }
  }
}

function closeGate() {
  els.gate.hidden = true;
}

function checkGate() {
  if (els.body.dataset.view === 'workout' || els.body.dataset.view === 'setup') return;
  if (gateShouldBeClosed()) openGate();
  else closeGate();
  if (els.body.dataset.view === 'home') {
    els.nextGate.textContent = describeNextGate();
  }
}

$('gateStart').addEventListener('click', () => {
  closeGate();
  beginSetup();
});

$('gateSnooze').addEventListener('click', () => {
  const state = store.loadState();
  state.snoozeUntil = Date.now() + 5 * 60000;
  store.saveState(state);
  closeGate();
  renderHome();
});

setInterval(checkGate, 15000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkGate();
});

/* ============================ カメラと計測ループ ============================ */

$('startNow').addEventListener('click', beginSetup);
$('abortWorkout').addEventListener('click', () => {
  stopLoop();
  stopCamera();
  setView('home');
});

async function beginSetup() {
  const def = EXERCISES[settings.exercise] ?? EXERCISES.situp;
  mode = 'setup';
  setupOkSince = 0;
  lastResult = null;
  lastVideoTime = -1;
  els.beginWorkout.disabled = true;
  els.guideTitle.textContent = 'カメラを準備しています…';
  els.guideBody.textContent = '';
  els.setupLead.textContent = def.setupHint;
  els.checklist.innerHTML = '';
  setView('setup');

  try {
    await startCamera();
  } catch (err) {
    els.guideTitle.textContent = 'カメラを使えませんでした';
    els.guideBody.textContent =
      err?.name === 'NotAllowedError'
        ? 'ブラウザの設定でカメラを許可してから、もう一度開いてください。'
        : `${err?.message ?? err}`;
    return;
  }

  els.guideTitle.textContent = '判定の準備をしています…';
  els.guideBody.textContent = '初回はモデルの読み込みに少し時間がかかります。';
  try {
    await createLandmarker();
  } catch (err) {
    els.guideTitle.textContent = '判定エンジンを読み込めませんでした';
    els.guideBody.textContent = 'ネットワークにつながっているか確認してください。';
    return;
  }

  els.guideTitle.textContent = def.guideTitle;
  els.guideBody.textContent = def.guideBody;
  startLoop();
}

async function startCamera() {
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: settings.facing, width: { ideal: 960 }, height: { ideal: 720 } },
    audio: false,
  });
  for (const v of [els.video, els.video2]) {
    v.srcObject = stream;
    await v.play().catch(() => {});
  }
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function startLoop() {
  if (rafId) return;
  const step = () => {
    rafId = requestAnimationFrame(step);
    tick();
  };
  rafId = requestAnimationFrame(step);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function activeEls() {
  return mode === 'workout'
    ? { video: els.video2, canvas: els.overlay2 }
    : { video: els.video, canvas: els.overlay };
}

function tick() {
  const { video, canvas } = activeEls();
  if (!video || !video.videoWidth) return;

  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      lastResult = detect(video, performance.now());
    } catch (err) {
      console.warn('推論に失敗しました', err);
    }
    if (lastResult) handleResult(lastResult);
  }

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const landmarks = lastResult?.landmarks?.[0];
  if (landmarks) {
    const color = mode === 'workout' && counter?.phase === 'contracted' ? '#ff5a3c' : '#3ddc97';
    drawSkeleton(ctx, landmarks, canvas.width, canvas.height, color);
  }
}

function handleResult(result) {
  const landmarks = result.landmarks?.[0];
  const world = result.worldLandmarks?.[0];
  const def = EXERCISES[settings.exercise] ?? EXERCISES.situp;

  if (mode === 'setup') {
    handleSetupFrame(def, landmarks);
  } else if (mode === 'workout' && counter) {
    handleWorkoutFrame(landmarks, world);
  }
}

function handleSetupFrame(def, landmarks) {
  if (!landmarks) {
    els.checklist.innerHTML = '<span class="chip chip--ng">人が見つかりません</span>';
    setupOkSince = 0;
    els.beginWorkout.disabled = true;
    return;
  }

  const { ok, parts } = checkSetup(def, landmarks);

  const seen = new Set();
  els.checklist.innerHTML = '';
  for (const p of parts) {
    const name = LM_NAME[p.index] ?? '体';
    if (seen.has(name)) continue;
    seen.add(name);
    const chip = document.createElement('span');
    const good = p.visibility >= 0.6;
    chip.className = `chip ${good ? 'chip--ok' : 'chip--ng'}`;
    chip.textContent = good ? `${name} OK` : `${name} が見えません`;
    els.checklist.appendChild(chip);
  }

  const now = performance.now();
  if (ok) {
    if (!setupOkSince) setupOkSince = now;
    const held = now - setupOkSince;
    if (held >= SETUP_HOLD_MS) {
      els.beginWorkout.disabled = false;
      els.setupLead.textContent = '準備できました。はじめられます。';
    } else {
      els.beginWorkout.disabled = true;
      els.setupLead.textContent = `そのまま静止してください（あと ${((SETUP_HOLD_MS - held) / 1000).toFixed(1)} 秒）`;
    }
  } else {
    setupOkSince = 0;
    els.beginWorkout.disabled = true;
    els.setupLead.textContent = def.setupHint;
  }
}

els.beginWorkout.addEventListener('click', () => {
  const def = EXERCISES[settings.exercise] ?? EXERCISES.situp;
  counter = new RepCounter(def);
  mode = 'workout';
  lastVideoTime = -1;
  sessionStartedAt = Date.now();
  els.repCount.textContent = '0';
  els.repTarget.textContent = settings.targetReps;
  showHudMessage('はじめ', 'ok');
  setView('workout');
  startLoop();
});

function handleWorkoutFrame(landmarks, world) {
  if (!landmarks) {
    showHudMessage('体が映っていません', 'warn', 400);
    return;
  }

  const out = counter.update(landmarks, world, performance.now());
  els.repCount.textContent = counter.count;
  els.meterFill.style.width = `${Math.round(out.progress * 100)}%`;
  els.debugLine.textContent =
    out.angle == null ? '角度: —' : `角度 ${out.angle.toFixed(0)}° ／ ${counter.phase} ／ 判定 ${counter.def.contractedBelow}°–${counter.def.extendedAbove}°`;

  if (out.event === 'counted') showHudMessage(out.message, 'ok', 700);
  else if (out.event) showHudMessage(out.message, 'warn', 1200);
  else if (!out.visible) showHudMessage(out.message, 'warn', 400);

  if (counter.count >= settings.targetReps) finishWorkout();
}

function showHudMessage(text, kind = '', ms = 900) {
  els.hudMsg.textContent = text;
  els.hudMsg.dataset.kind = kind;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    els.hudMsg.textContent = '';
    els.hudMsg.dataset.kind = '';
  }, ms);
}

/* ============================ 完了とリザルト ============================ */

function finishWorkout() {
  stopLoop();
  stopCamera();
  mode = null;

  const def = counter.def;
  const seconds = (Date.now() - sessionStartedAt) / 1000;

  lastSession = {
    date: store.dateKey(),
    at: sessionStartedAt,
    exercise: def.id,
    exerciseName: def.name,
    reps: counter.count,
    seconds: Math.round(seconds),
    log: counter.log,
  };
  store.addSession(lastSession);

  const state = store.loadState();
  state.unlockedUntil = Date.now() + settings.intervalMin * 60000;
  state.snoozeUntil = 0;
  store.saveState(state);

  closeGate();
  renderResult();
  setView('result');
}

function renderResult() {
  if (!lastSession) return;
  drawResult(els.resultCanvas, {
    reps: lastSession.reps,
    exerciseName: lastSession.exerciseName,
    seconds: lastSession.seconds,
    streak: store.streakDays(),
    date: new Date(lastSession.at),
    ratio,
  });

  const rows = [
    ['種目', lastSession.exerciseName],
    ['回数', `${lastSession.reps}回`],
    ['かかった時間', `${lastSession.seconds}秒`],
    ['次のゲート', describeNextGate()],
  ];
  if (lastSession.log.length) {
    const times = lastSession.log.map((r) => r.ms);
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    rows.push(['1レップ平均', `${(avg / 1000).toFixed(2)}秒`]);
    rows.push(['最短 / 最長', `${(Math.min(...times) / 1000).toFixed(2)} / ${(Math.max(...times) / 1000).toFixed(2)}秒`]);
  }
  els.sessionStats.innerHTML = rows
    .map(([k, v]) => `<div class="row"><span class="row__k">${k}</span><strong class="row__v">${v}</strong></div>`)
    .join('');
}

els.ratioSeg.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    ratio = b.dataset.ratio;
    els.ratioSeg.querySelectorAll('button').forEach((x) => {
      x.setAttribute('aria-checked', String(x.dataset.ratio === ratio));
    });
    renderResult();
  });
});

$('shareBtn').addEventListener('click', async () => {
  const result = await shareCanvas(els.resultCanvas, 'repgate.png');
  if (result === 'unsupported') {
    await downloadCanvas(els.resultCanvas, 'repgate.png');
    alert('この環境では共有シートを開けないため、画像を保存しました。SNSアプリから選んで投稿してください。');
  }
});

$('downloadBtn').addEventListener('click', () => downloadCanvas(els.resultCanvas, 'repgate.png'));

/* ============================ 記録 ============================ */

function renderHistory() {
  const days = store.byDay();
  if (!days.length) {
    els.historyList.innerHTML = '<p class="empty">まだ記録がありません。</p>';
    return;
  }
  els.historyList.innerHTML = days
    .slice(0, 60)
    .map((d) => `<div class="hist"><span class="hist__d">${d.date}</span><span class="hist__v">${d.reps}回 ／ ${d.sessions}セット</span></div>`)
    .join('');
}

$('exportLog').addEventListener('click', () => {
  const history = store.loadHistory();
  const lines = ['date,startedAt,exercise,reps,seconds,rep_n,rep_ms,min_angle,max_angle'];
  for (const s of history) {
    if (!s.log?.length) {
      lines.push([s.date, new Date(s.at).toISOString(), s.exercise, s.reps, s.seconds, '', '', '', ''].join(','));
      continue;
    }
    for (const r of s.log) {
      lines.push([s.date, new Date(s.at).toISOString(), s.exercise, s.reps, s.seconds, r.n, r.ms, r.minAngle, r.maxAngle].join(','));
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'repgate-log.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ============================ 起動 ============================ */

buildExerciseSeg();
syncSettingsUI();
renderHome();
checkGate();
