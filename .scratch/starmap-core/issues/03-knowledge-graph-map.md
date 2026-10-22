# 03: 知识图谱地图与浏览

**What to build:** 深色画布上看得见真实的知识网络：能逐层展开、能看到自己学到哪、点一个节点就进得去；同时留一条线性主线当退路。

**Blocked by:** 02

**Status:** resolved

- [x] 画布渲染全部真实节点；在 2000+ 节点规模下拖动与缩放仍可交互（物理模拟不得阻塞主线程）
- [x] 默认只显示当前焦点节点的两跳邻域，可 `+1 跳`／`−1 跳`／回全图
- [x] 四种状态着色可辨：未学／在学／已掌握／需复验
- [x] 点击节点进入对应关卡；从关卡返回时焦点保持原位
- [x] 线性主线视图可随时切换，切换后当前位置不丢
- [x] 缩放低于阈值时只画点不画标签，避免文字糊成一团
- [x] 全键盘可达；图谱状态变化有非颜色的第二编码（形状或文字），不靠颜色单通道传达

## Comments

### 1. 「需复验」这一桶现在是**假绿**（票 07 完成前必须知道）

第四条验收里「需复验」四种状态之一，UI、图例、形状编码、`toDisplayStatus` 的 `<= now` 比较全部就位，**但真实数据路径从未被跑过**。

- 桩数据能证明「给定 `reviewDueAt` 时 UI 显示对」，**不能证明「系统会写出这个值」**。
- 真相源是 `app.mastery.next_review_at`（本票的 `0003_graph_and_review.sql` 建列）。该列的**写入方是票 07**，本票只读。
- 因此：**票 07 完成前，这一桶在生产库中恒为空。任何人在此期间看到 `reviewDueAt` 全为 `null`，那是预期行为，不是 bug。**

为什么要这么切：票 07 的验收要求「图谱上『需复验』状态与到期判定一致，不会出现图谱说有、抽考说没有」。若票 03 自己算一遍到期规则、票 07 再算一遍，两边稍一漂移就会出现「图谱说该复习了、抽考说不用」——学生立刻发现系统在骗人，而且查不出是哪边错。**同一个事实只能有一个计算处**：schema（列）是共享面，规则是票 07 的。

**票 07 落地时请做一件事**：写一条用真实数据路径的测试（作答 → 到期 → 调 `GET /api/v1/graph` → 断言该节点的 `reviewDueAt` 非空），把这个假绿补成真绿。本票的 e2e 用的是 `page.route` 桩数据，帮不了这一步。

### 2. 画布与可访问层必须分离，**不要**在画布上叠透明按钮

画布（`GraphCanvas`）是纯视觉层，挂 `aria-hidden`；键盘与读屏由独立的 `NodeRoster`（真 `<button>` 列表）承担。**这不是偷懒，是先试过叠透明按钮再改回来的。**

试过的方案：在 canvas 上绝对定位一层透明 `<button>`，位置由 `sigma.graphToViewport()` 算出。它坏在：

- 相机一动（平移/缩放/换焦点）就得重算全部按钮位置，否则焦点框和视觉节点对不上。
- 真实后果是：用户按 Tab 走到第 7 个节点，一次键盘平移让相机动了，那个按钮跑到了别处——**焦点框在视觉上和语义上都对不上了**。屏幕阅读器用户失去位置感，而这件事光靠推理很难想到（你会自然假设「按钮是屏幕上的东西，它就该跟着画面动」）。
- 而且 2000 节点意味着 2000 个透明按钮，每次相机更新重排一遍，性能上也站不住。

改成独立真按钮列表后：Tab 顺序稳定、焦点环真实可见（`graph.spec.ts:535` 在深色背景下断言过）、天然满足 WCAG 1.1.1「非文本内容的等价替代」（图表配数据表是同一模式），代价只是多一个 DOM 清单。

**下一个人如果觉得「叠个透明按钮多简单」，请先读这条。**

### 3. 两个测试实现笔记（避免后人重踩）

- **长任务断言的测量窗口必须从「画布就绪」起算，不能从导航起算。** Vite dev 是逐模块编译 + 按需 transform，2000 个数据点进来后 React 首次渲染本身就有一次秒级任务（实测 dev 2000 节点 `start≈490ms / duration≈2276ms`，而画布 4710ms 才就绪；连真实 167 节点也有一次 `1169ms` 的同位任务——167 个节点跑力导向不可能秒级阻塞）。那是**加载**的代价，不是**物理模拟**的代价。生产构建同场景只有 449ms，dev/build 差 5 倍。窗口起点改为画布就绪后，断言反而更锋利：布局若漏回主线程仍会 >1s 红，且布局窗口结束后必须彻底零长任务。
- **`FA2LayoutSupervisor` 是自循环，不会自己停。** 它每轮算完自己 `askForIterations()` 再来一轮，所以哪怕 worker 化了，主线程仍会持续被「收坐标 + 重绘」打扰。`GraphCanvas` 用 `LAYOUT_BUDGET_MS`（4s）后主动 `stop()`。不设预算的话，布局窗口后的静默断言永远不可能通过。

### 4. t44：5495 节点时画布「看得见」了，但这是算术上限内的显著改善，不是全部可读

真实 `/api/v1/graph` 是 **5495 个叶节点、279 条边（去重后 241）**，其中 **5173 个（94%）完全孤立**。这个规模下有三个独立的缺陷，之前只修了第一个：

| # | 缺陷 | 修法 | 状态 |
|---|---|---|---|
| A | sigma 4 默认 `itemSizesReference: 'positions'`，`size` 单位是图坐标，7px 被放大成 ~3000px，整张画布被最后一个节点的颜色填满 | 显式 `itemSizesReference: 'screen'`（`1818d0a`） | 已修（t44 之前） |
| B | 布局种子是**半径 1 的等角圆环**，5495 个点间距 `2π/5495 ≈ 0.0011`，投影到 860px 后 **0.23px** —— 一整圈糊成一条线 | 改**向日葵盘**（`r = √((i+0.5)/n)`，黄金角） | 本票 |
| C | 节点直径写死 7–9px。5495 个 7px 圆的面积和是画布的 37.6%，**几何上必然互相覆盖** | `nodeDiameter(n) = clamp(241.3/√n, 2, 9)` | 本票 |

**实测数字（真图 `.scratch/graph.json`，n=5495，直径 3.26px，投影 860×480）**：

