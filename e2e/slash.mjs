// Drives the slash-command menu in the built app (run `npm run build` first).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';

mkdirSync('e2e/screenshots', { recursive: true });
const server = await preview({ preview: { port: 4180, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };
const doc = () => page.evaluate(() => window.__uml.source());

try {
  await page.goto('http://localhost:4180/');
  await page.waitForFunction(() => window.__uml?.layout());
  await page.click('.cm-content');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');

  await page.keyboard.type('/insert adap');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  const first = await page.textContent('.cm-tooltip-autocomplete li[aria-selected]');
  check(/Adapter/.test(first), `"/insert adap" highlights Adapter (got "${first}")`);
  await page.screenshot({ path: 'e2e/screenshots/slash-menu.png' });
  await page.keyboard.press('Enter');
  check((await doc()).includes('@group adapter: Client, Target, Adapter, Adaptee'), 'Enter inserts the Adapter pattern');

  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n/aggregation');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Client');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Adaptee');
  check((await doc()).includes('Client o-- Adaptee : has [1] [0..*]'), '/aggregation inserts a snippet whose fields Tab through');
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\n/adapter');
  await page.waitForSelector('.cm-tooltip-autocomplete');
  await page.keyboard.press('Enter');
  check((await doc()).includes('@group adapter-2: Client2, Target2, Adapter2, Adaptee2'), 'a second Adapter is renamed so nothing collides');

  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n// a comment');
  check(!(await page.$('.cm-tooltip-autocomplete')), '"//" comments do not open the menu');

  await page.waitForTimeout(900);
  const status = await page.textContent('#status');
  check(/Rendered/.test(status), `diagram renders after inserts (${status.trim()})`);
  check(!(await page.evaluate(() => window.__uml.problems().length)), 'no layout problems');
  await page.click('#fit');
  await page.screenshot({ path: 'e2e/screenshots/slash-result.png' });
  check(!errors.length, `no page errors ${errors.join(' ')}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
