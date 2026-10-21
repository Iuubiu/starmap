import { test, expect, type Page } from '@playwright/test';

/**
 * 五档掌握状态的中文词表（前端唯一真源：`apps/web/src/mastery/labels.ts`）。
 *
 * 抽成常量而不是每处各写一份正则，是因为漏掉一个状态时的症状是「某种状态下
 * 页面上所有卡片都匹配不到」—— 看起来像界面坏了，实际只是正则少了一个词。
 * 这几条正则历史上就漏过 `刚接触`（attempted），而它确实是五个状态之一。
 *
 * **不要**在这里加英文枚举值：`unseen` 之类出现在页面上是缺陷（词表漏翻），
 * 不是可接受的替代写法。
 */
const STATE_LABEL = /未学习|刚接触|已熟悉|已熟练|已掌握/;

/**
 * 「这一页要等后端才能渲染完」的等待上限。
 *
 * 为什么要单独给：`/map` 要等后端返回全图（现在 1789 个叶节点 / 466 KB），
 * 再把它们交给 sigma 建 WebGL 画布。本机没有 GPU，Chromium 走 SwiftShader
 * 软件渲染，实测从 `goto` 到清单第一项可见是 **6–11 秒**（三次采样：
 * 9049 / 9888 / 6057 ms）—— 而 Playwright 的 expect 默认超时是 5 秒。
 * 节点详情页同理：点进去后还要再取一次节点详情 + 掌握度，然后才渲染标题。
 *
 * 于是这几条用例会随机地在「刚好赶上」与「差一秒」之间摇摆，报的却是
 * 「元素找不到」/ 停在 loading 骨架，看起来像界面坏了。默认超时不该为了
 * 这几个重页面调大（那会让真正找不到元素的用例白白卡 20 秒才失败），所以
 * 只给「等后端渲染完」的断言显式声明。graph.spec.ts 对它找画布的断言也是这么做的。
 */
const SLOW_PAGE_TIMEOUT = 20_000;

/**
 * 知识地图左侧清单里的节点按钮。
 *
 * **必须限定在清单里，不能直接在整页上按状态正则找 button。**
 * 实测踩到的坑：`page.getByRole('button', { name: /已掌握|未学习/ }).first()`
 * 命中的第一个是**状态图例的筛选按钮**（`graph-legend-item`，可访问名形如
 * 「已掌握 0/0」），不是清单项。它确实可见、名字里也确实有那个词，所以
 * `toBeVisible()` 通过，但点它是「按状态过滤」，不是「打开这个知识点」——
 * 于是「点进详情」这条测试永远停在 `/map`，报的却是「URL 不对」。
 *
 * 清单本身有 `aria-label`（「当前视野内的微知识点」），是稳定的语义锚点：
 * 改 CSS 类名、改图例文案都不会影响它。
 */
function rosterButtons(page: Page, name?: RegExp) {
  const list = page.getByRole('list', { name: '当前视野内的微知识点' });
  return name ? list.getByRole('button', { name }) : list.getByRole('button');
}

/**
 * 数据库页左侧「知识点」卡片里的全部按钮。
 *
 * 为什么不按名字过滤：下面的布局测试原来写的是
 * `page.locator('button').filter({ hasText: '数字' })`，那其实是在暗中断言
 * 「库里恰好有一个名字带『数字』的知识点」。票 18 把知识点从 218 扩到 2420
 * 之后，首屏 200 个按钮里再没有「数字」系的名字，两条纯布局测试一起红了 ——
 * **红的是数据，不是布局**。布局缺陷和知识点叫什么名字无关，所以只按结构取。
 *
 * 为什么是 `role="group"`：Fluent `Card` 自带这个语义角色；再用卡片标题
 * 「知识点」精确定位，避免命中页面上别的 Card（页面上还有来源、统计等卡片）。
 */
function nodeButtons(page: Page) {
  return page
    .getByRole('group')
    .filter({ has: page.getByText('知识点', { exact: true }) })
    .getByRole('button');
}

