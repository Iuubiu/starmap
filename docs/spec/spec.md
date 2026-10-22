# Starmap 规格说明（v1）

Status: ready-for-agent
Slug: `starmap-core`
最后更新：基于 D1–D14 裁决、P1–P11 定位、Q1–Q6 裁决与表 3 数值。

---

## Problem Statement

一名核工程／物理方向的本科生（以及后续的研究生、备考者、在职工程师）要学《核电子学》与《电子技术基础·数字部分》，面对的现实是：

- 教材厚（王芝英 345 页、康华光数字部分 559 页，另有 100 篇经典论文），知识点高度网状，**按章节线性读会在第三章就失去方向**；
- 概念之间的依赖是硬的（数字电路 → 模拟电路 → 核电子学信号链），**缺一个前置就整章听不懂**，但教材不会告诉你缺的是哪个；
- 学完不知道自己到底掌握了没有——**重读带来的自信高于实际成绩**（Roediger & Karpicke 2006）；
- 通用聊天机器人只会「讲一遍」，讲完就忘，**既不给结构化产物，也不记录你哪一步没懂**；
- AI 生成的题目与解析质量不可靠（无效干扰项 33.75%），**用未校验的题去判定掌握会把错误写进学习记录**，之后所有推荐都建在错地基上。

用户要的不是一个「会聊天的教材」，而是一个**能判定掌握程度、能解释为什么推荐这一步、能把每一次学习都变成可回溯证据**的学习工作站。

## Solution

一个**本地单用户、无登录**的学科学习工作台。核心是一个「不是聊天」的智能体：底部常驻输入框，但每轮产出的是**结构化产物**——关卡卡、图谱聚焦、进度变化、追问表单——而不是气泡列表。历史是学习日志，不是聊天记录。

四个并存的东西：

1. **知识图谱关卡地图**（深色画布，2000+ 节点）：知识点不是章节，是一张网；点击节点进入关卡。同时保留一条线性主线作为退路，每次自动推荐都显示「为什么推荐这个」。
2. **两种关卡**：教学关卡（循序引导 → 展示细节 → 简单问题 → 判断掌握 → 未掌握则深究 → 进一步讲解 → 下一关）与题目关卡（考察判定）。四类来源并存：系统预设、自己创建、AI 依据学习情况生成、老师创建（暂不做，但文件规范先定好）。
3. **掌握度**：每个**微知识点**（叶节点）两个百分比——`achieved`（不衰减，管解锁与成长记录）与 `current`（按半衰期衰减，管推荐与检索门控）。判定基于证据量与变式覆盖，不是「做对一道题」。非叶知识点不持有掌握度，其颜色由子节点按证据量加权聚合得到（只读派生，不落库）。
4. **两个检视页**：数据库展示页（含检索调试器）与 skill 库展示页。前者是「为什么系统这样判断」的可观测性入口，后者是「应用里的教学策略到底有哪些」的资产清单。

一屏三区：深色图谱画布（主）、浅色学术工作台（次）、常驻输入框（底）。全中文。

## User Stories

### 入口与对话形态

1. 作为初学者，我想打开应用就看到「我该学什么」而不是一片空白，以便不用先做决定。
2. 作为初学者，我想在底部常驻输入框直接说「我想学核电子学的信号与噪声」，以便不用找菜单。
3. 作为学习者，我想对话的每一轮都在屏幕上产出**结构化的东西**（一张关卡卡、一次图谱聚焦、一个进度变化、一张追问表单），以便我知道刚才发生了什么，而不是读一段文字。
4. 作为学习者，我想看到的是学习日志而不是聊天记录，以便我能回溯「我哪天学了什么」。
5. 作为学习者，我想在我表达含糊时被追问（而不是被猜），以便系统不会沿着错误的理解走十分钟。
6. 作为学习者，我想追问只在对话开始时出现，以便我不被无休止的澄清打断。
7. 作为学习者，我想随时说「直接给我讲」并被尊重，以便我不用假装自己在思考。
8. 作为学习者，我想系统在我答不出时给**阶梯式提示**而不是直接给答案，以便我保留自己想出来的机会。
9. 作为学习者，我想连续三次答不上时被换一种更小的粒度重讲，以便我不会卡死在同一个说法上。

### 知识图谱与关卡地图

10. 作为学习者，我想看到一张大规模网状知识点地图，以便我理解这门学科的形状。
11. 作为学习者，我想地图上区分「已掌握／在学／未开始／需复验」，以便我知道自己在哪。
12. 作为学习者，我想点击节点就进入对应关卡，以便图不是装饰而是导航。
13. 作为学习者，我想节点能逐层展开（学科 → 模块 → 知识点 → 微知识点），以便 2000 个节点不会一次糊在屏幕上。
14. 作为学习者，我想看到某个知识点的前置依赖，以便我知道「学不动是因为缺哪一块」。
15. 作为学习者，我想地图默认只显示我附近的两跳邻域，以便我不会迷失。
16. 作为学习者，我想随时切回线性主线，以便我在迷路时有一条明确的路。
17. 作为学习者，我想每次自动推荐都显示理由（「你刚在 A 卡住，A 依赖 B，B 你只有 32%」），以便我能判断是否同意。
18. 作为学习者，我想一键改道（我不接受这个推荐），以便控制权仍在我手上。

### 关卡：教学型

19. 作为零基础学习者，我想在完全没基础时先看到**完整样例**而不是直接做题，以便我不至于从猜开始。
20. 作为有一定基础的学习者，我想看到**部分完成的样例**（前几步给了，后面留空），以便我不被当成零基础。
21. 作为熟练学习者，我想直接进入题目，以便我不被强制看冗余的例题。
22. 作为学习者，我想教学关卡里每一步都有「这一步为什么对」的信息性说明，以便正反馈对我有意义（而不是「很棒！」）。
23. 作为学习者，我想看到可见的进度推进（节点点亮、百分比上升），以便我的努力有反馈。
24. 作为学习者，我想教学关卡也计入掌握度证据，以便我认真学的部分不被当成没学。
25. 作为学习者，我想教学关卡不会因为答错就被判「未掌握」，以便我敢试错。
26. 作为学习者，我想教学关卡里能调出教材原文那一页，以便我核对。
27. 作为学习者，我想教学关卡里能调出对应的视频片段（≤6 分钟、已裁到纯讲解区间），以便我听老师讲一遍。
28. 作为学习者，我想教学关卡里能给出电路图／波形图／能谱图的图形演示，以便抽象公式有对应物。

### 关卡：题目型

29. 作为学习者，我想每关 5–8 题，以便一关能在一次学习里走完。
30. 作为学习者，我想提交后**立即**看到对错与原因，以便反馈和我的思考还对得上。
31. 作为学习者，我想事实／程序性题即时给完整解析，复杂概念题先只给「对错 + 错因类别」，完整解法留到再试一次之后，以便我还能自己再想一遍。
32. 作为学习者，我想答错后有 1 次免费重试，且换的是**平行题不是原题**，以便重试是学习而不是背答案。
33. 作为学习者，我想答错后被安排 ≥2 道平行题、间隔 ≥1 天，以便我不是当场重复而是真正巩固。
34. 作为学习者，我想看到题目来源（教材第几页／第几篇论文），以便我能追本溯源。
35. 作为学习者，我想知道哪些题是 AI 生成的、只进练习池，以便我理解为什么它不影响我的掌握度判定。
36. 作为学习者，我想题量不是固定分档（90 分做 5 题、70 分做 10 题那种是错的），以便系统不在我最不确定的时候少给证据。

