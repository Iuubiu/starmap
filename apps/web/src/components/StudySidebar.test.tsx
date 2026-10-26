/**
 * StudySidebar（票 83）：三门槛 + 实时建议的组件测试。
 *
 * 这里钉住这些事：
 * 1. 门槛上限的镜像常量是 8 / 3 / 2 —— 与 `packages/engine` 的三个常量一一对应。
 *    前端不 import engine（纯函数包不该打进浏览器包），所以用镜像常量，
 *    这条断言就是防漂移的那根钉子。票 06 起渲染行只剩作答/变式两条
 *    （连对进了档位卡的 basis 句），但常量仍钉住引擎真值。
 * 2. 「证据不足」不能显示成 `0 / 8`。
 * 3. `trailingCorrect` 从门控判定的 `itemIds − wrongItemIds` 尾部连续段算连对
 *    （票 06 起不进门槛行，函数保留）。
 * 4. 建议最多 3 条，点一下只把话交给输入框（`onAsk`），不发送。
 * 5. 票 02 起：右栏档位卡的两态文案——fallback 不许说「你的水平是 P1」，
 *    卡里不许出现任何切换档位的控件。
 * 6. 票 03 起：右栏「正在学」卡——名字回到侧栏（细条时代的「名字不在这里
 *    出现」口径随之作废），关卡入口两态。票 08 起来源行升级为「章 · 节」
 *    路径（ancestors join，分隔符是前端文案），pageLabel 降为悬浮；
 *    无祖先时沿用 pageLabel，手工 kp 两样都没有就整行不渲染。
 * 7. 票 06 起：档位卡 why 行显示服务端拼好的 `basis` 整句（透传，前端不拼）；
 *    连对行从门槛卡删除，三行变两行。
 */
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/msw';
import type { GateHistoryResponse, MasteryView, UnlockState } from '../api/queries';
import type { KpProgressView } from '@starmap/api-contract';
import {
  ATTEMPT_TARGET,
  STREAK_TARGET,
  StudySidebar,
  VARIANT_TARGET,
  buildSuggestions,
  progressRows,
  progressRowsFromView,
  trailingCorrect,
} from './StudySidebar';

function mastery(overrides: Partial<MasteryView> = {}): MasteryView {
  return {
    microKpId: 'kp-bool',
    name: '布尔代数基本运算',
    isLeaf: true,
    state: 'familiar',
    achieved: 0.62,
    current: 0.55,
    attemptCount: 3,
    variantCount: 2,
    evidenceSufficient: false,
    halfLifeDays: 30,
    lastEvidenceAt: '2026-10-22T10:00:00.000Z',
    aggregatedLeafCount: 0,
    ...overrides,
  };
}

function gateHistory(itemIds: string[], wrongItemIds: string[]): GateHistoryResponse {
  return {
    levelId: 'lv-bool-laws',
    evaluations: [
      {
        levelId: 'lv-bool-laws',
        microKpId: 'kp-bool',
        mode: 'exit',
        verdict: wrongItemIds.length === 0 ? 'passed' : 'failed',
        reason: wrongItemIds.length === 0 ? 'passed' : 'below_threshold',
        passed: wrongItemIds.length === 0,
        rule: { itemCount: 8, passCount: 7 },
        correct: itemIds.length - wrongItemIds.length,
        total: itemIds.length,
        shortfall: wrongItemIds.length,
        message: '判定说明',
        itemIds,
        wrongItemIds,
        evaluatedAt: '2026-10-22T10:05:00.000Z',
        remediation: null,
      },
    ],
  };
}

function unlock(overrides: Partial<UnlockState> = {}): UnlockState {
  return {
    microKpId: 'kp-kmap',
    unlocked: false,
    blockers: [
      {
        prerequisiteId: 'kp-bool',
        prerequisiteName: '布尔代数基本运算',
        levelId: 'lv-bool-laws',
        levelTitle: '逻辑代数基本律',
        gateMode: 'exit',
        lastVerdict: 'failed',
        shortfall: 2,
        lastAttemptedItemIds: [],
      },
    ],
    ...overrides,
  };
}

