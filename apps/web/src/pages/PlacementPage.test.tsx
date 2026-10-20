import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { delay, http, HttpResponse } from 'msw';
import { PlacementPage } from './PlacementPage';
import { server } from '../test/msw';

/**
 * 票 11 在前端这一侧的验收。
 *
 * ## 这一页最容易做假的地方
 *
 * 定级可以做成「点几下、显示一个档位」就交差：档位数字是从接口来的、
 * 界面渲染正常，测试断言「出现了 P2」——全绿。但票面要求的两件事都在
 * 那三行断言之外：
 *
 * 1. **定级结果必须能被复核**（验收 4）。所以这里断言作答之后**当场**
 *    就能看到正确答案与解析，以及结果页的逐题复核表同时列出「你选了什么」
 *    与「正确答案是什么」。只断言「有结果」的话，一个只显示档位的实现
 *    照样绿。
 * 2. **结果是临时的**（验收 5）。`provisional` 必须变成界面上的中文
 *    「临时档位」，而不是只存在于 JSON 里。被判低的人看不到「这个还会变」
 *    就会直接放弃。
 *
 * ## 打桩约定
 *
 * 全部桩用 `server.use(...)` 在本文件内安装（`setup.ts` 的 `afterEach` 会
 * 调 `server.resetHandlers()` 清掉）。**不动共享的 `test/msw.ts`**：
 * `onUnhandledRequest` 仍是 `'error'`，漏桩立刻红，这正是我们要的。
 *
 * 三条主线（自评 / 答题 / 结果）各有一套桩；用例显式覆盖自己那一段，
 * 而不是指望默认桩恰好满足断言。
 *
 * ## 为什么不用 `textContent` 断言 Fluent 组件
 *
 * Fluent 在 DOM 里留一份视觉隐藏副本给读屏，`textContent` 会把两份拼起来
 * 数出重复文字（票 08 踩过）。按钮/单选一律 `getByRole(..., { name })`。
 */

const TIER_LABEL_COPY = '你的临时档位';

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <PlacementPage />
      </QueryClientProvider>
    </FluentProvider>,
  );
};

// ---------------------------------------------------------------------------
// 桩数据
// ---------------------------------------------------------------------------

const questions = [
  {
    id: 'recent-study',
    prompt: '最近三个月里，你系统学过与电路、信号相关的课程吗？',
    options: [
      { id: 'none', label: '没有' },
      { id: 'some', label: '看过一点材料' },
      { id: 'course', label: '跟过一门课' },
      { id: 'done', label: '学完过一门课' },
      { id: 'many', label: '学过多门，还做过作业' },
    ],
  },
  {
    id: 'hand-calc',
    prompt: '像「已知电阻与温度，估算热噪声电压」这样的题，你现在能独立手算吗？',
    options: [
      { id: 'none', label: '完全不知道从哪下手' },
      { id: 'vague', label: '记得有公式但写不出来' },
      { id: 'formula', label: '查着公式能算但容易错' },
      { id: 'ok', label: '基本能算对' },
      { id: 'good', label: '能算，还能估算结果是否合理' },
    ],
  },
  {
    id: 'boolean',
    prompt: '给你一个布尔表达式，你能用代数化简法把它化成最简与或式吗？',
    options: [
      { id: 'none', label: '没听过这个方法' },
      { id: 'seen', label: '见过例题，自己动手会卡住' },
      { id: 'slow', label: '能做，但要多花些时间' },
      { id: 'most', label: '大部分题能一次做对' },
      { id: 'teach', label: '能做得又快又稳，还能给别人讲' },
    ],
  },
  {
    id: 'instruments',
    prompt: '示波器、信号发生器、万用表这类仪器，你实际动过手吗？',
    options: [
      { id: 'none', label: '没有碰过' },
      { id: 'demo', label: '只看别人演示过' },
      { id: 'lab', label: '实验课上按步骤用过' },
      { id: 'setup', label: '能自己搭一套测量' },
      { id: 'debug', label: '能自己搭，还能定位测量里的问题' },
    ],
  },
];

