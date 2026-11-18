import { chromium } from 'playwright';
const dir = new URL('./output', import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const base = process.env.REPGATE_BASE_URL ?? 'http://127.0.0.1:8777';
await page.goto(`${base}/index.html`);
// 24時間ゲート有効・未解除の状態を作る
await page.evaluate(() => {
  localStorage.setItem('repgate.settings.v1', JSON.stringify({
    exercise: 'situp', targetReps: 10, lockStart: '00:00', lockEnd: '00:00', intervalMin: 60, facing: 'user',
  }));
  localStorage.setItem('repgate.state.v1', JSON.stringify({ unlockedUntil: 0, snoozeUntil: 0 }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#gate:not([hidden])', { timeout: 5000 });
await page.screenshot({ path: `${dir}/shot-gate.png` });
console.log('gate visible:', await page.isVisible('#gate'), '/ req:', await page.textContent('#gateReq'));
await browser.close();