/**
 * 票 01 的最小闭环：页面能打开、能看到后端真实数据、能点进详情。
 *
 * 断言对象是**数据本身**（知识点名字、百分比），不是「页面上有某个 class」。
 * class 名会被重构改掉，数据不会。
 *
 * 但断言也不能钉死某条具体数据 —— 实测教训：票 02 导入 215 个真实知识点后，
 * 看板上一屏放不下，`布尔代数基本运算`（票 01 的种子数据）被顶出首屏，
 * 四个用它的测试全红。改成断言「有卡片、卡片带中文名、点得进去」。
 */
test('知识地图显示后端真实知识点', async ({ page }) => {
  // 这条测试断言的是「知识点列表」，而知识点浏览已经移到 `/map`：
  // 票 13 把 `/board` 改成「今天该干什么」（今日推荐 + 今日摘要 + 常用指令），
  // 全节点浏览留在知识地图（那里已有状态着色、邻域展开、键盘清单）。
  // 别再把它改回 `/board` —— 看板上不会再有节点网格。
  await page.goto('/map');
  await expect(page.getByRole('heading', { level: 1, name: '知识地图' })).toBeVisible();

  // 知识点按钮的可访问名形如「布尔代数基本运算，未学习，证据不足」
  const cards = rosterButtons(page, STATE_LABEL);
  await expect(cards.first()).toBeVisible({ timeout: SLOW_PAGE_TIMEOUT });
  await expect(cards.first()).toHaveAccessibleName(/[\u4e00-\u9fff]/);
});

test('顶栏显示数据库时间（证明后端连上了真库）', async ({ page }) => {
  await page.goto('/');
  // 顶栏是个壳，挂在哪个路由下都会渲染 —— 用 `/`（智能体主页）验证这一点。
  await expect(page.getByText(/数据库 \d{2}:\d{2}:\d{2}/)).toBeVisible();
});

test('从知识地图点进知识点详情', async ({ page }) => {
  await page.goto('/map');
  const first = rosterButtons(page, STATE_LABEL).first();
  await expect(first).toBeVisible({ timeout: SLOW_PAGE_TIMEOUT });
  const name = (await first.getAttribute('aria-label')) ?? '';
  const nodeName = name.split('，')[0]!;

  await first.click();
  await expect(page).toHaveURL(/\/map\/.+/);
  // 详情页必须显示同一知识点的名字 —— 点进去看到的不该是别的东西
  // （页面此刻可能还停在「加载知识点…」骨架，见 SLOW_PAGE_TIMEOUT）
  await expect(page.getByRole('heading', { name: nodeName })).toBeVisible({
    timeout: SLOW_PAGE_TIMEOUT,
  });
});

test('证据不足的知识点显示「证据不足」而不是 0%', async ({ page }) => {
  await page.goto('/map');
  const unseen = rosterButtons(page, /未学习/).first();
  await expect(unseen).toBeVisible({ timeout: SLOW_PAGE_TIMEOUT });
  await unseen.click();
  await expect(page.getByText('证据不足').first()).toBeVisible();
  // 关键：不能把「没有证据」显示成 0%
  await expect(page.getByText(/^0%$/)).toHaveCount(0);
});

test('知识地图页列出叶节点，状态用中文而不是英文枚举值', async ({ page }) => {
  await page.goto('/map');
  await expect(rosterButtons(page, STATE_LABEL).first()).toBeVisible({
    timeout: SLOW_PAGE_TIMEOUT,
  });

  // 这条断言原来写的是 `getByText('已熟悉')`。它钉死的不是界面行为，而是
  // 「库里恰好有一个 familiar 节点」—— 那唯一的 familiar 来自 seed.sql 手写的
  // 一行掌握度快照，而它声称的 10 次作答在 `app.attempts` 里一条都没有（伪造的
  // 证据，已随迁移 0005 与 seed 一并删除）。数据一变断言就红，说明它测的是数据
  // 不是界面。
  //
  // 换成不依赖具体数据、只依赖渲染规则的断言：页面上不该出现英文枚举原值。
  // 词表漏翻时它才会出现，那才是真缺陷。
  await expect(page.getByText(/^(unseen|attempted|familiar|proficient|mastered)$/)).toHaveCount(0);
});

