# Storyboard — Energy-Field Teachers for Small VLAs

自动生成：`node scripts/storyboard.js`（字幕从 core.js 直接解析，时间码为全片绝对时间）。
16:9 · 1920×1080 · 30 fps · 总长 11:26.0（686 s）· 16 章 · 场景切换 0.5 s 交叉淡化。

**主题**：已具备基本技能的小 VLA 在新的条件组合下，借助教师（几何 + 预测后果）先做对，把纠正学进去，再逐步不需要教师。
“第一次：预测与推理；之后：便宜、可迁移的技能。” 片中所有优势均为希望通过实验建立的假设，不是结果；屏幕上的数字都来自引用文献并标注出处。

**视觉**：深色“night lab”；台面是被照亮的舞台；字幕每次一行；列表为色条 + 文字（无胶囊气泡）；公式由 MathJax 排版。

## 01 · Title  `0:00.0 – 0:10.0` (10 s)

**3D 动作**

- 广角厨房镜头缓慢推移；机械臂轻微待机摆动；切片平面上淡入青色 T 等值线。

**画面文字（原文）**

- Energy-Field Teachers / for Small VLAs
- Help a small VLA get it right the first time — / then let it learn to do without the teacher.

**字幕**：无

## 02 · Skills, not the combination  `0:10.0 – 1:08.0` (58 s)

**3D 动作**

- 0–16 s 无挡板的开放布局：从台面抓起香蕉、抬起、低弧线搬运、放进碗、松开。
- 16 s 起新组合：挡板升起（16.3–17.8 s）、19 s 出现半透明低顶隔板；香蕉重新握在一端附近。
- 30–33 s 沿熟悉的直线动作前进，33 s 撞上挡板（红色碰撞环）。
- 52–54.5 s 低顶隔板上移并淡出：此后的机制章节只保留挡板（布局连续性）。

**画面文字（原文）**

- 副标题：Skills it already has → A combination it has not seen
- 列表（蓝色竖条）：grasp · lift · move sideways · slow down · place
- 列表（红色竖条）：bowl behind a barrier · low ceiling · grip near one end · no fast swing
- 37 s 卡片：WHAT IS MISSING — which skill to use, / how much of it, / and what it causes next.
- 46 s 卡片：SIMILAR DIAGNOSIS — Actions stay bound to training layouts. — VLS — Liu et al., arXiv 2602.03973
- 3D 标签：collision · ceiling removed from here on

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 0:10.0 | 0:18.0 | A small VLA that already knows the basics: grasp, lift, move, place. |
| 0:18.0 | 0:26.0 | In layouts like its training data, that is enough. |
| 0:26.0 | 0:33.0 | Now a new combination: a barrier, a low ceiling, a grip near one end. |
| 0:33.0 | 0:40.0 | Do not touch the barrier. Do not fling the banana by moving too fast. |
| 0:40.0 | 0:47.0 | Every motion is familiar. The combination is not — and it fails. |
| 0:47.0 | 0:56.0 | What is missing: which skill, how much, and what it causes next. |
| 0:56.0 | 1:02.0 | Our scope: re-using and adapting existing skills, not inventing new ones. |
| 1:02.0 | 1:08.0 | From here on: barrier only — the ceiling is removed to show the mechanism. |

## 03 · Where extra reasoning helps — and what it costs  `1:08.0 – 2:04.0` (56 s)

**3D 动作**

- 0–44 s 左右分屏（同一机位，标注为示意失败）。左：直接策略 3–6 s 直线前进撞挡板。
- 右：基于采样的世界模型规划器（示意，V-JEPA 2-AC 式 CEM）：两轮“想象—评分—走一步”（紫色短轨迹 + 幽灵香蕉，最佳候选橙色），停在挡板前。
- 44 s 起：深色背板上的问题卡。

**画面文字（原文）**

