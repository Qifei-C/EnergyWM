// Captions of the film, parsed from core.js (each scene function's `captions(ctx, u, [[start, end, 'text'], …])`
// list), so the tools that need them (storyboard, voiceover) always match the film.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'core.js'));
const src = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');

const drawMap = {}; for (const m of src.matchAll(/(\w+): (scene\w+)/g)) drawMap[m[1]] = m[2];
// [[start, end, text]] in scene-local seconds for one scene function
function captionsOf(fn) {
  const a = src.indexOf(`function ${fn}(`); if (a < 0) return [];
  const b = src.indexOf('\n  function ', a + 10), body = src.slice(a, b < 0 ? undefined : b);
  const c = body.indexOf('captions(ctx, u, ['); if (c < 0) return [];
  return [...body.slice(c).matchAll(/\[([\d.]+), ([\d.]+), '((?:[^'\\]|\\.)*)'\]/g)].map(m => [+m[1], +m[2], m[3]]);
}
// every scene with its captions: { i, id, name, start, dur, caps }
function captionsByScene() {
  return core.SCENES.map((s, i) => ({ i, id: s.id, name: s.name, start: s.start, dur: s.dur, caps: captionsOf(drawMap[s.id]) }));
}

module.exports = { drawMap, captionsOf, captionsByScene };
