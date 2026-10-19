# 01: 走通骨架

**What to build:** 一条命令就能启动整个应用，浏览器打开看到的是后端查出来的真实数据而不是假数据；四个测试接缝各有一份能跑通的示例。

这一票不实现任何业务，它只确立后面的每一票都要照着长的**形状**：schema 怎么迁移、契约怎么生成、API 怎么测、前端怎么拿到数据、模型怎么被隔离、浏览器怎么被驱动。**它同时完成仓库的一次性初始化**（`pnpm-workspace.yaml`、根 `package.json`、`.env.example`、`docker-compose.yml`、`dependency-cruiser` 规则、lint/format/typecheck 脚本），因为这些是后面每一票的默认前提，晚做一晚就要多改一轮。

**Blocked by:** None（可立即开始）

**Status:** resolved

- [x] `pnpm dev` 一条命令同时起前后端（含 `docker compose up -d` 拉起 PostgreSQL）；前端从后端 API 取到真实数据并渲染出来
- [x] `pnpm-workspace.yaml`、根 `package.json`、`.env.example`（真实值不入库）、`docker-compose.yml`、`.dependency-cruiser.cjs` 均已存在且可用
- [x] 数据库迁移可重复执行——连跑两次不报错，且存在明确的回滚路径；业务表在 `app` schema，Mastra 表在 `mastra` schema
- [x] **契约链跑通**：Zod schema → 生成 `openapi.yaml`（入库）→ Orval 生成前端客户端，一次生成后 TypeScript 零错误；CI 里校验生成物与 schema 同步，不一致即失败
- [x] 四个测试接缝各有至少一份可跑示例：NestJS `Test.createTestingModule()` + supertest 集成测试（响应过 openapi 校验）、MSW 组件测试、`packages/engine` 纯函数属性测试、Playwright 一条端到端
- [x] `LlmPort` 接口存在，且测试里用的是脚本化假实现；**跑测试不打任何真实模型、不产生费用**
- [x] 六个页面的路由骨架存在，每页能渲染出空态与错误态
- [x] `docs/architecture.md` 里的依赖方向被 `dependency-cruiser` 强制：反向 import 会让 CI 失败
- [x] `MASTRA_TELEMETRY_DISABLED=1` 生效，启动时无外发遥测
