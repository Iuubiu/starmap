import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 场景 0：全页面巡检（不属于 20 个场景，是我自己的探路工具）。
 *
 * 目的：一次打开全部 12 条路由，收集
 *   - 控制台 error / warning
 *   - 失败的网络请求（4xx/5xx）
 *   - 每页耗时
 *   - 截图
 * 用来在写 20 个场景前先知道「哪里本来就有问题」。
 */

const ROUTES: Array<{ path: string; name: string }> = [
  { path: '/', name: '00-home' },
  { path: '/placement', name: '01-placement' },
  { path: '/board', name: '02-board' },
  { path: '/map', name: '03-map' },
  { path: '/database', name: '04-database' },
  { path: '/market', name: '05-market' },
  { path: '/market/generate', name: '06-generation' },
  { path: '/skills', name: '07-skills' },
  { path: '/review', name: '08-review' },
  { path: '/level/lv-bool-laws', name: '09-level' },
];

const SHOTS = path.resolve(HERE, '../shots');
fs.mkdirSync(SHOTS, { recursive: true });

interface PageReport {
  route: string;
  ms: number;
  consoleErrors: string[];
  consoleWarnings: string[];
  failedRequests: string[];
  bodyTextLength: number;
  screenshot: string;
}

const reports: PageReport[] = [];

function attach(page: Page, bucket: { errors: string[]; warnings: string[] }) {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') bucket.errors.push(`${msg.text()} @ ${msg.location().url}`);
    if (msg.type() === 'warning') bucket.warnings.push(msg.text());
  });
}

test.describe('00 全页面巡检', () => {
  for (const route of ROUTES) {
    test(`巡检 ${route.path}`, async ({ page }) => {
      const bucket = { errors: [], warnings: [] as string[] };
      attach(page, bucket);
      const failed: string[] = [];
      page.on('response', (res) => {
        if (res.status() >= 400) failed.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      });

      const t0 = Date.now();
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      // 给数据加载一点时间，但不至于让慢页面把整轮拖死
      await page.waitForTimeout(6000);
      const ms = Date.now() - t0;

      const shot = path.join(SHOTS, `${route.name}.png`);
      await page.screenshot({ path: shot, fullPage: true });

      const bodyTextLength = (await page.locator('body').innerText()).length;
      reports.push({
        route: route.path,
        ms,
        consoleErrors: bucket.errors,
        consoleWarnings: bucket.warnings,
        failedRequests: failed,
        bodyTextLength,
        screenshot: shot,
      });

      // 页面不该白屏
      expect(bodyTextLength, `${route.path} 页面文本为空（白屏）`).toBeGreaterThan(10);
    });
  }

  test.afterAll(async () => {
    fs.writeFileSync(
      path.resolve(HERE, '../shots/_route-report.json'),
      JSON.stringify(reports, null, 2),
      'utf-8',
    );
  });
});
