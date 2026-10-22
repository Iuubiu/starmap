/**
 * t43 归属证据之一 / 之三：`RENDER_SYNC_MS` 改前改后的长任务对比 + 反向验证。
 *
 * 用法（生产构建，避免 dev 的 StrictMode 双建与 Vite 模块开销干扰）：
 *   pnpm build && npx vite preview --port 4173 --strictPort &
 *   node probe-t43-longtask.mjs            # 当前值
 *   # 改回 200 → pnpm build → 再跑一遍
 *
 * `vite preview` 不认 `server.proxy`，所以这里用 `page.route` 把 `/api/**`
 * 转给后端，不改共享的 vite 配置。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const NODES = Number(process.env.NODES ?? 3086);
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const API = 'http://127.0.0.1:3001';

const stub = JSON.stringify({
  nodes: Array.from({ length: NODES }, (_, i) => ({
    microKpId: `kp-stub-${i}`,
    name: `桩节点${i}`,
    state: ['unseen', 'learning', 'mastered', 'review'][i % 4],
    percent: (i % 11) * 9,
    depth: i % 3,
    moduleId: `mod-${i % 40}`,
    moduleName: `模块${i % 40}`,
    moduleOrdinal: i % 40,
    ordinal: i,
    reviewDueAt: null,
  })),
  edges: Array.from({ length: Math.floor(NODES * 0.087) }, (_, i) => ({
    from: `kp-stub-${i}`,
    to: `kp-stub-${(i * 7 + 3) % NODES}`,
    kind: 'prereq',
  })),
  contentGaps: [],
  recommendedIds: [],
});

const browser = await chromium.launch();
const runs = [];

for (let r = 0; r < ROUNDS; r++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.route('**/api/v1/graph', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: stub }),
  );
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/v1/graph')) return route.fallback();
    try {
      const res = await fetch(url.replace(/^https?:\/\/[^/]+/, API), {
        method: route.request().method(),
        headers: route.request().headers(),
        body: route.request().postData() ?? undefined,
      });
      return route.fulfill({
        status: res.status,
        contentType: res.headers.get('content-type') ?? 'application/json',
        body: await res.text(),
      });
    } catch {
      return route.fulfill({ status: 502, body: '{}' });
    }
  });

  await page.addInitScript(() => {
    window.__lt = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }
    }).observe({ type: 'longtask', buffered: true });
  });

  const t0 = Date.now();
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.graph-canvas-webgl canvas', { timeout: 60_000 });
  const canvasAt = Date.now() - t0;

  // 等到布局预算（4s）之后再多留 2s，确保停表之后的尾巴也被算进来
  await page.waitForTimeout(Math.max(0, canvasAt + 6000 - (Date.now() - t0)));

  const lt = await page.evaluate(() => window.__lt ?? []);
  await page.close();

  const sum = lt.reduce((a, e) => a + e.dur, 0);
  const max = lt.reduce((a, e) => Math.max(a, e.dur), 0);
  const end = lt.reduce((a, e) => Math.max(a, e.start + e.dur), 0);
  // 布局期 = 画布就绪之后到 4s 预算结束
  const layoutPhase = lt.filter((e) => e.start >= canvasAt - 200 && e.start <= canvasAt + 4000);
  const tail = lt.filter((e) => e.start > canvasAt + 4000);

  runs.push({
    round: r + 1,
    canvasAt,
    ltCount: lt.length,
    ltSum: sum,
    ltMax: max,
    ltEnd: end,
    layoutPhaseCount: layoutPhase.length,
    layoutPhaseSum: layoutPhase.reduce((a, e) => a + e.dur, 0),
    tailCount: tail.length,
    top: lt.slice().sort((a, b) => b.dur - a.dur).slice(0, 4),
  });
}

await browser.close();

const pick = (k) => runs.map((r) => r[k]).sort((a, b) => a - b);
const median = (arr) => arr[Math.floor(arr.length / 2)];

console.log(JSON.stringify({
  base: BASE,
  nodes: NODES,
  rounds: ROUNDS,
  median: {
    canvasAt: median(pick('canvasAt')),
    ltCount: median(pick('ltCount')),
    ltSum: median(pick('ltSum')),
    ltMax: median(pick('ltMax')),
    ltEnd: median(pick('ltEnd')),
    layoutPhaseCount: median(pick('layoutPhaseCount')),
    layoutPhaseSum: median(pick('layoutPhaseSum')),
    tailCount: median(pick('tailCount')),
  },
  runs,
}, null, 1));
