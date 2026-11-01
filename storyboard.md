# Storyboard — "Energy-Field Teachers for Small VLAs"

Format: 16:9, 1920×1080, 30 fps, 9:52 (592 s), English captions. Research **plan** (concept / hypothesis, 2026-11-01):
nothing shown is a result; every number on screen is cited prior work with its source on screen.

**Thesis.** The advantage worth fighting for is not "better detours than classic methods". It is this: a small VLA that already has
basic skills meets a new combination of conditions; a teacher (explicit geometry + predicted consequences) helps it get it
right; the correction is learned; the teacher is gradually no longer needed. *First time: predict and reason. After that: a
cheap, transferable skill.* The predictive-teacher → structured-energy-student step is a means, not the end.

**Look ("night lab").** Dark set with image-based lighting and fog; the counter is the lit stage; field slices glow.
Overlay: no boxes behind captions, no capsule chips — lists are an accent bar + text; ✓/✗ marks for verdicts; glass cards
only for formulas, facts and diagrams. Formulas are typeset by MathJax (TeX → SVG, `scripts/build_math.js`), never drawn
with "_" or "^". One caption line at a time (≤ ~80 chars). Beat timings shared by both layers live in `core.util.TL`.

**Assets.** Franka Panda (MuJoCo Menagerie, Apache-2.0); banana = YCB Object and Model Set scan, object 011 (CC BY 4.0,
re-oriented, texture resized — `scripts/fetch_banana.sh`); kitchen is procedural, RoboCasa-style, schematic.

| # | Time | Chapter | On screen |
|---|---|---|---|
| 01 | 0:00 | Title | title, one-line promise, status line over a wide kitchen shot with faint T contours |
| 02 | 0:10 | Skills, not the combination | open layout: grasp · lift · move · place; then barrier + low ceiling + grip near one end + "no fast swing" → the familiar straight move collides; "what is missing: which skill, how much, what it causes next"; VLS (arXiv 2602.03973) |
| 03 | 1:06 | What today's models cannot do | split screen: single VLA acts at once into the barrier ∣ world-model planner imagines futures (ghost bananas), scores by distance to goal, stalls; cited facts: π0.5 63 ms, WAMs 4.8–83× slower (arXiv 2603.22078 Tab. 5), V-JEPA 2-AC 16 s/action (arXiv 2506.09985), 92% → 41% (arXiv 2609.39235); then five tool families (planning, MPC/MBRL, fine-tuning, inference-time guidance, amortized guidance): good at / what we want to add; Guided Policy Search lineage |
| 04 | 2:22 | The bet | "First time: predict and reason. After that: a cheap, transferable skill." chain: skills → predictive correction → fast adaptation → acting alone; marked hypothesis |
| 05 | 2:58 | Guidance by energy gradient | the VLA's own chunk denoising; τ window; pipeline vθ → Â → K(Â) → E(K(Â)) → vθ − λ∇E; no path / no ranking = interface choice; planners and best-of-N are baselines |
| 06 | 3:48 | The geometry part of the teacher | local attract+repel field cancels (62% stall, least-restrictive filter baseline, arXiv 2511.18606); geodesic field T, −∇T up and over; "one ingredient, not the goal" |
| 07 | 4:28 | A direction, not a verdict | verdict vs. direction (keep progress · add clearance · ease acceleration); first-order expansion; DAgger; equal-budget test |
| 08 | 5:08 | Same path, different physics | split slow ∣ fast; geometry gives the same score; the teacher must tell them apart and beat an analytic grip-stability baseline |
| 09 | 5:42 | Change the task, not the weights | E(A; g, c) = E_geo(A; c) + ℓ(F_θ(h, A); g, c); barrier removed / top closed / taller / new goal (blue bowl) with a forbidden cup — field recomputed live; "where did it fail?"; AGF-style baseline |
| 10 | 6:38 | From teacher to student | teacher (geometry, JEPA predictor, teacher energy) → distill → light student (scene encoder, analytic energy, consequence module); "a means, not the end" |
| 11 | 7:22 | Guidance as an investment | states A (full teacher) → B (light student, geometry still guides) → C (VLA alone, T off); to measure: teacher calls ↓ interventions ↓ success ↑ |
| 12 | 8:06 | Four levels of success | new combination with help → one teacher, unseen combinations → VLA alone from new starts (first paper's endpoint) → each next task needs less help; information limit |
| 13 | 8:50 | What we do not claim | no path output · no best-of-N · using JEPA · the geometric field |
| 14 | 9:22 | The proposition | the falsifiable proposition, its three parts, closing line, status, sources and credits |
