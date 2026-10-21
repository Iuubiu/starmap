/**
 * 定级领域的 paths 片段。
 *
 * 归属泳道：agent-dev（票 11 初始定级）。本文件与该泳道的
 * `src/domains/placement.ts` 配对：加 schema 去那边，加路由来这边。两处都只 append。
 */
import {
  PlacementAnswerRequestSchema,
  PlacementAnswerResponseSchema,
  PlacementDifficultySchema,
  PlacementItemViewSchema,
  PlacementRejudgeEventSchema,
  PlacementRejudgeResponseSchema,
  PlacementResultResponseSchema,
  PlacementReviewItemSchema,
  PlacementSessionResponseSchema,
  PlacementStartRequestSchema,
  PlacementStatusResponseSchema,
  PlacementTierSchema,
  SelfAssessmentAnswerSchema,
  SelfAssessmentFormResponseSchema,
  SelfAssessmentOptionSchema,
  SelfAssessmentQuestionSchema,
  SelfAssessmentSubmitRequestSchema,
  SelfAssessmentSubmitResponseSchema,
} from '../../dist/index.js';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

/**
 * 每个契约 `*Schema` 都要在这里出现（或作为内联形状出现在 openapi.yaml 里）。
 *
 * `emit-openapi.mjs` 会逐个检查：没声明为组件、又没在文档里内联出现的 schema
 * 会被当成「写了但没人用」而报错。所以这里的清单不是可选项 —— 少一行，
 * `pnpm contract:gen` 就会红。
 */
export const components = {
  PlacementTier: jsonSchema(PlacementTierSchema),
  PlacementDifficulty: jsonSchema(PlacementDifficultySchema),
  SelfAssessmentOption: jsonSchema(SelfAssessmentOptionSchema),
  SelfAssessmentQuestion: jsonSchema(SelfAssessmentQuestionSchema),
  SelfAssessmentAnswer: jsonSchema(SelfAssessmentAnswerSchema),
  SelfAssessmentFormResponse: jsonSchema(SelfAssessmentFormResponseSchema),
  SelfAssessmentSubmitRequest: jsonSchema(SelfAssessmentSubmitRequestSchema),
  SelfAssessmentSubmitResponse: jsonSchema(SelfAssessmentSubmitResponseSchema),
  PlacementItemView: jsonSchema(PlacementItemViewSchema),
  PlacementStartRequest: jsonSchema(PlacementStartRequestSchema),
  PlacementSessionResponse: jsonSchema(PlacementSessionResponseSchema),
  PlacementAnswerRequest: jsonSchema(PlacementAnswerRequestSchema),
  PlacementAnswerResponse: jsonSchema(PlacementAnswerResponseSchema),
  PlacementReviewItem: jsonSchema(PlacementReviewItemSchema),
  PlacementResultResponse: jsonSchema(PlacementResultResponseSchema),
  PlacementStatusResponse: jsonSchema(PlacementStatusResponseSchema),
  PlacementRejudgeEvent: jsonSchema(PlacementRejudgeEventSchema),
  PlacementRejudgeResponse: jsonSchema(PlacementRejudgeResponseSchema),
};

/** 错误体统一走 `ApiError`（common 领域已定义，这里只引用不重定义） */
const err = (description) => jsonResponse(description, 'ApiError');

