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
 */
vi.mock('../api/queries', () => ({
  useNodeDetail: vi.fn(),
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

const mockDetail = (overrides: Record<string, unknown> = {}) => {
  vi.mocked(queries.useNodeDetail).mockReturnValue({
    isPending: false,
    isError: false,
    payload: {
      node: { microKpId: 'kp-bool', name: '布尔代数基本运算', state: 'familiar', percent: 0.66, depth: 1 },
      levels: [
        { levelId: 'lv-1', microKpId: 'kp-bool', title: '布尔代数的三条基本律', itemCount: 1, kind: 'teach' },
      ],
      reasons: ['已建立基础，还没有稳定，适合做变式练习。'],
    },
    ...overrides,
  } as never);
};

describe('NodeDetailPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('有证据时显示百分比', () => {
    mockDetail();
    renderPage();
    expect(screen.getByText('66%')).toBeInTheDocument();
    expect(screen.getByText('布尔代数基本运算')).toBeInTheDocument();
  });

  it('证据不足时显示「证据不足」而不是 0% —— 两者含义完全不同', () => {
    mockDetail({
      payload: {
        node: { microKpId: 'kp-kmap', name: '卡诺图化简', state: 'unseen', percent: null, depth: 1 },
        levels: [],
        reasons: [],
      },
    });
    renderPage('kp-kmap');
    expect(screen.getByText('证据不足')).toBeInTheDocument();
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
    mockDetail({
      payload: {
        node: { microKpId: 'kp-x', name: '空节点', state: 'unseen', percent: null, depth: 2 },
        levels: [],
        reasons: [],
      },
    });
    renderPage('kp-x');
    expect(screen.getByText(/还没有关卡/)).toBeInTheDocument();
  });

  it('加载失败时显示错误信息而不是白屏', () => {
    vi.mocked(queries.useNodeDetail).mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('网络断了'),
      payload: undefined,
    } as never);
    renderPage();
    expect(screen.getByText(/网络断了/)).toBeInTheDocument();
  });
});
