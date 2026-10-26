/*
 * HomeV2 抽走内联外壳之后仍要保证：`/` 的对话内容与右栏原样渲染。
 *
 * 外壳（左轨 / 会话列）已经搬到 `V2Shell`，这里不 mock 它 —— 测的就是
 * 「HomeV2 自己只负责主列 + 右栏 slot」这件事：根节点里不应再有 `.v2-shell`
 * 或 `.v2-rail`，否则就会出现两层外壳。
 */
import { MemoryRouter } from 'react-router';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeV2 } from './HomeV2';

vi.mock('../api/queries/agent', () => ({
  useAgentTurns: () => ({
    data: {
      data: {
        items: [
          {
            id: 'turn-1',
            utterance: '我想学布尔代数',
            visibleResponse: '先把布尔代数基本运算过一遍',
            createdAt: new Date().toISOString(),
          },
        ],
      },
    },
    isPending: false,
    isError: false,
  }),
  useSubmitTurn: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    data: undefined,
  }),
}));

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

/**
 * 票 09 集成后右栏档位/上限卡自己调 react-query hook（useTierOverview /
 * useTierSessionPlan），走生成的客户端 → 全局 fetch。桩直接给契约体
 * （客户端自己包 { data } 信封），形状抄 test/msw.ts 的默认 tier 桩。
 */
const tierOverviewBody = {
  tier: 'P2',
  source: 'placement',
  params: {
    tier: 'P2',
    firstRoundShape: 'completion',
    ladder: { start: 2, cap: 4 },
    sessionNewKpLimit: 3,
    feedbackTiming: 'step_immediate_with_summary',
    attemptsPerItem: 2,
    masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
  },
  label: '补全步骤',
  description: '首轮给例题，最后一步留给你补。',
  basis: '由 3 次作答判定 · 2 个变式已覆盖 · 连对 1/2',
  basisAttempts: 3,
  basisVariants: 2,
  basisStreak: 1,
};

describe('HomeV2（t96：外壳已抽到 V2Shell）', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/tier/session-plan'))
          return jsonResponse({ tier: 'P2', source: 'placement', limit: 3, items: [], deferred: 1 });
        if (url.includes('/api/v1/tier')) return jsonResponse(tierOverviewBody);
        if (url.includes('/api/v1/recommendations')) return jsonResponse({ recommendations: [] });
        if (url.includes('/api/v1/nodes/')) return jsonResponse({ node: { name: '布尔代数基本运算' } });
        return jsonResponse({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('主列仍渲染对话与空态，右栏 slot（学习档案 / 学习日志）仍是自己的', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomeV2 />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    /* 顶部三行（学习 / STARMAP / 说明）已按用户 s(m39578) 的要求删除，
       改为中栏居中一句问好。这里断言的是新契约：标题不存在、问好在、说明还在。 */
    expect(screen.queryByRole('heading', { name: '学习' })).toBeNull();
    expect(screen.queryByText('STARMAP')).toBeNull();
    expect(screen.getByText('今天想学点什么？')).toBeTruthy();
    expect(screen.getAllByText(/说一句你想学什么/).length).toBeGreaterThan(0);
    // 这一轮的真实记录仍在学习日志里（抽外壳时不能把数据流一起抽走）。
    expect(screen.getAllByText(/先把布尔代数基本运算过一遍/).length).toBeGreaterThan(0);

    // 右栏作为 slot 留在页面里，而不是跟着外壳一起被抽走。
    expect(screen.getByRole('heading', { name: '学习档案' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '学习日志' })).toBeTruthy();
    /* 档位由后端按作答证据裁定，测试不该写死 P2/P3 —— 只断言「档位这个字段渲染了」。 */
    expect((await screen.findAllByText(/^P[1-3]$/)).length).toBeGreaterThan(0);

    /* 票 09 集成：四张学习档案卡都在线上首页（此前只活在无路由的旧 HomePage）。
       冷启动无 kp：正在学卡给引导句与搜索入口；basis 与上限来自接口透传。 */
    expect(screen.getByRole('heading', { name: '正在学' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '换个知识点' })).toBeTruthy();
    expect(await screen.findByText(tierOverviewBody.basis)).toBeTruthy();
    expect(await screen.findByText(/一次最多推进 3 个新知识点/)).toBeTruthy();
    expect(await screen.findByText(/还有 1 个，下次会话再开/)).toBeTruthy();

    // 外壳归 V2Shell：页面自己不能再渲染一套。
    expect(container.querySelector('.v2-shell')).toBeNull();
    expect(container.querySelector('.v2-rail')).toBeNull();
    expect(container.querySelector('.v2-sessions')).toBeNull();
    expect(container.querySelector('.v2-main')).not.toBeNull();
    expect(container.querySelector('.v2-log')).not.toBeNull();
  });
});
