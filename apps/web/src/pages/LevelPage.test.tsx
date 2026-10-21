import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import type {
  GateEvaluation,
  GateHistoryResponse,
  LevelDetailResponse,
  MasteryView,
} from '../api/generated/model';
import { LevelPage } from './LevelPage';
import * as queries from '../api/queries';
import { ApiClientError } from '../api/fetcher';

/**
 * 页面测试只验证「拿到这份 spec 后页面怎么反应」，不验证请求本身。
 *
 * 请求路径、状态码、契约形状由 `apps/api/src/levels/levels.controller.test.ts`
 * 与 openapi 校验覆盖。这里替换掉 query hook，是为了让「反馈是不是立即出现」
 * 这件事变成可断言的事实：如果实现里偷偷 await 了一个模型调用，用 mock 的
 * hook 就根本渲染不出反馈，测试会红。
 *
 * `useSubmitAttempt` 的 `mutate` 用 `vi.hoisted` 提出来：`vi.mock` 会被提升到
 * 文件顶部，普通 `const` 在那一刻还没初始化。
 */
const submitMock = vi.hoisted(() => ({ mutate: vi.fn() }));
const gateMock = vi.hoisted(() => ({ mutate: vi.fn() }));

/**
 * 「看讲解」面板的返回桩（票 19）。
 *
 * 用可变变量而不是 `vi.fn()`，是因为 `vi.mock` 工厂在模块级只求值一次，
 * 而票 19 的两条用例要的是「同一份页面、不同的视频数据」。默认空列表让
 * 其余 21 条用例不受视频干扰。
 */
let videoClipsState: {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  payload: { items: Array<Record<string, unknown>> };
} = { isPending: false, isError: false, error: null, payload: { items: [] } };
const videoClipsMock = () => videoClipsState;
const setVideoClips = (next: Partial<typeof videoClipsState>) => {
  videoClipsState = { ...videoClipsState, ...next };
};

vi.mock('../api/queries', () => ({
  useLevel: vi.fn(),
  useMastery: vi.fn(),
  useSubmitAttempt: () => ({ mutate: submitMock.mutate }),
  useGateHistory: vi.fn(),
  useEvaluateGate: () => ({ mutate: gateMock.mutate, isPending: false, error: null }),
  useNodeDetail: vi.fn(),
  useNodeList: vi.fn(),
  useHealth: vi.fn(),
  // 关卡页在小结面板下方挂了「看讲解」（票 19，authoring-dev 的 VideoPanel）。
  // 这个 mock 工厂是**全量替换** `../api/queries`，页面每多用一个 hook 就必须
  // 在这里补一条，否则渲染时会抛 `No "useX" export is defined on the mock`。
  // 默认给「这个关卡没有配讲解片段」：本文件大多数断言只关心做题与门控。
  // 写成 `videoClipsMock()` 而不是内联对象，是为了让票 19 的用例能在单条
  // 测试里换成「有片段」的返回 —— 内联值在模块加载时固定，改不了。
  useLevelVideoClips: () => videoClipsMock(),
  // `VideoPanel` 还 import 了这两个纯函数。它们没有副作用，直接用与
  // `queries/video.ts` 同形的真实现，而不是再写一份假的 —— 写假的话
  // 一旦那边改了格式，这里的断言会“通过但错”。
  clipSrc: (clip: { playUrl: string }) => clip.playUrl,
  formatClipTime: (seconds: number) => {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  },
  // 票 12：关卡页现在会问「这一档怎么渲染这一关」。默认给 `payload: undefined`
  // （“还没拿到参数”）——`tier-render` 在 `null` 上一律回落到票 04 的行为
  // （全展开、一次提交即锁、即时反馈），所以本文件原有的 23 条断言逐字不变。
  // 专门验证「切档位 → 首屏不同」的用例在 `LevelPageTier.test.tsx`。
  useTierLevelPlan: () => ({ payload: undefined, isLoading: false, error: null }),
}));

