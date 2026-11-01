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
  const C = {
    paper: '#F6F7F9', panel: '#FFFFFF', ink: '#1C2533', mute: '#5B6676', faint: '#98A3B3',
    grid: '#DCE1E8', line: '#C3CAD5', band: '#EEF1F5',
    blue: '#2F5BB7', blueSoft: '#C2D0EE', blueDeep: '#1D3F86',
    orange: '#D4702A', orangeSoft: '#F3D2B5', orangeDeep: '#9E4F17',
    teal: '#17907F', tealSoft: '#BFE3DD', tealDeep: '#0E6358',
    red: '#C43D32', redSoft: '#F1C9C5', green: '#3A8F5C', greenSoft: '#CBE6D3',
    banana: '#E7B93A', bananaDk: '#B98A14', slate: '#6F7D90', slateDk: '#4C5868', slateSoft: '#C9D0DA',
    bowl: '#7F91A8', bowlDk: '#5E6E84', table: '#E6EAF0', tableEdge: '#C9D0DA'
  };
  const SERIF = 'Lora, "DejaVu Serif", Georgia, serif';
  const SANS = 'Inter, "DejaVu Sans", Arial, sans-serif';
  const MATH = 'Lora, "DejaVu Serif", Georgia, serif';

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
  const CMAP_WARM = makeCmap(['#FBF2E6', '#F0C79A', '#D4702A', '#7A3A11']);
  const CMAP_TEAL = makeCmap(['#EAF6F3', '#9FD5CC', '#17907F', '#0B3F38']);

  // ---- text helpers ----
  function font(ctx, weight, size, fam, italic) {
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${fam}`;
  }
  function text(ctx, s, x, y, o) {
    o = o || {};
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
  function panelBox(ctx, x, y, w, h, o) {
    o = o || {};
    ctx.save();
    rrect(ctx, x, y, w, h, o.r || 14);
    ctx.fillStyle = o.fill || C.panel; ctx.fill();
    ctx.strokeStyle = o.stroke || C.grid; ctx.lineWidth = o.lw || 2; ctx.stroke();
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
    bananaHalf: 0.085,
    goal: { x0: 0.75, x1: 0.87, z0: 0.03, z1: 0.10 },
    start: { x: 0.30, z: 0.17 },
    // L2 (top view, x right / y lateral): wall and goal footprint
    top: { wallY0: 0.0, wallY1: 0.50, goalY0: 0.26, goalY1: 0.38 },
    tallH: 0.42
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
      let col;
      if (field.obs[k]) col = hexToRgb(C.slateSoft);
      else if (field.goal[k]) col = hexToRgb(C.greenSoft);
      else { const v = valueOf(k); col = v == null ? hexToRgb(C.paper) : cmap(v); }
      d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = 255;
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
      drawContours(ctx, field, v, levels, C.teal, 3, cut);
      return;
    }
    drawField(ctx, tenv, field, v, mode, cut, 1);
    if (mode === 'T') {
      const levels = []; for (let k = 1; k <= 18; k++) levels.push(tm * k / 19);
      drawContours(ctx, field, v, levels, rgba(C.tealDeep, 0.6), 2, cut);
      if (opts.quiver > 0) drawQuiver(ctx, field, v, 9, 24, C.tealDeep, 0.75 * opts.quiver, cut);
    } else {
      // E: a few iso-lines of the local energy for shape
      const E = F.Eloc, levels = [0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2];
      ctx.save(); ctx.strokeStyle = rgba(C.orangeDeep, 0.45); ctx.lineWidth = 1.6; ctx.beginPath();
      for (const lv of levels) for (const s of contourSegs(field, E, lv, 50)) { ctx.moveTo(v.px(s[0]), v.py(s[1])); ctx.lineTo(v.px(s[2]), v.py(s[3])); }
      ctx.stroke(); ctx.restore();
    }
    // thin frame so the slice reads as a plane
    ctx.save(); ctx.strokeStyle = rgba(C.ink, 0.35); ctx.lineWidth = 4; ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4); ctx.restore();
  }

  // ---- common chrome (the overlay is transparent: the 3D layer shows through) ----
  function background(ctx) { ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H); }
  function wash(ctx, a) { if (a <= 0) return; ctx.save(); ctx.fillStyle = rgba(C.paper, a); ctx.fillRect(0, 0, W, H); ctx.restore(); }
  // horizontal gradient wash: solid (alpha a) on one side of [x0,x1], transparent on the other
  function hWash(ctx, x0, x1, a, fromRight) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, rgba(C.paper, fromRight ? 0 : a)); g.addColorStop(1, rgba(C.paper, fromRight ? a : 0));
    ctx.save(); ctx.fillStyle = g;
    if (fromRight) ctx.fillRect(x0, 0, W - x0, H); else ctx.fillRect(0, 0, x1, H);
    ctx.restore();
  }
  // vertical wash from the top edge down to y = h
  function topWash(ctx, h, a) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(C.paper, a)); g.addColorStop(0.6, rgba(C.paper, a * 0.85)); g.addColorStop(1, rgba(C.paper, 0));
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, h); ctx.restore();
  }
  function pill(ctx, x, y, w, h, a) {
    ctx.save(); rrect(ctx, x, y, w, h, Math.min(12, h / 2)); ctx.fillStyle = rgba(C.paper, a == null ? 0.88 : a); ctx.fill(); ctx.restore();
  }
  // text with a paper-coloured halo so it stays legible over the 3D layer
  function haloText(ctx, s, x, y, o) {
    o = o || {};
    const size = o.size || 24;
    font(ctx, o.weight || 400, size, o.fam || SANS, o.italic);
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = o.halo || Math.max(4, size * 0.3);
    ctx.strokeStyle = rgba(C.paper, 0.92); ctx.strokeText(s, x, y);
    ctx.fillStyle = o.color || C.ink; ctx.fillText(s, x, y);
    ctx.restore();
  }
  // a single-line label on a paper pill (used for panel titles over 3D)
  function pillText(ctx, s, x, y, o) {
    o = o || {};
    const size = o.size || 22;
    font(ctx, o.weight || 500, size, o.fam || SANS, o.italic);
    const w = ctx.measureText(s).width, padX = o.padX || 14, h = size + 18;
    ctx.save(); if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    pill(ctx, x - padX, y - size - 4, w + padX * 2, h, o.bg == null ? 0.9 : o.bg);
    text(ctx, s, x, y, { size, weight: o.weight || 500, color: o.color || C.mute, fam: o.fam, italic: o.italic });
    ctx.restore();
    return w;
  }
  // 3D-anchored labels produced by scene3d.js (already projected to overlay px)
  function drawLabels(ctx, fi) {
    if (!fi || !fi.labels) return;
    for (const l of fi.labels) {
      if (!l.px || l.alpha === 0) continue;
      haloText(ctx, l.text, l.px[0] + (l.dx || 0), l.px[1] + (l.dy || 0), {
        size: l.size || 22, weight: l.weight || (l.math ? 400 : 500), color: l.color || C.ink, align: l.align || 'left',
        fam: l.math ? MATH : SANS, italic: !!l.math, alpha: l.alpha == null ? 1 : l.alpha
      });
    }
  }
  function eyebrow(ctx, idx, name, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha == null ? 1 : alpha;
    const s = `${String(idx).padStart(2, '0')}  ·  ${name.toUpperCase()}`;
    // measure the spaced width first (draw invisibly), then pill + text
    font(ctx, 500, 20, SANS); let w = 0; for (const ch of s) w += ctx.measureText(ch).width + 2.2;
    pill(ctx, 64, 46, w + 32, 44, 0.86);
    spaced(ctx, s, 80, 76, { size: 20, weight: 500, color: C.mute, spacing: 2.2 });
    ctx.restore();
  }
  function caption(ctx, s, alpha) {
    if (!s || alpha <= 0) return;
    ctx.save(); ctx.globalAlpha *= alpha;
    font(ctx, 400, 34, SANS);
    const lines = wrap(ctx, s, 1600);
    const lh = 46, top = 984 - (lines.length - 1) * lh;
    rrect(ctx, 100, top - 44, 1720, 32 + lines.length * lh + 14, 12);
    ctx.fillStyle = rgba(C.paper, 0.93); ctx.fill();
    ctx.strokeStyle = rgba(C.ink, 0.08); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, top + i * lh));
    ctx.restore();
  }
  function progressLine(ctx, frac) {
    ctx.fillStyle = C.grid; ctx.fillRect(0, H - 6, W, 6);
    ctx.fillStyle = C.ink; ctx.fillRect(0, H - 6, W * frac, 6);
  }
  function heading(ctx, s, x, y, size, alpha, col) {
    ctx.save(); ctx.globalAlpha *= alpha == null ? 1 : alpha;
    text(ctx, s, x, y, { fam: SERIF, weight: 600, size: size || 44, color: col || C.ink });
    ctx.restore();
  }
  // pick which caption (from a list of [start,end,text]) is active, with 0.4 s fades
  function captions(ctx, u, list) {
    for (const [a, b, s] of list) {
      const al = fade(u, a, a + 0.4, b - 0.3, b);
      if (al > 0) caption(ctx, s, al);
    }
  }
  function bullets(ctx, items, x, y, maxW, u, t0, dt, o) {
    o = o || {}; let yy = y;
    items.forEach((it, i) => {
      const al = ramp(u, t0 + i * dt, t0 + i * dt + 0.5);
      if (al <= 0) { yy += o.gap || 52; return; }
      ctx.save(); ctx.globalAlpha *= al;
      ctx.translate((1 - easeOut(al)) * -14, 0);
      dot(ctx, x + 6, yy - 9, 5, o.dotColor || C.blue);
      const hgt = paragraph(ctx, it, x + 26, yy, maxW - 26, { size: o.size || 24, color: o.color || C.ink, lh: o.lh || 32 });
      ctx.restore();
      yy += Math.max(hgt, 0) + (o.gap || 20);
    });
    return yy;
  }

  // ---- scene list ----
  // Text budget: one short caption line at a time; on-screen text = titles, formulas, short labels.
  const SCENES = [
    { id: 'title', name: 'Title', dur: 10 },
    { id: 'task', name: 'Task and hard constraints', dur: 42 },
    { id: 'guide', name: 'Guidance mechanism', dur: 56 },
    { id: 'stall', name: 'Why local attraction fails', dur: 44 },
    { id: 'geo', name: 'Geodesic progress field', dur: 78 },
    { id: 'teach', name: 'Teacher to structured student', dur: 56 },
    { id: 'slip', name: 'Same path, different physics', dur: 34 },
    { id: 'exp', name: 'Experiments and acceptance', dur: 60 },
    { id: 'retire', name: 'Distillation and retirement', dur: 44 }
  ];
  let acc = 0; for (const s of SCENES) { s.start = acc; acc += s.dur; }
  const DUR = acc;

  // Beat timings (scene-local seconds) shared by the overlay and the 3D layer.
  const TL = {
    task: { move: [2, 7], flash: 7, propEnd: 14, wp: [14, 24], wpDraw: [14.8, 17.5], wpCross: 18.5, fan: [24, 35], fanDraw: [24.6, 27.5], fanCross: 28.5, grad: 35 },
    guide: { pipe: 14 },
    stall: { ghost: [5, 6.5], a1: [6.5, 8], a2: [8, 9.5], a3: [13, 14.5], inset: 20, card1: 28, card2: 36 },
    geo: { cut: [0.8, 7], quiver: [9, 10], grad: [13, 14.2], phase: [20, 28, 36], caveats: 44, stages: 64 }
  };
  // shared timing of the denoising loop in scene 3 (2D τ bar and 3D chunk agree)
  function guideTau(u) { const loopT = 12, uu = u % loopT; return clamp(uu / 8.5, 0, 1); }
  // shared timing of the fast/slow scene
  const SLIP = { t0: 1.5, period: 12, dur: [9.0, 4.5] };

  // simple card: title + optional one-line body (formula or short phrase)
  function card(ctx, x, y, w, h, title, body, o) {
    o = o || {};
    panelBox(ctx, x, y, w, h, { fill: o.fill || C.panel, stroke: o.stroke || C.grid, lw: o.lw || 2 });
    text(ctx, title, x + 26, y + (body ? 50 : h / 2 + 10), { size: o.tsize || 28, weight: 600, color: o.tcolor || C.ink });
    if (body) text(ctx, body, x + 26, y + 92, { size: o.bsize || 23, color: o.bcolor || C.mute, fam: o.math ? MATH : SANS, italic: !!o.math });
  }
  const appear = (ctx, a, dy) => { ctx.globalAlpha *= a; ctx.translate(0, (1 - easeOut(a)) * (dy == null ? 14 : dy)); };

  // =====================================================================
  // SCENE 1 — Title (3D: wide kitchen shot, faint T contours on the slice plane)
  // =====================================================================
  function sceneTitle(ctx, u) {
    hWash(ctx, 940, 1340, 0.95, false);
    ctx.save();
    const a = ramp(u, 0.8, 2.0);
    ctx.globalAlpha = a; ctx.translate(0, (1 - easeOut(a)) * 18);
    text(ctx, 'Energy-Field Teachers', 150, 430, { fam: SERIF, weight: 600, size: 96, color: C.ink });
    text(ctx, 'for Small VLAs', 150, 536, { fam: SERIF, weight: 600, size: 96, color: C.ink });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 2.0, 3.2);
    text(ctx, 'Guide a small robot policy with an energy field —', 150, 620, { size: 34, color: C.mute });
    text(ctx, 'then retire the teacher.', 150, 666, { size: 34, color: C.mute });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 3.2, 4.2);
    line(ctx, 150, 740, 510, 740, C.orange, 4);
    spaced(ctx, 'RESEARCH PLAN  ·  CONCEPT / HYPOTHESIS  ·  2026-11-01', 150, 790, { size: 21, color: C.mute, spacing: 2.4 });
    ctx.restore();
  }

  // =====================================================================
  // SCENE 2 — Task and the two hard constraints
  // =====================================================================
  function arcPath(x0, z0, x1, z1, apexZ, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = lerp(x0, x1, t);
      const z = lerp(z0, z1, t) + (apexZ - Math.max(z0, z1)) * Math.sin(Math.PI * t) * (1.0);
      pts.push([x, z]);
    }
    return pts;
  }
  function sceneTask(ctx, u, env, fi) {
    const A = fi.anchors || {}, T = TL.task;
    if (u > T.wp[0] && u < T.wp[1] + 0.5) {
      const cp = ramp(u, T.wpCross, T.wpCross + 1);
      ctx.save(); ctx.globalAlpha = fade(u, T.wp[0], T.wp[0] + 0.6, T.wp[1] - 0.6, T.wp[1] + 0.5);
      if (A.wpMid && cp > 0) cross(ctx, A.wpMid[0], A.wpMid[1], 62, C.red, cp, 12);
      if (A.wpMid && cp >= 1) haloText(ctx, 'no waypoints', A.wpMid[0], A.wpMid[1] - 92, { size: 34, weight: 700, color: C.red, align: 'center' });
      ctx.restore();
    }
    if (u > T.fan[0] && u < T.fan[1] + 0.5) {
      const cp = ramp(u, T.fanCross, T.fanCross + 1);
      ctx.save(); ctx.globalAlpha = fade(u, T.fan[0], T.fan[0] + 0.6, T.fan[1] - 0.6, T.fan[1] + 0.5);
      if (A.fanMid && cp > 0) cross(ctx, A.fanMid[0], A.fanMid[1], 76, C.red, cp, 12);
      if (A.fanMid && cp >= 1) haloText(ctx, 'no sample-and-rank', A.fanMid[0], A.fanMid[1] - 108, { size: 34, weight: 700, color: C.red, align: 'center' });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 7, 'Task: carry the grasped banana over the barrier and into the bowl.'],
      [7, 14, 'A small VLA proposes the obvious move: straight at the bowl. Collision.'],
      [14, 24, 'Rule 1: the teacher gives no path, no waypoints, no sub-goal images.'],
      [24, 30, 'Rule 2: no sampling and ranking of many candidate trajectories.'],
      [30, 35, 'Best-of-N and CEM appear only as equal-compute baselines.'],
      [35, 42.2, 'What remains: a field whose gradient corrects the VLA’s own actions.']
    ]);
  }

  // =====================================================================
  // SCENE 3 — Guidance mechanism (3D: the action chunk denoising in place)
  // =====================================================================
  function sceneGuide(ctx, u) {
    const pa = ramp(u, TL.guide.pipe, TL.guide.pipe + 1);
    if (pa > 0) { ctx.save(); ctx.globalAlpha = pa; hWash(ctx, 1040, 1140, 0.94, true); ctx.restore(); }
    pillText(ctx, 'Action chunk, being denoised', 80, 140, { size: 24 });
    const tau = guideTau(u), inWin = tau >= 0.3 && tau <= 0.8;
    // tau bar
    const bx = 130, by = 858, bw = 800;
    pill(ctx, 90, 806, 880, 96, 0.9);
    ctx.fillStyle = C.grid; rrect(ctx, bx, by - 8, bw, 16, 8); ctx.fill();
    ctx.fillStyle = rgba(C.orange, 0.35); ctx.fillRect(bx + bw * 0.3, by - 8, bw * 0.5, 16);
    ctx.fillStyle = C.blue; rrect(ctx, bx, by - 8, Math.max(bw * tau, 16), 16, 8); ctx.fill();
    dot(ctx, bx + bw * tau, by, 13, C.panel, C.blue);
    text(ctx, 'noise', bx, by + 36, { size: 22, color: C.mute });
    text(ctx, 'actions', bx + bw, by + 36, { size: 22, color: C.mute, align: 'right' });
    text(ctx, 'guided', bx + bw * 0.55, by - 20, { size: 22, weight: 600, color: C.orangeDeep, align: 'center' });
    text(ctx, `τ = ${tau.toFixed(2)}`, bx + bw * 0.55, by + 36, { size: 22, color: C.ink, align: 'center' });
    // pipeline on the right (second beat)
    if (pa > 0) {
      const boxes = [['Velocity', 'v_θ'], ['Clean estimate', 'Â'], ['Kinematics', 'K(Â)'], ['Energy', 'E(K(Â))'], ['Guided velocity', 'v_θ − λ∇E']];
      const bx0 = 1160, by0 = 190, bw0 = 660, bh0 = 82, gap = 30;
      const active = !inWin ? (tau > 0.8 ? 4 : 0) : Math.min(4, 1 + Math.floor(((tau - 0.3) / 0.5) * 4));
      boxes.forEach((b, i) => {
        const y = by0 + i * (bh0 + gap), al = ramp(u, TL.guide.pipe + 0.3 + i * 0.4, TL.guide.pipe + 0.9 + i * 0.4);
        ctx.save(); ctx.globalAlpha = al;
        const hot = i === active;
        panelBox(ctx, bx0, y, bw0, bh0, { fill: hot ? '#FBEFE6' : C.panel, stroke: hot ? C.orange : C.grid, lw: hot ? 3 : 2 });
        text(ctx, b[0], bx0 + 26, y + 52, { size: 28, weight: 600, color: hot ? C.orangeDeep : C.ink });
        text(ctx, b[1], bx0 + bw0 - 26, y + 53, { size: 32, fam: MATH, italic: true, color: hot ? C.orangeDeep : C.mute, align: 'right' });
        if (i < boxes.length - 1) arrow(ctx, bx0 + bw0 / 2, y + bh0 + 2, bx0 + bw0 / 2, y + bh0 + gap - 2, { color: C.faint, width: 2.5, head: 10 });
        ctx.restore();
      });
    }
    captions(ctx, u, [
      [0, 7, 'A flow-matching VLA denoises an action chunk from noise to actions.'],
      [7, 14, 'π0.5 takes 10 Euler steps; GR00T N1.6 takes 4.'],
      [14, 22, 'Each guided step: clean estimate → kinematics → energy → gradient.'],
      [22, 30, 'Guidance acts only in the middle window, τ from 0.3 to 0.8.'],
      [30, 37, 'Gradients are normalized, step-limited and smoothed over the chunk.'],
      [37, 44, 'Default: no backprop through the VLA (MPGD). Full backprop is an ablation.'],
      [44, 50, 'One energy serves both students, through each robot’s kinematics.'],
      [50, 56.2, 'Every comparison also reports equal-compute best-of-N.']
    ]);
  }

  // =====================================================================
  // SCENE 4 — Why local attraction + repulsion stalls (3D: E slice plane + force arrows)
  // =====================================================================
  const STALL_Z0 = 0.13, STALL_Z1 = 0.52; // vertical range of the inset curve (field z)
  function bigNumberCard(ctx, x, y, w, h, big, label, src, al) {
    ctx.save(); appear(ctx, al);
    panelBox(ctx, x, y, w, h, { fill: C.panel, stroke: C.grid });
    text(ctx, 'PRIOR WORK', x + 26, y + 40, { size: 17, weight: 600, color: C.faint });
    text(ctx, big, x + 26, y + 120, { fam: SERIF, weight: 600, size: 72, color: C.orangeDeep });
    text(ctx, label, x + 26, y + 168, { size: 24, color: C.ink });
    text(ctx, src, x + 26, y + 204, { size: 19, color: C.mute });
    ctx.restore();
  }
  function sceneStall(ctx, u, env) {
    const F = env.F, P = F.pStar, T = TL.stall;
    pillText(ctx, 'Local energy: attract + repel', 80, 140, { size: 24, alpha: ramp(u, 0.5, 1.5) });
    if (u > T.inset) {
      const al = ramp(u, T.inset, T.inset + 1);
      const ix = 1360, iy = 170, iw = 480, ih = 360;
      ctx.save(); ctx.globalAlpha = al;
      panelBox(ctx, ix, iy, iw, ih, { fill: C.panel });
      text(ctx, 'Energy vs. height', ix + 24, iy + 42, { size: 24, weight: 600, color: C.ink });
      const zs = [], Es = []; let emin = 1e9, emax = -1e9;
      for (let k = 0; k <= 60; k++) { const z = STALL_Z0 + k / 60 * (STALL_Z1 - STALL_Z0); const e = F.Eloc_fn(P.x, z); zs.push(z); Es.push(e); emin = Math.min(emin, e); emax = Math.max(emax, e); }
      const gx0 = ix + 60, gy0 = iy + 76, gw = iw - 90, gh = ih - 136;
      line(ctx, gx0, gy0 + gh, gx0 + gw, gy0 + gh, C.line, 2); line(ctx, gx0, gy0, gx0, gy0 + gh, C.line, 2);
      const pts = zs.map((z, k) => [gx0 + (z - STALL_Z0) / (STALL_Z1 - STALL_Z0) * gw, gy0 + gh - (Es[k] - emin) / (emax - emin) * gh]);
      drawPartial(ctx, pts, sramp(u, T.inset + 0.5, T.inset + 3), C.orange, 5);
      const bxp = gx0 + (WORLD.barrierH - STALL_Z0) / (STALL_Z1 - STALL_Z0) * gw;
      line(ctx, bxp, gy0, bxp, gy0 + gh, C.slate, 2, [6, 6]);
      text(ctx, 'barrier top', bxp + 8, gy0 + 20, { size: 19, color: C.slate });
      dot(ctx, pts[Math.round((P.z - STALL_Z0) / (STALL_Z1 - STALL_Z0) * 60)][0], pts[Math.round((P.z - STALL_Z0) / (STALL_Z1 - STALL_Z0) * 60)][1], 7, C.ink);
      text(ctx, 'height →', gx0 + gw, gy0 + gh + 32, { size: 20, color: C.mute, align: 'right' });
      text(ctx, 'E', gx0 - 28, gy0 + 14, { size: 24, fam: MATH, italic: true, color: C.mute });
      ctx.restore();
    }
    if (u > T.card1 && u < T.card2 + 0.5) bigNumberCard(ctx, 1360, 570, 480, 230, '92% → 41%', 'goal 5 → 20 steps away', 'distance-to-goal scoring, perfect predictions', fade(u, T.card1, T.card1 + 0.8, T.card2 - 0.4, T.card2));
    if (u > T.card2) bigNumberCard(ctx, 1360, 570, 480, 230, '62%', 'of hardware trials stalled', 'LatentCBF safety filter: safe, but stuck', fade(u, T.card2, T.card2 + 0.8, 43.4, 44));
    captions(ctx, u, [
      [0, 6.5, 'First try: attract toward the bowl, repel from the barrier.'],
      [6.5, 13, 'In front of the barrier, the two forces cancel.'],
      [13, 20, 'The net push has no upward part — it even points down.'],
      [20, 28, 'Along the height, energy only rises. Gradient descent stays stuck.'],
      [28, 36, 'Prior work: distance-to-goal scores break down on detours.'],
      [36, 44.2, 'Collision avoidance alone gives “safe, but stuck”.']
    ]);
  }

  // =====================================================================
  // SCENE 5 — Geodesic progress field (3D: T slice, then three layout interventions)
  // =====================================================================
  function sceneGeo(ctx, u) {
    const T = TL.geo, ph = T.phase;
    if (u < ph[0]) {
      const al = 1 - ramp(u, ph[0] - 0.6, ph[0]);
      ctx.save(); ctx.globalAlpha = al;
      pillText(ctx, 'Geodesic progress field T', 80, 140, { size: 24 });
      ctx.save(); appear(ctx, ramp(u, 1, 2));
      panelBox(ctx, 1360, 170, 480, 170, { fill: C.panel, stroke: C.grid });
      text(ctx, 'S(x) |∇T(x)| = 1', 1600, 248, { size: 44, fam: MATH, italic: true, align: 'center', color: C.ink });
      text(ctx, 'T = 0 at the goal', 1600, 300, { size: 23, align: 'center', color: C.mute });
      ctx.restore();
      ctx.restore();
    } else if (u < T.caveats) {
      const phase = u < ph[1] ? 0 : u < ph[2] ? 1 : 2, hA = ramp(u, ph[0], ph[0] + 0.8) * (1 - ramp(u, T.caveats - 0.5, T.caveats));
      ctx.save(); ctx.globalAlpha = hA;
      pillText(ctx, 'Change the layout; the field follows', 80, 146, { size: 34, fam: SERIF, weight: 600, color: C.ink, bg: 0.9 });
      ['Barrier removed', 'Top closed', 'Taller barrier'].forEach((title, i) => {
        const x = 1440, y = 190 + i * 112, w = 400, h = 88, on = i === phase, done = i < phase;
        ctx.save();
        panelBox(ctx, x, y, w, h, { fill: on ? '#E8F4F2' : C.panel, stroke: on ? C.teal : C.grid, lw: on ? 3 : 2 });
        ctx.globalAlpha *= on || done ? 1 : 0.45;
        ctx.fillStyle = on ? C.teal : done ? C.tealSoft : C.grid; ctx.beginPath(); ctx.arc(x + 44, y + h / 2, 19, 0, 7); ctx.fill();
        text(ctx, String(i + 1), x + 44, y + h / 2 + 8, { size: 21, weight: 700, align: 'center', color: on ? C.panel : C.ink });
        text(ctx, title, x + 80, y + h / 2 + 10, { size: 28, weight: 600, color: C.ink });
        ctx.restore();
      });
      ctx.restore();
    } else if (u < T.stages) {
      wash(ctx, 0.92 * ramp(u, T.caveats, T.caveats + 0.8));
      ctx.save(); ctx.globalAlpha = ramp(u, T.caveats, T.caveats + 0.8) * (1 - ramp(u, T.stages - 0.5, T.stages));
      heading(ctx, 'What T does — and does not — settle', 100, 250, 48);
      const cards = [
        ['A value field, not a path', 'no waypoints prescribed', false, 45],
        ['Reward progress itself', 'E_adv = [T(x_H) − T(x₀) + δ]₊²', true, 51],
        ['Still to be tested', 'discretization · action map · composition', false, 58]
      ];
      cards.forEach(([t, b, math, t0], i) => {
        ctx.save(); appear(ctx, ramp(u, t0, t0 + 0.8));
        card(ctx, 100 + i * 580, 330, 540, 150, t, b, { stroke: i === 1 ? C.orange : C.grid, lw: i === 1 ? 3 : 2, math, bsize: math ? 27 : 23, tsize: 30 });
        ctx.restore();
      });
      ctx.restore();
    } else {
      wash(ctx, 0.92);
      ctx.save(); ctx.globalAlpha = ramp(u, T.stages, T.stages + 0.8);
      heading(ctx, 'Stages change only with contact permissions', 100, 250, 48);
      ['approach', 'grasp', 'transport', 'place', 'release'].forEach((s, i) => {
        ctx.save(); appear(ctx, ramp(u, T.stages + 0.6 + i * 0.6, T.stages + 1.2 + i * 0.6));
        const x = 100 + i * 346, y = 340, w = 320, h = i === 2 ? 150 : 110;
        panelBox(ctx, x, y, w, h, { fill: i === 2 ? '#E8F4F2' : C.panel, stroke: i === 2 ? C.teal : C.grid, lw: i === 2 ? 3 : 2 });
        text(ctx, `${i + 1}  ${s}`, x + 26, y + 66, { size: 30, weight: 600, color: C.ink });
        if (i === 2) text(ctx, 'T active here', x + 26, y + 116, { size: 23, color: C.tealDeep, weight: 500 });
        if (i < 4) arrow(ctx, x + w + 2, y + 55, x + w + 24, y + 55, { color: C.faint, width: 2.5, head: 9 });
        ctx.restore();
      });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 7, 'Geodesic progress field T: the shortest time to reach the goal.'],
      [7, 13, 'Solved from the goal outward; obstacles inflated by gripper and banana.'],
      [13, 20, 'No false minima: in front of the barrier, −∇T points up and over.'],
      [20, 28, 'Remove the barrier: a plain pull toward the bowl.'],
      [28, 36, 'Close the top: −∇T turns toward the side opening.'],
      [36, 44, 'Raise the barrier: more clearance. No stage or waypoint was edited.'],
      [44, 51, 'T is a value field, not a reference path.'],
      [51, 58, 'The progress term rewards progress, so holding still is never free.'],
      [58, 64, 'Each of these steps can still stall — they must be tested.'],
      [64, 71, 'Stages change only where contact permissions change.'],
      [71, 78.2, 'There is no “cross the barrier” stage: the detour lives in T.']
    ]);
  }

  // =====================================================================
  // SCENE 6 — Teacher to structured student (diagram over a washed 3D orbit)
  // =====================================================================
  function sceneTeach(ctx, u) {
    wash(ctx, 0.9);
    heading(ctx, 'Teacher → student', 100, 160, 48, ramp(u, 0, 0.8));
    const box = (x, y, w, h, title, body, col, al) => {
      ctx.save(); appear(ctx, al);
      panelBox(ctx, x, y, w, h, { fill: C.panel, stroke: col, lw: 3 });
      text(ctx, title, x + 26, y + 52, { size: 30, weight: 600, color: col });
      text(ctx, body, x + 26, y + 100, { size: 24, color: C.ink });
      ctx.restore();
    };
    const ty = 250, sy = 600, bh = 140;
    ctx.save(); ctx.globalAlpha = ramp(u, 0.5, 1.2);
    spaced(ctx, 'TEACHER  ·  TRAINING ONLY', 100, ty - 18, { size: 19, color: C.orangeDeep, spacing: 2.2 });
    ctx.restore();
    box(100, ty, 520, bh, 'Explicit geometry', 'SDF · T · contact rules', C.teal, ramp(u, 7, 7.8));
    box(660, ty, 560, bh, 'JEPA predictor', 'grip · slip · contact outcome', C.orange, ramp(u, 14, 14.8));
    box(1260, ty, 560, bh, 'Teacher energy E_T', 'scores the VLA’s own proposal', C.orangeDeep, ramp(u, 1, 1.8));
    ctx.save(); ctx.globalAlpha = ramp(u, 14, 14.8);
    arrow(ctx, 622, ty + bh / 2, 656, ty + bh / 2, { color: C.faint, width: 3, head: 10 });
    arrow(ctx, 1222, ty + bh / 2, 1256, ty + bh / 2, { color: C.faint, width: 3, head: 10 });
    ctx.restore();
    // distillation
    ctx.save(); appear(ctx, ramp(u, 28, 29));
    arrow(ctx, 960, ty + bh + 12, 960, sy - 28, { color: C.ink, width: 5, head: 20 });
    pillText(ctx, 'distill: value + gradient matching', 990, ty + bh + 108, { size: 24, color: C.ink, bg: 0.95 });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 35, 35.7);
    spaced(ctx, 'STUDENT  ·  DEPLOYMENT', 100, sy - 18, { size: 19, color: C.blueDeep, spacing: 2.2 });
    ctx.restore();
    box(100, sy, 520, bh, 'Encoder W_ψ', 'once per chunk', C.blue, ramp(u, 35, 35.8));
    box(660, sy, 560, bh, 'Analytic energy', 'geometry — always kept', C.teal, ramp(u, 42, 42.8));
    box(1260, sy, 560, bh, 'Consequence module R_ψ', 'small, per action query', C.orange, ramp(u, 44, 44.8));
    ctx.save(); ctx.globalAlpha = ramp(u, 42, 42.8);
    arrow(ctx, 622, sy + bh / 2, 656, sy + bh / 2, { color: C.faint, width: 3, head: 10 });
    arrow(ctx, 1222, sy + bh / 2, 1256, sy + bh / 2, { color: C.faint, width: 3, head: 10 });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 49, 50);
    text(ctx, 'E_S = E_analytic + R_ψ', 960, sy + bh + 100, { size: 44, fam: MATH, italic: true, align: 'center', color: C.ink });
    ctx.restore();
    captions(ctx, u, [
      [0, 7, 'The teacher energy scores the VLA’s own proposal — during training only.'],
      [7, 14, 'Explicit geometry handles the detour: SDF, T and contact rules.'],
      [14, 21, 'A JEPA predictor adds what geometry cannot see: grip, slip, contact.'],
      [21, 28, 'JEPA has to prove its worth on physics, not on routes.'],
      [28, 35, 'Distill with value and gradient matching; relabel on guided rollouts.'],
      [35, 42, 'The student encodes the scene once per chunk.'],
      [42, 49, 'Geometry stays analytic; a small module adds the consequences.'],
      [49, 56.2, 'With R_ψ = 0 this is the geometry-only baseline. The experiment decides.']
    ]);
  }

  // =====================================================================
  // SCENE 7 — Same path, different physics (3D split screen: slow | fast)
  // =====================================================================
  function sceneSlip(ctx, u) {
    topWash(ctx, 250, 0.94);
    heading(ctx, 'Same path, different speed', 100, 150, 44, ramp(u, 0, 0.8));
    ctx.save(); ctx.fillStyle = rgba(C.ink, 0.28); ctx.fillRect(959, 180, 2, 900); ctx.restore();
    [[0, 'Slow'], [960, 'Fast']].forEach(([x, label], pi) => {
      pillText(ctx, label, x + 60, 226, { size: 28, color: C.ink, weight: 600 });
      ctx.save(); ctx.globalAlpha = ramp(u, 8, 8.8);
      panelBox(ctx, x + 60, 836, 380, 50, { fill: C.band, stroke: C.grid, r: 25 });
      text(ctx, 'geometry: same score', x + 250, 869, { size: 23, align: 'center', color: C.ink });
      ctx.globalAlpha = ramp(u, 15, 15.8);
      panelBox(ctx, x + 460, 836, 420, 50, { fill: pi === 0 ? C.greenSoft : C.redSoft, stroke: pi === 0 ? C.green : C.red, r: 25 });
      text(ctx, pi === 0 ? 'consequences: grip holds' : 'consequences: slip risk', x + 670, 869, { size: 23, align: 'center', color: C.ink });
      ctx.restore();
    });
    captions(ctx, u, [
      [0, 8, 'Same path, different speed. Slow keeps the banana; fast lets it slip.'],
      [8, 15, 'A geometry-only energy gives both the same score.'],
      [15, 22, 'A consequence module has to tell them apart…'],
      [22, 28, '…and beat a simple analytic grip-stability baseline.'],
      [28, 34.2, 'Fixed-rate action sequences already encode speed; only bare paths do not.']
    ]);
  }

  // =====================================================================
  // SCENE 8 — Experiments and E0 acceptance
  // =====================================================================
  function sceneExp(ctx, u) {
    wash(ctx, 0.9);
    heading(ctx, 'Experiments, ordered to fail early', 100, 150, 48, ramp(u, 0, 0.8));
    const cols = [
      ['A', 'Expressiveness', C.teal, 6, ['true geometry & contacts given', 'four energy families', 'stall · traps · layouts · fast/slow']],
      ['B', 'Amortization', C.orange, 14, ['keeps consequences?', 'fair AGF-style baseline', 'held-out objects & layouts']],
      ['C', 'Closed loop', C.blue, 30, ['π0.5 and GR00T N1.6', 'success · drops · latency', 'three gradient approximations']]
    ];
    cols.forEach(([letter, title, col, t0, items], i) => {
      const x = 100 + i * 580, y = 210, w = 540, h = 330;
      ctx.save(); appear(ctx, ramp(u, t0, t0 + 0.8), 16);
      panelBox(ctx, x, y, w, h, { fill: C.panel, stroke: col, lw: 3 });
      ctx.fillStyle = col; rrect(ctx, x + 26, y + 26, 54, 54, 12); ctx.fill();
      text(ctx, letter, x + 53, y + 64, { size: 32, weight: 700, color: C.panel, align: 'center' });
      text(ctx, title, x + 100, y + 64, { size: 32, weight: 600, color: C.ink });
      items.forEach((it, k) => {
        ctx.save(); ctx.globalAlpha *= ramp(u, t0 + 1 + k * 0.8, t0 + 1.5 + k * 0.8);
        dot(ctx, x + 34, y + 142 + k * 66 - 9, 6, col);
        text(ctx, it, x + 56, y + 142 + k * 66, { size: 25, color: C.ink });
        ctx.restore();
      });
      ctx.restore();
    });
    // E0 acceptance checklist
    ctx.save(); ctx.globalAlpha = ramp(u, 38, 38.8);
    panelBox(ctx, 100, 580, 1720, 250, { fill: C.band, stroke: C.grid });
    text(ctx, 'E0 acceptance — before any large training', 130, 636, { size: 30, weight: 600, color: C.ink });
    ['Hold-action test', 'Layout interventions', 'Space → action gradient', 'Dynamics increment'].forEach((t, i) => {
      const a = ramp(u, 46 + i * 2.5, 46.6 + i * 2.5);
      ctx.save(); ctx.globalAlpha *= Math.max(a, 0);
      const x = 130 + i * 425, y = 690;
      ctx.strokeStyle = C.mute; ctx.lineWidth = 3; rrect(ctx, x, y, 36, 36, 7); ctx.stroke();
      text(ctx, t, x + 52, y + 28, { size: 25, weight: 600, color: C.ink });
      text(ctx, 'to run', x + 52, y + 70, { size: 21, color: C.mute });
      ctx.restore();
    });
    ctx.restore();
    captions(ctx, u, [
      [0, 6, 'Experiments run in the order that can fail early.'],
      [6, 14, 'A: with true geometry and contacts, which energy can express the task?'],
      [14, 22, 'B: does a learned student keep the consequences, or only the look?'],
      [22, 30, 'Fair baseline: same teacher, data, information and interface.'],
      [30, 38, 'C: closed loop on π0.5 and GR00T — success, drops, latency.'],
      [38, 46, 'Before any large training run, four acceptance tests must pass.'],
      [46, 53, 'Holding still never counts as progress; layout edits change actions only.'],
      [53, 60.2, 'The gradient must survive the kinematic map; JEPA must beat geometry.']
    ]);
  }

  // =====================================================================
  // SCENE 9 — Distillation and three-level retirement
  // =====================================================================
  function sceneRetire(ctx, u) {
    wash(ctx, 0.9);
    heading(ctx, 'Retire the teacher in three steps', 100, 150, 48, ramp(u, 0, 0.8));
    const levels = [
      ['Level 1', 'Predictive teacher off', '', C.orange, 8],
      ['Level 2', 'Learned module off', 'geometry still guides', C.teal, 12],
      ['Level 3', 'All guidance off', 'VLA alone = autonomy', C.blue, 17]
    ];
    levels.forEach(([lv, title, note, col, t0], i) => {
      const y = 220 + i * 165, off = sramp(u, t0, t0 + 1.2);
      ctx.save(); appear(ctx, ramp(u, 7 + i * 0.4, 7.6 + i * 0.4));
      panelBox(ctx, 100, y, 820, 135, { fill: C.panel, stroke: off > 0.5 ? C.grid : col, lw: 3 });
      const tx = 780, ty = y + 45;
      ctx.fillStyle = off > 0.5 ? C.grid : col; rrect(ctx, tx, ty, 92, 44, 22); ctx.fill();
      dot(ctx, lerp(tx + 70, tx + 22, off), ty + 22, 17, C.panel);
      text(ctx, lv, 128, y + 44, { size: 21, weight: 600, color: col });
      text(ctx, title, 128, y + 88, { size: 32, weight: 600, color: off > 0.5 ? C.mute : C.ink });
      if (note) text(ctx, note, 128, y + 120, { size: 21, color: C.mute });
      ctx.restore();
    });
    // right: illustrative chart (hypothesis)
    const cx0 = 1000, cy0 = 210, cw = 820, ch = 560, T0 = 20;
    ctx.save(); appear(ctx, ramp(u, T0, T0 + 0.8));
    panelBox(ctx, cx0, cy0, cw, ch, { fill: C.panel });
    text(ctx, 'Autonomy vs. teacher calls', cx0 + 28, cy0 + 50, { size: 28, weight: 600, color: C.ink });
    spaced(ctx, 'ILLUSTRATIVE HYPOTHESIS — NOT RESULTS', cx0 + 28, cy0 + 86, { size: 17, color: C.orangeDeep, spacing: 2 });
    const gx = cx0 + 90, gy = cy0 + 120, gw = cw - 140, gh = ch - 250;
    for (let k = 0; k <= 4; k++) { const yy = gy + gh - gh * k / 4; line(ctx, gx, yy, gx + gw, yy, C.grid, 1); text(ctx, `${k * 25}%`, gx - 14, yy + 7, { size: 18, color: C.mute, align: 'right' }); }
    text(ctx, 'teacher calls →', gx + gw, gy + gh + 36, { size: 20, color: C.mute, align: 'right' });
    line(ctx, gx, gy + gh, gx + gw, gy + gh, C.line, 2);
    const series = [
      ['adapter distillation', C.blue, [35, 52, 67, 79, 88, 91]],
      ['action-only distillation', C.orange, [35, 45, 55, 66, 74, 79]],
      ['fine-tuning', C.slate, [35, 41, 48, 56, 63, 69]]
    ];
    const prog = sramp(u, T0 + 1, T0 + 8);
    series.forEach(([name, col, vals], si) => {
      const pts = vals.map((val, k) => [gx + gw * k / 5, gy + gh - gh * val / 100]);
      const end = drawPartial(ctx, pts, prog, col, 4);
      if (end) dot(ctx, end[0], end[1], 7, col);
      const lx = cx0 + 28 + si * 265, ly = cy0 + ch - 40; line(ctx, lx, ly, lx + 30, ly, col, 4); text(ctx, name, lx + 40, ly + 7, { size: 19, color: C.ink });
    });
    ctx.restore();
    // end card
    if (u > 34) {
      const al = ramp(u, 34, 35.2);
      ctx.save();
      ctx.fillStyle = rgba(C.paper, al); ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = al;
      text(ctx, 'Autonomy up, teacher use down, old skills kept.', 960, 420, { fam: SERIF, weight: 600, size: 56, align: 'center', color: C.ink });
      text(ctx, 'Next: a privileged closed-loop test.', 960, 500, { size: 34, color: C.mute, align: 'center' });
      line(ctx, 760, 590, 1160, 590, C.orange, 4);
      spaced(ctx, 'STATUS: CONCEPT / HYPOTHESIS  ·  NOTHING SHOWN HERE IS A RESULT', 490, 650, { size: 20, color: C.mute, spacing: 2.4 });
      text(ctx, 'Schematic RoboCasa-style kitchen · Franka Panda meshes: MuJoCo Menagerie (Apache-2.0)', 960, 1010, { size: 18, color: C.faint, align: 'center' });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 7, 'Guided rollouts are distilled into a light adapter; the base VLA stays frozen.'],
      [7, 14, 'Then the teacher retires, one level at a time.'],
      [14, 20, 'Level 2 still uses geometry — that is not yet autonomy.'],
      [20, 27, 'Hypothesis: autonomy rises while teacher calls fall.'],
      [27, 34, 'To be tested with equal data and compute, and old skills tracked.']
    ]);
  }

  const DRAW = [sceneTitle, sceneTask, sceneGuide, sceneStall, sceneGeo, sceneTeach, sceneSlip, sceneExp, sceneRetire];

  // ---- fields (built once at module load; scene3d.js reads core.F) ----
  let FIELDS = null;
  function getF() { return FIELDS || (FIELDS = buildFields()); }

  // ---- environment / compositor ----
  function createEnv(makeCanvas) {
    const env = { makeCanvas, F: getF(), cache: {} };
    env.off = makeCanvas(W, H);
    if (!texEnv) texEnv = { makeCanvas, F: env.F, cache: {} };
    return env;
  }
  function sceneIndexAt(t) {
    for (let i = SCENES.length - 1; i >= 0; i--) if (t >= SCENES[i].start) return i;
    return 0;
  }
  // fi = frame info from the 3D layer: { labels: [{px:[x,y], text, ...}], anchors: {name: [x,y]} }
  function drawScene(ctx, i, u, env, fi) {
    ctx.save();
    drawLabels(ctx, fi);
    DRAW[i](ctx, u, env, fi || {});
    ctx.restore();
    eyebrow(ctx, i + 1, SCENES[i].name, ramp(u, 0, 0.6));
  }
  // Draw the overlay at absolute time t (seconds) onto a TRANSPARENT ctx (the caller clears it).
  // fiPrev: frame info of the previous scene's last frame, used during the 0.5 s crossfade.
  // opts.opaque: paint the paper background first (2D-only previews without the 3D layer).
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
    } else {
      drawScene(ctx, i, u, env, fi);
    }
    progressLine(ctx, t / DUR);
  }

  const util = { clamp, lerp, ramp, sramp, easeIO, easeOut, fade, WORLD, FX0, FX1, FZ0, FZ1, rng: mulberry32, arcPath, contactPoint, guideTau, SLIP, TL, rgba };
  return {
    W, H, C, SCENES, DUR, FADE, createEnv, draw, sceneIndexAt, buildFields, util, paintFieldTexture,
    get F() { return getF(); }
  };
});
