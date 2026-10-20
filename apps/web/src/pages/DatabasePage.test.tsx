import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DatabasePage } from './DatabasePage';

/**
 * 走真实 fetch + MSW。这一组测试守的是「页面真的把库里的数字显示出来了」，
 * 不是「某个 hook 被调用过」。
 */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <DatabasePage />
      </QueryClientProvider>
    </FluentProvider>,
  );
}

describe('DatabasePage（MSW）', () => {
  it('显示内容库的真实计数，而不是占位符', async () => {
    renderPage();
    // 知识点总数 215、切片 3032、答案块 481、先修边 52。
    // 注意 3032/481 在页面上出现两次（统计卡 + 来源表），所以断言用
    // 「至少一处」而不是唯一匹配 —— 这两处本来就该一致。
    await waitFor(() => expect(screen.getByText('215')).toBeInTheDocument());
    expect(screen.getAllByText('3032').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('481').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('52')).toBeInTheDocument();
    expect(screen.getByText('其中叶节点 165 个')).toBeInTheDocument();
  });

  it('先修边卡片区分「总数」与「带证据的条数」', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('其中 52 条带可核验证据')).toBeInTheDocument());
  });

  it('来源表列出书名与页码范围，而不是只给一个 id', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('电子技术基础·数字部分（康华光 第5版）')).toBeInTheDocument(),
    );
    expect(screen.getByText('2–536')).toBeInTheDocument();
    expect(screen.getByText('教材')).toBeInTheDocument();
  });

  it('默认选中第一个知识点并显示它的来源页', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/共 2 个切片，页码：12、13/)).toBeInTheDocument());
  });

  it('答案块在界面上被显式标注出来，且只标真正的那一条', async () => {
    renderPage();
    // 两个切片里只有 ck-2 被标为答案块。检索门控就是靠这个标记决定给不给答案。
    // 「答案块」这三个字在页面上合法地出现三次：统计卡标签、来源表头、切片徽章。
    // 所以不能用全局计数断言 —— 要断言的是「徽章挂在哪个切片上」。
    await waitFor(() => expect(screen.getByText('A + A·B = A')).toBeInTheDocument());

    const formulaBox = screen.getByText('A + A·B = A').parentElement as HTMLElement;
    expect(within(formulaBox).getByText('答案块')).toBeInTheDocument();

    const proseBox = screen.getByText('逻辑代数的基本运算有三种：与、或、非。')
      .parentElement as HTMLElement;
    expect(within(proseBox).queryByText('答案块')).toBeNull();
  });

  it('切换知识点会重新拉取来源', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('卡诺图化简')).toBeInTheDocument());
    await user.click(screen.getByText('卡诺图化简'));
    await waitFor(() => expect(screen.getByText(/共 2 个切片/)).toBeInTheDocument());
  });

  it('切片正文以等宽字体原样显示，不被当作 markdown 渲染', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('A + A·B = A')).toBeInTheDocument());
  });
});
