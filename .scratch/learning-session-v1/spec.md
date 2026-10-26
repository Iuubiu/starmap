# 学习会话 V1 · 输入区与右栏 实现清单（spec）

> 依据：`.scratch/design/composer-3.html`（A/B/C 三版）、`.scratch/design/composer-b4.html`（B4/B5 两版，最终迭代）
> 与配套截图 `composer-A/B/B2–B5/C.png`。产品语境：`docs/design/learning-session.md`。
> 本清单只覆盖预览 HTML 里出现的东西：**输入区（Composer）与右侧学习档案栏**。
> 会话循环本身（先想再答、双通道、「记下了」确认）由既有票承接（t84 意图确认卡、
> 已上线的逐字流），不在本清单重复。
>
> 写法遵守 AGENTS.md：每张票 ≤30 分钟、票面写死输入/输出/判据；开工前先跑
> `node scripts/verify.mjs` 确认七段全绿。

## 0. 先拍一个板：v1 采用 B5 布局

预览 HTML 里共存两版最终稿：

| 版 | 输入区 | 知识点身份在哪 |
|---|---|---|
| B4 | 双层：知识点细条 + 输入行；细条右侧提示「按名字或页码找知识点」 | 细条 |
| **B5（建议）** | 一整块，无细条 | 右栏「正在学」卡 |

**建议 v1 = B5**，两条理由：

1. 它是最后一个迭代（时间戳 10:20，与 B4 同批但排在文件末位，命名「去掉细条，输入区一整块」）；
2. 与设计文档 §1「开口即开始，不先选章节」一致：知识点由对话推断后**展示**在右栏，
   不要求学习者先选。B4 细条的「按名字或页码找知识点」是有价值的**次级入口**，
   功能保留（T7），只是入口挪到「正在学」卡上。

B4 独有的「本档上限」卡（一次最多推进 N 个新知识点）建议并入 v1：数字来自现成接口，
成本一句话。C 版（卡片分栏 + 「27 本书」pill）未采纳，理由见 §3。

## 1. 功能点对照：预览 HTML 逐点 vs 代码现状

| # | 功能点（预览里长什么样） | 现状 | 缺口 → 票 |
|---|---|---|---|
| 1 | 输入区一整块：大圆角、18px textarea、占位「说说你想学什么，或者你卡在哪一步…」 | ✅ `components/Composer.tsx` 三层结构已有 | 框下工具条与档位 chip 要按 B5 移除 → **T1** |
| 2 | ＋ 添加按钮（ghost 圆角） | 按钮已有、**无行为** | v1 保持无动作（见 §3） |
| 3 | 模型选择器「DeepSeek V4 ▾」（框内按钮） | 按钮已有、仅展示（`modelLabel="默认模型"`，无 onClick） | 可用化需契约 + LlmPort 覆盖 → **T9**（第三批） |
| 4 | 🎙 语音按钮（ghost） | 按钮已有、无行为 | v1 后置 → **T10**（第三批） |
| 5 | 圆形发送；Enter 提交、Shift+Enter 换行 | ✅ 完整（含中文输入法 `isComposing` 拦截） | 无 |
| 6 | 知识点身份展示：B5 右栏「正在学」卡（名 + 学科·章节 + 已有可打开的关卡） | 细条 ✅（HomePage 传 `context`：徽标 + 去地图选）；「正在学」卡 ✗ | → **T3**（与 T1 同批）；章节路径字段缺 → **T8** |
| 7 | 「按名字或页码找知识点」搜索（B4 细条提示语） | ✗ 无任何搜索；现状只有「去地图选」 | → **T7**（含契约小改） |
| 8 | 档位卡：P2 pill + 「由 3 次作答判定 · 2 个变式已覆盖 · 连对 1/2」+「档位是测量结果，不能自选」 | `GET /tier/overview` 给 tier/source/label ✅；**判定依据数字与整句 ✗** | 两态文案 → **T2**；依据句 → **T6** |
| 9 | 门槛进度：作答 5/8 题、变式 2/3 组，双条 bar | ✅ `StudySidebar` 三行（作答/变式/连对）读 `GET /mastery/kp/:id` | 纯渲染对齐（两条 bar，连对进档位依据句）→ **T5** |
| 10 | 「本档上限：一次最多推进 3 个新知识点」卡（B4） | ✅ `GET /tier/session-plan` 给 limit/items/deferred | → **T4** |

## 2. 票清单

