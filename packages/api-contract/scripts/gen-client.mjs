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
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const contractRoot = join(here, '..');
const openapiPath = join(contractRoot, 'openapi.yaml');

console.log('→ 生成 OpenAPI 契约与前端客户端…');
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
