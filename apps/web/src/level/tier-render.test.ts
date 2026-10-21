import { describe, expect, it } from 'vitest';
import type { AnswerRecord, LevelItem } from './flow';
import {
  attemptsLeft,
  attemptsPerItem,
  cardPresentation,
  createTierFlow,
  deferredFeedbackFor,
  defersFeedback,
  masteryProgressText,
  masteryRuleText,
  skipsIntro,
  startStepIndex,
  tierSummaryLines,
  type TierRenderPlan,
} from './tier-render';

/**
 * 票 12 的**映射层**测试（纯函数，不渲染）。
 *
 * 这一层存在的理由就是「参数变了界面一定跟着变」这件事要能被穷举地测。
 * 如果把这些判断写进 JSX，测试只能测出「某个按钮在不在」，测不出
 * 「`cardMode: 'faded'` 只藏服务端点名的那一张卡」这种映射。
 *
 * ## 打桩约定
 *
 * `plan()` 只造**参数子集**（声明成 `TierRenderPlan`），不造完整响应：
 * 页面需要的字段与这里测的字段是同一批，而 `levelId`/`microKpId`/`source`
 * 与渲染决策无关。三档的数值**逐字抄自 `.scratch/starmap-core/spec.md`
 * §5 的三档表**，并在用例里断言「这三份桩确实互不相同」—— 否则哪天有人
 * 把三份桩改成一样，全部映射测试会一起变成恒真。
 */

const P1_PARAMS: TierRenderPlan['params'] = {
  tier: 'P1',
  firstRoundShape: 'worked_example',
  ladder: { start: 1, cap: 3 },
  sessionNewKpLimit: 2,
  feedbackTiming: 'step_immediate',
  attemptsPerItem: 2,
  masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
};

const P2_PARAMS: TierRenderPlan['params'] = {
  tier: 'P2',
  firstRoundShape: 'completion',
  ladder: { start: 2, cap: 4 },
  sessionNewKpLimit: 3,
  feedbackTiming: 'step_immediate_with_summary',
  attemptsPerItem: 2,
  masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
};

const P3_PARAMS: TierRenderPlan['params'] = {
  tier: 'P3',
  firstRoundShape: 'direct',
  ladder: { start: 3, cap: 5 },
  sessionNewKpLimit: 4,
  feedbackTiming: 'item_deferred_with_summary',
  attemptsPerItem: 1,
  masteryRule: { consecutiveCorrect: 1, requiresTransferItem: true },
};

/** 按 spec 三档表造一份首轮计划。`fadedCardId` 用第一段带卡的段的最后一张。 */
function plan(
  params: TierRenderPlan['params'],
  over: Partial<TierRenderPlan['firstRound']> = {},
  progress: Partial<TierRenderPlan['masteryProgress']> = {},
): TierRenderPlan {
  const base: TierRenderPlan['firstRound'] =
    params.firstRoundShape === 'direct'
      ? { shape: 'direct', startStepIndex: 2, cardMode: 'none', fadedCardId: null }
      : params.firstRoundShape === 'completion'
        ? { shape: 'completion', startStepIndex: 0, cardMode: 'faded', fadedCardId: 'c-absorb' }
        : { shape: 'worked_example', startStepIndex: 0, cardMode: 'all', fadedCardId: null };
  return {
    params,
    firstRound: { ...base, ...over },
    masteryProgress: {
      consecutiveCorrect: 0,
      hasTransferItem: false,
      satisfied: false,
      missing: ['还差连续答对 2 次', '还没做过迁移题'],
      ...progress,
    },
  };
}

const P1 = plan(P1_PARAMS);
const P2 = plan(P2_PARAMS);
const P3 = plan(P3_PARAMS);

function record(over: Partial<AnswerRecord> & { itemId: string }): AnswerRecord {
  return {
    stepId: 's-quiz',
    stepKind: 'quiz',
    choice: 0,
    correct: true,
    masteryCredit: 0,
    countsTowardMastery: true,
    ...over,
  };
}

const item = (id: string): LevelItem =>
  ({
    id,
    kind: 'concept',
    stem: `${id} 的题干`,
    options: ['甲', '乙'],
    answer: 0,
    variantGroup: 'vg-x',
    explainCorrect: '对了',
    explainWrong: '错了',
    misconceptionTags: [],
    sourceRef: null,
    pool: 'core',
    hintLadder: [],
  }) as LevelItem;

describe('三份档位桩本身要互不相同（否则后面的映射测试全是恒真）', () => {
  it('三个参数对象两两不同', () => {
    expect(P1_PARAMS).not.toEqual(P2_PARAMS);
    expect(P2_PARAMS).not.toEqual(P3_PARAMS);
    expect(P1_PARAMS).not.toEqual(P3_PARAMS);
  });

  it('三份首轮计划两两不同（形态、起始段、卡片模式至少各差一处）', () => {
    expect(P1.firstRound).not.toEqual(P2.firstRound);
    expect(P2.firstRound).not.toEqual(P3.firstRound);
    // P1 与 P2 都从第 1 段开始，但卡片模式不同 —— 这一条把「只看起始段」
    // 的实现挡住：它的 P1/P2 会完全一样。
    expect(P1.firstRound.startStepIndex).toBe(P2.firstRound.startStepIndex);
    expect(P1.firstRound.cardMode).not.toBe(P2.firstRound.cardMode);
  });
});

