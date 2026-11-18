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
  await page.route('**/vision_bundle.mjs', (route) => route.abort('failed'));
  await page.goto(base);
  await page.click('#toSettings');
  assert.equal(await page.locator('body').getAttribute('data-view'), 'settings');
  await page.click('[data-name="settings"] [data-back]');
  await page.click('#toHistory');
  assert.equal(await page.locator('body').getAttribute('data-view'), 'history');
  await page.click('[data-name="history"] [data-back]');
  await page.click('#startNow');
  await page.waitForFunction(() => document.querySelector('#guideTitle').textContent.includes('読み込めません'));
  console.log('CDN blocked: settings and history open; camera setup shows a model loading error');
} finally {
  await browser.close();
}
