/**
 * 契约漂移检查：重新生成一次，比对产物是否与仓库里的一致。
 *
 * 为什么不用 `git diff --exit-code`：仓库里这两种文件可能还是 untracked
 * （新克隆、或第一次生成后还没提交），此时 `git diff` 对 untracked 文件
 * **静默返回空**，检查通过但什么都没验。用内容哈希比对不依赖 git 状态。
 *
 * 失败信息要说清「改了什么」和「该怎么办」，而不是只报一个 exit code。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const watchPaths = [
  'packages/api-contract/openapi.yaml',
  'apps/web/src/api/generated',
];

/** 收集需要比对的全部文件的哈希 */
function snapshot() {
  const files = new Map();

  const walk = (abs) => {
    if (!existsSync(abs)) return;
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const entry of readdirSync(abs)) walk(join(abs, entry));
      return;
    }
    files.set(relative(root, abs).replaceAll('\\', '/'), createHash('sha256').update(readFileSync(abs)).digest('hex'));
  };

  for (const p of watchPaths) walk(join(root, p));
  return files;
}

const before = snapshot();

execFileSync('pnpm', ['contract:gen'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const after = snapshot();

const added = [...after.keys()].filter((k) => !before.has(k));
const removed = [...before.keys()].filter((k) => !after.has(k));
const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k));

if (added.length || removed.length || changed.length) {
  console.error('\n✗ 契约产物与提交内容不一致：');
  for (const f of changed) console.error(`  修改  ${f}`);
  for (const f of added) console.error(`  新增  ${f}`);
  for (const f of removed) console.error(`  删除  ${f}`);
  console.error('\n请提交重新生成的产物（pnpm contract:gen 已跑过，工作区现在是最新的）。');
  console.error('如果这是有意的契约变更，还要确认它是非破坏性的（@redocly/cli 的 breaking-change 规则）。');
  process.exit(1);
}

console.log(`✓ 契约产物已同步（${after.size} 个文件）`);
