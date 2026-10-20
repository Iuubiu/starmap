/**
 * 领域 paths 片段的公共工具。
 *
 * 每个 `scripts/paths/<domain>.mjs` 都导出 `{ paths, components }`，本文件提供
 * 拼装响应体时反复出现的三件事，避免每个领域文件各写一遍（也避免它们的写法
 * 漂移成三种「看起来一样、实际差一个字段」的形状）。
 */
import { z } from 'zod';

/**
 * OpenAPI 3.1 接受 JSON Schema 2020-12；去掉 Zod 附带的 `$schema` 声明。
 *
 * 为什么用原生 `z.toJSONSchema()`：`@asteasolutions/zod-to-openapi` 与
 * `zod-to-json-schema` 都是 Zod 3 时代的库。在 Zod 4.6 下前者类型不匹配、
 * 后者**静默返回空对象**（不报错）。这个坑踩过，别再换回去。
 */
export const jsonSchema = (schema) => {
  const out = z.toJSONSchema(schema, { io: 'output' });
  delete out.$schema;
  return out;
};

/** `{ $ref: '#/components/schemas/Name' }` */
export const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

/** 一个 JSON 响应：`200: { description, content: { application/json: { schema } } }` */
export const jsonResponse = (description, schemaName) => ({
  description,
  content: { 'application/json': { schema: ref(schemaName) } },
});

/** 路径参数（`/nodes/{microKpId}` 这种） */
export const pathParam = (name) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
});
