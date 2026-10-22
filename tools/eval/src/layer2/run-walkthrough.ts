/**
 * 第二层的最小可跑路径：打开看板 → 点知识点卡 → 进详情 → 记录 locator_failure。
 *
 * 这是票 20 验收里「persona 配置能被 driver 加载并驱动至少一条最小可跑路径」
 * 的那条路径。它刻意短：一条能跑通的路径比五条跑一半的路径有用 ——
 * 前者能进 CI，后者只能进报告。
 *
 * 动作由 ScriptedActor 给出（确定性，无模型）。target_hint 故意写成**人话**
 * 而不是选择器，且刻意包含一个不存在的目标，用来证明 locator_failure 真的
 * 会被记录，而不是被悄悄吞掉。
 *
 * 用法（需要一个在跑的前端）：
 *   pnpm --filter @starmap/web dev        # 另一个终端
 *   node ./src/layer2/run-walkthrough.ts
 * 环境变量：EVAL_WEB_URL（默认 http://localhost:5173）
 */

import { chromium } from '@playwright/test';
import { EvalDriver, ScriptedActor } from './driver.ts';
import { summarizeWalkthrough, type WalkthroughResult } from './result.ts';

const DEFAULT_WEB_URL = 'http://localhost:5173';

/**
 * 脚本化的最小旅程。
 *
 * 每一步的 target_hint 都是**学习者会说的话**，不是选择器：
 * "最上面那个看板标签""那个核电子学的知识点卡片"。
 * 最后一步故意指一个不存在的东西 —— 它必须产出 locator_failure。
 */
const MINIMAL_SCRIPT: string[] = [
  JSON.stringify({ action: 'click', target_hint: '顶部导航里写着「看板」的那个标签', text: '', note: '先看看首页' }),
  JSON.stringify({ action: 'click', target_hint: '第一张知识点卡片', text: '', note: '随便点一个看看' }),
  JSON.stringify({ action: 'click', target_hint: '这个页面上根本不存在的「学习进度导出」按钮', text: '', note: '找不到导出' }),
];

export async function runWalkthrough(webUrl: string = process.env.EVAL_WEB_URL ?? DEFAULT_WEB_URL): Promise<WalkthroughResult> {
  const browser = await chromium.launch();
  const driver = await EvalDriver.create(browser, { baseUrl: webUrl });
  const actor = new ScriptedActor('scripted-minimal', MINIMAL_SCRIPT);
  const startedAt = new Date().toISOString();
  const started = performance.now();

  try {
    await driver.goto('/');
    const stages: Array<{ stage: string; url: string; heading: string | null }> = [];

    for (let turn = 1; turn <= MINIMAL_SCRIPT.length; turn += 1) {
      const screen = await driver.screenText();
      const raw = await actor.next({ screen, turn, stage: 'S0-S1' });
      const record = await driver.step({ turn, stage: 'S0-S1', raw });
      driver.record(record);

      const heading = await driver.page
        .locator('h1, h2, [role="heading"]')
        .first()
        .textContent({ timeout: 2000 })
        .catch(() => null);
      stages.push({
        stage: `turn-${turn}`,
        url: driver.page.url().replace(webUrl, ''),
        heading: heading?.trim() ?? null,
      });
    }

    const screenTexts = driver.accessibilitySnapshot();
    return {
      actor: actor.name,
      webUrl,
      startedAt,
      durationMs: Math.round(performance.now() - started),
      steps: driver.steps,
      friction: driver.friction(),
      consoleErrors: driver.consoleErrors,
      screenSnapshots: screenTexts.length,
      urls: stages,
    };
  } finally {
    await driver.close();
    await browser.close();
  }
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/layer2/run-walkthrough.ts') ?? false;
if (isMain) {
  runWalkthrough()
    .then((result) => {
      console.log(summarizeWalkthrough(result));
      const failed = result.friction.locatorFailure === 0;
      /* 反直觉但重要：这条脚本里**必须**出现 locator_failure。
         一个都没出现说明解析器太宽松（把不存在的东西蒙对了），
         或失败被吞了 —— 两种都是工具坏了，不是界面好。 */
      if (failed) {
        console.error('\n✗ 自检失败：脚本里故意写的不存在目标没有产生 locator_failure，说明失败被吞掉了。');
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(`第二层执行失败：${(error as Error).message}`);
      process.exit(2);
    });
}
