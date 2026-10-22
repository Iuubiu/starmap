import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import { http, HttpResponse } from 'msw';
import { MePage } from './MePage';
import { server } from '../test/msw';

/**
 * 票 78 在「我的」页这一侧的验收。
 *
 * ## 重点在「只改该字段」
 *
 * 「改」很容易退化成「读出整份画像、改一个字段、整份 PUT 回去」—— 界面
 * 看起来完全正确，但两个标签页同时改不同字段时会互相覆盖。所以这里断言的是
 * **PATCH 请求体只含一个键**，而不是「界面显示变了」。
 */

const profile = {
  background: 'graduate',
  mathLevel: 'solid',
  goal: 'exam',
  weeklyHours: 4,
  explanationDensity: 'balanced',
  priorCourses: ['电路分析', '信号与系统'],
};

function stubBoard() {
  server.use(
    http.get('*/api/v1/mastery/board', () =>
      HttpResponse.json({
        evaluatedAt: '2026-10-22T00:00:00.000Z',
        knowledgePoints: {
          total: 3085,
          mastered: 1,
          learning: 1,
          untouched: 3083,
          byState: [
            { state: 'mastered', count: 1 },
            { state: 'proficient', count: 0 },
            { state: 'familiar', count: 0 },
            { state: 'attempted', count: 1 },
            { state: 'unseen', count: 3083 },
          ],
        },
        layers: [
          { id: 'nuclear-electronics', name: '核电子学', ordinal: 50, total: 202, mastered: 1 },
        ],
        books: [{ id: 'jichangsong', title: '核辐射探测器及其实验技术手册', enabled: true, total: 390, learned: 2 }],
        unlayeredLeafCount: 1054,
      }),
    ),
  );
}

function stubProfile(initial: Record<string, unknown> = profile) {
  const saved: Record<string, unknown>[] = [];
  let current = { ...initial };
  const answered = () => Object.values(current).filter((v) => v !== null).length;
  stubBoard();
  server.use(
    http.get('*/api/v1/profile', () => HttpResponse.json({ profile: current, updatedAt: null, answeredCount: answered() })),
    http.patch('*/api/v1/profile', async ({ request }) => {
      const patch = (await request.json()) as Record<string, unknown>;
      saved.push(patch);
      current = { ...current, ...patch };
      return HttpResponse.json({ profile: current, updatedAt: '2026-10-22T00:00:00.000Z', answeredCount: answered() });
    }),
  );
  return saved;
}

const renderMe = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/me']}>
          <Routes>
            <Route path="/me" element={<MePage />} />
            <Route path="/welcome" element={<div>欢迎页占位</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('画像卡', () => {
  it('逐字段显示画像，跳过的字段显示「未填写」而不是默认值', async () => {
    stubProfile({ ...profile, weeklyHours: null, goal: null });
    renderMe();

    const card = await screen.findByRole('region', { name: '学习者画像' });
    expect(within(card).getByText('研究生在读')).toBeInTheDocument();
    expect(within(card).getByText('电路分析、信号与系统')).toBeInTheDocument();
    // 两个跳过的字段都显示「未填写」，共两处。
    expect(within(card).getAllByText('未填写')).toHaveLength(2);
    expect(within(card).getByText(/已填 4\/6 项/)).toBeInTheDocument();
  });

  it('右侧是真的个人看板（票 80），占位已经撤掉', async () => {
    stubProfile();
    renderMe();
    const board = await screen.findByRole('region', { name: '个人看板' });
    // 占位必须消失：留着 `data-placeholder="dashboard"` 就说明没真接上。
    expect(board.querySelector('[data-placeholder="dashboard"]')).toBeNull();
    // 看板是异步取数：等它的总进度块出现，再断言分母。
    const total = await within(board).findByRole('region', { name: '总进度' });
    expect(within(total).getByText(/已掌握 1 \/ 3085/)).toBeInTheDocument();
  });
});

describe('改单题只改该字段', () => {
  it('改「学习目标」只发 { goal: ... }，其它字段不进入请求体', async () => {
    const saved = stubProfile();
    renderMe();
    const user = userEvent.setup();

    const card = await screen.findByRole('region', { name: '学习者画像' });
    const goalRow = within(card).getByText('学习目标').closest('div')!;
    await user.click(within(goalRow).getByRole('button', { name: '改' }));

    // 重新问的是目标那一题。
    expect(await screen.findByText('这段时间学它，主要是为了什么？')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /科研需要/ }));
    await user.click(screen.getByRole('button', { name: '只改这一项' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ goal: 'research' });
    // 回到画像卡，其它字段原封不动。
    const after = await screen.findByRole('region', { name: '学习者画像' });
    expect(within(after).getByText('科研需要')).toBeInTheDocument();
    expect(within(after).getByText('每周 4 小时')).toBeInTheDocument();
    expect(within(after).getByText('能补一步')).toBeInTheDocument(); // mathLevel: 'solid' 的界面值
  });

  it('改「每周可投入」发的是数字而不是选项字符串', async () => {
    const saved = stubProfile();
    renderMe();
    const user = userEvent.setup();

    const card = await screen.findByRole('region', { name: '学习者画像' });
    const row = within(card).getByText('每周可投入').closest('div')!;
    await user.click(within(row).getByRole('button', { name: '改' }));
    await user.click(await screen.findByRole('button', { name: /6–10 小时/ }));
    await user.click(screen.getByRole('button', { name: '只改这一项' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ weeklyHours: 8 });
  });
});
