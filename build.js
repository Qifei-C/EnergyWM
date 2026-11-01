// build.js — generate render.html (local deps, for headless capture / local viewing) and
// index.html (published artifact: three.js from cdnjs, fonts from Google Fonts, JS inlined)
// from one template.  Usage: node build.js
const fs = require('fs'), path = require('path');
const R = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

const TITLE = 'Energy-Field Teachers';
const CSS = `
:root {
  --bg: #F3F4F7; --fg: #1C2533; --muted: #5B6676; --panel: #FFFFFF; --line: #D5DBE3; --accent: #2F5BB7; --accent-fg: #FFFFFF; --stage: #F6F7F9;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #12161D; --fg: #E6EAF0; --muted: #9AA5B4; --panel: #1B212B; --line: #2D3542; --accent: #7EA2EE; --accent-fg: #0E1420; color-scheme: dark; }
}
:root[data-theme="dark"] { --bg: #12161D; --fg: #E6EAF0; --muted: #9AA5B4; --panel: #1B212B; --line: #2D3542; --accent: #7EA2EE; --accent-fg: #0E1420; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body { font: 15px/1.45 Inter, "DejaVu Sans", system-ui, sans-serif; }
.wrap { max-width: 1280px; margin: 0 auto; padding: 20px max(16px, env(safe-area-inset-right)) 32px max(16px, env(safe-area-inset-left)); }
header h1 { font: 600 clamp(20px, 3vw, 28px)/1.2 Lora, "DejaVu Serif", Georgia, serif; margin: 0 0 4px; }
header p { margin: 0 0 14px; color: var(--muted); }
.stage { position: relative; width: 100%; aspect-ratio: 16 / 9; background: var(--stage); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; cursor: pointer; }
.stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
#glprev, #ui { pointer-events: none; }
#glprev { visibility: hidden; }
.status { position: absolute; left: 12px; bottom: 10px; color: #5B6676; font-size: 13px; pointer-events: none; }
.stage:fullscreen { border: 0; border-radius: 0; background: #000; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 12px; }
.btn { appearance: none; border: 1px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 8px; height: 36px; min-width: 40px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font: inherit; }
.btn:hover { border-color: var(--accent); }
.btn:focus-visible, .seg:focus-visible, select:focus-visible, input:focus-visible, .chapters button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn.play { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.btn svg { width: 18px; height: 18px; fill: currentColor; }
.btn.play[data-state="play"] .i-pause, .btn.play[data-state="pause"] .i-play { display: none; }
.time { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 92px; }
#scrub { flex: 1 1 220px; min-width: 160px; accent-color: var(--accent); height: 28px; }
select { height: 36px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); padding: 0 8px; font: inherit; }
.strip { display: flex; gap: 3px; margin-top: 10px; }
.seg { appearance: none; flex: 1 1 0; min-width: 0; height: 26px; border: 1px solid var(--line); background: var(--panel); color: var(--muted); border-radius: 5px; font: 600 12px/1 Inter, system-ui, sans-serif; cursor: pointer; padding: 0; }
.seg:hover { border-color: var(--accent); color: var(--fg); }
.seg.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; margin-top: 8px; color: var(--muted); font-size: 13px; }
#sceneName { color: var(--fg); font-weight: 600; }
.chapters { list-style: none; margin: 16px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px; }
.chapters button { width: 100%; display: flex; align-items: baseline; gap: 10px; text-align: left; appearance: none; border: 1px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 8px; padding: 8px 10px; cursor: pointer; font: inherit; }
.chapters button:hover { border-color: var(--accent); }
.chapters button.on { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
.chapters .num { color: var(--accent); font-weight: 700; min-width: 1.2em; }
.chapters .nm { flex: 1; }
.chapters .tc { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 13px; }
.note { margin-top: 14px; color: var(--muted); font-size: 13px; }
html.headless body { background: #F6F7F9; overflow: hidden; }
html.headless .wrap { max-width: none; padding: 0; margin: 0; }
html.headless .chrome { display: none !important; }
html.headless .stage { width: 1920px; height: 1080px; border: 0; border-radius: 0; cursor: default; }
`;
const BODY = `
<main class="wrap">
  <header class="chrome">
    <h1>Energy-Field Teachers for Small VLAs</h1>
    <p>Motion-graphics explainer of a research plan (concept / hypothesis, 2026-11-01) · 4:42 · nothing shown is an experimental result</p>
  </header>
  <div id="stage" class="stage" role="img" aria-label="Animated explainer: robot kitchen scene with energy-field overlays">
    <canvas id="gl" width="1920" height="1080"></canvas>
    <canvas id="glprev" width="1920" height="1080"></canvas>
    <canvas id="ui" width="1920" height="1080"></canvas>
    <div id="status" class="status"></div>
  </div>
  <div class="controls chrome">
    <button id="btnPlay" class="btn play" type="button" data-state="play" aria-label="Play">
      <svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>
      <svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>
    </button>
    <span id="time" class="time">0:00 / 4:42</span>
    <input id="scrub" type="range" min="0" max="282" value="0" step="0.01" aria-label="Timeline">
    <select id="speed" aria-label="Playback speed">
      <option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option>
    </select>
    <button id="btnFull" class="btn" type="button" aria-label="Full screen" title="Full screen (F)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg>
    </button>
  </div>
  <div id="strip" class="strip chrome" role="group" aria-label="Scenes"></div>
  <div class="meta chrome"><span id="sceneName"></span><span>Space play/pause · ←/→ 5 s · 1–9 scenes · F full screen</span></div>
  <ol id="chapters" class="chapters chrome" aria-label="Chapters"></ol>
  <p class="note chrome">Kitchen is a schematic, RoboCasa-style procedural scene. Franka Panda meshes: MuJoCo Menagerie (Apache-2.0). three.js (MIT); Lora and Inter (SIL OFL).</p>
</main>`;

