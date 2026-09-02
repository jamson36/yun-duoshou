# 欲望剥壳机与手势联动 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在首页右侧掌机位置新增一个 45 秒、可选进入的“欲望剥壳机”，让各式包裹着促销话术外壳的商品从画面底部被抛起，用户用触控、鼠标、键盘或已主动开启的手势在空中剥开话术外壳，并在结束后通过一次明确选择把体验连接到现有“假装下单 / 订单处理”流程。

**Architecture:** 游戏作为房间之上的独立 <code>activity</code> 层存在，使用版本化本地配对词库和确定性的纯函数引擎保存局内状态，Canvas 只负责画面，语义化 DOM 负责操作与无障碍回退。现有手势 Worker 增加受控的游戏输入上下文，但摄像头授权、订单事实和路由事实仍由现有模块掌管；游戏不建立数据库、不调用在线能力、不直接创建或修改订单。

**Tech Stack:** 原生 ES Modules、HTML、CSS、Canvas 2D、现有 MediaPipe GestureRecognizer Worker、Node 内置测试运行器、现有同源 Node 服务。

---

## 0. 当前状态与交付边界

本文是已确认方向的完整本地实现方案，不代表代码已经实现。

- 本轮产物：实现边界、状态机、模块拆分、测试清单、浏览器验收矩阵、工期、发布门禁，以及基于网络调研整理的 65 对首发话术。
- 本轮不做：修改业务代码、生成最终美术、启动服务、提交、推送或部署。
- 实施顺序必须保持：本地修改 → 本地启动 → 本地自动化与浏览器验证 → 展示给用户 → 等待明确确认 → 才可部署。
- 首页顶部仍只有“消费测试 / 假装下单 / 预算计划”三个语义入口；游戏是房间探索入口，不新增第四个一级导航。
- 游戏不是电商、真实支付或抽奖；“看穿层数”等反馈只存在于当局，不进入消费人格、目标、订单统计或报告。
- 不修改冻结的活动版 PRD。新增机制及其边界写入 <code>DESIGN.md</code>。

## 1. 已确认的产品方案

### 1.1 名称与入口

- 用户名：欲望剥壳机。
- 场景入口：首页全景房间右侧货架上的掌机。
- 热点类型：<code>activity</code>，与三个核心 <code>feature</code> 热点、快递堆 <code>thought</code> 热点分开。
- 初始估算坐标：<code>yaw -35.5° / pitch 17°</code>。
- 初始聚焦参数：<code>yaw -35.5° / pitch 14° / fov 34°</code>。
- 上述坐标只作为实现起点，必须在 1440×1000、390×844 和 768px 三档浏览器中校准后再冻结。
- 点击或通过房间手势驻留掌机热点时，镜头在约 300–500ms 内聚焦，同时立即打开游戏介绍层，不等待镜头动画结束。

### 1.2 一局体验

正式单局 45 秒。首次进入先用一件商品完成不计时的极短教程，成功后才开始正式倒计时；重玩同一会话时直接进入正式回合：

| 时间 | 出现内容 | 意图 |
|---|---|---|
| 教程，不计时 | 慢速抛起一杯带超大“限时”外壳的奶茶，在顶点短暂停留 | 明确“剥开话术、保留商品”的核心规则 |
| 0–20 秒 | 从底部抛起带单层话术外壳的奶茶、耳机、键盘、相机等商品 | 熟悉不同尺寸、速度和轨迹 |
| 20–38 秒 | 抛起带单层或双层组合话术的鞋、包、盲盒等商品 | 识别“限时 + 爆款”“低月供 + 奖励自己”等叠加推动 |
| 38–45 秒 | 抛起本局聚焦商品与中性问号外壳，其他物体减少生成 | 从爽感自然转入一次反思 |

默认主画面必须采用类似经典划切游戏的动态抛物线机制，不是静态棋盘或 3×3 宫格：

1. 教程与正式回合全部使用商品，不出现水果或其他无关物体。
2. 教程商品在可视区底边以下生成，慢速抛至顶点后暂停，直到用户剥开外壳或点击“直接开始”；教程期间不倒计时。
3. 正式商品也在可视区底边以下生成，从底部向上抛出。
4. 每个商品道具由“完整商品本体 + 一至两层促销话术外壳”组成；外壳可切，本体不可切。
5. 每个道具有初始水平速度、向上的初始速度、重力和轻微自转，沿抛物线升至顶点后自然回落。
6. 同屏通常保持 1–4 个可切道具，极端情况下也不得超过 8 个。
7. 用户的手指、鼠标或手势轨迹形成连续切割线段；线段首先命中当前最外层话术外壳。
8. 命中后，外壳沿切线方向分成两片并在 350–600ms 内旋转下落；若还有内层话术则立即露出下一层。
9. 所有话术外壳都被剥开后，商品本体保持完整，短暂显示已有的商品名和真实价格，再完整落入画面底部的“冷静篮”。缺少价格时不补造数值。
10. 已剥净的商品本体不再响应切割；轨迹经过时只给轻微光圈，表达“商品不是敌人，冲动也不需要被惩罚”。
11. 未命中的道具继续落回屏幕底部并清理，不扣分、不震屏、不显示失败叉号。
12. 出场间隔、初速度和重力使用归一化屏幕单位，保证手机与桌面具有相近飞行时长；实现后在四档视口中校准。

局内反馈：

- 教程奶茶成功剥壳后完整落入冷静篮，不计入正式结果。
- 每剥开一层话术：局内“看穿层数”+1，外壳碎裂并显示中性提示，如“看穿一个购买推动词”。
- 1.2 秒内连续剥开多层时可以显示短暂的“连续看穿 ×2 / ×3”，但不保存连击、不形成排行榜。
- 切割已经露出的商品本体不加分、不损坏商品，也不显示错误惩罚。
- 漏掉物体不扣分，不制造失败压力。
- 不设置排行榜、连胜记录、分享攀比、稀有掉落、抽奖或付费道具。
- “看穿层数”和连续反馈仅用于本局节奏，关闭后丢弃。

### 1.3 聚焦商品的选择

聚焦商品按以下确定性顺序选择：

1. 当前浏览器最近更新的一笔“欲望冷却中”个人订单。
2. 若没有个人冷静订单，从版本化本地商品池按固定种子选择。
3. 演示数据不优先于个人数据，并在界面中保留 <code>demo</code> 标记。

外壳话术来自版本化本地词库 <code>peel-copy-v1</code>。首发按时间压力、数量稀缺、价格锚点、支付拆小、凑单组合、社会证明、身份投射、情绪奖励、收藏补全、赠品诱导、算法缘分、自我升级和优惠券损失厌恶 13 个家族整理 65 对“诱因外壳 + 原创反梗”，详见 <code>docs/research/2026-09-02-peel-copy-patterns.md</code>。

网络只用于编辑阶段发现常见话术结构，客户端不实时抓取、不复制品牌广告，也不调用在线 AI 生成局内文案。所有带库存、销量、金额或时限的外壳都必须显示“话术样本”标识，不能冒充聚焦商品的真实促销事实。个人订单如果没有结构化触发原因，只使用“是什么在推着我？”这样的中性问号外壳，不得擅自归因。禁止使用在线 AI 随机生成商品、价格、图片或促销话术。

### 1.4 结果页与业务联动

结果页先问一个低压力问题：

> 这一局里，哪种话术最容易推着你走？

