import { test, expect, chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 演示主线：**三种学习者学同一个知识点**（票 t64 的核心交付）。
 *
 * ## 这个 spec 要证明什么
 *
 * 用户当场否掉了原来的演示主线，原话是「软件的核心功能没有展示，就是三类人群的
 * 学习，这个必须要有」。所以这里的判据不是「三档都能跑通」，而是：
 *
 *   **同一句开场话术 + 同一个知识点，三档拿到的第一屏肉眼可见地不一样，
 *     而且不一样的地方正好是六维参数里那几维。**
 *
 * ## 为什么只能串行、且必须从外部切档
 *
 * 档位存在 `app.placement_profile` 里，全站共享**一行**。三个标签页同时开，
 * 读到的都是同一档 —— 三段画面会完全一样（第一次跑就是这么失败的：两次都读到
 * P1，六维全部相同）。所以必须用 `.scratch/demo-set-tier.mjs` 逐档切换、
 * 每档单独开 context，且切档不能手改数据库（脚本一次事务改 tier / status /
 * attempts_baseline 三列，少改一列都会被「够 5 题就重判」立刻改回去）。
 *
 * ## 两组证据，缺一不可
 *
 * - **首屏产物卡**：能看见「难度档 P1/P2/P3」与「按 P? 档，一次最多推进 N 个新知识点」。
 * - **进入关卡后的第一屏**：首轮形态只在这里看得见 ——
 *     P1 整段讲解全摊开（`讲解全展开`，DOM 里没有 `<details>`）
 *     P2 最后一张卡只给标题待补全（`讲解留最后一步给你补`，1 个 `<details>` 且默认关着）
 *     P3 跳过纯讲解段直接出题（`讲解默认收起，需要时展开`，停在「第 3 段 · 简单问题」）
 *
 * 这两组是「肉眼可见」的唯一可靠判据：六维参数本身只在 `/api/v1/tier` 里，
 * 观众看不见；而卡片文案是自然语言，可能被模型改写 —— 所以档位标签与
 * 首轮形态（两者都是前端按 `TIER_PARAMS` 确定性渲染的）才是硬证据。
 */
const KP = 'kp-bool';
const LEVEL = 'lv-bool-laws';
/** 三档共用同一句开场话术 —— 换成不同的话，差异就不再是「档位造成的」了。 */
const UTTERANCE = '我想学布尔代数的基本运算';
const TIERS = ['P1', 'P2', 'P3'] as const;

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = path.join(ROOT, '.scratch', 'demo');

interface TierRow {
  tier: string;
  firstRoundShape: string;
  ladder: { start: number; cap: number };
  feedbackTiming: string;
  attemptsPerItem: number;
  /** 嵌套成对象是为了让 tiers.json 的字段名与 `/api/v1/tier` 的返回逐字一致。 */
  masteryRule: { consecutiveCorrect: number };
  sessionNewKpLimit: number;
  /** 界面上看得见的：首屏产物卡 */
  ui: { tierBadge: string; sessionLimitText: string; cardHeadline: string };
  /** 界面上看得见的：进关卡第一屏 */
  level: {
    planShape: string;
    startStepIndex: number;
    cardMode: string;
    tierBadgeText: string;
    modeHintText: string;
    detailsCount: number;
    detailsOpen: number;
    firstStepTitle: string;
    screenshot: string;
  };
  screenshot: string;
}

test('三档学习：同一句话、同一个知识点，第一屏两两不同', async () => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const rows: TierRow[] = [];

  for (const tier of TIERS) {
    // 档位是全站共享的一行数据，只能从外部切（见文件头）。
    execFileSync('node', ['.scratch/demo-set-tier.mjs', tier], { cwd: ROOT, stdio: 'inherit' });

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
    const page = await ctx.newPage();

    // 六维参数一律从接口取真值，不从界面文案反推 —— 文案是给观众看的，
    // 参数是给断言用的，两者混淆过一次就会写出「看起来对但没断言」的测试。
    const tierRes = await page.request.get('http://127.0.0.1:3001/api/v1/tier');
    expect(tierRes.status(), 'GET /api/v1/tier 失败 —— 演示前自检里要先跑这一条').toBe(200);
    const p = (await tierRes.json()).params as {
      tier: string;
      firstRoundShape: string;
      ladder: { start: number; cap: number };
      feedbackTiming: string;
      attemptsPerItem: number;
      sessionNewKpLimit: number;
      masteryRule: { consecutiveCorrect: number };
    };
    expect(p.tier, `切档没生效：请求的是 ${tier}，接口回的是 ${p.tier}`).toBe(tier);

    // ---------- 证据 A：首屏产物卡 ----------
    await page.goto(`/?kp=${KP}`);
    await page.getByPlaceholder(/说说你想学什么/).fill(UTTERANCE);
    await page.getByRole('button', { name: '提交这一轮' }).click();

    // 等产物卡真的落地。不能盯 /关卡/ 这种到处都有的词 —— 右侧「还没有关卡」
    // 徽章会在「正在生成这一轮的卡片…」期间就匹配上，于是截到一张空屏。
    //
    // 上游模型偶发 45s 超时会回一张「模型暂时不可用」错误卡。那不是档位差异，
    // 也不该让这个演示 spec 变红 —— 但也不能把红的说成绿的：这里只允许
    // **重发同一句话**（点界面上那个「再试一次」），最多 3 次；3 次都拿不到
    // 产物卡仍然判红，因为那时演示本身也跑不下去了。
    //
    // 判据用 `main` 里的 heading，而不是 `getByText('模型暂时不可用')`：错误卡
    // 在左侧学习日志里还有一条同名的历史条目按钮，直接 getByText 会命中 2 个元素
    // 而抛 strict mode violation（第二版就是这么红的）。
    //
    // 重发方式用「重新填一次输入框 + 点提交」，而不是点错误卡上的「再试一次」：
    // 那个按钮点下去会立刻被「正在生成」的骨架替换掉，Playwright 的 click 在
    // 「元素已稳定 → 派发前一刻被卸载」时会一直重试直到超时（第三版就是这么红的）。
    // 输入框始终在，重填同一句话与「再试一次」在语义上完全等价。
    const failedCard = page.locator('main').getByRole('heading', { name: '模型暂时不可用' });
    const cardBadge = page.getByText(/难度档\s*P[123]/);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(page.getByText(/正在生成这一轮的卡片/)).toBeHidden({ timeout: 120_000 });
      // 卡片落地或错误卡落地，两者必居其一；等到其中任一出现再判断。
      await expect(failedCard.or(cardBadge).first()).toBeVisible({ timeout: 120_000 });
      if (!(await failedCard.isVisible())) break;
      console.log(`[demo] ${tier} 第 ${attempt + 1} 次提交遇到上游不可用，重发同一句话`);
      await page.getByPlaceholder(/说说你想学什么/).fill(UTTERANCE);
      await page.getByRole('button', { name: '提交这一轮' }).click();
    }
    await expect(cardBadge).toBeVisible({ timeout: 120_000 });

    const main = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    const tierBadge = (main.match(/难度档\s*(P[123])/) ?? [])[0] ?? '';
    const sessionLimitText = (main.match(/按\s*P[123]\s*档，一次最多推进\s*\d+\s*个新知识点。/) ?? [])[0] ?? '';
    expect(tierBadge, '首屏没有「难度档 P?」标签 —— 这是观众第一眼要看到的东西').not.toBe('');
    expect(sessionLimitText, '首屏没有「一次最多推进 N 个新知识点」文案').not.toBe('');

    const cardShot = path.join(OUT, `tier-${tier}-card.png`);
    await page.screenshot({ path: cardShot, fullPage: false });

    // ---------- 证据 B：进入关卡后的第一屏 ----------
    const lp = await ctx.newPage();
    await lp.goto(`/level/${LEVEL}`);
    await lp.waitForTimeout(1500);
    const lRes = await lp.request.get(`http://127.0.0.1:3001/api/v1/tier/levels/${LEVEL}/plan`);
    expect(lRes.status(), 'GET /tier/levels/:id/plan 失败').toBe(200);
    const firstRound = (await lRes.json()).firstRound as {
      shape: string;
      startStepIndex: number;
      cardMode: string;
    };

    const lmain = (await lp.locator('main').innerText()).replace(/\s+/g, ' ');
    const tierBadgeText = (lmain.match(/按\s*P[123]\s*档渲染/) ?? [])[0] ?? '';
    // 三种提示文案之一，正好对应三种首轮形态
    const modeHintText =
      (lmain.match(/讲解全展开|讲解留最后一步给你补|讲解默认收起，需要时展开/) ?? [])[0] ?? '';
    const detailsCount = await lp.locator('details').count();
    const detailsOpen = await lp.locator('details[open]').count();
    const firstStepTitle = (lmain.match(/第\s*\d+\s*段\s*·\s*[^\s]+/) ?? [])[0] ?? '';

    expect(tierBadgeText, '关卡页没写「按 P? 档渲染」').not.toBe('');
    expect(modeHintText, '关卡页没有出现三种呈现方式提示中的任何一种').not.toBe('');

    const levelShot = path.join(OUT, `tier-${tier}-level.png`);
    await lp.screenshot({ path: levelShot, fullPage: false });

    rows.push({
      tier: p.tier,
      firstRoundShape: p.firstRoundShape,
      ladder: p.ladder,
      feedbackTiming: p.feedbackTiming,
      attemptsPerItem: p.attemptsPerItem,
      masteryRule: { consecutiveCorrect: p.masteryRule.consecutiveCorrect },
      sessionNewKpLimit: p.sessionNewKpLimit,
      ui: { tierBadge, sessionLimitText, cardHeadline: main.slice(0, 220) },
      level: {
        planShape: firstRound.shape,
        startStepIndex: firstRound.startStepIndex,
        cardMode: firstRound.cardMode,
        tierBadgeText,
        modeHintText,
        detailsCount,
        detailsOpen,
        firstStepTitle,
        screenshot: path.relative(ROOT, levelShot).replace(/\\/g, '/'),
      },
      screenshot: path.relative(ROOT, cardShot).replace(/\\/g, '/'),
    });

    await ctx.close();
    console.log(
      `[demo] ${tier} shape=${p.firstRoundShape} ladder=${p.ladder.start}-${p.ladder.cap} ` +
        `newKp=${p.sessionNewKpLimit} 关卡首屏=${modeHintText} 起始=${firstStepTitle}`,
    );
  }

  await browser.close();

  // 落盘：三段的全部六维 + 两组界面证据 + 截图路径
  writeFileSync(path.join(OUT, 'tiers.json'), JSON.stringify(rows, null, 2) + '\n', 'utf8');

  // ---------- 硬断言一：六维里至少 4 维两两不同 ----------
  // 「两两比较」是 captain 明确要求的：只比 P1 vs P3 会掩盖 P1/P2 在
  // attemptsPerItem 与 consecutiveCorrect 上恰好相同这件事。
  const DIMS = [
    'firstRoundShape',
    'ladder',
    'sessionNewKpLimit',
    'feedbackTiming',
    'attemptsPerItem',
    'masteryRule',
  ] as const;
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i] as unknown as Record<string, unknown>;
      const b = rows[j] as unknown as Record<string, unknown>;
      const differing = DIMS.filter((d) => JSON.stringify(a[d]) !== JSON.stringify(b[d]));
      expect(
        differing.length,
        `${rows[i].tier} vs ${rows[j].tier} 只有 ${differing.length} 维不同（${differing.join(',')}），少于 4 维`,
      ).toBeGreaterThanOrEqual(4);
    }
  }

  // ---------- 硬断言二：第一轮形态三档两两不同 ----------
  const shapes = rows.map((r) => r.firstRoundShape);
  expect(new Set(shapes).size, `首轮形态不是三种：${shapes.join('/')}`).toBe(3);

  // ---------- 硬断言三：界面上至少三处可见差异 ----------
  const badges = rows.map((r) => r.ui.tierBadge);
  const limits = rows.map((r) => r.ui.sessionLimitText);
  const hints = rows.map((r) => r.level.modeHintText);
  expect(new Set(badges).size, `难度档标签不是三种：${badges.join('/')}`).toBe(3);
  expect(new Set(limits).size, `新知识点上限文案不是三种：${limits.join('/')}`).toBe(3);
  expect(new Set(hints).size, `关卡首屏提示不是三种：${hints.join('/')}`).toBe(3);

  // 首轮形态在界面上确实生效（不是只改了接口数字）
  const p1 = rows.find((r) => r.tier === 'P1')!;
  const p2 = rows.find((r) => r.tier === 'P2')!;
  const p3 = rows.find((r) => r.tier === 'P3')!;
  expect(p1.level.modeHintText, 'P1 应该是整段讲解全摊开').toContain('讲解全展开');
  expect(p1.level.detailsCount, 'P1 不该有折叠的讲解').toBe(0);
  expect(p2.level.modeHintText, 'P2 应该是最后一张卡待补全').toContain('讲解留最后一步给你补');
  expect(p2.level.detailsCount, 'P2 应该有恰好一张折叠的卡').toBe(1);
  expect(p2.level.detailsOpen, 'P2 的折叠卡必须默认关着（留最后一步给学习者）').toBe(0);
  expect(p3.level.modeHintText, 'P3 应该是讲解默认收起').toContain('讲解默认收起');
  expect(p3.level.startStepIndex, 'P3 应该跳过纯讲解段').toBeGreaterThan(0);
  expect(p3.level.firstStepTitle, 'P3 应该直接停在出题的那一段').toContain('简单问题');

  console.log('[demo] tiers.json 已落盘：' + path.join(OUT, 'tiers.json'));
});
