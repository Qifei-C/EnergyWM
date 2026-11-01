# HANDOFF — EnergyWM MG 动画（交给 cloud session 继续）

日期：2026-11-01。本文档是从 claude.ai 对话会话移交给 Claude Code cloud session 的工作交接。读完本文与 `CLAUDE.md`、`storyboard.md` 即可继续，不需要回看原对话。

## 0. 一句话目标
把研究计划"测地进度场 T(x) + 预测后果模块 → 梯度引导小型 VLA（π0.5 / GR00T）→ 蒸馏 → 教师分三级退出"做成一部 **约 4:42、1920×1080、30 fps、英文字幕、学术汇报风** 的 MG 动画，交付两种形态：
1. **网页播放器**（three.js 3D 场景 + Canvas 2D 叠加层），发布为 claude.ai Artifact（或任何静态托管）；
2. **MP4**（同一套代码在 headless Chrome 中逐帧截图，ffmpeg 编码）。

内容红线：这是研究**计划**（Concept / Hypothesis）。片中任何数字（成功率曲线、门槛、延迟）都必须标为 hypothesis / proposed / to run，不能呈现为结果。字幕文案已写在 `core.js` 各场景的 `captions(...)` 列表里，改动时保持这条红线。

## 1. 用户已确认的需求（不要再问）
- 3D 场景，**必须用 three.js**（用户原话："场景我要3维的，用three js"）。
- 场景用 **RoboCasa 同款厨房 + Franka 模型**（用户原话："就用robocasa相同的场景和franka的模型"）。RoboCasa 的真实资产不在其 GitHub 仓库内（要从 Box/HF 另行下载，云沙箱网络拿不到），所以厨房按 RoboCasa 风格程序化搭建（台面、柜门、瓷砖后挡板、吊柜、灶台+抽油烟机、水槽+窗、Omron 式移动底座），片中标注 "schematic"。Franka Panda 用 mujoco_menagerie 的真实网格（已转好 `assets/panda.glb`）。如果用户之后提供 RoboCasa 资产文件，再替换。
- 交付：网页版 **和** MP4 都要（"两者都要"）；时长 3–5 分钟完整版；学术汇报风·英文。
- 不要用 Motion 类 Artifact（本环境没有）；网页用 Artifact 发布，MP4 用 SendUserFile 交付（cloud session 里等价于放到仓库 release / 输出目录并告知）。

## 2. 当前仓库状态（已提交到 `main`）
| 文件 | 状态 | 说明 |
|---|---|---|
| `storyboard.md` | 完成 | 9 场景、时间、字幕摘要；与 `core.js` 的 `SCENES` 一致（总时长 282 s） |
| `core.js` | **可运行，但仍是"纯 2D 版"** | 含设计 token、文字/图形工具、eikonal fast-sweeping 求解器 `makeField`、marching squares、`buildFields()`（布局 L0/L1/L2/L3 + 局部能量 Eloc + 停滞点 `pStar`）、9 个场景的 2D 绘制与字幕、crossfade 合成。`node frames.js 6 17 36 80 128` 能离线渲染关键帧到 `preview/`（@napi-rs/canvas，130 ms/帧）。已经目视检查过场景 1–3 的构图：标题页好；场景 2 的机械臂画得过大、遮住眉题（这个问题在 3D 版中不存在，因为 2D 世界绘制将被删除）。 |
| `scene3d.js` | **写完但从未运行** | three.js r128（全局 THREE）世界：GLB 解析、Panda 运动学与 IK、厨房、任务物体、场切片平面、箭头/管道、分镜相机、分屏渲染。它依赖 `core.js` 中**尚不存在**的接口（见 §4.1）。预期有若干运行时错误要调。 |
| `frames.js` | 完成 | 2D 版关键帧离线渲染脚本 |
| `assets/panda.glb` (2.4 MB) / `assets/panda_kin.json` | 完成 | 每连杆一个节点（`link0..link7, hand, left_finger, right_finger`），子节点名 `link__material`，只有 POSITION + uint32 索引（法线在 JS 里 `computeVertexNormals`）。MJCF 四元数形如 `1 -1 0 0` **未归一化**，JS 侧已 `normalize()`。关节：7 个 hinge（轴都是局部 z）+ 2 个 slide（手指，轴 y，范围 0–0.04）。 |
| `assets/panda_src/panda.xml`, `LICENSE` | 完成 | OBJ 原始网格被 `.gitignore` 排除（33 MB）；`scripts/fetch_panda.sh` 可重新下载并转换 |
| `fonts/` | 完成 | Lora Regular/SemiBold/Italic/SemiBoldItalic（从 Google 可变字体用 fontTools 实例化）、Inter Regular/Medium/SemiBold/Bold（OTF）。离线渲染用 |
| `package.json` | 完成 | 依赖 `@napi-rs/canvas@0.1.65`、`three@0.128.0`（`npm install` 后 `node_modules/three/build/three.min.js` 可用于本地页面） |