export const paths = {
  '/api/v1/placement/self-assessment': {
    get: {
      operationId: 'getSelfAssessmentForm',
      summary: '行为自评问卷（4 题）',
      description:
        '返回四道**行为频率**题，用于给起手先验做一次小幅平移（最多 ±0.4 logit）。' +
        '不问「你觉得自己什么水平」：自评分与实测能力的相关性不稳定，而让学习者' +
        '给自己打分还会引入一层社交期望偏差。',
      responses: {
        '200': jsonResponse('自评问卷', 'SelfAssessmentFormResponse'),
        '500': err('服务内部错误'),
      },
    },
    post: {
      operationId: 'submitSelfAssessment',
      summary: '提交行为自评，得到起手先验',
      description:
        '只回先验（三档概率与平移量），**不直接给档位**。档位必须由随后的定级题' +
        '决定：自评只能把起点挪一点，不能替代测量。',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/SelfAssessmentSubmitRequest' } } },
      },
      responses: {
        '200': jsonResponse('起手先验', 'SelfAssessmentSubmitResponse'),
        '400': err('请求体不合法'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/placement/sessions': {
    /**
     * 开一次定级。
     *
     * 题池来自**马上要学的知识点池**（票 11 验收 2）：按图谱顺序取该学习者
     * 接下来要学的叶节点，只取其中有题的。用通用题库会让「定完级学的内容」
     * 与「定级考的内容」脱节——那正是这条验收要防的事。
     */
    post: {
      operationId: 'startPlacement',
      summary: '开始一次定级，返回第一道题',
      description:
        '题池只取「即将要学的知识点」里已有关卡的题。题池不足 8 题时仍然开始，' +
        '但结果会被标记为低置信度（题池的大小在 `remainingItems` 里可见）。',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/PlacementStartRequest' } } },
      },
      responses: {
        '200': jsonResponse('定级会话与第一道题', 'PlacementSessionResponse'),
        '400': err('请求体不合法'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/placement/sessions/{sessionId}': {
    get: {
      operationId: 'getPlacementSession',
      summary: '读取定级会话当前状态',
      description:
        '刷新页面后靠它恢复：服务端持有作答历史，前端不需要自己存。' +
        '`item` 为 null 表示这次定级已经结束。',
      parameters: [pathParam('sessionId')],
      responses: {
        '200': jsonResponse('定级会话', 'PlacementSessionResponse'),
        '404': err('定级会话不存在'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/placement/sessions/{sessionId}/answers': {
    post: {
      operationId: 'submitPlacementAnswer',
      summary: '提交一道定级题的作答',
      description:
        '判定并回带**正确答案与解析**（票 11 验收 4：学习者要能判断系统有没有把' +
        '自己判错）。定级的作答**不写 `app.attempts`** —— 它不是练习，不产生' +
        '掌握度记录。',
      parameters: [pathParam('sessionId')],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/PlacementAnswerRequest' } } },
      },
      responses: {
        '200': jsonResponse('判定与下一题', 'PlacementAnswerResponse'),
        '400': err('请求体不合法'),
        '404': err('定级会话不存在'),
        '422': err('选项下标越界或题目数据不合法'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/placement/sessions/{sessionId}/result': {
    get: {
      operationId: 'getPlacementResult',
      summary: '定级结果（档位、置信度与逐题复核）',
      description:
        '包含逐题复核表与中文说明。结果状态永远是 `provisional`：学满若干' +
        '知识点后会自动重判并可升降级（票 11 验收 5）。',
      parameters: [pathParam('sessionId')],
      responses: {
        '200': jsonResponse('定级结果', 'PlacementResultResponse'),
        '404': err('定级会话不存在'),
        '409': err('定级尚未结束，还不能出结果'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/placement': {
    get: {
      operationId: 'getPlacementStatus',
      summary: '当前定级状态',
      description:
        '没有定级记录时返回 `status: "none"` 与 `tier: null` —— 新用户没定过级' +
        '是正常状态，不是 404。',
      responses: {
        '200': jsonResponse('定级状态', 'PlacementStatusResponse'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/placement/rejudge': {
    /**
     * 重判。
     *
     * 用**已有的学习证据**重新定档，不是重答定级题。题面写「学满 3 个知识点
     * 后自动重判并可升降级」——它要的是「用真实学习数据修正最初那 8–18 题的
     * 判断」，重考一遍只会得到同一批人同样的结果，还多一次挫败。
     */
    post: {
      operationId: 'rejudgePlacement',
      summary: '用学习证据重判档位',
      description:
        '达到门槛（学满 3 个知识点）后调用。返回重判前后的档位与依据（学完的' +
        '知识点数、平均首轮正确率）。未达门槛时 409。',
      requestBody: {
        required: false,
        content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } },
      },
      responses: {
        '200': jsonResponse('重判结果', 'PlacementRejudgeResponse'),
        '409': err('还没学满门槛，暂不能重判'),
        '500': err('服务内部错误'),
      },
    },
  },
};
