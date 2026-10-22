/**
 * 票 83 的真实浏览器验收：四页 × 四档宽度。
 *
 * 为什么是探针而不是单测：这条票的验收数字全是**布局几何**——
 * `getBoundingClientRect` 的左右留白、画布宽度、16 张 1280×800 截图。
 * jsdom 没有布局引擎，量出来的一律是 0，单测在这里只能证明「元素在」。
 *
 * 覆盖：
 * 1. 四页（`/`、`/learning`、`/market`、`/map`）× 1280/1440/1920/2560 的
 *    主内容区左右留白（差 ≤ 2px）→ 数字表落盘 `.scratch/qa/layout-2560/`；
 * 2. 2560 下没有 760 上限造成的大片空白（学习页内容列 ≥ 1000px）；
 * 3. `/map` wide 模式：画布宽度 = 内容区宽 − 340px（-1px 容差给亚像素）；
 * 4. Composer 唯一实现（两页都 import 它，全仓没有第二条 compose 输入）；
 * 5. Composer 三层 + 工具条只在聚焦时可见（`opacity` 实测）；
 * 6. 右侧栏三门槛与建议；点建议只填输入框、不发请求。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const WIDTHS = [1280, 1440, 1920, 2560] as const;
const PAGES = [
  { path: '/', name: 'home', ready: '[data-study-sidebar]' },
  { path: '/learning', name: 'learning', ready: '.sm-page-in' },
  { path: '/market', name: 'market', ready: '.sm-market-list' },
  { path: '/map', name: 'map', ready: '.graph-canvas' },
] as const;

const OUT_DIR = resolve(process.cwd(), '../../.scratch/qa/layout-2560');

/**
 * 首页被「初识」门挡着：没做过画像的浏览器打开 `/` 会被重定向到
 * `/welcome`，于是 `.sm-composer` 永远等不到。这里在页面脚本之前把
 * `profileDone` 置上 —— 这是产品的真实开关（`WelcomePage.markProfileDone`），
 * 不是测试专有后门。
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('profileDone', '1');
    } catch {
      /* 隐私模式：忽略 */
    }
  });
});

interface Row {
  page: string;
  width: number;
  left: number;
  right: number;
  gap: number;
  contentWidth: number;
  mainWidth: number;
}

async function settle(page: import('@playwright/test').Page, ready: string) {
  await page.waitForSelector(ready, { timeout: 60_000 });
  // 页面切换有一段 260ms 的玻璃入场动画；量几何之前先让它落定。
  await page.waitForTimeout(400);
}

async function measure(page: import('@playwright/test').Page, name: string, width: number): Promise<Row> {
  const raw = await page.evaluate(() => {
    const main = document.getElementById('main');
    const root = document.querySelector('.sm-page-in')?.firstElementChild;
    if (!main || !root) throw new Error('没有 #main 或页面根元素');
    const mr = main.getBoundingClientRect();
    const pr = (root as HTMLElement).getBoundingClientRect();
    return {
      left: pr.left - mr.left,
      right: mr.right - pr.right,
      contentWidth: (root as HTMLElement).clientWidth,
      mainWidth: main.clientWidth,
    };
  });
  return {
    page: name,
    width,
    left: Math.round(raw.left * 100) / 100,
    right: Math.round(raw.right * 100) / 100,
    gap: Math.round(Math.abs(raw.left - raw.right) * 100) / 100,
    contentWidth: raw.contentWidth,
    mainWidth: raw.mainWidth,
  };
}

