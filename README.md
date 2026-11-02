# Energy-Field Teachers for Small VLAs — MG 动画

研究计划《WAM 教师指导 → Energy Gradient → 小型 VLA 自主泛化》的动态图形（motion-graphics）解释片。16:9、1920×1080、30 fps、约 13:50（17 章）、深色“night lab”主题、英文字幕。
内容是研究计划（2026-11-01）。文献数字在画面上标注出处与口径；我们自己的数值检查（手工场，12 个合成算例，第 06 章与附录）单独标为“our numerical check”。

## 目标形态
- **3D 场景（three.js r128）**：RoboCasa 风格的厨房台面（程序化搭建，schematic）+ Franka Panda（mujoco_menagerie 网格）装在移动底座上；任务是把抓住的香蕉越过台面上的挡板放进碗里。
- **2D 叠加层（Canvas 2D）**：字幕、眉题、流程框图、公式卡、图表、进度线。两层叠加后既是网页播放器，也是 MP4 的每一帧。
- **测地进度场 T(x)** 用 fast sweeping 在页面内实时求解（`core.js`），以半透明切片平面的形式出现在 3D 场景里；三组布局干预（去掉挡板 / 封顶走侧面 / 加高）用同一套求解器重算。
- **网页版**：发布为 Artifact（three.js 从 cdnjs 加载，字体 Lora + Inter 从 Google Fonts 加载）。
- **MP4**：用 headless Chrome（SwiftShader WebGL）逐帧截图 → ffmpeg，每个场景一个文件再拼接。

## 目录
| 路径 | 内容 |
|---|---|
| `storyboard.md` | 16 章的分镜、时间与字幕（由 `scripts/storyboard.js` 从代码生成） |
| `core.js` | 共享引擎：设计 token、文字/图形工具、eikonal 快速扫描求解器、marching squares 等值线、章节表与时间轴、2D 叠加层与字幕 |
| `scene3d.js` | three.js 世界：厨房、Panda（GLB 解析、运动学、阻尼最小二乘 IK）、任务物体、场切片平面、箭头/轨迹、分镜相机、分屏渲染 |
| `app.js` | 胶水层：加载素材、驱动两层、播放器 UI、`window.__frame(t)` 供无头截帧 |
| `frames.js` | 早期纯 2D 版的离线关键帧脚本（已不再使用） |
| `assets/panda.glb`, `assets/panda_kin.json` | Panda 可视网格（每连杆一个节点、按材质合并，2.4 MB）与运动学参数 |
| `assets/panda_src/` | `panda.xml` + LICENSE（Apache-2.0）；OBJ 网格不入库，用 `scripts/fetch_panda.sh` 重新下载并转换 |
| `scripts/` | `render_mp4.js`（MP4）、`keyframes.js`（关键帧）、`storyboard.js`（分镜表）、`build_math.js`（MathJax 公式）、`fetch_panda.sh` / `convert_panda.py`、`fetch_banana.sh` / `convert_banana.py` |
| `fonts/` | Lora（静态实例，由 Google Fonts 的可变字体生成）与 Inter，均为 SIL OFL；供离线渲染注册 |

## MP4
```bash
node scripts/render_mp4.js --workers 2 --name energywm_720p --page 'aa=0&scale=0.6&out=720&shadow=1024'
```
依赖 Node `playwright`（Chromium + SwiftShader）与 `ffmpeg`；每章一个文件写到 `out/`，可断点续跑，最后 `-c copy` 拼接。

配音（Kokoro-82M，本地运行，Apache-2.0）：逐句朗读字幕，放在字幕出现后 0.15 s，必要时最多加速到 1.2× 以免压到下一句；混成一条音轨、响度归一到 −16 LUFS，再无损合进视频（`out/energywm_1080p_vo.mp4`）。符号与缩写的读法在 `scripts/voiceover.js` 的 `SPOKEN` 表里；改字幕后重跑只合成改动的句子。
```bash
node scripts/voiceover.js --check            # 只打印朗读稿
node scripts/voiceover.js --voice af_heart   # 合成 + 混音 + 合并；逐句时长见 out/vo/<voice>/report.tsv
node scripts/voiceover.js --engine openai    # 改用 OpenAI gpt-realtime-2.1-mini（音色 marin，需要 OPENAI_API_KEY）→ out/energywm_1080p_vo_<model>_<voice>.mp4
```

有 GPU 的机器（如 Apple Silicon）用系统 Chrome + 硬件 WebGL，完整 1080p 画质约 20–60 ms/帧：
```bash
node scripts/render_mp4.js --channel chrome --gpu --workers 3 --name energywm_1080p --quality 0.95 --crf 18 --preset medium --page 'aa=1&scale=1&out=1080&shadow=2048'
```

## 进度
- [x] 叠加层 + 3D 世界 + 播放器（`core.js` / `scene3d.js` / `app.js`），`build.js` 生成 `render.html` 与 `index.html`
- [x] 主题对齐：17 章（见 `storyboard.md`）—— 小 VLA 已有技能、遇到新组合时借助教师做对、执行验证后更新 VLA（能量学生 / 策略学生）、教师关闭时的前后对照、逐步撤掉教师；第 03 章讲额外推理的用处与代价（直接策略 vs 采样式世界模型规划器、WAM 的不同设计、五类已有方法、Guided Policy Search 渊源）；从仿真到真实厨房（几何层、文献证据、待测的适应速度）；Level 3 测试设计；“我们基于什么、由此得到什么”；附录列出文献数字及其口径
- [x] 无伪数据：删除示意曲线图；屏幕上的数字全部来自引用文献并标注出处
- [x] 深色主题、MathJax 排版公式（不出现 `_` / `^`）、无胶囊气泡、YCB 扫描香蕉
- [ ] MP4 渲染（24,900 帧；720p 预览约 0.6–0.8 s/帧）
- [ ] 发布 `index.html` 为 Artifact（附 `assets/panda.glb`、`assets/panda_kin.json`、`assets/banana.glb`）

## 本地预览
```bash
npm install && node build.js      # build.js 也会运行 scripts/build_math.js
python3 -m http.server 8787        # 浏览器打开 http://localhost:8787/render.html
node scripts/keyframes.js 6 17 25 36 47 80 95 120 128 141 157 185 212 243 275   # → preview/kf_*.jpg
```

## 素材与许可
- Franka Panda 网格与 MJCF：[google-deepmind/mujoco_menagerie](https://github.com/google-deepmind/mujoco_menagerie)（Apache-2.0）。
- 厨房场景：按 RoboCasa 的风格程序化搭建（RoboCasa 的真实资产不在其 GitHub 仓库内，需另行下载，本片不使用）。
- 香蕉：YCB Object and Model Set 扫描模型（object 011，CC BY 4.0；已重新定向、贴图缩小），`scripts/fetch_banana.sh` 可重新生成。
- 公式排版：MathJax（Apache-2.0），构建时生成 `math.js`。
- three.js（MIT）；Lora、Inter（SIL OFL 1.1）。
