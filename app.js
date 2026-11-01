/* app.js — browser glue: boots the three.js world and the 2D overlay, drives the timeline,
   and exposes window.__render(t) / window.__ready for headless frame capture.
   Layers (bottom → top): #gl (three.js, current scene) · #glprev (last frame of the previous scene,
   only during the 0.5 s crossfade, CSS opacity) · #ui (Canvas 2D overlay, transparent). */
(function () {
  'use strict';
  const core = window.MGCore, MGScene = window.MGScene;
  const { W, H, DUR, SCENES, FADE } = core;
  const { clamp, easeIO } = core.util;
  const params = new URLSearchParams(location.search);
  const headless = params.get('headless') === '1';
  const assetBase = window.MG_ASSET_BASE != null ? window.MG_ASSET_BASE : 'assets/';
  if (headless) document.documentElement.classList.add('headless');

  const gl = document.getElementById('gl'), prev = document.getElementById('glprev'), ui = document.getElementById('ui');
  for (const c of [prev, ui]) { c.width = W; c.height = H; }
  const uiCtx = ui.getContext('2d'), prevCtx = prev.getContext('2d');
  let world = null, env = null, ready = false, prevCache = { i: -1, fi: null };
  let readyResolve; window.__ready = false; window.__readyPromise = new Promise(r => { readyResolve = r; });
  window.__errors = [];

  // ---- one frame at absolute time t (seconds) ----
  function renderAt(t) {
    if (!ready) return false;
    t = clamp(t, 0, DUR - 1e-3);
    const i = core.sceneIndexAt(t), u = t - SCENES[i].start;
    let fiPrev = null;
    if (i > 0 && u < FADE) {
      if (prevCache.i !== i) { // previous scene's last frame, rendered once per transition
        world.update(SCENES[i].start - 0.001); world.render();
        prevCtx.clearRect(0, 0, W, H); prevCtx.drawImage(gl, 0, 0);
        prevCache = { i, fi: world.frameInfo() };
      }
      fiPrev = prevCache.fi;
      prev.style.opacity = String(1 - easeIO(u / FADE)); prev.style.visibility = 'visible';
    } else prev.style.visibility = 'hidden';
    world.update(t); world.render();
    uiCtx.setTransform(1, 0, 0, 1, 0, 0); uiCtx.globalAlpha = 1; uiCtx.clearRect(0, 0, W, H);
    core.draw(uiCtx, t, env, world.frameInfo(), fiPrev);
    return true;
  }
  window.__render = function (t) { return renderAt(+t); };

  async function boot() {
    const faces = ['400 40px Lora', '600 40px Lora', 'italic 400 40px Lora', 'italic 600 40px Lora',
      '400 40px Inter', '500 40px Inter', '600 40px Inter', '700 40px Inter'];
    try { await Promise.all(faces.map(f => document.fonts.load(f, 'Aa∇τ'))); } catch (e) { /* fall back to stacks */ }
    world = await MGScene.createWorld(gl, assetBase);
    env = core.createEnv((w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }));
    window.__world = world;
    ready = true; window.__ready = true; readyResolve(true);
    if (headless) renderAt(+(params.get('t') || 0));
    else initPlayer();
  }

  // ---- player ----
  function fmt(t) { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }
  function initPlayer() {
    const $ = id => document.getElementById(id);
    const btnPlay = $('btnPlay'), scrub = $('scrub'), time = $('time'), sceneName = $('sceneName'), speedSel = $('speed'), strip = $('strip'), list = $('chapters'), btnFull = $('btnFull'), stage = $('stage');
    let t = +(params.get('t') || 0), playing = false, speed = 1, last = null, dirty = true;
    scrub.max = String(DUR); scrub.step = '0.01';
    // scene strip (proportional segments = ticks + tooltips + jump targets) and chapter list
    SCENES.forEach((s, i) => {
      const seg = document.createElement('button');
      seg.className = 'seg'; seg.style.flexGrow = String(s.dur); seg.type = 'button';
      seg.title = `${i + 1} · ${s.name} (${fmt(s.start)})`; seg.setAttribute('aria-label', `Jump to scene ${i + 1}: ${s.name}`);
      seg.textContent = String(i + 1);
      seg.addEventListener('click', () => seek(s.start + 0.6));
      strip.appendChild(seg);
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.innerHTML = `<span class="num">${i + 1}</span><span class="nm"></span><span class="tc">${fmt(s.start)}</span>`;
      b.querySelector('.nm').textContent = s.name;
      b.addEventListener('click', () => seek(s.start + 0.6));
      li.appendChild(b); list.appendChild(li);
    });
    const segs = strip.querySelectorAll('.seg'), chapters = list.querySelectorAll('button');
    function seek(nt) { t = clamp(nt, 0, DUR - 1e-3); dirty = true; }
    function setPlaying(p) {
      playing = p; if (p && t >= DUR - 0.01) t = 0;
      btnPlay.setAttribute('aria-label', p ? 'Pause' : 'Play'); btnPlay.dataset.state = p ? 'pause' : 'play'; last = null;
    }
    btnPlay.addEventListener('click', () => setPlaying(!playing));
    scrub.addEventListener('input', () => seek(+scrub.value));
    speedSel.addEventListener('change', () => { speed = +speedSel.value; });
    btnFull.addEventListener('click', toggleFull);
    stage.addEventListener('click', () => setPlaying(!playing));
    function toggleFull() {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    }
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') && e.key !== ' ') return;
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(t - 5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(t + 5); }
      else if (/^[1-9]$/.test(e.key)) seek(SCENES[+e.key - 1].start + 0.6);
      else if (e.key === 'f' || e.key === 'F') toggleFull();
    });
    let shownScene = -1;
    function frame(now) {
      if (playing) {
        if (last != null) t += Math.min(0.1, (now - last) / 1000) * speed;
        last = now; dirty = true;
        if (t >= DUR - 1e-3) { t = DUR - 1e-3; setPlaying(false); }
      }
      if (dirty) {
        renderAt(t); dirty = false;
        if (document.activeElement !== scrub) scrub.value = String(t);
        time.textContent = `${fmt(t)} / ${fmt(DUR)}`;
        const i = core.sceneIndexAt(t);
        if (i !== shownScene) {
          shownScene = i; sceneName.textContent = `${i + 1} · ${SCENES[i].name}`;
          segs.forEach((s, k) => s.classList.toggle('on', k === i));
          chapters.forEach((c, k) => c.classList.toggle('on', k === i));
        }
        scrub.style.setProperty('--p', `${(t / DUR) * 100}%`);
      }
      requestAnimationFrame(frame);
    }
    setPlaying(false);
    requestAnimationFrame(frame);
  }

  window.addEventListener('error', e => { window.__errors.push(String(e.message || e)); });
  boot().catch(err => {
    window.__errors.push(String(err && err.stack || err));
    console.error(err);
    const s = document.getElementById('status'); if (s) s.textContent = 'Could not start the 3D scene: ' + (err && err.message || err);
  });
})();
