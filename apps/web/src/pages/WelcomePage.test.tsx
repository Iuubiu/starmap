import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import { http, HttpResponse } from 'msw';
import { PROFILE_QUESTIONS } from '@starmap/api-contract';
import { PROFILE_DONE_KEY, WelcomePage, isProfileDone } from './WelcomePage';
import { server } from '../test/msw';

/**
 * 票 78 在欢迎页这一侧的验收。
 *
 * ## 这一页最容易做假的地方
 *
 * 「一次一屏」很容易退化成「把十题都渲染出来、用 CSS 只显示当前一屏」——
 * 截图看着一模一样，但读屏会一次念出十个问题，而且 DOM 里永远有下一题的
 * 答案可选。所以断言不看样式，数的是 `data-question-id` 的个数，并且断言
 * **下一题的题干不在 DOM 里**。
 *
 * 「跳过记 null」也一样：只看界面显示「未填写」证明不了什么 —— 那可能是
 * 渲染层的兜底。这里断言 PATCH 的请求体里那个字段真的是 `null`。
 */

const emptyProfile = {
  background: null,
  mathLevel: null,
  goal: null,
  weeklyHours: null,
  explanationDensity: null,
  priorCourses: null,
};

interface PatchRecord {
  body: unknown;
}

function stubProfile(options: { profile?: Record<string, unknown>; saved?: PatchRecord[] } = {}) {
  const saved = options.saved ?? [];
  let current = { ...emptyProfile, ...(options.profile ?? {}) };
  const answered = () => Object.values(current).filter((v) => v !== null).length;

  server.use(
    http.get('*/api/v1/profile', () =>
      HttpResponse.json({
        profile: current,
        updatedAt: null,
        answeredCount: answered(),
      }),
    ),
    http.patch('*/api/v1/profile', async ({ request }) => {
      const patch = (await request.json()) as Record<string, unknown>;
      saved.push({ body: patch });
      current = { ...current, ...patch };
      return HttpResponse.json({ profile: current, updatedAt: '2026-10-22T00:00:00.000Z', answeredCount: answered() });
    }),
  );
  return saved;
}

const renderWelcome = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/welcome']}>
          <Routes>
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/me" element={<div>我的页面占位</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('一次只问一个问题', () => {
  it('首屏只有一个问题卡，下一题的题干不在 DOM 里', async () => {
    stubProfile();
    renderWelcome();

    await waitFor(() => expect(screen.getByText(PROFILE_QUESTIONS[0]!.prompt)).toBeInTheDocument());
    expect(document.querySelectorAll('[data-question-id]')).toHaveLength(1);
    expect(screen.queryByText(PROFILE_QUESTIONS[1]!.prompt)).not.toBeInTheDocument();
  });

  it('答完第一题后同一个位置换成第二题，仍然只有一张卡', async () => {
    const saved = stubProfile();
    renderWelcome();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /本科在读/ }));
    await user.click(screen.getByRole('button', { name: '继续' }));

    await waitFor(() => expect(screen.getByText(PROFILE_QUESTIONS[1]!.prompt)).toBeInTheDocument());
    expect(document.querySelectorAll('[data-question-id]')).toHaveLength(1);
    expect(saved[0]!.body).toEqual({ background: 'undergraduate' });
  });

  it('进度点跟着走：第 1 问显示 1/8，答完显示 2/8', async () => {
    stubProfile();
    renderWelcome();
    const user = userEvent.setup();

    expect(await screen.findByText(/第 1\/8 问/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /本科在读/ }));
    await user.click(screen.getByRole('button', { name: '继续' }));
    expect(await screen.findByText(/第 2\/8 问/)).toBeInTheDocument();
  });
});

