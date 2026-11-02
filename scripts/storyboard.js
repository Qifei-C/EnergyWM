// Generate storyboard.md: per chapter — timing, 3D action, on-screen text (verbatim), captions with absolute
// timecodes (parsed from core.js, so they always match the film), sources.  Usage: node scripts/storyboard.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'core.js'));
const { drawMap, captionsOf } = require('./captions.js'); // captions per scene function, parsed from core.js
const tc = s => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; };

// hand-written: 3D action (中文) and on-screen text (verbatim). Keep in sync with core.js / scene3d.js.
const D = {
  title: {
    act: ['广角厨房镜头缓慢推移；机械臂轻微待机摆动；切片平面上淡入青色 T 等值线。'],
    txt: ['Energy-Field Teachers / for Small VLAs', 'Help a small VLA get it right the first time — / then let it learn to do without the teacher.', '作者：Qifei C.（CocoMatrix）']
  },
  gap: {
    act: ['0–16 s 无挡板的开放布局：从台面抓起香蕉、抬起、低弧线搬运、放进碗、松开。',
      '16 s 起新组合：挡板升起（16.3–17.8 s）、19 s 出现半透明低顶隔板；香蕉重新握在一端附近。',
      '30–33 s 沿熟悉的直线动作前进，33 s 撞上挡板（红色碰撞环）。',
      '52–54.5 s 低顶隔板上移并淡出：此后的机制章节只保留挡板（布局连续性）。'],
    txt: ['副标题：Skills it already has → A combination it has not seen',
      '列表（蓝色竖条）：grasp · lift · move sideways · slow down · place', '列表（红色竖条）：bowl behind a barrier · low ceiling · grip near one end · no fast swing',
      '37 s 卡片：WHAT IS MISSING — which skill to use, / how much of it, / and what it causes next.',
      '46 s 卡片：SIMILAR DIAGNOSIS — Actions stay bound to training layouts. — VLS — Liu et al., arXiv 2602.03973',
      '3D 标签：collision · ceiling removed from here on']
  },
  tools: {
    act: ['0–50 s 左右分屏（同一机位，标注为示意失败）。左：直接策略 3–6 s 直线前进撞挡板。',
      '右：基于采样的世界模型规划器（示意，V-JEPA 2-AC 式 CEM）：两轮“想象—评分—走一步”（紫色短轨迹 + 幽灵香蕉，最佳候选橙色），停在挡板前。',
      '28 s 左卡、35 s 右卡、42 s 数据卡（其余变暗）。',
      '50–64 s 深色背板：世界动作模型的三种设计；64–88 s 五类已有方法对比表；88 s GPS 横幅；96–106 s 问题卡。'],
    txt: ['标题：Where extra reasoning helps — and what it costs；右上：ILLUSTRATIVE FAILURE · COMBINED CHANGES',
      '左栏：Direct-policy baseline — e.g. π0.5 · GR00T N1.6 — direct action-chunk generation, no external rollout search',
      '右栏：A sampling-based world-model planner — e.g. V-JEPA 2-AC with CEM — not every world action model works this way',
      '3D 标签：collision · imagining… · best score · stalls at the barrier',
      '28 s 左卡：63 ms — per 50-action chunk, π0.5 (reported)；✓ direct action-chunk generation ✗ no separate action–outcome evaluation loop；来源 arXiv 2603.22078, Tab. 5',
      '35 s 右卡：16 s / action — 800 samples · 10 iterations · horizon 1 · one RTX 4090；✓ evaluates imagined outcomes ✗ pays for search at every step；来源 V-JEPA 2, arXiv 2506.09985, Tab. 3',
      '42 s 数据卡：92% → 41% — success with a perfect predictor and a fixed 5-step rollout, as the goal moves from 5 to 20 steps away — arXiv 2609.39235',
      '50 s：World action models are not one design — Imagine, score, then act（V-JEPA 2-AC with CEM, arXiv 2506.09985）· Predict actions and futures together（generates actions directly, with future states and values; can also plan — Cosmos Policy, Kim et al., arXiv 2601.16163）· Learn from video, act directly（video co-training, then no imagination at test time — Fast-WAM, Yuan et al., arXiv 2603.16666）',
      '59 s：Latency also varies: the WAMs evaluated in one benchmark were 4.8× to 83× slower per inference than π0.5. — Model- and configuration-dependent, arXiv 2603.22078, Tab. 5',
      '64 s：Other tools already solve part of it — ALREADY GOOD AT / WHAT WE WANT TO ADD：Motion planning (cuRobo) · MPC / model-based RL (TD-MPC2) · Fine-tuning the VLA (π0.5) · Inference-time guidance (OmniGuide · DynaGuide) · Amortized guidance (AGF)',
      '88 s：Not new: an optimizer that guides a policy which then acts alone — Guided Policy Search (Levine & Koltun, ICML 2013).',
      '96 s：THE QUESTION — When a new constraint needs extra computation, can that computation become help we no longer need next time?']
  },
  thesis: {
    act: ['纯图示（3D 在背板后）。'],
    txt: ['First time: predict and reason. / After that: a cheap, transferable skill.',
      '链条：Existing skills / the small VLA → Predictive correction / in a new situation → Fast adaptation / the VLA is updated → Acting alone / and accumulating']
  },
  guide: {
    act: ['动作块去噪循环（12 s 一次，τ 在 8.5 s 内 0→1）。蓝色细线 = VLA 自己的原提案（不变）；去噪中的动作块在引导窗口内由蓝变橙（= 修正后的动作块），引导箭头标为 guidance update。',
      '每次去噪结束后机械臂执行橙色动作块越过挡板，随后复位。'],
    txt: ['副标题：The VLA’s own action chunk, being denoised；图例：VLA proposal（蓝）· corrected chunk — executed（橙）',
      'τ 条：denoising time τ · noise · τ = 0 · guided window · τ = 1 · actions · τ = …', '3D 标签：VLA proposal · guidance update · corrected chunk',
      '20 s 起右侧双分支图（排版公式）：Â（clean estimate）→ K → Geometry（from sensors or simulation）: E_geo(K(Â); g, c)；→ F_θ(h,·) → Consequences（trained action-conditioned model）: ℓ(F_θ(h, Â); g, c)；g, c — goal and constraints decide the score',
      '汇总：E(Â; g, c) = E_geo(K(Â); g, c) + ℓ(F_θ(h, Â); g, c) → 更新：v_φ − λ𝒫(∇_Â E)；𝒫 normalize · clip · smooth — not the raw gradient',
      '符号说明（右下，随高亮切换）：20.6 s Â estimate of the finished chunk, at the current τ · A action chunk: a block of the robot’s next actions；27 s K arm kinematics: chunk → path of gripper and banana · E_geo clearance from obstacles + progress to the goal；34 s F_θ action-conditioned world model, with weights θ · h current observation and recent history · ℓ cost read out from the predicted outcome；41 s E total energy of the chunk: lower is better · g, c the goal; the constraints of this task；48 s v_φ the VLA’s denoising velocity, with weights φ · λ guidance strength · ∇_Â E gradient of the energy at the estimate',
      '高亮顺序：27 s 几何 · 34 s 后果 · 41 s 汇总 · 48 s 更新']
  },
  geom: {
    act: ['机械臂沿直线挪到停滞点后原地抖动；局部能量 E 切片 + attract / repel / net 箭头。',
      '14 s 切换为数值计算的测地进度场 T（波前 14.8–20.5 s，−∇T 21.5 s）。23 s 蓝色 VLA 原提案（直线穿过挡板）；25 s 橙色修正动作块（形状取自 −∇T 流线并保证香蕉全长净空）。',
      '27–32 s 机械臂执行橙色修正动作块。'],
    txt: ['副标题：Local energy: attract to the bowl + repel from the barrier → Geometric progress field T — computed numerically；图例：VLA proposal · corrected chunk — executed',
      '3D 标签：attract · repel · net · −∇T · VLA proposal · corrected chunk', '15 s 公式卡：S(x)‖∇T(x)‖ = 1；符号说明：T(x) time to the goal at speed S; T = 0 at the goal · S(x) speed: 0 in obstacles, 1 beyond 6 cm clearance · x position of the banana’s centre · 21.5 s −∇T steepest descent of T: the way to the goal（62% 卡片已移至附录）',
      '36–52 s 我们自己的数值检查（深色背板，前面的标签淡出）：OUR NUMERICAL CHECK — THE GEOMETRIC TARGET ALONE；Reached the goal without passing through an obstacle — nine blocked cases · same start and goal for every method',
      '四行实测条形（9 个有障碍样例）：No correction — the straight proposal 0/9（passes through the obstacle）· Local attraction + repulsion 0/9（stops in front of it）· Local energy + progress field T 7/9（two symmetric starts stall）· Random correction of the same size 0/9',
      '脚注：12 fixed synthetic cases (in the 3 unobstructed ones all four methods reach the goal) · ideal point motion, no robot · 20 mm voxels, 30 mm inflation（数据：trajectories-v2.json，按原始轨迹复核）']
  },
  direct: {
    act: ['VLA 的直线动作块（蓝）穿过挡板；8 / 10 / 12 s 依次出现保持前进、增加净空、减缓加速的箭头。',
      '16–20 s 动作块弯成越障弧线并由蓝变橙，原提案保留为蓝色细线；21–26.5 s 机械臂执行修正后的动作块。'],
    txt: ['副标题：The VLA’s proposal, and what the teacher says about it；16 s 图例', '卡片：A VERDICT — ✗ this action is bad',
      '卡片：A DIRECTION — keep the forward progress · add clearance over the barrier · ease the acceleration', '14 s 公式：E(A + ΔA) ≈ E(A) + ∇E(A)ᵀ ΔA；14.6–15.8 s 符号说明：A the VLA’s proposed chunk, as one vector · ΔA a small change to the chunk · ∇E(A) where E rises fastest: step against it',
      '21 s：Corrections on states the student visits — as in DAgger (Ross et al., 2011)', '3D 标签：keep progress · more clearance · ease the acceleration · corrected chunk']
  },
  slip: {
    act: ['左右分屏，同一条越障路径，12 s 循环：慢（9 s）稳稳放进碗；快（4.5 s）香蕉滞后、在顶点滑落到台面（选定抓持条件下的示意后果）。'],
    txt: ['标题：Same path, different speed；右侧：ILLUSTRATIVE CONSEQUENCES UNDER ONE CHOSEN GRIP', 'Slow — duration 2× · lower peak acceleration；Fast — duration 1× · higher peak acceleration', '3D 标签：slip',
      '8 s：◐ untimed geometric path: indistinguishable（两侧）', '15 s：✓ trained readout: grip holds（慢）/ ✗ trained readout: slip risk（快）']
  },
  intervene: {
    act: ['0–8 s：正面 T 切片 + −∇T。',
      '每种布局（8 s）：场重算 → 同一个蓝色 VLA 原提案 → 不同的橙色修正动作块 → 机械臂执行修正动作块再收回。',
      '8–16 s 去掉挡板（直拉，无多余抬高）；16–24 s 封顶，俯视顶视图，标出 side opening，修正绕向侧面开口；24–32 s 加高挡板（更大净空）。',
      '32–44 s 新目标：旧碗收走，蓝碗出现在机械臂可俯抓的范围内，杯子放在挡板和蓝碗之间、禁止接触；场实时重算，修正越过挡板、从杯子上方送进蓝碗。',
      '香蕉始终按夹爪的实际位姿（正向运动学）跟随，不会与夹爪错位。'],
    txt: ['副标题：Separate how the world changes from what we want this time；图例：VLA proposal · corrected chunk — executed',
      '公式卡（排版）：E(A; g, c) = E_geo(K(A); g, c) + ℓ(F_θ(h, A); g, c)；F_θ what happens — reused；g, c what we want — swapped；E_geo recomputed per layout — no training',
      '列表：1 Barrier removed · 2 Top closed · 3 Taller barrier · 4 New goal, cup forbidden', '3D 标签：−∇T · VLA proposal · corrected chunk · side opening · new goal · do not touch',
      '44 s：WHEN IT FAILS, ASK WHERE — goal grounding · geometry · contact rules · consequence prediction', '50 s：Baseline: equally informed vector guidance — AGF, arXiv 2609.34944']
  },
  teach: {
    act: ['纯图示（3D 在背板后）。'],
    txt: ['标题：Teacher → energy student', 'FULL TEACHER · OFFLINE SUPERVISION + SELECTIVE ADAPTATION-TIME USE：Explicit geometry / SDF · numerical T · contact rules；Action-conditioned JEPA / → trained readouts: grip · slip · contact；Teacher energy / scores the VLA’s own proposal',
      '21 s：distill: values + gradients', 'ENERGY STUDENT · LEARNS TO EVALUATE CHEAPLY：Scene encoder / once per chunk；Geometry energy / SDF + numerical T, from sensors；Consequence module / small, per action query',
      '35 s：Evaluation is cheaper — the VLA itself has not changed yet.']
  },
  policy: {
    act: ['0–30 s 纯图示：两个学生 + 学习闭环 + 参数更新公式。',
      '30–58 s 高潮：左右分屏，教师关闭。左 = 适应前的 VLA，右 = 适应后的 VLA，同一个未参与适应的初始条件。条件 1（30–44 s）：挡板加高到 0.30 m；左边直线撞挡板，右边越过更高的弧线放进碗。条件 2（44–58 s）：抓在香蕉一端附近；左撞、右越过。',
      '58–72 s 纯文字关键句。'],
    txt: ['Two students：Energy student — learns to evaluate cheaply；Policy student — the VLA — learns to act without the evaluator',
      '闭环（14 / 15 / 16 / 21 / 28 s）：1 VLA proposal — the current policy → 2 Teacher correction — guided by the energy → 3 Execute & observe — keep only verified corrections → 4 Update the VLA — own objective + old-skill replay → 5 Test, guidance off — held-out starts · no T（虚线返回：next round）',
      '21.5 s：公式 π_φk → π_φk+1；data: execution-verified corrections + replay of old skills；符号说明：π_φ the VLA as a policy, with weights φ · k adaptation round',
      '30 s 分屏：Teacher off: before vs. after adaptation；Before adaptation — teacher off · held-out start；After adaptation — teacher off · the same held-out start',
      '条件标签：Held-out condition 1 · a higher barrier → Held-out condition 2 · grip near one end；3D 标签：collision',
      '58 s：Making the correction cheaper is not enough. / The policy must learn to need it less.']
  },
  sim2real: {
    act: ['0–34 s 左右分屏。左：仿真厨房（原样），VLA 抓起香蕉放进碗。右：新厨房（暖光、木色台面与柜子、浅色墙、台面后方杂物、相机位置不同），同一个 VLA 在香蕉旁 6 cm 处合爪、空手抬起，标注 misses the grasp（示意失败）。',
      '20–21.8 s 一条扫描线沿世界 x 方向扫过画面（两半同一位置），切入几何视图：所有模型（厨房、物体、机械臂）去掉纹理，按机器人坐标系下的表面法线着色（正面蓝紫、顶面绿、侧面粉/青），铺 5 cm 公制网格；两边看起来一致——表示不再关注纹理。',
      '34–50 s 全屏，新厨房的几何视图（教师视角）：蓝色 VLA 原提案（抓偏处）→ 橙色修正动作块移到香蕉上 → 机械臂执行，抓起香蕉放进碗；48–49.8 s 第二条扫描线切出，回到真实厨房（香蕉已在碗里）。',
      '50–62 s 深色背板，三张文献卡；62–72 s 问题卡。'],
    txt: ['标题：From simulation to a real kitchen；右上：ILLUSTRATIVE FAILURE；左右栏：Simulation — where the VLA was trained / A new kitchen — new texture, light, background — and camera pose',
      '20 s 起：geometry only: surface normals on a metric grid（两栏）；Same geometry, same frame — in both kitchens',
      '34 s：The teacher works on the geometry layer — in the new kitchen；图例 VLA proposal · corrected chunk — executed；3D 标签：VLA proposal · corrected chunk · geometry view — what the teacher sees',
      '50 s：What prior work shows — 95% → <30%（VLA success under modest camera-viewpoint and robot-state perturbations — LIBERO-Plus, arXiv 2510.13626）· 2.7% → 36.9%（real-world success of a sim-trained policy (Click Bell): no randomization vs. table-height randomization; background alone: 11.5% — arXiv 2603.22876, Tab. 1）· 72.5% → 84.7%（π0.5 real-robot OOD completion with a JEPA world-model loss added in training only (5 tasks × 10 rollouts); median latency 54.05 → 55.12 ms — JEPA-WAM, arXiv 2608.09381, §4.4, Tab. 12）',
      '62 s：WHAT WE TEST — Does a teacher that works on geometry make a small VLA adapt to a new kitchen faster — fewer demonstrations to the same success — and keep it once the teacher is off?；Prior work shows robustness gains from world-model losses in training — not adaptation speed. That is the Level 3 test, run in a new environment.']
  },
  invest: {
    act: ['机械臂循环执行越障搬运；T 切片与 −∇T 可见；状态 A 香蕉周围大光环（JEPA predictor），B 缩小（light module）。',
      '22–24 s 进入状态 C：切片、箭头、光环淡出，机械臂不透明独立执行。'],
    txt: ['副标题：Deployment states', 'A — Full teacher — only for new or uncertain cases', 'B — Energy student — cheaper — geometry still guides', 'C — Updated VLA alone — T off too · safety check only',
      '28 s：TO MEASURE, OVER A DEPLOYMENT — ↓ teacher calls ↓ human interventions ↑ success']
  },
  levels: {
    act: ['纯图示（3D 在背板后）。'],
    txt: ['0–30 s 阶梯：LEVEL 1 Helped on a new combination；LEVEL 2 One teacher, unseen combinations；LEVEL 3 VLA alone, from new starts（first paper’s endpoint）；LEVEL 4 Each next task needs less help',
      '30 s：Level 3, as a test — 表头 METHOD · ADAPTATION BUDGET · AT TEST · STARTS',
      '行：Direct fine-tuning / Imitate the corrected actions / Teacher-guided update (verified corrections · gradient-informed)；每行：equal · all guidance off · held-out（不画曲线）',
      '52 s：LIMIT — The student must observe what decides the right action.']
  },
  notclaims: {
    act: ['纯图示（3D 在背板后）。五行，每 7 s 一行（与字幕对齐）：左边先出（我们基于什么），箭头，右边再出（由此得到什么）。'],
    txt: ['标题：What we build on — and what it gives us；列头 WE BUILD ON / WHAT WE GAIN',
      '1 Geometric fields — SDF and a numerically computed progress field T → A progress signal for any layout — recomputed when the scene changes — no retraining',
      '2 An action-conditioned world model — trained readouts: grip, slip, contact → Consequences geometry cannot see — same path, different speed — told apart',
      '3 The VLA’s own skills — its proposal and its denoising steps → Corrections close to what it already does — a gradient on its own chunk, not a new path',
      '4 Execution-verified corrections — replayed together with old skills → A VLA that needs the teacher less — checked with all guidance off, from held-out starts',
      '5 Geometry learned in simulation — in the robot’s frame — the layer the world model works on → A teacher that carries into a real kitchen — the same layer in sim and real — its gradient adapts the VLA']
  },
  end: {
    act: ['纯图示（3D 在背板后）。'],
    txt: ['THE PROPOSITION — STATED SO THAT IT CAN FAIL',
      'For a small VLA with basic skills: can a structured predictive teacher make it adapt to unseen constraint combinations and new environments with fewer new demonstrations or interactions — and keep that ability once guidance is removed?',
      '1 Useful on new combinations · 2 Cheaper adaptation · 3 Holds without the teacher', '20 s：Not a smarter planner carried forever — a teacher the robot outgrows.', '25 s：作者 Qifei C. · CocoMatrix、引用列表与素材致谢']
  },
  appendix: {
    act: ['纯图示（3D 在背板后）。0–14 s 第 1 页，14–30 s 第 2 页。'],
    txt: ['第 1 页 Appendix: prior numbers and their scope — 63 ms · 16 s / action · 92% → 41% · 62%（各自口径，同上一版）；Different tasks and protocols — not one comparison.',
      '第 2 页 Appendix: sim-to-real, world-model loss — and our check：95% → <30%（LIBERO-Plus, arXiv 2510.13626）· 2.7% → 36.9%（Click Bell, sim-trained; background 11.5%, lighting 12.3%, camera pose 23.5%; >10k real trials — arXiv 2603.22876, §4.2, Tab. 1）· 72.5% → 84.7%（π0.5 + JEPA objective, training only; LIBERO-Plus 84.5 → 86.3; latency 54.05 → 55.12 ms — arXiv 2608.09381, §4.4, Tab. 2, Tab. 12）',
      'OUR NUMERICAL CHECK 7 / 9：blocked cases reached without sampled penetration by local energy + T (local, none, random same-norm: 0/9 each); 12 fixed cases, ideal point kinematics, 20 mm voxels, 30 mm inflation, 5 mm steps, seed 20261101 — Our run, manual field, CPU (5.5 s); trajectories-v2.json, metrics-v2.json']
  }
};

