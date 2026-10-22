/**
 * 学习者画像的 paths 片段（票 78）。归属：agent-dev。
 *
 * 两条路由：读画像、按字段改画像。
 *
 * ## 为什么没有「新建画像」的 POST
 *
 * 画像是**单行**的（单用户工作站）。第一次 GET 时表里还没有行，返回一份全
 * `null` 的画像即可 —— 那正是「还什么都没问」的正确表达。让学生先点一下
 * 「开始」才能拥有画像，只会多一个可以忘记写的状态。
 *
 * ## 为什么用 PATCH 而不是 PUT
 *
 * 「改单题」只提交一个字段。PUT 的语义是整体替换，服务端就得自己区分
 * 「没提交这个字段」与「提交了 null」—— 而 `null` 在这里有确切含义（跳过）。
 * PATCH + 部分 schema 让这两件事在契约层面就分得开。
 */
import {
  ExplanationDensitySchema,
  LearnerBackgroundSchema,
  LearnerProfilePatchSchema,
  LearnerProfileSchema,
  LearningGoalSchema,
  MathLevelSchema,
  ProfileFieldSchema,
  ProfileResponseSchema,
} from '../../dist/index.js';
import { jsonResponse, jsonSchema } from './_shared.mjs';

/** 错误体统一走 `ApiError`（common 领域已定义，这里只引用不重定义）。 */
const err = (description) => jsonResponse(description, 'ApiError');

export const components = {
  LearnerBackground: jsonSchema(LearnerBackgroundSchema),
  MathLevel: jsonSchema(MathLevelSchema),
  LearningGoal: jsonSchema(LearningGoalSchema),
  ExplanationDensity: jsonSchema(ExplanationDensitySchema),
  ProfileField: jsonSchema(ProfileFieldSchema),
  LearnerProfile: jsonSchema(LearnerProfileSchema),
  LearnerProfilePatch: jsonSchema(LearnerProfilePatchSchema),
  ProfileResponse: jsonSchema(ProfileResponseSchema),
};

export const paths = {
  '/api/v1/profile': {
    get: {
      operationId: 'getProfile',
      summary: '读取学习者画像（没填过的字段是 null）',
      responses: {
        '200': jsonResponse('当前画像', 'ProfileResponse'),
        '500': err('服务内部错误'),
      },
    },
    patch: {
      operationId: 'updateProfile',
      summary: '按字段更新画像（只提交要改的那一个字段）',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/LearnerProfilePatch' } },
        },
      },
      responses: {
        '200': jsonResponse('更新后的画像', 'ProfileResponse'),
        '400': err('请求体不合法'),
        '500': err('服务内部错误'),
      },
    },
  },
};