## 3. 已验证的环境事实（省得再试）
- 沙箱网络：**GitHub / raw.githubusercontent.com 可达；unpkg、cdnjs、Google Fonts 不可达**。因此本地渲染页面必须用 `node_modules/three/build/three.min.js` 和 `fonts/` 里的字体；发布版 `index.html` 才用 cdnjs（`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`）与 Google Fonts（`Lora:ital,wght@0,400..700;1,400..700` + `Inter:wght@400;500;600;700`）。
- `/usr/bin/google-chrome`（Chrome for Testing 153）存在；Python `playwright` 已安装（`from playwright.async_api import async_playwright`，`chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-dev-shm-usage'])`）。WebGL2 可用（ANGLE/SwiftShader）。400×300 截图 JPEG q92 耗时 17 ms。`ffmpeg 6.1` 可用。机器 **2 核 / 7 GB**，渲染要控制并发。
- @napi-rs/canvas：`canvas.data()` 像素顺序是 **RGBA**；字体用 `GlobalFonts.registerFromPath`；缺字形不会自动回退，但 **逗号分隔的字体栈可以逐字形回退**（`Inter, "DejaVu Sans"` 能显示 ∇ ∈ ‖）。Inter 缺 ∇ ∈ ⊤ ∪；Lora 缺希腊字母。`core.js` 的 `SANS`/`SERIF`/`MATH` 栈已含 DejaVu 回退。
- trimesh 5.2 的 GLB 导出不做坐标轴转换（保持 MJCF 的 Z-up）；three.js 侧世界也设为 Z-up（`THREE.Object3D.DefaultUp.set(0,0,1)`，相机 `up=(0,0,1)`）。

