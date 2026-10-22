/**
 * 出口门控面板的测试（票 06 验收 2/3/4，票 25 的阈值口径）。
 *
 * ## 这里钉的是哪两件事
 *
 * 1. **考前显示的是引擎规则，不是 spec 里的作者声明值。**
 *    `ruleFor()` 对 `exit` / `prereq` 一律返回引擎常量，作者写的
 *    `gating.itemCount` / `gating.passCount` 不参与判定。若界面显示作者值，
 *    学习者会按一个不会生效的数字准备考试 —— 而考完看到的判定又按另一条线算，
 *    两句话自相矛盾。所以断言里刻意把 spec 写成 2/2、把期望写成 8/7。
 *
 * 2. **判定后所有数字都来自 `evaluation.rule`，不混 spec 值。**
 *    做 20 题时达标线是 16/20，不是 7/8 —— `appliedThreshold()` 的产物才是
 *    「这一次实际按什么线判的」。
 *
 * ## 为什么门槛常量要读 engine 源码比对
 *
 * `apps/web` 不依赖 `@starmap/engine`（`.dependency-cruiser.cjs` 的边界，
 * 浏览器侧只该拿契约生成的类型），所以 8/7 与 10/9 在这里重述了一遍。重述就会
 * 漂移。与 `MasteryMeter.test.tsx` 的 `MIN_ATTEMPTS` 同手法：直接读
 * `packages/engine/src/gating.ts` 的 `GATE_RULES` 当断言对象，而不是把期望值
 * 手抄一遍。
 *
 * 注释里那句「`GatePanel.test.tsx` 有一条用例锁住它们」在没有这个文件时比
 * 没有更糟 —— 下一个人会以为有守卫，于是放心去改。
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type { LevelSpec } from '../api/queries';
import { GATE_MIN_RULE, GatePanel } from './GatePanel';

const LONG_BODY =
  '吸收律说的是：如果一个与项是另一个与项的子集，那么它会被吸收掉，不留下任何痕迹。' +
  '推导只用分配律与 1 的性质：A + A·B = A·(1 + B) = A·1 = A，因为 1 + B 恒等于 1。';

const card = (id: string): LevelSpec['cards'][number] => ({
  id,
  title: `卡片 ${id}`,
  body: LONG_BODY,
  figureRef: null,
});

const item = (
  id: string,
  overrides: Partial<LevelSpec['items'][number]> = {},
): LevelSpec['items'][number] => ({
  id,
  kind: 'concept',
  stem: `题目 ${id} 的题干`,
  options: ['选项一', '选项二', '选项三'],
  answer: 0,
  variantGroup: `vg-${id}`,
  explainCorrect: '答对了。',
  explainWrong: '答错了。',
  misconceptionTags: [],
  sourceRef: '测试教材·第 1 章',
  pool: 'core',
  hintLadder: [],
  ...overrides,
});

/**
 * 一张 `meta.type='quiz'` 的最小合法关卡：`quiz` 段引用 `quizItems` 道题。
 *
 * `gating` 刻意可调：要能造出「作者声明 2 题」与「判定段只有 1 题」这两种
 * 与引擎规则不一致的情形。
 */
function makeSpec(options: {
  mode?: 'none' | 'exit' | 'prereq';
  gating?: { itemCount: number; passCount: number };
  quizItems?: number;
}): LevelSpec {
  const quizItems = options.quizItems ?? 1;
  const items = Array.from({ length: quizItems }, (_, index) => item(`i-q${index}`));
  const mode = options.mode ?? 'exit';
  return {
    schemaVersion: 1,
    meta: {
      id: 'lv-gate-panel',
      microKpId: 'kp-gate-panel',
      title: '门控面板测试关卡',
      type: 'quiz',
      tier: 'P1',
      estimatedMinutes: 8,
      author: 'system',
      isEntry: true,
      nextLevelId: null,
    },
    sources: [{ ref: '测试教材', locator: null }],
    cards: [card('c-summary')],
    steps: [
      {
        id: 's-quiz',
        kind: 'quiz',
        title: '判定',
        cardIds: [],
        itemIds: items.map((entry) => entry.id),
        requiredCorrect: 0,
      },
      {
        id: 's-summary',
        kind: 'summary',
        title: '小结',
        cardIds: ['c-summary'],
        itemIds: [],
        requiredCorrect: 0,
      },
    ],
    items,
    gating: {
      mode,
      itemCount: options.gating?.itemCount ?? 8,
      passCount: options.gating?.passCount ?? 7,
    },
  };
}

