import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  /**
   * 看板页（票 13）。
   *
   * 断言的是**验收第 2 条的字面要求**：理由里出现具体数字，而不是「根据你的
   * 学习情况」。所以直接找 `32%` 这个字符串 —— 它来自 MSW 里
   * `facts: [{type:'unblocks', current:0.32}]` 的原值。前端若把数字吞掉（渲染
   * 成「你在卡诺图化简上卡住了」而说不出多少），这条会红。
   */
  it('看板页显示今日推荐，理由里带具体百分比而不是空话', async () => {
    renderWith(<DashboardPage />, '/board', '/board');

    await waitFor(() => expect(screen.getByText('布尔代数基本运算')).toBeInTheDocument());
    // 32% 来自 unblocks 事实（另一个节点的当前掌握度）
    expect(screen.getByText('32%')).toBeInTheDocument();
    // 66% 是本节点自己的 current
    expect(screen.getByText('66%')).toBeInTheDocument();
    // 先修节点名做成可点链接（拼中文与做成链接是前端职责）
    expect(screen.getByRole('link', { name: '卡诺图化简' })).toBeInTheDocument();
    // 绝不出现空话
    expect(screen.queryByText(/根据你的学习情况/)).not.toBeInTheDocument();
  });

  it('看板页显示今日学习摘要（数字来自 API，不是本地猜）', async () => {
    renderWith(<DashboardPage />, '/board', '/board');

    await waitFor(() => expect(screen.getByText('今日学习摘要')).toBeInTheDocument());
    expect(await screen.findByText('7')).toBeInTheDocument();
  });

  /**
   * 「作答记录尚未接通」与「今天答了 0 题」必须是两句不同的话（验收第 1 条
   * 的边界，captain 的 A 裁定）。
   *
   * 判据是 `summary.available`，不是数字是否等于 0 —— 所以这里把 available
   * 置 false 但把数字留成 0，断言页面**不显示**那三个 0。
   */
  it('数据源没接通时说「尚未接通」，而不是显示 0', async () => {
    server.use(
      http.get('*/api/v1/recommendations', () =>
        HttpResponse.json({
          generatedAt: '2026-10-20T04:00:00.000Z',
          recommendations: [],
          summary: { available: false, answered: 0, knowledgePoints: 0, newlyMastered: 0 },
        }),
      ),
    );
    renderWith(<DashboardPage />, '/board', '/board');

    await waitFor(() => expect(screen.getByText(/作答记录尚未接通/)).toBeInTheDocument());
    expect(screen.queryByText('3 题')).not.toBeInTheDocument();
  });

  /**
   * 改道（验收第 3 条）：点「不学这个，换一个」→ 选一个节点 → 提交 →
   * 选择器收起。断言请求真的发出去了（MSW 收到 body），而不是只在本地把
   * 卡片藏起来。
   */
  it('拒绝推荐并改道：选一个节点后真的发出改道请求', async () => {
    const user = userEvent.setup();
    const sent: Array<{ recommended?: string; chosen?: string }> = [];
    server.use(
      http.post('*/api/v1/recommendations/redirect', async ({ request }) => {
        sent.push((await request.json()) as { recommended?: string; chosen?: string });
        return HttpResponse.json({ ok: true });
      }),
    );

    renderWith(<DashboardPage />, '/board', '/board');

    await user.click(await screen.findByRole('button', { name: '不学这个，换一个' }));
    const select = await screen.findByLabelText(/把「布尔代数基本运算」换成哪个知识点/);
    await user.selectOptions(select, 'kp-kmap');
    await user.click(screen.getByRole('button', { name: '就学这个' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ recommended: 'kp-bool', chosen: 'kp-kmap' });
    // 成功后选择器收起
    await waitFor(() =>
      expect(screen.queryByLabelText(/换成哪个知识点/)).not.toBeInTheDocument(),
    );
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