- 标题：Where extra reasoning helps — and what it costs；右上：ILLUSTRATIVE FAILURE · COMBINED CHANGES
- 左栏：Direct-policy baseline — e.g. π0.5 · GR00T N1.6 — direct action-chunk generation, no external rollout search
- 右栏：A sampling-based world-model planner — e.g. V-JEPA 2-AC with CEM — not every world action model works this way
- 3D 标签：collision · imagining… · best score · stalls at the barrier
- 28 s 左卡：63 ms — per 50-action chunk, π0.5 (reported)；✓ direct action-chunk generation ✗ no separate action–outcome evaluation loop；来源 arXiv 2603.22078, Tab. 5
- 28 s 右卡：16 s / action — 800 samples · 10 iterations · horizon 1 · one RTX 4090；✓ evaluates imagined outcomes ✗ pays for search at every step；来源 V-JEPA 2, arXiv 2506.09985, Tab. 3
- 36 s 数据卡：92% → 41% — success with a perfect predictor and a fixed 5-step rollout, as the goal moves from 5 to 20 steps away — arXiv 2609.39235
- 44 s：THE QUESTION — When a new constraint needs extra computation, can that computation become help we no longer need next time?
- 45 s：World action models differ: Cosmos Policy also generates actions directly (arXiv 2601.16163); Fast-WAM skips test-time imagination (arXiv 2603.16666).

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 1:08.0 | 1:15.0 | Two ways to act: a direct policy, and a sampling-based world-model planner. |
| 1:15.0 | 1:22.0 | Illustrative failure: the direct policy repeats its habit into the barrier. |
| 1:22.0 | 1:29.0 | The planner imagines outcomes, scores them, and takes one step. |
| 1:29.0 | 1:36.0 | A short rollout scored by endpoint distance can miss the benefit of a detour. |
| 1:36.0 | 1:44.0 | One side has no separate outcome evaluation; the other pays for search. |
| 1:44.0 | 1:52.0 | Even a perfect predictor does not fix a short-sighted score. |
| 1:52.0 | 1:58.0 | World action models differ — some act directly, without test-time imagination. |
| 1:58.0 | 2:04.0 | The question: can extra reasoning become help we do not need next time? |

## 04 · The bet  `2:04.0 – 2:40.0` (36 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- First time: predict and reason. / After that: a cheap, transferable skill.
- 链条：Existing skills / the small VLA → Predictive correction / in a new situation → Fast adaptation / the VLA is updated → Acting alone / and accumulating
- 27 s：HYPOTHESIS · TO BE ESTABLISHED BY EXPERIMENT

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 2:04.0 | 2:13.0 | The first time a problem appears, prediction makes up for missing experience. |
| 2:13.0 | 2:22.0 | When it comes back: turn that expensive reasoning into a cheap skill. |
| 2:22.0 | 2:31.0 | Skills → corrected in a new situation → the VLA is updated → acting alone. |
| 2:31.0 | 2:40.0 | These are advantages we hope to establish — not results we have. |

## 05 · Guidance: geometry and consequences  `2:40.0 – 3:40.0` (60 s)

**3D 动作**

- 动作块去噪循环（12 s 一次，τ 在 8.5 s 内 0→1）。蓝色细线 = VLA 自己的原提案（不变）；去噪中的动作块在引导窗口内由蓝变橙（= 修正后的动作块），引导箭头标为 guidance update。
- 每次去噪结束后机械臂执行橙色动作块越过挡板，随后复位。

**画面文字（原文）**

- 副标题：The VLA’s own action chunk, being denoised；图例：VLA proposal（蓝）· corrected chunk — executed（橙）
- τ 条：noise · guided window (proposed config) · actions · τ = …
- 3D 标签：VLA proposal · guidance update · corrected chunk
- 20 s 起右侧双分支图（排版公式）：Â（clean estimate）→ K → Geometry（from sensors or simulation）: E_geometry(K(Â))；→ F_θ(h,·) → Consequences（trained action-conditioned model）: ℓ(F_θ(h, Â); g, c)；g, c — goal and constraints decide the score
- 汇总：E(Â) = E_geometry(K(Â)) + ℓ(F_θ(h, Â); g, c) → 更新：v_θ − λ𝒫(∇E)；𝒫 normalize · clip · smooth (proposed) — not the raw gradient
- 高亮顺序：27 s 几何 · 34 s 后果 · 41 s 汇总 · 48 s 更新

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 2:40.0 | 2:47.0 | How the teacher helps: it corrects the VLA’s own action chunk. |
| 2:47.0 | 2:54.0 | Blue: what the VLA proposes. Orange: the corrected chunk the robot executes. |
| 2:54.0 | 3:00.0 | π0.5 denoises in 10 steps, GR00T N1.6 in 4; guidance acts mid-way (proposed). |
| 3:00.0 | 3:07.0 | From the clean estimate, two branches: geometry and predicted consequences. |
| 3:07.0 | 3:14.0 | Geometry comes from sensors or simulation, through the arm’s kinematics. |
| 3:14.0 | 3:21.0 | Consequences come from a trained action-conditioned model, read out as costs. |
| 3:21.0 | 3:28.0 | The goal and constraints decide how the predicted outcome is scored. |
| 3:28.0 | 3:34.0 | A processed gradient updates the velocity: normalized, clipped, smoothed. |
| 3:34.0 | 3:40.0 | Planners and best-of-N stay in the study as strong baselines. |

