/**
 * 关卡领域的 paths 片段。
 *
 * 归属泳道：level-dev。本文件与该泳道的 `src/domains/levels.ts` 配对：
 * 加 schema 去那边，加路由来这边。两处都只 append。
 */
import {
  LevelDetailResponseSchema,
  LevelSummarySchema,
} from '../../dist/index.js';
import { LevelSpecSchema } from '@starmap/shared';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

export const components = {
  LevelSummary: jsonSchema(LevelSummarySchema),
  // spec 的 JSON Schema 直接由 Zod 渲染。它是响应体的一部分，所以必须进组件，
  // 否则前端只能拿到一个 `additionalProperties: true` 的空对象去猜形状。
  LevelSpec: jsonSchema(LevelSpecSchema),
  LevelDetailResponse: jsonSchema(LevelDetailResponseSchema),
};

export const paths = {
  '/api/v1/levels/{levelId}': {
    get: {
      operationId: 'getLevel',
      summary: '关卡详情（含完整 level.spec）',
      description:
        '返回关卡的完整规范。播放器靠它一次性拿到卡片、七段步骤与全部题目：' +
        '每题的选项、正确答案与**预写反馈**都在里面，作答后不需要再请求后端、' +
        '也不需要等模型生成解释。',
      parameters: [pathParam('levelId')],
      responses: {
        '200': jsonResponse('关卡详情', 'LevelDetailResponse'),
        '404': jsonResponse('关卡不存在', 'ApiError'),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },
};
