/**
 * 一次性探针：区分两种假设。
 *
 * H1 嵌套 FluentProvider（main.tsx 一层 + App.tsx 一层）
 * H2 React `StrictMode` 的双挂载（开发构建下 effect 跑两遍 → keyborg 被 dispose 两次）
 *
 * 做法：分别拦截 `/src/App.tsx`（去内层 provider）与 `/src/main.tsx`（去 StrictMode），
 * 各跑一次，看控制台 error 是否消失。拦截是否真的生效也一并打印（用标记串验证）。
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const browser = await chromium.launch();

async function load(label, patch) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 120));
  });
  let applied = 'n/a';
  if (patch) {
    await page.route('**/src/*', async (route) => {
      const url = route.request().url();
      const target = patch.match;
      if (!url.includes(target)) return route.continue();
      const resp = await route.fetch();
      let body = await resp.text();
      const before = body;
      body = patch.apply(body);
      applied = body === before ? '未命中（内容没变）' : '已改写';
      await route.fulfill({ status: 200, contentType: 'text/javascript', body });
    });
  }
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.close();
  console.log(`${label}: 改写=${applied} 错误=${JSON.stringify(errors)}`);
}

await load('基线', null);

await load('H1 去 App.tsx 内层 FluentProvider', {
  match: '/src/App.tsx',
  apply: (b) =>
    b
      .replace("import { FluentProvider, webLightTheme } from '@fluentui/react-components';", '')
      .replace('<FluentProvider theme={webLightTheme}>', '<>')
      .replace('</FluentProvider>', '</>'),
});

await load('H2 去 main.tsx 的 StrictMode', {
  match: '/src/main.tsx',
  apply: (b) => b.replace('<StrictMode>', '<>').replace('</StrictMode>', '</>'),
});

await browser.close();
