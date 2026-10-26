import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import { http, HttpResponse } from 'msw';
import { HomePage } from './HomePage';
import { server, sseTurn } from '../test/msw';

/**
 * 票 08 在前端这一侧的验收。
 *
 * 后端接口测试已经证明了「响应里没有内部推理」。这里要证明的是**它也没有
 * 进 DOM** —— 这两件事不等价：一个字段没被渲染，也可能被写进 `data-*`、
 * `title`、`aria-label` 或 React key 里，然后出现在页面源码或调试面板上。
 * 所以断言的是 `container.textContent` 与 `innerHTML` 的整体，不是某个节点。
 *
 * 另外两条也只有在这一层能测：
 * - 「一次只有一张卡」：换一轮之后旧卡必须消失，而不是两端都留在 DOM 里
 *   靠 CSS 藏起来（那样「看」是看不到，但复制全文还在）。
 * - 「历史是学习日志」：日志条目不叫「消息」，也不按对话气泡渲染。
 *
 * ## 打桩约定（写断言前必须读）
 *
 * `test/msw.ts` 的**默认** `POST /agent/turns/stream` 桩返回的是**关卡卡**
 * （`makeTurn()`），因为默认行为应该是「最常见的那条路」。本文件多数用例
 * 关心追问卡或降级卡，所以每条都显式 `stubTurn(...)` 覆盖。
 *
 * 曾经有七条测试红在这儿：断言按追问卡写、桩却返回关卡卡。报错是
 * `Unable to find an element with the text: ...`，看起来像实现缺文案，
 * 实际是**前提数据不对**。`getByText` 对这三种情况报的错一模一样：
 * 文案不该存在 / 组件没渲染 / 组件渲染了但数据不对。
 */