/** 与 content/levels/lv-bool-laws.spec.json 同构的最小教学关卡（题少，断言好写）。 */
const makeSpec = (
  gating: LevelDetailResponse['spec']['gating'] = { mode: 'none', itemCount: 1, passCount: 1 },
): LevelDetailResponse => ({
  level: {
    levelId: 'lv-bool-laws',
    microKpId: 'kp-bool',
    title: '逻辑代数基本律：吸收律与德摩根律',
    itemCount: 4,
    kind: 'teach',
  },
  spec: {
    schemaVersion: 1,
    meta: {
      id: 'lv-bool-laws',
      microKpId: 'kp-bool',
      title: '逻辑代数基本律：吸收律与德摩根律',
      type: 'teaching',
      tier: 'P1',
      estimatedMinutes: 14,
      author: 'system',
      isEntry: true,
      nextLevelId: null,
    },
    sources: [{ ref: '康华光·数字部分·第5版', locator: 'p.34' }],
    cards: [
      {
        id: 'c-guide',
        title: '为什么要化简',
        body: '一个组合逻辑式 $Y = A·B + A·B·C + A·\\overline{B}·C$ 需要 3 个与门和 1 个或门。\n\n用吸收律把前两项合成 $A·B$，用 $A + \\overline{A}·B = A + B$ 把后两项并成 $C$，门数就从 7 个降到 3 个。',
        figureRef: null,
      },
      {
        id: 'c-absorb',
        title: '吸收律',
        body: '吸收律指的是 $A + A·B = A$：既然 $A$ 已经为真，那么 $A·B$ 的真假就不再影响结果。\n\n对偶形式是 $A·(A + B) = A$，推导时把或换成与、与换成或即可。',
        figureRef: 'ck-digital-kanghua-5e-0062-03-8f36a966f7b7',
      },
      {
        id: 'c-deepen',
        title: '深究：错误为什么抓不住',
        body: '多数人答错吸收律，是因为把 $A + A·B$ 当成了 $A + B$。\n\n这一段的作答不扣掌握度，目的是把错误暴露出来。',
        figureRef: null,
      },
      {
        id: 'c-reteach',
        title: '换个角度看',
        body: '用集合看：$A + A·B = A$ 就是「A 并（A 交 B）」等于 A，画个韦恩图一眼看出来。\n\n用真值表看：四种输入里 $A$ 为 1 的两行结果都是 1，$A$ 为 0 的两行结果都是 0，逐行比对即得。',
        figureRef: null,
      },
      {
        id: 'c-summary',
        title: '带走三条规则',
        body: '吸收律 $A + A·B = A$；消去律 $A + \\overline{A}·B = A + B$；德摩根律 $\\overline{A·B} = \\overline{A} + \\overline{B}$。',
        figureRef: null,
      },
    ],
    steps: [
      { id: 's-guide', kind: 'guide', title: '引导', cardIds: ['c-guide'], itemIds: [], requiredCorrect: 0 },
      { id: 's-detail', kind: 'detail', title: '展示细节', cardIds: ['c-absorb'], itemIds: [], requiredCorrect: 0 },
      { id: 's-probe', kind: 'probe', title: '简单问题', cardIds: [], itemIds: ['i-probe'], requiredCorrect: 1 },
      { id: 's-deepen', kind: 'deepen', title: '深究', cardIds: ['c-deepen'], itemIds: ['i-deepen'], requiredCorrect: 0 },
      { id: 's-reteach', kind: 'reteach', title: '进一步讲解', cardIds: ['c-reteach'], itemIds: [], requiredCorrect: 0 },
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
        explainCorrect: '对，吸收律 $A + A·B = A$ 就是这个形状。',
        explainWrong: '再看一眼吸收律：多出来的 $B$ 被 $A$ 吸收了。',
        misconceptionTags: ['吸收律误用'],
        sourceRef: '康华光·数字部分·p.34',
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
        explainCorrect: '对，德摩根律把与变成或、同时取反。',
        explainWrong: '德摩根律要同时换运算和取反，只取反不换运算是错的。',
        misconceptionTags: ['德摩根只取反不换运算'],
        sourceRef: null,
        pool: 'practice',
        hintLadder: ['把与看成交集，取反看成补集。'],
      },
      {
        id: 'i-quiz',
        kind: 'comprehensive',
        stem: '要用与非门实现 $Y = A + B$，怎么接？',
        options: ['两个输入先各自取反再与非', '把 $A$、$B$ 直接接到与非门', '需要三个与非门级联'],
        answer: 0,
        variantGroup: 'vg-nand',
        explainCorrect: '对：$A + B = \\overline{\\overline{A}·\\overline{B}}$，输入各取反后送一个与非门。',
        explainWrong: '与非门做或运算要先对输入取反。',
        misconceptionTags: ['把与非门当成或非门'],
        sourceRef: '康华光·数字部分·p.38',
        pool: 'core',
        hintLadder: ['先把或写成与非的形式。'],
      },
    ],
    gating,
  },
});

