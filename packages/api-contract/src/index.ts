/**
 * 契约唯一真源（ADR-0006）——**只做 re-export**。
 *
 * 链条：这里的 Zod schema → `openapi.yaml`（入库）→ Orval 生成前端客户端。
 * 前端不得手写与后端重复的类型；后端也不得绕过这里直接定义响应形状。
 *
 * 注意：Zod 是**内部**真源，`openapi.yaml` 是**对外**契约。两者都要入库，
 * 且 CI 必须校验它们同步——因为外部消费者（以及未来的移动端）只认 yaml。
 *
 * ## 本文件为什么只剩 re-export
 *
 * 20 张票由多条泳道并行实现，每条泳道都要加自己的 schema。单文件时
 * 「加一个 schema」= 改一个所有人都改的文件 = 每天撞车。拆分后：
 *
 *   - 领域 schema 落 `src/domains/<domain>.ts`，由对应泳道拥有；
 *   - 本文件按领域 re-export，**对外导出名一个都没变**——Orval 生成的
 *     类型名、`@starmap/api-contract` 的 import 路径、后端 controller 的
 *     import 全部不受影响。这是纯重构的前提。
 *
 * 新增领域：加 `src/domains/<x>.ts` + 下面一行 `export *`，两处都是 append。
 *
 * ## 领域文件归属
 *
 * | 文件 | 泳道 | 内容 |
 * | --- | --- | --- |
 * | `common.ts` | integrator | 错误码、统一错误体 |
 * | `system.ts` | integrator | 健康检查 |
 * | `graph.ts` | graph-dev | 节点状态、节点列表/详情 |
 * | `levels.ts` | level-dev | 关卡摘要 |
 * | `content.ts` | content-dev | 内容库统计、来源追溯 |
 * | `agent.ts` | agent-dev | 智能体回合（空壳，待填） |
 * | `market.ts` | authoring-dev | 关卡市场（空壳，待填） |
 * | `placement.ts` | agent-dev | 初始定级（自适应选题、自评、复核） |
 * | `profile.ts` | agent-dev | 学习者画像（票 78「初识」技能的输出） |
 * | `mastery.ts` | agent-dev | 个人看板的三级进度（票 80） |
 */
export * from './domains/common.js';
export * from './domains/system.js';
export * from './domains/levels.js';
export * from './domains/graph.js';
export * from './domains/content.js';
export * from './domains/agent.js';
export * from './domains/market.js';
export * from './domains/placement.js';
export * from './domains/tier.js';
export * from './domains/video.js';
export * from './domains/profile.js';
export * from './domains/mastery.js';
