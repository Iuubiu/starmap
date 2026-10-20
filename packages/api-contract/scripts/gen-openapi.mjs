/**
 * 把 Zod schema 渲染成 openapi.yaml。
 *
 * 链条：Zod（内部真源）→ 本脚本 → openapi.yaml（对外契约）→ Orval 生成前端客户端。
 *
 * 两个踩过的坑，写下来免得后人重踩：
 * 1. `@asteasolutions/zod-to-openapi` 与 `zod-to-json-schema` 都是 Zod 3 时代的库。
 *    在 Zod 4.6 下前者类型不匹配、后者**静默返回空对象**（不报错）。
 *    Zod 4 自带 `toJSONSchema()`，直接用原生实现。
 * 2. YAML 序列化交给 `yaml` 包。手写序列化器输出 `-     url:` 这种错误缩进
 *    且自测能通过——YAML 缩进错误不报错，只在消费端炸。
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { z } from 'zod';
import {
  HealthResponseSchema,
  NodeDetailResponseSchema,
  NodeListResponseSchema,
  NodeSourcesResponseSchema,
  ContentStatsResponseSchema,
  ApiErrorSchema,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outFile = join(root, 'openapi.yaml');

/** OpenAPI 3.1 接受 JSON Schema 2020-12；去掉 Zod 附带的 $schema 声明 */
const jsonSchema = (schema) => {
  const out = z.toJSONSchema(schema, { io: 'output' });
  delete out.$schema;
  return out;
};

const components = {
  HealthResponse: jsonSchema(HealthResponseSchema),
  NodeListResponse: jsonSchema(NodeListResponseSchema),
  NodeDetailResponse: jsonSchema(NodeDetailResponseSchema),
  NodeSourcesResponse: jsonSchema(NodeSourcesResponseSchema),
  ContentStatsResponse: jsonSchema(ContentStatsResponseSchema),
  ApiError: jsonSchema(ApiErrorSchema),
};

/** 稳定 YAML 序列化：交给 yaml 包，按固定 key 顺序重排以便 diff 稳定 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'StarMap API',
    version: '1.0.0',
    description:
      '核电子学学习工作站。契约唯一真源：本文件由 packages/api-contract 的 Zod schema 生成，请勿手改。',
  },
  servers: [{ url: 'http://127.0.0.1:3001', description: '本地开发' }],
  paths: {
    '/api/v1/health': {
      get: {
        operationId: 'getHealth',
        summary: '健康检查',
        responses: {
          '200': {
            description: '服务正常',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
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
          '200': {
            description: '节点列表',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NodeListResponse' },
              },
            },
          },
          '400': {
            description: '查询参数不合法',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
            },
          },
          '500': {
            description: '服务内部错误',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
            },
          },
        },
      },
    },
    '/api/v1/content/stats': {
      get: {
        operationId: 'getContentStats',
        summary: '内容库统计：来源、知识点、chunk、答案块、先修边',
        responses: {
          '200': {
            description: '统计结果',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ContentStatsResponse' },
              },
            },
          },
          '500': {
            description: '服务内部错误',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
            },
          },
        },
      },
    },
    '/api/v1/nodes/{microKpId}/sources': {
      get: {
        operationId: 'getNodeSources',
        summary: '某知识点的来源页与切片（用于核对内容可追溯）',
        parameters: [
          { name: 'microKpId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: '来源页与切片',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NodeSourcesResponse' },
              },
            },
          },
          '404': {
            description: '节点不存在',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
            },
          },
          '500': {
            description: '服务内部错误',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
            },
          },
        },
      },
    },
    '/api/v1/nodes/{microKpId}': {
      get: {
        operationId: 'getNode',
        summary: '单个知识点详情与可用关卡',
        parameters: [
          { name: 'microKpId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: '节点详情',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NodeDetailResponse' },
              },
            },
          },
          '404': {
            description: '节点不存在',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
            },
          },
          '500': {
            description: '服务内部错误',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
            },
          },
        },
      },
    },
  },
  components: { schemas: components },
};

// 整体过一遍 JSON 保证结构合法，并固定 key 顺序使 diff 稳定
const header = `# 由 packages/api-contract/scripts/gen-openapi.mjs 生成，请勿手改。
# 改契约请改 packages/api-contract/src/index.ts 的 Zod schema，然后 pnpm contract:gen。
`;
const body = stringify(sortKeys(openapi), { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE' });
const next = `${header}${body}`;

const previous = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
writeFileSync(outFile, next, 'utf8');

if (previous && previous !== next) {
  console.log('openapi.yaml 已更新');
} else {
  console.log('openapi.yaml 无变化');
}
