import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * 量「圆角现状」：把每个可见元素的实际 computed border-radius 与 background-color
 * 取出来，按出现次数排序写进文件。
 *
 * 为什么必须这样量而不看代码：圆角可能来自 Fluent 组件的默认样式、Grep 的
 * Griffel 类、或者行内 style，人眼读代码数不出来；而「看起来还是直角」是视觉判断，
 * 需要一条可复跑的数字来定基线，否则改完谁也不知道到底改了没有。
 */
test('量全部可见元素的圆角分布', async ({ page }) => {
  for (const [name, path] of [
    ['home', '/'],
    ['board', '/board'],
    ['level', '/level/lv-bool-laws'],
    ['map', '/map'],
  ] as const) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    const data = await page.evaluate(() => {
      const rows: Array<{ radius: string; bg: string; tag: string; w: number; h: number; text: string }> = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        // 只统计「有可见表面」的元素（有背景色或边框），纯布局容器不算
        const hasSurface = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderTopWidth) > 0;
        if (!hasSurface) continue;
        rows.push({
          radius: cs.borderTopLeftRadius,
          bg: cs.backgroundColor,
          tag: el.tagName.toLowerCase(),
          w: Math.round(r.width),
          h: Math.round(r.height),
          text: (el.textContent ?? '').trim().slice(0, 18),
        });
      }
      return rows;
    });

    const tally = new Map<string, { n: number; samples: string[] }>();
    for (const row of data) {
      const key = row.radius;
      const cur = tally.get(key) ?? { n: 0, samples: [] };
      cur.n += 1;
      if (cur.samples.length < 4) {
        cur.samples.push(`${row.tag} ${row.w}x${row.h} "${row.text}"`);
      }
      tally.set(key, cur);
    }

    const sorted = [...tally.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([radius, v]) => ({ radius, count: v.n, samples: v.samples }));

    writeFileSync(`.scratch/qa/shots/radius-${name}.json`, JSON.stringify(sorted, null, 2), 'utf8');
    console.log(`RADIUS_${name.toUpperCase()} ` + JSON.stringify(sorted));
  }
});
