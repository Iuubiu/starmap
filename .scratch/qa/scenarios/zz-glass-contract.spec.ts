import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * 液态玻璃语言的可量取契约。
 *
 * 四条设计特征各配一条机器判据 —— 「像不像液态玻璃」是人的判断，但
 * 「有没有做出来」可以量：
 *
 *   ① 液态形状：主容器/浮层的四个角半径**互不相等**（非对称轮廓），且 ≥20px。
 *   ② 流动背景：≥5 个 blur 光团，`animation-name` 非 none，周期 ≥40s。
 *   ③ 玻璃：主容器有 `backdrop-filter` 且 blur ≥24px；内阴影里有一条白色
 *      内发光（折射）；描边是**渐变**（`::before` 的 background-image 含
 *      linear-gradient），不是均匀 1px 实线。
 *   ④ 流体交互：导航项悬浮时 `scale` 变化（形变而非位移），过渡缓动是
 *      `cubic-bezier(0.22, 1, 0.36, 1)`。
 *
 * 外加两条硬要求：`prefers-reduced-motion` 下动画为 none；正文对比度 AA。
 *
 * 跑法：
 *   cd apps/web && npx playwright test --config=../../.scratch/qa/playwright.config.ts \
 *     zz-glass-contract --output=../../.scratch/pw-glass-<时间戳>
 */

const OUT = '../../.scratch/qa/shots';

const pin = (theme: 'dark' | 'light') =>
  `(() => { try { localStorage.setItem('starmap.theme', '${theme}'); } catch (e) {} })();`;

test.describe('① 液态形状：非对称轮廓', () => {
  test('内容舞台与浮层的四个角半径互不相等且 ≥20px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(pin('dark'));
    await page.goto('/');
    await page.waitForSelector('.sm-stage');

    const stage = await page.evaluate(() => {
      const el = document.querySelector('.sm-stage') as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        tl: parseFloat(cs.borderTopLeftRadius),
        tr: parseFloat(cs.borderTopRightRadius),
        br: parseFloat(cs.borderBottomRightRadius),
        bl: parseFloat(cs.borderBottomLeftRadius),
      };
    });
    // 上下两对各自不同 = 轮廓不是「固定圆角矩形」。
    expect(stage.tl).not.toBe(stage.tr);
    expect(stage.tl).toBeGreaterThanOrEqual(20);
    expect(stage.tr).toBeGreaterThanOrEqual(20);

    await page.locator('.sm-rail').hover();
    await page.waitForTimeout(400);
    const flyout = await page.evaluate(() => {
      const el = document.querySelector('.sm-flyout') as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        tl: parseFloat(cs.borderTopLeftRadius),
        tr: parseFloat(cs.borderTopRightRadius),
        br: parseFloat(cs.borderBottomRightRadius),
        bl: parseFloat(cs.borderBottomLeftRadius),
      };
    });
    const corners = new Set([flyout.tl, flyout.tr, flyout.br, flyout.bl]);
    expect(corners.size, `浮层四角 ${JSON.stringify(flyout)} 应是四个不同的半径`).toBeGreaterThanOrEqual(3);
    writeFileSync(`${OUT}/glass-shape.json`, JSON.stringify({ stage, flyout }, null, 2), 'utf8');
  });
});

test.describe('② 流动的背景', () => {
  test('5 个光团，动画在跑，周期 ≥40s', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('.sm-blob');

    const blobs = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.sm-blob')).map((el) => {
        const cs = getComputedStyle(el);
        return {
          name: cs.animationName,
          duration: cs.animationDuration,
          blur: cs.filter,
          radius: cs.borderTopLeftRadius,
        };
      }),
    );
    expect(blobs.length).toBeGreaterThanOrEqual(5);
    for (const b of blobs) {
      expect(b.name).not.toBe('none');
      const seconds = parseFloat(b.duration);
      expect(seconds, `${b.duration} 应 ≥40s`).toBeGreaterThanOrEqual(40);
      expect(b.blur).toContain('blur');
      // 半径是「椭圆式」双半径（computed 归一成百分比串，部分浏览器只回单组），
      // 判据取本质：四个角不相等 → 圆会呼吸成不规则软体而不是正圆。
      const corners = b.radius.split(/\s+/);
      expect(new Set(corners).size, `光团半径 ${b.radius} 应是四个不同的角`).toBeGreaterThan(1);
    }

    // 真的在动：同一光团两次采样位置不同。
    const a = await page.evaluate(
      () => (document.querySelector('.sm-blob') as HTMLElement).getBoundingClientRect().top,
    );
    await page.waitForTimeout(1200);
    const b = await page.evaluate(
      () => (document.querySelector('.sm-blob') as HTMLElement).getBoundingClientRect().top,
    );
    expect(Math.abs(a - b), '光团在 1.2s 内应发生位移').toBeGreaterThan(0.5);
    writeFileSync(`${OUT}/glass-blobs.json`, JSON.stringify(blobs, null, 2), 'utf8');
  });

  test('prefers-reduced-motion 下光团停止漂移，渐变仍在', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('.sm-blob');
    const state = await page.evaluate(() => {
      const el = document.querySelector('.sm-blob') as HTMLElement;
      const cs = getComputedStyle(el);
      return { name: cs.animationName, background: cs.backgroundImage };
    });
    expect(state.name).toBe('none');
    expect(state.background).toContain('gradient');
    await page.screenshot({ path: `${OUT}/glass-reduced-motion.png` });
  });
});

