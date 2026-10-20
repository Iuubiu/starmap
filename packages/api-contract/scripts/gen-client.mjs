/**
 * 契约唯一真源的生成链。
 *
 * Zod（packages/api-contract/src/index.ts）→ openapi.yaml → Orval → apps/web/src/api/generated。
 *
 * 为什么 Orval 而不是手写 fetch 封装：
 * 手写封装会把「后端改字段」变成「前端运行时才发现」，而 OpenAPI 是 spec 里
 * 写死的唯一真源（OmniDev §1）。Orval 直接在 CI 里失败，比运行时白屏好。
 *
 * 生成物入库，script 可重复执行且结果稳定 —— 否则 `contract:check` 里
 * `git diff --exit-code` 会天天误报。
 *
 * 为什么第一步是 build 而不是直接生成：
 * 下游三段（emit-openapi / paths/*.mjs / gen-openapi）全都在 import `dist/index.js`，
 * 而 dist 在 .gitignore 里（.gitignore:2 `dist/`）—— 干净检出时它根本不存在，
 * 生成链会以 `Cannot find module .../dist/index.js` 崩掉；更糟的是「改了 src 忘了
 * build」时它不崩，而是拿旧 dist 生成出一份「和 src 不一致但检查通过」的契约。
 * 那种成功比失败更难发现。所以先构建，让 dist 恒等于 src。
 *
 * 根 package.json 的 contract:gen 也会先 build 一次（因为 emit-openapi 走的是
 * apps/api 的 tsconfig，发生在进入本文件之前）。两处重复是刻意的：本文件要能
 * 被单独执行（`pnpm --filter @starmap/api-contract gen`）也成立。空 dist 时
 * 全量构建 0.88s，增量近乎 0，这份保险很便宜。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const contractRoot = join(here, '..');
const openapiPath = join(contractRoot, 'openapi.yaml');

console.log('→ 生成 OpenAPI 契约与前端客户端…');

// 先构建，保证下游读到的 dist 就是当前 src（tsc 7 原生编译器，空 dist 全量 0.88s）。
execFileSync('node', [join(contractRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(contractRoot, 'tsconfig.json')], {
  stdio: 'inherit',
  cwd: contractRoot,
});

execFileSync('node', [join(contractRoot, 'scripts', 'gen-openapi.mjs')], {
  stdio: 'inherit',
  cwd: contractRoot,
});

execFileSync(
  'node',
  [join(contractRoot, 'node_modules', 'orval', 'dist', 'bin', 'orval.mjs'), '--config', join(contractRoot, 'orval.config.mjs')],
  { stdio: 'inherit', cwd: contractRoot },
);

console.log('✓ 契约生成完成');