const selfAssessmentForm = () => ({
  questions,
  rationale:
    '这四道题问的是你最近**做过什么**，不是让你给自己打分。自评与真实能力的关系并不稳定，' +
    '所以它只用来把你的起点小幅挪动（最多半档），真正的档位由接下来的定级题决定。',
});

const item = (overrides: Record<string, unknown> = {}) => ({
  itemId: 'kp-noise-item-0',
  microKpId: 'kp-noise',
  microKpName: '噪声系数',
  stem: '噪声系数：这道题该选哪个方案？（第 1 题）',
  options: ['甲方案', '乙方案', '丙方案', '丁方案'],
  difficulty: 'medium',
  ...overrides,
});

const sessionState = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'plc-test',
  item: item(),
  answered: 0,
  correctCount: 0,
  probabilities: [0.32, 0.36, 0.32],
  posteriorSd: 0.81,
  stop: { stopped: false, reason: null },
  remainingItems: 20,
  ...overrides,
});

const answerBody = (overrides: Record<string, unknown> = {}) => ({
  itemId: 'kp-noise-item-0',
  correct: false,
  correctAnswer: 2,
  correctAnswerText: '丙方案',
  explanation: '正确答案是「丙方案」，因为这一项满足量纲与带宽要求。',
  whyWrong: '选「丁方案」是最常见的误判：它忽略了后级负载。',
  session: sessionState({ answered: 1, item: item({ itemId: 'kp-noise-item-1', stem: '噪声系数：第 2 题' }) }),
  ...overrides,
});

const statusBody = (overrides: Record<string, unknown> = {}) => ({
  tier: null,
  status: 'none',
  placedAt: null,
  rejudgeAfterAttempts: 5,
  attemptsSince: 0,
  shouldRejudge: false,
  lastRejudge: null,
  ...overrides,
});

const resultBody = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'plc-test',
  tier: 'P2',
  status: 'provisional',
  confidence: 0.58,
  lowConfidence: false,
  probabilities: [0.2, 0.6, 0.2],
  answered: 9,
  correctCount: 6,
  stopReason: 'sd',
  review: [
    {
      itemId: 'kp-noise-item-0',
      microKpId: 'kp-noise',
      stem: '噪声系数：这道题该选哪个方案？（第 1 题）',
      yourAnswerText: '丁方案',
      correctAnswerText: '丙方案',
      correct: false,
      difficulty: 'medium',
    },
    {
      itemId: 'kp-noise-item-1',
      microKpId: 'kp-noise',
      stem: '噪声系数：第 2 题',
      yourAnswerText: '甲方案',
      correctAnswerText: '甲方案',
      correct: true,
      difficulty: 'easy',
    },
  ],
  rejudgeAfterAttempts: 5,
  explanation:
    '你答了 9 道题，答对 6 道，系统对档位的判断已经足够确定，因此定为 P2。' +
    '这个结果是临时的：再答 5 题后会用你的真实学习数据重新判断，可能升也可能降。',
  ...overrides,
});

// ---------------------------------------------------------------------------
// 桩安装
// ---------------------------------------------------------------------------

/** 只装「档位状态」这一段的桩（页面首屏）。 */
function stubStatus(body: Record<string, unknown> = statusBody()) {
  server.use(http.get('*/api/v1/placement', () => HttpResponse.json(body)));
}

/** 自评问卷 + 提交自评。 */
function stubSelfAssessment() {
  server.use(
    http.get('*/api/v1/placement/self-assessment', () => HttpResponse.json(selfAssessmentForm())),
    http.post('*/api/v1/placement/self-assessment', () =>
      HttpResponse.json({ priorShift: 0.28, priorProbabilities: [0.26, 0.35, 0.39] }),
    ),
  );
}

/** 开一次定级（POST sessions）。 */
function stubStart(body: Record<string, unknown> = sessionState()) {
  server.use(http.post('*/api/v1/placement/sessions', () => HttpResponse.json(body)));
}

