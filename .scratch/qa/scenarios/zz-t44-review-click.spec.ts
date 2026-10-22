/**
 * t44 独立评审 · 探针 2：可点击性（`nodePickingPadding: 8` 的兑现与副作用）。
 *
 * 探针 1 的点击循环有缺陷：命中后 `goBack()` 落在 SPA 历史里，后续点击其实打在
 * 详情页上（URL 里的 `?focus=` 是「返回地图」按钮的产物）。这里重写成**每次点击
 * 前都重新 `goto('/map')` 并确认 `data-node-count` 回到 5467**，绝不带状态。
 *
 * 同时把「点击点有没有墨迹」这件事交给 Python 侧：截图 + 记录坐标，事后比对。
 * 这样能分清两种失败：
 *   - 有墨迹却没导航 → 拾取坏了（点不中）
 *   - 没墨迹却导航了 → padding 过大（点空白处误开节点）
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const READY = 90_000;
test.describe.configure({ timeout: 300_000 });

function shotDir(): string {
  const root = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t44-review-manual';
  const dir = path.resolve(process.cwd(), root, 't44-review');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('t44 评审：每个点都在干净页面上点一次，记录导航结果', async ({ page }) => {
  const dir = shotDir();
  await page.setViewportSize({ width: 1440, height: 900 });

  /**
   * 每次点击前都回到**干净**的 /map。
   *
   * 注意：节点数不写死。评审期间内容库被另一个 agent 改动过（5467 → 3086），
   * 写死会让这条探针变成环境断言而不是 t44 断言。
   */
  const settle = async (): Promise<void> => {
    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
    await expect
      .poll(async () => Number(await page.locator('.graph-canvas').getAttribute('data-node-count')), {
        timeout: READY,
      })
      .toBeGreaterThan(500);
    await page.waitForTimeout(7_000);
  };

  await settle();
  const canvas = page.locator('.graph-canvas');
  const box = (await canvas.boundingBox())!;
  const png = path.join(dir, 'click-canvas.png');
  await canvas.screenshot({ path: png, animations: 'disabled' });

  // 画布内相对坐标（0..1）。画布 780×480，圆盘大约占中间 70%：
  //   - 4 个角落点必定是空背景（圆盘外）
  //   - 8 个点在圆盘内（密度最高处）
  const rel: Array<{ rx: number; ry: number; zone: 'empty' | 'disk' }> = [
    { rx: 0.03, ry: 0.06, zone: 'empty' },
    { rx: 0.97, ry: 0.06, zone: 'empty' },
    { rx: 0.03, ry: 0.94, zone: 'empty' },
    { rx: 0.97, ry: 0.94, zone: 'empty' },
    { rx: 0.50, ry: 0.50, zone: 'disk' },
    { rx: 0.45, ry: 0.42, zone: 'disk' },
    { rx: 0.55, ry: 0.58, zone: 'disk' },
    { rx: 0.40, ry: 0.55, zone: 'disk' },
    { rx: 0.60, ry: 0.45, zone: 'disk' },
    { rx: 0.48, ry: 0.62, zone: 'disk' },
    { rx: 0.52, ry: 0.38, zone: 'disk' },
    { rx: 0.44, ry: 0.48, zone: 'disk' },
  ];

  const results: Array<{
    zone: string;
    canvasX: number;
    canvasY: number;
    pageX: number;
    pageY: number;
    navigated: boolean;
    url: string;
  }> = [];

  for (const spot of rel) {
    await settle();
    const fresh = (await page.locator('.graph-canvas').boundingBox())!;
    const pageX = fresh.x + fresh.width * spot.rx;
    const pageY = fresh.y + fresh.height * spot.ry;
    await page.mouse.click(pageX, pageY);
    await page.waitForTimeout(600);
    const url = page.url();
    results.push({
      zone: spot.zone,
      canvasX: Math.round(fresh.width * spot.rx),
      canvasY: Math.round(fresh.height * spot.ry),
      pageX: Math.round(pageX),
      pageY: Math.round(pageY),
      navigated: !url.replace(/\/$/, '').endsWith('/map'),
      url: url.replace('http://localhost:5173', ''),
    });
  }

  fs.writeFileSync(
    path.join(dir, 'click2.json'),
    JSON.stringify({ box, png, results }, null, 2),
    'utf8',
  );
  // eslint-disable-next-line no-console
  console.log(
    'clicks',
    JSON.stringify(results.map((r) => [r.zone, r.canvasX, r.canvasY, r.navigated, r.url])),
  );

  expect(results.length).toBe(rel.length);
});
