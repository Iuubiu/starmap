/**
 * 校验契约与 openapi.yaml 是否一致。
 *
 * 这里不生成 openapi.yaml —— 生成在 packages/api-contract/scripts/gen-openapi.mjs。
 * 本脚本守三件事：
 *   ① 契约包与 @starmap/shared 里每个 `*Schema` 都能渲染成 JSON Schema；
 *   ② openapi.yaml 声明的每个组件都真的有对应的 schema（改名漏同步会在这里断）；
 *   ③ 没被声明为组件的 schema，必须能在 openapi.yaml 里找到它的内联形态 ——
 *      否则就是一个「写了但没人引用」的死 schema。
 *
 * ── 为什么不再维护一张手写的 schema 表 ──────────────────────────
 * 早先这里是 `const schemas = { HealthResponse: …, … }`，注释说「必须与
 * gen-openapi.mjs 的 components 一致」。并行开发下这张表必然腐烂：它只有 6 行，
 * 而 openapi.yaml 已经有 30 个组件 —— 也就是说 24 个组件从来没被这个检查覆盖过，
 * 而且每条泳道都被要求往这里加一行（一处共享文件的写入点，四个泳道排队）。
 *
 * ── 为什么不搞一份「允许不声明」的豁免清单 ────────────────────────
 * 试过：把 16 个内联使用的辅助 schema 列进白名单。问题是白名单只记录「谁被豁免」，
 * 不记录「为什么」；下次有人新增一个**根本没人引用**的 schema 时，往清单里加一行
 * 就能让它通过，而这恰恰是这份检查最该抓的东西。
 *
 * 所以改成结构性判据：未被声明为组件的 schema，把它渲染出来的 JSON 规范化后，
 * 必须在 openapi.yaml 全文里找得到（说明某个组件或 path 内联展开了它）。
 * 「内联使用」这件事实本身成为证据，不需要人来担保。
 */
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as contract from '@starmap/api-contract';
import * as shared from '@starmap/shared';

const here = dirname(fileURLToPath(import.meta.url));
const openapiPath = join(here, '..', '..', '..', 'packages', 'api-contract', 'openapi.yaml');

/** 递归按键名排序，使两段等价 JSON 的可序列化形式一致。 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

function render(schema) {
  const json = z.toJSONSchema(schema, { io: 'output' });
  delete json.$schema;
  return json;
}

/**
 * 契约包里有、但**有意**不声明为组件、也不内联进 openapi.yaml 的 schema。
 *
 * 必须是「名字 + 理由」而不是一个纯 Set：纯 Set 只记录谁被豁免，不记录为什么，
 * 下次有人新增一个根本没人引用的 schema 时，往里加一行就能过 —— 而这恰恰是
 * 这份检查最该抓的东西。写理由这一步本身就是在问「它真的该存在吗」。
 */
const ACCOUNTED_ELSEWHERE = [
  {
    name: 'AgentArtifactKindSchema',
    reason:
      'AgentArtifactSchema 是 discriminatedUnion，kind 的字面量已经写在四个分支里，' +
      '这个枚举只作为公开类型 AgentArtifactKind 导出，没有参与任何响应体。' +
      '待 agent-dev 确认是保留公开类型还是从契约包删掉。',
  },
];

/**
 * 需要「被交代」的 schema 只来自契约包。
 *
 * 为什么不算 @starmap/shared：那是领域库，里面的 `ChunkSchema` / `MicroKpSchema` /
 * `RetrievalRequestSchema` 等描述的是**领域内部形状**，不一定过网络 —— 要求它们
 * 出现在 openapi.yaml 里是错的约束（第一次写这版就因此误报了 8 条）。
 * 但 shared 又必须参与查找，因为 `LevelSpecSchema` 确实撑起了一个组件
 * （levels 片段直接从 shared 引用它）。所以分工是：
 *   - 契约包 → 必须被交代（声明为组件、或内联出现、或有理由地豁免）；
 *   - shared  → 只作为组件的来源被查找，不强制出现。
 */
