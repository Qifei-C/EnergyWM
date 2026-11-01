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
    bowl2X: 1.05, cup: { x0: 0.90, x1: 0.95, h: 0.11 }, goal2: { x0: 0.99, x1: 1.11, z0: 0.03, z1: 0.10 }
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
    // L4: new goal (blue bowl) + forbidden contact with the cup and the old bowl
    const G2 = WORLD.goal2, CU = WORLD.cup, b0 = WORLD.bowlX - WORLD.bowlR, b1 = WORLD.bowlX + WORLD.bowlR;
    F.L4 = makeField(Object.assign({}, base, {
      sdf: (x, y) => Math.min(sideSdf(WORLD.barrierH)(x, y), rectSdf(x, y, CU.x0, CU.x1, -1, CU.h), rectSdf(x, y, b0, b1, -1, WORLD.bowlH)),
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
  const MATH_FALLBACK = { vtheta: 'vθ', Ahat: 'Â', KAhat: 'K(Â)', EKAhat: 'E(K(Â))', guided: 'vθ − λ∇E', eikonal: 'S(x) ‖∇T(x)‖ = 1', taylor: 'E(A + ΔA) ≈ E(A) + ∇E(A)ᵀΔA', energy1: 'E(A; g, c) = Egeo(A; c)', energy2: '+ ℓ(Fθ(h, A); g, c)', Ftheta: 'Fθ', gc: 'g, c' };
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
  // is gradually no longer needed. Everything shown is a plan / hypothesis; every number is cited prior work.
  const SCENES = [
    { id: 'title', name: 'Title', dur: 10 },
    { id: 'gap', name: 'Skills, not the combination', dur: 56 },
    { id: 'tools', name: 'What today’s models cannot do', dur: 76 },
    { id: 'thesis', name: 'The bet', dur: 36 },
    { id: 'guide', name: 'Guidance by energy gradient', dur: 50 },
    { id: 'geom', name: 'The geometry part of the teacher', dur: 40 },
    { id: 'direct', name: 'A direction, not a verdict', dur: 40 },
    { id: 'slip', name: 'Same path, different physics', dur: 34 },
    { id: 'intervene', name: 'Change the task, not the weights', dur: 56 },
    { id: 'teach', name: 'From teacher to student', dur: 44 },
    { id: 'invest', name: 'Guidance as an investment', dur: 44 },
    { id: 'levels', name: 'Four levels of success', dur: 44 },
    { id: 'notclaims', name: 'What we do not claim', dur: 32 },
    { id: 'end', name: 'The proposition', dur: 30 }
  ];
  let acc = 0; for (const s of SCENES) { s.start = acc; acc += s.dur; }
  const DUR = acc;

  // Beat timings (scene-local seconds) shared by the overlay and the 3D layer.
  const TL = {
    gap: { skills: [1.5, 13], chips: [3, 4.5, 7, 10, 12], combo: 16, comboChips: [16.5, 19, 21.5, 24], fail: [30, 33], why: 37, vls: 46 },
    tools: { vla: [3, 6], cem: [[8, 11], [11, 14], [14, 17]], step1: [17, 19], cem2: [[19, 22], [22, 25]], step2: [25, 27], cards: 30, wam: 37, stat: 44, table: 50, gps: 72 },
    guide: { pipe: 14 },
    geom: { ghost: [2, 3.5], a1: [3.5, 5], a2: [5, 6.5], a3: [8, 9.5], card: 14, T: 20, cut: [20.8, 26.5], quiver: [27, 28], grad: [27.5, 28.7] },
    direct: { keep: 8, lift: 10, ease: 12, bend: [16, 20], eq: 14, dagger: 21 },
    intervene: { phase: [8, 16, 24], goal: 32, goalCut: [33, 37], diag: 44, agf: 50 },
    invest: { A: 7, B: 14, C: 26, measure: 38 }
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
    spaced(ctx, 'RESEARCH PLAN  ·  CONCEPT / HYPOTHESIS  ·  2026-11-01', 150, 784, { size: 19, weight: 600, color: C.mute, spacing: 2.6 });
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
      [46, 56.2, 'Our scope: re-using and adapting existing skills, not inventing new ones.']
    ]);
  }

  // =====================================================================
  // 03 — What today's models cannot do (split VLA | WAM, cited facts, other tools)
  // =====================================================================
  function sceneTools(ctx, u) {
    const T = TL.tools;
    if (u < T.table) {
      const dimForStat = 1 - 0.85 * ramp(u, T.stat, T.stat + 0.6);
      topWash(ctx, 300, 0.94);
      heading(ctx, 'Two strong families today', 100, 150, 44, ramp(u, 0, 0.8));
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(959, 190, 2, 890); ctx.restore();
      const halves = [
        [0, 'Single VLA', 'π0.5 · GR00T N1.6', C.blue],
        [960, 'World action model', 'Cosmos-Policy · GE-Act · LingBot-VA · V-JEPA 2-AC planner', C.violet]
      ];
      halves.forEach(([x, title, sub, col]) => {
        ctx.save(); ctx.globalAlpha = ramp(u, 0.6, 1.4);
        ctx.fillStyle = col; rrect(ctx, x + 60, 206, 4, 54, 2); ctx.fill();
        haloText(ctx, title, x + 80, 232, { size: 30, weight: 600, color: col });
        haloText(ctx, sub, x + 80, 262, { size: 19, color: C.mute });
        ctx.restore();
      });
      // fact cards
      const rows = (x, y, items, t0) => items.forEach(([k, s], i) => {
        ctx.save(); ctx.globalAlpha *= ramp(u, t0 + i * 1.6, t0 + i * 1.6 + 0.5);
        mark(ctx, k, x + 16, y + i * 50 - 9, 14);
        text(ctx, s, x + 44, y + i * 50, { size: 24, color: C.ink });
        ctx.restore();
      });
      if (u > T.cards) {
        ctx.save(); ctx.globalAlpha = dimForStat; appear(ctx, ramp(u, T.cards, T.cards + 0.6));
        panelBox(ctx, 60, 610, 840, 250, { stroke: C.blue });
        rows(90, 668, [['yes', 'one forward pass per chunk'], ['no', 'no look-ahead at consequences'], ['no', 'brittle outside its training data']], T.cards + 0.3);
        text(ctx, '63 ms', 870, 690, { fam: SERIF, weight: 600, size: 60, color: C.blue, align: 'right' });
        text(ctx, 'π0.5, one inference step', 870, 722, { size: 18, color: C.mute, align: 'right' });
        text(ctx, 'Latency: Do WAMs Generalize Better than VLAs?, arXiv 2603.22078, Tab. 5', 90, 840, { size: 16, color: C.faint });
        ctx.restore();
      }
      if (u > T.wam) {
        ctx.save(); ctx.globalAlpha = dimForStat; appear(ctx, ramp(u, T.wam, T.wam + 0.6));
        panelBox(ctx, 1020, 610, 840, 250, { stroke: C.violet });
        rows(1050, 668, [['yes', 'predicts what happens next'], ['no', 'imagines before every action'], ['no', 'short-horizon scores miss detours']], T.wam + 0.3);
        text(ctx, '4.8–83×', 1830, 678, { fam: SERIF, weight: 600, size: 50, color: C.violet, align: 'right' });
        text(ctx, 'slower than π0.5 per step', 1830, 704, { size: 18, color: C.mute, align: 'right' });
        text(ctx, '16 s', 1830, 772, { fam: SERIF, weight: 600, size: 50, color: C.violet, align: 'right' });
        text(ctx, 'per action, V-JEPA 2-AC (CEM)', 1830, 798, { size: 18, color: C.mute, align: 'right' });
        text(ctx, 'arXiv 2603.22078, Tab. 5  ·  V-JEPA 2, arXiv 2506.09985, §4.2', 1050, 840, { size: 16, color: C.faint });
        ctx.restore();
      }
      if (u > T.stat) {
        ctx.save(); appear(ctx, ramp(u, T.stat, T.stat + 0.7));
        statCard(ctx, 460, 330, 1000, 330, '92% → 41%', 'success with a perfect predictor, as the goal moves from 5 to 20 steps away',
          'The Planning Limits of Latent World Models — Alrasheed, Azam, Akhtar, arXiv 2609.39235', { col: C.violet, bigSize: 92 });
        ctx.restore();
      }
    } else {
      wash(ctx, 0.96);
      heading(ctx, 'Other tools already solve part of it', 100, 170, 48, ramp(u, T.table, T.table + 0.8));
      const gpsDim = 1 - 0.6 * ramp(u, T.gps, T.gps + 0.6);
      ctx.save(); ctx.globalAlpha = ramp(u, T.table + 0.3, T.table + 1) * gpsDim;
      tag(ctx, 'ALREADY GOOD AT', 640, 252, C.faint); tag(ctx, 'WHAT WE WANT TO ADD — TO BE TESTED', 1180, 252, C.orangeDeep);
      ctx.restore();
      const rows = [
        ['Motion planning', 'cuRobo, arXiv 2310.17274', 'feasible motion for given geometry', 'language, vision, learned consequences'],
        ['MPC / model-based RL', 'TD-MPC2, arXiv 2310.16828', 'optimizing on predicted outcomes', 'the VLA’s skill prior; less re-solving'],
        ['Fine-tuning the VLA', 'π0.5, arXiv 2504.16054', 'writing data into the policy', 'targeted corrections, faster adaptation'],
        ['Inference-time guidance', 'OmniGuide 2603.10052 · DynaGuide', 'better behaviour right now', 'cheap, composable, kept after switch-off'],
        ['Amortized guidance', 'AGF, arXiv 2609.34944', 'a light net replaces the critic', 'structure: objects, contacts, physics']
      ];
      rows.forEach(([m, src, good, add], i) => {
        const y = 278 + i * 104, a = ramp(u, T.table + 0.8 + i * 3.2, T.table + 1.4 + i * 3.2);
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
    }
    captions(ctx, u, [
      [0, 7, 'Two strong families today: single VLAs and world action models.'],
      [7, 14, 'A VLA that never saw this barrier acts at once — straight into it.'],
      [14, 22, 'A world model imagines futures, scores them, then takes one step.'],
      [22, 30, 'Its short-horizon score cannot see that the detour pays off.'],
      [30, 37, 'VLAs are fast, but they do not look ahead at consequences.'],
      [37, 44, 'World models look ahead, but are much slower to act.'],
      [44, 50, 'Distance-to-goal scoring breaks on far goals, even with perfect prediction.'],
      [50, 58, 'Other tools already solve parts: planners, MPC, fine-tuning, guidance.'],
      [58, 66, 'What we want to add: reuse the VLA’s skills, and keep the lesson.'],
      [66, 72, 'Guidance that is cheap, composable — and survives being switched off.'],
      [72, 76.2, 'Teacher-guided policy learning itself is not new.']
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
    const nodes = [['Existing skills', 'the small VLA', C.blue], ['Predictive correction', 'in a new situation', C.orange], ['Fast adaptation', 'the lesson is learned', C.teal], ['Acting alone', 'and accumulating', C.green]];
    nodes.forEach(([t, s, col], i) => {
      const x = 150 + i * 420, y = 500, a = ramp(u, 18.5 + i * 1.8, 19.2 + i * 1.8);
      ctx.save(); appear(ctx, a, 10);
      panelBox(ctx, x, y, 360, 130, { stroke: col, bar: col });
      text(ctx, t, x + 30, y + 58, { size: 28, weight: 600, color: C.ink });
      text(ctx, s, x + 30, y + 96, { size: 22, color: C.mute });
      if (i < 3) arrow(ctx, x + 366, y + 65, x + 414, y + 65, { color: C.faint, width: 3, head: 12 });
      ctx.restore();
    });
    ctx.save(); appear(ctx, ramp(u, 27, 27.8));
    ctx.fillStyle = C.orange; ctx.fillRect(150, 712, 60, 3);
    spaced(ctx, 'HYPOTHESIS  ·  TO BE ESTABLISHED BY EXPERIMENT', 150, 752, { size: 18, weight: 600, color: C.orangeDeep, spacing: 2.6 });
    ctx.restore();
    captions(ctx, u, [
      [0, 9, 'The first time a problem appears, prediction makes up for missing experience.'],
      [9, 18, 'When it comes back: turn that expensive reasoning into a cheap skill.'],
      [18, 27, 'Skills → corrected in a new situation → fast adaptation → acting alone.'],
      [27, 36.2, 'These are advantages we hope to establish — not results we have.']
    ]);
  }

  // =====================================================================
  // 05 — Guidance by energy gradient (3D: the action chunk denoising in place)
  // =====================================================================
  function sceneGuide(ctx, u) {
    const pa = ramp(u, TL.guide.pipe, TL.guide.pipe + 1);
    if (pa > 0) { ctx.save(); ctx.globalAlpha = pa; hWash(ctx, 1040, 1150, 0.92, true); ctx.restore(); }
    subhead(ctx, 'The VLA’s own action chunk, being denoised', 80, 140, { color: C.blue });
    const tau = guideTau(u), inWin = tau >= 0.3 && tau <= 0.8;
    const bx = 130, by = 850, bw = 800;
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; rrect(ctx, bx, by - 6, bw, 12, 6); ctx.fill();
    ctx.fillStyle = rgba(C.orange, 0.35); ctx.fillRect(bx + bw * 0.3, by - 6, bw * 0.5, 12);
    ctx.fillStyle = C.blue; rrect(ctx, bx, by - 6, Math.max(bw * tau, 12), 12, 6); ctx.fill();
    dot(ctx, bx + bw * tau, by, 11, C.ink);
    haloText(ctx, 'noise', bx, by + 36, { size: 21, color: C.mute });
    haloText(ctx, 'actions', bx + bw, by + 36, { size: 21, color: C.mute, align: 'right' });
    haloText(ctx, 'guided', bx + bw * 0.55, by - 20, { size: 21, weight: 600, color: C.orange, align: 'center' });
    haloText(ctx, `τ = ${tau.toFixed(2)}`, bx + bw * 0.55, by + 36, { size: 21, color: C.ink, align: 'center' });
    if (pa > 0) {
      const boxes = [['Velocity', 'vtheta'], ['Clean estimate', 'Ahat'], ['Kinematics', 'KAhat'], ['Energy', 'EKAhat'], ['Guided velocity', 'guided']];
      const bx0 = 1160, by0 = 190, bw0 = 660, bh0 = 82, gap = 30;
      const active = !inWin ? (tau > 0.8 ? 4 : 0) : Math.min(4, 1 + Math.floor(((tau - 0.3) / 0.5) * 4));
      boxes.forEach((b, i) => {
        const y = by0 + i * (bh0 + gap), al = ramp(u, TL.guide.pipe + 0.3 + i * 0.4, TL.guide.pipe + 0.9 + i * 0.4);
        ctx.save(); ctx.globalAlpha = al;
        const hot = i === active;
        panelBox(ctx, bx0, y, bw0, bh0, { stroke: hot ? C.orange : null, hot, fill: hot ? 'rgba(58,38,20,0.92)' : undefined });
        text(ctx, b[0], bx0 + 28, y + 52, { size: 28, weight: 600, color: hot ? C.orangeDeep : C.ink });
        mathText(ctx, b[1], bx0 + bw0 - 28, y + 53, { size: 34, color: hot ? C.orangeDeep : C.mute, align: 'right' });
        if (i < boxes.length - 1) arrow(ctx, bx0 + bw0 / 2, y + bh0 + 3, bx0 + bw0 / 2, y + bh0 + gap - 3, { color: C.faint, width: 2.5, head: 10 });
        ctx.restore();
      });
    }
    captions(ctx, u, [
      [0, 7, 'How the teacher helps: it nudges the VLA’s own action chunk.'],
      [7, 14, 'A flow-matching VLA denoises a chunk: π0.5 in 10 steps, GR00T N1.6 in 4.'],
      [14, 22, 'Each guided step: clean estimate → kinematics → energy → gradient.'],
      [22, 30, 'Guidance acts only in the middle window, τ from 0.3 to 0.8.'],
      [30, 37, 'Gradients are normalized, step-limited and smoothed over the chunk.'],
      [37, 44, 'No reference path and no ranking: an interface choice, not a claim.'],
      [44, 50.2, 'Planners and best-of-N stay in the study as strong baselines.']
    ]);
  }

  // =====================================================================
  // 06 — The geometry part of the teacher (local field stalls; geodesic T)
  // =====================================================================
  function sceneGeom(ctx, u) {
    const T = TL.geom;
    subhead(ctx, 'Local energy: attract to the bowl + repel from the barrier', 80, 140, { color: C.orange, alpha: 1 - ramp(u, T.T - 0.5, T.T) });
    subhead(ctx, 'Geodesic progress field T', 80, 140, { color: C.teal, alpha: ramp(u, T.T, T.T + 0.6) });
    if (u > T.card && u < T.T + 0.4) {
      ctx.save(); appear(ctx, fade(u, T.card, T.card + 0.7, T.T - 0.4, T.T + 0.4));
      statCard(ctx, 1360, 300, 480, 310, '62%', 'of hardware trials stalled — safe, but stuck',
        'Least-restrictive safety filter (baseline) in LatentCBF, arXiv 2511.18606, Tab. 2', { col: C.red, srcLines: 2 });
      ctx.restore();
    }
    if (u > T.T + 1) {
      ctx.save(); appear(ctx, ramp(u, T.T + 1, T.T + 1.8));
      panelBox(ctx, 1360, 170, 480, 170, { stroke: C.teal });
      mathText(ctx, 'eikonal', 1600, 250, { size: 46, align: 'center', color: C.ink });
      text(ctx, 'T = 0 at the goal', 1600, 300, { size: 23, align: 'center', color: C.mute });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 7, 'The geometry part of the teacher. A plain attract-and-repel field…'],
      [7, 14, '…cancels in front of the barrier: no upward push. It stalls.'],
      [14, 20, 'Avoidance alone can be “safe, but stuck” — also on real hardware.'],
      [20, 27, 'A geodesic progress field T measures the shortest way to the goal.'],
      [27, 34, 'In front of the barrier, −∇T points up and over.'],
      [34, 40.2, 'Geometry is one ingredient — not the goal of this project.']
    ]);
  }

  // =====================================================================
  // 07 — A direction, not a verdict
  // =====================================================================
  function sceneDirect(ctx, u) {
    const T = TL.direct;
    hWash(ctx, 1000, 1110, 0.92, true);
    subhead(ctx, 'The VLA’s proposal, and what the teacher says about it', 80, 140, { color: C.blue });
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
      ctx.restore();
    }
    if (u > T.dagger) {
      ctx.save(); appear(ctx, ramp(u, T.dagger, T.dagger + 0.8));
      text(ctx, 'Corrections on states the student visits — as in DAgger (Ross et al., 2011)', 1470, 730, { size: 19, color: C.faint, align: 'center' });
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
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(959, 190, 2, 890); ctx.restore();
    [[0, 'Slow', C.green], [960, 'Fast', C.red]].forEach(([x, label, col], pi) => {
      ctx.save(); ctx.fillStyle = col; rrect(ctx, x + 60, 204, 4, 34, 2); ctx.fill(); ctx.restore();
      haloText(ctx, label, x + 80, 232, { size: 30, weight: 600, color: C.ink });
      ctx.save(); ctx.globalAlpha = ramp(u, 8, 8.8);
      chip(ctx, 'geometry: same score', x + 60, 820, { mark: 'part', size: 24 });
      ctx.globalAlpha = ramp(u, 15, 15.8);
      chip(ctx, pi === 0 ? 'consequences: grip holds' : 'consequences: slip risk', x + 420, 820, { mark: pi === 0 ? 'yes' : 'no', size: 24 });
      ctx.restore();
    });
    captions(ctx, u, [
      [0, 8, 'Same path, different speed. Slow keeps the banana; fast lets it slip.'],
      [8, 15, 'A geometry-only energy gives both the same score.'],
      [15, 22, 'The teacher must tell them apart — the key criterion.'],
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
    // formula card (whole scene)
    ctx.save(); appear(ctx, ramp(u, 0.5, 1.3));
    panelBox(ctx, 1320, 170, 520, 200, {});
    mathText(ctx, 'energy1', 1350, 230, { size: 32, color: C.ink });
    mathText(ctx, 'energy2', 1392, 280, { size: 32, color: C.ink });
    const fw = mathText(ctx, 'Ftheta', 1352, 328, { size: 24, color: C.tealDeep }); text(ctx, '  what happens — reused', 1352 + fw, 327, { size: 20, color: C.tealDeep });
    const gw = mathText(ctx, 'gc', 1352, 358, { size: 24, color: C.orangeDeep }); text(ctx, '  what we want — swapped', 1352 + gw, 357, { size: 20, color: C.orangeDeep });
    ctx.restore();
    if (u < T.diag) {
      const step = u < ph[0] ? -1 : u < ph[1] ? 0 : u < ph[2] ? 1 : u < T.goal ? 2 : 3;
      ['Barrier removed', 'Top closed', 'Taller barrier', 'New goal, cup forbidden'].forEach((s, i) => {
        const y = 400 + i * 76, on = i === step, done = i < step;
        ctx.save(); ctx.globalAlpha = ramp(u, 1 + i * 0.3, 1.6 + i * 0.3) * (1 - ramp(u, T.diag - 0.5, T.diag));
        panelBox(ctx, 1320, y, 520, 62, { r: 12, stroke: on ? C.teal : null, hot: on, fill: on ? 'rgba(18,58,55,0.92)' : undefined });
        ctx.globalAlpha *= on || done ? 1 : 0.5;
        badge(ctx, i + 1, 1352, y + 31, on ? C.teal : done ? C.tealDeep : C.faint, 15);
        text(ctx, s, 1380, y + 40, { size: 24, weight: 600, color: C.ink });
        ctx.restore();
      });
    } else {
      ctx.save(); appear(ctx, ramp(u, T.diag, T.diag + 0.7));
      panelBox(ctx, 1320, 400, 520, 300, { stroke: C.orange });
      tag(ctx, 'WHEN IT FAILS, ASK WHERE', 1350, 444, C.orangeDeep);
      ['goal grounding', 'geometry', 'contact rules', 'consequence prediction'].forEach((s, i) => {
        ctx.save(); ctx.globalAlpha *= ramp(u, T.diag + 0.4 + i * 0.5, T.diag + 0.9 + i * 0.5);
        chip(ctx, s, 1350 + (i % 2) * 236, 474 + Math.floor(i / 2) * 76, { col: C.orange, size: 20 });
        ctx.restore();
      });
      if (u > T.agf) {
        ctx.globalAlpha *= ramp(u, T.agf, T.agf + 0.6);
        text(ctx, 'Baseline: equally informed vector guidance', 1350, 652, { size: 20, color: C.ink });
        text(ctx, 'AGF, arXiv 2609.34944', 1350, 680, { size: 17, color: C.faint });
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
  // 10 — From teacher to student (intermediate step)
  // =====================================================================
  function sceneTeach(ctx, u) {
    wash(ctx, 0.95);
    heading(ctx, 'From teacher to student', 100, 170, 48, ramp(u, 0, 0.8));
    const box = (x, y, w, h, title, body, col, al) => {
      ctx.save(); appear(ctx, al);
      panelBox(ctx, x, y, w, h, { stroke: col, bar: col });
      text(ctx, title, x + 30, y + 56, { size: 30, weight: 600, color: C.ink });
      text(ctx, body, x + 30, y + 102, { size: 24, color: C.mute });
      ctx.restore();
    };
    const ty = 270, sy = 610, bh = 140;
    ctx.save(); ctx.globalAlpha = ramp(u, 0.5, 1.2); tag(ctx, 'TEACHER  ·  TRAINING TIME', 100, ty - 22, C.orangeDeep, { size: 17 }); ctx.restore();
    box(100, ty, 520, bh, 'Explicit geometry', 'SDF · T · contact rules', C.teal, ramp(u, 1, 1.8));
    box(660, ty, 560, bh, 'JEPA predictor', 'grip · slip · contact outcome', C.orange, ramp(u, 7, 7.8));
    box(1260, ty, 560, bh, 'Teacher energy', 'scores the VLA’s own proposal', C.orangeDeep, ramp(u, 9, 9.8));
    ctx.save(); appear(ctx, ramp(u, 14, 15));
    arrow(ctx, 960, ty + bh + 14, 960, sy - 30, { color: C.mute, width: 4, head: 18 });
    haloText(ctx, 'distill: value + gradient matching', 990, ty + bh + 112, { size: 24, color: C.ink });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 21, 21.7); tag(ctx, 'LIGHT ENERGY STUDENT', 100, sy - 22, C.blueDeep, { size: 17 }); ctx.restore();
    box(100, sy, 520, bh, 'Scene encoder', 'once per chunk', C.blue, ramp(u, 21, 21.8));
    box(660, sy, 560, bh, 'Analytic energy', 'geometry — kept analytic', C.teal, ramp(u, 28, 28.8));
    box(1260, sy, 560, bh, 'Consequence module', 'small, per action query', C.orange, ramp(u, 30, 30.8));
    ctx.save(); ctx.globalAlpha = ramp(u, 35, 36);
    chip(ctx, 'a means, not the end: next, the VLA itself must learn', 100, 820, { col: C.green, size: 22 });
    ctx.restore();
    captions(ctx, u, [
      [0, 7, 'During training, the full teacher: geometry plus a JEPA predictor.'],
      [7, 14, 'JEPA covers what geometry cannot see: grip, slip, contact outcome.'],
      [14, 21, 'Distill with value and gradient matching; relabel on guided rollouts.'],
      [21, 28, 'The light student encodes the scene once per chunk…'],
      [28, 35, '…keeps geometry analytic, and asks a small module about consequences.'],
      [35, 44.2, 'This student is a means, not the end: next, the VLA itself must learn.']
    ]);
  }

  // =====================================================================
  // 11 — Guidance as an investment (deployment states A / B / C)
  // =====================================================================
  function sceneInvest(ctx, u) {
    const T = TL.invest;
    subhead(ctx, 'Deployment states', 80, 140, { color: C.green });
    const st = [['A', 'Full teacher', 'geometry + JEPA predictor', C.orange, T.A], ['B', 'Light energy student', 'cheaper — geometry still guides', C.teal, T.B], ['C', 'VLA alone', 'T off too · safety check only', C.green, T.C]];
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
      [0, 7, 'Guidance should be an investment, not a permanent cost.'],
      [7, 14, 'State A: the full teacher helps on new or uncertain cases.'],
      [14, 21, 'State B: a light energy student replaces the full teacher.'],
      [21, 26, 'Cheaper guidance — but geometry still guides.'],
      [26, 33, 'State C: the VLA alone. The progress field T is off, too.'],
      [33, 38, 'Only then has the guidance become the policy’s own skill.'],
      [38, 44.2, 'To measure: teacher calls and interventions fall while success rises.']
    ]);
  }

  // =====================================================================
  // 12 — Four levels of success
  // =====================================================================
  function sceneLevels(ctx, u) {
    wash(ctx, 0.95);
    heading(ctx, 'Four levels of success', 100, 170, 48, ramp(u, 0, 0.8));
    const lv = [
      ['Helped on a new combination', 'with the teacher, first time', C.orange, 0.6],
      ['One teacher, unseen combinations', 'one set of parameters', C.teal, 8],
      ['VLA alone, from new starts', 'after a little guidance', C.green, 16],
      ['Each next task needs less help', 'skills accumulate, none forgotten', C.blue, 26]
    ];
    lv.forEach(([t, s, col, t0], i) => {
      const x = 100 + i * 435, y = 640 - i * 112, w = 410, h = 150, key = i === 2;
      ctx.save(); appear(ctx, ramp(u, t0, t0 + 0.8));
      panelBox(ctx, x, y, w, h, { stroke: col, hot: key, bar: col });
      tag(ctx, `LEVEL ${i + 1}`, x + 30, y + 40, col);
      text(ctx, t, x + 30, y + 86, { size: 25, weight: 600, color: C.ink });
      text(ctx, s, x + 30, y + 122, { size: 20, color: C.mute });
      if (key) { ctx.globalAlpha *= ramp(u, 20, 20.8); chip(ctx, 'first paper’s endpoint', x, y - 60, { col: C.green, size: 20 }); }
      ctx.restore();
    });
    if (u > 34) {
      ctx.save(); appear(ctx, ramp(u, 34, 34.8));
      panelBox(ctx, 100, 250, 800, 120, { stroke: C.red });
      tag(ctx, 'LIMIT', 130, 292, C.red);
      text(ctx, 'The student must observe what decides the right action.', 130, 336, { size: 25, color: C.ink });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 8, 'Level 1: with the teacher, a new combination is handled correctly.'],
      [8, 16, 'Level 2: one teacher guides combinations it was never trained on.'],
      [16, 26, 'Level 3: after a little guidance, the VLA alone succeeds from new starts.'],
      [26, 34, 'Level 4: each related task needs less teaching than the one before.'],
      [34, 44.2, 'Limit: the student must be able to see what decides the right action.']
    ]);
  }

  // =====================================================================
  // 13 — What we do not claim
  // =====================================================================
  function sceneNotClaims(ctx, u) {
    wash(ctx, 0.95);
    heading(ctx, 'What we do not claim as contributions', 100, 170, 48, ramp(u, 0, 0.8));
    const cards = [
      ['No path output', 'an interface choice — planners stay as strong baselines', 1],
      ['No best-of-N', 'compared on success, cost and adaptation speed', 8],
      ['Using JEPA', 'V-JEPA 2-AC already plans; the question is how well it teaches', 16],
      ['The geometric field', 'if geometry alone suffices, we accept that result', 24]
    ];
    cards.forEach(([t, s, t0], i) => {
      const x = 100 + (i % 2) * 880, y = 260 + Math.floor(i / 2) * 250, w = 840, h = 210;
      ctx.save(); appear(ctx, ramp(u, t0, t0 + 0.8));
      panelBox(ctx, x, y, w, h, {});
      tag(ctx, 'NOT A SELLING POINT', x + 32, y + 46, C.red);
      text(ctx, t, x + 32, y + 104, { fam: SERIF, weight: 600, size: 40, color: C.ink });
      text(ctx, s, x + 32, y + 158, { size: 24, color: C.mute });
      ctx.restore();
    });
    captions(ctx, u, [
      [0, 8, 'What we do not claim as contributions:'],
      [8, 16, 'Skipping paths or best-of-N is a choice; both remain baselines.'],
      [16, 24, 'Using JEPA is not new: the question is whether it teaches well.'],
      [24, 32.2, 'If geometry alone solves the task, the experiment will say so.']
    ]);
  }

  // =====================================================================
  // 14 — The proposition
  // =====================================================================
  function sceneEnd(ctx, u) {
    wash(ctx, 0.97);
    ctx.save(); appear(ctx, ramp(u, 0.4, 1.2));
    tag(ctx, 'THE PROPOSITION — STATED SO THAT IT CAN FAIL', 160, 200, C.orangeDeep, { size: 18 });
    paragraph(ctx, 'For a small VLA with basic skills: can a structured predictive teacher make it adapt to unseen constraint combinations with fewer new demonstrations or interactions — and keep that ability once guidance is removed?', 160, 282, 1600, { fam: SERIF, weight: 600, size: 44, color: C.ink, lh: 62 });
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
    text(ctx, 'Cited: arXiv 2603.22078 · 2506.09985 · 2609.39235 · 2511.18606 · 2602.03973 · 2603.10052 · 2609.34944 · 2310.17274 · 2310.16828 · 2504.16054 · Levine & Koltun 2013 · Ross et al. 2011', 160, 866, { size: 16, color: C.faint });
    text(ctx, 'Schematic RoboCasa-style kitchen · Franka Panda meshes: MuJoCo Menagerie (Apache-2.0) · Banana: YCB Object and Model Set scan, object 011 (CC BY 4.0, re-oriented, texture resized)', 160, 894, { size: 16, color: C.faint });
    ctx.restore();
    captions(ctx, u, [
      [0, 10, 'The proposition, stated so that it can fail.'],
      [10, 18, 'One part: better inference. Two: faster adaptation. All three: the loop.'],
      [18, 25, 'Not a smarter planner carried forever — a teacher the robot outgrows.']
    ]);
  }

  const DRAW = { title: sceneTitle, gap: sceneGap, tools: sceneTools, thesis: sceneThesis, guide: sceneGuide, geom: sceneGeom, direct: sceneDirect, slip: sceneSlip, intervene: sceneIntervene, teach: sceneTeach, invest: sceneInvest, levels: sceneLevels, notclaims: sceneNotClaims, end: sceneEnd };
  const OPAQUE = { thesis: 1, teach: 1, levels: 1, notclaims: 1, end: 1 }; // diagram scenes: no vignette needed

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
    return !!OPAQUE[s.id] || (s.id === 'tools' && u > TL.tools.table + 1);
  }
  const util = { clamp, lerp, ramp, sramp, easeIO, easeOut, fade, WORLD, FX0, FX1, FZ0, FZ1, rng: mulberry32, arcPath, contactPoint, guideTau, SLIP, TL, rgba };
  return {
    W, H, C, SCENES, DUR, FADE, createEnv, draw, sceneIndexAt, buildFields, util, paintFieldTexture, setMath, overlayCovers,
    get F() { return getF(); }
  };
});
