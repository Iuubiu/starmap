import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

/**
 * 跨语言展开的展示（t32）。
 *
 * ## 为什么这一定要在页面上看得见
 *
 * 英文书占全库六成叶知识点，而检索是字面匹配。给中文 query 加英文扩展词之后，
 * 调试器上会出现一个奇怪现象：**一句纯中文的提问命中了 Knoll 的英文正文**。
 * 如果不把展开记录摊开，看的人只能怀疑「是不是索引串了」—— 而这一页存在的
 * 意义恰恰是「不用猜」。
 */
describe('跨语言展开要说明「为什么一句中文命中了英文」', () => {
  it('默认桩带一条展开，页面把它摊开成「中文 → 英文」', async () => {
    const user = userEvent.setup();
    renderDebugger();
    await runQuery(user);

    const list = await screen.findByRole('list', { name: '中文术语到英文的展开' });
    expect(within(list).getByText('逻辑代数')).toBeInTheDocument();
    expect(within(list).getByText('Boolean algebra')).toBeInTheDocument();
    // 说明文字要交代「为什么需要这一步」，否则读者会以为这是噪音
    expect(screen.getByText(/英文书占全库六成叶知识点/)).toBeInTheDocument();
  });

  it('没有展开时不渲染这块（纯英文 query 不该看到空框）', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/api/v1/agent/retrieval/debug', () =>
        HttpResponse.json({
          query: 'germanium detector',
          microKpId: 'kp-bool',
          current: 0.66,
          gateTier: 'scaffold',
          totalMatched: 1,
          answerChunkCount: 0,
          excludedCount: 0,
          expansions: [],
          hits: [],
        }),
      ),
    );

    renderDebugger();
    await runQuery(user, 'germanium detector');

    await waitFor(() => expect(screen.getByText(/候选 1 条/)).toBeInTheDocument());
    expect(screen.queryByRole('list', { name: '中文术语到英文的展开' })).toBeNull();
    expect(screen.queryByText(/已按术语表扩展到英文/)).toBeNull();
  });

  it('同一个术语展开出多个英文写法时逐条列出，条数说的是「术语数」不是「条数」', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/api/v1/agent/retrieval/debug', () =>
        HttpResponse.json({
          query: '多道分析器',
          microKpId: 'kp-bool',
          current: 0.66,
          gateTier: 'scaffold',
          totalMatched: 0,
          answerChunkCount: 0,
          excludedCount: 0,
          expansions: [
            { zh: '多道分析器', en: 'Multichannel analyzer' },
            { zh: '多道分析器', en: 'THE MULTICHANNEL ANALYZER' },
            { zh: '死时间', en: 'Dead Time' },
          ],
          hits: [],
        }),
      ),
    );

    renderDebugger();
    await runQuery(user, '多道分析器与死时间');

    const list = await screen.findByRole('list', { name: '中文术语到英文的展开' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    // 3 条展开但只有 2 个术语 —— 标题说的是术语数
    expect(screen.getByText(/认出了 2\s*个术语/)).toBeInTheDocument();
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

  /**
   * 这是一条「永远在转圈」的回归测试。
   *
   * `useRetrievalDebug` 的 `enabled` 是 `Boolean(query && microKpId)`，而 TanStack
   * Query v5 里**禁用查询的 status 恒为 `'pending'`**（不是 `'success'`）——
   * 于是 `debug.isPending` 从挂载到卸载一直是 true，页面永远显示「检索中…」。
   * 屏幕阅读器会把这句话念给一个根本没发过请求的页面。
   *
   * 修法是把 `isPending` 换成 `isFetching`（后者只在实际有请求在飞时为真）。
   * 断言用 `queryByRole` 而不是 `getByRole`：后者在元素不存在时自己就报错，
   * 但报的是「找不到 progressbar」，说不清是「没转圈」还是「整块没渲染」。
   */
  it('从未检索过时不显示「检索中…」的假加载态', async () => {
    renderWith('kp-bool');
    await screen.findByLabelText('检索词');

    expect(screen.queryByRole('progressbar', { name: /检索中/ })).toBeNull();
    expect(screen.queryByText('检索中…')).toBeNull();
  });

  it('真正在检索时才显示加载态，请求落地后消失', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.get('*/api/v1/agent/retrieval/debug', async () => {
        await gate;
        // 必须给完整形状：`DebugResult` 直接读 `payload.hits.filter(...)`，
        // 少了 hits 会在渲染时抛 TypeError（Vitest 报成 unhandled error）。
        // 同时提醒：这个抛错不会让任何一条测试变红 —— 断言已经先跑完了。
        // t32 起 `expansions` 也是必填数组，同理。
        return HttpResponse.json({
          query: '布尔代数',
          microKpId: 'kp-bool',
          current: 0.66,
          gateTier: 'scaffold',
          totalMatched: 0,
          answerChunkCount: 0,
          excludedCount: 0,
          expansions: [],
          hits: [],
        });
      }),
    );

    renderWith('kp-bool');
    await runQuery(user);

    // 请求飞在路上：这一次必须真的有加载态（否则修法就把真加载也一并去掉了）
    expect(await screen.findByText('检索中…')).toBeInTheDocument();
    release?.();
    await waitFor(() => expect(screen.queryByText('检索中…')).toBeNull());
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
