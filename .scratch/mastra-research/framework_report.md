# Mastra 事实清单（架构决策用）

> 采集时间：2026-10-20。数据源优先级：npm registry → 官方文档（`mastra.ai/*.md`）→ GitHub 仓库源码 → 官方 release 列表。
> 所有「原文」引用均来自官方文档页或已下载的 npm tarball 内源码，路径见文末「证据文件清单」。

---

## 0. 一句话结论（给决策者）

Mastra 是一个**库（library）**，不是只能整体使用的服务器；它自带一个 Hono HTTP server（`mastra build` 产物），但也提供 8 种 server adapter 把同一套路由挂到你已有的 Node 后端里。它**不强依赖 Next.js**，`@mastra/client-js` 是纯浏览器可用的 fetch 客户端。结构化输出（Zod / JSON Schema）是一等公民且可用于流式。Workflow 支持并行、子流程、suspend/resume、异步启动，能承载批处理，但**step 必须幂等**（lease 是 advisory、不 fence 写）。**主要风险不在能力，而在版本节奏**：约每 3 天一个 minor，官方有 16 篇 v1 迁移指南。

---

## 1. 版本 / 发布日期 / 许可证

| 包 | latest | 发布日期 | 备注 |
|---|---|---|---|
| `@mastra/core` | **1.78.0** | **2026-10-15T22:37:38.661Z** | 1722 个已发布版本（含 canary）；1.x 稳定版 91 个 |
| `mastra`（CLI） | 1.34.2 | 2026-10-15 | **与 core 版本号不同步**，peer 要求 `@mastra/core >=1.58.0-0 <2.0.0-0` |
| `@mastra/client-js` | 1.55.0 | 2026-10-15 | 浏览器 SDK，版本线独立 |
| `@mastra/memory` | 1.38.0 | 2026-10-15 | peer `@mastra/core >=1.4.1-0` |
| `@mastra/rag` | 2.6.7 | 2026-10-11 | |
| `@mastra/evals` | 1.10.7 | 2026-10-14 | peer `vitest >=3 <5` |
| `@mastra/mcp` | 2.4.1 | 2026-10-15 | peer 卡最紧：`@mastra/core >=1.76.0-0` |
| `@mastra/pg` / `@mastra/libsql` | 1.31.2 / 1.26.2 | 2026-10-15 | |
| `@mastra/nestjs` | **0.2.37** | 2026-10-17 | **仍在 0.x** |
| `@mastra/fastify` / `express` / `hono` | 1.5.22 / 1.5.22 / 1.7.20 | 2026-10-15 | |
| `@mastra/ai-sdk` / `@mastra/react` | 1.11.1 / 1.11.0 | 2026-10-15 | |

**结论：每个子包独立版本线，禁止横向比较版本号大小。** `mastra 1.34.2` 与 `@mastra/core 1.78.0` 是同一代产品，不是两代。

### 许可证（**重要，文档里几乎不提**）

- npm `license` 字段全部写 `Apache-2.0`，但 GitHub API `license` 返回 **`NOASSERTION`**。
- 根目录 [`LICENSE.md`](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md) 原文：
  > "Portions of this software are licensed as follows: All content that resides under any directory named `ee/` … including `@mastra/core/auth/ee`, `@mastra/core/agent-builder/ee`, `@mastra/editor/ee` is licensed under the license defined in `ee/LICENSE`. … Content outside of the above-mentioned directories or restrictions is available under the **Apache License 2.0**"
