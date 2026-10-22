/**
 * 把 Zod schema 渲染成 openapi.yaml。
 *
 * 链条：Zod（内部真源）→ 本脚本 → openapi.yaml（对外契约）→ Orval 生成前端客户端。
 *
 * ## 本文件的边界
 *
 * 它**不认识任何具体的路由或 schema**。领域片段在 `scripts/paths/<domain>.mjs`
 * 里（每个导出 `{ paths, components }`），由 `collect-paths.mjs` 收集合并。
 * 本文件只做三件事：定文档骨架（info / servers）、合并、稳定序列化。
 *
 * 这样分是因为 20 张票由多条泳道并行实现，每条都要加自己的路由。硬编码在
 * 这个文件里意味着所有人改同一个文件；拆开后每条泳道只碰自己那一份。
 *
 * 两个踩过的坑，写下来免得后人重踩：
 * 1. `@asteasolutions/zod-to-openapi` 与 `zod-to-json-schema` 都是 Zod 3 时代的库。
 *    在 Zod 4.6 下前者类型不匹配、后者**静默返回空对象**（不报错）。
 *    Zod 4 自带 `toJSONSchema()`，直接用原生实现（见 `paths/_shared.mjs`）。
 * 2. YAML 序列化交给 `yaml` 包。手写序列化器输出 `-     url:` 这种错误缩进
 *    且自测能通过——YAML 缩进错误不报错，只在消费端炸。
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { loadFragments, mergeFragments } from './collect-paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outFile = join(root, 'openapi.yaml');

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

const fragments = await loadFragments();
const merged = mergeFragments(fragments);

const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'StarMap API',
    version: '1.0.0',
    description:
      '核电子学学习工作站。契约唯一真源：本文件由 packages/api-contract 的 Zod schema 生成，请勿手改。',
  },
  servers: [{ url: 'http://127.0.0.1:3001', description: '本地开发' }],
  paths: merged.paths,
  components: { schemas: merged.components },
};

const header = `# 由 packages/api-contract/scripts/gen-openapi.mjs 生成，请勿手改。
# 改契约请改 packages/api-contract/src/domains/<domain>.ts 的 Zod schema，
# 与 packages/api-contract/scripts/paths/<domain>.mjs 的 paths 片段，然后 pnpm contract:gen。
`;
const body = stringify(sortKeys(openapi), { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE' });
const next = `${header}${body}`;

const previous = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
writeFileSync(outFile, next, 'utf8');

const summary = fragments
  .filter((f) => Object.keys(f.paths).length > 0 || Object.keys(f.components).length > 0)
  .map((f) => f.domain)
  .join(', ');
console.log(
  `  片段：${fragments.length} 个（${summary || '无'}）；` +
    `path ${Object.keys(merged.paths).length} 条；component ${Object.keys(merged.components).length} 个`,
);

if (previous && previous !== next) {
  console.log('openapi.yaml 已更新');
} else {
  console.log('openapi.yaml 无变化');
}