/** 提交一道作答。 */
function stubAnswer(body: Record<string, unknown> = answerBody()) {
  server.use(
    http.post('*/api/v1/placement/sessions/:sessionId/answers', () => HttpResponse.json(body)),
  );
}

/** 结果。 */
function stubResult(body: Record<string, unknown> = resultBody()) {
  server.use(
    http.get('*/api/v1/placement/sessions/:sessionId/result', () => HttpResponse.json(body)),
  );
}

/** 把页面推进到答题段：装齐状态/自评/开始三套桩并走完自评。 */
async function reachQuizStage(user: ReturnType<typeof userEvent.setup>) {
  stubStatus();
  stubSelfAssessment();
  stubStart();
  stubAnswer();
  renderPage();

  await user.click(await screen.findByRole('button', { name: '开始定级' }));

  for (const question of questions) {
    const group = await screen.findByRole('radiogroup', { name: new RegExp(question.prompt.slice(0, 8)) });
    const middle = question.options[2]!;
    await user.click(within(group).getByRole('radio', { name: middle.label }));
  }

  await user.click(screen.getByRole('button', { name: '提交自评' }));
  await user.click(await screen.findByRole('button', { name: '开始答题' }));
}

describe('首屏：档位状态与入口', () => {
  it('没定过级时说清「定级不是打分」，并给出去定级入口', async () => {
    stubStatus();
    renderPage();

    expect(await screen.findByText(/还没定过级/)).toBeInTheDocument();
    // 正向对照：这不是一个错误状态，页面上不该出现「读不到档位」
    expect(screen.queryByText(/读不到档位状态/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始定级' })).toBeInTheDocument();
  });

  it('已经定过级时显示档位与「临时档位」标记，并说明还差几题才能重判', async () => {
    stubStatus(
      statusBody({
        tier: 'P2',
        status: 'provisional',
        placedAt: '2026-10-20T04:00:00.000Z',
        attemptsSince: 2,
        shouldRejudge: false,
      }),
    );
    renderPage();

    expect(await screen.findByText(/P2（标准节奏）/)).toBeInTheDocument();
    expect(screen.getByText('临时档位')).toBeInTheDocument();
    // 门槛口径是「再答几题」，不是「再学完几个知识点」：spec 两处都写
    // 「学 5 题后可重判」，而一个知识点要 8 题 + 3 变式才算学完 —— 按知识
    // 点计数会让初始那几天永远不触发重判。
    expect(screen.getByText(/再答 3 题/)).toBeInTheDocument();
    expect(screen.queryByText(/学完.*个知识点/)).not.toBeInTheDocument();
    // 不够门槛时手动重判按钮不渲染：常态下读状态就会自动结算，这个按钮
    // 只为并发下的旧快照留门。一个永远置灰的按钮只会让人反复去点它。
    expect(screen.queryByRole('button', { name: '用学习证据重判' })).not.toBeInTheDocument();
  });

  it('读不到档位时给出可读的错误，不白屏', async () => {
    server.use(
      http.get('*/api/v1/placement', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '服务器内部错误' }, { status: 500 }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/读不到档位状态/)).toBeInTheDocument();
    expect(screen.getByText('服务器内部错误')).toBeInTheDocument();
  });
});

describe('自评段：只问做过什么，且不直接给档位', () => {
  it('四道题都答完才能提交，且题目里没有「你觉得自己几分」', async () => {
    stubStatus();
    stubSelfAssessment();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '开始定级' }));

    const submit = await screen.findByRole('button', { name: '提交自评' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('四道题都答完才能继续。')).toBeInTheDocument();

    // 只答三题仍然禁用（这条防「少答一题也能提交」）
    for (const question of questions.slice(0, 3)) {
      const group = screen.getByRole('radiogroup', { name: new RegExp(question.prompt.slice(0, 8)) });
      await user.click(within(group).getByRole('radio', { name: question.options[1]!.label }));
    }
    expect(submit).toBeDisabled();

    const last = questions[3]!;
    const lastGroup = screen.getByRole('radiogroup', { name: new RegExp(last.prompt.slice(0, 8)) });
    await user.click(within(lastGroup).getByRole('radio', { name: last.options[1]!.label }));
    expect(submit).toBeEnabled();
  });

  it('提交自评后只说「起点挪了一点」，不显示档位', async () => {
    stubStatus();
    stubSelfAssessment();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '开始定级' }));
    for (const question of questions) {
      const group = await screen.findByRole('radiogroup', { name: new RegExp(question.prompt.slice(0, 8)) });
      await user.click(within(group).getByRole('radio', { name: question.options[2]!.label }));
    }
    await user.click(screen.getByRole('button', { name: '提交自评' }));

    const card = await screen.findByRole('region', { name: '自评结果' });
    expect(within(card).getByText(/最多半档/)).toBeInTheDocument();
    expect(within(card).getByText(/0\.28 个 logit/)).toBeInTheDocument();
    // 自评不直接定档：这一段里不该出现「你的临时档位」
    expect(screen.queryByText(TIER_LABEL_COPY)).not.toBeInTheDocument();
  });
});