```
盘状种子 + 新参数(sr4/grav1) 120 轮   sep=90.7%  nnP10=3.31  nnMed=4.09  inner30=8.4%  span=4604
盘状种子 + 旧参数(sr10/grav0.5)      sep=90.3%  nnP10=3.27  nnMed=4.01  inner30=7.2%  span=7845
圆环种子 + 新参数                    sep=70.7%  nnP10=2.28  nnMed=3.61  span=4639
圆环种子 + 旧参数（改前全部）        sep=67.0%  nnP10=2.35  nnMed=3.51  span=7932
圆环种子 0 轮（改前的初始态）        sep= 0.0%  nnP10=0.23  nnMed=0.23
盘状种子 0 轮（改后的初始态）        sep=100.0% nnP10=4.53  nnMed=4.57
```

**诚实的归因**（2×2 矩阵，`apps/web/.t44-matrix.mjs`，3 个随机种子，合成同形拓扑）：

- **种子形状是主因**：5000 节点上盘状 88.6% vs 圆环 54.4%（差 34pp）、3000 差 28pp、1200 差 35pp。
- **FA2 参数（`scalingRatio` 10→4、`gravity` 0.5→1）在盘状种子下几乎无差别（<2pp）**；圆环种子下新参数甚至略差。所以验收里「改回 `scalingRatio:10`/`gravity:0.5` 测试必须红」这条**在盘状前提下不成立**，已改成断言**投影后的可观察结果**（见下）。参数真正的作用是坐标跨度：新参数 span 4604 vs 旧 7845（240 轮时 6238 vs 10848）。
- **直径缩放是第二大杠杆**：固定 7px 在 3000 节点只剩 1.5% 可分辨、5000 节点 0.2%。

**验收口径（已与 captain 对齐并改写）**：

- 原第 1 条 `非背景色像素 > 10000` **保留为回归下限**，但它证明不了可读（改前 76463 也过）。
- 原第 2 条「换算到视口宽度的节点直径 ≥ 3px」在 `itemSizesReference: 'screen'` 下是**空断言**（`size` 恒等于屏幕像素，永远 ≥3）。改成：**投影后最近邻距离中位数 ≥ 节点直径** + **可分辨节点占比 ≥ 60%**（最优实测 90.7%，留 30pp 余量）。
- 回归测试落在 `apps/web/src/graph/layout.test.ts` 的 `describe('可观察结果：5495 节点规模下节点不能粘成一团')`：5000 节点跑 60 轮 `forceAtlas2.assign`，投影到 860×480，断言 `separable > 0.75`、`inner > 0.05`（中心不能空）、`nodeDiameter(5000) < 7`。反向验证：**种子改回圆环 → 3 条红**（`separable` 0.6924 < 0.75）；**直径改回 7 → 2 条红**。

**像素级前后对比**（`apps/web/e2e/t44-shots.spec.ts`，画布截图 + 自写 PNG 解码 + 4-连通分量，`tol=6` 只算接近纯节点色 `#5A6A80` 的像素）：

| 档位 | 改前 blobs / 最大块占比 | 改后 blobs / 最大块占比 |
|---|---|---|
| 1x（默认视野） | **156 / 94.0%**（糊成一坨） | **3677 / 0.5%**（逐点可分） |
| 0.2x（缩到最小） | 1 / 100% | 4 / 25.0% |
| 3x（放大） | 3 / 63.3% | 61 / 8.6% |

默认视野下可读标签数 16 → **22**；`data-node-count=5467`。截图：`.scratch/qa/shots/t44-{1x,0.2x,3x}.png`（改后）与 `t44-before-{1x,0.2x,3x}.png`（改前），数字在 `_map-probe.json`。

**算术上限（必须承认）**：5495 个点铺在 860×480 里，每点平均只有 `860×480/5495 ≈ 75px²`，即直径上限约 4.9px；而**94% 的节点是孤立的**（没有边可聚簇），它们只能靠种子形状均匀铺开。所以本票交付的是「**从糊成一坨到逐点可分**」，**不是「5495 个名字全部可读」**——后者在这个规模下做不到，也不该靠缩小字号或丢弃节点来假装做到。

**后续若要「真的能读」**，接口已经就位、本票不实现：

- `apps/web/src/graph/topology.ts:155` `visibleSubgraph(index, focusId, hops)` 已经把「全图 / 邻域」做成同一条通路；`MapPage.tsx:352` 调它、`:410` 用 `hops: view.hops ?? 2`。
- 要加「只画有边子图 + 每簇代表节点」，就是在 `visibleSubgraph` 里多一个策略分支（按 `moduleId` 分簇，孤立节点降级为无标签小点），**不需要动 `GraphCanvas`**。
- **不许为好看编造先修边**：真实数据只有 241 条去重边、322 个有边节点，这是数据现状（票 18 的「无证据不建边」）。

### 5. t47：窄视口下画布宽度归零 → sigma 未捕获异常，降级后又发现清单高度为 0

**症状（修复前，视口 400/375/320px）**：`.graph-canvas` 宽度 0、`.graph-canvas-webgl` 量不到（`-1`），控制台 `pageerror` 每次 resize 抛一次 `Error: Sigma: Container has no width. You can set the allowInvalidContainer setting to true to stop seeing this error.`。

**三个独立成因，缺一个都修不好**：

1. **栅格右列固定 340px，左列 `minmax(0, 1fr)` 允许归零**。`MapPage` 的 `body` 是 `grid-template-columns: minmax(0, 1fr) 340px`；视口 400px 时左列算出来 `400 − 64(padding) − 16(gap) − 340 = −20`，被 `minmax(0, …)` 夹到 0。→ 窄视口改单列（`@media (max-width: 1080px) { gridTemplateColumns: 'minmax(0, 1fr)' }`），清单落到画布下方而不是藏掉（票 03 第 7 条：画布的等价文本在清单里，藏清单等于删无障碍出口）。
2. **`body` / `side` / `page` 都没写 `min-width: 0`**，flex/grid 项的 `min-width: auto` 让清单里 `white-space: nowrap` 的两列把整格顶到 min-content。实测 320px 视口下画布与清单**都是 331px**、整页横向滚动。→ 三处补 `minWidth: 0`，画布再靠 `.graph-canvas { min-width: 240px }` 兜底（320 − 64 = 256，留 16px 余量）。
3. **`GraphCanvas` 在容器宽度为 0 时仍 `new Sigma()`**。sigma 的 `resize()` 是从 window resize 回调链里调的（`scheduleRefresh` → `render` → `resize`），异常落在 React 错误边界之外，`try/catch` 只能接住构造期那一次。→ 构造前先量 `container.offsetWidth`，为 0 就渲染 `.graph-canvas-blocked` 占位，并用 `ResizeObserver` 等它变宽再建；`needsWidth` 进 effect 依赖，拉宽后画布自己回来。

