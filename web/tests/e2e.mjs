// End-to-end browser test of the built caregiver demo (run `npm run build` first).
// Plays the replay in headless Chromium: forecasts render, the accuracy table
// matches results/metrics.json, alerts appear in plain English with no dosing
// advice, "I'm on it" stops escalation, and the layout holds on a phone.
// Run: npx playwright install chromium && npm run build && node tests/e2e.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('../dist/', import.meta.url).pathname;
const metrics = JSON.parse(await readFile(join(root, 'metrics.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const errors = [];
const pct = (p) => `${(p * 100).toFixed(1)}%`;

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.getByRole('button', { name: 'Skip to next alert' }).waitFor();

  // The accuracy table shows the published numbers, not hard-coded ones.
  const ours = await page.locator('tr.ours').innerText();
  assert.ok(ours.includes(pct(metrics.test.model.accuracy)), ours);
  assert.ok(ours.includes(pct(metrics.low_alerts.test.model.caught_early)), ours);

  // Playing advances the clock and scores forecasts.
  const before = await page.locator('.now .label').innerText();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('radio', { name: 'Fast' }).click();
  await page.waitForFunction((b) => document.querySelector('.now .label').innerText !== b, before);
  await page.getByRole('button', { name: 'Pause' }).click();

  // Skip to an alert: plain English, never a dose.
  await page.getByRole('button', { name: 'Skip to next alert' }).click();
  const text = await page.locator('.alert-text').innerText();
  assert.match(text, /glucose/);
  assert.doesNotMatch(text, /\bunits?\b|insulin|glucagon|take \d/i, 'no dosing advice');
  await page.getByRole('button', { name: "I'm on it" }).click();
  await page.locator('.acked', { hasText: 'Escalation stopped' }).waitFor();
  assert.ok((await page.locator('.feed li').count()) > 0, 'the family feed shows what happened');

  // Every simulated patient loads.
  const options = await page.locator('select option').count();
  for (let i = 1; i < options; i++) {
    await page.locator('select').selectOption(String(i));
    await page.locator('.now .reading').waitFor();
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px at ${viewport.width}px wide`);
  await page.close();
}

await browser.close();
server.close();
assert.deepEqual(errors, [], 'no errors in the browser console');
console.log('e2e: caregiver demo checks passed');