describe('答题段：提交后当场给答案与解析（票面验收 4）', () => {
  it('答完一题立刻显示正确答案、正确解析与错误解析', async () => {
    const user = userEvent.setup();
    await reachQuizStage(user);

    const quiz = await screen.findByRole('region', { name: '定级题' });
    expect(within(quiz).getByText(/考的是：噪声系数/)).toBeInTheDocument();
    expect(within(quiz).getByText('中等')).toBeInTheDocument();
    expect(within(quiz).getByText(/第 1 题/)).toBeInTheDocument();

    await user.click(within(quiz).getByRole('radio', { name: 'D. 丁方案' }));
    await user.click(screen.getByRole('button', { name: '提交这道题' }));

    const judged = await screen.findByRole('region', { name: '这道题的判定' });
    expect(within(judged).getByText('回答错误')).toBeInTheDocument();
    expect(within(judged).getByText(/正确答案：丙方案/)).toBeInTheDocument();
    // 解析必须来自后端，而不是前端拼一句「再试试」
    expect(within(judged).getByText(/满足量纲与带宽要求/)).toBeInTheDocument();
    expect(within(judged).getByText(/忽略了后级负载/)).toBeInTheDocument();
  });

  it('提交时发的是选项下标，不是选项文本', async () => {
    let sent: unknown = null;
    const user = userEvent.setup();
    await reachQuizStage(user);
    // 覆盖桩必须放在 `reachQuizStage` **之后**：MSW 的 `server.use` 是
    // 「后注册者优先」，在辅助函数之前注册会被它里面的默认作答桩盖掉 ——
    // 断言就只能永远看到 null，而且看起来像「页面根本没发请求」。
    server.use(
      http.post('*/api/v1/placement/sessions/:sessionId/answers', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(answerBody());
      }),
    );

    const quiz = await screen.findByRole('region', { name: '定级题' });
    await user.click(within(quiz).getByRole('radio', { name: 'C. 丙方案' }));
    await user.click(screen.getByRole('button', { name: '提交这道题' }));

    await waitFor(() => expect(sent).not.toBeNull());
    // 服务端判分用的是 `answer` 下标（与关卡作答同一套 `judgeAnswer`）；
    // 传文本会让选择题退化成填空题，两套判分早晚分叉
    expect(sent).toEqual({ itemId: 'kp-noise-item-0', answer: 2 });
  });

  it('显式提交后会话状态由回执推进，不需要再发一次 GET', async () => {
    let sessionGets = 0;
    server.use(
      http.get('*/api/v1/placement/sessions/:sessionId', () => {
        sessionGets += 1;
        return HttpResponse.json(sessionState());
      }),
    );
    const user = userEvent.setup();
    await reachQuizStage(user);

    const quiz = await screen.findByRole('region', { name: '定级题' });
    await user.click(within(quiz).getByRole('radio', { name: 'A. 甲方案' }));
    await user.click(screen.getByRole('button', { name: '提交这道题' }));

    await screen.findByRole('region', { name: '这道题的判定' });
    await user.click(screen.getByRole('button', { name: '下一题' }));

    // 下一题的题面来自回执里的 `session`（第 2 题），而不是重新查会话
    expect(await screen.findByText('噪声系数：第 2 题')).toBeInTheDocument();
    expect(sessionGets).toBe(0);
  });

  it('答完最后一题时按钮变成「看结果」', async () => {
    const user = userEvent.setup();
    await reachQuizStage(user);
    // 同「提交时发的是下标」那条：覆盖桩必须在辅助函数之后注册。
    stubAnswer(
      answerBody({
        session: sessionState({
          item: null,
          answered: 9,
          correctCount: 7,
          stop: { stopped: true, reason: 'sd' },
          remainingItems: 12,
          posteriorSd: 0.31,
        }),
      }),
    );

    const quiz = await screen.findByRole('region', { name: '定级题' });
    await user.click(within(quiz).getByRole('radio', { name: 'A. 甲方案' }));
    await user.click(screen.getByRole('button', { name: '提交这道题' }));

    // 最后一题的判定卡必须先出现：票面验收 4 要求每道题都能复核，
    // 最后一道如果直接把结果页顶上来，学生就再也看不到这题的答案。
    const judged = await screen.findByRole('region', { name: '这道题的判定' });
    expect(within(judged).getByText(/正确答案：/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '看结果' })).toBeInTheDocument();
    // 阴性对照：题已经没了，别把「下一题」留在这里
    expect(screen.queryByRole('button', { name: '下一题' })).not.toBeInTheDocument();
  });

  it('提交失败时说清没提交成功，并且不清空已选项', async () => {
    const user = userEvent.setup();
    await reachQuizStage(user);
    server.use(
      http.post('*/api/v1/placement/sessions/:sessionId/answers', () =>
        HttpResponse.json({ code: 'INTERNAL', message: '服务器内部错误' }, { status: 500 }),
      ),
    );

    const quiz = await screen.findByRole('region', { name: '定级题' });
    await user.click(within(quiz).getByRole('radio', { name: 'B. 乙方案' }));
    await user.click(screen.getByRole('button', { name: '提交这道题' }));

    expect(await screen.findByText(/这一轮没能提交/)).toBeInTheDocument();
    // 学生不该因为一次 500 丢掉刚才做的选择
    expect(within(quiz).getByRole('radio', { name: 'B. 乙方案' })).toBeChecked();
  });
});

