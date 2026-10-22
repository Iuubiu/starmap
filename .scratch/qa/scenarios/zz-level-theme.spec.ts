/**
 * t63 验收探针：关卡页的两套主题 + 「对错不只靠色相」。
 *
 * 回答四个问题，全部基于**真实的 computed style 与真实的交互**：
 *
 * 1. **两套主题下七段全链路都能读**：引导 → 展示细节 → 简单问题 → 深究 →
 *    进一步讲解 → 判定 → 小结，每段出图，人眼可复核。
 * 2. **对/错不只靠色相**：反馈条的图标、左侧 3px 竖条、文字三条通道同时在，
 *    且图标**不在 `aria-hidden` 里**（读屏要能念出来）。
 * 3. **对比度真的达标**：从 DOM 取**渲染后**的颜色（不是从 token 文件抄一遍），
 *    按 WCAG 2.1 现算，判据是「两套主题下最差的那一对」。
 * 4. **字面 hex 没有回流**到 `apps/web/src/level/` 与 `LevelPage.tsx`。
 *
 * ## 为什么第 3 条要从 DOM 取色
 *
 * t63 开工时发现 `skills/web-design-engineer/references/contrast-check.mjs`
 * 自带一份手抄 palette，与 `apps/web/src/theme/tokens.ts` 漂移了 47/52 个键
 * （深）/ 39/52（亮），于是它 `TOTAL FAILURES: 0` 全绿，而屏幕上早就不达标了。
 * 这里改成读渲染结果，与那个脚本互为独立的第二意见：那个查「规范对不对」，
 * 这个查「屏幕对不对」。
 *
 * ## 为什么每条用例都自己设档位
 *
 * 档位（P1/P2/P3）是**全站共享的一份服务端状态**，不是每页一份。不显式设置
 * 就会读到上一条用例留下的值 —— 实测过一次：P3 遗留让「简单问题」段直接从
 * 第 3 段开始，于是「走完七段」的断言只数到 1 段。
 */
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.use({ viewport: { width: 1280, height: 800 } });

const LEVEL = 'lv-bool-laws';
const SHOTS = '../../.scratch/qa/shots';

/** 切档位。脚本会一次事务改 tier + status + attempts_baseline 三列。 */
function setTier(tier: 'P1' | 'P2' | 'P3'): void {
  execFileSync('node', ['../../.scratch/demo-set-tier.mjs', tier], { cwd: process.cwd(), stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// 从 DOM 取色 + WCAG 2.1（在浏览器里算，避免把颜色字符串搬回 Node 再解析）
// ---------------------------------------------------------------------------

interface Measured {
  name: string;
  ratio: number;
  fg: string;
  bg: string;
  min: number;
}

interface PairDef {
  name: string;
  /** 前景元素选择器。 */
  selector: string;
  /** `text` = 文字色对背景；`border-left` / `border-top` = 边框色对背景。 */
  what: 'text' | 'border-left' | 'border-top';
  min: number;
  /** 背景取样点：默认用前景元素自身的有效背景；`page` 表示沿 DOM 往上找页面底。 */
  bgFrom?: 'self' | 'parent';
}

async function measure(page: Page, defs: PairDef[]): Promise<Measured[]> {
  return page.evaluate((list) => {
    const rgbOf = (value: string) => {
      const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(value);
      if (!m) return null;
      return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4]! };
    };
    const over = (
      fg: { r: number; g: number; b: number; a: number },
      bg: { r: number; g: number; b: number },
    ) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const lum = (c: { r: number; g: number; b: number }) => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    };
    const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
      (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    /** 沿 DOM 往上把半透明背景层层合成，直到遇到不透明的一层。 */
    const effectiveBg = (el: Element | null) => {
      const stack: { r: number; g: number; b: number; a: number }[] = [];
      let node: Element | null = el;
      while (node) {
        const c = rgbOf(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) {
          stack.push(c);
          if (c.a >= 1) break;
        }
        node = node.parentElement;
      }
      let acc = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i -= 1) acc = { ...over(stack[i]!, acc), a: 1 };
      return acc;
    };

    const out: Array<{ name: string; ratio: number; fg: string; bg: string; min: number }> = [];
    for (const def of list) {
      const el = document.querySelector(def.selector);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const raw =
        def.what === 'text'
          ? rgbOf(cs.color)
          : rgbOf(def.what === 'border-left' ? cs.borderLeftColor : cs.borderTopColor);
      if (!raw) continue;
      const bg = effectiveBg(def.bgFrom === 'parent' ? el.parentElement : el);
      const fg = over(raw, bg);
      out.push({
        name: def.name,
        ratio: Math.round(ratio(fg, bg) * 100) / 100,
        fg: `rgb(${Math.round(fg.r)}, ${Math.round(fg.g)}, ${Math.round(fg.b)})`,
        bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        min: def.min,
      });
    }
    return out;
  }, defs);
}

// ---------------------------------------------------------------------------
// 驱动关卡
// ---------------------------------------------------------------------------

async function openLevel(page: Page, theme: 'dark' | 'light', tier: 'P1' | 'P2' | 'P3' = 'P1'): Promise<void> {
  setTier(tier);
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((value) => localStorage.setItem('starmap.theme', value), theme);
  await page.goto(`/level/${LEVEL}`);
  await expect(page.locator('body')).toContainText(/第 \d+ 段 · /, { timeout: 60_000 });
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-sm-theme')), { timeout: 10_000 })
    .toBe(theme);
}

async function currentSegment(page: Page): Promise<{ index: number; name: string }> {
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const m = /第 (\d+) 段 · ([^\s·]+)/.exec(text);
  if (!m) throw new Error('找不到段标题');
  return { index: Number(m[1]), name: m[2]! };
}

