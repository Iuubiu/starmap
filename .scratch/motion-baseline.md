# 动效现状基线（t60 只读调研）

测量日期：2026-10-22
测量环境：Redmi Book Pro 14 2024 / Core Ultra 7 155H / 32GB / **无独显，Intel Arc 核显**
浏览器：Playwright Chromium（Desktop Chrome，1280×800），dev server（Vite）
测量脚本：`.scratch/qa/scenarios/zz-fps-map.spec.ts`（`MOTION_FPS=1` 才跑，原 `zz-motion-fps.spec.ts` 改名以避开门禁的 `zz-motion` 过滤）、`zz-motion.spec.ts`

> 数字全部来自本机实测，未做任何推算。dev server 下 React StrictMode 会让
> effect 跑两遍，所以这些是**偏悲观**的上界。

---

## 一、全站动效现状：几乎为零

`grep -rn "transition\|animation\|@keyframes" apps/web/src` 只命中三行：

| 位置 | 内容 |
| --- | --- |
| `apps/web/src/components/AppShell.tsx:131-132` | 窄屏抽屉 `transitionProperty: 'transform'` + `tokens.durationNormal` |

除此之外：

- **没有** `prefers-reduced-motion` 处理（全仓 0 命中）
- **没有** View Transitions API 使用（0 命中）
- **没有** 路由转场，`RouterProvider` 直接换页
- **没有** 卡片入场、数字滚动、进度条动画

也就是说 t60 是**从零起步**，不存在「改现有动画」的兼容负担；反过来也意味着
所有动效都必须是新增的，验收里「reduced-motion 全站零动画」需要靠一套统一
开关兜住，而不是逐个补丁。

---

## 二、转场挂点清单（文件:行）

| # | 位置 | 触发 | 现状时长 | 被打断怎么办 |
| --- | --- | --- | --- | --- |
| 1 | `apps/web/src/App.tsx:34` `<RouterProvider router={router} />` | 侧栏 Tab / 链接点击 | **0ms 硬切**（实测点击→新页首帧 78ms，但那 78ms 里主线程被独占，见下） | 无需处理，现在没有动画 |
| 2 | `apps/web/src/components/AppShell.tsx:130-135` 抽屉 | ≤767px 点汉堡 | `durationNormal`（t58 token，约 200ms） | CSS transition 天然可中断 |
| 3 | `apps/web/src/pages/LevelPage.tsx:665` `onClick={() => setFlow(advance(spec, flow))}` | 点「进入下一段」 | **0ms 硬切**：整块内容 `removed=1 / added=3`，DOM 直接换 | 现在没有动画 |
| 4 | `apps/web/src/graph/GraphCanvas.tsx:478` `camera.animate({x,y},{duration:350})` | 换焦点知识点 | 350ms（sigma 自带补间，**只平移不改 ratio**） | sigma `runAnimation` 内部会取消上一段 |
| 5 | `apps/web/src/level/CardView.tsx:96` `<Card>` | 段落切换后重挂 | 无 | — |
| 6 | `apps/web/src/level/StepRail.tsx:68` 段进度轨 | 每次 `advance` | 无（条形直接跳） | — |
| 7 | `apps/web/src/level/MasteryMeter.tsx:139` 与 `:143` 大数字 `percent(view.achieved)` / `percent(view.current)` | 掌握度变化 | 无（数字直接跳变） | — |

**关键结论**：用户要的「像从地球到地面的那种阶段」= 第 1 项（路由）+ 第 3 项
（关卡段推进）的组合。这两处现在是**纯硬切**，中间没有任何可追踪的公共锚点。

---

## 三、帧率实测

采样口径：`requestAnimationFrame` 记每帧时间戳 → 算**帧间隔** → P50/P95/max；
长任务用 `PerformanceObserver({entryTypes:['longtask']})` 收（>50ms），与 t53
的 `zz-perf.spec.ts` 同口径。

### 3.1 采样器灵敏度对照（先证明脚本可信）

主线程忙等 300ms，采样器必须报出同量级的最长帧间隔：

```
frames=77  P50=16.7ms  P95=16.7ms  max=283.3ms  longMax=300ms
```

**通过** —— 283ms 的帧空洞 + 300ms 的 longtask 都如实记到了。

> 踩到的坑：忙等必须由**页面自己的定时器**发起（`setTimeout` 里跑）。
> 在 `page.evaluate` 里直接同步忙等，rAF 采样器能看见空洞，但
> `PerformanceObserver` 收不到 longtask 归因（`longMax=0`）。
> 这一点写进脚本注释了，否则以后会误判成「页面没有长任务」。

### 3.2 稳态对照（页面空转）

| 场景 | frames | P50 | P95 | max | longMax |
| --- | --- | --- | --- | --- | --- |
| `/map` 3086 节点**静止** | 85 | **16.7ms (59.9fps)** | 16.8 | 16.8 | **0ms** |

→ 页面空转是满帧的。后面所有掉帧都是「动起来」带来的，不是页面本身有病。

### 3.3 现成动画路径（最贴近 t60 目标负载）

| 场景 | frames | P50 | P95 | max | longMax | longtask 数 |
| --- | --- | --- | --- | --- | --- | --- |
| `/map` 滚轮连续缩放（逐帧改 ratio） | 133 | 16.7 (59.9fps) | 83.3 | 100 | **118ms** | 23 |
| `/map` 按钮缩放补间（`camera.zoomIn`） | 152 | 16.7 (59.9fps) | 83.3 | 133.4 | **115ms** | 23 |
| `/map` 焦点切换相机平移（350ms） | 48 | 16.7 (59.9fps) | 283.3 | 366.6 | **255ms** | 17 |

