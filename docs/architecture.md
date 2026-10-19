# Starmap 架构

本文件说明模块边界与依赖方向。**术语以根 `GLOSSARY.md` 为准**，决策取舍见 `docs/adr/`，需求与验收见 `.scratch/starmap-core/spec.md`。

词汇沿用 `codebase-design`：**模块**（有接口与实现的东西，尺度无关）、**接口**（调用方必须知道的全部事实，不止类型签名）、**深度**（接口上每单位学习成本能换到的行为量）、**接缝**（可以不改此处而改变行为的位置）、**适配器**（在接缝上满足接口的具体物）。

---

## 1. 进程拓扑

一个进程，三层职责：

```
浏览器
  │  HTTP / SSE
  ▼
NestJS (apps/api)
  ├─ /api/*            业务 API（本应用的全部行为）
  ├─ /api/mastra/*     Mastra 的 REST 面（Studio 调试 + 前端流式）
  │
  ├─ application 层     用例编排：事务、跨模块协作
  ├─ engine (packages/engine)  纯策略：掌握度、门控、检索过滤、追问状态机
  │
  └─ 基础设施适配器
       ├─ app.* schema (Drizzle)        业务表，本仓库管迁移
       └─ mastra.* schema (PostgresStore) 框架表，随 Mastra 版本变动
```

**Mastra 作为库嵌在后端进程里，不单独起服务。** 单独起服务意味着两个进程、两套端口、两套 CORS、两套鉴权，而 Mastra 的路由本来就要被业务路由包一层。嵌入之后 `mastra.getAgent()` / `getWorkflow()` 直接在 NestJS service 里调用，事务边界与日志都在一处。

Studio 用 `mastra studio` 单独起、指向后端的 `/api/mastra` 即可调试，**不需要为 Studio 让 Mastra 跑独立服务**。

---

## 2. 包与依赖方向

```
apps/web  ──> packages/api-contract（生成的客户端与类型）
apps/api  ──> packages/engine, packages/shared
apps/api  ──> packages/api-contract（生成 openapi 时）
packages/engine ──> packages/shared
packages/shared ──> （无）
tools/ingest ──> content/（只写，不 import 任何 TS 包）
```

**箭头只能单向。反向依赖是架构违规**，由 `dependency-cruiser` 在 CI 强制，规则写在 `.dependency-cruiser.cjs`。

五条不能破的边界：

| 边界 | 为什么 |
|---|---|
| `packages/engine` 不 import `@mastra/*`、数据库客户端、`fs`、`http` | 它是全项目**唯一能被穷举测试**的层。破坏纯度等于放弃对教学策略的测试能力 |
| `apps/web` 不 import `apps/api` 或 `packages/shared` 的服务端 schema | 前端只从 `packages/api-contract` 拿生成物。手写与契约重复的 interface 是违规（Hyrum's Law：可观察行为即契约） |
| 业务代码不读 `mastra.*` schema 的表 | 那是框架的私有存储，随版本变动 |
| `apps/api` 的用例不直接调 `@mastra/*`，只经 `LlmPort` | 见 §5。这是让 AI 相关工作可重复、不花钱的唯一点 |

---

## 3. NestJS 内部结构

按 feature 分模块，每个模块内部三层。**不是每个 feature 都需要三层**——没有策略的纯 CRUD 模块只有 controller + repository，凭空造 service 是浅模块。

```
apps/api/src/
├── main.ts                    # bootstrap：全局管道、过滤器、ShutdownHooks
├── app.module.ts              # MastraModule 最后导入（见 §6）
├── common/                    # 跨模块：异常过滤器、日志、DTO 基类
├── adapters/                  # 端口实现（见 §5）
│   ├── llm/                   # LlmPort 的 Mastra 实现 + 脚本化假实现
│   ├── content/               # ContentRepository 的 fs 实现
│   └── persistence/           # Drizzle repository 集合
├── features/
│   ├── map/                   # 知识图谱查询、邻域展开
│   ├── levels/                # 关卡 CRUD、播放、提交作答
│   ├── sessions/              # 会话、学习日志、追问
│   ├── insights/              # 推荐、看板、进度
│   ├── placement/             # 初始定级
│   ├── authoring/             # 自制关卡、关卡市场
│   ├── content/               # 检索、检索调试器、数据库展示
│   └── skills/                # skill 库
└── mastra/                    # Mastra 层，见 §4
```