候选项只来自本局实际出现过的话术，并提供“没什么感觉”。用户选择后可即时生成一句不保存的 if-then 提醒，例如：

> 下次看到“限时”，我先放进冷静区，再决定。

随后提供三个明确按钮：

1. “放进冷静区”
2. “只是玩玩”
3. “再来一局”

“放进冷静区”只表达用户意图，不直接落业务数据：

- 聚焦对象来自已有冷静订单：打开现有订单详情或订单列表并聚焦该订单，不创建副本。
- 聚焦对象来自本地商品池：调用现有商品预填适配器，打开下单表单；只有用户提交表单后才创建“欲望冷却中”订单。
- 聚焦对象无法映射到商品：打开空白下单表单。

游戏代码不得调用 <code>simulateCommerceOrder</code>、<code>createOrder</code>，也不得修改订单状态、目标、消费人格、同意状态或报告。

“只是玩玩”返回房间；“再来一局”重新初始化局内状态。所有业务动作必须继续由触控、鼠标或键盘确认。

## 2. 输入、手势与隐私设计

### 2.1 四条等价输入路径

| 输入 | 房间进入 | 游戏切割 | 结果页业务按钮 |
|---|---|---|---|
| 触控 | 点击热点 | 手指划动或点击目标 | 支持 |
| 鼠标 | 点击热点 | 按住拖动或点击目标 | 支持 |
| 键盘 | 聚焦并 Enter / Space | 方向键移动可见刀锋，Space / Enter 划切 | 支持 |
| 屏幕阅读器辅助 | 聚焦并 Enter / Space | 在当前空中目标间切换并切开所选目标 | 支持 |
| 摄像头手势 | 食指指向并驻留 | 食指轨迹划过目标 | 禁止 |

触控、鼠标和键盘始终可用，不以摄像头成功为前提。

### 2.2 手势映射

- 房间保持现有 <code>Pointing_Up</code> 指向与驻留进入。
- 游戏中仅使用食指指尖坐标形成连续线段。
- <code>Open_Palm</code> 及无手状态视为中性，不触发切割。
- <code>Closed_Fist</code>、捏合等动作不绑定业务或游戏命令，避免误触。
- 最低识别置信度沿用 <code>0.68</code>。
- 连续丢失手部超过 600ms 时自动暂停计时，并显示“手暂时离开画面”；恢复后继续。
- 同一物体命中去重窗口 120ms。
- 视觉目标直径建议 88–120 CSS px，手势碰撞半径在视觉半径上扩大 20%。
- 坐标继续镜像，保证屏幕上的手和游标移动方向一致。

### 2.3 摄像头生命周期

场景 A：用户已经在房间主动开启手势。

1. 手势驻留掌机热点或点击热点进入。
2. 复用现有摄像头流和 Worker，不重复申请权限、不重复加载模型。
3. 游戏期间结果帧只进入游戏映射器，不再控制房间全景。
4. 进入结果页前立即停止媒体轨道；可保留已经就绪的 Worker。
5. 用户返回房间时，只有原会话仍符合自动恢复条件才重新获取摄像头。

场景 B：用户未开启手势。

1. 直接以触控、鼠标、键盘模式进入。
2. 游戏介绍层可提供次要按钮“开启体感剥壳”。
3. 只有用户点击该按钮后才调用摄像头权限。
4. 拒绝、超时或设备不可用时，显示一次非阻断提示并继续普通输入。

场景 C：用户主动停止摄像头。

- 当次会话不自动恢复。
- 游戏和房间都回退到普通输入。

隐私说明改为：

> 摄像头画面只在当前浏览器中用于房间手势和你主动选择的体感剥壳，不保存、不写入订单或目标，也不会发送到本站接口。普通功能页和游戏结果页会关闭摄像头；触控、鼠标和键盘始终可用。

### 2.4 减少动态效果与无障碍

- Canvas 标记 <code>aria-hidden="true"</code>。
- 普通玩家看到的唯一主玩法是“道具从底部抛起并在空中划切”，页面不得同时展示 3×3 静态目标网格。
- 视力正常的键盘用户把焦点留在游戏舞台上：方向键移动可见刀锋，Space / Enter 生成一小段切割轨迹，仍然命中同一批正在飞行的道具。
- 为屏幕阅读器提供一个持久、不会因道具掉出画面而丢失焦点的“当前空中目标”控制器：上一个目标、剥开当前外壳、下一个目标。它只引用当前引擎中仍有话术外壳的活动道具，操作时仍调用同一命中与“看穿层数”逻辑。
- 屏幕阅读器辅助控件默认视觉隐藏；检测到辅助模式、键盘专用模式或用户主动展开后才显示，不占用普通游戏画面。
- 所有操作目标至少 44×44px。
- 看穿层数、暂停、剩余时间和结果使用节制的 <code>aria-live</code> 播报，不能每帧播报。
- 开启“减少动态效果”时仍保持“从底部出现”的空间逻辑，但改为低幅度、低速度的垂直升起—短暂停留—下沉；取消高速抛物线、旋转、爆裂粒子和倒计时压力。只有用户主动选择纯静态辅助模式时，才改用逐个目标按钮。
- <code>Esc</code>、关闭按钮和浏览器后退均返回上一层；关闭后焦点回到掌机热点或原触发按钮。
- Canvas 或商品素材失败时，才启用语义化目标列表作为故障降级；这不是正常视觉玩法。

## 3. 路由、状态机与数据流

### 3.1 路由

- 游戏入口路由：<code>#room?activity=peel</code>。
- 局内阶段、看穿层数、物体位置不写入 URL。
- 普通刷新进入游戏介绍页，不恢复到半局状态。
- 浏览器后退从游戏回到 <code>#room</code>，再按现有层级处理。
- 游戏触发“放进冷静区”后，由现有路由打开下单或订单页面。

### 3.2 状态机

~~~text
IDLE
  └─ open ─> READY
READY
  ├─ first start ─> TUTORIAL
  ├─ replay start ─> PLAYING
  └─ close ─> CLOSED
TUTORIAL
  ├─ first shell peeled / skip ─> PLAYING
  └─ close ─> CLOSED
PLAYING
  ├─ visibility lost / hand lost / help ─> PAUSED
  ├─ timer finished ─> SUMMARY
  └─ close ─> CLOSED
PAUSED
  ├─ resume ─> PLAYING
  └─ close ─> CLOSED
SUMMARY
  ├─ replay ─> READY
  ├─ cool intent ─> CLOSED + existing business adapter
  └─ dismiss ─> CLOSED + room
CLOSED
  └─ cleanup ─> IDLE
~~~

关键不变量：

- 同一时刻只存在一个游戏实例和一个动画帧循环。
- <code>TUTORIAL</code> 不推进 45 秒计时；教程商品到达顶点后冻结，完成或跳过才进入 <code>PLAYING</code>。
- <code>tutorialSeen</code> 只保留在当前游戏控制器会话，不写入 LocalStorage。
- <code>SUMMARY</code> 前停止计时和输入采样。
- 进入 <code>SUMMARY</code> 前释放摄像头轨道。
- 关闭后清理 <code>requestAnimationFrame</code>、事件监听、实体数组和粒子。
- 同一输入、同一商品池版本、同一种子得到同样的出场序列和聚焦商品。

### 3.3 数据流

~~~text
scene-config activity hotspot
        │
        ▼