/**
 * 把本段**每一道题**都答掉。
 *
 * 两次踩坑都记在这里，因为它们是同一个反直觉：
 *
 * 1. 第一版只反复点「页面上第一个『提交答案』」，第一题答完锁定后按钮变
 *    disabled，循环立刻 break，第二题没答 —— `isStepComplete` 要求
 *    `step.itemIds` 里每个都有选择，于是「进入下一段」一直 disabled，
 *    七段只走到第三段。
 * 2. 第二版改成「先看按钮 enabled 再点」，结果**一道题都没答**：Fluent 的
 *    提交按钮在**还没选选项时就是 disabled 的**（`canSubmit` 依赖
 *    `draftChoice !== undefined`）。所以顺序必须是「先选选项，按钮才会亮」。
 *
 * 现在：每轮重新枚举所有「提交答案」，对每个找到它所在 Card 里的选项，
 * **先点选项**，再看按钮是否可点。`pick` 决定选第一个还是最后一个
 * （后者制造错答）。
 */
async function answerSegment(page: Page, pick: 'first' | 'last'): Promise<number> {
  let done = 0;
  for (let guard = 0; guard < 24; guard += 1) {
    const submits = page.locator('button:has-text("提交答案")');
    const count = await submits.count();
    let acted = false;
    for (let i = 0; i < count; i += 1) {
      const btn = submits.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      // 这道题自己的 Card：从按钮往上找最近的 fui-Card，避免点到别题的选项
      const card = btn.locator('xpath=ancestor::div[contains(@class,"fui-Card")][1]');
      const radios = card.getByRole('radio');
      const total = await radios.count();
      if (total === 0) continue;
      // 已提交且锁定：选项点不动，按钮也不会亮 —— 跳过这道题
      const first = radios.nth(pick === 'first' ? 0 : total - 1);
      await first.click();
      await page.waitForTimeout(60);
      if (!(await btn.isEnabled().catch(() => false))) continue;
      await btn.click();
      done += 1;
      acted = true;
      await page.waitForTimeout(120);
      break;
    }
    if (!acted) break;
  }
  return done;
}

async function nextSegment(page: Page): Promise<boolean> {
  const next = page.locator('button:has-text("进入下一段")');
  if ((await next.count()) === 0) return false;
  if (!(await next.isEnabled().catch(() => false))) return false;
  await next.click();
  await page.waitForTimeout(200);
  return true;
}

