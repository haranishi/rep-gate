const pw = await import('/Users/hara/Projects/kenkyuu-app/node_modules/playwright/index.js');
const chromium = pw.chromium ?? pw.default?.chromium;

const BASE = 'http://127.0.0.1:8777';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: ['camera'],
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });

/* ---------------- A. レップ判定ロジック（合成ランドマークで駆動） ---------------- */

const logic = await page.evaluate(async () => {
  const { RepCounter, EXERCISES } = await import('/js/exercises.js');

  // 33点のランドマークを作り、指定の3点だけ角度を作るように置く。
  const makeLandmarks = (spec) => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    for (const [idx, p] of Object.entries(spec)) lm[Number(idx)] = { z: 0, visibility: 1, ...p };
    return lm;
  };

  // 頂点 b を原点として、a を角度 deg の位置に、c を +x 方向に置く。
  const withAngle = (aIdx, bIdx, cIdx, deg, visibility = 1) => {
    const rad = (deg * Math.PI) / 180;
    return makeLandmarks({
      [bIdx]: { x: 0.5, y: 0.5, visibility },
      [cIdx]: { x: 0.7, y: 0.5, visibility },
      [aIdx]: { x: 0.5 + 0.2 * Math.cos(rad), y: 0.5 + 0.2 * Math.sin(rad), visibility },
    });
  };

  // 腹筋: 肩(11)-腰(23)-膝(25)
  const situp = (deg, vis = 1) => withAngle(11, 23, 25, deg, vis);

  // 角度の列を与えて回数と最後のイベントを返す
  const run = (defId, frames) => {
    const c = new RepCounter(EXERCISES[defId]);
    const events = [];
    for (const f of frames) {
      const out = c.update(f.lm, null, f.t);
      if (out.event) events.push(out.event);
    }
    return { count: c.count, events, log: c.log };
  };

  const out = {};

  // 1) 正常な1レップ: 伸びきり→縮み→伸びきり、1秒かける
  out.normal = run('situp', [
    { lm: situp(160), t: 0 },
    { lm: situp(120), t: 200 },
    { lm: situp(80), t: 500 },
    { lm: situp(120), t: 800 },
    { lm: situp(160), t: 1100 },
  ]);

  // 2) 速すぎる: 同じ動きを300msで
  out.tooFast = run('situp', [
    { lm: situp(160), t: 0 },
    { lm: situp(80), t: 150 },
    { lm: situp(160), t: 300 },
  ]);

  // 3) 可動域が足りない: 110度までしか曲げない
  out.partial = run('situp', [
    { lm: situp(160), t: 0 },
    { lm: situp(110), t: 500 },
    { lm: situp(160), t: 1200 },
  ]);

  // 4) 3レップ連続
  // 1レップ1000ms（最小レップ時間800msを満たす）を3回
  const frames = [{ lm: situp(160), t: 0 }];
  for (let i = 0; i < 3; i += 1) {
    const base = 1400 * i;
    frames.push({ lm: situp(80), t: base + 400 });
    frames.push({ lm: situp(160), t: base + 1400 });
  }
  out.three = run('situp', frames);

  // 5) 関節が見えていない: visibility 0.2
  out.invisible = run('situp', [
    { lm: situp(160, 0.2), t: 0 },
    { lm: situp(80, 0.2), t: 500 },
    { lm: situp(160, 0.2), t: 1200 },
  ]);

  // 6) 腕立てのフォーム判定: 肘は正しく動くが胴体が曲がっている
  const pushupLm = (elbowDeg, torsoDeg) => {
    const rad = (d) => (d * Math.PI) / 180;
    return {
      // 肩(11)-肘(13)-手首(15)
      11: { x: 0.5 + 0.2 * Math.cos(rad(elbowDeg)), y: 0.5 + 0.2 * Math.sin(rad(elbowDeg)), z: 0, visibility: 1 },
      13: { x: 0.5, y: 0.5, z: 0, visibility: 1 },
      15: { x: 0.7, y: 0.5, z: 0, visibility: 1 },
      // 胴体 肩(11)-腰(23)-膝(25) は別の位置に置く
      23: { x: 0.2, y: 0.8, z: 0, visibility: 1 },
      25: { x: 0.2 + 0.2 * Math.cos(rad(180 - torsoDeg)), y: 0.8 + 0.2 * Math.sin(rad(180 - torsoDeg)), z: 0, visibility: 1 },
    };
  };
  const pushupFrames = (torsoDeg) => {
    const build = (elbow) => {
      const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
      const spec = pushupLm(elbow, torsoDeg);
      // 肩の位置は肘角度で決まるので、胴体角は腰-膝で近似する
      for (const [i, p] of Object.entries(spec)) lm[Number(i)] = p;
      return lm;
    };
    return [
      { lm: build(170), t: 0 },
      { lm: build(80), t: 500 },
      { lm: build(170), t: 1200 },
    ];
  };
  out.pushupNoForm = run('pushup', pushupFrames(90));   // 胴体が90度＝腰が落ちている

  return out;
});

