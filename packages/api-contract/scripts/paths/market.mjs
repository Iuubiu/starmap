/**
 * 关卡市场领域的 paths 片段（票 14 / 16）。
 *
 * 归属泳道：authoring-dev。本文件与该泳道的 `src/domains/market.ts` 配对：
 * 加 schema 去那边，加路由来这边。两处都只 append。
 *
 * component 名一律 `Market*` 前缀 —— 合并器对重名直接报错（Orval 的类型名
 * 只由 component 名决定，重名会静默换掉前端的类型形状），前缀是防撞的最低成本。
 *
 * ## 为什么没有「分发」类路由
 *
 * spec.md:496 明确把「关卡市场的真实分发」列为 Out of Scope。这里的 POST 是
 * **保存到本地关卡库**，没有任何让关卡离开本机的语义（没有 publish / share /
 * visibility）。路由命名也按这个说：`/market/levels` 是「入库」，不是「发布」。
 */
import {
  MarketDraftItemSchema,
  MarketDraftLearningSchema,
  MarketDraftRequestSchema,
  MarketDraftResponseSchema,
  MarketLevelAuthorSchema,
  MarketLevelDetailResponseSchema,
  MarketLevelListResponseSchema,
  MarketLevelOriginSchema,
  MarketLevelSummarySchema,
  MarketSaveLevelRequestSchema,
  MarketSaveLevelResponseSchema,
  MarketSpecIssueSchema,
} from '../../dist/index.js';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

export const components = {
  // 被响应体嵌套引用的子形状也要单独成组件。原因不是「好看」，而是
  // `contract:emit` 的双向检查：契约包里每个 `*Schema` 都必须出现在
  // components 中，否则它报「片段里没引用它」。这条检查值得留着 ——
  // 它抓的是「schema 写了但没人用」的腐烂（通常是改名后的残留）。
  MarketLevelSummary: jsonSchema(MarketLevelSummarySchema),
  MarketSpecIssue: jsonSchema(MarketSpecIssueSchema),
  MarketDraftItem: jsonSchema(MarketDraftItemSchema),
  MarketDraftLearning: jsonSchema(MarketDraftLearningSchema),
  MarketLevelOrigin: jsonSchema(MarketLevelOriginSchema),
  MarketLevelAuthor: jsonSchema(MarketLevelAuthorSchema),
  MarketLevelListResponse: jsonSchema(MarketLevelListResponseSchema),
  MarketDraftRequest: jsonSchema(MarketDraftRequestSchema),
  MarketDraftResponse: jsonSchema(MarketDraftResponseSchema),
  MarketSaveLevelRequest: jsonSchema(MarketSaveLevelRequestSchema),
  MarketSaveLevelResponse: jsonSchema(MarketSaveLevelResponseSchema),
  MarketLevelDetailResponse: jsonSchema(MarketLevelDetailResponseSchema),
};

/** 错误体统一走 `ApiError`（common 领域已定义，这里只引用不重定义） */
const err = (description) => jsonResponse(description, 'ApiError');

export const paths = {
  '/api/v1/market/levels': {
    get: {
      operationId: 'listMarketLevels',
      summary: '关卡市场：预制关卡 + 自己保存的关卡（当前只做保存，不做分发）',
      responses: {
        '200': jsonResponse('市场关卡列表', 'MarketLevelListResponse'),
        '500': err('服务内部错误'),
      },
    },
    post: {
      operationId: 'saveMarketLevel',
      summary: '保存自制关卡到关卡库（先过 level.spec 校验器，不通过返回 422 与字段级错误）',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/MarketSaveLevelRequest' } },
        },
      },
      responses: {
        // 永远是 200，新建与覆盖的区别在 `created` 里。用 201/200 两个状态码
        // 表达同一件事，会让「保存成功」这件事有两套前端分支，而它能提供的信息
        // 已经由 created 提供了。
        '200': jsonResponse('已保存（created=false 表示覆盖了同 id 的旧版本）', 'MarketSaveLevelResponse'),
        '422': err('关卡规范校验不通过，details 里是字段级错误列表'),
        '409': err('关卡 id 与已有系统关卡冲突'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/market/drafts': {
    post: {
      operationId: 'createMarketDraft',
      summary: '把一个知识点的学习过程（涉及的题、错因、讲解片段）打包成关卡草稿',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/MarketDraftRequest' } },
        },
      },
      responses: {
        '200': jsonResponse('草稿（可能还不合法，字段级缺项在 issues 里）', 'MarketDraftResponse'),
        '404': err('知识点不存在'),
        '422': err('请求参数不合法'),
        '500': err('服务内部错误'),
      },
    },
  },

  '/api/v1/market/levels/{levelId}': {
    get: {
      operationId: 'getMarketLevel',
      summary: '市场的单个关卡（含完整 level.spec，供编辑/重新开始）',
      parameters: [pathParam('levelId')],
      responses: {
        '200': jsonResponse('关卡详情', 'MarketLevelDetailResponse'),
        '404': err('关卡不存在'),
        '500': err('服务内部错误'),
      },
    },
  },
};
