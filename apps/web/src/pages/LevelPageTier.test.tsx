import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import type {
  LevelDetailResponse,
  MasteryView,
  TierLevelPlanResponse,
} from '../api/generated/model';
import { LevelPage } from './LevelPage';
import * as queries from '../api/queries';

/**
 * 票 12 验收 2：「同一个知识点切到不同档位，首屏渲染结果不同（有测试）」。
 *
 * ## 这一层要测的是什么（以及为什么不能在 `tier-render.test.ts` 里测完）
 *
 * `tier-render.test.ts` 已经穷举了「参数 → 决策」的映射。但那只证明了映射函数
 * 是对的，**不证明页面真的用了它**。最典型的假绿：映射函数写得完美，页面却
 * 还在 `cards.map(card => <CardView card={card} />)` 里不传 `presentation` ——
 * 于是 28 条纯函数测试全绿，三个档位在屏幕上长得一模一样。
 *
 * 所以这里**渲染真页面**（`LevelPage`），只把 query hook 换成可控桩，
 * 断言的是 DOM 里能看见的东西：第几段、卡片是不是折叠的、反馈有没有出现、
 * 有没有「还可再试 N 次」。
 *
 * ## 为什么不走 MSW
 *
 * 这一层要控制的是「档位参数是什么」，而 `useLevel` 的返回（spec 本体）也得
 * 同时可控。两件事都在 MSW 里打桩会变成「一个文件里两套数据源」，调试时要先
 * 分清是桩错了还是实现错了。这与 `LevelPage.test.tsx` 的分工一致：
 * **渲染决策用 mock hook 测，请求形状用 MSW 测**（见 `pages.msw.test.tsx`）。
 *
 * ## 三份档位桩逐字抄自 spec.md §5 的三档表
 *
 * 这里再抄一遍而不是从 `TIER_PARAMS` 读（web 不依赖 engine，那是
 * `.dependency-cruiser.cjs` 的边界）。防漂移靠后端那侧：
 * `apps/api/src/tier/tier.controller.test.ts` 逐项断言服务端投影的六维参数，
 * 两份合起来才闭环 —— 这里管「参数到界面」，那边管「engine 到参数」。
 */

const submitMock = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('../api/queries', () => ({
  useLevel: vi.fn(),
  useMastery: vi.fn(),
  useSubmitAttempt: () => ({ mutate: submitMock.mutate }),
  useGateHistory: vi.fn(),
  useEvaluateGate: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useNodeDetail: vi.fn(),
  useNodeList: vi.fn(),
  useHealth: vi.fn(),
  useLevelVideoClips: () => ({ isPending: false, isError: false, error: null, payload: { items: [] } }),
  clipSrc: (clip: { playUrl: string }) => clip.playUrl,
  formatClipTime: (seconds: number) => `${Math.floor(seconds / 60)}:00`,
  useTierLevelPlan: vi.fn(),
}));

const LONG_BODY =
  '吸收律说的是：如果一个与项是另一个与项的子集，那么它会被吸收掉，不留下任何痕迹。' +
  '推导只用分配律与 1 的性质：A + A·B = A·(1 + B) = A·1 = A，因为 1 + B 恒等于 1。';

/**
 * 一份七段的教学关卡。
 *
 * 段序与真实 `lv-bool-laws.spec.json` 一致（guide / detail / probe / deepen /
 * reteach / quiz / summary），因为 P3 的 `startStepIndex` 依赖「第一段带题的段
 * 是下标 2」这个结构。结构改了而测试没改，会得到「P3 从第 1 段开始」的假绿。
 */
