import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter } from 'react-router';
import { MapPage } from './MapPage';
import * as queries from '../api/queries';
import type { GraphResponse } from '../api/generated/model';

/**
 * 地图页的**渲染决策**测试（mock 掉 query hook）。
 *
 * 画布本身归 Playwright（jsdom 没有 WebGL，`new Sigma()` 起不来，见
 * `test/setup.ts` 的说明）。这里测的是页面在拿到 payload 之后怎么排版：
 *
 * 1. 内容缺口区（票 18 AC5）到底渲染了没有、渲染了几条；
 * 2. 它**没有**被塞进画布容器 —— 缺口不是图上的节点。
 *
 * 第 2 条用 `within(canvasContainer).queryByText(...)` 为 null 来断言。
 * 这种「断言不在某处」的写法容易写空（容器选择器写错时永远为 null，测试
 * 恒绿），所以同时断言那个容器**确实存在**且里面有画布内容 —— 否则这条
 * 用例只是在测 `document.querySelector` 返回 null。
 */
vi.mock('../api/queries', () => ({
  useGraph: vi.fn(),
}));

const mocked = vi.mocked(queries);

/** 两个节点的最小图。`kp-bool` 有证据，`kp-kmap` 证据不足（percent=null）。 */
const graphPayload = (overrides: Partial<GraphResponse> = {}): GraphResponse => ({
  nodes: [
    {
      microKpId: 'kp-bool',
      name: '布尔代数基本运算',
      state: 'familiar',
      percent: 0.66,
      depth: 1,
      moduleId: 'm-digital',
      moduleName: '数字逻辑',
      moduleOrdinal: 1,
      ordinal: 1,
      reviewDueAt: null,
    },
    {
      microKpId: 'kp-kmap',
      name: '卡诺图化简',
      state: 'unseen',
      percent: null,
      depth: 1,
      moduleId: 'm-digital',
      moduleName: '数字逻辑',
      moduleOrdinal: 1,
      ordinal: 2,
      reviewDueAt: null,
    },
  ],
  edges: [{ from: 'kp-bool', to: 'kp-kmap', kind: 'prereq' }],
  recommendedIds: ['kp-bool'],
  contentGaps: [],
  ...overrides,
});

const gap = (id: string, topic: string, nearestKpIds: string[]) => ({
  id,
  topic,
  reason: `${topic}的对口教材在资源库里不存在。`,
  expectedRole: 'advanced' as const,
  nearestKpIds,
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/map']}>
          <MapPage />
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

beforeEach(() => {
  mocked.useGraph.mockReturnValue({
    payload: graphPayload(),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof queries.useGraph>);
});

describe('地图页 · 内容缺口（票 18 AC5）', () => {
  it('有缺口时把三条 topic 都渲染出来', () => {
    mocked.useGraph.mockReturnValue({
      payload: graphPayload({
        contentGaps: [
          gap('gap-digital-mca', '数字多道分析器', ['kp-bool']),
          gap('gap-fpga', 'FPGA 可编程器件', ['kp-kmap']),
          gap('gap-digital-pulse', '数字脉冲处理', ['kp-bool']),
        ],
      }),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useGraph>);

    renderPage();

    const section = screen.getByRole('region', { name: '内容缺口' });
    expect(within(section).getByText('数字多道分析器')).toBeInTheDocument();
    expect(within(section).getByText('FPGA 可编程器件')).toBeInTheDocument();
    expect(within(section).getByText('数字脉冲处理')).toBeInTheDocument();
  });

  /**
   * 缺口区不能画在画布容器里。
   *
   * 票 18 AC5 只要求「在图上可见」，但把它塞进 `.graph-canvas` 会让 sigma
   * 的容器里出现非节点内容 —— 4441 个节点下布局与状态着色都会被这一块挤
   * 变形，而且画布的 `aria-hidden` 会把它一起藏掉。所以位置也是验收面。
   */
  it('缺口区不在画布容器内', () => {
    mocked.useGraph.mockReturnValue({
      payload: graphPayload({ contentGaps: [gap('gap-fpga', 'FPGA 可编程器件', ['kp-bool'])] }),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useGraph>);

    renderPage();

    const canvas = document.querySelector('.graph-canvas');
    // 容器必须真的存在 —— 否则下面的 `queryByText` 恒为 null，用例测的是空气。
    expect(canvas).not.toBeNull();
    expect(within(canvas as HTMLElement).queryByText('FPGA 可编程器件')).toBeNull();

    // 但它必须在页面上某处可见（不是被上面的断言顺手排除掉了）
    expect(screen.getByText('FPGA 可编程器件')).toBeInTheDocument();
  });

  it('缺口为空数组时不渲染这一块（资源库补齐后的正常终态）', () => {
    renderPage();
    expect(screen.queryByRole('region', { name: '内容缺口' })).toBeNull();
  });

  /**
   * `nearestKpIds` 指向已经不在图里的知识点时，缺口照常显示但没有跳转按钮。
   *
   * 这是重导入后的真实场景（迁移按名字解析 id，重新入库后 id 会漂移）。
   * 如果实现改成「解析不到就过滤掉整条缺口」，「这里缺内容」会随一次内容
   * 更新静默消失 —— 恰恰是最需要它出现的时刻。
   */
  it('nearestKpIds 全部失效时仍显示缺口，只是不给跳转', () => {
    mocked.useGraph.mockReturnValue({
      payload: graphPayload({
        contentGaps: [gap('gap-digital-pulse', '数字脉冲处理', ['kp-gone', 'kp-also-gone'])],
      }),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useGraph>);

    renderPage();

    const section = screen.getByRole('region', { name: '内容缺口' });
    expect(within(section).getByText('数字脉冲处理')).toBeInTheDocument();
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('第一个可用的 nearestKpIds 做成跳转入口', async () => {
    mocked.useGraph.mockReturnValue({
      payload: graphPayload({
        // 第一个失效、第二个有效：要跳过失效的那个
        contentGaps: [gap('gap-digital-mca', '数字多道分析器', ['kp-gone', 'kp-kmap'])],
      }),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof queries.useGraph>);

    renderPage();

    const section = screen.getByRole('region', { name: '内容缺口' });
    const button = within(section).getByRole('button', { name: '从最接近的知识点看起' });
    expect(button).toHaveAttribute('data-content-gap-nearest', 'kp-kmap');
    // 点得动（不验证导航目标 —— 路由在 MapPage 之外，这里只验证按钮真的接了回调）
    await userEvent.click(button);
  });
});