### 掌握度

37. 作为学习者，我想每个知识点显示**具体百分比**而不只是「已掌握／未掌握」，以便我知道还差多少。
38. 作为学习者，我想同时看到 `achieved` 与 `current` 两个数，以便我理解「我曾经会，现在生了」。
39. 作为学习者，我想在证据不足时看到「证据不足」而不是一个虚假的 62.4%，以便我不被假精确骗。
40. 作为学习者，我想掌握度不随时间无故归零（`achieved` 不衰减），以便我过去的努力不作废。
41. 作为学习者，我想掌握度跨过阈值后才解锁章末出口，以便我不会在没准备好的时候被推着走。
42. 作为学习者，我想章末出口测是 8 题中 ≥7 对（85%），以便这个门槛是可理解的。
43. 作为学习者，我想高入度先修节点的门槛更高（10 题中 ≥9 对，90%），以便关键地基更稳。
44. 作为学习者，我想完全掌握后仍会被复验抽到（复验），以便我不会「学完就丢」。
45. 作为学习者，我想抽考没过时掌握度按错题数量下调而不是清零，以便惩罚与证据成比例。
46. 作为学习者，我想每完成 3 个知识点就重新评估我的水平档并可能调整流程，以便流程跟着我变化。

### 初始水平判定

47. 作为新用户，我想第一次使用时被判定起始水平（而不是所有人走同一条路），以便我不浪费时间也不掉队。
48. 作为新用户，我想定级用 8–18 道题而不是 30 道考试，以便我不在第一次使用就被劝退。
49. 作为新用户，我想定级题的文案是「帮我找到合适的起点」而不是「测试你的水平」，以便我不紧张。
50. 作为新用户，我想定级题必须来自我马上要学的知识点，以便定级本身就是学习。
51. 作为新用户，我想定级后立刻看到正确答案与一句话解释，以便定级不是白做。
52. 作为新用户，我想定级结果是临时的、学 5 题后可以重判，以便系统错了能纠正。
53. 作为学习者，我想系统不问「你是什么水平」然后直接分层，以便我的流程不由一句自评决定。

### 内容与资源

54. 作为学习者，我想知识点来自我提供的教材（不是模型编的），以便内容和我的课程对得上。
55. 作为学习者，我想教材解析能把公式保留为公式而不是乱码，以便我能核对推导。
56. 作为学习者，我想扫描版教材（王芝英那本没有文字层）也能被正确识别，以便核心教材不被跳过。
57. 作为学习者，我想看到知识点的来源页码，以便我回到原书。
58. 作为学习者，我想知识结构按「课程先修关系」排（数字电路在大三上之前，核电子学在其后），以便路径符合我的真实课表。
59. 作为学习者，我想系统明确标注「资源库里没有对口教材」的知识块（数字多道／FPGA／DSP），以便它不会假装覆盖了。
60. 作为学习者，我想 100 篇论文也能被检索，以便我深入某个专题。
61. 作为学习者，我想图表（电路图、波形、能谱）能被单独取出并在关卡里展示，以便我不只是读文字。

### 管理与检视

62. 作为用户，我想有一个数据库展示页，以便我能看到系统到底记了什么。
63. 作为用户，我想在数据库页里看到知识库 chunk 列表与答案块标记，以便我理解检索是怎么被限制的。
64. 作为用户，我想有检索调试器：输入一个问题，看到命中了哪些 chunk、为什么这次没给答案，以便检索门控不是黑盒。
65. 作为用户，我想看到掌握度的历史曲线，以便我知道自己什么时候学的、什么时候忘的。
66. 作为用户，我想有一个 skill 库展示页，列出应用内置的全部教学策略 skill（名称、描述、触发条件、版本），以便我能管理它们。
67. 作为用户，我想在 skill 库页启用／禁用某个 skill，以便我能关掉不想要的行为。
68. 作为用户，我想 skill 是可浏览的一等资产而不是藏在代码里的常量，以便我以后能迁移。

### 关卡创作与市场

69. 作为学习者，我想学完一段后让系统把这次学习过程打包成一个关卡，以便我以后能重走一遍。
70. 作为学习者，我想补全细节后把它保存进关卡库，以便我积累自己的关卡。
71. 作为学习者，我想关卡市场先展示预制关卡，以便我有起点。
72. 作为自制关卡的人，我想读到一份明确的关卡文件规范，以便我手写关卡也能被系统正确加载。
73. 作为使用者，我想系统能依据我的学习情况自动生成关卡，以便我不用自己设计。
74. 作为使用者，我想批量生成的关卡先经过校验才进判定池，以便错题不会污染我的掌握度。

### 稳定性与体验

75. 作为用户，我想所有界面、题目、解析、反馈都是中文，以便我不用在术语之间来回翻译。
76. 作为用户，我想专业术语第一次出现时带英文（如「能量分辨率（energy resolution）」），之后只用中文，以便我以后读论文能对上。
77. 作为用户，我想学习进度实时保存，以便我关掉浏览器不丢东西。
78. 作为用户，我想断网／模型超时不会让我的关卡崩掉，而是给一个明确的降级状态，以便我知道发生了什么。
79. 作为用户，我想图谱画布 2000+ 节点仍然能流畅拖动，以便它真的可用。
80. 作为用户，我想在深色图谱与浅色工作台之间切换时视觉不割裂，以便我长时间使用不累。

## Implementation Decisions

### 1. 进程与包结构

**Mastra 作为库嵌入后端进程，不单独起 Mastra 服务。** 业务路由与 Mastra 的 REST 面并存：业务路由挂 `/api/*`，Mastra 面挂 `/api/mastra`（供 Studio 调试与前端流式）。

```
apps/web              React SPA（Vite）
apps/api              NestJS + Mastra（嵌入式）
packages/api-contract OpenAPI 契约：openapi.yaml + 由它生成的前端客户端与类型
packages/engine       纯 TypeScript 领域内核（无 IO、无框架依赖）
packages/shared       Zod schema（关卡规范、卡片 schema、内部 DTO）——内部单一真源
tools/ingest          Python 离线内容管线（PDF → 文本/OCR → chunk → 候选知识点）
content/              内容产物（解析结果、图谱种子、关卡种子），版本化
```

**依赖方向是单向的**：`apps/web` → `packages/api-contract`（生成的客户端）→ 无；`apps/api` → `packages/engine` 与 `packages/shared`；`packages/engine` → `packages/shared`。**反向依赖一律视为架构违规**，由 `dependency-cruiser` 在 CI 里拦截（规则写在 `.dependency-cruiser.cjs`）。NestJS 内部按 feature 分模块、每个 feature 内 controller / service / repository 三层，**没有策略的纯 CRUD 模块不强行造 service**。完整的模块边界、深模块清单与依赖图在 `docs/architecture.md`，本 spec 只钉死包名与方向。

四条硬边界：

