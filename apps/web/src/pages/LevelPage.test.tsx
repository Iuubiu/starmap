import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { LevelDetailResponse } from '../api/generated/model';
import { LevelPage } from './LevelPage';
import * as queries from '../api/queries';

/**
 * 页面测试只验证「拿到这份 spec 后页面怎么反应」，不验证请求本身。
 *
 * 请求路径、状态码、契约形状由 `apps/api/src/levels/levels.controller.test.ts`
 * 与 openapi 校验覆盖。这里替换掉 query hook，是为了让「反馈是不是立即出现」
 * 这件事变成可断言的事实：如果实现里偷偷 await 了一个模型调用，用 mock 的
 * hook 就根本渲染不出反馈，测试会红。
 */
vi.mock('../api/queries', () => ({
  useLevel: vi.fn(),
  useNodeDetail: vi.fn(),
  useNodeList: vi.fn(),
  useHealth: vi.fn(),
}));

/** 与 content/levels/lv-bool-laws.spec.json 同构的最小教学关卡（题少，断言好写）。 */
const makeSpec = (): LevelDetailResponse => ({
  level: {
    levelId: 'lv-bool-laws',
    microKpId: 'kp-bool',
    title: '逻辑代数基本律：吸收律与德摩根律',
    itemCount: 4,
    kind: 'teach',
  },
  spec: {
    schemaVersion: 1,
    meta: {
      id: 'lv-bool-laws',
      microKpId: 'kp-bool',
      title: '逻辑代数基本律：吸收律与德摩根律',
      type: 'teaching',
      tier: 'P1',
      estimatedMinutes: 14,
      author: 'system',
      isEntry: true,
      nextLevelId: null,
    },
    sources: [{ ref: '康华光·数字部分·第5版', locator: 'p.34' }],
    cards: [
      {
        id: 'c-guide',
        title: '为什么要化简',
        body: '一个组合逻辑式 $Y = A·B + A·B·C + A·\\overline{B}·C$ 需要 3 个与门和 1 个或门。\n\n用吸收律把前两项合成 $A·B$，用 $A + \\overline{A}·B = A + B$ 把后两项并成 $C$，门数就从 7 个降到 3 个。',
        figureRef: null,
      },
      {
        id: 'c-absorb',
        title: '吸收律',
        body: '吸收律指的是 $A + A·B = A$：既然 $A$ 已经为真，那么 $A·B$ 的真假就不再影响结果。\n\n对偶形式是 $A·(A + B) = A$，推导时把或换成与、与换成或即可。',
        figureRef: 'ck-digital-kanghua-5e-0062-03-8f36a966f7b7',
      },
      {
        id: 'c-deepen',
        title: '深究：错误为什么抓不住',
        body: '多数人答错吸收律，是因为把 $A + A·B$ 当成了 $A + B$。\n\n这一段的作答不扣掌握度，目的是把错误暴露出来。',
        figureRef: null,
      },
      {
        id: 'c-reteach',
        title: '换个角度看',
        body: '用集合看：$A + A·B = A$ 就是「A 并（A 交 B）」等于 A，画个韦恩图一眼看出来。\n\n用真值表看：四种输入里 $A$ 为 1 的两行结果都是 1，$A$ 为 0 的两行结果都是 0，逐行比对即得。',
        figureRef: null,
      },
      {
        id: 'c-summary',
        title: '带走三条规则',
        body: '吸收律 $A + A·B = A$；消去律 $A + \\overline{A}·B = A + B$；德摩根律 $\\overline{A·B} = \\overline{A} + \\overline{B}$。',
        figureRef: null,
      },
    ],
    steps: [
      { id: 's-guide', kind: 'guide', title: '引导', cardIds: ['c-guide'], itemIds: [], requiredCorrect: 0 },
      { id: 's-detail', kind: 'detail', title: '展示细节', cardIds: ['c-absorb'], itemIds: [], requiredCorrect: 0 },
      { id: 's-probe', kind: 'probe', title: '简单问题', cardIds: [], itemIds: ['i-probe'], requiredCorrect: 1 },
      { id: 's-deepen', kind: 'deepen', title: '深究', cardIds: ['c-deepen'], itemIds: ['i-deepen'], requiredCorrect: 0 },
      { id: 's-reteach', kind: 'reteach', title: '进一步讲解', cardIds: ['c-reteach'], itemIds: [], requiredCorrect: 0 },
      { id: 's-quiz', kind: 'quiz', title: '判定', cardIds: [], itemIds: ['i-quiz'], requiredCorrect: 1 },
      { id: 's-summary', kind: 'summary', title: '小结', cardIds: ['c-summary'], itemIds: [], requiredCorrect: 0 },
    ],
    items: [
      {
        id: 'i-probe',
        kind: 'fact',
        stem: '下列哪一个式子恒等于 $A$？',
        options: ['$A + A·B$', '$A + B$', '$A·(A + B)·\\overline{A}$'],
        answer: 0,
        variantGroup: 'vg-absorb',
        explainCorrect: '对，吸收律 $A + A·B = A$ 就是这个形状。',
        explainWrong: '再看一眼吸收律：多出来的 $B$ 被 $A$ 吸收了。',
        misconceptionTags: ['吸收律误用'],
        sourceRef: '康华光·数字部分·p.34',
        pool: 'core',
        hintLadder: ['先看两项里谁被谁包含。'],
      },
      {
        id: 'i-deepen',
        kind: 'concept',
        stem: '$\\overline{A·B}$ 展开后等于什么？',
        options: ['$\\overline{A}·\\overline{B}$', '$\\overline{A} + \\overline{B}$'],
        answer: 1,
        variantGroup: 'vg-demorgan',
        explainCorrect: '对，德摩根律把与变成或、同时取反。',
        explainWrong: '德摩根律要同时换运算和取反，只取反不换运算是错的。',
        misconceptionTags: ['德摩根只取反不换运算'],
        sourceRef: null,
        pool: 'practice',
        hintLadder: ['把与看成交集，取反看成补集。'],
      },
      {
        id: 'i-quiz',
        kind: 'comprehensive',
        stem: '要用与非门实现 $Y = A + B$，怎么接？',
        options: ['两个输入先各自取反再与非', '把 $A$、$B$ 直接接到与非门', '需要三个与非门级联'],
        answer: 0,
        variantGroup: 'vg-nand',
        explainCorrect: '对：$A + B = \\overline{\\overline{A}·\\overline{B}}$，输入各取反后送一个与非门。',
        explainWrong: '与非门做或运算要先对输入取反。',
        misconceptionTags: ['把与非门当成或非门'],
        sourceRef: '康华光·数字部分·p.38',
        pool: 'core',
        hintLadder: ['先把或写成与非的形式。'],
      },
    ],
    gating: { mode: 'none', itemCount: 1, passCount: 1 },
  },
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/level/lv-bool-laws']}>
          <Routes>
            <Route path="/level/:levelId" element={<LevelPage />} />
            <Route path="/map/:microKpId" element={<div>知识点详情桩</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

const mockLevel = (payload: LevelDetailResponse | undefined = makeSpec()) => {
  vi.mocked(queries.useLevel).mockReturnValue({
    isLoading: false,
    error: null,
    payload,
  } as never);
};

/** 一步步点完当前段，直到进入指定段（或超过上限）。 */
const walkTo = async (user: ReturnType<typeof userEvent.setup>, kind: string, correct: boolean) => {
  for (let guard = 0; guard < 12; guard += 1) {
    const stepHeading = screen.queryByText(new RegExp(`第 \\d+ 段 · `));
    if (!stepHeading) return;
    const text = stepHeading.textContent ?? '';
    if (text.includes(kind)) return;
    // 一道选择题本身就有多个 radio，必须用 All 版本再判空。
    const radios = screen.queryAllByRole('radio');
    if (radios.length > 0) {
      const target = correct ? radios[0] : radios[radios.length - 1];
      if (!target) throw new Error('没有可选选项');
      await user.click(target);
      const submitButton = screen.queryByRole('button', { name: '提交答案' });
      if (submitButton) await user.click(submitButton);
    }
    await user.click(screen.getByRole('button', { name: /进入下一段|完成本关/ }));
  }
  throw new Error('推进次数超限');
};

describe('LevelPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('载入时显示当前段与首段内容卡，进度条七段齐全', () => {
    mockLevel();
    renderPage();
    expect(screen.getByText('逻辑代数基本律：吸收律与德摩根律')).toBeInTheDocument();
    expect(screen.getByText('第 1 段 · 引导')).toBeInTheDocument();
    expect(screen.getByText('为什么要化简')).toBeInTheDocument();
    // 内容卡渲染了整段正文，而不是一句话摘要
    expect(screen.getByText(/一个组合逻辑式/)).toBeInTheDocument();

    const rail = screen.getByRole('list', { name: '关卡进度' });
    expect(within(rail).getAllByRole('listitem')).toHaveLength(7);
  });

  it('答对后立即显示预写反馈，不需要等待任何异步', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '简单问题', true);
    expect(screen.getByText('第 3 段 · 简单问题')).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    await user.click(radios[0]!);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    // 点完的那一帧就在 DOM 里：没有 loading、没有 await。
    expect(screen.getByText('答对了')).toBeInTheDocument();
    expect(screen.getByText(/吸收律 \$A \+ A·B = A\$ 就是这个形状/)).toBeInTheDocument();
  });

  it('答错后显示的是另一段预写反馈，并列出错因标签', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '简单问题', true);
    const radios = screen.getAllByRole('radio');
    const lastRadio = radios[radios.length - 1];
    if (!lastRadio) throw new Error('没有可选选项');
    await user.click(lastRadio);
    await user.click(screen.getByRole('button', { name: '提交答案' }));

    expect(screen.getByText('这条没答对，看下错在哪')).toBeInTheDocument();
    expect(screen.getByText(/多出来的 \$B\$ 被 \$A\$ 吸收了/)).toBeInTheDocument();
    expect(screen.getByText('吸收律误用')).toBeInTheDocument();
  });

  it('简单问题未达标 → 真的进入深究，并明说不扣掌握度', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '简单问题', false);
    const radios = screen.getAllByRole('radio');
    const lastRadio = radios[radios.length - 1];
    if (!lastRadio) throw new Error('没有可选选项');
    await user.click(lastRadio);
    await user.click(screen.getByRole('button', { name: '提交答案' }));
    await user.click(screen.getByRole('button', { name: '进入下一段' }));

    expect(screen.getByText('第 4 段 · 深究')).toBeInTheDocument();
    expect(screen.getByText(/全程不扣掌握度/)).toBeInTheDocument();
    // 深究段的题也被标成「本段不影响掌握度」
    expect(screen.getByText('本段不影响掌握度')).toBeInTheDocument();
  });

  it('简单问题达标 → 跳过深究与进一步讲解，直接进判定；跳过的段在进度条上标出来', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '判定', true);
    expect(screen.getByText('第 6 段 · 判定')).toBeInTheDocument();

    const rail = screen.getByRole('list', { name: '关卡进度' });
    const chips = within(rail).getAllByRole('listitem');
    expect(chips.map((chip) => chip.getAttribute('data-status'))).toEqual([
      'done',
      'done',
      'done',
      'skipped',
      'skipped',
      'current',
      'upcoming',
    ]);
  });

  it('走完全程后显示小结与本关证据统计', async () => {
    const user = userEvent.setup();
    mockLevel();
    renderPage();

    await walkTo(user, '判定', true);
    const radios = screen.getAllByRole('radio');
    await user.click(radios[0]!);
    await user.click(screen.getByRole('button', { name: '提交答案' }));
    // 判定段之后还有小结段，所以这里仍是「进入下一段」而不是「完成本关」。
    await user.click(screen.getByRole('button', { name: '进入下一段' }));

    expect(screen.getByText('本关小结')).toBeInTheDocument();
    expect(screen.getByText('一次通过')).toBeInTheDocument();
    expect(screen.getByText('本关证据')).toBeInTheDocument();
    expect(screen.getByText(/一次通过，2 道作答全部计入掌握度/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回到知识点' })).toBeInTheDocument();
  });

  it('关卡载入失败时给出可读的错误，而不是白屏', () => {
    vi.mocked(queries.useLevel).mockReturnValue({
      isLoading: false,
      error: new Error('关卡不存在: lv-nope'),
      payload: undefined,
    } as never);
    renderPage();
    expect(screen.getByText(/关卡载入失败/)).toBeInTheDocument();
  });

  it('载入中显示 spinner', () => {
    vi.mocked(queries.useLevel).mockReturnValue({
      isLoading: true,
      error: null,
      payload: undefined,
    } as never);
    renderPage();
    expect(screen.getByText('正在载入关卡…')).toBeInTheDocument();
  });
});
