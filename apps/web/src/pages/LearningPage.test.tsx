import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import { http, HttpResponse } from 'msw';
import { LearningPage, bucketOf, groupSessions, sessionTimeLabel } from './LearningPage';
import { server } from '../test/msw';

/**
 * 「学习记录」页（票 76 第 3 项）。
 *
 * 这一页真正容易错的三处，测试就钉这三处：
 *
 * 1. **分组边界**：23:59 与 00:01 只差两分钟却分属「昨天」和「今天」。用固定
 *    的 `now` 测纯函数，而不是在组件里靠 `vi.setSystemTime` —— 后者会让
 *    Fluent 与 React 的定时器一起跳，失败原因不可信。
 * 2. **点一条记录 = 恢复会话**：会话 id 必须写进 `starmap.session` 再跳 `/`，
 *    否则首页会开一个新会话，用户以为自己的历史丢了。
 * 3. **草稿交接**：在 `/learning` 写的第一句话要交到首页，而不是丢在导航里。
 *    交接物是 `sessionStorage['starmap.draft']`（首页取走即删）。
 */

const NOW = new Date('2026-10-22T12:00:00');

/**
 * 组件用例必须把「现在」钉住：夹具里的 session 时间写死在 2026-10-22，而
 * `LearningPage` 自己调 `new Date()`。真实时钟一旦跨过本地零点（本仓就是
 * 00:02 跑测试时红的），「今天」组里那条会整体掉到「昨天」，用例随机器时间
 * 时红时绿。只伪造 `Date`、不伪造定时器 —— React Query 与 MSW 仍用真实时钟。
 */
function pinClock() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
}

function iso(date: Date): string {
  return date.toISOString();
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function stubSessions(
  sessions: Array<{ sessionId: string; startedAt?: string; lastActivityAt?: string; firstUtterance?: string; turnCount?: number }>,
) {
  server.use(
    http.get('*/api/v1/agent/sessions', () =>
      HttpResponse.json({
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          startedAt: s.startedAt ?? iso(minutesAgo(30)),
          endedAt: null,
          turnCount: s.turnCount ?? 2,
          firstUtterance: s.firstUtterance ?? '我想学布尔代数',
          lastActivityAt: s.lastActivityAt ?? iso(minutesAgo(30)),
        })),
      }),
    ),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/learning']}>
          <Routes>
            <Route path="/learning" element={<LearningPage />} />
            <Route path="/" element={<div>首页内容</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
}

beforeAll(pinClock);

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubSessions([]);
  // beforeAll 里 setSystemTime 一次就够，但 userEvent 等库可能推进时钟，逐个用例再钉一次。
  vi.setSystemTime(NOW);
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('bucketOf / sessionTimeLabel：今天、昨天、更早', () => {
  it('按本地日界分组，不按 24 小时窗口', () => {
    // 23:59 的会话在 00:01 之后属于「昨天」；若用「24 小时内」算，它会被
    // 错误地留在「今天」—— 而用户是按日历过日子的。
    const lateLastNight = new Date('2026-10-21T23:59:00');
    const earlyToday = new Date('2026-10-22T00:01:00');
    expect(bucketOf(iso(lateLastNight), NOW)).toBe('昨天');
    expect(bucketOf(iso(earlyToday), NOW)).toBe('今天');
    expect(bucketOf(iso(new Date('2026-10-20T23:59:00')), NOW)).toBe('更早');
  });

  it('解析不了的时间落到「更早」，不抛错', () => {
    expect(bucketOf('not-a-date', NOW)).toBe('更早');
    expect(sessionTimeLabel('not-a-date', NOW)).toBe('');
  });

  it('今天/昨天给时刻，更早给日期', () => {
    expect(sessionTimeLabel(iso(new Date('2026-10-22T09:05:00')), NOW)).toBe('09:05');
    expect(sessionTimeLabel(iso(new Date('2026-10-21T23:59:00')), NOW)).toBe('23:59');
    expect(sessionTimeLabel(iso(new Date('2026-10-03T09:05:00')), NOW)).toBe('10月3日');
  });

  it('groupSessions 只保留非空组，顺序固定为 今天 → 昨天 → 更早', () => {
    const sessions = [
      { sessionId: 'a', lastActivityAt: iso(new Date('2026-10-03T09:05:00')) },
      { sessionId: 'b', lastActivityAt: iso(new Date('2026-10-22T09:05:00')) },
      { sessionId: 'c', lastActivityAt: iso(new Date('2026-10-21T23:59:00')) },
    ] as never;
    const grouped = groupSessions(sessions, NOW);
    expect(grouped.map((g) => g.bucket)).toEqual(['今天', '昨天', '更早']);
    expect(grouped.map((g) => g.items.map((i) => i.sessionId))).toEqual([['b'], ['c'], ['a']]);
    expect(groupSessions([], NOW)).toEqual([]);
  });
});