const renderHome = (path = '/') => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/map" element={<div>知识地图占位</div>} />
            <Route path="/map/:microKpId" element={<div>知识点占位</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

/** 一张追问卡的完整回合响应。 */
const probeTurn = (extra: Record<string, unknown> = {}) => ({
  turnId: 'turn-9',
  sessionId: 'ses-test',
  artifact: {
    kind: 'probe_form',
    cardId: 'turn-9',
    createdAt: '2026-10-20T04:00:00.000Z',
    title: '这一步你怎么判断',
    rationale: '你在问噪声，先确认这一步涉及的物理量。',
    probeId: 'pr-1',
    microKpId: 'kp-bool',
    question: '这条定律里哪个量是多余的？',
    ladderLevel: 2,
    ladderCap: 3,
    inputKind: 'free_text',
    choices: [],
    actions: [
      { kind: 'retry', label: '再问一次', enabled: true },
      { kind: 'show_evidence', label: '看依据', enabled: true },
    ],
  },
  errorCard: null,
  degraded: false,
  retryCount: 0,
  visibleResponse: '这一轮我们从一个更小的问题开始。',
  visibleResponseKind: 'statement',
  languageCheck: { ok: true, offenders: [] },
  actions: [
    { kind: 'retry', label: '再问一次', enabled: true },
    { kind: 'show_evidence', label: '看依据', enabled: true },
  ],
  createdAt: '2026-10-20T04:00:00.000Z',
  ...extra,
});

/**
 * 把 POST /agent/turns/stream 换成固定的响应体。
 *
 * 参数类型是 `Record<string, unknown>` 而不是 `unknown`：响应体要过
 * `sseTurn` 包成 SSE 帧，宽索引签名让调用处的字面量能带上 `...spread`。
 */
const stubTurn = (body: Record<string, unknown>) =>
  server.use(http.post('*/api/v1/agent/turns/stream', () => sseTurn(body)));

/** 输入一句话并点底部那颗提交按钮（等它变成 enabled 再点）。 */
const submitTurn = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  const box = await screen.findByLabelText('这一轮想说的话');
  await user.clear(box);
  await user.type(box, text);
  const button = screen.getByRole('button', { name: '提交这一轮' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
};

describe('首页不是聊天界面', () => {
  it('首屏没有消息气泡列表，只有输入框与一句引导', async () => {
    // 默认桩里有一条日志记录；这条用例要的是真正的空态
    server.use(
      http.get('*/api/v1/agent/turns', ({ request }) =>
        HttpResponse.json({
          sessionId: new URL(request.url).searchParams.get('sessionId') ?? '',
          items: [],
          nextCursor: null,
        }),
      ),
    );
    renderHome();

    expect(await screen.findByLabelText('这一轮想说的话')).toBeInTheDocument();
    // `TurnLog` 在 isPending 时显示 Spinner；等它落定再断言空态文案
    await waitFor(() => expect(screen.getByText(/还没有记录/)).toBeInTheDocument());

    const html = document.body.innerHTML;
    expect(html).not.toContain('气泡');
    expect(html).not.toContain('消息流');
  });

  it('输入区按 B5 收成一整块：没有知识点细条、没有框下工具条', async () => {
    const { container } = renderHome();
    expect(await screen.findByLabelText('这一轮想说的话')).toBeInTheDocument();
    /*
     * 知识点细条已按 B5 摘除（票 01），名字展示由票 03 的右栏「正在学」卡接回。
     * 这里断言类名而不是文案：「当前知识点」「去地图选」都可能随 03 回到页面上
     * （03 要在「正在学」卡里保留「去地图选」入口），而 `.sm-composer-context`
     * 属于 Composer 的 context 插槽，只会跟着首页的传参出现或消失。
     */
    expect(container.querySelector('.sm-composer-context')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('输入区工具')).not.toBeInTheDocument();
  });

  it('提交一句话后，中央出现且只出现一张卡', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    // 默认桩返回关卡卡（`makeTurn()`），这条用例正好用它
    await submitTurn(user, '我想学噪声');

    await waitFor(() => expect(screen.getByText('布尔代数的三条基本律')).toBeInTheDocument());
    // 卡片自己的种类标签（`CardShell` 的 kindLabel），与日志里的 `ARTIFACT_KIND_LABEL` 不同
    expect(screen.getByText('关卡')).toBeInTheDocument();

    // 一次只有一张卡。
    // 注意不能拿整个 container 的文本查「进度」二字 —— 页面标题那句引导语里
    // 本来就有「进度变化」，那样断言会因无关文案失败。改成按**卡片的标题**查。
    expect(screen.queryByRole('heading', { name: '这一步你怎么判断' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it('换一轮时旧卡被替换，不是堆叠', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/v1/agent/turns/stream', async ({ request }) => {
        const body = (await request.json()) as { utterance: string };
        const second = body.utterance.includes('第二句');
        return sseTurn(
          probeTurn({
            turnId: second ? 'turn-2' : 'turn-1',
            artifact: {
              ...(probeTurn().artifact as Record<string, unknown>),
              cardId: second ? 'turn-2' : 'turn-1',
              title: second ? '第二张卡' : '第一张卡',
              // probeId 必须不同：相同会让 ProbePanel 复用同一个 key，
              // 那样测出来的「替换」其实是组件没重挂载。
              probeId: second ? 'pr-2' : 'pr-1',
            },
          }),
        );
      }),
    );

    renderHome();

    await submitTurn(user, '第一句');
    await waitFor(() => expect(screen.getByText('第一张卡')).toBeInTheDocument());

    await submitTurn(user, '第二句');
    await waitFor(() => expect(screen.getByText('第二张卡')).toBeInTheDocument());

    // 旧卡必须真的离开 DOM，而不是被 CSS 藏起来
    expect(screen.queryByText('第一张卡')).not.toBeInTheDocument();
  });
});

describe('内部推理不得进入 DOM', () => {
  it('响应里就算带了 reasoning/answer，页面上也一个字都找不到', async () => {
    const user = userEvent.setup();
    stubTurn({
      ...probeTurn(),
      // 模拟「后端漏了一处」：故意把脏字段加回来
      reasoning: '学生完全不会，直接给答案最快',
      answer: '120 个电子',
      artifact: {
        ...(probeTurn().artifact as Record<string, unknown>),
        _debug: { model: 'gpt-fake' },
      },
    });

    const { container } = renderHome();
    await submitTurn(user, '我卡住了');
    await waitFor(() => expect(screen.getByText('这一步你怎么判断')).toBeInTheDocument());

    // 三个层面都查：可见文本、原始 HTML（含属性）、序列化后的 DOM
    expect(container.textContent ?? '').not.toContain('直接给答案最快');
    expect(container.textContent ?? '').not.toContain('120 个电子');
    expect(container.innerHTML).not.toContain('gpt-fake');
    expect(container.innerHTML).not.toContain('reasoning');
    expect(container.innerHTML).not.toContain('_debug');
  });
});

describe('降级不白屏：错误卡要说人话', () => {
  /**
   * 降级轮。
   *
   * `actions` 必须一起覆盖：`HomePage` 渲染的是**响应里的** actions，
   * 不是写死的。只改 `errorCard` 而沿用 `probeTurn()` 的 action（`再问一次`），
   * 断言就会去找一个不存在的「再试一次」。
   */
  const degradedTurn = (overrides: Record<string, unknown> = {}) =>
    probeTurn({
      turnId: 'turn-bad',
      artifact: null,
      degraded: true,
      retryCount: 1,
      errorCard: {
        title: '这次没能生成卡片',
        detail: '模型返回的不是可解析的结构化数据。你可以换个说法再问一次。',
        retryable: true,
        debugId: 'abc123def456',
      },
      visibleResponse: '这次我没能把你的问题变成一张卡片。',
      visibleResponseKind: 'statement',
      actions: [
        { kind: 'retry', label: '再试一次', enabled: true },
        { kind: 'show_evidence', label: '看依据', enabled: true },
      ],
      ...overrides,
    });

  it('降级轮显示错误卡、可念的编号与「再试一次」', async () => {
    const user = userEvent.setup();
    stubTurn(degradedTurn());
    renderHome();

    await submitTurn(user, '随便问问');

    await waitFor(() => expect(screen.getByText('这次没能生成卡片')).toBeInTheDocument());
    // 学生报问题时能念出来的编号
    expect(screen.getByText(/abc123def456/)).toBeInTheDocument();
    // 仍然是中文的、可读的说明，不是异常栈
    expect(screen.getByText(/换个说法再问一次/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再试一次' })).toBeInTheDocument();
    // 降级轮不该渲染任何产物卡
    expect(screen.queryByText('追问')).not.toBeInTheDocument();
  });

  it('「再试一次」重发同一句话，而不是让学生重打', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    server.use(
      http.post('*/api/v1/agent/turns/stream', async ({ request }) => {
        const body = (await request.json()) as { utterance: string };
        seen.push(body.utterance);
        return sseTurn(seen.length === 1 ? degradedTurn() : probeTurn({ turnId: 'turn-2' }));
      }),
    );

    renderHome();
    await submitTurn(user, '噪声从哪里来');
    await waitFor(() => expect(screen.getByText('这次没能生成卡片')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '再试一次' }));
    await waitFor(() => expect(screen.getByText('这一步你怎么判断')).toBeInTheDocument());

    // 第二次请求的 utterance 与第一次逐字相同
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[1]).toBe('噪声从哪里来');
  });

  it('提交本身失败（500）时不白屏，输入内容也不丢', async () => {
    const user = userEvent.setup();
    server.use(
      // 500 的错误体走 JSON 没关系：流式客户端对 !res.ok 先短路再读类型
      http.post('*/api/v1/agent/turns/stream', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '服务器内部错误' }, { status: 500 }),
      ),
    );

    renderHome();
    await submitTurn(user, '这句不能丢');

    await waitFor(() => expect(screen.getByText(/这一轮没能提交/)).toBeInTheDocument());
    expect(screen.getByText(/你的话没有丢/)).toBeInTheDocument();
    // 输入框里的内容必须还在（否则学生要重打）
    expect(screen.getByLabelText('这一轮想说的话')).toHaveValue('这句不能丢');
  });
});

