# StarMap

核电子学学习工作站。单用户、本地运行、全中文界面。

- 产品规格：`.scratch/starmap-core/spec.md`
- 术语表：`GLOSSARY.md`（**术语唯一真源，写代码前先读**）
- 架构决策：`docs/adr/`、`docs/architecture.md`
- 任务票据：`.scratch/starmap-core/issues/`

## 快速开始

前置：Node ≥ 22、pnpm 12、PostgreSQL 18（本机默认 `postgres/postgres@127.0.0.1:5432`）。

```bash
pnpm install
cp .env.example .env          # 按需改 DATABASE_URL 与 LLM_* 配置
pnpm db:migrate               # 必跑，见下方「为什么 db:migrate 是硬前置」
pnpm db:seed                  # 可选：灌入演示数据
pnpm dev                      # 同时起 API(3001) 与 Web(5173)
```

数据库不在跑时，`pnpm dev` 会先调用 `scripts/db-up.ps1` 尝试拉起本机 PostgreSQL；
若用的是别的实例或容器，直接改 `.env` 的 `DATABASE_URL`。

## 为什么 `db:migrate` 是硬前置

迁移没跑时**服务能起来、typecheck 和单测全绿，但接口返回 500**（`relation "..." does not exist`）。
这是本项目最容易踩的坑：它不属于任何一层测试能捕获的失败模式。

拉取新代码后，只要 `apps/api/migrations/` 下有新文件，就必须：

```bash
pnpm db:migrate
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 起 API + Web（先自动迁移） |
| `pnpm typecheck` | 全仓类型检查（6 个包） |
| `pnpm test` | 单元与集成测试（Vitest） |
| `pnpm test:e2e` | Playwright 端到端 |
| `pnpm check:boundaries` | 依赖方向检查（`dependency-cruiser`） |
| `pnpm contract:gen` | 契约链：build → 生成 `openapi.yaml` → 生成前端客户端 |
| `pnpm contract:check` | 校验契约产物与源码一致（141 个文件的 sha256 快照） |
| `pnpm verify` | typecheck + boundaries + test |

## 契约链

`packages/api-contract` 的 Zod schema 是**内部单一真源**，`openapi.yaml` 是**对外契约唯一真源**。
改 schema 之后必须跑 `pnpm contract:gen`，它会依次：

1. `tsc` 构建 api-contract（**不能省**：生成链每段都 import `dist/`，跳过会拿到过期的 dist 而静默生成错误契约）
2. 生成 `packages/api-contract/openapi.yaml`
3. 用 Orval 生成 `apps/web/src/api/generated/`
4. 校验 schema 覆盖率（未声明为组件也没被内联使用的「死 schema」会被报出）

`pnpm contract:check` 会在运行前后各做一次快照比对，任何未同步都会失败。

## 目录

```
apps/web          React 19 + Vite + Fluent UI v9 前端
apps/api          NestJS 12 + Mastra（嵌入式）后端
packages/engine   纯 TS 领域内核（禁 import 框架/DB/fs，由 dependency-cruiser 强制）
packages/shared   Zod schema 与领域类型
packages/api-contract  OpenAPI 契约与生成器
tools/ingest      教材 PDF / OCR 离线抽取管线（Python）
tools/eval        模拟学生与评测框架
content/          版本化的内容产物
资源库/           原始教材与论文（134 个 PDF，当前在版本控制内，见下方「已知问题」）
```

## 数据库

PostgreSQL 18，业务表在 `app` schema，Mastra 的表在 `mastra` schema（由 `@mastra/pg` 自管）。

- 迁移文件：`apps/api/migrations/NNNN_*.sql`，成对提供 `.down.sql`
- 测试隔离：每个测试文件建临时 schema `app_test_<random>`，测完 `DROP SCHEMA ... CASCADE`
- **不要对 `mastra.*` 建外键**：那些表随 Mastra 版本变动，升级时会把业务迁移锁死

## 已知问题

**`资源库/` 的 134 个 PDF（1.14 GiB）已经被提交进 git 历史**（`d4cb8be` 初始化时误入），
`.git` 目录因此膨胀到 1.5 GiB。当前单机开发无实际影响，但：

- 克隆会拖完整 1.14 GiB
- 推送 GitHub 会被 100 MiB 单文件限制拒绝

清理需要 `git filter-repo --path 资源库 --invert-paths` 重写全部历史，
这会改变所有 commit hash。**在并行开发期间不要做**，等全部票收尾后一次性处理。

`资源库/` 已加入 `.gitignore` 的说明段，**新增素材不要再提交进仓库**。

## 已知环境限制

- **两个 LLM 端点都没有 embedding 模型**，向量检索不可用；检索用 BM25
- 资源库 128 个 PDF 中 11 个无文字层，需 OCR（`tools/ingest/ocr.py`）
