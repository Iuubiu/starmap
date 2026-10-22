import { expect, type Page, type ConsoleMessage, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SHOTS = path.resolve(HERE, '../shots');
fs.mkdirSync(SHOTS, { recursive: true });

export const API = 'http://127.0.0.1:3001';

/** 页面错误采集桶。每个场景开头 `attachDiagnostics(page)`，结尾 `expectClean`。 */
export interface Diagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  badResponses: string[];
}

/**
 * 已知的「开发模式噪音」：不是产品缺陷，但会把真实错误淹掉。
 *
 * 每一条都必须能说清「为什么不是产品问题」，并给出验证方法 —— 否则这个列表
 * 就会变成「把报错拉黑」的垃圾桶，最后没人再看控制台。
 *
 * 1. `Keyborg instance kN is being disposed incorrectly.`
 *    Fluent UI 的键盘导航单例（keyborg）在 React 18 StrictMode 下会经历一次
 *    挂载→卸载→再挂载，第一次卸载时它发现自己的 ref 已被顶替，于是打这条
 *    dev-only 的 console.error。**证据**：`keyborg/dist/index.js` 里这句被
 *    `process.env.NODE_ENV !== "production"` 包着；`pnpm --filter @starmap/web build`
 *    产物 `dist/assets/index-*.js` 里 `grep -c "is being disposed incorrectly"` = 0。
 *    生产构建不会有这条，且它不影响任何行为（不影响焦点、不影响键盘导航）。
 */
const DEV_ONLY_NOISE: RegExp[] = [/Keyborg instance \S+ is being disposed incorrectly/];

function isDevOnlyNoise(text: string): boolean {
  return DEV_ONLY_NOISE.some((re) => re.test(text));
}

/**
 * 采集控制台错误 / 未捕获异常 / 网络失败。
 *
 * 只看 `console.error` 不够：React 的未捕获异常走 `pageerror`，而接口 500
 * 往往被页面吞成一句「加载失败」，控制台里一条 error 都没有。三类都要抓。
 */
export function attachDiagnostics(page: Page): Diagnostics {
  const d: Diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] };
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (isDevOnlyNoise(text)) return;
    d.consoleErrors.push(`${text} @ ${msg.location().url}`);
  });
  page.on('pageerror', (err) => d.pageErrors.push(`${err.name}: ${err.message}`));
  page.on('requestfailed', (req: Request) => {
    const f = req.failure();
    d.failedRequests.push(`${req.method()} ${req.url()} — ${f?.errorText ?? 'unknown'}`);
  });
  page.on('response', (res) => {
    const s = res.status();
    if (s >= 400) d.badResponses.push(`${s} ${res.request().method()} ${res.url()}`);
  });
  return d;
}

/** 白屏判据：`#root` 里几乎没有文本、且没有可见的交互元素。 */
export async function assertNotBlank(page: Page) {
  const stats = await page.evaluate(() => {
    const root = document.getElementById('root');
    const text = (root?.innerText ?? '').trim();
    const interactive = document.querySelectorAll('button, input, textarea, select, a[href]').length;
    return { textLen: text.length, interactive, html: root?.innerHTML.length ?? 0 };
  });
  expect(stats.html, '页面根节点是空的（白屏）').toBeGreaterThan(200);
  expect(stats.textLen, '页面上没有可读文本（白屏）').toBeGreaterThan(10);
}

/** 截图到 `.scratch/qa/shots/<name>.png`，返回绝对路径。 */
export async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

/** 元素重叠检测：用 `elementFromPoint` 判「看得见但点不到」。 */
export async function overlappingElements(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    const nodes = Array.from(document.querySelectorAll(sel));
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        out.push(`${el.tagName.toLowerCase()}"${(el.textContent ?? '').trim().slice(0, 20)}" 被 <${hit.tagName.toLowerCase()}> 遮挡`);
      }
    }
    return out;
  }, selector);
}