describe('「看依据」在页面上展开，被排除的条目也要看得见', () => {
  it('点开依据后列出采用与排除两种条目，排除项带原因', async () => {
    const user = userEvent.setup();
    stubTurn(probeTurn());
    renderHome();

    await submitTurn(user, '布尔代数');
    await waitFor(() => expect(screen.getByText('这一步你怎么判断')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '看依据' }));

    await waitFor(() => expect(screen.getByText(/本轮检索到/)).toBeInTheDocument());
    expect(screen.getByText('采用')).toBeInTheDocument();
    expect(screen.getByText('排除')).toBeInTheDocument();
    // 被排除的具体原因 —— 票 09 的验收原文
    expect(screen.getByText(/排除原因：/)).toBeInTheDocument();
    // 答案块必须被标出来
    expect(screen.getByText('答案块')).toBeInTheDocument();
  });
});

describe('语言检查：混入未加注英文要标红', () => {
  it('languageCheck.ok=false 时给出提示并列出违规词', async () => {
    const user = userEvent.setup();
    stubTurn(
      probeTurn({
        languageCheck: { ok: false, offenders: ['energy resolution', 'setup'] },
      }),
    );
    renderHome();

    await submitTurn(user, '这是什么');

    await waitFor(() => expect(screen.getByText(/未加注的英文/)).toBeInTheDocument());
    expect(screen.getByText(/energy resolution/)).toBeInTheDocument();
  });
});

