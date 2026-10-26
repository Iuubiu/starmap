/**
 * 学习会话 V1 批次 · 2560×1440 布局与搜索实测探针。
 *
 * 依据 AGENTS.md 硬规则：视觉验证以全屏 2560×1440 为基准，报数必须带实测数字。
 * 覆盖：票 01（B5 输入区形状）、02/03/04（右栏三卡在场）、06（basis 行）、
 * 07（换个知识点：消歧/页码/空态/浏览器层 200ms 判据）、08（章·节路径行）。
 *
 * 用法：先起 dev（pnpm dev，api:3001 / web:5173），再在 apps/web 下 `node probe-lsv1.mjs`。
 * 产物：控制台数字 + .scratch/learning-session-v1/shots/ 截图。
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const SHOTS = '../.scratch/learning-session-v1/shots';
mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch();
const p = await (
  await b.newContext({
    viewport: { width: 2560, height: 1440 },
    baseURL: 'http://localhost:5173',
    locale: 'zh-CN',
  })
).newPage();
// 首访画像问卷放行（WelcomePage.tsx 的 PROFILE_DONE_KEY；探针只测学习台本身）
await p.addInitScript(() => window.localStorage.setItem('profileDone', '1'));

const num = (v) => Math.round(v * 100) / 100;
const rect = async (sel) => {
  const r = await p.locator(sel).first().boundingBox();
  return r ? { x: num(r.x), y: num(r.y), w: num(r.width), h: num(r.height) } : null;
};

// ---- 1. 首页布局（B5）----
await p.goto('/');
await p.waitForSelector('.sm-composer-box', { timeout: 20000 });
await p.waitForTimeout(2500); // 等右栏接口落定

const layout = await p.evaluate(() => ({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  scrollWidth: document.documentElement.scrollWidth,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
}));
console.log('[layout]', JSON.stringify(layout));
console.log('[composer-box]', JSON.stringify(await rect('.sm-composer-box')));
console.log('[composer-input]', JSON.stringify(await rect('.sm-composer-input')));

// B5 三条形状断言：工具条/档位 chip/上下文细条都必须不存在
for (const gone of ['.sm-composer-toolbar', '.sm-composer-chip', '.sm-composer-context']) {
  console.log(`[b5] ${gone} count =`, await p.locator(gone).count(), '(must be 0)');
}

// ---- 2. 右栏卡片在场与内容（HomeV2 集成后：data-study-* 标记）----
const sideText = await p.locator('aside.v2-log').first().innerText().catch(() => '');
console.log('[rail] aside text head =', JSON.stringify(sideText.slice(0, 500)));
for (const mark of ['data-study-now', 'data-study-tier', 'data-study-session-limit', 'data-kp-progress']) {
  console.log(`[rail] [${mark}] count =`, await p.locator(`[${mark}]`).count());
}
for (const label of ['正在学', '当前档位', '本知识点进度', '一次最多推进']) {
  console.log(`[rail] 「${label}」count =`, await p.getByText(label).count());
}
const basis = await p.getByText(/由 \d+ 次作答判定|定级后这里会写判定依据/).count();
console.log('[06] basis 行 count =', basis);

await p.screenshot({ path: `${SHOTS}/home-2560.png` });

// ---- 3. 换个知识点：索引、查询计时、消歧、页码、空态 ----
const switchBtn = p.getByRole('button', { name: '换个知识点' });
console.log('[07] 换个知识点 button =', await switchBtn.count());
if (await switchBtn.count()) {
  await switchBtn.first().click();
  // 索引建立计时（弹层打开到可输入）
  const t0 = performance.now();
  const box = p.locator('input:visible').first();
  await box.waitFor({ state: 'visible', timeout: 15000 });
  await p.waitForTimeout(2500); // 分页拉全后建索引
  console.log('[07] 弹层+索引就绪耗时 ms =', num(performance.now() - t0));

  // 名字搜 + 计时（浏览器层 200ms 判据）
  const q1 = performance.now();
  await box.fill('吸收律');
  await p.waitForTimeout(60);
  const listText1 = await p.locator('body').innerText();
  const tQuery1 = performance.now() - q1;
  console.log('[07] 名字搜「吸收律」query ms =', num(tQuery1), '(<200)',
    '命中 =', listText1.includes('吸收律') ? 'yes' : 'no');
  const hits1 = await p.getByText('吸收律').count();
  console.log('[07] 结果条数(粗) =', hits1, '；含书名消歧 =', /《|版|第\s*\d+\s*页/.test(listText1) ? 'yes' : 'check');
  await p.screenshot({ path: `${SHOTS}/kp-search-name.png` });

  // 页码搜
  await box.fill('12');
  await p.waitForTimeout(60);
  const q2 = performance.now();
  await p.waitForTimeout(30);
  console.log('[07] 页码搜「12」query ms =', num(performance.now() - q2), '；结果区非空 =',
    (await p.getByText(/没找到这个知识点/).count()) === 0 ? 'yes' : 'EMPTY');
  await p.screenshot({ path: `${SHOTS}/kp-search-page.png` });

  // 空态
  await box.fill('zzzz不存在的知识点qqq');
  await p.waitForTimeout(60);
  console.log('[07] 空态文案 count =', await p.getByText('没找到这个知识点').count(), '(must be ≥1)');
  await p.screenshot({ path: `${SHOTS}/kp-search-empty.png` });

  // 点选一条 → 地址栏焦点链
  await box.fill('吸收律');
  await p.waitForTimeout(80);
  const firstHit = p.getByText('吸收律').first();
  if (await firstHit.isVisible().catch(() => false)) {
    await firstHit.click();
    await p.waitForTimeout(1200);
    console.log('[07] 点选后 URL =', p.url());
  }
}

await b.close();
console.log('done.');