## 06 · The geometry part of the teacher  `3:40.0 – 4:16.0` (36 s)

**3D 动作**

- 机械臂沿直线挪到停滞点后原地抖动；局部能量 E 切片 + attract / repel / net 箭头。
- 14 s 切换为数值计算的测地进度场 T（波前 14.8–20.5 s，−∇T 21.5 s）。23 s 蓝色 VLA 原提案（直线穿过挡板）；25 s 橙色修正动作块（形状取自 −∇T 流线并保证香蕉全长净空）。
- 27–32 s 机械臂执行橙色修正动作块，标注 intended guided behaviour — to be verified。

**画面文字（原文）**

- 副标题：Local energy: attract to the bowl + repel from the barrier → Geometric progress field T — computed numerically；图例：VLA proposal · corrected chunk — executed
- 3D 标签：attract · repel · net · −∇T · VLA proposal · corrected chunk · intended guided behaviour — to be verified
- 15 s 公式卡：S(x)‖∇T(x)‖ = 1 — T = 0 at the goal（62% 卡片已移至附录）

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 3:40.0 | 3:47.0 | The geometry part of the teacher. A plain attract-and-repel field… |
| 3:47.0 | 3:54.0 | …cancels in front of the barrier: no upward push. It stalls. |
| 3:54.0 | 4:01.0 | A geometric progress field T, computed numerically, measures the way to the goal. |
| 4:01.0 | 4:08.0 | The field evaluates progress; the VLA still proposes the motion. |
| 4:08.0 | 4:16.0 | The correction lifts the chunk over the barrier — to be verified in execution. |

## 07 · A direction, not a verdict  `4:16.0 – 4:56.0` (40 s)

**3D 动作**

- VLA 的直线动作块（蓝）穿过挡板；8 / 10 / 12 s 依次出现保持前进、增加净空、减缓加速的箭头。
- 16–20 s 动作块弯成越障弧线并由蓝变橙，原提案保留为蓝色细线；21–26.5 s 机械臂执行修正后的动作块。

**画面文字（原文）**

- 副标题：The VLA’s proposal, and what the teacher says about it；16 s 图例
- 卡片：A VERDICT — ✗ this action is bad
- 卡片：A DIRECTION — keep the forward progress · add clearance over the barrier · ease the acceleration
- 14 s 公式：E(A + ΔA) ≈ E(A) + ∇E(A)ᵀ ΔA
- 21 s：Corrections on states the student visits — as in DAgger (Ross et al., 2011)
- 3D 标签：keep progress · more clearance · ease the acceleration · corrected chunk

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 4:16.0 | 4:23.0 | A verdict says only: this action is bad. |
| 4:23.0 | 4:30.0 | A gradient says how nearby actions would score better. |
| 4:30.0 | 4:37.0 | Keep the forward progress, add clearance, ease the acceleration. |
| 4:37.0 | 4:44.0 | Corrections land on the states the student actually visits. |
| 4:44.0 | 4:50.0 | This helps only if the gradient points to an executable improvement. |
| 4:50.0 | 4:56.0 | Test: same VLA, same budget vs. imitation, fine-tuning, policy optimization. |

## 08 · Same path, different physics  `4:56.0 – 5:30.0` (34 s)

**3D 动作**

- 左右分屏，同一条越障路径，12 s 循环：慢（9 s）稳稳放进碗；快（4.5 s）香蕉滞后、在顶点滑落到台面（选定抓持条件下的示意后果）。

**画面文字（原文）**

