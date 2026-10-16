// Builds nothing itself: run `npm run build` first. Serves dist/ with `vite preview`,
// opens it in headless Chromium, checks the layout geometry, takes screenshots and
// exercises every export button. Outputs land in e2e/screenshots/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';
import lz from 'lz-string';

const OUT = 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'warn' });
const base = 'http://localhost:4179/';
const browser = await chromium.launch();
let failed = false;

async function inspect(name, url, { exports = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__uml?.layout());
  const info = await page.evaluate(() => {
    const l = window.__uml.layout();
    return {
      width: l.width, height: l.height, nodes: l.nodes.length, edges: l.edges.length,
      problems: window.__uml.problems(),
      fontOk: document.fonts.check('700 14px "Source Sans 3"'),
      status: document.getElementById('status').textContent,
    };
  });
  const aspect = (info.width / info.height).toFixed(2);
  console.log(`[${name}] ${info.nodes} nodes, ${info.edges} edges, ${info.width}×${info.height} (aspect ${aspect}), font loaded: ${info.fontOk}`);
  console.log(`[${name}] status: ${info.status}`);
  if (info.problems.length) { failed = true; console.log(`[${name}] PROBLEMS:`, info.problems); }
  if (errors.length) { failed = true; console.log(`[${name}] page errors:`, errors); }

  await page.screenshot({ path: `${OUT}/${name}-app.png` });
  // Full-resolution diagram: render the SVG alone at its natural size.
  const svg = await page.evaluate(() => document.querySelector('#stage svg').outerHTML);
  const shot = await ctx.newPage();
  await shot.setViewportSize({ width: info.width, height: info.height });
  await shot.goto(base); // same origin so Google Fonts load the same way
  await shot.evaluate((s) => {
    document.body.innerHTML = s;
    document.body.style.cssText = 'margin:0;display:block;overflow:visible;background:#fff';
  }, svg);
  await shot.evaluate(() => document.fonts.ready);
  await shot.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

  if (exports) {
    for (const [id, file] of [['export-svg', 'svg'], ['export-png', 'png'], ['export-pdf', 'pdf'], ['export-drawio', 'drawio']]) {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(`#${id}`)]);
      await dl.saveAs(`${OUT}/${name}-export.${file}`);
      console.log(`[${name}] exported ${dl.suggestedFilename()}`);
    }
  }

  // Error handling: break the text and confirm the old diagram stays.
  if (exports) {
    await page.click('.cm-content');
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n\nthis is not valid');
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({
      status: document.getElementById('status').textContent,
      lint: document.querySelectorAll('.cm-lintRange-error').length,
      svg: !!document.querySelector('#stage svg'),
    }));
    console.log(`[${name}] after bad edit: ${JSON.stringify(after)}`);
    if (!after.svg || !after.lint || !/Line \d+/.test(after.status)) failed = true;
    await page.screenshot({ path: `${OUT}/${name}-error.png` });
  }
  await ctx.close();
}

try {
  await inspect('gof', base, { exports: true });
  const library = readFileSync('src/examples/library.uml', 'utf8');
  await inspect('library', `${base}#code=${lz.compressToEncodedURIComponent(library)}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
writeFileSync(`${OUT}/.ran`, new Date().toISOString());
if (failed) { console.log('E2E FAILED'); process.exit(1); }
console.log('E2E OK');
