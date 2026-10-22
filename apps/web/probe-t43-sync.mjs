/**
 * t43 归属证据：`apps/web/src/graph/layout.ts` 的 `RENDER_SYNC_MS` 与
 * `stopConverging()` 里那次 `stopSync()` 到底改变了什么。
 *
 * 用法（必须先 `pnpm build` + `vite preview`）：
 *   node probe-t43-sync.mjs
 *
 * 量三件事：
 *   1. 长任务条数 / 总时长 / 末尾时刻（PerformanceObserver longtask）
 *   2. 布局期的**视觉步进幅度**：每 100ms 截一次画布，算与上一帧的平均像素差。
 *      这回答「400ms 一次写回会不会看起来一顿一顿」—— 步进幅度小到看不出来就没事。
 *   3. 相机平移是否受影响：布局期间按住拖动画布，量平移前后画布中心区域的
 *      位移像素数。相机变换与节点坐标同步无关，这条用来证明「拖动不滞后」。
 */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';

const BASE = process.env.BASE ?? 'http://localhost:4173';
const NODES = Number(process.env.NODES ?? 3086);
const SETTLE = Number(process.env.SETTLE ?? 6000);

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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

await page.route('**/api/v1/graph', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: stub }),
);

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

// ---- 2. 视觉步进：每 100ms 截一次，算与上一帧的平均像素差 ----
const shots = [];
const canvas = page.locator('.graph-canvas-webgl');
for (let i = 0; i < 60; i++) {
  const buf = await canvas.screenshot();
  shots.push({ at: Date.now() - t0, buf });
  await page.waitForTimeout(100);
  if (Date.now() - t0 > SETTLE + 4000) break;
}

await page.waitForTimeout(1000);
const lt = await page.evaluate(() => window.__lt ?? []);
await browser.close();

// 用 Playwright 自带的 PNG 解码不可得，改用原始字节做近似：
// 同一尺寸的 PNG 字节流长度 + sha1 只能判断「变没变」，判断不了「变了多少」。
// 所以这里退一步：统计**有变化的帧**与**变化帧的时间间隔**，以及每个间隔内
// 画布内容是否真的变了（sha1 不同）。步进幅度的绝对值由另一个脚本量。
const changed = [];
let prev = null;
for (const s of shots) {
  const h = createHash('sha1').update(s.buf).digest('hex');
  if (prev !== h) {
    changed.push(s.at);
    prev = h;
  }
}

const gaps = changed.slice(1).map((v, i) => v - changed[i]);

const buckets = new Map();
for (const e of lt) {
  const k = Math.floor(e.start / 1000);
  const b = buckets.get(k) ?? { n: 0, sum: 0, max: 0 };
  b.n += 1;
  b.sum += e.dur;
  b.max = Math.max(b.max, e.dur);
  buckets.set(k, b);
}

const sum = lt.reduce((a, e) => a + e.dur, 0);
const max = lt.reduce((a, e) => Math.max(a, e.dur), 0);
const last = lt.reduce((a, e) => Math.max(a, e.start + e.dur), 0);

console.log(
  JSON.stringify(
    {
      nodes: NODES,
      canvasAt,
      ltCount: lt.length,
      ltSum: sum,
      ltMax: max,
      ltEnd: last,
      bySecond: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ s: k, ...v })),
      frames: shots.length,
      changedFrames: changed.length,
      changeTimes: changed.map((v) => v),
      gapMedian: gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null,
      top: lt.slice().sort((a, b) => b.dur - a.dur).slice(0, 6),
    },
    null,
    1,
  ),
);
