/**
 * 三档渲染参数领域的 paths 片段。
 *
 * 归属泳道：agent-dev（票 12）。本文件与该泳道的 `src/domains/tier.ts` 配对：
 * 加 schema 去那边，加路由来这边。两处都只 append。
 *
 * ## 为什么全是 GET
 *
 * 这一组端点**只读**：档位从定级档案来，参数从 engine 常量来，首轮计划从关卡
 * spec 算来。控制档位的写入路径在 `/api/v1/placement`（重判）与学习行为（作答）
 * 上，不在这里。因此这里没有 POST ——「改档位」不是一个可以直接调的操作，
 * 它必须是学习证据的**结果**。
 */
import {
  FirstRoundPlanSchema,
  FirstRoundShapeSchema,
  TierChangeSchema,
  TierChangesResponseSchema,
  TierLadderSchema,
  TierLevelPlanResponseSchema,
  TierMasteryProgressSchema,
  TierMasteryRuleSchema,
  TierNameSchema,
  TierOverviewResponseSchema,
  TierParamsSchema,
  TierSessionPlanResponseSchema,
} from '../../dist/index.js';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

/**
 * 每个契约 `*Schema` 都要在这里出现（或作为内联形状出现在 openapi.yaml 里）。
 * `emit-openapi.mjs` 会逐个检查，少一行 `pnpm contract:gen` 就会红。
 *
 * 子 schema（`TierLadder` 等）也单独列成组件：不列的话它们会内联展开在
 * `TierParams` 里，生成的前端类型就变成一坨匿名对象，改一个字段会 diff 整份文件。
 */
export const components = {
  TierName: jsonSchema(TierNameSchema),
  TierLadder: jsonSchema(TierLadderSchema),
  TierMasteryRule: jsonSchema(TierMasteryRuleSchema),
  TierParams: jsonSchema(TierParamsSchema),
  FirstRoundShape: jsonSchema(FirstRoundShapeSchema),
  FirstRoundPlan: jsonSchema(FirstRoundPlanSchema),
  TierOverviewResponse: jsonSchema(TierOverviewResponseSchema),
  TierLevelPlanResponse: jsonSchema(TierLevelPlanResponseSchema),
  TierMasteryProgress: jsonSchema(TierMasteryProgressSchema),
  TierChange: jsonSchema(TierChangeSchema),
  TierChangesResponse: jsonSchema(TierChangesResponseSchema),
  TierSessionPlanResponse: jsonSchema(TierSessionPlanResponseSchema),
};

export const paths = {
  '/api/v1/tier': {
    get: {
      summary: '当前档位与六维渲染参数',
      description:
        '没定过级时返回 `tier: "P1"` 与 `source: "fallback"`（参数回落到 P1），' +
        '不是 404 —— 新用户该看到最完整的默认档界面，而不是一条错误。' +
        '`source` 用来区分「真的定级到 P1」与「还没定级所以按 P1 渲染」：' +
        '后者界面上不该说「你的水平是 P1」。',
      operationId: 'getTierOverview',
      responses: {
        '200': jsonResponse('当前档位与参数', 'TierOverviewResponse'),
      },
    },
  },
  '/api/v1/tier/levels/{levelId}/plan': {
    get: {
      summary: '某一关在当前档位下的渲染计划',
      description:
        '首轮从哪一段开始、卡片怎么摊，由服务端按该关真实的 spec 算出。' +
        '前端自己推导会把「第一段带题的段」这套规则再写一遍。' +
        '`masteryProgress` 也一并返回：掌握判定按本档规则算，且证据来自 `app.attempts` ' +
        '回放（跨关卡、跨会话），不是页面本地记录。',
      operationId: 'getTierLevelPlan',
      parameters: [pathParam('levelId')],
      responses: {
        '200': jsonResponse('关卡的首轮计划', 'TierLevelPlanResponse'),
        '404': jsonResponse('关卡不存在', 'ApiError'),
      },
    },
  },
  '/api/v1/tier/changes': {
    get: {
      summary: '档位变更历史（新的在前）',
      description:
        '升降级都写进学习日志；这里读出来给学习者看「为什么给我降档了」。' +
        '`items` 为空数组表示从未重评过。',
      operationId: 'getTierChanges',
      parameters: [
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
      ],
      responses: {
        '200': jsonResponse('档位变更历史', 'TierChangesResponse'),
      },
    },
  },
  '/api/v1/tier/session-plan': {
    get: {
      summary: '本次会话的下一步（受档位的会话新知识点上限约束）',
      description:
        '按当前档位的 `sessionNewKpLimit` 截断推荐列表，并回报被推迟的数量。' +
        'P1 学习者拿到的 `items` 最多 2 条。',
      operationId: 'getTierSessionPlan',
      responses: {
        '200': jsonResponse('本次会话的下一步', 'TierSessionPlanResponse'),
      },
    },
  },
};
