/**
 * t53：/map 首屏长任务归因。
 *
 * ## 为什么要拆成四组
 *
 * 单看 `/map` 的 longSum 只能说明「它比别的页慢」，说不出慢在哪。所以用
 * **对照实验**把成本拆开：
 *
 * | 组 | 做法 | 隔离出来的成本 |
 * |---|---|---|
 * | `/board` | 同一套 shell，没有画布 | shell + 路由 + Fluent provider 的公共成本 |
 * | `/map` 100 节点 | `page.route` 把 `/api/v1/graph` 换成 100 节点 | 与节点数无关的画布固定成本（WebGL program、字体 SDF） |
 * | `/map` 全量 | 真实 3086 节点 | 真实值 |
 * | `/map` 无 WebGL | 让 `getContext('webgl2')` 返回 null | sigma 完全不建时的路径（只剩 React + 清单） |
 *
 * 全量 − 100 节点 = **随节点数增长的成本**；100 节点 − 无 WebGL = **画布固定成本**；
 * 无 WebGL − `/board` = **地图页自身的 React 成本**。
 *
 * ## 测量口径
 *
 * `PerformanceObserver` 监听 `longtask`（>50ms），`goto` 之后等 `SETTLE_MS`
 * 再取值。这与 captain 的探针同口径，数字可直接对比。
 *
 * **环境是 `pnpm dev`（Vite dev server + StrictMode）**，不是 production
 * build：dev 下 ESM 模块数是构建版的数十倍，StrictMode 还会把每个 effect
 * 跑两遍（画布会建一次、拆一次、再建一次）。所以这里的绝对值偏大，看的是
 * **组间差值**而不是绝对值。
 */
import { expect, test, type Page } from '@playwright/test';

const SETTLE_MS = 4_000;
const ROUNDS = Number(process.env.PERF_ROUNDS ?? 3);

interface PerfSample {
  route: string;
  nodes: number;
  longCount: number;
  longMax: number;
  longSum: number;
  /** 清单出现时刻（ms，相对 goto） */
  rosterMs: number;
  /** 画布 `data-node-count` 就绪时刻 */
  canvasMs: number;
  /** 布局跑在哪：worker / static / 无画布 */
  layoutSource: string;
  pageErrors: string[];
}

/** 在页面脚本之前挂 longtask 观察器 + 记里程碑。 */
async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __probeInstalled?: boolean;
      __lt: Array<{ start: number; dur: number }>;
      __marks: Record<string, number>;
    };
    // `addInitScript` 是**累加**的：同一个 page 上装第二次，两份脚本都会在
    // 每次导航时跑，同一条 longtask 就会被 push 两遍、longSum 翻倍。用一个
    // 页面级标记把重复安装挡掉。
    if (w.__probeInstalled === true) return;
    w.__probeInstalled = true;
    w.__lt = [];
    w.__marks = {};
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          w.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* 老浏览器没有 longtask：留空数组，断言会自然失败 */
    }
  });
}

/** 造一份只有 `count` 个节点的图，用来隔离「与节点数无关的固定成本」。 */
function stubGraph(count: number, nameFor: (i: number) => string = (i) => `桩节点${i}`): string {
  const nodes = Array.from({ length: count }, (_, i) => ({
    microKpId: `kp-stub-${i}`,
    name: nameFor(i),
    state: 'unseen',
    percent: 0,
    depth: 1,
    moduleId: 'mod-stub',
    moduleName: '桩模块',
    moduleOrdinal: 0,
    ordinal: i,
    reviewDueAt: null,
  }));
  return JSON.stringify({
    nodes,
    edges: [],
    contentGaps: [],
    recommendedIds: [],
  });
}

async function measure(
  page: Page,
  label: string,
  path: string,
  options: { stubNodes?: number; stubName?: (i: number) => string; noWebgl?: boolean } = {},
): Promise<PerfSample> {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  if (options.noWebgl === true) {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patched(
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
  }

  if (options.stubNodes !== undefined) {
    const body = stubGraph(options.stubNodes, options.stubName);
    await page.route('**/api/v1/graph', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body }),
    );
  }

  const t0 = Date.now();
  await page.goto(`http://localhost:5173${path}`, { waitUntil: 'domcontentloaded' });
  // 对照组 `/board` 没有画布清单，等的是页面主体；其余三组等清单第一项。
  // 两边都等到「首屏内容已经画出来」为止，否则 shell 成本会把差值吃掉。
  await page.waitForSelector(path === '/map' ? '.graph-roster-item' : 'main', {
    timeout: 120_000,
  });
  const rosterMs = Date.now() - t0;

  let canvasMs = -1;
  if (path === '/map') {
    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector('.graph-canvas');
          return el !== null && Number(el.getAttribute('data-node-count')) > 0;
        },
        undefined,
        { timeout: 120_000 },
      );
      canvasMs = Date.now() - t0;
    } catch {
      canvasMs = -1;
    }
  }

  await page.waitForTimeout(SETTLE_MS);

  const measured = await page.evaluate(() => {
    const w = window as unknown as { __lt: Array<{ start: number; dur: number }> };
    const el = document.querySelector('.graph-canvas');
    return {
      longCount: w.__lt.length,
      longMax: Math.round(w.__lt.reduce((m, e) => Math.max(m, e.dur), 0)),
      longSum: Math.round(w.__lt.reduce((s, e) => s + e.dur, 0)),
      nodes: el === null ? 0 : Number(el.getAttribute('data-node-count')),
      layoutSource: el?.getAttribute('data-layout-source') ?? 'none',
    };
  });

  // eslint-disable-next-line no-console
  console.log(
    `PERF ${label.padEnd(18)} nodes=${String(measured.nodes).padStart(5)} ` +
      `long=${String(measured.longCount).padStart(3)} ` +
      `max=${String(measured.longMax).padStart(5)} ` +
      `sum=${String(measured.longSum).padStart(5)} ` +
      `roster=${String(rosterMs).padStart(5)} canvas=${String(canvasMs).padStart(5)} ` +
      `layout=${measured.layoutSource} errors=${pageErrors.length}`,
  );

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  page.removeAllListeners('pageerror');

  return {
    route: label,
    nodes: measured.nodes,
    longCount: measured.longCount,
    longMax: measured.longMax,
    longSum: measured.longSum,
    rosterMs,
    canvasMs,
    layoutSource: measured.layoutSource,
    pageErrors,
  };
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

