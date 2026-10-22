/**
 * 一次性探针 v4：在**已转译的模块代码**上打补丁（v3 直接替换 JSX 文本，
 * 但 Vite 已经把 JSX 编译成 `_jsxDEV(...)`，所以匹配不到）。
 *
 * 两个变体：
 *   H1 —— App.tsx 里的 FluentProvider 换成透明组件（去掉嵌套的 provider）
 *   H2 —— main.tsx 里的 StrictMode 换成 Fragment（去掉开发构建的双挂载）
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const browser = await chromium.launch();

async function load(label, patches) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 120));
  });
  const notes = [];
  await page.route('**/src/*', async (route) => {
    const url = route.request().url();
    const patch = patches?.find((p) => url.includes(p.match));
    if (!patch) return route.continue();
    const resp = await route.fetch();
    const before = await resp.text();
    const after = patch.apply(before);
    notes.push(`${patch.match}: ${after === before ? '未命中' : '已改写'}`);
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: after });
  });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.close();
  console.log(`${label}: [${notes.join('; ') || '无补丁'}] 错误=${JSON.stringify(errors)}`);
}

await load('基线', null);

await load('H1 去 App.tsx 内层 FluentProvider', [
  {
    match: '/src/App.tsx',
    apply: (b) =>
      b.replace(
        'import { FluentProvider, webLightTheme } from',
        'const FluentProvider = (p) => p.children;\nimport { webLightTheme } from',
      ),
  },
]);

await load('H2 去 main.tsx 的 StrictMode', [
  {
    match: '/src/main.tsx',
    apply: (b) => b.replace('__vite__cjsImport0_react["StrictMode"]', '__vite__cjsImport0_react["Fragment"]'),
  },
]);

await browser.close();
