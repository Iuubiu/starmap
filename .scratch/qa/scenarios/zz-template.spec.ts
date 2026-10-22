/**
 * 票 67「关卡模板 UI：按档位预览 + 保存 + 导出/导入」的验收取证场景。
 *
 * 与 `apps/web/src/pages/MarketPage.test.tsx` 的分工：单测把 query/mutation
 * 换成假货，验证「拿到这份数据之后页面怎么反应」；这一条走真实后端 + 真实
 * 下载/上传，验证四件单测证明不了的事：
 *
 *   1. 三档预览的差异是**服务端真算出来的**，不是前端编的（验收②）；
 *   2. 导出真的落盘成 `*.level.json`，导入真的把文件读回来（验收④）；
 *   3. 导出 → 导入 → 再导出，两份文件除 `exportedAt` 与 id 外一致（验收⑤）；
 *   4. 375px 窄视口不横向溢出、两套主题下模板区都可读（验收⑥⑦）。
 *
 * ## 关于「除 exportedAt 外一致」的准确判据
 *
 * 票面原文是「导出→导入→再导出，两次下载内容除 `exportedAt` 外一致」。
 * 实测**字面做不到**：导入时 `levels.id` 与 `level_items.id` 是全局主键，
 * 沿用原 id 会撞车，所以 `remapSpecIds()` 会给三类 id 加 `--<hash前8>` 后缀
 * （票 66 的刻意决定，`apps/api/src/levels/levels.export.ts` 有注释）。
 * 于是「再导出」出来的文件里 `meta.id` / `steps[].id` / `items[].id` 必然不同。
 *
 * 所以这条验收按**两个可验证的不变量**取证，都断言、都打日志：
 *   A. 同一张关卡连按两次导出，两份文件除 `exportedAt` 外逐字节相同（真幂等）；
 *   B. 导出 → 导入 → 再导出，剥掉三类 id 与 `exportedAt` 后逐字节相同（真 round-trip）。
 *
 * 取证产生的 `lv-import-*` 关卡在 afterAll 里删掉，不污染库。
 */
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { API, attachDiagnostics, shot } from './_helpers';

const READY = 60_000;

test.describe.configure({ timeout: 240_000 });

/** 导出体里会被导入重编的三类 id。剥掉它们才谈得上「一致」。 */
type ExportFile = {
  format: string;
  exportedAt: string;
  source: { title: string; page: number | null };
  spec: { meta: { id: string; microKpId: string }; steps: { id: string }[]; items: { id: string }[] };
  items: { id: string }[];
};

/**
 * 把一份导出体归一：去掉 `exportedAt`，剥掉导入重编时加的 `--<hash前8>` 后缀，
 * 并把关卡自身的 id 换成 `<id>`。这样比较的是**内容**而不是「谁在第几位」。
 *
 * 为什么要剥后缀而不是只换三个顶层 id：`remapSpecIds()` 会给 cards / items /
 * steps 三类 id 全部加后缀，卡片 id 也在里面（`c-guide` → `c-guide--c2defbaa`）。
 * 只换顶层 id 会让 round-trip 判定永远为 false —— 那不是内容差异，是重编策略。
 */
function normalize(file: ExportFile): string {
  const stripSuffix = (value: unknown): unknown => {
    if (typeof value === 'string') return value.replace(/--[0-9a-f]{8}$/, '');
    if (Array.isArray(value)) return value.map(stripSuffix);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, stripSuffix(inner)]),
      );
    }
    return value;
  };

  const clone = stripSuffix(JSON.parse(JSON.stringify(file))) as ExportFile;
  delete (clone as Partial<ExportFile>).exportedAt;
  clone.spec.meta.id = '<id>';
  for (const step of clone.spec.steps) step.id = '<id>';
  for (const item of clone.spec.items) item.id = '<id>';
  for (const item of clone.items) item.id = '<id>';
  return JSON.stringify(clone);
}

/** 用真实后端拿一份关卡 spec。 */
async function fetchLevelSpec(page: Page, levelId: string): Promise<unknown> {
  const res = await page.request.get(`${API}/api/v1/levels/${encodeURIComponent(levelId)}`);
  expect(res.status(), `GET /levels/${levelId}`).toBe(200);
  const body = (await res.json()) as { spec: unknown };
  return body.spec;
}