test('t53：/map 首屏长任务归因（五组对照）', async ({ page }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1280, height: 720 });

  /**
   * 五组对照。第 5 组是**决定性实验**：节点数与全量完全一样（3086），
   * 但名字只有一个字符。如果「随节点数增长」那 4991ms 里主要是 sigma 给
   * 每个标签的每个字生成 SDF 字形纹理（`generateSDFGlyph` + `edt1d`），
   * 那这一组的 longSum 应该显著低于全量；如果两者接近，说明成本在
   * 节点数本身（顶点/索引/拾取纹理），与标签文字量无关。
   */
  const groups: Array<{
    label: string;
    path: string;
    options: { stubNodes?: number; stubName?: (i: number) => string; noWebgl?: boolean };
  }> = [
    { label: '/board', path: '/board', options: {} },
    { label: '/map 100节点', path: '/map', options: { stubNodes: 100 } },
    { label: '/map 3086短名', path: '/map', options: { stubNodes: 3086, stubName: () => '甲' } },
    { label: '/map 全量', path: '/map', options: {} },
    { label: '/map 无WebGL', path: '/map', options: { noWebgl: true } },
  ];

  const samples: PerfSample[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const group of groups) {
      // 每组都换一个新 page：`page.route` 与 `addInitScript` 都是累加的，
      // 复用同一个 page 会让上一组的 stub / noWebgl 泄漏到下一组。
      const tab = await page.context().newPage();
      await tab.setViewportSize({ width: 1280, height: 720 });
      await installProbe(tab);
      samples.push(await measure(tab, group.label, group.path, group.options));
      await tab.close();
    }
  }

  const byGroup = new Map<string, PerfSample[]>();
  for (const sample of samples) {
    const list = byGroup.get(sample.route) ?? [];
    list.push(sample);
    byGroup.set(sample.route, list);
  }

  // eslint-disable-next-line no-console
  console.log('\n=== 中位数（%d 轮）===', ROUNDS);
  const summary: Record<string, Record<string, number | string>> = {};
  for (const [label, list] of byGroup) {
    const row = {
      nodes: median(list.map((s) => s.nodes)),
      longCount: median(list.map((s) => s.longCount)),
      longMax: median(list.map((s) => s.longMax)),
      longSum: median(list.map((s) => s.longSum)),
      rosterMs: median(list.map((s) => s.rosterMs)),
      canvasMs: median(list.map((s) => s.canvasMs)),
      layout: list[0]?.layoutSource ?? 'none',
    };
    summary[label] = row;
    // eslint-disable-next-line no-console
    console.log(
      `${label.padEnd(16)} nodes=${String(row.nodes).padStart(5)} ` +
        `long=${String(row.longCount).padStart(3)} ` +
        `max=${String(row.longMax).padStart(5)} ` +
        `sum=${String(row.longSum).padStart(5)} ` +
        `roster=${String(row.rosterMs).padStart(5)} canvas=${String(row.canvasMs).padStart(5)} ` +
        `layout=${row.layout}`,
    );
  }

  const full = summary['/map 全量']?.longSum as number;
  const small = summary['/map 100节点']?.longSum as number;
  const shortName = summary['/map 3086短名']?.longSum as number;
  const noGl = summary['/map 无WebGL']?.longSum as number;
  const shell = summary['/board']?.longSum as number;
  const pct = (part: number): string => (full === 0 ? '—' : `${Math.round((part / full) * 100)}%`);
  // eslint-disable-next-line no-console
  console.log(
    `\n分解（longSum, ms；占比以全量 ${full} 为分母）：\n` +
      `  shell 公共（/board 也有）  = ${shell}  ${pct(shell)}\n` +
      `  地图页 React（无 WebGL）   = ${noGl} - ${shell} = ${noGl - shell}  ${pct(noGl - shell)}\n` +
      `  画布固定（100 节点即出现）  = ${small} - ${noGl} = ${small - noGl}  ${pct(small - noGl)}\n` +
      `  随节点数增长              = ${full} - ${small} = ${full - small}  ${pct(full - small)}\n` +
      `    ├ 标签文字量            = ${full} - ${shortName} = ${full - shortName}  ${pct(full - shortName)}\n` +
      `    └ 节点数本身            = ${shortName} - ${small} = ${shortName - small}  ${pct(shortName - small)}\n` +
      `  合计                      = ${full}`,
  );

  // 关键事实：布局真的在 worker 里（票 03 第 1 条）
  expect(summary['/map 全量']?.layout, '全量 /map 的布局必须跑在 worker 里').toBe('worker');

  await page.context().close();
});