- 标题：Same path, different speed；右侧：ILLUSTRATIVE CONSEQUENCES UNDER ONE CHOSEN GRIP
- Slow — duration 2× · lower peak acceleration；Fast — duration 1× · higher peak acceleration
- 3D 标签：slip
- 8 s：◐ untimed geometric path: indistinguishable（两侧）
- 15 s：✓ trained readout: grip holds（慢）/ ✗ trained readout: slip risk（快）

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 4:56.0 | 5:04.0 | Same path, different timing — illustrative consequences under one chosen grip. |
| 5:04.0 | 5:11.0 | As an untimed geometric path, the two are indistinguishable. |
| 5:11.0 | 5:18.0 | Trained outcome readouts must tell them apart — the key criterion. |
| 5:18.0 | 5:24.0 | And it must beat a simple analytic grip-stability baseline. |
| 5:24.0 | 5:30.0 | Fixed-rate action sequences already encode speed; bare paths do not. |

## 09 · Change the task, not the weights  `5:30.0 – 6:26.0` (56 s)

**3D 动作**

- 0–8 s：正面 T 切片 + −∇T。
- 每种布局（8 s）：场重算 → 同一个蓝色 VLA 原提案 → 不同的橙色修正动作块 → 机械臂执行修正动作块再收回。
- 8–16 s 去掉挡板（直拉，无多余抬高）；16–24 s 封顶，俯视顶视图，标出 side opening，修正绕向侧面开口；24–32 s 加高挡板（更大净空）。
- 32–44 s 新目标蓝碗 + 杯子禁止接触：场实时重算，修正越过挡板、从杯子上方送进蓝碗。

**画面文字（原文）**

- 副标题：Separate how the world changes from what we want this time；图例：VLA proposal · corrected chunk — executed
- 公式卡（排版）：E(A; g, c) = E_geo(A; c) + ℓ(F_θ(h, A); g, c)；F_θ what happens — reused；g, c what we want — swapped
- 列表：1 Barrier removed · 2 Top closed · 3 Taller barrier · 4 New goal, cup forbidden
- 3D 标签：−∇T · VLA proposal · corrected chunk · side opening · new goal · do not touch
- 44 s：WHEN IT FAILS, ASK WHERE — goal grounding · geometry · contact rules · consequence prediction
- 50 s：Baseline: equally informed vector guidance — AGF, arXiv 2609.34944

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 5:30.0 | 5:38.0 | Separate how the world changes from what we want this time. |
| 5:38.0 | 5:46.0 | Remove the barrier: the field follows. No weights change. |
| 5:46.0 | 5:54.0 | Close the top: −∇T turns toward the side opening. |
| 5:54.0 | 6:02.0 | Raise the barrier: more clearance. Same skills, same predictor. |
| 6:02.0 | 6:08.0 | New instruction: the blue bowl — and do not touch the cup. |
| 6:08.0 | 6:14.0 | Only the goal and the contact rules change; the field updates at once. |
| 6:14.0 | 6:20.0 | When it fails, we can ask where: goal, geometry, contact rules, prediction. |
| 6:20.0 | 6:26.0 | Structure must still beat an equally informed vector network. |

## 10 · Teacher → energy student  `6:26.0 – 7:08.0` (42 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- 标题：Teacher → energy student
- FULL TEACHER · OFFLINE SUPERVISION + SELECTIVE ADAPTATION-TIME USE：Explicit geometry / SDF · numerical T · contact rules；Action-conditioned JEPA / → trained readouts: grip · slip · contact；Teacher energy / scores the VLA’s own proposal
- 21 s：distill: values + gradients
- ENERGY STUDENT · LEARNS TO EVALUATE CHEAPLY：Scene encoder / once per chunk；Geometry energy / SDF + numerical T, from sensors；Consequence module / small, per action query
- 35 s：Evaluation is cheaper — the VLA itself has not changed yet.

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 6:26.0 | 6:33.0 | The full teacher: explicit geometry plus an action-conditioned JEPA. |
| 6:33.0 | 6:40.0 | JEPA predicts future representations; trained readouts turn them into costs. |
| 6:40.0 | 6:47.0 | It supervises offline, and may step in again during allowed adaptation. |
| 6:47.0 | 6:54.0 | Its judgement is distilled into a light energy student: values and gradients. |
| 6:54.0 | 7:01.0 | The student encodes the scene once and queries consequences cheaply. |
| 7:01.0 | 7:08.0 | This makes evaluation cheaper. The VLA itself has not changed yet. |

## 11 · Policy student: learning to need it less  `7:08.0 – 8:20.0` (72 s)

**3D 动作**

