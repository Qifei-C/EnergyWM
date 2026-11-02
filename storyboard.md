# Storyboard — Energy-Field Teachers for Small VLAs

自动生成：`node scripts/storyboard.js`（字幕从 core.js 直接解析，时间码为全片绝对时间）。
16:9 · 1920×1080 · 30 fps · 总长 9:52.0（592 s）· 14 章 · 场景切换 0.5 s 交叉淡化。

**主题**：已具备基本技能的小 VLA 在新的条件组合下，借助教师（几何 + 预测后果）先做对，把纠正学进去，再逐步不需要教师。
“第一次：预测与推理；之后：便宜、可迁移的技能。” 片中所有优势均为希望通过实验建立的假设，不是结果；屏幕上的数字都来自引用文献并标注出处。

**视觉**：深色“night lab”；台面是被照亮的舞台；字幕每次一行；列表为色条 + 文字（无胶囊气泡）；公式由 MathJax 排版。

## 01 · Title  `0:00.0 – 0:10.0` (10 s)

**3D 动作**

- 广角厨房镜头缓慢推移；机械臂轻微待机摆动；切片平面上淡入青色 T 等值线。

**画面文字（原文）**

- Energy-Field Teachers / for Small VLAs
- Help a small VLA get it right the first time — / then let it learn to do without the teacher.
- RESEARCH PLAN · CONCEPT / HYPOTHESIS · 2026-11-01

**字幕**：无

## 02 · Skills, not the combination  `0:10.0 – 1:06.0` (56 s)

**3D 动作**

- 0–16 s 无挡板的开放布局：从台面抓起香蕉（≈3 s）、抬起、低弧线搬运、放进碗（≈12 s）、松开。
- 16 s 起新组合：挡板升起（16.3–17.8 s）、19 s 出现半透明低顶隔板；香蕉重新握在一端附近。
- 30–33 s 沿熟悉的直线动作前进，33 s 撞上挡板（红色碰撞环）。之后静止。

**画面文字（原文）**

- 副标题：Skills it already has → A combination it has not seen
- 列表（蓝色竖条，3 / 4.5 / 7 / 10 / 12 s 出现）：grasp · lift · move sideways · slow down · place
- 列表（红色竖条，16.5 / 19 / 21.5 / 24 s）：bowl behind a barrier · low ceiling · grip near one end · no fast swing
- 37 s 卡片：WHAT IS MISSING — which skill to use, / how much of it, / and what it causes next.
- 46 s 卡片：SIMILAR DIAGNOSIS — Actions stay bound to training layouts. — VLS — Liu et al., arXiv 2602.03973
- 3D 标签：collision

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 0:10.0 | 0:18.0 | A small VLA that already knows the basics: grasp, lift, move, place. |
| 0:18.0 | 0:26.0 | In layouts like its training data, that is enough. |
| 0:26.0 | 0:33.0 | Now a new combination: a barrier, a low ceiling, a grip near one end. |
| 0:33.0 | 0:40.0 | Do not touch the barrier. Do not fling the banana by moving too fast. |
| 0:40.0 | 0:47.0 | Every motion is familiar. The combination is not — and it fails. |
| 0:47.0 | 0:56.0 | What is missing: which skill, how much, and what it causes next. |
| 0:56.0 | 1:06.0 | Our scope: re-using and adapting existing skills, not inventing new ones. |

## 03 · What today’s models cannot do  `1:06.0 – 2:22.0` (76 s)

**3D 动作**

- 0–50 s 左右分屏（同一机位）。左：单 VLA 3–6 s 直线前进，6 s 撞挡板。
- 右：世界模型规划器（示意）。CEM 第 1 轮 8–17 s：3 次迭代，每次 10 条“想象的未来”（紫色短轨迹 + 半透明幽灵香蕉），最后一次最佳候选变橙色；17–19 s 执行一步；第 2 轮 19–25 s；25–27 s 再走一步，停在挡板前。
- 50 s 起：深色背板上的对比表（3D 在背板后以 2 fps 更新）。

**画面文字（原文）**