describe('结果段：档位是临时的，且逐题可复核', () => {
  /**
   * 推进到结果页。
   *
   * `result` 必须从这个参数传进来、由本函数自己注册桩 —— 在调用方先
   * `stubResult(...)` 再调本函数的话，本函数里的默认桩后注册会把它盖掉
   * （MSW `server.use` 后注册者优先），用例就会对着默认结果断言。
   */
  async function reachResultStage(
    user: ReturnType<typeof userEvent.setup>,
    result: Record<string, unknown> = resultBody(),
  ) {
    stubStatus();
    stubSelfAssessment();
    stubStart();
    stubAnswer(answerBody({ session: sessionState({ item: null, stop: { stopped: true, reason: 'sd' } }) }));
    stubResult(result);
    renderPage();

    await user.click(await screen.findByRole('button', { name: '开始定级' }));
    for (const question of questions) {
      const group = await screen.findByRole('radiogroup', { name: new RegExp(question.prompt.slice(0, 8)) });
      await user.click(within(group).getByRole('radio', { name: question.options[1]!.label }));
    }
    await user.click(screen.getByRole('button', { name: '提交自评' }));
    await user.click(await screen.findByRole('button', { name: '开始答题' }));

    const quiz = await screen.findByRole('region', { name: '定级题' });
    await user.click(within(quiz).getByRole('radio', { name: 'A. 甲方案' }));
    await user.click(screen.getByRole('button', { name: '提交这道题' }));
    await screen.findByRole('region', { name: '这道题的判定' });
    await user.click(screen.getByRole('button', { name: '看结果' }));
  }

  it('显示档位 + 「临时档位」文字标记 + 重判门槛', async () => {
    const user = userEvent.setup();
    await reachResultStage(user);

    const card = await screen.findByRole('region', { name: '定级结果' });
    expect(within(card).getByText('你的临时档位')).toBeInTheDocument();
    expect(within(card).getByText('P2：标准节奏')).toBeInTheDocument();
    // 「临时」是文字而不是低饱和度的颜色：一个看起来像终审的档位会让被判低的人放弃
    expect(within(card).getByText('临时档位')).toBeInTheDocument();
    // 重判门槛单独断言那句说明，而不是 /再答 5 题后/ —— 后端给的
    // explanation 里也有同样的措辞，全局查会命中两处
    expect(within(card).getByText(/这次共答 9 题，答对 6 题/)).toBeInTheDocument();
    expect(within(card).getByText(/因此定为 P2/)).toBeInTheDocument();
  });

  it('逐题复核表同时给出「你选了什么」与「正确答案」，判错的标出来', async () => {
    const user = userEvent.setup();
    await reachResultStage(user);

    const card = await screen.findByRole('region', { name: '定级结果' });
    const review = within(card).getByRole('list', { name: '逐题复核' });
    const rows = within(review).getAllByRole('listitem');
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByText(/你选的是：丁方案/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/正确答案：丙方案/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText('回答错误')).toBeInTheDocument();

    expect(within(rows[1]!).getByText('回答正确')).toBeInTheDocument();
    // 正向对照：两条复核行真的分别判了错与对，而不是都渲染成同一句
    expect(within(rows[1]!).queryByText('回答错误')).not.toBeInTheDocument();
  });

  it('置信度不高时显式提示，而不是只给一个数字', async () => {
    const user = userEvent.setup();
    await reachResultStage(
      user,
      resultBody({ lowConfidence: true, answered: 7, correctCount: 3, confidence: 0.42, stopReason: 'no_more_items' }),
    );

    const card = await screen.findByRole('region', { name: '定级结果' });
    expect(within(card).getByText('置信度不高')).toBeInTheDocument();
    expect(within(card).getByText(/这次共答 7 题，答对 3 题/)).toBeInTheDocument();
  });
});

