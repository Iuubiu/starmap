import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { http, HttpResponse } from 'msw';
import { ProbePanel } from './ProbePanel';
import { server } from '../test/msw';

/**
 * 票 10 的作答侧验收：追问面板。
 *
 * ## 这一层能测、后端测不了的三件事
 *
 * 1. **上限是给学生看的，不是给日志看的。** `2/3` 这个数字出现在屏幕上，
 *    学生才知道还剩几次；后端返回了 `ladder.level` 不代表界面把它显示出来了。
 * 2. **每一轮的账目都要留下。** 学生答完第二问还能看见第一问自己写过什么，
 *    否则「我上一轮说了啥」只能靠记忆 —— 而追问恰恰是在记忆最容易断的时候用。
 * 3. **揭晓之后不能再提问。** `action === 'reveal'` 说明状态机已经给了结论，
 *    这时输入框还能提交，就等于允许学生继续套话。
 *
 * ## 打桩约定
 *
 * `test/msw.ts` 的默认 `POST /agent/probes/:probeId/replies` 桩返回
 * 「part 对 → 提示升级到 2/3」。本文件多条用例要用别的路径（揭晓、结束、
 * 失败），所以每条都显式覆盖。**别信默认桩**：默认桩用来让页面能渲染，
 * 不是用来表达语义的。
 */

const renderPanel = (
  overrides: Partial<Parameters<typeof ProbePanel>[0]> = {},
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) => {
  const props = {
    probeId: 'pr-test',
    microKpId: 'kp-bool',
    initialQuestion: '布尔代数里，A + A·B 里的哪一项是多余的？',
    initialLevel: 1,
    initialCap: 3,
    inputKind: 'free_text' as const,
    choices: [] as string[],
    ...overrides,
  };
  return render(
    <QueryClientProvider client={client}>
      <FluentProvider theme={webLightTheme}>
        <ProbePanel {...props} />
      </FluentProvider>
    </QueryClientProvider>,
  );
};

/** 覆盖一轮回复的桩。字段与 `ProbeTurnResponse` 契约一一对应。 */
const stubReply = (body: Record<string, unknown>) => {
  server.use(
    http.post('*/api/v1/agent/probes/:probeId/replies', () => HttpResponse.json(body)),
  );
};

const replyBody = (overrides: Record<string, unknown> = {}) => ({
  probeId: 'pr-test',
  microKpId: 'kp-bool',
  tier: 'P1',
  replyKind: 'wrong',
  action: 'hint',
  actionReason: '答错，升一级提示',
  question: '这一步该用哪个关系式？',
  ladder: {
    level: 2,
    cap: 3,
    maxLevelUsed: 2,
    consecutiveUnknown: 0,
    consecutiveWrong: 1,
    noProgress: 1,
    exited: false,
  },
  judge: { passed: true, reasons: [], questionCount: 1 },
  fallbackApplied: false,
  createdAt: '2026-10-20T04:00:00.000Z',
  ...overrides,
});

