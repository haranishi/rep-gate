import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.REPGATE_BASE_URL ?? 'http://127.0.0.1:8777';
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const failures = [];
try {
  for (const scenario of ['leave', 'late permission', 'model failure']) {
    const context = await browser.newContext({ permissions: ['camera'], timezoneId: 'UTC' });
    const page = await context.newPage();
    try {
      await page.clock.setFixedTime(new Date('2026-08-11T12:00:00Z'));
      let releaseModel;
      const model = new Promise((resolve) => { releaseModel = resolve; });
      await page.route('**/pose_landmarker_lite.task', async (route) => {
        await model;
        await route.abort('failed').catch(() => {});
      });
      await page.addInitScript(({ delay }) => {
        const media = navigator.mediaDevices;
        const capture = media.getUserMedia.bind(media);
        const permission = new Promise((resolve) => { window.releaseCamera = resolve; });
        media.getUserMedia = async (...args) => {
          const stream = await capture(...args);
          window.testTrack = stream.getVideoTracks()[0];
          if (delay) await permission;
          return stream;
        };
      }, { delay: scenario === 'late permission' });
      await page.goto(base);
      await page.click('#startNow');
      await page.waitForFunction(() => Boolean(window.testTrack));
      if (scenario === 'leave') {
        await page.waitForFunction(() => document.querySelector('#video').srcObject !== null);
        await page.click('[data-name="setup"] [data-back]');
      } else if (scenario === 'late permission') {
        await page.click('[data-name="setup"] [data-back]');
        await page.evaluate(() => window.releaseCamera());
      } else {
        releaseModel();
        await page.waitForFunction(() => document.querySelector('#guideTitle').textContent.includes('読み込めません'));
      }
      const state = await page.evaluate(() => window.testTrack.readyState);
      console.log(`${scenario}: track=${state}`);
      if (state !== 'ended') failures.push(scenario);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
assert.deepEqual(failures, []);
