/**
 * t74 重审 t44 的独立探针（reviewer-2 自用，**不复用**实现者 layout.test.ts 的断言函数）。
 *
 * 审查对象是**当前工作区字节**（GraphCanvas.tsx / layout.ts / layout.test.ts / 票面 §9），
 * 不是 t44 交付时的快照。当前真实 `/api/v1/graph` 已从 t44 时的 5495 节点漂到 ~3085 节点
 * （内容库被其他泳道改动），所以断言阈值按**现场**节点数写，不硬编码 5495。
 *
 * 量三件事：
 *   1. 默认视野（1x，cameraRatio≈1）的画布截图 —— 交给 Python 侧做我自己的像素度量。
 *   2. 盘内点击是否命中**互不相同**的节点、盘外空白是否误触。
 *   3. 1x 视野下真正画出来的标签数（`data-labels-displayed`）。
 *
 * 跑法（必须带 --output，否则会踩共享 test-results 的并发坑）：
 *   cd apps/web
 *   npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *     scenarios/zz-t44b-review.spec.ts --output=../../.scratch/pw-t44b-<ts>
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const READY = 90_000;
const TAG = process.env.T44B_TAG ?? 'cur';
test.describe.configure({ timeout: 300_000 });

function shotDir(): string {
  const root = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t44b-manual';
  const dir = path.resolve(process.cwd(), root, 't44b');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/map', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
  // LAYOUT_BUDGET_MS = 4s；留足余量等 worker 停下、相机稳定
  await page.waitForTimeout(9_000);
}

async function attrs(page: import('@playwright/test').Page) {
  return page.locator('.graph-canvas').evaluate((el) => ({
    nodeCount: el.getAttribute('data-node-count'),
    labelsVisible: el.getAttribute('data-labels-visible'),
    labelsDisplayed: el.getAttribute('data-labels-displayed'),
    cameraRatio: el.getAttribute('data-camera-ratio'),
    layoutSource: el.getAttribute('data-layout-source'),
  }));
}

test('t44b：默认视野像素证据 + 标签数', async ({ page }) => {
  const dir = shotDir();
  await settle(page);

  const canvas = page.locator('.graph-canvas');
  const box = (await canvas.boundingBox())!;
  const a1 = await attrs(page);

  const png = path.join(dir, `${TAG}-canvas-1x.png`);
  await canvas.screenshot({ path: png, animations: 'disabled' });

  await page.waitForTimeout(3_000);
  const png2 = path.join(dir, `${TAG}-canvas-1x-late.png`);
  await canvas.screenshot({ path: png2, animations: 'disabled' });
  const stable = fs.readFileSync(png).equals(fs.readFileSync(png2));

  // 放大 4 档：人想「看清一个点」时的实际手段
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: '放大图谱' }).click();
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1_500);
  const pngZoom = path.join(dir, `${TAG}-canvas-zoom4.png`);
  await canvas.screenshot({ path: pngZoom, animations: 'disabled' });
  const a2 = await attrs(page);

  fs.writeFileSync(
    path.join(dir, `${TAG}-metrics.json`),
    JSON.stringify({ tag: TAG, box, base: a1, zoom4: a2, stable, png, png2, pngZoom }, null, 2),
    'utf8',
  );
  // eslint-disable-next-line no-console
  console.log(`[${TAG}]`, JSON.stringify({ box, base: a1, zoom4: a2, stable }));

  expect(Number(a1.nodeCount)).toBeGreaterThan(2_000);
  expect(a1.layoutSource).toBe('worker');
});

test('t44b：盘内点击是否命中互异节点、盘外空白是否误触', async ({ page }) => {
  const dir = shotDir();
  await settle(page);

  const box = (await page.locator('.graph-canvas').boundingBox())!;
  // 盘内：以画布中心为圆心、半径 30% 的圆上均匀取 8 个点
  const inside: Array<{ x: number; y: number }> = [];
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * 0.3;
  for (let i = 0; i < 8; i += 1) {
    const t = (i / 8) * Math.PI * 2;
    inside.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
  }
  // 盘外：四个角（内缩 6px，避开圆角与边框）
  const outside = [
    { x: box.x + 6, y: box.y + 6 },
    { x: box.x + box.width - 6, y: box.y + 6 },
    { x: box.x + 6, y: box.y + box.height - 6 },
    { x: box.x + box.width - 6, y: box.y + box.height - 6 },
  ];

  const visited: string[] = [];
  const tried: Array<{ kind: string; x: number; y: number; hit: boolean; url: string }> = [];
  for (const [kind, spots] of [
    ['inside', inside],
    ['outside', outside],
  ] as const) {
    for (const spot of spots) {
      await page.mouse.click(spot.x, spot.y);
      await page.waitForTimeout(350);
      const url = page.url();
      const hit = /\/map\/kp-/.test(url);
      tried.push({ kind, x: Math.round(spot.x), y: Math.round(spot.y), hit, url });
      if (hit) {
        visited.push(url.split('/map/')[1] ?? '');
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
        await expect(page.locator('.graph-canvas')).toBeVisible({ timeout: READY });
        await page.waitForTimeout(9_000);
      }
    }
  }

  const insideTried = tried.filter((t) => t.kind === 'inside');
  const outsideTried = tried.filter((t) => t.kind === 'outside');
  const summary = {
    tag: TAG,
    insideHits: insideTried.filter((t) => t.hit).length,
    insideTotal: insideTried.length,
    distinctNodes: new Set(visited).size,
    outsideHits: outsideTried.filter((t) => t.hit).length,
    outsideTotal: outsideTried.length,
    tried,
  };
  fs.writeFileSync(
    path.join(dir, `${TAG}-clickability.json`),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
  // eslint-disable-next-line no-console
  console.log(`[${TAG}] 点击`, JSON.stringify(summary));

  expect(insideTried.length).toBe(8);
});
