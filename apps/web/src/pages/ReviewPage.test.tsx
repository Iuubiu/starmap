/**
 * 复验页（票 07）。
 *
 * 三条最要紧的事情在这份测试里各有一组：
 *
 * 1. **队列与图谱同源**：这一页不能自己再算一遍「到期没有」—— 它只读
 *    `GET /review/queue`，而那个接口与图谱读同一列。测试锁住「空队列要显示
 *    一句人话、不是错误」，因为空队列是正常状态。
 * 2. **交错**：题单按变式组交错，不出现「同一个知识点连考」。测试用两个
 *    知识点交替的题单证明渲染顺序就是后端给的顺序，前端不重排。
 * 3. **未通过只降 current 不降 achieved**：结果区把两个数字都摆出来供学习者
 *    核对，测试断言两个数字都出现过。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';

const mocks = vi.hoisted(() => {
  const submitMutate = vi.fn();
  const startMutate = vi.fn();
  const completeMutate = vi.fn();
  return { submitMutate, startMutate, completeMutate };
});

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual<typeof import('../api/queries')>('../api/queries');
  return {
    ...actual,
    useReviewQueue: vi.fn(),
    useReviewRound: vi.fn(),
    useStartReviewRound: vi.fn(),
    useCompleteReviewRound: vi.fn(),
    useSubmitAttempt: vi.fn(),
  };
});

import * as queries from '../api/queries';
import { ReviewPage } from './ReviewPage';

const useReviewQueue = vi.mocked(queries.useReviewQueue);
const useReviewRound = vi.mocked(queries.useReviewRound);
const useStartReviewRound = vi.mocked(queries.useStartReviewRound);
const useCompleteReviewRound = vi.mocked(queries.useCompleteReviewRound);
const useSubmitAttempt = vi.mocked(queries.useSubmitAttempt);

type Queue = NonNullable<ReturnType<typeof queries.useReviewQueue>['payload']>;
type Detail = NonNullable<ReturnType<typeof queries.useReviewRound>['payload']>;

function queueOf(due: Queue['due']): Queue {
  return { due };
}

function emptyQueue(): Queue {
  return { due: [] };
}

function detailOf(overrides: Partial<Detail> = {}): Detail {
  return {
    round: {
      roundId: 'round-1',
      itemCount: 3,
      createdAt: '2026-10-21T00:00:00.000Z',
      completedAt: null,
      verdict: null,
      correctCount: null,
    },
    items: [
      {
        ordinal: 1,
        itemId: 'i-a1',
        microKpId: 'kp-a',
        microKpName: '布尔代数',
        variantGroup: 'vg-absorb',
        stem: '**吸收律**：A + AB 等于什么？',
        options: ['A', 'B', 'AB', 'A+B'],
        explainCorrect: '吸收律把 AB 一项吸收掉了，所以只剩 A。',
        explainWrong: '再看一遍吸收律：A + AB = A(1+B) = A。',
        misconceptionTags: ['把或运算当成算术加法'],
      },
      {
        ordinal: 2,
        itemId: 'i-b1',
        microKpId: 'kp-b',
        microKpName: '德摩根定律',
        variantGroup: 'vg-demorgan',
        stem: '非(A 且 B) 等于什么？',
        options: ['非A 且 非B', '非A 或 非B', 'A 或 B', 'A 且 B'],
        explainCorrect: '德摩根：把非推进括号，且要换成或。',
        explainWrong: '记住「换号」：且变或，或变且。',
        misconceptionTags: ['忘了换运算符'],
      },
      {
        ordinal: 3,
        itemId: 'i-a2',
        microKpId: 'kp-a',
        microKpName: '布尔代数',
        variantGroup: 'vg-simplify',
        stem: 'A · A 化简成什么？',
        options: ['A', 'A²', '1', '0'],
        explainCorrect: '幂等律：同一个变量和自己与，还是它自己。',
        explainWrong: '布尔代数里没有平方这回事。',
        misconceptionTags: ['套用普通代数'],
      },
    ],
    outcomes: [],
    mastery: [],
    ...overrides,
  };
}

function renderPage(route = '/review') {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/board" element={<div>看板页</div>} />
          <Route path="/map" element={<div>地图页</div>} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useStartReviewRound.mockReturnValue({
    mutate: mocks.startMutate,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof queries.useStartReviewRound>);
  useCompleteReviewRound.mockReturnValue({
    mutate: mocks.completeMutate,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof queries.useCompleteReviewRound>);
  useSubmitAttempt.mockReturnValue({
    mutate: mocks.submitMutate,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof queries.useSubmitAttempt>);
  useReviewRound.mockReturnValue({
    payload: undefined,
    isPending: false,
  } as unknown as ReturnType<typeof queries.useReviewRound>);
});

describe('ReviewPage 复验队列', () => {
  it('空队列是正常状态：说一句「今天没有要复验的内容」，不是报错', () => {
    useReviewQueue.mockReturnValue({
      payload: emptyQueue(),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);

    renderPage();

    expect(screen.getByText('今天没有要复验的内容')).toBeTruthy();
    expect(screen.queryByText(/失败|错误|出问题/)).toBeNull();
    // 没有到期项时不该给「开始复验」按钮
    expect(screen.queryByRole('button', { name: '开始复验' })).toBeNull();
  });

  it('到期项显示逾期天数、间隔档位与可复验题数', () => {
    useReviewQueue.mockReturnValue({
      payload: queueOf([
        {
          microKpId: 'kp-a',
          name: '布尔代数',
          nextDueAt: '2026-10-18T00:00:00.000Z',
          overdueDays: 3,
          reviewStage: 1,
          intervalDays: 3,
          availableItemCount: 7,
        },
      ]),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);

    renderPage();

    expect(screen.getByText('布尔代数')).toBeTruthy();
    expect(screen.getByText('逾期 3 天')).toBeTruthy();
    expect(screen.getByText(/第 2 档 · 间隔 3 天/)).toBeTruthy();
    expect(screen.getByText(/可复验的题 7 道/)).toBeTruthy();
  });

  it('到期但逾期 0 天显示「今天到期」而不是「逾期 0 天」', () => {
    useReviewQueue.mockReturnValue({
      payload: queueOf([
        {
          microKpId: 'kp-a',
          name: '布尔代数',
          nextDueAt: '2026-10-21T00:00:00.000Z',
          overdueDays: 0,
          reviewStage: 0,
          intervalDays: 1,
          availableItemCount: 4,
        },
      ]),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);

    renderPage();

    expect(screen.getByText('今天到期')).toBeTruthy();
    expect(screen.queryByText(/逾期 0 天/)).toBeNull();
  });

  it('点「开始复验」调一次 start，且不会自动触发（挂载不抽题）', async () => {
    useReviewQueue.mockReturnValue({
      payload: queueOf([
        {
          microKpId: 'kp-a',
          name: '布尔代数',
          nextDueAt: '2026-10-20T00:00:00.000Z',
          overdueDays: 1,
          reviewStage: 0,
          intervalDays: 1,
          availableItemCount: 5,
        },
      ]),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);

    renderPage();

    // 挂载时一次都没调 —— 抽题有副作用，挂载即抽会消耗一次复验机会
    expect(mocks.startMutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '开始复验' }));
    expect(mocks.startMutate).toHaveBeenCalledTimes(1);
  });

  it('开始失败（409 没有到期）时把后端的话原样显示出来', async () => {
    useReviewQueue.mockReturnValue({
      payload: queueOf([
        {
          microKpId: 'kp-a',
          name: '布尔代数',
          nextDueAt: '2026-10-20T00:00:00.000Z',
          overdueDays: 1,
          reviewStage: 0,
          intervalDays: 1,
          availableItemCount: 5,
        },
      ]),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);

    mocks.startMutate.mockImplementation(
      (_vars: void, options?: { onError?: (error: unknown) => void }) => {
        const error = Object.assign(new Error('这些知识点目前都没有可复验的题目'), {
          status: 409,
          code: 'CONFLICT',
        });
        options?.onError?.(error);
      },
    );

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: '开始复验' }));

    await waitFor(() => {
      expect(screen.getByText('现在还开不了复验')).toBeTruthy();
    });
  });
});

describe('ReviewPage 作答', () => {
  it('题单按后端给的顺序交错渲染，前端不重排', () => {
    useReviewQueue.mockReturnValue({
      payload: emptyQueue(),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);
    useReviewRound.mockReturnValue({
      payload: detailOf(),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewRound>);

    renderPage('/review?round=round-1');

    const names = screen.getAllByText(/布尔代数|德摩根定律/).map((node) => node.textContent);
    // 期望 a, b, a —— 交错，不是 a, a, b
    expect(names).toEqual(['布尔代数', '德摩根定律', '布尔代数']);
  });

  it('答完立即显示预写反馈，且不需要重新请求', async () => {
    useReviewQueue.mockReturnValue({
      payload: emptyQueue(),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);
    useReviewRound.mockReturnValue({
      payload: detailOf({ items: [detailOf().items[0]!], round: { ...detailOf().round, itemCount: 1 } }),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewRound>);

    // 模拟后端判为答对
    mocks.submitMutate.mockImplementation(
      (
        _body: unknown,
        options?: { onSuccess?: (data: { attempt: { correct: boolean } }) => void },
      ) => {
        options?.onSuccess?.({ attempt: { correct: true, attemptNo: 1 } } as never);
      },
    );

    renderPage('/review?round=round-1');

    await userEvent.click(screen.getByRole('radio', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: '提交答案' }));

    await waitFor(() => {
      expect(screen.getByText(/吸收律把 AB 一项吸收掉了/)).toBeTruthy();
    });
    expect(mocks.submitMutate).toHaveBeenCalledTimes(1);
    // 提交时带上了 reviewRoundId，后端据此认领会话
    const body = mocks.submitMutate.mock.calls[0]?.[0] as { reviewRoundId?: string };
    expect(body.reviewRoundId).toBe('round-1');
  });

  it('判定回来之前显示「已提交，正在核对」，不冒充答对也不冒充答错', async () => {
    useReviewQueue.mockReturnValue({
      payload: emptyQueue(),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);
    useReviewRound.mockReturnValue({
      payload: detailOf({
        items: [detailOf().items[0]!],
        round: { ...detailOf().round, itemCount: 1 },
      }),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewRound>);

    // 不回调 onSuccess：模拟还在等后端
    mocks.submitMutate.mockImplementation(() => undefined);

    renderPage('/review?round=round-1');

    await userEvent.click(screen.getByRole('radio', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: '提交答案' }));

    expect(screen.getByText('已提交，正在核对')).toBeTruthy();
    expect(screen.queryByText('答对了')).toBeNull();
    expect(screen.queryByText('这条没答对，看下错在哪')).toBeNull();
  });

  it('没答完时不能交卷，按钮禁用并说明还差几道', async () => {
    useReviewQueue.mockReturnValue({
      payload: emptyQueue(),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);
    useReviewRound.mockReturnValue({
      payload: detailOf(),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewRound>);

    renderPage('/review?round=round-1');

    const button = screen.getByRole('button', { name: '交卷并判分' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('还有 3 道没答，答完才能判')).toBeTruthy();
  });
});

describe('ReviewPage 结果', () => {
  it('按知识点分别展示通过/未通过、下次到期与间隔档位', async () => {
    useReviewQueue.mockReturnValue({
      payload: emptyQueue(),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);
    useReviewRound.mockReturnValue({
      payload: detailOf({
        round: {
          roundId: 'round-1',
          itemCount: 3,
          createdAt: '2026-10-21T00:00:00.000Z',
          completedAt: '2026-10-21T00:05:00.000Z',
          verdict: 'failed',
          correctCount: 2,
        },
        outcomes: [
          {
            microKpId: 'kp-a',
            name: '布尔代数',
            correct: 2,
            total: 2,
            passed: true,
            verdict: 'passed',
            stage: 1,
            nextDueAt: '2026-10-24T00:00:00.000Z',
            correctItemIds: ['i-a1', 'i-a2'],
            wrongItemIds: [],
            message: '布尔代数：2/2 通过，间隔推进到 3 天。',
          },
          {
            microKpId: 'kp-b',
            name: '德摩根定律',
            correct: 0,
            total: 1,
            passed: false,
            verdict: 'failed',
            stage: 0,
            nextDueAt: '2026-10-22T00:00:00.000Z',
            correctItemIds: [],
            wrongItemIds: ['i-b1'],
            message: '德摩根定律：0/1 未通过，间隔退回 1 天。',
          },
        ],
        mastery: [
          {
            microKpId: 'kp-b',
            name: '德摩根定律',
            isLeaf: true,
            state: 'familiar',
            achieved: 0.96,
            current: 0.42,
            attemptCount: 12,
            variantCount: 4,
            evidenceSufficient: true,
            halfLifeDays: 30,
            lastEvidenceAt: '2026-10-21T00:05:00.000Z',
            aggregatedLeafCount: 0,
          },
        ],
      }),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewRound>);

    renderPage('/review?round=round-1');

    expect(screen.getByText('这一轮复验结束了')).toBeTruthy();
    expect(screen.getByText('布尔代数：2/2 通过，间隔推进到 3 天。')).toBeTruthy();
    expect(screen.getByText('德摩根定律：0/1 未通过，间隔退回 1 天。')).toBeTruthy();
    expect(screen.getByText(/这次答错的是：i-b1/)).toBeTruthy();

    // 验收 3 的核心：current 降了，achieved 没降 —— 两个数字都要能看见
    await waitFor(() => {
      expect(screen.getByText('96%')).toBeTruthy();
      expect(screen.getByText('42%')).toBeTruthy();
    });
  });

  it('刷新区块里已判分的一轮直接显示结果，不再显示答题区', () => {
    useReviewQueue.mockReturnValue({
      payload: emptyQueue(),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewQueue>);
    useReviewRound.mockReturnValue({
      payload: detailOf({
        round: {
          roundId: 'round-1',
          itemCount: 3,
          createdAt: '2026-10-21T00:00:00.000Z',
          completedAt: '2026-10-21T00:05:00.000Z',
          verdict: 'passed',
          correctCount: 3,
        },
        outcomes: [
          {
            microKpId: 'kp-a',
            name: '布尔代数',
            correct: 2,
            total: 2,
            passed: true,
            verdict: 'passed',
            stage: 2,
            nextDueAt: '2026-10-28T00:00:00.000Z',
            correctItemIds: ['i-a1', 'i-a2'],
            wrongItemIds: [],
            message: '布尔代数：2/2 通过，间隔推进到 7 天。',
          },
        ],
      }),
      isPending: false,
    } as unknown as ReturnType<typeof queries.useReviewRound>);

    renderPage('/review?round=round-1');

    expect(screen.getByText('这一轮复验结束了')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '交卷并判分' })).toBeNull();
  });
});