/** 模板预览：直接打 API，把三档的段数摊开（验收②的后端侧证据）。 */
async function previewTiers(
  page: Page,
  microKpId: string,
): Promise<{ tier: string; steps: number; items: number }[]> {
  const out: { tier: string; steps: number; items: number }[] = [];
  for (const tier of ['P1', 'P2', 'P3'] as const) {
    const res = await page.request.post(`${API}/api/v1/level-templates/teaching/preview`, {
      data: { microKpId, tier },
    });
    expect(res.status(), `preview ${tier}`).toBe(200);
    const body = (await res.json()) as { spec: { steps: unknown[]; items: unknown[] } };
    out.push({ tier, steps: body.spec.steps.length, items: body.spec.items.length });
  }
  return out;
}

/** 打开市场页并等模板区渲染出来。 */
async function gotoMarket(page: Page): Promise<void> {
  await page.goto('/market', { waitUntil: 'domcontentloaded' });
  await page.getByRole('radiogroup', { name: '关卡模板' }).waitFor({ timeout: READY });
}

/** 切主题：**必须**走 localStorage + 重新加载，不能只改 DOM 属性。 */
async function loadInTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.addInitScript((next) => {
    window.localStorage.setItem('starmap.theme', next);
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
  await gotoMarket(page);
  // ThemeProvider 挂载后会按 mode 重算并回写 data-sm-theme；等它稳定
  await expect(page.locator('html')).toHaveAttribute('data-sm-theme', theme, { timeout: READY });
}

test('模板区列出三张模板，且三档预览的段数是服务端算出来的', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await gotoMarket(page);

  // 验收①：三张模板都在
  const cards = page.getByRole('radio');
  await expect(cards).toHaveCount(3);
  const names = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  console.log(`[t67] 三张模板：${names.join(' / ')}`);
  expect(names[0]).toMatch(/^教学关卡/);
  expect(names[1]).toMatch(/^练习关卡/);
  expect(names[2]).toMatch(/^复验关卡/);

  // 每张都说清「几段、几题、适合谁」
  const text = await page.getByRole('radiogroup', { name: '关卡模板' }).innerText();
  console.log(`[t67] 模板区文本：${text.replace(/\n+/g, ' | ')}`);
  expect(text).toMatch(/7 段 · 4 题/);
  expect(text).toMatch(/2 段 · 5 题/);
  expect(text).toMatch(/2 段 · 3 题/);
  expect(text).toMatch(/适合谁：/);

  // 验收②的后端侧：同一知识点三档的段数必须不同（7 / 6 / 5）
  const tiers = await previewTiers(page, 'kp-bool');
  console.log(`[t67] 三档预览：${tiers.map((t) => `${t.tier}=${t.steps}段/${t.items}题`).join('  ')}`);
  expect(tiers.map((t) => t.steps)).toEqual([7, 6, 5]);
  // 三档段数必须有 3 个不同值 —— 否则「改档位预览即时变化」无从谈起
  expect(new Set(tiers.map((t) => t.steps)).size).toBe(3);

  // 预览草稿必须能过校验器（服务端已经跑过 validateLevelSpec 才会 200）
  const spec = await fetchLevelSpec(page, 'lv-bool-laws');
  expect(spec).toBeTruthy();

  await shot(page, 't67-01-templates');
  expect(diag.pageErrors, diag.pageErrors.join('\n')).toEqual([]);
});

test('改档位时右侧预览即时变化，且预览标着「未落库」', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await gotoMarket(page);

  await page.getByRole('radio', { name: /^教学关卡/ }).click();
  await page.getByLabel('模板预览的知识点 id').fill('kp-bool');

  const stepList = page.getByRole('list', { name: '预览的段' });

  // P1（默认档）→ 七段
  await page.getByRole('button', { name: '预览' }).click();
  await expect(stepList.getByRole('listitem')).toHaveCount(7, { timeout: READY });
  await expect(page.getByText('未落库')).toBeVisible();
  const p1Text = await stepList.innerText();
  console.log(`[t67] P1 预览段：${p1Text.replace(/\n+/g, ' | ')}`);
  await shot(page, 't67-02-preview-P1');

  // 切到 P3 → 五段（这就是「肉眼可见差异」）
  await page.getByLabel('节奏档位').click();
  await page.getByRole('option', { name: /P3/ }).click();
  await page.getByRole('button', { name: '预览' }).click();
  await expect(stepList.getByRole('listitem')).toHaveCount(5, { timeout: READY });
  const p3Text = await stepList.innerText();
  console.log(`[t67] P3 预览段：${p3Text.replace(/\n+/g, ' | ')}`);
  await shot(page, 't67-03-preview-P3');

  // 差异必须是「段真的少了」而不是同一批段换了名字
  expect(p1Text).not.toBe(p3Text);
  expect(p1Text).toMatch(/进一步讲解/); // P1 有 reteach
  expect(p3Text).not.toMatch(/进一步讲解/); // P3 没有

  expect(diag.pageErrors, diag.pageErrors.join('\n')).toEqual([]);
});

