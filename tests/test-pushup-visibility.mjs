import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.REPGATE_BASE_URL ?? 'http://127.0.0.1:8777';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(base);
  const result = await page.evaluate(async () => {
    const { checkSetup, EXERCISES, RepCounter } = await import('/js/exercises.js');
    const def = EXERCISES.pushup;
    function landmarks(angle, leftTorso, right) {
      const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
      const radians = angle * Math.PI / 180;
      for (const offset of [0, 1]) {
        const arm = offset ? right : 1;
        const torso = offset ? right : leftTorso;
        points[11 + offset] = { x: 0, y: 1, visibility: arm };
        points[13 + offset] = { x: 1, y: 1, visibility: arm };
        points[15 + offset] = { x: 1 - Math.cos(radians), y: 1 + Math.sin(radians), visibility: arm };
        points[23 + offset] = { x: 0, y: 0, visibility: torso };
        points[25 + offset] = { x: 0, y: -1, visibility: torso };
      }
      return points;
    }
    function count(torso) {
      const counter = new RepCounter(def);
      for (const [angle, time] of [[170, 0], [120, 200], [75, 600], [170, 1200]]) {
        counter.update(landmarks(angle, torso, 0), null, time);
      }
      return counter.count;
    }
    const { ok, side } = checkSetup(def, landmarks(170, 0.2, 0.7));
    return { invisibleTorso: count(0.2), visibleTorso: count(1), setup: { ok, side } };
  });
  console.log(JSON.stringify(result));
  assert.deepEqual(result, { invisibleTorso: 0, visibleTorso: 1, setup: { ok: true, side: 'right' } });
} finally {
  await browser.close();
}