/**
 * 一份**证据足够**的双字段掌握度。`achieved` 高于 `current` 是刻意的：
 * 它就是「上个月学会了、这周还没复习」那张脸，若页面只显示一个数就会骗人。
 */
const makeMastery = (over: Partial<MasteryView> = {}): MasteryView => ({
  microKpId: 'kp-bool',
  name: '逻辑代数基本律',
  isLeaf: true,
  achieved: 0.93,
  current: 0.74,
  state: 'proficient',
  attemptCount: 12,
  variantCount: 3,
  evidenceSufficient: true,
  halfLifeDays: 30,
  lastEvidenceAt: '2026-10-01T00:00:00.000Z',
  aggregatedLeafCount: 1,
  ...over,
});

/** 让门控 `mutate` 在调用时立刻按给定结果回调。 */
const respondWithGate = (evaluation: GateEvaluation, unlockedNodeIds: string[]) => {
  gateMock.mutate.mockImplementation((_levelId, options) => {
    options?.onSuccess?.({ evaluation, unlockedNodeIds });
  });
};

/** 一份「全对、通过」的判定。默认恰好 8 题 7 对的门槛线。 */
const passedEvaluation = (over: Partial<GateEvaluation> = {}): GateEvaluation => ({
  levelId: 'lv-bool-laws',
  microKpId: 'kp-bool',
  mode: 'exit',
  verdict: 'passed',
  reason: 'passed',
  passed: true,
  rule: { itemCount: 2, passCount: 2 },
  correct: 2,
  total: 2,
  shortfall: 0,
  message: '通过了：2 题答对 2 题，达到 2/2 的达标线。',
  itemIds: ['i-probe', 'i-quiz'],
  wrongItemIds: [],
  evaluatedAt: '2026-10-21T02:00:00.000Z',
  remediation: null,
  ...over,
});