const makeLevel = (): LevelDetailResponse => ({
  level: {
    levelId: 'lv-tier-demo',
    microKpId: 'kp-tier-demo',
    title: '吸收律与德摩根律',
    itemCount: 2,
    kind: 'teach',
  },
  spec: {
    schemaVersion: 1,
    meta: {
      id: 'lv-tier-demo',
      microKpId: 'kp-tier-demo',
      title: '吸收律与德摩根律',
      type: 'teaching',
      tier: 'P1',
      estimatedMinutes: 12,
      author: 'system',
      isEntry: true,
      nextLevelId: null,
    },
    sources: [{ ref: '康华光·数字部分', locator: 'p.34' }],
    cards: [
      { id: 'c-guide', title: '为什么要化简', body: LONG_BODY, figureRef: null },
      { id: 'c-absorb', title: '吸收律', body: LONG_BODY, figureRef: null },
      { id: 'c-summary', title: '带走三条规则', body: LONG_BODY, figureRef: null },
    ],
    steps: [
      { id: 's-guide', kind: 'guide', title: '引导', cardIds: ['c-guide'], itemIds: [], requiredCorrect: 0 },
      { id: 's-detail', kind: 'detail', title: '展示细节', cardIds: ['c-absorb'], itemIds: [], requiredCorrect: 0 },
      { id: 's-probe', kind: 'probe', title: '简单问题', cardIds: [], itemIds: ['i-probe'], requiredCorrect: 1 },
      { id: 's-deepen', kind: 'deepen', title: '深究', cardIds: [], itemIds: ['i-deepen'], requiredCorrect: 0 },
      { id: 's-reteach', kind: 'reteach', title: '进一步讲解', cardIds: [], itemIds: [], requiredCorrect: 0 },
      { id: 's-quiz', kind: 'quiz', title: '判定', cardIds: [], itemIds: ['i-quiz'], requiredCorrect: 1 },
      { id: 's-summary', kind: 'summary', title: '小结', cardIds: ['c-summary'], itemIds: [], requiredCorrect: 0 },
    ],
    items: [
      {
        id: 'i-probe',
        kind: 'fact',
        stem: '下列哪一个式子恒等于 $A$？',
        options: ['$A + A·B$', '$A + B$', '$A·(A + B)·\\overline{A}$'],
        answer: 0,
        variantGroup: 'vg-absorb',
        explainCorrect: '对，吸收律。',
        explainWrong: '再看一眼吸收律。',
        misconceptionTags: ['吸收律误用'],
        sourceRef: '康华光·p.34',
        pool: 'core',
        hintLadder: ['先看两项里谁被谁包含。'],
      },
      {
        id: 'i-deepen',
        kind: 'concept',
        stem: '$\\overline{A·B}$ 展开后等于什么？',
        options: ['$\\overline{A}·\\overline{B}$', '$\\overline{A} + \\overline{B}$'],
        answer: 1,
        variantGroup: 'vg-demorgan',
        explainCorrect: '对，德摩根律。',
        explainWrong: '德摩根要同时换运算和取反。',
        misconceptionTags: ['德摩根只取反不换运算'],
        sourceRef: null,
        pool: 'practice',
        hintLadder: [],
      },
      {
        id: 'i-quiz',
        kind: 'comprehensive',
        stem: '要用与非门实现 $Y = A + B$，怎么接？',
        options: ['输入各取反再与非', '直接接到与非门', '三个与非门级联'],
        answer: 0,
        variantGroup: 'vg-nand',
        explainCorrect: '对：$A + B = \\overline{\\overline{A}·\\overline{B}}$。',
        explainWrong: '与非门做或运算要先对输入取反。',
        misconceptionTags: ['把与非门当成或非门'],
        sourceRef: '康华光·p.38',
        pool: 'core',
        hintLadder: [],
      },
    ],
    gating: { mode: 'none', itemCount: 2, passCount: 2 },
  },
});

const mastery = (): MasteryView => ({
  microKpId: 'kp-tier-demo',
  name: '吸收律',
  isLeaf: true,
  achieved: 0.5,
  current: 0.4,
  state: 'attempted',
  attemptCount: 3,
  variantCount: 2,
  evidenceSufficient: false,
  halfLifeDays: 30,
  lastEvidenceAt: null,
  aggregatedLeafCount: 1,
});

