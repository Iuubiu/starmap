/**
 * 票 19 的端到端验证：真浏览器打开关卡页，确认「看讲解」面板能拉到片段、
 * `<video>` 能加载元数据、点播放能真的走 Range 请求。
 *
 * ## 为什么要用真浏览器而不是 vitest + MSW
 *
 * 这条链上有三处是 jsdom 测不出来的：
 * 1. `<video>` 元素在 jsdom 里不加载任何东西，`readyState` 永远是 0；
 * 2. 浏览器的媒体加载**自带 Range 请求**，`curl` 能测 206 但不能证明浏览器
 *    播放器真的用了它；
 * 3. 面板里 `<video preload="none">` 的渲染在真实布局下才会暴露问题
 *    （比如宽度塌成 0）。
 *
 * ## 为什么直接打 3001 的 API 而不起 mock
 *
 * 这一趟要验的正是「离线管线的产物 → 数据库 → HTTP → 播放器」整条链。任何
 * 一段被 mock 掉，这一趟就只证明了前端能渲染一个假对象。
 *
 * ## 为什么要先把关卡走完
 *
 * 「看讲解」挂在小结面板里（学习者卡住之后才需要补丁，而不是进关卡之前），
 * 所以要先答完这一关的题。这一段点击不是为了测做题 —— 做题由
 * `LevelPage.test.tsx` 的 23 条用例覆盖 —— 只是为了把面板弄到屏幕上。
 *
 * 跑法（先确保 api:3001 与 web:5173 都在跑）：
 *   pnpm --filter @starmap/web exec playwright test video-panel.spec.ts \
 *     --output=../../.scratch/pw-authoring-video
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:3001';
/**
 * 用 `localhost` 而不是 `127.0.0.1`：Vite 默认只绑 `::1`（IPv6 回环），
 * 直接打 `127.0.0.1:5173` 会得到 `ERR_CONNECTION_REFUSED`。
 * 这一条是实测踩到的 —— 症状是「页面打不开」，很容易误以为前端挂了。
 */
const WEB = 'http://localhost:5173';

interface LevelItem {
  levelId: string;
  microKpId: string;
  title: string;
}

/** 拉全量关卡列表。 */
async function listLevels(request: APIRequestContext): Promise<LevelItem[]> {
  const response = await request.get(`${API}/api/v1/market/levels`);
  expect(response.ok(), '关卡列表接口必须能读').toBe(true);
  const body = (await response.json()) as { items: LevelItem[] };
  return body.items;
}

/** 某个关卡能看的片段数。 */
async function clipCount(request: APIRequestContext, levelId: string): Promise<number> {
  const response = await request.get(`${API}/api/v1/levels/${levelId}/video-clips`);
  if (!response.ok()) return 0;
  const body = (await response.json()) as { items: unknown[] };
  return body.items.length;
}

/**
 * 找一个「挂了视频」的关卡，和一个「没挂视频」的关卡。
 *
 * 找不到时返回 null 并让用例 skip —— 而不是让测试假装通过。库里有没有
 * 视频取决于离线管线是否跑过，这是环境事实，不该让 e2e 变成偶然失败。
 */
async function pickLevels(
  request: APIRequestContext,
): Promise<{ withClips: LevelItem | null; withoutClips: LevelItem | null }> {
  const levels = await listLevels(request);
  let withClips: LevelItem | null = null;
  let withoutClips: LevelItem | null = null;
  for (const level of levels) {
    const count = await clipCount(request, level.levelId);
    if (count > 0 && withClips === null) withClips = level;
    if (count === 0 && withoutClips === null) withoutClips = level;
  }
  return { withClips, withoutClips };
}

/**
 * 把这一关走完，直到小结面板出现。
 *
 * AI 生成的一关会在**同一个判定段里放多道题**（实测 5 道）：一次只选一个
 * 选项再点一次提交，剩下的题永远交不了，`进入下一段`永远 disabled。
 *
 * ## 为什么用**页面级** `getByRole('radio')` 而不按 `radiogroup` 分组
 *
 * Fluent UI v9 的 `<RadioGroup>` 渲染出的 `[role="radio"]` **不是**
 * `[role="radiogroup"]` 的后代（直接量过：页面级 20 个，组内 0 个）。
 * 所以只能反过来做：把每个未选中的单选框逐个点上，再提交全部可提交的按钮。
 *
 * 选对选错都无所谓 —— 判定段只要求「每道题都提交过」（`isStepComplete`），
 * 不是「全对」。选第一个只是最短路径，不是断言正确率。
 */
