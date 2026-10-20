/**
 * 票 16 前端：批量生成页的测试。
 *
 * 与 `MarketPage.test.tsx` 同一套做法 —— `vi.mock('../api/queries')` 把 hook
 * 换掉，只测「拿到数据后页面怎么反应」。真正的生成逻辑在服务端，这里不该
 * 重新验证一遍 AI 会不会出题。
 *
 * 但有一件事必须在**这一层**验：失败原因要真的显示出来。验收⑤是「可汇总
 * 查看」，如果后端算好了分类而页面不渲染，那条验收在用户视角就是没做。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { GenerationPage } from './GenerationPage';
import type { GenerationRun } from '../api/generated/model';

vi.mock('../api/queries', () => ({
  useGenerationRun: vi.fn(),
  useStartGeneration: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queries = await import('../api/queries') as any;

/** 造一个 react-query 形状的桩。页面只读这几个字段。 */
function queryStub<T>(payload: T | undefined) {
  return {
    data: payload === undefined ? undefined : { data: payload },
    payload,
    isPending: false,
    isError: false,
    isSuccess: payload !== undefined,
    error: null,
  };
}

function mutationStub<TData>(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null as unknown,
    data: undefined as TData | undefined,
    ...overrides,
  };
}

function renderPage(path = '/market/generate') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/market/generate" element={<GenerationPage />} />
            <Route path="/market" element={<div>关卡市场占位</div>} />
            <Route path="/level/:levelId" element={<div>播放器占位</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
}

/** 带着 runId 进页面 —— 相当于「刷新后接着看同一批」，页面从 URL 读它。 */
const withRun = () => renderPage('/market/generate?runId=run-abc');

function makeTask(over: Partial<GenerationRun['tasks'][number]> = {}): GenerationRun['tasks'][number] {
  return {
    taskId: 't-1',
    microKpId: 'kp-bool',
    microKpName: '布尔代数',
    status: 'succeeded',
    failureKind: null,
    failureMessage: null,
    failureDetail: null,
    levelId: 'lv-ai-kp-bool',
    levelTitle: '布尔代数：AI 生成关卡',
    itemCount: 1,
    attempts: 1,
    durationMs: 2100,
    ...over,
  };
}

function makeRun(over: Partial<GenerationRun> = {}): GenerationRun {
  return {
    runId: 'run-abc',
    requestedCount: 1,
    succeededCount: 1,
    failedCount: 0,
    concurrency: 4,
    tasks: [makeTask()],
    failures: [],
    createdAt: '2026-10-20T08:00:00.000Z',
    finishedAt: '2026-10-20T08:00:05.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queries.useGenerationRun.mockReturnValue(queryStub(undefined));
  queries.useStartGeneration.mockReturnValue(mutationStub());
});

