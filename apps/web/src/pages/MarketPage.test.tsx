import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import type {
  LevelExportFile,
  MarketDraftResponse,
  MarketLevelListResponseItemsItem,
  MarketSaveLevelResponse,
} from '../api/generated/model';
import { MarketPage } from './MarketPage';
import { MarketAuthorPage, toIssues } from './MarketAuthorPage';
import * as queries from '../api/queries';
import * as downloadModule from '../market/download';
import { ApiClientError } from '../api/fetcher';

/**
 * 关卡市场页与自制关卡编辑页的渲染测试。
 *
 * 请求路径、状态码、契约形状由 `apps/api/src/market/market.controller.test.ts`
 * 与 openapi 校验覆盖。这里把 query/mutation hook 换掉，只验证页面在
 * 「拿到这份数据」之后怎么反应 —— 尤其是票 14 验收④那条：页面上必须有
 * 「这是保存、不是分发」的明确说法，且**不能**出现分享/上传类动作。
 */
vi.mock('../api/queries', () => ({
  useMarketLevels: vi.fn(),
  useMarketLevel: vi.fn(),
  useCreateMarketDraft: vi.fn(),
  useSaveMarketLevel: vi.fn(),
  // 票 67 新增的五个 hook：页面每多用一 hook 就必须补进这个工厂，
  // 否则整页在 render 时就抛「No "useXxx" export is defined on the mock」，
  // 连带把与本票无关的旧用例一起弄红。
  useLevelTemplates: vi.fn(),
  usePreviewLevelTemplate: vi.fn(),
  useExportLevel: vi.fn(),
  useImportLevel: vi.fn(),
  useTierOverview: vi.fn(),
}));

const mocked = vi.mocked(queries);

const queryStub = <T,>(payload: T | undefined) => ({
  data: payload === undefined ? undefined : { data: payload },
  payload,
  isPending: false,
  isError: false,
  isSuccess: payload !== undefined,
  error: null,
});

/**
 * mutation 的桩。
 *
 * 与 `queryStub` 分开写是因为两者的形状没有交集：mutation 没有 `data/payload`，
 * query 没有 `mutate`。硬套一个「万能 stub」会让类型断言撒谎，测试也就查不出
 * 「页面读了 mutation 上并不存在的字段」这类错。
 */
const mutationStub = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  data: undefined,
  reset: vi.fn(),
});

const teachingTemplate = {
  templateId: 'teaching',
  version: 1,
  name: '教学关',
  summary: '先讲再练：引导、展示细节、简单问题、深究、进一步讲解、判定、小结七段。',
  type: 'teaching' as const,
  gating: { mode: 'none' as const, itemCount: 2, passCount: 2 },
  segments: [
    { kind: 'guide', title: '引导', cardCount: 1, itemCount: 0, requiredCorrect: 0, tiers: ['P1', 'P2', 'P3'], purpose: '先把这一关要解决的问题说清楚。' },
    { kind: 'detail', title: '展示细节', cardCount: 2, itemCount: 0, requiredCorrect: 0, tiers: ['P1', 'P2', 'P3'], purpose: '把定义、公式与适用条件摊开。' },
    { kind: 'probe', title: '简单问题', cardCount: 0, itemCount: 1, requiredCorrect: 1, tiers: ['P1', 'P2', 'P3'], purpose: '用一道小题探一探卡在哪。' },
    { kind: 'deepen', title: '深究', cardCount: 0, itemCount: 1, requiredCorrect: 0, tiers: ['P1', 'P2'], purpose: '没答对就往下追一层。' },
    { kind: 'reteach', title: '进一步讲解', cardCount: 1, itemCount: 0, requiredCorrect: 0, tiers: ['P1'], purpose: '换一个角度重讲一遍。' },
    { kind: 'quiz', title: '判定', cardCount: 0, itemCount: 2, requiredCorrect: 1, tiers: ['P1', 'P2', 'P3'], purpose: '判定这一关过没过。' },
    { kind: 'summary', title: '小结', cardCount: 0, itemCount: 0, requiredCorrect: 0, tiers: ['P1', 'P2', 'P3'], purpose: '把这一趟的证据与路线摊给学生看。' },
  ],
  slots: [
    { key: 'guide-card-0', kind: 'card' as const, segmentKind: 'guide' as const, index: 0, label: '引导卡', required: true },
  ],
};

const practiceTemplate = {
  ...teachingTemplate,
  templateId: 'practice',
  name: '练习关',
  summary: '直接练：五道判定题加一段小结。',
  type: 'quiz' as const,
  gating: { mode: 'none' as const, itemCount: 5, passCount: 3 },
  segments: [
    { kind: 'quiz', title: '判定', cardCount: 0, itemCount: 5, requiredCorrect: 3, tiers: ['P1', 'P2', 'P3'], purpose: '五道题看掌握到什么程度。' },
    { kind: 'summary', title: '小结', cardCount: 0, itemCount: 0, requiredCorrect: 0, tiers: ['P1', 'P2', 'P3'], purpose: '摊出证据。' },
  ],
};

