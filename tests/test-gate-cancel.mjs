import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.REPGATE_BASE_URL ?? 'http://127.0.0.1:8777';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('repgate.settings.v1', JSON.stringify({ lockStart: '00:00', lockEnd: '00:00' }));
  });
  await page.goto(base);
  await page.click('#gateStart');
  await page.click('[data-name="setup"] [data-back]');
  const visible = await page.locator('#gate').isVisible();
  console.log(`gate visible immediately after cancelling setup: ${visible}`);
  assert.equal(visible, true);
} finally {
  await browser.close();
}