test.describe('③ 玻璃：折射 + 内辉 + 渐变描边', () => {
  test('主容器有 backdrop-filter 与白色内发光，描边是渐变不是均匀实线', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(pin('dark'));
    await page.goto('/');
    await page.waitForSelector('.sm-stage');

    const stage = await page.evaluate(() => {
      const el = document.querySelector('.sm-stage') as HTMLElement;
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      return {
        backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
        fill: cs.backgroundColor,
        shadow: cs.boxShadow,
        beforeImage: before.backgroundImage,
        beforeMask: before.maskImage || before.webkitMaskImage,
        borderWidth: cs.borderTopWidth,
      };
    });

    expect(stage.backdrop).toContain('blur');
    const blurPx = parseFloat(stage.backdrop.match(/blur\(([\d.]+)px\)/)?.[1] ?? '0');
    expect(blurPx, `blur 应 ≥24px，实测 ${blurPx}`).toBeGreaterThanOrEqual(24);
    // 半透明填充（不是不透明色块）
    expect(stage.fill).toMatch(/rgba\(/);
    // 左上白色内发光 = 折射感
    expect(stage.shadow).toContain('inset');
    expect(stage.shadow).toContain('rgba(255, 255, 255');
    // 描边：0 宽 border + 渐变伪元素 + mask 求差
    expect(parseFloat(stage.borderWidth)).toBe(0);
    expect(stage.beforeImage).toContain('gradient');
    expect(stage.beforeMask).toContain('gradient');
    writeFileSync(`${OUT}/glass-surface.json`, JSON.stringify(stage, null, 2), 'utf8');
  });

  test('背景与导航是同一张膜：导航没有自己的背景色与描边', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('.sm-rail');
    const rail = await page.evaluate(() => {
      const el = document.querySelector('.sm-rail') as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        bg: cs.backgroundColor,
        borderRight: cs.borderRightWidth,
        sheet: getComputedStyle(document.querySelector('.sm-liquid-sheet') as HTMLElement)
          .backdropFilter,
      };
    });
    expect(rail.bg).toBe('rgba(0, 0, 0, 0)');
    expect(parseFloat(rail.borderRight)).toBe(0);
    expect(rail.sheet).toContain('blur');
  });
});

test.describe('④ 流体交互', () => {
  test('导航项悬浮是形变（scale + 圆角变化），不是位移', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('.sm-nav-item');
    const tab = page.getByRole('tab', { name: '看板' });
    const read = () =>
      tab.evaluate((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          transform: cs.transform,
          radius: cs.borderTopLeftRadius,
          top: r.top,
          height: r.height,
          hover: el.matches(':hover'),
        };
      });

    // 先把指针挪开：`goto` 之后指针可能恰好落在这一项上，那样「悬浮前」就已经是
    // 悬浮态，前后两次读数相同 —— 这条断言会以「没有变化」的形式假失败。
    await page.mouse.move(640, 520);
    await page.waitForTimeout(300);
    const before = await read();
    await tab.hover();
    /*
     * 等「真的开始形变」，而不是死等一个固定毫秒数。
     *
     * 实测：这一页有 5 个大半径 blur 层 + 全屏 backdrop-filter，合成器排队
     * 之后过渡的**起始帧**会被推后到 ~0.5s（`transition-duration` 只有
     * 180ms）。写死 400ms 会在机器忙的时候假失败 —— 那条断言本来要问的是
     * 「悬浮会不会形变」，不是「多久之内形变」。
     */
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.sm-nav-item:hover') as HTMLElement | null;
        if (!el) return false;
        const t = getComputedStyle(el).transform;
        return t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)';
      },
      undefined,
      { timeout: 4000 },
    );
    const after = await read();

    expect(before.hover, '悬浮前指针不应在这一项上').toBe(false);
    expect(after.hover).toBe(true);
    expect(after.transform, `悬浮后 transform 应离开单位矩阵，实测 ${after.transform}`).not.toBe('none');
    expect(after.transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
    expect(after.radius, `圆角应从胶囊 ${before.radius} 变成更小的值`).not.toBe(before.radius);
    // 形变而非位移：位置不动、尺寸按比例放大。
    expect(Math.abs(after.top - before.top), '位移应≈0（形变而非移动）').toBeLessThan(1.5);
    expect(after.height).toBeGreaterThan(before.height);
  });

  test('页面切换：淡入 + 上浮 + 模糊收敛，且 300–380ms', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForSelector('.sm-page-in');
    const anim = await page.evaluate(() => {
      const el = document.querySelector('.sm-page-in') as HTMLElement;
      const cs = getComputedStyle(el);
      return { name: cs.animationName, duration: cs.animationDuration };
    });
    expect(anim.name).toBe('sm-liquid-page-in');
    const ms = parseFloat(anim.duration) * 1000;
    expect(ms).toBeGreaterThanOrEqual(300);
    expect(ms).toBeLessThanOrEqual(380);
  });
});