function collectContractSchemas() {
  return Object.entries(contract)
    .filter(([name, value]) => name.endsWith('Schema') && value && typeof value === 'object')
    .sort(([a], [b]) => a.localeCompare(b));
}

/** 组件可能来自 shared，这里单独收集，只用于「反查 schema 是否存在」。 */
function collectSharedSchemas() {
  return Object.entries(shared).filter(
    ([name, value]) => name.endsWith('Schema') && value && typeof value === 'object',
  );
}

/** 组件名约定：component 名 = schema 名去掉结尾的 `Schema`。 */
function componentNameFor(schemaName) {
  return schemaName.replace(/Schema$/, '');
}

const doc = parseYaml(readFileSync(openapiPath, 'utf8'));
const declared = new Set(Object.keys(doc?.components?.schemas ?? {}));
const docCanonical = JSON.stringify(canonical(doc));

const exemptions = new Map(ACCOUNTED_ELSEWHERE.map((e) => [e.name, e.reason]));

const entries = collectContractSchemas();
const sharedEntries = collectSharedSchemas();
const rendered = new Map();
const failures = [];
for (const [name, schema] of entries) {
  try {
    const json = render(schema);
    if (!json || Object.keys(json).length === 0) {
      failures.push({ name, reason: '渲染为空 schema（Zod 3 时代的库在 Zod 4 下会静默返回 {}）' });
    } else {
      rendered.set(name, json);
    }
  } catch (err) {
    failures.push({ name, reason: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * openapi.yaml 里每个组件都能被某个 schema 生成出来。
 *
 * 先看契约包，找不到再退到 shared —— `LevelSpec` 就是后者：它的真源是
 * packages/shared/src/domain/level.ts（校验器必须在纯函数环境里跑），
 * 契约包只引用它。所以「openapi.yaml 有、契约包没有」不等于错了。
 */
const renderedComponents = new Set([...rendered.keys()].map(componentNameFor));
const sharedComponents = new Set(sharedEntries.map(([name]) => componentNameFor(name)));
const missingInContract = [...declared]
  .filter((c) => !renderedComponents.has(c) && !sharedComponents.has(c))
  .sort();

// ② 契约 schema 既没声明为组件、又没在 openapi.yaml 里内联出现、也没写理由 → 写了但没人用。
const unaccounted = [];
for (const [name, json] of rendered) {
  if (declared.has(componentNameFor(name))) continue;
  if (exemptions.has(name)) continue;
  const needle = JSON.stringify(canonical(json));
  if (docCanonical.includes(needle)) continue;
  unaccounted.push(name);
}
unaccounted.sort();

// ③ 豁免清单自身的护栏：理由写太短、或豁免了根本不存在的 schema，都要报出来。
const staleExemptions = ACCOUNTED_ELSEWHERE.filter(
  (e) => !rendered.has(e.name) || e.reason.trim().length < 20,
).map((e) => e.name);

console.log(`契约 schema：${entries.length} 个（渲染成功 ${rendered.size} 个）`);
console.log(`openapi.yaml 组件：${declared.size} 个（其中来自 shared：${sharedComponents.size} 个可用）`);

let failed = false;

for (const { name, reason } of failures) {
  failed = true;
  console.error(`✗ ${name}：${reason}`);
}

for (const name of missingInContract) {
  failed = true;
  console.error(`✗ openapi.yaml 声明了组件 ${name}，但契约包与 shared 里都没有对应的 schema`);
}

for (const name of unaccounted) {
  failed = true;
  console.error(`✗ ${name} 既没声明为组件，也没在 openapi.yaml 里被内联使用（死 schema）`);
}

for (const name of staleExemptions) {
  failed = true;
  console.error(`✗ 豁免清单里的 ${name} 已失效（schema 不存在）或理由太短（<20 字）`);
}

if (failed) {
  console.error('');
  console.error('修复方向：契约改了就跑 `pnpm contract:gen`；');
  console.error('片段忘了引用组件就补上引用；schema 确实废弃了就删掉它。');
  process.exit(1);
}

console.log(
  `✓ 契约 schema 与 openapi.yaml 一致（${declared.size} 个组件全部有来源，${exemptions.size} 个已交代豁免）`,
);