- **OpenAPI 是 API 契约的唯一真源**。`packages/api-contract/openapi.yaml` 由后端 Zod schema 生成（`@asteasolutions/zod-to-openapi`），前端客户端与类型由它生成（Orval），**禁止手写重复类型**。破坏性变更由 `@redocly/cli` 的 breaking-change 规则在 CI 里拦截。
- `packages/shared` 的 Zod schema 同时用于 ① Mastra `structuredOutput` ② 生成 OpenAPI ③ 后端入参校验。它是**内部**单一真源，不等于对外契约——对外契约是生成出来的 `openapi.yaml`。
- `apps/web` 只依赖 `@mastra/client-js` 与生成的 API 客户端，**不引入 `@mastra/react`**（其 Radix/Tailwind 与 Fluent v9 冲突）。
- `packages/engine` 不允许 import 任何 `@mastra/*`、数据库客户端或 `fs`。它是可被单测直接调用的纯逻辑层。
- `apps/api` 的用例层**不直接调 `@mastra/*`**，只经 `LlmPort`。Mastra 的所有变动因此被关在一个适配器文件里，且测试可以不初始化 Mastra、不打真实模型、不花钱。

**Mastra 层的目录遵守官方约定**（`agents/` / `workflows/` / `tools/` / `scorers/` / `skills/`，组装根是唯一的 `mastra/index.ts`），且 `index.ts` 只做组装、不含业务逻辑。Mastra 的目录约定管「AI 资产如何组装」，NestJS 的模块边界管「业务用例如何组织」，两者只在 `MastraModule.register()` 一处交汇。

### 2. 技术栈定稿

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | React + TypeScript + Vite + React Router + TanStack Query | 项目默认栈 |
| 组件 | `@fluentui/react-components` 9.74.10 + `@fluentui/react-icons` + Fluent Design Tokens | OmniDev 默认设计语言；亮/暗主题、键盘导航 |
| 图谱渲染 | `graphology` 0.26 + `sigma` 4.0（WebGL） | 2000+ 节点 WebGL 才稳；d3-force 物理计算放 Web Worker |
| 后端 | **NestJS 12** + `@mastra/nestjs` 0.2.37 + `@nestjs/platform-express` | OmniDev 默认技术方向；适配器实测是完整 NestJS 模块（DI、guards、限流、优雅停机、tracing、内置 auth 默认关闭）。**必须用 express 平台**（适配器 peer 是 `express ^4\|\|^5`，`platform-fastify` 装不上） |
| 智能体 | `@mastra/core` 1.78.0（**精确锁版本，不加 `^`**） | 近 90 天发 30 个稳定版，每约 3 天一个 minor |
| 数据库 | **PostgreSQL 18** + Drizzle ORM | OmniDev 默认；`@mastra/pg` 原生支持；接学校数据库时不需要换引擎 |
| Mastra 存储 | `PostgresStore` 设 `schemaName: 'mastra'`，业务表在 `app` schema | `PostgresBaseConfig.schemaName` 已在 `@mastra/pg@1.31.2` 类型定义核实可用；Mastra 表自动建，不手写 DDL |
| 检索 | 自有 chunk 表 + BM25（MiniSearch 7.2）+ 可选本地向量 | **两个端点都没有 embeddings**（实测：d1api 返回 503 `model_not_found`；api.deepseek.com 返回 404） |
| 向量（阶段二） | `@huggingface/transformers` 4.3.1 本地 ONNX（bge-small-zh 级） | 不依赖远端 embedding 服务；CPU 可跑；模型随应用分发 |
| 模型 | `https://d1api.xin/v1` + `deepseek-v4.1-flash` | 用户指定；1M 上下文、支持 tool/JSON/流式 |
| 数学渲染 | KaTeX 0.19 | 公式保留为 LaTeX 后可渲染 |
| 测试 | Vitest + Testing Library + MSW；Playwright | 项目默认栈 |
| 契约 | `@asteasolutions/zod-to-openapi` 生成 → Orval 8 生成客户端 → `@redocly/cli` 破断检查 | OmniDev 契约工程；生成物入库，禁用 `any` |

**模型路由**：所有 LLM 调用经一个 `LlmPort` 接口（`generateObject` / `streamObject` / `generateText`），内部走 Mastra Agent。**这是唯一允许直接触达模型的地方。**

#### 契约先行流程

改任何 API 的固定顺序，五步缺一不可：

1. **改 Zod schema**（`packages/shared`）——这是唯一的输入。
2. **生成 `openapi.yaml`**（`@asteasolutions/zod-to-openapi`）并**入库**。契约文件是审阅对象：PR 里必须能看到它的 diff。
3. **生成前端客户端与类型**（Orval → TanStack Query hooks）。前端只允许 `import` 生成物，**不得手写与契约重复的 interface**。
4. **契约测试**：后端集成测试的每个响应都过 `openapi-response-validator`，不符合即失败；MSW 的 mock 也从契约生成，不手写 fixture。
5. **兼容检查**：CI 里对 `openapi.yaml` 跑破坏性变更检测（`@redocly/cli` breaking-change 规则，或 `oasdiff`）。破坏性变更必须显式记录在 PR 描述里并升版本前缀。

`openapi.yaml` 里的错误结构统一为 `{ code, message, details? }`：`code` 是稳定的机器可读字符串，`message` 是中文用户可读文案，`details` 放字段级校验错误。**分页**统一 `?limit=&cursor=`，响应带 `nextCursor`（无更多时为 `null`）。v1 无鉴权（本地单用户），但契约里保留 `security` 段留空的位置，接学校数据库时不用改形状。

### 3. 数据模型（业务表，全部位于 `app` schema，由 Drizzle migration 管理）

**schema 划分**：`app.*` 是本应用的业务表，迁移文件由仓库自己维护、可回滚；`mastra.*` 由 `@mastra/pg` 的 `PostgresStore` 维护，随框架版本变动，**任何业务代码不得读它的表**。两者同库不同 schema，边界靠 `search_path` 与 Drizzle 的 schema 绑定强制，不靠约定。

**测试隔离**：每个集成测试建独立 schema（`CREATE SCHEMA app_test_<random>`）并在 `afterAll` 里 `DROP SCHEMA ... CASCADE`；测试进程的 `search_path` 指向它。**不使用共享库、不使用事务回滚代替隔离**（回滚不能覆盖 DDL 与序列行为）。

