# Storyboard — "Energy-Field Teachers for Small VLAs"

Format: 16:9, 1920×1080, 30 fps, 7:04 (424 s). Academic-report look (paper background, ink type, Lora + Inter), English captions. Content is a research plan (Concept / Hypothesis, 2026-11-01); every number shown is labelled as prior work or as a hypothesis, never as a result.

Text budget (user request: less text per frame, a longer film is fine)
- One caption line at a time (≤ ~80 characters, 34 px), each held 5–10 s.
- On screen only titles, formulas and short labels; no paragraphs or bullet prose. Dense scenes are split into beats that show one idea at a time.
- Beat timings shared by the 3D layer and the overlay live in `core.util.TL`.

Visual grammar
- Eyebrow top-left "0k · scene name", caption band at the bottom, thin progress line at the bottom edge.
- Colours: VLA / flow = blue, teacher & energy gradient = orange, geodesic field T = teal, collision = red, success = green, banana = yellow, barrier = slate.
- 0.5 s crossfades between scenes (3D and overlay both).

| # | Time | Scene | Beats (what is on screen) | Captions (one line each) |
|---|---|---|---|---|
| 1 | 0:00–0:10 | Title | title, one-line subtitle, status line over a wide kitchen shot | — |
| 2 | 0:10–0:52 | Task & two rules | straight move → collision · waypoint arc crossed out ("no waypoints") · candidate fan crossed out ("no sample-and-rank") · gradient arrow −∇E | task · naive VLA collides · rule 1 · rule 2 · best-of-N only as baseline · what remains |
| 3 | 0:52–1:48 | Guidance | chunk denoising in 3D + τ bar (noise / guided / actions); from 0:14 a five-box pipeline (velocity → Â → K(Â) → E → v − λ∇E) | flow denoising · step counts · guided step · window 0.3–0.8 · normalize/limit/smooth · MPGD default · both students · equal-compute best-of-N |
| 4 | 1:48–2:32 | Why local attraction fails | E slice; attract / repel / net arrows; inset "Energy vs. height"; prior-work cards one at a time (92% → 41%; 62%) | first try · forces cancel · no upward part · energy only rises · prior work on detours · safe but stuck |
| 5 | 2:32–3:50 | Geodesic field T | T wavefront + S|∇T| = 1 card, −∇T up and over · three interventions (8 s each) with a 3-item list · three caveat cards · five stage chips | definition · inflated obstacles · no false minima · removed / top closed / taller · value field not path · progress term · still to test · stages = contact permissions · detour lives in T |
| 6 | 3:50–4:46 | Teacher → student | teacher row (E_T, geometry, JEPA) · distill arrow · student row (encoder, analytic energy, R_ψ) · E_S = E_analytic + R_ψ | training only · geometry handles detour · JEPA adds grip/slip/contact · prove it on physics · distillation · encode once · geometry kept · R_ψ = 0 baseline |
| 7 | 4:46–5:20 | Same path, different speed | split screen slow / fast, banana slips at the apex; two chips per side | same path · geometry same score · must tell apart · beat analytic baseline · input definition |
| 8 | 5:20–6:20 | Experiments | A / B / C cards with three short items each · E0 checklist (four "to run" boxes) | fail early · A · B · fair baseline · C · E0 · two caption lines on the tests |
| 9 | 6:20–7:04 | Retirement | three level toggles · illustrative chart (labelled hypothesis) · end card | distill · retire stepwise · level 2 not autonomy · hypothesis · to be tested |