describe('首轮从哪一段开始', () => {
  it('P1/P2 从第 1 段开始，P3 从第一段带题的段开始', () => {
    expect(startStepIndex(P1)).toBe(0);
    expect(startStepIndex(P2)).toBe(0);
    expect(startStepIndex(P3)).toBe(2);
    // 反向对照：起始段不是恒 0，否则上面那条 P3 断言在「永远返回 0」时也绿。
    expect(new Set([startStepIndex(P1), startStepIndex(P3)]).size).toBe(2);
  });

  it('只有 P3 算「跳过前面的讲解」', () => {
    expect(skipsIntro(P1)).toBe(false);
    expect(skipsIntro(P2)).toBe(false);
    expect(skipsIntro(P3)).toBe(true);
  });

  it('没有档位参数时回落到票 04 的行为：第 1 段、不跳讲解', () => {
    expect(startStepIndex(null)).toBe(0);
    expect(skipsIntro(null)).toBe(false);
  });

  it('createTierFlow 的起始段跟着档位走，其余字段与全展开时一致', () => {
    const flow = createTierFlow(P3);
    expect(flow.stepIndex).toBe(2);
    expect(flow.finished).toBe(false);
    expect(flow.records).toEqual([]);
    expect(flow.choices).toEqual({});
    // 反向对照：P1 的起始段是 0，不是 2。
    expect(createTierFlow(P1).stepIndex).toBe(0);
    expect(createTierFlow(null).stepIndex).toBe(0);
  });
});

describe('卡片呈现方式', () => {
  it('P1：全部展开，连 fadedCardId 也不藏', () => {
    expect(cardPresentation('c-guide', P1)).toBe('full');
    expect(cardPresentation('c-absorb', P1)).toBe('full');
  });

  it('P2：只有服务端点名的那张卡 faded，其余照常展开', () => {
    expect(cardPresentation('c-absorb', P2)).toBe('faded');
    // forward fading 是「最后一步留给你补」，不是把整关讲解藏起来。
    expect(cardPresentation('c-guide', P2)).toBe('full');
    expect(cardPresentation('c-quiz', P2)).toBe('full');
  });

  it('P3：所有卡默认收起（但仍在页面上，可展开）', () => {
    expect(cardPresentation('c-guide', P3)).toBe('collapsed');
    expect(cardPresentation('c-absorb', P3)).toBe('collapsed');
  });

  it('没有参数时全部展开', () => {
    expect(cardPresentation('c-guide', null)).toBe('full');
    expect(cardPresentation('c-absorb', null)).toBe('full');
  });

  it('faded 指向一张不存在的卡时，没有任何卡被藏（不静默藏错卡）', () => {
    const weird = plan(P2_PARAMS, { fadedCardId: 'c-not-in-this-level' });
    expect(cardPresentation('c-guide', weird)).toBe('full');
    expect(cardPresentation('c-absorb', weird)).toBe('full');
  });
});

describe('每题尝试次数与剩余机会', () => {
  it('P1/P2 两次、P3 一次', () => {
    expect(attemptsPerItem(P1)).toBe(2);
    expect(attemptsPerItem(P2)).toBe(2);
    expect(attemptsPerItem(P3)).toBe(1);
    expect(new Set([attemptsPerItem(P1), attemptsPerItem(P3)]).size).toBe(2);
  });

  it('没有参数时一次（票 04 的行为：提交即锁定）', () => {
    expect(attemptsPerItem(null)).toBe(1);
  });

  it('没答过时是满额', () => {
    expect(attemptsLeft(P1, [], 'i-quiz')).toBe(2);
    expect(attemptsLeft(P3, [], 'i-quiz')).toBe(1);
  });

  it('答对之后不再有次数（答对就没有再试的理由）', () => {
    const records = [record({ itemId: 'i-quiz', correct: true })];
    expect(attemptsLeft(P1, records, 'i-quiz')).toBe(0);
    // 未答的题不受影响 —— 否则「答对一道题就锁掉全关」的实现也能过。
    expect(attemptsLeft(P1, records, 'i-probe')).toBe(2);
  });

  it('答错一次后 P1 还剩 1 次，P3 已经用完', () => {
    const records = [record({ itemId: 'i-quiz', correct: false })];
    expect(attemptsLeft(P1, records, 'i-quiz')).toBe(1);
    expect(attemptsLeft(P3, records, 'i-quiz')).toBe(0);
  });

  it('答错两次后 P1 也用完（不会无限重试）', () => {
    const records = [
      record({ itemId: 'i-quiz', correct: false }),
      record({ itemId: 'i-quiz', correct: false }),
    ];
    expect(attemptsLeft(P1, records, 'i-quiz')).toBe(0);
  });

  it('最后一次答对时剩余是 0（不是负数）', () => {
    const records = [
      record({ itemId: 'i-quiz', correct: false }),
      record({ itemId: 'i-quiz', correct: true }),
    ];
    expect(attemptsLeft(P1, records, 'i-quiz')).toBe(0);
  });
});