/**
 * 票 02 起右栏卡自己在组件里调 hook 取数（useTierOverview / useTierSessionPlan），
 * 所以组件测试也要像页面测试一样给一个 QueryClient。
 *
 * 票 03 起「正在学」卡里有导航（打开关卡 → /level/:id、去地图选 → /map），
 * 所以再套一层 MemoryRouter，并给两个目标路由一个占位页 —— 断言「点按钮后
 * 占位页出现」就是在测真的路由跳转，而不是 mock navigate 数调用次数。
 *
 * `retry: false` 是刻意的：msw 里用 server.use 打的错桩如果触发 react-query
 * 默认的三次退避重试，单测会多等几秒才见到错误分支。
 */
/**
 * 地址栏探针（票 07）：「换个知识点」点选后断言的是**真的路由跳转**
 * （`/?kp=<id>`），不是 mock navigate 的调用次数。探针文本刻意带前缀，
 * 不与卡片里的知识点名撞。
 */
function LocationProbe() {
  const [searchParams] = useSearchParams();
  return <div>探针kp:{searchParams.get('kp') ?? '无'}</div>;
}

function renderSidebar(overrides: Partial<Parameters<typeof StudySidebar>[0]> = {}) {
  const onAsk = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    microKpName: '布尔代数基本运算',
    mastery: mastery(),
    unlock: { microKpId: 'kp-bool', unlocked: true, blockers: [] },
    gateHistory: gateHistory(['i1', 'i2', 'i3'], ['i2']),
    onAsk,
    ...overrides,
  } as Parameters<typeof StudySidebar>[0];
  render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <LocationProbe />
                  <StudySidebar {...props} />
                </>
              }
            />
            <Route path="/level/:levelId" element={<div>关卡页占位</div>} />
            <Route path="/map" element={<div>地图占位</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
  return { onAsk };
}

/** 局部覆盖 `GET /api/v1/tier`（默认桩在 test/msw.ts，是 P1 placement）。 */
const stubTier = (body: Record<string, unknown>) => {
  server.use(http.get('*/api/v1/tier', () => HttpResponse.json(body)));
};

/** 一份完整的 TierOverviewResponse 形状；抄漏字段会让「接口透传」的断言失焦。 */
const tierOverview = (overrides: Record<string, unknown> = {}) => ({
  tier: 'P2',
  source: 'placement',
  params: {
    tier: 'P2',
    firstRoundShape: 'completion',
    ladder: { start: 2, cap: 4 },
    sessionNewKpLimit: 3,
    feedbackTiming: 'step_immediate_with_summary',
    attemptsPerItem: 2,
    masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
  },
  label: '补全步骤',
  description: '样例留一步让你补。',
  // 票 06：basis 整句 + 三个数值字段（有定级记录的样本形状）
  basis: '由 3 次作答判定 · 2 个变式已覆盖 · 连对 1/2',
  basisAttempts: 3,
  basisVariants: 2,
  basisStreak: 1,
  ...overrides,
});

describe('常量与引擎同源', () => {
  it('三门槛是 8 / 3 / 2（MASTERY_MIN_ATTEMPTS / MASTERY_MIN_VARIANTS / consecutiveCorrect）', () => {
    expect(ATTEMPT_TARGET).toBe(8);
    expect(VARIANT_TARGET).toBe(3);
    expect(STREAK_TARGET).toBe(2);
  });
});

describe('trailingCorrect：连对来自最近一次判定的尾部连续段', () => {
  it('尾部全对 → 全段长度', () => {
    expect(trailingCorrect(gateHistory(['a', 'b', 'c', 'd'], []))).toBe(4);
  });

  it('中间错一道 → 只数尾部的对', () => {
    expect(trailingCorrect(gateHistory(['a', 'b', 'c', 'd'], ['b']))).toBe(2);
  });

  it('最后一题错 → 0（不是证据不足）', () => {
    expect(trailingCorrect(gateHistory(['a', 'b'], ['b']))).toBe(0);
  });

  it('没有判定记录 → null', () => {
    expect(trailingCorrect(undefined)).toBeNull();
    expect(trailingCorrect({ levelId: 'x', evaluations: [] })).toBeNull();
  });

  it('多条判定取 evaluatedAt 最新的一条', () => {
    const older = gateHistory(['a', 'b', 'c'], []);
    older.evaluations[0]!.evaluatedAt = '2026-10-01T00:00:00.000Z';
    const newer = gateHistory(['a', 'b', 'c'], ['a']);
    newer.evaluations[0]!.evaluatedAt = '2026-10-22T00:00:00.000Z';
    expect(trailingCorrect({ levelId: 'x', evaluations: [...older.evaluations, ...newer.evaluations] })).toBe(2);
  });
});

