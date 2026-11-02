// Generate storyboard.md: per chapter — timing, 3D action, on-screen text (verbatim), captions with absolute
// timecodes (parsed from core.js, so they always match the film), sources.  Usage: node scripts/storyboard.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'core.js'));
const src = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');

// captions per scene function, parsed from the source
const drawMap = {}; for (const m of src.matchAll(/(\w+): (scene\w+)/g)) drawMap[m[1]] = m[2];
function captionsOf(fn) {
  const a = src.indexOf(`function ${fn}(`); if (a < 0) return [];
  const b = src.indexOf('\n  function ', a + 10), body = src.slice(a, b < 0 ? undefined : b);
  const c = body.indexOf('captions(ctx, u, ['); if (c < 0) return [];
  return [...body.slice(c).matchAll(/\[([\d.]+), ([\d.]+), '((?:[^'\\]|\\.)*)'\]/g)].map(m => [+m[1], +m[2], m[3]]);
}
const tc = s => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; };

// hand-written: 3D action (中文) and on-screen text (verbatim). Keep in sync with core.js / scene3d.js.
const D = {
  title: {
    act: ['广角厨房镜头缓慢推移；机械臂轻微待机摆动；切片平面上淡入青色 T 等值线。'],
    txt: ['Energy-Field Teachers / for Small VLAs', 'Help a small VLA get it right the first time — / then let it learn to do without the teacher.', 'RESEARCH PLAN · CONCEPT / HYPOTHESIS · 2026-11-01']
  },
  gap: {
    act: ['0–16 s 无挡板的开放布局：从台面抓起香蕉（≈3 s）、抬起、低弧线搬运、放进碗（≈12 s）、松开。',
      '16 s 起新组合：挡板升起（16.3–17.8 s）、19 s 出现半透明低顶隔板；香蕉重新握在一端附近。',
      '30–33 s 沿熟悉的直线动作前进，33 s 撞上挡板（红色碰撞环）。之后静止。'],
    txt: ['副标题：Skills it already has → A combination it has not seen',
      '列表（蓝色竖条，3 / 4.5 / 7 / 10 / 12 s 出现）：grasp · lift · move sideways · slow down · place',
      '列表（红色竖条，16.5 / 19 / 21.5 / 24 s）：bowl behind a barrier · low ceiling · grip near one end · no fast swing',
      '37 s 卡片：WHAT IS MISSING — which skill to use, / how much of it, / and what it causes next.',
      '46 s 卡片：SIMILAR DIAGNOSIS — Actions stay bound to training layouts. — VLS — Liu et al., arXiv 2602.03973',
      '3D 标签：collision']
  },
  tools: {
    act: ['0–50 s 左右分屏（同一机位）。左：单 VLA 3–6 s 直线前进，6 s 撞挡板。',
      '右：世界模型规划器（示意）。CEM 第 1 轮 8–17 s：3 次迭代，每次 10 条“想象的未来”（紫色短轨迹 + 半透明幽灵香蕉），最后一次最佳候选变橙色；17–19 s 执行一步；第 2 轮 19–25 s；25–27 s 再走一步，停在挡板前。',
      '50 s 起：深色背板上的对比表（3D 在背板后以 2 fps 更新）。'],
    txt: ['标题：Two strong families today', '左栏：Single VLA — π0.5 · GR00T N1.6', '右栏：World action model — Cosmos-Policy · GE-Act · LingBot-VA · V-JEPA 2-AC planner',
      '3D 标签：collision · imagining… · best score · stalls at the barrier',
      '30 s VLA 卡：✓ one forward pass per chunk ✗ no look-ahead at consequences ✗ brittle outside its training data；63 ms — π0.5, one inference step；来源：Latency: Do WAMs Generalize Better than VLAs?, arXiv 2603.22078, Tab. 5',
      '37 s WAM 卡：✓ predicts what happens next ✗ imagines before every action ✗ short-horizon scores miss detours；4.8–83× — slower than π0.5 per step；16 s — per action, V-JEPA 2-AC (CEM)；来源：arXiv 2603.22078, Tab. 5 · V-JEPA 2, arXiv 2506.09985, §4.2',
      '44 s 数据卡：PRIOR WORK — 92% → 41% — success with a perfect predictor, as the goal moves from 5 to 20 steps away — The Planning Limits of Latent World Models — Alrasheed, Azam, Akhtar, arXiv 2609.39235',
      '50 s 表头：Other tools already solve part of it；列：ALREADY GOOD AT / WHAT WE WANT TO ADD — TO BE TESTED',
      '行 1：Motion planning (cuRobo, arXiv 2310.17274) | feasible motion for given geometry | + language, vision, learned consequences',
      '行 2：MPC / model-based RL (TD-MPC2, arXiv 2310.16828) | optimizing on predicted outcomes | + the VLA’s skill prior; less re-solving',
      '行 3：Fine-tuning the VLA (π0.5, arXiv 2504.16054) | writing data into the policy | + targeted corrections, faster adaptation',
      '行 4：Inference-time guidance (OmniGuide 2603.10052 · DynaGuide) | better behaviour right now | + cheap, composable, kept after switch-off',
      '行 5：Amortized guidance (AGF, arXiv 2609.34944) | a light net replaces the critic | + structure: objects, contacts, physics',
      '72 s 横幅：Not new: an optimizer that guides a policy which then acts alone — Guided Policy Search (Levine & Koltun, ICML 2013).']
  },
  thesis: {
    act: ['纯图示（3D 在背板后）。'],
    txt: ['First time: predict and reason.（0.5 s）', 'After that: a cheap, transferable skill.（9 s）',
      '链条（18.5 s 起依次）：Existing skills / the small VLA → Predictive correction / in a new situation → Fast adaptation / the lesson is learned → Acting alone / and accumulating',
      '27 s：HYPOTHESIS · TO BE ESTABLISHED BY EXPERIMENT']
  },
  guide: {
    act: ['动作块去噪循环，每 12 s 一次（τ 在 8.5 s 内从 0 到 1）；τ ∈ [0.3, 0.8] 时出现橙色引导箭头，动作块被抬过挡板。',
      '每次去噪结束后（8.6–11 s），机械臂执行这条动作块越过挡板到碗上方，11.3–12 s 回到起点开始下一次。'],
    txt: ['副标题：The VLA’s own action chunk, being denoised', 'τ 条：noise · guided · actions · τ = 0.00…', '3D 标签：clean estimate · −λ∇E',
      '14 s 起右侧流程（排版公式）：Velocity v_θ → Clean estimate Â → Kinematics K(Â) → Energy E(K(Â)) → Guided velocity v_θ − λ∇E（当前步骤高亮）']
  },
  geom: {
    act: ['机位转到正面。0.3–3 s 机械臂沿直线挪到停滞点，之后原地抖动、无法脱出；局部能量 E 切片淡入，3.5 / 5 / 8 s 依次出现 attract / repel / net 箭头。',
      '20 s 切换为测地场 T：波前 20.8–26.5 s 从碗扩展，27 s 出现流向箭头，27.5 s 出现 −∇T。',
      '29–34.5 s 机械臂沿 −∇T 的流线越过挡板，把香蕉放进碗。'],
    txt: ['副标题：Local energy: attract to the bowl + repel from the barrier → Geodesic progress field T', '3D 标签：attract · repel · net · −∇T',
      '14–20 s 数据卡：PRIOR WORK — 62% — of hardware trials stalled — safe, but stuck — Least-restrictive safety filter (baseline) in LatentCBF, arXiv 2511.18606, Tab. 2',
      '21 s 公式卡：S(x)‖∇T(x)‖ = 1 — T = 0 at the goal']
  },
  direct: {
    act: ['VLA 的直线动作块（蓝点）穿过挡板；8 s 蓝色“保持前进”箭头，10 s 挡板附近橙色向上箭头，12 s 末段向后的“减缓加速”箭头。',
      '16–20 s 动作块弯成越障弧线；21–26.5 s 机械臂执行修正后的动作块。'],
    txt: ['副标题：The VLA’s proposal, and what the teacher says about it', '卡片：A VERDICT — ✗ this action is bad',
      '7 s 卡片：A DIRECTION — keep the forward progress · add clearance over the barrier · ease the acceleration',
      '14 s 公式：E(A + ΔA) ≈ E(A) + ∇E(A)ᵀ ΔA', '21 s：Corrections on states the student visits — as in DAgger (Ross et al., 2011)',
      '3D 标签：keep progress · more clearance · ease the acceleration · corrected chunk']
  },
  slip: {
    act: ['左右分屏，同一条越障路径，12 s 循环：慢（9 s）稳稳放进碗；快（4.5 s）香蕉滞后、在顶点滑落到台面。'],
    txt: ['标题：Same path, different speed', '左右标题：Slow / Fast', '3D 标签：slip',
      '8 s：◐ geometry: same score（两侧）', '15 s：✓ consequences: grip holds（慢）/ ✗ consequences: slip risk（快）']
  },
  intervene: {
    act: ['0–8 s：正面 T 切片 + −∇T。',
      '8–16 s 去掉挡板：挡板缩回，场重算为直拉；12.6–15 s 机械臂沿新流线直接移向碗，再收回。',
      '16–24 s 封顶：镜头俯视顶视图切片；机械臂沿流线绕向侧面开口，再收回。',
      '24–32 s 加高挡板：场要求更大净空；机械臂沿更高的流线越过，再收回。',
      '32–44 s 新指令：蓝碗出现为新目标、杯子为禁止接触；场实时重算（33–37 s）；38.6–42.6 s 机械臂越过挡板、从杯子上方把香蕉送进蓝碗。'],
    txt: ['副标题：Separate how the world changes from what we want this time',
      '公式卡（排版）：E(A; g, c) = E_geo(A; c) + ℓ(F_θ(h, A); g, c)；F_θ what happens — reused；g, c what we want — swapped',
      '列表（当前项高亮）：1 Barrier removed · 2 Top closed · 3 Taller barrier · 4 New goal, cup forbidden', '3D 标签：−∇T · new goal · do not touch',
      '44 s 卡片：WHEN IT FAILS, ASK WHERE — goal grounding · geometry · contact rules · consequence prediction',
      '50 s：Baseline: equally informed vector guidance — AGF, arXiv 2609.34944']
  },
  teach: {
    act: ['纯图示（3D 在背板后）。'],
    txt: ['标题：From teacher to student', 'TEACHER · TRAINING TIME：Explicit geometry / SDF · T · contact rules；JEPA predictor / grip · slip · contact outcome；Teacher energy / scores the VLA’s own proposal',
      '14 s：distill: value + gradient matching', 'LIGHT ENERGY STUDENT：Scene encoder / once per chunk；Analytic energy / geometry — kept analytic；Consequence module / small, per action query',
      '35 s：a means, not the end: next, the VLA itself must learn']
  },
  invest: {
    act: ['机械臂循环执行越障搬运（每 6.5 s：执行、停留、复位）。T 切片和 −∇T 箭头可见；香蕉周围橙色光环：状态 A 大（JEPA predictor），状态 B 缩小（light module）。',
      '26–28 s 进入状态 C：切片、箭头、光环全部淡出，机械臂变为不透明，独立执行；标注 target behaviour — to be tested。'],
    txt: ['副标题：Deployment states', 'A — Full teacher — geometry + JEPA predictor', 'B — Light energy student — cheaper — geometry still guides', 'C — VLA alone — T off too · safety check only',
      '3D 标签：JEPA predictor / light module · target behaviour — to be tested',
      '38 s：TO MEASURE, OVER A DEPLOYMENT — ↓ teacher calls ↓ human interventions ↑ success']
  },
  levels: {
    act: ['纯图示（3D 在背板后）。'],
    txt: ['标题：Four levels of success', 'LEVEL 1 — Helped on a new combination — with the teacher, first time', 'LEVEL 2 — One teacher, unseen combinations — one set of parameters',
      'LEVEL 3 — VLA alone, from new starts — after a little guidance（20 s 标注 first paper’s endpoint）', 'LEVEL 4 — Each next task needs less help — skills accumulate, none forgotten',
      '34 s：LIMIT — The student must observe what decides the right action.']
  },
  notclaims: {
    act: ['纯图示（3D 在背板后）。'],
    txt: ['标题：What we do not claim as contributions', '每张卡标签：NOT A SELLING POINT',
      'No path output — an interface choice — planners stay as strong baselines', 'No best-of-N — compared on success, cost and adaptation speed',
      'Using JEPA — V-JEPA 2-AC already plans; the question is how well it teaches', 'The geometric field — if geometry alone suffices, we accept that result']
  },
  end: {
    act: ['纯图示（3D 在背板后）。'],
    txt: ['THE PROPOSITION — STATED SO THAT IT CAN FAIL',
      'For a small VLA with basic skills: can a structured predictive teacher make it adapt to unseen constraint combinations with fewer new demonstrations or interactions — and keep that ability once guidance is removed?',
      '1 Useful on new combinations · 2 Cheaper adaptation · 3 Holds without the teacher', '20 s：Not a smarter planner carried forever — a teacher the robot outgrows.',
      '25 s 引用：Cited: arXiv 2603.22078 · 2506.09985 · 2609.39235 · 2511.18606 · 2602.03973 · 2603.10052 · 2609.34944 · 2310.17274 · 2310.16828 · 2504.16054 · Levine & Koltun 2013 · Ross et al. 2011',
      '25 s 致谢：Schematic RoboCasa-style kitchen · Franka Panda meshes: MuJoCo Menagerie (Apache-2.0) · Banana: YCB Object and Model Set scan, object 011 (CC BY 4.0, re-oriented, texture resized)']
  }
};

let md = `# Storyboard — Energy-Field Teachers for Small VLAs

自动生成：\`node scripts/storyboard.js\`（字幕从 core.js 直接解析，时间码为全片绝对时间）。
16:9 · 1920×1080 · 30 fps · 总长 ${tc(core.DUR)}（${core.DUR} s）· ${core.SCENES.length} 章 · 场景切换 0.5 s 交叉淡化。

**主题**：已具备基本技能的小 VLA 在新的条件组合下，借助教师（几何 + 预测后果）先做对，把纠正学进去，再逐步不需要教师。
“第一次：预测与推理；之后：便宜、可迁移的技能。” 片中所有优势均为希望通过实验建立的假设，不是结果；屏幕上的数字都来自引用文献并标注出处。

**视觉**：深色“night lab”；台面是被照亮的舞台；字幕每次一行；列表为色条 + 文字（无胶囊气泡）；公式由 MathJax 排版。

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
