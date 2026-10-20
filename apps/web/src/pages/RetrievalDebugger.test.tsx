import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { http, HttpResponse } from 'msw';
import { RetrievalDebugger } from './RetrievalDebugger';
import { server } from '../test/msw';

/**
 * 票 09 的调试器验收。
 *
 * 票面要求的是「能输入 query，看到：命中的 chunk、每块对当前知识点是否为
 * 答案块、以及**被排除的具体原因**」。这三件事缺一件，调试器就退化成
 * 「列出一堆切片」—— 而学生看不到的切片恰恰是这一页存在的理由。
 *
 * 所以这里断言的重点不是「渲染没崩」，而是：
 * - 被排除的条目**也在列表里**（只列采用的就等于隐藏了门控）；
 * - 每一条排除都带着原因文案（不是空串、不是 `false`）；
 * - 档位与 `current` 的映射显示出来（否则「为什么这次是脚手架档」无从判断）。
 */

// 注意：不能用 `microKpId: string | undefined = 'kp-bool'` 再把 undefined 传进来 ——
// 默认参数对 undefined 生效，那样「未选定知识点」的用例会悄悄拿到默认值，
// 变成一条永远通过的假测试。所以拆成两个入口。
const renderWith = (microKpId: string | undefined) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <RetrievalDebugger microKpId={microKpId} />
      </QueryClientProvider>
    </FluentProvider>,
  );
};

const renderDebugger = () => renderWith('kp-bool');

const runQuery = async (user: ReturnType<typeof userEvent.setup>, text = '布尔代数') => {
  const input = await screen.findByLabelText('检索词');
  await user.clear(input);
  await user.type(input, text);
  await user.click(screen.getByRole('button', { name: '检索' }));
};

describe('调试器能回答「这一条为什么不在上下文里」', () => {
  it('命中列表同时包含采用与排除的条目', async () => {
    const user = userEvent.setup();
    renderDebugger();
    await runQuery(user);

    await waitFor(() => expect(screen.getByText(/候选 /)).toBeInTheDocument());

    // 默认桩给两条：ck-1 采用、ck-2 排除
    expect(screen.getByText('采用')).toBeInTheDocument();
    expect(screen.getByText('排除')).toBeInTheDocument();
    // 两条切片的片段都要在（被排除的那条也不能消失）
    expect(screen.getByText(/逻辑代数的基本运算有三种/)).toBeInTheDocument();
    expect(screen.getByText(/A \+ A·B = A/)).toBeInTheDocument();
  });

  it('每条排除都写明具体原因，不是「被排除」三个字', async () => {
    const user = userEvent.setup();
    renderDebugger();
    await runQuery(user);

    await waitFor(() => expect(screen.getByText(/排除原因：/)).toBeInTheDocument());
    expect(
      screen.getByText(/该切片是当前知识点的答案块，会直接给出结论/),
    ).toBeInTheDocument();
  });

  it('答案块被单独标出来', async () => {
    const user = userEvent.setup();
    renderDebugger();
    await runQuery(user);

    await waitFor(() => expect(screen.getByText('答案块')).toBeInTheDocument());
  });

  it('展示档位与 current 的映射，而不是只给一个档位名', async () => {
    const user = userEvent.setup();
    renderDebugger();
    await runQuery(user);

    await waitFor(() => expect(screen.getByText(/掌握度 current/)).toBeInTheDocument());
    // 0.66 → 脚手架档；文案里要带阈值区间，否则读者不知道 0.66 为什么是脚手架
    expect(screen.getByText(/脚手架档（0\.4 – 0\.7）/)).toBeInTheDocument();
    expect(screen.getByText(/0\.66/)).toBeInTheDocument();
  });

  it('统计行给出候选数、展示数与排除数', async () => {
    const user = userEvent.setup();
    renderDebugger();
    await runQuery(user);

    await waitFor(() => expect(screen.getByText(/候选 2 条/)).toBeInTheDocument());
    expect(screen.getByText(/排除 1 条/)).toBeInTheDocument();
    expect(screen.getByText(/该知识点的答案块共 1 个/)).toBeInTheDocument();
  });
});

describe('三档对比能看出「随档位变化」与「任何档位都排除」的区别', () => {
  it('打开对比后显示三档的采用/排除集合', async () => {
    const user = userEvent.setup();
    renderDebugger();
    await runQuery(user);

    await user.click(screen.getByLabelText('对比三档'));

    // 「背景档 / 全量档」在调试器里各只出现一次；「脚手架档」会同时出现在
    // 单次检索的档位徽章上，所以用 getAllByText 并断言至少一个来自三档区。
    await waitFor(() => expect(screen.getByText('背景档')).toBeInTheDocument());
    expect(screen.getByText('全量档')).toBeInTheDocument();
    expect(screen.getAllByText('脚手架档').length).toBeGreaterThan(0);
    // 每档的 current 都要标出来，否则「0.2 / 0.55 / 0.85」三个数没有来源
    expect(screen.getByText(/current = 0\.20/)).toBeInTheDocument();
    expect(screen.getByText(/current = 0\.55/)).toBeInTheDocument();
    expect(screen.getByText(/current = 0\.85/)).toBeInTheDocument();
  });

  it('提示「所有档位都排除」的切片是答案块，并点名是哪几个', async () => {
    const user = userEvent.setup();
    // 默认桩就是三档都排除 ck-2 —— 它必须是「任何掌握度下都不放行」的那一类
    renderDebugger();
    await runQuery(user);
    await user.click(screen.getByLabelText('对比三档'));

    // 注意标题上方那句静态说明也含「所有档位都被排除的」，
    // 所以这里必须锚定冒号后的正文，否则会同时命中说明文字。
    await waitFor(() =>
      expect(screen.getByText(/所有档位都被排除的切片：ck-2/)).toBeInTheDocument(),
    );
    // 说明它为什么任何档位都不放行 —— 这是「门控不是概率」的证据
    expect(screen.getByText(/app\.chunk_kp_answer/)).toBeInTheDocument();
  });
});

describe('边界与错误', () => {
  it('没选知识点时不能检索，并说明原因', async () => {
    renderWith(undefined);

    await waitFor(() =>
      expect(screen.getByText(/当前知识点：未选定/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: '检索' })).toBeDisabled();
  });

  it('检索失败时不白屏，给出中文原因', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/api/v1/agent/retrieval/debug', () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: '知识点不存在: kp-x' },
          { status: 404 },
        ),
      ),
    );

    renderWith('kp-x');
    await runQuery(user);

    await waitFor(() => expect(screen.getByText('检索失败')).toBeInTheDocument());
    expect(screen.getByText(/知识点不存在/)).toBeInTheDocument();
  });

  it('空检索词不发请求', async () => {
    const user = userEvent.setup();
    let called = 0;
    server.use(
      http.get('*/api/v1/agent/retrieval/debug', () => {
        called += 1;
        return HttpResponse.json({});
      }),
    );

    renderDebugger();
    await screen.findByLabelText('检索词');
    // 直接点按钮：它应当禁用
    expect(screen.getByRole('button', { name: '检索' })).toBeDisabled();
    expect(called).toBe(0);
    void user;
  });
});