const reviewTemplate = {
  ...teachingTemplate,
  templateId: 'review',
  name: '复习关',
  summary: '隔一段时间回来复查：三道题加一段小结。',
  type: 'quiz' as const,
  gating: { mode: 'none' as const, itemCount: 3, passCount: 2 },
  segments: [
    { kind: 'quiz', title: '判定', cardCount: 0, itemCount: 3, requiredCorrect: 2, tiers: ['P1', 'P2', 'P3'], purpose: '复查还记得多少。' },
    { kind: 'summary', title: '小结', cardCount: 0, itemCount: 0, requiredCorrect: 0, tiers: ['P1', 'P2', 'P3'], purpose: '摊出证据。' },
  ],
};

/** 模板预览响应：段数随档位变化（P1 七段 / P2 六段 / P3 五段），与后端一致。 */
function makePreview(tier: 'P1' | 'P2' | 'P3') {
  const segments = teachingTemplate.segments.filter((segment) => segment.tiers.includes(tier));
  return {
    persisted: false as const,
    templateId: 'teaching',
    tier,
    spec: {
      ...makeDraftSpec(),
      meta: { ...makeDraftSpec().meta, id: `kp-bool--teaching--${tier}`, tier, type: 'teaching' as const },
      steps: segments.map((segment, index) => ({
        id: `s-${segment.kind}-${index}`,
        kind: segment.kind,
        title: segment.title,
        cardIds: [],
        itemIds: [],
        requiredCorrect: segment.requiredCorrect,
      })),
    },
  };
}

function renderPage(ui: React.ReactNode, path = '/market', route = '/market') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={ui} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
}

const presetLevel: MarketLevelListResponseItemsItem = {
  levelId: 'lv-bool-laws',
  microKpId: 'kp-bool',
  microKpName: '布尔代数基本运算',
  title: '逻辑代数基本律：吸收律与德摩根律',
  kind: 'teach',
  author: 'system',
  itemCount: 4,
  savedAt: null,
  tags: [],
  origin: 'preset',
};

const savedLevel: MarketLevelListResponseItemsItem = {
  levelId: 'lv-self-kp-bool',
  microKpId: 'kp-bool',
  microKpName: '布尔代数基本运算',
  title: '吸收律：我自己整理的一关',
  kind: 'quiz',
  author: 'self',
  itemCount: 2,
  savedAt: '2026-10-20T02:30:00.000Z',
  tags: ['自测', '吸收律'],
  origin: 'saved',
};

/** 一份合法的 quiz 型 spec：草稿打包出来的形状。 */
function makeDraftSpec() {
  return {
    schemaVersion: 1,
    meta: {
      id: 'lv-self-kp-bool',
      microKpId: 'kp-bool',
      title: '布尔代数：我的学习关卡',
      type: 'quiz',
      tier: 'P1',
      estimatedMinutes: 4,
      author: 'self',
      isEntry: false,
      nextLevelId: null,
    },
    sources: [{ ref: '教材 p.42', locator: null }],
    cards: [],
    steps: [
      {
        id: 's-quiz',
        kind: 'quiz',
        title: '这段学习里做过的题',
        cardIds: [],
        itemIds: ['lv-self-kp-bool-i0'],
        requiredCorrect: 0,
      },
    ],
    items: [
      {
        id: 'lv-self-kp-bool-i0',
        kind: 'concept',
        stem: 'A + A·B 化简后等于什么？',
        options: ['A', 'B', 'A·B', 'A+B'],
        answer: 0,
        variantGroup: 'vg-absorb',
        explainCorrect: '吸收律：A 为真时整式为真。',
        explainWrong: '再想想：A 为真时，A·B 是否影响结果？',
        misconceptionTags: ['吸收律混淆'],
        sourceRef: '教材 p.42',
        pool: 'core',
        hintLadder: [],
      },
    ],
    gating: { mode: 'exit', itemCount: 1, passCount: 1 },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.useSaveMarketLevel.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null,
  } as unknown as ReturnType<typeof queries.useSaveMarketLevel>);
  mocked.useCreateMarketDraft.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null,
  } as unknown as ReturnType<typeof queries.useCreateMarketDraft>);
  mocked.useMarketLevel.mockReturnValue(
    queryStub(undefined) as unknown as ReturnType<typeof queries.useMarketLevel>,
  );
  // 票 67：默认给三个模板 + 空预览，让与模板无关的旧用例不受影响。
  mocked.useLevelTemplates.mockReturnValue(
    queryStub({ templates: [teachingTemplate, practiceTemplate, reviewTemplate] }) as unknown as ReturnType<
      typeof queries.useLevelTemplates
    >,
  );
  mocked.usePreviewLevelTemplate.mockReturnValue(mutationStub() as unknown as ReturnType<
    typeof queries.usePreviewLevelTemplate
  >);
  mocked.useExportLevel.mockReturnValue(mutationStub() as unknown as ReturnType<
    typeof queries.useExportLevel
  >);
  mocked.useImportLevel.mockReturnValue(mutationStub() as unknown as ReturnType<
    typeof queries.useImportLevel
  >);
  mocked.useTierOverview.mockReturnValue(
    queryStub({
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
      label: '标准节奏',
      description: '关卡给部分步骤，剩下由你补。',
    }) as unknown as ReturnType<typeof queries.useTierOverview>,
  );
});