**为什么不用 `allowInvalidContainer: true`**：它只是把 `width` 顶成 1px 继续渲染，画布仍然不可见、`camera` 比例全错，且把「这里其实量不出尺寸」这个事实藏起来。宁可显式降级并说明「这块屏幕放不下」，也不留一块 1px 的假画布。

**降级分支不能只做「画布不可用」**：占位文案写「节点清单仍然可以逐个打开；把窗口拉宽一些，画布会自动出现」，且**不渲染缩放按钮**（按钮对空画布没有意义，还会成为键盘陷阱）。这条在 `.scratch/qa` 的强制零宽场景里验证过：`blockedText` 正确、`rosterItems=400` 仍在。

**修好前两条后又暴露的第三个缺陷（我自己引入的）**：切单列后 `.graph-roster` 高度塌成 **0px**。单列时画布与侧栏各占一行，第二行是 `auto`，而清单是滚动容器（`overflow-y: auto` + `min-height: 0`），对 `auto` 行的固有高度贡献是 0 —— 于是行高只剩图例 32 + 按钮 34 + 两个 gap，中间一片空白。**宽度 720/636/311 都正确、400 条 `li` 也在 DOM 与无障碍树里、`isVisible()` 也报可见**，所以只断言宽度是假绿。→ `side` 在 `@media (max-width: 1080px)` 补 `minHeight: '320px'`；`narrow.spec.ts` 补一条 `rosterHeight > 120`。反向验证：删掉 `minHeight` → `width=1080：清单高度 0px，视觉上不可浏览` 立刻红。

**修前 / 修后（节点数已按 `945c456` 之后的真实规模 3086 重测）**：

| 视口 | 修前 canvas / webgl | 修后 canvas / webgl | 修前 roster | 修后 roster |
|---|---|---|---|---|
| 1440 | 780 / 780 | 780 / 780 | 340×348 | 340×348 |
| 1080 | **420 / 420**（两列，左列被挤） | 776 / 776（单列） | 340×348 | 776×226 |
| 900 | **280 / 280** | 636 / 636 | 340×348 | 636×226 |
| 600 | **180 / 180** | 536 / 536 | 340×348 | 536×226 |
| 400 | **0 / 0，`blocked`** | 336 / 336 | 340×348 | 336×188 |
| 375 | **0 / 0，`blocked`** | 311 / 311 | 340×348 | 311×188 |
| 320 | **0 / 0，`blocked`** | 256 / 256 | 340×348 | 256×188 |

七档 `pageErrors = 0`、`documentElement.scrollWidth − innerWidth = 0`（无横向滚动）、`rosterItems = 400` 全程不变。注：节点数从 5495 掉到 3086 后，**缺陷本身没有消失** —— 窄视口下画布仍归零、sigma 仍抛错（`Sigma` 的宽度检查与节点数无关），只是 600px 档从「180px 的窄条」变成「180px 的窄条」而已；上表修前列就是证据。

**测试**：`apps/web/e2e/narrow.spec.ts`（新文件）七档宽度逐一断言 `outerWidth > 0`、`webglWidth > 0`、`rosterItems > 0`、`rosterWidth > 0`、`rosterHeight > 120`、`≤1080px 时 rosterTop ≥ outerBottom − 1`（单列的直接证据）、全程 `pageErrors` 为空；另有一条「从窄视口拉宽后画布自动恢复」钉住 `needsWidth` 不是一次性判定。**这些断言只能在 Playwright 里做**：jsdom 没有布局（`offsetWidth` 恒 0）也没有 WebGL，`new Sigma()` 根本起不来。

**一处如实记录（未修，属边界）**：把**已经建好**的 sigma 容器用注入样式强行压到 0 宽（人造场景，不是自然视口），window resize 仍会让已存在的 sigma 抛 `Container has no width` —— `needsWidth` 只在「构造前」把关，已经建好的实例没有二次守卫。自然路径（视口 ≤400px 冷加载 + 拉宽恢复）实测 `pageErrors = 0`，所以不构成本票的失败项；真要彻底消除，得在 sigma 的 `resize` 之前挂一层 `ResizeObserver` 强制 `kill()`，代价是每次拖窗口都重建布局，收益不成比例。

### 6. t53：`/map` 冷加载 6.7s 的长任务里，72% 是「每轮布局写回都重索引整张图」

**测量环境（先声明，因为它是本次归因的关键）**：以下除标注「生产构建」的行外，都是 `pnpm dev`（Vite dev server，`:5173`）+ 真实 `/api/v1/graph`（当时 **3086 节点 / 269 边**，`945c456` 语料分离之后的规模）。dev 与 production build 的成本结构**完全不同**，用 dev 数字估用户体感会高估近一倍 —— 见下面的 dev-vs-prod 对照。

#### 6.1 三块成因分解

用 `.scratch/qa/scenarios/zz-perf.spec.ts`（新增）跑五组对照，每组量 `PerformanceObserver('longtask')` 的条数 / 合计 / 最长，以及画布就绪（`.graph-canvas-webgl` 出现）与清单就绪时刻：

| 组 | nodes | longtask 条数 | longSum | longMax | canvasAt | layout |
|---|---|---|---|---|---|---|
| `/board`（外壳基线） | 0 | 2 | 887 | 837 | — | none |
| `/map` 100 节点 | 100 | 2 | 1264 | 931 | 3364 | **worker** |
| `/map` 3086 短名（名字全是「甲」） | 3086 | 13 | 2123 | 845 | 3514 | worker |
| `/map` 全量 | 3086 | 14 | 4178 | 2057 | 5393 | worker |
| `/map` 无 WebGL（降级） | 0 | 3 | 1401 | 919 | — | none |

改前同一脚本的对应数字（`longSum` 6115 / 条数 41 / canvasAt 4999），分解为：

```
外壳公共（/board 也有）        887      16%
地图页 React（无 WebGL − 外壳）  514      10%
画布固定（100 节点 − 无 WebGL）    -137     ≈0（在噪声内）
随节点数增长（全量 − 100 节点）   2914     53%
其余（3086 短名组揭示的标签文字量） 2055    38%  ← 见 6.2，这条在生产下不成立
```

