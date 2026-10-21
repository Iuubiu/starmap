import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { http, HttpResponse } from 'msw';
import { SessionPlanCard } from './SessionPlanCard';
import { server } from '../test/msw';

/**
 * 票 12 的第四维参数：「单次会话新知识点上限」（P1=2 / P2=3 / P3=4）。
 *
 * ## 这一维最容易做假的地方
 *
 * 另外五维都能在关卡首屏看见，这一维不能 —— 它是策略。最省事的实现是
 * 服务端算完丢掉、前端也不显示，然后「六维参数驱动界面」这句话在五维上成立、
 * 在这一维上落空，而**没有任何测试会红**（因为没人断言过它出现在屏幕上）。
 *
 * 所以这里断言的是三件可观察的事：
 *   1. 上限值本身出现在屏幕上，且**来自接口**（P1 说 2、P3 说 4，同一段代码）；
 *   2. 排在前面的知识点列出来，带「有没有现成关卡」；
 *   3. 超出上限的那些**没有消失**，而是明说「还有 N 个排在后面」——
 *      学生不该因为看不见而以为被永久跳过。
 *
 * ## 为什么读不到时要求「整块不渲染」而不是显示错误
 *
 * 这张卡是侧栏的辅助信息。它挂了不影响做题，而侧栏里多一条红色告警会让人
 * 以为「现在不能学了」。所以断言的是**没有错误提示**，而不是「有错误提示」。
 */

const renderCard = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <SessionPlanCard />
      </QueryClientProvider>
    </FluentProvider>,
  );
};

const stubPlan = (body: Record<string, unknown>) => {
  server.use(http.get('*/api/v1/tier/session-plan', () => HttpResponse.json(body)));
};

const plan = (overrides: Record<string, unknown> = {}) => ({
  tier: 'P1',
  source: 'placement',
  limit: 2,
  items: [
    { microKpId: 'kp-bool', name: '布尔代数基本运算', hasLevel: true },
    { microKpId: 'kp-kmap', name: '卡诺图化简', hasLevel: false },
  ],
  deferred: 0,
  ...overrides,
});

describe('会话新知识点上限：看得见，且跟着档位变（票 12 验收 1）', () => {
  it('P1：上限 2，列出两个知识点，并标出哪个有现成关卡', async () => {
    stubPlan(plan());
    renderCard();

    expect(await screen.findByText(/按 P1 档，一次最多推进 2 个新知识点。/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: '本档排在前面的新知识点' });
    expect(list).toBeInTheDocument();
    expect(screen.getByText('布尔代数基本运算')).toBeInTheDocument();
    expect(screen.getByText('卡诺图化简')).toBeInTheDocument();
    // 「有没有关卡」必须是文字而不是只靠颜色。
    expect(screen.getByText('有现成关卡')).toBeInTheDocument();
    expect(screen.getByText('还没有关卡')).toBeInTheDocument();
    // deferred=0 时不该出现排队提示。
    expect(screen.queryByText(/排在后面/)).not.toBeInTheDocument();
  });

  it('P3：同一段代码，上限变成 4（值来自接口，不是前端写死的 2）', async () => {
    stubPlan(
      plan({
        tier: 'P3',
        limit: 4,
        items: [
          { microKpId: 'kp-a', name: '噪声系数', hasLevel: true },
          { microKpId: 'kp-b', name: '噪声温度', hasLevel: true },
          { microKpId: 'kp-c', name: '等效输入噪声', hasLevel: false },
          { microKpId: 'kp-d', name: '最佳源阻抗', hasLevel: false },
        ],
        deferred: 3,
      }),
    );
    renderCard();

    expect(await screen.findByText(/按 P3 档，一次最多推进 4 个新知识点。/)).toBeInTheDocument();
    expect(screen.getByText('噪声系数')).toBeInTheDocument();
    expect(screen.getByText('最佳源阻抗')).toBeInTheDocument();
    // 关键反向对照：不是 P1 的那句话。
    expect(screen.queryByText(/按 P1 档/)).not.toBeInTheDocument();
  });

  it('超出上限的那些明说「排在后面」，不是静默截断', async () => {
    stubPlan(plan({ deferred: 5 }));
    renderCard();

    expect(
      await screen.findByText(/还有 5 个知识点排在后面：这一档一次只开 2 个，学完一个就往前挪一个。/),
    ).toBeInTheDocument();
  });

  it('一个待学知识点都没有时说清「先学完手上的」，而不是空列表', async () => {
    stubPlan(plan({ items: [], deferred: 0 }));
    renderCard();

    expect(await screen.findByText(/当前没有待学的新知识点/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '本档排在前面的新知识点' })).not.toBeInTheDocument();
  });

  it('读不到时整块不渲染，也不在侧栏里喊「不能学了」', async () => {
    server.use(
      http.get('*/api/v1/tier/session-plan', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '档位读不到' }, { status: 500 }),
      ),
    );
    const { container } = renderCard();

    // 先等一次微任务，让 query 真的失败（否则「没有错误提示」可能在请求
    // 还没回来时就通过 —— 那是一个恒真的断言）。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.textContent).toBe('');
    expect(screen.queryByText(/不能学/)).not.toBeInTheDocument();
  });
});