describe('学习日志是历史，不是消息流', () => {
  it('日志条目点开后回看那一轮（走单轮接口，不重新调模型）', async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => expect(screen.getByText('学习日志')).toBeInTheDocument());
    const entry = await screen.findByRole('button', { name: /第 1 轮/ });
    await user.click(entry);

    // 回看走 GET /agent/turns/:turnId，桩返回关卡卡标题
    await waitFor(() => expect(screen.getByText('布尔代数的三条基本律')).toBeInTheDocument());
  });

  it('「开新会话」清空当前卡与输入', async () => {
    const user = userEvent.setup();
    stubTurn(probeTurn());
    renderHome();

    await submitTurn(user, '第一句');
    await waitFor(() => expect(screen.getByText('这一步你怎么判断')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '开新会话' }));

    await waitFor(() => expect(screen.queryByText('这一步你怎么判断')).not.toBeInTheDocument());
    expect(screen.getByLabelText('这一轮想说的话')).toHaveValue('');
  });
});

describe('无障碍：同页两颗「提交」不能同名', () => {
  it('追问面板的提交按钮与底部输入框的提交按钮有各自的名字', async () => {
    const user = userEvent.setup();
    stubTurn(probeTurn());
    renderHome();

    await submitTurn(user, '我卡住了');
    await waitFor(() => expect(screen.getByText('这一步你怎么判断')).toBeInTheDocument());

    // 同页两颗按钮：一颗提交一句话，一颗提交对追问的回答。
    // 同名会让屏幕阅读器报出两个一模一样的按钮，用户不知道点哪个。
    expect(screen.getByRole('button', { name: '提交这一问的回答' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '提交这一轮' })).toHaveLength(1);
  });

  it('输入框是 textarea 且有可读标签', async () => {
    renderHome();
    const box = await screen.findByLabelText('这一轮想说的话');
    expect(box.tagName).toBe('TEXTAREA');
  });

  it('日志条目是 button 而不是 div，键盘可聚焦', async () => {
    renderHome();
    const entry = await screen.findByRole('button', { name: /第 1 轮/ });
    expect(entry).toHaveAttribute('tabindex', '0');
  });
});

/**
 * 票 12：档位必须进到「真实发给智能体」的那次请求里。
 *
 * 这一条只有在这一层能测：后端测试能证明「给了 tier，提示词里就有水平档」，
 * 但证明不了**页面给的是哪一档**。写死 `'P1'` 时页面渲染一切正常 ——
 * 关卡按 P3 展开、摘要行写着「每题 1 次」，而每一轮对话仍把学习者当零基础。
 */
