# Energy-Field Teachers for Small VLAs — MG 动画

研究计划《WAM 教师指导 → Energy Gradient → 小型 VLA 自主泛化》的动态图形（motion-graphics）解释片。16:9、1920×1080、30 fps、约 9:52、深色“night lab”主题、英文字幕。
内容是研究计划（Concept / Hypothesis，2026-11-01）；片中所有数字都标为假设，不是实验结果。

## 目标形态
- **3D 场景（three.js r128）**：RoboCasa 风格的厨房台面（程序化搭建，schematic）+ Franka Panda（mujoco_menagerie 网格）装在移动底座上；任务是把抓住的香蕉越过台面上的挡板放进碗里。
- **2D 叠加层（Canvas 2D）**：字幕、眉题、流程框图、公式卡、图表、进度线。两层叠加后既是网页播放器，也是 MP4 的每一帧。
- **测地进度场 T(x)** 用 fast sweeping 在页面内实时求解（`core.js`），以半透明切片平面的形式出现在 3D 场景里；三组布局干预（去掉挡板 / 封顶走侧面 / 加高）用同一套求解器重算。
- **网页版**：发布为 Artifact（three.js 从 cdnjs 加载，字体 Lora + Inter 从 Google Fonts 加载）。
- **MP4**：用 headless Chrome（SwiftShader WebGL）逐帧截图 → ffmpeg，每个场景一个文件再拼接。

## 目录
| 路径 | 内容 |
|---|---|
| `storyboard.md` | 9 个场景的分镜、时间与字幕 |
| `core.js` | 共享引擎：设计 token、文字/图形工具、eikonal 快速扫描求解器、marching squares 等值线、2D 场景与字幕（第一版纯 2D；正在改为 3D + 叠加层） |
| `scene3d.js` | three.js 世界：厨房、Panda（GLB 解析、运动学、阻尼最小二乘 IK）、任务物体、场切片平面、箭头/轨迹、分镜相机、分屏渲染（进行中，尚未联调） |
| `frames.js` | 用 @napi-rs/canvas 离线渲染 2D 版关键帧到 `preview/`（检查构图用） |
| `assets/panda.glb`, `assets/panda_kin.json` | Panda 可视网格（每连杆一个节点、按材质合并，2.4 MB）与运动学参数 |
| `assets/panda_src/` | `panda.xml` + LICENSE（Apache-2.0）；OBJ 网格不入库，用 `scripts/fetch_panda.sh` 重新下载并转换 |
| `scripts/` | `fetch_panda.sh`、`convert_panda.py` |
| `fonts/` | Lora（静态实例，由 Google Fonts 的可变字体生成）与 Inter，均为 SIL OFL；供离线渲染注册 |

## 本地运行
```bash
npm install                      # @napi-rs/canvas, three
node frames.js 6 17 36 80 128    # 2D 版关键帧 → preview/
python3 -m http.server 8787      # 之后在浏览器打开 render.html（待加入）
```
离线 MP4 渲染依赖：Python `playwright`（已安装时可直接驱动系统 Chrome：`/usr/bin/google-chrome`）、`ffmpeg`。

## 进度
- [x] 叠加层 + 3D 世界 + 播放器（`core.js` / `scene3d.js` / `app.js`），`build.js` 生成 `render.html` 与 `index.html`
- [x] 主题对齐：14 章（见 `storyboard.md`）—— 小 VLA 已有技能、遇到新组合时借助教师做对、吸收纠正、逐步撤掉教师；附 SOTA VLA / WAM 的能力缺口（均附来源）、五类方法对比、Guided Policy Search 渊源、“不作为卖点”的部分与可证伪命题
- [x] 无伪数据：删除示意曲线图；屏幕上的数字全部来自引用文献并标注出处
- [x] 深色主题、MathJax 排版公式（不出现 `_` / `^`）、无胶囊气泡、YCB 扫描香蕉
- [ ] MP4 渲染（约 17,760 帧；截图约 1–6 s/帧，需要并行）
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