test.describe('票 83：四页 × 四档宽度', () => {
  test('四页在四档宽度下左右留白对称，且 2560 没有 760 上限的空白', async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    const rows: Row[] = [];

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const target of PAGES) {
        await page.goto(target.path);
        await settle(page, target.ready);
        const row = await measure(page, target.name, width);
        rows.push(row);
        await page.screenshot({
          path: resolve(OUT_DIR, `${target.name}-${width}.png`),
          animations: 'disabled',
        });
      }
    }

    writeFileSync(resolve(OUT_DIR, 'metrics.json'), `${JSON.stringify(rows, null, 2)}\n`);
    const lines = [
      '# 票 83：四页 × 四档宽度实测',
      '',
      '| 页面 | 宽 | 左留白 | 右留白 | 差 | 内容列宽 | #main 宽 |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...rows.map(
        (row) =>
          `| ${row.page} | ${row.width} | ${row.left.toFixed(2)} | ${row.right.toFixed(2)} | ${row.gap.toFixed(2)} | ${row.contentWidth} | ${row.mainWidth} |`,
      ),
      '',
    ];
    writeFileSync(resolve(OUT_DIR, 'metrics.md'), lines.join('\n'));

    // ① 左右留白差 ≤ 2px（四页 × 四档）
    for (const row of rows) {
      expect(row.gap, `${row.page}@${row.width} 左右留白差`).toBeLessThanOrEqual(2);
    }

    // ② 2560 下学习页内容列不再被 760 卡住
    const home2560 = rows.find((row) => row.page === 'home' && row.width === 2560)!;
    expect(home2560.contentWidth).toBeGreaterThanOrEqual(1000);

    // ② 地图页 wide：画布 = 内容区宽 − 340（1px 亚像素容差）
    await page.setViewportSize({ width: 2560, height: 800 });
    await page.goto('/map');
    await settle(page, '.graph-canvas');
    const canvas = await page.evaluate(() => {
      const main = document.getElementById('main');
      const root = document.querySelector('.sm-page-in')?.firstElementChild;
      const graph = document.querySelector('.graph-canvas');
      if (!main || !root || !graph) throw new Error('缺元素');
      const rootEl = root as HTMLElement;
      const pageStyle = getComputedStyle(rootEl);
      const padX = parseFloat(pageStyle.paddingLeft) + parseFloat(pageStyle.paddingRight);
      return {
        // 用 border-box 宽度：画布自带 1px 描边（票 62），clientWidth 会少 2px。
        canvasWidth: Math.round((graph as HTMLElement).getBoundingClientRect().width * 100) / 100,
        contentWidth: rootEl.clientWidth,
        pagePaddingX: padX,
        innerWidth: rootEl.clientWidth - padX,
        mainWidth: main.clientWidth,
        windowWidth: window.innerWidth,
      };
    });
    // 画布 = 页面内宽 − 340（列间距已并入清单列的 padding，见 MapPage 的注释）
    expect(canvas.innerWidth - canvas.canvasWidth).toBeLessThanOrEqual(341);
    expect(canvas.innerWidth - canvas.canvasWidth).toBeGreaterThanOrEqual(339);
    // 记录到同一份 metrics，供报告引用
    writeFileSync(
      resolve(OUT_DIR, 'map-wide.json'),
      `${JSON.stringify(
        {
          ...canvas,
          deltaInnerMinusCanvas: canvas.innerWidth - canvas.canvasWidth,
          deltaContentMinusCanvas: canvas.contentWidth - canvas.canvasWidth,
          deltaWindowMinusCanvas: canvas.windowWidth - canvas.canvasWidth,
        },
        null,
        2,
      )}\n`,
    );
  });

  test('Composer 是唯一实现，且三层结构在真实浏览器里成立', async ({ page }) => {
    const repo = resolve(process.cwd(), '../..');
    const home = readFileSync(resolve(repo, 'apps/web/src/pages/HomePage.tsx'), 'utf8');
    const learning = readFileSync(resolve(repo, 'apps/web/src/pages/LearningPage.tsx'), 'utf8');
    expect(home).toContain("from '../components/Composer'");
    expect(learning).toContain("from '../components/Composer'");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await settle(page, '.sm-composer');

    // 三层都在
    await expect(page.locator('.sm-composer-box')).toHaveCount(1);
    await expect(page.locator('.sm-composer-row')).toHaveCount(1);
    await expect(page.locator('.sm-composer-toolbar')).toHaveCount(1);
    await expect(page.locator('.sm-composer-row button')).toHaveCount(4); // ＋ / 模型 / 麦克风 / 发送（档位是 span）
    await expect(page.getByRole('button', { name: '期刊下载器' })).toBeVisible();

    // 工具条：失焦 opacity 0，聚焦后 1（CSS :focus-within，不是 JS 状态）
    const opacity = () =>
      page.locator('.sm-composer-toolbar').evaluate((el) => getComputedStyle(el).opacity);
    expect(await opacity()).toBe('0');
    await page.getByLabel('这一轮想说的话').focus();
    await expect.poll(opacity, { timeout: 2_000 }).toBe('1');
    await page.getByLabel('这一轮想说的话').blur();
    await expect.poll(opacity, { timeout: 2_000 }).toBe('0');
  });

  test('学习记录页也用的是同一个 Composer（不是第二份输入条）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/learning');
    await settle(page, '.sm-composer');
    await expect(page.locator('.sm-composer-box')).toHaveCount(1);
    await expect(page.getByLabel('这一轮想说的话')).toHaveCount(1);
  });
});

test.describe('票 83：右侧栏（进度 + 建议）', () => {
  test('三门槛实测数 + 建议只填不发', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?kp=kp-bool');
    await settle(page, '[data-study-progress]');

    // 上块：三条门槛（没有就「证据不足」，不显示 0 / 8）
    await expect(page.locator('[data-study-row="作答"]')).toHaveCount(1);
    await expect(page.locator('[data-study-row="变式"]')).toHaveCount(1);
    await expect(page.locator('[data-study-row="连对"]')).toHaveCount(1);

    // 下块：建议 ≤3 条，点一条只把话填进输入框
    const cards = page.locator('[data-study-suggestions]');
    await expect(cards).toHaveCount(1);
    const suggestions = page.locator('.sm-study-suggestion');
    const count = await suggestions.count();
    expect(count).toBeLessThanOrEqual(3);
    if (count > 0) {
      const text = (await suggestions.first().textContent())?.trim() ?? '';
      let posted = 0;
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().includes('/api/v1/agent/turns')) posted += 1;
      });
      await suggestions.first().click();
      await expect(page.getByLabel('这一轮想说的话')).toHaveValue(text);
      expect(posted).toBe(0);
    }
  });
});