- 标题：Two strong families today
- 左栏：Single VLA — π0.5 · GR00T N1.6
- 右栏：World action model — Cosmos-Policy · GE-Act · LingBot-VA · V-JEPA 2-AC planner
- 3D 标签：collision · imagining… · best score · stalls at the barrier
- 30 s VLA 卡：✓ one forward pass per chunk ✗ no look-ahead at consequences ✗ brittle outside its training data；63 ms — π0.5, one inference step；来源：Latency: Do WAMs Generalize Better than VLAs?, arXiv 2603.22078, Tab. 5
- 37 s WAM 卡：✓ predicts what happens next ✗ imagines before every action ✗ short-horizon scores miss detours；4.8–83× — slower than π0.5 per step；16 s — per action, V-JEPA 2-AC (CEM)；来源：arXiv 2603.22078, Tab. 5 · V-JEPA 2, arXiv 2506.09985, §4.2
- 44 s 数据卡：PRIOR WORK — 92% → 41% — success with a perfect predictor, as the goal moves from 5 to 20 steps away — The Planning Limits of Latent World Models — Alrasheed, Azam, Akhtar, arXiv 2609.39235
- 50 s 表头：Other tools already solve part of it；列：ALREADY GOOD AT / WHAT WE WANT TO ADD — TO BE TESTED
- 行 1：Motion planning (cuRobo, arXiv 2310.17274) | feasible motion for given geometry | + language, vision, learned consequences
- 行 2：MPC / model-based RL (TD-MPC2, arXiv 2310.16828) | optimizing on predicted outcomes | + the VLA’s skill prior; less re-solving
- 行 3：Fine-tuning the VLA (π0.5, arXiv 2504.16054) | writing data into the policy | + targeted corrections, faster adaptation
- 行 4：Inference-time guidance (OmniGuide 2603.10052 · DynaGuide) | better behaviour right now | + cheap, composable, kept after switch-off
- 行 5：Amortized guidance (AGF, arXiv 2609.34944) | a light net replaces the critic | + structure: objects, contacts, physics
- 72 s 横幅：Not new: an optimizer that guides a policy which then acts alone — Guided Policy Search (Levine & Koltun, ICML 2013).

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 1:06.0 | 1:13.0 | Two strong families today: single VLAs and world action models. |
| 1:13.0 | 1:20.0 | A VLA that never saw this barrier acts at once — straight into it. |
| 1:20.0 | 1:28.0 | A world model imagines futures, scores them, then takes one step. |
| 1:28.0 | 1:36.0 | Its short-horizon score cannot see that the detour pays off. |
| 1:36.0 | 1:43.0 | VLAs are fast, but they do not look ahead at consequences. |
| 1:43.0 | 1:50.0 | World models look ahead, but are much slower to act. |
| 1:50.0 | 1:56.0 | Distance-to-goal scoring breaks on far goals, even with perfect prediction. |
| 1:56.0 | 2:04.0 | Other tools already solve parts: planners, MPC, fine-tuning, guidance. |
| 2:04.0 | 2:12.0 | What we want to add: reuse the VLA’s skills, and keep the lesson. |
| 2:12.0 | 2:18.0 | Guidance that is cheap, composable — and survives being switched off. |
| 2:18.0 | 2:22.0 | Teacher-guided policy learning itself is not new. |

## 04 · The bet  `2:22.0 – 2:58.0` (36 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- First time: predict and reason.（0.5 s）
- After that: a cheap, transferable skill.（9 s）
- 链条（18.5 s 起依次）：Existing skills / the small VLA → Predictive correction / in a new situation → Fast adaptation / the lesson is learned → Acting alone / and accumulating
- 27 s：HYPOTHESIS · TO BE ESTABLISHED BY EXPERIMENT

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 2:22.0 | 2:31.0 | The first time a problem appears, prediction makes up for missing experience. |
| 2:31.0 | 2:40.0 | When it comes back: turn that expensive reasoning into a cheap skill. |
| 2:40.0 | 2:49.0 | Skills → corrected in a new situation → fast adaptation → acting alone. |
| 2:49.0 | 2:58.0 | These are advantages we hope to establish — not results we have. |

## 05 · Guidance by energy gradient  `2:58.0 – 3:48.0` (50 s)

**3D 动作**

- 动作块去噪循环，每 12 s 一次（τ 在 8.5 s 内从 0 到 1）；τ ∈ [0.3, 0.8] 时出现橙色引导箭头，动作块被抬过挡板。
- 每次去噪结束后（8.6–11 s），机械臂执行这条动作块越过挡板到碗上方，11.3–12 s 回到起点开始下一次。

**画面文字（原文）**