## 4. 下一步（按顺序）
### 4.1 把 `core.js` 改成"叠加层 + 共享工具"（必须先做，`scene3d.js` 依赖它）
需要新增/导出：
- `core.util = { clamp, lerp, ramp, sramp, easeIO, easeOut, fade, WORLD, FX0, FX1, FZ0, FZ1, rng: mulberry32, arcPath, contactPoint }`，其中 `contactPoint()` 返回场坐标下"香蕉前缘刚碰到挡板"的抓取点 `{x, z}`（当前 2D 版用 `xContact = 0.505`、`z = WORLD.start.z`；换成新几何后重算：`x = barrierX0 − 香蕉半长(0.085) − 余量(0.01)`）。
- `core.F = buildFields()` 在模块加载时构建一次（或在 `createEnv` 后挂到 `core.F`），因为 `scene3d.js` 直接读 `core.F.L0/L1/L2/L3/Eloc_parts/pStar`。
- `core.paintFieldTexture(canvas, mode, cut, opts)`：把场画到给定 2D canvas（1200×640）上供 three.js 做 `CanvasTexture`。`mode ∈ {'T','E'}`；`cut` 为波前截断值（null = 全部）；`opts.field` 选布局键（默认 `'L0'`）；`opts.contoursOnly` 只画等值线（标题页）；`opts.quiver` 为箭头 alpha（0–1）；`opts.top` 表示顶视图（L2）。可直接复用现有 `drawField/drawContours/drawQuiver`，用 `makeView(0,0,1200,FX0,FX1,FZ0,FZ1)` 做映射。注意：纹理 y 轴方向 —— `PlaneGeometry` 的 UV v=0 在下方；现有 `fieldImage` 已经翻转过 y，确认最终纹理方向正确（挡板在平面上应该立在底部）。
- **删除** 2D 世界绘制：`drawTable/drawBarrier/drawBowl/drawGripper/drawBanana` 以及场景 2/3/4/5/7 里对它们的调用；这些内容改由 3D 层负责。叠加层保留：`eyebrow`、`captions`、`progressLine`、标题文字、场景 3 的 τ 进度条与右侧流水线框图、场景 4 的内嵌 E–z 曲线与事实卡、场景 5 的公式卡/要点/三张 caveat 卡/五个阶段 chip、场景 6/8/9 的框图与图表、场景 7 的两个 verdict chip 与面板标题。
- 新增 **3D 锚定标签**绘制：`scene3d.js` 每帧产出 `world.labelsOut = [{pos: THREE.Vector3, text, color, size, weight, alpha, align, math}]`；叠加层用 `world.project(pos)` 投影到 1920×1080 像素后画文字。场景 2 的两个红叉（`cross()`）也要改为画在投影位置（waypoint 路径中点、候选扇中心）。
- 场景 6/8/9 以及场景 5 后半段（u≥34）是框图场景：在 3D 背景上先铺 `rgba(paper, 0.88)` 的 wash 再画卡片，否则不可读。
- `WORLD` 常量改为新几何（场坐标）：`barrierX0=0.51, barrierX1=0.55, barrierH=0.24, bowlX=0.81, bowlR=0.085, bowlH=0.075, rObj=0.045, goal={x0:0.75,x1:0.87,z0:0.03,z1:0.10}, start={x:0.30,z:0.17}`；L2 顶视图布局的墙 `x∈[0.51,0.55], y∈[0,0.50]`，目标 `x∈[0.75,0.87], y∈[0.26,0.38]`；L3 挡板高 0.42；停滞点 `pStar` 在 `z=0.17` 沿 x 二分求力平衡点（现有代码搜索区间 `[0.30, 0.515]` 需改为 `[0.30, 0.465]`，即贴着膨胀后的挡板左缘 `barrierX0 − rObj`）。
- 相应地 `sceneGuide/sceneTask` 里直接写死的 2D 坐标（0.33、0.98、0.46 等）统一改为从 `WORLD` 推导。

### 4.2 写 `app.js`（浏览器端胶水）
- 两个 canvas 叠放：`#gl`（three.js，逻辑尺寸 1920×1080，`renderer.setSize(1920,1080,false)`，CSS 缩放到容器）和 `#ui`（2D，同尺寸同缩放，`pointer-events:none`）。
- 启动：`await document.fonts.load(...)`（Lora 600/400/italic、Inter 400/500/600）→ `world = await MGScene.createWorld(glCanvas, assetBase)` → `env = core.createEnv(makeCanvas)`（其中 `makeCanvas = (w,h) => Object.assign(document.createElement('canvas'), {width:w,height:h})`）→ 设 `window.__ready = true`。
- `renderAt(t)`：`world.update(t)` → `world.render()` → `core.draw(uiCtx, t, env, world)`（叠加层需要 `world.project` 与 `world.labelsOut`，把 `world` 挂进 `env`）。
- 播放器 UI（学术风，页面有 light/dark 两套 token，但 canvas 画面固定 paper 配色）：播放/暂停、拖动条（带 9 个场景刻度与名称 tooltip）、场景跳转列表、倍速 0.5/1/1.5/2、键盘（空格、←/→ 5 s、1–9 跳场景、F 全屏）、时间码。页面宽度 400 px 也要能看（控件换行、canvas 等比缩放），遵守 Artifact 页面契约（16 px 侧边距、`<title>` 为短名、theme tokens 在 `:root` 定义并在两个 dark 块中重定义、`body` 有显式背景）。
- 无头接口：URL 带 `?headless=1` 时不启动 rAF、不渲染控件；暴露 `window.__render(t)`（同步渲染一帧并返回 true）与 `window.__ready`（Promise 或布尔）。
- 性能：`sceneGuide` 每帧重建 `TubeGeometry`，先 `dispose` 旧几何（已写）；场纹理 1200×640 每帧重绘只发生在场景 4/5（波前动画），其余帧可缓存（按 `(mode, field, cut 四舍五入到 1/200)` 做 key）。