const failedEvaluation = (over: Partial<GateEvaluation> = {}): GateEvaluation => ({
  ...passedEvaluation({
    verdict: 'failed',
    reason: 'below_threshold',
    passed: false,
    correct: 1,
    shortfall: 1,
    message: '没通过：2 题答对 1 题，还差 1 题。',
    remediation: {
      kind: 'reteach',
      microKpId: 'kp-bool',
      stepId: 's-quiz',
      stepTitle: '判定',
      message: '回到「判定」这一段重听一遍，再做一遍这几道题。',
    },
  }),
  ...over,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/level/lv-bool-laws']}>
          <Routes>
            <Route path="/level/:levelId" element={<LevelPage />} />
            <Route path="/map/:microKpId" element={<div>知识点详情桩</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

const mockLevel = (payload: LevelDetailResponse | undefined = makeSpec()) => {
  vi.mocked(queries.useLevel).mockReturnValue({
    isLoading: false,
    error: null,
    payload,
    refetch: vi.fn(),
  } as never);
};

/** 门控历史默认空数组：多数用例不关心历史，只关心「能不能评一次」。 */
const mockHistory = (evaluations: GateHistoryResponse['evaluations'] = []) => {
  vi.mocked(queries.useGateHistory).mockReturnValue({
    payload: { levelId: 'lv-bool-laws', evaluations },
    isLoading: false,
    error: null,
  } as never);
};

const mockMastery = (view: MasteryView | undefined = makeMastery()) => {
  vi.mocked(queries.useMastery).mockReturnValue({
    payload: view,
    isLoading: false,
    error: null,
  } as never);
};

/** 让 `mutate` 在调用时立刻按给定结果回调，模拟后端已返回。 */
const respondWith = (kind: 'success' | 'error') => {
  submitMock.mutate.mockImplementation((request, options) => {
    if (kind === 'success') {
      options?.onSuccess?.({
        attempt: {
          attemptId: '9001',
          attemptNo: 7,
          itemId: request.itemId,
          microKpId: 'kp-bool',
          levelId: 'lv-bool-laws',
          variantGroup: 'vg-x',
          knowledgeKind: 'fact',
          correct: true,
          countsTowardMastery: true,
          createdAt: '2026-10-20T00:00:00.000Z',
        },
        mastery: makeMastery(),
      });
    } else {
      options?.onError?.(new Error('网络断了'));
    }
  });
};

/** 一步步点完当前段，直到进入指定段（或超过上限）。 */
const walkTo = async (user: ReturnType<typeof userEvent.setup>, kind: string, correct: boolean) => {
  for (let guard = 0; guard < 12; guard += 1) {
    const stepHeading = screen.queryByText(new RegExp(`第 \\d+ 段 · `));
    if (!stepHeading) return;
    const text = stepHeading.textContent ?? '';
    if (text.includes(kind)) return;
    // 一道选择题本身就有多个 radio，必须用 All 版本再判空。
    const radios = screen.queryAllByRole('radio');
    if (radios.length > 0) {
      const target = correct ? radios[0] : radios[radios.length - 1];
      if (!target) throw new Error('没有可选选项');
      await user.click(target);
      const submitButton = screen.queryByRole('button', { name: '提交答案' });
      if (submitButton) await user.click(submitButton);
    }
    await user.click(screen.getByRole('button', { name: /进入下一段|完成本关/ }));
  }
  throw new Error('推进次数超限');
};

/**
 * 一直做题到小结面板。
 *
 * 票 19 的「看讲解」面板挂在小结里（卡住之后才需要补丁，不是进关卡之前），
 * 所以两条视频用例都得先走到这里。抽成函数是因为「推进到终态」的细节
 * （先点选项、再提交、再下一段）与做题用例完全一致 —— 写两遍就会漏一遍。
 */
const walkToSummary = async (user: ReturnType<typeof userEvent.setup>) => {
  await walkTo(user, '判定', true);
  await user.click(screen.getAllByRole('radio')[0]!);
  await user.click(screen.getByRole('button', { name: '提交答案' }));
  await user.click(screen.getByRole('button', { name: '进入下一段' }));
  expect(screen.getByText('本关小结')).toBeInTheDocument();
};

describe('LevelPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 视频桩在每个用例前回到空列表：上一条用例的片段不能漏到下一条。
    videoClipsState = { isPending: false, isError: false, error: null, payload: { items: [] } };
    mockMastery();
    mockHistory();
    respondWith('success');
  });

  it('载入时显示当前段与首段内容卡，进度条七段齐全', () => {
    mockLevel();
    renderPage();
    expect(screen.getByText('逻辑代数基本律：吸收律与德摩根律')).toBeInTheDocument();
    expect(screen.getByText('第 1 段 · 引导')).toBeInTheDocument();
    expect(screen.getByText('为什么要化简')).toBeInTheDocument();
    // 内容卡渲染了整段正文，而不是一句话摘要
    expect(screen.getByText(/一个组合逻辑式/)).toBeInTheDocument();

    const rail = screen.getByRole('list', { name: '关卡进度' });
    expect(within(rail).getAllByRole('listitem')).toHaveLength(7);
  });

  it('答对后立即显示预写反馈，不需要等待任何异步', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '简单问题', true);
    expect(screen.getByText('第 3 段 · 简单问题')).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    await user.click(radios[0]!);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    // 点完的那一帧就在 DOM 里：没有 loading、没有 await。
    expect(screen.getByText('答对了')).toBeInTheDocument();
    /*
      讲解里的 `$…$` 必须已经被渲染成可读文本，不能把源码丢给学生。

      这里断言 `document.body.textContent` 而不是 `getByText`：`InlineRich` 会把
      公式切成独立的 `<span>`（那是渲染发生了的证据），一个正则无法跨元素匹配。
    */
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('吸收律 A + A·B = A 就是这个形状');
    expect(bodyText).not.toContain('$A + A·B = A$');
  });

  it('答错后显示的是另一段预写反馈，并列出错因标签', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '简单问题', true);
    const radios = screen.getAllByRole('radio');
    const lastRadio = radios[radios.length - 1];
    if (!lastRadio) throw new Error('没有可选选项');
    await user.click(lastRadio);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    expect(screen.getByText('这条没答对，看下错在哪')).toBeInTheDocument();
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('多出来的 B 被 A 吸收了');
    expect(bodyText).not.toContain('$B$');
    expect(screen.getByText('吸收律误用')).toBeInTheDocument();
  });

  it('提交后把这道题送到后端记账，上传的是题干信息与段 id，不含前端算出的对错', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '简单问题', true);
    await user.click(screen.getAllByRole('radio')[0]!);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    expect(submitMock.mutate).toHaveBeenCalledTimes(1);
    const [request] = submitMock.mutate.mock.calls[0]!;
    expect(request).toMatchObject({ itemId: 'i-probe', answer: 0, stepId: 's-probe' });
    // 判对错的真源在后端（拿 level_items.answer 重判）。前端这份 correct 只用于渲染，
    // 一旦上传就等于把证据交给客户端，而掌握度正是唯一不能让的那一环。
    expect(request).not.toHaveProperty('correct');
    expect(request).not.toHaveProperty('microKpId');
    // 过程量（用时、提示级数）要一起上报：8 分钟才蒙对与 3 秒答对不该同权。
    expect(request).toHaveProperty('latencyMs');
    expect(request).toHaveProperty('hintsUsed');
  });

  it('后端确认后，题下显示「已记入学习档案（第 N 次）」', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '简单问题', true);
    await user.click(screen.getAllByRole('radio')[0]!);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    expect(await screen.findByText(/已记入学习档案（第 7 次）/)).toBeInTheDocument();
  });

  it('记账失败时明说这条没记上、掌握度不会更新，且不阻塞继续答题', async () => {
    const user = userEvent.setup();
    mockLevel();
    respondWith('error');
    renderPage();

    await walkTo(user, '简单问题', true);
    await user.click(screen.getAllByRole('radio')[0]!);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    // 反馈照样出现（票 04 验收 3 不因为后端故障而失效）
    expect(screen.getByText('答对了')).toBeInTheDocument();
    // 但必须留下「没记进档案」的明确提示，不做静默降级
    expect(await screen.findByText(/这条作答没能记进档案：网络断了/)).toBeInTheDocument();
    expect(screen.getByText(/掌握度这次不会更新/)).toBeInTheDocument();
    // 顶部还有一条汇总提示条（文本被 <strong> 切成多个节点，只能匹配前一段）
    expect(screen.getByText(/有 1 条作答/)).toBeInTheDocument();
    // 仍可继续推进
    expect(screen.getByRole('button', { name: '进入下一段' })).toBeEnabled();
  });

  it('简单问题未达标 → 真的进入深究，并明说不扣掌握度', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '简单问题', false);
    const radios = screen.getAllByRole('radio');
    const lastRadio = radios[radios.length - 1];
    if (!lastRadio) throw new Error('没有可选选项');
    await user.click(lastRadio);
    await user.click(screen.getByRole('button', { name: '提交答案' }));
    await user.click(screen.getByRole('button', { name: '进入下一段' }));

    expect(screen.getByText('第 4 段 · 深究')).toBeInTheDocument();
    expect(screen.getByText(/全程不扣掌握度/)).toBeInTheDocument();
    // 深究段的题也被标成「本段不影响掌握度」
    expect(screen.getByText('本段不影响掌握度')).toBeInTheDocument();
  });

  it('简单问题达标 → 跳过深究与进一步讲解，直接进判定；跳过的段在进度条上标出来', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '判定', true);
    expect(screen.getByText('第 6 段 · 判定')).toBeInTheDocument();

    const rail = screen.getByRole('list', { name: '关卡进度' });
    const chips = within(rail).getAllByRole('listitem');
    expect(chips.map((chip) => chip.getAttribute('data-status'))).toEqual([
      'done',
      'done',
      'done',
      'skipped',
      'skipped',
      'current',
      'upcoming',
    ]);
  });

  it('走完全程后显示小结，并展示后端给的 achieved/current 双栏', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '判定', true);
    const radios = screen.getAllByRole('radio');
    await user.click(radios[0]!);
    await user.click(screen.getByRole('button', { name: '提交答案' }));
    // 判定段之后还有小结段，所以这里仍是「进入下一段」而不是「完成本关」。
    await user.click(screen.getByRole('button', { name: '进入下一段' }));

    expect(screen.getByText('本关小结')).toBeInTheDocument();
    expect(screen.getByText('一次通过')).toBeInTheDocument();
    expect(screen.getByText('本关证据')).toBeInTheDocument();
    expect(screen.getByText(/一次通过，2 道作答全部计入掌握度/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回到知识点' })).toBeInTheDocument();

    // 双栏：历史最高（不衰减）与当前熟练度（会衰减）都必须出现，且是两个不同的数。
    expect(screen.getByText('历史最高（不回落，用于解锁）')).toBeInTheDocument();
    expect(screen.getByText('当前熟练度（会随时间回落，用于推荐）')).toBeInTheDocument();
    expect(screen.getByText('93%')).toBeInTheDocument();
    expect(screen.getByText('74%')).toBeInTheDocument();
  });

  it('小结段的掌握度取自后端；证据不足时显示「证据不足」而不是 0%', async () => {
    const user = userEvent.setup();
    mockLevel();
    mockMastery(
      makeMastery({ achieved: null, current: null, evidenceSufficient: false, attemptCount: 2, variantCount: 1 }),
    );
    renderPage();

    await walkTo(user, '判定', true);
    await user.click(screen.getAllByRole('radio')[0]!);
    await user.click(screen.getByRole('button', { name: '提交答案' }));
    await user.click(screen.getByRole('button', { name: '进入下一段' }));

    expect(screen.getByText('证据不足')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    // 还差多少要讲清楚，让人知道下一步该做什么
    expect(screen.getByText(/再 6 次作答、再 2 个不同变式/)).toBeInTheDocument();
  });

  it('关卡载入失败时给出可读的错误，而不是白屏', () => {
    vi.mocked(queries.useLevel).mockReturnValue({
      isLoading: false,
      error: new Error('关卡不存在: lv-nope'),
      payload: undefined,
    } as never);
    renderPage();
    expect(screen.getByText(/关卡载入失败/)).toBeInTheDocument();
  });

  it('载入中显示 spinner', () => {
    vi.mocked(queries.useLevel).mockReturnValue({
      isLoading: true,
      error: null,
      payload: undefined,
    } as never);
    renderPage();
    expect(screen.getByText('正在载入关卡…')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 票 06：出口门控
  // -------------------------------------------------------------------------

  /** 走到小结（判定段答对并推进）。 */
  const walkToSummary = async (user: ReturnType<typeof userEvent.setup>) => {
    await walkTo(user, '判定', true);
    await user.click(screen.getAllByRole('radio')[0]!);
    await user.click(screen.getByRole('button', { name: '提交答案' }));
    await user.click(screen.getByRole('button', { name: '进入下一段' }));
    expect(screen.getByText('本关小结')).toBeInTheDocument();
  };

  it('不设门控的关卡只说清楚这里没有门槛，不画一个永远灰着的按钮', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();
    await walkToSummary(user);

    expect(screen.getByText('出口门控')).toBeInTheDocument();
    expect(screen.getByText(/这一关不设门控/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /评一次出口门控/ })).not.toBeInTheDocument();
  });

  it('章末出口：进小结不自动判定，点按钮才发一次 POST，且考前不显示作者的题量', async () => {
    const user = userEvent.setup();
    // spec 里作者声明 2/2，但 exit 门的判定规则是引擎常量（8 题需 7 对）——
    // 作者的数值只被校验器用来保证卷子够长，不参与判定。
    mockLevel(makeSpec({ mode: 'exit', itemCount: 2, passCount: 2 }));
    renderPage();
    await walkToSummary(user);

    // 关键：翻到小结页不等于被考一次。挂载即 POST 会让「看看小结」变成一场考试。
    expect(gateMock.mutate).not.toHaveBeenCalled();
    // 考前展示的必须是**引擎规则**：作者写 2 题，但判定从 8 题起算。
    // 显示 2/2 会让学习者按一个不会生效的数字准备考试。
    expect(screen.getByText(/至少要做满 8 道/)).toBeInTheDocument();
    expect(screen.getByText(/答对 7 道才算过/)).toBeInTheDocument();
    expect(screen.queryByText(/要做满 2 道/)).not.toBeInTheDocument();
    // 这一关的判定段只有 1 道题，撑不起 8 题的门控 —— 要明说「不是你的问题」。
    expect(screen.getByText(/只有 1 道题，少于门控要求的 8 道/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '评一次出口门控' }));
    expect(gateMock.mutate).toHaveBeenCalledTimes(1);
    expect(gateMock.mutate.mock.calls[0]![0]).toBe('lv-bool-laws');
  });

  it('判定通过：显示「已通过」、刚解锁的下游节点，并说明不会重复解锁', async () => {
    const user = userEvent.setup();
    mockLevel(makeSpec({ mode: 'exit', itemCount: 2, passCount: 2 }));
    respondWithGate(passedEvaluation({ itemIds: ['i-probe', 'i-quiz'] }), ['kp-demorgan']);
    renderPage();
    await walkToSummary(user);
    await user.click(screen.getByRole('button', { name: '评一次出口门控' }));

    expect(await screen.findByText('已通过')).toBeInTheDocument();
    expect(screen.getByText(/刚解锁了 1 个下游节点/)).toBeInTheDocument();
    expect(screen.getByText(/kp-demorgan/)).toBeInTheDocument();
  });

  it('判定没通过：给重讲路径（段落 + 答错的具体题目），不是一句「不合格」', async () => {
    const user = userEvent.setup();
    mockLevel(makeSpec({ mode: 'exit', itemCount: 2, passCount: 2 }));
    respondWithGate(
      failedEvaluation({
        itemIds: ['i-probe', 'i-quiz'],
        wrongItemIds: ['i-quiz'],
        shortfall: 1,
      }),
      [],
    );
    renderPage();
    await walkToSummary(user);
    await user.click(screen.getByRole('button', { name: '评一次出口门控' }));

    expect(await screen.findByText('未通过')).toBeInTheDocument();
    expect(screen.getByText('接下来重听哪一块')).toBeInTheDocument();
    // 指向具体段落
    expect(screen.getByText(/对应段落：判定/)).toBeInTheDocument();
    // 指向具体的题（题干摘要）。两处都提这道题：重讲路径里一处、判定用了哪几题一处。
    expect(screen.getAllByText(/要用与非门实现/).length).toBeGreaterThan(0);
    // 还差几道要说出来
    expect(screen.getByText('还差')).toBeInTheDocument();
  });

  it('题量不足显示「还没考够」而不是「未通过」：没考完不等于考砸了', async () => {
    const user = userEvent.setup();
    mockLevel(makeSpec({ mode: 'exit', itemCount: 8, passCount: 7 }));
    respondWithGate(
      failedEvaluation({
        verdict: 'undetermined',
        reason: 'insufficient_items',
        itemIds: ['i-probe', 'i-quiz'],
        wrongItemIds: [],
        correct: 2,
        total: 2,
        shortfall: 6,
        message: '题量不足：还需要 6 道判定题才能判定',
      }),
      [],
    );
    renderPage();
    await walkToSummary(user);
    await user.click(screen.getByRole('button', { name: '评一次出口门控' }));

    expect(await screen.findByText('还没考够')).toBeInTheDocument();
    expect(screen.queryByText('未通过')).not.toBeInTheDocument();
  });

  it('历次判定可回看，且每次都说清用了哪几道题', async () => {
    const user = userEvent.setup();
    mockLevel(makeSpec({ mode: 'exit', itemCount: 2, passCount: 2 }));
    mockHistory([
      passedEvaluation({ itemIds: ['i-probe', 'i-quiz'] }),
      failedEvaluation({ itemIds: ['i-probe'], wrongItemIds: ['i-probe'], shortfall: 2 }),
    ]);
    renderPage();
    await walkToSummary(user);

    expect(screen.getByText('历次判定（新的在前）')).toBeInTheDocument();
    const entries = screen.getAllByText(/用了 \d 道题/);
    expect(entries).toHaveLength(2);
  });

  it('判定失败时明说「这次没有写下任何判定记录」，不让错误静默', async () => {
    const user = userEvent.setup();
    mockLevel(makeSpec({ mode: 'exit', itemCount: 2, passCount: 2 }));
    gateMock.mutate.mockImplementation((_levelId, options) => {
      options?.onError?.(new Error('网络断了'));
    });
    renderPage();
    await walkToSummary(user);
    await user.click(screen.getByRole('button', { name: /评一次出口门控/ }));

    expect(await screen.findByText(/判定没能完成：网络断了/)).toBeInTheDocument();
  });

  it('「重走这一关」把本地流程清零（后端证据保留）', async () => {
    const user = userEvent.setup();
    mockLevel(makeSpec({ mode: 'exit', itemCount: 2, passCount: 2 }));
    renderPage();
    await walkToSummary(user);

    await user.click(screen.getByRole('button', { name: '重走这一关' }));
    // 回到第一段
    expect(screen.getByText('第 1 段 · 引导')).toBeInTheDocument();
    // 后端收到的作答不会因为重走而被撤销 —— 页面只是重新开始本地流程
    expect(submitMock.mutate).toHaveBeenCalled();
  });

  it('未解锁（409）时给出「先过哪一关」，而不是一句「载入失败」', () => {
    vi.mocked(queries.useLevel).mockReturnValue({
      isLoading: false,
      error: new ApiClientError(409, 'CONFLICT', '这个关卡还没解锁', {
        microKpId: 'kp-demorgan',
        unlocked: false,
        blockers: [
          {
            prerequisiteId: 'kp-bool',
            prerequisiteName: '逻辑代数基本律',
            levelId: 'lv-bool-laws',
            levelTitle: '逻辑代数基本律：吸收律与德摩根律',
            gateMode: 'exit',
            lastVerdict: 'failed',
            shortfall: 2,
            lastAttemptedItemIds: ['i-probe'],
          },
        ],
      }),
      payload: undefined,
      refetch: vi.fn(),
    } as never);
    renderPage();

    expect(screen.getByText('这一关还没解锁')).toBeInTheDocument();
    expect(screen.getByText(/逻辑代数基本律/)).toBeInTheDocument();
    expect(screen.getByText(/最近一次判定还差 2 道题/)).toBeInTheDocument();
    // 不是把 409 当服务器故障
    expect(screen.queryByText(/关卡载入失败/)).not.toBeInTheDocument();
  });

  /**
   * 票 19 验收第 4 条：「每片至少对齐 1 个知识点，能在关卡页被调出播放」。
   *
   * 这条必须在**页面层**验，不能只靠 `video.controller.test.ts` 验接口：
   * 接口能返回片段但页面不渲染 `<video>` 的话，学习者那边就是没有视频。
   * 同时钉住 `src` 的路径形状（`/media/clips/...`，相对路径，与 captain
   * 定下的约定一致）—— 写成绝对地址会让 dev / 生产两套域名都错。
   *
   * 「看讲解」住在小结面板里（卡住之后才需要补丁，不是进关卡之前），
   * 所以要先走到小结。
   */
  it('有讲解片段时渲染出可播放的 <video>，src 指向 /media/clips/ 下的相对路径', async () => {
    const user = userEvent.setup();
    mockLevel();
    setVideoClips({
      payload: {
        items: [
          {
            clipId: 'BV1VE411e7UP_p9-c01',
            videoId: 'BV1VE411e7UP_p9',
            title: '核电子学 37 讲 p09 前置放大器（1）',
            startSec: 15.25,
            endSec: 324.7,
            durationSec: 309.45,
            microKpId: 'kp-jichangsong-1990-11-8',
            microKpName: '前置放大器',
            reason: '跳过片头 1 条（命中开场寒暄）；停在 5:24：为控制单片时长（≤6 分钟）',
            transcriptExcerpt: '那么前置放大器它的作用是什么呢',
            playUrl: '/media/clips/BV1VE411e7UP_p9-c01.mp4',
            sourceUrl: 'https://www.bilibili.com/video/BV1VE411e7UP?p=9',
            sourceOrigin: 'bilibili',
            sourceNote: null,
            uploadedBy: '张雪梅（B 站）',
            asrModel: 'faster-whisper:small:int8',
            downloadedAt: '2026-10-21T04:00:03+00:00',
            alignments: [
              {
                microKpId: 'kp-jichangsong-1990-11-8',
                name: '前置放大器',
                score: 6,
                hits: ['前置放大器'],
              },
            ],
          },
        ],
      },
    });
    renderPage();

    await walkToSummary(user);

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    // 相对路径：`clipSrc` 拼的是 `VITE_API_BASE_URL`，测试环境为空串
    expect(video?.getAttribute('src')).toBe('/media/clips/BV1VE411e7UP_p9-c01.mp4');

    // 票面验收第 3 条：切分理由要看得见，不能只存库里
    expect(screen.getByText(/跳过片头 1 条/)).toBeInTheDocument();
    // 票面验收第 7 条：来源可追溯
    expect(screen.getByText(/BV1VE411e7UP\?p=9/)).toBeInTheDocument();
  });

  /**
   * 视频是**只读增强**：没有片段时不能渲染一个空播放器，也不能报错。
   *
   * 「没配」与「加载失败」要能分开。前者不阻断做题，后者才提示重试。
   */
  it('没有讲解片段时不渲染空播放器、也不报错（视频不阻断做题）', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkToSummary(user);

    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText(/这个知识点还没有配讲解视频/)).toBeInTheDocument();
    // 没片段不是错误
    expect(screen.queryByText(/讲解视频没能加载/)).not.toBeInTheDocument();
    // 页面主体仍然正常：小结面板与做题都不受影响
    expect(screen.getByText('本关小结')).toBeInTheDocument();
  });
});