- 副标题：The VLA’s own action chunk, being denoised
- τ 条：noise · guided · actions · τ = 0.00…
- 3D 标签：clean estimate · −λ∇E
- 14 s 起右侧流程（排版公式）：Velocity v_θ → Clean estimate Â → Kinematics K(Â) → Energy E(K(Â)) → Guided velocity v_θ − λ∇E（当前步骤高亮）

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 2:58.0 | 3:05.0 | How the teacher helps: it nudges the VLA’s own action chunk. |
| 3:05.0 | 3:12.0 | A flow-matching VLA denoises a chunk: π0.5 in 10 steps, GR00T N1.6 in 4. |
| 3:12.0 | 3:20.0 | Each guided step: clean estimate → kinematics → energy → gradient. |
| 3:20.0 | 3:28.0 | Guidance acts only in the middle window, τ from 0.3 to 0.8. |
| 3:28.0 | 3:35.0 | Gradients are normalized, step-limited and smoothed over the chunk. |
| 3:35.0 | 3:42.0 | No reference path and no ranking: an interface choice, not a claim. |
| 3:42.0 | 3:48.0 | Planners and best-of-N stay in the study as strong baselines. |

## 06 · The geometry part of the teacher  `3:48.0 – 4:28.0` (40 s)

**3D 动作**

- 机位转到正面。0.3–3 s 机械臂沿直线挪到停滞点，之后原地抖动、无法脱出；局部能量 E 切片淡入，3.5 / 5 / 8 s 依次出现 attract / repel / net 箭头。
- 20 s 切换为测地场 T：波前 20.8–26.5 s 从碗扩展，27 s 出现流向箭头，27.5 s 出现 −∇T。
- 29–34.5 s 机械臂沿 −∇T 的流线越过挡板，把香蕉放进碗。

**画面文字（原文）**

- 副标题：Local energy: attract to the bowl + repel from the barrier → Geodesic progress field T
- 3D 标签：attract · repel · net · −∇T
- 14–20 s 数据卡：PRIOR WORK — 62% — of hardware trials stalled — safe, but stuck — Least-restrictive safety filter (baseline) in LatentCBF, arXiv 2511.18606, Tab. 2
- 21 s 公式卡：S(x)‖∇T(x)‖ = 1 — T = 0 at the goal

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 3:48.0 | 3:55.0 | The geometry part of the teacher. A plain attract-and-repel field… |
| 3:55.0 | 4:02.0 | …cancels in front of the barrier: no upward push. It stalls. |
| 4:02.0 | 4:08.0 | Avoidance alone can be “safe, but stuck” — also on real hardware. |
| 4:08.0 | 4:15.0 | A geodesic progress field T measures the shortest way to the goal. |
| 4:15.0 | 4:22.0 | In front of the barrier, −∇T points up and over. |
| 4:22.0 | 4:28.0 | Geometry is one ingredient — not the goal of this project. |

## 07 · A direction, not a verdict  `4:28.0 – 5:08.0` (40 s)

**3D 动作**

- VLA 的直线动作块（蓝点）穿过挡板；8 s 蓝色“保持前进”箭头，10 s 挡板附近橙色向上箭头，12 s 末段向后的“减缓加速”箭头。
- 16–20 s 动作块弯成越障弧线；21–26.5 s 机械臂执行修正后的动作块。

**画面文字（原文）**

- 副标题：The VLA’s proposal, and what the teacher says about it
- 卡片：A VERDICT — ✗ this action is bad
- 7 s 卡片：A DIRECTION — keep the forward progress · add clearance over the barrier · ease the acceleration
- 14 s 公式：E(A + ΔA) ≈ E(A) + ∇E(A)ᵀ ΔA
- 21 s：Corrections on states the student visits — as in DAgger (Ross et al., 2011)
- 3D 标签：keep progress · more clearance · ease the acceleration · corrected chunk

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 4:28.0 | 4:35.0 | A verdict says only: this action is bad. |
| 4:35.0 | 4:42.0 | A gradient says how nearby actions would score better. |
| 4:42.0 | 4:49.0 | Keep the forward progress, add clearance, ease the acceleration. |
| 4:49.0 | 4:56.0 | Corrections land on the states the student actually visits. |
| 4:56.0 | 5:02.0 | This helps only if the gradient points to an executable improvement. |
| 5:02.0 | 5:08.0 | Test: same VLA, same budget vs. imitation, fine-tuning, policy optimization. |

## 08 · Same path, different physics  `5:08.0 – 5:42.0` (34 s)

**3D 动作**

- 左右分屏，同一条越障路径，12 s 循环：慢（9 s）稳稳放进碗；快（4.5 s）香蕉滞后、在顶点滑落到台面。

**画面文字（原文）**