describe('progressRows：证据不足不显示 0（票 06 起只有作答/变式两行）', () => {
  it('有作答记录时给实测数；连对行已删，两行', () => {
    const rows = progressRows(mastery({ attemptCount: 3, variantCount: 2 }));
    expect(rows.map((row) => [row.label, row.value, row.target])).toEqual([
      ['作答', 3, 8],
      ['变式', 2, 3],
    ]);
  });

  it('没有 mastery → 两条都是 null', () => {
    const rows = progressRows(undefined);
    expect(rows.every((row) => row.value === null)).toBe(true);
  });

  it('有一题但证据不够 → 仍显示实测数（不是 0 假装）', () => {
    const rows = progressRows(mastery({ attemptCount: 1, evidenceSufficient: false }));
    expect(rows[0]!.value).toBe(1);
    expect(rows).toHaveLength(2);
  });
});

describe('StudySidebar：渲染两门槛', () => {
  it('作答 3/8、变式 2/3；连对不出现（票 06：进了档位 basis 句）', () => {
    renderSidebar({
      mastery: mastery({ attemptCount: 3, variantCount: 2 }),
      gateHistory: gateHistory(['a', 'b', 'c'], ['a']),
    });
    expect(screen.getByText('3 / 8')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.queryByText('2 / 2')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-study-row]')).toHaveLength(2);
  });

  it('没有知识点时给出选择提示，而不是 0 / 8', () => {
    renderSidebar({ microKpName: null, mastery: undefined });
    expect(screen.getByText(/还没选知识点/)).toBeInTheDocument();
    expect(screen.queryByText('0 / 8')).not.toBeInTheDocument();
  });
});

