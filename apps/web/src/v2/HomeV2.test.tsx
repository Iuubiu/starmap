/*
 * HomeV2 抽走内联外壳之后仍要保证：`/` 的对话内容与右栏原样渲染。
 *
 * 外壳（左轨 / 会话列）已经搬到 `V2Shell`，这里不 mock 它 —— 测的就是
 * 「HomeV2 自己只负责主列 + 右栏 slot」这件事：根节点里不应再有 `.v2-shell`
 * 或 `.v2-rail`，否则就会出现两层外壳。
 */
import { render, screen } from '@testing-library/react';
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

describe('HomeV2（t96：外壳已抽到 V2Shell）', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/placement')) return jsonResponse({ status: 'provisional', tier: 'P2' });
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
    const { container } = render(<HomeV2 />);

    expect(screen.getByRole('heading', { name: '学习' })).toBeTruthy();
    expect(screen.getByText('STARMAP')).toBeTruthy();
    expect(screen.getAllByText(/说一句你想学什么/).length).toBeGreaterThan(0);
    // 这一轮的真实记录仍在学习日志里（抽外壳时不能把数据流一起抽走）。
    expect(screen.getAllByText(/先把布尔代数基本运算过一遍/).length).toBeGreaterThan(0);

    // 右栏作为 slot 留在页面里，而不是跟着外壳一起被抽走。
    expect(screen.getByRole('heading', { name: '学习档案' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '学习日志' })).toBeTruthy();
    expect((await screen.findAllByText('P2')).length).toBeGreaterThan(1);

    // 外壳归 V2Shell：页面自己不能再渲染一套。
    expect(container.querySelector('.v2-shell')).toBeNull();
    expect(container.querySelector('.v2-rail')).toBeNull();
    expect(container.querySelector('.v2-sessions')).toBeNull();
    expect(container.querySelector('.v2-main')).not.toBeNull();
    expect(container.querySelector('.v2-log')).not.toBeNull();
  });
});
