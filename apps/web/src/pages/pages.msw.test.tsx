import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import { http, HttpResponse } from 'msw';
import { NodeDetailPage } from './NodeDetailPage';
import { DashboardPage } from './DashboardPage';
import { server } from '../test/msw';

/**
 * 走真实 fetch 的集成式组件测试（MSW 打桩）。
 *
 * 与 NodeDetailPage.test.tsx 的分工：那边 mock 掉 query hook，只测渲染决策；
 * 这边不 mock，请求、错误翻译、Query 状态机全部真跑。
 * 这里能抓到那边漏掉的故障：URL 拼错、错误码没映射、loading 态永远不结束。
 */
const renderWith = (ui: React.ReactNode, path = '/map/kp-bool', route = '/map/:microKpId') => {
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
};

describe('页面 × 真实请求（MSW）', () => {
  it('详情页从 API 取到数据并渲染', async () => {
    renderWith(<NodeDetailPage />);
    await waitFor(() => expect(screen.getByText('布尔代数基本运算')).toBeInTheDocument());
    expect(screen.getByText('66%')).toBeInTheDocument();
  });

  it('404 的 code 被翻译成用户能读的中文，而不是「请求失败」', async () => {
    renderWith(<NodeDetailPage />, '/map/kp-missing');
    await waitFor(() => expect(screen.getByText(/知识点不存在/)).toBeInTheDocument());
  });

  it('加载过程中先显示 loading，到达后显示内容', async () => {
    renderWith(<NodeDetailPage />);
    // 首帧是 loading；MSW 立即响应，所以只能断言「最终不是 loading」
    await waitFor(() => expect(screen.queryByText('加载知识点…')).not.toBeInTheDocument());
    expect(screen.getByText('布尔代数基本运算')).toBeInTheDocument();
  });

  it('看板页列出 API 返回的全部叶节点', async () => {
    renderWith(<DashboardPage />, '/', '/');
    await waitFor(() => expect(screen.getByText('布尔代数基本运算')).toBeInTheDocument());
    expect(screen.getByText('卡诺图化简')).toBeInTheDocument();
    // null 百分比的节点显示「证据不足」而不是 0%
    expect(screen.getByText(/证据不足/)).toBeInTheDocument();
  });

  it('接口 500 时显示错误态，不白屏也不显示旧数据', async () => {
    server.use(
      http.get('*/api/v1/nodes/:id', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '数据库连接池耗尽' }, { status: 500 }),
      ),
    );
    renderWith(<NodeDetailPage />);
    await waitFor(() => expect(screen.getByText(/数据库连接池耗尽/)).toBeInTheDocument());
  });
});