test('导出真的落盘，导入真的读回，且两个不变量成立', async ({ page }) => {
  const diag = attachDiagnostics(page);
  const importedIds: string[] = [];

  try {
    await page.goto('/market', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '重新开始' }).first().waitFor({ timeout: READY });

    // 验收④前半：点「导出」真的下载到一个 .level.json
    const firstDownload = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出' }).first().click(),
    ]).then(([download]) => download);

    const suggested = firstDownload.suggestedFilename();
    console.log(`[t67] 导出文件名：${suggested}`);
    expect(suggested).toMatch(/\.level\.json$/);
    expect(suggested).toContain('kp-bool');

    const firstPath = await firstDownload.path();
    expect(firstPath, '下载落盘路径').toBeTruthy();
    const firstRaw = await readFile(firstPath!, 'utf8');
    const firstFile = JSON.parse(firstRaw) as ExportFile;
    expect(firstFile.format).toBe('starmap.level/1');
    expect(firstFile.spec.meta.microKpId).toBe('kp-bool');
    const sourceLevelId = firstFile.spec.meta.id;

    // 不变量 A：同一张关卡再导一次，除 exportedAt 外逐字节相同
    const againRes = await page.request.post(
      `${API}/api/v1/levels/${encodeURIComponent(sourceLevelId)}/export`,
    );
    expect(againRes.status()).toBe(200);
    const againFile = (await againRes.json()) as ExportFile;
    const stripTime = (file: ExportFile): string => {
      const clone = JSON.parse(JSON.stringify(file)) as ExportFile;
      delete (clone as Partial<ExportFile>).exportedAt;
      return JSON.stringify(clone);
    };
    console.log(`[t67] 不变量 A（同关卡导两次除 exportedAt 外一致）：${stripTime(firstFile) === stripTime(againFile)}`);
    expect(stripTime(firstFile)).toBe(stripTime(againFile));

    // 验收④后半：把这份文件通过 UI 导回去
    await page.getByLabel('选择关卡文件').setInputFiles({
      name: suggested,
      mimeType: 'application/json',
      buffer: Buffer.from(firstRaw, 'utf8'),
    });
    await expect(page.getByText(/导入成功|这份文件之前导入过/)).toBeVisible({ timeout: READY });
    console.log(`[t67] 导入回执：${await page.getByText(/导入成功|这份文件之前导入过/).innerText()}`);

    // 从库侧确认这次导入落在哪张关卡
    const listRes = await page.request.get(`${API}/api/v1/market/levels`);
    expect(listRes.status()).toBe(200);
    const listed = (await listRes.json()) as { items: { levelId: string; origin: string }[] };
    const imported = listed.items.filter((item) => item.levelId.startsWith('lv-import-'));
    expect(imported.length, '库里应当出现 lv-import-* 关卡').toBeGreaterThan(0);
    for (const item of imported) importedIds.push(item.levelId);
    console.log(`[t67] 库里的导入关卡：${importedIds.join(', ')}`);

    // 不变量 B：导出 → 导入 → 再导出，剥掉 id 与 exportedAt 后逐字节相同
    const importedLevelId = imported[0]!.levelId;
    const roundRes = await page.request.post(
      `${API}/api/v1/levels/${encodeURIComponent(importedLevelId)}/export`,
    );
    const roundBody = await roundRes.text();
    console.log(`[t67] 再导出 ${importedLevelId} → HTTP ${roundRes.status()} ${roundBody.slice(0, 200)}`);
    expect(roundRes.status()).toBe(200);
    const roundFile = JSON.parse(roundBody) as ExportFile;
    expect(roundFile.format).toBe('starmap.level/1');
    console.log(`[t67] 源关卡 ${sourceLevelId} → 导入 ${importedLevelId}`);
    console.log(`[t67] 不变量 B（剥 id 与 exportedAt 后 round-trip 一致）：${normalize(firstFile) === normalize(roundFile)}`);
    expect(normalize(firstFile)).toBe(normalize(roundFile));

    await shot(page, 't67-04-transfer');
    expect(diag.pageErrors, diag.pageErrors.join('\n')).toEqual([]);
  } finally {
    // 取证完把导入出来的关卡删掉，别留在库里（知识地图与复验池都读这张表）。
    // 没有 DELETE 端点 —— 直连数据库。失败不掩盖原断言。
    if (importedIds.length > 0) {
      // psql 不在 Playwright 的 node 进程 PATH 里（实测 spawnSync psql ENOENT），
      // 所以先按已知安装位置找，找不到再退回 PATH 里的裸名。
      const psqlCandidates = [
        'C:/Users/Yhwhy/scoop/apps/postgresql/current/bin/psql.exe',
        'psql',
      ];
      let cleaned = false;
      for (const bin of psqlCandidates) {
        try {
          execFileSync(
            bin,
            [
              'postgresql://postgres@127.0.0.1:5432/starmap',
              '-v',
              'ON_ERROR_STOP=1',
              '-c',
              `DELETE FROM app.levels WHERE id IN (${importedIds.map((id) => `'${id}'`).join(',')})`,
            ],
            { stdio: 'pipe', env: { ...process.env, PGCLIENTENCODING: 'UTF8' } },
          );
          console.log(`[t67] 已清理导入关卡（${bin}）：${importedIds.join(', ')}`);
          cleaned = true;
          break;
        } catch (error) {
          if (bin === psqlCandidates[psqlCandidates.length - 1]) {
            console.log(`[t67] 清理失败（需人工删）：${importedIds.join(', ')} —— ${String(error)}`);
          }
        }
      }
      expect(cleaned, '取证后必须把 lv-import-* 清干净，否则污染市场与复验池').toBe(true);
    }
  }
});