describe('buildSuggestions：最多 3 条，来源可辨', () => {
  it('前置挡路排第一', () => {
    const suggestions = buildSuggestions({ mastery: mastery(), unlock: unlock() });
    expect(suggestions[0]!.source).toBe('prereq');
    expect(suggestions[0]!.text).toContain('布尔代数基本运算');
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it('阈值差给的是可数的还差几题', () => {
    const suggestions = buildSuggestions({
      mastery: mastery({ attemptCount: 3, evidenceSufficient: false }),
    });
    expect(suggestions.some((item) => item.text.includes('还差 5 道题'))).toBe(true);
  });

  it('变式够了但变式不足 → 提醒换问法', () => {
    const suggestions = buildSuggestions({
      mastery: mastery({ attemptCount: 8, variantCount: 1, evidenceSufficient: false }),
    });
    expect(suggestions.some((item) => item.text.includes('还差 2 种变式'))).toBe(true);
  });

  it('已掌握 → 提醒复验', () => {
    const suggestions = buildSuggestions({ mastery: mastery({ state: 'mastered' }) });
    expect(suggestions.some((item) => item.text.includes('复验'))).toBe(true);
  });

  it('上一轮追问作为错因线索', () => {
    const suggestions = buildSuggestions({ lastProbe: '为什么德摩根律要取反？' });
    expect(suggestions.some((item) => item.text.includes('德摩根律'))).toBe(true);
  });

  it('永远不超过 3 条', () => {
    const suggestions = buildSuggestions({
      mastery: mastery({ state: 'mastered', attemptCount: 2 }),
      unlock: unlock(),
      lastProbe: '追问一句',
    });
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });
});

describe('StudySidebar：建议点击只填不发', () => {
  it('点建议把整句交给 onAsk，且只调用一次', () => {
    const { onAsk } = renderSidebar({
      mastery: mastery({ attemptCount: 3, evidenceSufficient: false }),
      unlock: { microKpId: 'kp-bool', unlocked: true, blockers: [] },
      gateHistory: undefined,
    });
    const buttons = screen.getAllByRole('button');
    const suggestion = buttons.find((button) => button.textContent?.includes('还差'));
    expect(suggestion).toBeDefined();
    fireEvent.click(suggestion!);
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk.mock.calls[0]![0]).toContain('还差 5 道题');
  });

  it('没有建议时给一句「继续往下学」而不是空白', () => {
    renderSidebar({
      mastery: mastery({ evidenceSufficient: true, attemptCount: 8, variantCount: 3, state: 'proficient' }),
      unlock: { microKpId: 'kp-bool', unlocked: true, blockers: [] },
      gateHistory: gateHistory(['a'], []),
    });
    expect(screen.getByText(/暂时没有更强的建议/)).toBeInTheDocument();
  });
});

describe('票 89：进度读接口（前端不硬编码阈值、不做除法）', () => {
  const view: KpProgressView = {
    microKpId: 'kp-bool',
    name: '布尔代数基本运算',
    levelId: 'lv-bool-laws',
    levelTitle: '逻辑代数基本律：吸收律与德摩根律',
    // 服务端饱和后的数字：474 次累计 → 8（阈值 8），真数留在 cumulative
    gates: [
      { key: 'attempts', label: '作答', value: 8, cumulative: 474, target: 8, ratio: 1, reached: true, unit: '题' },
      { key: 'variants', label: '变式', value: 3, cumulative: 3, target: 3, ratio: 1, reached: true, unit: '组' },
      { key: 'streak', label: '连对', value: 1, cumulative: 1, target: 2, ratio: 0.5, reached: false, unit: '题' },
    ],
    gatePassed: false,
    gateEvaluatedAt: null,
    evaluatedAt: '2026-10-23T00:00:00.000Z',
  };

  it('门槛的值、阈值、比例都来自接口，400 次累计不会显示成「474 / 8」', () => {
    const rows = progressRowsFromView(view);
    expect(rows.map((r) => r.label)).toEqual(['作答', '变式']);
    expect(rows.map((r) => `${r.value} / ${r.target}`)).toEqual(['8 / 8', '3 / 3']);
    expect(rows[0]?.ratio).toBe(1);
    expect(rows[1]?.ratio).toBe(1);
    // 真数在 cumulative 里，只用于悬浮说明
    expect(rows[0]?.cumulative).toBe(474);
  });

  it('本关判定没达标时进度条走中性色；达标才换 success', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container, rerender } = render(
      <FluentProvider theme={webLightTheme}>
        <QueryClientProvider client={client}>
          <StudySidebar microKpName={view.name} progress={view} onAsk={() => undefined} />
        </QueryClientProvider>
      </FluentProvider>,
    );
    const tones = Array.from(container.querySelectorAll('[data-study-row]')).map((n) =>
      n.getAttribute('data-tone'),
    );
    expect(tones).toEqual(['neutral', 'neutral']);

    rerender(
      <FluentProvider theme={webLightTheme}>
        <QueryClientProvider client={client}>
          <StudySidebar
            microKpName={view.name}
            progress={{ ...view, gatePassed: true }}
            onAsk={() => undefined}
          />
        </QueryClientProvider>
      </FluentProvider>,
    );
    const passed = Array.from(container.querySelectorAll('[data-study-row]')).map((n) =>
      n.getAttribute('data-tone'),
    );
    expect(passed).toEqual(['success', 'success']);
  });

  describe('票 05：数值带单位渲染对齐 mockup（单位来自接口，前端不写死）', () => {
    const renderWithProgress = (progress: KpProgressView) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <FluentProvider theme={webLightTheme}>
          <QueryClientProvider client={client}>
            <StudySidebar microKpName={progress.name} progress={progress} onAsk={() => undefined} />
          </QueryClientProvider>
        </FluentProvider>,
      );
    };

    it('作答/变式的数值带单位（mockup：作答 5 / 8 题、变式 2 / 3 组）', () => {
      renderWithProgress(view);
      expect(screen.getByText('8 / 8 题')).toBeInTheDocument();
      expect(screen.getByText('3 / 3 组')).toBeInTheDocument();
    });

    it('连对行已删（票 06 落地：连对数字进档位卡的 basis 句），三行变两行', () => {
      renderWithProgress(view);
      expect(document.querySelector('[data-study-row="连对"]')).toBeNull();
      expect(document.querySelectorAll('[data-study-row]')).toHaveLength(2);
    });

    it('单位是透传不是前端词典：接口给「次/套」就显示「次/套」', () => {
      renderWithProgress({
        ...view,
        gates: view.gates.map((gate) => ({
          ...gate,
          unit: gate.unit === '题' ? '次' : '套',
        })),
      });
      expect(screen.getByText('8 / 8 次')).toBeInTheDocument();
      expect(screen.getByText('3 / 3 套')).toBeInTheDocument();
      expect(screen.queryByText('8 / 8 题')).not.toBeInTheDocument();
    });
  });
});

