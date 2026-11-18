import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.REPGATE_BASE_URL ?? 'http://127.0.0.1:8777';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ timezoneId: 'UTC' });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-08-11T12:00:00Z'));
  await page.addInitScript(() => {
    localStorage.setItem('repgate.settings.v1', JSON.stringify({ lockStart: '00:00', lockEnd: '00:00' }));
    localStorage.setItem('repgate.state.v1', JSON.stringify({ unlockedUntil: Date.now() + 60000 }));
  });
  await page.goto(base);
  await page.locator('#toSettings').focus();
  await page.evaluate(() => {
    localStorage.removeItem('repgate.state.v1');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const focused = () => page.evaluate(() => document.activeElement.id);
  const initial = await focused();
  const tabStops = [];
  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    tabStops.push(await focused());
  }
  console.log(`gate open: initial=${initial || '(body)'} tabStops=${JSON.stringify(tabStops)}`);
  assert.equal(initial, 'gateStart');
  assert.ok(tabStops.every((id) => ['', 'gateStart', 'gateSnooze'].includes(id)));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#gate').isVisible(), true);
  await page.locator('#gateSnooze').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#gate').isVisible(), false);
  assert.equal(await focused(), 'toSettings');
  console.log('Escape keeps the gate active; keyboard snooze restores focus');
} finally {
  await browser.close();
}
