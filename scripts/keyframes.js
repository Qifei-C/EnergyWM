// Render keyframes of render.html in headless Chromium (SwiftShader WebGL).
// Usage: node scripts/keyframes.js [--out preview] [--port 8787] t1 t2 ...
// Expects a static server on the repo root (python3 -m http.server 8787).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const out = opt('--out', path.join(__dirname, '..', 'preview')), port = opt('--port', '8787'), scale = +opt('--scale', '1');
const times = argv.map(Number).filter(x => !isNaN(x));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { errors.push(`[${m.type()}] ${m.text()}`); } });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/render.html?headless=1`);
  await page.waitForFunction('window.__ready === true || (window.__errors && window.__errors.length > 0)', null, { timeout: 120000 });
  const errs = await page.evaluate('window.__errors');
  if (errs.length) { console.log('BOOT ERRORS', errs); }
  console.log('boot ms', Date.now() - t0, await page.evaluate('JSON.stringify(window.__world && window.__world.ikResidual)'));
  for (const t of times) {
    const a = Date.now();
    await page.evaluate(t => window.__render(t), t);
    const b = Date.now();
    const file = path.join(out, `kf_${String(t.toFixed(1)).replace('.', 'p').padStart(6, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    console.log(`t=${t} render ${b - a} ms, shot ${Date.now() - b} ms -> ${path.basename(file)}`);
  }
  if (errors.length) console.log('CONSOLE:\n' + [...new Set(errors)].join('\n'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