test('六个页面路由都能打开，占位页说明「将来干什么」而不是「建设中」', async ({ page }) => {
  await page.goto('/database');
  await expect(page.getByRole('heading', { name: '数据库' })).toBeVisible();
  // 票 02 之后数据库页是真的有数据了，不再是占位页
  await expect(page.getByText('来源追溯', { exact: true })).toBeVisible();

  await page.goto('/skills');
  await expect(page.getByRole('heading', { name: '技能库' })).toBeVisible();
});

/**
 * 关卡页要能真的打开，且是**真关卡**。
 *
 * 这里用 `lv-bool-laws`（迁移 0010 提供）而不是 `lv-bool-1`（早期 seed 插入的
 * 演示关卡）。后者没有 spec，靠 `levels.spec` 的 `DEFAULT '{}'` 蒙混入库，
 * 点开就是 500「关卡规范不合法」—— 已由迁移 0004 删除，且那个 DEFAULT 也被
 * 一并撤掉了。断言换成迁移提供的关卡，任何库都有，不依赖有没有跑过 seed。
 *
 * 用一级标题断言而不是 `getByRole('heading')`：这个页面此前**没有 h1**
 * （`<Text>` 默认渲染成 span），屏幕阅读器的标题导航在这里断掉。断言 h1
 * 同时钉住了无障碍缺陷与关卡真名。
 */
test('关卡页打开真实教学关卡，一级标题是关卡名', async ({ page, request }) => {
  /**
   * 首屏落在第几段**取决于当前档位**（票 12）：P1/P2 从第 1 段的讲解开始，
   * P3「直接出题」从第一段带题的段开始。
   *
   * 这条用例原来写死 `第 1 段`，在开发库被定到 P3 之后立刻红了 —— 而那是
   * **正确行为**，不是回归。所以这里先问一次后端「这一档从第几段开始」，
   * 再断言页面与之一致。写死一个数字等于假设全世界的档位都一样。
   */
  const plan = await request.get('/api/v1/tier/levels/lv-bool-laws/plan');
  expect(plan.status()).toBe(200);
  const { firstRound } = (await plan.json()) as { firstRound: { startStepIndex: number } };

  await page.goto('/level/lv-bool-laws');
  await expect(
    page.getByRole('heading', { level: 1, name: '逻辑代数基本律：吸收律与德摩根律' }),
  ).toBeVisible();
  // 播放器真的渲染出了首轮段，而不是空壳页面。
  //
  // 正则带 ` · ` 后缀：进度条上每个 chip 也写着「第 N 段」，只匹配「第 N 段」
  // 会同时命中 chip 与小节标题，Playwright 的 strict mode 直接判失败 ——
  // 报错看起来像「元素找不到」，实际是「找到两个」。`第 N 段 · <段名>` 才是
  // 小节标题独有的形状。
  await expect(
    page.getByText(new RegExp(`第 ${firstRound.startStepIndex + 1} 段 · `)),
  ).toBeVisible();
});

/**
 * 「关卡不存在」与「关卡存在但数据坏了」必须是两种不同的结果。
 *
 * 500 曾经是「这行在库里，但它的 spec 是坏的」的唯一信号；把它和 404 混成
 * 一种，下一个写坏 spec 的人就不会知道自己写坏了。这条守的是这个区分本身：
 * 一个从没存在过的 id 必须 404，不能因为「读不出来」就报 500。
 */
test('不存在的关卡返回 404，不是 500', async ({ request }) => {
  const res = await request.get('/api/v1/levels/nope-does-not-exist');
  expect(res.status()).toBe(404);
  expect((await res.json()).code).toBe('NOT_FOUND');
});


test('顶栏导航能切换到数据库页', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '数据库' }).click();
  await expect(page).toHaveURL(/\/database/);
});

/**
 * 布局缺陷只能在这里抓 —— jsdom 没有真实布局，测不到元素重叠。
 *
 * 实测踩过的缺陷：Fluent `Button` 默认是固定高度（medium = 32px），知识点名
 * 一长就换行，文字溢出按钮外，与下一个按钮的字叠在一起。截图里肉眼可见，
 * 单元测试全绿。
 */