- 标题：Same path, different speed
- 左右标题：Slow / Fast
- 3D 标签：slip
- 8 s：◐ geometry: same score（两侧）
- 15 s：✓ consequences: grip holds（慢）/ ✗ consequences: slip risk（快）

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 5:08.0 | 5:16.0 | Same path, different speed. Slow keeps the banana; fast lets it slip. |
| 5:16.0 | 5:23.0 | A geometry-only energy gives both the same score. |
| 5:23.0 | 5:30.0 | The teacher must tell them apart — the key criterion. |
| 5:30.0 | 5:36.0 | And it must beat a simple analytic grip-stability baseline. |
| 5:36.0 | 5:42.0 | Fixed-rate action sequences already encode speed; bare paths do not. |

## 09 · Change the task, not the weights  `5:42.0 – 6:38.0` (56 s)

**3D 动作**

- 0–8 s：正面 T 切片 + −∇T。
- 8–16 s 去掉挡板：挡板缩回，场重算为直拉；12.6–15 s 机械臂沿新流线直接移向碗，再收回。
- 16–24 s 封顶：镜头俯视顶视图切片；机械臂沿流线绕向侧面开口，再收回。
- 24–32 s 加高挡板：场要求更大净空；机械臂沿更高的流线越过，再收回。
- 32–44 s 新指令：蓝碗出现为新目标、杯子为禁止接触；场实时重算（33–37 s）；38.6–42.6 s 机械臂越过挡板、从杯子上方把香蕉送进蓝碗。

**画面文字（原文）**

- 副标题：Separate how the world changes from what we want this time
- 公式卡（排版）：E(A; g, c) = E_geo(A; c) + ℓ(F_θ(h, A); g, c)；F_θ what happens — reused；g, c what we want — swapped
- 列表（当前项高亮）：1 Barrier removed · 2 Top closed · 3 Taller barrier · 4 New goal, cup forbidden
- 3D 标签：−∇T · new goal · do not touch
- 44 s 卡片：WHEN IT FAILS, ASK WHERE — goal grounding · geometry · contact rules · consequence prediction
- 50 s：Baseline: equally informed vector guidance — AGF, arXiv 2609.34944

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 5:42.0 | 5:50.0 | Separate how the world changes from what we want this time. |
| 5:50.0 | 5:58.0 | Remove the barrier: the field follows. No weights change. |
| 5:58.0 | 6:06.0 | Close the top: −∇T turns toward the side opening. |
| 6:06.0 | 6:14.0 | Raise the barrier: more clearance. Same skills, same predictor. |
| 6:14.0 | 6:20.0 | New instruction: the blue bowl — and do not touch the cup. |
| 6:20.0 | 6:26.0 | Only the goal and the contact rules change; the field updates at once. |
| 6:26.0 | 6:32.0 | When it fails, we can ask where: goal, geometry, contact rules, prediction. |
| 6:32.0 | 6:38.0 | Structure must still beat an equally informed vector network. |

## 10 · From teacher to student  `6:38.0 – 7:22.0` (44 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- 标题：From teacher to student
- TEACHER · TRAINING TIME：Explicit geometry / SDF · T · contact rules；JEPA predictor / grip · slip · contact outcome；Teacher energy / scores the VLA’s own proposal
- 14 s：distill: value + gradient matching
- LIGHT ENERGY STUDENT：Scene encoder / once per chunk；Analytic energy / geometry — kept analytic；Consequence module / small, per action query
- 35 s：a means, not the end: next, the VLA itself must learn

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 6:38.0 | 6:45.0 | During training, the full teacher: geometry plus a JEPA predictor. |
| 6:45.0 | 6:52.0 | JEPA covers what geometry cannot see: grip, slip, contact outcome. |
| 6:52.0 | 6:59.0 | Distill with value and gradient matching; relabel on guided rollouts. |
| 6:59.0 | 7:06.0 | The light student encodes the scene once per chunk… |
| 7:06.0 | 7:13.0 | …keeps geometry analytic, and asks a small module about consequences. |
| 7:13.0 | 7:22.0 | This student is a means, not the end: next, the VLA itself must learn. |

## 11 · Guidance as an investment  `7:22.0 – 8:06.0` (44 s)

**3D 动作**

- 机械臂循环执行越障搬运（每 6.5 s：执行、停留、复位）。T 切片和 −∇T 箭头可见；香蕉周围橙色光环：状态 A 大（JEPA predictor），状态 B 缩小（light module）。
- 26–28 s 进入状态 C：切片、箭头、光环全部淡出，机械臂变为不透明，独立执行；标注 target behaviour — to be tested。

**画面文字（原文）**