describe('反馈时机', () => {
  it('只有 P3 整题延迟反馈', () => {
    expect(defersFeedback(P1)).toBe(false);
    expect(defersFeedback(P2)).toBe(false);
    expect(defersFeedback(P3)).toBe(true);
    expect(defersFeedback(null)).toBe(false);
  });
});

describe('掌握判定文案与进度', () => {
  it('判定条件由参数拼出来，不是查表', () => {
    expect(masteryRuleText(P1)).toBe('掌握判定：连对 2 次 + 一道迁移题');
    expect(masteryRuleText(P3)).toBe('掌握判定：连对 1 次 + 一道迁移题');
    // 把参数改一处，文案必须跟着变 —— 这条挡住「按档位查固定文案」的实现。
    const tweaked = plan({ ...P1_PARAMS, masteryRule: { consecutiveCorrect: 3, requiresTransferItem: false } });
    expect(masteryRuleText(tweaked)).toBe('掌握判定：连对 3 次');
    expect(masteryRuleText(tweaked)).not.toBe(masteryRuleText(P1));
  });

  it('还差什么直接取 engine 给的中文，不自己编措辞', () => {
    expect(masteryProgressText(P1)).toBe('还差：还差连续答对 2 次；还没做过迁移题。');
    const satisfied = plan(P3_PARAMS, {}, { satisfied: true, missing: [] });
    expect(masteryProgressText(satisfied)).toBe('按本档判定，这个知识点已经达标。');
    const partial = plan(P1_PARAMS, {}, { consecutiveCorrect: 1, missing: [] });
    expect(masteryProgressText(partial)).toContain('已连对 1 次');
    expect(masteryProgressText(null)).toContain('等档位参数');
  });
});

describe('档位摘要（验收 2：参数改变能被观察到）', () => {
  it('三档的摘要行两两不同', () => {
    const p1 = tierSummaryLines(P1);
    const p2 = tierSummaryLines(P2);
    const p3 = tierSummaryLines(P3);
    expect(p1).not.toEqual(p2);
    expect(p2).not.toEqual(p3);
    expect(p1).not.toEqual(p3);
  });

  it('摘要逐条对应参数，不是三句固定话', () => {
    expect(tierSummaryLines(P1)).toEqual(['讲解全展开', '每题最多 2 次', '答完立刻给反馈']);
    expect(tierSummaryLines(P2)).toEqual(['讲解留最后一步给你补', '每题最多 2 次', '答完立刻给反馈']);
    expect(tierSummaryLines(P3)).toEqual(['讲解默认收起，需要时展开', '每题只有 1 次机会', '整段提交后统一给反馈']);
  });

  it('没有参数时没有摘要行（不凭空编一段说明）', () => {
    expect(tierSummaryLines(null)).toEqual([]);
  });
});

describe('整段提交后的统一反馈（P3）', () => {
  const items = [item('i-probe'), item('i-quiz')];

  it('P1/P2 不产出延迟反馈（它们逐题即时给）', () => {
    const records = [record({ itemId: 'i-probe', correct: true })];
    expect(deferredFeedbackFor(P1, items, records)).toEqual([]);
    expect(deferredFeedbackFor(P2, items, records)).toEqual([]);
  });

  it('P3 只汇总已作答的题，并带出题干与对错', () => {
    const records = [
      record({ itemId: 'i-probe', correct: true, choice: 1 }),
      record({ itemId: 'i-quiz', correct: false, choice: 0 }),
    ];
    const entries = deferredFeedbackFor(P3, items, records);
    expect(entries.map((entry) => entry.itemId)).toEqual(['i-probe', 'i-quiz']);
    expect(entries[0]?.correct).toBe(true);
    expect(entries[0]?.choice).toBe(1);
    expect(entries[1]?.correct).toBe(false);
    expect(entries[0]?.item.stem).toContain('i-probe');
  });

  it('P3 只有一道题答过时只汇总那一道（漏答的不编造）', () => {
    const entries = deferredFeedbackFor(P3, items, [record({ itemId: 'i-quiz', correct: true })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.itemId).toBe('i-quiz');
  });

  it('同一题答过两次时取最后一次（重试后的结论才是结论）', () => {
    const records = [
      record({ itemId: 'i-quiz', correct: false, choice: 1 }),
      record({ itemId: 'i-quiz', correct: true, choice: 0 }),
    ];
    const entries = deferredFeedbackFor(P3, items, records);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.correct).toBe(true);
    expect(entries[0]?.choice).toBe(0);
  });
});