/** 局部覆盖 `GET /api/v1/tier/session-plan`（默认桩在 test/msw.ts，是 P1/limit2/deferred0）。 */
const stubSessionPlan = (body: Record<string, unknown>) => {
  server.use(http.get('*/api/v1/tier/session-plan', () => HttpResponse.json(body)));
};

/** 一份完整的 TierSessionPlanResponse 形状。 */
const sessionPlan = (overrides: Record<string, unknown> = {}) => ({
  tier: 'P1',
  source: 'placement',
  limit: 2,
  items: [
    { microKpId: 'kp-bool', name: '布尔代数基本运算', hasLevel: true },
    { microKpId: 'kp-kmap', name: '卡诺图化简', hasLevel: false },
  ],
  deferred: 0,
  ...overrides,
});

describe('票 04：本档上限卡——上限来自接口，前端不写死 2/3/4', () => {
  it('deferred=0：一行「一次最多推进 N 个新知识点」，没有「下次会话再开」', async () => {
    // 5 不是任何档位的真值：如果前端写死了 2/3/4，这条断言必红。
    stubSessionPlan(sessionPlan({ tier: 'P3', limit: 5 }));
    renderSidebar();

    expect(await screen.findByText('一次最多推进 5 个新知识点')).toBeInTheDocument();
    expect(screen.queryByText(/下次会话再开/)).not.toBeInTheDocument();
  });

  it('deferred>0：追加「还有 N 个，下次会话再开」', async () => {
    stubSessionPlan(sessionPlan({ tier: 'P3', limit: 5, deferred: 3 }));
    renderSidebar();

    expect(await screen.findByText('一次最多推进 5 个新知识点')).toBeInTheDocument();
    expect(screen.getByText('还有 3 个，下次会话再开')).toBeInTheDocument();
  });

  it('接口失败：降级为「—」占位，不红错', async () => {
    server.use(
      http.get(
        '*/api/v1/tier/session-plan',
        () => HttpResponse.json({ code: 'INTERNAL', message: '读不到' }, { status: 500 }),
      ),
    );
    renderSidebar();

    // 等一次微任务让 query 真的失败，否则「没有句子」可能是请求还没回来（恒真）。
    await new Promise((resolve) => setTimeout(resolve, 50));
    const card = document.querySelector('[data-study-session-limit]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('—');
    expect(screen.queryByText(/一次最多推进/)).not.toBeInTheDocument();
  });
});

describe('票 02：右栏档位卡——档位是测量结果，不是设置项', () => {
  it("source='fallback'：说「还没定级，先按完整样例档教」，不说「你的水平是 P1」", async () => {
    stubTier(tierOverview({ tier: 'P1', source: 'fallback', label: '完整样例' }));
    renderSidebar();

    expect(await screen.findByText('还没定级，先按完整样例档教')).toBeInTheDocument();
    // 固定句两态都在
    expect(screen.getByText('档位是测量结果，不能自选。')).toBeInTheDocument();
    // fallback 态的禁句：界面不能把默认档说成学习者的水平。
    expect(screen.queryByText(/你的水平是/)).not.toBeInTheDocument();
    // 生效档与展示名仍然给出（档位永远有值，靠 source 区分语义）
    expect(screen.getByText('P1')).toBeInTheDocument();
    expect(screen.getByText('完整样例')).toBeInTheDocument();
    expect(screen.queryByText('由定级测得')).not.toBeInTheDocument();
  });

  it("source='placement'：说「由定级测得」", async () => {
    stubTier(tierOverview());
    renderSidebar();

    expect(await screen.findByText('由定级测得')).toBeInTheDocument();
    expect(screen.getByText('档位是测量结果，不能自选。')).toBeInTheDocument();
    expect(screen.getByText('P2')).toBeInTheDocument();
    expect(screen.getByText('补全步骤')).toBeInTheDocument();
    expect(screen.queryByText(/还没定级/)).not.toBeInTheDocument();
  });

  it('卡里没有任何按钮——切换档位这种控件不存在', async () => {
    stubTier(tierOverview());
    renderSidebar();

    // 先等数据态渲染出来，再数按钮（占位态本来就没有按钮，等到位才算数）
    expect(await screen.findByText('由定级测得')).toBeInTheDocument();
    const card = document.querySelector('[data-study-tier]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.querySelectorAll('button')).toHaveLength(0);
  });

  it('接口还没回来/挂了：占位不红错，也不把话说死', async () => {
    server.use(
      http.get('*/api/v1/tier', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '档位读不到' }, { status: 500 }),
      ),
    );
    renderSidebar();

    await screen.findByText('档位暂时读不到，先按默认档。');
    expect(screen.queryByText('档位是测量结果，不能自选。')).not.toBeInTheDocument();
  });
});