describe('提交回合时带的是当前档位，不是写死的 P1（票 12）', () => {
  const captureTier = () => {
    const seen: Array<{ tier?: string; utterance?: string }> = [];
    server.use(
      http.post('*/api/v1/agent/turns/stream', async ({ request }) => {
        seen.push((await request.json()) as { tier?: string; utterance?: string });
        return sseTurn(probeTurn());
      }),
    );
    return seen;
  };

  it('档位是 P3 时，请求体里的 tier 也是 P3', async () => {
    const user = userEvent.setup();
    const seen = captureTier();
    server.use(
      http.get('*/api/v1/tier', () =>
        HttpResponse.json({
          tier: 'P3',
          source: 'placement',
          params: {
            tier: 'P3',
            firstRoundShape: 'direct',
            ladder: { start: 3, cap: 5 },
            sessionNewKpLimit: 4,
            feedbackTiming: 'item_deferred_with_summary',
            attemptsPerItem: 1,
            masteryRule: { consecutiveCorrect: 1, requiresTransferItem: true },
          },
          label: '直接出题',
          description: '首轮直接给题目。',
        }),
      ),
    );

    renderHome();
    await submitTurn(user, '我想练题');

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.tier).toBe('P3');
  });

  it('档位接口还没回来/挂了时，回落 P1 而不是不发 tier', async () => {
    const user = userEvent.setup();
    const seen = captureTier();
    server.use(
      http.get('*/api/v1/tier', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '档位读不到' }, { status: 500 }),
      ),
    );

    renderHome();
    await submitTurn(user, '我想练题');

    await waitFor(() => expect(seen).toHaveLength(1));
    // 回落值必须显式出现在请求里（契约的 default 也在服务端兜底，但两层都写
    // 才不会被「某天把 default 删了」悄悄改成别的档）。
    expect(seen[0]!.tier).toBe('P1');
    // 反向对照：这句话本身没被降级分支吞掉。
    expect(seen[0]!.utterance).toBe('我想练题');
  });
});

/**
 * 初始焦点（`/?kp=<microKpId>`）：从知识点详情页「问助手」跳过来时，第一轮
 * 就要围着那个知识点转。
 *
 * 在此之前，首页的焦点**只能从上一张卡继承**，而冷启动时一张卡都没有 ——
 * 实测 10 轮对话都在推荐集里轮换，学生说「我想练布尔代数」不改变焦点。
 * 那个行为本身由后端的「未选定知识点」任务负责；这里只钉前端这一层：
 * 地址栏里给了 `kp`，就不能把它丢掉。
 */