三块里两块当场就被排除：
- **FA2 确实在 Worker 里**：五组的 `data-layout-source` 全是 `worker`，主线程 profile 里 FA2 的 `iterate()` 采样为 0。票 03 第 1 条的要求成立，`zz-perf.spec.ts` 把它作为断言钉住。
- **画布/WebGL 固定成本可忽略**：100 节点组已经付过一遍 program 编译与字体图集初始化，与「无 WebGL」组相比是负数（噪声）。

#### 6.2 两个「看起来像原因」的假设，都被实验否掉了

**假设 A：sigma 为全部 3086 个标签预生成 SDF 字形，而屏幕上只显示十几个。**
`sigma.esm.js:2882` 的 `processWebGLLabels` docstring 明写 "Pre-generate glyphs for all node labels"，且内部只跳过 `visibility === 'hidden'` 或空标签，**不检查 `labelVisibility`**；调用点 `:4839` 传的是 `graph.nodes()` 全量。dev 的 CPU profile 也支持它：`generateSDFGlyph 7.3% + edt1d 6.3% + _defineProperty 4.1% + generateTextures 1.7% + ownKeys 1.4% = 25.6%`。

**决定性实验**：保持 3086 个节点不变，把每个节点的 `name` 换成单字「甲」（`/map 3086短名` 组）。dev 下 longSum 6115 → 4588（-25%），看起来假设成立。**但换成 production build 后，同一实验是 4260 → 4334 → 4170（全名 / 单字 / 空名，差 <4%）** —— 生产下标签文字量几乎不影响。dev 那 25% 是 Vite 的模块加载与源码映射开销被算进了字形生成的采样里。

**假设 B：dev 下 `<StrictMode>` 让画布建了两遍。** 这个成立，但只是 dev-only 成本：包一层 `getContext` 计数，dev 是 `webgl2: 2`（`kill @ sigma.js:7161` 占 2.9% 采样），production 是 `webgl2: 1`。

**dev vs production（同一份 3086 节点数据、同一台机器）**：

| | webgl2 上下文 | longtask 条数 | longSum | longMax | 画布就绪 |
|---|---|---|---|---|---|
| `pnpm dev` | 2 | 41 | 6115ms | 1905ms | 4999ms |
| production build | 1 | 43 | 4260ms | 1002ms | **1595ms** |

dev 的 6115ms 里约 1855ms（30%）是 StrictMode 双构建 + Vite dev 开销。**用户实际吃到的是生产那一行。**

#### 6.3 真正的成因：布局每迭代一轮，主线程就重索引整张图

生产构建下的长任务时间线（`probe-t53-timeline.mjs`）给出形态：

```
0-1s   2 条  合计 1170ms  最长 1109ms   ← 首屏构建
1-2s   1 条  合计  222ms
2-3s   9 条  合计  693ms  最长   81ms
3-4s  12 条  合计  886ms  最长   76ms
4-5s  11 条  合计  814ms  最长   77ms
5-6s   9 条  合计  670ms  最长   77ms
6s+    0 条
```

2.07s 到 5.8s 之间是 **39 条 72–81ms 的等间隔长任务**，间隔正好等于一轮 worker 迭代的往返时间。

**源码因果链**（三处逐字）：

1. `graphology-layout-forceatlas2/worker.js` 的 `handleMessage` 每收到一轮结果就调 `helpers.assignLayoutChanges(this.graph, matrix, this.outputReducer)`；
2. `helpers.js` 的 `assignLayoutChanges` 用 `graph.updateEachNodeAttributes(...)` 逐节点写 `x`/`y`；
3. sigma `sigma.esm.js:2104` 的 `bindGraphHandlers` 监听 `eachNodeAttributesUpdated`：
   ```js
   var updatedFields = e.hints?.attributes;
   var layoutChanged = !updatedFields || updatedFields.some((f) => LAYOUT_IMPACTING_FIELDS.has(f));
   ctx.refresh({ partialGraph: { nodes: graph.nodes() }, skipIndexation: !layoutChanged, schedule: true });
   ```
   `updateEachNodeAttributes` **不带 hints** → `updatedFields` 是 `undefined` → `layoutChanged` 恒 `true` → `skipIndexation` 恒 `false` → `refresh` 走进 `updateNode()` 的循环，**对全部 3086 个节点重跑 reducer + 样式 + 程序索引**。

3086 节点实测每轮约 74ms，而一轮 worker 迭代本身只要几毫秒 —— **布局期间的主线程开销几乎全部花在这个写回重索引上，而不是布局计算**。

**决定性实验（A/B）**：把 `LAYOUT_BUDGET_MS` 临时改成 `0`（布局到点立刻停）：

```
44 条 / 约 4800ms  →  2 条 / 1296ms（1052ms + 244ms）
```

**约 3500–3700ms（≈72%）全部来自布局写回循环**；首屏固有成本只有约 1300ms。中间档 `1_500` 是 16 条 / 末尾 3.2s，与预算线性相关。

#### 6.4 落盘的改动：副本图解算 + 节流写回

`apps/web/src/graph/layout.ts`（唯一改动的文件，+8/−1 之外主要是新增的 `syncLayoutPositions` 与注释）：

- `startLayout(graph)` 里先 `solver = graph.copy()`，把 FA2 的 supervisor 绑到**副本**上；副本上的 `updateEachNodeAttributes` 不经过 sigma，不触发任何重索引。
- 新增 `syncLayoutPositions(from, to)`：用带 hints 的 `to.updateEachNodeAttributes(fn, { attributes: ['x', 'y'] })` 一次性把副本坐标搬回渲染图 —— **只发一次事件、只重索引一次**，语义与原来逐轮写回完全一致（`x`/`y` 在 `LAYOUT_IMPACTING_FIELDS` 里，`skipIndexation` 仍是 false）。
- 用 `window.setInterval(sync, RENDER_SYNC_MS)` 驱动，`RENDER_SYNC_MS = 400`（2.5 次/秒；先试过 200，长任务仍偏多）。
- `stopConverging()` **先 `stopSync()` 再补一次最终写回**，然后才 `supervisor.stop()`。漏掉这一步时 worker 停了但定时器还在，把同一份冻结坐标反复写回，长任务从 13 条涨回 38 条、末尾拖到 9s —— 这是实现过程中实测到的坑，注释里写明了。
- `stop()` 同样先 `stopSync()` 再 `kill()`。

