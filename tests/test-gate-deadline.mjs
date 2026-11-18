import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.REPGATE_BASE_URL ?? 'http://127.0.0.1:8777';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ timezoneId: 'UTC' });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-08-11T11:59:45Z') });
  await page.clock.pauseAt(new Date('2026-08-11T11:59:55Z'));
  await page.addInitScript(() => {
    localStorage.setItem('repgate.settings.v1', JSON.stringify({ lockStart: '12:00', lockEnd: '12:01' }));
    localStorage.setItem('repgate.state.v1', JSON.stringify({ unlockedUntil: Date.parse('2026-08-11T12:00:56Z') }));
  });
  await page.goto(base);
  const gate = page.locator('#gate');
  await page.clock.runFor(60000);
  const before = await gate.isVisible();
  await page.clock.runFor(2500);
  const during = await gate.isVisible();
  await page.clock.runFor(3500);
  const after = await gate.isVisible();
  console.log(`short remaining gate: before=${before} during=${during} after=${after}`);
  assert.deepEqual([before, during, after], [false, true, false]);
} finally {
  await browser.close();
}