| 表 | 关键字段 | 说明 |
|---|---|---|
| `subjects` | id, name, description | 学科（当前只有核电子学，可扩展） |
| `modules` | id, subject_id, name, layer(`A`/`B`/`C`/`D`) | 模块层，承载 A 主干/B 探测/C 专题/D 先修 |
| `knowledge_points` | id, module_id, parent_id, name, name_en, summary, layer_depth, difficulty, source_refs | 知识点 + 微知识点（自引用树） |
| `kp_edges` | from_kp, to_kp, relation(`prereq`/`related`), strength | 先修边（来自课程大纲证据）+ related 边 |
| `sources` | id, kind(`book`/`paper`/`video`), title, file_path, pages, meta | 教材／论文／视频条目 |
| `chunks` | id, source_id, kp_ids, page_from, page_to, text, latex, kind(`body`/`figure`/`formula`) | 知识库切片 |
| `chunk_kp_answer` | chunk_id, micro_kp_id | 该 chunk 对**这个**微知识点是否为答案块；检索门控按当前知识点 join 此表 |
| `levels` | id, type(`teaching`/`quiz`), micro_kp_id, cognitive_level, origin(`preset`/`self`/`ai`/`teacher`), spec_json, version | 关卡（spec 见第 4 节） |
| `level_items` | id, level_id, stem, options, answer, explain_correct, explain_wrong, variant_group, misconception_tags, source_ref, pool(`practice`/`judgment`) | 题目；**对错两种反馈都必须预写**；`variant_group` 同组即同一变式 |
| `attempts` | id, level_id, item_id, micro_kp_id, response, correct, latency_ms, hints_used, attempt_no, created_at | 作答记录（掌握度证据的唯一来源） |
| `mastery` | micro_kp_id, achieved, current, evidence_count, variant_count, last_updated, next_review_at | 每知识点双字段掌握度 |
| `sessions` | id, started_at, ended_at, mode, kps_touched | 一次学习会话 |
| `learning_log` | id, date, micro_kp_id, action(`studied`/`practiced`/`verified`/`reviewed`), delta_mastery, note | 「哪天学了什么」 |
| `level_market` | id, level_id, title, tags, saved_at | 关卡市场（当前只做保存，不做分发） |
| `skills_registry` | id, name, description, triggers, version, enabled, path | skill 库（源自文件系统扫描 + 启用状态） |

### 4. 关卡文件规范（`level.spec.json`，版本化，供自制）

对外发布的规范，人可手写、系统可校验。字段（Zod 定义在 `packages/shared`）：

- `schemaVersion`（必填，语义化版本）
- `meta`：`id`、`title`、`type`（`teaching`｜`quiz`）、`microKpId`、`cognitiveLevel`（`remember`／`understand`／`apply`／`analyze`／`evaluate`）、`estimatedMinutes`、`author`、`license`
- `sources[]`：`{ kind, title, page? | url?, quote? }` —— **每个知识点卡至少一条来源**
- `cards[]`：教学关卡的内容卡 `{ id, title, bodyMarkdown, formulas[], figures[], sourceRef }`
- `steps[]`：教学关卡步骤序列，每步 `{ id, kind: 'explain'｜'workedExample'｜'check'｜'deepen'｜'recap', contentRef, questionId? }`
- `items[]`：题目 `{ id, stem, options[], answer, explainCorrect, explainWrong[], variantGroup, misconceptionTags[], sourceRef, pool }` —— `variantGroup` 在同一微知识点内唯一标识一个变式；平行题与被平行题**共用同一 `variantGroup`**，因此不增加变式数
- `flow`：`{ entry: 'express'｜'partial'｜'independent', onFail: 'deepen'｜'relevel', maxHints }`
- `gating`：`{ exitThreshold, itemCount }`

**结构不变量（校验器强制）**：
- 每道题必须有 `explainCorrect` **与** `explainWrong`（对错两种结果都要能立即反馈）；
- `type: 'quiz'` 的关卡每个 `item` 必须有 `sourceRef`；
- AI 生成的关卡 `pool` 只能是 `practice`；
- 同一微知识点内，`variantGroup` 不同的题才算不同变式；平行题必须与被平行题同组；
- 引用不存在的 `microKpId` 或 `sourceRef` 直接拒绝加载。

### 5. 掌握度与判定

**双字段**（D2）：

- `achieved`：取历史最高，**不衰减**，管解锁与成长记录。
- `current`：BKT 后验，按半衰期衰减——事实/公式 14 天、概念 30 天、综合 45 天（**设计推断，无直接文献**）。

**BKT 自实现**（D9）：4 参数（prior / learn / guess / slip），TypeScript < 100 行，写在 `packages/engine`。无 Python 侧车。`current` 的衰减以时间常数形式叠加在 BKT 的预测步上（遗忘即 `learn → forget`）。

**证据门槛**（表 3）：一个知识点要报「已掌握」，必须有 **≥3 个不同变式**、**≥8 次作答**。低于门槛时 UI 显示「证据不足」，不给数字。

**门控**（D3）：见 `GLOSSARY.md` 的「出口门控」——硬门槛只设在 ① 章末出口 ② 高入度先修节点。关内允许「尝试—失败—再听讲解」，失败计入进度。

- 章末出口：**n=8，≥7 对（85%）**，用二项下界而不是点估计。
- 高入度先修：**n=10，≥9 对（90%）**。

**题量与判定分离**：单关 5–8 题只产出证据，不单独决定掌握；掌握由跨关累积的证据决定。

**复验**：已掌握的知识点会按 `next_review_at` 被复验抽到（1/3/7/21/60 天各一次，每次 3–5 题）；未通过则 `current` 按错题数量下调（不清零），`achieved` 不变。不做扩张式间隔（Latimier 2021：扩张 vs 均一 g=0.034，不显著）。

**水平档**（D12）：三档 P1/P2/P3 是**每关的渲染参数**，不是三条课程路径（班间分组 g=0.04，班内分化 g=0.19–0.30）。

| 参数 | P1 零基础 | P2 有电子学基础 | P3 有工程经验 |
|---|---|---|---|
| 关卡首轮形态 | 完整样例 | 补全步骤（forward fading） | 直接出题 |
| 追问阶梯起始/上限 | L1 / 3 层 | L2 / 4 层 | L3 / 5 层 |
| 单次会话新知识点 | 2 | 3 | 4 |
| 反馈延迟 | 步骤级即时 | 步骤级即时 + 关末总结 | 整题提交后延迟 + 关末总结 |
| 每题尝试次数 | 2 | 2 | 1 |
| 掌握判定 | 连对 2 次 + 迁移题 | 连对 2 次 + 迁移题 | 连对 1 次 + 迁移题 |

升降级：每完成 3 个知识点重评；平均首轮正确率 ≥80% 上调一级，≤30% 下调一级并给已过知识点打 `revisit` 标记（不重开关卡）。

**初始定级**（OQ11）：行为频率自评（4 题）+ 8–18 道来自「即将要学的知识点池」的定级题；先验只做 ±0.4 logit 的平移，**不问「你是什么水平」，不按专业/年级查表**；停止条件三选一（后验 SD ≤ 0.35 / 连续 3 题落在 40–70% 带 / 熵变化 < 0.01）；**定级后必须展示正确答案**；低置信度判为 `provisional`，学 5 题后可重判。

### 6. 教学策略

**正反馈 = 信息性确认 + 可见进度**（D1）。禁止泛化表扬（「很棒！」「真厉害！」）。UI 必须有「本步为何正确」的显式槽位，不能只渲染 ✅。

**苏格拉底追问 = 显式状态机 + 求助阶梯**（D7）：

- 状态：`{ ladderLevel, hintsGiven, consecutiveFails, masterySignalHistory }`
- **每轮的阶梯上限由非 LLM 策略核心决定**（只读可信学习者状态），LLM 不能自行加码。
- 阶梯（5 级，按 `learner-leveling` 定义）：L1 概念辨认／量纲单位 → L2 公式选择与适用条件 → L3 近似与误差合理性 → L4 边界情形与失效模式 → L5 设计权衡。
- **同一追问轮序列内连续 3 轮答不上 → 退出追问**，换更小粒度重讲；**不无限追问，也不直接给答案**。
- 独立 judge 校验本轮是否越界；**过度拒绝比帮助不足危害更大**（arXiv 2608.12292 首轮 43% 诚实求助被误拒），所以越界判定要按拒绝原因分类，而不是只看总通过率。
- 追问占比约 40–60%，其余是微讲解 + 图形演示 + 即时反馈练习。