// ---------------------------------------------------------------------------
// 用例 1：两套主题下走完七段，每段出图
// ---------------------------------------------------------------------------

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}：七段全链路可读并出图`, async ({ page }) => {
    await openLevel(page, theme, 'P1');

    const scenes: Array<{ index: number; name: string }> = [];
    let summaryReached = false;
    for (let guard = 0; guard < 10; guard += 1) {
      let seg: { index: number; name: string };
      try {
        seg = await currentSegment(page);
      } catch {
        /**
         * 第 7 段（小结）**没有段标题**：`LevelPage` 在
         * `flow.finished || step.kind === 'summary'` 时直接渲染结算面板，
         * 不再渲染「第 N 段 · 小结」那一行（注释写明是为了避免同一张小结卡
         * 出现两次）。所以「读不到段标题」在这里不是失败，而是**到达终点**
         * 的信号 —— 结算面板本身就是第七段。
         */
        summaryReached = true;
        await page.screenshot({ path: `${SHOTS}/theme-level-7-小结-${theme}.png` });
        break;
      }
      scenes.push(seg);
      await page.screenshot({ path: `${SHOTS}/theme-level-${seg.index}-${seg.name}-${theme}.png` });

      /**
       * **「简单问题」段故意答错**：答对会跳过「深究 + 进一步讲解」两段
       * （`flow.ts` 的 `advance` 里那条 skipped 逻辑），那样七段只看得到
       * 五段。走补救分支才能把七段走全 —— 这正是「七段全链路」要验的形态。
       */
      await answerSegment(page, seg.name === '简单问题' ? 'last' : 'first');
      if (!(await nextSegment(page))) break;
    }

    const names = scenes.map((s) => s.name);
    console.log(`SCENES ${theme} ${JSON.stringify({ scenes, summaryReached })}`);
    expect(summaryReached, `没走到小结段，只走了 ${JSON.stringify(scenes)}`).toBe(true);
    for (const expected of ['引导', '展示细节', '简单问题', '深究', '进一步讲解', '判定']) {
      expect(names, `缺少「${expected}」段，实际 ${JSON.stringify(names)}`).toContain(expected);
    }
  });
}

// ---------------------------------------------------------------------------
// 用例 2：对/错不只靠色相
// ---------------------------------------------------------------------------

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}：对/错有三条非颜色通道`, async ({ page }) => {
    // P1：每题提交后立刻给反馈（P3 会把反馈收到整段末尾，验不了单条反馈条）
    await openLevel(page, theme, 'P1');

    // 走到「简单问题」段
    for (let guard = 0; guard < 4; guard += 1) {
      const seg = await currentSegment(page);
      if (seg.name === '简单问题') break;
      await answerSegment(page, 'first');
      expect(await nextSegment(page), '走不到「简单问题」段').toBe(true);
    }
    expect((await currentSegment(page)).name).toBe('简单问题');

    // 答**错**：选最后一个选项（正确答案是第 1 个）
    const radios = page.getByRole('radio');
    const total = await radios.count();
    expect(total, '「简单问题」段没有选项题').toBeGreaterThan(1);
    await radios.nth(total - 1).click();
    await page.locator('button:has-text("提交答案")').first().click();

    const icon = page.locator('svg[aria-label="没答对"]').first();
    await expect(icon).toBeVisible({ timeout: 10_000 });

    const facts = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label="没答对"]');
      if (!svg) return null;
      // 反馈条 = 图标往上第一个有背景色的祖先
      let bar: HTMLElement | null = svg.parentElement as HTMLElement | null;
      while (bar && getComputedStyle(bar).backgroundColor === 'rgba(0, 0, 0, 0)') bar = bar.parentElement;
      if (!bar) return null;
      const cs = getComputedStyle(bar);
      return {
        barText: (bar.textContent ?? '').slice(0, 60),
        borderLeftWidth: cs.borderLeftWidth,
        borderLeftStyle: cs.borderLeftStyle,
        borderTopWidth: cs.borderTopWidth,
        borderTopStyle: cs.borderTopStyle,
        barBg: cs.backgroundColor,
        iconLabel: svg.getAttribute('aria-label'),
        iconRole: svg.getAttribute('role'),
        iconInAriaHidden: svg.closest('[aria-hidden="true"]') !== null,
      };
    });

    console.log(`FEEDBACK ${theme} ${JSON.stringify(facts)}`);
    expect(facts, '没有找到反馈条').not.toBeNull();
    // ① 内容通道：判词在文字里
    expect(facts!.barText).toContain('没答对');
    // ② 图标通道：在、能朗读、不在 aria-hidden 里
    expect(facts!.iconInAriaHidden, '图标还在 aria-hidden 里，读屏拿不到').toBe(false);
    expect(facts!.iconRole).toBe('img');
    expect(facts!.iconLabel).toBe('没答对');
    // ③ 形状通道：左侧 3px 实线竖条，且比顶部边框粗（不是整圈同色）
    expect(parseFloat(facts!.borderLeftWidth), '左侧竖条不是 3px').toBeGreaterThanOrEqual(3);
    expect(facts!.borderLeftStyle).toBe('solid');
    expect(parseFloat(facts!.borderLeftWidth)).toBeGreaterThan(parseFloat(facts!.borderTopWidth));
    // 竖条与边框同色（同一个语义色），否则「加粗」读起来像两种语义
    await page.screenshot({ path: `${SHOTS}/theme-level-feedback-wrong-${theme}.png` });

    /*
     * 验收第 6 条：**「答错」反馈条的边框在两套主题下都 ≥3:1**。
     *
     * 这里量的是浏览器算完后的真实颜色，不是 token 表里的字面值 ——
     * 两者会分叉的典型场景：`theme.ts` 把某个 Fluent 键映射到了另一组
     * palette 值，或者某处 `var()` 没解析成功而静默回落。token 层的
     * 断言在 `skills/web-design-engineer/references/contrast-check.mjs`
     * 里已经有一条（`warning-border` 对三种底），这里是同一判据在
     * 真实 DOM 上的复核，两条都要绿才算数。
     *
     * 三个底与脚本口径一致：条自身填充（`barBg`）、卡片底、页面底。
     */
    const borderPairs = await page.evaluate(() => {
      const rgbOf = (value: string) => {
        const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(value);
        if (!m) return null;
        return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4]! };
      };
      const over = (
        fg: { r: number; g: number; b: number; a: number },
        bg: { r: number; g: number; b: number },
      ) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) });
      const lum = (c: { r: number; g: number; b: number }) => {
        const ch = (v: number) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
      };
      const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
        Math.round(((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)) * 100) / 100;
      const effectiveBg = (el: Element | null) => {
        const stack: { r: number; g: number; b: number; a: number }[] = [];
        let node: Element | null = el;
        while (node) {
          const c = rgbOf(getComputedStyle(node).backgroundColor);
          if (c && c.a > 0) {
            stack.push(c);
            if (c.a >= 1) break;
          }
          node = node.parentElement;
        }
        let acc = { r: 255, g: 255, b: 255 };
        for (let i = stack.length - 1; i >= 0; i -= 1) acc = over(stack[i]!, acc);
        return acc;
      };

      const svg = document.querySelector('svg[aria-label="没答对"]');
      if (!svg) return null;
      let bar: HTMLElement | null = svg.parentElement as HTMLElement | null;
      while (bar && getComputedStyle(bar).backgroundColor === 'rgba(0, 0, 0, 0)') bar = bar.parentElement;
      if (!bar) return null;
      const barBg = effectiveBg(bar);
      const pageBg = effectiveBg(document.body);
      const rawBorder = rgbOf(getComputedStyle(bar).borderLeftColor);
      if (!rawBorder) return null;
      const border = over(rawBorder, pageBg);
      return {
        borderLeftColor: getComputedStyle(bar).borderLeftColor,
        vsBarFill: ratio(border, barBg),
        vsPageCanvas: ratio(border, pageBg),
        barBg: `rgb(${Math.round(barBg.r)}, ${Math.round(barBg.g)}, ${Math.round(barBg.b)})`,
        pageBg: `rgb(${Math.round(pageBg.r)}, ${Math.round(pageBg.g)}, ${Math.round(pageBg.b)})`,
      };
    });
    console.log(`WRONG-BORDER ${theme} ${JSON.stringify(borderPairs)}`);
    expect(borderPairs, '没有量到答错反馈条的边框').not.toBeNull();
    expect(
      borderPairs!.vsBarFill,
      `答错反馈条边框对自己填充只有 ${borderPairs!.vsBarFill}:1（要求 ≥3）border=${borderPairs!.borderLeftColor} barBg=${borderPairs!.barBg}`,
    ).toBeGreaterThanOrEqual(3);
    expect(
      borderPairs!.vsPageCanvas,
      `答错反馈条边框对页面底只有 ${borderPairs!.vsPageCanvas}:1（要求 ≥3）border=${borderPairs!.borderLeftColor} pageBg=${borderPairs!.pageBg}`,
    ).toBeGreaterThanOrEqual(3);

    // 答**对**的那条：换个新页面重走一遍，验图标与竖条同样存在
    await page.goto(`/level/${LEVEL}`);
    await expect(page.locator('body')).toContainText(/第 \d+ 段 · /, { timeout: 30_000 });
    for (let guard = 0; guard < 4; guard += 1) {
      const seg = await currentSegment(page);
      if (seg.name === '简单问题') break;
      await answerSegment(page, 'first');
      expect(await nextSegment(page)).toBe(true);
    }
    await page.getByRole('radio').first().click();
    await page.locator('button:has-text("提交答案")').first().click();
    const okIcon = page.locator('svg[aria-label="答对"]').first();
    await expect(okIcon).toBeVisible({ timeout: 10_000 });
    const okFacts = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label="答对"]');
      if (!svg) return null;
      let bar: HTMLElement | null = svg.parentElement as HTMLElement | null;
      while (bar && getComputedStyle(bar).backgroundColor === 'rgba(0, 0, 0, 0)') bar = bar.parentElement;
      if (!bar) return null;
      const cs = getComputedStyle(bar);
      return {
        borderLeftWidth: cs.borderLeftWidth,
        borderTopWidth: cs.borderTopWidth,
        iconInAriaHidden: svg.closest('[aria-hidden="true"]') !== null,
      };
    });
    console.log(`FEEDBACK-OK ${theme} ${JSON.stringify(okFacts)}`);
    expect(okFacts, '没有找到答对的反馈条').not.toBeNull();
    expect(okFacts!.iconInAriaHidden).toBe(false);
    expect(parseFloat(okFacts!.borderLeftWidth)).toBeGreaterThanOrEqual(3);
    expect(parseFloat(okFacts!.borderLeftWidth)).toBeGreaterThan(parseFloat(okFacts!.borderTopWidth));
    await page.screenshot({ path: `${SHOTS}/theme-level-feedback-correct-${theme}.png` });
  });
}

