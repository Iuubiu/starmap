# 开发须知

面向在本仓库里改代码的人（包括智能体）。产品定位与架构概览见 [`../README.md`](../README.md)。

## 前置

Node ≥ 22、pnpm 12、PostgreSQL 18（默认 `postgres/postgres@127.0.0.1:5432`）。

```bash
pnpm install
cp .env.example .env
createdb starmap      # 库要先存在；表由下面的启动过程自动建
pnpm dev
```

数据库没在跑时，`pnpm dev` 会先调 `scripts/db-up.ps1` 尝试拉起本机 PostgreSQL；
用的是别的实例或容器就直接改 `.env` 的 `DATABASE_URL`。

## 迁移：首次启动自动应用

**`apps/api` 启动时会自动应用 `apps/api/migrations/` 下所有尚未执行的迁移**，然后才开始监听端口。
四个入口都覆盖（`pnpm dev`、`pnpm dev:api`、`pnpm start`、Playwright 的 webServer）：
前三个最终都落到 `apps/api` 的 `dev` / `start` 这两个 npm script，而 Playwright 的
webServer 跑的也是 `pnpm --filter @starmap/api dev`。所以：

- **clone 之后不需要手工 `psql -f`**，跑起来就建好表。
- **拉取含新迁移的代码后也不需要额外动作**，下次启动自动补上。
- 迁移失败时服务**不启动**且退出码非零 —— 带着半套 schema 起服务，第一次查询会报
  `column ... does not exist`，看起来像业务代码 bug，比启动失败难查得多。

实现分三层：

| 位置 | 职责 |
|---|---|
| `apps/api/src/db/migrate.ts` | 执行器（`migrateUp` / `migrateDown` / `runSeed`），启动路径与测试共用同一份 |
| `apps/api/scripts/prepare-db.ts` | 启动前钩子，只调 `migrateUp`，失败设非零退出码 |
| `apps/api/package.json` 的 `dev` / `start` | `tsx ./scripts/prepare-db.ts && tsx ... src/main.ts` —— `&&` 保证迁移失败时服务根本不启动 |

`apps/api/scripts/migrate.ts` 是给 `pnpm db:*` 用的 CLI 外壳，走同一个执行器。
执行器用 advisory lock 做多实例互斥：两个 api 进程同时起时，第二个会排队，
醒来发现版本表已更新就什么都不做。

`pnpm dev`（根 `scripts/dev.mjs`）在拉起两个 dev server **之前**还会自己跑一次
`pnpm db:migrate`。这一层现在是冗余的（API 自己会跑），保留它是因为只有它在
「数据库连不上」时能在**启动任何 dev server 之前**退出并打出排查提示；迁移本身
幂等，多跑一次的代价是两秒。

### 什么时候还需要手工迁移

自动迁移只覆盖「启动 api 进程」这一条路径。以下情况要手工跑：

| 场景 | 命令 |
|---|---|
| 只想迁移、不想起服务（CI、初始化脚本） | `pnpm db:migrate` |
| 用另一套 `DATABASE_URL`（如临时验证库） | `DATABASE_URL=... pnpm db:migrate` |
| 单个迁移要单独应用 | `psql "$DATABASE_URL" -f apps/api/migrations/NNNN_x.sql` |
| 回滚 | `pnpm db:rollback`（按配对 `.down.sql` 逆序） |
| 灌演示数据 | `pnpm db:seed`（不进版本表，可重复执行） |

`psql -f` 单条应用**不会写版本表**，之后再跑 `pnpm db:migrate` 会认为它没执行过而重跑一次 ——
所以只有在迁移本身幂等（本项目要求全部 `CREATE ... IF NOT EXISTS`）时才这么干，事后补跑一次
`pnpm db:migrate` 让版本表对齐。

### 「代码要、库里没有」的全量比对（2026-10-22）

自动迁移上线时做了一次全量核对，口径不是读 SQL 猜形状，而是**在一次性 schema 上把 25 个迁移真跑一遍**，
拿结果与真实库的 `app` schema 逐表逐列做差集（`information_schema` + `pg_indexes`）：

```
代码要求的形状：表 34 个、列 274 个
真实库 app   ：表 34 个、列 274 个
【代码要、库里没有】表：0 处
【代码要、库里没有】列：0 处
【类型/可空性不一致】：0 处
（库里多出来的表 / 列：0 处 / 0 处）
```

**结论：0 处。** 真实库与迁移文件完全一致，没有第二处像 `0070_level_templates` 那样的漏应用。

