import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 闸门：`qaHarness.{html,tsx}` 是**测试夹具**，不许被任何应用代码引用。
 *
 * ## 为什么这条测试存在
 *
 * 夹具要 import 真实的动效模块，所以它必须躺在 `src/` 里（放 `.scratch/` 走
 * `/@fs/` 绝对路径，换一台机器或换一个 checkout 目录就断）。躺进 `src/` 的
 * 代价是：**将来任何人 import 它一下，它就会被打进产物**，而产物里多一个
 * 挂 `window.__mountMotionHarness` 的模块，是那种没人会去看的污染。
 *
 * 当初「确认 vite build 产物里没有它」是**一次性人工核对**——我今天核了，
 * 明天有人加一行 import 就失效了，而且不会有任何东西变红。人工核对不是保证，
 * 这条测试才是。
 *
 * ## 为什么扫源码字符串而不是解析 import 图
 *
 * 要防的只有一种事故：有人在应用代码里写了 `qaHarness` 这个词。字符串扫描
 * 足以覆盖它（import 路径、动态 import、注释掉的引用都算），而解析 import 图
 * 需要引入 TypeScript 编译器 API 或新依赖——为一个两行就能覆盖的风险引入
 * 依赖，不划算。
 *
 * 反过来，字符串扫描会误报「提到 qaHarness 的注释」。这是可接受的方向：
 * 误报的表现是一条测试变红、要人多看一眼；漏报的表现是夹具进了产物、没人发现。
 */
const SRC = resolve(process.cwd(), 'src');

/** 允许引用夹具的文件：夹具自己（互相引用），以及测试文件。 */
function isAllowedReferrer(relPath: string): boolean {
  const normalized = relPath.split(sep).join('/');
  if (normalized === 'motion/qaHarness.html' || normalized === 'motion/qaHarness.tsx') return true;
  if (/\.test\.tsx?$/.test(normalized)) return true;
  // Playwright 的 e2e 用例也允许（它们同样只在测试进程里跑）。
  if (normalized.startsWith('e2e/') && /\.spec\.tsx?$/.test(normalized)) return true;
  return false;
}

/** 递归列出 `src/` 下所有源码文件（相对 `src/` 的 POSIX 路径）。 */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx|html|css)$/.test(entry.name)) continue;
    out.push(relative(SRC, full).split(sep).join('/'));
  }
  return out;
}

describe('qaHarness 不许进产物', () => {
  it('src/ 内除夹具自身与测试文件外，没有文件提到 qaHarness', () => {
    const offenders: string[] = [];

    for (const relPath of listSourceFiles(SRC)) {
      if (isAllowedReferrer(relPath)) continue;
      const text = readFileSync(join(SRC, relPath), 'utf8');
      if (text.includes('qaHarness')) offenders.push(relPath);
    }

    expect(offenders).toEqual([]);
  });

  it('夹具页不是 rollup 入口（vite 配置里没有它）', () => {
    // 入口清单是 `build.rollupOptions.input`；一旦有人把夹具页加进去，它就会
    // 变成产物的第二个 HTML 入口——那比被 import 更隐蔽，因为源码里看不出。
    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(config).not.toContain('qaHarness');
  });
});
