// Render the film to MP4: headless Chromium (SwiftShader) → window.__frame(t) JPEGs → ffmpeg, one file per chapter,
// then concat (-c copy). Resumable: finished chapter files are skipped. Temp names are renamed on success.
// Usage: node scripts/render_mp4.js [--workers 3] [--crf 20] [--preset veryfast] [--out out] [--name energywm_v1] [--scenes 1,2]
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const WORKERS = +opt('--workers', 3), CRF = opt('--crf', '20'), PRESET = opt('--preset', 'veryfast'), FPS = 30, Q = +opt('--quality', 0.92);
const OUT = path.resolve(ROOT, opt('--out', 'out')), NAME = opt('--name', 'energywm_v1'), ONLY = opt('--scenes', null);
const PAGEQ = opt('--page', 'aa=0&scale=0.75&out=1080&q3d=1'); // capture options passed to render.html
const core = require(path.join(ROOT, 'core.js'));
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ` + a.join(' '); console.log(s); fs.appendFileSync(path.join(OUT, 'render.log'), s + '\n'); };

// static server for the repo
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});

const scenes = core.SCENES.map((s, i) => ({ i, id: s.id, start: s.start, dur: s.dur, frames: Math.round(s.dur * FPS) }))
  .filter(s => !ONLY || ONLY.split(',').map(Number).includes(s.i + 1));
const fileOf = s => path.join(OUT, `scene${String(s.i + 1).padStart(2, '0')}_${s.id}.mp4`);

async function renderScene(page, s) {
  const final = fileOf(s), tmp = final.replace(/\.mp4$/, '.tmp.mp4');
  if (fs.existsSync(final)) { log(`skip ${path.basename(final)} (exists)`); return; }
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
  const t0 = Date.now();
  for (let k = 0; k < s.frames; k++) {
    const t = s.start + k / FPS;
    const b64 = await page.evaluate(([t, q]) => window.__frame(t, q), [t, Q]);
    if (!b64) throw new Error('frame failed at t=' + t);
    if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (k % 150 === 149) log(`${s.id}: ${k + 1}/${s.frames} frames, ${((Date.now() - t0) / (k + 1)).toFixed(0)} ms/frame`);
  }
  ff.stdin.end(); await done;
  fs.renameSync(tmp, final);
  log(`done ${path.basename(final)} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  // balance chapters over workers by frame count (longest first)
  const groups = Array.from({ length: WORKERS }, () => ({ n: 0, list: [] }));
  [...scenes].sort((a, b) => b.frames - a.frames).forEach(s => { const g = groups.reduce((a, b) => a.n <= b.n ? a : b); g.list.push(s); g.n += s.frames; });
  log(`page options: ${PAGEQ}`); log(`rendering ${scenes.length} chapters, ${scenes.reduce((a, s) => a + s.frames, 0)} frames, ${WORKERS} workers`);
  await Promise.all(groups.map(async (g, wi) => {
    if (!g.list.length) return;
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => log(`[w${wi}] pageerror ${e.message}`));
    await page.goto(`http://localhost:${port}/render.html?headless=1&${PAGEQ}`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
    for (const s of g.list.sort((a, b) => a.i - b.i)) await renderScene(page, s);
    await browser.close();
  }));
  server.close();
  if (!ONLY) {
    const list = path.join(OUT, 'concat.txt');
    fs.writeFileSync(list, core.SCENES.map((s, i) => `file '${path.basename(fileOf({ i, id: s.id }))}'`).join('\n') + '\n');
    const tmp = path.join(OUT, NAME + '.tmp.mp4'), fin = path.join(OUT, NAME + '.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', tmp]);
    fs.renameSync(tmp, fin);
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height,r_frame_rate', '-of', 'json', fin]).toString();
    log('final', fin, probe.replace(/\s+/g, ' '));
  }
})().catch(e => { log('ERROR', e.stack || e); process.exit(1); });