**时序决策与对话生成解耦**（D8）：「下一个教哪个知识点」是轻量策略（输入学习者状态摘要 + 先修图结构）；「怎么教」才是 LLM。两者不放在同一个调用里。

**检索门控**（D6）：每个 chunk 对**每个微知识点**分别标记是否为答案块（`chunk_kp_answer` 关系表），按当前知识点的 `current` 在**检索层物理过滤**：

| `current` | 模式 | 模型能看到 |
|---|---|---|
| < 0.4 | `context_only` | 只有背景上下文，**答案块被排除** |
| 0.4–0.7 | `prerequisite_first` | 提示、结构、定义脚手架 |
| > 0.7 | `full_reveal` | 全部，含答案 |

提示词约束无效（泄露率随模型能力上升），必须架构层解决。结构化输出强制 `visibleResponse` 以 `?` 结尾；内部推理字段展示前剥离。

**教学关卡流程**（需求 17）：引导 → 展示细节 → 简单问题 → 判断细节掌握 → 未掌握则深究 → 进一步讲解 → 下一关。未掌握分支不扣掌握度。

**错题深究**：错因归类（misconception_tags）→ 生成解析 + ≥2 道平行题（间隔 ≥1 天，不增加变式数）→ 二次校验后才回到判定池。

### 7. 内容管线（离线，独立于运行时）

`tools/ingest`：PDF → 版面分析 → 文本／公式／图表 → chunk → 候选知识点／考点／题型 → 人工/规则校验 → 写入 `content/` 的版本化产物 → 运行时导入。

**实测约束（必须写进规格的事实）**：128 个 PDF 中有 **11 个没有文字层**（按采样页 <100 字符判定），全部在 books 里：

`01_核电子技术原理_王芝英`（345 页，**A 层主力教材，扫描版**）、`02_核电子学_王经瑾上`、`05_核辐射测量原理_汤彬`、`06_核辐射物理及探测学_陈伯显`、`07_核辐射探测器_丁洪林`、`18_原子核物理实验方法`、`19_核辐射探测器及其实验技术手册`、`22_电子技术基础_模拟部分_康华光`、`23_数字电子技术基础_阎石`、`24_模拟电子技术基础_童诗白`、`25_电路分析基础_李瀚荪上册`。

`21_电子技术基础_数字部分_康华光`（559 页）**有完整文字层**。

**OCR 策略**（用户明确否决大模型 OCR）：使用专业 OCR 引擎（PaddleOCR/RapidOCR 系）并适配本机集显；OCR 是**离线批处理任务**，不是请求路径的一部分。逐页产出必须带置信度，低置信度页进人工复核队列。

**图表**：由版面分析切出 PNG/WebP，入 `chunks.kind='figure'`，供关卡卡引用。

**知识点抽取**：从教材结构（目录 + 小节标题 + 定义/定理块）+ 论文 DOI 索引（`papers/.doi_index.json` 已有 101 条映射）生成候选，再由规则校验（非 LLM 自由生成）。

**教材分级**（D14）：按**课程先修关系**而非「三本同类」。数字部分（第 3–4 学期）必须排在核电子学（第 4–6 学期）之前，中间隔模拟电子、电路分析、原子核物理。`18 原子核物理实验方法` 移到 A/T2（它是后继课教材）；`05 汤彬` 从核电子学主干位移到「探测/测量方法」组。**显式标注缺口**：资源库没有「数字多道／FPGA／数字脉冲处理」的对口教材。

### 8. Skill = 产品资产（Mastra 原生）

skill 以 `SKILL.md` + `references/` 落在应用仓库内（后端包下的 `mastra/skills/<name>/` 目录），由 `Workspace({ filesystem: new LocalFilesystem(...), skills: ['skills'] })` 扫描。**与 Agent Skills 规范同源（agentskills.io），不使用 DSH 的 skill 目录。**

渐进式披露：只有 `name`／`description` 进 system message，正文由 agent 调 `skill` 工具载入。长内容放 `references/`。

v1 的 8 个 skill：

| skill | 职责 |
|---|---|
| `intent-clarify` | 拆分用户意图并追问；**只在对话开始时用**，有轮数上限 |
| `socratic-tutor` | 5 级求助阶梯与追问状态机的策略文档 |
| `worked-example` | 完整样例／部分样例／独立练习三态切换 |
| `question-author` | 出题（干扰项设计、双分支反馈、来源锚定） |
| `misconception-diagnoser` | 错因归类与深究路径 |
| `mastery-verifier` | 章末出口与复验的判定流程 |
| `level-harvester` | 把一段学习过程打包为关卡草稿 |
| `course-mapper` | 教材／论文 → 知识点与先修关系的抽取规则 |

skill 库展示页读取同一份文件系统清单 + `skills_registry` 的启用状态。**禁用时从 workspace 的 skills 路径里摘除**（不是靠提示词让模型别看）——与 ADR-0001 同一原则：约束做成架构事实，不写成请求。

`name` 必须等于目录名，≤64 字符，仅小写字母数字连字符、首尾非连字符、无连续连字符（官方硬约束，违反会加载失败）。

### 9. UI 结构

六个页面（React Router）：

1. **智能体主页**（`/`）：一屏三区。深色图谱画布（主）、浅色工作台（次）、底部常驻输入框。每轮产出产物卡。
2. **看板页**（`/board`）：推荐功能 + 常用指令 + 今日学习摘要。
3. **知识图谱关卡页**（`/map`、`/map/:microKpId`）：全屏深色画布，两跳邻域、逐层展开。点击节点打开该微知识点的**入口关卡**（一个微知识点可有多张关卡，同一时刻只有一张是入口关卡；入口关卡的选取规则由引擎侧的纯函数决定并可有测试）。
4. **关卡内页**（`/level/:levelId`）：关卡卡渲染、题目作答、即时反馈、提示阶梯。
5. **数据库展示页**（`/data`）：数据浏览器 + 掌握度可视化 + **检索调试器**（输入 query → 看到命中的 chunk、每块对当前知识点是否为答案块、被检索门控排除的原因）。不做 SQL 控制台。
6. **skill 库页**（`/skills`）：只读列表 + 启用/禁用开关。不做在线编辑提示词、不做导入导出（迁移由文件系统天然支持）。

**设计语言**：浅色学术工作台（Fluent 2 默认 token）+ 深色知识图谱画布（独立 `FluentProvider` 主题）。两套主题切换不割裂；键盘导航与无障碍必须过。

### 10. 全中文（D10）

一切用户可见文本为中文：UI 文案、AI 生成内容、知识点名称、图表坐标轴与 tooltip。保持英文：代码标识符、类型名、表名列名、文件名、提交信息。

三条实现约束：
1. **禁止中文硬编码散落在组件里** —— 集中到一处文案资源。
2. **LLM 输出语言在系统提示强制约束且有校验**：输出非中文需重试或标红；进评测。
3. 教材原文引用保持原文，周围解释用中文。