route-sync: #room?activity=peel
        │
        ▼
app.js activity coordinator
        │
        ├── peel-game-ui.js ── Canvas + accessible controls
        │         │
        │         ▼
        │    peel-game.js pure engine
        │         │
        │         ▼
        │    peel-copy-catalog.js
        │
        └── gesture-ui.js activity context
                  │
                  ▼
          peel-gesture-controls.js

SUMMARY user intent
        │
        ▼
app.js business adapter
        ├── existing cooling order: open/focus
        └── catalog item: prefill existing order form
~~~

## 4. 文件级设计

### 4.1 新增文件

| 文件 | 职责 |
|---|---|
| <code>peel-game.js</code> | 纯函数游戏引擎、商品与话术外壳实体、确定性出场、碰撞、计时和结算 |
| <code>peel-copy-catalog.js</code> | 65 对版本化本地话术、家族元数据、已审核双层组合与中性问号壳 |
| <code>peel-gesture-controls.js</code> | 手势结果到归一化剥壳线段的映射 |
| <code>peel-game-ui.js</code> | Canvas 动态抛物线舞台、键盘刀锋、屏幕阅读器辅助、输入适配、生命周期和渲染 |
| <code>tests/peel-game.test.mjs</code> | 引擎单测 |
| <code>tests/peel-copy-catalog.test.mjs</code> | 词库结构、编辑边界、版本与确定性选择测试 |
| <code>tests/peel-gesture-controls.test.mjs</code> | 手势映射单测 |
| <code>tests/peel-game-ui.test.mjs</code> | DOM、键盘、Canvas 降级与清理单测 |
| <code>tests/peel-game-integration.test.mjs</code> | 路由、手势上下文、业务适配集成测试 |
| <code>tests/peel-game-layout.test.mjs</code> | 静态结构、响应式与无障碍约束 |
| <code>assets/peel-game/ASSET-MANIFEST.md</code> | 原创商品本体、话术外壳和反馈素材来源、尺寸及版本 |
| <code>docs/research/2026-09-02-peel-copy-patterns.md</code> | 网络话术模式调研、65 对首发原创回应、编辑规范和来源记录；本方案阶段已形成 |

### 4.2 修改文件

| 文件 | 变更 |
|---|---|
| <code>scene-config.js</code> | 注册 <code>activity</code> 热点与焦点参数 |
| <code>panorama.js</code> | 渲染和激活 activity 热点；房间手势允许列表显式支持 activity |
| <code>route-sync.js</code> | 解析和构建 activity 查询参数 |
| <code>gesture-controls.js</code> | 抽出共享镜像坐标函数 |
| <code>gesture-ui.js</code> | 增加房间 / 游戏两个输入上下文及摄像头切换 API |
| <code>index.html</code> | 游戏对话层、动态舞台、键盘刀锋与屏幕阅读器辅助控件、结果页和隐私文案 |
| <code>styles.css</code> | 掌机热点、游戏层、响应式、减少动态和降级样式 |
| <code>app.js</code> | 活动协调、路由接入、商品选择和结果意图适配 |
| <code>server.mjs</code> | 新根目录模块静态白名单 |
| <code>Dockerfile</code> | 复制新根目录模块和游戏素材 |
| <code>DESIGN.md</code> | 记录 activity 层、状态机、隐私和业务边界 |

### 4.3 商品与素材池

第一版只使用原创、低刺激、无品牌商品插画：

- 教程：带超大“限时”外壳的奶茶。
- 饮品：奶茶、咖啡、气泡水。
- 数码：头戴耳机、机械键盘、相机。
- 日用兴趣：运动鞋、通勤包、盲盒、香薰、露营灯。
- 单层话术外壳覆盖 13 个家族、65 对内容，例如“最后一天 → 这个‘最后一天’挺长情”“每天一杯奶茶钱 → 总价请出来说句话”“刷到就是缘分 → 划走也算有缘告别”。
- 双层组合必须来自人工审核白名单，例如“最后一天 + 大家都在买”“月付没压力 + 奖励一下自己”“就差这一款 + 你的券要过期了”。

商品本体和话术外壳必须作为两套独立素材与数据组合：

- 第一版约 10 个商品本体，不为每种话术重复绘制商品。
- 65 对配对话术按 <code>peel-copy-v1</code> 冻结；运行时只显示短句和回应，不显示内部来源标签。
- 话术比例为 40% 直给拆解、40% 轻梗吐槽、20% 温和提醒；同一句每局最多一次，同一家族连续最多两次。
- 只有标记为兼容的家族可以组成双层，不在运行时任意拼接长文案。
- 同一商品或同一品类不得连续出现超过两次。
- 大小差异由统一 hitbox 规则归一化，避免相机等小物件难切、通勤包等大物件过易。
- 商品与外壳组合由版本化种子决定，可重现且方便自动化测试。
- 带数字或时限的外壳必须固定显示“话术样本”，不得与商品真实价格、库存、销量或活动状态绑定。
- 个人订单无结构化触发原因时绕过促销词库，仅从中性问号壳中确定性选择。

素材要求：

- 不出现商标、品牌包装、平台 UI 或真实商品图。
- 不直接复制品牌广告、主播口播或平台专属句式；网络调研只用于提炼机制与语言节奏。
- 单张优先 WebP 或紧凑 SVG；总下载预算不超过 800KB。
- 游戏逻辑与词库 JavaScript 合计新增体积目标小于 65KB 未压缩。
- 首次打开游戏时再加载，不阻塞房间首屏。
- 素材加载失败时用 CSS 形状与文字标签降级。

## 5. 分阶段实施任务

以下任务按 TDD 顺序执行。每个提交点都只是建议检查点；只有用户明确要求提交时才执行，且只精确暂存本任务文件。

### Task 0：冻结基线与建立验收记录

**Files:**

- Inspect: <code>AGENTS.md</code>
- Inspect: <code>让你花个爽！活动网页产品需求文档 (PRD).md</code>
- Inspect: <code>DESIGN.md</code>
- Inspect: <code>scene-config.js</code>
- Inspect: <code>panorama.js</code>
- Inspect: <code>gesture-controls.js</code>
- Inspect: <code>gesture-ui.js</code>
- Inspect: <code>route-sync.js</code>
- Inspect: <code>app.js</code>
- Inspect: <code>server.mjs</code>
- Inspect: <code>Dockerfile</code>

**Step 1: 记录工作区，不覆盖用户修改**

Run:

~~~bash
git status --short
git diff -- scene-config.js panorama.js gesture-controls.js gesture-ui.js route-sync.js app.js index.html styles.css server.mjs Dockerfile DESIGN.md
~~~

Expected: 输出当前修改与未跟踪文件；实施记录中标明哪些不是本轮变更。

**Step 2: 跑现有基线**

Run:

~~~bash
npm test
node --check app.js
node --check personality-scoring.js
node --check panorama.js
node --check scene-config.js
node --check server.mjs
node --check server/diagnosis-service.mjs
git diff --check
~~~

Expected: 记录每条命令的真实结果。若基线已有失败，先归档失败，不把它算作游戏回归。

**Step 3: 截取入口基线**

- 本地启动 <code>npm start</code>。
- 在 1440×1000 和 390×844 截取当前右侧掌机位置。
- 记录热点校准坐标、滚动宽度和控制台状态。
- 验证结束后关闭本轮自动化浏览器进程。