describe('跳过写 null，不写默认值', () => {
  it('跳过第一题时 PATCH 体是 { background: null }', async () => {
    const saved = stubProfile();
    renderWelcome();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: '跳过' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.body).toEqual({ background: null });
    // 界面必须走到下一题，而不是停在原地假装答过了。
    expect(await screen.findByText(PROFILE_QUESTIONS[1]!.prompt)).toBeInTheDocument();
  });

  it('已经答过的字段再次进来时不再从第一题开始', async () => {
    stubProfile({ profile: { background: 'graduate', goal: 'exam' } });
    renderWelcome();

    // 第一题（学段）与第四题目标都答过了，起点应为第二题「学过哪些课」。
    expect(await screen.findByText(PROFILE_QUESTIONS[1]!.prompt)).toBeInTheDocument();
    expect(screen.queryByText(PROFILE_QUESTIONS[0]!.prompt)).not.toBeInTheDocument();
  });
});

describe('同一字段的多道题：并集而不是互相覆盖', () => {
  it('跳过同字段的第二问，不会把第一问的答案清成 null', async () => {
    const saved = stubProfile();
    renderWelcome();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /本科在读/ }));
    await user.click(screen.getByRole('button', { name: '继续' }));

    // 第二问：已学过的课，选一门。
    await user.click(await screen.findByRole('button', { name: '电路分析' }));
    await user.click(screen.getByRole('button', { name: '继续' }));
    await waitFor(() => expect(saved).toHaveLength(2));

    // 第三问仍在问先修课（换了个角度）。跳过它 —— 不能把刚才那门课抹掉。
    expect(await screen.findByText(PROFILE_QUESTIONS[2]!.prompt)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^跳过$/ }));
    await waitFor(() => expect(screen.getByText(PROFILE_QUESTIONS[3]!.prompt)).toBeInTheDocument());

    expect(saved).toHaveLength(2);
    expect(saved[1]!.body).toEqual({ priorCourses: ['电路分析'] });
    expect(saved.some((record) => JSON.stringify(record.body) === '{"priorCourses":null}')).toBe(false);
  });

  it('答同一字段的下一问时是并集：两门课都留在画像里', async () => {
    const saved = stubProfile();
    renderWelcome();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /本科在读/ }));
    await user.click(screen.getByRole('button', { name: '继续' }));
    await user.click(await screen.findByRole('button', { name: '电路分析' }));
    await user.click(screen.getByRole('button', { name: '继续' }));
    await waitFor(() => expect(saved).toHaveLength(2));

    await waitFor(() => expect(screen.getByText(PROFILE_QUESTIONS[2]!.prompt)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '核电子学' }));
    await user.click(screen.getByRole('button', { name: '继续' }));

    await waitFor(() => expect(saved).toHaveLength(3));
    expect(saved[2]!.body).toEqual({ priorCourses: ['电路分析', '核电子学'] });
  });

  it('从中间那道题进来时，答完接着往后走，而不是回到第 2 题', async () => {
    stubProfile({ profile: { background: 'graduate' } });
    renderWelcome();
    const user = userEvent.setup();

    // 从第二题（已学过的课）开始。
    expect(await screen.findByText(PROFILE_QUESTIONS[1]!.prompt)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '电路分析' }));
    await user.click(screen.getByRole('button', { name: '继续' }));

    expect(await screen.findByText(PROFILE_QUESTIONS[2]!.prompt)).toBeInTheDocument();
    expect(screen.queryByText(PROFILE_QUESTIONS[1]!.prompt)).not.toBeInTheDocument();
  });
});

describe('走完落 /me 并记下 profileDone', () => {
  it('八题都跳过后跳到 /me，localStorage 有标记', async () => {
    const saved = stubProfile();
    renderWelcome();
    const user = userEvent.setup();

    for (const [i, question] of PROFILE_QUESTIONS.entries()) {
      await waitFor(() => expect(screen.getByText(question.prompt)).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: '跳过' }));
      // 每题都发了 PATCH、且写的都是 null：跳过不是「不提交」。
      await waitFor(() => expect(saved).toHaveLength(i + 1));
      expect(saved[i]!.body).toEqual({ [question.field]: null });
    }

    await waitFor(() => expect(screen.getByText('我的页面占位')).toBeInTheDocument());
    expect(isProfileDone()).toBe(true);
    expect(window.localStorage.getItem(PROFILE_DONE_KEY)).toBe('1');
  });
});