function renderPanel(
  spec: LevelSpec,
  overrides: Partial<React.ComponentProps<typeof GatePanel>> = {},
) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <GatePanel
        spec={spec}
        evaluation={undefined}
        unlockedNodeIds={[]}
        history={undefined}
        isEvaluating={false}
        error={undefined}
        onEvaluate={vi.fn()}
        onRestart={vi.fn()}
        {...overrides}
      />
    </FluentProvider>,
  );
}

/** 一份判定快照。默认 20 题答对 16 通过 —— 正是「做多了以后达标线重算」的形状。 */
const evaluation = (
  overrides: Partial<NonNullable<React.ComponentProps<typeof GatePanel>['evaluation']>> = {},
) => ({
  levelId: 'lv-gate-panel',
  microKpId: 'kp-gate-panel',
  mode: 'exit' as const,
  verdict: 'passed' as const,
  reason: 'passed' as const,
  passed: true,
  rule: { itemCount: 20, passCount: 16 },
  correct: 16,
  total: 20,
  shortfall: 0,
  message: '已通过：答对 16/20，真实正确率的 50% 置信下界为 80.0%（达标线 75%）。',
  itemIds: ['i-q0', 'i-q1'],
  wrongItemIds: [],
  evaluatedAt: '2026-10-21T02:00:00.000Z',
  remediation: null,
  ...overrides,
});

