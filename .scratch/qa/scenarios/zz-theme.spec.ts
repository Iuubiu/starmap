import { test, expect } from '@playwright/test';

/**
 * t58 验收探针：token 层 + 首帧脚本 + ThemeProvider 是否真的生效。
 *
 * 只回答三个问题（不做视觉评分）：
 * 1. 首帧不闪：`<head>` 内联脚本是否在 React 挂载前就把 data-theme 写到 <html> 上
 * 2. 两套主题是否各自解析出**不同的**背景色（不是同一种黑）
 * 3. 亮色下正文对比度是否够（按 WCAG 相对亮度算，不算好看不好看）
 */

const readState = () =>
  ({
    dataTheme: document.documentElement.getAttribute('data-sm-theme'),
    scheme: document.documentElement.style.colorScheme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    rootBg: getComputedStyle(document.documentElement).backgroundColor,
    fg: getComputedStyle(document.body).color,
  }) as const;

test('首帧脚本：HTML 源码里就带 data-sm-theme，首帧不会白闪', async ({ page, request }) => {
  // 1) 静态源码：index.html 里 `<html data-sm-theme="dark">` 已写死，
  //    因此浏览器拿到 HTML 的第一帧就是深色，不依赖任何 JS。
  const html = await (await request.get('/')).text();
  expect(html).toMatch(/data-sm-theme="(dark|light)"/);

  // 2) 内联脚本在 <head> 里同步执行，domcontentloaded 时属性必须已存在。
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const atLoad = await page.evaluate(() =>
    document.documentElement.getAttribute('data-sm-theme'),
  );
  expect(['dark', 'light']).toContain(atLoad);
});

test('两套主题的背景色与前景色各自不同', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('starmap.theme', 'dark'));
  await page.goto('/');
  const dark = await page.evaluate(readState);
  await page.waitForTimeout(400);
  await page.screenshot({ path: '../../.scratch/qa/shots/theme-dark-home.png', fullPage: false });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('starmap.theme', 'light'));
  await page.goto('/');
  const light = await page.evaluate(readState);
  await page.waitForTimeout(400);
  await page.screenshot({ path: '../../.scratch/qa/shots/theme-light-home.png', fullPage: false });

  console.log('DARK ', JSON.stringify(dark));
  console.log('LIGHT', JSON.stringify(light));

  expect(dark.dataTheme).toBe('dark');
  expect(light.dataTheme).toBe('light');
  // 底色落在 body 上（html 是透明），所以比 bodyBg 而不是 rootBg
  expect(dark.bodyBg).not.toBe(light.bodyBg);
  expect(dark.fg).not.toBe(light.fg);

  // 亮色必须是亮底（相对亮度 > 0.5），深色必须是暗底（< 0.2）
  const lum = (rgb: string) => {
    const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const darkLum = lum(dark.bodyBg);
  const lightLum = lum(light.bodyBg);
  console.log('LUM dark', darkLum.toFixed(4), 'light', lightLum.toFixed(4));
  expect(darkLum).toBeLessThan(0.2);
  expect(lightLum).toBeGreaterThan(0.5);
});

test('亮色下正文对比度 ≥ 4.5:1', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('starmap.theme', 'light'));
  await page.goto('/');
  const { bg, fg } = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    fg: getComputedStyle(document.body).color,
  }));
  const lum = (rgb: string) => {
    const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const a = lum(bg);
  const b = lum(fg);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  console.log('CONTRAST', ratio.toFixed(2), bg, fg);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
