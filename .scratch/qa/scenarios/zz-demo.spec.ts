import { expect, test, type Page } from '@playwright/test';
import { api, attachDiagnostics, shot } from './_helpers';

/**
 * 等页面静下来：只等**不确定态** progressbar（没有 `aria-valuenow` 的那些）。
 *
 * 本仓每个数据区都有 `role=progressbar` 的 pending 态，但 `ProbePanel` 的
 * 「提示等级 1/5」是定值量尺（`aria-valuenow="0.2"`），会一直在页面上 ——
 * 把它也算成 loading，任何开着探针面板的页面都等不到静下来。
 * （同 `03-twenty.spec.ts` 里的同名函数；那边是文件内私有，没有从 `_helpers` 导出。）
 */
async function settled(page: Page, timeout = 30_000) {
  await page.waitForFunction(
    () => document.querySelectorAll('[role="progressbar"]:not([aria-valuenow])').length === 0,
    undefined,
    { timeout },
  );
}

/**
 * 零模型五连（背景铺垫，**不是演示主线**）：13 关卡市场 → 16 数据库 → 05 图谱
 * → 08 节点溯源 → 10 关卡播放。
 *
 * ## 它在演示里的位置
 *
 * 演示主线是 `zz-demo-tiers.spec.ts`（三种学习者学同一个知识点）。这一条是
 * 主线讲完之后用来「证明资产厚度」的：五步全部走真实接口与真实库，**一次模型
 * 都不调**，所以现场网断了也能演。操作卡里明确写了它只是背景，不要用它开场。
 *
 * ## 为什么把「零模型」做成硬断言
 *
 * 这五步里最容易悄悄变成「调模型」的是 10（关卡播放）与 08（节点详情）：两者的
 * 页面在数据缺失时会退化成「用 AI 生成」。真出现那种退化，演示会从 3 秒变成
 * 30 秒并且依赖网络 —— 所以这里统计整个 spec 期间 `/api/v1/agent/turns` 与
 * `/api/v1/agent/probes` 的请求数，必须为 0。
 *
 * ## 前置断言为什么必须「说人话」
 *
 * 共享库被别的泳道清过、被迁移改过（13 本英文教材物理移除那次，写死的
 * `> 5000` 当场变红但地图一个点没少画）。所以这里每条前置断言都在失败时
 * 指出「哪个前置变了、去核对什么」，而不是抛一个看不懂的超时。
 */
const MODEL_ENDPOINTS = [/\/api\/v1\/agent\/turns/, /\/api\/v1\/agent\/probes/];

interface StepLog {
  step: string;
  ms: number;
  ok: boolean;
  note?: string;
}

const LOG: StepLog[] = [];
/** 全 spec 期间命中模型端点的请求（跨页面累计）。 */
const MODEL_HITS: string[] = [];

function watchModelCalls(page: Page) {
  page.on('request', (req) => {
    const url = req.url();
    if (MODEL_ENDPOINTS.some((re) => re.test(url))) MODEL_HITS.push(`${req.method()} ${url}`);
  });
}

async function step(name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try {
    const note = (await fn()) ?? undefined;
    LOG.push({ step: name, ms: Date.now() - t0, ok: true, note });
    console.log(`[demo] ✓ ${name} — ${Date.now() - t0} ms${note ? ` — ${note}` : ''}`);
  } catch (err) {
    LOG.push({ step: name, ms: Date.now() - t0, ok: false, note: String(err).slice(0, 400) });
    console.log(`[demo] ✗ ${name} — ${Date.now() - t0} ms — ${String(err).slice(0, 400)}`);
    throw err;
  }
}

test.afterAll(() => {
  const total = LOG.reduce((s, l) => s + l.ms, 0);
  const failed = LOG.filter((l) => !l.ok);
  console.log(
    `[demo] 合计 ${LOG.length} 步 / 失败 ${failed.length} / 总耗时 ${(total / 1000).toFixed(1)}s\n` +
      LOG.map((l) => `[demo]   ${l.ok ? 'passed' : 'failed'}  ${l.step}  ${(l.ms / 1000).toFixed(1)}s`).join('\n'),
  );
  console.log(`[demo] 模型端点命中 ${MODEL_HITS.length} 次${MODEL_HITS.length ? '：' + MODEL_HITS.join(' | ') : ''}`);
});