### 4.3 构建脚本 `build.js`
从一个模板生成：
- `render.html`：`<script src="node_modules/three/build/three.min.js">`，`@font-face` 指向 `fonts/*.ttf|otf`（通过本地 http 服务读取），再内联或引用 `core.js`、`scene3d.js`、`app.js`，资产路径 `assets/`。
- `index.html`（发布用，单文件自包含除 CDN 外）：three.js 走 cdnjs r128，字体走 Google Fonts；`core.js/scene3d.js/app.js` 内联；`assets/panda.glb`、`assets/panda_kin.json` 作为 Artifact 的 supporting `files` 一起发布（`fetch('panda.glb')` 相对路径）。注意 Artifact 的 CSP：外部脚本只允许 cdnjs/jsdelivr/unpkg/tailwind/jquery，外部样式只允许 Google Fonts，其余都要内联；页面会被套上 skeleton，所以不要自己写 `<!doctype>/<html>/<head>/<body>`，`<title>` 与 `<style>` 放文件顶部，并加 `<meta name="claude:viewport-fit-sides" content="cover">` 搭配两侧 `max(16px, env(safe-area-inset-*))` padding。

### 4.4 联调 `scene3d.js`（预期要修的点）
1. 本地起服务 `python3 -m http.server 8787`，用 Playwright 打开 `http://localhost:8787/render.html?headless=1`，`page.on('console')` 打印错误，`await page.wait_for_function('window.__ready === true')`，然后 `page.evaluate('window.__render(17)')` + 截图。先看 t = 6, 17, 25, 36, 47, 80, 95, 120, 128, 141, 157, 185, 212, 243, 275 这 15 帧。
2. **IK 可达性**：Panda 装在 `robotMount=(0.30,−0.38,0.73)`，目标点在台面 y=0.22、z≈1.09（场 z 0.17 + 台面 0.92）；碗在世界 x=0.56。若 IK 残差大（手够不到或姿态怪），调 `robotMount`（y 更靠近台面或底座更高）或把目标姿态的 `wRot` 降到 0.2；检查 `fk()` 的 tcp 偏移 0.1034 是否与 GLB 的手指位置一致（手指在 hand 帧 z=0.0584 处，再加指长≈0.045）。
3. **关节方向**：验证 `apply()` 用 `bodyQuat × R(axis,q)` 的顺序是否让机械臂形态与 MuJoCo 一致（可以把 `q=[0,0,0,0,0,0,0]` 的 FK 末端位置与 MuJoCo 已知值对比：全零姿态下 Panda 法兰大约在 (0.088, 0, 0.926)+ 手部）。
4. **相机构图**：`CAM_MAIN=[1.05,−1.85,1.95 → 0.28,0.22,1.00, fov 36]` 是 RoboCasa agentview 式的前高位；`CAM_SIDE` 更贴近台面正面用于看切片平面；分析场景（4/5）里机械臂透明度降到 0.32，让平面可读。按截图调整。
5. **场切片平面**：`PlaneGeometry` 绕 x 转 90° 后应竖立在 x–z 平面；确认纹理上下没有反、挡板纹理位置与 3D 挡板重合；顶视图平面在 z=台面+0.17，L2 的墙加长到 y∈[−0.10,0.40] 并显示 `roof`。
6. **分屏**（场景 7）：`render()` 用 scissor 渲染两次，每次先摆姿态再 `updateMatrixWorld`；叠加层的两个面板标题位置要与半屏对齐。
7. 右手指节点 `right_finger` 的 quat 是 `0 0 0 1`（绕 z 转 180°），所以手指滑动方向在父帧里也要翻转 —— 现在 `apply()` 对两根手指都加了 `+y`，若右指反向就改成 `−y`。
8. 阴影在 SwiftShader 下较慢，如果单帧 > 400 ms，考虑关掉 `shadowMap` 或把 mapSize 降到 1024。