describe('票 06：档位卡 why 行——basis 是服务端拼好的整句，前端透传不拼', () => {
  it("source='placement'：依据句整句显示（「·」分隔与 x/y 都是服务端文案）", async () => {
    stubTier(tierOverview());
    renderSidebar();

    expect(
      await screen.findByText('由 3 次作答判定 · 2 个变式已覆盖 · 连对 1/2'),
    ).toBeInTheDocument();
  });

  it("source='fallback'：basis 是引导句，照常显示（不是空串，也不是前端编的数字句）", async () => {
    stubTier(
      tierOverview({
        tier: 'P1',
        source: 'fallback',
        label: '完整样例',
        basis: '定级后这里会写判定依据',
        basisAttempts: 0,
        basisVariants: 0,
        basisStreak: 0,
      }),
    );
    renderSidebar();

    expect(await screen.findByText('定级后这里会写判定依据')).toBeInTheDocument();
    // 0/0/0 的数字句不许由前端拼出来（拼了就是在编证据）
    expect(document.querySelector('[data-study-tier]')?.textContent).not.toContain('0 次');
  });

  it('连对行从门槛卡删除后，basis 句是连对数字的唯一居所', async () => {
    stubTier(tierOverview());
    renderSidebar({ gateHistory: gateHistory(['a', 'b'], []) });

    expect(
      await screen.findByText('由 3 次作答判定 · 2 个变式已覆盖 · 连对 1/2'),
    ).toBeInTheDocument();
    // 门槛卡只剩作答/变式（连对 2/2 这类数字不在这张卡里）
    const progress = document.querySelector('[data-study-progress]') as HTMLElement;
    expect(progress.querySelectorAll('[data-study-row]')).toHaveLength(2);
    expect(progress.textContent).not.toContain('连对');
  });
});

/** 局部覆盖 `GET /api/v1/nodes/:id`（默认桩在 test/msw.ts，带 source 与一个关卡）。 */
const stubNodeDetail = (body: Record<string, unknown>) => {
  server.use(http.get('*/api/v1/nodes/:id', () => HttpResponse.json(body)));
};

/** 一份完整的 NodeDetailResponse 形状（抄漏字段会让「透传」断言失焦）。 */
const nodeDetail = (overrides: Record<string, unknown> = {}) => ({
  node: {
    microKpId: 'kp-bool',
    name: '布尔代数基本运算',
    state: 'familiar',
    percent: 0.66,
    depth: 1,
    sourceTitle: '辐射探测与测量（Knoll 第4版 2010）',
    page: 12,
  },
  levels: [
    {
      levelId: 'lv-bool-laws',
      microKpId: 'kp-bool',
      title: '布尔代数的三条基本律',
      itemCount: 8,
      kind: 'teach',
    },
  ],
  reasons: [],
  // 票 08：章节路径（根在前、不含自身）。默认给两级，钉住「 · 」join。
  ancestors: ['第 1 章 逻辑代数', '第 1.2 节 布尔恒等式'],
  source: {
    sourceId: 'knoll-4e-2010',
    title: '辐射探测与测量（Knoll 第4版 2010）',
    page: 12,
    pageLabel: '「辐射探测与测量（Knoll 第4版 2010）」第 12 页',
  },
  ...overrides,
});