**为什么不用 `mergeNode` 逐节点搬**：`mergeNode` 不发 `eachNodeAttributesUpdated`，画布会停在种子位置一动不动（试过，`probe-t53-move.mjs` 会显示 0 帧变化）。必须让 sigma 收到**恰好一次**更新通知。

#### 6.5 改前 / 改后

**生产构建，3086 节点，默认 4s 预算**（`probe-t53-timeline.mjs`）：

| | longtask 条数 | longSum | longMax | 布局期长任务 | 末尾 |
|---|---|---|---|---|---|
| 改前 | 44 | ~4800ms | 1109ms | 39 条 × 72–81ms | 5.8s |
| 改后 | **13** | **~2200ms** | **1030ms** | 8 条（每 400ms 一次写回） | **5.6s** |

**`pnpm dev`，同一份数据**（`zz-perf.spec.ts`）：

| | longtask 条数 | longSum | longMax | 画布就绪 |
|---|---|---|---|---|
| 改前 | 41 | 6115ms | 1905ms | 4999ms |
| 改后 | **14** | **4178ms** | 2057ms | 5393ms |

longSum 降 32%（dev）/ 54%（prod），条数降 66%（dev）/ 70%（prod）。**画布就绪时刻没有变快**（dev 还略慢 0.4s，在轮次噪声内）—— 因为首屏那条 1.0–1.1s 的长任务没动，它来自 sigma 自身的节点索引与 WebGL 初始化，本票没碰。

**确认写回真的在生效，而不是「什么都不动所以很快」**（`probe-t53-move.mjs`）：布局期间每 400ms 截画布取 sha1，`201ms → 3798ms` 之间连续 7 帧各不相同，`4286ms` 之后完全冻结 —— 与 4s 预算吻合。如果退回 `mergeNode` 方案，这段会显示 0 帧变化。

#### 6.6 t44 的可分辨度验收没有破

| | 1x blobs | 1x 最大块占比 | 3x blobs | 3x 最大块占比 |
|---|---|---|---|---|
| 改前 | 2130 | 0.4% | 97 | 28.3% |
| 改后 | **2151** | **0.6%** | **97** | **32.2%** |

（`e2e/t44-shots.spec.ts` 实跑，3086 节点。差异在噪声内：布局在 4s 内停，最终坐标与逐轮写回只差最后一帧。）`layout.test.ts` 的 16 条（含 `separable > 0.75`、`inner > 0.05` 那条 5000 节点回归）全绿；`probe-t53-iters.mjs` 复算 40 轮 81.2% / 60 轮 82.9%，与改前一致。

#### 6.7 为什么没做更彻底的优化

- **把 `LAYOUT_BUDGET_MS` 调小**（如 1.5s）：长任务能降到 16 条，但 t44 的可分辨度是「40 轮 81.2%、60 轮 82.9%」才过线，1.5s 大约只跑 60–80 轮，余量变薄；而且用户会看到布局「突然停住」。4s 保留。
- **改成预置坐标（不跑 FA2）**：`probe-t53-iters.mjs` 的 `iters=0` 行是可分辨度 100%，但那是**向日葵盘种子本身**，没有任何拓扑信息（孤立点均匀铺开、有边的点不聚）。等于把 t44 的力导向成果扔掉，不划算。
- **首屏那条 1.0–1.1s 的长任务**：来自 sigma 构造时的节点索引 + WebGL 初始化（`processNodes` / `loadShader` / 首帧 program 编译），要拆只能把画布改成异步分片构建，改动面远超本票且会破坏「画布就绪」的可测试性。**它是固有成本，已在票面标注。**

#### 6.8 复现方式

```
pnpm dev                                   # 或 pnpm build && pnpm preview --port 4173
node apps/web/probe-t53-timeline.mjs       # 生产：长任务时间线
node apps/web/probe-t53-move.mjs           # 确认坐标在写回（帧指纹）
node apps/web/probe-t53-iters.mjs          # 迭代轮数 vs 可分辨度
cd .scratch/qa && PERF_ROUNDS=1 npx playwright test scenarios/zz-perf.spec.ts --reporter=line
```

四个探针都是本次新增、**用完即删**的临时脚本；`zz-perf.spec.ts` 留在 `.scratch/qa/scenarios/` 作为可复跑的对照实验。

### 7. t43：`layout.ts` 的 `RENDER_SYNC_MS 200→400` 与 `stopConverging()` 补 `stopSync()` 的归属与证据

> 归属说明：这两处改动是 t53 实现过程中调出来的，但**落在 t53 关闭之后**（t53 票面第 6 节写的是当时的状态）。按 captain 要求归进 t43（「浏览器深度验收，发现并修复全部缺陷」），在此补齐三项证据。t53 第 6 节仍是那次优化的主体记录，本节只补这两行的**改前/改后数字、视觉影响评估与反向验证**。

#### 7.1 改了什么（`apps/web/src/graph/layout.ts`，`git diff --stat` = 8 插入 / 1 删除）

```diff
-const RENDER_SYNC_MS = 200;
+const RENDER_SYNC_MS = 400;

     stopConverging: () => {
+      // 先停同步定时器：`supervisor.stop()` 只是不再「问下一轮」，副本坐标
+      // 就此冻结，定时器再跑也只是把同一份坐标反复写回、白白重索引。
+      stopSync();
       // 收尾这一帧的坐标要落地，否则最后几百毫秒的位移会丢
       syncLayoutPositions(solver, graph);
```
另外 8 行里还有 `stopConverging` docstring 里的一段说明（同一个理由，写给下一个读代码的人）。

#### 7.2 ① 改前/改后的长任务条数与总时长

**测量条件**：生产构建（`npx vite build` + `npx vite preview --port 4173`），3086 节点 / 231 边（用 `page.route` 造数与真实规模同形），1280×720，`LAYOUT_BUDGET_MS = 4_000` 不变，每档跑 **3 轮取中位数**。生产构建而非 `pnpm dev`：dev 下 `<StrictMode>` 会把画布建两次、Vite 还会把模块加载算进采样（见第 6.6 节），噪声远大于本改动的效果。

| `RENDER_SYNC_MS` | longtask 条数 | longSum | longMax | 布局期条数 | 布局期合计 | 末尾时刻 | 4s 之后残留 |
|---|---|---|---|---|---|---|---|
| **200（改前）** | 21 | 1868ms | 234ms | 20 | 1648ms | 4555ms | 0 |
| **400（改后）** | **12** | **1040ms** | 224ms | **11** | **803ms** | 4553ms | 0 |