/* ============================ 对比度 ============================ */

type Sample = { text: string; ratio: number; color: string; bg: string; size: number };

const AA_BODY = 4.5;
const AA_LARGE = 3;

test.describe('对比度（两套主题逐页取样）', () => {
  const PAGES = [
    ['home', '/'],
    ['board', '/board'],
    ['placement', '/placement'],
    ['skills', '/skills'],
    ['database', '/database'],
  ] as const;

  for (const theme of ['dark', 'light'] as const) {
    for (const [name, path] of PAGES) {
      test(`对比度 @ ${name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.addInitScript(pin(theme));
        await page.goto(path);
        await page.waitForTimeout(1600);

        const samples: Sample[] = await page.evaluate(() => {
          const toRgb = (value: string): [number, number, number, number] => {
            const m = value.match(/rgba?\(([^)]+)\)/);
            if (!m?.[1]) return [0, 0, 0, 1];
            const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
            return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
          };
          /** 沿祖先链找第一个非全透明背景，按 alpha 与下一层混合。 */
          const bgOf = (el: Element): [number, number, number] => {
            const stack: Array<[number, number, number, number]> = [];
            let node: Element | null = el;
            while (node) {
              const c = toRgb(getComputedStyle(node).backgroundColor);
              if (c[3] > 0) {
                stack.push(c);
                if (c[3] >= 0.999) break;
              }
              node = node.parentElement;
            }
            // 兜底：画布色
            let base: [number, number, number] = [11, 11, 15];
            for (let i = stack.length - 1; i >= 0; i -= 1) {
              const [r, g, b, a] = stack[i] as [number, number, number, number];
              base = [
                r * a + base[0] * (1 - a),
                g * a + base[1] * (1 - a),
                b * a + base[2] * (1 - a),
              ];
            }
            return base;
          };
          const lum = ([r, g, b]: [number, number, number]): number => {
            const ch = [r, g, b].map((v) => {
              const s = v / 255;
              return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            }) as [number, number, number];
            return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
          };
          const ratio = (a: [number, number, number], b: [number, number, number]): number => {
            const la = lum(a);
            const lb = lum(b);
            return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
          };

          const out: Array<{ text: string; ratio: number; color: string; bg: string; size: number }> = [];
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
            // 只看直接承载文本的元素
            const own = Array.from(el.childNodes)
              .filter((n) => n.nodeType === Node.TEXT_NODE)
              .map((n) => (n.textContent ?? '').trim())
              .join('');
            if (own.length < 2) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 4 || rect.height < 4) continue;
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            const fg = toRgb(cs.color);
            const fgRgb: [number, number, number] = [fg[0], fg[1], fg[2]];
            const bg = bgOf(el);
            out.push({
              text: own.slice(0, 18),
              ratio: Math.round(ratio(fgRgb, bg) * 100) / 100,
              color: cs.color,
              bg: `rgb(${bg.map((v) => Math.round(v)).join(',')})`,
              size: parseFloat(cs.fontSize),
            });
          }
          return out;
        });

        const fails = samples.filter((s) => {
          const need = s.size >= 18.66 ? AA_LARGE : AA_BODY;
          return s.ratio < need;
        });
        const min = samples.reduce((acc, s) => Math.min(acc, s.ratio), Number.POSITIVE_INFINITY);
        writeFileSync(
          `${OUT}/contrast-${name}-${theme}.json`,
          JSON.stringify({ min, count: samples.length, fails, samples: samples.slice(0, 60) }, null, 2),
          'utf8',
        );
        expect(samples.length, `${name}/${theme} 没取到文本样本`).toBeGreaterThan(3);
        expect(
          fails,
          `${name}/${theme} 有 ${fails.length} 处低于 AA：${JSON.stringify(fails.slice(0, 5))}`,
        ).toHaveLength(0);
        expect(min, `${name}/${theme} 最小比值 ${min}`).toBeGreaterThanOrEqual(AA_BODY);
      });
    }
  }
});
