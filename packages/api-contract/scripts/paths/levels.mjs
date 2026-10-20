/**
 * 关卡领域的 paths 片段。
 *
 * 归属泳道：level-dev。本文件与该泳道的 `src/domains/levels.ts` 配对：
 * 加 schema 去那边，加路由来这边。两处都只 append。
 */
import {
  AttemptRecordSchema,
  AttemptSubmitRequestSchema,
  AttemptSubmitResponseSchema,
  LevelDetailResponseSchema,
  LevelSummarySchema,
  MasteryViewSchema,
} from '../../dist/index.js';
import { LevelSpecSchema } from '@starmap/shared';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

export const components = {
  LevelSummary: jsonSchema(LevelSummarySchema),
  // spec 的 JSON Schema 直接由 Zod 渲染。它是响应体的一部分，所以必须进组件，
  // 否则前端只能拿到一个 `additionalProperties: true` 的空对象去猜形状。
  LevelSpec: jsonSchema(LevelSpecSchema),
  LevelDetailResponse: jsonSchema(LevelDetailResponseSchema),
  // 票 05：作答与双字段掌握度
  AttemptSubmitRequest: jsonSchema(AttemptSubmitRequestSchema),
  AttemptRecord: jsonSchema(AttemptRecordSchema),
  MasteryView: jsonSchema(MasteryViewSchema),
  AttemptSubmitResponse: jsonSchema(AttemptSubmitResponseSchema),
};

/** 错误体统一走 `ApiError`（common 领域已定义，这里只引用不重定义） */
const err = (description) => jsonResponse(description, 'ApiError');

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

  /**
   * 提交一次作答。
   *
   * ## 为什么是 POST /attempts 而不是 POST /levels/{id}/attempts
   *
   * 作答的归属是**微知识点**，关卡只是它发生的地点：同一道题会在复验关卡里
   * 再出现一次（票 07），那时关卡 id 变了而知识点没变。挂在关卡下面会让
   * 「这道题我做过几次」变成跨三个关卡 id 的并集查询。
   *
   * ## 为什么响应里带掌握度
   *
   * 学习者答完一题最想知道的是「这算数吗」；判完立刻把新的双字段带回来，
   * 前端不必再发一次请求，也不会出现「记录写成功了但掌握度显示的是旧值」
   * 这种两秒钟的错觉窗口。
   *
   * ## 为什么不幂等
   *
   * 每次 POST 都是一条**新证据**，同一道题做两次就是两条记录（这才会让
   * attemptNo 有意义）。要防「双击提交」请由客户端在提交后禁用按钮 ——
   * 服务端去重会让「真的想再做一次」变成静默无效。
   */
  /**
   * 读一个知识点的双字段掌握度。
   *
   * `microKpId` 可以是叶节点也可以是折叠父节点：父节点的数是**只读聚合**
   * （叶子后代按证据量加权），`isLeaf=false` 与 `aggregatedLeafCount` 就是
   * 给调用方看这件事的。聚合不落库（ADR-0004），所以这个接口是纯读。
   */
  '/api/v1/mastery/{microKpId}': {
    get: {
      operationId: 'getMastery',
      summary: '知识点掌握度（双字段：achieved 不衰减、current 会衰减）',
      description:
        '证据不足（<3 个变式或 <8 次作答）时 `achieved` 与 `current` 都是 null，' +
        '调用方应显示「证据不足」而不是 0% —— 「不知道」和「零分」是两件事。',
      parameters: [pathParam('microKpId')],
      responses: {
        '200': jsonResponse('掌握度', 'MasteryView'),
        '404': err('知识点不存在'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/attempts': {
    post: {
      operationId: 'submitAttempt',
      summary: '记录一次作答并重算掌握度',
      description:
        '对错由后端比对 `level_items.answer` 判定，请求体不接受客户端自报的 ' +
        '`correct`。写入作答、重算该微知识点掌握度、更新掌握度行在**同一个事务**里' +
        '完成：半步失败会留下「证据记了但掌握度没动」的不一致状态。',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AttemptSubmitRequest' },
          },
        },
      },
      responses: {
        '200': jsonResponse('作答已记录，附带重算后的掌握度', 'AttemptSubmitResponse'),
        '400': err('请求体不成形（缺字段、类型不对）'),
        '404': err('题目不存在'),
        '422': err('作答不合法（选项下标越界、答案类型与题目不符）'),
        '500': err('服务内部错误'),
      },
    },
  },
};