术语格式：「能量分辨率（energy resolution）」首次出现带英文，之后只用中文。

### 11. 批处理与并发

「多线程子智能体批量生成关卡」用 Mastra Workflow：`.foreach(spec, { concurrency: 4 })` → 生成 → 结构化校验（`errorStrategy: 'fallback'`）→ 落库。用 `run.startAsync()` 触发（进程内语义，立即返回 `runId`），前端轮询或订阅 `run.observe()`。

**所有 step 必须幂等**——lease 是 advisory，不 fence 写操作，崩溃恢复可能重跑 step。

**只有批处理走 Workflow。** 单次 LLM 生成直接调 `LlmPort`（包一层 Workflow 只增加间接层）；追问循环走 `packages/engine` 纯函数（ADR-0003）。判据是：是否需要跨进程、跨重启、或在无人值守时继续跑。

### 12. 结构化输出

所有 agent 产出走 `structuredOutput`（Zod schema 来自 `packages/shared`），`errorStrategy: 'fallback'` + `fallbackValue` 兜底，避免单次抽风让整关生成失败。流式 + 结构化并存（chunk `type === 'object-result'`）。

### 13. 已确认的数值

| 参数 | 取值 |
|---|---|
| 章末出口 | n=8，≥7 对（85%） |
| 高入度先修 | n=10，≥9 对（90%） |
| 每关题量 | 5–8 |
| 免费重试 | 1 次，换平行题 |
| 错题变式 | ≥2 道同结构，间隔 ≥1 天 |
| `current` 半衰期 | 14 / 30 / 45 天 |
| 掌握报告的硬门槛 | ≥3 变式、≥8 次作答 |
| 定级题量 | 8–18（停止：SD ≤0.35 / 连续 3 题在 40–70% 带 / 熵变化 <0.01） |
| 视频片段 | ≤6 分钟 |
| 进度条初始预填 | 10–20% |
| 单次会话新知识点 | P1=2 / P2=3 / P3=4 |
| 追问阶梯 | P1 3 层 / P2 4 层 / P3 5 层 |
| 复验间隔 | 1 / 3 / 7 / 21 / 60 天，每次 3–5 题 |
| 检索门控阈值 | 0.4 / 0.7 |
| 空转上限 | 同一追问轮序列内连续 3 轮答不上即退出追问 |

## Testing Decisions

### 测试先行

**每张票都按 TDD 推进：先写失败测试，再写实现，最后重构。** 不是「写完补测试」。

- 在 4 个接缝上先写红测试：engine 的纯函数、API 的 HTTP 行为、`LlmPort` 的假实现契约、内容 repository 的返回形状。
- 集成测试写成「建临时 schema → 打真实 HTTP → 断言 JSON 且过 openapi 校验」，这个形状由票 01 固定下来，后续照抄。
- UI 的行为测试写在组件层（Testing Library），不写快照测试——快照只在样式意外变更时报警，不表达行为。
- 一张票完成的判据是「测试全绿且这些测试在实现之前是红的」。**先写实现后补的测试不算完成**——尤其对掌握度、门控、检索过滤这类数值逻辑，补的测试往往只是把实现抄一遍。

### 接缝（从高到低，共 4 个，不再增加）

1. **HTTP JSON API**（`/api/*`，契约见 `openapi.yaml`）——后端行为的唯一主接缝。前端测试用 MSW 在契约上打桩；后端测试用 NestJS `Test.createTestingModule()` + `supertest` 直接打真实 HTTP 层。
2. **`LlmPort`** —— 唯一触达模型的地方。测试注入脚本化的假模型（返回预置 JSON、可指定超时/非法 JSON/中英混杂）。**没有这个接缝，任何涉及 agent 的测试都不可重复且要花钱。**
3. **`packages/engine` 的导出函数** —— 纯函数，测试就是接缝本身，不需要 mock。
4. **内容产物的 repository 接口** —— 运行时只通过接口读 `content/` 产物；内容管线与运行时可以独立推进。

四个接缝各自只有一个入口，不新增细粒度 mock 点。

**明确不作为接缝的东西**：Mastra 内部（Workflow step 生命周期、Agent 实现、tool 调度）。Mastra 约每 3 天发一个 minor，测它的内部等于把测试绑在会高速变动的第三方实现上。所有 Mastra 交互都发生在接缝 2 之下，由 `LlmPort` 的实现承载，测试不穿透它。

### 什么算好测试

**只测外部行为，不测实现细节。** 具体到本项目：

- 不测「BKT 的内部变量叫什么」，测「给定一串作答，掌握度百分比单调上升到预期区间」。
- 不测「组件调用了哪个 hook」，测「点击提交后，页面上出现正确答案与错因说明」。
- 不测「LLM 说了什么」，测「本轮产物的 schema 合法、`visibleResponse` 以 `?` 结尾、且不含答案块内容」。
- 时间是注入的（可伪造），**不 sleep**。

### 先例（prior art）

**本仓库是绿地，没有任何既有测试可作先例。** 唯一可参照的是本机既有 `D:\DeepSeek\chuanguan-learning` 等历史项目——但按 Code Reuse Trust Policy，**不复用其测试代码**，只记一条已验证事实：该项目的需求台账记录 d1api.xin 端点「chat/tool/JSON/流式可用；embeddings 不可用」，与本 spec 的实测一致。

因此第一批测试写入后，它们自身就是后续所有测试的先例：属性测试写在 `packages/engine` 内部的 `*.test.ts` 旁，集成测试写成「建临时 schema → `supertest` 打真实 HTTP → 断言 JSON 且过 openapi 校验」的固定形状，组件测试写成「`render()` → `await screen.findByRole()`」的固定形状。

### 各层测什么

**`packages/engine`（单元 + 属性测试）**
- BKT：先验更新、guess/slip 边界、掌握度单调性（答对不降、答错不升）、衰减半衰期正确。
- 出口门控：85%/90% 二项下界判定；边界值（7/8 通过、6/8 不通过）。
- 检索门控：三档阈值下，对当前知识点标记为答案块的 chunk 被排除／放行的集合运算。
- 状态机：追问阶梯不越界；连续 3 次失败退出；重试换平行题。
- 用 `fast-check` 写属性测试（单调性、幂等性、互斥性）。

**`apps/api`（集成，NestJS testing + supertest + 临时 Postgres schema + 假 LlmPort）**
- 关卡 CRUD、开始关卡、提交作答、掌握度更新、定级流程、检索调试器。
- 每个测试建独立 schema（`app_test_<random>`），跑完 `DROP SCHEMA`；不 sleep、不共享状态。
- LLM 相关断言只看 schema 与业务字段，不看文案。
- **契约测试**：同一套请求同时过 `supertest` 与 `openapi-response-validator`，响应不符合 `openapi.yaml` 即失败。

**`apps/web`（组件 + 集成，Vitest + Testing Library + MSW）**
- 六个页面各一组：渲染、加载态、空态、错误态、键盘可达。
- 结构化产物卡片的 schema 渲染（关卡卡／图谱聚焦／进度变化／追问表单）。
- 断言对象是 **DOM 语义**（role/label/text），不是 class 名。