describe('GatePanel', () => {
  // ---------------------------------------------------------------------
  // ① 考前阈值口径
  // ---------------------------------------------------------------------

  it('考前显示引擎规则的 8/7，不显示 spec 里作者声明的 2/2', () => {
    renderPanel(makeSpec({ mode: 'exit', gating: { itemCount: 2, passCount: 2 }, quizItems: 2 }));

    expect(screen.getByText(/至少要做满 8 道/)).toBeInTheDocument();
    expect(screen.getByText(/答对 7 道才算过/)).toBeInTheDocument();
    // 作者值一个字都不该出现在界面上
    expect(screen.queryByText(/要做满 2 道/)).not.toBeInTheDocument();
    expect(screen.queryByText(/答对 2 道/)).not.toBeInTheDocument();
  });

  it('先修门的考前口径是 10/9，不是出口门的 8/7', () => {
    renderPanel(makeSpec({ mode: 'prereq', gating: { itemCount: 3, passCount: 1 }, quizItems: 3 }));

    expect(screen.getByText(/至少要做满 10 道/)).toBeInTheDocument();
    expect(screen.getByText(/答对 9 道才算过/)).toBeInTheDocument();
  });

  it('判定段题量撑不起门控时明说「这是内容的问题，不是你的问题」', () => {
    // 判定段只有 2 道题，而出口门要 8 道起算 —— 学习者无论怎么答都过不了。
    // 不说这句，他会以为是自己的问题，回头反复重做。
    renderPanel(makeSpec({ mode: 'exit', gating: { itemCount: 2, passCount: 2 }, quizItems: 2 }));

    expect(screen.getByText(/只有 2 道题，少于门控要求的 8 道/)).toBeInTheDocument();
    expect(screen.getByText(/不可能通过/)).toBeInTheDocument();
  });

  it('题量足够时不给那条警告，否则警告会变成总在响的背景噪音', () => {
    const items = Array.from({ length: 8 }, (_, index) => item(`i-q${index}`));
    const spec: LevelSpec = {
      ...makeSpec({ mode: 'exit', gating: { itemCount: 8, passCount: 7 } }),
      steps: [
        {
          id: 's-quiz',
          kind: 'quiz',
          title: '判定',
          cardIds: [],
          itemIds: items.map((entry) => entry.id),
          requiredCorrect: 0,
        },
      ],
      items,
    };
    renderPanel(spec);

    expect(screen.queryByText(/少于门控要求/)).not.toBeInTheDocument();
    expect(screen.getByText(/至少要做满 8 道/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // ② 判定后一律读 evaluation.rule
  // ---------------------------------------------------------------------

  it('判定后达标线读快照里的实际生效值 16/20，不是引擎下限 7/8', () => {
    renderPanel(makeSpec({ mode: 'exit', quizItems: 20 }), { evaluation: evaluation() });

    expect(screen.getByText('16/20')).toBeInTheDocument();
    expect(screen.queryByText('7/8')).not.toBeInTheDocument();
  });

  it('同一份判定里的三个数字互相对得上：答对 16、做了 20、达标线 16/20', () => {
    renderPanel(makeSpec({ mode: 'exit', quizItems: 20 }), { evaluation: evaluation() });

    // 这三个数来自同一条 `evaluation`。混用 spec 值会让「答对 16/20、达标线 7/8、
    // 已通过」同时出现在屏幕上 —— 读者会问「那到底按哪条线的」。
    expect(screen.getByText('答对').nextSibling?.textContent).toBe('16');
    expect(screen.getByText('做了').nextSibling?.textContent).toBe('20');
    expect(screen.getByText('达标线').nextSibling?.textContent).toBe('16/20');
  });

  it('历次判定回看用的是那一条记录自己的达标线，不是当前的', () => {
    // 两次判定：第一次 8 题 7 对，第二次 20 题 16 对。回看必须分别显示 7/8 与 16/20，
    // 否则「当年为什么没过」会被今天的题量重新解释一遍。
    renderPanel(makeSpec({ mode: 'exit', quizItems: 20 }), {
      evaluation: evaluation(),
      history: {
        levelId: 'lv-gate-panel',
        evaluations: [
          evaluation(),
          evaluation({
            rule: { itemCount: 8, passCount: 7 },
            correct: 7,
            total: 8,
            evaluatedAt: '2026-10-20T02:00:00.000Z',
          }),
        ],
      },
    });

    const entries = screen.getByText(/历次判定/).parentElement!;
    const text = entries.textContent ?? '';
    expect(text).toContain('达标线 7/8');
    expect(text).toContain('达标线 16/20');
  });

  // ---------------------------------------------------------------------
  // 门槛常量与 engine 同源
  // ---------------------------------------------------------------------

  it('门槛常量（8/7、10/9）与 engine 的 GATE_RULES 一致', () => {
    const gatingPath = resolve(
      process.cwd(),
      '..',
      '..',
      'packages',
      'engine',
      'src',
      'gating.ts',
    );
    const source = readFileSync(gatingPath, 'utf8');

    // 解析 `exit: { mode: 'exit', itemCount: 8, passCount: 7 }` 这种形状。
    const ruleFor = (mode: 'exit' | 'prereq') => {
      const match = new RegExp(
        `${mode}:\\s*\\{\\s*mode:\\s*'${mode}',\\s*itemCount:\\s*(\\d+),\\s*passCount:\\s*(\\d+)\\s*\\}`,
      ).exec(source);
      // 正则没匹配到就等于「这条测试什么都没验证」，必须先失败 —— 否则 engine
      // 改了个写法（比如加字段）就会让这条断言静默变成空转。
      if (!match?.[1] || !match[2]) {
        throw new Error(`在 ${gatingPath} 里找不到 GATE_RULES.${mode} 的 itemCount/passCount`);
      }
      return { itemCount: Number(match[1]), passCount: Number(match[2]) };
    };

    expect(GATE_MIN_RULE.exit).toEqual(ruleFor('exit'));
    expect(GATE_MIN_RULE.prereq).toEqual(ruleFor('prereq'));
  });
});