### 第一批 · 纯前端（不动契约；互不阻塞可并行，唯 T1 与 T3 同批落地）

**T1 Composer 按 B5 定版**
- 输入：`apps/web/src/components/Composer.tsx`、`theme/glass.css`（`.sm-composer-*`）、
  `Composer.test.tsx`、`pages/HomePage.tsx` / `pages/LearningPage.tsx` 引用处。
- 做什么：移除框下工具条（期刊下载器/文件/插件/视图切换）与框内档位 chip；
  输入区收成一整块；`tierLabel` prop 及其断言删除。
- 判据：① 组件测试更新后全绿（新增「无工具条/无档位 chip」断言）；
  ② 2560×1440 实测输入区宽度与左右留白数字写回执；
  ③ Enter/Shift+Enter/`isComposing` 行为不变（既有测试语义不动）。
- 坑：`zz-layout-2560` 探针在仓里已找不到（只在 `NEXT-VERSION.md` §13 被提及）。
  **动手前先确认探针在不在**；缺失则按 t83 票面四数重建，否则「四页四档留白差全 0.00」
  失去守门。删除知识点细条会让名字无处显示——**必须与 T3 同一批合入**。

**T2 档位卡（右栏）**
- 输入：`apps/web/src/components/StudySidebar.tsx`（或新建 `TierCard`）、`api/queries/tier.ts`（已有，只读）。
- 做什么：pill（P1/P2/P3）+ `label` + `source` 两态文案 + 固定句「档位是测量结果，不能自选。」
- 判据：① `source='fallback'` 显示「还没定级，先按完整样例档教」，**不得**出现「你的水平是 P1」；
  ② `source='placement'` 显示「由定级测得」；③ 两态各有测试断言；④ 禁止 POST/PATCH 档位
  （契约本就没有，前端也不出现任何「切换档位」控件）。

**T3 「正在学」卡（右栏）**
- 输入：`StudySidebar.tsx`、`api/queries/graph.ts` 的 NodeDetail（已有）。
- 做什么：知识点名（承接 T1 移除的细条）+ 来源 `pageLabel`（服务端拼好的整句，不前端拼）+
  关卡入口：`node.levels` 非空 → 「打开关卡」按钮跳对应路由；空 → 「还没有关卡，说一句让我生成」
  （只提示，不自动生成）+ 保留「去地图选」入口（T7 落地前它是唯一切换方式）。
- 判据：① 未选 kp 沿用现有引导句；② 选定后名 / pageLabel / 关卡按钮或提示三者有测试断言；
  ③ 3 个手工知识点（无 source）不 404，pageLabel 位降级为空。
- 坑：StudySidebar 现有注释明说「知识点名不在这里重复出现」——那是细条存在时的决定，
  T1+T3 合入后该注释与对应测试口径要一并改。

**T4 「本档上限」卡**
- 输入：`StudySidebar.tsx`、`api/queries/tier.ts` 的 `useTierSessionPlan()`（已有）。
- 做什么：一行「一次最多推进 N 个新知识点」；`deferred > 0` 时追加「还有 N 个，下次会话再开」。
- 判据：① `deferred=0` 与 `>0` 两态测试；② limit 数字来自接口（测试用 mock 断言透传，
  禁止在前端出现字面量 2/3/4——tier.ts 头注释已写明这条纪律）。

**T5 门槛卡渲染对齐 mockup**
- 输入：`StudySidebar.tsx` 的 `Row` 渲染。
- 做什么：作答/变式两条 bar（label 带「题/组」单位，单位来自 `KpProgressView.gates[].unit`）；
  连对行的去留由 T6 决定：T6 未落地前**保留第三行**，T6 落地后连对数字进档位依据句、此处删行。
- 判据：① 数据源与取数路径不变（仍 `GET /mastery/kp/:id`）；② 行数与 label 断言更新；
  ③ 「证据不足显示『—』不显示 0」的既有行为不变。

### 第二批 · 契约先行（contract-first，逐票 契约→后端→前端）

**T6 档位判定依据句**
- 输入：`packages/api-contract/src/domains/tier.ts`（`TierOverviewResponseSchema` 加字段）、
  后端 tier 用例（回放定级/重评 + attempts）、`StudySidebar` 档位卡。
- 做什么：加 `basis`：服务端拼好的中文句（先例：`NodeSourceSchema.pageLabel`——
  「句子给人，字段给机器」），同时给数值字段 `attemptsSince / variantsCovered / consecutiveCorrect`。
  文案形状对齐 mockup：「由 3 次作答判定 · 2 个变式已覆盖 · 连对 1/2」。