- 副标题：Deployment states
- A — Full teacher — geometry + JEPA predictor
- B — Light energy student — cheaper — geometry still guides
- C — VLA alone — T off too · safety check only
- 3D 标签：JEPA predictor / light module · target behaviour — to be tested
- 38 s：TO MEASURE, OVER A DEPLOYMENT — ↓ teacher calls ↓ human interventions ↑ success

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 7:22.0 | 7:29.0 | Guidance should be an investment, not a permanent cost. |
| 7:29.0 | 7:36.0 | State A: the full teacher helps on new or uncertain cases. |
| 7:36.0 | 7:43.0 | State B: a light energy student replaces the full teacher. |
| 7:43.0 | 7:48.0 | Cheaper guidance — but geometry still guides. |
| 7:48.0 | 7:55.0 | State C: the VLA alone. The progress field T is off, too. |
| 7:55.0 | 8:00.0 | Only then has the guidance become the policy’s own skill. |
| 8:00.0 | 8:06.0 | To measure: teacher calls and interventions fall while success rises. |

## 12 · Four levels of success  `8:06.0 – 8:50.0` (44 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- 标题：Four levels of success
- LEVEL 1 — Helped on a new combination — with the teacher, first time
- LEVEL 2 — One teacher, unseen combinations — one set of parameters
- LEVEL 3 — VLA alone, from new starts — after a little guidance（20 s 标注 first paper’s endpoint）
- LEVEL 4 — Each next task needs less help — skills accumulate, none forgotten
- 34 s：LIMIT — The student must observe what decides the right action.

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 8:06.0 | 8:14.0 | Level 1: with the teacher, a new combination is handled correctly. |
| 8:14.0 | 8:22.0 | Level 2: one teacher guides combinations it was never trained on. |
| 8:22.0 | 8:32.0 | Level 3: after a little guidance, the VLA alone succeeds from new starts. |
| 8:32.0 | 8:40.0 | Level 4: each related task needs less teaching than the one before. |
| 8:40.0 | 8:50.0 | Limit: the student must be able to see what decides the right action. |

## 13 · What we do not claim  `8:50.0 – 9:22.0` (32 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- 标题：What we do not claim as contributions
- 每张卡标签：NOT A SELLING POINT
- No path output — an interface choice — planners stay as strong baselines
- No best-of-N — compared on success, cost and adaptation speed
- Using JEPA — V-JEPA 2-AC already plans; the question is how well it teaches
- The geometric field — if geometry alone suffices, we accept that result

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 8:50.0 | 8:58.0 | What we do not claim as contributions: |
| 8:58.0 | 9:06.0 | Skipping paths or best-of-N is a choice; both remain baselines. |
| 9:06.0 | 9:14.0 | Using JEPA is not new: the question is whether it teaches well. |
| 9:14.0 | 9:22.0 | If geometry alone solves the task, the experiment will say so. |

## 14 · The proposition  `9:22.0 – 9:52.0` (30 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- THE PROPOSITION — STATED SO THAT IT CAN FAIL
- For a small VLA with basic skills: can a structured predictive teacher make it adapt to unseen constraint combinations with fewer new demonstrations or interactions — and keep that ability once guidance is removed?
- 1 Useful on new combinations · 2 Cheaper adaptation · 3 Holds without the teacher
- 20 s：Not a smarter planner carried forever — a teacher the robot outgrows.
- 25 s 引用：Cited: arXiv 2603.22078 · 2506.09985 · 2609.39235 · 2511.18606 · 2602.03973 · 2603.10052 · 2609.34944 · 2310.17274 · 2310.16828 · 2504.16054 · Levine & Koltun 2013 · Ross et al. 2011
- 25 s 致谢：Schematic RoboCasa-style kitchen · Franka Panda meshes: MuJoCo Menagerie (Apache-2.0) · Banana: YCB Object and Model Set scan, object 011 (CC BY 4.0, re-oriented, texture resized)

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 9:22.0 | 9:32.0 | The proposition, stated so that it can fail. |
| 9:32.0 | 9:40.0 | One part: better inference. Two: faster adaptation. All three: the loop. |
| 9:40.0 | 9:47.0 | Not a smarter planner carried forever — a teacher the robot outgrows. |

## 素材与许可

- Franka Panda 网格与 MJCF：MuJoCo Menagerie（Apache-2.0）。
- 香蕉：YCB Object and Model Set 扫描模型，object 011（CC BY 4.0；已重新定向、贴图缩小）。
- 厨房：程序化 RoboCasa 风格示意场景（不含 RoboCasa 真实资产）。
- 公式排版：MathJax（Apache-2.0）；three.js（MIT）；Lora、Inter（SIL OFL 1.1）。
