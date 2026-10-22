/**
 * 场景 S2 / S5 / S9：关卡卡产出、追问表单、会话恢复。
 *
 * 这三个阶段是 captain 明确划给我的范围（`t19` 已覆盖 S0/S1/S3/S4/S6/S7/S8）。
 * 全部**不 mock 任何接口**：每轮真的打 `/api/v1/agent/turns`，真的走模型。
 *
 * 这一组用例同时是缺陷的证据：写它们时发现的三条缺陷（D-01 冷启动无入口选
 * 知识点、D-02 关卡卡没有「进入关卡」按钮、D-03 确认轮/退出后作答区不收起）
 * 都已修，所以现在的断言是**修好之后应该成立的行为**。
 */
import { expect, test, type Page } from '@playwright/test';
import { api, attachDiagnostics, pageText, shot } from './_helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

/** 提交一句话并等这一轮的响应体回来。 */
async function submitTurn(page: Page, text: string) {
  const box = page.getByLabel('这一轮想说的话');
  await box.fill(text);
  const submit = page.getByRole('button', { name: '提交这一轮' });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/v1/agent/turns') && r.request().method() === 'POST',
    { timeout: 240_000 },
  );
  await submit.click();
  const res = await response;
  expect(res.status(), `POST /agent/turns 应 < 400，实际 ${res.status()}`).toBeLessThan(400);
  const body = (await res.json()) as {
    turnId: string;
    visibleResponseKind: string;
    degraded?: boolean;
    artifact?: { kind: string; microKpId?: string; levelId?: string; probeId?: string };
  };
  await page.waitForTimeout(1200);
  return body;
}

/**
 * 上游模型偶发不可用时会返回降级卡（`degraded: true`）。那不是本场景要验的
 * 产品行为，照学生的做法点「再试一次」，最多 3 次；仍不可用才把降级轮交给
 * 调用处的断言报出来（信息里带 `degraded`，能区分运维问题与产品缺陷）。
 */
async function submitUntilNotDegraded(page: Page, text: string, maxTries = 3) {
  let body = await submitTurn(page, text);
  for (let i = 1; i < maxTries && body.degraded; i += 1) {
    const retry = page.getByRole('button', { name: '再试一次' });
    if (await retry.count()) {
      const response = page.waitForResponse(
        (r) => r.url().includes('/api/v1/agent/turns') && r.request().method() === 'POST',
        { timeout: 240_000 },
      );
      await retry.click();
      const res = await response;
      body = (await res.json()) as typeof body;
      await page.waitForTimeout(1200);
    } else {
      body = await submitTurn(page, text);
    }
  }
  return body;
}

