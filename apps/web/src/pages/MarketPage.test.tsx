import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import type {
  MarketDraftResponse,
  MarketLevelListResponseItemsItem,
  MarketSaveLevelResponse,
} from '../api/generated/model';
import { MarketPage } from './MarketPage';
import { MarketAuthorPage, toIssues } from './MarketAuthorPage';
import * as queries from '../api/queries';

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
