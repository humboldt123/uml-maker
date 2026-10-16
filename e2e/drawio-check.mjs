// Renders an exported .drawio file with draw.io's own viewer (client-side, nothing is
// uploaded) and screenshots it, to compare against the app's rendering.
// Usage: node e2e/drawio-check.mjs e2e/screenshots/gof-export.drawio
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const file = process.argv[2] ?? 'e2e/screenshots/gof-export.drawio';
const xml = readFileSync(file, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2600, height: 2000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.setContent('<!doctype html><body style="margin:0;background:#fff"></body>');
await page.addScriptTag({ url: 'https://viewer.diagrams.net/js/viewer-static.min.js' });
await page.evaluate((x) => {
  const div = document.createElement('div');
  div.className = 'mxgraph';
  div.setAttribute('data-mxgraph', JSON.stringify({ xml: x, toolbar: '', nav: false, resize: true, border: 0 }));
  document.body.appendChild(div);
  // eslint-disable-next-line no-undef
  GraphViewer.processElements();
}, xml);
await page.waitForSelector('.mxgraph svg', { timeout: 30000, state: 'attached' });
await page.waitForTimeout(2500); // web fonts
const box = await page.evaluate(() => {
  const r = document.querySelector('.mxgraph svg').getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
console.log('draw.io viewer rendered', box, errors.length ? errors : 'no errors');
await page.screenshot({ path: file.replace(/\.drawio$/, '-drawio.png'), fullPage: true });
await browser.close();
