import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router';
import { NodeDetailPage } from './NodeDetailPage';
import * as queries from '../api/queries';

/**
 * 组件测试用 MSW 太重的场景，直接替换 query hook。
 *
 * 这样做的取舍：不验证「请求怎么发」，只验证「拿到这个响应后页面长什么样」。
 * 请求本身由 API 集成测试与契约测试覆盖；页面测试关心的是**渲染决策**，
 * 尤其是「证据不足 ≠ 0%」这类会误导学习者的显示。
 *
 * ⚠️ `vi.mock` 的工厂是**全量替换**：工厂里没列出的导出全部变成 undefined。
 * 所以页面每多 import 一个 hook，这里必须同步加一行，否则报的是
 * `No "useMastery" export is defined on the "../api/queries" mock` ——
 * 那条报错读起来像「实现写错了」，实际是「mock 没列全」。
 */
vi.mock('../api/queries', () => ({
  useNodeDetail: vi.fn(),
  useMastery: vi.fn(),
  useNodeUnlock: vi.fn(),
  useNodeList: vi.fn(),
  useHealth: vi.fn(),
}));

const renderPage = (id = 'kp-bool') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/map/${id}`]}>
          <Routes>
            <Route path="/map/:microKpId" element={<NodeDetailPage />} />
            {/**
             * 首页占位：把地址栏里的 `kp` 参数显示出来。
             *
             * 「问助手」要证明的不是「点了一个按钮」，而是**把这个页面的
             * 知识点真的带到了首页**。所以占位组件读的是真实的路由参数，
             * 而不是断言某个内部状态。
             */}
            <Route
              path="/"
              element={<HomeFocusProbe />}
            />
            {/**
             * 生成页占位：读 `microKpIds`。证明的是「知识点 id 真的进了
             * 生成页的预填参数」，不是「点了按钮」。跳转目标写死在页面里，
             * 这里只观察参数。
             */}
            <Route path="/market/generate" element={<GenerationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

function GenerationProbe() {
  const [params] = useSearchParams();
  return <div>生成页预填：{params.get('microKpIds') ?? '无'}</div>;
}

function HomeFocusProbe() {
  const [params] = useSearchParams();
  return <div>首页焦点：{params.get('kp') ?? '无'}</div>;
}

/**
 * 掌握度的默认样本：证据充足，`achieved` 高于 `current`。
 *
 * 两个 hook 的数值刻意**自洽**（`node.percent` 与 `mastery.current` 都是 0.66），
 * 否则「有证据时显示百分比」可能因为页面读了另一个源而显示错的值却依然绿。
 * 「页面到底读哪个源」由下面两条**故意让两者不一致**的用例来钉。
 */
const nodePayload = (overrides: Record<string, unknown> = {}) => ({
  node: { microKpId: 'kp-bool', name: '布尔代数基本运算', state: 'familiar', percent: 0.66, depth: 1 },
  levels: [
    { levelId: 'lv-1', microKpId: 'kp-bool', title: '布尔代数的三条基本律', itemCount: 1, kind: 'teach' },
  ],
  reasons: ['已建立基础，还没有稳定，适合做变式练习。'],
  // 票 18 验收 6：默认给一个有来源的样本。`kp-bool` 在真实库里是示例知识点
  // （source 为 null），但默认桩刻意不沿用那个事实 —— 否则「有来源时渲染页码」
  // 这条永远走不到，而它才是这个功能的主体。无来源那条单独覆盖。
  source: {
    sourceId: 'knoll-4e-2010',
    title: '辐射探测与测量（Knoll 第4版 2010）',
    page: 12,
    pageLabel: '「辐射探测与测量（Knoll 第4版 2010）」第 12 页',
  },
  ...overrides,
});

const masteryView = (overrides: Record<string, unknown> = {}) => ({
  microKpId: 'kp-bool',
  name: '布尔代数基本运算',
  isLeaf: true,
  state: 'familiar',
  achieved: 0.72,
  current: 0.66,
  attemptCount: 12,
  variantCount: 3,
  evidenceSufficient: true,
  halfLifeDays: 30,
  lastEvidenceAt: '2026-10-19T00:00:00.000Z',
  aggregatedLeafCount: 0,
  ...overrides,
});

const mockNode = (overrides: Record<string, unknown> = {}) => {
  vi.mocked(queries.useNodeDetail).mockReturnValue({
    isPending: false,
    isError: false,
    payload: nodePayload(),
    ...overrides,
  } as never);
};

const mockMastery = (overrides: Record<string, unknown> = {}) => {
  vi.mocked(queries.useMastery).mockReturnValue({
    isPending: false,
    isError: false,
    payload: masteryView(),
    ...overrides,
  } as never);
};

/** 默认已解锁：多数用例不关心锁，只关心掌握度与关卡列表。 */
const mockUnlock = (overrides: Record<string, unknown> = {}) => {
  vi.mocked(queries.useNodeUnlock).mockReturnValue({
    isPending: false,
    isError: false,
    payload: { microKpId: 'kp-bool', unlocked: true, blockers: [] },
    ...overrides,
  } as never);
};

/** 常规页面：节点与掌握度都取到，数值自洽。 */
const mockDetail = () => {
  mockNode();
  mockMastery();
  mockUnlock();
};

describe('NodeDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlock();
  });

  it('双字段都显示具体百分比：历史最高不衰减、当前熟练度会衰减', () => {
    mockDetail();
    renderPage();

    expect(screen.getByText('历史最高（不回落，用于解锁）')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('当前熟练度（会随时间回落，用于推荐）')).toBeInTheDocument();
    expect(screen.getByText('66%')).toBeInTheDocument();
    expect(screen.getByText('布尔代数基本运算')).toBeInTheDocument();
  });

  it('证据不足时显示「证据不足」而不是 0% —— 两者含义完全不同', () => {
    mockNode({
      payload: nodePayload({
        node: { microKpId: 'kp-kmap', name: '卡诺图化简', state: 'unseen', percent: null, depth: 1 },
        levels: [],
        reasons: [],
      }),
    });
    mockMastery({
      payload: masteryView({
        microKpId: 'kp-kmap',
        name: '卡诺图化简',
        state: 'unseen',
        achieved: null,
        current: null,
        attemptCount: 2,
        variantCount: 1,
        evidenceSufficient: false,
      }),
    });
    renderPage('kp-kmap');

    expect(screen.getByText('证据不足')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    // 还得说清「差的不是分数，是样本」，否则「证据不足」只是一句没用的驳回。
    expect(screen.getByText(/还差再 6 次作答、再 2 个不同变式/)).toBeInTheDocument();
  });

  it('掌握度以 mastery 接口为准：节点里那份旧快照不会冒充掌握度', () => {
    // 节点详情里 percent 仍是 0.66（上一次作答那刻写下的值），但 mastery 接口
    // 重放证据后认定证据不足。页面必须听后者的 —— 否则用户看到的是一个
    // 「几天前算出来的数」，而它此刻没有任何依据。
    mockNode();
    mockMastery({
      payload: masteryView({
        achieved: null,
        current: null,
        attemptCount: 3,
        variantCount: 2,
        evidenceSufficient: false,
      }),
    });
    renderPage();

    expect(screen.getByText('证据不足')).toBeInTheDocument();
    expect(screen.queryByText('66%')).not.toBeInTheDocument();
  });

  it('节点快照缺失但 mastery 有数时照常显示百分比（真源是 mastery）', () => {
    mockNode({
      payload: nodePayload({
        node: { microKpId: 'kp-bool', name: '布尔代数基本运算', state: 'unseen', percent: null, depth: 1 },
      }),
    });
    mockMastery();
    renderPage();

    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('66%')).toBeInTheDocument();
    expect(screen.queryByText('证据不足')).not.toBeInTheDocument();
  });

  it('掌握度还没取到时给出「正在算」而不是 0%', () => {
    mockNode();
    vi.mocked(queries.useMastery).mockReturnValue({
      isPending: true,
      isError: false,
      payload: undefined,
    } as never);
    renderPage();

    expect(screen.getByText(/掌握度还没算出来/)).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('关卡类型显示中文标签而不是枚举值', () => {
    mockDetail();
    renderPage();
    expect(screen.getByText('教学关卡')).toBeInTheDocument();
    expect(screen.queryByText('teach')).not.toBeInTheDocument();
  });

  it('显示推荐理由，让「为什么推荐这个」可解释', () => {
    mockDetail();
    renderPage();
    expect(screen.getByText(/还没有稳定/)).toBeInTheDocument();
  });

  it('没有关卡时给出可执行的下一步提示，而不是空白', () => {
    mockNode({
      payload: nodePayload({
        node: { microKpId: 'kp-x', name: '空节点', state: 'unseen', percent: null, depth: 2 },
        levels: [],
        reasons: [],
      }),
    });
    mockMastery({
      payload: masteryView({
        microKpId: 'kp-x',
        name: '空节点',
        achieved: null,
        current: null,
        attemptCount: 0,
        variantCount: 0,
        evidenceSufficient: false,
      }),
    });
    renderPage('kp-x');
    expect(screen.getByText(/还没有关卡/)).toBeInTheDocument();
    /**
     * 反向断言：「运行内容入库（票 02）后会生成」这句是**假话** ——
     * `apps/api/scripts/import-content.ts`（673 行）从不写 `app.levels`，
     * 只有 `generation.service.ts` 与 `market.service.ts` 会写。学生照着
     * 那句话去跑内容入库，永远不会有新关卡。实测全库 5467 个叶节点只有
     * 8 个有关卡，这句话几乎对每个知识点都在误导。
     */
    expect(screen.queryByText(/运行内容入库/)).not.toBeInTheDocument();
    // 真能走通的出口：跳到生成页并预填这个知识点。
    expect(screen.getByRole('button', { name: /用 AI 给这个知识点生成关卡/ })).toBeInTheDocument();
  });

  it('「生成关卡」按钮把知识点带进生成页的 microKpIds 预填参数', async () => {
    mockNode({
      payload: nodePayload({
        node: { microKpId: 'kp-x', name: '空节点', state: 'unseen', percent: null, depth: 2 },
        levels: [],
        reasons: [],
      }),
    });
    mockMastery({
      payload: masteryView({
        microKpId: 'kp-x',
        name: '空节点',
        achieved: null,
        current: null,
        attemptCount: 0,
        variantCount: 0,
        evidenceSufficient: false,
      }),
    });
    renderPage('kp-x');
    await userEvent.click(screen.getByRole('button', { name: /用 AI 给这个知识点生成关卡/ }));
    // 断言的是「参数真的进了地址栏」，而不是「点了一个按钮」。
    expect(screen.getByText('生成页预填：kp-x')).toBeInTheDocument();
  });

  it('加载失败时显示错误信息而不是白屏', () => {
    mockMastery();
    vi.mocked(queries.useNodeDetail).mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('网络断了'),
      payload: undefined,
    } as never);
    renderPage();
    expect(screen.getByText(/网络断了/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 票 06：解锁提示（能看出「为什么还没解锁」）
  // -------------------------------------------------------------------------

  it('未解锁时讲清被哪几道门挡着、各差几题，而不是只说「进不去」', () => {
    mockDetail();
    mockUnlock({
      payload: {
        microKpId: 'kp-demorgan',
        unlocked: false,
        blockers: [
          {
            prerequisiteId: 'kp-bool',
            prerequisiteName: '布尔代数基本运算',
            levelId: 'lv-bool-laws',
            levelTitle: '逻辑代数基本律：吸收律与德摩根律',
            gateMode: 'exit',
            lastVerdict: 'failed',
            shortfall: 2,
            lastAttemptedItemIds: ['i-probe', 'i-quiz'],
          },
        ],
      },
    });
    renderPage('kp-demorgan');

    expect(screen.getByText('这个知识点还没解锁')).toBeInTheDocument();
    // 先修知识点名字会同时出现在障碍行与「去考」按钮上 —— 两处都该有。
    expect(screen.getAllByText(/布尔代数基本运算/).length).toBeGreaterThan(0);
    // 门控类型、还差几道都要说清楚
    expect(screen.getByText(/章末出口/)).toBeInTheDocument();
    expect(screen.getByText(/最近一次还差 2 道题/)).toBeInTheDocument();
    // 给一个能直接去的下一步动作，而不是让学习者自己找路
    expect(
      screen.getByRole('button', { name: /去考「布尔代数基本运算」的出口测试/ }),
    ).toBeInTheDocument();
  });

  it('从没考过先修门时说「还没考过」，而不是「还差 0 道」', () => {
    mockDetail();
    mockUnlock({
      payload: {
        microKpId: 'kp-demorgan',
        unlocked: false,
        blockers: [
          {
            prerequisiteId: 'kp-bool',
            prerequisiteName: '布尔代数基本运算',
            levelId: 'lv-bool-laws',
            levelTitle: '逻辑代数基本律',
            gateMode: 'prereq',
            lastVerdict: null,
            shortfall: null,
            lastAttemptedItemIds: [],
          },
        ],
      },
    });
    renderPage('kp-demorgan');

    expect(screen.getByText(/还没考过它的出口测试/)).toBeInTheDocument();
    expect(screen.getByText(/高入度先修/)).toBeInTheDocument();
  });

  it('已解锁时不显示任何解锁障碍', () => {
    mockDetail();
    renderPage();
    expect(screen.queryByText('这个知识点还没解锁')).not.toBeInTheDocument();
  });

  it('已解锁时每张关卡都有可点的入口（否则详情页是个死胡同）', () => {
    mockDetail();
    renderPage();
    const entry = screen.getByRole('button', { name: '开始' });
    expect(entry).toBeEnabled();
  });

  it('未解锁时入口禁用，但原因写在障碍卡里而不是只靠一个灰按钮', () => {
    mockDetail();
    mockUnlock({
      payload: {
        microKpId: 'kp-demorgan',
        unlocked: false,
        blockers: [
          {
            prerequisiteId: 'kp-bool',
            prerequisiteName: '布尔代数基本运算',
            levelId: 'lv-bool-laws',
            levelTitle: '逻辑代数基本律',
            gateMode: 'exit',
            lastVerdict: 'failed',
            shortfall: 1,
            lastAttemptedItemIds: [],
          },
        ],
      },
    });
    renderPage('kp-demorgan');

    expect(screen.getByRole('button', { name: '未解锁' })).toBeDisabled();
    expect(screen.getByText(/最近一次还差 1 道题/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 票 18 验收 6：这个知识点来自哪本书哪一页
  // -------------------------------------------------------------------------

  it('显示「来自哪本书哪一页」，用的是服务端拼好的 pageLabel', () => {
    mockDetail();
    renderPage();

    // 整句断言而不是分别断言书名与页码：分成两段的话，界面把两者拼错顺序
    // （例如「第 12 页」在前）也能绿。
    expect(
      screen.getByText('来源：「辐射探测与测量（Knoll 第4版 2010）」第 12 页'),
    ).toBeInTheDocument();
    // 反向对照：这条路径真的走到了，不是被当成无来源分支
    expect(screen.queryByText('示例知识点（无教材出处）')).not.toBeInTheDocument();
  });

  it('示例知识点（source 为 null）说明「无教材出处」，而不是省略这一行', () => {
    // 真实库里有 3 个这样的节点（kp-bool / kp-kmap / kp-logic），它们必须能
    // 被点开。省略这一行会让人以为「这个页面还没做来源功能」，而事实是
    // 「这个知识点确实不来自任何书」—— 两种「没有」含义完全不同。
    mockNode({ payload: nodePayload({ source: null }) });
    mockMastery();
    mockUnlock();
    renderPage('kp-bool');

    expect(screen.getByText('示例知识点（无教材出处）')).toBeInTheDocument();
    expect(screen.queryByText(/^来源：/)).not.toBeInTheDocument();
  });

  it('来源不是链接：本地没有 PDF 阅读器，做成链接是死链', () => {
    mockDetail();
    renderPage();

    // 正向对照：那行字确实在页面上
    expect(screen.getByText(/第 12 页/)).toBeInTheDocument();
    // 反向：它不能被包在 <a> 里。`queryByRole('link')` 查的是可访问性树，
    // 比 `closest('a')` 更接近「用户能不能点」这件事。
    expect(screen.queryByRole('link', { name: /第 12 页/ })).toBeNull();
    expect(screen.getByText(/第 12 页/).closest('a')).toBeNull();
  });

  /**
   * 「问助手」：把当前知识点带给首页的那张卡片。
   *
   * 这条入口补的是一个**真实的断头路**：地图 → 知识点详情页是终点，想把
   * 这个点变成一轮对话的起点，只能自己记住名字、回首页、重新打一遍。而
   * 首页的焦点又只能从上一张卡继承，冷启动时一张卡都没有 —— 于是「选一个
   * 知识点，然后要一张它的关卡」在界面上根本没有入口。
   */
  it('「问助手」把这个页面的知识点带到首页的 kp 参数上', async () => {
    const user = userEvent.setup();
    mockDetail();
    renderPage('kp-bool');

    await user.click(screen.getByRole('button', { name: '问助手' }));

    // 真的跳到了首页，并且带的是这个页面的点
    expect(await screen.findByText('首页焦点：kp-bool')).toBeInTheDocument();
  });

  it('「问助手」带的是当前页面的点，不是硬编码的示例点', async () => {
    const user = userEvent.setup();
    mockNode({
      payload: nodePayload({
        node: { microKpId: 'kp-kmap', name: '卡诺图化简', state: 'unseen', percent: null, depth: 1 },
      }),
    });
    mockMastery();
    mockUnlock();
    renderPage('kp-kmap');

    // 页面标题确实是那个点（否则下面断言「按钮与页面同一个点」就成了套套逻辑）
    expect(screen.getByText('卡诺图化简')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '问助手' }));

    expect(await screen.findByText('首页焦点：kp-kmap')).toBeInTheDocument();
  });
});