describe('初始焦点来自地址栏', () => {
  const captureFocus = () => {
    const seen: Array<{ microKpId?: string | null; utterance?: string }> = [];
    server.use(
      http.post('*/api/v1/agent/turns/stream', async ({ request }) => {
        seen.push((await request.json()) as { microKpId?: string | null; utterance?: string });
        return sseTurn(probeTurn());
      }),
    );
    return seen;
  };

  it('地址栏带了 kp 时，第一轮请求体的 microKpId 就是它', async () => {
    const user = userEvent.setup();
    const seen = captureFocus();

    renderHome('/?kp=kp-kmap');
    await submitTurn(user, '给我一张这个知识点的题');

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.microKpId).toBe('kp-kmap');
    // 反向对照：这句话没被吞掉
    expect(seen[0]!.utterance).toBe('给我一张这个知识点的题');
  });

  it('没有 kp 参数时照旧发 null，不是发空串或 undefined', async () => {
    const user = userEvent.setup();
    const seen = captureFocus();

    renderHome();
    await submitTurn(user, '随便看看');

    await waitFor(() => expect(seen).toHaveLength(1));
    // `undefined` 会在 JSON 序列化时字段消失，契约校验就变成「缺字段」；
    // 服务端要的是显式的「没有选定」。
    expect(seen[0]).toHaveProperty('microKpId', null);
  });

  it('卡片回来之后，卡片自带的点接管 —— 焦点不会死在地址栏上', async () => {
    const user = userEvent.setup();
    const seen: Array<{ microKpId?: string | null; utterance?: string }> = [];
    server.use(
      http.post('*/api/v1/agent/turns/stream', async ({ request }) => {
        const body = (await request.json()) as { microKpId?: string | null; utterance?: string };
        seen.push(body);
        // 第二轮起，服务端按学生说的话改给了另一个点
        return sseTurn(probeTurn({ turnId: `turn-${seen.length}` }));
      }),
    );

    renderHome('/?kp=kp-kmap');
    await submitTurn(user, '第一句');
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.microKpId).toBe('kp-kmap');

    await submitTurn(user, '第二句');
    await waitFor(() => expect(seen).toHaveLength(2));
    // `probeTurn` 的卡带的是 `kp-bool`。学生换话题后，地址栏里那个旧参数
    // 不该继续劫持焦点 —— 否则他会一直拿到同一个知识点的题，而屏幕上
    // 已经写着另一个知识点的名字。
    expect(seen[1]!.microKpId).toBe('kp-bool');
  });

  it('票 03：/?kp= 带进来的点在右栏「正在学」卡里有名字与关卡入口', async () => {
    // 默认桩：/nodes 列表含 kp-bool，/nodes/:id 带 ancestors/source 与一个关卡。
    renderHome('/?kp=kp-bool');

    expect(await screen.findByRole('heading', { name: '正在学' })).toBeInTheDocument();
    // 名字走 HomePage 现有解析链（nodeItems 命中 kp-bool；列表回来前是裸 id，
    // 所以这里等它解析成名字，不与首帧赛跑）。恢复出来的关卡卡也会提到这个
    // 名字，所以把查询收在卡内（selector），不跟工作区比谁的匹配多。
    expect(
      await screen.findByText('布尔代数基本运算', { selector: '[data-study-now] .sm-study-kp' }),
    ).toBeInTheDocument();
    // 来源行与关卡入口由卡内 useNodeDetail 自取。票 08 起主行是章节路径，
    // 书名页码降为悬浮（title）——页面级只钉「两行都在卡里」，拼法细节在
    // NowLearningCard 的组件测试里。
    const path = screen.getByText('第 1 章 逻辑代数 · 第 1.2 节 布尔恒等式');
    expect(path).toBeInTheDocument();
    expect(path).toHaveAttribute('title');
    expect(await screen.findByRole('button', { name: '打开关卡' })).toBeInTheDocument();
  });

  it('焦点点不在节点列表那一页里时，仍按 id 单独取名字（展示位由 03 接回）', async () => {
    // 节点列表接口只回两条（`kp-bool` / `kp-kmap`），`kp-far` 不在其中 ——
    // 这正是真实库的情形：`?kp=` 带进来的点可能落在列表前 N 条之外。
    const detailCalls: string[] = [];
    server.use(
      http.get('*/api/v1/nodes/:id', ({ params }) => {
        detailCalls.push(String(params.id));
        return HttpResponse.json({
          node: {
            microKpId: params.id,
            name: '触发器与锁存器',
            state: 'unseen',
            percent: null,
            depth: 2,
            sourceTitle: null,
            page: null,
          },
          levels: [],
          ancestors: [],
        });
      }),
    );

    renderHome('/?kp=kp-far');

    /*
     * 名字解析链仍在：列表里没有的点会单独 GET /nodes/:id 取名字。
     * 名字的**展示位**（原输入框上方那枚徽标）已按 B5 摘除（票 01），
     * 由票 03 的右栏「正在学」卡接回；这里先钉住两件不受摘除影响的事：
     * 解析照常发生、裸 id 不进 DOM。
     */
    await waitFor(() => expect(detailCalls).toContain('kp-far'));
    expect(screen.queryByText('kp-far')).toBeNull();
  });
});