test('零模型五连：13 市场 → 16 数据库 → 05 图谱 → 08 溯源 → 10 关卡', async ({ page }) => {
  test.setTimeout(240_000);
  watchModelCalls(page);

  // ---------- 前置数据断言（失败时说人话） ----------
  await step('前置：内容库与关卡库状态', async () => {
    const stats = await api<{
      knowledgePoints: { total: number };
      chunks: { total: number };
      sources: Array<{ id: string; kind: string }>;
    }>('/api/v1/content/stats');
    expect(stats.knowledgePoints.total, '前置数据变了：内容库知识点为 0 —— 先核对是否有人跑了 tools/ingest 重导或迁移').toBeGreaterThan(0);
    expect(stats.chunks.total, '前置数据变了：切片为 0').toBeGreaterThan(0);

    const graph = await api<{ nodes: Array<{ id?: string; microKpId?: string }> }>('/api/v1/graph');
    const ids = new Set(graph.nodes.map((n) => n.id ?? n.microKpId ?? ''));
    for (const kp of ['kp-bool', 'kp-chenboxian-2011-3-2']) {
      expect(ids.has(kp), `前置数据变了：图谱里没有 ${kp}（08 与 10 依赖它）。先核对 content:import 是否跑过。`).toBe(true);
    }

    // 技能库接口是 `/api/v1/agent/skills`（不是 `/api/v1/skills`，写错了会拿到
    // 一个 404 的 JSON 而不是数组，于是 skillCount 变成 -1 而看不出原因）。
    const skills = await api<{ items?: unknown[] }>('/api/v1/agent/skills');
    const skillCount = Array.isArray(skills?.items) ? skills.items.length : -1;
    expect(skillCount, `前置数据变了：skill 数 ${skillCount} < 2（技能库页会空）`).toBeGreaterThanOrEqual(2);

    return `kp=${stats.knowledgePoints.total} chunks=${stats.chunks.total} nodes=${graph.nodes.length} skills=${skillCount}`;
  });

  // ---------- 13 关卡市场 ----------
  await step('13 关卡市场：预制关卡可列出并进入', async () => {
    const diag = attachDiagnostics(page);
    await page.goto('/market');
    await settled(page);
    await expect(page.getByRole('heading', { name: '关卡市场' })).toBeVisible();
    const restarts = page.getByRole('button', { name: '重新开始' });
    const count = await restarts.count();
    expect(count, `前置数据变了：关卡市场预制关卡 ${count} 张（应 ≥1）。先核对关卡库是否被清过。`).toBeGreaterThanOrEqual(1);
    await shot(page, 'demo-13-market');
    expect(diag.pageErrors, `未捕获异常：${diag.pageErrors.join(' | ')}`).toEqual([]);
    return `预制 ${count} 张`;
  });

  // ---------- 16 数据库页 ----------
  await step('16 数据库页：页面数字与 /content/stats 逐字一致', async () => {
    const diag = attachDiagnostics(page);
    const stats = await api<{ knowledgePoints: { total: number }; chunks: { total: number } }>('/api/v1/content/stats');
    await page.goto('/database');
    await settled(page);
    const body = await page.getByRole('main').innerText();
    expect(body, `数据库页上没有知识点总数 ${stats.knowledgePoints.total} —— 页面数字与接口不一致（这条正是「不是示例数据」的判据）`).toContain(
      String(stats.knowledgePoints.total),
    );
    expect(body, `数据库页上没有切片总数 ${stats.chunks.total}`).toContain(String(stats.chunks.total));
    await shot(page, 'demo-16-database');
    expect(diag.pageErrors, `未捕获异常：${diag.pageErrors.join(' | ')}`).toEqual([]);
    return `kp=${stats.knowledgePoints.total} chunks=${stats.chunks.total}`;
  });

  // ---------- 05 知识图谱 ----------
  await step('05 知识图谱：画布点数 = 接口节点数', async () => {
    const diag = attachDiagnostics(page);
    await page.goto('/map');
    await settled(page);
    const canvas = page.locator('.graph-canvas-webgl, .graph-canvas').first();
    await expect(canvas, '地图画布没渲染出来（sigma 的 itemSizesReference 若退回 positions，画布会是一整块纯色）').toBeVisible();
    const count = Number(await canvas.getAttribute('data-node-count'));
    const graph = await api<{ nodes: unknown[] }>('/api/v1/graph');
    expect(count, `画布点数 ${count} 应等于接口节点数 ${graph.nodes.length}`).toBe(graph.nodes.length);
    await shot(page, 'demo-05-map');
    expect(diag.pageErrors, `未捕获异常：${diag.pageErrors.join(' | ')}`).toEqual([]);
    return `nodes=${count}`;
  });

  // ---------- 08 节点详情溯源 ----------
  await step('08 节点详情：来自哪本书哪一页', async () => {
    const diag = attachDiagnostics(page);
    // 只读断言：不调 ensureMasteryEvidence（那会写 attempts，破坏「干净起点」的
    // 演示前提，且会让三档主线的首屏出现「你已经掌握」）。掌握度双字段的证据
    // 由 03-twenty 场景 08 负责，这里只验「溯源」这一件演示要讲的事。
    await page.goto('/map/kp-chenboxian-2011-3-2');
    await settled(page);
    const body = await page.getByRole('main').innerText();
    expect(body, '节点详情页没有教材名（溯源断了）').toMatch(/辐射|探测|核/);
    expect(body, '节点详情页没有页码（「来自哪本书哪一页」是这一步要证明的事）').toMatch(/第\s*\d+\s*页/);
    await shot(page, 'demo-08-node');
    expect(diag.pageErrors, `未捕获异常：${diag.pageErrors.join(' | ')}`).toEqual([]);
    const page0 = (body.match(/第\s*\d+\s*页/) ?? [])[0] ?? '';
    return page0;
  });

  // ---------- 10 关卡播放推进 ----------
  await step('10 关卡播放：能推进到下一段', async () => {
    const diag = attachDiagnostics(page);
    await page.goto('/level/lv-bool-laws');
    await settled(page);
    await expect(page.getByText(/第\s*\d\s*段/).first()).toBeVisible({ timeout: 30_000 });
    let advanced = 0;
    for (let i = 0; i < 24 && advanced < 2; i += 1) {
      const next = page.getByRole('button', { name: '进入下一段' });
      if (await next.isEnabled().catch(() => false)) {
        await next.click();
        advanced += 1;
        await settled(page);
        continue;
      }
      const sub = page.getByRole('button', { name: '提交答案' });
      if (await sub.isVisible().catch(() => false)) {
        const radios = page.locator('input[type="radio"]:enabled');
        if ((await radios.count()) > 0) await radios.first().check();
        if (await sub.isEnabled().catch(() => false)) await sub.click();
        await page.waitForTimeout(400);
      } else {
        await page.waitForTimeout(300);
      }
    }
    expect(advanced, '关卡一段都推不动（关卡页在真人手里卡住）').toBeGreaterThanOrEqual(1);
    await shot(page, 'demo-10-level');
    expect(diag.pageErrors, `未捕获异常：${diag.pageErrors.join(' | ')}`).toEqual([]);
    return `推进 ${advanced} 段`;
  });

  // ---------- 零模型断言 ----------
  expect(
    MODEL_HITS,
    `这五步必须零模型调用，实际命中 ${MODEL_HITS.length} 次：${MODEL_HITS.join(' | ')} —— ` +
      '说明某一步退化成了「用 AI 生成」，演示会从 3 秒变成 30 秒且依赖网络',
  ).toEqual([]);
  console.log(`[demo] 零模型断言通过：模型端点命中 ${MODEL_HITS.length} 次`);
});