顺带记下第一版比对为什么错了（教训）：那一版用正则解析迁移 SQL，报了 4 处假阳性 ——
`REFERENCES` 与 `OR` 被当成列名，`learned_kp_count` 被当成缺失（其实早被 `0025` DROP 掉了）。
**判断「库里缺什么」的唯一可靠口径是把迁移真跑一遍再比形状**，解析 SQL 文本猜不出来。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 起 API + Web（API 启动时自动迁移） |
| `pnpm db:migrate` | 只迁移不起服务（幂等，已执行的会跳过） |
| `pnpm typecheck` | 全仓类型检查（6 个包） |
| `pnpm test` | 单元与集成测试（Vitest） |
| `pnpm test:e2e` | Playwright 端到端 |
| `pnpm check:boundaries` | 依赖方向检查（dependency-cruiser） |
| `pnpm contract:gen` | 契约链：build → 生成 `openapi.yaml` → 生成前端客户端 |
| `pnpm contract:check` | 校验契约产物与源码一致 |
| `node scripts/verify.mjs` | 七段门禁（类型 / 边界 / 契约 / 迁移 / 单测 / 内容管线 / e2e） |

## 契约链

`packages/api-contract` 的 Zod schema 是**内部单一真源**，`openapi.yaml` 是**对外契约唯一真源**。
改 schema 之后必须跑 `pnpm contract:gen`，它依次：

1. `tsc` 构建 api-contract —— **不能省**：生成链每段都 import `dist/`，跳过会拿到过期 dist 而静默生成错误契约；
2. 生成 `packages/api-contract/openapi.yaml`；
3. 用 Orval 生成 `apps/web/src/api/generated/`；
4. 校验 schema 覆盖率（既没声明为组件、也没被内联使用的"死 schema"会被报出）。

`pnpm contract:check` 在运行前后各做一次快照比对，任何未同步都会失败。

> 顺序很重要：`contract:gen` 必须是 build → emit → orval。曾因把 emit 放在最前导致「改了组件就死锁」——emit 拿磁盘旧 yaml 比对失败，yaml 又只有后面的步骤才会写。

## 目录

```
apps/web               React 19 + Vite + Fluent UI v9 前端
apps/api               NestJS + Mastra（嵌入式）后端
packages/engine        纯 TS 领域内核（禁 import 框架 / DB / fs，由 dependency-cruiser 强制）
packages/shared        Zod schema 与领域类型
packages/api-contract  OpenAPI 契约与生成器
tools/ingest           教材 PDF / OCR 离线抽取管线（Python）
tools/eval             模拟学生与评测框架
content/               版本化的内容产物（不含原始 PDF）
```

## 数据库

PostgreSQL 18。业务表在 `app` schema，Mastra 的表在 `mastra` schema（由 `@mastra/pg` 自管）。

- 迁移：`apps/api/migrations/NNNN_*.sql`，**必须成对提供 `.down.sql`**（`scripts/check-migrations.mjs` 会检查回滚无残留）。
- 测试隔离：每个测试文件建临时 schema `app_test_<random>`，测完 `DROP SCHEMA ... CASCADE`。
- **不要对 `mastra.*` 建外键**：那些表随 Mastra 版本变动，升级时会把业务迁移锁死。
- 时间字段一律带时区；「今天」这类口径必须显式传展示时区，不要用 UTC 日界直接算。

## 测试纪律

- **反向验证**：说"修好了"之前，把修复撤销一次，确认守门测试确实变红。没红过的测试不能算守门测试。
- **不要用绝对阈值**：`blobs > 1500` 这类断言会随数据规模变化误红，改用相对量或结构化判据。
- **探针比断言多**：界面上的数字用浏览器实测（Playwright）而不是读代码推断；探针自己也要被验证，否则会把"修好了"读成"全坏"。
- 跑 Playwright 必须指定独立输出目录（`--output=../../.scratch/pw-<名字>`）：默认目录会被并发运行互相清空，症状是 `ENOENT ... recording*.trace`。

## 已知限制

- **两个 LLM 端点都没有 embedding 模型**，向量检索不可用；检索用 BM25（CJK bigram 分词）。
- 资源库里 11 本书没有文字层，需 OCR（`tools/ingest/ocr.py`）。
- 图谱规模 3000+ 叶节点、边数远少于节点数（大量孤立节点），布局会把孤立点铺在圆周上——这是数据现状，不是渲染缺陷。

## 语料与版权

`资源库/`（原始 PDF）与 `content/`（抽取产物）**都不进公开仓库**。要用自己的书重建：

```bash
python tools/ingest/books_batch.py --book <book-id>     # 生成 content/<book-id>/
pnpm --filter @starmap/api content:import               # 入库
```
