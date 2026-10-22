#!/usr/bin/env node
/**
 * SKILL.md 文件清单漂移探针。
 *
 * 用法：
 *   node skills/web-design-engineer/references/inventory-check.mjs
 *
 * 为什么要有这个文件
 * ------------------
 * SKILL.md §7 写死了「27 个 makeStyles 文件 = 基础组件层 13 + 页面层 14」。
 * 这个数字一旦漂移，文档就会安静地变成谎话：新加一个页面时没人会回头改 SKILL.md，
 * 下一个人按 §7 的清单改样式，就会漏掉那个新页面，而评审也发现不了
 * （清单看起来「都对」）。
 *
 * 所以把「文件系统里的事实」与「文档里的清单」逐条对照：任何一侧多出或缺少
 * 一个文件，就以非零码退出，并打印出差异。零依赖，只用 node 内置能力。
 *
 * 它**不**检查样式本身好不好看，也不检查 token 值 —— 那些是
 * `contrast-check.mjs` 与人工评审的事。
 */

import fs from 'node:fs';
import path from 'node:path';

const SKILL = 'skills/web-design-engineer/SKILL.md';
const WEB_SRC = 'apps/web/src';

/** 递归收集非测试的 .ts/.tsx（跳过生成物目录）。 */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const toPosix = (p) => p.split(path.sep).join('/');

if (!fs.existsSync(SKILL)) {
  console.error(`找不到 ${SKILL}（请在仓库根运行本脚本）`);
  process.exitCode = 1;
} else {
  const skill = fs.readFileSync(SKILL, 'utf8');

  /** 实测：用 makeStyles 的非测试文件。 */
  const actual = walk(WEB_SRC)
    .filter((f) => fs.readFileSync(f, 'utf8').includes('makeStyles'))
    .map(toPosix)
    .sort();

  /** 文档：SKILL.md 里被反引号包起来的 `apps/web/src/**.tsx` 路径。 */
  const documented = new Set(
    [...skill.matchAll(/`(apps\/web\/src\/[^`]+\.(?:tsx|ts|css))`/g)].map((m) => m[1]),
  );

  const notDocumented = actual.filter((f) => !documented.has(f));

  // 反向：文档里写了的 .tsx 必须真的存在（防止改名后留下幽灵条目）。
  // 例外是 §7.1 主题层 —— 那一节的文件是 t58 **待新建**的，本来就不该存在。
  const ghosts = [...documented]
    .filter((p) => p.endsWith('.tsx') && !p.includes('/theme/') && !fs.existsSync(p))
    .sort();

  const claimed = skill.match(/<!--\s*inventory:\s*(\d+)\s*-->/);
  const claimedCount = claimed ? Number(claimed[1]) : null;

  console.log(`实测 makeStyles 文件：${actual.length}`);
  console.log(`文档声称：${claimedCount ?? '（未写 <!-- inventory: N -->）'}`);

  let failures = 0;

  if (claimedCount === null) {
    failures += 1;
    console.error('FAIL SKILL.md §7 缺少 <!-- inventory: N --> 计数行');
  } else if (claimedCount !== actual.length) {
    failures += 1;
    console.error(`FAIL 文档写的是 ${claimedCount} 个，实测 ${actual.length} 个 —— 改 SKILL.md §7 的清单与数字`);
  }

  if (notDocumented.length > 0) {
    failures += 1;
    console.error('FAIL 这些文件用了 makeStyles 但没进 SKILL.md §7 的清单：');
    for (const f of notDocumented) console.error(`       ${f}`);
  }

  if (ghosts.length > 0) {
    failures += 1;
    console.error('FAIL 这些文件在 SKILL.md 里被引用但磁盘上不存在：');
    for (const f of ghosts) console.error(`       ${f}`);
  }

  if (failures === 0) console.log('ok   SKILL.md §7 的清单与磁盘一致');
  console.log(`\nTOTAL FAILURES: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}