describe('票 03：右栏「正在学」卡——名字回到侧栏，细条时代的口径作废', () => {
  it('未选知识点：整张卡不渲染，引导句仍在进度卡里（不出现两次）', () => {
    renderSidebar({ microKpId: null, microKpName: null, mastery: undefined });

    expect(screen.queryByRole('heading', { name: '正在学' })).not.toBeInTheDocument();
    // 判据 1：引导句沿用，且全文只出现一次（getByText 多匹配会直接抛错）。
    expect(screen.getByText('还没选知识点：先在下面说一句你想学什么')).toBeInTheDocument();
  });

  it('选定后：来源行是「章 · 节」路径（08），pageLabel 降为悬浮提示', async () => {
    renderSidebar({ microKpId: 'kp-bool' });

    // 名字来自调用方的解析链（microKpName），卡里不再自己解析一遍。
    expect(screen.getByText('布尔代数基本运算')).toBeInTheDocument();
    /*
     * 票 08：主行是 ancestors 的 join(' · ')——分隔符是前端文案（契约注释
     * 写明），两级路径必须拼成一句而不是两行。书名页码降为悬浮（title），
     * 不再占一整行。
     */
    const path = await screen.findByText('第 1 章 逻辑代数 · 第 1.2 节 布尔恒等式');
    expect(path).toHaveAttribute('title', '「辐射探测与测量（Knoll 第4版 2010）」第 12 页');
    // pageLabel 不再是可见文本（悬浮不是次行）
    expect(
      screen.queryByText('「辐射探测与测量（Knoll 第4版 2010）」第 12 页'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开关卡' })).toBeInTheDocument();
  });

  it('ancestors 为空但有 source（真实书的无父节点）：沿用 pageLabel 当来源行', async () => {
    stubNodeDetail(nodeDetail({ ancestors: [] }));
    renderSidebar({ microKpId: 'kp-bool' });

    expect(
      await screen.findByText('「辐射探测与测量（Knoll 第4版 2010）」第 12 页'),
    ).toBeInTheDocument();
  });

  it('「打开关卡」跳关卡页路由，「去地图选」跳地图（票 07 前唯一切换方式）', async () => {
    renderSidebar({ microKpId: 'kp-bool' });

    fireEvent.click(await screen.findByRole('button', { name: '打开关卡' }));
    expect(await screen.findByText('关卡页占位')).toBeInTheDocument();
  });

  it('「去地图选」入口保留在卡里', async () => {
    renderSidebar({ microKpId: 'kp-bool' });

    fireEvent.click(await screen.findByRole('button', { name: '去地图选' }));
    expect(await screen.findByText('地图占位')).toBeInTheDocument();
  });

  it('levels 为空：提示「还没有关卡，说一句让我生成」，不给按钮不自动生成', async () => {
    stubNodeDetail(nodeDetail({ levels: [] }));
    renderSidebar({ microKpId: 'kp-bool' });

    expect(await screen.findByText('还没有关卡，说一句让我生成')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开关卡' })).not.toBeInTheDocument();
  });

  it('无 source 且无祖先的手工知识点：来源位降级为空，名字与关卡入口照常，不报错', async () => {
    stubNodeDetail(nodeDetail({ source: null, ancestors: [] }));
    renderSidebar({ microKpId: 'kp-bool' });

    expect(await screen.findByRole('button', { name: '打开关卡' })).toBeInTheDocument();
    expect(screen.getByText('布尔代数基本运算')).toBeInTheDocument();
    // 降级 = 什么都不渲染，而不是渲染「来源：—」这种占位句子。
    expect(screen.queryByText(/第 12 页/)).not.toBeInTheDocument();
    expect(screen.queryByText(/来源/)).not.toBeInTheDocument();
    // 章节路径也不出现（空数组不是「第 0 章」之类的东西）
    expect(screen.queryByText(/第 1 章/)).not.toBeInTheDocument();
  });
});

/** 局部覆盖 `GET /api/v1/nodes`（默认桩在 test/msw.ts，含 sourceTitle/page）。 */
const stubNodes = (items: unknown[]) => {
  server.use(http.get('*/api/v1/nodes', () => HttpResponse.json({ items, nextCursor: null })));
};

describe('票 07：「换个知识点」——本地索引搜索，输入即筛不发请求', () => {
  it('名字子串命中，重名靠书名消歧；点选后地址栏变 /?kp=<id>（接回焦点链）', async () => {
    stubNodes([
      {
        microKpId: 'kp-bool',
        name: '布尔代数基本运算',
        state: 'familiar',
        percent: 0.66,
        depth: 1,
        sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
        page: 12,
      },
      {
        microKpId: 'kp-absorb-kang',
        name: '吸收律',
        state: 'unseen',
        percent: null,
        depth: 2,
        sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
        page: 45,
      },
      {
        microKpId: 'kp-absorb-knoll',
        name: '吸收律',
        state: 'unseen',
        percent: null,
        depth: 2,
        sourceTitle: '辐射探测与测量（Knoll 第4版 2010）',
        page: 210,
      },
    ]);
    renderSidebar({ microKpId: 'kp-bool' });

    fireEvent.click(await screen.findByRole('button', { name: '换个知识点' }));
    fireEvent.change(await screen.findByLabelText('搜索知识点'), {
      target: { value: '吸收律' },
    });

    // 两本书同名「吸收律」，各带书名可区分（判据 1）
    const knoll = await screen.findByRole('button', { name: '吸收律 · 辐射探测与测量（Knoll 第4版 2010）' });
    expect(
      screen.getByRole('button', { name: '吸收律 · 电子技术基础·数字部分（康华光 第5版）' }),
    ).toBeInTheDocument();

    // 点选一条：真的路由跳转（探针），弹层收起（判据的「接回现有地址栏焦点链」）
    fireEvent.click(knoll);
    expect(await screen.findByText('探针kp:kp-absorb-knoll')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText('搜索知识点')).not.toBeInTheDocument());
  });

  it('纯数字输入按页码命中（默认桩：kp-bool 是第 12 页）', async () => {
    renderSidebar({ microKpId: 'kp-bool' });

    fireEvent.click(await screen.findByRole('button', { name: '换个知识点' }));
    fireEvent.change(await screen.findByLabelText('搜索知识点'), {
      target: { value: '12' },
    });

    expect(
      await screen.findByRole('button', { name: /布尔代数基本运算/ }),
    ).toBeInTheDocument();
  });

  it('查无此点：显示「没找到这个知识点」，不是空白面板', async () => {
    renderSidebar({ microKpId: 'kp-bool' });

    fireEvent.click(await screen.findByRole('button', { name: '换个知识点' }));
    fireEvent.change(await screen.findByLabelText('搜索知识点'), {
      target: { value: '不存在的知识点' },
    });

    expect(await screen.findByText('没找到这个知识点')).toBeInTheDocument();
  });

  it('输入即筛不发网络请求（msw 计数：建索引 1 次，筛选 0 次）', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/v1/nodes', () => {
        calls += 1;
        return HttpResponse.json({
          items: [
            {
              microKpId: 'kp-bool',
              name: '布尔代数基本运算',
              state: 'familiar',
              percent: 0.66,
              depth: 1,
              sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
              page: 12,
            },
            {
              microKpId: 'kp-kmap',
              name: '卡诺图化简',
              state: 'unseen',
              percent: null,
              depth: 1,
              sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
              page: 34,
            },
          ],
          nextCursor: null,
        });
      }),
    );
    renderSidebar({ microKpId: 'kp-bool' });

    // 弹层没打开时不取数（enabled 门：不给每个页面白背 21 个请求）
    await screen.findByRole('button', { name: '打开关卡' });
    expect(calls).toBe(0);

    fireEvent.click(await screen.findByRole('button', { name: '换个知识点' }));
    await screen.findByLabelText('搜索知识点');
    await waitFor(() => expect(calls).toBe(1));

    // 连续输入两个字：索引已在内存，一次网络请求都不多发（判据 3 的组件半边）
    const input = screen.getByLabelText('搜索知识点');
    fireEvent.change(input, { target: { value: '卡诺' } });
    expect(await screen.findByRole('button', { name: /卡诺图化简/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '卡诺图' } });
    await screen.findByRole('button', { name: /卡诺图化简/ });
    expect(calls).toBe(1);
  });

  it('索引还在建立时输入：提示「正在建立索引」，不误报「没找到」', async () => {
    let release: (() => void) | undefined;
    server.use(
      http.get('*/api/v1/nodes', async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderSidebar({ microKpId: 'kp-bool' });

    fireEvent.click(await screen.findByRole('button', { name: '换个知识点' }));
    fireEvent.change(await screen.findByLabelText('搜索知识点'), {
      target: { value: '吸收律',
      },
    });

    expect(await screen.findByText('正在建立索引…')).toBeInTheDocument();
    expect(screen.queryByText('没找到这个知识点')).not.toBeInTheDocument();
    release?.();
  });
});