/** 一份档位计划桩。三档的数值逐字抄自 spec.md:274-280。 */
function tierPlan(tier: 'P1' | 'P2' | 'P3'): TierLevelPlanResponse {
  const params = {
    P1: {
      tier: 'P1' as const,
      firstRoundShape: 'worked_example' as const,
      ladder: { start: 1, cap: 3 },
      sessionNewKpLimit: 2,
      feedbackTiming: 'step_immediate' as const,
      attemptsPerItem: 2,
      masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
    },
    P2: {
      tier: 'P2' as const,
      firstRoundShape: 'completion' as const,
      ladder: { start: 2, cap: 4 },
      sessionNewKpLimit: 3,
      feedbackTiming: 'step_immediate_with_summary' as const,
      attemptsPerItem: 2,
      masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
    },
    P3: {
      tier: 'P3' as const,
      firstRoundShape: 'direct' as const,
      ladder: { start: 3, cap: 5 },
      sessionNewKpLimit: 4,
      feedbackTiming: 'item_deferred_with_summary' as const,
      attemptsPerItem: 1,
      masteryRule: { consecutiveCorrect: 1, requiresTransferItem: true },
    },
  }[tier];

  const firstRound = {
    P1: { shape: 'worked_example' as const, startStepIndex: 0, cardMode: 'all' as const, fadedCardId: null },
    P2: { shape: 'completion' as const, startStepIndex: 0, cardMode: 'faded' as const, fadedCardId: 'c-guide' },
    P3: { shape: 'direct' as const, startStepIndex: 2, cardMode: 'none' as const, fadedCardId: null },
  }[tier];

  return {
    levelId: 'lv-tier-demo',
    microKpId: 'kp-tier-demo',
    tier,
    source: 'placement',
    params,
    firstRound,
    masteryProgress: {
      consecutiveCorrect: 0,
      hasTransferItem: false,
      satisfied: false,
      missing: ['还差连续答对 2 次', '还没做过迁移题'],
    },
  };
}

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/level/lv-tier-demo']}>
          <Routes>
            <Route path="/level/:levelId" element={<LevelPage />} />
            <Route path="/map/:microKpId" element={<div>知识点占位</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

const mockLevel = () => {
  vi.mocked(queries.useLevel).mockReturnValue({
    isLoading: false,
    error: null,
    payload: makeLevel(),
    refetch: vi.fn(),
  } as never);
};

const mockTier = (plan: TierLevelPlanResponse | undefined) => {
  vi.mocked(queries.useTierLevelPlan).mockReturnValue({
    payload: plan,
    isLoading: false,
    error: null,
  } as never);
};

const mockBaseline = () => {
  vi.mocked(queries.useMastery).mockReturnValue({
    payload: mastery(),
    isLoading: false,
    error: null,
  } as never);
  vi.mocked(queries.useGateHistory).mockReturnValue({
    payload: { levelId: 'lv-tier-demo', evaluations: [] },
    isLoading: false,
    error: null,
  } as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  mockLevel();
  mockBaseline();
  submitMock.mutate.mockImplementation((request, options) => {
    options?.onSuccess?.({
      attempt: {
        attemptId: '1',
        attemptNo: 1,
        itemId: request.itemId,
        microKpId: 'kp-tier-demo',
        levelId: 'lv-tier-demo',
        variantGroup: 'vg-x',
        knowledgeKind: 'fact',
        correct: true,
        countsTowardMastery: true,
        createdAt: '2026-10-21T00:00:00.000Z',
      },
      mastery: mastery(),
    });
  });
});

describe('切档位 → 首屏不同（票 12 验收 2）', () => {
  it('P1：从第 1 段开始，讲解全展开，页面上写着「按 P1 档渲染」', () => {
    mockTier(tierPlan('P1'));
    renderPage();

    expect(screen.getByText('第 1 段 · 引导')).toBeInTheDocument();
    expect(screen.getByText('按 P1 档渲染')).toBeInTheDocument();
    // 全展开：正文可见。
    expect(screen.getByText(/吸收律说的是/)).toBeInTheDocument();
    // 没有「折叠」入口。
    expect(screen.queryByText('这一步留给你补：点开看讲解')).not.toBeInTheDocument();
  });

  it('P2：仍从第 1 段开始，但第一张卡折叠到「留给你补」后面', () => {
    mockTier(tierPlan('P2'));
    renderPage();

    expect(screen.getByText('第 1 段 · 引导')).toBeInTheDocument();
    expect(screen.getByText('按 P2 档渲染')).toBeInTheDocument();
    // 卡片确实折叠了：出现展开入口，且 details 默认闭着。
    expect(screen.getByText('这一步留给你补：点开看讲解')).toBeInTheDocument();
    const details = document.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    // 但正文仍在 DOM 里 —— 「被藏起来」与「不存在」是两件事。
    expect(screen.getByText(/吸收律说的是/)).toBeInTheDocument();
  });

  it('P3：直接落在第 3 段（第一段带题的段），讲解全部收起', () => {
    mockTier(tierPlan('P3'));
    renderPage();

    // 这是三个档位里最显眼的差异：首屏就不是讲解段了。
    expect(screen.getByText('第 3 段 · 简单问题')).toBeInTheDocument();
    expect(screen.queryByText('第 1 段 · 引导')).not.toBeInTheDocument();
    expect(screen.getByText('按 P3 档渲染')).toBeInTheDocument();
    // 顶部说明「跳过了前面的讲解」，否则学习者会以为关卡坏了。
    expect(screen.getByText(/这一档直接从第 3 段开始/)).toBeInTheDocument();
  });

  it('P1/P2 不会说「跳过前面讲解」（那句话只属于 P3）', () => {
    mockTier(tierPlan('P1'));
    const p1 = renderPage();
    expect(screen.queryByText(/这一档直接从/)).not.toBeInTheDocument();
    p1.unmount();

    mockTier(tierPlan('P2'));
    renderPage();
    expect(screen.queryByText(/这一档直接从/)).not.toBeInTheDocument();
  });

  it('三档的首屏两两不同（同一份 spec、同一个知识点）', () => {
    mockTier(tierPlan('P1'));
    const p1 = renderPage();
    const p1Text = p1.container.textContent ?? '';
    p1.unmount();

    mockTier(tierPlan('P2'));
    const p2 = renderPage();
    const p2Text = p2.container.textContent ?? '';
    p2.unmount();

    mockTier(tierPlan('P3'));
    const p3 = renderPage();
    const p3Text = p3.container.textContent ?? '';

    expect(p1Text).not.toBe(p2Text);
    expect(p2Text).not.toBe(p3Text);
    expect(p1Text).not.toBe(p3Text);
    // 而且差异不只是「按 Pn 档渲染」那一行：遮掉徽章文字之后仍然不同。
    const strip = (text: string) => text.replace(/按 P\d 档渲染/g, '');
    expect(strip(p1Text)).not.toBe(strip(p2Text));
    expect(strip(p2Text)).not.toBe(strip(p3Text));
  });

  it('拿不到档位参数时回到票 04 的行为：第 1 段、全展开、无档位徽章', () => {
    mockTier(undefined);
    renderPage();

    expect(screen.getByText('第 1 段 · 引导')).toBeInTheDocument();
    expect(screen.queryByText(/按 P\d 档渲染/)).not.toBeInTheDocument();
    expect(screen.getByText(/吸收律说的是/)).toBeInTheDocument();
    expect(screen.queryByText('这一步留给你补：点开看讲解')).not.toBeInTheDocument();
  });
});

describe('档位摘要与掌握判定（验收 1 的「真正驱动界面」）', () => {
  it('三档的参数摘要逐条不同，且都能看到', () => {
    mockTier(tierPlan('P1'));
    const p1 = renderPage();
    expect(screen.getByRole('list', { name: '本档渲染参数' })).toBeInTheDocument();
    expect(screen.getByText('讲解全展开')).toBeInTheDocument();
    expect(screen.getByText('每题最多 2 次')).toBeInTheDocument();
    expect(screen.getByText('答完立刻给反馈')).toBeInTheDocument();
    p1.unmount();

    mockTier(tierPlan('P3'));
    renderPage();
    expect(screen.getByText('讲解默认收起，需要时展开')).toBeInTheDocument();
    expect(screen.getByText('每题只有 1 次机会')).toBeInTheDocument();
    expect(screen.getByText('整段提交后统一给反馈')).toBeInTheDocument();
    // 反向对照：P1 的三句话在 P3 下不该原样都在。
    expect(screen.queryByText('讲解全展开')).not.toBeInTheDocument();
  });

  it('掌握判定规则文案跟着档位变，且写清还差什么', () => {
    mockTier(tierPlan('P2'));
    renderPage();
    expect(screen.getByText(/掌握判定：连对 2 次 \+ 一道迁移题/)).toBeInTheDocument();
    expect(screen.getByText(/还差：还差连续答对 2 次；还没做过迁移题。/)).toBeInTheDocument();
  });
});

describe('P1/P2 的第二次机会（验收 1 的「每题尝试次数」）', () => {
  /** 走到简单问题段，答错一次。 */
  const answerWrongOnce = async (user: ReturnType<typeof userEvent.setup>) => {
    // 第 1 段是纯讲解，点两次「进入下一段」到第 3 段。
    await user.click(screen.getByRole('button', { name: '进入下一段' }));
    await user.click(screen.getByRole('button', { name: '进入下一段' }));
    const radios = screen.getAllByRole('radio');
    const wrong = radios[radios.length - 1];
    if (!wrong) throw new Error('没有可选选项');
    await user.click(wrong);
    await user.click(screen.getByRole('button', { name: '提交答案' }));
  };

  it('P1 答错后还能再提交，并写着「还可以再试 1 次」', async () => {
    const user = userEvent.setup();
    mockTier(tierPlan('P1'));
    renderPage();

    await answerWrongOnce(user);

    // 关键：选项没有被禁用，提交按钮还在。
    const submit = screen.getByRole('button', { name: '提交答案' });
    expect(submit).toBeInTheDocument();
    expect(screen.getAllByRole('radio')[0]).not.toBeDisabled();
    expect(screen.getByText('还可以再试 1 次')).toBeInTheDocument();
    // 这一档是即时反馈：答错的对错现在就说。
    expect(screen.getByText(/再看一眼吸收律/)).toBeInTheDocument();
  });

  it('P3 答错后直接锁题（每题只有 1 次）', async () => {
    const user = userEvent.setup();
    mockTier(tierPlan('P3'));
    renderPage();

    // P3 从第 3 段开始，直接就是简单问题段。
    expect(screen.getByText('第 3 段 · 简单问题')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    const wrong = radios[radios.length - 1];
    if (!wrong) throw new Error('没有可选选项');
    await user.click(wrong);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    expect(screen.queryByRole('button', { name: '提交答案' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')[0]).toBeDisabled();
    expect(screen.getByText('已作答，本关内不可重答')).toBeInTheDocument();
  });
});

describe('P3 的整段延迟反馈（验收 1 的「反馈延迟」）', () => {
  it('答完当场不亮对错，只说明「本题不即时给对错」', async () => {
    const user = userEvent.setup();
    mockTier(tierPlan('P3'));
    renderPage();

    const radios = screen.getAllByRole('radio');
    const wrong = radios[radios.length - 1];
    if (!wrong) throw new Error('没有可选选项');
    await user.click(wrong);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    // 中性条，不是绿/黄反馈条。
    expect(screen.getByText('本题不即时给对错')).toBeInTheDocument();
    expect(screen.queryByText('这条没答对，看下错在哪')).not.toBeInTheDocument();
    // 文案里明确说「收到整段末尾」，而不是「正在核对」——后者会让人以为卡住。
    expect(screen.getByText(/这一档把反馈收到整段末尾/)).toBeInTheDocument();
    expect(screen.queryByText('已提交，正在核对')).not.toBeInTheDocument();
  });

  it('同一条路径在 P1 下是即时反馈（对照组）', async () => {
    const user = userEvent.setup();
    mockTier(tierPlan('P1'));
    renderPage();

    await user.click(screen.getByRole('button', { name: '进入下一段' }));
    await user.click(screen.getByRole('button', { name: '进入下一段' }));
    const radios = screen.getAllByRole('radio');
    const wrong = radios[radios.length - 1];
    if (!wrong) throw new Error('没有可选选项');
    await user.click(wrong);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    expect(screen.getByText('这条没答对，看下错在哪')).toBeInTheDocument();
    expect(screen.queryByText('本题不即时给对错')).not.toBeInTheDocument();
  });
});