describe('LearningPage：会话列表', () => {
  it('按今天/昨天/更早分组，每组显示首句、时刻与轮数', async () => {
    stubSessions([
      { sessionId: 'ses-today', lastActivityAt: iso(new Date('2026-10-22T09:05:00')), firstUtterance: '布尔代数', turnCount: 3 },
      { sessionId: 'ses-yesterday', lastActivityAt: iso(new Date('2026-10-21T23:59:00')), firstUtterance: '卡诺图', turnCount: 1 },
      { sessionId: 'ses-old', lastActivityAt: iso(new Date('2026-10-03T09:05:00')), firstUtterance: '电离室', turnCount: 7 },
    ]);
    renderPage();

    const today = await screen.findByRole('region', { name: '今天' });
    expect(within(today).getByText('布尔代数')).toBeInTheDocument();
    expect(within(today).getByText('3 轮')).toBeInTheDocument();

    const yesterday = screen.getByRole('region', { name: '昨天' });
    expect(within(yesterday).getByText('卡诺图')).toBeInTheDocument();

    const older = screen.getByRole('region', { name: '更早' });
    expect(within(older).getByText('电离室')).toBeInTheDocument();
    expect(within(older).getByText('10月3日')).toBeInTheDocument();
  });

  it('点一条记录 = 把会话 id 写回当前会话，然后回首页', async () => {
    stubSessions([
      { sessionId: 'ses-today', lastActivityAt: iso(new Date('2026-10-22T09:05:00')), firstUtterance: '布尔代数' },
    ]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /布尔代数/ }));

    await waitFor(() => expect(screen.getByText('首页内容')).toBeInTheDocument());
    expect(window.localStorage.getItem('starmap.session')).toBe('ses-today');
  });

  it('点「新会话」换一个新 id（与旧会话不同），然后回首页', async () => {
    stubSessions([
      { sessionId: 'ses-today', lastActivityAt: iso(new Date('2026-10-22T09:05:00')), firstUtterance: '布尔代数' },
    ]);
    window.localStorage.setItem('starmap.session', 'ses-today');
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /新会话/ }));

    await waitFor(() => expect(screen.getByText('首页内容')).toBeInTheDocument());
    const next = window.localStorage.getItem('starmap.session');
    expect(next).toBeTruthy();
    expect(next).not.toBe('ses-today');
  });

  it('在右栏写的第一句话交给首页（sessionStorage 草稿）', async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByRole('textbox', { name: '这一轮想说的话' });
    await user.type(input, '我想学卡诺图');
    await user.click(screen.getByRole('button', { name: '开始' }));

    await waitFor(() => expect(screen.getByText('首页内容')).toBeInTheDocument());
    expect(window.sessionStorage.getItem('starmap.draft')).toBe('我想学卡诺图');
  });

  it('一条记录都没有时说明白，而不是空白', async () => {
    renderPage();
    expect(await screen.findByText('还没有任何会话。点「新会话」开始第一轮。')).toBeInTheDocument();
    expect(screen.getByText('还没有记录可继续')).toBeInTheDocument();
  });

  it('后端没连上时给出原因，而不是一直转圈', async () => {
    server.use(http.get('*/api/v1/agent/sessions', () => new HttpResponse(null, { status: 500 })));
    renderPage();
    expect(
      await screen.findByText('没读到会话列表：后端可能没连上。稍后重试。'),
    ).toBeInTheDocument();
  });
});