### Task 1：实现确定性纯函数剥壳引擎

**Files:**

- Create: <code>peel-copy-catalog.js</code>
- Create: <code>peel-game.js</code>
- Create: <code>tests/peel-copy-catalog.test.mjs</code>
- Create: <code>tests/peel-game.test.mjs</code>
- Reference: <code>docs/research/2026-09-02-peel-copy-patterns.md</code>

**Step 1: 写失败测试**

覆盖：

- 词库版本为 <code>peel-copy-v1</code>，13 个家族各不少于 5 对，总数不少于 65 对。
- 每条 ID 唯一，外壳与回应非空且满足移动端长度预算。
- 带数字或时限的条目显式标记为虚构话术样本，不能被当作商品事实。
- 词库不含品牌、平台、服务商、模型、羞辱或绝对化诊断词。
- 已审核双层组合引用的 ID 和家族都存在且兼容。
- 同一种子选择相同；单局不重复整句，同一家族连续不超过两次。
- 初始状态为 <code>READY</code>，没有实体且看穿层数为 0。
- 同一种子得到相同出场序列。
- 商品本体与外壳独立组合，同一商品或品类不会连续出现超过两次。
- 首次 start 进入 <code>TUTORIAL</code>，教程实体是带“限时”外壳的奶茶。
- 教程商品到达顶点后冻结，教程期间正式 elapsed 始终为 0。
- 剥开教程外壳或 skip 后才进入 <code>PLAYING</code> 并从 0 秒计时。
- replay start 跳过教程直接进入 <code>PLAYING</code>。
- 0–20、20–38、38–45 秒进入正确正式阶段。
- 新实体从可视区底边以下生成，初始垂直速度向上。
- 正式商品实体包含不可切的商品本体和一至两层可切的话术外壳。
- advance 后实体先上升、到达顶点、再在重力作用下落回底部。
- 同一配置在不同视口比例下保持接近的飞行时长。
- 被剥开的外壳碎片继承原始速度并继续下落，超过清理边界后移除。
- 每次只剥最外层，双层外壳必须命中两次。
- 每层外壳只结算一次，看穿层数每层 +1。
- 所有外壳移除后商品本体保持完整，并进入 <code>revealed</code> 状态。
- 已 <code>revealed</code> 的商品本体不再响应切割。
- 个人订单缺少结构化触发原因时只能使用中性问号外壳。
- 只显示已有商品价格，缺少价格时不产生占位金额。
- 教程奶茶只剥外壳，商品本体保持完整，且不计入看穿层数。
- 漏切不扣分。
- 暂停期间 elapsed 不增长。
- 第 45 秒只结算一次并进入 <code>SUMMARY</code>。
- replay 清空看穿层数、连续反馈和实体。
- focus item 优先最近冷静订单，否则使用确定性商品池。

Run:

~~~bash
node --test tests/peel-copy-catalog.test.mjs tests/peel-game.test.mjs
~~~

Expected: FAIL，提示模块或导出不存在。

**Step 2: 实现最小 API**

建议导出：

~~~js
// peel-copy-catalog.js
export const PEEL_COPY_VERSION = "peel-copy-v1";
export const PEEL_COPY_CATALOG = [];
export const APPROVED_DOUBLE_SHELLS = [];
export const NEUTRAL_QUESTION_SHELLS = [];
export function selectShellSequence({ seed, phase, history, item }) {}

// peel-game.js
export const PEEL_GAME_VERSION = "peel-v1";
export function createPeelGame(config) {}
export function startRound(state, now) {}
export function advanceRound(state, now) {}
export function applyPeelSegment(state, segment, now) {}
export function pauseRound(state, reason, now) {}
export function resumeRound(state, now) {}
export function selectFocusItem({ orders, catalog, seed }) {}
export function summarizeRound(state) {}
~~~

实现约束：

- 引擎不读取 DOM、LocalStorage、摄像头或全局时钟。
- 词库是只读数据模块；不在运行时请求网络或生成新文案。
- 引擎只保存话术 ID、家族与局内出现记录，不复制第二套散落文案。
- 个人订单无结构化触发原因时，<code>selectShellSequence</code> 只能返回中性问号壳。
- 所有时间由调用方传入。
- 实体上限 8 个；粒子不进入业务状态。
- 线段只与当前最外层 shell hitbox 碰撞；商品 core 没有可结算 hitbox。
- 商品、外壳层和碎片使用显式数据结构，不靠素材文件名推断业务含义。
- 不保存局内记录。

**Step 3: 运行测试**

Run:

~~~bash
node --test tests/peel-copy-catalog.test.mjs tests/peel-game.test.mjs
node --check peel-copy-catalog.js
node --check peel-game.js
~~~

Expected: PASS。

**Step 4: 可选提交点**

只有用户明确要求提交时：

~~~text
feat(activity): 新增欲望剥壳机核心引擎

- 在活动模块中新增版本化配对词库、商品本体与话术外壳规则
- 优化确定性回合、逐层剥壳与结算逻辑
- 补充词库边界、游戏阶段、碰撞和商品本体保护测试
~~~

### Task 2：实现手势剥壳线段映射

**Files:**

- Modify: <code>gesture-controls.js</code>
- Create: <code>peel-gesture-controls.js</code>
- Create: <code>tests/peel-gesture-controls.test.mjs</code>
- Modify: <code>tests/gesture-controls.test.mjs</code>

**Step 1: 写失败测试**

覆盖：

- 镜像后的食指坐标与房间游标方向一致。
- 首帧只建立锚点，不生成超长线段。
- 两个有效帧生成一个归一化线段。
- 置信度低于 0.68 不输出。
- 非 <code>Pointing_Up</code> 不生成剥壳轨迹。
- 坐标跳变超阈值时重置锚点。
- 同目标 120ms 内不重复命中。
- 丢手 600ms 输出 pause 事件；恢复输出 resume。
- mapper reset 后不保留上局轨迹。

Run:

~~~bash
node --test tests/peel-gesture-controls.test.mjs tests/gesture-controls.test.mjs
~~~

Expected: FAIL。

**Step 2: 抽出共享镜像函数**

在 <code>gesture-controls.js</code> 导出：

~~~js
export function mirroredLandmarkPoint(landmark) {
  return {
    x: 1 - landmark.x,
    y: landmark.y,
  };
}
~~~

房间 mapper 改为调用共享函数，行为不得变化。

**Step 3: 实现游戏 mapper**

建议 API：

~~~js
export function createPeelGestureMapper(options = {}) {
  return {
    update(result, now),
    reset(),
  };
}
~~~

输出只允许：

- <code>{ type: "segment", from, to, at }</code>
- <code>{ type: "pause", reason: "hand-lost" }</code>
- <code>{ type: "resume" }</code>
- <code>null</code>

**Step 4: 运行测试**

Run:

~~~bash
node --test tests/peel-gesture-controls.test.mjs tests/gesture-controls.test.mjs
node --check gesture-controls.js
node --check peel-gesture-controls.js
~~~

Expected: PASS；房间手势旧测试保持通过。

### Task 3：注册掌机 activity 热点

**Files:**

- Modify: <code>scene-config.js</code>
- Modify: <code>panorama.js</code>
- Modify: <code>styles.css</code>
- Modify: <code>tests/panorama-flat.test.mjs</code>
- Create: <code>tests/peel-game-layout.test.mjs</code>

**Step 1: 写失败测试**