**端到端（Playwright）**
- 关键旅程：首次定级 → 进第一关 → 作答 → 看反馈 → 回图谱 → 看掌握度变化。
- 每个会话独立 `userDataDir` + DB 副本，LLM 调用全录制（回放保证可重复）。

### 三档模拟学习者（D13）

三个模拟学习者（P1 零基础 / P2 有电子学基础 / P3 有工程经验）是**常驻测试资产**，两个时机用：设计期做纸面评审，实现后驱动真实浏览器。

**必须遵守的三层顺序**（不可颠倒）：
1. **确定性断言层**（schema、数值、量纲、状态一致性）—— 先跑，最便宜；
2. **模拟用户行为层**（Playwright 真实点击输入）；
3. **LLM judge**（只评主观：语气是否恰当、下一步是否清楚）。

**模拟用户只能用于「发现问题的假设生成」与回归门禁，不能出「可用性达标」的结论**（Lost in Simulation 报成功率偏移达 9pp 且系统性失准；NN/g 实测 mode collapse）。报告首页必须标 `证据等级：假设生成`，`judge_scores.agreement_with_human_kappa` 在完成 50–100 条人工校准前恒为 `null`。

persona 的五要素：已有知识清单、知识边界（明确「不知道什么」）、典型误解、追问容忍度／求助倾向、语言习惯。形容词无效，必须写成可执行行为规则。三档区分度自检：首轮输入长度、追问容忍轮数、术语密度三项差异 <20% 即判 persona 坍缩。

**persona 里的「典型误解」在 v1 是我方设计假设，无文献支撑**，上线前须由 1–2 位核电子学教师复核。

### 内容评测

- 领域正确性**不让 LLM 当裁判**：LLM 只做抽取（自然语言 → 公式/数值），判定交给 CAS（数值容差 → 单位量纲 → 符号等价 → 原文溯源）。BioDimBench 硬数据：只比数值 invalid recall 0.600，加单位校验后 1.000。
- 出题质量：GPT-4 级模型与人类在 relevance/clarity/distractor 上无显著差异，但 GRADE 全为 VERY LOW ⇒ **AI 题只进练习池**，进判定池需规则校验或人工过。
- 语言：抽样检测 LLM 输出是否全中文，混入英文未加注需重试。

## Out of Scope

- **教师端**（不做；只发布关卡文件规范供他人自制）
- **关卡市场的真实分发**（只做「保存」与预制关卡展示）
- **登录、多用户、权限体系**（本地单用户；Mastra auth 保持默认关闭）
- **对接学校数据库**（表结构预留，不实现）
- **本机部署大模型**（用户明确不需要；本机算力只用于 embedding 与 OCR）
- **移动端／响应式小屏**
- **语音输入输出、TTS**
- **生产部署、域名、HTTPS、CI 流水线**
- **多学科内容**（架构预留 `subjects` 表，v1 只做核电子学 + 数字部分）
- **完整课程对齐到某一所高校的课表**（按先修关系排，不按某校课时表）
- **DKT / IRT / CAT 完整实现**（v1 只用 BKT + 简化定级）

## Further Notes

### 术语表

**术语的唯一真源是根 `GLOSSARY.md`**（已创建）。下表是 spec 用到的术语速查，与 `GLOSSARY.md` 冲突时以 `GLOSSARY.md` 为准；新增术语必须先写进 `GLOSSARY.md` 再在本 spec 使用，**不得另起同义词**。

| 术语 | 英文 | 定义 | 易混淆项 |
|---|---|---|---|
| 关卡 | level | 一次可完成的学习单元，分教学型与题目型；有 `level.spec.json` 规范 | 不是「章节」，也不是「一次会话」 |
| 知识点 | knowledge point (KP) | 图谱节点，可含子节点 | 不是「小节标题」；粒度以「能否单独判定掌握」为准 |
| 微知识点 | micro KP | KP 的叶节点，掌握度的判定单元 | — |
| 掌握度 | mastery | 双字段百分比 `achieved` / `current` | 不是「正确率」，不是「进度」 |
| `achieved` | — | 历史最高掌握，不衰减，管解锁与成长记录 | 不等于「学过」 |
| `current` | — | 按半衰期衰减的当前掌握，管推荐与检索门控 | 不等于「最近一次成绩」 |
| 证据门槛 | evidence threshold | ≥3 变式且 ≥8 次作答，未达则不给数字 | — |
| 证据不足 | insufficient evidence | 未达证据门槛时的状态，UI 不给数字 | 不是 0% |
| 出口门控 | exit gate | 硬门槛，只在章末出口与高入度先修节点设置 | 关内失败不叫门控失败 |
| 章末出口 | chapter exit | n=8、≥7 对的出口测 | — |
| 求助阶梯 | hint ladder | 5 级提示递进，每轮上限由非 LLM 策略决定 | 不是「提示越多越好」 |
| 追问 | probing | 苏格拉底式提问；每追问轮的产物 | 不是自由聊天 |
| 检索门控 | progressive context revelation | 按 `current` 在检索层物理过滤答案块 | 不是「提示词里别给答案」 |
| 答案块 | answer chunk | 对**某个微知识点**而言可直接据此作答的 chunk（按知识点分别标记） | 不是全库布尔属性 |
| 平行题 | parallel item | 与错题同结构、不同表面的题，用于免费重试 | 不是原题重做，**不增加变式数** |
| 变式 | variant | 同一知识点的不同表面形式，是「变式覆盖」的计数单位 | 不是平行题 |
| 定级 | placement | 新用户起始水平的临时估计 | 不是「考试」，不是「自评」 |
| 水平档 | proficiency tier | P1/P2/P3，**每关的渲染参数** | 不是三条课程路径 |
| 深究 | deepen | 教学关卡中未掌握时的追加讲解分支，不扣掌握度 | 不是「重做一遍」 |
| 关卡市场 | level market | 当前仅「保存」与预制展示 | 不做真实分发 |
| 痕迹 | log entry | `learning_log` 的一条记录 | 不是聊天记录 |

### 已实测的关键事实（不是假设）

- **两个模型端点都没有 embeddings**：`d1api.xin` 返回 `503 model_not_found`（deepseek-v4.1-flash、glm-5.3 均试）；`api.deepseek.com` 的 `/v1/embeddings` 返回 `404`。**检索必须以 BM25 起步，向量是阶段二的自托管本地模型。**
- **128 个 PDF 中 11 个无文字层**，含 A 层主力教材王芝英（345 页）。OCR 是必需工序，不是可选优化。
- **Mastra 1.78.0 原生支持 skill**（`SKILL.md` + `Workspace` + 渐进式披露），OQ1 已关闭，不需自研 loader。
- **Mastra 版本节奏约每 3 天一个 minor**，必须精确锁版本；升级当独立任务做。
- Node ≥ 22.13（本机 v26.11.1 满足）；TS 必须 `module: ES2022` / `moduleResolution: bundler`。
- `@mastra/core` 默认开启 PostHog 遥测（非匿名），`.env` 里设 `MASTRA_TELEMETRY_DISABLED=1`。

### 三条必须正视的风险