一个 feature 模块的内部形状：

```
features/levels/
├── levels.module.ts
├── levels.controller.ts       # 只做：解析请求 → 调用例 → 映射响应
├── levels.service.ts          # 用例编排：事务、调 engine、调 repository
├── dto/                       # Zod schema 派生（经 nestjs-zod）
└── levels.repository.ts       # Drizzle 查询
```

**controller 只做三件事**：解析、调用例、映射响应。超出就是逻辑放错了层（`architecture-patterns` 的经典失败模式）。

---

## 4. Mastra 层

### 4.1 目录（遵守官方约定）

Mastra 对目录**基本不设限**，但官方约定有实际作用（`src/mastra/public` 会被打包、`agents/<name>` 有文件式定义约定）。这里遵守约定，降低后续升级时的意外。

```
apps/api/src/mastra/
├── index.ts                   # 唯一的组装点：new Mastra({...})
├── agents/
│   └── level-agent.ts         # 生成关卡内容（structuredOutput）
├── workflows/
│   ├── level-batch.ts         # 批量生成：.foreach({ concurrency: 4 })
│   └── content-index.ts       # 内容索引重建
├── tools/                     # agent 可调用的工具（只读业务库、校验关卡合法性）
├── scorers/                   # 关卡质量评分（@mastra/evals）
├── skills/                    # SKILL.md 目录（见 §4.3）
└── workspace.ts               # Workspace + LocalFilesystem
```

**`src/mastra/index.ts` 是 AI 世界的组装根，不含业务逻辑。** 它只导出 `new Mastra({ agents, workflows, storage, logger })`。业务通过 `MASTRA` token 或 `MastraService` 反向注入使用。这条规则让 Mastra 的目录约定与 NestJS 的模块边界不打架：一边是「AI 资产如何组装」，一边是「业务用例如何组织」，两者只在一个 `MastraModule.register()` 处交汇（ADR-0007）。

### 4.2 什么用 Workflow，什么不用

这是最容易做错的地方。判据是**是否需要跨进程、跨重启、或在无人值守时继续跑**：

| 场景 | 用什么 | 理由 |
|---|---|---|
| 批量生成关卡 | **Workflow** `.foreach({ concurrency: 4 })` | 长时运行、可 `startAsync()`、崩溃可 `restart()` |
| 内容索引重建 | **Workflow** | 同上 |
| 苏格拉底追问循环 | **不用 Workflow**（`packages/engine` 纯函数） | 见下 |
| 单次 LLM 生成 | **直接调用** `LlmPort` | 包一层 Workflow 只增加间接层 |

**追问循环不用 Workflow**，尽管它看起来是状态机、Workflow 也有 `dountil` 与 `suspend`。理由是它的产物需要被**穷举测试**：每一条分支路径（连续答不上、学生说「直接告诉我」、误解题、分类判错）都要有测试。写成 Workflow 后，测试要穿过 Mastra 的 step 生命周期、snapshot、resume 语义——而 Mastra 约每 3 天发一个 minor。**把教学策略绑在会高速变动的第三方实现上是错的**（ADR-0003）。

代价明说：跨回合状态持久化、suspend/resume 要自己写。换来的是「改一个阈值不必升级框架」。

### 4.3 Skills = 产品资产

教学策略、出题方法论、掌握度解释规范这些「怎么想」的东西，写成 `SKILL.md` 放在 `src/mastra/skills/`，由 Mastra 原生加载。

```
src/mastra/skills/
├── level-design/
│   ├── SKILL.md               # frontmatter 必填 name + description
│   └── references/
│       ├── difficulty-curve.md
│       └── anti-patterns.md
└── probe-strategy/
    ├── SKILL.md
    └── references/
```

三条硬约束（来自官方规范）：

- **`name` 必须等于目录名**，≤64 字符，仅小写字母数字连字符，首尾非连字符，无连续连字符。
- **渐进式披露**：只有 `name` / `description` 进 system message，正文由 agent 需要时调 `skill` 工具载入。所以方法论可以写长，不吃每轮 token。
- **加载是无状态的**：指令作为 tool result 留在会话里；被上下文压缩挤掉后 agent 可再次调用 `skill`。

Skills 的启用/禁用状态存在 `skills_registry` 表，**禁用时从 workspace 的 skills 路径里摘除**（不是靠提示词让模型别看）。这与 ADR-0001 同一原则：约束做成架构事实，不写成请求。