- [`ee/LICENSE`](https://github.com/mastra-ai/mastra/blob/main/ee/LICENSE) = **MASTRA ENTERPRISE EDITION LICENSE v2.0，Effective September 22, 2026**，Copyright © 2026 Kepler Software Inc. 原文：
  > "Enterprise Features are made available in source-available form. **They are not open source.** … it does not permit Production Use, and it does not permit redistribution."
- EE 实际覆盖：`packages/core/src/auth/ee/`（RBAC / SSO / FGA / license 校验）、`packages/editor/src/ee/`（Agent Builder / Workflow Builder）。

**判断**：核心框架（Agent/Workflow/Tool/Memory/RAG/Evals/MCP）是 Apache-2.0，个人项目可放心用。企业特性源码可见但生产需商业授权。**这条不在官方文档正文里，只在仓库文本里，是隐藏的踩坑点。**

---

## 2. 核心构成：哪些稳定，哪些实验

官方文档用页首标记区分：`> **Beta:**` / `> **Deprecated:**` /（无标记 = 稳定）。我已全站 grep 过这些标记。

### 稳定（无 beta 标记）

| 原语 | 包 / 入口 | 形态 |
|---|---|---|
| **Agent** | `@mastra/core/agent` · `new Agent({...})` | `{ id, name, instructions, model, tools, memory, agents(子智能体), scorers, processors }` |
| **Workflow** | `@mastra/core/workflows` · `createWorkflow()` / `createStep()` | 见 §7 |
| **Tool** | `@mastra/core/tools` · `createTool({...})` | `{ id, description, inputSchema, outputSchema, execute(inputData, context) }`；文档明确 "`execute` has exactly one signature: `execute(inputData, context)`" |
| **Memory** | `@mastra/memory` | 四层：message history（默认）/ working memory / semantic recall / observational memory |
| **RAG** | `@mastra/rag` | `MDocument` → chunk → `embedMany` → vector store `upsert` |
| **Evals** | `@mastra/evals` | scorer 三类（Textual/Classification/Prompt-Engineering），返回 0–1；支持 live evaluation 挂在 agent/workflow |
| **MCP** | `@mastra/mcp` | `MCPClient`（消费）+ `MCPServer`（暴露），走 MCP **2026-07-28** revision，支持 stdio 与 Streamable HTTP |
| **结构化输出** | `agent.generate/stream(..., { structuredOutput })` | 见 §6 |
| **Subagents（supervisor 模式）** | `new Agent({ agents: {...} })` | Added in `@mastra/core@1.8.0` |

### Beta

| 能力 | 页面 | 原文 |
|---|---|---|
| **Workers**（orchestration / scheduler / background-task 三类 worker） | https://mastra.ai/docs/deployment/workers | "**Beta:** Breaking changes may occur without a major version bump until the API is stable." |
| **Durable Agents** | https://mastra.ai/docs/harness/durable-agents | 同上；`Added in: @mastra/core@1.45.0` |
| **Dynamic workflows**（`upsertDynamicWorkflow`） | https://mastra.ai/docs/workflows/dynamic-workflows | 同上 |
| **workflowDefinitions 存储域** | https://mastra.ai/docs/storage | 域表标注 `(beta)` |
| **OpenAI Responses API / Conversations 路由** | https://mastra.ai/docs/server/overview | "currently experimental" |

### Skills / Workspace（**本项目重点：原生支持，不需自研**）

Mastra 有两套 skill 机制，可并存：https://mastra.ai/docs/skills 、https://mastra.ai/docs/sandbox/skills

| 类型 | 定义方式 | 入口 | 依赖 workspace |
|---|---|---|---|
| **Agent-level skills** | 代码内 `createSkill({ name, description, instructions, references })`，或直接给路径 `'./skills/code-review'` | `new Agent({ skills: [...] })`，`import { createSkill } from '@mastra/core/skills'` | 否 |
| **Filesystem-backed（workspace）skills** | 目录 + `SKILL.md`，由 `Workspace` 扫描 | `new Workspace({ filesystem: new LocalFilesystem({ basePath }), skills: ['skills'] })`，`import { Workspace, LocalFilesystem } from '@mastra/core/workspace'` | 是 |

- 遵循 **[Agent Skills 规范](https://agentskills.io)**（与 Claude Code / DSH 同一套 `SKILL.md` 约定）。
- 目录结构：`SKILL.md` + `references/`（按需读）+ `scripts/` + `assets/`。官方建议："Keep the main workflow in `SKILL.md`. Move detailed material to `references/` so the agent only reads it when needed."
- `SKILL.md` frontmatter 必填 `name` + `description`；`name` 必须等于目录名、≤64 字符、小写字母/数字/连字符、首尾非连字符、不可连续连字符。另读 `license`、`compatibility`、`user-invocable`、`metadata`。
- **渐进式披露**：注册后 Mastra 只把每个 skill 的 name / description / path / source type 写进 **system message**，不预载正文；并自动注入三个工具：`skill`（载入 SKILL.md + 列出 references/scripts/assets）、`skill_read`（读 skill 目录内任意文件）、`skill_search`（搜正文与 references）。
- **加载是无状态的**：指令以 tool result 形式留在会话里；被上下文压缩挤掉后 agent 可再次调 `skill`。
- `skills` 路径形态：`skills`（扫每个直接子目录）/ `skills/code-review`（单目录）/ `skills/code-review/SKILL.md`（单文件）/ `./**/skills`、`./**/SKILL.md`（glob，**遍历上限 4 层**）。
- **同名优先级**：本地项目路径 > 托管路径 `.mastra/skills` > `node_modules`；同优先级重名直接**抛错**。Agent-level 直接 skill 优先于 workspace skill。
- **动态**：`skills` 可传 `({ requestContext }) => string[]`（同步/异步），按请求选 skill 集。
- **检索**：配了 BM25 或向量检索时自动索引 SKILL.md 与 references（scripts/assets 不索引）；未配则 `skill_search` 退化为大小写不敏感文本匹配。
- 类型入口已确认存在于 `@mastra/core@1.78.0`：exports 含 `./skills`（`dist/skills/index.js`）、`./workspace`（`dist/workspace/index.js`）、`./storage/domains/skills`、`./storage/domains/workspaces`。
- Skills / workspaces 也有 storage domain（LibSQL / Postgres / MongoDB）支持 CRUD + 版本化，`CompositeVersionedSkillSource` 可从 blob store 挂载已发布版本。

**判断**：本项目「skill 打包教学关卡生成策略」可以直接落在 `SKILL.md` + `references/`，不用自研 RAG-提示词拼接层。

### Deprecated

- **Agent networks（`.network()`）**：https://mastra.ai/docs/agents/networks 首行 —— "**Deprecated:** Agent networks are deprecated and will be removed in a future major release. Replace them with supervisor agents …"。
  → **新项目直接用 `agents: {...}` 子智能体，不要用 `.network()`。**

---

## 3. 服务端形态（库还是服务器？）

**两者都是。** 三种落地方式，官方都支持：

### (a) 独立服务（`mastra build` 产物）

- https://mastra.ai/docs/server/overview :7 原文 —— "Mastra runs as an HTTP server that exposes your agents, workflows, and other functionality as API endpoints."
- :45 原文 —— "Mastra uses **[Hono](https://hono.dev)** as its underlying HTTP server framework. When you build a Mastra application using `mastra build`, it generates a Hono-based HTTP server in the `.mastra` directory."
- `hono ^4.13.7` 是 `@mastra/core` 的**运行时依赖**（不是可选插件），另有 `hono-openapi`。
- 默认端口 `4111`（`PORT` 可覆盖），默认 host `localhost`（`MASTRA_HOST` 覆盖）。
- 产物：`.mastra/output/{index.mjs, mastra.mjs, tools.mjs, package.json, node_modules/, public/, playground/(仅 --studio)}`，**自包含可整目录拷走**，`node .mastra/output/index.mjs` 或 `mastra start`。

### (b) 作为库嵌进已有 Node 后端（**这是你要的答案**）

- https://mastra.ai/docs/server/server-adapters 原文 —— "Server adapters … run Mastra with your own HTTP server **instead of** the Hono server generated by `mastra build`"、"**You can still integrate Mastra into any Node.js application** without changing how agents or workflows execute."
- 官方适配器：`@mastra/express`、`@mastra/fastify`、`@mastra/hono`、`@mastra/koa`、`@mastra/elysia`、`@mastra/nestjs`、`@mastra/next`、`@mastra/tanstack-start`。
- **关键限制（原文 :9 Warning）**："Server adapters use the `mastra` instance you pass them and **don't run file-based discovery**. Register agents on that instance in code."
- **关键限制（原文）**：adapter 的 `init()` **不启动后台 worker**；scheduled workflows / agent schedules / event listeners 需要手动 `await mastra.startWorkers()`。

**NestJS 具体形态**（https://mastra.ai/reference/server/nestjs-adapter）：
```ts
@Module({ imports: [ /* ...你的模块 */, MastraModule.register({ mastra }) ] })
export class AppModule {}
```
- **仅 Express platform**：原文 "It's intentionally Express-only for v1. If Nest is bootstrapped with a different HTTP adapter, `MastraModule` throws during startup"。
- **坑 1**：`MastraModule` 注册的是 catch-all `@All('*')` —— "If it's imported before your app modules, it can intercept unrelated routes and return 404s." → **必须最后 import，或挂到专用前缀**（`prefix: '/api/v1/mastra'`）。
- **坑 2**：不启动 worker，`app.listen()` 后要 `await app.get<Mastra>(MASTRA).startWorkers()`；关停时要 `mastra.shutdown()`（`drainTimeout` 默认 5s）。
- 依赖注入用 `@Inject(MASTRA)` 或 `MastraService`。
- 版本 `0.2.37`——仍是 0.x，API 稳定性无保证。
- 默认路由前缀 `/api`；健康检查刻意不加前缀：`GET /health`、`GET /ready`、`GET /info`。

**Fastify / Hono 形态**（更简单，推荐给独立后端）：
```ts
const app = Fastify({ logger: true })
const server = new MastraServer({ app, mastra })
await server.init()
app.listen({ port: 3000 })
```
Hono 同形：`new MastraServer({ app, mastra })` + `await server.init()`。

### (c) 纯库（完全不暴露 HTTP）

`new Mastra({ agents })` 就是个对象，可直接 `mastra.getAgent('weather-agent')`、`mastra.getWorkflow('x')` 在自己的 route handler 里调用。**这时 Mastra 只是进程内的编排库，你完全掌控 HTTP 层。**

---

## 4. 前端集成

### `@mastra/client-js` 是什么

https://mastra.ai/docs/server/mastra-client :7 —— "The Mastra Client SDK provides a concise and type-safe interface for interacting with your Mastra Server from your client environment."
:15 Note 原文 —— "The Mastra Client SDK is **designed for browser environments and uses the native `fetch` API**"。

源码验证（`@mastra/client-js@1.55.0` dist/index.js，4.5MB / 142 files）：**无 `from "node:*"` 导入、无 `process.env` 使用** → 纯浏览器可打包。

覆盖能力：Agents（generate/stream/resumeStream）、Memory（threads/messages）、Tools（`executeTool`）、Workflows（run/stream/observe/resume/cancel）、Vectors、Logs/Observability、Schedules、Stored Agents、Dynamic Workflows。

构造参数（`dist/types.d.ts:55-74` `ClientOptions` 实测）：

```ts
interface ClientOptions {
  baseUrl: string
  apiPrefix?: string      // 默认 '/api'，必须与服务端 server.apiPrefix 一致
  retries?: number        // 默认 3，指数退避 100ms → 1000ms
  headers?: Record<string, string>
  abortSignal?: AbortSignal   // 全局取消
  credentials?: 'omit' | 'same-origin' | 'include'
  fetch?: typeof fetch        // 可注入（Tauri 等）
}
```

### 流式怎么接到 Vite + React（两条路，都验证过 API 存在）

**路 A：`@mastra/client-js` 原生流（不依赖 AI SDK UI）**

```ts
// apps/web/src/api/stream.ts
import { MastraClient } from '@mastra/client-js'

// ⚠️ baseUrl 与 apiPrefix 是两个独立量：
//    最终 URL = baseUrl（去尾斜杠） + apiPrefix + path
//    所以不要把 '/api/mastra' 塞进 baseUrl，否则会拼成 /api/mastra/api/agents
const client = new MastraClient({
  baseUrl: '',                 // 同源；Vite dev 用 proxy 转 :4111
  apiPrefix: '/api/mastra',    // 必须等于服务端 server.apiPrefix
})

const agent = client.getAgent('level-agent')
const res = await agent.stream([{ role: 'user', content: '生成第 3 关' }], {
  memory: { resource: 'local-user', thread: 'level-3' },
  structuredOutput: { schema },        // ← 结构化与流式可同时
})

await res.processDataStream({
  onChunk: async (chunk) => {
    // chunk.type: 'text-delta' | 'tool-call' | 'tool-result' | 'object-result' | 'finish' ...
    if (chunk.type === 'object-result') setCard(chunk.object)
  },
})
```

- **断线重连**：`agent.subscribeToThread({ threadId, resourceId, reconnect: true })` —— 官方原文 "Pass `reconnect: true` to resubscribe when the transport closes"；4xx/501 停止重连，408/429 继续重试（`x_ref_client-agents.md:324`）。
- **HITL**：`agent.resumeStream(resumeData, options)` / `agent.approveToolCall({ runId, toolCallId })` / `declineToolCall(...)` / `agent.listSuspendedRuns()`（**基于 storage，服务重启后仍可列**）。
- 要转成 AI SDK UI 的 part 流：用 `@mastra/ai-sdk` 的 `toAISdkStream()` 把 `processDataStream` 包成 `ReadableStream<ChunkType>`（`x_ref_client-agents.md:149-162`）。

**路 B：服务端 `chatRoute()` + 前端 `useChat()`**
- 服务端 `server.apiRoutes` 加 `chatRoute({ path: '/chat/:agentId' })`（`@mastra/ai-sdk`），前端 `useChat({ transport: new DefaultChatTransport({ api: '/api/mastra/chat/level-agent' }) })`。
- 路 B 更省事但会把 AI SDK UI 协议带进前端；**路 A 更适合与 TanStack Query 组合**（`useQuery` 拿 run 结果 + 单独订阅流）。

**不要用 `@mastra/react`**：它的 dependencies 带 `@radix-ui/react-tooltip`、`tailwind-merge`、`lucide-react`、`shiki`，与 Fluent UI v9 体系冲突。

### 是否强依赖 Next.js？**否。**

官方有独立的 Vite + React 指南：https://mastra.ai/integrations/frameworks/vite-react，命令就是 `npm create vite@latest mastra-react -- --template react-ts`。示例里只有两处是 Mastra 相关：
1. 后端注册 `chatRoute({ path: '/chat/:agentId' })`（来自 `@mastra/ai-sdk`）；
2. 前端 `useChat({ transport: new DefaultChatTransport({ api: 'http://localhost:4111/chat/weather-agent' }) })`。

示例用的 AI Elements 组件库（Tailwind + Radix）**只是示例选择**，与 Mastra 本体无关。

⚠️ 但要注意 2 个实际依赖后果：
- `@mastra/client-js` 运行时 import 了 `@mastra/core/error`、`@mastra/core/request-context`、`@mastra/core/a2a/client`、`@mastra/core/a2a/v1`，且 `package.json` 里**精确锁死** `"@mastra/core": "1.78.0"` → **前端装 client-js 会把 core 拖进依赖树**，需实测 tree-shaking 后 bundle 体积。
- `@mastra/react` 是另一条路（TanStack Query hooks，peer `react >=19`、`@tanstack/react-query` 为 **optional** peer），但它的 dependencies 自带 `@radix-ui/react-tooltip`、`tailwind-merge`、`lucide-react`、`shiki` → **与 Fluent UI v9 体系冲突**，不建议引入 `@mastra/react`；用 `@mastra/client-js` + 自己的 TanStack Query 包装更干净。

### Mastra Studio / Playground

- **Studio** = 官方 GUI（构建/测试/管理 agents、workflows、tools），能改模型参数、看 reasoning、workflow 图形化逐步执行 + time travel 重放、跑 scorer。
- `mastra dev` → 服务起在 **http://localhost:4111**，Studio 同端口；`/swagger-ui` 看 REST API。
- **`mastra studio`**（独立命令）→ 以**静态服务器**启动 Studio，默认端口 **3000**，然后「enter your Mastra instance URL (e.g. `http://localhost:4111`) to connect」→ **可以指向任意 Mastra 实例**，不要求同进程。这正是 server adapter 场景下的调试方式。
  flags：`--port`(3000) / `--server-host`(localhost) / `--server-port`(4111) / `--server-protocol`(http) / `--server-api-prefix`(/api)。
- Studio 内改模型列表**只改内存**，重启即丢。
- 云版另有 https://agent-builder.mastra.ai。

---

## 5. 存储

### 关系型 / KV 适配器（https://mastra.ai/docs/storage）

libSQL、**PostgreSQL**（`@mastra/pg`）、Neon、Upstash、Redis、Valkey、MongoDB、MySQL、MSSQL、OracleDB、ClickHouse、ClickHouse Managed Postgres、Aurora DSQL、Cloudflare D1、Cloudflare KV、Convex、DuckDB、DynamoDB、Elasticsearch、Google Cloud Spanner、LanceDB、Mastra 平台。

- 本地开发默认 **in-memory**（进程退出即丢）；持久化本地默认 libSQL `file:./mastra.db`。
- `MastraCompositeStore` 可按域路由到不同后端；存储域：`memory` / `workflows` / `workflowDefinitions`(beta) / `observability` / `scores` / `datasets` / `experiments` / `schedules`。
- 官方建议：`memory` 用事务库（libSQL/PG/Mongo）；`observability` 用 OLAP（ClickHouse/DuckDB）；`workflows` 必须可靠持久库。

### 向量库（20 个，https://mastra.ai/reference/vectors/*）

**pgvector 支持 ✅** —— https://mastra.ai/reference/vectors/pg，`@mastra/pg` 导出 `PgVector`，"provides vector search using PostgreSQL with pgvector extension"。构造参数：`indexName`、`dimension`（必须与 embedding 模型一致）、`vectorType: 'vector' | 'halfvec' | 'bit' | 'sparsevec'`。

全清单：s3vectors、astra、azure-ai-search、chroma、cloudflare-vectorize、convex、couchbase、duckdb、elasticsearch、lance、libsql、mongodb、opensearch、oracledb、**pg**、pinecone、qdrant、turbopuffer、upstash、weaviate。

### memory / thread 默认数据模型（源码级，非二手）

`@mastra/core@1.78.0` dist/constants-*.js `TABLE_SCHEMAS` 原文：

```
mastra_threads          ── id text PK / resourceId text NOT NULL / title text NOT NULL
                           metadata jsonb / createdAt ts NOT NULL / updatedAt ts NOT NULL
mastra_messages         ── id text PK / thread_id text NOT NULL / content text NOT NULL
                           role text NOT NULL / type text NOT NULL
                           createdAt ts NOT NULL / resourceId text NULL
mastra_resources        ── id text PK / workingMemory text NULL(markdown)
                           metadata jsonb / createdAt ts / updatedAt ts
mastra_workflow_snapshot── workflow_name text / run_id text / resourceId text NULL
                           snapshot jsonb / createdAt ts / updatedAt ts
mastra_scorers, mastra_ai_spans, mastra_traces, mastra_observational_memory,
mastra_agents(+_versions), mastra_prompt_blocks(+_versions), mastra_datasets, …
```

- `mastra_messages.content` 是 **JSON 字符串**：`{ format: 2, parts: [...] }`（parts 含 text / tool-invocation / file / reasoning）。
- 表由适配器**自动创建/管理**：`@mastra/pg` 源码里有 `MANAGED_TABLES = [mastra_threads, mastra_messages, mastra_resources, OM_TABLE]`，并自动建索引 `mastra_threads_resourceid_createdat_idx`、`mastra_messages_thread_id_createdat_idx`。**不需要手写 DDL。**
- **坑**：thread 的 owner（`resourceId`）创建后**不可改**——复用同一 threadId 给不同 owner 会查询报错。

### `@mastra/memory` 与存储的配合方式

```ts
// 全局 storage 挂在 Mastra 实例上（所有 agent 共享）
export const mastra = new Mastra({
  storage: new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' }),
})

// Memory 可单独指定 storage / vector / embedder
const memory = new Memory({
  storage: new PostgresStore({ /* ... */ }),
  vector: new PgVector({ /* ... */ }),
  embedder: openai.embedding('text-embedding-3-small'),
  options: { lastMessages: 20, workingMemory: { enabled: true } },
})
```
- `storage` 不传时默认 `new DefaultStorage({ config: { url: "file:memory.db" } })`。
- `semanticRecall` 需要 **vector + embedder 同时配置**；默认 `topK: 4`、`messageRange: {before:1, after:1}`。
- `workingMemory` 两种 scope：`resource`（默认，跨 thread）/ `thread`（隔离）。**切换 scope = 彼此看不到**。
- 调用时传 `memory: { resource: 'user-123', thread: 'conversation-123' }`。

### 用 memory 持久化「学习进度」的正确姿势（本项目）

`mastra_resources.workingMemory` 是**一段 Markdown**，天然适合存「学习者画像 + 已通关卡 + 薄弱点」这类摘要型进度：

```ts
// 每轮把进度写进 resource 级 working memory（跨 thread 累积）
const memory = new Memory({
  storage: new PostgresStore({ id: 'mastra', connectionString: process.env.DATABASE_URL }),
  options: {
    workingMemory: {
      enabled: true,
      scope: 'resource',        // ← 跨会话累积，这是关键
      template: `# 学习者画像
- 目标：{{goal}}
- 已通关卡：{{clearedLevels}}
- 薄弱知识点：{{weakPoints}}`,
    },
  },
})

// thread 用来隔离「一次关卡尝试」，resource 用来累积「整段学习历程」
await agent.generate(prompt, {
  memory: { resource: 'local-user', thread: `level-run-${runId}` },
})
```

**职责划分建议**：
| 存什么 | 放哪 | 为什么 |
|---|---|---|
| 关卡内容、运行结果、评分 | **你自己的业务表**（Prisma/Drizzle） | 这是业务数据，不该塞进 Mastra 的 snapshot/thread 表 |
| 对话消息、工具调用轨迹 | `mastra_messages` / `mastra_threads`（自动管理） | 换记忆压缩/召回策略不用改自己的表 |
| 学习进度摘要 | `mastra_resources.workingMemory`（Markdown） | 模型可读可写，跨 thread |
| 长流程中间态 | workflow snapshot（`mastra_workflow_snapshot`） | suspend/resume 靠它 |

⚠️ **不要把业务主数据只存在 Mastra 表里**：这些表结构随 minor 版本变动（版本节奏见 §9），而你的业务表由你自己的 migration 控制。

---

## 6. 结构化输出（**确认支持，且可流式**）

https://mastra.ai/docs/agents/structured-output（页面无 beta 标记）

- 支持 **Standard JSON Schema**（Zod / Valibot / ArkType 经 `toStandardJsonSchema()`）**或裸 JSON Schema**。
- 原文："The schema tells the model what fields to produce, and the model ensures the final result fits that shape. Access the validated, typed result through `response.object`."

```ts
const res = await agent.generate(prompt, { structuredOutput: { schema } })
res.object  // 已验证、已类型化
```

- **流式 + 结构化可同时**：`agent.stream(..., { structuredOutput })`，chunk `type === 'object-result'`，`await stream.object` 拿最终对象。
- 校验失败 `errorStrategy`：`'strict'`（默认抛错）/ `'warn'` / `'fallback'` + `fallbackValue`（结果带 `usedFallbackValue: true`）。
- 模型不兼容时三种绕过：`jsonPromptInjection`（`false`/`'inline'`/`true`|`'system'`/`'auto'`）、第二个 model 做二次结构化（`useAgent: true` 继承会话）、`prepareStep` 分步。
- **已知坑**：Gemini 2.5 + tools **必须** `jsonPromptInjection: true`，否则报 `Function calling with a response mime type: 'application/json' is unsupported`。

**对应你的「有界卡片」需求：这是可以做到的，并且流式也能拿到符合 schema 的对象。** 建议 `errorStrategy: 'fallback'` + `fallbackValue` 兜底，避免单次抽风让整个关卡生成失败。

---

## 7. 长任务与并发

### 组合子（https://mastra.ai/docs/workflows/control-flow）

`.then()` · `.parallel([...])` · `.branch()` · `.foreach(step, { concurrency: N })` · `.map()` · `.dountil()` · `.dowhile()` · `.sleep()` · `.sleepUntil()` · `.agent()` · `.tool()` · `.commit()`

- **并行**：`.parallel([step1, step2])` —— 所有分支跑完才继续，输出是**以 step id 为 key 的对象**；任一步抛错则整块失败（要隔离就在 step 内 try/catch）。
- **并发**：`.foreach(step, { concurrency: N })`，文档原文 "**The default is `1`**, which runs steps sequentially." 嵌套 workflow 尊重父级并发。
- **子流程**：workflow 可以直接当 step 用（`.then(childWorkflow)` / `.foreach(childWorkflow, {concurrency})`）；`cloneWorkflow(wf, {id})` 以新 ID 复用。

### suspend / resume（HITL 一等公民）

https://mastra.ai/docs/workflows/suspend-and-resume

```ts
const step1 = createStep({
  id: 'step-1',
  inputSchema: z.object({ userEmail: z.string() }),
  outputSchema: z.object({ output: z.string() }),
  resumeSchema: z.object({ approved: z.boolean() }),   // ← 恢复时校验 resumeData
  execute: async ({ inputData, resumeData, suspend }) => {
    const { approved } = resumeData ?? {}
    if (!approved) return await suspend({})            // ← 挂起，状态存 snapshot
    return { output: `Email sent to ${inputData.userEmail}` }
  },
})
```
- **snapshot 存在你配置的 storage 里**，跨部署、跨重启存活。
- run 结果 `status` 是判别联合：`success` | `failed` | `suspended` | `tripwire` | `paused`。
- 恢复：`run.resume({ step: 'step-1', resumeData: { approved: true } })`。
- 客户端侧对应 `agent.resumeStream()` / `agent.resumeStreamUntilIdle()` / `listSuspendedRuns()`。

### 长时运行 / 批处理

- **`run.startAsync()` 立即返回 `{ runId }`** —— https://mastra.ai/reference/workflows/run-methods/startAsync 原文 "starts a workflow run without waiting for completion. It returns immediately with the `runId`"，页面明确推荐用于 "Long-running workflows: The workflow may take minutes or hours"。之后 `workflow.getWorkflowRunExecutionResult(runId)` 或 `run.observe({ offset })` 取结果/重连流。
- ⚠️ 注意 client-js 里 **`startAsync()` 的语义不同**：它 await 到完成才返回（`/start-async` 端点）。真要 fire-and-forget 用 **`start()`**（`/start` 端点，立即返回）。
- **崩溃恢复**：`run.restart()`、`workflow.restartAllActiveWorkflowRuns()`、`mastra.restartAllActiveWorkflowRuns()`（boot 时扫）；`recovery.workflowConcurrency` 默认 **5**；`autoRestartActiveRuns: false` 可关闭。
- **重要限制（原文）**：run 持 storage lease 并后台续约；未过期时 `restart()` 抛 `WORKFLOW_RESTART_RUN_OWNED`。但 "**The lease is advisory and doesn't fence writes.** If a process stops renewing its lease but keeps executing a step … recovery can run that step a second time" → **step 必须幂等**。
- **`agent.stream()` 不能跨进程退出恢复**（原文："A plain `agent.stream()` call can't resume after its server process exits"）→ 需要时用 Beta 的 Durable Agents。

### 「多线程子智能体批量生成关卡」适配性判断

**适合**，推荐形态：
```
workflow(level-batch)
  .foreach(levelSpec, { concurrency: 4 })   ← 每项是一个子 workflow 或 .agent() step
    → step: 生成
    → step: 结构化校验（structuredOutput + errorStrategy fallback）
    → step: 落库
```
- 用 `startAsync()` / `start()` 触发，前端拿 `runId` 轮询或 `run.observe()` 订阅。
- **单机单进程即可跑**；in-process worker 不跨崩溃。要生产级容错需：持久 storage + 幂等 step +（可选）拆分 worker 进程 + 分布式 PubSub（`RedisStreamsPubSub` 等），并设 `MASTRA_WORKERS` 控制各进程起哪些 worker。
- Worker 的**已知限制（原文）**："No dead-letter queue"；"Scheduler is single-instance"（多实例会重复触发）；"Runs stuck in 'running' after API crash"（需 `recovery.durableAgents: 'auto'`）。

---

## 8. 接入自定义 OpenAI 兼容端点

https://mastra.ai/docs/models/overview（`model` 可以是对象）

```ts
new Agent({
  model: {
    id: 'openai-compatible/my-qwen3-32b',   // 见下方 id 规则
    url: 'https://your-endpoint.example.com/v1',  // ← base URL，含 /v1
    apiKey: process.env.MY_LLM_KEY,
    headers: { 'X-Custom': 'x' },                 // 可选
  },
})
```

- **原文强调**："For the `url` it's **important** that you use the base URL of the OpenAI-compatible endpoint … and not the individual chat endpoints."
- **`id` 路由规则**：远端像直接 provider（期望裸模型名）→ `provider/model`；远端像 gateway（自身命名就带 provider）→ `gateway/provider/model`。
- `api: "responses"` 切 OpenAI Responses API（默认 `"chat"` = Chat Completions）。
- **模型 failover**：`model: [{ model, maxRetries, modelSettings, providerOptions }, ...]`，遇 500/限流/超时自动切下一个——对一个「批量生成关卡」的稳定性很有用。
- 也可直接传 AI SDK provider 实例（如 `groq('gemma2-9b-it')`）。

---

## 9. 已知坑与限制

### 版本破坏性变更频率（**最大的实际风险**）

- 近 90 天发了 **30 个稳定版**（自 2026-07-20）→ 约**每 3 天一个 minor**。
- 官方有 **16 篇 v1 迁移指南**（agents/cli/client/deployment/evals/mastra/mcp/memory/processors/rag/storage/tools/tracing/vectors/voice/workflows）+ 5 篇其它破坏性迁移（mcp-v2、agentnetwork、ai-sdk-v4-to-v5、mastra-cloud、vnext-to-standard-apis、network-to-supervisor）。
- 判断：**必须锁精确版本**（`"@mastra/core": "1.78.0"`，不加 `^`），升级当独立任务做。

### 云端账号 / 计费

- **自托管完全不需要账号、不产生费用**。只有 `mastra deploy` 需要 `mastra auth login` 或 `MASTRA_API_TOKEN`（凭证存 `~/.mastra/credentials.json`）。
- Mastra Platform 三档（https://mastra.ai/pricing，2026-10 实抓）：**Free `$0`**（100K observability events，超出 `$10/100K`；24 CPU hours，超出 `$0.35/hr`；数据留 15 天）、**Teams `$250/月`**（1M events，超出 `$8/100K`；250 CPU hours，超出 `$0.25/hr`；6 个月留存；SSO/SOC2）、**Enterprise 定制**（"One flat annual fee — **no per-trace or per-seat metering**"）。
- **没有按 token 或按 agent 调用计费**，只有 observability event / CPU hour 计量。
- `create-mastra` 的交互模式会**提议**连 Mastra platform（写入 `MASTRA_PLATFORM_ACCESS_TOKEN` + `MASTRA_PROJECT_ID` 到 `.env`）——可拒绝。

### 遥测（默认开，非匿名）

- `@mastra/core` 内置 PostHog，**默认开启**。源码 `POSTHOG_API_KEY = "phc_SBLpZVAB6jmHOct9CABq3PF0Yn5FU3G2FgT4xUr2XrT"`、host `https://us.posthog.com`。
- 发的是 OS / Mastra 版本 / Node 版本 / `machine_id`(sha256(hostname) 前 16 位) / token 用量统计；**不发 prompt/response 内容**。
- 官方 CLI 文档承认："These server events **aren't anonymous**: a Platform ID links them to that project, and a known repository URL can be normalized and hashed to match Git-derived events."
- 关闭：`MASTRA_TELEMETRY_DISABLED=1`（只认 `1`/`true`/`yes`，大小写不敏感）。**建议在 `.env` 里直接设上。**

### Node / TypeScript 要求

- **Node >= 22.13.0**（所有 `@mastra/*` 的 `engines`）。
- **TS 必须现代 module 配置**：https://mastra.ai/docs/server/overview:83 原文 "Mastra requires `module` and `moduleResolution` settings compatible with modern Node.js. Legacy options like `CommonJS` or `node` aren't supported." 官方 tsconfig：`target ES2022 / module ES2022 / moduleResolution bundler`。
- ⚠️ 张力：`@mastra/core` 的 `exports` 每项都有 `require` → `./dist/index.cjs`（**双格式发布，CJS 可用**），但 NestJS 集成页要求「CJS 项目需去掉 top-level await」。**按 ESM 规划更安全。**

### 其它坑

- `@mastra/nestjs` 是 **0.2.x**，且 Express-only、catch-all 路由、不启 worker（见 §3）。
- Server adapter 场景**不做 file-based discovery**，agent 必须在代码里注册。
- 默认 CORS `origin: '*'`（`server.cors` 可配；`false` 关闭）。
- `mastra_messages.content` 是 JSON 字符串而非结构化列——**自己查库时要 parse**。
- Studio 里改的模型配置不持久。
- 生产默认**关闭** OpenAPI/Swagger（需 `server.build.openAPIDocs` / `server.build.swaggerUI` = true）。
- 优雅关停 `server.drainTimeout` 默认 **5 秒**，HTTP drain 与 workflow drain 串行 —— 长任务要给足时间。

---

## 10. 鉴权能否整体关掉（本地单用户场景）

**可以，而且是默认状态。** https://mastra.ai/docs/auth/overview:18 原文：

> "**Authentication is optional.** If no auth is configured, all routes and Studio are publicly accessible."

- 不配 `server.auth` → `/api/agents/*`、`/api/workflows/*` 全部裸露。
- ⚠️ **本地无所谓，但一旦监听 `0.0.0.0` 或上公网就是任意代码执行级风险**（agent 能调 tool、workflow 能跑任意 step）。生产要么加 auth，要么放私有网络 + 反代鉴权。
- 如果将来要开 auth：`server.auth` 支持 JWT / Clerk / Supabase / Firebase / WorkOS / Auth0 / Simple Auth；`mapUserToResourceId` 把登录用户映射到 memory 的 resourceId（不配则信任客户端传来的 resourceId 并打 warning）。
- **多租户不需要**：`memory.resource` 传个固定字符串（如 `'local-user'`）即可，thread 用关卡/session id。

---

## 11. `create-mastra` 现在会生成什么

https://mastra.ai/reference/cli/create-mastra

三种模式：

| 模式 | 命令 | 产物 |
|---|---|---|
| **Default starter**（默认） | `npx create-mastra@latest my-app --llm anthropic` | **Agent Harness 模板**：workspace tools、memory、task tracking、web access、recurring schedules、storage、observability。provider 只能选 openai/anthropic/google/xai |
| **Template** | `--template agent-harness` 或 GitHub URL | 模板自带依赖/模型/env，`--llm` 不生效 |
| **Empty** | `--empty` | **无 provider、无 agent、无示例、无 model SDK、无 env 文件** ← 嵌入已有项目时用这个 |

默认结构（https://mastra.ai/reference/project-structure）：
```
src/mastra/agents/agent.ts
src/mastra/tools/schedule-tools.ts
src/mastra/index.ts
.env.example   AGENTS.md   package.json   tsconfig.json
```

自动行为：会检测 PATH 上的 coding assistant 并安装 Mastra skills（`--no-skills` 跳过）；会做初次 git commit（`--no-git` 跳过）；交互模式会问要不要连 Mastra platform。

**对已有项目的建议：不要用 default starter（它塞一整套 harness 进来），用 `--empty` 或手写。**

---

## 12. 推荐进程 / 包结构（前端 SPA + 后端服务 + Mastra 层）

### 结论：**Mastra 作为库嵌入后端进程，不单独起服务。**

理由：
1. 单独起 Mastra server = 你要维护两个进程、两套端口、两套 cors、两套鉴权，而 Mastra 的路由你本来就要用自己的业务路由包一层（关卡生成不是「对话」）。
2. 嵌入后端后，`mastra.getAgent()` / `mastra.getWorkflow()` 直接在 service 里调，事务边界、鉴权、日志都在 NestJS/Fastify 内，不需要跨进程。
3. Studio 用 `mastra studio` 单独起在 3000 端口、指向后端的 `:4111/api` 即可调试——**不需要为了 Studio 而让 Mastra 跑独立服务**。

### monorepo 结构

```
starmap/
├─ apps/
│  ├─ web/                       # Vite + React + React Router + TanStack Query + Fluent UI v9
│  │   └─ src/api/mastraClient.ts   ← new MastraClient({ baseUrl: '', apiPrefix: '/api/mastra' })
│  │                                  只在这里 import @mastra/client-js
│  └─ server/                    # Node + TS 后端（NestJS 或 Fastify）
│      ├─ src/
│      │  ├─ mastra/             # ← Mastra 层，官方约定的目录
│      │  │  ├─ index.ts         # export const mastra = new Mastra({ agents, workflows, storage })
│      │  │  ├─ agents/
│      │  │  ├─ workflows/       # 关卡状态机 + 批量生成 workflow
│      │  │  ├─ tools/
│      │  │  └─ scorers/
│      │  ├─ modules/levels/     # ← 业务路由：POST /levels/batches → 调 workflow.startAsync()
│      │  └─ main.ts
│      └─ .env                   # ← 放这里，不是 monorepo 根
├─ packages/
│  └─ shared/                    # Zod schema（关卡卡片 schema）+ 生成的 API 类型
└─ package.json                  # 单 lockfile，Mastra 相关包精确锁版本
```

三条边界：
- **`packages/shared` 持有 Zod schema** —— 同一份 schema 同时给 ① Mastra `structuredOutput`、② 后端 DTO 校验、③ 前端类型。这是「有界卡片」的单一真源。
- **`apps/web` 只依赖 `@mastra/client-js`**，不依赖 `@mastra/core`（虽然会被拖进依赖树，但至少不直接 import）；**绝不引入 `@mastra/react`**（Radix/Tailwind 会跟 Fluent 打架）。
- **`apps/server` 独占 `@mastra/*` 服务端包**。

### Mastra 层的内部组织（含 Skills）

```
apps/server/src/mastra/
├─ index.ts                 # new Mastra({ agents, workflows, storage, server })
├─ agents/
│  └─ level-agent.ts        # 生成关卡的主 agent（structuredOutput 用它）
├─ workflows/
│  ├─ level-batch.ts        # 批处理：.foreach(spec, { concurrency: N })
│  └─ level-session.ts      # 单关：讲解 → 出题 → 判分 → 复盘（含 suspend 等待学习者作答）
├─ tools/
│  └─ ...                   # 读写业务库、校验关卡合法性
├─ skills/                  # ← 直接复用 SKILL.md 规范，不用自研提示词拼装
│  ├─ level-design/
│  │  ├─ SKILL.md           # 必填 frontmatter: name(=目录名) + description
│  │  └─ references/
│  │     ├─ difficulty-curve.md
│  │     └─ anti-patterns.md
│  └─ card-schema/
│     ├─ SKILL.md
│     └─ references/
├─ scorers/                 # 关卡质量评分（@mastra/evals）
└─ workspace.ts             # new Workspace({ filesystem: new LocalFilesystem({ basePath }), skills: ['skills'] })
```

`workspace.ts` 三行就够：

```ts
import { LocalFilesystem, Workspace } from '@mastra/core/workspace'

export const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath: import.meta.dirname }),
  skills: ['skills'],   // 扫 ./skills/*/SKILL.md
})
```

关键点：**`SKILL.md` 是渐进式披露的**——只有 name/description 进 system message，正文由 agent 需要时调 `skill` 工具载入。这意味着「关卡设计方法论」可以写得很长（放 `references/`），不吃的每轮 token 预算。这与 DSH / Claude Code 的 skill 格式同源（[agentskills.io](https://agentskills.io)），**同一份 `SKILL.md` 两边都能用**。

### 挂载方式选择

| 选项 | 何时用 |
|---|---|
| **NestJS + `@mastra/nestjs`** | 已经是 NestJS，且接受 Express platform。好处是有 `MASTRA` 注入、内置 rate limit/body limit/stream/tracing 选项。<br>**代价**：适配器 0.2.x、catch-all 陷阱、必须手动 `startWorkers()`。 |
| **Fastify + `@mastra/fastify`**（推荐给新项目） | 适配器 1.5.22 稳定得多，挂载显式（`new MastraServer({ app, mastra })` + `await server.init()`），没有 catch-all 问题。 |
| **纯库，不要 adapter** | 只需要在自己的 route 里 `mastra.getWorkflow('x').createRun()`，不需要 Mastra 那套 REST 路由。**最省心**，但 Studio 就连不上（Studio 需要 `/api` 那套路由）。 |

**折中推荐**：Fastify（或 NestJS）挂 `MastraServer` 到 `/api/mastra` 前缀（Studio 可连），业务路由另开 `/api/levels`。`prefix` 参数原生支持。

### server 端最小骨架

```ts
// apps/server/src/mastra/index.ts
import { Mastra } from '@mastra/core'
import { PostgresStore } from '@mastra/pg'
import { levelWorkflow } from './workflows/level-batch'
import { levelAgent } from './agents/level-agent'

export const mastra = new Mastra({
  agents: { levelAgent },          // ← 代码注册，adapter 不做 file discovery
  workflows: { levelWorkflow },
  storage: new PostgresStore({ id: 'mastra-store', connectionString: process.env.DATABASE_URL }),
  server: {
    apiPrefix: '/api/mastra',      // ← 必须与前端 MastraClient.apiPrefix 一致
    cors: { origin: ['http://localhost:5173'] },   // 或 false 交给反代
    build: { openAPIDocs: process.env.NODE_ENV !== 'production' },
  },
})
```

```ts
// apps/server/src/mastra/agents/level-agent.ts
import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'

export const levelAgent = new Agent({
  id: 'level-agent',
  model: { id: 'openai-compatible/my-model', url: process.env.LLM_BASE_URL!, apiKey: process.env.LLM_API_KEY! },
  memory: new Memory({                       // ← memory 挂在 Agent 上，不是挂在 Mastra 实例上
    options: { workingMemory: { enabled: true, scope: 'resource' } },
  }),
})
```
> 核对过类型定义：`Mastra` 配置里的 `memory` 字段注释是 "Memory instances that can be **referenced by stored agents**"（`dist/mastra/index.d.ts:255-259`），普通代码定义的 agent 走 `AgentConfig.memory?: DynamicArgument<MastraMemory>`（`dist/agent/types.d.ts:745`）。两处别搞混。

```ts
// apps/server/src/main.ts（Fastify）
import Fastify from 'fastify'
import { MastraServer } from '@mastra/fastify'
import { mastra } from './mastra'

const app = Fastify({ logger: true })
const server = new MastraServer({ app, mastra, prefix: '/api/mastra' })  // ← 与 apiPrefix 对齐
await server.init()

// 业务路由（不属于 Mastra 的 REST 面）
app.post('/api/levels/batches', async (req) => {
  const wf = mastra.getWorkflow('levelBatch')
  const run = await wf.createRun()
  const { runId } = await run.startAsync({ inputData: req.body })   // fire-and-forget，返回 { runId }
  return { runId }
})

await app.listen({ port: 4111 })
await mastra.startWorkers()        // ← 别忘，否则 scheduled workflow / event listener 不跑
```

> 注意两种「start」语义（源码核对过）：
> - **core（进程内）** `run.startAsync()` → `Promise<{ runId }>`，立即返回（`dist/workflows/workflow.d.ts:649`）。
> - **client-js（HTTP）** `run.startAsync()` → await 到完成才返回 `/start-async` 的结果；fire-and-forget 用 `run.start()`（`dist/resources/run.d.ts:92 vs :104`）。
> 上例是进程内调用，所以用 `startAsync()` 拿 runId 是对的。

前端：
```ts
// apps/web/src/api/mastraClient.ts
import { MastraClient } from '@mastra/client-js'
// 同源 + Vite proxy（/api/mastra → http://localhost:4111/api/mastra）
export const client = new MastraClient({ baseUrl: '', apiPrefix: '/api/mastra' })
// 配合 TanStack Query：批处理用 createRun → run.start() 拿 runId，再用 run.observe()/runById 取结果
```

Vite dev 代理（避免 CORS）：
```ts
// apps/web/vite.config.ts
export default defineConfig({
  server: {
    proxy: { '/api/mastra': { target: 'http://localhost:4111', changeOrigin: true } },
  },
})
```

### 版本策略

```jsonc
{
  "dependencies": {
    "@mastra/core": "1.78.0",        // ← 精确，不加 ^
    "@mastra/fastify": "1.5.22",
    "@mastra/pg": "1.31.2",
    "@mastra/memory": "1.38.0",
    "@mastra/rag": "2.6.7",
    "@mastra/evals": "1.10.7",
    "@mastra/mcp": "2.4.1"
  }
}
```
升级当独立任务，跑一遍 workflow 回归 + 读对应 CHANGELOG。**不要开 `latest` 或 `^`。**

### 采用前必须先验证的 4 件事

1. **bundle 体积**：`@mastra/client-js` 会把 `@mastra/core` 拖进前端依赖树（锁死 1.78.0），实测 `vite build` 后体积是否可接受。
2. **结构化输出在你的模型上实测**：用你的 OpenAI 兼容端点跑一次 `structuredOutput`，确认不需要 `jsonPromptInjection` 兜底。
3. **step 幂等**：所有 workflow step（尤其是落库、调外部 API）按「可能重跑」设计。
4. **`mastra dev` 与你的后端是否打架**：`mastra dev` 自己起 4111 端口；如果后端也占 4111 会冲突，改一个。

---

## 证据文件清单（本地）

| 文件 | 内容 |
|---|---|
| `.scratch/mastra-research/core.json` | `@mastra/core` 完整 npm metadata（22MB，含全部版本与发布时间） |
| `.scratch/mastra-research/corepkg/package/dist/constants-*.js` | `TABLE_SCHEMAS`、`TABLE_*` 表名常量（源码级） |
| `.scratch/mastra-research/cjspkg/package/dist/index.js` | `@mastra/client-js@1.55.0` 实现（确认无 node 内置模块、start vs startAsync 语义） |
| `.scratch/mastra-research/pages/*.md` | 75 个官方文档页的 Markdown 原文（`https://mastra.ai/<path>.md`） |
| `.scratch/mastra-research/llms.txt` | 官方文档索引（838 行） |
| `.scratch/mastra-research/license.md` / `ee_license.md` | 根 LICENSE.md 与 ee/LICENSE 原文 |

## 官方链接汇总

- 文档索引：https://mastra.ai/llms.txt （任意页面加 `.md` 得纯 Markdown）
- Server 概览：https://mastra.ai/docs/server/overview
- Server Adapters：https://mastra.ai/docs/server/server-adapters
- NestJS 适配器：https://mastra.ai/reference/server/nestjs-adapter
- Fastify 适配器：https://mastra.ai/reference/server/fastify-adapter
- Client SDK 概览：https://mastra.ai/docs/server/mastra-client
- Client Agents API：https://mastra.ai/reference/client-js/agents
- Client Workflows API：https://mastra.ai/reference/client-js/workflows
- React + Vite：https://mastra.ai/integrations/frameworks/vite-react
- Studio：https://mastra.ai/docs/studio/overview
- CLI 参考（含 `mastra studio`、遥测）：https://mastra.ai/reference/cli/mastra
- create-mastra：https://mastra.ai/reference/cli/create-mastra
- 项目结构：https://mastra.ai/reference/project-structure
- 存储：https://mastra.ai/docs/storage
- 存储表结构：https://mastra.ai/reference/storage/overview
- pgvector：https://mastra.ai/reference/vectors/pg
- Memory：https://mastra.ai/docs/memory/overview
- Memory Class 参数：https://mastra.ai/reference/memory/memory-class
- Working Memory：https://mastra.ai/docs/memory/working-memory
- 结构化输出：https://mastra.ai/docs/agents/structured-output
- Workflow 概览：https://mastra.ai/docs/workflows/overview
- Control Flow：https://mastra.ai/docs/workflows/control-flow
- Workflow State：https://mastra.ai/docs/workflows/workflow-state
- Suspend & Resume：https://mastra.ai/docs/workflows/suspend-and-resume
- Run.startAsync()：https://mastra.ai/reference/workflows/run-methods/startAsync
- Subagents：https://mastra.ai/docs/subagents
- Harness 总览：https://mastra.ai/docs/harness/overview
- Durable Agents（Beta）：https://mastra.ai/docs/harness/durable-agents
- Workers（Beta）：https://mastra.ai/docs/deployment/workers
- MCP：https://mastra.ai/docs/connections/mcp
- Models（自定义端点）：https://mastra.ai/docs/models/overview
- Evals：https://mastra.ai/docs/evals/overview
- Auth：https://mastra.ai/docs/auth/overview
- 配置参考：https://mastra.ai/reference/configuration
- 部署：https://mastra.ai/docs/deployment/mastra-server
- Monorepo：https://mastra.ai/docs/deployment/monorepo
- 计价：https://mastra.ai/pricing
- 许可证：https://github.com/mastra-ai/mastra/blob/main/LICENSE.md 、https://github.com/mastra-ai/mastra/blob/main/ee/LICENSE
- 仓库：https://github.com/mastra-ai/mastra