**条数 −43%、布局期总时长 −51%。** 首屏那条固有长任务（约 224–234ms，sigma 节点索引 + WebGL 初始化）不变，所以 longMax 几乎不动 —— 符合预期：这次改的是「布局期每轮写回」，不是首屏。

复现：
```bash
cd apps/web && npx vite build && npx vite preview --port 4173 --strictPort &
node apps/web/probe-t43-longtask.mjs          # 打印 median + 每轮明细
sed -i 's/RENDER_SYNC_MS = 400/RENDER_SYNC_MS = 200/' src/graph/layout.ts && npx vite build
node apps/web/probe-t43-longtask.mjs          # 改前
```

#### 7.3 ② 400ms 一次写回，会不会看起来「一顿一顿」

这是本次改动最该被质疑的地方，所以分开量了**视觉**与**相机**两件事。

**(a) 写回的视觉步长**（`apps/web/probe-t43-step.mjs`，真实快照 `.scratch/graph-3086.json`，本地跑 FA2，按两种写回间隔取快照后算**净位移** —— 不是逐轮步长累加，节点会来回晃，累加会高估）：

| 写回间隔 | 第 1 次 | 第 2 次 | 第 3 次 | 第 4 次 | 第 5 次 | 稳态中位数 |
|---|---|---|---|---|---|---|
| 200ms（≈20 轮/次） | 23.72px | 2.50px | 1.47px | 1.08px | 0.86px | **0.86px** |
| 400ms（≈40 轮/次） | 22.51px | 2.51px | 1.58px | 1.14px | 0.94px | **1.58px** |

（单位：一次写回后节点**平均**移动的屏幕像素；`max` 见脚本输出，第 1 次写回单点最大约 250px。）

**结论**：唯一的大跳变是**第一次写回**（种子盘 → 第一次力导向结果），两种间隔下都是 22–24px 平均、几乎一样大 —— 那是「布局开始」的固有观感，与 200/400 无关。进入稳态后，400ms 的步长中位数是 **1.58px**，人眼在 860×480 的画布上分辨不出这是一次跳变，观感仍是连续微动（而 200ms 是 0.86px，差别远小于「一顿一顿」的阈值）。**代价是每秒 2.5 次 vs 5 次的刷新，收益是长任务条数减半** —— 在「布局本来就只是 4 秒的过场动画」这个前提下，这笔交换划算。

**(b) 拖动画布会不会滞后**：不会，且与 `RENDER_SYNC_MS` 无关。相机变换（`camera.animate/zoom`）走的是 sigma 的独立 camera 状态与 `requestAnimationFrame`，**不经过节点坐标写回**；节点坐标只影响「点在哪儿」，不影响「视口看哪儿」。所以布局期间按住拖动，画布跟随鼠标是每帧的，与 400ms 的写回节拍完全解耦。这一点是结构性的，不需要实测支撑；真正会被 400ms 影响的是「布局过程中节点的移动是否平滑」，即 (a)。

#### 7.4 ③ 反向验证：两行分别改回去，长任务都真的涨回来

| 配置 | longtask 条数 | longSum | 布局期条数 | 末尾时刻 | 4s 后残留 |
|---|---|---|---|---|---|
| 400 + `stopSync()`（**当前**） | 12 | 1040ms | 11 | 4553ms | 0 |
| 200 + `stopSync()` | 21 | 1868ms | 20 | 4555ms | 0 |
| 400 + **删掉 `stopSync()`** | 18 | 1673ms | 12 | **6866ms** | **5 条** |

两行各自独立有效：
- **`RENDER_SYNC_MS` 200→400**：条数 21→12、布局期 1648→803ms。
- **`stopSync()`**：删掉后虽然布局期条数变化不大（12），但**末尾从 4.5s 拖到 6.9s、4s 预算之后还残留 5 条长任务** —— 因为 worker 停了、副本坐标冻结，定时器还在把同一份坐标反复写回、白白重索引，直到组件卸载才停。这正是 t53 票面第 6.4 节记录的「13 条涨回 38 条、末尾拖到 9s」那个坑（当时是在 dev 环境下量的，绝对数字不同，方向一致）。

复现（第三行）：
```bash
python - <<'PY'
import io; p='apps/web/src/graph/layout.ts'; s=io.open(p,encoding='utf-8').read()
old="""      // 先停同步定时器：`supervisor.stop()` 只是不再「问下一轮」，副本坐标
      // 就此冻结，定时器再跑也只是把同一份坐标反复写回、白白重索引。
      stopSync();
"""
assert old in s; io.open(p,'w',encoding='utf-8',newline='\n').write(s.replace(old,'',1))
PY
cd apps/web && npx vite build && node probe-t43-longtask.mjs   # → 18 条 / 末尾 6866ms / 残留 5
```

#### 7.5 `apps/web/src/graph/` 下的未申报改动

**只有 `layout.ts` 这一个**（`git status --short apps/web/src/graph/` → `M apps/web/src/graph/layout.ts`）。该目录其余文件（`GraphCanvas.tsx`、`graph.css`、`status.ts`、`topology.ts`、`label-threshold.ts`、`layout.test.ts` 等）在工作区里都是干净的 —— t44/t47/t53 的改动都已由各自 commit 落主干。`git diff --cached --name-only` 为空（未 `git add` 任何东西）。

三个探针 `probe-t43-longtask.mjs` / `probe-t43-step.mjs` / `probe-t43-sync.mjs` 是本节的取证脚本，**取证完即删**（与 t53 的四个探针同一处理方式）；本节正文保留了完整命令，任何人可随时重建。

## 8. Comments：t62 双主题适配（2026-10-22）

### 8.1 方案选择：两套主题画布**都是深色面板**（选了 t62 票面的 a 方案）

票面给的 b 方案（亮主题浅底深点）被否决，理由是**可量化**的：
- 图里 3085 个点，直径 2–9px；浅底深点后，点的边缘只剩面积差，形状编码（圆/方/菱/三角）先糊掉；
- 视觉反相后，四态色要在浅底上重新调一套（明度差比色相差更重要），等于两套配色各自维护，t63 无法复用键名；
- a 方案把差异压在**一个维度**（画布的深浅档位），页面 chrome 仍是正常的亮/暗主题，图例、清单、按钮走页面语义键。