- 0–30 s 纯图示：两个学生 + 学习闭环 + 参数更新公式。
- 30–58 s 高潮：左右分屏，教师关闭。左 = 适应前的 VLA，右 = 适应后的 VLA，同一个未参与适应的初始条件。条件 1（30–44 s）：挡板加高到 0.30 m；左边直线撞挡板，右边越过更高的弧线放进碗。条件 2（44–58 s）：抓在香蕉一端附近；左撞、右越过。
- 58–72 s 纯文字关键句。

**画面文字（原文）**

- Two students：Energy student — learns to evaluate cheaply；Policy student — the VLA — learns to act without the evaluator
- 闭环（14 / 15 / 16 / 21 / 28 s）：1 VLA proposal — the current policy → 2 Teacher correction — guided by the energy → 3 Execute & observe — keep only verified corrections → 4 Update the VLA — native objective + old-skill replay → 5 Test, guidance off — held-out starts · no T（虚线返回：next round）
- 21.5 s：PROPOSED — TRAINING ALGORITHM NOT FIXED；公式 π_φk → π_φk+1；data: execution-verified corrections + replay of old skills
- 30 s 分屏：Teacher off: before vs. after adaptation；Before adaptation — teacher off · held-out start；After adaptation — teacher off · the same held-out start；RIGHT: TARGET BEHAVIOUR — A HYPOTHESIS, NOT A RESULT
- 条件标签：Held-out condition 1 · a higher barrier → Held-out condition 2 · grip near one end；3D 标签：collision
- 58 s：Making the correction cheaper is not enough. / The policy must learn to need it less.

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 7:08.0 | 7:15.0 | Two kinds of learning. The energy student learns to evaluate cheaply. |
| 7:15.0 | 7:22.0 | The policy student — the VLA itself — must learn to act without it. |
| 7:22.0 | 7:29.0 | Execute the corrected chunk and observe the outcome; keep only what works. |
| 7:29.0 | 7:36.0 | Update the VLA with its own objective, replaying old skills — proposed. |
| 7:36.0 | 7:44.0 | Then test with all guidance off, from starts never used in adaptation. |
| 7:44.0 | 7:52.0 | Left: before adaptation. Right: after. Same held-out start, no teacher. |
| 7:52.0 | 8:00.0 | A second held-out condition: the grip is near one end of the banana. |
| 8:00.0 | 8:06.0 | Target behaviour — a hypothesis to test, not a result. |
| 8:06.0 | 8:13.0 | Making the correction cheaper is not enough. |
| 8:13.0 | 8:20.0 | The policy must learn to need it less. |

## 12 · Deployment states  `8:20.0 – 8:54.0` (34 s)

**3D 动作**

- 机械臂循环执行越障搬运；T 切片与 −∇T 可见；状态 A 香蕉周围大光环（JEPA predictor），B 缩小（light module）。
- 22–24 s 进入状态 C：切片、箭头、光环淡出，机械臂不透明独立执行，标注 target behaviour — to be tested。

**画面文字（原文）**

- 副标题：Deployment states
- A — Full teacher — only for new or uncertain cases
- B — Energy student — cheaper — geometry still guides
- C — Updated VLA alone — T off too · safety check only
- 28 s：TO MEASURE, OVER A DEPLOYMENT — ↓ teacher calls ↓ human interventions ↑ success

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 8:20.0 | 8:28.0 | Deployment states, from most help to none. |
| 8:28.0 | 8:35.0 | A: the full teacher, called only for new or uncertain cases. |
| 8:35.0 | 8:42.0 | B: the energy student — cheaper, but geometry still guides. |
| 8:42.0 | 8:48.0 | C: the updated VLA alone. T is off, too; only a safety check remains. |
| 8:48.0 | 8:54.0 | To measure: teacher calls and interventions fall while success rises. |

## 13 · Four levels — and the Level 3 test  `8:54.0 – 9:50.0` (56 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- 0–30 s 阶梯：LEVEL 1 Helped on a new combination；LEVEL 2 One teacher, unseen combinations；LEVEL 3 VLA alone, from new starts（first paper’s endpoint）；LEVEL 4 Each next task needs less help
- 30 s：Level 3, as a test — 表头 METHOD · ADAPTATION BUDGET · AT TEST · STARTS · SUCCESS
- 行：Direct fine-tuning / Imitate the corrected actions / Proposed update (verified corrections · gradient-informed)；每行：equal · all guidance off · held-out · to be measured（不画曲线）
- 52 s：LIMIT — The student must observe what decides the right action.

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 8:54.0 | 9:02.0 | Level 1: with the teacher, a new combination is handled correctly. |
| 9:02.0 | 9:08.0 | Level 2: one teacher guides combinations it was never trained on. |
| 9:08.0 | 9:16.0 | Level 3: after a little guidance, the VLA alone succeeds from new starts. |
| 9:16.0 | 9:24.0 | Level 4: each related task needs less teaching than the one before. |
| 9:24.0 | 9:32.0 | Level 3 as a test: the same adaptation budget for every method. |
| 9:32.0 | 9:40.0 | Direct fine-tuning, imitating corrected actions, and the proposed update. |
| 9:40.0 | 9:46.0 | All guidance off, held-out starts. Success is to be measured — no curves yet. |
| 9:46.0 | 9:50.0 | Limit: the student must be able to see what decides the right action. |

