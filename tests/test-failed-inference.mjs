import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.REPGATE_BASE_URL ?? 'http://127.0.0.1:8777';
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
try {
  const context = await browser.newContext({ permissions: ['camera'], timezoneId: 'UTC' });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-08-11T12:00:00Z'));
  await page.route('**/vision_bundle.mjs', (route) => route.fulfill({
    contentType: 'text/javascript',
    headers: { 'access-control-allow-origin': '*' },
    body: `
      export class FilesetResolver {
        static async forVisionTasks() {}
      }
      export class PoseLandmarker {
        static POSE_CONNECTIONS = [];
        static async createFromOptions() { return new PoseLandmarker(); }
        detectForVideo() {
          window.testFrameCount = (window.testFrameCount ?? 0) + 1;
          if (window.testFrameCount > 1) throw new Error('Test inference failure');
          return { landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))] };
        }
      }
    `,
  }));
  await page.goto(base);
  await page.click('#startNow');
  await page.waitForFunction(() => window.testFrameCount > 2);
  await page.waitForTimeout(1700);
  const ready = await page.locator('#beginWorkout').isEnabled();
  const checklist = await page.locator('#checklist').textContent();
  console.log(`one successful frame followed by inference errors: ready=${ready}, checklist=${JSON.stringify(checklist)}`);
  assert.equal(ready, false);
  assert.match(checklist, /人が見つかりません/);
} finally {
  await browser.close();
}
