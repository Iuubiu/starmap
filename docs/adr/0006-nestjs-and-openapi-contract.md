# 后端用 NestJS，API 契约以 openapi.yaml 为真源

两件事写在一起，因为它们一起被推翻又一起被重建。

第一件：早先的版本选了 Fastify，理由是「NestJS 适配器仍是 0.2.x、Express-only、catch-all 路由、需手动 `startWorkers()`」。这个理由经实测不成立——`@mastra/nestjs@0.2.37` 是一个完整的 NestJS 模块，走 `MastraModule.forRootAsync`，带 DI、guards、限流、优雅停机、tracing，且内置 auth 默认关闭。版本号小不等于不成熟，这个判断是我读版本号读出来的，不是读代码读出来的。

第二件：内部用 Zod schema 做单一真源，但**对外暴露的契约是生成出来的 `openapi.yaml`**，前端客户端与类型由它生成。Zod 是内部真源，不等于对外契约——混淆这两者会导致「前端类型跟着后端改」而不是「后端契约驱动前端」。

## Considerations

- 后端框架：NestJS 是项目默认方向。偏离默认需要压倒性理由，而此处的理由已被实测推翻。
- 契约：项目规定 OpenAPI 是唯一真源，前端类型与客户端由契约生成，禁止手写重复类型。落地方式是 `@asteasolutions/zod-to-openapi` 把 Zod schema 生成 `openapi.yaml`（生成物入库），Orval 从 `openapi.yaml` 生成 TanStack Query hooks 与类型，`@redocly/cli` 的 breaking-change 规则在 CI 里拦截破坏性变更。
- 为什么不让 Zod 直接当契约：Zod 是运行时校验库，不是契约格式。第三方（前端代码生成器、未来的 API 文档、契约测试）需要一个语言中立的描述。

## Consequences

- 改 API 的正常路径是：改 Zod schema → 跑生成 → 看 `openapi.yaml` 的 diff → 前端重新生成客户端。生成物入库，diff 可审。
- 前端禁止 import 后端类型包，只能用生成的客户端与类型。
- 契约测试是独立一层：同一套请求同时过 `supertest` 与 `openapi-response-validator`，响应不符合 `openapi.yaml` 即失败。
- 代价：多一个生成步骤，CI 里要检查生成物是否与 schema 同步（不一致则失败）。这是有意付出的成本。
