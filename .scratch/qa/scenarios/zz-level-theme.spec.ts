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
