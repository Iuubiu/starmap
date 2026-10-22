/**
 * 图谱领域的 paths 片段。
 *
 * 归属泳道：graph-dev。本文件与该泳道的 `src/domains/graph.ts` 配对：
 * 加 schema 去那边，加路由来这边。两处都只 append。
 */
import {
  ContentGapSchema,
  GraphEdgeSchema,
  GraphNodeSchema,
  GraphResponseSchema,
  NodeDetailResponseSchema,
  NodeListResponseSchema,
  NodeSourceSchema,
  ReasonFactSchema,
  ReasonKindSchema,
  RecommendationListResponseSchema,
  RecommendationReasonSchema,
  RecommendationSchema,
  RedirectRequestSchema,
  RedirectResponseSchema,
  TodaySummarySchema,
} from '../../dist/index.js';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

/** 请求体：`{ required: true, content: { 'application/json': { schema: $ref } } }` */
const jsonBody = (schemaName) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
});

export const components = {
  NodeListResponse: jsonSchema(NodeListResponseSchema),
  NodeDetailResponse: jsonSchema(NodeDetailResponseSchema),
  // 来源单独声明为组件：前端要写 `NodeSource` 这个类型名（`NodeDetailResponse`
  // 里的 `source` 字段是可空对象，Orval 只有拿到组件名才会生成独立类型而不是
  // 一串匿名内联对象）。
  NodeSource: jsonSchema(NodeSourceSchema),
  // GraphNode / GraphEdge 单独声明为组件（而不只内联在 GraphResponse 里）：
  // 一是让生成的前端类型有独立名字（`GraphNode` 会被 MapPage 直接引用），
  // 二是 emit-openapi 的「死 schema」检查要求每个契约 schema 要么进 components
  // 要么在 openapi.yaml 里以内联形态出现——进 components 是更明确的那条路。
  GraphNode: jsonSchema(GraphNodeSchema),
  GraphEdge: jsonSchema(GraphEdgeSchema),
  // ContentGap 同理：前端要写 `ContentGap` 这个类型名，而不是一串匿名内联对象。
  ContentGap: jsonSchema(ContentGapSchema),
  GraphResponse: jsonSchema(GraphResponseSchema),

  // ---- 推荐（票 13）----
  // 这些全部声明为组件，理由同上：每个都要在前端有独立类型名。
  // `ReasonFact` 尤其重要——它是判别联合，Orval 只有拿到组件名才会生成
  // `ReasonFact` 类型而不是一串匿名内联对象；前端渲染理由时要做 switch。
  ReasonFact: jsonSchema(ReasonFactSchema),
  ReasonKind: jsonSchema(ReasonKindSchema),
  RecommendationReason: jsonSchema(RecommendationReasonSchema),
  Recommendation: jsonSchema(RecommendationSchema),
  TodaySummary: jsonSchema(TodaySummarySchema),
  RecommendationListResponse: jsonSchema(RecommendationListResponseSchema),
  RedirectRequest: jsonSchema(RedirectRequestSchema),
  RedirectResponse: jsonSchema(RedirectResponseSchema),
};

export const paths = {
  '/api/v1/graph': {
    get: {
      operationId: 'getGraph',
      summary: '整张知识图谱：全部微知识点、先修边与掌握状态',
      description:
        '一次返回全部叶节点（微知识点）与其先修边，供知识地图画布做本地布局与两跳邻域裁剪。' +
        '不分页：力导向布局需要完整图，缺一半节点会让布局跳变。' +
        '同时带上资源库的内容缺口（`contentGaps`）—— 缺口只在跟节点摆在一起时才有意义：' +
        '它指向的是「课程表上本该有、资源库里没有」的东西，单独拉一份缺口列表反而无法告诉学习者' +
        '「你现在看到的这张图的哪里断了」。',
      responses: {
        '200': jsonResponse('整张图谱', 'GraphResponse'),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },
  '/api/v1/recommendations': {
    get: {
      operationId: 'getRecommendations',
      summary: '今日推荐（带结构化理由）与今日学习摘要',
      description:
        '推荐由 `@starmap/engine` 的纯函数 `recommend()` 算出，与 `GET /api/v1/graph` ' +
        '在同一个请求里用同一时刻调用同一个函数，所以两处的 `recommendedIds` 必然一致。' +
        '理由以结构化事实返回（不是拼好的中文句子），由前端渲染成可点、可加粗的表述。',
      responses: {
        '200': jsonResponse('今日推荐与摘要', 'RecommendationListResponse'),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },
  '/api/v1/recommendations/redirect': {
    post: {
      operationId: 'redirectRecommendation',
      summary: '拒绝当前推荐并改道到另一个微知识点',
      description:
        '把「谁拒绝了谁」记进 `learning_log`（`event = recommendation_redirect`）。' +
        '被拒绝的节点从此不再被推荐，直到它产生晚于拒绝时刻的新作答证据 —— ' +
        '因为只有状态变了，拒绝的理由才过期。',
      requestBody: jsonBody('RedirectRequest'),
      responses: {
        '200': jsonResponse('改道已记录', 'RedirectResponse'),
        '400': jsonResponse('请求体不成形（缺字段、类型不对）', 'ApiError'),
        '404': jsonResponse('微知识点不存在', 'ApiError'),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },
  '/api/v1/nodes': {
    get: {
      operationId: 'listNodes',
      summary: '列出知识点节点及其掌握状态',
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
        { name: 'cursor', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': jsonResponse('节点列表', 'NodeListResponse'),
        '400': jsonResponse('查询参数不合法', 'ApiError'),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },
  '/api/v1/nodes/{microKpId}': {
    get: {
      operationId: 'getNode',
      summary: '单个知识点详情与可用关卡',
      parameters: [pathParam('microKpId')],
      responses: {
        '200': jsonResponse('节点详情', 'NodeDetailResponse'),
        '404': jsonResponse('节点不存在', 'ApiError'),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },
};
