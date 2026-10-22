# 开发须知

面向在本仓库里改代码的人（包括智能体）。产品定位与架构概览见 [`../README.md`](../README.md)。

## 前置

Node ≥ 22、pnpm 12、PostgreSQL 18（默认 `postgres/postgres@127.0.0.1:5432`）。

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

数据库没在跑时，`pnpm dev` 会先调 `scripts/db-up.ps1` 尝试拉起本机 PostgreSQL；
用的是别的实例或容器就直接改 `.env` 的 `DATABASE_URL`。

## 为什么 `db:migrate` 是硬前置

迁移没跑时，**服务能起来、typecheck 与单测全绿，但接口返回 500**（`relation "..." does not exist`）。
这是本项目最容易踩的坑：它不属于任何一层测试能捕获的失败模式。

拉取新代码后只要 `apps/api/migrations/` 下有新文件，就必须 `pnpm db:migrate`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 起 API + Web（先自动迁移） |
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
