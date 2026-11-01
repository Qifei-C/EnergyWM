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
  // Scene geometry (metres)
  const WORLD = {
    barrierX0: 0.56, barrierX1: 0.60, barrierH: 0.30,
    bowlX: 1.0, bowlR: 0.085, bowlH: 0.075,
    rObj: 0.045, // inflation radius (gripper + banana)
    goal: { x0: 0.94, x1: 1.06, z0: 0.03, z1: 0.10 },
    start: { x: 0.25, z: 0.17 }
  };

  function drawTable(ctx, v) {
    ctx.save();
    const yt = v.py(0);
    ctx.fillStyle = C.table; ctx.fillRect(v.x0, yt, v.w, v.y0 + v.h - yt + 0.001);
    line(ctx, v.x0, yt, v.x0 + v.w, yt, C.tableEdge, 3);
    ctx.restore();
  }
  function drawBarrier(ctx, v, hgt, o) {
    o = o || {};
    const x = v.px(WORLD.barrierX0), w = v.px(WORLD.barrierX1) - x, top = v.py(hgt), bot = v.py(0);
    ctx.save();
    ctx.fillStyle = o.color || C.slate; rrect(ctx, x, top, w, bot - top, 3); ctx.fill();
    ctx.fillStyle = C.slateDk; ctx.fillRect(x, top, w, 4);
    ctx.restore();
  }
  function drawBowl(ctx, v, o) {
    o = o || {};
    const cx = v.px(WORLD.bowlX), yb = v.py(0), r = WORLD.bowlR * v.scale, hh = WORLD.bowlH * v.scale;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.12, yb - hh);
    ctx.quadraticCurveTo(cx - r * 1.05, yb - 2, cx - r * 0.55, yb);
    ctx.lineTo(cx + r * 0.55, yb);
    ctx.quadraticCurveTo(cx + r * 1.05, yb - 2, cx + r * 1.12, yb - hh);
    ctx.lineTo(cx + r * 0.92, yb - hh);
    ctx.quadraticCurveTo(cx + r * 0.85, yb - 14, cx + r * 0.45, yb - 10);
    ctx.lineTo(cx - r * 0.45, yb - 10);
    ctx.quadraticCurveTo(cx - r * 0.85, yb - 14, cx - r * 0.92, yb - hh);
    ctx.closePath();
    ctx.fillStyle = o.color || C.bowl; ctx.fill();
    ctx.strokeStyle = C.bowlDk; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
  function drawBanana(ctx, x, y, ang, s, o) {
    // crescent banana centred at (x,y) in px, s = half-length in px
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang || 0);
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.12);
    ctx.quadraticCurveTo(0, s * 0.95, s, -s * 0.12);
    ctx.quadraticCurveTo(0, s * 0.45, -s, -s * 0.12);
    ctx.closePath();
    ctx.fillStyle = o.color || C.banana; ctx.fill();
    ctx.strokeStyle = C.bananaDk; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = C.bananaDk;
    ctx.beginPath(); ctx.arc(-s, -s * 0.12, s * 0.07, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(s, -s * 0.12, s * 0.07, 0, 7); ctx.fill();
    ctx.restore();
  }
  // gripper with the banana hanging below; (gx,gz) = grasp point (banana centre) in metres
  function drawGripper(ctx, v, gx, gz, o) {
    o = o || {};
    const s = v.scale, px = v.px(gx), py = v.py(gz);
    const fingerH = 0.065 * s, fingerW = 0.014 * s, palmW = 0.11 * s, palmH = 0.03 * s;
    const bananaOff = (o.bananaDx || 0) * s, bananaDy = (o.bananaDz || 0) * s;
    // arm: two links from an anchor above-left
    const ax = v.px(0.06), ay = v.py(0.62);
    const wx = px, wy = py - fingerH - palmH;
    const L1 = 0.46 * s, L2 = 0.46 * s;
    let d = Math.hypot(wx - ax, wy - ay); d = Math.min(d, L1 + L2 - 1);
    const a = Math.atan2(wy - ay, wx - ax);
    const cosb = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const b = Math.acos(cosb);
    const ex = ax + L1 * Math.cos(a - b), ey = ay + L1 * Math.sin(a - b);
    ctx.save();
    ctx.globalAlpha *= (o.armAlpha == null ? 1 : o.armAlpha);
    polyline(ctx, [[ax, ay], [ex, ey], [wx, wy]], C.slateSoft, 0.05 * s);
    polyline(ctx, [[ax, ay], [ex, ey], [wx, wy]], C.slate, 0.03 * s);
    dot(ctx, ax, ay, 0.03 * s, C.slateDk); dot(ctx, ex, ey, 0.024 * s, C.slateDk);
    ctx.restore();
    // palm + fingers
    ctx.save();
    ctx.fillStyle = C.slateDk;
    rrect(ctx, px - palmW / 2, py - fingerH - palmH, palmW, palmH, 4); ctx.fill();
    const open = o.open || 0;
    rrect(ctx, px - palmW / 2 - open, py - fingerH, fingerW, fingerH, 3); ctx.fill();
    rrect(ctx, px + palmW / 2 - fingerW + open, py - fingerH, fingerW, fingerH, 3); ctx.fill();
    ctx.restore();
    if (!o.noBanana) drawBanana(ctx, px + bananaOff, py + 0.012 * s + bananaDy, o.bananaAng || 0, 0.07 * s);
  }

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
    const base = { nx: NX, ny: NY, x0: FX0, x1: FX1, y0: FZ0, y1: FZ1, rObj: WORLD.rObj, dmax: 0.12, smin: 0.15, goal: goalSide };
    const F = {};
    F.L0 = makeField(Object.assign({}, base, { sdf: sideSdf(WORLD.barrierH) }));
    F.L1 = makeField(Object.assign({}, base, { sdf: sideSdf(0) }));
    F.L3 = makeField(Object.assign({}, base, { sdf: sideSdf(0.42) }));
    // L2: top view (x right, y lateral). Wall spans y∈[0,0.50], opening at the far side.
    F.L2 = makeField(Object.assign({}, base, {
      rObj: WORLD.rObj, sdf: (x, y) => rectSdf(x, y, WORLD.barrierX0, WORLD.barrierX1, -1, 0.50),
      goal: (x, y) => x >= 0.94 && x <= 1.06 && y >= 0.26 && y <= 0.38
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
    let xe = 0.42; { const z = 0.17; let lo = 0.30, hi = 0.515; for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; const p = F.Eloc_parts(mid, z); const gxs = p.attract[0] + p.repel[0]; if (gxs < 0) lo = mid; else hi = mid; } xe = (lo + hi) / 2; }
    F.pStar = { x: xe, z: 0.17 };
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

  // ---- common chrome ----
  function background(ctx) { ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H); }
  function eyebrow(ctx, idx, name, alpha) {
    ctx.save(); ctx.globalAlpha *= alpha == null ? 1 : alpha;
    spaced(ctx, `${String(idx).padStart(2, '0')}  ·  ${name.toUpperCase()}`, 80, 76, { size: 20, weight: 500, color: C.mute, spacing: 2.2 });
    ctx.restore();
  }
  function caption(ctx, s, alpha) {
    if (!s || alpha <= 0) return;
    ctx.save(); ctx.globalAlpha *= alpha;
    font(ctx, 400, 30, SANS);
    const lines = wrap(ctx, s, 1560);
    const lh = 42, top = 960;
    ctx.fillStyle = rgba(C.ink, 0.06);
    rrect(ctx, 120, top - 36, 1680, 28 + lines.length * lh + 20, 10); ctx.fill();
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
  const SCENES = [
    { id: 'title', name: 'Title', dur: 10 },
    { id: 'task', name: 'Task and hard constraints', dur: 30 },
    { id: 'guide', name: 'Guidance mechanism', dur: 32 },
    { id: 'stall', name: 'Why local attraction fails', dur: 36 },
    { id: 'geo', name: 'Geodesic progress field', dur: 54 },
    { id: 'teach', name: 'Teacher to structured student', dur: 38 },
    { id: 'slip', name: 'Same path, different physics', dur: 26 },
    { id: 'exp', name: 'Experiments and acceptance', dur: 30 },
    { id: 'retire', name: 'Distillation and retirement', dur: 26 }
  ];
  let acc = 0; for (const s of SCENES) { s.start = acc; acc += s.dur; }
  const DUR = acc;

  // =====================================================================
  // SCENE 1 — Title
  // =====================================================================
  function sceneTitle(ctx, u, env) {
    background(ctx);
    const v = makeView(0, 120, W, FX0, FX1, FZ0, FZ1); // full-width field as motif
    const f = env.F.L0;
    const levels = []; for (let k = 1; k <= 22; k++) levels.push(f.tmax * k / 23);
    const cut = f.tmax * sramp(u, 0.2, 5.5);
    ctx.save(); ctx.globalAlpha = 0.28;
    drawContours(ctx, f, v, levels, C.teal, 2.5, cut);
    ctx.restore();
    // title block
    ctx.save();
    ctx.globalAlpha = ramp(u, 0.8, 2.0);
    ctx.translate(0, (1 - easeOut(ramp(u, 0.8, 2.0))) * 18);
    text(ctx, 'Energy-Field Teachers for Small VLAs', 160, 470, { fam: SERIF, weight: 600, size: 84, color: C.ink });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 2.0, 3.2);
    paragraph(ctx, 'Gradient guidance from a geodesic progress field and a predictive world model — and how the teacher retires.', 160, 545, 1400, { size: 36, color: C.mute, lh: 48 });
    ctx.restore();
    ctx.save(); ctx.globalAlpha = ramp(u, 3.2, 4.2);
    line(ctx, 160, 700, 520, 700, C.orange, 4);
    spaced(ctx, 'RESEARCH PLAN  ·  CONCEPT / HYPOTHESIS  ·  2026-11-01', 160, 748, { size: 20, color: C.mute, spacing: 2.4 });
    text(ctx, 'Teacher: geometry + JEPA consequences   ·   Students: π0.5, GR00T N1.x   ·   No experimental results yet', 160, 790, { size: 24, color: C.faint });
    ctx.restore();
  }

  // =====================================================================
  // SCENE 2 — Task and the two hard constraints
  // =====================================================================
  const VIEW_MAIN = makeView(160, 170, 1600, FX0, FX1, FZ0, FZ1); // 1600 px wide → scale 1333 → height 853... too tall; use a cropped view instead
  const VIEW_SIDE = makeView(190, 150, 1540, 0.06, 1.18, 0, 0.56);

  function arcPath(x0, z0, x1, z1, apexZ, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = lerp(x0, x1, t);
      const z = lerp(z0, z1, t) + (apexZ - Math.max(z0, z1)) * Math.sin(Math.PI * t) * (1.0);
      pts.push([x, z]);
    }
    return pts;
  }
  function sceneTask(ctx, u, env) {
    background(ctx);
    const v = VIEW_SIDE;
    const ia = ramp(u, 0, 1.2);
    ctx.save(); ctx.globalAlpha = ia;
    drawTable(ctx, v); drawBarrier(ctx, v, WORLD.barrierH); drawBowl(ctx, v);
    text(ctx, 'barrier', v.px(0.58), v.py(WORLD.barrierH) - 14, { size: 22, color: C.mute, align: 'center' });
    text(ctx, 'bowl', v.px(WORLD.bowlX), v.py(WORLD.bowlH) - 16, { size: 22, color: C.mute, align: 'center' });
    ctx.restore();
    // gripper motion: straight toward the bowl, stops at contact
    const xContact = 0.505;
    const m = sramp(u, 2.0, 6.0);
    const gx = lerp(WORLD.start.x, xContact, m), gz = WORLD.start.z;
    // collision flash
    const flash = u > 6 ? fade(u, 6, 6.15, 7.2, 8.5) : 0;
    ctx.save(); ctx.globalAlpha = ia; drawGripper(ctx, v, gx, gz, { bananaAng: -0.05 }); ctx.restore();
    if (flash > 0) {
      ctx.save(); ctx.globalAlpha = flash;
      const cx = v.px(WORLD.barrierX0), cy = v.py(gz - 0.01);
      for (let r = 0; r < 3; r++) { ctx.beginPath(); ctx.arc(cx, cy, 24 + r * 22 + (u - 6) * 20, 0, 7); ctx.strokeStyle = rgba(C.red, 0.9 - r * 0.25); ctx.lineWidth = 5 - r; ctx.stroke(); }
      text(ctx, 'collision', cx - 30, cy - 70, { size: 24, weight: 600, color: C.red, align: 'right' });
      ctx.restore();
    }
    // the VLA's straight proposal (dashed) while moving
    if (u > 2 && u < 12) {
      ctx.save(); ctx.globalAlpha = fade(u, 2, 2.6, 10.5, 12) * 0.8;
      line(ctx, v.px(WORLD.start.x), v.py(gz), v.px(0.95), v.py(gz), C.blue, 3, [10, 12]);
      text(ctx, 'VLA proposal: straight to the bowl', v.px(0.3), v.py(gz) - 120, { size: 22, color: C.blue });
      ctx.restore();
    }
    // constraint 1: a teacher box emits a waypoint path, then it is crossed out
    if (u > 12 && u < 20.5) {
      const al = fade(u, 12, 12.6, 19.6, 20.5);
      ctx.save(); ctx.globalAlpha = al;
      panelBox(ctx, 1380, 190, 360, 120, { fill: C.panel, stroke: C.orange, lw: 3 });
      text(ctx, 'WAM teacher', 1560, 240, { size: 26, weight: 600, align: 'center', color: C.ink });
      text(ctx, 'outputs waypoints?', 1560, 278, { size: 22, align: 'center', color: C.mute });
      const pts = arcPath(xContact, gz, 0.98, 0.14, 0.44, 24).map(p => [v.px(p[0]), v.py(p[1])]);
      const prog = sramp(u, 12.8, 15.2);
      drawPartial(ctx, pts, prog, C.orange, 4, { dash: [14, 12] });
      const nShow = Math.floor(prog * 6 + 1e-6);
      for (let i = 1; i <= Math.min(nShow, 5); i++) { const p = pts[Math.round(i * 24 / 6)]; dot(ctx, p[0], p[1], 9, C.panel, C.orange); }
      // link from box to path
      arrow(ctx, 1380, 250, pts[10][0] + 30, pts[10][1] - 40, { color: C.orange, width: 2.5, head: 10, dash: [6, 8] });
      const cp = ramp(u, 15.6, 16.6);
      if (cp > 0) cross(ctx, pts[12][0], pts[12][1] - 20, 70, C.red, cp, 12);
      if (cp >= 1) text(ctx, 'not allowed: no reference path', pts[12][0], pts[12][1] - 120, { size: 26, weight: 600, color: C.red, align: 'center' });
      ctx.restore();
    }
    // constraint 2: a fan of ranked candidates, then crossed out
    if (u > 20 && u < 28.5) {
      const al = fade(u, 20, 20.6, 27.6, 28.5);
      ctx.save(); ctx.globalAlpha = al;
      const rnd = mulberry32(7);
      const prog = sramp(u, 20.6, 23.2);
      const scores = [];
      for (let i = 0; i < 12; i++) {
        const apex = 0.22 + rnd() * 0.32, endx = 0.78 + rnd() * 0.3, endz = 0.08 + rnd() * 0.2;
        const pts = arcPath(xContact, gz, endx, endz, apex, 24).map(p => [v.px(p[0]), v.py(p[1])]);
        const ok = apex > 0.36;
        drawPartial(ctx, pts, prog, ok ? rgba(C.faint, 0.9) : rgba(C.faint, 0.55), 3);
        if (prog >= 1) { const sc = (ok ? 0.55 + rnd() * 0.4 : rnd() * 0.4).toFixed(2); const e = pts[pts.length - 1]; text(ctx, sc, e[0] + 8, e[1] - 6, { size: 18, color: C.mute }); }
      }
      panelBox(ctx, 1380, 190, 360, 120, { fill: C.panel, stroke: C.slate, lw: 3 });
      text(ctx, 'sample N, score, rank', 1560, 240, { size: 26, weight: 600, align: 'center', color: C.ink });
      text(ctx, 'CEM / best-of-N', 1560, 278, { size: 22, align: 'center', color: C.mute });
      const cp = ramp(u, 24.2, 25.2);
      if (cp > 0) cross(ctx, v.px(0.78), v.py(0.36), 80, C.red, cp, 12);
      if (cp >= 1) text(ctx, 'not allowed as the main method', v.px(0.78), v.py(0.36) - 130, { size: 26, weight: 600, color: C.red, align: 'center' });
      ctx.restore();
    }
    // what remains: one gradient arrow on the current chunk
    if (u > 28) {
      const al = ramp(u, 28, 28.8);
      ctx.save(); ctx.globalAlpha = al;
      const px = v.px(gx), py = v.py(gz);
      arrow(ctx, px - 20, py - 40, px + 60 * al, py - 40 - 150 * al, { color: C.orange, width: 8, head: 26 });
      text(ctx, '−∇E', px + 80, py - 200, { size: 34, fam: MATH, italic: true, color: C.orange });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 6.2, 'Task: carry the grasped banana over the barrier and into the bowl.'],
      [6.2, 12.2, 'A small VLA proposes the obvious thing: move straight toward the bowl. The banana hits the barrier.'],
      [12.2, 20.2, 'Hard constraint 1 — the teacher never outputs a reference path, waypoints or sub-goal images.'],
      [20.2, 28.2, 'Hard constraint 2 — no sampling and ranking of many candidate trajectories. CEM and best-of-N stay as equal-compute baselines only.'],
      [28.2, 30.2, 'What remains: a differentiable field whose gradient corrects the VLA’s own action chunk.']
    ]);
  }

  // =====================================================================
  // SCENE 3 — Guidance mechanism
  // =====================================================================
  function sceneGuide(ctx, u, env) {
    background(ctx);
    const v = makeView(110, 170, 860, 0.18, 1.18, 0, 0.52);
    panelBox(ctx, 90, 150, 900, 600, { fill: C.panel });
    text(ctx, 'Action chunk during denoising (side view)', 110, 190, { size: 22, weight: 500, color: C.mute });
    ctx.save(); ctx.beginPath(); ctx.rect(92, 200, 896, 548); ctx.clip();
    drawTable(ctx, v); drawBarrier(ctx, v, WORLD.barrierH); drawBowl(ctx, v);
    // chunk: straight proposal → guided arc, H = 10 points
    const Hn = 10, rnd = mulberry32(3);
    const noise = []; for (let i = 0; i < Hn; i++) noise.push([(rnd() - 0.5) * 0.22, (rnd() - 0.5) * 0.22]);
    const loopT = 12; // seconds per denoising pass
    const uu = u % loopT; const pass = Math.floor(u / loopT);
    const tau = clamp(uu / 8.5, 0, 1);
    const inWin = tau >= 0.3 && tau <= 0.8;
    const g = sramp(tau, 0.3, 0.8); // how much the clean target has bent upward
    const straight = [], arc = arcPath(0.33, 0.17, 0.98, 0.13, 0.46, Hn - 1);
    for (let i = 0; i < Hn; i++) straight.push([lerp(0.33, 0.98, i / (Hn - 1)), lerp(0.17, 0.13, i / (Hn - 1))]);
    const pts = [], clean = [];
    for (let i = 0; i < Hn; i++) {
      const cx = lerp(straight[i][0], arc[i][0], g), cz = lerp(straight[i][1], arc[i][1], g);
      clean.push([cx, cz]);
      pts.push([lerp(noise[i][0] + 0.65, cx, tau), lerp(noise[i][1] + 0.28, cz, tau)]);
    }
    const P = pts.map(p => [v.px(p[0]), v.py(p[1])]);
    polyline(ctx, P, rgba(C.blue, 0.35 + 0.65 * tau), 4);
    P.forEach((p, i) => dot(ctx, p[0], p[1], 7, C.blue));
    // clean estimate ghost
    if (tau > 0.05 && tau < 0.98) { const Q = clean.map(p => [v.px(p[0]), v.py(p[1])]); polyline(ctx, Q, rgba(C.blueDeep, 0.35), 2.5, { dash: [8, 8] }); text(ctx, 'clean estimate Â', Q[6][0] + 10, Q[6][1] - 24, { size: 20, color: C.blueDeep, alpha: 0.9 }); }
    // guidance arrows during the window
    if (inWin) {
      const strength = Math.sin((tau - 0.3) / 0.5 * Math.PI);
      for (let i = 2; i <= 7; i++) {
        const p = P[i], len = 70 * strength * (1 - Math.abs(i - 4.5) / 4);
        arrow(ctx, p[0], p[1], p[0] + len * 0.25, p[1] - len, { color: C.orange, width: 4, head: 14 });
      }
      text(ctx, '−λ · ∇E', P[4][0] - 40, P[4][1] - 110, { size: 28, fam: MATH, italic: true, color: C.orange });
    }
    ctx.restore();
    // tau bar
    const bx = 150, by = 715, bw = 780;
    ctx.fillStyle = C.grid; rrect(ctx, bx, by - 8, bw, 16, 8); ctx.fill();
    ctx.fillStyle = rgba(C.orange, 0.35); ctx.fillRect(bx + bw * 0.3, by - 8, bw * 0.5, 16);
    ctx.fillStyle = C.blue; rrect(ctx, bx, by - 8, bw * tau, 16, 8); ctx.fill();
    dot(ctx, bx + bw * tau, by, 13, C.panel, C.blue);
    text(ctx, 'τ = 0 (noise)', bx, by + 40, { size: 20, color: C.mute });
    text(ctx, 'τ = 1 (actions)', bx + bw, by + 40, { size: 20, color: C.mute, align: 'right' });
    text(ctx, 'guided window τ ∈ [0.3, 0.8]', bx + bw * 0.55, by - 22, { size: 20, color: C.orangeDeep, align: 'center' });
    text(ctx, `τ = ${tau.toFixed(2)}`, bx + bw * 0.55, by + 40, { size: 20, color: C.ink, align: 'center' });

    // pipeline on the right
    const boxes = [
      ['VLA velocity field', 'v_θ(A^τ, o, ℓ)   —   π0.5: 10 Euler steps · GR00T: 4'],
      ['Clean estimate', 'Â = A^τ + (1 − τ) · v_θ'],
      ['Kinematics', 'K(Â): end-effector + attached object (swept spheres)'],
      ['Energy', 'E(K(Â); G, p, b) — geometry, progress, consequences'],
      ['Gradient', '∇_A E → normalize · clip · trust region · low-pass'],
      ['Guided velocity', 'v_θ − λ · q · ∇̄E   (MPGD: no backprop through v_θ)']
    ];
    const bx0 = 1030, by0 = 160, bw0 = 800, bh0 = 86, gap = 14;
    const active = tau <= 0.02 ? 0 : !inWin ? (tau > 0.8 ? 5 : 0) : Math.min(5, 1 + Math.floor(((tau - 0.3) / 0.5) * 5));
    boxes.forEach((b, i) => {
      const y = by0 + i * (bh0 + gap), al = ramp(u, 0.6 + i * 0.35, 1.2 + i * 0.35);
      ctx.save(); ctx.globalAlpha = al;
      const hot = i === active;
      panelBox(ctx, bx0, y, bw0, bh0, { fill: hot ? rgba(C.orange, 0.10) : C.panel, stroke: hot ? C.orange : C.grid, lw: hot ? 3 : 2 });
      text(ctx, b[0], bx0 + 22, y + 36, { size: 24, weight: 600, color: hot ? C.orangeDeep : C.ink });
      text(ctx, b[1], bx0 + 22, y + 68, { size: 21, fam: MATH, italic: true, color: C.mute });
      if (i < boxes.length - 1) arrow(ctx, bx0 + bw0 / 2, y + bh0 + 1, bx0 + bw0 / 2, y + bh0 + gap - 1, { color: C.faint, width: 2, head: 8 });
      ctx.restore();
    });
    text(ctx, 'Injection points: openpi sample_actions loop (t runs 1 → 0) · GR00T action-head Euler loop (τ runs 0 → 1)', 1030, 790, { size: 20, color: C.mute });
    captions(ctx, u, [
      [0, 6.5, 'A flow-matching VLA denoises an action chunk from noise (τ = 0) to actions (τ = 1); π0.5 uses 10 Euler steps, GR00T N1.6 uses 4.'],
      [6.5, 13.5, 'At each guided step: estimate the clean chunk, map it through kinematics, evaluate the energy, and push its gradient back into the velocity field.'],
      [13.5, 20.5, 'Guided only for τ ∈ [0.3, 0.8]; gradient normalized, a trust region per step, low-pass over the chunk. The MPGD path by default; backprop through v_θ is an ablation.'],
      [20.5, 26.5, 'The same energy serves both students: OmniGuide-style Cartesian injection through each embodiment’s kinematics.'],
      [26.5, 32.2, 'One guided step costs one energy forward and backward. Every comparison also reports equal-compute best-of-N.']
    ]);
  }

  // =====================================================================
  // SCENE 4 — Why local attraction + repulsion stalls
  // =====================================================================
  const VIEW_FIELD = makeView(130, 140, 1140, FX0, FX1, FZ0, FZ1); // 1140 → scale 950, height 608
  function sceneStall(ctx, u, env) {
    background(ctx);
    const v = VIEW_FIELD, F = env.F, f = F.L0;
    panelBox(ctx, v.x0 - 10, v.y0 - 10, v.w + 20, v.h + 20, { fill: C.panel });
    const ia = ramp(u, 0, 2.5);
    ctx.save(); ctx.beginPath(); ctx.rect(v.x0, v.y0, v.w, v.h); ctx.clip();
    drawField(ctx, env, f, v, 'E', null, ia);
    drawBarrier(ctx, v, WORLD.barrierH); drawBowl(ctx, v);
    text(ctx, 'E_local = attraction to bowl + repulsion from barrier', v.x0 + 20, v.y0 + 36, { size: 22, color: C.mute });
    // test point and force arrows
    const P = F.pStar, px = v.px(P.x), py = v.py(P.z);
    const parts = F.Eloc_parts(P.x, P.z);
    const sc = 11; // px per unit gradient
    const a1 = sramp(u, 3.2, 5.0), a2 = sramp(u, 5.0, 6.8), a3 = sramp(u, 6.8, 8.2);
    if (u > 3) {
      drawGripper(ctx, v, P.x, P.z, { armAlpha: 0.5 });
      dot(ctx, px, py, 9, C.ink);
      const ax = -parts.attract[0] * sc, ay = parts.attract[1] * sc; // force = −grad; canvas y down
      const rx = -parts.repel[0] * sc, ry = parts.repel[1] * sc;
      if (a1 > 0) { arrow(ctx, px, py, px + ax * a1, py + ay * a1, { color: C.blue, width: 6, head: 18 }); text(ctx, 'attraction', px + ax * a1 + 14, py + ay * a1 + 8, { size: 22, weight: 600, color: C.blue }); }
      if (a2 > 0) { arrow(ctx, px, py, px + rx * a2, py + ry * a2, { color: C.red, width: 6, head: 18 }); text(ctx, 'repulsion', px + rx * a2 - 14, py + ry * a2 + 8, { size: 22, weight: 600, color: C.red, align: 'right' }); }
      if (a3 > 0) {
        const nx = (ax + rx), ny = (ay + ry);
        ctx.save(); ctx.globalAlpha = a3;
        arrow(ctx, px, py, px + nx * 3, py + ny * 3, { color: C.ink, width: 7, head: 20 });
        text(ctx, 'net: no upward component', px + 30, py + 90, { size: 24, weight: 600, color: C.ink });
        ctx.restore();
      }
    }
    ctx.restore();
    // inset: E along z at x = P.x
    if (u > 10) {
      const al = ramp(u, 10, 11);
      const ix = 1320, iy = 150, iw = 480, ih = 360;
      ctx.save(); ctx.globalAlpha = al;
      panelBox(ctx, ix, iy, iw, ih, { fill: C.panel });
      text(ctx, 'E along the vertical at the stall point', ix + 20, iy + 36, { size: 22, color: C.mute });
      const zs = [], Es = []; let emin = 1e9, emax = -1e9;
      for (let k = 0; k <= 60; k++) { const z = 0.02 + k / 60 * 0.5; const e = F.Eloc_fn(P.x, z); zs.push(z); Es.push(e); emin = Math.min(emin, e); emax = Math.max(emax, e); }
      const gx0 = ix + 70, gy0 = iy + 70, gw = iw - 100, gh = ih - 130;
      line(ctx, gx0, gy0 + gh, gx0 + gw, gy0 + gh, C.line, 2); line(ctx, gx0, gy0, gx0, gy0 + gh, C.line, 2);
      const pts = zs.map((z, k) => [gx0 + (z - 0.02) / 0.5 * gw, gy0 + gh - (Es[k] - emin) / (emax - emin) * gh]);
      drawPartial(ctx, pts, sramp(u, 10.5, 13), C.orange, 4);
      // mark barrier top
      const bxp = gx0 + (WORLD.barrierH - 0.02) / 0.5 * gw;
      line(ctx, bxp, gy0, bxp, gy0 + gh, C.slate, 2, [6, 6]);
      text(ctx, 'barrier top', bxp + 8, gy0 + 18, { size: 18, color: C.slate });
      text(ctx, 'z (height)', gx0 + gw, gy0 + gh + 30, { size: 18, color: C.mute, align: 'right' });
      text(ctx, 'E', gx0 - 30, gy0 + 10, { size: 20, fam: MATH, italic: true, color: C.mute });
      if (u > 13) { ctx.globalAlpha = al * ramp(u, 13, 13.8); text(ctx, '∂E/∂z > 0 everywhere here: the field says “go down”', ix + 20, iy + ih - 24, { size: 21, weight: 600, color: C.orangeDeep }); }
      ctx.restore();
    }
    // facts card
    if (u > 18) {
      const al = fade(u, 18, 18.8, 35.3, 36);
      ctx.save(); ctx.globalAlpha = al;
      panelBox(ctx, 1320, 540, 480, 300, { fill: C.band, stroke: C.grid });
      text(ctx, 'Reported in prior work', 1340, 578, { size: 20, weight: 500, color: C.mute });
      paragraph(ctx, 'The Planning Limits of Latent World Models: with perfect predictions, distance-to-goal scoring drops from 92% to 41% success as the goal moves from 5 to 20 steps away.', 1340, 616, 440, { size: 21, color: C.ink, lh: 29 });
      paragraph(ctx, 'LatentCBF: a least-restrictive safety filter stalled in 62% of hardware trials — safe, but stuck.', 1340, 748, 440, { size: 21, color: C.ink, lh: 29 });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 3.3, 'First attempt: attraction to the bowl plus repulsion from the barrier — a classic potential field, built from the same SDF geometry.'],
      [3.3, 10.3, 'In front of the barrier the two forces cancel. The net gradient has no upward component; it even points toward the bowl’s height, i.e. down.'],
      [10.3, 18.3, 'Along the vertical the energy keeps rising. A gradient method stays pinned in front of the barrier.'],
      [18.3, 27.3, 'Distance-to-goal scores assume every step gets closer. A detour first moves away — and more accurate prediction does not repair the score.'],
      [27.3, 36.2, 'Knowing where not to go is not knowing how to get around. Collision avoidance alone yields “safe but stuck”.']
    ]);
  }

  // =====================================================================
  // SCENE 5 — Geodesic progress field
  // =====================================================================
  function drawSmallField(ctx, env, field, x, y, w, label, u, t0, pStart, isTop) {
    const v = makeView(x, y, w, FX0, FX1, FZ0, FZ1);
    const al = ramp(u, t0, t0 + 0.8);
    ctx.save(); ctx.globalAlpha = al;
    panelBox(ctx, x - 8, y - 8, w + 16, v.h + 16, { fill: C.panel });
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, v.h); ctx.clip();
    const cut = field.tmax * sramp(u, t0 + 0.2, t0 + 3.5);
    drawField(ctx, env, field, v, 'T', cut, 1);
    const levels = []; for (let k = 1; k <= 14; k++) levels.push(field.tmax * k / 15);
    drawContours(ctx, field, v, levels, rgba(C.tealDeep, 0.55), 1.5, cut);
    drawQuiver(ctx, field, v, 12, 11, C.tealDeep, 0.6 * ramp(u, t0 + 3.2, t0 + 4), cut);
    if (!isTop) { drawBarrier(ctx, v, field === env.F.L3 ? 0.42 : (field === env.F.L1 ? 0 : WORLD.barrierH)); drawBowl(ctx, v); }
    else {
      // top view drawing: wall and bowl circle
      ctx.fillStyle = C.slate; ctx.fillRect(v.px(WORLD.barrierX0), v.py(0.50), (WORLD.barrierX1 - WORLD.barrierX0) * v.scale, 0.50 * v.scale);
      ctx.beginPath(); ctx.arc(v.px(1.0), v.py(0.32), WORLD.bowlR * v.scale, 0, 7); ctx.fillStyle = C.bowl; ctx.fill(); ctx.strokeStyle = C.bowlDk; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, 'opening', v.px(0.58), v.py(0.56), { size: 16, color: C.slateDk, align: 'center' });
    }
    // descent arrow at the probe
    const gq = ramp(u, t0 + 3.6, t0 + 4.4);
    if (gq > 0) {
      const g = field.gradAt(pStart[0], pStart[1]), L = Math.hypot(g[0], g[1]) || 1;
      const px = v.px(pStart[0]), py = v.py(pStart[1]);
      dot(ctx, px, py, 6, C.ink);
      arrow(ctx, px, py, px - g[0] / L * 70 * gq, py + g[1] / L * 70 * gq, { color: C.orange, width: 5, head: 16 });
    }
    ctx.restore();
    text(ctx, label, x, y + v.h + 38, { size: 21, weight: 500, color: C.ink });
    ctx.restore();
    return v.h;
  }
  function sceneGeo(ctx, u, env) {
    background(ctx);
    const F = env.F, f = F.L0, P = F.pStar;
    if (u < 34) {
      const v = VIEW_FIELD;
      const al = u < 16 ? 1 : fade(u, 0, 0.1, 15.4, 16.2);
      if (al > 0) {
        ctx.save(); ctx.globalAlpha = al;
        panelBox(ctx, v.x0 - 10, v.y0 - 10, v.w + 20, v.h + 20, { fill: C.panel });
        ctx.save(); ctx.beginPath(); ctx.rect(v.x0, v.y0, v.w, v.h); ctx.clip();
        const cut = f.tmax * sramp(u, 0.8, 6.5);
        drawField(ctx, env, f, v, 'T', cut, 1);
        const levels = []; for (let k = 1; k <= 22; k++) levels.push(f.tmax * k / 23);
        drawContours(ctx, f, v, levels, rgba(C.tealDeep, 0.55), 1.8, cut);
        drawQuiver(ctx, f, v, 10, 13, C.tealDeep, 0.65 * ramp(u, 8, 9), cut);
        drawBarrier(ctx, v, WORLD.barrierH); drawBowl(ctx, v);
        text(ctx, 'T(x): shortest time to the goal set, speed S falls toward obstacles', v.x0 + 20, v.y0 + 36, { size: 22, color: C.mute });
        // probe and its descent direction
        if (u > 8.5) {
          const gq = sramp(u, 8.5, 9.6);
          drawGripper(ctx, v, P.x, P.z, { armAlpha: 0.5 });
          const g = f.gradAt(P.x, P.z), L = Math.hypot(g[0], g[1]) || 1;
          const px = v.px(P.x), py = v.py(P.z);
          dot(ctx, px, py, 9, C.ink);
          arrow(ctx, px, py, px - g[0] / L * 150 * gq, py + g[1] / L * 150 * gq, { color: C.orange, width: 8, head: 26 });
          text(ctx, '−∇T: up and over', px - 10, py - 190, { size: 26, weight: 600, color: C.orangeDeep });
        }
        ctx.restore();
        // side card: equation
        panelBox(ctx, 1320, 140, 480, 220, { fill: C.band, stroke: C.grid });
        text(ctx, 'S(x) ‖∇T(x)‖ = 1', 1560, 205, { size: 40, fam: MATH, italic: true, align: 'center', color: C.ink });
        text(ctx, 'T = 0 on the goal set;  S = clip(SDF_inflated / d_max, s_min, 1)', 1560, 252, { size: 20, align: 'center', color: C.mute });
        text(ctx, 'solved numerically (fast marching / fast sweeping) once per stage', 1560, 288, { size: 20, align: 'center', color: C.mute });
        text(ctx, '−∇T = d̂ / S  (direction d̂, magnitude 1/S)', 1560, 330, { size: 21, fam: MATH, italic: true, align: 'center', color: C.tealDeep });
        if (u > 8.5) {
          ctx.save(); ctx.globalAlpha = ramp(u, 8.5, 9.5);
          panelBox(ctx, 1320, 390, 480, 300, { fill: C.panel, stroke: C.grid });
          bullets(ctx, [
            'Continuous value function: no local minimum outside the goal set',
            'Computed on the grasped object’s reference point with inflated obstacles',
            'Recomputed only when the layout or the grasp changes'
          ], 1340, 440, 440, u, 8.8, 0.9, { size: 21, lh: 29, dotColor: C.teal });
          ctx.restore();
        }
        ctx.restore();
      }
      // interventions: three small fields
      if (u >= 15.6) {
        const w = 540, xs = [100, 690, 1280], y = 210;
        const probes = [[P.x, P.z], [0.30, 0.32], [P.x, P.z]];
        const fields = [F.L1, F.L2, F.L3];
        const labels = ['Barrier removed → straight pull, no extra lift', 'Top closed (top view) → around the side opening', 'Taller barrier → more clearance, same stages'];
        const starts = [16.2, 22.2, 28.2];
        fields.forEach((fl, i) => drawSmallField(ctx, env, fl, xs[i], y, w, labels[i], u, starts[i], probes[i], i === 1));
        ctx.save(); ctx.globalAlpha = ramp(u, 16, 17);
        heading(ctx, 'Change the layout; the field changes with it', 100, 170, 36);
        ctx.restore();
      }
    } else {
      // caveats and stage structure
      const al = ramp(u, 34, 35);
      ctx.save(); ctx.globalAlpha = al;
      heading(ctx, 'What T does and does not settle', 100, 200, 40);
      const cards = [
        ['A value field, not a path', 'T scores any candidate state; it prescribes no waypoints. Following −∇T greedily is one option, not the interface.'],
        ['Progress, not just direction', 'E_adv = [T(x_H) − T(x₀) + δ]₊² — staying still is not free. δ = 0 while grasping or releasing; positive during transport.'],
        ['Still to be tested', 'Numerical T_h vs. the continuous T; the map J_Kᵀ ∇T into action space; composition with collision and consequence terms — each can stall.']
      ];
      cards.forEach((c, i) => {
        const a2 = ramp(u, 34.4 + i * 1.2, 35.2 + i * 1.2);
        ctx.save(); ctx.globalAlpha = a2; ctx.translate(0, (1 - easeOut(a2)) * 16);
        const x = 100 + i * 580, y = 250, w = 540, h = 300;
        panelBox(ctx, x, y, w, h, { fill: C.panel, stroke: i === 1 ? C.orange : C.grid, lw: i === 1 ? 3 : 2 });
        text(ctx, c[0], x + 26, y + 50, { size: 26, weight: 600, color: C.ink });
        paragraph(ctx, c[1], x + 26, y + 100, w - 52, { size: 22, color: C.mute, lh: 31, fam: i === 1 ? MATH : SANS, italic: i === 1 });
        ctx.restore();
      });
      if (u > 43) {
        const a3 = ramp(u, 43, 44);
        ctx.save(); ctx.globalAlpha = a3;
        heading(ctx, 'Stages switch only where contact permissions change', 100, 640, 34);
        const stages = [['approach', 'gripper ↔ banana allowed'], ['grasp', 'latched event'], ['transport', 'banana ↔ barrier forbidden; T active'], ['place', 'banana ↔ bowl allowed'], ['release', 'gripper opens']];
        stages.forEach((s, i) => {
          const a4 = ramp(u, 43.6 + i * 0.6, 44.2 + i * 0.6);
          ctx.save(); ctx.globalAlpha = a4;
          const x = 100 + i * 346, y = 680, w = 320, h = 150;
          panelBox(ctx, x, y, w, h, { fill: i === 2 ? rgba(C.teal, 0.08) : C.panel, stroke: i === 2 ? C.teal : C.grid, lw: i === 2 ? 3 : 2 });
          text(ctx, `${i + 1}  ${s[0]}`, x + 22, y + 48, { size: 26, weight: 600, color: C.ink });
          paragraph(ctx, s[1], x + 22, y + 88, w - 44, { size: 20, color: C.mute, lh: 27 });
          if (i < 4) arrow(ctx, x + w + 2, y + h / 2, x + w + 24, y + h / 2, { color: C.faint, width: 2.5, head: 9 });
          ctx.restore();
        });
        text(ctx, 'No “cross the barrier” stage: the detour lives in T, not in stage design.', 100, 880, { size: 24, color: C.tealDeep, weight: 500 });
        ctx.restore();
      }
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 8.5, 'Geodesic progress field T(x): solve the eikonal equation from the goal set in the grasped-object space, with obstacles inflated by gripper and banana. Speed falls toward obstacles to keep clearance.'],
      [8.5, 16, 'T is a numerical shortest-time field. Its continuous value function has no spurious minima; in front of the barrier −∇T points up and over, with magnitude 1/S.'],
      [16, 22.2, 'Remove the barrier and the field becomes a plain pull toward the bowl — no extra lift is asked for.'],
      [22.2, 28.2, 'Close the top and, in the top view, −∇T swings toward the side opening.'],
      [28.2, 34, 'Raise the barrier and the field asks for more clearance. No stage definition or waypoint was edited for any of these.'],
      [34, 43.2, 'T is a value field, not a reference path. The progress term must reward progress itself — a hinge on the change of T over the chunk — so that holding still is never free.'],
      [43.2, 54.2, 'Stages are cut only where contact permissions change. Geometry no longer hides a route inside the stage definition.']
    ]);
  }

  // =====================================================================
  // SCENE 6 — Teacher to structured student
  // =====================================================================
  function sceneTeach(ctx, u, env) {
    background(ctx);
    heading(ctx, 'Predictive teacher → structured energy student', 100, 150, 40, ramp(u, 0, 0.8));
    const box = (x, y, w, h, title, body, col, al, o) => {
      o = o || {};
      ctx.save(); ctx.globalAlpha = al; ctx.translate(0, (1 - easeOut(al)) * 14);
      panelBox(ctx, x, y, w, h, { fill: o.fill || C.panel, stroke: col, lw: 3 });
      text(ctx, title, x + 22, y + 42, { size: 24, weight: 600, color: col });
      paragraph(ctx, body, x + 22, y + 80, w - 44, { size: 21, color: C.ink, lh: 29, fam: o.math ? MATH : SANS, italic: !!o.math });
      ctx.restore();
    };
    // Teacher row
    const ty = 210;
    ctx.save(); ctx.globalAlpha = ramp(u, 0.5, 1.2);
    spaced(ctx, 'TEACHER  ·  TRAINING TIME ONLY', 100, ty - 14, { size: 18, color: C.orangeDeep, spacing: 2.2 });
    ctx.restore();
    box(100, ty, 520, 190, 'Explicit geometry', 'SDF of the scene · geodesic progress T(x) · contact permission matrix M (part × surface × stage)', C.teal, ramp(u, 0.8, 1.6));
    box(660, ty, 560, 190, 'JEPA predictor F_θ(z₀, A)', 'Consequence readouts: grasp held? relative slip? object in goal set? forbidden contact?', C.orange, ramp(u, 1.6, 2.4));
    box(1260, ty, 560, 190, 'Teacher energy E_T(A)', 'E_T = E_geometry(K(A)) + ℓ_task(F_θ(z₀, A), g, c); evaluated on the VLA proposal and its local perturbations — no path, no ranking.', C.orangeDeep, ramp(u, 2.4, 3.2), { math: false });
    arrow(ctx, 622, ty + 95, 656, ty + 95, { color: C.faint, width: 3, head: 10 });
    arrow(ctx, 1222, ty + 95, 1256, ty + 95, { color: C.faint, width: 3, head: 10 });
    // middle: distillation arrow
    const mid = ramp(u, 16, 17.2);
    ctx.save(); ctx.globalAlpha = mid;
    arrow(ctx, 960, ty + 200, 960, ty + 318, { color: C.ink, width: 5, head: 20 });
    panelBox(ctx, 420, ty + 222, 1080, 74, { fill: C.band, stroke: C.grid });
    text(ctx, 'Sobolev matching (values + gradients on VLA proposals)  ·  DAgger-style relabel on post-guidance proposals  ·  judged by real simulated outcomes', 960, ty + 268, { size: 20, align: 'center', color: C.ink });
    ctx.restore();
    // Student row
    const sy = ty + 340;
    ctx.save(); ctx.globalAlpha = ramp(u, 16.5, 17.3);
    spaced(ctx, 'STUDENT  ·  DEPLOYMENT', 100, sy - 14, { size: 18, color: C.blueDeep, spacing: 2.2 });
    ctx.restore();
    box(100, sy, 520, 210, 'Encoder W_ψ, once per chunk', '(h, p, b) = W_ψ(o, s, ℓ): object roles, goal set, contact permissions p; stage belief and invariants b; cached features h.', C.blue, ramp(u, 17, 17.8));
    box(660, sy, 560, 210, 'Analytic energy, always kept', 'E_analytic(K(A); G, p, b): SDF repulsion, progress hinge on T, contact matrix. Geometry comes from sensors, not from the network.', C.teal, ramp(u, 18, 18.8));
    box(1260, sy, 560, 210, 'Small consequence module R_ψ', 'R_ψ(h, φ(A); p, b) answers per action query from velocities, accelerations and grasp state. R_ψ = 0 is the S1 baseline.', C.orange, ramp(u, 19, 19.8));
    arrow(ctx, 622, sy + 105, 656, sy + 105, { color: C.faint, width: 3, head: 10 });
    arrow(ctx, 1222, sy + 105, 1256, sy + 105, { color: C.faint, width: 3, head: 10 });
    const eq = ramp(u, 20.5, 21.3);
    ctx.save(); ctx.globalAlpha = eq;
    text(ctx, 'E_S(A) = E_analytic(K(A); G, p, b) + R_ψ(h, φ(A); p, b)', 960, sy + 290, { size: 34, fam: MATH, italic: true, align: 'center', color: C.ink });
    text(ctx, 'single scalar potential · total-gradient normalization only · independent execution safety layer', 960, sy + 332, { size: 20, align: 'center', color: C.mute });
    ctx.restore();
    captions(ctx, u, [
      [0, 8, 'Teacher, used only in training: explicit geometry — SDF, T, contact matrix — plus a JEPA predictor whose readouts cover what geometry cannot see: grasp stability, slip, contact outcome.'],
      [8, 16, 'Detour knowledge now comes from T, not from JEPA. JEPA’s increment has to be shown on physics, not on routes.'],
      [16, 26, 'Student, at deployment: one encoder pass per chunk gives roles, goal set and stage belief; a small consequence module answers each action query; analytic geometry is always kept.'],
      [26, 38.2, 'Train with value and gradient matching, relabel on the post-guidance distribution, and judge only by real outcomes. If the analytic field alone suffices, the experiment says so.']
    ]);
  }

  // =====================================================================
  // SCENE 7 — Same path, different physics (fast/slow)
  // =====================================================================
  function sceneSlip(ctx, u, env) {
    background(ctx);
    heading(ctx, 'Same path geometry, different physics', 100, 140, 40, ramp(u, 0, 0.8));
    const panels = [[100, 'Slow transport (duration 2×)', 9.0], [980, 'Fast transport (duration 1×)', 4.5]];
    const path = arcPath(0.30, 0.17, 0.98, 0.13, 0.47, 60);
    panels.forEach(([x, label, dur], pi) => {
      const v = makeView(x + 20, 230, 800, 0.16, 1.16, 0, 0.56);
      panelBox(ctx, x, 180, 840, 560, { fill: C.panel });
      text(ctx, label, x + 24, 218, { size: 22, weight: 500, color: C.mute });
      ctx.save(); ctx.beginPath(); ctx.rect(x + 2, 226, 836, 512); ctx.clip();
      drawTable(ctx, v); drawBarrier(ctx, v, WORLD.barrierH); drawBowl(ctx, v);
      polyline(ctx, path.map(p => [v.px(p[0]), v.py(p[1])]), rgba(C.blue, 0.35), 3, { dash: [8, 10] });
      // motion: both start at u=1.5, repeat
      const t0 = 1.5, period = 12;
      let s = ((u - t0) % period + period) % period; if (u < t0) s = 0;
      const prog = clamp(s / dur, 0, 1);
      const idx = prog * 60, i0 = Math.floor(idx), i1 = Math.min(60, i0 + 1), fr = idx - i0;
      const gx = lerp(path[i0][0], path[i1][0], fr), gz = lerp(path[i0][1], path[i1][1], fr);
      // acceleration proxy: curvature × speed²
      const speed = 1 / dur;
      const slipped = pi === 1 && s > dur * 0.5 && s < period - 0.1;
      let bDx = 0, bDz = 0, bAng = 0;
      if (pi === 1 && !slipped) { const lag = clamp(speed * 4 * Math.sin(Math.PI * prog), 0, 0.09); bDx = -lag; bAng = -lag * 4; }
      drawGripper(ctx, v, gx, gz, { bananaDx: bDx, bananaDz: bDz, bananaAng: bAng, noBanana: slipped, open: slipped ? 6 : 0 });
      if (slipped) {
        // banana falls from the apex
        const tf = s - dur * 0.5, ax = path[30][0] - 0.06, az = path[30][1] - 0.01;
        const fz = Math.max(WORLD.barrierH + 0.04, az - 0.5 * 2.2 * tf * tf), fx = ax + 0.2 * tf;
        drawBanana(ctx, v.px(fx), v.py(fz), -tf * 2.0, 0.07 * v.scale);
        ctx.save(); ctx.globalAlpha = fade(s, dur * 0.5, dur * 0.5 + 0.3, period - 1, period - 0.2);
        text(ctx, 'slip', v.px(fx) + 40, v.py(fz) - 40, { size: 26, weight: 600, color: C.red });
        ctx.restore();
      }
      ctx.restore();
      // verdict chips
      const chipA = ramp(u, 7.5, 8.3);
      ctx.save(); ctx.globalAlpha = chipA;
      panelBox(ctx, x + 24, 690, 380, 38, { fill: C.band, stroke: C.grid, r: 19 });
      text(ctx, 'geometry-only energy: identical score', x + 214, 716, { size: 19, align: 'center', color: C.ink });
      const chipB = ramp(u, 14.5, 15.3);
      ctx.globalAlpha = chipB;
      panelBox(ctx, x + 420, 690, 400, 38, { fill: pi === 0 ? C.greenSoft : C.redSoft, stroke: pi === 0 ? C.green : C.red, r: 19 });
      text(ctx, pi === 0 ? 'consequence module: grasp held' : 'consequence module: slip risk high', x + 620, 716, { size: 19, align: 'center', color: C.ink });
      ctx.restore();
    });
    captions(ctx, u, [
      [0, 7.5, 'Same path geometry, different timing. Slow transport keeps the banana; fast transport lets it lag and slip at the apex.'],
      [7.5, 14.5, 'A geometry-only energy — SDF, T, contact matrix — scores both executions identically.'],
      [14.5, 20.5, 'The consequence module must tell them apart — and must beat a simple analytic grasp-stability baseline (acceleration bound, friction cone) to justify learning it.'],
      [20.5, 26.2, 'The input definition decides what the test proves: a fixed-rate action sequence already encodes velocity; only time-free path geometry is blind to speed.']
    ]);
  }

  // =====================================================================
  // SCENE 8 — Experiments and E0 acceptance
  // =====================================================================
  function sceneExp(ctx, u, env) {
    background(ctx);
    heading(ctx, 'Experiments, in the order that can fail early', 100, 140, 40, ramp(u, 0, 0.8));
    const cols = [
      ['A', 'Privileged expressiveness', C.teal, 0.6, [
        'Correct geometry, roles and contacts given; no language backbone trained',
        'Four energies: analytic · analytic + T · JEPA teacher · both; plus an analytic grasp-stability baseline',
        'Plateau gradient at the stall point, trap rate, six layout interventions, fast/slow test',
        'Hand-made fields are “privileged references”, never upper bounds'
      ]],
      ['B', 'Does amortization keep consequences?', C.orange, 6.6, [
        'Frozen VLA · analytic field · JEPA teacher · learned parameter field · field + R_ψ · AGF-style guidance vector',
        'Fair baseline: same teacher signal, data, information and injection interface; one multi-task network each',
        'Held-out objects × constraints × layouts; interventionability when roles or contacts are edited',
        'Student gradient judged by one-step improvement in simulation, not by cosine to the teacher'
      ]],
      ['C', 'Closed loop, latency, retirement', C.blue, 12.6, [
        'π0.5 and GR00T N1.6: success, collisions, drops, recovery after a lost grasp',
        'Full-pipeline p50/p95: encoding, geometry update (T once per stage), generation, R_ψ query, backward',
        'Three gradient variants: MPGD stop-gradient · full Tweedie Jacobian · adjoint',
        'Equal-compute best-of-N / CEM as baselines; teacher retirement curves'
      ]]
    ];
    cols.forEach(([letter, title, col, t0, items], i) => {
      const x = 100 + i * 580, y = 200, w = 540, h = 470;
      const al = ramp(u, t0, t0 + 0.8);
      ctx.save(); ctx.globalAlpha = al; ctx.translate(0, (1 - easeOut(al)) * 16);
      panelBox(ctx, x, y, w, h, { fill: C.panel, stroke: col, lw: 3 });
      ctx.fillStyle = col; rrect(ctx, x + 22, y + 24, 46, 46, 10); ctx.fill();
      text(ctx, letter, x + 45, y + 57, { size: 28, weight: 700, color: C.panel, align: 'center' });
      text(ctx, title, x + 84, y + 56, { size: 24, weight: 600, color: C.ink });
      bullets(ctx, items, x + 22, y + 120, w - 44, u, t0 + 0.9, 1.0, { size: 20, lh: 27, dotColor: col, gap: 16 });
      ctx.restore();
    });
    // E0 acceptance checklist
    const e0 = ramp(u, 18.5, 19.3);
    ctx.save(); ctx.globalAlpha = e0;
    panelBox(ctx, 100, 700, 1720, 200, { fill: C.band, stroke: C.grid });
    text(ctx, 'E0 acceptance — before any amortization training', 124, 740, { size: 24, weight: 600, color: C.ink });
    const tests = [
      ['Hold-action test', 'staying still is never scored as progress'],
      ['Layout interventions', 'closed top, closed side, removed barrier: actions change, stages do not'],
      ['Space → action gradient', '∇T survives the kinematic map; no stall at symmetric or joint-limit states'],
      ['Dynamics increment', 'JEPA beats pure geometry and the analytic grasp-stability baseline']
    ];
    tests.forEach((t, i) => {
      const a = ramp(u, 19.5 + i * 1.6, 20.1 + i * 1.6);
      ctx.save(); ctx.globalAlpha = a;
      const x = 124 + i * 425, y = 770;
      ctx.strokeStyle = C.mute; ctx.lineWidth = 3; rrect(ctx, x, y, 30, 30, 6); ctx.stroke();
      text(ctx, 'to run', x + 15, y + 52, { size: 15, color: C.faint, align: 'center' });
      text(ctx, t[0], x + 46, y + 24, { size: 21, weight: 600, color: C.ink });
      paragraph(ctx, t[1], x + 46, y + 56, 350, { size: 18, color: C.mute, lh: 24 });
      ctx.restore();
    });
    ctx.restore();
    captions(ctx, u, [
      [0, 6.6, 'Experiment A — privileged expressiveness: with correct geometry and contacts given, which energy family can even express the task?'],
      [6.6, 12.6, 'Experiment B — does amortization keep consequences, or only the look of the field? Fair AGF-style baseline: same teacher, data, information and injection interface.'],
      [12.6, 18.6, 'Experiment C — closed loop on π0.5 and GR00T: success, drops, full-pipeline latency, three gradient approximations, and retirement.'],
      [18.6, 30.2, 'Before any large-scale amortization training, four acceptance tests must pass.']
    ]);
  }

  // =====================================================================
  // SCENE 9 — Distillation and three-level retirement
  // =====================================================================
  function sceneRetire(ctx, u, env) {
    background(ctx);
    heading(ctx, 'Distill the corrections, then retire the teacher in three steps', 100, 140, 40, ramp(u, 0, 0.8));
    // left: three levels
    const levels = [
      ['Level 1', 'Predictive teacher (JEPA) off', 'amortized R_ψ and geometry still guide', C.orange, 3.0],
      ['Level 2', 'Learned consequence module R_ψ off', 'FMM/T and SDF geometry still guide — not yet autonomous', C.teal, 6.0],
      ['Level 3', 'All guidance off', 'VLA alone + independent execution safety layer = autonomy', C.blue, 9.0]
    ];
    levels.forEach(([lv, title, note, col, t0], i) => {
      const y = 210 + i * 170, al = ramp(u, 0.8 + i * 0.5, 1.4 + i * 0.5), off = sramp(u, t0, t0 + 1.2);
      ctx.save(); ctx.globalAlpha = al;
      panelBox(ctx, 100, y, 860, 140, { fill: C.panel, stroke: off > 0.5 ? C.grid : col, lw: 3 });
      // toggle
      const tx = 820, ty = y + 50;
      ctx.fillStyle = off > 0.5 ? C.grid : col; rrect(ctx, tx, ty, 92, 44, 22); ctx.fill();
      dot(ctx, lerp(tx + 70, tx + 22, off), ty + 22, 17, C.panel);
      text(ctx, off > 0.5 ? 'off' : 'on', tx + 46, ty + 76, { size: 16, color: C.mute, align: 'center' });
      text(ctx, lv, 124, y + 46, { size: 20, weight: 500, color: col });
      text(ctx, title, 124, y + 82, { size: 26, weight: 600, color: off > 0.5 ? C.mute : C.ink });
      paragraph(ctx, note, 124, y + 116, 660, { size: 20, color: C.mute, lh: 26 });
      ctx.restore();
    });
    ctx.save(); ctx.globalAlpha = ramp(u, 1.5, 2.3);
    paragraph(ctx, 'Corrections are distilled into a noise-space adapter or a vector-field residual; the base VLA weights stay frozen first.', 100, 745, 860, { size: 21, color: C.mute, lh: 29 });
    ctx.restore();
    // right: illustrative chart (hypothesis)
    const cx0 = 1040, cy0 = 210, cw = 780, ch = 540;
    const ca = ramp(u, 2.5, 3.3);
    ctx.save(); ctx.globalAlpha = ca;
    panelBox(ctx, cx0, cy0, cw, ch, { fill: C.panel });
    text(ctx, 'Autonomous success vs. cumulative teacher calls', cx0 + 24, cy0 + 40, { size: 22, weight: 600, color: C.ink });
    spaced(ctx, 'ILLUSTRATIVE HYPOTHESIS — NOT RESULTS', cx0 + 24, cy0 + 68, { size: 15, color: C.orangeDeep, spacing: 2 });
    const gx = cx0 + 90, gy = cy0 + 100, gw = cw - 130, gh = ch - 190;
    // grid
    for (let k = 0; k <= 4; k++) { const yy = gy + gh - gh * k / 4; line(ctx, gx, yy, gx + gw, yy, C.grid, 1); text(ctx, `${k * 25}%`, gx - 14, yy + 7, { size: 16, color: C.mute, align: 'right' }); }
    const xs = [0, 50, 100, 200, 400, 800];
    xs.forEach((xv, k) => { const xx = gx + gw * k / 5; text(ctx, String(xv), xx, gy + gh + 30, { size: 16, color: C.mute, align: 'center' }); });
    text(ctx, 'teacher calls (log-spaced)', gx + gw / 2, gy + gh + 60, { size: 17, color: C.mute, align: 'center' });
    line(ctx, gx, gy + gh, gx + gw, gy + gh, C.line, 2);
    const series = [
      ['vector-field / adapter distillation', C.blue, [35, 52, 67, 79, 88, 91]],
      ['action-only distillation', C.orange, [35, 45, 55, 66, 74, 79]],
      ['direct fine-tuning (same data)', C.slate, [35, 41, 48, 56, 63, 69]]
    ];
    const prog = sramp(u, 3.5, 11);
    series.forEach(([name, col, vals], si) => {
      const pts = vals.map((val, k) => [gx + gw * k / 5, gy + gh - gh * val / 100]);
      const end = drawPartial(ctx, pts, prog, col, 3);
      if (end) { dot(ctx, end[0], end[1], 6, col); }
      if (prog >= 1) text(ctx, name, pts[5][0] - 12, pts[5][1] - 14 + (si === 1 ? 0 : 0), { size: 17, color: C.ink, align: 'right' });
    });
    // legend
    series.forEach(([name, col], si) => { const lx = cx0 + 24 + si * 250, ly = cy0 + ch - 24; line(ctx, lx, ly, lx + 26, ly, col, 3); text(ctx, name.split(' (')[0], lx + 34, ly + 6, { size: 15, color: C.mute }); });
    ctx.restore();
    // end card
    if (u > 17) {
      const al = ramp(u, 17, 18.2);
      ctx.save(); ctx.globalAlpha = al;
      ctx.fillStyle = rgba(C.paper, 0.92 * al); ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = al;
      text(ctx, 'Success means autonomy rises while teacher usage falls — and old skills hold.', 960, 400, { fam: SERIF, weight: 600, size: 48, align: 'center', color: C.ink });
      paragraph(ctx, 'Next: a privileged closed-loop test. From a wrong or stalled action, does the field find an executable improvement?', 360, 480, 1200, { size: 30, color: C.mute, lh: 42, align: 'center' });
      line(ctx, 760, 600, 1160, 600, C.orange, 4);
      spaced(ctx, 'STATUS: CONCEPT / HYPOTHESIS  ·  NOTHING SHOWN HERE IS A RESULT', 490, 660, { size: 20, color: C.mute, spacing: 2.4 });
      ctx.restore();
    }
    captions(ctx, u, [
      [0, 8, 'Guided rollouts are distilled into a lightweight student; then the teacher is retired one layer at a time.'],
      [8, 16, 'Level 1: predictive teacher off. Level 2: learned consequence module off — geometry guidance still runs, so this is not yet autonomy. Level 3: all guidance off.'],
      [16, 26.2, 'The curves are hypotheses to test under equal data and compute, with retention on old tasks reported alongside.']
    ]);
  }

  const DRAW = [sceneTitle, sceneTask, sceneGuide, sceneStall, sceneGeo, sceneTeach, sceneSlip, sceneExp, sceneRetire];

  // ---- environment / compositor ----
  function createEnv(makeCanvas) {
    const env = { makeCanvas, F: buildFields(), cache: {} };
    env.off = makeCanvas(W, H);
    return env;
  }
  function sceneIndexAt(t) {
    for (let i = SCENES.length - 1; i >= 0; i--) if (t >= SCENES[i].start) return i;
    return 0;
  }
  function drawScene(ctx, i, u, env) {
    ctx.save();
    DRAW[i](ctx, u, env);
    ctx.restore();
    eyebrow(ctx, i + 1, SCENES[i].name, ramp(u, 0, 0.6));
  }
  // draw the full frame at absolute time t (seconds)
  function draw(ctx, t, env) {
    t = clamp(t, 0, DUR - 1e-3);
    const i = sceneIndexAt(t), s = SCENES[i], u = t - s.start;
    if (i > 0 && u < FADE) {
      // crossfade: previous scene frozen at its end, new scene fading in
      drawScene(ctx, i - 1, SCENES[i - 1].dur - 0.001, env);
      const octx = env.off.getContext('2d');
      octx.save(); octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, W, H);
      drawScene(octx, i, u, env);
      octx.restore();
      ctx.save(); ctx.globalAlpha = easeIO(u / FADE); ctx.drawImage(env.off, 0, 0); ctx.restore();
    } else {
      drawScene(ctx, i, u, env);
    }
    progressLine(ctx, t / DUR);
  }

  return { W, H, C, SCENES, DUR, FADE, createEnv, draw, sceneIndexAt, buildFields };
});