- 判据：① `openapi.yaml` 可见新字段，`pnpm contract:check` 绿；② 有定级记录与无记录
  （fallback）两态各有整句测试；③ 落地后 T5 才允许删连对行。

**T7 知识点搜索：按名字或页码**
- 输入：`packages/api-contract/src/domains/graph.ts`（`NodeStateSchema` 加可选
  `sourceTitle` + `page`，供书名消歧与页码搜）、后端 nodes 列表 join sources、
  前端新索引模块（建议落 `apps/web/src/graph/`，与 M2 地图找点共用）+「正在学」卡「换个知识点」入口。
- 做什么：`GET /nodes` 一次拉全量（当前 enabled 约 4030 节点）建本地索引，200ms 内出结果、
  不发请求（判据口径对齐 NEXT-MILESTONE M2）；纯数字输入按页码命中；重名结果带书名消歧。
- 判据：① 输入「吸收律」→ 结果 ≥1 且每条带书名；② 输入页码数字能命中对应节点；
  ③ 响应时间探针实测 <200ms 写回执；④ 空结果显示「没找到这个知识点」，不是空白面板。
- 坑：3077+ 节点大量重名（`信号`、`小结`），消歧字段不加进列表契约，这条票就做不出
  mockup 承诺的效果——`sourceTitle` 是本票的必要部分，不是可选优化。

**T8 章节路径**
- 输入：`packages/api-contract/src/domains/graph.ts`（`NodeDetailResponseSchema` 加
  `ancestors: string[]`，章/节名数组）、后端按 depth 回溯、`StudySidebar`「正在学」卡第二行。
- 做什么：第二行从「书名页码」升级为「学科 · 章 · 节」（mockup：「逻辑代数 · 第 1 章」）。
- 判据：① 契约先行；② 三级路径显示正确（抽 3 个不同 depth 的节点断言）；
  ③ 手工 kp 无祖先时降级显示 pageLabel，不报错。

### 第三批 · 大件与可后置（单独决策，不阻塞前两批）

**T9 模型选择器可用化**（mockup「DeepSeek V4 ▾」从摆设变功能）
- 输入：契约（新 `GET /api/v1/system/models` + `turns/stream` 请求体可选 `modelId`）、
  `apps/api` LlmPort 注入链、`Composer.tsx` 模型按钮、localStorage 记住选择。
- 风险：**动 LlmPort 注入链，属高风险改动，必须复核**（ADR 边界：唯一触达模型处）。
  参照 NEXT-VERSION §12 的前置纪律：先写评估再动手。
- 判据：① 契约先行、`contract:check` 绿；② 选定模型 X 后提交一轮，
  `agent_turns.trace` 的 `model.name = X`（集成测试断言）；③ 未选时走默认，现网行为不变。

**T10 语音输入**（可后置；v1 按钮允许继续占位）
- 输入：`Composer.tsx` 🎙 按钮 + Web Speech API（zh-CN）。
- 判据：① Chromium 实测一轮：语音 → 文本进输入框（不自动发送）；② 不支持的浏览器
  **按钮不出现**（不是禁用灰钮）；③ 识别中文本实时可见。

## 3. 明确不做进 v1 的

- **框下工具条四件套**（期刊下载器/文件/插件/视图切换）：预览两版都没有，且当前无真实
  行为。随 T1 移除；将来真做哪个，按功能另开票再回来。
- **「27 本书」pill**（仅 C 版出现）：C 版未采纳；「按书筛选」与「开口即开始」的理念冲突。
- **＋ 按钮的功能**：没有任何预览画面定义它打开什么。v1 保持无动作占位；
  若认为空按钮误导，可在 T1 里顺手隐藏——由 T1 执行时定，回执写明选了哪种。
- **多模型并行/对比**、**语音连续对话**：预览未出现，不猜需求。

## 4. 验收与门禁

1. 每票完成回执三行（做了什么 / 数字或产物路径 / 卡点）；视觉类结论必须带
   2560×1440 实测数字（AGENTS.md 硬规则）。
2. 每批合入前 `node scripts/verify.mjs` 七段全绿；T9 合入另加复核（高风险改动）。
3. 全部完成判定：§1 对照表每行「缺口」列为零——以 B5+右栏三卡（正在学/档位/进度，
   外加本档上限）的实机 2560 截图与 `composer-b4.html` 逐点对照。