test('知识点按钮不重叠：每个按钮的矩形都不与邻按钮相交', async ({ page }) => {
  await page.goto('/database');
  const buttons = nodeButtons(page);
  await expect(buttons.first()).toBeVisible();

  const boxes = await buttons.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, text: el.textContent ?? '' };
    }),
  );
  expect(boxes.length).toBeGreaterThan(1);

  // 按 top 排序后，任意相邻两个按钮的矩形不得相交
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    expect(
      cur.top,
      `按钮「${prev.text}」下缘 ${prev.bottom} 越过了「${cur.text}」上缘 ${cur.top}`,
    ).toBeGreaterThanOrEqual(prev.bottom - 0.5);
  }
});

test('知识点按钮的文字没有溢出自己的盒子', async ({ page }) => {
  await page.goto('/database');
  const buttons = nodeButtons(page);
  await expect(buttons.first()).toBeVisible();

  const overflow = await buttons.evaluateAll((els) =>
    els
      .map((el) => ({
        text: el.textContent ?? '',
        buttonHeight: el.getBoundingClientRect().height,
        contentHeight: el.scrollHeight,
      }))
      .filter((x) => x.contentHeight > x.buttonHeight + 1),
  );
  expect(overflow).toEqual([]);
});

/**
 * 技能库页：**磁盘上的真 skill + 真的写操作能不能走通**。
 *
 * 为什么必须放在 e2e 里：这一页的单测（`src/pages/SkillsPage.test.tsx` 13 条）
 * 全部由 MSW 在 fetch 层拦截，证明的是「页面按契约渲染」。它们**结构上**看不见
 * 两件事：
 *
 * 1. 页面里的 skill 是不是真的来自磁盘上的 `SKILL.md`（桩里想要几个有几个）；
 * 2. 开关的 PATCH 请求体能不能穿过 Vite 代理 + Express body-parser 到达后端。
 *
 * 第 2 条不是假设 —— 它真的坏过。`customFetch` 用对象字面量把小写的
 * `content-type` 和 Orval 自带的大写 `Content-Type` 合并成两个键，`fetch`
 * 归一化后值变成 `application/json, application/json`，body-parser 认不出这是
 * JSON，**静默跳过解析**，`req.body` 是 undefined → 400 `expected object,
 * received undefined`。单测全绿、真链路必坏。已由 `src/api/fetcher.test.ts`
 * 的逐字头断言 + 下面这条 e2e 共同守住。
 *
 * 这条用例会写真实开发库的 `app.skill_switches`，所以结尾必须恢复现场 ——
 * 留在半关状态会让后续用例与人的手动检查都看到假象。
 */
test('技能库：开关能写进真实后端，禁用后预览里真的没有它了', async ({ page, request }) => {
  const skill = 'socratic-tutor';
  const restore = () =>
    request.patch(`http://127.0.0.1:3001/api/v1/agent/skills/${skill}`, {
      data: { enabled: true },
    });

  await restore();
  try {
    await page.goto('/skills');
    await expect(page.getByRole('heading', { level: 1, name: '技能库' })).toBeVisible();

    // ① 两个 skill 来自磁盘，触发场景来自 frontmatter（不是页面里硬编码的）。
    //    断言必须限定在**行内**：右侧详情区的「触发场景」字段显示的是同一份
    //    文本，全局查会得到两个元素（strict mode 直接报错），而且即使不报错，
    //    命中的可能是详情区 —— 那证明不了「列表里也有」。
    const socratic = page.getByRole('button', { name: /^socratic-tutor，/ });
    await expect(socratic).toBeVisible();
    await expect(page.getByRole('button', { name: /^question-author，/ })).toBeVisible();
    await expect(socratic.getByText('学习者说「不会」「做不出来」「卡住了」')).toBeVisible();

    // ② 预览里出现 skill 正文，说明它此刻真的被装进了 system message
    const preview = page.getByRole('region', { name: 'system message 原文' });
    await expect(preview.getByText(/五级求助阶梯/)).toBeVisible();

    // ③ 点开关 → PATCH 真的到达后端并生效（这一步是上面那个 400 的回归守卫）
    await page.getByRole('switch', { name: `${skill} 启用开关` }).click();

    // 断言限定在预览区里：左侧详情区仍显示这份正文，那是「它写了什么」，
    // 与「此刻装没装进去」是两件事。
    await expect(preview.getByText(/五级求助阶梯/)).toHaveCount(0);
    await expect(preview).not.toContainText(skill);
    await expect(page.getByText(/已排除 \d+ 个：.*socratic-tutor/)).toBeVisible();

    // ④ 开关状态真的落库了：绕过页面直接问后端，返回的是禁用
    const persisted = await request.get(`http://127.0.0.1:3001/api/v1/agent/skills/${skill}`);
    expect(persisted.status()).toBe(200);
    expect((await persisted.json()).skill.enabled).toBe(false);
  } finally {
    await restore();
  }
});

