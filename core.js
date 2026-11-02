/* core.js — shared Canvas 2D engine for the research-plan animation.
   Works in the browser (window.MGCore) and in Node (@napi-rs/canvas).
   All drawing happens in a fixed 1920×1080 coordinate space; the host scales. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MGCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 1920, H = 1080, FADE = 0.5;

  // ---- design tokens (fixed "paper" look for the film itself) ----
  // Theme "night lab": deep ink background, luminous accents. Keys keep their roles:
  // paper = frame background, panel = card fill, ink = primary text, *Deep = emphasis text on dark,
  // *Soft = dark tinted fills.
  const C = {
    paper: '#0B0F15', paper2: '#121A26', panel: '#141B26', panelHi: '#1B2433',
    ink: '#EEF2F7', mute: '#A4AFC0', faint: '#6F7B8E',
    grid: '#283243', line: '#344055', band: '#111823',
    blue: '#6EA8FF', blueSoft: '#1A2B4A', blueDeep: '#A9CBFF',
    orange: '#FFA24C', orangeSoft: '#3A2614', orangeDeep: '#FFC48A',
    teal: '#2DD4BF', tealSoft: '#123A37', tealDeep: '#7CEBDD',
    violet: '#B49BFF', violetSoft: '#271F45',
    red: '#FF6B6B', redSoft: '#3D1C22', green: '#4ADE80', greenSoft: '#123222',
    banana: '#FACC15', bananaDk: '#A16207', slate: '#8796AB', slateDk: '#5B677A', slateSoft: '#2B3442',
    bowl: '#7F91A8', bowlDk: '#5E6E84', table: '#E6EAF0', tableEdge: '#C9D0DA'
  };
  const SERIF = 'Lora, "DejaVu Serif", Georgia, serif';
  const SANS = 'Inter, "DejaVu Sans", Arial, sans-serif';
  const MATH_FAM = 'Lora, "DejaVu Serif", Georgia, serif';

  // ---- small math helpers ----
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const ramp = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeIn = t => t * t * t;
  const sramp = (t, a, b) => easeIO(ramp(t, a, b));
  // 0 before a, up to 1 at b, hold to c, down to 0 at d
  const fade = (t, a, b, c, d) => (t < b ? ramp(t, a, b) : t < c ? 1 : 1 - ramp(t, c, d));
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
  function mixHex(h1, h2, t) {
    const a = hexToRgb(h1), b = hexToRgb(h2);
    return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
  }
  // sequential colour map through stops
  function makeCmap(stops) {
    const rgb = stops.map(hexToRgb);
    return function (v) {
      v = clamp(v, 0, 1) * (rgb.length - 1);
      const i = Math.min(Math.floor(v), rgb.length - 2), f = v - i;
      const a = rgb[i], b = rgb[i + 1];
      return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
    };
  }
  // field colour maps for the dark set: low values (near the goal / low energy) glow brightest
  const CMAP_WARM = makeCmap(['#FFF1D6', '#FFB868', '#E0661B', '#6B240C', '#2A1208']);
  const CMAP_TEAL = makeCmap(['#D5FBF4', '#5EEAD4', '#14A594', '#0B4F49', '#0A2427']);

  // ---- text helpers ----
  function font(ctx, weight, size, fam, italic) {
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${fam}`;
  }
  // split "E_geo(A)" into runs; "_x" / "_{xy}" become subscripts
  function richRuns(s) {
    const runs = []; let i = 0, cur = '';
    while (i < s.length) {
      if (s[i] === '_' && i + 1 < s.length) {
        if (cur) { runs.push({ t: cur, sub: false }); cur = ''; }
        let j = i + 1, tok = '';
        if (s[j] === '{') { j++; while (j < s.length && s[j] !== '}') tok += s[j++]; j++; }
        else while (j < s.length && /[\p{L}\p{N}]/u.test(s[j])) tok += s[j++];
        runs.push({ t: tok, sub: true }); i = j; continue;
      }
      cur += s[i++];
    }
    if (cur) runs.push({ t: cur, sub: false });
    return runs;
  }
  function richDraw(ctx, s, x, y, o, stroke) {
    const size = o.size || 28, runs = richRuns(s), ssz = Math.round(size * 0.66);
    const setF = r => font(ctx, o.weight || 400, r.sub ? ssz : size, o.fam || SANS, o.italic);
    let w = 0; for (const r of runs) { setF(r); r.w = ctx.measureText(r.t).width + (r.sub ? 1 : 0); w += r.w; }
    let cx = (o.align === 'center') ? x - w / 2 : (o.align === 'right') ? x - w : x;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    for (const r of runs) { setF(r); const yy = r.sub ? y + size * 0.2 : y; if (stroke) ctx.strokeText(r.t, cx, yy); ctx.fillText(r.t, cx, yy); cx += r.w; }
    return w;
  }
  function text(ctx, s, x, y, o) {
    o = o || {};
    if (s.indexOf('_') >= 0) {
      ctx.save(); if (o.alpha != null) ctx.globalAlpha *= o.alpha; ctx.fillStyle = o.color || C.ink; richDraw(ctx, s, x, y, o, false); ctx.restore(); return;
    }
    font(ctx, o.weight || 400, o.size || 28, o.fam || SANS, o.italic);
    ctx.fillStyle = o.color || C.ink;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.alpha != null) { ctx.save(); ctx.globalAlpha *= o.alpha; ctx.fillText(s, x, y); ctx.restore(); }
    else ctx.fillText(s, x, y);
  }
  function spaced(ctx, s, x, y, o) {
    // letter-spaced text (manual, for eyebrows)
    o = o || {}; const sp = o.spacing || 2;
    font(ctx, o.weight || 500, o.size || 22, o.fam || SANS);
    ctx.fillStyle = o.color || C.mute; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    let cx = x;
    for (const ch of s) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
    return cx - x;
  }
  function wrap(ctx, s, maxW) {
    const words = s.split(' '), lines = []; let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function paragraph(ctx, s, x, y, maxW, o) {
    o = o || {};
    font(ctx, o.weight || 400, o.size || 26, o.fam || SANS, o.italic);
    ctx.fillStyle = o.color || C.ink; ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic';
    const lh = o.lh || Math.round((o.size || 26) * 1.35);
    const lines = wrap(ctx, s, maxW);
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh));
    return lines.length * lh;
  }

  // ---- shape helpers ----
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function arrow(ctx, x0, y0, x1, y1, o) {
    o = o || {};
    const lw = o.width || 4, head = o.head || lw * 3.2, col = o.color || C.ink;
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 0.5) return;
    const ux = dx / L, uy = dy / L;
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * head * 0.6, y1 - uy * head * 0.6); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * head - uy * head * 0.45, y1 - uy * head + ux * head * 0.45);
    ctx.lineTo(x1 - ux * head + uy * head * 0.45, y1 - uy * head - ux * head * 0.45);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function line(ctx, x0, y0, x1, y1, col, lw, dash) {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw || 2; ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }
  function polyline(ctx, pts, col, lw, o) {
    o = o || {};
    if (pts.length < 2) return;
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke(); ctx.restore();
  }
  function dot(ctx, x, y, r, col, stroke) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function cross(ctx, cx, cy, r, col, prog, lw) {
    // animated red cross-out (two strokes)
    const p1 = clamp(prog * 2, 0, 1), p2 = clamp(prog * 2 - 1, 0, 1);
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw || 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx - r + 2 * r * p1, cy - r + 2 * r * p1); ctx.stroke();
    if (p2 > 0) { ctx.beginPath(); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx + r - 2 * r * p2, cy - r + 2 * r * p2); ctx.stroke(); }
    ctx.restore();
  }
  // dark glass card; o.stroke = accent colour (subtle border), o.hot = emphasised border, o.bar = accent bar on the left
  function panelBox(ctx, x, y, w, h, o) {
    o = o || {};
    ctx.save();
    rrect(ctx, x, y, w, h, o.r || 16);
    ctx.fillStyle = o.fill || 'rgba(20,27,38,0.92)'; ctx.fill();
    ctx.strokeStyle = o.stroke ? rgba(o.stroke, o.hot ? 0.95 : 0.45) : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = o.hot ? 2.5 : 1.5; ctx.stroke();
    if (o.bar) { ctx.fillStyle = o.bar; rrect(ctx, x, y + 16, 4, h - 32, 2); ctx.fill(); }
    ctx.restore();
  }
  // partially drawn polyline (progress 0..1 along cumulative length)
  function drawPartial(ctx, pts, prog, col, lw, o) {
    if (prog <= 0 || pts.length < 2) return;
    const seg = []; let total = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
    let target = total * clamp(prog, 0, 1), out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (target >= seg[i - 1]) { out.push(pts[i]); target -= seg[i - 1]; }
      else { const f = target / seg[i - 1]; out.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]); break; }
    }
    polyline(ctx, out, col, lw, o);
    return out[out.length - 1];
  }

  // ---- world (side view) ----
  // A view maps world metres (x right, z up) to pixels.
  function makeView(x0, y0, w, wx0, wx1, wz0, wz1) {
    const scale = w / (wx1 - wx0), h = (wz1 - wz0) * scale;
    return {
      x0, y0, w, h, wx0, wx1, wz0, wz1, scale,
      px: x => x0 + (x - wx0) * scale,
      py: z => y0 + h - (z - wz0) * scale,
      rect() { return [x0, y0, w, h]; }
    };
  }
  // Scene geometry in FIELD coordinates (metres): fx = x_world − X_OFF, fz = z_world − counter top.
  // The 3D layer (scene3d.js) builds the same objects from these numbers.
  const WORLD = {
    barrierX0: 0.51, barrierX1: 0.55, barrierH: 0.24,
    bowlX: 0.81, bowlR: 0.085, bowlH: 0.075,
    rObj: 0.045, // inflation radius (gripper + banana)
    bananaHalf: 0.099, // YCB banana scan: 0.197 m long
    goal: { x0: 0.75, x1: 0.87, z0: 0.03, z1: 0.10 },
    start: { x: 0.30, z: 0.17 },
    // L2 (top view, x right / y lateral): wall and goal footprint
    top: { wallY0: 0.0, wallY1: 0.50, goalY0: 0.26, goalY1: 0.38 },
    tallH: 0.42,
    // scene "change the task": a second (blue) bowl becomes the goal, a cup between the bowls must not be touched
    // (kept inside the arm's top-down workspace; the old bowl is cleared away when the goal changes)
    bowl2X: 0.88, cup: { x0: 0.645, x1: 0.695, h: 0.11 }, goal2: { x0: 0.82, x1: 0.94, z0: 0.03, z1: 0.10 }
  };
  // grasp point (banana centre, field coords) where the banana's leading tip touches the barrier
  function contactPoint() { return { x: WORLD.barrierX0 - WORLD.bananaHalf - 0.01, z: WORLD.start.z }; }

  // ---- eikonal field (fast sweeping) ----
  function rectSdf(x, y, ax, bx, ay, by) {
    const dx = Math.max(ax - x, 0, x - bx), dy = Math.max(ay - y, 0, y - by);
    const out = Math.hypot(dx, dy);
    if (out > 0) return out;
    return -Math.min(x - ax, bx - x, y - ay, by - y);
  }
  function makeField(opt) {
    const nx = opt.nx, ny = opt.ny, hx = (opt.x1 - opt.x0) / nx, hy = (opt.y1 - opt.y0) / ny, hcell = hx;
    const N = nx * ny, BIG = 1e9;
    const sdf = new Float32Array(N), S = new Float32Array(N), T = new Float32Array(N), goal = new Uint8Array(N), obs = new Uint8Array(N);
    const xs = i => opt.x0 + (i + 0.5) * hx, ys = j => opt.y0 + (j + 0.5) * hy;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = xs(i), y = ys(j);
      const d = opt.sdf(x, y) - opt.rObj; sdf[k] = d;
      const g = opt.goal(x, y); goal[k] = g ? 1 : 0;
      if (g) { S[k] = 1; obs[k] = 0; T[k] = 0; }
      else if (d <= 0) { S[k] = 0; obs[k] = 1; T[k] = BIG; }
      else { S[k] = clamp(d / opt.dmax, opt.smin, 1); obs[k] = 0; T[k] = BIG; }
    }
    // fast sweeping, Godunov upwind
    const sweeps = [[0, nx, 1, 0, ny, 1], [nx - 1, -1, -1, 0, ny, 1], [nx - 1, -1, -1, ny - 1, -1, -1], [0, nx, 1, ny - 1, -1, -1]];
    for (let it = 0; it < 40; it++) {
      let maxd = 0;
      for (const [i0, i1, di, j0, j1, dj] of sweeps) {
        for (let j = j0; j !== j1; j += dj) for (let i = i0; i !== i1; i += di) {
          const k = j * nx + i; if (obs[k] || goal[k]) continue;
          const a = Math.min(i > 0 ? T[k - 1] : BIG, i < nx - 1 ? T[k + 1] : BIG);
          const b = Math.min(j > 0 ? T[k - nx] : BIG, j < ny - 1 ? T[k + nx] : BIG);
          const f = hcell / S[k];
          let tn;
          if (Math.abs(a - b) >= f) tn = Math.min(a, b) + f;
          else tn = 0.5 * (a + b + Math.sqrt(2 * f * f - (a - b) * (a - b)));
          if (tn < T[k]) { maxd = Math.max(maxd, T[k] - tn); T[k] = tn; }
        }
      }
      if (maxd < 1e-7) break;
    }
    let tmax = 0; for (let k = 0; k < N; k++) if (!obs[k] && T[k] < BIG) tmax = Math.max(tmax, T[k]);
    // gradient (central / one-sided), zero in obstacles
    const gx = new Float32Array(N), gy = new Float32Array(N);
    const free = k => !obs[k] && T[k] < BIG;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!free(k)) continue;
      const l = i > 0 && free(k - 1), r = i < nx - 1 && free(k + 1), d = j > 0 && free(k - nx), u = j < ny - 1 && free(k + nx);
      gx[k] = l && r ? (T[k + 1] - T[k - 1]) / (2 * hx) : r ? (T[k + 1] - T[k]) / hx : l ? (T[k] - T[k - 1]) / hx : 0;
      gy[k] = d && u ? (T[k + nx] - T[k - nx]) / (2 * hy) : u ? (T[k + nx] - T[k]) / hy : d ? (T[k] - T[k - nx]) / hy : 0;
    }
    const field = { nx, ny, hx, hy, x0: opt.x0, x1: opt.x1, y0: opt.y0, y1: opt.y1, sdf, S, T, goal, obs, tmax, gx, gy, BIG };
    field.cell = (x, y) => [clamp(Math.floor((x - opt.x0) / hx), 0, nx - 1), clamp(Math.floor((y - opt.y0) / hy), 0, ny - 1)];
    field.sample = (arr, x, y) => { // bilinear sample of a grid array at world coords
      const fx = (x - opt.x0) / hx - 0.5, fy = (y - opt.y0) / hy - 0.5;
      const i = clamp(Math.floor(fx), 0, nx - 2), j = clamp(Math.floor(fy), 0, ny - 2);
      const tx = clamp(fx - i, 0, 1), ty = clamp(fy - j, 0, 1);
      const v00 = arr[j * nx + i], v10 = arr[j * nx + i + 1], v01 = arr[(j + 1) * nx + i], v11 = arr[(j + 1) * nx + i + 1];
      return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
    };
    field.gradAt = (x, y) => [field.sample(gx, x, y), field.sample(gy, x, y)];
    return field;
  }
  // marching squares → list of segments in world coords
  function contourSegs(field, arr, level, maxVal) {
    const { nx, ny, hx, hy, x0, y0 } = field, segs = [];
    const X = i => x0 + (i + 0.5) * hx, Y = j => y0 + (j + 0.5) * hy;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const v = [arr[k], arr[k + 1], arr[k + nx + 1], arr[k + nx]];
      if (v[0] >= maxVal || v[1] >= maxVal || v[2] >= maxVal || v[3] >= maxVal) continue;
      const px = [X(i), X(i + 1), X(i + 1), X(i)], py = [Y(j), Y(j), Y(j + 1), Y(j + 1)];
      let idx = 0; for (let c = 0; c < 4; c++) if (v[c] > level) idx |= 1 << c;
      if (idx === 0 || idx === 15) continue;
      const ip = (a, b) => { const t = (level - v[a]) / (v[b] - v[a] || 1e-9); return [lerp(px[a], px[b], t), lerp(py[a], py[b], t)]; };
      const e = [[0, 1], [1, 2], [2, 3], [3, 0]];
      const pts = {};
      const need = edges => edges.map(ei => { if (!pts[ei]) pts[ei] = ip(e[ei][0], e[ei][1]); return pts[ei]; });
      const table = {
        1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]],
        8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]]
      };
      for (const pr of table[idx]) { const [a, b] = need(pr); segs.push([a[0], a[1], b[0], b[1]]); }
    }
    return segs;
  }

  // ---- layouts ----
  const FX0 = 0, FX1 = 1.2, FZ0 = 0, FZ1 = 0.64, NX = 150, NY = 80;
  function sideSdf(barrierH) {
    return (x, y) => {
      let d = y; // floor
      if (barrierH > 0) d = Math.min(d, rectSdf(x, y, WORLD.barrierX0, WORLD.barrierX1, -1, barrierH));
      return d;
    };
  }
  const goalSide = (x, y) => x >= WORLD.goal.x0 && x <= WORLD.goal.x1 && y >= WORLD.goal.z0 && y <= WORLD.goal.z1;
  function buildFields() {
    const base = { nx: NX, ny: NY, x0: FX0, x1: FX1, y0: FZ0, y1: FZ1, rObj: WORLD.rObj, dmax: 0.06, smin: 0.15, goal: goalSide };
    const F = {};
    F.L0 = makeField(Object.assign({}, base, { sdf: sideSdf(WORLD.barrierH) }));
    F.L1 = makeField(Object.assign({}, base, { sdf: sideSdf(0) }));
    F.L3 = makeField(Object.assign({}, base, { sdf: sideSdf(WORLD.tallH) }));
    // L4: new goal (blue bowl, replacing the old one) + forbidden contact with the cup
    const G2 = WORLD.goal2, CU = WORLD.cup;
    F.L4 = makeField(Object.assign({}, base, {
      sdf: (x, y) => Math.min(sideSdf(WORLD.barrierH)(x, y), rectSdf(x, y, CU.x0, CU.x1, -1, CU.h)),
      goal: (x, y) => x >= G2.x0 && x <= G2.x1 && y >= G2.z0 && y <= G2.z1
    }));
    // L2: top view (x right, y lateral). Wall spans y∈[0,0.50], opening at the far side.
    const TP = WORLD.top;
    F.L2 = makeField(Object.assign({}, base, {
      rObj: WORLD.rObj, sdf: (x, y) => rectSdf(x, y, WORLD.barrierX0, WORLD.barrierX1, -1, TP.wallY1),
      goal: (x, y) => x >= WORLD.goal.x0 && x <= WORLD.goal.x1 && y >= TP.goalY0 && y <= TP.goalY1
    }));
    // local attraction + repulsion energy on the L0 grid
    const f = F.L0, N = f.nx * f.ny, E = new Float32Array(N);
    const sig = 0.35, m = 0.03, rho = 0.015, wrep = 1.0, gx0 = WORLD.bowlX, gz0 = 0.065;
    const softplus = v => v > 20 ? v : Math.log1p(Math.exp(v));
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) {
      const k = j * f.nx + i, x = f.x0 + (i + 0.5) * f.hx, z = f.y0 + (j + 0.5) * f.hy;
      const d = f.sdf[k];
      E[k] = 0.5 * ((x - gx0) * (x - gx0) + (z - gz0) * (z - gz0)) / (sig * sig) + wrep * softplus((m - d) / rho);
    }
    F.Eloc = E;
    F.Eloc_fn = (x, z) => {
      const d = sideSdf(WORLD.barrierH)(x, z) - WORLD.rObj;
      return 0.5 * ((x - gx0) * (x - gx0) + (z - gz0) * (z - gz0)) / (sig * sig) + wrep * softplus((m - d) / rho);
    };
    F.Eloc_parts = (x, z) => { // gradients of the two terms
      const d = sideSdf(WORLD.barrierH)(x, z) - WORLD.rObj;
      const ga = [(x - gx0) / (sig * sig), (z - gz0) / (sig * sig)];
      const sgm = 1 / (1 + Math.exp(-(m - d) / rho));
      const eps = 1e-4, dd = (sideSdf(WORLD.barrierH)(x + eps, z) - sideSdf(WORLD.barrierH)(x - eps, z)) / (2 * eps);
      const dz = (sideSdf(WORLD.barrierH)(x, z + eps) - sideSdf(WORLD.barrierH)(x, z - eps)) / (2 * eps);
      const gr = [-wrep * sgm / rho * dd, -wrep * sgm / rho * dz];
      return { attract: ga, repel: gr };
    };
    // equilibrium x along z = 0.17 where ∂E/∂x = 0 (force balance)
    let xe = 0.42; { const z = WORLD.start.z; let lo = WORLD.start.x, hi = WORLD.barrierX0 - WORLD.rObj; for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; const p = F.Eloc_parts(mid, z); const gxs = p.attract[0] + p.repel[0]; if (gxs < 0) lo = mid; else hi = mid; } xe = (lo + hi) / 2; }
    F.pStar = { x: xe, z: WORLD.start.z };
    return F;
  }

  // ---- field rendering ----
  function fieldImage(env, field, valueOf, cmap, key) {
    // returns an offscreen canvas nx×ny with colours
    const cv = env.makeCanvas(field.nx, field.ny), cx = cv.getContext('2d');
    const img = cx.createImageData(field.nx, field.ny), d = img.data;
    for (let j = 0; j < field.ny; j++) for (let i = 0; i < field.nx; i++) {
      const k = j * field.nx + i, p = ((field.ny - 1 - j) * field.nx + i) * 4; // flip y
      let col, a = 255;
      if (field.obs[k]) { col = [58, 68, 84]; a = 150; }            // inflated obstacle: muted, half see-through
      else if (field.goal[k]) { col = hexToRgb(C.green); a = 230; }
      else { const v = valueOf(k); if (v == null) { col = [0, 0, 0]; a = 0; } else col = cmap(v); } // not yet reached: transparent
      d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = a;
    }
    cx.putImageData(img, 0, 0);
    return cv;
  }
  function drawField(ctx, env, field, v, mode, cut, alpha) {
    // mode: 'T' or 'E'; cut: max T shown (wavefront), null = all
    let img;
    if (mode === 'E') {
      const E = env.F.Eloc; let emax = 0; for (let k = 0; k < E.length; k++) if (!field.obs[k]) emax = Math.max(emax, Math.min(E[k], 6));
      env.cache.Eimg = env.cache.Eimg || fieldImage(env, field, k => Math.pow(clamp(Math.min(E[k], 6) / emax, 0, 1), 0.55), CMAP_WARM);
      img = env.cache.Eimg;
    } else {
      const tm = field.tmax;
      img = fieldImage(env, field, k => (cut != null && field.T[k] > cut) ? null : Math.pow(field.T[k] / tm, 0.75), CMAP_TEAL);
    }
    ctx.save(); ctx.globalAlpha *= (alpha == null ? 1 : alpha);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, field.nx, field.ny, v.px(field.x0), v.py(field.y1), (field.x1 - field.x0) * v.scale, (field.y1 - field.y0) * v.scale);
    ctx.restore();
  }
  function drawContours(ctx, field, v, levels, col, lw, cut) {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const lv of levels) {
      if (cut != null && lv > cut) continue;
      const segs = contourSegs(field, field.T, lv, field.BIG / 2);
      for (const s of segs) { ctx.moveTo(v.px(s[0]), v.py(s[1])); ctx.lineTo(v.px(s[2]), v.py(s[3])); }
    }
    ctx.stroke(); ctx.restore();
  }
  function drawQuiver(ctx, field, v, step, len, col, alpha, cut) {
    ctx.save(); ctx.globalAlpha *= alpha;
    for (let j = step >> 1; j < field.ny; j += step) for (let i = step >> 1; i < field.nx; i += step) {
      const k = j * field.nx + i; if (field.obs[k] || field.goal[k] || field.T[k] >= field.BIG) continue;
      if (cut != null && field.T[k] > cut) continue;
      const gx = -field.gx[k], gy = -field.gy[k], L = Math.hypot(gx, gy); if (L < 1e-6) continue;
      const x = field.x0 + (i + 0.5) * field.hx, y = field.y0 + (j + 0.5) * field.hy;
      const px = v.px(x), py = v.py(y);
      arrow(ctx, px, py, px + gx / L * len, py - gy / L * len, { color: col, width: 2.2, head: 7 });
    }
    ctx.restore();
  }

  // ---- field textures for the 3D slice planes ----
  // The canvas (normally 1200×640) maps the field domain [FX0,FX1]×[FZ0,FZ1] with fz up, so a
  // THREE.CanvasTexture (flipY = true) on a PlaneGeometry shows the field upright.
  let texEnv = null;
  function getTexEnv(canvas) {
    if (!texEnv) {
      const mk = (typeof document !== 'undefined') ? ((w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }))
        : (canvas && canvas.constructor ? (w, h) => new canvas.constructor(w, h) : null);
      texEnv = { makeCanvas: mk, F: getF(), cache: {} };
    }
    return texEnv;
  }
  function paintFieldTexture(canvas, mode, cut, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d'), F = getF(), field = F[opts.field || 'L0'], tenv = getTexEnv(canvas);
    const v = makeView(0, 0, canvas.width, FX0, FX1, FZ0, FZ1);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, canvas.width, canvas.height);
    const tm = field.tmax;
    if (opts.contoursOnly) {
      const levels = []; for (let k = 1; k <= 22; k++) levels.push(tm * k / 23);
      drawContours(ctx, field, v, levels, rgba(C.teal, 0.9), 3, cut);
      return;
    }
    drawField(ctx, tenv, field, v, mode, cut, 1);
    if (mode === 'T') {
      const levels = []; for (let k = 1; k <= 18; k++) levels.push(tm * k / 19);
      drawContours(ctx, field, v, levels, 'rgba(225,255,250,0.42)', 2, cut);
      if (opts.quiver > 0) drawQuiver(ctx, field, v, 9, 24, '#F0FFFC', 0.8 * opts.quiver, cut);
    } else {
      // E: a few iso-lines of the local energy for shape
      const E = F.Eloc, levels = [0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2];
      ctx.save(); ctx.strokeStyle = 'rgba(255,236,210,0.35)'; ctx.lineWidth = 1.6; ctx.beginPath();
      for (const lv of levels) for (const s of contourSegs(field, E, lv, 50)) { ctx.moveTo(v.px(s[0]), v.py(s[1])); ctx.lineTo(v.px(s[2]), v.py(s[3])); }
      ctx.stroke(); ctx.restore();
    }
    // thin frame so the slice reads as a plane
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4); ctx.restore();
  }

  // ---- common chrome (theme "night lab"; the overlay is transparent over the 3D layer) ----
  function background(ctx) {
    const g = ctx.createRadialGradient(W * 0.5, H * 0.36, 60, W * 0.5, H * 0.5, W * 0.78);
    g.addColorStop(0, C.paper2); g.addColorStop(1, C.paper);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // opaque-ish backdrop for diagram beats (the 3D keeps moving faintly underneath)
  function wash(ctx, a) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; background(ctx); ctx.restore(); }
  function hWash(ctx, x0, x1, a, fromRight) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, rgba(C.paper, fromRight ? 0 : a)); g.addColorStop(1, rgba(C.paper, fromRight ? a : 0));
    ctx.save(); ctx.fillStyle = g;
    if (fromRight) ctx.fillRect(x0, 0, W - x0, H); else ctx.fillRect(0, 0, x1, H);
    ctx.restore();
  }
  function topWash(ctx, h, a) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(C.paper, a)); g.addColorStop(0.55, rgba(C.paper, a * 0.8)); g.addColorStop(1, rgba(C.paper, 0));
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, h); ctx.restore();
  }
  function vignette(ctx, a) {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.35, W / 2, H * 0.5, W * 0.72);
    g.addColorStop(0, rgba(C.paper, 0)); g.addColorStop(1, rgba(C.paper, a));
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  // text with a dark halo so it stays legible over the 3D layer
  function haloText(ctx, s, x, y, o) {
    o = o || {};
    const size = o.size || 24;
    font(ctx, o.weight || 400, size, o.fam || SANS, o.italic);
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = o.halo || Math.max(5, size * 0.28);
    ctx.strokeStyle = rgba(C.paper, 0.8); ctx.fillStyle = o.color || C.ink;
    if (s.indexOf('_') >= 0) { richDraw(ctx, s, x, y, o, true); ctx.restore(); return; }
    ctx.strokeText(s, x, y); ctx.fillText(s, x, y);
    ctx.restore();
  }
  // typeset formulas (math.js → decoded SVG images, tinted per colour and cached); y = baseline
  let MATH = null, mkCanvas = null; const mathCache = {};
  const MATH_FALLBACK = { Ahat: 'Â', Kmap: 'K', Fmap: 'Fθ(h, ·)', EgeoK: 'Egeo(K(Â); g, c)', Econs: 'ℓ(Fθ(h, Â); g, c)', Esum: 'E(Â; g, c) = Egeo(K(Â); g, c) + ℓ(Fθ(h, Â); g, c)', update: 'vφ − λ𝒫(∇E)', Pcal: '𝒫', piUpdate: 'π(φk) → π(φk+1)', eikonal: 'S(x) ‖∇T(x)‖ = 1', taylor: 'E(A + ΔA) ≈ E(A) + ∇E(A)ᵀΔA', energy1: 'E(A; g, c) = Egeo(K(A); g, c)', energy2: '+ ℓ(Fθ(h, A); g, c)', Ftheta: 'Fθ', gc: 'g, c',
    sA: 'A', sE: 'E', sEgeo: 'Egeo', sh: 'h', sell: 'ℓ', sv: 'vφ', slam: 'λ', sgradA: '∇E', sT: 'T(x)', sS: 'S(x)', sx: 'x', snegT: '−∇T', sdA: 'ΔA', sgradE: '∇E(A)', spi: 'πφ', sk: 'k' };
  function setMath(m) { MATH = m; }
  function mathText(ctx, key, x, y, o) {
    o = o || {};
    const size = o.size || 28, col = o.color || C.ink, m = MATH && MATH[key];
    if (!m || !mkCanvas) { text(ctx, MATH_FALLBACK[key] || key, x, y, { size, color: col, align: o.align, fam: MATH_FAM, italic: true, alpha: o.alpha }); return 0; }
    const vb = m.vb, sc = size / 1000, w = vb[2] * sc, h = vb[3] * sc, ck = key + '|' + col + '|' + size;
    let cv = mathCache[ck];
    if (!cv) {
      cv = mkCanvas(Math.ceil(w) + 4, Math.ceil(h) + 4); const g = cv.getContext('2d');
      g.drawImage(m.img, 2, 2, w, h); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, cv.width, cv.height);
      mathCache[ck] = cv;
    }
    const dx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.drawImage(cv, dx - 2, y + vb[1] * sc - 2);
    ctx.restore();
    return w;
  }
  function mathWidth(key, size) { const m = MATH && MATH[key]; return m && mkCanvas ? m.vb[2] * size / 1000 : 0.6 * size * (MATH_FALLBACK[key] || key).length; }
  // symbol legend: one row per symbol — typeset symbol, then a short plain-English definition.
  // rows: [key, definition, t0?]; a row with t0 fades in at u = t0 (o.u required then).
  function symLegend(ctx, x, y, rows, o) {
    o = o || {};
    const ms = o.msize || 22, ts = o.tsize || 19, lh = o.lh || 34, sw = o.symW || 96;
    rows.forEach(([key, def, t0], i) => {
      const a = t0 == null ? 1 : ramp(o.u, t0, t0 + 0.5); if (a <= 0) return;
      ctx.save(); ctx.globalAlpha *= a;
      mathText(ctx, key, x, y + i * lh, { size: ms, color: o.mcolor || C.ink });
      text(ctx, def, x + sw, y + i * lh - 1, { size: ts, color: o.color || C.mute });
      ctx.restore();
    });
  }
  // one centred line: [key, definition] pairs separated by a dot
  function symInline(ctx, items, cx, y, o) {
    o = o || {};
    const ms = o.msize || 24, ts = o.tsize || 20, gap = 10, sep = 34;
    font(ctx, 400, ts, SANS);
    const ws = items.map(([k, d]) => [mathWidth(k, ms), ctx.measureText(d).width]);
    let x = cx - (ws.reduce((a, [m, t]) => a + m + gap + t, 0) + sep * (items.length - 1)) / 2;
    items.forEach(([k, d], i) => {
      mathText(ctx, k, x, y, { size: ms, color: o.mcolor || C.ink }); x += ws[i][0] + gap;
      text(ctx, d, x, y - 1, { size: ts, color: o.color || C.mute }); x += ws[i][1];
      if (i < items.length - 1) { text(ctx, '·', x + sep / 2, y - 1, { size: ts, color: C.faint, align: 'center' }); x += sep; }
    });
  }
  // section label over 3D: short accent bar + text
  function subhead(ctx, s, x, y, o) {
    o = o || {};
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.fillStyle = o.color || C.orange; rrect(ctx, x, y - 22, 4, 26, 2); ctx.fill();
    haloText(ctx, s, x + 18, y, { size: o.size || 26, weight: 600, color: C.ink });
    ctx.restore();
  }
  function tag(ctx, s, x, y, col, o) { // small spaced caps label
    o = o || {};
    spaced(ctx, s, x, y, { size: o.size || 16, weight: 600, color: col || C.faint, spacing: 2 });
  }
  function drawLabels(ctx, fi) {
    if (!fi || !fi.labels) return;
    for (const l of fi.labels) {
      if (!l.px || l.alpha === 0) continue;
      haloText(ctx, l.text, l.px[0] + (l.dx || 0), l.px[1] + (l.dy || 0), {
        size: l.size || 22, weight: l.weight || (l.math ? 400 : 600), color: l.color || C.ink, align: l.align || 'left',
        fam: l.math ? MATH_FAM : SANS, italic: !!l.math, alpha: l.alpha == null ? 1 : l.alpha
      });
    }
  }
  function eyebrow(ctx, idx, name, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha == null ? 1 : alpha;
    const num = String(idx).padStart(2, '0');
    font(ctx, 700, 20, SANS); const nw = ctx.measureText(num).width;
    haloText(ctx, num, 80, 76, { size: 20, weight: 700, color: C.orange });
    ctx.fillStyle = rgba(C.ink, 0.35); ctx.fillRect(80 + nw + 14, 68, 22, 2);
    ctx.lineJoin = 'round';
    spaced(ctx, name.toUpperCase(), 80 + nw + 50, 76, { size: 18, weight: 600, color: C.mute, spacing: 2.4 });
    ctx.restore();
  }
  function caption(ctx, s, alpha) {
    if (!s || alpha <= 0) return;
    ctx.save(); ctx.globalAlpha *= alpha;
    const g = ctx.createLinearGradient(0, H - 250, 0, H);
    g.addColorStop(0, rgba(C.paper, 0)); g.addColorStop(0.55, rgba(C.paper, 0.62)); g.addColorStop(1, rgba(C.paper, 0.86));
    ctx.fillStyle = g; ctx.fillRect(0, H - 250, W, 250);
    font(ctx, 400, 34, SANS);
    const lines = wrap(ctx, s, 1600), lh = 46, top = 1004 - (lines.length - 1) * lh;
    lines.forEach((ln, i) => haloText(ctx, ln, W / 2, top + i * lh, { size: 34, color: '#F4F7FB', align: 'center', halo: 7 }));
    ctx.restore();
  }
  function progressLine(ctx, frac) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(0, H - 4, W, 4);
    ctx.fillStyle = rgba(C.orange, 0.85); ctx.fillRect(0, H - 4, W * frac, 4);
  }
  function heading(ctx, s, x, y, size, alpha, col) {
    ctx.save(); ctx.globalAlpha *= alpha == null ? 1 : alpha;
    haloText(ctx, s, x, y, { fam: SERIF, weight: 600, size: size || 44, color: col || C.ink });
    ctx.restore();
  }
  function captions(ctx, u, list) {
    for (const [a, b, s] of list) {
      const al = fade(u, a, a + 0.4, b - 0.3, b);
      if (al > 0) caption(ctx, s, al);
    }
  }
  // check / cross / partial marks for the capability matrix
  function mark(ctx, kind, cx, cy, r) {
    const col = kind === 'yes' ? C.green : kind === 'no' ? C.red : C.orange;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fillStyle = rgba(col, 0.14); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.stroke();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.beginPath();
    if (kind === 'yes') { ctx.moveTo(cx - r * 0.42, cy + r * 0.02); ctx.lineTo(cx - r * 0.1, cy + r * 0.34); ctx.lineTo(cx + r * 0.45, cy - r * 0.32); }
    else if (kind === 'no') { ctx.moveTo(cx - r * 0.34, cy - r * 0.34); ctx.lineTo(cx + r * 0.34, cy + r * 0.34); ctx.moveTo(cx + r * 0.34, cy - r * 0.34); ctx.lineTo(cx - r * 0.34, cy + r * 0.34); }
    else { ctx.moveTo(cx - r * 0.4, cy); ctx.lineTo(cx + r * 0.4, cy); }
    ctx.stroke(); ctx.restore();
  }
  // a dark-glass chip with an accent dot; returns its width
  // list item (no capsule): accent bar or ✓/✗ mark, then text with a dark halo
  function chip(ctx, s, x, y, o) {
    o = o || {};
    const size = o.size || 24, h = size + 26, cy = y + h / 2;
    if (o.mark) mark(ctx, o.mark, x + 12, cy, size * 0.5);
    else { ctx.fillStyle = o.col || C.mute; rrect(ctx, x, cy - size * 0.55, 4, size * 1.1, 2); ctx.fill(); }
    haloText(ctx, s, x + (o.mark ? 34 : 18), cy + size * 0.36, { size, weight: 500, color: o.tcol || C.ink });
    font(ctx, 500, size, SANS); return ctx.measureText(s).width + (o.mark ? 34 : 18);
  }
  function badge(ctx, n, cx, cy, col, r) {
    r = r || 20;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fillStyle = col; ctx.fill();
    text(ctx, String(n), cx, cy + r * 0.38, { size: r * 1.05, weight: 700, color: C.paper, align: 'center' });
  }
  function toggle(ctx, x, y, off, col) {
    ctx.fillStyle = off > 0.5 ? C.grid : col; rrect(ctx, x, y, 84, 42, 21); ctx.fill();
    dot(ctx, lerp(x + 63, x + 21, off), y + 21, 16, off > 0.5 ? C.mute : C.paper);
  }
  // cited statistic: big number, label, source line
  function statCard(ctx, x, y, w, h, big, label, src, o) {
    o = o || {};
    panelBox(ctx, x, y, w, h, { stroke: o.col || C.orange, fill: 'rgba(17,23,33,0.98)' });
    tag(ctx, o.tag || 'PRIOR WORK', x + 28, y + 42, C.faint);
    text(ctx, big, x + 28, y + 42 + (o.bigSize || 76), { fam: SERIF, weight: 600, size: o.bigSize || 76, color: o.col || C.orange });
    let yy = y + 42 + (o.bigSize || 76) + 44;
    yy += paragraph(ctx, label, x + 28, yy, w - 56, { size: o.lsize || 26, color: C.ink, lh: 34 });
    paragraph(ctx, src, x + 28, y + h - 26 - (o.srcLines ? (o.srcLines - 1) * 22 : 0), w - 56, { size: 17, color: C.faint, lh: 22 });
  }
  const appear = (ctx, a, dy) => { ctx.globalAlpha *= a; ctx.translate(0, (1 - easeOut(a)) * (dy == null ? 14 : dy)); };

  // ---- scene list ----
  // Thesis: a small VLA that already has basic skills meets a new combination of conditions; a teacher
  // (geometry + predicted consequences) helps it get it right, the correction is learned, and the teacher
  // is gradually no longer needed. Literature numbers are cited on screen; our own numerical check is labelled as ours.
  const SCENES = [
    { id: 'title', name: 'Title', dur: 10 },
    { id: 'gap', name: 'Skills, not the combination', dur: 58 },
    { id: 'tools', name: 'Where extra reasoning helps — and what it costs', dur: 106 },
    { id: 'thesis', name: 'The bet', dur: 36 },
    { id: 'guide', name: 'Guidance: geometry and consequences', dur: 60 },
    { id: 'geom', name: 'The geometry part of the teacher', dur: 52 },
    { id: 'direct', name: 'A direction, not a verdict', dur: 40 },
    { id: 'slip', name: 'Same path, different physics', dur: 34 },
    { id: 'intervene', name: 'Change the task, not the weights', dur: 56 },
    { id: 'teach', name: 'Teacher → energy student', dur: 42 },
    { id: 'policy', name: 'Policy student: learning to need it less', dur: 72 },
    { id: 'sim2real', name: 'From simulation to a real kitchen', dur: 72 },
    { id: 'invest', name: 'Deployment states', dur: 34 },
    { id: 'levels', name: 'Four levels — and the Level 3 test', dur: 56 },
    { id: 'notclaims', name: 'What we build on — and what it gives us', dur: 42 },
    { id: 'end', name: 'The proposition', dur: 30 },
    { id: 'appendix', name: 'Appendix: prior numbers and their scope', dur: 30 }
  ];
  let acc = 0; for (const s of SCENES) { s.start = acc; acc += s.dur; }
  const DUR = acc;

  // Beat timings (scene-local seconds) shared by the overlay and the 3D layer.
  const TL = {
    gap: { skills: [1.5, 13], chips: [3, 4.5, 7, 10, 12], combo: 16, comboChips: [16.5, 19, 21.5, 24], fail: [30, 33], why: 37, vls: 46, lift: 52 },
    tools: { vla: [3, 6], cem: [[8, 11], [11, 14], [14, 17]], step1: [17, 19], cem2: [[19, 22], [22, 25]], step2: [25, 27], cards: 28, wam: 35, stat: 42, table: 50, fam: 64, gps: 88, question: 96 },
    guide: { pipe: 20, geo: 27, cons: 34, sum: 41, upd: 48 },
    geom: { ghost: [2, 3.5], a1: [3.5, 5], a2: [5, 6.5], a3: [8, 9.5], T: 14, cut: [14.8, 20.5], quiver: [21, 22], grad: [21.5, 22.7], prop: 23, corr: 25, exec: [27, 32], check: 36 },
    direct: { keep: 8, lift: 10, ease: 12, bend: [16, 20], eq: 14, dagger: 21 },
    intervene: { phase: [8, 16, 24], goal: 32, goalCut: [33, 37], diag: 44, agf: 50 },
    policy: { split: 30, c1: [31.5, 34, 37.5], c2: 44, c2m: [45.5, 48, 51.5], line: 58 },
    sim2real: { miss: 0.5, geo: 20, geoOut: 48, fix: 34, exec: 39, cards: 50, open: 62 },
    invest: { A: 8, B: 15, C: 22, measure: 28 },
    levels: { test: 30, rows: 38, limit: 52 },
    appendix: {}
  };
  // shared timing of the denoising loop (2D τ bar and 3D chunk agree)
  function guideTau(u) { const loopT = 12, uu = u % loopT; return clamp(uu / 8.5, 0, 1); }
  const SLIP = { t0: 1.5, period: 12, dur: [9.0, 4.5] };

  // =====================================================================
  // 01 — Title
  // =====================================================================
  function sceneTitle(ctx, u) {
    hWash(ctx, 860, 1360, 0.94, false);
    ctx.save();
    const a = ramp(u, 0.8, 2.0);
    ctx.globalAlpha = a; ctx.translate(0, (1 - easeOut(a)) * 18);
    text(ctx, 'Energy-Field Teachers', 150, 420, { fam: SERIF, weight: 600, size: 96, color: C.ink });
    text(ctx, 'for Small VLAs', 150, 526, { fam: SERIF, weight: 600, size: 96, color: C.ink });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 2.0, 3.2);
    text(ctx, 'Help a small VLA get it right the first time —', 150, 612, { size: 34, color: C.mute });
    text(ctx, 'then let it learn to do without the teacher.', 150, 658, { size: 34, color: C.mute });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 3.2, 4.2);
    ctx.fillStyle = C.orange; ctx.fillRect(150, 730, 120, 4);
    text(ctx, 'Qifei C.', 150, 792, { size: 30, weight: 600, color: C.ink });
    text(ctx, 'CocoMatrix', 150, 832, { size: 24, color: C.mute });
    ctx.restore();
  }

  // =====================================================================
  // 02 — Skills, not the combination
  // =====================================================================
  function arcPath(x0, z0, x1, z1, apexZ, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = lerp(x0, x1, t);
      const z = lerp(z0, z1, t) + (apexZ - Math.max(z0, z1)) * Math.sin(Math.PI * t);
      pts.push([x, z]);
    }
    return pts;
  }
  function sceneGap(ctx, u) {
    const T = TL.gap;
    hWash(ctx, 1020, 1160, 0.9, true);
    subhead(ctx, 'Skills it already has', 80, 140, { color: C.blue, alpha: 1 - ramp(u, T.combo - 0.6, T.combo) });
    subhead(ctx, 'A combination it has not seen', 80, 140, { color: C.red, alpha: ramp(u, T.combo, T.combo + 0.6) });
    // skills column
    const skills = ['grasp', 'lift', 'move sideways', 'slow down', 'place'];
    const sa = 1 - ramp(u, T.combo - 0.6, T.combo);
    if (sa > 0) skills.forEach((s, i) => {
      ctx.save(); ctx.globalAlpha = sa; appear(ctx, ramp(u, T.chips[i], T.chips[i] + 0.5));
      chip(ctx, s, 1240, 200 + i * 80, { col: C.blue, size: 30 });
      ctx.restore();
    });
    // new-combination column
    const combo = ['bowl behind a barrier', 'low ceiling', 'grip near one end', 'no fast swing'];
    const ca = ramp(u, T.combo, T.combo + 0.6) * (1 - ramp(u, T.why - 0.6, T.why));
    if (ca > 0) combo.forEach((s, i) => {
      ctx.save(); ctx.globalAlpha = ca; appear(ctx, ramp(u, T.comboChips[i], T.comboChips[i] + 0.5));
      chip(ctx, s, 1240, 200 + i * 80, { col: C.red, size: 30 });
      ctx.restore();
    });
    // what is missing
    if (u > T.why) {
      ctx.save(); appear(ctx, ramp(u, T.why, T.why + 0.8));
      panelBox(ctx, 1200, 190, 640, 330, { stroke: C.orange });
      tag(ctx, 'WHAT IS MISSING', 1232, 236, C.orangeDeep);
      ['which skill to use,', 'how much of it,', 'and what it causes next.'].forEach((s, i) =>
        text(ctx, s, 1232, 312 + i * 64, { fam: SERIF, weight: 600, size: 42, color: C.ink }));
      ctx.restore();
    }
    if (u > T.vls) {
      ctx.save(); appear(ctx, ramp(u, T.vls, T.vls + 0.8));
      panelBox(ctx, 1200, 550, 640, 170, {});
      tag(ctx, 'SIMILAR DIAGNOSIS', 1232, 594, C.faint);
      text(ctx, 'Actions stay bound to training layouts.', 1232, 644, { size: 26, color: C.ink });
      text(ctx, 'VLS — Liu et al., arXiv 2602.03973', 1232, 690, { size: 18, color: C.faint });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 8, 'A small VLA that already knows the basics: grasp, lift, move, place.'],
      [8, 16, 'In layouts like its training data, that is enough.'],
      [16, 23, 'Now a new combination: a barrier, a low ceiling, a grip near one end.'],
      [23, 30, 'Do not touch the barrier. Do not fling the banana by moving too fast.'],
      [30, 37, 'Every motion is familiar. The combination is not — and it fails.'],
      [37, 46, 'What is missing: which skill, how much, and what it causes next.'],
      [46, 52, 'Our scope: re-using and adapting existing skills, not inventing new ones.'],
      [52, 58.2, 'From here on: barrier only — the ceiling is removed to show the mechanism.']
    ]);
  }

  // =====================================================================
  // 03 — Where additional reasoning helps, and what it costs (split: direct policy | sampling planner)
  // =====================================================================
  function sceneTools(ctx, u) {
    const T = TL.tools;
    const rowsYN = (x, y, items, t0) => items.forEach(([k, s], i) => {
      ctx.save(); ctx.globalAlpha *= ramp(u, t0 + i * 1.2, t0 + i * 1.2 + 0.5);
      mark(ctx, k, x + 16, y + i * 50 - 9, 14); text(ctx, s, x + 44, y + i * 50, { size: 24, color: C.ink });
      ctx.restore();
    });
    if (u < T.table) {
      // ---- A: the same new combination, two ways to act (3D split behind) ----
      const dim = 1 - 0.85 * ramp(u, T.stat, T.stat + 0.6);
      topWash(ctx, 300, 0.94);
      heading(ctx, 'Where extra reasoning helps — and what it costs', 100, 150, 42, ramp(u, 0, 0.8));
      ctx.save(); ctx.globalAlpha = ramp(u, 1, 2); spaced(ctx, 'ILLUSTRATIVE FAILURE · COMBINED CHANGES', 1150, 150, { size: 16, weight: 600, color: C.orangeDeep, spacing: 2.2 }); ctx.restore();
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(959, 190, 2, 890); ctx.restore();
      [[0, 'Direct-policy baseline', 'e.g. π0.5 · GR00T N1.6 — direct action-chunk generation, no external rollout search', C.blue],
       [960, 'A sampling-based world-model planner', 'e.g. V-JEPA 2-AC with CEM — not every world action model works this way', C.violet]].forEach(([x, title, sub, col]) => {
        ctx.save(); ctx.globalAlpha = ramp(u, 0.6, 1.4);
        ctx.fillStyle = col; rrect(ctx, x + 60, 206, 4, 54, 2); ctx.fill();
        haloText(ctx, title, x + 80, 232, { size: 30, weight: 600, color: col });
        haloText(ctx, sub, x + 80, 262, { size: 18, color: C.mute });
        ctx.restore();
      });
      if (u > T.cards) {
        ctx.save(); ctx.globalAlpha = dim; appear(ctx, ramp(u, T.cards, T.cards + 0.6));
        panelBox(ctx, 60, 640, 840, 230, { stroke: C.blue });
        text(ctx, '63 ms', 90, 698, { fam: SERIF, weight: 600, size: 48, color: C.blue });
        text(ctx, 'per 50-action chunk, π0.5 (reported)', 250, 696, { size: 18, color: C.mute });
        rowsYN(90, 760, [['yes', 'direct action-chunk generation'], ['no', 'no separate action–outcome evaluation loop']], T.cards + 0.8);
        text(ctx, 'Do WAMs Generalize Better than VLAs?, arXiv 2603.22078, Tab. 5', 90, 852, { size: 16, color: C.faint });
        ctx.restore();
      }
      if (u > T.wam) {
        ctx.save(); ctx.globalAlpha = dim; appear(ctx, ramp(u, T.wam, T.wam + 0.6));
        panelBox(ctx, 1020, 640, 840, 230, { stroke: C.violet });
        text(ctx, '16 s / action', 1050, 698, { fam: SERIF, weight: 600, size: 44, color: C.violet });
        text(ctx, '800 samples · 10 iterations · horizon 1 · one RTX 4090', 1340, 696, { size: 18, color: C.mute });
        rowsYN(1050, 760, [['yes', 'evaluates imagined outcomes'], ['no', 'pays for search at every step']], T.wam + 0.8);
        text(ctx, 'V-JEPA 2, arXiv 2506.09985, Tab. 3', 1050, 852, { size: 16, color: C.faint });
        ctx.restore();
      }
      if (u > T.stat) {
        ctx.save(); appear(ctx, ramp(u, T.stat, T.stat + 0.7));
        statCard(ctx, 410, 330, 1100, 330, '92% → 41%', 'success with a perfect predictor and a fixed 5-step rollout, as the goal moves from 5 to 20 steps away',
          'The Planning Limits of Latent World Models — Alrasheed, Azam, Akhtar, arXiv 2609.39235', { col: C.violet, bigSize: 88 });
        ctx.restore();
      }
    } else if (u < T.fam) {
      // ---- B: world action models are not one design ----
      wash(ctx, 0.96);
      heading(ctx, 'World action models are not one design', 100, 170, 48, ramp(u, T.table, T.table + 0.8));
      const kinds = [
        ['Imagine, score, then act', 'samples action sequences and scores their predicted outcomes', 'V-JEPA 2-AC with CEM — arXiv 2506.09985'],
        ['Predict actions and futures together', 'generates actions directly, with future states and values; can also plan', 'Cosmos Policy — Kim et al., arXiv 2601.16163'],
        ['Learn from video, act directly', 'video co-training, then no imagination at test time', 'Fast-WAM — Yuan et al., arXiv 2603.16666']
      ];
      kinds.forEach(([t, s, src], i) => {
        const y = 300 + i * 150, a = ramp(u, T.table + 1 + i * 2.6, T.table + 1.7 + i * 2.6);
        ctx.save(); appear(ctx, a, 10);
        ctx.fillStyle = C.violet; rrect(ctx, 160, y - 34, 5, 108, 2); ctx.fill();
        text(ctx, t, 192, y, { size: 34, weight: 600, color: C.ink });
        text(ctx, s, 192, y + 42, { size: 24, color: C.mute });
        text(ctx, src, 192, y + 74, { size: 17, color: C.faint });
        ctx.restore();
      });
      ctx.save(); appear(ctx, ramp(u, T.table + 9, T.table + 9.8));
      text(ctx, 'Latency also varies: the WAMs evaluated in one benchmark were 4.8× to 83× slower per inference than π0.5.', 160, 790, { size: 22, color: C.ink });
      text(ctx, 'Model- and configuration-dependent — Do WAMs Generalize Better than VLAs?, arXiv 2603.22078, Tab. 5', 160, 824, { size: 17, color: C.faint });
      ctx.restore();
    } else if (u < T.question) {
      // ---- C: other tools already solve part of it; GPS is not new ----
      wash(ctx, 0.96);
      heading(ctx, 'Other tools already solve part of it', 100, 170, 48, ramp(u, T.fam, T.fam + 0.8));
      const gpsDim = 1 - 0.6 * ramp(u, T.gps, T.gps + 0.6);
      ctx.save(); ctx.globalAlpha = ramp(u, T.fam + 0.3, T.fam + 1) * gpsDim;
      tag(ctx, 'ALREADY GOOD AT', 640, 252, C.faint); tag(ctx, 'WHAT WE WANT TO ADD', 1180, 252, C.orangeDeep);
      ctx.restore();
      const rows = [
        ['Motion planning', 'cuRobo, arXiv 2310.17274', 'feasible motion for given geometry', 'language, vision, learned consequences'],
        ['MPC / model-based RL', 'TD-MPC2, arXiv 2310.16828', 'optimizing on predicted outcomes', 'the VLA’s skill prior; less re-solving'],
        ['Fine-tuning the VLA', 'π0.5, arXiv 2504.16054', 'writing data into the policy', 'targeted corrections, faster adaptation'],
        ['Inference-time guidance', 'OmniGuide 2603.10052 · DynaGuide', 'better behaviour right now', 'cheap, composable, kept after switch-off'],
        ['Amortized guidance', 'AGF, arXiv 2609.34944', 'a light net replaces the critic', 'structure: objects, contacts, physics']
      ];
      rows.forEach(([m, src, good, add], i) => {
        const y = 278 + i * 104, a = ramp(u, T.fam + 0.8 + i * 3.2, T.fam + 1.4 + i * 3.2);
        ctx.save(); ctx.globalAlpha = gpsDim; appear(ctx, a, 10);
        panelBox(ctx, 100, y, 1720, 90, { r: 12 });
        text(ctx, m, 128, y + 42, { size: 26, weight: 600, color: C.ink });
        text(ctx, src, 128, y + 72, { size: 17, color: C.faint });
        text(ctx, good, 640, y + 54, { size: 24, color: C.mute });
        text(ctx, '+ ' + add, 1180, y + 54, { size: 24, weight: 500, color: C.orangeDeep });
        ctx.restore();
      });
      if (u > T.gps) {
        ctx.save(); appear(ctx, ramp(u, T.gps, T.gps + 0.6));
        panelBox(ctx, 100, 812, 1720, 74, { stroke: C.orange, hot: true });
        text(ctx, 'Not new: an optimizer that guides a policy which then acts alone — Guided Policy Search (Levine & Koltun, ICML 2013).', 128, 858, { size: 23, color: C.ink });
        ctx.restore();
      }
    } else {
      // ---- D: the question ----
      wash(ctx, 0.96);
      ctx.save(); appear(ctx, ramp(u, T.question + 0.3, T.question + 1.1));
      tag(ctx, 'THE QUESTION', 160, 330, C.orangeDeep, { size: 18 });
      paragraph(ctx, 'When a new constraint needs extra computation, can that computation become help we no longer need next time?', 160, 420, 1560, { fam: SERIF, weight: 600, size: 52, color: C.ink, lh: 70 });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 7, 'Two ways to act: a direct policy, and a sampling-based world-model planner.'],
      [7, 14, 'Illustrative failure: the direct policy repeats its habit into the barrier.'],
      [14, 21, 'The planner imagines outcomes, scores them, and takes one step.'],
      [21, 28, 'A short rollout scored by endpoint distance can miss the benefit of a detour.'],
      [28, 35, 'The direct policy is fast: one chunk of 50 actions in 63 ms, as reported.'],
      [35, 42, 'The planner evaluates imagined outcomes — and pays for search at every step.'],
      [42, 50, 'Even a perfect predictor does not fix a short-sighted score.'],
      [50, 57, 'World action models are not one design.'],
      [57, 64, 'Some generate actions directly; some skip imagination at test time.'],
      [64, 72, 'Other tools already solve parts of the problem.'],
      [72, 80, 'Planners, MPC, fine-tuning, guidance — each is good at something.'],
      [80, 88, 'What we want to add: reuse the VLA’s skills, and keep the lesson.'],
      [88, 96, 'Teacher-guided policy learning itself is not new: Guided Policy Search.'],
      [96, 106.2, 'The question: can extra reasoning become help we do not need next time?']
    ]);
  }


  // =====================================================================
  // 04 — The bet
  // =====================================================================
  function sceneThesis(ctx, u) {
    wash(ctx, 0.97);
    ctx.save(); appear(ctx, ramp(u, 0.5, 1.4));
    text(ctx, 'First time:', 150, 300, { fam: SERIF, weight: 600, size: 58, color: C.mute });
    text(ctx, 'predict and reason.', 480, 300, { fam: SERIF, weight: 600, size: 58, color: C.orange });
    ctx.restore();
    ctx.save(); appear(ctx, ramp(u, 9, 9.9));
    text(ctx, 'After that:', 150, 384, { fam: SERIF, weight: 600, size: 58, color: C.mute });
    text(ctx, 'a cheap, transferable skill.', 480, 384, { fam: SERIF, weight: 600, size: 58, color: C.teal });
    ctx.restore();
    const nodes = [['Existing skills', 'the small VLA', C.blue], ['Predictive correction', 'in a new situation', C.orange], ['Fast adaptation', 'the VLA is updated', C.teal], ['Acting alone', 'and accumulating', C.green]];
    nodes.forEach(([t, s, col], i) => {
      const x = 150 + i * 420, y = 500, a = ramp(u, 18.5 + i * 1.8, 19.2 + i * 1.8);
      ctx.save(); appear(ctx, a, 10);
      panelBox(ctx, x, y, 360, 130, { stroke: col, bar: col });
      text(ctx, t, x + 30, y + 58, { size: 28, weight: 600, color: C.ink });
      text(ctx, s, x + 30, y + 96, { size: 22, color: C.mute });
      if (i < 3) arrow(ctx, x + 366, y + 65, x + 414, y + 65, { color: C.faint, width: 3, head: 12 });
      ctx.restore();
    });
    captions(ctx, u, [
      [0, 9, 'The first time a problem appears, prediction makes up for missing experience.'],
      [9, 18, 'When it comes back: turn that expensive reasoning into a cheap skill.'],
      [18, 27, 'Skills → corrected in a new situation → the VLA is updated → acting alone.'],
      [27, 36.2, 'Existing skills, a predictive correction, fast adaptation — then acting alone.']
    ]);
  }


  // =====================================================================
  // 05 — Guidance: geometry and predicted consequences (3D: chunk denoising; right: two-branch graph)
  // =====================================================================
  function legendProposal(ctx, x, y, a) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a;
    const w = chip(ctx, 'VLA proposal', x, y, { col: C.blue, size: 20 });
    chip(ctx, 'corrected chunk — executed', x + w + 30, y, { col: C.orange, size: 20 });
    ctx.restore();
  }
  function sceneGuide(ctx, u) {
    const G = TL.guide, pa = ramp(u, G.pipe, G.pipe + 1);
    if (pa > 0) { ctx.save(); ctx.globalAlpha = pa; hWash(ctx, 980, 1090, 0.94, true); ctx.restore(); }
    subhead(ctx, 'The VLA’s own action chunk, being denoised', 80, 140, { color: C.blue });
    legendProposal(ctx, 80, 160, ramp(u, 7, 8));
    const tau = guideTau(u);
    const bx = 130, by = 850, bw = 800;
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; rrect(ctx, bx, by - 6, bw, 12, 6); ctx.fill();
    ctx.fillStyle = rgba(C.orange, 0.35); ctx.fillRect(bx + bw * 0.3, by - 6, bw * 0.5, 12);
    ctx.fillStyle = C.blue; rrect(ctx, bx, by - 6, Math.max(bw * tau, 12), 12, 6); ctx.fill();
    dot(ctx, bx + bw * tau, by, 11, C.ink);
    haloText(ctx, 'denoising time τ', bx, by - 20, { size: 20, weight: 600, color: C.mute });
    haloText(ctx, 'noise · τ = 0', bx, by + 36, { size: 21, color: C.mute });
    haloText(ctx, 'τ = 1 · actions', bx + bw, by + 36, { size: 21, color: C.mute, align: 'right' });
    haloText(ctx, 'guided window', bx + bw * 0.55, by - 20, { size: 20, weight: 600, color: C.orange, align: 'center' });
    haloText(ctx, `τ = ${tau.toFixed(2)}`, bx + bw * 0.55, by + 36, { size: 21, color: C.ink, align: 'center' });
    if (pa > 0) {
      const hot = u < G.geo ? -1 : u < G.cons ? 0 : u < G.sum ? 1 : u < G.upd ? 2 : 3;
      const A = (t0) => ramp(u, t0, t0 + 0.6);
      ctx.save(); ctx.globalAlpha = A(G.pipe);
      mathText(ctx, 'Ahat', 1485, 205, { size: 46, align: 'center', color: C.ink });
      text(ctx, 'clean estimate', 1485, 238, { size: 18, color: C.mute, align: 'center' });
      ctx.restore();
      const branch = (x, y, w, col, title, sub, key, on, t0, lab, labx) => {
        ctx.save(); ctx.globalAlpha = A(t0);
        arrow(ctx, 1485, 252, x + w / 2, y - 6, { color: C.faint, width: 2.5, head: 10 });
        mathText(ctx, lab, labx, 286, { size: 24, color: C.mute, align: 'center' });
        panelBox(ctx, x, y, w, 160, { stroke: col, hot: on, fill: on ? 'rgba(30,38,52,0.95)' : undefined });
        text(ctx, title, x + 22, y + 40, { size: 24, weight: 600, color: C.ink });
        text(ctx, sub, x + 22, y + 68, { size: 17, color: C.mute });
        mathText(ctx, key, x + w / 2, y + 128, { size: 28, color: on ? C.ink : C.mute, align: 'center' });
        ctx.restore();
      };
      branch(1120, 310, 340, C.teal, 'Geometry', 'from sensors or simulation', 'EgeoK', hot === 0, G.pipe + 0.6, 'Kmap', 1270);
      branch(1500, 310, 350, C.orange, 'Consequences', 'trained action-conditioned model', 'Econs', hot === 1, G.pipe + 1.2, 'Fmap', 1720);
      ctx.save(); ctx.globalAlpha = A(G.cons);
      text(ctx, 'g, c — goal and constraints decide the score', 1675, 498, { size: 17, color: hot === 1 ? C.orangeDeep : C.faint, align: 'center' });
      ctx.restore();
      ctx.save(); ctx.globalAlpha = A(G.pipe + 1.8);
      arrow(ctx, 1290, 474, 1400, 540, { color: C.faint, width: 2.5, head: 10 });
      arrow(ctx, 1675, 510, 1580, 540, { color: C.faint, width: 2.5, head: 10 });
      panelBox(ctx, 1120, 546, 730, 84, { stroke: C.ink, hot: hot === 2, fill: hot === 2 ? 'rgba(30,38,52,0.95)' : undefined });
      mathText(ctx, 'Esum', 1485, 598, { size: 28, color: hot === 2 ? C.ink : C.mute, align: 'center' });
      arrow(ctx, 1485, 634, 1485, 664, { color: C.faint, width: 2.5, head: 10 });
      panelBox(ctx, 1120, 670, 730, 104, { stroke: C.orange, hot: hot === 3, fill: hot === 3 ? 'rgba(58,38,20,0.92)' : undefined });
      mathText(ctx, 'update', 1485, 722, { size: 32, color: hot === 3 ? C.orangeDeep : C.mute, align: 'center' });
      const pw = mathText(ctx, 'Pcal', 1300, 756, { size: 20, color: C.faint });
      text(ctx, '  normalize · clip · smooth — not the raw gradient', 1300 + pw, 756, { size: 17, color: C.faint });
      ctx.restore();
      // symbol definitions, one beat per highlighted step
      [[G.pipe + 0.6, G.geo, [['Ahat', 'estimate of the finished chunk, at the current τ'], ['sA', 'action chunk: a block of the robot’s next actions']]],
        [G.geo, G.cons, [['Kmap', 'arm kinematics: chunk → path of gripper and banana'], ['sEgeo', 'clearance from obstacles + progress to the goal']]],
        [G.cons, G.sum, [['Ftheta', 'action-conditioned world model, with weights θ'], ['sh', 'current observation and recent history'], ['sell', 'cost read out from the predicted outcome']]],
        [G.sum, G.upd, [['sE', 'total energy of the chunk: lower is better'], ['gc', 'the goal; the constraints of this task']]],
        [G.upd, 99, [['sv', 'the VLA’s denoising velocity, with weights φ'], ['slam', 'guidance strength'], ['sgradA', 'gradient of the energy at the estimate']]]
      ].forEach(([a, b, rows]) => {
        const al = fade(u, a, a + 0.4, b - 0.3, b); if (al <= 0) return;
        ctx.save(); ctx.globalAlpha *= al; symLegend(ctx, 1140, 826, rows, { symW: 92 }); ctx.restore();
      });
    }
    captions(ctx, u, [
      [0, 7, 'How the teacher helps: it corrects the VLA’s own action chunk.'],
      [7, 14, 'Blue: what the VLA proposes. Orange: the corrected chunk the robot executes.'],
      [14, 20, 'π0.5 denoises in 10 steps, GR00T N1.6 in 4; guidance acts mid-way.'],
      [20, 27, 'From the clean estimate, two branches: geometry and predicted consequences.'],
      [27, 34, 'Geometry comes from sensors or simulation, through the arm’s kinematics.'],
      [34, 41, 'Consequences come from a trained action-conditioned model, read out as costs.'],
      [41, 48, 'The goal and constraints decide how the predicted outcome is scored.'],
      [48, 54, 'A processed gradient updates the velocity: normalized, clipped, smoothed.'],
      [54, 60.2, 'Planners and best-of-N stay in the study as strong baselines.']
    ]);
  }


  // =====================================================================
  // 06 — The geometry part of the teacher
  // =====================================================================
  function sceneGeom(ctx, u) {
    const T = TL.geom;
    const keep = 1 - ramp(u, T.check, T.check + 0.6);
    subhead(ctx, 'Local energy: attract to the bowl + repel from the barrier', 80, 140, { color: C.orange, alpha: 1 - ramp(u, T.T - 0.5, T.T) });
    subhead(ctx, 'Geometric progress field T — computed numerically', 80, 140, { color: C.teal, alpha: ramp(u, T.T, T.T + 0.6) * keep });
    legendProposal(ctx, 80, 160, ramp(u, T.prop, T.prop + 0.8) * keep);
    if (u > T.T + 1 && keep > 0) {
      ctx.save(); appear(ctx, ramp(u, T.T + 1, T.T + 1.8) * keep);
      panelBox(ctx, 1290, 170, 560, 276, { stroke: C.teal });
      mathText(ctx, 'eikonal', 1570, 246, { size: 46, align: 'center', color: C.ink });
      symLegend(ctx, 1320, 306, [['sT', 'time to the goal at speed S; T = 0 at the goal'], ['sS', 'speed: 0 in obstacles, 1 beyond 6 cm clearance'],
        ['sx', 'position of the banana’s centre'], ['snegT', 'steepest descent of T: the way to the goal', T.grad[0]]], { u, symW: 92, tsize: 18 });
      ctx.restore();
    }
    if (u > T.check) numericCheck(ctx, u - T.check);
    captions(ctx, u, [
      [0, 7, 'The geometry part of the teacher. A plain attract-and-repel field…'],
      [7, 14, '…cancels in front of the barrier: no upward push. It stalls.'],
      [14, 21, 'A geometric progress field T, computed numerically, measures the way to the goal.'],
      [21, 28, 'The field evaluates progress; the VLA still proposes the motion.'],
      [28, 36, 'The correction lifts the chunk over the barrier, and the robot executes it.'],
      [36, 41.5, 'We checked the geometric target numerically, on twelve fixed synthetic cases.'],
      [41.5, 47, 'Local energy stops in all nine blocked ones; adding T reaches seven cleanly.'],
      [47, 52.2, 'A random correction of the same size goes through, like no correction at all.']
    ]);
  }
  // our own numerical check of the manual geometric field (12 fixed synthetic cases, ideal point kinematics)
  function numericCheck(ctx, v) {
    ctx.save(); ctx.globalAlpha = ramp(v, 0, 0.8); wash(ctx, 0.95); ctx.restore();
    ctx.save(); appear(ctx, ramp(v, 0.3, 1.1));
    tag(ctx, 'OUR NUMERICAL CHECK — THE GEOMETRIC TARGET ALONE', 160, 240, C.tealDeep, { size: 16 });
    text(ctx, 'Reached the goal without passing through an obstacle', 160, 306, { fam: SERIF, weight: 600, size: 44, color: C.ink });
    text(ctx, 'nine blocked cases · same start and goal for every method', 160, 350, { size: 22, color: C.mute });
    ctx.restore();
    const rows = [
      ['No correction — the straight proposal', 0, 'passes through the obstacle', C.blue, 1.5],
      ['Local attraction + repulsion', 0, 'stops in front of it', C.violet, 2.7],
      ['Local energy + progress field T', 7, 'two symmetric starts stall', C.teal, 6],
      ['Random correction of the same size', 0, 'passes through the obstacle', C.faint, 11.2]
    ];
    const bx = 780, bw = 720;
    rows.forEach(([lab, n, note, col, t0], i) => {
      const y = 450 + i * 100;
      ctx.save(); appear(ctx, ramp(v, t0, t0 + 0.7), 8);
      text(ctx, lab, 160, y, { size: 26, weight: 600, color: C.ink });
      text(ctx, note, 160, y + 32, { size: 19, color: C.mute });
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; rrect(ctx, bx, y - 22, bw, 30, 6); ctx.fill();
      const f = (n / 9) * sramp(v, t0 + 0.3, t0 + 1.3);
      if (f > 0) { ctx.fillStyle = col; rrect(ctx, bx, y - 22, Math.max(bw * f, 10), 30, 6); ctx.fill(); }
      text(ctx, `${n} / 9`, bx + bw + 40, y + 6, { fam: SERIF, weight: 600, size: 40, color: n ? col : C.mute });
      ctx.restore();
    });
    ctx.save(); ctx.globalAlpha = ramp(v, 6.5, 7.3);
    text(ctx, '12 fixed synthetic cases (in the 3 unobstructed ones all four methods reach the goal) · ideal point motion, no robot · 20 mm voxels, 30 mm inflation', 160, 862, { size: 18, color: C.faint });
    ctx.restore();
  }


  // =====================================================================
  // 07 — A direction, not a verdict
  // =====================================================================
  function sceneDirect(ctx, u) {
    const T = TL.direct;
    hWash(ctx, 1000, 1110, 0.92, true);
    subhead(ctx, 'The VLA’s proposal, and what the teacher says about it', 80, 140, { color: C.blue });
    legendProposal(ctx, 80, 160, ramp(u, TL.direct.bend[0], TL.direct.bend[0] + 0.8));
    ctx.save(); appear(ctx, ramp(u, 1, 1.8));
    panelBox(ctx, 1120, 170, 700, 130, { stroke: C.red });
    tag(ctx, 'A VERDICT', 1150, 214, C.faint);
    mark(ctx, 'no', 1168, 256, 17);
    text(ctx, 'this action is bad', 1200, 266, { size: 32, weight: 600, color: C.ink });
    ctx.restore();
    if (u > T.keep - 1) {
      ctx.save(); appear(ctx, ramp(u, T.keep - 1, T.keep - 0.2));
      panelBox(ctx, 1120, 330, 700, 260, { stroke: C.orange });
      tag(ctx, 'A DIRECTION', 1150, 374, C.orangeDeep);
      [['keep the forward progress', C.blue, T.keep], ['add clearance over the barrier', C.orange, T.lift], ['ease the acceleration', C.orange, T.ease]].forEach(([s, col, t0], i) => {
        ctx.save(); ctx.globalAlpha *= ramp(u, t0, t0 + 0.5);
        dot(ctx, 1166, 434 + i * 58 - 9, 7, col);
        text(ctx, s, 1190, 434 + i * 58, { size: 28, color: C.ink });
        ctx.restore();
      });
      ctx.restore();
    }
    if (u > T.eq) {
      ctx.save(); appear(ctx, ramp(u, T.eq, T.eq + 0.8));
      mathText(ctx, 'taylor', 1470, 672, { size: 42, color: C.ink, align: 'center' });
      symLegend(ctx, 1160, 724, [['sA', 'the VLA’s proposed chunk, as one vector', T.eq + 0.6], ['sdA', 'a small change to the chunk', T.eq + 1.2],
        ['sgradE', 'where E rises fastest: step against it', T.eq + 1.8]], { u, symW: 100 });
      ctx.restore();
    }
    if (u > T.dagger) {
      ctx.save(); appear(ctx, ramp(u, T.dagger, T.dagger + 0.8));
      text(ctx, 'Corrections on states the student visits — as in DAgger (Ross et al., 2011)', 1470, 852, { size: 19, color: C.faint, align: 'center' });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 7, 'A verdict says only: this action is bad.'],
      [7, 14, 'A gradient says how nearby actions would score better.'],
      [14, 21, 'Keep the forward progress, add clearance, ease the acceleration.'],
      [21, 28, 'Corrections land on the states the student actually visits.'],
      [28, 34, 'This helps only if the gradient points to an executable improvement.'],
      [34, 40.2, 'Test: same VLA, same budget vs. imitation, fine-tuning, policy optimization.']
    ]);
  }

  // =====================================================================
  // 08 — Same path, different physics (3D split screen: slow | fast)
  // =====================================================================
  function sceneSlip(ctx, u) {
    topWash(ctx, 260, 0.94);
    heading(ctx, 'Same path, different speed', 100, 150, 44, ramp(u, 0, 0.8));
    ctx.save(); ctx.globalAlpha = ramp(u, 1, 2); spaced(ctx, 'ILLUSTRATIVE CONSEQUENCES UNDER ONE CHOSEN GRIP', 760, 150, { size: 16, weight: 600, color: C.orangeDeep, spacing: 2.2 }); ctx.restore();
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(959, 190, 2, 890); ctx.restore();
    [[0, 'Slow', C.green], [960, 'Fast', C.red]].forEach(([x, label, col], pi) => {
      ctx.save(); ctx.fillStyle = col; rrect(ctx, x + 60, 204, 4, 34, 2); ctx.fill(); ctx.restore();
      haloText(ctx, label, x + 80, 232, { size: 30, weight: 600, color: C.ink });
      haloText(ctx, pi === 0 ? 'duration 2× · lower peak acceleration' : 'duration 1× · higher peak acceleration', x + 80, 262, { size: 19, color: C.mute });
      ctx.save(); ctx.globalAlpha = ramp(u, 8, 8.8);
      chip(ctx, 'untimed geometric path: indistinguishable', x + 60, 776, { mark: 'part', size: 23 });
      ctx.globalAlpha = ramp(u, 15, 15.8);
      chip(ctx, pi === 0 ? 'trained readout: grip holds' : 'trained readout: slip risk', x + 60, 826, { mark: pi === 0 ? 'yes' : 'no', size: 23 });
      ctx.restore();
    });
    captions(ctx, u, [
      [0, 8, 'Same path, different timing — illustrative consequences under one chosen grip.'],
      [8, 15, 'As an untimed geometric path, the two are indistinguishable.'],
      [15, 22, 'Trained outcome readouts must tell them apart — the key criterion.'],
      [22, 28, 'And it must beat a simple analytic grip-stability baseline.'],
      [28, 34.2, 'Fixed-rate action sequences already encode speed; bare paths do not.']
    ]);
  }

  // =====================================================================
  // 09 — Change the task, not the weights
  // =====================================================================
  function sceneIntervene(ctx, u) {
    const T = TL.intervene, ph = T.phase;
    subhead(ctx, 'Separate how the world changes from what we want this time', 80, 140, { color: C.teal });
    legendProposal(ctx, 80, 160, ramp(u, TL.intervene.phase[0], TL.intervene.phase[0] + 0.8));
    // formula card (whole scene)
    ctx.save(); appear(ctx, ramp(u, 0.5, 1.3));
    panelBox(ctx, 1320, 170, 520, 230, {});
    mathText(ctx, 'energy1', 1350, 230, { size: 32, color: C.ink });
    mathText(ctx, 'energy2', 1392, 280, { size: 32, color: C.ink });
    const fw = mathText(ctx, 'Ftheta', 1352, 328, { size: 24, color: C.tealDeep }); text(ctx, '  what happens — reused', 1352 + fw, 327, { size: 20, color: C.tealDeep });
    const gw = mathText(ctx, 'gc', 1352, 358, { size: 24, color: C.orangeDeep }); text(ctx, '  what we want — swapped', 1352 + gw, 357, { size: 20, color: C.orangeDeep });
    const ew = mathText(ctx, 'sEgeo', 1352, 388, { size: 24, color: C.orangeDeep }); text(ctx, '  recomputed per layout — no training', 1352 + ew, 387, { size: 20, color: C.orangeDeep });
    ctx.restore();
    if (u < T.diag) {
      const step = u < ph[0] ? -1 : u < ph[1] ? 0 : u < ph[2] ? 1 : u < T.goal ? 2 : 3;
      ['Barrier removed', 'Top closed', 'Taller barrier', 'New goal, cup forbidden'].forEach((s, i) => {
        const y = 426 + i * 74, on = i === step, done = i < step;
        ctx.save(); ctx.globalAlpha = ramp(u, 1 + i * 0.3, 1.6 + i * 0.3) * (1 - ramp(u, T.diag - 0.5, T.diag));
        panelBox(ctx, 1320, y, 520, 62, { r: 12, stroke: on ? C.teal : null, hot: on, fill: on ? 'rgba(18,58,55,0.92)' : undefined });
        ctx.globalAlpha *= on || done ? 1 : 0.5;
        badge(ctx, i + 1, 1352, y + 31, on ? C.teal : done ? C.tealDeep : C.faint, 15);
        text(ctx, s, 1380, y + 40, { size: 24, weight: 600, color: C.ink });
        ctx.restore();
      });
    } else {
      ctx.save(); appear(ctx, ramp(u, T.diag, T.diag + 0.7));
      panelBox(ctx, 1320, 426, 520, 300, { stroke: C.orange });
      tag(ctx, 'WHEN IT FAILS, ASK WHERE', 1350, 470, C.orangeDeep);
      ['goal grounding', 'geometry', 'contact rules', 'consequence prediction'].forEach((s, i) => {
        ctx.save(); ctx.globalAlpha *= ramp(u, T.diag + 0.4 + i * 0.5, T.diag + 0.9 + i * 0.5);
        chip(ctx, s, 1350 + (i % 2) * 236, 500 + Math.floor(i / 2) * 76, { col: C.orange, size: 20 });
        ctx.restore();
      });
      if (u > T.agf) {
        ctx.globalAlpha *= ramp(u, T.agf, T.agf + 0.6);
        text(ctx, 'Baseline: equally informed vector guidance', 1350, 678, { size: 20, color: C.ink });
        text(ctx, 'AGF, arXiv 2609.34944', 1350, 706, { size: 17, color: C.faint });
      }
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 8, 'Separate how the world changes from what we want this time.'],
      [8, 16, 'Remove the barrier: the field follows. No weights change.'],
      [16, 24, 'Close the top: −∇T turns toward the side opening.'],
      [24, 32, 'Raise the barrier: more clearance. Same skills, same predictor.'],
      [32, 38, 'New instruction: the blue bowl — and do not touch the cup.'],
      [38, 44, 'Only the goal and the contact rules change; the field updates at once.'],
      [44, 50, 'When it fails, we can ask where: goal, geometry, contact rules, prediction.'],
      [50, 56.2, 'Structure must still beat an equally informed vector network.']
    ]);
  }

  // =====================================================================
  // 10 — Teacher → energy student
  // =====================================================================
  function sceneTeach(ctx, u) {
    wash(ctx, 0.95);
    heading(ctx, 'Teacher → energy student', 100, 170, 48, ramp(u, 0, 0.8));
    const box = (x, y, w, h, title, body, col, al) => {
      ctx.save(); appear(ctx, al);
      panelBox(ctx, x, y, w, h, { stroke: col, bar: col });
      text(ctx, title, x + 30, y + 56, { size: 30, weight: 600, color: C.ink });
      text(ctx, body, x + 30, y + 102, { size: 23, color: C.mute });
      ctx.restore();
    };
    const ty = 270, sy = 610, bh = 140;
    ctx.save(); ctx.globalAlpha = ramp(u, 0.5, 1.2); tag(ctx, 'FULL TEACHER  ·  OFFLINE SUPERVISION + SELECTIVE ADAPTATION-TIME USE', 100, ty - 22, C.orangeDeep, { size: 17 }); ctx.restore();
    box(100, ty, 520, bh, 'Explicit geometry', 'SDF · numerical T · contact rules', C.teal, ramp(u, 1, 1.8));
    box(660, ty, 560, bh, 'Action-conditioned JEPA', '→ trained readouts: grip · slip · contact', C.orange, ramp(u, 7, 7.8));
    box(1260, ty, 560, bh, 'Teacher energy', 'scores the VLA’s own proposal', C.orangeDeep, ramp(u, 9, 9.8));
    ctx.save(); appear(ctx, ramp(u, 21, 22));
    arrow(ctx, 960, ty + bh + 14, 960, sy - 30, { color: C.mute, width: 4, head: 18 });
    haloText(ctx, 'distill: values + gradients', 990, ty + bh + 112, { size: 24, color: C.ink });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 28, 28.7); tag(ctx, 'ENERGY STUDENT  ·  LEARNS TO EVALUATE CHEAPLY', 100, sy - 22, C.tealDeep, { size: 17 }); ctx.restore();
    box(100, sy, 520, bh, 'Scene encoder', 'once per chunk', C.blue, ramp(u, 28, 28.8));
    box(660, sy, 560, bh, 'Geometry energy', 'SDF + numerical T, from sensors', C.teal, ramp(u, 28.6, 29.4));
    box(1260, sy, 560, bh, 'Consequence module', 'small, per action query', C.orange, ramp(u, 29.2, 30));
    ctx.save(); ctx.globalAlpha = ramp(u, 35, 36);
    chip(ctx, 'Evaluation is cheaper — the VLA itself has not changed yet.', 100, 810, { col: C.red, size: 24 });
    ctx.restore();
    captions(ctx, u, [
      [0, 7, 'The full teacher: explicit geometry plus an action-conditioned JEPA.'],
      [7, 14, 'JEPA predicts future representations; trained readouts turn them into costs.'],
      [14, 21, 'It supervises offline, and may step in again during allowed adaptation.'],
      [21, 28, 'Its judgement is distilled into a light energy student: values and gradients.'],
      [28, 35, 'The student encodes the scene once and queries consequences cheaply.'],
      [35, 42.2, 'This makes evaluation cheaper. The VLA itself has not changed yet.']
    ]);
  }


  // =====================================================================
  // 11 — Policy student: learning to need it less (loop → before/after split → key line)
  // =====================================================================
  function scenePolicy(ctx, u) {
    const P = TL.policy;
    if (u < P.split) {
      wash(ctx, 0.96);
      heading(ctx, 'Two students', 100, 170, 48, ramp(u, 0, 0.8));
      [[100, 'Energy student', 'learns to evaluate cheaply', C.teal, 0.6], [980, 'Policy student — the VLA', 'learns to act without the evaluator', C.blue, 7]].forEach(([x, t, s, col, t0]) => {
        ctx.save(); appear(ctx, ramp(u, t0, t0 + 0.8));
        panelBox(ctx, x, 220, 840, 120, { stroke: col, bar: col, hot: x > 500 && u > 7 });
        text(ctx, t, x + 32, 270, { size: 32, weight: 600, color: C.ink });
        text(ctx, s, x + 32, 312, { size: 24, color: C.mute });
        ctx.restore();
      });
      const nodes = [['VLA proposal', 'the current policy', C.blue, 14], ['Teacher correction', 'guided by the energy', C.orange, 15], ['Execute & observe', 'keep only verified corrections', C.green, 16],
        ['Update the VLA', 'own objective + old-skill replay', C.teal, 21], ['Test, guidance off', 'held-out starts · no T', C.green, 28]];
      nodes.forEach(([t, s, col, t0], i) => {
        const x = 100 + i * 352, y = 420, w = 320, h = 128;
        ctx.save(); appear(ctx, ramp(u, t0, t0 + 0.7), 10);
        panelBox(ctx, x, y, w, h, { stroke: col, bar: col });
        badge(ctx, i + 1, x + 34, y + 40, col, 15);
        text(ctx, t, x + 60, y + 48, { size: 25, weight: 600, color: C.ink });
        text(ctx, s, x + 26, y + 96, { size: 19, color: C.mute });
        if (i < 4) arrow(ctx, x + w + 2, y + h / 2, x + 348, y + h / 2, { color: C.faint, width: 2.5, head: 9 });
        ctx.restore();
      });
      ctx.save(); ctx.globalAlpha = ramp(u, 28.5, 29.3);
      ctx.strokeStyle = C.faint; ctx.lineWidth = 2.5; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(1668, 552); ctx.lineTo(1668, 590); ctx.lineTo(260, 590); ctx.lineTo(260, 556); ctx.stroke(); ctx.setLineDash([]);
      arrow(ctx, 260, 572, 260, 552, { color: C.faint, width: 2.5, head: 9 });
      text(ctx, 'next round', 964, 614, { size: 18, color: C.faint, align: 'center' });
      ctx.restore();
      ctx.save(); ctx.globalAlpha = ramp(u, 21.5, 22.3);
      mathText(ctx, 'piUpdate', 960, 712, { size: 52, align: 'center', color: C.ink });
      text(ctx, 'data: execution-verified corrections + replay of old skills', 960, 764, { size: 22, color: C.mute, align: 'center' });
      symInline(ctx, [['spi', 'the VLA as a policy, with weights φ'], ['sk', 'adaptation round']], 960, 812);
      ctx.restore();
    } else if (u < P.line) {
      topWash(ctx, 300, 0.94);
      heading(ctx, 'Teacher off: before vs. after adaptation', 100, 150, 42, ramp(u, P.split, P.split + 0.8));
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(959, 190, 2, 890); ctx.restore();
      [[0, 'Before adaptation', 'teacher off · held-out start', C.red], [960, 'After adaptation', 'teacher off · the same held-out start', C.green]].forEach(([x, t, s, col]) => {
        ctx.fillStyle = col; rrect(ctx, x + 60, 206, 4, 54, 2); ctx.fill();
        haloText(ctx, t, x + 80, 232, { size: 30, weight: 600, color: C.ink });
        haloText(ctx, s, x + 80, 262, { size: 19, color: C.mute });
      });
      const cond = u < P.c2 ? 'Held-out condition 1 · a higher barrier' : 'Held-out condition 2 · grip near one end';
      haloText(ctx, cond, 960, 312, { size: 24, weight: 600, color: C.orangeDeep, align: 'center', alpha: u < P.c2 ? ramp(u, P.split + 0.5, P.split + 1.2) : ramp(u, P.c2, P.c2 + 0.7) });
    } else {
      wash(ctx, 0.97);
      ctx.save(); appear(ctx, ramp(u, P.line + 0.3, P.line + 1.2));
      text(ctx, 'Making the correction cheaper is not enough.', 960, 440, { fam: SERIF, weight: 600, size: 58, color: C.ink, align: 'center' });
      ctx.restore();
      ctx.save(); appear(ctx, ramp(u, P.line + 3, P.line + 4));
      text(ctx, 'The policy must learn to need it less.', 960, 540, { fam: SERIF, weight: 600, size: 58, color: C.orange, align: 'center' });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 7, 'Two kinds of learning. The energy student learns to evaluate cheaply.'],
      [7, 14, 'The policy student — the VLA itself — must learn to act without it.'],
      [14, 21, 'Execute the corrected chunk and observe the outcome; keep only what works.'],
      [21, 28, 'Update the VLA with its own objective, replaying old skills.'],
      [28, 36, 'Then test with all guidance off, from starts never used in adaptation.'],
      [36, 44, 'Left: before adaptation. Right: after. Same held-out start, no teacher.'],
      [44, 52, 'A second held-out condition: the grip is near one end of the banana.'],
      [52, 58, 'Both run without the teacher; only the VLA’s weights differ.'],
      [58, 65, 'Making the correction cheaper is not enough.'],
      [65, 72.2, 'The policy must learn to need it less.']
    ]);
  }


  // =====================================================================
  // 12 — From simulation to a real kitchen
  // =====================================================================
  function sceneSim2Real(ctx, u) {
    const S = TL.sim2real;
    if (u < S.fix) {
      topWash(ctx, 300, 0.94);
      heading(ctx, 'From simulation to a real kitchen', 100, 150, 42, ramp(u, 0, 0.8));
      ctx.save(); ctx.globalAlpha = ramp(u, 1, 2) * (1 - ramp(u, S.geo - 0.5, S.geo)); spaced(ctx, 'ILLUSTRATIVE FAILURE', 1150, 150, { size: 16, weight: 600, color: C.orangeDeep, spacing: 2.2 }); ctx.restore();
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(959, 190, 2, 890); ctx.restore();
      const g = ramp(u, S.geo + 0.9, S.geo + 1.5), g0 = 1 - ramp(u, S.geo, S.geo + 0.5);
      [[0, 'Simulation', 'where the VLA was trained', C.blue], [960, 'A new kitchen', 'new texture, light, background — and camera pose', C.orange]].forEach(([x, title, sub, col]) => {
        ctx.save(); ctx.globalAlpha = ramp(u, 0.6, 1.4);
        ctx.fillStyle = col; rrect(ctx, x + 60, 206, 4, 54, 2); ctx.fill();
        haloText(ctx, title, x + 80, 232, { size: 30, weight: 600, color: col });
        haloText(ctx, sub, x + 80, 262, { size: 18, color: C.mute, alpha: g0 });
        haloText(ctx, 'geometry only: surface normals on a metric grid', x + 80, 262, { size: 18, color: C.tealDeep, alpha: g });
        ctx.restore();
      });
      haloText(ctx, 'Same geometry, same frame — in both kitchens', 960, 330, { size: 26, weight: 600, color: C.tealDeep, align: 'center', alpha: ramp(u, S.geo + 2, S.geo + 3) });
    } else if (u < S.cards) {
      subhead(ctx, 'The teacher works on the geometry layer — in the new kitchen', 80, 140, { color: C.teal });
      legendProposal(ctx, 80, 160, ramp(u, S.fix + 1, S.fix + 1.8));
    } else if (u < S.open) {
      wash(ctx, 0.96);
      heading(ctx, 'What prior work shows', 100, 170, 48, ramp(u, S.cards, S.cards + 0.8));
      const cards = [
        ['95% → <30%', 'VLA success under modest camera-viewpoint and robot-state perturbations', 'LIBERO-Plus — Fei et al., arXiv 2510.13626', C.blue],
        ['2.7% → 36.9%', 'real-world success of a sim-trained policy (Click Bell): no randomization vs. table-height randomization; background alone: 11.5%', 'Jin et al., arXiv 2603.22876, Tab. 1', C.teal],
        ['72.5% → 84.7%', 'π0.5 real-robot OOD completion with a JEPA world-model loss added in training only (5 tasks × 10 rollouts); median latency 54.05 → 55.12 ms', 'JEPA-WAM — Lin et al., arXiv 2608.09381, §4.4, Tab. 12', C.orange]
      ];
      cards.forEach(([big, lab, src, col], i) => {
        ctx.save(); appear(ctx, ramp(u, S.cards + 0.5 + i * 2.5, S.cards + 1.2 + i * 2.5));
        statCard(ctx, 100 + i * 590, 250, 560, 350, big, lab, src, { col, bigSize: 54, lsize: 22 });
        ctx.restore();
      });
    } else {
      wash(ctx, 0.96);
      ctx.save(); appear(ctx, ramp(u, S.open + 0.3, S.open + 1.1));
      tag(ctx, 'WHAT WE TEST', 160, 330, C.orangeDeep, { size: 18 });
      paragraph(ctx, 'Does a teacher that works on geometry make a small VLA adapt to a new kitchen faster — fewer demonstrations to the same success — and keep it once the teacher is off?', 160, 420, 1600, { fam: SERIF, weight: 600, size: 46, color: C.ink, lh: 64 });
      ctx.restore();
      ctx.save(); ctx.globalAlpha = ramp(u, S.open + 3, S.open + 4);
      text(ctx, 'Prior work shows robustness gains from world-model losses in training — not adaptation speed. That is the Level 3 test, run in a new environment.', 160, 700, { size: 22, color: C.mute });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 6, 'Trained in simulation, the VLA meets a real kitchen.'],
      [6, 13, 'New texture, light and background — and a different camera pose.'],
      [13, 20, 'A small VLA must absorb all of it from pixels; larger models run slower.'],
      [20, 27, 'Drop the textures: the geometry, in the robot’s own frame, is the same.'],
      [27, 34, 'The teacher’s world model learns dynamics on this layer, in simulation.'],
      [34, 42, 'In the new kitchen it sees the same layer — and corrects the VLA’s chunk.'],
      [42, 50, 'Its gradient shows the VLA how to adapt; the update keeps what it learned.'],
      [50, 56, 'Prior work: VLAs are brittle to camera and robot-state shifts.'],
      [56, 62, 'Spatial setup matters more than texture; a world-model loss in training helps.'],
      [62, 72.2, 'What we test: does the geometry teacher make adaptation to a new kitchen faster?']
    ]);
  }

  // =====================================================================
  // 12 — Deployment states
  // =====================================================================
  function sceneInvest(ctx, u) {
    const T = TL.invest;
    subhead(ctx, 'Deployment states', 80, 140, { color: C.green });
    const st = [['A', 'Full teacher', 'only for new or uncertain cases', C.orange, T.A], ['B', 'Energy student', 'cheaper — geometry still guides', C.teal, T.B], ['C', 'Updated VLA alone', 'T off too · safety check only', C.green, T.C]];
    const cur = u < T.B ? 0 : u < T.C ? 1 : 2;
    st.forEach(([k, title, sub, col, t0], i) => {
      const y = 170 + i * 150;
      ctx.save(); appear(ctx, ramp(u, t0 - 1, t0 - 0.3));
      panelBox(ctx, 1320, y, 520, 130, { stroke: col, hot: i === cur });
      ctx.globalAlpha *= i === cur ? 1 : 0.55;
      badge(ctx, k, 1362, y + 65, col, 22);
      text(ctx, title, 1402, y + 58, { size: 28, weight: 600, color: C.ink });
      text(ctx, sub, 1402, y + 94, { size: 21, color: C.mute });
      ctx.restore();
    });
    if (u > T.measure) {
      ctx.save(); appear(ctx, ramp(u, T.measure, T.measure + 0.7));
      panelBox(ctx, 1320, 640, 520, 190, {});
      tag(ctx, 'TO MEASURE, OVER A DEPLOYMENT', 1350, 684, C.faint);
      [['teacher calls', '↓', C.orange], ['human interventions', '↓', C.orange], ['success', '↑', C.green]].forEach(([s, a, col], i) => {
        text(ctx, a, 1352, 730 + i * 34, { size: 26, weight: 700, color: col });
        text(ctx, s, 1386, 730 + i * 34, { size: 23, color: C.ink });
      });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 8, 'Deployment states, from most help to none.'],
      [8, 15, 'A: the full teacher, called only for new or uncertain cases.'],
      [15, 22, 'B: the energy student — cheaper, but geometry still guides.'],
      [22, 28, 'C: the updated VLA alone. T is off, too; only a safety check remains.'],
      [28, 34.2, 'To measure: teacher calls and interventions fall while success rises.']
    ]);
  }


  // =====================================================================
  // 13 — Four levels, and Level 3 as a concrete test
  // =====================================================================
  function sceneLevels(ctx, u) {
    const L = TL.levels;
    wash(ctx, 0.95);
    if (u < L.test) {
      const fo = 1 - ramp(u, L.test - 0.6, L.test);
      heading(ctx, 'Four levels of success', 100, 170, 48, ramp(u, 0, 0.8) * fo);
      const lv = [
        ['Helped on a new combination', 'with the teacher, first time', C.orange, 0.6],
        ['One teacher, unseen combinations', 'one set of parameters', C.teal, 8],
        ['VLA alone, from new starts', 'after a little guidance', C.green, 14],
        ['Each next task needs less help', 'skills accumulate, none forgotten', C.blue, 22]
      ];
      lv.forEach(([t, s, col, t0], i) => {
        const x = 100 + i * 435, y = 640 - i * 112, w = 410, h = 150, key = i === 2;
        ctx.save(); ctx.globalAlpha = fo; appear(ctx, ramp(u, t0, t0 + 0.8));
        panelBox(ctx, x, y, w, h, { stroke: col, hot: key, bar: col });
        tag(ctx, `LEVEL ${i + 1}`, x + 30, y + 40, col);
        text(ctx, t, x + 30, y + 86, { size: 25, weight: 600, color: C.ink });
        text(ctx, s, x + 30, y + 122, { size: 20, color: C.mute });
        if (key) { ctx.globalAlpha *= ramp(u, 16, 16.8); chip(ctx, 'first paper’s endpoint', x, y - 60, { col: C.green, size: 20 }); }
        ctx.restore();
      });
    } else {
      heading(ctx, 'Level 3, as a test', 100, 170, 48, ramp(u, L.test, L.test + 0.8));
      const cols = [[130, 'METHOD'], [860, 'ADAPTATION BUDGET'], [1220, 'AT TEST'], [1560, 'STARTS']];
      ctx.save(); ctx.globalAlpha = ramp(u, L.test + 0.3, L.test + 1);
      cols.forEach(([x, s]) => tag(ctx, s, x, 262, C.faint));
      ctx.restore();
      const rows = [['Direct fine-tuning', ''], ['Imitate the corrected actions', ''], ['Teacher-guided update', 'verified corrections · gradient-informed']];
      rows.forEach(([m, sub], i) => {
        const y = 290 + i * 120;
        ctx.save(); appear(ctx, ramp(u, L.rows + i * 1.6, L.rows + 0.6 + i * 1.6), 10);
        panelBox(ctx, 100, y, 1720, 100, { r: 12, stroke: i === 2 ? C.orange : null, hot: i === 2 });
        text(ctx, m, 130, y + (sub ? 46 : 60), { size: 27, weight: 600, color: C.ink });
        if (sub) text(ctx, sub, 130, y + 80, { size: 19, color: C.mute });
        text(ctx, 'equal', 860, y + 60, { size: 24, color: C.ink });
        text(ctx, 'all guidance off', 1220, y + 60, { size: 24, color: C.ink });
        text(ctx, 'held-out', 1560, y + 60, { size: 24, color: C.ink });
        ctx.restore();
      });
      ctx.save(); ctx.globalAlpha = ramp(u, L.limit, L.limit + 0.8);
      panelBox(ctx, 100, 680, 900, 110, { stroke: C.red });
      tag(ctx, 'LIMIT', 130, 720, C.red);
      text(ctx, 'The student must observe what decides the right action.', 130, 762, { size: 25, color: C.ink });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 8, 'Level 1: with the teacher, a new combination is handled correctly.'],
      [8, 14, 'Level 2: one teacher guides combinations it was never trained on.'],
      [14, 22, 'Level 3: after a little guidance, the VLA alone succeeds from new starts.'],
      [22, 30, 'Level 4: each related task needs less teaching than the one before.'],
      [30, 38, 'Level 3 as a test: the same adaptation budget for every method.'],
      [38, 46, 'Direct fine-tuning, imitating corrected actions, and the teacher-guided update.'],
      [46, 52, 'Same budget, all guidance off, held-out starts: success decides.'],
      [52, 56.2, 'Limit: the student must be able to see what decides the right action.']
    ]);
  }


  // =====================================================================
  // 14 — What we do not claim
  // =====================================================================
  function sceneNotClaims(ctx, u) {
    wash(ctx, 0.95);
    heading(ctx, 'What we build on — and what it gives us', 100, 170, 48, ramp(u, 0, 0.8));
    ctx.save(); ctx.globalAlpha = ramp(u, 0.4, 1.0);
    tag(ctx, 'WE BUILD ON', 100, 262, C.tealDeep); tag(ctx, 'WHAT WE GAIN', 1000, 262, C.orangeDeep);
    ctx.restore();
    const rows = [
      ['Geometric fields', 'SDF and a numerically computed progress field T', 'A progress signal for any layout', 'recomputed when the scene changes — no retraining'],
      ['An action-conditioned world model', 'trained readouts: grip, slip, contact', 'Consequences geometry cannot see', 'same path, different speed — told apart'],
      ['The VLA’s own skills', 'its proposal and its denoising steps', 'Corrections close to what it already does', 'a gradient on its own chunk, not a new path'],
      ['Execution-verified corrections', 'replayed together with old skills', 'A VLA that needs the teacher less', 'checked with all guidance off, from held-out starts'],
      ['Geometry learned in simulation', 'in the robot’s frame — the layer the world model works on', 'A teacher that carries into a real kitchen', 'the same layer in sim and real — its gradient adapts the VLA']
    ];
    rows.forEach(([l, ls, r, rs], i) => {
      const y = 318 + i * 118, t0 = 7.5 + i * 7;
      ctx.save(); appear(ctx, ramp(u, t0, t0 + 0.7), 10);
      ctx.fillStyle = C.teal; rrect(ctx, 100, y - 32, 5, 88, 2); ctx.fill();
      text(ctx, l, 130, y, { size: 29, weight: 600, color: C.ink });
      text(ctx, ls, 130, y + 42, { size: 21, color: C.mute });
      ctx.restore();
      ctx.save(); ctx.globalAlpha = ramp(u, t0 + 1.6, t0 + 2.2);
      arrow(ctx, 860, y + 6, 950, y + 6, { color: C.faint, width: 3, head: 12 });
      ctx.restore();
      ctx.save(); appear(ctx, ramp(u, t0 + 2.2, t0 + 2.9), 10);
      ctx.fillStyle = C.orange; rrect(ctx, 1000, y - 32, 5, 88, 2); ctx.fill();
      text(ctx, r, 1030, y, { size: 29, weight: 600, color: C.ink });
      text(ctx, rs, 1030, y + 42, { size: 21, color: C.mute });
      ctx.restore();
    });
    captions(ctx, u, [
      [0, 7, 'What we build on, and what each part gives us.'],
      [7, 14, 'Geometric fields give a progress signal that is recomputed for any layout.'],
      [14, 21, 'A world model adds the consequences geometry cannot see: slip, contact, timing.'],
      [21, 28, 'Correcting the VLA’s own chunk keeps it close to the skills it already has.'],
      [28, 35, 'Learning from verified corrections, the VLA needs the teacher less.'],
      [35, 42.2, 'Geometry learned in simulation carries the teacher into a real kitchen.']
    ]);
  }


  // =====================================================================
  // 14 — The proposition
  // =====================================================================
  function sceneEnd(ctx, u) {
    wash(ctx, 0.97);
    ctx.save(); appear(ctx, ramp(u, 0.4, 1.2));
    tag(ctx, 'THE PROPOSITION — STATED SO THAT IT CAN FAIL', 160, 200, C.orangeDeep, { size: 18 });
    paragraph(ctx, 'For a small VLA with basic skills: can a structured predictive teacher make it adapt to unseen constraint combinations and new environments with fewer new demonstrations or interactions — and keep that ability once guidance is removed?', 160, 282, 1600, { fam: SERIF, weight: 600, size: 44, color: C.ink, lh: 62 });
    ctx.restore();
    const parts = [['Useful on new combinations', C.orange], ['Cheaper adaptation', C.teal], ['Holds without the teacher', C.green]];
    parts.forEach(([s, col], i) => {
      ctx.save(); appear(ctx, ramp(u, 6 + i * 1.5, 6.8 + i * 1.5));
      panelBox(ctx, 160 + i * 540, 540, 500, 100, { stroke: col, bar: col });
      badge(ctx, i + 1, 214 + i * 540, 590, col, 20);
      text(ctx, s, 252 + i * 540, 599, { size: 27, weight: 600, color: C.ink });
      ctx.restore();
    });
    ctx.save(); appear(ctx, ramp(u, 20, 20.8));
    text(ctx, 'Not a smarter planner carried forever — a teacher the robot outgrows.', 960, 740, { fam: SERIF, weight: 600, size: 38, color: C.orangeDeep, align: 'center' });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 25, 26);
    text(ctx, 'Qifei C.', 160, 818, { size: 24, weight: 600, color: C.ink });
    text(ctx, '· CocoMatrix', 160 + (font(ctx, 600, 24, SANS), ctx.measureText('Qifei C.').width) + 10, 818, { size: 24, color: C.mute });
    text(ctx, 'Cited: arXiv 2603.22078 · 2506.09985 · 2609.39235 · 2511.18606 · 2602.03973 · 2601.16163 · 2603.16666 · 2608.09381 · 2510.13626 · 2603.22876', 160, 856, { size: 16, color: C.faint });
    text(ctx, 'arXiv 2603.10052 · 2609.34944 · 2310.17274 · 2310.16828 · 2504.16054 · Levine & Koltun 2013 · Ross et al. 2011 · our numerical check: manual field, 12 synthetic cases', 160, 880, { size: 16, color: C.faint });
    text(ctx, 'Schematic RoboCasa-style kitchen · Franka Panda meshes: MuJoCo Menagerie (Apache-2.0) · Banana: YCB Object and Model Set scan, object 011 (CC BY 4.0, re-oriented, texture resized)', 160, 906, { size: 16, color: C.faint });
    ctx.restore();
    captions(ctx, u, [
      [0, 10, 'The proposition, stated so that it can fail.'],
      [10, 18, 'One part: better inference. Two: faster adaptation. All three: the loop.'],
      [18, 25, 'Not a smarter planner carried forever — a teacher the robot outgrows.']
    ]);
  }

  // =====================================================================
  // 16 — Appendix: related work and prior numbers
  // =====================================================================
  function sceneAppendix(ctx, u) {
    wash(ctx, 0.97);
    const P2 = 14, pg = u < P2 ? 0 : 1, v = u - pg * P2;
    heading(ctx, pg ? 'Appendix: sim-to-real, world-model loss — and our check' : 'Appendix: prior numbers and their scope', 100, 170, 48, ramp(v, 0, 0.8));
    const cards = pg ? [
      ['95% → <30%', 'VLA success under modest perturbations, mainly camera viewpoint and robot initial state (7 perturbation dimensions)', 'LIBERO-Plus — Fei et al., arXiv 2510.13626', C.blue],
      ['2.7% → 36.9%', 'Click Bell, real world, sim-trained: no randomization vs. table-height randomization (background 11.5%, lighting 12.3%, camera pose 23.5%); >10k real trials overall', 'Jin et al., arXiv 2603.22876, §4.2, Tab. 1', C.teal],
      ['72.5% → 84.7%', 'π0.5 + JEPA world-model objective, training only: real-robot OOD completion (5 bimanual tasks × 10 rollouts); LIBERO-Plus 84.5 → 86.3; latency 54.05 → 55.12 ms', 'JEPA-WAM — Lin et al., arXiv 2608.09381, §4.4, Tab. 2, Tab. 12', C.orange],
      ['7 / 9', 'blocked cases reached without sampled penetration by local energy + T (local, none, random same-norm: 0/9 each); 12 fixed cases, ideal point kinematics, 20 mm voxels, 30 mm inflation, 5 mm steps, seed 20261101', 'Our run — manual field, CPU (5.5 s); trajectories-v2.json, metrics-v2.json', C.teal]
    ] : [
      ['63 ms', 'π0.5, per 50-action chunk; evaluated WAMs 4.8–83× slower per inference (model and config dependent)', 'Do WAMs Generalize Better than VLAs?, arXiv 2603.22078, Tab. 5', C.blue],
      ['16 s / action', 'V-JEPA 2-AC CEM planning: 800 samples, 10 iterations, horizon 1, one RTX 4090', 'V-JEPA 2, arXiv 2506.09985, Tab. 3', C.violet],
      ['92% → 41%', 'perfect predictor, fixed 5-step rollout, goal 5 → 20 steps away', 'The Planning Limits of Latent World Models, arXiv 2609.39235', C.violet],
      ['62%', 'least-restrictive filter baseline stalled (open-bag lifting): safe is not the same as progress', 'LatentCBF, arXiv 2511.18606, Tab. 2', C.red]
    ];
    cards.forEach(([big, lab, src, col], i) => {
      const x = 100 + (i % 2) * 880, y = 230 + Math.floor(i / 2) * 300;
      ctx.save(); appear(ctx, ramp(v, 0.6 + i * 0.8, 1.3 + i * 0.8));
      statCard(ctx, x, y, 840, 270, big, lab, src, { col, bigSize: 58, lsize: pg ? 18 : 22, tag: pg && i === 3 ? 'OUR NUMERICAL CHECK' : 'PRIOR WORK' });
      ctx.restore();
    });
    ctx.save(); ctx.globalAlpha = ramp(v, 4.5, 5.5);
    text(ctx, 'Different tasks and protocols — not one comparison.', 100, 860, { size: 22, color: C.mute });
    ctx.restore();
    captions(ctx, u, [
      [0, 7, 'Prior numbers, each from its own task and protocol — not one comparison.'],
      [7, 14, 'They motivate the questions this plan asks.'],
      [14, 22, 'Sim-to-real and world-model numbers, with their settings.'],
      [22, 30.2, 'Our own numerical check is labelled as ours, with its full setup.']
    ]);
  }

  const DRAW = { title: sceneTitle, gap: sceneGap, tools: sceneTools, thesis: sceneThesis, guide: sceneGuide, geom: sceneGeom, direct: sceneDirect, slip: sceneSlip, intervene: sceneIntervene, teach: sceneTeach, policy: scenePolicy, sim2real: sceneSim2Real, invest: sceneInvest, levels: sceneLevels, notclaims: sceneNotClaims, end: sceneEnd, appendix: sceneAppendix };
  const OPAQUE = { thesis: 1, teach: 1, levels: 1, notclaims: 1, end: 1, appendix: 1 }; // diagram scenes: no vignette needed

  // ---- fields (built once; scene3d.js reads core.F) ----
  let FIELDS = null;
  function getF() { return FIELDS || (FIELDS = buildFields()); }

  // ---- environment / compositor ----
  function createEnv(makeCanvas) {
    const env = { makeCanvas, F: getF(), cache: {} };
    env.off = makeCanvas(W, H); mkCanvas = makeCanvas;
    if (!texEnv) texEnv = { makeCanvas, F: env.F, cache: {} };
    return env;
  }
  function sceneIndexAt(t) {
    for (let i = SCENES.length - 1; i >= 0; i--) if (t >= SCENES[i].start) return i;
    return 0;
  }
  function drawScene(ctx, i, u, env, fi) {
    const id = SCENES[i].id;
    ctx.save();
    if (!OPAQUE[id]) vignette(ctx, 0.55);
    drawLabels(ctx, fi);
    DRAW[id](ctx, u, env, fi || {});
    ctx.restore();
    eyebrow(ctx, i + 1, SCENES[i].name, ramp(u, 0, 0.6));
  }
  // Draw the overlay at absolute time t onto a TRANSPARENT ctx (the caller clears it).
  // fiPrev: frame info of the previous scene's last frame (0.5 s crossfade). opts.opaque: paint the background first.
  function draw(ctx, t, env, fi, fiPrev, opts) {
    t = clamp(t, 0, DUR - 1e-3); fi = fi || {};
    if (opts && opts.opaque) background(ctx);
    const i = sceneIndexAt(t), s = SCENES[i], u = t - s.start;
    if (i > 0 && u < FADE) {
      const a = easeIO(u / FADE), off = env.off, octx = off.getContext('2d');
      const layer = (idx, uu, f, alpha) => {
        octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalAlpha = 1; octx.clearRect(0, 0, W, H);
        drawScene(octx, idx, uu, env, f || {});
        ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(off, 0, 0); ctx.restore();
      };
      layer(i - 1, SCENES[i - 1].dur - 0.001, fiPrev, 1 - a);
      layer(i, u, fi, a);
    } else drawScene(ctx, i, u, env, fi);
    progressLine(ctx, t / DUR);
  }

  // true where the overlay fully covers the 3D layer (diagram beats): capture may update the 3D at a low rate there
  function overlayCovers(t) {
    const i = sceneIndexAt(t), s = SCENES[i], u = t - s.start;
    if (u < FADE + 0.05 || u > s.dur - 0.05) return false;
    return !!OPAQUE[s.id] || (s.id === 'tools' && u > TL.tools.table + 1) || (s.id === 'policy' && (u < TL.policy.split - 0.5 || u > TL.policy.line + 1)) || (s.id === 'sim2real' && u > TL.sim2real.cards + 1) || (s.id === 'geom' && u > TL.geom.check + 1);
  }
  const util = { clamp, lerp, ramp, sramp, easeIO, easeOut, fade, WORLD, FX0, FX1, FZ0, FZ1, rng: mulberry32, arcPath, contactPoint, guideTau, SLIP, TL, rgba };
  return {
    W, H, C, SCENES, DUR, FADE, createEnv, draw, sceneIndexAt, buildFields, util, paintFieldTexture, setMath, overlayCovers,
    get F() { return getF(); }
  };
});