// ---------------------------------------------------------------------------
// 用例 3：对比度实测（两套主题各一组，最差值必须达标）
// ---------------------------------------------------------------------------

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}：关卡页关键配对的实测对比度`, async ({ page }) => {
    await openLevel(page, theme, 'P1');
    /**
     * 先走到「简单问题」段再量：第 1 段（引导）时 StepRail 上还没有
     * `[data-status="done"]` 的 chip，量出来的配对少一对，断言数会莫名其妙
     * 地飘。到了第 3 段，已完成 / 当前 / 未开始三态同时在场，才是这条用例
     * 真正想覆盖的形态。
     */
    for (let guard = 0; guard < 4; guard += 1) {
      const seg = await currentSegment(page);
      if (seg.name === '简单问题') break;
      await answerSegment(page, 'first');
      expect(await nextSegment(page), '走不到「简单问题」段').toBe(true);
    }
    expect((await currentSegment(page)).name).toBe('简单问题');

    const pairs = await measure(page, [
      { name: 'StepRail 当前段文字', selector: '[data-status="current"]', what: 'text', min: 4.5 },
      { name: 'StepRail 未开始文字', selector: '[data-status="upcoming"]', what: 'text', min: 4.5 },
      { name: 'StepRail 已完成文字', selector: '[data-status="done"]', what: 'text', min: 4.5 },
      { name: 'StepRail 未开始描边', selector: '[data-status="upcoming"]', what: 'border-top', min: 3, bgFrom: 'parent' },
      { name: 'StepRail 已完成描边', selector: '[data-status="done"]', what: 'border-top', min: 3, bgFrom: 'parent' },
    ]);

    console.log(`CONTRAST ${theme} ${JSON.stringify(pairs, null, 1)}`);
    expect(pairs.length, '没有量到全部五对').toBe(5);
    for (const p of pairs) {
      expect(
        p.ratio,
        `${p.name} 只有 ${p.ratio}:1（要求 ≥${p.min}）fg=${p.fg} bg=${p.bg}`,
      ).toBeGreaterThanOrEqual(p.min);
    }
  });
}

// ---------------------------------------------------------------------------
// 用例 4：跳过态与反馈条的对比度（需要走完 probe 才知道跳过态长什么样）
// ---------------------------------------------------------------------------

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}：跳过态与反馈条对比度`, async ({ page }) => {
    await openLevel(page, theme, 'P1');
    // 走到「简单问题」并答对 → probe 通过 → 后面两段被标记为跳过
    for (let guard = 0; guard < 4; guard += 1) {
      const seg = await currentSegment(page);
      if (seg.name === '简单问题') break;
      await answerSegment(page, 'first');
      await nextSegment(page);
    }
    await page.getByRole('radio').first().click();
    await page.locator('button:has-text("提交答案")').first().click();
    await expect(page.locator('svg[aria-label="答对"]').first()).toBeVisible({ timeout: 10_000 });

    const feedback = await measure(page, [
      { name: '答对反馈条文字', selector: 'svg[aria-label="答对"]', what: 'text', min: 4.5, bgFrom: 'parent' },
    ]);

    // 进到下一段（判定），StepRail 上应出现 skipped
    expect(await nextSegment(page), 'probe 答对后没有进入下一段').toBe(true);
    const hasSkipped = await page.locator('[data-status="skipped"]').count();
    const skipped =
      hasSkipped > 0
        ? await measure(page, [
            { name: '跳过态文字', selector: '[data-status="skipped"]', what: 'text', min: 4.5 },
            { name: '跳过态描边', selector: '[data-status="skipped"]', what: 'border-top', min: 3, bgFrom: 'parent' },
          ])
        : [];

    console.log(`CONTRAST2 ${theme} ${JSON.stringify({ feedback, skipped, hasSkipped })}`);
    expect(feedback.length, '没有量到反馈条文字').toBe(1);
    for (const p of [...feedback, ...skipped]) {
      expect(p.ratio, `${p.name} 只有 ${p.ratio}:1（要求 ≥${p.min}）fg=${p.fg} bg=${p.bg}`).toBeGreaterThanOrEqual(p.min);
    }
    expect(hasSkipped, 'probe 答对后 StepRail 上没有跳过态').toBeGreaterThan(0);
  });
}

// ---------------------------------------------------------------------------
// 用例 6：选项三态与焦点环（验收 6 / 7）
// ---------------------------------------------------------------------------

/**
 * 选项三态必须**靠边界就能分辨**，而且边界对底 ≥3:1。
 *
 * ## 为什么要读 `.fui-Radio` 外层而不是 `[data-option-state]` 那个元素
 *
 * `data-option-state` 是我们透传的未知 props，Fluent 把它落在**内层
 * `<input type="radio">`** 上；而 `styles.option` 的边框画在**外层
 * `.fui-Radio`** 上。第一版探针读 input，得到 `0px none`，误判「样式没生效」。
 *
 * ## 为什么禁用态也要量
 *
 * `optionLocked` 刻意不用低对比度的禁用色，而是用虚线边框（形状通道）+
 * `text-secondary`。WCAG 1.4.11 对禁用控件本可豁免，本仓不豁免 —— 交卷后
 * 「我刚才选了哪个」正是最该看清的信息。
 */
