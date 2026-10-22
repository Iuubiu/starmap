/**
 * 一次性探针：验证 "Keyborg instance k1 is being disposed incorrectly." 的根因假设。
 *
 * 假设：`main.tsx` 与 `App.tsx` **各包了一层 FluentProvider**（嵌套），
 * 卸载/重挂时内层 keyborg 实例被外层先行清掉，于是 keyborg 在 dispose 时
 * 找不到自己的 ref 记录 → `console.error`。这是开发构建下的报错（NODE_ENV !== production），
 * 但 `pnpm dev` 就是开发构建，学生打开控制台会看到一条红色 error。
 *
 * 做法：拦截 `/src/App.tsx` 与 `/src/main.tsx` 的源码响应，把内层 FluentProvider
 * 去掉后再加载，对比报错是否消失。这样不必改仓库文件就能证伪/证实。
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';

const browser = await chromium.launch();

async function load(transform) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 120));
  });
  if (transform) await page.route('**/src/**', transform);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.close();
  return errors;
}

// 基线
console.log('基线（现状）:', JSON.stringify(await load(null)));

// 变体：把 App.tsx 里的 FluentProvider 换成 Fragment
const errors = await load(async (route) => {
  const url = route.request().url();
  if (!url.includes('/src/App.tsx')) return route.continue();
  const resp = await route.fetch();
  let body = await resp.text();
  body = body
    .replace(
      "import { FluentProvider, webLightTheme } from '@fluentui/react-components';",
      '',
    )
    .replace('<FluentProvider theme={webLightTheme}>', '<>')
    .replace('</FluentProvider>', '</>');
  await route.fulfill({ status: 200, contentType: 'text/javascript', body });
});
console.log('去掉 App.tsx 内层 FluentProvider 后:', JSON.stringify(errors));

await browser.close();
