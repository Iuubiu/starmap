/**
 * 内容库领域的 paths 片段。
 *
 * 归属泳道：content-dev。本文件与该泳道的 `src/domains/content.ts` 配对：
 * 加 schema 去那边，加路由来这边。两处都只 append。
 */
import { ContentStatsResponseSchema, NodeSourcesResponseSchema } from '../../dist/index.js';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

export const components = {
  ContentStatsResponse: jsonSchema(ContentStatsResponseSchema),
  NodeSourcesResponse: jsonSchema(NodeSourcesResponseSchema),
};

export const paths = {
  '/api/v1/content/stats': {
    get: {
      operationId: 'getContentStats',
      summary: '内容库统计：来源、知识点、chunk、答案块、先修边',
      responses: {
        '200': jsonResponse('统计结果', 'ContentStatsResponse'),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },
  '/api/v1/nodes/{microKpId}/sources': {
    get: {
      operationId: 'getNodeSources',
      summary: '某知识点的来源页与切片（用于核对内容可追溯）',
      parameters: [pathParam('microKpId')],
      responses: {
        '200': jsonResponse('来源页与切片', 'NodeSourcesResponse'),
        '404': jsonResponse('节点不存在', 'ApiError'),
        '500': jsonResponse('服务内部错误', 'ApiError'),
      },
    },
  },
};