describe('重判：用学习证据，不是重考', () => {
  it('自动重判过就说明是谁调的、从哪一档调到哪一档', async () => {
    // 票 11 验收 5 的「自动」在界面上有个副作用：学习者**没点任何按钮**，
    // 档位就变了。不解释这件事，页面看起来就是出错了 —— 所以这条断言的是
    // 「有一句话说清是系统根据学习数据调的」，不是只断言档位数字。
    stubStatus(
      statusBody({
        tier: 'P2',
        status: 'provisional',
        placedAt: '2026-10-21T04:00:00.000Z',
        attemptsSince: 0,
        shouldRejudge: false,
        lastRejudge: {
          previousTier: 'P1',
          tier: 'P2',
          changed: true,
          attemptsSince: 24,
          averageFirstTryRate: 0.88,
          explanation: '你在上次定级后又答了 24 题，平均首轮正确率 88%，因此把档位上调一档：P1 → P2。',
          at: '2026-10-21T04:00:00.000Z',
        },
      }),
    );
    renderPage();

    expect(
      await screen.findByText(/系统根据你的学习数据，把档位从 P1 调整为 P2/),
    ).toBeInTheDocument();
    expect(screen.getByText(/平均首轮正确率 88%/)).toBeInTheDocument();
    // 自动重判后门槛计数归零，所以说明文字回到「再答 5 题」
    expect(screen.getByText(/再答 5 题/)).toBeInTheDocument();
    // 自动重判没有被手动路径重复渲染一遍。这里必须用**精确字符串**匹配：
    // 自动那条的标题是「系统根据…把档位从 P1 调整为 P2」，用正则 /档位从
    // P1 调整为 P2/ 会把它自己也匹配进去，阴性断言就恒假。
    expect(screen.queryByText('档位从 P1 调整为 P2')).not.toBeInTheDocument();
    // 自动结算过之后 shouldRejudge 就是 false，手动按钮不该出现
    expect(screen.queryByRole('button', { name: '用学习证据重判' })).not.toBeInTheDocument();
  });

  it('自动重判但档位不变时也说一句，而不是让学习者以为没生效', async () => {
    stubStatus(
      statusBody({
        tier: 'P2',
        status: 'provisional',
        placedAt: '2026-10-21T04:00:00.000Z',
        lastRejudge: {
          previousTier: 'P2',
          tier: 'P2',
          changed: false,
          attemptsSince: 5,
          averageFirstTryRate: 0.55,
          explanation: '你在上次定级后又答了 5 题，平均首轮正确率 55%。这个表现与 P2 相符，档位不变。',
          at: '2026-10-21T04:00:00.000Z',
        },
      }),
    );
    renderPage();

    expect(
      await screen.findByText(/系统根据你的学习数据重判过，档位保持不变/),
    ).toBeInTheDocument();
    expect(screen.getByText(/这个表现与 P2 相符，档位不变/)).toBeInTheDocument();
  });

  it('并发下才出现的手动入口：点了会显示升降级结果与理由', async () => {
    // 常态下读状态已经结算过，shouldRejudge 回来就是 false。只有两个请求
    // 同时到达时，后到的那个会拿着旧快照，所以还留一个手动入口。
    stubStatus(
      statusBody({
        tier: 'P1',
        status: 'provisional',
        placedAt: '2026-10-20T04:00:00.000Z',
        attemptsSince: 5,
        shouldRejudge: true,
      }),
    );
    server.use(
      http.post('*/api/v1/placement/rejudge', () =>
        HttpResponse.json({
          tier: 'P2',
          previousTier: 'P1',
          changed: true,
          attemptsSince: 5,
          averageFirstTryRate: 0.85,
          explanation: '你在上次定级后又答了 5 题，平均首轮正确率 85%，因此把档位上调一档：P1 → P2。',
          placedAt: '2026-10-21T04:00:00.000Z',
        }),
      ),
    );

    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole('button', { name: '用学习证据重判' });
    expect(button).toBeEnabled();
    await user.click(button);

    expect(await screen.findByText(/档位从 P1 调整为 P2/)).toBeInTheDocument();
    expect(screen.getByText(/平均首轮正确率 85%/)).toBeInTheDocument();
  });

  it('重判失败时说清原因（例如还没答够）', async () => {
    stubStatus(
      statusBody({
        tier: 'P1',
        status: 'provisional',
        placedAt: '2026-10-20T04:00:00.000Z',
        attemptsSince: 5,
        shouldRejudge: true,
      }),
    );
    server.use(
      http.post('*/api/v1/placement/rejudge', () =>
        HttpResponse.json(
          { code: 'CONFLICT', message: '还需要再答 3 题才能重判。重判依据是真实学习证据，不是重考一遍定级题。' },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '用学习证据重判' }));

    expect(await screen.findByText(/重判没能进行/)).toBeInTheDocument();
    expect(screen.getByText(/不是重考一遍定级题/)).toBeInTheDocument();
  });
});

describe('加载态：慢请求时说明在做什么', () => {
  it('档位状态慢时显示加载中的说明，而不是空白页', async () => {
    server.use(
      http.get('*/api/v1/placement', async () => {
        await delay(300);
        return HttpResponse.json(statusBody());
      }),
    );
    renderPage();
    expect(screen.getByText('正在读取你的档位…')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('正在读取你的档位…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '开始定级' })).toBeInTheDocument();
  });
});