### 4.5 渲染 MP4（`render.py`）
- 一个场景一个文件：对每个场景 `[start, start+dur)` 以 1/30 s 步进，`page.screenshot(type='jpeg', quality=92)` → 直接 pipe 给 `ffmpeg -f image2pipe -framerate 30 -i - -c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium -movflags +faststart out/tmp_sceneNN.mp4`，成功后 `rename` 为 `out/sceneNN.mp4`；最后 concat demuxer `-c copy` 得到 `out/energywm_full.mp4`。crossfade 已在引擎内按全局时间合成，分文件只是切分时间轴。
- 2 核机器：最多 2 个 Chrome 进程并行（按场景分配）。先渲染 5 帧测速，再决定并发。预计单帧 0.2–0.5 s，全片 8460 帧约 30–60 分钟。
- 完成后用 `ffprobe` 校验总时长 ≈ 282 s、分辨率、帧率；抽查每个场景首尾帧。

### 4.6 发布与交付
- 用 Artifact 工具发布 `index.html`（icon 建议 `"film"`），`files` 里带上 `assets/panda.glb`、`assets/panda_kin.json`；标题用 "Energy-Field Teachers for Small VLAs"。
- MP4 放到仓库外的输出目录并通知用户（文件约 150–300 MB，不要提交到 git；可以上传到 GitHub Release）。
- 在 `README.md` 更新完成状态。

## 5. 设计要点速查（避免再查对话）
- 配色（canvas 固定）：paper `#F6F7F9`、ink `#1C2533`、mute `#5B6676`、VLA/flow 蓝 `#2F5BB7`、教师/能量梯度橙 `#D4702A`、测地场 T 青 `#17907F`、碰撞红 `#C43D32`、成功绿 `#3A8F5C`、香蕉 `#E7B93A`、挡板 slate `#6F7D90`。图表只有一张（场景 9，蓝/橙/slate 三条线，已通过 CVD 检查），标注 "ILLUSTRATIVE HYPOTHESIS — NOT RESULTS"。
- 场景顺序与时长（s）：Title 10 · Task & constraints 30 · Guidance 32 · Why local attraction fails 36 · Geodesic field 54 · Teacher→student 38 · Fast/slow 26 · Experiments & E0 30 · Retirement 26 = 282。
- 研究内容的关键修正（已反映在字幕里，改字幕时别改回去）：测地梯度 `−∇T = d̂/S`（不是 `S·d̂`）；进度项用窗口铰链 `E_adv=[T(x_H)−T(x_0)+δ]_+²`（下降锥允许"不动得零分"，只作可选正则）；T 是价值场不是路径；T 无伪极小不代表动作代价无停滞；快慢测试只支持"几何不够"，证明 JEPA 必要还需解析抓持稳定性基线；阶段只按接触许可切换（approach/grasp/transport/place/release），没有"越障"阶段；教师退出分三级（L1 预测教师关、L2 学习型 R_ψ 关但几何引导仍在、L3 全部引导关）；软阶段权重 `g_k=c_{k−1}−c_k` 加 `g_done=c_K`。

## 6. 验收清单
- [ ] `render.html` 在 headless Chrome 中无 console error，15 张关键帧构图可读（字幕不压台面、箭头方向正确：场景 4 净力无向上分量、场景 5 −∇T 朝上越过挡板、顶视图箭头绕向开口）。
- [ ] 网页播放器可播放/拖动/跳场景，400 px 宽可用，light/dark 两套页面主题都正常。
- [ ] MP4：282 s ±1 s、1920×1080、30 fps、场景切换处 0.5 s crossfade 连续、无黑帧。
- [ ] 全片没有把任何数字说成结果。