## 14 · What we do not claim  `9:50.0 – 10:10.0` (20 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- 标题：What we do not claim as contributions（每卡标签 NOT A SELLING POINT）
- No path output — an interface choice — planners stay as baselines；No best-of-N — compared on success, cost and adaptation speed；Using JEPA — the question is how well it teaches；The geometric field — if geometry alone suffices, we accept that

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 9:50.0 | 10:00.0 | Not claimed as contributions: skipping paths or best-of-N, or using JEPA. |
| 10:00.0 | 10:10.0 | And if geometry alone solves the task, the experiment will say so. |

## 15 · The proposition  `10:10.0 – 10:40.0` (30 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- THE PROPOSITION — STATED SO THAT IT CAN FAIL
- For a small VLA with basic skills: can a structured predictive teacher make it adapt to unseen constraint combinations with fewer new demonstrations or interactions — and keep that ability once guidance is removed?
- 1 Useful on new combinations · 2 Cheaper adaptation · 3 Holds without the teacher
- 20 s：Not a smarter planner carried forever — a teacher the robot outgrows.
- 25 s：引用列表与素材致谢

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 10:10.0 | 10:20.0 | The proposition, stated so that it can fail. |
| 10:20.0 | 10:28.0 | One part: better inference. Two: faster adaptation. All three: the loop. |
| 10:28.0 | 10:35.0 | Not a smarter planner carried forever — a teacher the robot outgrows. |

## 16 · Appendix: related work and prior numbers  `10:40.0 – 11:26.0` (46 s)

**3D 动作**

- 纯图示（3D 在背板后）。

**画面文字（原文）**

- 0–24 s 五类方法对比表（ALREADY GOOD AT / WHAT WE WANT TO ADD — TO BE TESTED）：Motion planning (cuRobo) · MPC / model-based RL (TD-MPC2) · Fine-tuning the VLA (π0.5) · Inference-time guidance (OmniGuide · DynaGuide) · Amortized guidance (AGF)
- 16 s：Not new: an optimizer that guides a policy which then acts alone — Guided Policy Search (Levine & Koltun, ICML 2013).
- 24 s 四张文献数字卡（各自口径）：63 ms（π0.5 per 50-action chunk; WAMs 4.8–83× per inference, model/config dependent）· 16 s / action（800 samples, 10 iterations, horizon 1, RTX 4090）· 92% → 41%（perfect predictor, fixed 5-step rollout, 5 → 20 steps）· 62%（least-restrictive filter baseline, open-bag lifting: safe ≠ progress）
- Different tasks and protocols — not one comparison.

**字幕**

| 开始 | 结束 | 字幕 |
|---|---|---|
| 10:40.0 | 10:48.0 | Appendix: other tools already solve part of the problem. |
| 10:48.0 | 10:56.0 | Planners, MPC, fine-tuning and guidance — and what we want to add to each. |
| 10:56.0 | 11:04.0 | Teacher-guided policy learning itself is not new: Guided Policy Search. |
| 11:04.0 | 11:14.0 | Prior numbers, each from its own task and protocol — not one comparison. |
| 11:14.0 | 11:26.0 | They motivate the questions; none of them is a result of this plan. |

## 素材与许可

- Franka Panda 网格与 MJCF：MuJoCo Menagerie（Apache-2.0）。
- 香蕉：YCB Object and Model Set 扫描模型，object 011（CC BY 4.0；已重新定向、贴图缩小）。
- 厨房：程序化 RoboCasa 风格示意场景（不含 RoboCasa 真实资产）。
- 公式排版：MathJax（Apache-2.0）；three.js（MIT）；Lora、Inter（SIL OFL 1.1）。