### 4.4 结构化输出

所有 agent 产出走 `structuredOutput`，schema 来自 `packages/shared`，配 `errorStrategy: 'fallback'` + `fallbackValue`，避免单次抽风让整关生成失败。流式与结构化可并存（chunk `type === 'object-result'`）。

---

## 5. 接缝与适配器

四个接缝，不再增加（详见 spec 的 `## Testing Decisions`）：

| 接缝 | 接口 | 适配器 |
|---|---|---|
| HTTP JSON API | `openapi.yaml` | NestJS controller |
| `LlmPort` | `generateObject` / `streamObject` / `generateText` | Mastra Agent 实现 + **脚本化假实现** |
| `packages/engine` 导出函数 | 纯函数签名 | 无需适配器——测试就是接缝本身 |
| `ContentRepository` | 按知识点/来源查询内容产物 | `fs` 实现 + 内存实现 |

**`LlmPort` 是本架构里最重要的接缝。** 它的价值不只是「可换模型」，而是：

1. 测试里注入假实现 → **跑测试不打真实模型、不花钱、结果可复现**。
2. 假实现能精确制造失败：超时、非法 JSON、中英混杂、拒答。
3. Mastra 的所有变动都被关在 `adapters/llm/mastra-llm.adapter.ts` 一个文件里。

推论：**集成测试默认不初始化 Mastra**。只有极少数验证「适配器本身能跑」的测试才建 Mastra 实例。这是 `packages/engine` 纯度 + `LlmPort` 接缝的直接回报。

---

## 6. 三条来自适配器的硬约束

这三条不是风格问题，违反会直接出故障。

**① 必须用 `@nestjs/platform-express`。** `@mastra/nestjs@0.2.37` 的 peer 是 `express ^4 || ^5`。用 `platform-fastify` 装不上。

**② `MastraModule` 注册的是 catch-all 控制器（`@All('*')`）。** 导入顺序不对会拦截其它路由并返回 404。两条同时做：

```ts
MastraModule.registerAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    mastra: createMastra(config),
    prefix: '/api/mastra',          // ← 专用前缀，把 catch-all 关在笼子里
  }),
  inject: [ConfigService],
})
```

并在 `app.module.ts` 里**最后导入**。两者是防御纵深：前缀限制爆炸半径，顺序避免先注册先匹配。

**③ 后台 worker 要手动启停。** `MastraModule` 不启动 Mastra 的 background workers；不启动则定时 workflow、agent schedules、事件监听全部不运行。且 shutdown 时模块只 drain 请求，不停 worker。

```ts
// main.ts
await app.listen(port);
await app.get<Mastra>(MASTRA).startWorkers();

// 某个导入了 MastraModule 的模块的 providers 里
@Injectable()
export class MastraLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MASTRA) private readonly mastra: Mastra) {}
  async onApplicationShutdown() { await this.mastra.shutdown() }
}
```

`app.enableShutdownHooks()` 必须调用，否则 shutdown hook 不执行。

---

## 7. 存储

**同库、两个 schema。** `PostgresStore` 的 `PostgresBaseConfig` 有 `schemaName?: string`（已在 `@mastra/pg@1.31.2` 类型定义里核实），设成 `'mastra'`；业务表由 Drizzle 管 `app` schema。

```ts
// Mastra 侧
new PostgresStore({
  id: 'mastra',
  connectionString: process.env.DATABASE_URL,
  schemaName: 'mastra',
})

// 业务侧：Drizzle 的 pgSchema('app')
```

Mastra 的表由适配器自动建与管理，**不手写 DDL**，且 schema 本身也会被自动创建——`PostgresStore` 的初始化执行 `CREATE SCHEMA IF NOT EXISTS "<schemaName>"`（已在 `@mastra/pg@1.31.2` 的 `dist/index.js` 核实）。实测存在的表含 `mastra_threads` / `mastra_messages` / `mastra_agents` / `mastra_ai_spans` / `mastra_knowledge_*` / `mastra_schedules_*` 等；业务表由仓库自己的迁移管，可回滚。

**不要对 `mastra.*` 建外键**：那些表随 Mastra 版本变动，版本升级时外键会把业务迁移锁死。业务侧只存 Mastra 的 id 字符串（如 `thread_id`），关联完整性由应用层保证。