1. **van Gog & Sweller 2015**：测试效应随元素交互性升高而减弱，极高复杂度时可能消失。核电子学题目恰是高元素交互性（器件＋电路＋公式＋单位），「题目关卡驱动」的地基在这个学科上最不稳——靠大量变式与即时精细化反馈补，不靠「多做题」。
2. **Slavin 1987 + Kulik 1990**：掌握学习在标准化测量上的真实效应约 0.2（不是流传的 0.7–2.0），且门槛增加学习时间、降低完成率。系统可能「看起来很严谨，实际学得更少」。
3. **Chauhan 2025 + Bastani 2025**：AI 题无效干扰项 33.75%；无护栏 AI 撤除后学生倒退 17%。**用未校验的 AI 题判定掌握 = 把错误写进图谱。**

### 待验证（进实现前必须做的小实验）

1. `deepseek-v4.1-flash` 在 d1api 上的 `structuredOutput` 是否稳定（是否需要 `jsonPromptInjection` 兜底）——30 分钟可验证。
2. `@mastra/client-js` 被拖进前端依赖树后的 `vite build` 体积。
3. 本地 embedding 模型在 CPU 上的吞吐（决定向量检索是 v1 还是阶段二）。
4. PaddleOCR/RapidOCR 在本机集显上的实际吞吐（决定 11 本扫描教材的 OCR 排期）。
5. 2000+ 节点 sigma.js 在目标机器上的帧率。

### 内容管线的可拆票清单（OCR 等工序在此显式列出）

这些是**离线批处理工作**，不在请求路径上，必须作为独立工作任务排期。按依赖排序：

| # | 任务 | 输入 | 输出 | 关键判据 |
|---|---|---|---|---|
| C1 | PDF 版面分析基线 | 117 个有文字层的 PDF | 页级文本 + 块级版面（段落/公式/图表/表） | 抽样 20 页与原书对齐，不漏整段 |
| C2 | **专业 OCR 管线**（用户明确否决大模型 OCR） | 11 个无文字层的书 | 页级文本 + 每页置信度 | 每页带 `confidence`；<0.85 进人工复核队列；不得静默丢弃页面 |
| C3 | 公式识别 | C1/C2 的公式块 | LaTeX 字符串 | 抽样 50 个公式，KaTeX 能无错渲染 |
| C4 | 图表抽取 | C1 的图表块 | WebP + 图注 + 所在页 | 图注与图片必须配对；缺图注的图单独标记 |
| C5 | chunk 切分 + 答案块标注 | C1–C4 | `chunks` 表 + `chunk_kp_answer` 关系表 | **答案块标注必须人工/规则复核**——它直接决定检索门控是否有效；标注粒度是「chunk × 微知识点」 |
| C6 | 知识点候选抽取 | 教材目录 + 小节标题 + 定义/定理块 | 候选 `knowledge_points` 树 | 不靠 LLM 自由生成；每个知识点有页码溯源 |
| C7 | 先修边构建 | 课程大纲证据 + 教材依赖 | `kp_edges`（`relation='prereq'`） | 每条 `prereq` 边必须有证据来源，无证据的边不建 |
| C8 | 论文元数据建图 | `papers/.doi_index.json`（101 条） | `sources` + 论文节点 + 引用边 | 零 OCR；两个 README 的年份/被引/期刊直接入库 |
| C9 | 视频切分与对齐 | 用户后续提供的课程视频 | ≤6 分钟片段 + 知识点对齐 | 切在纯讲解区间，避开寒暄与题外话；无视频时此任务阻塞 |
| C10 | 关卡种子生成 + 校验 | C5–C7 + C8 | `content/` 下的关卡种子 | 必须过 `level.spec.json` 校验；AI 生成的只进 `practice` 池 |

C2 与 C9 是唯一两个**用户已明确表态或依赖外部输入**的任务：C2 的引擎选型已定（专业 OCR，适配本机集显）；C9 在用户提供视频前无法开工，规格中不假设视频存在。

### 任务拆分

本 spec 已拆为 20 张 tracer-bullet 票，落在 `docs/spec/issues/`（`01`–`20`），每张声明阻塞边与验收标准。要点：
- `02` 选《数字部分》康华光打头，**不是**因为它是核电子学主干，而是因为它是资源库唯一有完整文字层的主力教材——内容是慢的，骨架不能等。
- `17` OCR 与 `18` 全量建图是离线内容工序，与主线（`03`–`16`）并行，不挡学习者路径。
- `20` 是验收关卡：三档学生智能体跑通全流程，才说明前面各票拼成了一个完整应用。

### 已知的内容缺口

- 资源库**没有**「数字多道／FPGA／数字脉冲处理」的口对教材（`13 Nakhostin` 是唯一候选，但对应知识块在中国本科大纲里不存在，属研究生/科研层）。
- 没有任何高校把**康华光数字部分**列为核专业《数字电子技术》选用教材（只见作电类专业教材或参考书）。
- `papers/` 里有 1 个文件命名与内容不符（`10.1109_tns.2018.2840160_OpenAlexOA.pdf` 实为 `Dujardin2018_Needs`），3 个变音字母丢失（`Mller`/`Frhwirth`/`Kibdi`）。

### 架构决策记录

七条最难回退、最容易被后人「顺手改回去」的决定已单独写成 ADR，改动前先读：

| ADR | 决定 |
|---|---|
| `docs/adr/0001-retrieval-gate-at-retrieval-layer.md` | 检索门控放检索层，不放提示词 |
| `docs/adr/0002-sqlite-instead-of-postgres.md` | ~~本地单用户用 SQLite/libSQL~~（**已被 0005 取代，勿照此实现**） |
| `docs/adr/0003-probe-loop-in-engine-not-workflow.md` | 苏格拉底追问循环写在 engine 纯函数里，不用 Mastra Workflow |
| `docs/adr/0004-mastery-on-leaf-nodes.md` | 掌握度只挂在微知识点叶节点上，父节点颜色是只读派生 |
| `docs/adr/0005-postgres-instead-of-sqlite.md` | 用 PostgreSQL 不用 SQLite（推翻 0002） |
| `docs/adr/0006-nestjs-and-openapi-contract.md` | 后端用 NestJS；OpenAPI 是契约真源、由 Zod 生成 |
| `docs/adr/0007-mastra-layering.md` | Mastra 目录管 AI 资产、NestJS 模块管业务用例，只在 `MastraModule` 交汇；只有批处理走 Workflow |

### 一次性初始化清单（playbook §8）

| 项 | 状态 |
|---|---|
| `AGENTS.md` | ✅ 已建 |
| `/setup-matt-pocock-skills`（issue tracker / triage / domain docs） | ✅ 已跑 |
| `GLOSSARY.md` | ✅ 已建（22+ 条术语） |
| `docs/adr/` | ✅ 已建（7 条，其中 1 条已被取代） |
| `docs/architecture.md` | ✅ 已建 |
| `openapi.yaml` | ⬜ 票 01 产出 |
| `pnpm-workspace.yaml` + 根 `package.json` | ⬜ 票 01 产出 |
| `.env.example` | ⬜ 票 01 产出 |
| `docker-compose.yml`（PostgreSQL） | ⬜ 票 01 产出 |

术语的唯一真源是根 `GLOSSARY.md`；本 spec 的术语速查表与之冲突时以 `GLOSSARY.md` 为准。