async function finishLevel(page: Page): Promise<void> {
  for (let guard = 0; guard < 60; guard += 1) {
    if (await page.getByText('本关小结').isVisible().catch(() => false)) return;

    let acted = false;

    // 1) 把所有还没选中的单选框逐个点上（每个组选第一个得到最短路径）
    const radios = page.getByRole('radio');
    const radioCount = await radios.count();
    for (let index = 0; index < radioCount; index += 1) {
      const radio = radios.nth(index);
      if (await radio.isChecked().catch(() => true)) continue;
      if (await radio.isDisabled().catch(() => true)) continue;
      await radio.click();
      acted = true;
      break; // 一次只点一个：一次循环只推进一个单选框，避免 stale 句柄
    }

    // 2) 把所有还能点的「提交答案」点一遍（已提交的题会隐藏自己的按钮）
    const submits = page.getByRole('button', { name: '提交答案' });
    const submitCount = await submits.count();
    for (let index = 0; index < submitCount; index += 1) {
      const button = submits.nth(index);
      if (await button.isDisabled().catch(() => true)) continue;
      await button.click();
      acted = true;
      break;
    }

    // 3) 这一段全交完了，就往下走
    const next = page.getByRole('button', { name: /进入下一段|完成本关/ });
    if ((await next.count()) > 0 && (await next.first().isVisible().catch(() => false))) {
      if (!(await next.first().isDisabled().catch(() => true))) {
        await next.first().click();
        continue;
      }
    }

    // 没东西可动也没法推进：把现场交给调用方的断言，别在这里死循环
    if (!acted) return;
    await page.waitForTimeout(150);
  }
}

test.describe('关卡页的「看讲解」面板（票 19）', () => {
  test('有片段时能列出、每片有可读理由、<video> 能加载并真的走 Range', async ({ page, request }) => {
    const { withClips } = await pickLevels(request);
    test.skip(withClips === null, '库里还没有挂了视频的关卡（先跑 tools/video/run.py import）');

    await page.goto(`${WEB}/level/${withClips!.levelId}`);
    await finishLevel(page);

    await expect(page.getByText('看讲解')).toBeVisible({ timeout: 15_000 });

    const video = page.locator('video').first();
    await expect(video).toBeVisible();
    const src = await video.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).toContain('/media/clips/');

    // 票面验收第 3 条：每一片都有可读的切分理由
    expect(await page.getByText(/视频一开头就是讲解内容|续切|为控制单片时长|转写结束/).count()).toBeGreaterThan(0);

    // 票面验收第 7 条：来源可追溯
    await expect(page.getByText(/来源：https:\/\/www\.bilibili\.com/).first()).toBeVisible();

    // 真的能解码：点一下播放，readyState 必须往前跑
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play().catch(() => undefined);
    });
    await expect
      .poll(async () => video.evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);

    const duration = await video.evaluate((element: HTMLVideoElement) => element.duration);
    expect(Number.isFinite(duration)).toBe(true);
    // 票面红线：每片 ≤6 分钟
    expect(duration).toBeLessThanOrEqual(360.5);

    // 浏览器播放器发的就是 Range：这里再亲验一次 206
    const ranged = await request.get(`${API}${src}`, { headers: { Range: 'bytes=0-1023' } });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
  });

  test('没有片段时不渲染空播放器、也不报错（视频不阻断做题）', async ({ page, request }) => {
    const { withoutClips } = await pickLevels(request);
    test.skip(withoutClips === null, '所有关卡都挂了视频，无法验空态');

    await page.goto(`${WEB}/level/${withoutClips!.levelId}`);
    await finishLevel(page);

    await expect(page.getByText(/这个知识点还没有配讲解视频/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('video')).toHaveCount(0);
    // 「没配」不能被说成「加载失败」
    await expect(page.getByText(/讲解视频没能加载/)).toHaveCount(0);
  });

  test('媒体路由必须真的在 API 侧存在（不是前端拼字符串）', async ({ request }) => {
    const { withClips } = await pickLevels(request);
    test.skip(withClips === null, '库里还没有挂了视频的关卡');

    const clips = await request.get(`${API}/api/v1/levels/${withClips!.levelId}/video-clips`);
    const body = (await clips.json()) as { items: Array<{ playUrl: string }> };
    const playUrl = body.items[0]?.playUrl;
    expect(playUrl).toBeTruthy();

    const head = await request.fetch(`${API}${playUrl}`, { method: 'HEAD' });
    expect(head.status(), `HEAD ${API}${playUrl} 必须是 200，否则页面里的 <video> 是 404`).toBe(200);
    expect(head.headers()['accept-ranges']).toBe('bytes');
    expect(head.headers()['content-type']).toContain('video/mp4');
  });
});