for (const theme of ['dark', 'light'] as const) {
  test(`${theme}：选项三态与焦点环`, async ({ page }) => {
    await openLevel(page, theme, 'P1');
    for (let guard = 0; guard < 4; guard += 1) {
      const seg = await currentSegment(page);
      if (seg.name === '简单问题') break;
      await answerSegment(page, 'first');
      expect(await nextSegment(page), '走不到「简单问题」段').toBe(true);
    }
    expect((await currentSegment(page)).name).toBe('简单问题');

    /** 读某个状态下的真实边框/底色/文字色，并在页内算对比度。 */
    const readState = (state: 'idle' | 'selected') =>
      page.evaluate((tag) => {
        const input = document.querySelector(`[data-option-state="${tag}"]`);
        if (!input) return null;
        const wrap = input.closest('.fui-Radio');
        if (!wrap) return { error: 'no .fui-Radio wrapper' };
        const rgbOf = (value: string) => {
          const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(value);
          if (!m) return null;
          return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4]! };
        };
        const over = (fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number }) => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
          a: 1,
        });
        const lum = (c: { r: number; g: number; b: number }) => {
          const ch = (v: number) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
        };
        const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
          (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
        /** 沿 DOM 往上合成，直到遇到不透明底。 */
        const effectiveBg = (el: Element) => {
          const stack: { r: number; g: number; b: number; a: number }[] = [];
          let node: Element | null = el;
          while (node) {
            const c = rgbOf(getComputedStyle(node).backgroundColor);
            if (c && c.a > 0) {
              stack.push(c);
              if (c.a >= 1) break;
            }
            node = node.parentElement;
          }
          let acc = { r: 255, g: 255, b: 255, a: 1 };
          for (let i = stack.length - 1; i >= 0; i -= 1) acc = { ...over(stack[i]!, acc), a: 1 };
          return acc;
        };
        const cs = getComputedStyle(wrap);
        const bg = effectiveBg(wrap);
        const border = over(rgbOf(cs.borderTopColor) ?? { r: 0, g: 0, b: 0, a: 1 }, bg);
        const text = over(rgbOf(cs.color) ?? { r: 0, g: 0, b: 0, a: 1 }, bg);
        const round = (n: number) => Math.round(n * 100) / 100;
        return {
          state: tag,
          borderStyle: cs.borderTopStyle,
          border: `rgb(${Math.round(border.r)}, ${Math.round(border.g)}, ${Math.round(border.b)})`,
          bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
          borderVsBg: round(ratio(border, bg)),
          textVsBg: round(ratio(text, bg)),
        };
      }, state);

    const idle = await readState('idle');
    await page.getByRole('radio').first().click();
    await page.waitForTimeout(150);
    const selected = await readState('selected');

    /**
     * 焦点环：按 Tab 走到第一个 radio。读的是**浏览器 UA 的 outline**
     * （Fluent 在 wrapper 上 `outline-style: none`，环画在 input 上）。
     * 深色下 UA 环能翻白，前提是主题设了 `color-scheme: dark` —— 这条断言
     * 同时守住了那个前提。
     */
    await page.locator('h1').first().click();
    let focused = false;
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return Boolean(a && a.tagName === 'INPUT' && (a as HTMLInputElement).type === 'radio');
      });
      if (focused) break;
    }
    const ring = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return null;
      const cs = getComputedStyle(a);
      const rgbOf = (value: string) => {
        const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(value);
        if (!m) return null;
        return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4]! };
      };
      const lum = (c: { r: number; g: number; b: number }) => {
        const ch = (v: number) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
      };
      const ratio = (a2: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
        (Math.max(lum(a2), lum(b)) + 0.05) / (Math.min(lum(a2), lum(b)) + 0.05);
      let node: Element | null = a;
      let bg = { r: 255, g: 255, b: 255 };
      while (node) {
        const c = rgbOf(getComputedStyle(node).backgroundColor);
        if (c && c.a >= 1) {
          bg = c;
          break;
        }
        node = node.parentElement;
      }
      const ringColor = rgbOf(cs.outlineColor);
      return {
        outline: cs.outline,
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        ringVsBg: ringColor ? Math.round(ratio(ringColor, bg) * 100) / 100 : 0,
      };
    });

    // 交卷 → 锁定态
    await page.locator('button:has-text("提交答案")').first().click().catch(() => {});
    await page.waitForTimeout(300);
    const locked = await readState('selected');

    console.log(`OPTIONS ${theme} ${JSON.stringify({ idle, selected, locked, ring }, null, 1)}`);

    for (const s of [idle, selected, locked]) {
      expect(s, `${theme} 没读到某个选项态`).not.toBeNull();
      expect(s && 'error' in s, `${theme} 读不到 .fui-Radio 外层`).toBe(false);
      if (!s || 'error' in s) continue;
      expect(s.borderVsBg, `${theme} ${s.state} 态边界只有 ${s.borderVsBg}:1（要求 ≥3）border=${s.border} bg=${s.bg}`).toBeGreaterThanOrEqual(3);
      expect(s.textVsBg, `${theme} ${s.state} 态文字只有 ${s.textVsBg}:1（要求 ≥4.5）`).toBeGreaterThanOrEqual(4.5);
    }
    // 三态必须**靠形状也能分**：锁定态是虚线，另两态实线。
    expect(locked && !('error' in locked) ? locked.borderStyle : '', '锁定态没有用虚线（形状通道）').toBe('dashed');
    expect(idle && !('error' in idle) ? idle.borderStyle : '', '未选中态不该是虚线').toBe('solid');

    expect(focused, 'Tab 走不到选项 radio').toBe(true);
    expect(ring, '读不到焦点环').not.toBeNull();
    if (ring) {
      expect(ring.outlineStyle, `焦点环被清掉了（outline-style=${ring.outlineStyle}）`).not.toBe('none');
      expect(ring.ringVsBg, `焦点环只有 ${ring.ringVsBg}:1（要求 ≥3）`).toBeGreaterThanOrEqual(3);
      // 验收 7 的前提：深色主题必须设 color-scheme: dark，UA 环才会翻白。
      expect(ring.colorScheme, `color-scheme 不是 ${theme}，UA 焦点环不会跟着换色`).toBe(theme);
    }
  });
}

// ---------------------------------------------------------------------------
// 用例 7：票面第 11 条点名的八张图
// ---------------------------------------------------------------------------