/**
 * 票 12：档位参数真的驱动了关卡页的首屏。
 *
 * 单测（`LevelPageTier.test.tsx`）用 mock hook 证明「参数 → 界面」，后端测试
 * 证明「engine → 参数」。这条补上最后一环：**真后端 + 真浏览器**里，页面拿到
 * 的档位与它渲染的段号一致。三件事任何一件断了，这条都会红。
 *
 * 它同时是那个真缺陷的回归守卫：`key` 一度挂在只读 props 的 `LevelPlayer` 上，
 * 而 `flow` 的 `useState` 在父层 —— 换 key 只换渲染树、换不掉 state，于是
 * P3 学习者永远看到第 1 段。单测能抓（那正是它被发现的地方），但只有真链路
 * 能证明「线上也修好了」。
 */
test('关卡页按当前档位渲染：首屏段号与 /tier/levels/{id}/plan 一致', async ({ page, request }) => {
  const res = await request.get('/api/v1/tier/levels/lv-bool-laws/plan');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    tier: string;
    firstRound: { startStepIndex: number; cardMode: 'all' | 'faded' | 'none' };
    params: { attemptsPerItem: number };
  };

  await page.goto('/level/lv-bool-laws');
  // ` · ` 后缀限定在小节标题上（进度条 chip 是「第 N 段」的另一种形状）。
  await expect(page.getByText(/^第 \d+ 段 · /)).toBeVisible();

  // ① 段号：页面显示的段号 = 服务端算出的首轮起始段（+1，界面从 1 数）。
  await expect(
    page.getByText(new RegExp(`^第 ${body.firstRound.startStepIndex + 1} 段 · `)),
  ).toBeVisible();

  // ② 档位徽章：页面上写着「按 Pn 档渲染」，且与服务端一致。
  await expect(page.getByText(`按 ${body.tier} 档渲染`)).toBeVisible();

  // ③ 参数摘要：尝试次数反映在摘要行里（P3 = 1 次，P1/P2 = 2 次）。
  const attempts =
    body.params.attemptsPerItem > 1
      ? `每题最多 ${body.params.attemptsPerItem} 次`
      : '每题只有 1 次机会';
  await expect(page.getByText(attempts)).toBeVisible();

  /**
   * ④ 卡片呈现方式与 `cardMode` 一致。
   *
   * 这里断言的是**摘要行**而不是「页面上有没有折叠的卡」：P3 的首轮段是
   * `probe`（`cardIds: []`），首屏根本一张卡都没有 —— 折叠入口不存在是
   * 对的，不是缺陷。写「非 all 档必须看到折叠入口」会在这条真实关卡上
   * 永远红，而且红得很有道理。
   *
   * 摘要行由 `tierSummaryLines()` 从 `cardMode` 拼出来，是这一维在首屏上
   * 永远可观察的那一面；卡片本身的行为由 `LevelPageTier.test.tsx` 的
   * 「P2 折叠 / P1 不折叠」两条在受控 spec 上守（那里首轮段有卡）。
   */
  const CARD_MODE_LINE: Record<string, string> = {
    all: '讲解全展开',
    faded: '讲解留最后一步给你补',
    none: '讲解默认收起，需要时展开',
  };
  await expect(page.getByText(CARD_MODE_LINE[body.firstRound.cardMode]!)).toBeVisible();
});
