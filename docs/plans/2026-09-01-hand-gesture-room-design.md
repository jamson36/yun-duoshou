# Hand Gesture Room Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为“让你花个爽！”全景房间增加用户主动开启、浏览器本地识别、平滑且可随时退出的手势环视、缩放与热点进入能力。

**Architecture:** 摄像头帧只在用户主动授权后发送给同源 Worker。Worker 使用本站托管的 MediaPipe Tasks Vision 运行时和 Gesture Recognizer 模型，向主线程返回手势类别、置信度与单手关键点；纯函数状态机再把结果转换为全景相机增量和热点停留进度。业务路由、订单、评分与目标数据不接触摄像头或手势数据，现有鼠标、触摸、键盘和顶部语义入口始终保留。

**Tech Stack:** 原生 ES Modules、Web Worker、MediaPipe Tasks Vision、MediaDevices、现有 WebGL 全景与 Node 测试。

---

## 已确认的体验合同

- 仅进入房间后显示“手势”入口；点击入口后先展示用途和隐私说明，再由用户点击开启并触发浏览器摄像头授权。
- 首次识别时展示镜像校准画面；稳定识别到手后自动折叠为状态点，点击状态点可以重新查看或停止。
- `Closed_Fist` 加手掌位移控制环视；捏合后上下移动控制缩放；`Pointing_Up` 映射为空气指针，在房间热点停留约 800ms 后激活。
- 握拳环视的水平增益高于垂直增益，一次完整左右挥动应能跨越原先约两次的可视角度；垂直移动、缩放和指向灵敏度保持不变。
- 手势只允许控制全景相机和打开非破坏性的房间入口，不允许操作表单、订单状态、删除、购买确认、目标或消费报告数据。
- 打开功能面板时立即停止推理并释放摄像头；如果进入前手势正在运行，返回房间后在当前页面会话内自动恢复。用户主动停止、页面隐藏、启用减少动态效果、摄像头轨道结束或识别错误都会取消自动恢复资格。
- 权限拒绝、无摄像头、模型失败、低置信度或性能不足都只降级为状态提示，不能阻断原有交互。
- 模型、WASM 和脚本全部同源托管并按需加载；不开启手势时不下载模型，不改变原有首屏执行路径。

## Task 1: 纯函数手势状态机

**Files:**
- Create: `gesture-controls.js`
- Create: `tests/gesture-controls.test.mjs`

1. 先写失败测试，覆盖手掌中心、归一化捏合距离、低置信度忽略、握拳首帧只建锚点、后续位移输出、捏合缩放、指向停留、热点切换重置和冷却期。
2. 运行 `node --test tests/gesture-controls.test.mjs`，确认缺少模块或导出而失败。
3. 实现无 DOM 依赖的 `GestureCommandMapper`，加入指数平滑、死区、速度上限、800ms 停留和 1200ms 激活冷却。
4. 再运行目标测试并确认通过。

## Task 2: 统一全景输入接口

**Files:**
- Modify: `panorama.js`
- Modify: `tests/panorama-flat.test.mjs`

1. 写失败测试，验证环视和缩放增量服从现有 pitch/FOV 边界，减少动态或交互锁定时拒绝控制。
2. 把指针拖动、滚轮与新手势输入汇聚到 `applyInputDelta()`，保持原有操作方向和边界不变。
3. 增加可见热点命中与激活方法，手势不得绕过现有热点点击回调。
4. 运行全景目标测试。

## Task 3: 本地识别 Worker 与运行时资产

**Files:**
- Create: `gesture-recognizer.worker.js`
- Create: `assets/vendor/mediapipe/NOTICE.md`
- Create: `assets/vendor/mediapipe/vision_bundle.mjs`
- Create: `assets/vendor/mediapipe/wasm/*`
- Create: `assets/vendor/mediapipe/gesture_recognizer.task`
- Modify: `tests/server.test.mjs`

1. 固定并记录官方包与模型版本、来源和 Apache-2.0 许可信息。
2. Worker 仅接收可转移的 `ImageBitmap`，初始化后在 `VIDEO` 模式识别单手，返回最小化的类别、置信度和关键点；每帧结束关闭位图。
3. 主线程一次只允许一帧在途，默认间隔约 66ms，避免排队和内存增长。
4. 增加服务端静态文件、MIME 和安全头测试。

## Task 4: 房间启停与校准 UI

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`
- Create: `gesture-ui.js`
- Create: `tests/gesture-ui.test.mjs`

1. 增加顶部手势入口、用途说明、校准视频/关键点画布、状态提示、开始与停止按钮、全景空气指针和停留进度环。
2. `gesture-ui.js` 管理摄像头、Worker、帧节流、校准折叠、错误映射和资源清理；不读写业务状态。
3. `app.js` 只注入全景控制、热点命中/激活和生命周期回调；面板打开时暂停并释放摄像头，回到房间时按会话恢复资格自动重启，减少动态效果时彻底停止。
4. 在 390×844、768px 与 1440×1000 下保持无横向溢出，校准层不遮挡退出按钮和顶部三个入口。

## Task 5: 服务权限与回归

**Files:**
- Modify: `server.mjs`
- Modify: `tests/server.test.mjs`

1. 把摄像头 Permissions Policy 从完全禁用收窄为仅允许当前源；麦克风、定位与支付继续禁用。
2. CSP 保持 `script-src 'self'`、`connect-src 'self'`，不开放远程脚本、模型或连接。
3. 为 `.wasm` 与 `.task` 返回正确类型；根目录仅新增明确列入白名单的手势模块和 Worker。
4. 验证公开路径无法读取源码目录、环境文件或其他内部文件。

## Task 6: 验证与本地交付

1. 运行 `npm test`。
2. 运行 `node --check app.js gesture-controls.js gesture-ui.js gesture-recognizer.worker.js panorama.js scene-config.js server.mjs server/diagnosis-service.mjs`。
3. 运行 `git diff --check` 并确认未触碰既有未跟踪素材。
4. 使用模拟摄像头验证：首次说明前无权限请求、开启/停止、权限拒绝、握拳环视、捏合缩放、指向停留、打开面板时释放摄像头、返回房间自动恢复、主动停止后不再恢复、减少动态效果和普通输入回退。
5. 验证桌面 1440×1000、移动 390×844，并关闭本轮自动化浏览器进程。
6. 启动 `npm start`，保留本地地址供用户用真实摄像头体验；明确这不等于真实移动设备、生产部署或现场验收。

## 变更控制

- 本轮不创建数据库、不修改业务数据结构、评分、AI 协议、路由语义或生产配置。
- 本轮不覆盖现有未跟踪素材，不自动提交、推送或部署；提交步骤因项目交付规则明确省略。
