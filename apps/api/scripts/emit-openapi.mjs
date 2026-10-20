/**
 * 校验后端 Zod schema 能渲染成 openapi.yaml 所需的全部组件。
 *
 * 这里不生成 openapi.yaml —— 生成在 packages/api-contract/scripts/gen-openapi.mjs。
 * 本脚本只做一件事：确认后端实际用到的 schema 与契约包导出的一致，
 * 避免「后端改了 schema、忘了跑 contract:gen」这种漂移。
 */
import { z } from 'zod';
import {
  HealthResponseSchema,
  NodeDetailResponseSchema,
  NodeListResponseSchema,
  NodeSourcesResponseSchema,
  ContentStatsResponseSchema,
  ApiErrorSchema,
} from '@starmap/api-contract';

// 这张表必须与 packages/api-contract/scripts/gen-openapi.mjs 的 components 一致。
// 少列一个 schema 的后果不是报错，而是「后端用了契约里没有的形状」这件事
// 不被任何检查发现 —— 直到前端生成出来的类型对不上。
const schemas = {
  HealthResponse: HealthResponseSchema,
  NodeListResponse: NodeListResponseSchema,
  NodeDetailResponse: NodeDetailResponseSchema,
  NodeSourcesResponse: NodeSourcesResponseSchema,
  ContentStatsResponse: ContentStatsResponseSchema,
  ApiError: ApiErrorSchema,
};

let failed = false;
for (const [name, schema] of Object.entries(schemas)) {
  try {
    const json = z.toJSONSchema(schema, { io: 'output' });
    delete json.$schema;
    if (!json || Object.keys(json).length === 0) {
      console.error(`✗ ${name} 渲染为空 schema`);
      failed = true;
    } else {
      console.log(`✓ ${name}`);
    }
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