ok('正常な1レップを数える', logic.normal.count === 1, `count=${logic.normal.count}`);
ok('1レップのログに所要時間が残る', logic.normal.log[0]?.ms >= 800, JSON.stringify(logic.normal.log[0] ?? {}));
ok('速すぎるレップは数えない', logic.tooFast.count === 0 && logic.tooFast.events.includes('too_fast'), `count=${logic.tooFast.count} events=${logic.tooFast.events}`);
ok('可動域が足りないレップは数えない', logic.partial.count === 0 && logic.partial.events.includes('form'), `count=${logic.partial.count} events=${logic.partial.events}`);
ok('連続3レップを数える', logic.three.count === 3, `count=${logic.three.count}`);
ok('関節が見えないフレームは評価しない', logic.invisible.count === 0, `count=${logic.invisible.count}`);
ok('腕立てで腰が落ちたレップを弾く', logic.pushupNoForm.count === 0 && logic.pushupNoForm.events.includes('form'), `count=${logic.pushupNoForm.count} events=${logic.pushupNoForm.events}`);

/* ---------------- B. 画面遷移と設定 ---------------- */

await page.click('#toSettings');
ok('設定画面が開く', await page.evaluate(() => document.body.dataset.view) === 'settings');

await page.click('#exerciseSeg button[data-exercise="pushup"]');
const hint = await page.textContent('#exerciseHint');
ok('種目を切り替えるとヒントが変わる', /斜め前/.test(hint ?? ''), hint ?? '');

await page.click('[data-step="1"]');
await page.click('[data-step="1"]');
const target = await page.inputValue('#targetReps');
ok('回数のステッパーが効く', target === '12', `targetReps=${target}`);

await page.fill('#lockStart', '22:30');
await page.dispatchEvent('#lockStart', 'change');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('repgate.settings.v1')));
ok('設定が端末内に保存される', saved.lockStart === '22:30' && saved.exercise === 'pushup' && saved.targetReps === 12, JSON.stringify(saved));

await page.click('[data-back]');
ok('ホームに戻る', await page.evaluate(() => document.body.dataset.view) === 'home');
const req = await page.textContent('#requirement');
ok('ホームに解除条件が出る', req === '腕立て 12回', req ?? '');

/* ---------------- C. ゲートの時間帯判定 ---------------- */