覆盖：

- 掌机热点 id 唯一，kind 为 <code>activity</code>。
- 它不出现在三个顶部 feature 入口中。
- activity 可点击、可聚焦，有可读名称和说明。
- 空中指向允许激活 feature 与 activity，但不能激活 thought。
- 它使用独立图标 / 状态样式，不伪装成第四个核心功能。

Run:

~~~bash
node --test tests/panorama-flat.test.mjs tests/peel-game-layout.test.mjs
~~~

Expected: FAIL。

**Step 2: 注册配置**

建议在 <code>scene-config.js</code> 新增：

~~~js
export const ACTIVITY_HOTSPOTS = [
  {
    id: "desire-peel",
    kind: "activity",
    activity: "peel",
    title: "欲望剥壳机",
    description: "剥开催你下单的话术，看看商品本身",
    yaw: -35.5,
    pitch: 17,
    focusYaw: -35.5,
    focusPitch: 14,
    focusFov: 34,
  },
];
~~~

<code>app.js</code> 组装热点时加入该注册表。不要把它加入 <code>FEATURE_HOTSPOTS</code>。

**Step 3: 扩展 panorama**

- 增加 <code>renderActivityHotspotMarkup</code>。
- <code>createHotspots()</code> 根据 kind 显式分支。
- 将可被空中指向的 allowlist 从隐式判断改为 <code>feature | activity</code>。
- <code>activateHotspot</code> 支持 activity，并把配置传给 <code>onActivate</code>。
- 保持 thought 只能用普通点击探索。

**Step 4: 运行测试与坐标初验**

Run:

~~~bash
node --test tests/panorama-flat.test.mjs tests/peel-game-layout.test.mjs
node --check scene-config.js
node --check panorama.js
~~~

Expected: PASS。

在本地浏览器确认掌机热点不遮挡原热点，随后按三档视口微调坐标。

### Task 4：扩展房间 activity 路由

**Files:**

- Modify: <code>route-sync.js</code>
- Modify: <code>tests/routing-flicker.test.mjs</code>

**Step 1: 写失败测试**

覆盖：

- <code>#room?activity=peel</code> 解析为房间中的 peel activity。
- <code>#room</code> 无 activity。
- 未知 activity 被忽略或规范化回房间。
- build 后保留现有合法房间参数，不复制冲突参数。
- activity 不被当成 panel。
- 刷新只恢复 <code>READY</code>，不恢复半局。
- 浏览器后退关闭 activity 并回房间。

Run:

~~~bash
node --test tests/routing-flicker.test.mjs
~~~

Expected: FAIL。

**Step 2: 实现纯函数**

建议增加：

~~~js
export function parseRoomHashState(hash) {}
export function buildRoomHash({ activity } = {}) {}
~~~

保持现有 <code>panelNameFromHash</code>、<code>routeSignature</code> 行为兼容。

**Step 3: 运行测试**

Run:

~~~bash
node --test tests/routing-flicker.test.mjs
node --check route-sync.js
~~~

Expected: PASS。

### Task 5：搭建游戏语义结构、视觉和原创素材

**Files:**

