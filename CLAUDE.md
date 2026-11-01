# EnergyWM — motion-graphics explainer of the energy-field-teacher research plan

Purpose: a ~7:04, 1920×1080, 30 fps explainer (English captions, academic look) of the plan
"geodesic progress field + predictive consequence module → gradient-guide small VLAs (π0.5, GR00T) → distill → retire the teacher".
It is a research *plan* (Concept / Hypothesis, 2026-11-01): never present any number in the film as a result.

## Architecture (two layers, one timeline)
- `core.js` — shared engine. Design tokens, text/shape helpers, eikonal fast-sweeping solver (`makeField`), marching squares, scene list `SCENES` with absolute `start`/`dur`, 2D overlay drawing (captions, eyebrow, cards, charts). Everything is a pure function of time `t` in a 1920×1080 coordinate space.
- `scene3d.js` — three.js r128 (global `THREE`, UMD) world: procedural RoboCasa-style kitchen, Franka Panda from `assets/panda.glb` + `assets/panda_kin.json` (minimal GLB parser, MJCF kinematics, damped-least-squares IK precomputed per trajectory), task objects, field slice planes (CanvasTexture painted by core's field code), arrows/tubes, per-scene camera, split-screen render for the fast/slow scene.
- `app.js` (to write) — glue: loads assets, drives both layers, player UI, and `window.__render(t)` + `window.__ready` for headless frame capture.
- Build: `index.html` (published artifact; three.js from cdnjs, fonts from Google Fonts) and `render.html` (local deps from `node_modules` and `fonts/`) generated from one template.

## Conventions
- World is **Z-up**, metres. Counter top z = 0.92. Field coordinates: `fx = x_world − X_OFF` (X_OFF = −0.25), `fz = z_world − 0.92`; object plane y = 0.22.
- Determinism: no `Date.now()`/`Math.random()` in frame code; use `core.util.rng(seed)`. IK is precomputed once at init.
- Keep a scene's drawing inside its own function; crossfades (0.5 s) are composited by the engine.
- Captions: `[start, end, text]` lists per scene, ONE short line each (≤ ~80 chars), English, no claims of results. Keep on-screen text to titles, formulas and short labels; split dense ideas into beats (`core.util.TL`) rather than adding text.
- Fonts: Lora (display, formulas in italic) + Inter (body/labels); font stacks include DejaVu fallbacks for ∇ ∈ ‖.

## Rendering the MP4
Headless Chrome (`/usr/bin/google-chrome`, SwiftShader WebGL) through Python Playwright: serve the repo (`python3 -m http.server 8787`), open `render.html`, step `window.__render(t)` at 30 fps, screenshot JPEG q92 → ffmpeg, one file per scene, then concat with `-c copy`. Write temp names and rename on success.

## Assets & licenses
Panda meshes/MJCF: mujoco_menagerie (Apache-2.0); regenerate with `scripts/fetch_panda.sh`. Fonts: SIL OFL. three.js: MIT. The kitchen is procedural; real RoboCasa assets are not included.