const gate = await page.evaluate(() => {
  // 24時間有効（開始と終了が同じ）にして、ゲートが閉じることを確認する
  const s = JSON.parse(localStorage.getItem('repgate.settings.v1'));
  s.lockStart = '00:00';
  s.lockEnd = '00:00';
  localStorage.setItem('repgate.settings.v1', JSON.stringify(s));
  localStorage.setItem('repgate.state.v1', JSON.stringify({ unlockedUntil: 0, snoozeUntil: 0 }));
  return true;
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
ok('ロック時間帯ならゲートが閉じる', await page.isVisible('#gate'), '');

const gateReq = await page.textContent('#gateReq');
ok('ゲートに解除条件が出る', gateReq === '腕立て 12回', gateReq ?? '');

await page.click('#gateSnooze');
await page.waitForTimeout(200);
ok('あとで を押すとゲートが閉じる', !(await page.isVisible('#gate')));

// 解除済み（unlockedUntil が未来）ならゲートは出ない
await page.evaluate(() => {
  localStorage.setItem('repgate.state.v1', JSON.stringify({ unlockedUntil: Date.now() + 3600000, snoozeUntil: 0 }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
ok('解除中はゲートが出ない', !(await page.isVisible('#gate')));

/* ---------------- D. リザルト画像 ---------------- */

const resultInfo = await page.evaluate(async () => {
  const { drawResult } = await import('/js/result.js');
  const c = document.getElementById('resultCanvas');
  drawResult(c, { reps: 12, exerciseName: '腕立て', seconds: 47, streak: 5, date: new Date('2026-08-11T21:30:00'), ratio: '4:5' });
  const ctx = c.getContext('2d');
  // 完全な単色でないこと＝何か描かれていることを確認する
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const colors = new Set();
  for (let i = 0; i < data.length; i += 4 * 997) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  return { w: c.width, h: c.height, distinctColors: colors.size, dataUrlLen: c.toDataURL('image/png').length };
});
ok('リザルト画像が4:5で描かれる', resultInfo.w === 1080 && resultInfo.h === 1350, JSON.stringify(resultInfo));
ok('リザルト画像に中身がある', resultInfo.distinctColors > 5 && resultInfo.dataUrlLen > 20000, JSON.stringify(resultInfo));

await page.evaluate(async () => {
  const { drawResult } = await import('/js/result.js');
  const c = document.getElementById('resultCanvas');
  drawResult(c, { reps: 30, exerciseName: '腹筋', seconds: 62, streak: 12, date: new Date(), ratio: '1:1' });
});
const square = await page.evaluate(() => {
  const c = document.getElementById('resultCanvas');
  return { w: c.width, h: c.height };
});
ok('正方形に切り替わる', square.w === 1080 && square.h === 1080, JSON.stringify(square));

/* ---------------- E. カメラ起動とモデル読み込み ---------------- */

await page.evaluate(() => { document.body.dataset.view = 'home'; });
await page.click('#startNow');
await page.waitForTimeout(1200);
ok('セットアップ画面に移る', await page.evaluate(() => document.body.dataset.view) === 'setup');

const camOk = await page.evaluate(() => {
  const v = document.getElementById('video');
  return { w: v.videoWidth, h: v.videoHeight, playing: !v.paused };
});
ok('カメラ映像が流れる', camOk.w > 0 && camOk.playing, JSON.stringify(camOk));

// モデルのダウンロードを待つ
await page.waitForFunction(
  () => {
    const t = document.getElementById('guideTitle').textContent ?? '';
    return !t.includes('準備をしています') && !t.includes('カメラを準備');
  },
  { timeout: 60000 },
).catch(() => {});
const guideTitle = await page.textContent('#guideTitle');
ok('姿勢推定エンジンが読み込める', !/読み込めません|使えませんでした/.test(guideTitle ?? ''), guideTitle ?? '');

await page.waitForTimeout(2500);
const checklist = await page.textContent('#checklist');
const beginDisabled = await page.evaluate(() => document.getElementById('beginWorkout').disabled);
ok('人がいないフレームでは開始させない', beginDisabled === true, `checklist="${(checklist ?? '').trim()}"`);

// 推論ループが実際に回っているか（合成映像なので検出はされない前提）
const looping = await page.evaluate(() => {
  const c = document.getElementById('overlay');
  return c.width > 0 && c.height > 0;
});
ok('オーバーレイが映像サイズに同期する', looping);

/* ---------------- スクリーンショット ---------------- */

const shotDir = new URL('./output', import.meta.url).pathname;
await page.evaluate(() => { document.body.dataset.view = 'home'; });
await page.waitForTimeout(300);
await page.screenshot({ path: `${shotDir}/shot-home.png` });
await page.evaluate(() => { document.body.dataset.view = 'settings'; });
await page.waitForTimeout(200);
await page.screenshot({ path: `${shotDir}/shot-settings.png`, fullPage: true });
await page.evaluate(async () => {
  const { drawResult } = await import('/js/result.js');
  drawResult(document.getElementById('resultCanvas'), {
    reps: 12, exerciseName: '腹筋', seconds: 47, streak: 5, date: new Date('2026-08-11T21:30:00'), ratio: '4:5',
  });
  document.body.dataset.view = 'result';
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${shotDir}/shot-result.png`, fullPage: true });
await page.evaluate(() => {
  document.body.dataset.view = 'home';
  document.getElementById('gate').hidden = false;
});
await page.waitForTimeout(200);
await page.screenshot({ path: `${shotDir}/shot-gate-racy.png` });

/* ---------------- 結果 ---------------- */

const realErrors = consoleErrors.filter((e) => !/favicon|icon\.png/i.test(e));
ok('コンソールエラーなし', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
