/**
 * t44 独立评审 · 探针 3：悬停能不能读出「这是什么」。
 *
 * 「逐点可分」只回答「点是不是分开的」。用户真正要做的事是**找到想学的那一个**，
 * 而 5495 个点里默认视野只画出个位数标签（`labelGridCellSize: 160` 的去重网格）。
 * 所以必须量：把鼠标放到点上，会不会浮出名字 / 尺寸会不会变大到看得见。
 *
 * 记录三件事（每次悬停前都回到干净 /map）：
 *   - `data-labels-displayed` 是否比基线多（悬停是否触发新标签）
 *   - 光标周围 60×60 的像素差（悬停是否产生可见反馈）
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

test('t44 评审：悬停反馈（标签 + 尺寸）', async ({ page }) => {
  const dir = shotDir();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/map', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
  await page.waitForTimeout(9_000);

  const canvas = page.locator('.graph-canvas');
  const box = (await canvas.boundingBox())!;
  const baseLabels = Number(await canvas.getAttribute('data-labels-displayed'));

  const probes = [
    { rx: 0.50, ry: 0.50 },
    { rx: 0.45, ry: 0.42 },
    { rx: 0.55, ry: 0.58 },
    { rx: 0.40, ry: 0.55 },
  ];

  const rows: Array<{ rx: number; ry: number; labels: number; delta: number }> = [];
  for (const p of probes) {
    const x = box.x + box.width * p.rx;
    const y = box.y + box.height * p.ry;
    await page.mouse.move(x, y);
    await page.waitForTimeout(700);
    const labels = Number(await canvas.getAttribute('data-labels-displayed'));
    rows.push({ rx: p.rx, ry: p.ry, labels, delta: labels - baseLabels });
    // 悬停态截图（裁到光标附近，方便肉眼看「有没有名字浮出来」）
    await page.screenshot({
      path: path.join(dir, `hover-${p.rx}-${p.ry}.png`),
      clip: { x: x - 150, y: y - 60, width: 300, height: 120 },
    });
    await page.mouse.move(box.x + 5, box.y + 5); // 移开，避免累积高亮
    await page.waitForTimeout(300);
  }

  fs.writeFileSync(
    path.join(dir, 'hover.json'),
    JSON.stringify({ baseLabels, rows }, null, 2),
    'utf8',
  );
  // eslint-disable-next-line no-console
  console.log('hover', JSON.stringify({ baseLabels, rows }));

  expect(rows.length).toBe(probes.length);
});