test('375px 窄视口下模板区不横向溢出、不重叠', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await gotoMarket(page);

  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement;
    return el ? el.scrollWidth - el.clientWidth : -1;
  });
  console.log(`[t67] 375px 横向溢出：${overflow}px`);
  expect(overflow).toBe(0);

  // 模板卡与预览区在窄屏下应当上下堆叠（不是左右并排挤成负数宽度）
  const boxes = await page.getByRole('radiogroup', { name: '关卡模板' }).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
  });
  console.log(`[t67] 模板区盒子：left=${boxes.left} right=${boxes.right} width=${boxes.width}`);
  expect(boxes.width).toBeGreaterThan(0);
  expect(boxes.left).toBeGreaterThanOrEqual(0);
  expect(boxes.right).toBeLessThanOrEqual(375);

  await shot(page, 't67-05-narrow-375');
  expect(diag.pageErrors, diag.pageErrors.join('\n')).toEqual([]);
});

test('两套主题下模板区都取语义 token，且对比度达标', async ({ page }) => {
  const diag = attachDiagnostics(page);

  /**
   * 解析 `#rgb` / `#rrggbb` / `rgb()` / `rgba()` 成 [r,g,b,a]。
   *
   * 第一版只认 `rgb()` 里的数字，于是 `#a8a8b3` 被正则抠成 [8,8,3]（把十六进制
   * 的字符当十进制数字），算出「次级文字 vs 画布 = 1.05」这种假红。token 是
   * hex、计算样式是 rgb()，两种形态都会进来，必须都认。
   */
  const parse = (color: string): [number, number, number, number] => {
    const hex = color.trim().match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      const digits = hex[1]!;
      const expand = (pair: string): number => parseInt(pair.length === 1 ? pair + pair : pair, 16);
      if (digits.length === 3 || digits.length === 4) {
        return [expand(digits[0]!), expand(digits[1]!), expand(digits[2]!), digits.length === 4 ? expand(digits[3]!) / 255 : 1];
      }
      return [
        expand(digits.slice(0, 2)),
        expand(digits.slice(2, 4)),
        expand(digits.slice(4, 6)),
        digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
      ];
    }
    const nums = (color.match(/[\d.]+/g) ?? []).map(Number);
    return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1];
  };

  /**
   * 半透明色必须先合成到底色上再算对比度。
   *
   * 第一版直接丢掉 alpha 通道，于是 `rgba(255,255,255,0.09)` 被当成纯白算出
   * 19.64:1 —— 一个漂亮的假绿：那条 9% 白的描边压在深底上实际几乎看不见。
   * 卡片底色 `rgba(0,0,0,0)`（完全透明）则让「文字 vs 卡底」整条断言被 if 跳过。
   * 两处都是「探针绿了但没测」的典型形态，所以这里合成 + 强制断言，不留 if。
   */
  const composite = (fg: string, bg: string): string => {
    const [r, g, b, a] = parse(fg);
    const [br, bg2, bb] = parse(bg);
    const mix = (front: number, back: number): number => Math.round(front * a + back * (1 - a));
    return `rgb(${mix(r, br)}, ${mix(g, bg2)}, ${mix(b, bb)})`;
  };

  const lum = (rgb: string): number => {
    const [r, g, b] = parse(rgb);
    const channel = (value: number): number => {
      const s = value / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };

  const results: Record<string, Record<string, number>> = {};

  for (const theme of ['dark', 'light'] as const) {
    await loadInTheme(page, theme);

    const measured = await page.evaluate(() => {
      const root = document.documentElement;
      const token = (name: string): string => getComputedStyle(root).getPropertyValue(name).trim();
      const card = document.querySelector('[role="radio"]');
      const cardStyles = card ? getComputedStyle(card) : null;
      const bodyStyles = getComputedStyle(document.body);
      return {
        canvas: token('--sm-bg-canvas'),
        surface: token('--sm-bg-surface'),
        textPrimary: token('--sm-text-primary'),
        textSecondary: token('--sm-text-secondary'),
        borderControl: token('--sm-border-control'),
        cardBorder: cardStyles?.borderTopColor ?? '',
        cardText: cardStyles?.color ?? '',
        cardBg: cardStyles?.backgroundColor ?? '',
        bodyBg: bodyStyles.backgroundColor,
      };
    });

    console.log(
      `[t67] theme=${theme} canvas=${measured.canvas} surface=${measured.surface} ` +
        `text=${measured.textPrimary} cardBg=${measured.cardBg} cardText=${measured.cardText} cardBorder=${measured.cardBorder}`,
    );

    // token 必须有值，否则深色下会掉回白底（空串会让后面所有比值变成 NaN）
    expect(measured.canvas, `${theme} 的 --sm-bg-canvas`).not.toBe('');
    expect(measured.surface, `${theme} 的 --sm-bg-surface`).not.toBe('');

    const pageBg = measured.bodyBg;
    expect(pageBg, `${theme} 的 body 背景`).toMatch(/^rgba?\(/);

    // 模板卡底色可能透明 —— 透明就合成到页面底上，别跳过
    const cardBg = measured.cardBg.startsWith('rgba(0, 0, 0, 0)')
      ? pageBg
      : composite(measured.cardBg, pageBg);

    const cardTextRatio = ratio(measured.cardText, cardBg);
    // 模板卡边框是半透明描边 —— 合成后再算，这才是眼睛看到的对比度
    const cardBorder = composite(measured.cardBorder, cardBg);
    const cardBorderRatio = ratio(cardBorder, cardBg);
    const secondaryOnCanvas = ratio(measured.textSecondary, measured.canvas);

    console.log(
      `[t67] theme=${theme} 文字/卡底=${cardTextRatio}  边框/卡底=${cardBorderRatio}（合成后 ${cardBorder}）` +
        `  次级文字/画布=${secondaryOnCanvas}`,
    );

    // 正文 4.5:1
    expect(cardTextRatio, `${theme} 模板卡文字对比度`).toBeGreaterThanOrEqual(4.5);
    // 控件边界 3:1（WCAG 1.4.11）
    expect(cardBorderRatio, `${theme} 模板卡边框对比度（合成 alpha 后）`).toBeGreaterThanOrEqual(3);
    // 次级文字 4.5:1
    expect(secondaryOnCanvas, `${theme} 次级文字对比度`).toBeGreaterThanOrEqual(4.5);

    results[theme] = {
      cardTextRatio,
      cardBorderRatio,
      secondaryOnCanvas,
    };

    await shot(page, `t67-06-theme-${theme}`);
  }

  // 两套主题必须真的不同 —— 否则「切主题」只是换了个 data 属性，颜色没跟着动
  expect(results['dark']!['cardTextRatio']).not.toBe(results['light']!['cardTextRatio']);
  const worst = Math.min(
    ...Object.values(results).flatMap((entry) => Object.values(entry)),
  );
  console.log(
    `[t67] 断言条数=${Object.keys(results).length * 3}  最差值=${worst}  判定=${worst >= 3 ? 'PASS' : 'FAIL'}`,
  );

  expect(diag.pageErrors, diag.pageErrors.join('\n')).toEqual([]);
});