**生产环境建议 `disableInit: true`**：否则每次进程启动都可能触发建表/改表。改由部署脚本显式调一次 `storage.init()`，运行期只读。本地开发保持默认（自动初始化），省一步。

**测试隔离**：每个集成测试建 `app_test_<random>` schema，跑完 `DROP SCHEMA ... CASCADE`，测试进程的 `search_path` 指向它。不用事务回滚代替隔离——回滚盖不住 DDL 与序列行为。不需要 Mastra 的测试根本不该建 `mastra_test_*`（见 §5 推论）。

---

## 8. 一次作答的数据流

最常走的路径，也是最能说明边界的路径：

```
1. 前端 POST /api/levels/{id}/attempts
      请求体由生成的客户端保证形状，服务端再过一次 Zod
2. controller 解析 → service.submitAttempt()
3. service 内，事务开始：
     a. repository 取题目（answer / explainCorrect / explainWrong 都是预写的）
     b. 判对错 —— 纯比较，不经 LLM
     c. engine.mastery.update(state, evidence)    ← 纯函数
     d. engine.gating.evaluate(answers, rule)     ← 纯函数
     e. repository 写 attempts + mastery
4. 事务提交，响应返回「新掌握度 + 本轮反馈」
5. 若本轮进入追问，另起 POST /api/sessions/{id}/probe，走 engine.probe + LlmPort
```

**LLM 不在这条路径的判定环节里。** 作答对错由 `level_items.answer` 决定，掌握度由 BKT 决定，门控由二项下界决定。LLM 只负责生成新的关卡与讲解文本，且这些产物必须过 schema 校验。

这是刻意的：**判定必须可复现、可回归**。若掌握度由模型判定，换一次模型版本就换一套学习记录，历史推荐与解锁全部失去意义。

---

## 9. 深模块在哪

按 `codebase-design` 的判据：改一个阈值不需要动 API 契约，改 BKT 参数不需要动 UI，换图谱渲染库不需要动 engine。任何「改一个数要改三个地方」都是边界画错了。

| 模块 | 接口（对外承诺） | 藏起来的实现 |
|---|---|---|
| `engine/mastery` | `update(state, evidence) → state`、`isMastered(state) → boolean` | BKT 四参数、衰减半衰期、证据门槛、变式去重 |
| `engine/gating` | `evaluate(answers, rule) → { passed, reason }` | 二项下界、样本量、边界处理 |
| `engine/retrieval-gate` | `filter(chunks, current) → { allowed, excluded, reasons }` | 三档阈值、答案块判定、排除理由构造 |
| `engine/probe` | `next(state, classification) → { action, state' }` | 求助阶梯、降级阈值、错误类型处理 |
| `engine/placement` | `evaluate(responses) → { tier, provisional, confidence }` | 停止条件、重判触发、自评与客观题权重 |
| `LlmPort` | 三个方法 | Mastra 全部细节、重试、fallback、遥测关闭 |
| `ContentRepository` | 按知识点/来源查产物 | 文件布局、缓存、格式版本 |

`engine/probe` 的接口只有两个参数、一个返回值，里面藏着整个求助阶梯与降级状态机——**这是本项目最深的一个模块**，也是唯一能让「追问是否越界」可穷举验证的地方。

---

## 10. 内容管线边界

`tools/ingest`（Python）是**离线**的：产物写进 `content/`（入库、版本化），再由 `apps/api` 的导入命令读进 `app.*` 表。运行时不依赖 Python。

理由：OCR 与版面分析是 CPU 密集批处理，跑一次几小时；把 Python 拖进运行时意味着部署要管两个运行时，而它每次启动都无事可做。

---

## 11. 横切关注点

| 关注点 | 落点 |
|---|---|
| 日志 | NestJS 结构化日志（JSON），每请求带 `requestId`；**不打印学习者全文作答** |
| 错误 | 统一异常过滤器 → `{ code, message, details? }`；`code` 稳定机器可读，`message` 中文 |
| 配置 | `.env` + `.env.example`；真实值不入库 |
| 遥测 | `MASTRA_TELEMETRY_DISABLED=1`（Mastra 默认开非匿名 PostHog） |
| 限流 | Mastra 适配器自带（默认开）；业务路由另有全局节流 |
| 追踪 | `tracingOptions` 可开 OpenTelemetry；v1 不开 |