- Modify: <code>index.html</code>
- Modify: <code>styles.css</code>
- Create: <code>assets/peel-game/ASSET-MANIFEST.md</code>
- Create: <code>assets/peel-game/*.webp</code> or <code>assets/peel-game/*.svg</code>
- Modify: <code>tests/peel-game-layout.test.mjs</code>

**Step 1: 写失败测试**

静态断言：

- 对话层具备标题、说明、普通开始和可选体感按钮。
- 教程文案明确“划开外层贴纸，商品会保留”，并提供“直接开始”。
- HTML、素材清单和商品池中不存在水果教学资产。
- Canvas 为装饰，不进入辅助技术树。
- 普通游戏舞台中不存在可见的 3×3 静态目标网格。
- 键盘刀锋控制说明存在，方向键和 Space / Enter 有清晰文案。
- 屏幕阅读器辅助区使用持久控件表示“当前空中目标”，且不会随飞行实体销毁而失去焦点。
- 状态区包含看穿层数、剩余时间和暂停提示。
- 结果页先提供本局话术选择和不保存的 if-then 提醒，再提供三个主选择。
- 结果页业务按钮不是手势目标。
- 关闭按钮、焦点返回点和 <code>aria-live</code> 存在。
- 隐私文案明确本地处理、不保存、不发送、结果页关闭摄像头。
- DOM 中不出现真实支付、抽奖、排行榜、模型或服务商文案。

Run:

~~~bash
node --test tests/peel-game-layout.test.mjs
~~~

Expected: FAIL。

**Step 2: 新增 HTML 骨架**

建议结构：

~~~html
<section id="peel-game-dialog" role="dialog" aria-modal="true">
  <header>...</header>
  <div class="peel-game-stage" tabindex="0">
    <canvas aria-hidden="true"></canvas>
    <div class="peel-game-blade" aria-hidden="true"></div>
  </div>
  <div class="peel-game-a11y-controls">
    <button>上一个目标</button>
    <output>当前空中目标：奶茶的“限时”外壳</output>
    <button>剥开当前外壳</button>
    <button>下一个目标</button>
  </div>
  <div class="peel-game-status" aria-live="polite">...</div>
  <section class="peel-game-summary" hidden>...</section>
</section>
~~~

游戏层放在房间之后、业务 panel 之前，避免嵌入 WebGL。

**Step 3: 生成或绘制原创素材**

- 保持小浣熊产品世界观，但游戏主体不复制其他划切游戏的刀痕、字体、音效、布局或品牌符号。
- 每件正式商品至少有“完整本体”“单层外壳”“双层外壳”“外壳碎片”四种可组合视觉状态。
- 外壳用圆润促销贴纸、透明价格泡泡和收据封条；商品本体始终完整、清晰且不呈现破坏状态。
- 剥净后用柔和光圈和“落入冷静篮”反馈替代商品爆裂。
- 在清单中逐项记录文件、作者方式、尺寸、用途和降级文本。

**Step 4: 实现响应式与减少动态**

- 桌面游戏区建议最大 760×620。
- 手机使用近全屏 sheet，底部保留安全区。
- 低高度设备允许内容内部纵向滚动，不允许页面横向溢出。
- <code>prefers-reduced-motion</code> 切到低幅度垂直升降，不默认切成静态宫格。
- 不引入循环背景视频或重型 3D。

**Step 5: 运行测试**

Run:

~~~bash
node --test tests/peel-game-layout.test.mjs
git diff --check
~~~

Expected: PASS。

### Task 6：实现 Canvas / DOM 游戏控制器

**Files:**

- Create: <code>peel-game-ui.js</code>
- Modify: <code>tests/peel-game-ui.test.mjs</code>
- Modify: <code>tests/peel-game-layout.test.mjs</code>

**Step 1: 写失败测试**

覆盖：

- open 只创建一个实例。
- 第一次打开才加载素材。
- 首次开始先显示不计时的商品教程，教程奶茶到顶点后暂停。
- 完成或跳过教程后才开始 45 秒计时，replay 不重复教程。
- 每个普通实体从画面底部外生成，沿抛物线上升并回落。
- pointer drag 转为切割线段。
- pointer tap 可切目标，满足触屏无拖动回退。
- 命中只让最外层话术碎裂，商品本体纹理和完整状态不变。
- 双层话术第一次命中后仍保留内层，第二次命中后才露出商品。
- 商品露出后完整落入冷静篮，继续划过不会再次结算。
- 方向键移动可见刀锋，Space / Enter 生成切割线段并调用同一引擎动作。
- 屏幕阅读器的持久目标控制器调用同一引擎动作，活动实体销毁时焦点不丢失。
- Canvas 不可用时才显示语义化目标列表，故障降级仍可玩。
- <code>devicePixelRatio</code> 上限为 2。
- 同时最多 8 个实体、60 个粒子。
- pause 后取消动画推进。
- close 清理 RAF 和事件。
- summary 禁止继续命中。
- reduced motion 使用低幅度升降，不启动高速抛物线、旋转或粒子循环。

Run:

~~~bash
node --test tests/peel-game-ui.test.mjs
~~~

Expected: FAIL。

**Step 2: 实现控制器**

建议 API：

~~~js
export function createPeelGameController({
  root,
  engine,
  loadAssets,
  onStateChange,
  onSummary,
  now,
}) {
  return {
    open(config),
    start(inputMode),
    applySegment(segment),
    pause(reason),
    resume(),
    replay(),
    close(),
    destroy(),
  };
}
~~~

性能约束：

- 使用单一 <code>requestAnimationFrame</code>。
- 运动基于 timestamp，不按帧数累计。
- Canvas 仅在游戏 active 时连续刷新。
- 目标 input-to-visual response 小于 100ms。
- 中端移动设备帧耗时 p95 目标小于 20ms。
- 页面隐藏时自动暂停。

**Step 3: 运行测试**

Run:

~~~bash
node --test tests/peel-game.test.mjs tests/peel-game-ui.test.mjs tests/peel-game-layout.test.mjs
node --check peel-game-ui.js
~~~

Expected: PASS。

### Task 7：给现有手势控制器增加 activity 上下文

**Files:**

- Modify: <code>gesture-ui.js</code>
- Modify: <code>tests/gesture-ui.test.mjs</code>
- Modify: <code>tests/peel-game-integration.test.mjs</code>

**Step 1: 写失败测试**

覆盖：

- 已开启房间手势进入游戏时复用 Worker 和媒体流。
- activity active 时结果帧不再传给 panorama。
- 未开启手势进入游戏不会自动请求权限。
- 点击“开启体感剥壳”才请求权限。
- 拒绝或失败后仍保持普通模式。
- summary 前停止媒体轨道。
- 返回房间时仅在允许自动恢复时恢复。
- 用户主动 stop 后不自动恢复。
- panel 和 activity 不会同时消费帧。
- destroy 后无 Worker、stream、timer 或 listener 泄漏。

Run:

~~~bash
node --test tests/gesture-ui.test.mjs tests/peel-game-integration.test.mjs
~~~

Expected: FAIL。

**Step 2: 增加明确上下文 API**

建议能力：

~~~js
gestureController.canContinueIntoActivity()
gestureController.continueIntoActivity(frameConsumer)
gestureController.startForActivity(frameConsumer)
gestureController.pauseActivityForPointer()
gestureController.finishActivityForSummary()
gestureController.returnToRoomFromActivity()
gestureController.stopActivityByUser()
~~~

内部使用显式状态：

~~~text
inputContext = room | activity | none
resumePolicy = automatic | manual
~~~

禁止使用多个布尔值拼出不可验证的隐式状态。

**Step 3: 接入 game mapper**

- Worker 的 <code>result</code> 在 activity 上下文传给 <code>PeelGestureMapper</code>。
- mapper 输出 segment 后再调用游戏控制器。
- 房间 dwell cooldown 与局内 hit dedupe 分开。
- 游戏关闭时 reset mapper。

**Step 4: 运行测试**

Run:

~~~bash
node --test tests/gesture-controls.test.mjs tests/gesture-ui.test.mjs tests/peel-gesture-controls.test.mjs tests/peel-game-integration.test.mjs
node --check gesture-ui.js
~~~

Expected: PASS。

### Task 8：在 app.js 中完成活动协调和业务适配

**Files:**

- Modify: <code>app.js</code>
- Modify: <code>tests/order-interactions.test.mjs</code>
- Modify: <code>tests/peel-game-integration.test.mjs</code>

**Step 1: 写失败测试**

覆盖：

- 点击 activity 热点设置 <code>#room?activity=peel</code> 并打开介绍层。
- 直接访问该路由打开 <code>READY</code>。
- 游戏与业务 panel 互斥。
- Esc、关闭和后退按层级退出并恢复焦点。
- 最近 cooling 订单被选为 focus。
- 缺少结构化触发原因的个人订单只得到中性问号外壳。
- 结果页话术候选只来自本局实际出现过的外壳。
- 选择话术后生成的 if-then 提醒不写入 LocalStorage。
- 已有订单的“放进冷静区”只打开 / 聚焦，不创建重复订单。
- 商品池对象只预填表单，不自动创建订单。
- “只是玩玩”不改变 LocalStorage。
- replay 不改变 LocalStorage。
- 全程不调用在线诊断接口。
- 游戏结束不改变消费人格、目标和订单统计。

Run:

~~~bash
node --test tests/order-interactions.test.mjs tests/peel-game-integration.test.mjs
~~~

Expected: FAIL。

**Step 2: 引入依赖并组装热点**

<code>app.js</code> 只承担协调：

- 读取现有订单和本地商品池。
- 调用纯函数选择 focus。
- 打开 / 关闭 activity。
- 将手势 frame consumer 切到游戏。
- 将 summary 的用户点击翻译成现有业务操作。

不要在 <code>app.js</code> 重新实现碰撞、外壳层数、看穿层数或手势阈值。

**Step 3: 建立唯一业务适配器**

建议新增内部函数：

~~~js
function handlePeelGameIntent(intent, focusItem) {
  // existing order: navigate and focus
  // catalog item: prefill existing form
  // dismiss/replay: no business mutation
}
~~~

添加测试 spy，证明 <code>createOrder</code> 和 <code>simulateCommerceOrder</code> 不会被游戏直接调用。

**Step 4: 运行测试**

Run:

~~~bash
node --test tests/order-interactions.test.mjs tests/peel-game-integration.test.mjs
node --check app.js
~~~

Expected: PASS。

### Task 9：更新同源服务白名单与容器复制清单

**Files:**

- Modify: <code>server.mjs</code>
- Modify: <code>Dockerfile</code>
- Modify: <code>tests/server.test.mjs</code>

**Step 1: 写失败测试**

覆盖：

- <code>/peel-copy-catalog.js</code>、<code>/peel-game.js</code>、<code>/peel-game-ui.js</code>、<code>/peel-gesture-controls.js</code> 可访问。
- 文件带正确 JavaScript MIME 和 1 小时缓存。
- <code>/assets/peel-game/...</code> 可访问。
- 非白名单根文件和内部源码继续 404。
- 响应和静态脚本不包含服务商、模型或秘密字段。

Run:

~~~bash
node --test tests/server.test.mjs
~~~

Expected: FAIL。

**Step 2: 更新白名单和 Dockerfile**

- 只加入四个新的公开根模块。
- 素材继续走现有 <code>/assets/</code> 规则。
- Dockerfile 使用显式 <code>COPY</code>，不复制整个项目和未跟踪私有文件。
- 不修改 CSP、摄像头权限策略或 API Schema，除非测试证明现有策略阻断本地 Worker。

**Step 3: 运行测试和容器配置检查**

Run:

~~~bash
node --test tests/server.test.mjs
node --check server.mjs
SPREE_ENV_FILE=./deploy/spree.env.example docker compose config --quiet
~~~

Expected: PASS。

### Task 10：更新技术设计与验收合同

**Files:**

- Modify: <code>DESIGN.md</code>
- Verify unchanged: <code>让你花个爽！活动网页产品需求文档 (PRD).md</code>

**Step 1: 补充设计章节**

写明：

- 游戏是 P1 可拔除 activity，不是一级功能。
- 正式玩法是剥开商品外层话术，商品本体不可切且始终保持完整。
- <code>peel-copy-v1</code>、13 个话术家族、单层、双层和中性问号外壳的数据合同与确定性选择规则。
- 带数字、库存、销量或时限的壳必须标记为“话术样本”，不得冒充真实商品事实。
- 网络仅用于人工内容调研，运行时不抓取、不复制品牌广告、不在线生成。
- 路由、状态机、确定性商品池与局内数据生命周期。
- 房间与游戏的手势上下文切换。
- 摄像头主动授权、结果页释放、主动停止不恢复。
- 游戏不得直接执行业务动作。
- Canvas / DOM 双通道与减少动态回退。
- 性能预算、素材许可和失败降级。

**Step 2: 检查 PRD 无静默变化**

Run:

~~~bash
git diff -- "让你花个爽！活动网页产品需求文档 (PRD).md"
~~~

Expected: 无输出。

**Step 3: 可选提交点**

只有用户明确要求提交时：

~~~text
docs(activity): 补充欲望剥壳机技术设计

- 优化话术外壳、活动状态机与手势上下文约束
- 调整摄像头、业务联动和降级验收说明
~~~

### Task 11：执行完整自动化门禁

**Files:**

- Test: all modified source and tests

**Step 1: 全量测试**

Run:

~~~bash
npm test
~~~

Expected: 全部 PASS，不允许只报告新增测试。

**Step 2: 语法检查**

Run:

~~~bash
node --check app.js
node --check personality-scoring.js
node --check panorama.js
node --check scene-config.js
node --check route-sync.js
node --check gesture-controls.js
node --check gesture-ui.js
node --check peel-copy-catalog.js
node --check peel-game.js
node --check peel-game-ui.js
node --check peel-gesture-controls.js
node --check server.mjs
node --check server/diagnosis-service.mjs
~~~

Expected: 全部退出码 0。

**Step 3: 静态与隐私回归**

Run:

~~~bash
git diff --check
rg -n "provider|model|api[_-]?key|银行卡|真实支付|排行榜|抽奖" index.html styles.css app.js peel-copy-catalog.js peel-game.js peel-game-ui.js peel-gesture-controls.js assets/peel-game DESIGN.md
~~~

Expected:

- <code>git diff --check</code> 无输出。
- 搜索结果只允许设计文档中的否定性边界说明；公开 UI 与脚本无服务商、模型、密钥、真实支付、排行榜或抽奖文案。

**Step 4: 检查改动范围**

Run:

~~~bash
git status --short
git diff --stat
~~~

Expected: 只出现计划内文件及用户原有修改；不得混入浏览器状态、临时文件或真实密钥。

### Task 12：本地浏览器与真实摄像头验收

**Files:**

- Verify only

**Step 1: 启动完整同源服务**

Run:

~~~bash
npm start
~~~

Expected: <code>http://127.0.0.1:8787</code> 可访问；不注入生产密钥。

**Step 2: 普通输入回归**

视口：

- 1440×1000
- 768×1024 或等宽档
- 390×844
- 375×812

每档检查：

- 开屏流程和房间仍正常。
- 顶部仍只有三个语义入口。
- 掌机热点在物件上、可点击、可聚焦且不遮挡其他热点。
- 点击后快速聚焦并打开 READY。
- 首次进入先慢速抛出带“限时”外壳的教程奶茶，到达顶点后暂停且不消耗正式时间。
- 教程完成或跳过后才开始 45 秒；同一会话 replay 不重复教程。
- 教程与正式回合都只出现商品，不出现水果。
- 所有正式商品均从底部外抛起，沿弧线上升、到达顶点并自然回落。
- 所有商品只允许外壳分裂，商品本体始终完整。
- 双层外壳需要逐层剥开，剥净后的商品完整落入冷静篮。
- 外壳始终带“话术样本”标识；带数字、库存、销量或时限的短句不会被误认成商品真实信息。
- 一局内不重复整句话术，同一家族和同一商品品类均不连续出现超过两次。
- 剥开后回应在移动端最多两行，先显示解构笑点，再淡出，不遮挡下一件商品。
- 13 个话术家族在多局固定种子回归中均可到达，40 / 40 / 20 语气配比符合配置。
- 未切中的商品连同外壳自然落回底部，不扣分。
- 触控 / 鼠标划动、点击回退、键盘刀锋和屏幕阅读器目标控制器均可完成。
- 计时、暂停、结果和再来一局正确。
- Esc、关闭、后退与焦点恢复正确。
- 无横向溢出、遮挡、不可点击控件或阻断性控制台错误。
- Canvas 和单个素材故障时语义化目标列表可用，正常模式不显示静态宫格。
- reduced motion 下使用低幅度升降，没有高速抛物线、旋转或爆裂动画。

**Step 3: 业务边界回归**

分别准备：

1. 有个人 cooling 订单。
2. 无 cooling 订单。
3. 仅有 demo 数据。

检查：

- focus 选择符合确定性优先级。
- 个人订单缺少结构化触发原因时只显示中性问号外壳，不猜测用户动机。
- 个人订单的真实名称和价格不会与虚构库存、销量、折扣或倒计时绑定。
- 结果页只列本局出现过的话术；if-then 提醒不保存。
- “只是玩玩”和 replay 不改变存储。
- “放进冷静区”只打开已有订单或预填表单。
- 不提交表单就不产生订单。
- 正式提交后只通过现有流程创建“欲望冷却中”。
- 游戏前后目标、人格和统计不被局内看穿层数污染。

**Step 4: 手势模拟验证**

- 用现有 Worker 消息夹具验证 room → activity → summary → room。
- 验证 activity 期间 panorama 不移动。
- 验证丢手 600ms 暂停、恢复继续。
- 验证低置信度、Open Palm 和 Closed Fist 均不切割。
- 验证 summary 上任何手势都不能点击业务按钮。

**Step 5: 本地真实摄像头验证**

由用户主动点击后验证：

- 首次授权文案准确。
- 已在房间开启时进入游戏不重复加载模型。
- 食指划过轨迹与屏幕方向一致，端到端反馈小于约 100ms。
- 慢网首次 Worker 初始化仍显示进度并遵守现有 90 秒超时。
- 游戏结果页摄像头指示灯熄灭。
- 返回房间的自动恢复与主动停止后的不恢复符合规则。
- 拒绝权限后触控、鼠标和键盘仍完整可用。

真实摄像头测试属于本地设备验证，不得用模拟测试替代结论。

**Step 6: 性能采样**

- 运行至少 3 局。
- 检查只有一个 RAF。
- 峰值实体不超过 8、粒子不超过 60。
- 记录帧耗时 p95 和输入到视觉反馈。
- 检查连续 replay 后内存和媒体轨道不持续增长。

**Step 7: 清理**

- 关闭本轮浏览器自动化会话及对应进程。
- 停止本地服务，除非需要保留给用户现场查看；若保留必须明确说明 PID 和地址。

### Task 13：本地展示与发布门禁

**Files:**

- No code changes

**Step 1: 本地交付**

向用户提供：

- 本地地址。
- 桌面和移动截图或录屏。
- 普通输入、手势输入、摄像头释放、业务预填四类证据。
- 自动化命令与真实通过数。
- 未验证边界，如未覆盖的真机型号。
- 精确改动文件清单。

**Step 2: 停止在等待确认**

此时状态只能描述为：

- 代码已本地实现。
- 自动化测试结果如何。
- 本地浏览器 / 摄像头验证结果如何。
- 未提交 / 未推送 / 未部署，除非用户分别授权并实际完成。

**Step 3: 只有确认后再安排发布**

用户看到本地版本并明确说“可以部署”“上传吧”后，才能进入既有备份、精确同步、重建、公开页面验收和回滚流程。本计划不包含任何自动生产变更。

## 6. 验收清单

### 产品

- [ ] 游戏位于右侧掌机，不新增顶部第四入口。
- [ ] 首次商品教程不计时，完成或跳过后才进入正式 45 秒。
- [ ] 一局按单层外壳 → 单双层混合 → 聚焦商品推进，全程不出现水果。
- [ ] 正式商品本体始终完整，只有话术外壳会被切碎。
- [ ] 首发 65 对话术覆盖 13 个家族，全部来自本地版本化词库。
- [ ] 每个外壳有对应原创回应；一局不重复整句，同一家族连续不超过两次。
- [ ] 数字、库存、销量、折扣与时限文案均被标作“话术样本”，不冒充真实促销事实。
- [ ] 文案轻松但不羞辱、不诊断、不强迫用户必须不买。
- [ ] 不漏切扣分，不设排行榜、抽奖或付费道具。
- [ ] 结果页先让用户选择本局出现过的话术，再给出不保存的 if-then 提醒和三个明确选择。
- [ ] 看穿层数不影响订单、目标、人格或报告。

### 手势与隐私

- [ ] 普通输入无需摄像头。
- [ ] 只有主动点击后请求权限。
- [ ] 已开启房间手势时复用 Worker / stream。
- [ ] 游戏手势只剥话术外壳，不切商品本体，也不操作结果页业务按钮。
- [ ] 结果页前释放摄像头。
- [ ] 主动停止后不自动恢复。
- [ ] 拒绝、超时和设备不可用均可无缝回退。

### 数据与业务

- [ ] focus 选择可复现。
- [ ] 现有订单不被复制。
- [ ] 商品池对象只预填表单。
- [ ] 新订单仍只能由用户提交后创建为“欲望冷却中”。
- [ ] 无在线 AI、无后端数据库、无真实支付。

### 无障碍与降级

- [ ] 默认视觉玩法始终是底部抛起、空中划切，不显示静态宫格。
- [ ] 键盘刀锋作用于同一批动态道具。
- [ ] Canvas 之外有持久的屏幕阅读器目标控制器和故障降级列表。
- [ ] 键盘、屏幕阅读器和 44px 点击目标可用。
- [ ] reduced motion 使用低幅度升降；纯静态模式只在用户主动选择或 Canvas 故障时出现。
- [ ] Canvas、素材、摄像头或 Worker 失败不阻断体验。
- [ ] Esc、返回和焦点恢复符合页面层级。

### 工程与质量

- [ ] 所有新模块由测试先行。
- [ ] <code>npm test</code> 全量通过。
- [ ] 所有相关 <code>node --check</code> 通过。
- [ ] <code>git diff --check</code> 通过。
- [ ] 服务白名单和 Docker 显式复制清单已更新。
- [ ] 没有供应商、模型、密钥或未授权品牌素材泄露。
- [ ] 浏览器自动化进程在验收后关闭。

## 7. 工期、里程碑与风险

### 7.1 建议工期

| 里程碑 | 内容 | 估算 |
|---|---|---:|
| M1 | 版本化词库、引擎、手势 mapper、路由与热点 | 2–2.5 天 |
| M2 | 游戏 UI、原创素材、普通输入与无障碍 | 2.5 天 |
| M3 | 手势上下文、摄像头生命周期、业务适配 | 2 天 |
| M4 | 服务 / 容器、全量测试、四档浏览器验收 | 1.5–2 天 |
| 缓冲 | 真机手势调参、素材压缩、缺陷修复 | 1–1.5 天 |
| 合计 | 本地可验收版本 | 8–10.5 个工程日 |

### 7.2 主要风险与控制

| 风险 | 控制 |
|---|---|
| 掌机在移动端太小或热点漂移 | 三档校准；热点扩大但不遮挡相邻物件 |
| 手势轨迹抖动、误切 | 置信度门槛、线段平滑、跳变重置、命中去重和扩大碰撞区 |
| 摄像头常驻引发隐私担忧 | 主动授权、上下文隔离、结果页释放、清晰本地处理文案 |
| 游戏反而刺激消费 | 不使用真实品牌、倒计时促销奖励、稀有度或排行榜；话术外壳被剥开，商品本体不被奖励或惩罚 |
| 网络热梗过时或引发版权 / 品牌风险 | 只提炼通用机制，回应原创；词库按版本人工审核，不在客户端实时抓取 |
| 虚构促销被误认成真实商品信息 | 外壳固定显示“话术样本”；个人订单无结构化依据时只用中性问号壳 |
| 梗太密导致疲劳或冒犯 | 40% 直给、40% 轻梗、20% 温和；移动端两行限制并设置人工朗读审查 |
| 局内状态污染业务事实 | 纯引擎、只读商品投影、唯一业务适配器、集成测试禁止直接创建订单 |
| Canvas 无障碍不足 | 持久的语义目标控制器作为完整等价路径，不在默认画面展示宫格 |
| 首页性能回退 | 首次进入才加载、DPR 上限、实体 / 粒子上限、无重型依赖 |
| 与现有手势生命周期冲突 | 显式 inputContext 状态机；复用 Worker；每次退出做资源断言 |

## 8. 明确不在第一版范围

- 排行榜、成就、连续签到、奖励币、付费道具。
- 多人对战、社交分享挑战。
- 陀螺仪、全身骨骼或双手复杂手势。
- 在线生成商品、动态 AI 文案或云端局内记录。
- 真实电商链接、比价、购物车、支付或资金操作。
- 把看穿层数、连续反馈或结果话术选择纳入消费人格评分。
- 为游戏新增第四个首页导航。
- 生产发布、域名、Caddy 或 Cloudflare 变更。

## 9. 实施完成的定义

只有以下条件同时成立，才能把第一版称为“本地实现完成”：

1. 用户可从右侧掌机进入，并用触控、鼠标或键盘完整玩完。
2. 已主动授权摄像头的用户可用食指剥开话术外壳，未授权用户不会被强制请求。
3. 结果页前摄像头关闭，且手势不能执行任何业务决定。
4. “放进冷静区”只导航或预填，订单仍由现有表单明确提交。
5. 所有局内状态均为临时状态，不改写订单、目标、人格或报告。
6. 自动化、四档浏览器、减少动态、失败降级和本地真实摄像头验证都有证据。
7. 本地结果已展示给用户，并停在等待是否提交 / 部署的确认状态。
