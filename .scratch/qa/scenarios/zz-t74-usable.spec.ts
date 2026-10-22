/**
 * t74 重审 t44 — 探针 6：可用性（布局修好后，画布终于落在视口内）
 *
 * 只读探针：不改源码，只量。
 *   cd apps/web
 *   npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *     scenarios/zz-t74-usable.spec.ts --output=../../.scratch/pw-t74u-<ts>
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const READY = 90_000;
test.describe.configure({ timeout: 300_000 });

function outDir(): string {
  const root = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../../.scratch/pw-t74u-manual';
  const dir = path.resolve(process.cwd(), root, 't74u');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('t74u：画布在视口内，盘内点击能导航、盘外不导航、悬停是否揭示标签', async ({ page }) => {
  const dir = outDir();
  const log: Record<string, unknown> = {};

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/map');
  await page.locator('.graph-canvas').waitFor({ state: 'visible', timeout: READY });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.graph-canvas');
      const n = Number(el?.getAttribute('data-node-count') ?? '0');
      return n > 1000;
    },
    undefined,
    { timeout: READY },
  );
  await page.waitForTimeout(9000);

  const box = await page.locator('.graph-canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  log.box = box;
  log.inViewport = box.y >= 0 && box.y + box.height <= 900 && box.height < 900;
  log.canvasAttrs = await page.locator('.graph-canvas').evaluate((el) => ({
    nodeCount: el.getAttribute('data-node-count'),
    labels: el.getAttribute('data-labels-displayed'),
    ratio: el.getAttribute('data-camera-ratio'),
    source: el.getAttribute('data-layout-source'),
  }));

  // 盘心与半径：从截图里估（画布 932×480，盘心约在画布中心）
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  const R = Math.min(box.width, box.height) * 0.38;
  log.disk = { cx, cy, R };

  // --- 盘内 8 个点，看是否各自导航到不同关卡 ---
  const inside: Array<{ x: number; y: number; url: string; level: string | null }> = [];
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  const reopen = async () => {
    await page.goto('/map');
    await page.locator('.graph-canvas').waitFor({ state: 'visible', timeout: READY });
    await page.waitForFunction(
      () => Number(document.querySelector('.graph-canvas')?.getAttribute('data-node-count') ?? '0') > 1000,
      undefined,
      { timeout: READY },
    );
    await page.waitForTimeout(9000);
  };
  for (const a of angles) {
    const rad = (a * Math.PI) / 180;
    const x = cx + Math.cos(rad) * R * 0.62;
    const y = cy + Math.sin(rad) * R * 0.62;
    await page.mouse.click(x, y);
    await page.waitForTimeout(1200);
    const url = page.url();
    inside.push({
      x: Math.round(x),
      y: Math.round(y),
      url,
      level: url.replace('http://localhost:5173', ''),
    });
    if (!/\/map$/.test(url)) await reopen();
  }
  log.inside = inside;
  log.insideHits = inside.filter((i) => i.level && i.level !== '/map').length;
  log.distinctLevels = new Set(inside.map((i) => i.level ?? '').filter((u) => u && u !== '/map'))
    .size;

  // --- 盘外 4 个角落，不应导航 ---
  const outside: Array<{ x: number; y: number; url: string }> = [];
  const corners = [
    [box.x + 12, box.y + 12],
    [box.x + box.width - 12, box.y + 12],
    [box.x + 12, box.y + box.height - 12],
    [box.x + box.width - 12, box.y + box.height - 12],
  ];
  for (const [x, y] of corners) {
    await page.mouse.click(x as number, y as number);
    await page.waitForTimeout(700);
    outside.push({
      x: Math.round(x as number),
      y: Math.round(y as number),
      url: page.url().replace('http://localhost:5173', ''),
    });
    if (!/\/map$/.test(page.url())) await reopen();
  }
  log.outside = outside;
  log.outsideHits = outside.filter((o) => !/\/map$/.test(o.url)).length;

  if (!page.url().includes('/map')) await reopen();

  // --- 悬停是否揭示标签 ---
  const before = await page.locator('.graph-canvas').getAttribute('data-labels-displayed');
  const hoverDeltas: number[] = [];
  for (const a of [0, 90, 180, 270]) {
    const rad = (a * Math.PI) / 180;
    await page.mouse.move(cx + Math.cos(rad) * R * 0.5, cy + Math.sin(rad) * R * 0.5);
    await page.waitForTimeout(900);
    const now = Number(await page.locator('.graph-canvas').getAttribute('data-labels-displayed') ?? '0');
    hoverDeltas.push(now - Number(before ?? '0'));
  }
  log.labelsBefore = before;
  log.hoverDeltas = hoverDeltas;

  // --- 清单里有没有搜索框（能不能按名字找点） ---
  log.roster = await page.evaluate(() => {
    const r = document.querySelector('.graph-roster');
    if (!r) return { present: false };
    const inputs = r.querySelectorAll('input, [role="searchbox"], [type="search"]');
    const items = r.querySelectorAll('li').length;
    return {
      present: true,
      inputs: inputs.length,
      items,
      scrollH: r.scrollHeight,
      clientH: r.clientHeight,
    };
  });

  await page.screenshot({ path: path.join(dir, 'after-probes.png'), fullPage: false });
  fs.writeFileSync(path.join(dir, 'usable.json'), JSON.stringify(log, null, 2), 'utf8');
  console.log('WROTE', dir);
  expect(log.inViewport).toBe(true);
});
