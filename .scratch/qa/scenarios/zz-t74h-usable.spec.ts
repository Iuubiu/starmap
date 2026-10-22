import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const OUT = '../../.scratch/pw-t74h-manual/t74h';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(300_000);

test('t74h 可用性：默认视野下点击能否命中互不相同的节点', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto('/map');
  await page.locator('.graph-canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(9000);

  const box = (await page.locator('.graph-canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * 0.42;

  const hits: Array<{ i: number; url: string; hit: boolean }> = [];
  const angles = [0, 60, 120, 180, 240, 300];
  for (let i = 0; i < angles.length; i++) {
    const a = (angles[i]! * Math.PI) / 180;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    await page.goto('/map');
    await page.locator('.graph-canvas').waitFor({ state: 'visible' });
    await page.waitForTimeout(4000);
    const before = page.url();
    await page.mouse.click(x, y);
    await page.waitForTimeout(1200);
    const after = page.url();
    hits.push({ i, url: after.replace('http://localhost:5173', ''), hit: after !== before });
  }

  const outside: Array<{ i: number; hit: boolean }> = [];
  const corners: Array<[number, number]> = [
    [box.x + 6, box.y + 6],
    [box.x + box.width - 6, box.y + 6],
    [box.x + 6, box.y + box.height - 6],
    [box.x + box.width - 6, box.y + box.height - 6],
  ];
  for (let i = 0; i < corners.length; i++) {
    await page.goto('/map');
    await page.locator('.graph-canvas').waitFor({ state: 'visible' });
    await page.waitForTimeout(4000);
    const before = page.url();
    await page.mouse.click(corners[i]![0], corners[i]![1]);
    await page.waitForTimeout(800);
    outside.push({ i, hit: page.url() !== before });
  }

  const distinct = new Set(hits.filter((h) => h.hit).map((h) => h.url));
  const labels = await page.locator('.graph-canvas').getAttribute('data-labels-displayed');
  const nodes = await page.locator('.graph-canvas').getAttribute('data-node-count');
  const roster = page.locator('.graph-roster');
  const rosterInputs = await roster.locator('input').count();

  const out = {
    canvas: { w: Math.round(box.width), h: Math.round(box.height) },
    nodes,
    labels,
    diskHits: hits,
    distinctTargets: distinct.size,
    outsideHits: outside.filter((o) => o.hit).length,
    rosterInputs,
  };
  fs.writeFileSync(`${OUT}/usable.json`, JSON.stringify(out, null, 1));
  console.log('USABLE ' + JSON.stringify(out));
  expect(box.width).toBeGreaterThan(0);
});
