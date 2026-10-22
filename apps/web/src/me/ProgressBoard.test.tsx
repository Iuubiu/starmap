import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { ProgressBoard, percentOf } from './ProgressBoard';
import { server } from '../test/msw';

/**
 * 票 80 在「个人看板」这一侧的验收。
 *
 * ## 这里盯的不是「渲染没报错」，而是三件容易做错的事
 *
 * 1. **空态不许画 0% 的条**。0% 和「还没有数据」是两个断言，混同起来会把
 *    一个什么都没做的学生显示成「学了但全没学会」。
 * 2. **分母要显示出来**。「掌握了 7 个」没有分母就不是进度；三数（已掌握 /
 *    在学 / 未学）也不能只留一个百分比。
 * 3. **停用的书不画 0/0 的进度条**。那看起来像「这本书你一字未学」，而事实
 *    是它已经不在教学范围里。
 *
 * 五态之和 === 叶节点总数这条最容易错的断言在 API 侧（`mastery.board.test.ts`）；
 * 这里再钉一次「页面显示的五态确实是这五项、且分母就是总数」，防止组件自己
 * 另算一套。
 */

const LAYERS = [
  { id: 'circuit-analysis', name: '电路分析', ordinal: 10, total: 61, mastered: 1 },
  { id: 'analog-electronics', name: '模拟电子技术', ordinal: 20, total: 376, mastered: 2 },
  { id: 'digital-electronics', name: '数字电子技术', ordinal: 30, total: 274, mastered: 0 },
  { id: 'atomic-nuclear-physics', name: '原子核物理', ordinal: 40, total: 245, mastered: 0 },
  { id: 'nuclear-electronics', name: '核电子学', ordinal: 50, total: 202, mastered: 3 },
  { id: 'radiation-detection', name: '探测与测量方法', ordinal: 60, total: 600, mastered: 1 },
  { id: 'radiation-measurement-methods', name: '实验方法与数据处理', ordinal: 70, total: 273, mastered: 0 },
  { id: 'advanced-digital', name: '数字脉冲处理与可编程逻辑', ordinal: 80, total: 0, mastered: 0 },
];

const BOOKS = [
  { id: 'jichangsong', title: '核辐射探测器及其实验技术手册', enabled: true, total: 390, learned: 12 },
  { id: 'tongshibai', title: '模拟电子技术基础（童诗白）', enabled: true, total: 208, learned: 0 },
  { id: 'knoll-4e', title: '辐射探测与测量（Knoll 第4版）', enabled: false, total: 0, learned: 0 },
];

const BY_STATE = [
  { state: 'mastered', count: 7 },
  { state: 'proficient', count: 2 },
  { state: 'familiar', count: 3 },
  { state: 'attempted', count: 5 },
  { state: 'unseen', count: 3068 },
];

const TOTAL = 3085;

const BOARD = {
  evaluatedAt: '2026-10-22T00:00:00.000Z',
  knowledgePoints: {
    total: TOTAL,
    mastered: 7,
    learning: 10,
    untouched: 3068,
    byState: BY_STATE,
  },
  layers: LAYERS,
  books: BOOKS,
  unlayeredLeafCount: 1054,
};

const EMPTY_BOARD = {
  ...BOARD,
  knowledgePoints: {
    total: TOTAL,
    mastered: 0,
    learning: 0,
    untouched: TOTAL,
    byState: [
      { state: 'mastered', count: 0 },
      { state: 'proficient', count: 0 },
      { state: 'familiar', count: 0 },
      { state: 'attempted', count: 0 },
      { state: 'unseen', count: TOTAL },
    ],
  },
  layers: LAYERS.map((layer) => ({ ...layer, mastered: 0 })),
  books: BOOKS.map((book) => ({ ...book, learned: 0 })),
};

function stubBoard(body: Record<string, unknown> = BOARD, status = 200) {
  server.use(
    http.get('*/api/v1/mastery/board', () =>
      status === 200 ? HttpResponse.json(body) : new HttpResponse(null, { status }),
    ),
  );
}

function renderBoard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProgressBoard />
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
}

