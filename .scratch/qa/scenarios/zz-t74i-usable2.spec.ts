import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const OUT = '../../.scratch/pw-t74i-manual/t74i';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(300_000);

test('t74i 可用性：盘内不同半径的点击命中率', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto('/map');
  await page.locator('.graph-canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(9000);

  const box = (await page.locator('.graph-canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const unit = Math.min(box.width, box.height);

  const spots: Array<{ frac: number; deg: number }> = [];
  for (const frac of [0.1, 0.18, 0.26]) {
    for (const deg of [0, 90, 180, 270]) spots.push({ frac, deg });
  }

  const hits: Array<{ frac: number; deg: number; hit: boolean; url: string }> = [];
  for (const s of spots) {
    await page.goto('/map');
    await page.locator('.graph-canvas').waitFor({ state: 'visible' });
    await page.waitForTimeout(3500);
    const before = page.url();
    const a = (s.deg * Math.PI) / 180;
    const x = cx + Math.cos(a) * s.frac * unit;
    const y = cy + Math.sin(a) * s.frac * unit;
    await page.mouse.click(x, y);
    await page.waitForTimeout(1000);
    const after = page.url();
    hits.push({ ...s, hit: after !== before, url: after.replace('http://localhost:5173', '') });
  }

  const corners: Array<[number, number]> = [
    [box.x + 6, box.y + 6],
    [box.x + box.width - 6, box.y + box.height - 6],
  ];
  const outside: Array<{ i: number; hit: boolean }> = [];
  for (let i = 0; i < corners.length; i++) {
    await page.goto('/map');
    await page.locator('.graph-canvas').waitFor({ state: 'visible' });
    await page.waitForTimeout(3500);
    const before = page.url();
    await page.mouse.click(corners[i]![0], corners[i]![1]);
    await page.waitForTimeout(800);
    outside.push({ i, hit: page.url() !== before });
  }

  const distinct = new Set(hits.filter((h) => h.hit).map((h) => h.url));
  const out = {
    canvas: { w: Math.round(box.width), h: Math.round(box.height) },
    unit: Math.round(unit),
    nodes: await page.locator('.graph-canvas').getAttribute('data-node-count'),
    labels: await page.locator('.graph-canvas').getAttribute('data-labels-displayed'),
    hits,
    hitRate: `${hits.filter((h) => h.hit).length}/${hits.length}`,
    distinctTargets: distinct.size,
    outsideHits: `${outside.filter((o) => o.hit).length}/${outside.length}`,
    rosterInputs: await page.locator('.graph-roster input').count(),
  };
  fs.writeFileSync(`${OUT}/usable.json`, JSON.stringify(out, null, 1));
  console.log('USABLE2 ' + JSON.stringify(out));
  expect(box.width).toBeGreaterThan(0);
});