describe('MarketPage', () => {
  it('分开列出「我保存的」与「预制」两类关卡', () => {
    mocked.useMarketLevels.mockReturnValue(
      queryStub({
        items: [savedLevel, presetLevel],
      }) as unknown as ReturnType<typeof queries.useMarketLevels>,
    );
    renderPage(<MarketPage />);

    expect(screen.getByText('我保存的关卡')).toBeInTheDocument();
    expect(screen.getByText('预制关卡')).toBeInTheDocument();
    // 两张卡都在
    expect(screen.getByText('逻辑代数基本律：吸收律与德摩根律')).toBeInTheDocument();
    expect(screen.getByText('吸收律：我自己整理的一关')).toBeInTheDocument();
    // 标签与保存时间对自制关卡可见
    expect(screen.getByText('自测')).toBeInTheDocument();
    expect(screen.getByText(/保存于/)).toBeInTheDocument();
  });

  /**
   * 验收④的正面断言：页面上有「只做保存、不做分发」这句话。
   * 这句话是产品语义的一部分，不是装饰 —— 删掉它等于让用户以为保存
   * 会发布出去。
   */
  it('页面明确写着这是「保存」而不是「分发」', () => {
    mocked.useMarketLevels.mockReturnValue(
      queryStub({ items: [presetLevel] }) as unknown as ReturnType<typeof queries.useMarketLevels>,
    );
    renderPage(<MarketPage />);
    expect(screen.getByText(/这里只做「保存」，不做「分发」/)).toBeInTheDocument();
    expect(screen.getByText(/不会上传到任何社区/)).toBeInTheDocument();
  });

  /**
   * 验收④的反面断言：不存在分享/上传/发布类按钮。
   * 用可访问名扫一遍比逐个数按钮更耐改版 —— 新增按钮时只要名字里带这些词就会红。
   */
  it('没有任何分享/上传/发布到社区的入口', () => {
    mocked.useMarketLevels.mockReturnValue(
      queryStub({
        items: [savedLevel, presetLevel],
      }) as unknown as ReturnType<typeof queries.useMarketLevels>,
    );
    renderPage(<MarketPage />);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const label of buttons) {
      expect(label).not.toMatch(/分享|上传|发布|社区|公开/);
    }
  });

  it('没有保存过关卡时给出怎么做的提示，而不是空白', () => {
    mocked.useMarketLevels.mockReturnValue(
      queryStub({ items: [presetLevel] }) as unknown as ReturnType<typeof queries.useMarketLevels>,
    );
    renderPage(<MarketPage />);
    expect(screen.getByText(/还没有保存过自制关卡/)).toBeInTheDocument();
  });

  it('接口失败时显示错误，不白屏', () => {
    mocked.useMarketLevels.mockReturnValue({
      ...queryStub(undefined),
      isPending: false,
      isError: true,
      error: new Error('数据库连接池耗尽'),
    } as unknown as ReturnType<typeof queries.useMarketLevels>);
    renderPage(<MarketPage />);
    expect(screen.getByText(/数据库连接池耗尽/)).toBeInTheDocument();
  });

  it('自制关卡有「继续编辑」与「重新开始」，预制关卡只有「重新开始」', () => {
    mocked.useMarketLevels.mockReturnValue(
      queryStub({
        items: [savedLevel, presetLevel],
      }) as unknown as ReturnType<typeof queries.useMarketLevels>,
    );
    renderPage(<MarketPage />);
    expect(screen.getByRole('button', { name: '继续编辑' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '重新开始' })).toHaveLength(2);
  });

  it('没填知识点 id 就点「开始打包」时提示，不发请求', async () => {
    const user = userEvent.setup();
    mocked.useMarketLevels.mockReturnValue(
      queryStub({ items: [] }) as unknown as ReturnType<typeof queries.useMarketLevels>,
    );
    renderPage(<MarketPage />);
    await user.click(screen.getByRole('button', { name: '开始打包' }));
    expect(screen.getByText(/先填写知识点 id/)).toBeInTheDocument();
  });
});

