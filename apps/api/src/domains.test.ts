import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { domainControllers } from './domains.js';

/**
 * 控制器注册表的结构守卫。
 *
 * ## 为什么需要这条测试
 *
 * 三个控制器（`AttemptsController`、`MasteryController`、`GenerationController`）
 * 曾经写好、测过、单测全绿，但**从来没有出现在 `domainControllers` 里**。
 * 后果不是编译错误也不是测试失败，而是真实服务上那几个路由返回 404 ——
 * 而每个控制器自己的集成测试用 `Test.createTestingModule({imports:[AppModule]})`
 * 装配后直接打路由，`AppModule` 里注册了就会被 Nest 解析到，看上去一切正常。
 *
 * 这是"局部全绿、整体缺一块"的典型：路由的完整性不归任何一个文件自己的
 * 测试管。所以这条测试不去追某个具体路由，而是守一个更窄、更硬的事实 ——
 * **`src/` 下每一个 `*.controller.ts` 都必须在 `domainControllers` 里出现。**
 *
 * ## 为什么按文件扫而不是按导出名扫
 *
 * 按导出名扫要先 import 每个文件才知道它导出了哪个类，而"文件存在但类名不叫
 * 文件名"恰好是漏注册的另一个变体。按文件名扫只依赖命名约定（Nest 项目里
 * 这个约定是硬的），并且新增控制器时不需要改这条测试 —— 它自动覆盖新文件。
 */

const here = fileURLToPath(new URL('.', import.meta.url));

/** 递归收集 src/ 下所有非测试的 `*.controller.ts` */
function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      controllerFiles(full, out);
    } else if (entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `src/attempts/attempts.controller.ts` → `AttemptsController`
 * `src/agent/agent-turns.controller.ts` → `AgentTurnsController`
 *
 * kebab-case 也必须转：`agent-turns` 的类名是 `AgentTurnsController`，
 * 只把首字母大写会得到 `Agent-turnsController`，然后误报"漏注册"。
 */
function classNameOf(file: string): string {
  const base = file.slice(file.lastIndexOf(sep) + 1).replace(/\.controller\.ts$/, '');
  const pascal = base.replace(/(^|-)([a-z0-9])/g, (_, __, ch: string) => ch.toUpperCase());
  return `${pascal}Controller`;
}

describe('domainControllers 注册表', () => {
  const files = controllerFiles(here);
  const registered = new Set(domainControllers.map((c) => c.name));

  it('没有漏注册的控制器', () => {
    const missing = files
      .map((f) => ({ file: relative(here, f).replaceAll(sep, '/'), cls: classNameOf(f) }))
      // 类名以文件名为准；注册表里可能是别名导入，但 Nest 控制器类名就是文件名
      .filter(({ cls }) => !registered.has(cls))
      .map(({ file, cls }) => `${file} → ${cls}`)
      .sort();

    expect(
      missing,
      `这些控制器文件存在但没有注册到 domainControllers，它们的路由在真实服务上是 404：\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('注册表里没有指向不存在的文件的名字', () => {
    const declared = new Set(files.map(classNameOf));
    const ghosts = [...registered].filter((name) => !declared.has(name)).sort();
    expect(ghosts, `domainControllers 里有找不到对应文件的控制器：${ghosts.join(', ')}`).toEqual([]);
  });

  it('扫到的控制器数量是可信的（防这条测试自己静默失效）', () => {
    // 硬编码一个下限而不是精确值：控制器会继续增加，这条测试不该每年都要改。
    // 但如果目录扫描因为路径错误返回 0 个文件，上面两条会"全部通过"——那才是最坏的情况。
    expect(files.length).toBeGreaterThanOrEqual(11);
  });
});