/**
 * 上面那些用例的截图是按「第 N 段 · 段名」命名的（`theme-level-1-引导-dark.png`），
 * 便于按段落顺序复核；但票面第 11 条点名要的是**按语义命名**的八张：
 *
 *     .scratch/qa/shots/leveltheme-<dark|light>-<question|feedback-right|feedback-wrong|summary>.png
 *
 * 两者不是重复：段名命名回答「七段各长什么样」，语义命名回答「同一屏在两套
 * 主题下是否成立」—— 后者才是评审要逐张对照看的那一组（把 dark 与 light
 * 的同名文件并排放，差异一眼可见）。所以这里单独出图，不做任何断言之外的
 * 副作用：每张图都发生在**断言已经确认该状态确实渲染出来之后**，不是
 * 「先截图再碰运气」。
 */
for (const theme of ['dark', 'light'] as const) {
  test(`${theme}：票面点名的四张图`, async ({ page }) => {
    /** 走到「简单问题」段 —— 这是全页唯一同时有题干、选项、反馈条的位置。 */
    const toProbe = async (): Promise<void> => {
      for (let guard = 0; guard < 4; guard += 1) {
        const seg = await currentSegment(page);
        if (seg.name === '简单问题') break;
        await answerSegment(page, 'first');
        expect(await nextSegment(page), '走不到「简单问题」段').toBe(true);
      }
      expect((await currentSegment(page)).name).toBe('简单问题');
    };

    // ① question：还没作答的干净形态（选项未选中、无反馈条）
    await openLevel(page, theme, 'P1');
    await toProbe();
    await page.screenshot({ path: `${SHOTS}/leveltheme-${theme}-question.png` });

    /**
     * 反馈条渲染在**选项下方**，1280×800 的首屏里它压在折线以下；更麻烦的是
     * 关卡页底部有一条 sticky 的「进入下一段」工具条，`scrollIntoViewIfNeeded`
     * 只保证元素在滚动容器可见区内，**不躲这条覆盖层** —— 第一版出图时两张
     * 反馈条正好被工具条压掉一半。这里改成 `block: 'center'`：把它放到视口
     * 正中，远离底部工具条。这张图要证明的是「反馈条本身长什么样」，不是
     * 「它在第几屏」。
     */
    const showFeedback = async (label: '答对' | '没答对'): Promise<void> => {
      const icon = page.locator(`svg[aria-label="${label}"]`).first();
      await expect(icon).toBeVisible({ timeout: 10_000 });
      await icon.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await page.waitForTimeout(250);
    };

    // ② feedback-right：答对后的反馈条
    await page.getByRole('radio').first().click();
    await page.locator('button:has-text("提交答案")').first().click();
    await showFeedback('答对');
    await page.screenshot({ path: `${SHOTS}/leveltheme-${theme}-feedback-right.png` });

    // ③ feedback-wrong：答错后的反馈条（新开一页，上一题已经锁定，改不了答案）
    await openLevel(page, theme, 'P1');
    await toProbe();
    const radios = page.getByRole('radio');
    const total = await radios.count();
    expect(total, '「简单问题」段没有选项题').toBeGreaterThan(1);
    await radios.nth(total - 1).click();
    await page.locator('button:has-text("提交答案")').first().click();
    await showFeedback('没答对');
    await page.screenshot({ path: `${SHOTS}/leveltheme-${theme}-feedback-wrong.png` });

    // ④ summary：小结面板（证据卡 + 掌握度双字段 + 门控面板都在这一屏）
    await openLevel(page, theme, 'P1');
    let reached = false;
    for (let guard = 0; guard < 10; guard += 1) {
      try {
        await currentSegment(page);
      } catch {
        // 第 7 段没有段标题：`flow.finished` 时直接渲染结算面板（见用例 1 的注释）
        reached = true;
        break;
      }
      await answerSegment(page, 'first');
      if (!(await nextSegment(page))) break;
    }
    expect(reached, '没走到小结段').toBe(true);
    await expect(page.getByText('本关小结').first()).toBeVisible({ timeout: 10_000 });
    /**
     * 小结要**从头看**：上面的反馈条滚动位置会残留，第一版出图时标题
     * 「本关小结」被顶出视口，图里第一行是半截卡片。
     */
    await page.getByText('本关小结').first().evaluate((el) => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/leveltheme-${theme}-summary.png` });
  });
}

// ---------------------------------------------------------------------------
// 用例 8：小结面板的三层级、门控面板、公式、以及亮主题的深色残留块
// ---------------------------------------------------------------------------

/**
 * 小结那一屏是关卡页信息密度最高的地方：本关证据卡的四个数、掌握度双字段、
 * 出口门控面板全挤在一起。前面几条用例只把它当「能走到」的终点，这条专门量
 * 它**读不读得清**。
 *
 * ## 为什么按可见文字定位而不是按 class
 *
 * `makeStyles` 产出的类名是原子类（`f1x2y3z` 这种），跨组件共享且随构建变化，
 * 拿它当选择器会在下次改样式时静默失配。这里一律「先找到写着『作答』的那个
 * 元素，再往上取它所在的那一列」—— 与学习者看到的层级一致。
 *
 * ## 三个层级各量一次
 *
 * 标题（`作答` 这类说明文字）/ 数值（`5` 这类大字）/ 说明（`这一趟走的是…`）
 * 三者的前景色与字号都不同，WCAG 的判据也不同（正文 4.5:1，大字 3:1）。
 * 逐层给数，而不是给一个「整块都挺清楚」的结论。
 */
interface LevelPair {
  name: string;
  ratio: number;
  fg: string;
  bg: string;
  min: number;
  fontSize: string;
}

async function measureSummary(page: Page): Promise<{ pairs: LevelPair[]; darkBlocks: string[] }> {
  return page.evaluate(() => {
    const rgbOf = (value: string) => {
      const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(value);
      if (!m) return null;
      return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4]! };
    };
    const over = (
      fg: { r: number; g: number; b: number; a: number },
      bg: { r: number; g: number; b: number },
    ) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) });
    const lum = (c: { r: number; g: number; b: number }) => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    };
    const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
      Math.round(((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)) * 100) / 100;
    const effectiveBg = (el: Element | null) => {
      const stack: { r: number; g: number; b: number; a: number }[] = [];
      let node: Element | null = el;
      while (node) {
        const c = rgbOf(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) {
          stack.push(c);
          if (c.a >= 1) break;
        }
        node = node.parentElement;
      }
      let acc = { r: 255, g: 255, b: 255 };
      for (let i = stack.length - 1; i >= 0; i -= 1) acc = over(stack[i]!, acc);
      return acc;
    };

    /** 页面上**恰好**写着某段文字的最后一个叶子元素（避免命中容器）。 */
    const leafWithText = (text: string): Element | null => {
      const all = Array.from(document.querySelectorAll('span, div, p, button'));
      const hits = all.filter(
        (el) => (el.textContent ?? '').trim() === text && el.children.length === 0,
      );
      return hits[hits.length - 1] ?? null;
    };

    const pairs: LevelPair[] = [];
    const push = (name: string, el: Element | null, min: number) => {
      if (!el) return;
      const cs = getComputedStyle(el);
      const raw = rgbOf(cs.color);
      if (!raw) return;
      const bg = effectiveBg(el);
      const fg = over(raw, bg);
      pairs.push({
        name,
        ratio: ratio(fg, bg),
        fg: `rgb(${Math.round(fg.r)}, ${Math.round(fg.g)}, ${Math.round(fg.b)})`,
        bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        min,
        fontSize: cs.fontSize,
      });
    };

    // ① 本关证据卡：标题（说明文字）/ 数值
    push('证据卡·标题「作答」', leafWithText('作答'), 4.5);
    push('证据卡·标题「答对」', leafWithText('答对'), 4.5);
    push('证据卡·标题「计入掌握度」', leafWithText('计入掌握度'), 4.5);
    const statValue = ((): Element | null => {
      const label = leafWithText('作答');
      return label?.parentElement?.querySelector('span:last-child') ?? null;
    })();
    push('证据卡·数值', statValue, 3);

    // ② 掌握度双字段：两个 meterLabel + 两个 value
    push('掌握度·标题「历史最高（不回落，用于解锁）」', leafWithText('历史最高（不回落，用于解锁）'), 4.5);
    push('掌握度·标题「当前熟练度（会随时间回落，用于推荐）」', leafWithText('当前熟练度（会随时间回落，用于推荐）'), 4.5);
    push('掌握度·标题「状态」', leafWithText('状态'), 4.5);
    const masteryValue = ((): Element | null => {
      const label = leafWithText('历史最高（不回落，用于解锁）');
      return label?.parentElement?.querySelector('span:last-child') ?? null;
    })();
    push('掌握度·数值（历史最高）', masteryValue, 3);
    const stateBadge = ((): Element | null => {
      const label = leafWithText('状态');
      return label?.parentElement?.querySelector('span:last-child') ?? null;
    })();
    push('掌握度·状态徽章', stateBadge, 3);

    // ③ 说明层：小结正文那段话
    const hint = Array.from(document.querySelectorAll('span, div, p')).find((el) =>
      /这一趟没触发深究|这一趟走了深究路径/.test(el.textContent ?? ''),
    );
    push('小结·说明正文', hint ?? null, 4.5);

    // ④ 出口门控面板：模式徽章 + 说明
    push('门控·模式徽章', leafWithText('不设门控') ?? leafWithText('章末出口'), 3);
    const gateNote = Array.from(document.querySelectorAll('span, div, p')).find((el) =>
      /这一关不设门控|达标线|还差 \d+ 道/.test(el.textContent ?? ''),
    );
    push('门控·说明', gateNote ?? null, 4.5);

    /**
     * ⑤ 亮主题下不得出现「嵌入的暗块」。
     *
     * 判据与 t63 早前那次普查一致：`backgroundColor` 的 alpha ≥ 0.5、相对亮度
     * < 0.18、尺寸 ≥ 8×8。`0.18` 是经验值 —— 深色主题的 `bg-surface #111419`
     * 亮度约 0.006，浅色主题里任何「看起来是深色块」的东西都远低于 0.18，
     * 而正常浅底（`#ECEDF0`）亮度 0.83，两者差一个数量级，边界不敏感。
     *
     * 主按钮（`accent-fill` 珊瑚红）会命中，这是**正确**的：浅色页面上的实心
     * 主按钮本来就该是深色块。所以这里把 `button` 元素排除在外，只在**非交互
     * 容器**上普查 —— 要抓的是「反馈条 / 代码块 / 徽章」这类内容块。
     */
    const darkBlocks: string[] = [];
    for (const el of Array.from(document.querySelectorAll('div, span, pre, code, blockquote'))) {
      if (el.closest('button')) continue;
      const cs = getComputedStyle(el);
      const bg = rgbOf(cs.backgroundColor);
      if (!bg || bg.a < 0.5) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (lum(bg) < 0.18) {
        darkBlocks.push(
          `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0] ?? ''} ` +
            `bg=${cs.backgroundColor} ${Math.round(r.width)}x${Math.round(r.height)} ` +
            `"${(el.textContent ?? '').trim().slice(0, 24)}"`,
        );
      }
    }

    return { pairs, darkBlocks };
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}：小结三层级、门控面板与公式都对得上 token`, async ({ page }) => {
    await openLevel(page, theme, 'P1');
    for (let guard = 0; guard < 10; guard += 1) {
      try {
        await currentSegment(page);
      } catch {
        break;
      }
      await answerSegment(page, 'first');
      if (!(await nextSegment(page))) break;
    }
    await expect(page.getByText('本关小结').first()).toBeVisible({ timeout: 10_000 });

    const { pairs, darkBlocks } = await measureSummary(page);
    console.log(`SUMMARY ${theme} ${JSON.stringify(pairs, null, 1)}`);
    console.log(`DARKBLOCKS ${theme} ${JSON.stringify(darkBlocks)}`);

    // 三层级至少各量到一条，否则说明选择器失配了（宁可红，也不要「跳过即通过」）
    const groups = ['证据卡·', '掌握度·', '小结·说明', '门控·'];
    for (const group of groups) {
      expect(
        pairs.filter((p) => p.name.startsWith(group)).length,
        `${theme} 下没有量到「${group}」这一组`,
      ).toBeGreaterThan(0);
    }

    for (const p of pairs) {
      expect(
        p.ratio,
        `${theme} ${p.name} 只有 ${p.ratio}:1（要求 ≥${p.min}）fg=${p.fg} bg=${p.bg} fontSize=${p.fontSize}`,
      ).toBeGreaterThanOrEqual(p.min);
    }

    /*
     * 验收第 8 条：亮主题下「嵌入的暗块」不超过 2 处，且每处都要能说清理由。
     * 深主题下这条不适用（整个页面本来就是暗的），只打印数字不设限。
     */
    if (theme === 'light') {
      expect(
        darkBlocks.length,
        `亮主题下出现了 ${darkBlocks.length} 个暗块（上限 2）：\n${darkBlocks.join('\n')}`,
      ).toBeLessThanOrEqual(2);
    }
  });
}

/**
 * 验收第 7 条：题干与讲解里的公式两套主题下都从 token 取，且与正文一致。
 *
 * 本仓**没有 KaTeX**（`markdown.tsx` 文件头写明「没有 KaTeX 也不打算有」：
 * 它需要字体文件与 CSS，还要处理 CJK 排版），公式是 `$…$` 包起来的等宽衬线
 * 文本块，底色 `colorNeutralBackground3`（= `--sm-bg-elevated`）。所以这条
 * 验收要证的其实是同一件事：**公式的前景色与正文同源，底色也是语义 token，
 * 两套主题下都达标**。
 *
 * 直接扫页面里所有 `[translate="no"]` 的公式块（`markdown.tsx:154` 给它们加了
 * 这个属性），而不是找某个具体公式的文本 —— 换关卡、换讲解都不用改探针。
 */
for (const theme of ['dark', 'light'] as const) {
  test(`${theme}：公式与正文同源且两套主题都达标`, async ({ page }) => {
    await openLevel(page, theme, 'P1');
    /** 走到第 2 段「展示细节」—— 讲解卡在那里，公式最密。 */
    for (let guard = 0; guard < 4; guard += 1) {
      const seg = await currentSegment(page);
      if (seg.name === '展示细节') break;
      await answerSegment(page, 'first');
      expect(await nextSegment(page), '走不到「展示细节」段').toBe(true);
    }
    expect((await currentSegment(page)).name).toBe('展示细节');

    const formulas = await page.evaluate(() => {
      const rgbOf = (value: string) => {
        const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(value);
        if (!m) return null;
        return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4]! };
      };
      const over = (
        fg: { r: number; g: number; b: number; a: number },
        bg: { r: number; g: number; b: number },
      ) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) });
      const lum = (c: { r: number; g: number; b: number }) => {
        const ch = (v: number) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
      };
      const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
        Math.round(((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)) * 100) / 100;
      const effectiveBg = (el: Element | null) => {
        const stack: { r: number; g: number; b: number; a: number }[] = [];
        let node: Element | null = el;
        while (node) {
          const c = rgbOf(getComputedStyle(node).backgroundColor);
          if (c && c.a > 0) {
            stack.push(c);
            if (c.a >= 1) break;
          }
          node = node.parentElement;
        }
        let acc = { r: 255, g: 255, b: 255 };
        for (let i = stack.length - 1; i >= 0; i -= 1) acc = over(stack[i]!, acc);
        return acc;
      };

      const nodes = Array.from(document.querySelectorAll('[translate="no"]'));
      return nodes.slice(0, 6).map((el) => {
        const cs = getComputedStyle(el);
        const raw = rgbOf(cs.color);
        const bg = effectiveBg(el);
        const fg = raw ? over(raw, bg) : bg;
        const body = document.querySelector('body');
        const bodyColor = body ? getComputedStyle(body).color : '';
        return {
          text: (el.textContent ?? '').trim().slice(0, 24),
          color: cs.color,
          bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
          ratio: ratio(fg, bg),
          sameAsBody: cs.color === bodyColor,
        };
      });
    });

    console.log(`FORMULA ${theme} ${JSON.stringify(formulas, null, 1)}`);
    expect(formulas.length, '这一段里没有找到任何公式').toBeGreaterThan(0);
    for (const f of formulas) {
      expect(f.ratio, `公式「${f.text}」只有 ${f.ratio}:1（要求 ≥4.5）color=${f.color} bg=${f.bg}`).toBeGreaterThanOrEqual(4.5);
      expect(f.sameAsBody, `公式「${f.text}」的前景色 ${f.color} 与正文不一致，公式应随正文取同一个 token`).toBe(true);
    }
  });
}

// ---------------------------------------------------------------------------
// 用例 5：字面颜色不回流
// ---------------------------------------------------------------------------

test('关卡页与 level/ 里没有字面 hex', async () => {
  /**
   * 票面第 2 条：字面 hex 只剩 0 处（`VideoPanel` 的 `#000` 已改成
   * `--sm-bg-sunken`）。
   *
   * 为什么这条要单独存在：上面那些 computed-style 断言在有人写回 `#000`
   * 时**一条都不会红** —— 黑底视频容器在深色主题下看着完全正常。只有源码
   * 层的扫描能在「两套主题都还没人看过」的时候提前报警。
   *
   * 注释里的 `#fff` 之类不算：先剥掉行注释与块注释再匹配。
   */
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = process.cwd(); // apps/web
  const offenders: string[] = [];

  const scan = (file: string) => {
    const text = readFileSync(file, 'utf8');
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^\n]*/g, '');
    stripped.split('\n').forEach((line, i) => {
      // 6 位 hex 与 3 位 hex 都算；`#000` 正是漏网过的那个
      if (/#[0-9a-fA-F]{6}\b/.test(line) || /#[0-9a-fA-F]{3}\b/.test(line)) {
        offenders.push(`${file.slice(root.length + 1)}:${i + 1} ${line.trim().slice(0, 80)}`);
      }
    });
  };
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const name of readdirSync(p)) walk(join(p, name));
      return;
    }
    if (/\.(ts|tsx)$/.test(p)) scan(p);
  };
  walk(join(root, 'src/level'));
  scan(join(root, 'src/pages/LevelPage.tsx'));

  console.log(`HEX ${JSON.stringify(offenders, null, 1)}`);
  expect(offenders, '关卡页里又出现了字面颜色').toEqual([]);
});
