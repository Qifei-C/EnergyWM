// Render selected frames to PNG for inspection: node frames.js 5 20 55 ...
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs'), path = require('path');
for (const f of fs.readdirSync(path.join(__dirname, 'fonts'))) GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', f), f.startsWith('Lora') ? 'Lora' : 'Inter');
const core = require('./core.js');
const env = core.createEnv((w, h) => createCanvas(w, h));
const times = process.argv.slice(2).map(Number);
const outDir = process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : path.join(__dirname, 'preview');
fs.mkdirSync(outDir, { recursive: true });
const cv = createCanvas(core.W, core.H), ctx = cv.getContext('2d');
const t0 = Date.now();
for (const t of times) {
  if (isNaN(t)) continue;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  core.draw(ctx, t, env);
  fs.writeFileSync(path.join(outDir, `f_${String(t).replace('.', 'p')}.png`), cv.toBuffer('image/png'));
}
console.log(`rendered ${times.length} frames in ${Date.now() - t0} ms; total duration ${core.DUR}s`);
