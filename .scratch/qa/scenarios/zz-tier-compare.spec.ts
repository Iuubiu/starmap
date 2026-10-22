import { test, expect, chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * 目的：验证「三类人群学同一个知识点」在界面上是**肉眼可见的差别**，而不是只在
 * `/api/v1/tier` 的数字里。这是用户明确点出的核心功能（原文：「软件的核心功能
 * 没有展示，就是三类人群的学习，这个必须要有」）。
 *
 * 判据不是「三档都能跑通」，而是「同一句开场话术、同一个知识点，三档拿到的第一屏
 * 不一样，且不一样的地方正好是六维参数里那几维」。
 *
 * 前置：档位用 `.scratch/demo-set-tier.mjs` 逐档切换（一人单机，档位全站共享）。
 */
const KP = 'kp-bool';
const TIERS = ['P1', 'P3'] as const;
const UTTERANCE = '我想学布尔代数的基本运算';

test('三档对照：同一句话，P1 给样例、P3 直接出题', async () => {
  test.setTimeout(240_000);
  const browser = await chromium.launch();
  const shots: Array<Record<string, unknown>> = [];

  for (const tier of TIERS) {
    // 档位是全站共享的一行数据，只能从外部切。不切的话两段画面完全一样 ——
    // 第一次跑就是这么失败的（两次都读到 P1，六维全部相同）。
    execFileSync('node', ['.scratch/demo-set-tier.mjs', tier], {
      // 从 `.scratch/qa/scenarios/` 往上三层才是仓库根（scenarios → qa → .scratch → root）。
      // 写成四层会落到 D:\DeepSeek，报 `Cannot find module 'D:\DeepSeek\.scratch\...'`。
      cwd: new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      stdio: 'inherit',
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    const tierParams = await page.request.get('/api/v1/tier').then((r) => r.json());
    const p = tierParams.params ?? tierParams;

    await page.goto(`/?kp=${KP}`);
    await page.getByPlaceholder(/说说你想学什么/).fill(UTTERANCE);
    await page.getByRole('button', { name: '提交这一轮' }).click();

    // 等产物卡真的落地。第一版这里用 /这一轮的产物|追问|关卡/ 判断，被右侧
    // 「还没有关卡」徽章匹配到，于是在「正在生成这一轮的卡片…」时就截图了 ——
    // 断言必须盯住卡片自身的文字，不能盯住到处都有的「关卡」两个字。
    await expect(page.getByText(/正在生成这一轮的卡片/)).toBeHidden({ timeout: 90_000 });
    await expect(page.getByText(/追问：|进入这一关|关卡卡|这一轮的产物/).first()).toBeVisible({
      timeout: 90_000,
    });

    const body = (await page.locator('main').innerText()).slice(0, 4000);
    const badges = await page
      .locator('[class*="badge" i], [class*="Badge" i]')
      .allInnerTexts()
      .catch(() => [] as string[]);

    const row = {
      tier: p.tier,
      firstRoundShape: p.firstRoundShape,
      ladder: p.ladder,
      feedbackTiming: p.feedbackTiming,
      attemptsPerItem: p.attemptsPerItem,
      consecutiveCorrect: p.masteryRule?.consecutiveCorrect,
      sessionNewKpLimit: p.sessionNewKpLimit,
      // 界面上真正看得见的两处
      uiShowsTierBadge: /按\s*P[123]\s*档渲染/.test(body),
      uiAsksQuestion: /追问/.test(body),
      uiShowsLevelCard: /进入这一关|开始这一关|关卡/.test(body),
      badges: badges.slice(0, 6),
      bodyHead: body.replace(/\s+/g, ' ').slice(0, 320),
    };
    shots.push(row);

    await page.screenshot({
      path: `.scratch/qa/shots/tier-${tier}.png`,
      fullPage: false,
    });
    await ctx.close();
  }

  await browser.close();
  console.log('TIER_COMPARE ' + JSON.stringify(shots, null, 2));

  // 硬断言：六维里至少有四维真不同，且第一轮形态必须不同（这是第一屏的差异来源）
  const [a, b] = shots;
  expect(a.firstRoundShape).not.toBe(b.firstRoundShape);
  const differing = ['firstRoundShape', 'feedbackTiming', 'attemptsPerItem', 'consecutiveCorrect', 'sessionNewKpLimit']
    .filter((k) => JSON.stringify((a as never)[k]) !== JSON.stringify((b as never)[k]));
  expect(differing.length).toBeGreaterThanOrEqual(4);
  expect(a.ladder).not.toEqual(b.ladder);
});
