import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
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
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

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
});