describe('个人看板', () => {
  it('有数据时顶部给分母与三个数，而不是只给一个百分比', async () => {
    stubBoard();
    renderBoard();

    const total = await screen.findByRole('region', { name: '总进度' });
    expect(within(total).getByText(/已掌握 7 \/ 3085/)).toBeInTheDocument();
    expect(within(total).getByText('已掌握')).toBeInTheDocument();
    expect(within(total).getByText('在学')).toBeInTheDocument();
    expect(within(total).getByText('未学')).toBeInTheDocument();
    expect(within(total).getByText('10')).toBeInTheDocument();
    expect(within(total).getByText('3068')).toBeInTheDocument();
    // 顶部有一条总进度条（有声标签里有分母）。
    expect(
      within(total).getByRole('progressbar', { name: /已掌握 7 \/ 3085 个知识点/ }),
    ).toBeInTheDocument();
  });

  it('五态明细用后端给的五个数，分母就是叶节点总数', async () => {
    stubBoard();
    renderBoard();

    const card = await screen.findByRole('region', { name: '知识点进度' });
    const labels = ['已掌握', '已熟练', '已熟悉', '刚接触', '未学习'];
    for (const label of labels) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    expect(within(card).getByText('知识点：全库 3085 个叶节点')).toBeInTheDocument();
    // 五个态各自的数量都渲染出来了（而不是只画一个总条）。
    for (const row of BY_STATE) {
      expect(within(card).getByText(`${String(row.count)} 个`)).toBeInTheDocument();
    }
    // 页面上不会出现「只显示百分比」的样子：分母 3085 必须可读。
    expect(within(card).getByText(/3085/)).toBeInTheDocument();
  });

  it('学科：八层全部出现且顺序与 ordinal 一致；空层也出现并标 0 / 0', async () => {
    stubBoard();
    renderBoard();

    const card = await screen.findByRole('region', { name: '学科进度' });
    const names = LAYERS.map((layer) => layer.name);
    const rendered = names.map((name) => within(card).getByText(name));
    // 以 DOM 顺序断言，而不是「都能找到」——「都能找到」放过顺序错。
    const positions = rendered.map((el) => {
      let index = 0;
      let node: Node | null = el;
      while (node !== null) {
        node = node.previousSibling;
        index += 1;
      }
      return index;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // 空层（数字脉冲处理）显示 0 / 0 而不是消失。
    expect(within(card).getByText(/0 \/ 0/)).toBeInTheDocument();
    // 未归层的差额必须解释。
    expect(within(card).getByText(/另有 1054 个知识点没归入任何课程层/)).toBeInTheDocument();
  });

  it('课本：启用的书有「已学 / 总数」，停用的单列并标已停用且不画进度条', async () => {
    stubBoard();
    renderBoard();

    const card = await screen.findByRole('region', { name: '课本进度' });
    expect(within(card).getByText('课本：2 本在用')).toBeInTheDocument();
    expect(within(card).getByText(/12 \/ 390/)).toBeInTheDocument();
    expect(within(card).getByText('已停用')).toBeInTheDocument();
    expect(within(card).getByText('辐射探测与测量（Knoll 第4版）')).toBeInTheDocument();
    // 只有启用书的进度条：2 条；停用书不画 0/0。
    expect(within(card).getAllByRole('progressbar')).toHaveLength(2);
  });

  it('空态：说明「还没有任何作答记录」，不显示 0%', async () => {
    stubBoard(EMPTY_BOARD);
    renderBoard();

    const total = await screen.findByRole('region', { name: '总进度' });
    expect(
      within(total).getByText('你还没有任何作答记录，学完第一关后这里会出现数字。'),
    ).toBeInTheDocument();
    // 空态不画总进度条（0% 的条会被读成「学了但全没学会」）。
    expect(within(total).queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/^0%$/)).toBeNull();
    // 三个数仍在（0 / 0 / 3085）：分母是真话，不是「假装没有分母」。
    expect(within(total).getByText('3085')).toBeInTheDocument();
  });

  it('读不到看板时说明后端没连上，而不是渲染一堆 0', async () => {
    stubBoard(undefined, 500);
    renderBoard();

    expect(await screen.findByText(/没读到看板/)).toBeInTheDocument();
  });

  it('百分比在分母为 0 时是 null（0/0 不渲染成 0%）', () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(7, 3085)).toBe(0.23);
    expect(percentOf(1, 3085)).toBe(0.03); // 不能四舍五入成 0：那是「一个都没学」的假话
    expect(percentOf(1, 2)).toBe(50);
    expect(percentOf(2, 3)).toBe(66.67);
  });
});
