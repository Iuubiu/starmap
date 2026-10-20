/**
 * 图谱领域的 paths 片段。
 *
 * 归属泳道：graph-dev。本文件与该泳道的 `src/domains/graph.ts` 配对：
 * 加 schema 去那边，加路由来这边。两处都只 append。
 */
import { NodeDetailResponseSchema, NodeListResponseSchema } from '../../dist/index.js';
import { jsonResponse, jsonSchema, pathParam } from './_shared.mjs';

export const components = {
  NodeListResponse: jsonSchema(NodeListResponseSchema),
  NodeDetailResponse: jsonSchema(NodeDetailResponseSchema),
};

export const paths = {
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
