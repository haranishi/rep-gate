import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.REPGATE_BASE_URL ?? 'http://127.0.0.1:8777';
const browser = await chromium.launch();
const cases = [
  { name: 'last seconds of window', now: '2026-08-11T10:00:40Z', start: '12:00', end: '12:01', until: '2026-08-11T12:00:50Z', expected: '12:00' },
  { name: 'exclusive end', now: '2026-08-11T10:00:40Z', start: '12:00', end: '12:01', until: '2026-08-11T12:01:00Z', expected: '明日 12:00' },
  { name: 'day after tomorrow', now: '2026-08-11T23:45:00Z', start: '05:00', end: '05:01', until: '2026-08-12T05:02:00Z', expected: '8/13 05:00' },
  { name: 'spring DST gap', now: '2026-03-08T01:59:50-05:00', start: '02:00', end: '02:01', timezoneId: 'America/New_York', expected: '明日 02:00' },
];
const mismatches = [];
try {
  for (const { name, now, start, end, until, timezoneId = 'UTC', expected } of cases) {
    const context = await browser.newContext({ timezoneId });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.addInitScript(({ start, end, unlockedUntil }) => {
      localStorage.setItem('repgate.settings.v1', JSON.stringify({ lockStart: start, lockEnd: end }));
      localStorage.setItem('repgate.state.v1', JSON.stringify({ unlockedUntil }));
    }, { start, end, unlockedUntil: until ? Date.parse(until) : 0 });
    await page.goto(base);
    const actual = await page.locator('#nextGate').textContent();
    console.log(`${name}: ${actual}`);
    if (actual !== expected) mismatches.push({ name, actual, expected });
    await context.close();
  }
} finally {
  await browser.close();
}
assert.deepEqual(mismatches, []);