describe('GenerationPage（票 16 的前端面）', () => {
  it('还没发起时不显示任何运行详情', () => {
    renderPage();
    expect(screen.getByText('AI 批量生成关卡')).toBeTruthy();
    expect(screen.queryByText(/逐条结果/)).toBeNull();
  });

  it('页面上写着生成的题只进练习池（验收④的用户可见面）', () => {
    renderPage();
    expect(screen.getByText(/生成的题只会进练习池，不会进判定池/)).toBeTruthy();
    expect(screen.getByText(/practice/)).toBeTruthy();
  });

  it('空输入点「开始生成」时提示，不发请求', async () => {
    const mutate = vi.fn();
    queries.useStartGeneration.mockReturnValue(mutationStub({ mutate }));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(screen.getByText(/先填至少一个知识点 id/)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('填了 id 后把逗号/换行/顿号都当分隔符，去掉空项再发', async () => {
    const mutate = vi.fn();
    queries.useStartGeneration.mockReturnValue(mutationStub({ mutate }));
    renderPage();

    await userEvent.type(screen.getByLabelText('知识点 id'), 'kp-bool, kp-kmap、　kp-logic');
    await userEvent.click(screen.getByRole('button', { name: '开始生成' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      microKpIds: ['kp-bool', 'kp-kmap', 'kp-logic'],
    });
  });

  it('成功的一批列出每个知识点、题数与关卡标题，并能点进播放器', async () => {
    queries.useGenerationRun.mockReturnValue(queryStub(makeRun()));
    withRun();

    expect(screen.getByText('布尔代数')).toBeTruthy();
    expect(screen.getByText('kp-bool')).toBeTruthy();
    expect(screen.getByText(/1 道题 · 《布尔代数：AI 生成关卡》/)).toBeTruthy();
    expect(screen.getByText('这一批全部生成成功')).toBeTruthy();

    // 「打开这一关」真的导航到播放器（验收：AI 关卡与内置关卡走同一个播放器）
    await userEvent.click(screen.getByRole('button', { name: '打开这一关' }));
    expect(screen.getByText('播放器占位')).toBeTruthy();
  });

  it('失败项逐条显示分类、原文与字段级明细（验收⑤）', async () => {
    queries.useGenerationRun.mockReturnValue(
      queryStub(
        makeRun({
          requestedCount: 2,
          succeededCount: 1,
          failedCount: 1,
          tasks: [
            makeTask(),
            makeTask({
              taskId: 't-2',
              microKpId: 'kp-en',
              microKpName: '英文知识点',
              status: 'failed',
              failureKind: 'language_not_compliant',
              failureMessage: '题干只有 2 个汉字，低于下限 8',
              failureDetail: [
                { path: 'items.0.stem', message: '题干必须用中文：What is a gate?' },
                { path: 'items.0.explainCorrect', message: '解析必须用中文' },
              ],
              levelId: null,
              levelTitle: null,
              itemCount: 0,
            }),
          ],
          failures: [
            {
              kind: 'language_not_compliant',
              count: 1,
              sample: '题干只有 2 个汉字，低于下限 8',
            },
          ],
        }),
      ),
    );
    withRun();

    // 汇总区：分类翻成人话 + 条数 + 样例
    expect(screen.getByText('失败原因汇总')).toBeTruthy();
    // 同一句分类文案出现两次是对的：汇总区一次（「有 1 条是这个原因」），
    // 逐条区一次（「这一条是这个原因」）。两处回答的是不同的问题。
    expect(screen.getAllByText('题干或解析不是中文').length).toBe(2);
    expect(screen.getByText('1 条')).toBeTruthy();
    // 原文同样两处：汇总区的「典型报错」与逐条区的「这一条的报错」。
    expect(screen.getAllByText('题干只有 2 个汉字，低于下限 8').length).toBe(2);

    // 逐条区：字段级明细指向具体字段
    expect(screen.getByText(/items\.0\.stem：题干必须用中文/)).toBeTruthy();
    expect(screen.getByText(/items\.0\.explainCorrect：解析必须用中文/)).toBeTruthy();

    // 整批的定性：部分成功，不是「失败了」
    expect(screen.getByText(/这一批部分成功/)).toBeTruthy();
  });

  it('还在跑时提示会自己刷新，且不把未完成当成成功', async () => {
    queries.useGenerationRun.mockReturnValue(
      queryStub(
        makeRun({
          requestedCount: 2,
          succeededCount: 0,
          failedCount: 0,
          tasks: [
            makeTask({ taskId: 't-1', status: 'succeeded' }),
            makeTask({ taskId: 't-2', microKpId: 'kp-2', status: 'running', levelId: null }),
          ],
        }),
      ),
    );
    withRun();
    expect(screen.getByText(/还在跑… 这一页会自己刷新/)).toBeTruthy();
    expect(screen.getByText('生成中')).toBeTruthy();
  });

  it('全部失败时定性为失败，且不给「打开这一关」的入口', async () => {
    queries.useGenerationRun.mockReturnValue(
      queryStub(
        makeRun({
          requestedCount: 1,
          succeededCount: 0,
          failedCount: 1,
          tasks: [
            makeTask({
              status: 'failed',
              failureKind: 'llm_error',
              failureMessage: 'upstream 503 Service Unavailable',
              levelId: null,
              levelTitle: null,
              itemCount: 0,
            }),
          ],
          failures: [{ kind: 'llm_error', count: 1, sample: 'upstream 503 Service Unavailable' }],
        }),
      ),
    );
    withRun();
    expect(screen.getByText('这一批全部失败')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '打开这一关' })).toBeNull();
  });

  it('发起失败时显示后端给的原话，而不是通用「出错了」', async () => {
    queries.useStartGeneration.mockReturnValue(
      mutationStub({ error: new Error('这些知识点不存在：kp-typo') }),
    );
    renderPage();
    expect(screen.getByText(/发起失败：这些知识点不存在：kp-typo/)).toBeTruthy();
  });
});