**这是本次调研最重要的数字。**

- **P50 全部达标**（16.7ms = 59.9fps，验收线 50fps）。滚动/缩放时「大多数帧」
  是满帧的，肉眼不会觉得卡成 PPT。
- **但 P95 和长任务全线超标**：验收要求「无超过 100ms 的长任务」，
  而滚轮缩放 118ms、按钮补间 115ms、**焦点平移 255ms**。
- 焦点平移那条最刺眼：它只是**平移**（不改 ratio、不重算节点屏幕尺寸），
  却出现了 366ms 的单帧空洞。说明成本不在「缩放」这个动作上，而在
  **sigma 每帧 `emit('updated')` 之后的标签重排**（`labelGridCellSize: 160`
  要在 3086 个节点上重算网格）。

### 3.4 路由切换（`/board` → `/map`）

```
点击 → 新页首帧:  78ms
点击 → 画布可用: 2494ms
frames=15  P50=16.7  P95=50  max=2283.3  longMax=1913ms
longtasks: 66ms + 1913ms + 388ms
```

- 78ms 是「React 提交 + 首帧」的成本，可接受。
- **1913ms 的长任务是建 WebGL 画布 + 首帧布局**（3086 节点、269 边）。
- 这条决定了 `useRouteTransition()` 的实现形态：**不能在路由切换时叠加
  一段 CSS 动画去掩盖这 1.9 秒**。如果先播 200ms 淡出再换页，用户会先看
  200ms 动画、再卡 1.9 秒白屏/黑屏。正确做法是：**先让新页面挂载、画布建好，
  再做入场**；或者转场期间保持旧画面（View Transitions 的快照机制正好如此）。

### 3.5 关卡段推进（现在的硬切）

`LevelPage.tsx:665`，从「第 1 段 · 引导」→「第 2 段 · 展示细节」：

```
点击 → 新段落首帧: 70ms
MutationObserver: mutations=4, removed=1, added=3
frames=3  P50=66.6ms  P95=66.6ms  max=66.6ms  longMax=50ms
```

- **70ms 完成，其中一帧 66.6ms** —— 也就是说切换是「一帧之内整块换掉」。
- 内容区 `removed=1 / added=3`：旧段落容器整个移除，新段落容器 + 标题 + 正文
  一次性插入。**没有任何过渡**，这就是「硬切」的物理形态。
- 3 帧的采样窗口说明这段太快，采样器来不及收集更多样本 —— 这本身也是
  「现在没有动画」的证据。

---

## 四、平台能力探针（决定实现选型）

`zz-motion-probe2.spec.ts` 实测（Chromium，Playwright）：

| 能力 | 结果 |
| --- | --- |
| `typeof document.startViewTransition` | **`function`** ✅ |
| `CSS.supports('selector(::view-transition-old(root))')` | **`true`** ✅ |
| `page.emulateMedia({ reducedMotion: 'reduce' })` 后 `matchMedia(...).matches` | **`true`** ✅ |
| 恢复 `no-preference` 后 | **`false`** ✅ |

结论：

1. **View Transitions API 可用**，可以按 t60 验收要求「用 VT 起手」。
2. **`::view-transition-*` 伪元素可选中**，意味着可以用 CSS 精确控制快照
   的 transform/opacity。
3. **Playwright 能可靠模拟 reduced-motion**，`zz-motion.spec.ts` 的
   「该模式下动画时长均为 0」断言有可执行的基础。
4. `/map` 页面 DOM 规模：**6065 个元素 / 422 个 button**。VT 会给根元素拍
   快照（一张位图），3086 个点的 WebGL canvas 会被拍进快照 —— 这是 VT 在
   这个页面上的主要风险点（快照成本 + 快照期间 canvas 不更新）。

---

## 五、对 t60 实现的三条硬结论

1. **不能靠 CSS transition 做「地图→节点」的缩放**。地图是 WebGL canvas，
   它的内容不在 DOM 里，CSS `transform: scale()` 只会把整张位图放大，节点
   和文字会一起糊掉，且丢失「我在图里的哪里」这个唯一有价值的信息。
   **必须驱动 sigma 的 camera**（`camera.animate({x,y,ratio},{duration})`），
   让 WebGL 自己重绘每一帧。
2. **`useCinematicZoom()` 需要 `graph/` 侧开口**。`GraphCanvas.tsx` 把 sigma
   实例关在组件内的 `sigmaRef` 里，外部拿不到 camera。已核实
   `apps/web/src/graph/` 目前没有导出任何相机句柄。**这是 t60 的前置阻塞**，
   需要 captain 协调 graph/ 泳道加一个只读挂点（例如把 `sigmaRef.current`
   通过 context 或 module-level registry 暴露）。
3. **转场期间必须限制在 transform/opacity**。上面 3.3 的数据说明，3086 节点
   时 sigma 自己每帧的标签重排就能吃掉 100ms+；如果再叠 DOM 侧的 layout
   动画（width/height/top/left），会直接掉出验收线。**镜头交给 WebGL，
   DOM 侧只做 opacity + translateY 的小位移。**

---

## 附：复现命令

```bash
cd apps/web
# 帧率采样（默认 skip，需开关）
MOTION_FPS=1 npx playwright test --config=../../.scratch/qa/playwright.config.ts \
  zz-fps-map --output=../../.scratch/pw-motion-fps-$(date +%s)

# 动效底座验收（reduce 双向断言 + 真实页面可用性）
npx playwright test --config=../../.scratch/qa/playwright.config.ts \
  zz-motion --output=../../.scratch/pw-motion-$(date +%s)
```
