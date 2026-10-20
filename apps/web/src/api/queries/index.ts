/**
 * 生成客户端的薄包装，只做一件事：把 `data` 收窄成成功响应体。
 *
 * 为什么需要这层：Orval 会把 `data` 类型化成「成功体 | 各错误体」的联合，
 * 因为 OpenAPI 里列出了 400/404/500。但我们的 `customFetch` 在 `!res.ok`
 * 时**直接 throw**，所以运行时 `data` 永远是成功体 —— 联合类型的错误分支
 * 是可达性为零的死路。每张页面各自写 `as` 是重复的噪音，收在一处更好。
 *
 * 顺带统一了 `payload` 命名，页面不需要记住 `data.data` 这种嵌套。
 *
 * ## 本文件为什么只剩 re-export
 *
 * 20 张票由多条泳道并行实现，每条都要加自己的 query hook。单文件时
 * 「加一个 hook」= 改一个所有人都改的文件。拆分后：
 *
 *   - 各领域的 hook 落 `queries/<domain>.ts`，由对应泳道拥有；
 *   - 本文件按领域 re-export，**对外导出名一个都没变** —— 页面里的
 *     `import { useNodeList } from '../api/queries'` 与测试里的
 *     `vi.mock('../api/queries', ...)` 全部照旧。
 *
 * 新增领域：加 `queries/<x>.ts` + 下面一行 `export *`，两处都是 append。
 *
 * ## 领域文件归属
 *
 * | 文件 | 泳道 | 内容 |
 * | --- | --- | --- |
 * | `system.ts` | integrator | `useHealth` |
 * | `graph.ts` | graph-dev | `useNodeList` / `useNodeDetail` |
 * | `content.ts` | content-dev | `useContentStats` / `useNodeSources` |
 * | `levels.ts` | level-dev | 关卡相关（空壳，待填） |
 * | `agent.ts` | agent-dev | 智能体回合相关（空壳，待填） |
 * | `market.ts` | authoring-dev | 关卡市场相关（空壳，待填） |
 */
export * from './system.js';
export * from './graph.js';
export * from './levels.js';
export * from './content.js';
export * from './agent.js';
export * from './market.js';