test('场景 S2：从知识点详情进首页要一张关卡 → 卡上有入口且能进关卡页', async ({ page }) => {
  const d = attachDiagnostics(page);

  // 走真实路径的第一段：地图 → 知识点详情 → 「问助手」
  await page.goto('/map/kp-bool');
  await expect(page.getByRole('heading', { name: '布尔代数基本运算' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '问助手' }).click();
  await page.waitForURL(/\/\?kp=kp-bool/, { timeout: 20_000 });

  // 焦点必须是刚选的那个点，而不是「未选定」
  const focused = await pageText(page);
  expect(focused, '首页应显示刚选定的知识点').toContain('布尔代数基本运算');

  const turn = await submitUntilNotDegraded(page, '给我一张关卡，我想做题。');
  expect(turn.artifact?.kind, `应产出关卡卡，实际 ${turn.artifact?.kind}`).toBe('level_card');

  // 卡片上的四个数字 + 一个入口
  const card = await pageText(page);
  expect(card).toContain('预计用时');
  expect(card).toContain('题目数');
  const enter = page.getByRole('button', { name: '进入关卡' });
  await expect(enter, '关卡卡必须给「进入关卡」入口').toBeVisible();

  await shot(page, 's2-level-card');

  // 点进去必须是这一张关卡，不是市场页或空白
  await enter.click();
  await page.waitForURL(/\/level\/lv-/, { timeout: 20_000 });
  /**
   * 等关卡真的渲染完再量文本。
   *
   * 之前这里只等 URL 就立刻读 innerText，实测拿到 58 字符（只有顶栏 + 标题），
   * 于是「关卡页没有可读文本」这条断言会误报 —— 关卡正文（段标题、题干、选项）
   * 是异步取 `/api/v1/levels/:id` 之后才挂上去的。
   *
   * 不用 `getByText('知识点', {exact:true})` 等：那一行的实际文本是
   * 「知识点 kp-bool · 共 7 段 · 这一档直接从第 3 段开始」，一个元素里混了多个
   * 事实，精确匹配永远等不到。改用「轮询整页文本长度」，它对任何关卡都成立。
   */
  let levelText = '';
  for (let i = 0; i < 40 && levelText.length <= 80; i += 1) {
    await page.waitForTimeout(500);
    levelText = await pageText(page);
  }
  expect(levelText.length, `关卡页没有可读文本（等到 ${levelText.length} 字符）`).toBeGreaterThan(80);
  expect(levelText).toContain('知识点');

  await shot(page, 's2-level-page');
  expect(d.pageErrors, `未捕获异常：${d.pageErrors.join(' | ')}`).toHaveLength(0);
  expect(d.badResponses, `接口 4xx/5xx：${d.badResponses.join(' | ')}`).toHaveLength(0);
});

test('场景 S5：追问表单能连续作答，退出后不再留可打字的空框', async ({ page }) => {
  const d = attachDiagnostics(page);
  /**
   * 为什么用 `kp-chenboxian-2011-8-3`（正比计数器）而不是 `kp-bool`：
   *
   * 服务端 `turn.service.ts:768` 写的是「模型说要 level_card、且有可打开的关卡，
   * 就给关卡卡；**关卡事实不足时退化成 probe_form**」。而 `kp-bool` 有关卡，
   * 于是模型只要判成 level_card 就永远拿不到追问表单 —— 实测四句不同的
   * 「先别给答案，问我一个问题」全部返回 level_card。
   *
   * 这一条是**产品缺陷**（S5 在有关卡的知识点上不可达），已记进 REPORT.md；
   * 场景本身要验证的是「追问表单能用」，所以挑一个「有切片、还没有关卡」的
   * 叶节点，让服务端走到它自己写明的退路上。这不是绕开缺陷，是把缺陷和
   * 场景分开：场景证明表单可用，缺陷条目证明它在另一条路径上进不去。
   */
  const S5_KP = 'kp-chenboxian-2011-8-3';
  await page.goto(`/?kp=${S5_KP}`);
  await page.waitForTimeout(2500);

  /**
   * 产出哪种卡片由模型决定（服务端按掌握度/意图挑），同一句话不保证每次都
   * 给追问表单。用几句都在要「先提问」的说法重试，最多 4 轮；4 轮都不给
   * 追问表单才算失败（那就是真的进不去这个阶段了）。
   */
  const askForProbe = [
    '先别给答案，问我一个问题。',
    '别讲，先考考我：出一道题让我自己答。',
    '我想先自己试一下，你问我一个问题。',
    '先问我，不要直接讲。',
  ];
  let turn = await submitUntilNotDegraded(page, askForProbe[0]);
  for (let i = 1; i < askForProbe.length && turn.artifact?.kind !== 'probe_form'; i += 1) {
    turn = await submitUntilNotDegraded(page, askForProbe[i]);
  }
  expect(turn.artifact?.kind, `应产出追问表单，实际 ${turn.artifact?.kind}`).toBe('probe_form');

  // 追问面板：有输入框（或选项）与一颗专属的提交按钮
  const trailRounds: string[] = [];
  let exited = false;
  for (let i = 0; i < 5; i += 1) {
    const box = page.getByLabel('追问作答');
    const radios = page.getByRole('radio');
    if (await box.count()) await box.fill('不知道。');
    else if (await radios.count()) await radios.first().check();
    else break;

    const submit = page.getByRole('button', { name: '提交这一问的回答' });
    if (!(await submit.count()) || (await submit.isDisabled())) break;

    const response = page.waitForResponse(
      (r) => r.url().includes('/api/v1/agent/probes') && r.request().method() === 'POST',
      { timeout: 180_000 },
    );
    await submit.click();
    const res = await response;
    expect(res.status(), '追问作答应 < 400').toBeLessThan(400);
    const body = (await res.json()) as { action: string; ladder: { exited: boolean } };
    await page.waitForTimeout(600);

    // 每一轮都要留下账目：第 N 轮可数
    const trail = page.getByLabel('追问记录');
    if (await trail.count()) {
      trailRounds.push((await trail.innerText()).replace(/\s+/g, ' '));
    }

    if (body.ladder.exited) {
      exited = true;
      break;
    }
  }

  expect(exited, '连续答不上 5 轮内必须退出追问（阶梯有上限）').toBe(true);
  await expect(page.getByText('追问已结束')).toBeVisible();

  // D-03：退出之后不能再留一个「能打字、按不动」的输入框
  expect(await page.getByLabel('追问作答').count(), '退出后不应再有作答框').toBe(0);
  expect(
    await page.getByRole('button', { name: '提交这一问的回答' }).count(),
    '退出后不应再有追问提交按钮',
  ).toBe(0);

  // 退出前答过的轮次仍然在账目里（学生能回看自己写过什么）
  expect(trailRounds.length, '追问过程应留下记录').toBeGreaterThan(0);
  expect(trailRounds[trailRounds.length - 1]).toContain('不知道');

  await shot(page, 's5-probe-exit');
  expect(d.pageErrors, `未捕获异常：${d.pageErrors.join(' | ')}`).toHaveLength(0);
  expect(d.badResponses, `接口 4xx/5xx：${d.badResponses.join(' | ')}`).toHaveLength(0);
});

test('场景 S9：刷新页面后会话与学习日志都还在；开新会话才清空', async ({ page }) => {
  const d = attachDiagnostics(page);
  await page.goto('/?kp=kp-bool');
  await page.waitForTimeout(2500);

  const first = await submitUntilNotDegraded(page, '给我一张关卡，我想做题。');
  expect(first.turnId).toBeTruthy();

  const sessionBefore = await page.evaluate(() => localStorage.getItem('starmap.session'));
  expect(sessionBefore, '会话 id 应落 localStorage').toBeTruthy();

  const beforeReload = await pageText(page);
  expect(beforeReload).toContain('学习日志');

  // 刷新：同一个会话 id、同一份日志都要回来
  await page.reload();
  await page.waitForTimeout(3000);
  const sessionAfter = await page.evaluate(() => localStorage.getItem('starmap.session'));
  expect(sessionAfter, '刷新后会话 id 不应变化').toBe(sessionBefore);

  // 学习日志按会话取，刷新后条数不能归零
  const logBody = await api<{ items?: unknown[] }>(
    `/api/v1/agent/turns?sessionId=${encodeURIComponent(sessionAfter ?? '')}`,
  );
  const logCount = Array.isArray(logBody?.items) ? logBody.items.length : -1;
  expect(logCount, '同一会话刷新后学习日志不应为空').toBeGreaterThan(0);

  const afterReload = await pageText(page);
  expect(afterReload.length, '刷新后页面不应是空白').toBeGreaterThan(80);
  expect(afterReload).toContain('学习日志');

  await shot(page, 's9-after-reload');

  // 「开新会话」换 id，日志清空
  await page.getByRole('button', { name: '开新会话' }).click();
  await page.waitForTimeout(2500);
  const sessionNew = await page.evaluate(() => localStorage.getItem('starmap.session'));
  expect(sessionNew, '开新会话应换一个 id').not.toBe(sessionBefore);

  const emptyHint = await pageText(page);
  expect(emptyHint).toContain('共 0 轮记录');

  await shot(page, 's9-new-session');
  expect(d.pageErrors, `未捕获异常：${d.pageErrors.join(' | ')}`).toHaveLength(0);
  expect(d.badResponses, `接口 4xx/5xx：${d.badResponses.join(' | ')}`).toHaveLength(0);
});