亮主题下面板是 `#14181F`（不是 t58 初版的 `#ECEDF0`），深主题是 `#0B0B0F`；两者都要求 < 0.05 相对亮度（`palette.test.ts` 断言），且**不相等**（探针断言）。面板四周加了 1px `--sm-border-control` 细边框 + `--sm-radius-lg` 圆角：亮主题下它必须看起来像「被放进去的一块面板」，而不是页面挖了个洞。

### 8.2 映射表（旧写死值 → 语义键 → dark / light）

| 角色 | 旧值（写死） | 键 | dark | light |
|---|---|---|---|---|
| 画布底 | `#12161c` | `graph-canvas` | `#0B0B0F` | `#14181F` |
| 网格 | `#1e2632` | `graph-canvas-grid` | `#1E2632` | `#242A33` |
| 连线 | `#2E3A4A`（`EDGE_COLOR`） | `graph-edge` | `#55637A` | `#64728C` |
| 节点标签 | sigma 默认 `#000` | `graph-label` | `#E6E6EC` | `#ECEFF4` |
| hint / broken / blocked | `#6b7785` / `#8fa0b8` | `graph-label-muted` | `#9AA0AC` | `#9AA4B2` |
| 焦点底衬 | `#12161C` | `graph-node-backdrop` | `#1C1C22` | `#1F2530` |
| 画布焦点环 | `#4c8dff` | `graph-focus-ring` | `#FF6B6B` | `#FF8A8A` |
| 四态节点 | `STATUS_COLOR` 常量 | `graph-node-*` | 不变（`#6E6E79` / `#7AA2FF` / `#4ADE80` / `#F5A524`） | `#8A93A3` / `#8FAEFF` / `#5FD79A` / `#FFC061` |
| zoom 按钮 | `#2e3644` / `#1e242d` / `#e8ecf2` | `border-control` / `bg-elevated` / `text-primary` | — | — |
| 图例底 / 边 / 数字 | `#ffffff` / `#e0e0e0` / `#616161` / `#9e9e9e` | `bg-surface` / `border-hairline` / `text-secondary` / `text-tertiary` | — | — |
| 图例按下 | `#4c8dff` / `#eef4ff` | `accent` / `accent-soft` | — | — |
| 清单 hover / 当前项 | `#f3f3f3` / `#eef4ff` | `bg-hover` / `bg-selected` | — | — |
| 推荐徽标 | `#fff1d6` / `#e8a33d` / `#7a4a02` | `warning-soft` / `warning` / `warning` | — | — |

关键点：**sigma 的默认标签色是纯黑**（node 与 edge 的 `labelColor` 默认值），深色画布上等于读不出 —— 这是既有缺陷，本次在 `nodeReducer` 里显式返回 `labelColor: colors.label` 修掉。标签色、连线色、焦点底衬色通过 `colorsRef` 读最新值，主题切换时整图 `refresh()` 一次（不重建画布，`data-node-count` 不变）。

### 8.3 实测对比度（`zz-graph-contrast.spec.ts`，浏览器里读 `--sm-*` 现算）

| 角色 | dark | light | 下限 |
|---|---|---|---|
| 节点标签 | 15.80:1 | 15.44:1 | 4.5 |
| 次要标签（hint/降级文案） | 7.48:1 | 7.06:1 | 4.5 |
| 连线 | 3.23:1 | 3.67:1 | 3 |
| 未学 / 在学 / 已掌握 / 需复验 | 3.90 / 7.89 / 11.27 / 9.63 | 5.75 / 8.19 / 9.89 / 10.99 | 3 |
| 画布焦点环 | 7.08:1 | 7.84:1 | 3 |
| 页面正文 / 次要文字（vs 卡片底） | 16.29 / 7.73 | 18.04 / 7.38 | 4.5 |
| 网格（装饰，仅记录） | 1.29:1 | 1.23:1 | — |

### 8.4 事故记录：块注释里的 glob 喂出了注释终止符（全站白屏）

t62 改 `apps/web/src/theme/tokens.ts` 时，docblock 里写了一句「图例与清单仍走 `bg-*/text-*` 这些页面语义键」。其中 `bg-*` 后面紧跟的 `/` 与星号组成 `*/`，**块注释在 `bg-*` 后就闭合了**，剩下的半句变成代码落进 `darkPalette` 的对象字面量里，120 行的 `{` 一直不闭合。

症状与坑：
- Vite 报 `[PARSE_ERROR] Expected ',' or '}' but found '-'`，**指到的是注释正文那一行**，与真正的缺失右括号完全无关；
- `tsc --noEmit` 与单测也报同样的下游语法错，但**单测根本跑不到**，所以「测试全绿」在这里没有任何保护作用；
- 开发服务器 `GET /src/theme/tokens.ts` 直接 **500**，React 一个模块都加载不了，**全站白屏**（不只地图页）；
- 这个缺陷只在「开发服务器 + 该文件被请求」的路径上炸，构建产物与已提交版本都正常 —— 典型的「只在某人工作区里出现」的玄学。

修法：`bg-* / text-*`（加空格断开 `*/`）。教训：**注释里写 glob 通配（`bg-*/text-*`、`**/*.ts`、`src/**/*.ts`）会喂出注释终止符**；写这类例子时要么加空格，要么用行注释。

### 8.5 相机挂点的证据边界

`cameraRef` 的挂载赋值、卸载置 null 目前只有代码 + `typecheck` + 既有 e2e 回归（28/28）作为证据：jsdom 没有 WebGL，`GraphCanvas` 在单测环境里走的是 `.graph-canvas-broken` 分支，拿不到 sigma 实例，因此**没有组件级单测**直接断言这个 ref。这条边界由 **t68（关卡浮层）在真浏览器里首次验证** —— 它要驱动「地图 → 近景」的连续缩放，挂点没接上会立刻暴露，而不是等到演示时。


## 9. Comments：t73 `graph.spec.ts` 并行抖动量化（2026-10-22）

### 9.1 先回答两个问题：失败率多少、是固定几条还是随机几条

5 次串行连跑（`npx playwright test e2e/graph.spec.ts --workers=1`，每次独立 `PLAYWRIGHT_OUTPUT_DIR`）：

| RUN | 结果 | 耗时 | 失败用例 |
|---|---|---|---|
| 1 | 28 passed | 3.5m | — |
| 2 | 28 passed | 2.8m | — |
| 3 | **4 failed / 24 passed** | 7.7m | 见下 |
| 4 | 28 passed | 3.1m | — |
| 5 | 28 passed | 5.6m | — |