/** 等待一个接口返回；返回解析后的 JSON（失败给 null）。 */
export async function waitForApi<T = unknown>(page: Page, fragment: string): Promise<T | null> {
  const res = await page.waitForResponse((r) => r.url().includes(fragment) && r.status() < 400, {
    timeout: 30_000,
  });
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 直接打后端（造前置状态用；**断言一律走界面**）。 */
export async function api<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${pathname} → ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * 造「已经定过级、并且重判过一次」的前置状态。
 *
 * ## 为什么场景要自己造
 *
 * 场景 02 要验的是「档位变更历史」这一块**能不能显示出来**，而
 * `TierHistoryCard` 在「从没重判过」时按设计**什么都不渲染**（见
 * `apps/web/src/pages/PlacementPage.tsx` 的注释：空卡片会把正常状态弄得像
 * 出了问题）。本套件跑的是**共享真实库**，别的泳道随时可能清空
 * `app.attempts` / `placement_profile`（实测 2026-10-22 15:34 就是 0 行），
 * 于是这条场景会在「产品没坏、只是库里没历史」时红。
 *
 * 所以：**前置数据自己造，断言仍然只看界面**。这也是 `api()` 存在的理由。
 *
 * 造法走真实接口（不直接写库）：
 *   1. `POST /placement/self-assessment` —— 交自评，页面才有「档位」可看；
 *   2. `POST /placement/sessions` —— 开一场定级；
 *   3. 逐题 `POST /placement/sessions/:id/answers` 直到 `item === null`
 *      （题池用尽或到 18 题上限，两种都正常）；
 *   4. `GET /placement/sessions/:id/result` —— 落定级结果；
 *   5. 补足 `PLACEMENT_LIMITS.rejudgeAfterAttempts`（实测 5）次真实作答 ——
 *      **重判的前置条件是学习证据，不是重考定级题**（服务端原话）；
 *   6. `POST /placement/rejudge` —— 写一条 `tier_rejudge` 学习日志。
 *
 * 第 5 步用的题目来自 `lv-bool-laws`（`kp-bool` 的教学关卡，4 道题覆盖 3 个
 * 变式组），选对答案让 `averageFirstTryRate` 不落到下调线以下 —— 档位变了
 * 也无所谓，历史卡片要验的是「有没有一行记录」，不是「必须是升级」。
 *
 * 幂等：已经有定级结果时**不重复造定级**，但**仍会补作答与重判**（那是真实
 * 学习事件，不是测试垃圾；重判每次都写一行新历史，正是场景要渲染的东西）。
 * 返回是否新造了定级、是否新增了历史行。
 */
export async function ensurePlacementHistory(): Promise<{ created: boolean; rejudged: boolean }> {
  const status = await api<{ tier?: string | null }>('/api/v1/placement').catch(() => null);
  const alreadyPlaced = status !== null && status.tier !== null && status.tier !== undefined;

  if (!alreadyPlaced) {
    // 1. 自评：每题都选中间档，不刻意拉高/拉低先验。
    const sa = await api<{ questions: { id: string; options: { id: string }[] }[] }>(
      '/api/v1/placement/self-assessment',
    );
    const answers = sa.questions.map((q) => ({
      questionId: q.id,
      optionId: q.options[Math.floor(q.options.length / 2)]!.id,
    }));
    await api('/api/v1/placement/self-assessment', {
      method: 'POST',
      body: JSON.stringify({ answers }),
    });

    // 2–4. 开一场定级，答到底，取结果。
    //
    // 注意 `item` 的形状是 `PlacementItemView`（`itemId`，不是 `id`），
    // 且 `null` 表示本场定级已结束（题池用尽或到 18 题上限）。
    type Session = { sessionId: string; item: { itemId: string } | null };
    const session = await api<Session>('/api/v1/placement/sessions', {
      method: 'POST',
      body: JSON.stringify({ selfAssessment: answers }),
    });
    let item = session.item;
    let guard = 0;
    while (item !== null && guard < 30) {
      // 一律选第一个选项：定级只看后验，不追求答对，避免把档位拉偏。
      //
      // 作答响应把**更新后的会话**放在 `session` 字段里（外面还包着判分与
      // 解析），不是顶层的 `item` —— 这里踩过一次。
      const next = await api<{ session: Session }>(
        `/api/v1/placement/sessions/${session.sessionId}/answers`,
        { method: 'POST', body: JSON.stringify({ itemId: item.itemId, answer: 0 }) },
      );
      item = next.session.item;
      guard += 1;
    }
    await api(`/api/v1/placement/sessions/${session.sessionId}/result`);
  }

  // 5. 补足重判所需的学习证据。
  //
  // 服务端拒绝重判时的原话是「重判依据是真实学习证据，不是重考一遍定级题」——
  // 所以这里必须打 `/attempts`，而不是再开一场定级。题目取 `lv-bool-laws`
  // （`kp-bool` 的教学关卡，4 道题覆盖 3 个变式组），答案取真实正确值，
  // 让 `averageFirstTryRate` 不落到下调线以下；档位变不变都无所谓，场景要验
  // 的是「历史卡片渲染出来了」。
  //
  // **不预先算短差**：`/placement` 的 `attemptsSince` 是快照，与重判内部的
  // `totalAttempts - attempts_baseline` 会差一两题（实测 5 → 仍差 1）。改成
  // 「重判被拒就补题再试」，最多 3 轮，够用且不会掩盖真实故障。
  const LEVEL_ITEMS: { itemId: string; answer: number }[] = [
    { itemId: 'i-probe-absorb', answer: 0 },
    { itemId: 'i-deepen-demorgan', answer: 1 },
    { itemId: 'i-quiz-absorb', answer: 1 },
    { itemId: 'i-quiz-demorgan', answer: 0 },
  ];
  const before = await api<{ items: unknown[] }>('/api/v1/tier/changes?limit=10');
  let fed = 0;
  for (let round = 0; round < 3; round += 1) {
    const res = await fetch(`${API}/api/v1/placement/rejudge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.ok) break;
    const text = await res.text();
    const need = /还需要再答\s*(\d+)\s*题/.exec(text);
    if (need === null) throw new Error(`POST /api/v1/placement/rejudge → ${res.status} ${text.slice(0, 300)}`);
    for (let i = 0; i < Number(need[1]); i += 1) {
      const pick = LEVEL_ITEMS[(fed + i) % LEVEL_ITEMS.length]!;
      await api('/api/v1/attempts', { method: 'POST', body: JSON.stringify(pick) });
    }
    fed += Number(need[1]);
  }
  const after = await api<{ items: unknown[] }>('/api/v1/tier/changes?limit=10');

  return { created: !alreadyPlaced, rejudged: after.items.length > before.items.length };
}

/**
 * 造「某个知识点已经有足够掌握度证据」的前置状态。
 *
 * ## 为什么要造
 *
 * `MasteryMeter` 有两个分支：证据不足时只显示「证据不足」+ 还差多少次作答；
 * 证据足够（`MASTERY_MIN_ATTEMPTS = 8` 次作答 + `MASTERY_MIN_VARIANTS = 3` 个
 * 变式组）时才显示「历史最高 / 当前熟练度」这对双字段。场景 08 要验的是
 * **双字段**，所以必须先有证据 —— 否则页面会（正确地）走「证据不足」分支，
 * 测试就变成在验另一个分支了。
 *
 * ## 怎么造
 *
 * 打真实 `/attempts`，题目取 `lv-bool-laws` 的 4 道题（覆盖 `vg-absorb` /
 * `vg-demorgan` / `vg-simplify` 三个变式组），答案取真实正确值 —— 这样
 * `achieved` / `current` 都有非空值，两个字段才都会渲染。
 *
 * 幂等：已经足够就不打接口。
 */
export async function ensureMasteryEvidence(
  microKpId = 'kp-bool',
): Promise<{ attempts: number; variants: number; sufficient: boolean }> {
  type View = {
    attemptCount: number;
    variantCount: number;
    evidenceSufficient: boolean;
  };
  const LEVEL_ITEMS: { itemId: string; answer: number }[] = [
    { itemId: 'i-probe-absorb', answer: 0 },
    { itemId: 'i-deepen-demorgan', answer: 1 },
    { itemId: 'i-quiz-absorb', answer: 1 },
    { itemId: 'i-quiz-demorgan', answer: 0 },
  ];

  let view = await api<View>(`/api/v1/mastery/${microKpId}`);
  // 上限 12 次：MIN_ATTEMPTS 是 8，多答几轮保证「变式组」也够，同时不会把库刷爆。
  for (let i = 0; i < 12 && !view.evidenceSufficient; i += 1) {
    await api('/api/v1/attempts', {
      method: 'POST',
      body: JSON.stringify(LEVEL_ITEMS[i % LEVEL_ITEMS.length]),
    });
    view = await api<View>(`/api/v1/mastery/${microKpId}`);
  }
  return { attempts: view.attemptCount, variants: view.variantCount, sufficient: view.evidenceSufficient };
}

/** 点顶栏标签（Fluent Tab，真实点击而非直接 goto —— 场景要求走导航）。 */
export async function navTab(page: Page, label: string) {
  await page.getByRole('tab', { name: label, exact: true }).click();
  await page.waitForTimeout(600);
}

/** 把整页可见文本收成一个字符串，用于「同一事实两处一致」的比对。 */
export async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => (document.body.innerText ?? '').replace(/\s+/g, ' '));
}