describe('追问面板把策略状态摆到学生面前', () => {
  it('显示当前阶梯与上限', () => {
    renderPanel({ initialLevel: 2, initialCap: 5 });
    expect(screen.getByText('提助等级 2/5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('提交一轮后阶梯上升，进度条跟着走', async () => {
    const user = userEvent.setup();
    stubReply(replyBody());
    renderPanel();

    await user.type(screen.getByLabelText('追问作答'), '我觉得是 A·B');
    await user.click(screen.getByRole('button', { name: '提交这一问的回答' }));

    await waitFor(() => expect(screen.getByText('提助等级 2/3')).toBeInTheDocument());
    // 服务端回来的新问题必须替换掉卡上的初始问题，而不是两句话同时在场
    expect(screen.getByText('这一步该用哪个关系式？')).toBeInTheDocument();
    expect(
      screen.queryByText('布尔代数里，A + A·B 里的哪一项是多余的？'),
    ).not.toBeInTheDocument();
  });

  it('一提交就清空输入框，避免同一句话被当成下一轮的回答', async () => {
    const user = userEvent.setup();
    stubReply(replyBody());
    renderPanel();

    const input = screen.getByLabelText('追问作答') as HTMLTextAreaElement;
    await user.type(input, '我觉得是 A·B');
    await user.click(screen.getByRole('button', { name: '提交这一问的回答' }));

    await waitFor(() => expect(input.value).toBe(''));
  });
});

describe('每一轮的账目都留下', () => {
  it('答两轮后两条记录都在，且能看出各自的判定', async () => {
    const user = userEvent.setup();
    stubReply(replyBody());
    renderPanel();

    await user.type(screen.getByLabelText('追问作答'), '第一轮的答案');
    await user.click(screen.getByRole('button', { name: '提交这一问的回答' }));
    await waitFor(() => expect(screen.getByLabelText('追问记录')).toBeInTheDocument());

    await user.type(screen.getByLabelText('追问作答'), '第二轮的答案');
    await user.click(screen.getByRole('button', { name: '提交这一问的回答' }));

    await waitFor(() => expect(screen.getByText('第 2 轮')).toBeInTheDocument());
    const trail = screen.getByLabelText('追问记录');
    // 第一轮的回答不能因为第二轮到来而被顶掉 —— 学习日志的语义是累积
    expect(trail.textContent).toContain('第一轮的答案');
    expect(trail.textContent).toContain('第二轮的答案');
    // 判定用的是中文标签，不是服务端的枚举值
    expect(trail.textContent).toContain('这步不对');
    expect(trail.textContent).not.toContain('wrong');
  });

  it('记录里不留服务端枚举值（学生看到的是中文）', async () => {
    const user = userEvent.setup();
    stubReply(replyBody({ replyKind: 'partial', action: 'probe_deeper' }));
    renderPanel();

    await user.type(screen.getByLabelText('追问作答'), '半对');
    await user.click(screen.getByRole('button', { name: '提交这一问的回答' }));

    await waitFor(() => expect(screen.getByLabelText('追问记录')).toBeInTheDocument());
    const trail = screen.getByLabelText('追问记录');
    expect(trail.textContent).toContain('部分对');
    expect(trail.textContent).not.toContain('partial');
    expect(trail.textContent).not.toContain('probe_deeper');
  });
});

describe('揭晓与结束之后不再提问', () => {
  it('揭晓之后输入框与提交按钮都消失', async () => {
    const user = userEvent.setup();
    stubReply(
      replyBody({
        action: 'reveal',
        replyKind: 'give_up',
        actionReason: '学生放弃',
        question: '好，我直接说结论，然后我们回看它为什么成立。',
        ladder: {
          level: 1,
          cap: 3,
          maxLevelUsed: 1,
          consecutiveUnknown: 0,
          consecutiveWrong: 0,
          noProgress: 0,
          exited: true,
        },
      }),
    );
    const onFinished = vi.fn();
    renderPanel({ onFinished });

    await user.type(screen.getByLabelText('追问作答'), '直接告诉我答案吧');
    await user.click(screen.getByRole('button', { name: '提交这一问的回答' }));

    await waitFor(() => expect(screen.getByText('追问已结束')).toBeInTheDocument());
    // 揭晓之后还能继续提交，等于允许学生继续套话
    expect(screen.queryByLabelText('追问作答')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '提交这一问的回答' }),
    ).not.toBeInTheDocument();
    // 结束时要通知外层（外层可能把产物换成「进度变化」卡）
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('揭晓后不显示进度条（阶梯已经用不上了）', async () => {
    const user = userEvent.setup();
    stubReply(
      replyBody({
        action: 'reveal',
        replyKind: 'give_up',
        ladder: {
          level: 3,
          cap: 3,
          maxLevelUsed: 3,
          consecutiveUnknown: 0,
          consecutiveWrong: 0,
          noProgress: 0,
          exited: true,
        },
      }),
    );
    renderPanel();

    await user.type(screen.getByLabelText('追问作答'), '看答案');
    await user.click(screen.getByRole('button', { name: '提交这一问的回答' }));

    await waitFor(() => expect(screen.getByText('追问已结束')).toBeInTheDocument());
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('选项题用文本作答，不用序号', () => {
  it('选中选项后提交的是选项文本', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    server.use(
      http.post('*/api/v1/agent/probes/:probeId/replies', async ({ request }) => {
        const body = (await request.json()) as { replyText: string };
        seen.push(body.replyText);
        return HttpResponse.json(replyBody());
      }),
    );

    renderPanel({ inputKind: 'choice', choices: ['A + A·B', 'A·B', 'A + B'] });

    // 序号只是显示给学生的前缀；提交上去的是选项本身的文本。
    await user.click(screen.getByRole('radio', { name: 'B. A·B' }));
    await user.click(screen.getByRole('button', { name: '提交这一问的回答' }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toBe('A·B');
  });
});

describe('提交失败时学生不丢输入', () => {
  it('服务端报错后输入框内容还在，可以重试', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/agent/probes/:probeId/replies', () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: '服务器内部错误' },
          { status: 500 },
        ),
      ),
    );
    renderPanel();

    const input = screen.getByLabelText('追问作答') as HTMLTextAreaElement;
    await user.type(input, '这句话不能丢');
    await user.click(screen.getByRole('button', { name: '提交这一问的回答' }));

    await waitFor(() =>
      expect(screen.getByText(/这一轮没能提交/)).toBeInTheDocument(),
    );
    // 提交失败还把输入框清空，学生就得重打一遍 —— 追问本来就累
    expect(input.value).toBe('这句话不能丢');
  });
});