**失败率 4/(28×5) = 2.9%，但 4 条红全部集中在同一次 run**，不是随机散布在五次里。四条分别是：

```
graph.spec.ts:651  从地图点进详情，再返回地图时落到该节点为焦点的视图
                   → locator('.graph-roster-item').first() toBeVisible 超时 60s，element(s) not found
graph.spec.ts:680  顶栏切到知识地图后画布就绪
                   → locator.click 超时 120s（getByRole('tab', {name:'知识地图'})）
graph.spec.ts:689  清单项的可访问名是「名称，状态，百分比/证据不足」 → 同上 toBeVisible 超时
graph.spec.ts:706  清单上看得见的状态文字只能来自五态词表           → 同上 toBeVisible 超时
```

### 9.2 三种可能的分辨（判据 + 证据）

| 可能 | 判据 | 实测 | 结论 |
|---|---|---|---|
| 真实竞态（产品代码有同步 bug） | 同一用例在无外部干扰时能稳定复现失败 | 5 次里 4 次全绿，且失败集中在一次 run 的**不同**用例 | **排除** |
| 资源竞争（抢 CPU / 抢真实库 / 抢 dev server） | 人为加压后失败率上升 | 并发双泳道（两个 Playwright 进程同时跑同一份 spec，共用 3001 库 + 5173 dev server）跑 4 次：**全部 28 passed**（lane A 4.1m/4.1m，lane B 4.2m/4.0m） | **排除** |
| 断言对时间敏感 + 共享 checkout 的源文件写入竞态 | 失败目录的 `error-context.md` 里应能看到「不是断言，是页面根本没起来」的痕迹 | 四个失败目录 `grep -o "PARSE_ERROR\|tokens.ts:163\|Transform failed"` **三个关键词全部命中** | **成立** |

决定性证据（RUN 3 某个失败目录的 page snapshot 原文）：

```
text: "[plugin:vite:oxc] Transform failed with 1 error: [PARSE_ERROR] Expected `,` or `}` but found `-`
╭─[ src/theme/tokens.ts:163:24 ]
│ 163 │ * 的图例与清单仍走 bg-*/text-*- 这些页面语义键 —— 两套主题差在 chrome，
│     ┴ `,` or `}` expected
D:/DeepSeek/starmap/apps/web/src/theme/tokens.ts"
code: server.hmr.overlay
```

即：**RUN 3 期间另一个泳道把 `apps/web/src/theme/tokens.ts` 写成了语法错误的半成品**（块注释里 `bg-*/text-*` 的 `*/` 提前闭合了注释，见 §8.4）。vite dev 是按需 transform，所以只有那几条「RUN 3 期间才第一次加载 `/map`」的用例撞上编译错误，前 24 条用的是更早的模块图缓存 —— **这正好解释「每次挂的是不同的几条」**：失败点跟着「哪几条恰好在那几秒加载模块」走。`stat` 显示 `tokens.ts` mtime = `18:36:06`，落在 RUN 3 时间窗内；RUN 3 结束后复核 `tsc --noEmit tokens.ts` → exit 0（对方已修好）。

### 9.3 修法（只改判据，不抬预算、不加 retry）

改的只有 `apps/web/e2e/graph.spec.ts` 一个文件（+94/−27）：

1. **新增 `waitForGraph(page)`**：先等 `.graph-canvas` 可见，再 `expect.poll` 等 `data-node-count > 0`。
   原先是 15 处 `await expect(canvas(page)).toBeVisible({ timeout: READY })` —— 「容器可见」只证明组件挂上了，`GraphCanvas` 对空数组也渲染，不证明图已经来了。`data-node-count` 是画布从 props 直接渲染出的真实数字。
2. **新增 `legendTotals(page)`**：先 `toHaveCount(4)` 等图例四格齐，再读计数。
   原写法 `allTextContents()` 在图例未渲染时返回空数组 → 累加得 0 → `expect(total).toBeGreaterThan(0)` 报的是「图例数据不对」，实际只是「还没画出来」。
3. **切回图谱视图后的单次读改成 `expect.poll(...).toBe(before)`**：切视图会重建画布，单次读会读到重建前/中途的值。
4. **文件头补「并行泳道下不稳定」一节**：写明 5 次连跑的实测分布、四条红的真实原因（别人在写 `tokens.ts`）、并发双泳道 4 次全绿的对照、以及「跑它要独占 checkout / 不引入 retry」的结论。

**没做的事**（对照票面约束）：
- `READY` 仍是 `60_000`，**没有**把 60s 改成 120s；
- **没有**加 `retries`（`playwright.config.ts` 保持 `retries: process.env.CI ? 1 : 0`）；
- **没有**动 `GraphCanvas.tsx` / `layout.ts`（不在 inScope）；
- `--workers=1` 本来就在 `playwright.config.ts` 里，本票没有改配置，只在文件头写清「它是让失败可复现，不是稳定性开关」。

### 9.4 修后复跑

| 阶段 | 命令 | 结果 |
|---|---|---|
| 冒烟 | `npx playwright test e2e/graph.spec.ts --workers=1` | 28 passed (4.9m) |
| 连跑 5 次 | 同上 ×5，各自独立 outputDir | 见下表 |

| RUN | 结果 | 耗时 | EXIT |
|---|---|---|---|
| 1 | 28 passed | 4.3m | 0 |
| 2 | 28 passed | 5.6m | 0 |
| 3 | 28 passed | 3.6m | 0 |
| 4 | 28 passed | 3.4m | 0 |
| 5 | 28 passed | 3.6m | 0 |

**失败率 0/140 = 0%。**

### 9.5 如实记录的边界

- **本票不能消除「别人正在写源文件」这类假红** —— 那是共享 checkout 的物理事实，只能靠「跑 e2e 前确认没人在改 `apps/web/src/**`」或 CI 独占来规避。文件头已把这条写死。
- 修后的判据仍然依赖 `data-node-count` 这个 DOM 属性。若将来有人把它改成异步延迟写入，`waitForGraph` 会跟着变慢但不会假绿（poll 到 60s 才红，报的是「节点数一直为 0」，比原来报「容器不可见」更接近真相）。
- 冒烟那一次跑（4.9m）比后续 5 次（3.9–4.4m）慢，是冷启动；本票没有把它算进失败率。
