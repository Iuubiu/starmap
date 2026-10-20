import { NodesController } from './nodes/nodes.controller.js';
import { ContentController } from './content/content.controller.js';
import { LevelsController } from './levels/levels.controller.js';

/**
 * 全部领域控制器的汇总表。
 *
 * 目的很窄：让「新增一个领域」= 在下面数组里加一行，而不是去改
 * `app.module.ts`（那个文件同时管 Provider、exports 和 Mastra 的排序约束，
 * 多条泳道并行时改它必然冲突）。
 *
 * 注意 `StarmapMastraModule` 不在这里：它注册的是 catch-all 控制器
 * （`@All('*')`），必须排在所有业务控制器之后，那个排序约束归
 * `app.module.ts` 管，见那里的注释。
 *
 * ## 归属
 *
 * | 控制器 | 泳道 |
 * | --- | --- |
 * | `NodesController` | graph-dev |
 * | `ContentController` | content-dev |
 * | `LevelsController` | level-dev |
 *
 * 新控制器落地后在下面加一行即可，本文件由 integrator 维护（冲突多时
 * 找我加，别自己改 `app.module.ts`）。
 */
export const domainControllers = [NodesController, ContentController, LevelsController];