let md = `# Storyboard — Energy-Field Teachers for Small VLAs

自动生成：\`node scripts/storyboard.js\`（字幕从 core.js 直接解析，时间码为全片绝对时间）。
16:9 · 1920×1080 · 30 fps · 总长 ${tc(core.DUR)}（${core.DUR} s）· ${core.SCENES.length} 章 · 场景切换 0.5 s 交叉淡化。

**主题**：已具备基本技能的小 VLA 在新的条件组合下，借助教师（几何 + 预测后果）先做对，把纠正学进去，再逐步不需要教师。
“第一次：预测与推理；之后：便宜、可迁移的技能。” 片中的优势是计划中要用实验检验的；屏幕上的文献数字都标注出处与口径，我们自己的数值检查（第 06 章与附录）单独标注为我们的，并写明设置。

**视觉**：深色“night lab”；台面是被照亮的舞台；字幕每次一行；列表为色条 + 文字（无胶囊气泡）；公式由 MathJax 排版。

## 记号（全片统一，每个公式出现时旁边有符号说明）

| 符号 | 含义 | 出现 |
|---|---|---|
| A | 动作块：机器人接下来的一段动作（H 步 × 每步 d 维，π0.5 为 50 步） | 05, 07, 09 |
| τ | 去噪时间：0 = 纯噪声，1 = 生成完的动作块；guided window = 施加引导的 τ 区间 | 05 |
| Â | 当前 τ 下对去噪完成的动作块的一步估计（clean estimate） | 05 |
| v_φ / π_φ | VLA：去噪速度场 / 作为策略；φ = VLA 权重，k = 适应轮次 | 05, 11 |
| F_θ(h, ·) | 动作条件世界模型，θ = 其权重；h = 当前观测与近期历史 | 05, 09 |
| K | 机械臂运动学：动作块 → 夹爪与香蕉扫过的路径 | 05, 09 |
| E_geo(K(A); g, c) | 几何能量：离障碍物的间隙 + 朝目标的进度 T；布局变化时重新计算，不训练 | 05, 09 |
| ℓ(F_θ(h, A); g, c) | 从预测结果读出的代价（抓稳、滑动、接触） | 05, 09 |
| g, c | 目标；约束 | 05, 09 |
| E(A; g, c) | 总能量 = E_geo + ℓ，越低越好 | 05, 07, 09 |
| λ, 𝒫 | 引导强度；对梯度做 normalize · clip · smooth | 05 |
| ∇_Â E, ∇E(A), ΔA | 能量对动作块的梯度；修正量（沿 −∇E 一阶下降） | 05, 07 |
| T(x), S(x), x | 程函方程 S(x)‖∇T(x)‖ = 1：T = 以速度 S 到目标的时间（目标处为 0）；S = 速度，膨胀障碍物内为 0（膨胀 4.5 cm），间隙 ≥ 6 cm 为 1，下限 0.15；x = 香蕉中心位置（竖直平面） | 06 |
| −∇T | T 的最速下降方向，即朝目标的路 | 06, 09 |

`;
core.SCENES.forEach((s, i) => {
  const d = D[s.id] || { act: [], txt: [] }, caps = captionsOf(drawMap[s.id]);
  md += `## ${String(i + 1).padStart(2, '0')} · ${s.name}  \`${tc(s.start)} – ${tc(s.start + s.dur)}\` (${s.dur} s)\n\n`;
  md += `**3D 动作**\n\n${d.act.map(x => '- ' + x).join('\n')}\n\n**画面文字（原文）**\n\n${d.txt.map(x => '- ' + x).join('\n')}\n\n`;
  if (caps.length) {
    md += `**字幕**\n\n| 开始 | 结束 | 字幕 |\n|---|---|---|\n`;
    for (const [a, b, t] of caps) md += `| ${tc(s.start + a)} | ${tc(s.start + Math.min(b, s.dur))} | ${t.replace(/\|/g, '\\|')} |\n`;
    md += '\n';
  } else md += `**字幕**：无\n\n`;
});
md += `## 素材与许可

- Franka Panda 网格与 MJCF：MuJoCo Menagerie（Apache-2.0）。
- 香蕉：YCB Object and Model Set 扫描模型，object 011（CC BY 4.0；已重新定向、贴图缩小）。
- 厨房：程序化 RoboCasa 风格示意场景（不含 RoboCasa 真实资产）。
- 公式排版：MathJax（Apache-2.0）；three.js（MIT）；Lora、Inter（SIL OFL 1.1）。
`;
fs.writeFileSync(path.join(ROOT, 'storyboard.md'), md);
console.log('wrote storyboard.md', md.length, 'chars');