describe('MarketAuthorPage', () => {
  it('进页面就打包草稿，并把 JSON 与「这次学习发生了什么」一起显示出来', async () => {
    const draft: MarketDraftResponse = {
      spec: makeDraftSpec(),
      issues: [],
      learning: {
        microKpId: 'kp-bool',
        microKpName: '布尔代数基本运算',
        attemptCount: 3,
        correctCount: 1,
        items: [
          {
            itemId: 'it-1',
            stem: 'A + A·B 化简后等于什么？',
            correct: false,
            misconceptionTags: ['吸收律混淆'],
          },
        ],
        cardIds: [],
        sourceLevelIds: ['lv-bool-laws'],
      },
    };
    const mutate = vi.fn((_req: unknown, handlers?: { onSuccess?: (r: MarketDraftResponse) => void }) => {
      handlers?.onSuccess?.(draft);
    });
    mocked.useCreateMarketDraft.mockReturnValue({
      mutate,
      isPending: false,
      isSuccess: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useCreateMarketDraft>);

    renderPage(<MarketAuthorPage />, '/market/author/kp-bool', '/market/author/:microKpId');

    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ microKpId: 'kp-bool' }, expect.anything()));
    expect(screen.getByText(/作答 3 次，其中 1 次正确/)).toBeInTheDocument();
    expect(screen.getByText('A + A·B 化简后等于什么？')).toBeInTheDocument();
    expect(screen.getByText('做错')).toBeInTheDocument();
    const editor = screen.getByLabelText('关卡 JSON') as HTMLTextAreaElement;
    expect(editor.value).toContain('"schemaVersion": 1');
  });

  /**
   * 验收②：校验不通过时**必须**把字段级错误摊开给用户看，且明确说没入库。
   * 只显示「保存失败」等于让用户自己猜哪个字段错了。
   *
   * 这里的 `ApiClientError` 逐字照抄服务端 422 的真实响应体
   * （`apps/api/src/market/market.controller.test.ts` 里
   * 「422 与 400 的 details 是两种形状」那条测试把它钉住了）：
   * `code='VALIDATION_FAILED'`、`message` 里带「未写入关卡库」、
   * `details` 是 `{path: '点号字符串', message, code}[]`。
   * 造一个服务端根本不会返回的形状，等于用假响应验证假行为。
   */
  it('校验失败时逐条显示字段路径，并说明没有入库', async () => {
    const user = userEvent.setup();
    const { ApiClientError } = await import('../api/fetcher');
    const error = new ApiClientError(
      422,
      'VALIDATION_FAILED',
      '关卡规范校验不通过（2 处），未写入关卡库',
      [
        {
          path: 'items.0.sourceRef',
          message: '判定题 d-i-1 缺少 sourceRef，无法溯源到教材',
          code: 'custom',
        },
        {
          path: 'gating.itemCount',
          message: '门控题量 5 超过关卡总题量 1',
          code: 'custom',
        },
      ],
    );
    mocked.useSaveMarketLevel.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      error,
    } as unknown as ReturnType<typeof queries.useSaveMarketLevel>);
    mocked.useCreateMarketDraft.mockReturnValue({
      mutate: vi.fn((_r: unknown, handlers?: { onSuccess?: (r: MarketDraftResponse) => void }) => {
        handlers?.onSuccess?.({ spec: makeDraftSpec(), issues: [], learning: {
          microKpId: 'kp-bool', microKpName: '布尔代数基本运算',
          attemptCount: 0, correctCount: 0, items: [], cardIds: [], sourceLevelIds: [],
        } });
      }),
      isPending: false,
      isSuccess: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useCreateMarketDraft>);

    renderPage(<MarketAuthorPage />, '/market/author/kp-bool', '/market/author/:microKpId');
    await user.click(screen.getByRole('button', { name: '保存进关卡库' }));

    expect(screen.getByText(/校验没通过（2 处）/)).toBeInTheDocument();
    expect(screen.getByText('items.0.sourceRef')).toBeInTheDocument();
    expect(screen.getByText('判定题 d-i-1 缺少 sourceRef，无法溯源到教材')).toBeInTheDocument();
    expect(screen.getByText('gating.itemCount')).toBeInTheDocument();
  });

  /**
   * 服务端有**两种** details 形状（见 `apps/api/src/market/market.controller.test.ts`
   * 里「422 与 400 的 details 是两种形状」）：422 是点号字符串路径，
   * 400 是 Zod 原生的数组路径。页面必须两种都渲染得出来 —— 否则请求体
   * 语法错误时用户看到的是一个空的错误列表。
   */
  it('400 的 Zod 数组路径也能渲染成可读的字段路径', async () => {
    const user = userEvent.setup();
    const { ApiClientError } = await import('../api/fetcher');
    const error = new ApiClientError(400, 'VALIDATION_FAILED', '请求体不合法：spec 必须是关卡 JSON 对象', [
      {
        code: 'invalid_type',
        expected: 'nonoptional',
        path: ['spec'],
        message: 'Invalid input: expected nonoptional, received undefined',
      },
    ]);
    mocked.useSaveMarketLevel.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      error,
    } as unknown as ReturnType<typeof queries.useSaveMarketLevel>);
    mocked.useCreateMarketDraft.mockReturnValue({
      mutate: vi.fn((_r: unknown, handlers?: { onSuccess?: (r: MarketDraftResponse) => void }) => {
        handlers?.onSuccess?.({ spec: makeDraftSpec(), issues: [], learning: {
          microKpId: 'kp-bool', microKpName: '布尔代数基本运算',
          attemptCount: 0, correctCount: 0, items: [], cardIds: [], sourceLevelIds: [],
        } });
      }),
      isPending: false,
      isSuccess: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useCreateMarketDraft>);

    renderPage(<MarketAuthorPage />, '/market/author/kp-bool', '/market/author/:microKpId');
    await user.click(screen.getByRole('button', { name: '保存进关卡库' }));

    // 数组 path 被 join 成点号，而不是渲染成 "[object Array]" 或空白
    expect(screen.getByText('spec')).toBeInTheDocument();
    expect(screen.getByText(/expected nonoptional/)).toBeInTheDocument();
  });

  it('JSON 语法错误时在本地就拦住，不把坏文本发给后端', async () => {
    const user = userEvent.setup();
    const saveMutate = vi.fn();
    mocked.useSaveMarketLevel.mockReturnValue({
      mutate: saveMutate,
      isPending: false,
      isSuccess: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useSaveMarketLevel>);
    mocked.useCreateMarketDraft.mockReturnValue({
      mutate: vi.fn((_r: unknown, handlers?: { onSuccess?: (r: MarketDraftResponse) => void }) => {
        handlers?.onSuccess?.({ spec: makeDraftSpec(), issues: [], learning: {
          microKpId: 'kp-bool', microKpName: '布尔代数基本运算',
          attemptCount: 0, correctCount: 0, items: [], cardIds: [], sourceLevelIds: [],
        } });
      }),
      isPending: false,
      isSuccess: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useCreateMarketDraft>);

    renderPage(<MarketAuthorPage />, '/market/author/kp-bool', '/market/author/:microKpId');
    const editor = screen.getByLabelText('关卡 JSON');
    await user.clear(editor);
    await user.type(editor, '{{{{');
    await user.click(screen.getByRole('button', { name: '保存进关卡库' }));

    expect(screen.getByText(/这不是合法的 JSON/)).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it('保存成功后告知已保存并强调不会离开这台工作台', async () => {
    const saved: MarketSaveLevelResponse = {
      created: true,
      level: { ...savedLevel, savedAt: '2026-10-20T02:30:00.000Z' },
    };
    mocked.useSaveMarketLevel.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: true,
      data: saved,
      error: null,
    } as unknown as ReturnType<typeof queries.useSaveMarketLevel>);
    mocked.useCreateMarketDraft.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useCreateMarketDraft>);

    renderPage(<MarketAuthorPage />, '/market/author/kp-bool', '/market/author/:microKpId');
    expect(screen.getByText('已保存进关卡库')).toBeInTheDocument();
    expect(screen.getByText(/不会离开这台工作台/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新开始这一关' })).toBeInTheDocument();
  });

  it('带 levelId 进来时编辑已保存的关卡，而不是重新打包草稿', async () => {
    const createMutate = vi.fn();
    mocked.useCreateMarketDraft.mockReturnValue({
      mutate: createMutate,
      isPending: false,
      isSuccess: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useCreateMarketDraft>);
    mocked.useMarketLevel.mockReturnValue(
      queryStub({
        level: savedLevel,
        spec: makeDraftSpec(),
      }) as unknown as ReturnType<typeof queries.useMarketLevel>,
    );

    renderPage(
      <MarketAuthorPage />,
      '/market/author/kp-bool?levelId=lv-self-kp-bool',
      '/market/author/:microKpId',
    );

    expect(createMutate).not.toHaveBeenCalled();
    const editor = await screen.findByLabelText('关卡 JSON');
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('"schemaVersion": 1'));
    const heading = screen.getByRole('heading', { name: '继续编辑自制关卡' });
    expect(heading).toBeInTheDocument();
    expect(within(heading.closest('div') as HTMLElement).getByText(/lv-self-kp-bool/)).toBeInTheDocument();
  });
});

/**
 * `toIssues()` 的独立测试。
 *
 * 这个函数看起来像「万能的防御性函数」，那种函数最容易在下一个人手里被当
 * 冗余删掉 —— 因为没人知道它到底防的是什么。它防的是**服务端真的会返回的
 * 两种形状**（外加几种 `z.unknown()` 允许的畸形值），依据是
 * `apps/api/src/market/market.controller.test.ts` 里
 * 「422 与 400 的 details 是两种形状」那条实测。
 *
 * 这里的每个 `it` 对应一种真实或契约允许的形状。删掉任何一条，都是删掉
 * 一个「用户会看到空错误列表」的具体场景。
 */
describe('toIssues', () => {
  it('吃得下 422 的点号字符串 path（来自 validateLevelSpec）', () => {
    // 逐字来自真实响应体的抓取结果。
    const issues = toIssues([
      {
        path: 'items.0.sourceRef',
        message: '判定题 d-i-1 缺少 sourceRef，无法溯源到教材',
        code: 'custom',
      },
      { path: 'gating.itemCount', message: '门控题量 5 超过关卡总题量 1', code: 'custom' },
    ]);

    expect(issues).toEqual([
      {
        path: 'items.0.sourceRef',
        message: '判定题 d-i-1 缺少 sourceRef，无法溯源到教材',
        code: 'custom',
      },
      { path: 'gating.itemCount', message: '门控题量 5 超过关卡总题量 1', code: 'custom' },
    ]);
  });

  it('吃得下 400 的 Zod 数组 path，并 join 成点号', () => {
    // Zod 原生的 `error.issues`：path 是数组，还带 expected/received 等多余字段。
    const issues = toIssues([
      {
        code: 'invalid_type',
        expected: 'nonoptional',
        path: ['spec'],
        message: 'Invalid input: expected nonoptional, received undefined',
      },
      {
        code: 'unrecognized_keys',
        keys: ['tag'],
        path: ['tags', 0],
        message: 'Unrecognized key: "tag"',
      },
    ]);

    expect(issues).toEqual([
      {
        path: 'spec',
        message: 'Invalid input: expected nonoptional, received undefined',
        code: 'invalid_type',
      },
      { path: 'tags.0', message: 'Unrecognized key: "tag"', code: 'unrecognized_keys' },
    ]);
  });

  it('两种形状混在同一个数组里也能一起处理', () => {
    const issues = toIssues([
      { path: 'meta.title', message: '必填', code: 'custom' },
      { path: ['spec', 'meta', 'id'], code: 'invalid_type', message: '不是字符串' },
    ]);

    expect(issues.map((i) => i.path)).toEqual(['meta.title', 'spec.meta.id']);
  });

  it('details 是 null / undefined / 字符串 / 对象时不崩溃，退化成空列表', () => {
    // 契约里 details 是 `z.unknown()`，所以这些都合法。抛异常会把
    // 「展示错误」变成「白屏」，比不显示更糟。
    expect(toIssues(null)).toEqual([]);
    expect(toIssues(undefined)).toEqual([]);
    expect(toIssues('字段不合法')).toEqual([]);
    expect(toIssues({ message: '看起来像 issue 但是个对象' })).toEqual([]);
    expect(toIssues(42)).toEqual([]);
  });

  it('数组元素本身不是对象时跳过那一项，不拖垮整张列表', () => {
    const issues = toIssues([
      null,
      'oops',
      42,
      { path: 'meta.id', message: '必填', code: 'custom' },
      ['嵌套数组'],
    ]);

    expect(issues).toEqual([{ path: 'meta.id', message: '必填', code: 'custom' }]);
  });

  it('字段缺失或类型不对时给出可读的兜底值，而不是 undefined', () => {
    // 兜底文案是给人看的；`undefined` 渲染到 React 里是一片空白，
    // 用户会以为这条错误没有内容。
    const issues = toIssues([
      {},
      { message: 123 },
      { path: { nested: true }, message: '路径是个对象' },
      { code: 7 },
    ]);

    expect(issues).toEqual([
      { path: '', message: '未知问题', code: 'invalid' },
      { path: '', message: '未知问题', code: 'invalid' },
      { path: '', message: '路径是个对象', code: 'invalid' },
      { path: '', message: '未知问题', code: 'invalid' },
    ]);
  });
});

/**
 * 票 67：模板预览 / 保存 / 导出 / 导入。
 *
 * 这些用例都只替换 hook，不碰网络 —— 请求形状与状态码由
 * `apps/api/src/levels/levels.templates.test.ts` 与 openapi 校验覆盖。
 * 这里要钉住的是**页面在拿到这些数据之后的反应**：
 * 三档差异肉眼可见、导出交给下载层的是服务端原样返回体、
 * 导入把用户选的文件原样发出去、错误把字段路径摊开。
 */
describe('MarketPage · 关卡模板与导入导出（票 67）', () => {
  const renderMarket = (items: MarketLevelListResponseItemsItem[] = [presetLevel]) => {
    mocked.useMarketLevels.mockReturnValue(
      queryStub({ items }) as unknown as ReturnType<typeof queries.useMarketLevels>,
    );
    return renderPage(<MarketPage />);
  };

  it('列出三个模板，每个都说清几段、几题、适合谁', () => {
    renderMarket();

    // 三张模板卡都在（role=radio 是给键盘与读屏用的，不是装饰）
    const group = screen.getByRole('radiogroup', { name: '关卡模板' });
    const cards = within(group).getAllByRole('radio');
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      '教学关',
      '练习关',
      '复习关',
    ]);

    // 「几段 · 几题」是 facts 现算的，不是写死的文案
    const teaching = within(cards[0]!);
    expect(teaching.getByText(/7 段 · 4 题/)).toBeInTheDocument();
    expect(teaching.getByText(/适合谁：/)).toBeInTheDocument();
    const practice = within(cards[1]!);
    expect(practice.getByText(/2 段 · 5 题/)).toBeInTheDocument();
    const review = within(cards[2]!);
    expect(review.getByText(/2 段 · 3 题/)).toBeInTheDocument();
  });

  it('模板接口读不到时给解释，而不是空白区', () => {
    mocked.useLevelTemplates.mockReturnValue({
      ...queryStub(undefined),
      isError: true,
      error: new Error('模板接口挂了'),
    } as unknown as ReturnType<typeof queries.useLevelTemplates>);
    renderMarket();

    expect(screen.getByText(/无法读取关卡模板：模板接口挂了/)).toBeInTheDocument();
  });

  it('选模板 + 填知识点 + 点预览，把三档差异摊开', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn(
      (
        vars: { templateId: string; request: { microKpId: string; tier: string } },
        handlers?: { onSuccess?: (data: ReturnType<typeof makePreview>) => void },
      ) => {
        handlers?.onSuccess?.(makePreview(vars.request.tier as 'P1' | 'P2' | 'P3'));
      },
    );
    mocked.usePreviewLevelTemplate.mockReturnValue({ ...mutationStub(), mutate } as unknown as ReturnType<
      typeof queries.usePreviewLevelTemplate
    >);
    renderMarket();

    await user.click(screen.getByRole('radio', { name: '教学关' }));
    await user.type(screen.getByLabelText('模板预览的知识点 id'), 'kp-bool');
    await user.click(screen.getByRole('button', { name: '预览' }));

    // 请求带的是选中的模板 + 知识点 + 默认档位
    expect(mutate).toHaveBeenCalledWith(
      { templateId: 'teaching', request: { microKpId: 'kp-bool', tier: 'P1' } },
      expect.anything(),
    );

    // 预览卡：段数、题数、未落库、首屏形态
    expect(await screen.findByText('7 段')).toBeInTheDocument();
    expect(screen.getByText('未落库')).toBeInTheDocument();
    expect(screen.getByText(/首屏先看讲解/)).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: '预览的段' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(7);
  });

  it('没选模板或没填知识点时「预览」是禁用的', async () => {
    const user = userEvent.setup();
    renderMarket();
    const preview = screen.getByRole('button', { name: '预览' });
    expect(preview).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: '练习关' }));
    expect(preview).toBeDisabled(); // 还差知识点

    await user.type(screen.getByLabelText('模板预览的知识点 id'), 'kp-bool');
    expect(preview).toBeEnabled();
  });

  it('保存把预览草稿原样交给 save，并把 levelId 回显', async () => {
    const user = userEvent.setup();
    const previewMutate = vi.fn(
      (
        _vars: unknown,
        handlers?: { onSuccess?: (data: ReturnType<typeof makePreview>) => void },
      ) => {
        handlers?.onSuccess?.(makePreview('P2'));
      },
    );
    mocked.usePreviewLevelTemplate.mockReturnValue({
      ...mutationStub(),
      mutate: previewMutate,
    } as unknown as ReturnType<typeof queries.usePreviewLevelTemplate>);

    const saveMutate = vi.fn(
      (_spec: unknown, handlers?: { onSuccess?: (data: MarketSaveLevelResponse) => void }) => {
        handlers?.onSuccess?.({
          created: true,
          level: {
            levelId: 'kp-bool--teaching--P2',
            microKpId: 'kp-bool',
            microKpName: '布尔代数基本运算',
            title: '布尔代数基本运算（教学关）',
            kind: 'teach',
            author: 'system',
            itemCount: 3,
            savedAt: null,
            tags: [],
            origin: 'saved',
          },
        });
      },
    );
    mocked.useSaveMarketLevel.mockReturnValue({
      ...mutationStub(),
      mutate: saveMutate,
    } as unknown as ReturnType<typeof queries.useSaveMarketLevel>);

    renderMarket();
    await user.click(screen.getByRole('radio', { name: '教学关' }));
    await user.type(screen.getByLabelText('模板预览的知识点 id'), 'kp-bool');
    await user.click(screen.getByRole('button', { name: '预览' }));
    await screen.findByText('6 段');

    await user.click(screen.getByRole('button', { name: '保存为我的关卡' }));

    // 交给 save 的是**预览里那份 spec**，不是重新构造的一份
    const [requestArg] = saveMutate.mock.calls[0]!;
    expect((requestArg as { spec: { meta: { id: string } } }).spec.meta.id).toBe(
      'kp-bool--teaching--P2',
    );
    expect(await screen.findByText(/已保存成新关卡：kp-bool--teaching--P2/)).toBeInTheDocument();
  });

  it('保存被服务端拒时把字段路径摊开', async () => {
    const user = userEvent.setup();
    mocked.usePreviewLevelTemplate.mockReturnValue({
      ...mutationStub(),
      mutate: vi.fn((_v: unknown, h?: { onSuccess?: (d: unknown) => void }) => {
        h?.onSuccess?.(makePreview('P1'));
      }),
    } as unknown as ReturnType<typeof queries.usePreviewLevelTemplate>);

    const error = new ApiClientError(422, 'VALIDATION_FAILED', '关卡规范校验不通过（1 处），未写入关卡库', [
      { path: 'steps.0.itemIds.0', message: '步骤 s-guide 引用了不存在的题目 i-x', code: 'invalid' },
    ]);
    mocked.useSaveMarketLevel.mockReturnValue({
      ...mutationStub(),
      error,
    } as unknown as ReturnType<typeof queries.useSaveMarketLevel>);

    renderMarket();
    await user.click(screen.getByRole('radio', { name: '教学关' }));
    await user.type(screen.getByLabelText('模板预览的知识点 id'), 'kp-bool');
    await user.click(screen.getByRole('button', { name: '预览' }));
    await screen.findByText('7 段');

    expect(screen.getByText(/保存失败：/)).toBeInTheDocument();
    // 字段级路径必须出现 —— 只说「保存失败」等于让用户自己猜
    expect(screen.getByText(/steps\.0\.itemIds\.0/)).toBeInTheDocument();
  });

  it('每张关卡卡都有「导出」，点了把服务端返回体原样交给下载层', async () => {
    const user = userEvent.setup();
    const exported: unknown[] = [];
    const spy = vi
      .spyOn(downloadModule, 'downloadLevelFile')
      .mockImplementation((file) => {
        exported.push(file);
      });

    const file = {
      format: 'starmap.level/1' as const,
      exportedAt: '2026-10-22T10:00:00.000Z',
      source: { title: '康华光·电子技术基础（数字部分）第5版', page: 34 },
      spec: { ...makeDraftSpec(), meta: { ...makeDraftSpec().meta, id: 'lv-bool-laws' } },
      items: makeDraftSpec().items,
    };
    const mutate = vi.fn((_id: string, handlers?: { onSuccess?: (data: typeof file) => void }) => {
      handlers?.onSuccess?.(file);
    });
    mocked.useExportLevel.mockReturnValue({ ...mutationStub(), mutate } as unknown as ReturnType<
      typeof queries.useExportLevel
    >);

    renderMarket();
    await user.click(screen.getByRole('button', { name: '导出' }));

    expect(mutate).toHaveBeenCalledWith('lv-bool-laws', expect.anything());
    // 交给下载层的是**同一个对象**，中间没有加工 —— 加工会破坏往返一致
    expect(exported).toHaveLength(1);
    expect(exported[0]).toBe(file);
    spy.mockRestore();
  });

  it('导出失败时给可读错误，不静默', async () => {
    const user = userEvent.setup();
    // 页面把错误存在本地 state 里（mutation 的 error 只在下次 mutate 前清掉，
    // 而导出是「点了才知道」的动作），所以这里走 onError 回调而不是塞 error 字段。
    const mutate = vi.fn((_id: string, handlers?: { onError?: (error: unknown) => void }) => {
      handlers?.onError?.(new ApiClientError(404, 'NOT_FOUND', '关卡不存在: lv-bool-laws'));
    });
    mocked.useExportLevel.mockReturnValue({ ...mutationStub(), mutate } as unknown as ReturnType<
      typeof queries.useExportLevel
    >);
    renderMarket();

    await user.click(screen.getByRole('button', { name: '导出' }));
    expect(await screen.findByText(/导出失败：关卡不存在: lv-bool-laws/)).toBeInTheDocument();
  });

  it('选文件后把解析出的 JSON 原样发给导入接口，成功后回显 levelId', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn(
      (_file: unknown, handlers?: { onSuccess?: (data: { created: boolean; levelId: string; itemCount: number; shareHash: string }) => void }) => {
        handlers?.onSuccess?.({
          created: true,
          levelId: 'lv-import-abc123def456',
          itemCount: 2,
          shareHash: 'abc123def456789',
        });
      },
    );
    mocked.useImportLevel.mockReturnValue({ ...mutationStub(), mutate } as unknown as ReturnType<
      typeof queries.useImportLevel
    >);

    renderMarket();
    const payload = {
      format: 'starmap.level/1',
      exportedAt: '2026-10-22T10:00:00.000Z',
      source: { title: '康华光', page: 34 },
      spec: makeDraftSpec(),
      items: makeDraftSpec().items,
    };
    const file = new File([JSON.stringify(payload)], 'lv-bool-laws__kp-bool.level.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('选择关卡文件'), file);

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    // 原样透传：不做规范化、不重排字段
    expect(mutate.mock.calls[0]![0]).toEqual(payload);
    expect(await screen.findByText(/导入成功/)).toBeInTheDocument();
    expect(screen.getByText('lv-import-abc123def456')).toBeInTheDocument();
  });

  it('选了非 JSON 文件时本地就给出人话，不发请求', async () => {
    // `applyAccept: false` 是必须的：file input 上有 accept=".json,application/json"，
    // userEvent 默认会照着它过滤掉 .html 文件，于是这个用例会「通过」但什么都没测到。
    const user = userEvent.setup({ applyAccept: false });
    const mutate = vi.fn();
    mocked.useImportLevel.mockReturnValue({ ...mutationStub(), mutate } as unknown as ReturnType<
      typeof queries.useImportLevel
    >);

    renderMarket();
    const file = new File(['<html>不是 JSON</html>'], 'page.html', { type: 'text/html' });
    await user.upload(screen.getByLabelText('选择关卡文件'), file);

    expect(await screen.findByText(/这个文件不是 JSON/)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('导入被服务端拒时把字段路径摊开', () => {
    mocked.useImportLevel.mockReturnValue({
      ...mutationStub(),
      error: new ApiClientError(422, 'VALIDATION_FAILED', '关卡规范校验不通过（1 处）', [
        { path: 'steps.2.itemIds.0', message: '步骤 s-quiz 引用了不存在的题目 i-q9', code: 'invalid' },
      ]),
    } as unknown as ReturnType<typeof queries.useImportLevel>);

    renderMarket();
    expect(screen.getByText(/导入被拒/)).toBeInTheDocument();
    expect(screen.getByText(/steps\.2\.itemIds\.0/)).toBeInTheDocument();
  });

  it('导入同一份文件第二次时说明复用了上次那张关卡', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn(
      (
        _file: unknown,
        handlers?: { onSuccess?: (data: { created: boolean; levelId: string; itemCount: number; shareHash: string }) => void },
      ) => {
        handlers?.onSuccess?.({
          created: false,
          levelId: 'lv-import-abc123def456',
          itemCount: 2,
          shareHash: 'abc123',
        });
      },
    );
    mocked.useImportLevel.mockReturnValue({ ...mutationStub(), mutate } as unknown as ReturnType<
      typeof queries.useImportLevel
    >);

    renderMarket();
    const payload = {
      format: 'starmap.level/1',
      exportedAt: '2026-10-22T10:00:00.000Z',
      source: { title: '康华光', page: 34 },
      spec: makeDraftSpec(),
      items: makeDraftSpec().items,
    };
    await user.upload(
      screen.getByLabelText('选择关卡文件'),
      new File([JSON.stringify(payload)], 'again.level.json', { type: 'application/json' }),
    );

    expect(await screen.findByText(/这份文件之前导入过/)).toBeInTheDocument();
    expect(screen.getByText(/不会重复堆一份/)).toBeInTheDocument();
  });
});

describe('downloadLevelFile（票 67 验收④）', () => {
  it('写出的文件名带关卡名与知识点，且清掉非法字符', async () => {
    const { exportFileName } = await import('../api/queries/levels');
    // 夹具是手写的字面量，kind/pool 是宽 string；这里只关心文件名，
    // 不打算为了取一个文件名去构造完整契约类型，所以显式窄化一次。
    const file = {
      format: 'starmap.level/1' as const,
      exportedAt: '2026-10-22T10:00:00.000Z',
      source: { title: 'x', page: null },
      spec: { ...makeDraftSpec(), meta: { ...makeDraftSpec().meta, title: 'A/B: 吸收律?', microKpId: 'kp-bool' } },
      items: makeDraftSpec().items,
    } as unknown as LevelExportFile;
    expect(exportFileName(file)).toBe('A_B_ 吸收律___kp-bool.level.json');
  });
});