const FONT_FACES = [
  ['Lora', 400, 'normal', 'Lora-Regular.ttf'], ['Lora', 600, 'normal', 'Lora-SemiBold.ttf'],
  ['Lora', 400, 'italic', 'Lora-Italic.ttf'], ['Lora', 600, 'italic', 'Lora-SemiBoldItalic.ttf'],
  ['Inter', 400, 'normal', 'Inter-Regular.otf'], ['Inter', 500, 'normal', 'Inter-Medium.otf'],
  ['Inter', 600, 'normal', 'Inter-SemiBold.otf'], ['Inter', 700, 'normal', 'Inter-Bold.otf']
].map(([f, w, s, file]) => `@font-face { font-family: "${f}"; font-weight: ${w}; font-style: ${s}; src: url("fonts/${file}"); font-display: block; }`).join('\n');

// local page: scripts referenced (fast iteration), fonts and three.js from the repo
const renderHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<style>
${FONT_FACES}
${CSS}
</style>
</head>
<body>
${BODY}
<script src="node_modules/three/build/three.min.js"></script>
<script>window.MG_ASSET_BASE = 'assets/';</script>
<script src="core.js"></script>
<script src="scene3d.js"></script>
<script src="app.js"></script>
</body>
</html>
`;

// published artifact: the host wraps the page in its own skeleton
const inline = f => `<script>\n${R(f).replace(/<\/script/gi, '<\\/script')}\n</script>`;
const indexHtml = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400..700;1,400..700&display=swap">
<style>
${CSS}
</style>
${BODY}
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>window.MG_ASSET_BASE = '';</script>
${inline('core.js')}
${inline('scene3d.js')}
${inline('app.js')}
`;

fs.writeFileSync(path.join(__dirname, 'render.html'), renderHtml);
fs.writeFileSync(path.join(__dirname, 'index.html'), indexHtml);
console.log('wrote render.html and index.html');
