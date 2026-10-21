/**
 * 三档参数表的测试。写法说明见每组的注释——重点不是「表里的数字对不对」，
 * 而是**表与别处引用它的地方是否仍然一致**。
 */
import { describe, expect, it } from 'vitest';
import { TIER_LADDER } from './probe-ladder.js';
import {
  FIRST_ROUND_DESCRIPTION,
  TIER_LABEL,
  TIER_PARAMS,
  masteryRuleProgress,
  planFirstRound,
  showsFeedbackImmediately,
  tierParams,
} from './tier.js';
import type { FirstRoundStepShape } from './tier.js';

const TIERS = ['P1', 'P2', 'P3'] as const;

describe('三档参数表', () => {
  it('六个维度在每一档都有值，且不是三档同一个值', () => {
    for (const tier of TIERS) {
      const params = TIER_PARAMS[tier];
      expect(params.tier).toBe(tier);
      expect(params.firstRoundShape).toBeTruthy();
      expect(params.ladder.cap).toBeGreaterThanOrEqual(params.ladder.start);
      expect(params.sessionNewKpLimit).toBeGreaterThan(0);
      expect(params.feedbackTiming).toBeTruthy();
      expect(params.attemptsPerItem).toBeGreaterThan(0);
      expect(params.masteryRule.consecutiveCorrect).toBeGreaterThan(0);
    }
    // 三档必须真的不同——如果三个档位拿到同一份参数，"分档"这件事就是空转。
    const shapes = TIERS.map((tier) => TIER_PARAMS[tier].firstRoundShape);
    expect(new Set(shapes).size).toBe(3);
    const limits = TIERS.map((tier) => TIER_PARAMS[tier].sessionNewKpLimit);
    expect(new Set(limits).size).toBe(3);
  });

  it('阶梯维度就是 probe-ladder 的 TIER_LADDER，不是抄的一份数字', () => {
    for (const tier of TIERS) {
      // 逐字相等：任何一处改动都会让这条断言红。抄一份数字的后果不是多四行代码，
      // 而是某天只改了其中一份、另一份还在按旧上限给提示。
      expect(TIER_PARAMS[tier].ladder).toEqual(TIER_LADDER[tier]);
    }
    expect(TIER_PARAMS.P1.ladder.cap).toBe(3);
    expect(TIER_PARAMS.P2.ladder.cap).toBe(4);
    expect(TIER_PARAMS.P3.ladder.cap).toBe(5);
  });

  it('spec §5 的六维数值逐条对上', () => {
    expect(TIER_PARAMS.P1.sessionNewKpLimit).toBe(2);
    expect(TIER_PARAMS.P2.sessionNewKpLimit).toBe(3);
    expect(TIER_PARAMS.P3.sessionNewKpLimit).toBe(4);
    expect(TIER_PARAMS.P1.attemptsPerItem).toBe(2);
    expect(TIER_PARAMS.P2.attemptsPerItem).toBe(2);
    expect(TIER_PARAMS.P3.attemptsPerItem).toBe(1);
    expect(TIER_PARAMS.P1.feedbackTiming).toBe('step_immediate');
    expect(TIER_PARAMS.P2.feedbackTiming).toBe('step_immediate_with_summary');
    expect(TIER_PARAMS.P3.feedbackTiming).toBe('item_deferred_with_summary');
    expect(TIER_PARAMS.P1.masteryRule.consecutiveCorrect).toBe(2);
    expect(TIER_PARAMS.P2.masteryRule.consecutiveCorrect).toBe(2);
    expect(TIER_PARAMS.P3.masteryRule.consecutiveCorrect).toBe(1);
    for (const tier of TIERS) {
      expect(TIER_PARAMS[tier].masteryRule.requiresTransferItem).toBe(true);
    }
  });

  it('未知档位回落 P1，而不是抛错或返回 undefined', () => {
    // 数据库里出现脏值、旧客户端传 'L1' —— 这些都不该让整个关卡页 500。
    expect(tierParams('P9').tier).toBe('P1');
    expect(tierParams(null).tier).toBe('P1');
    expect(tierParams(undefined).tier).toBe('P1');
    expect(tierParams('P3').tier).toBe('P3');
  });

  it('每一档都有可读的中文标签与首轮说明', () => {
    for (const tier of TIERS) {
      expect(TIER_LABEL[tier]).not.toBe('');
      expect(FIRST_ROUND_DESCRIPTION[TIER_PARAMS[tier].firstRoundShape]).not.toBe('');
    }
  });
});

describe('首轮计划', () => {
  const steps: FirstRoundStepShape[] = [
    { kind: 'guide', cardIds: ['c1', 'c2'], itemIds: [] },
    { kind: 'detail', cardIds: ['c3'], itemIds: [] },
    { kind: 'probe', cardIds: [], itemIds: ['i1'] },
    { kind: 'quiz', cardIds: [], itemIds: ['i2'] },
  ];

  it('P1 完整样例：从第一段开始，卡片全展开', () => {
    const plan = planFirstRound(steps, 'P1');
    expect(plan.shape).toBe('worked_example');
    expect(plan.startStepIndex).toBe(0);
    expect(plan.cardMode).toBe('all');
    expect(plan.fadedCardId).toBeNull();
  });

  it('P2 补全步骤：从第一段开始，藏掉首个带卡段的最后一张卡', () => {
    const plan = planFirstRound(steps, 'P2');
    expect(plan.shape).toBe('completion');
    expect(plan.startStepIndex).toBe(0);
    expect(plan.cardMode).toBe('faded');
    // 是 c2（第一段的最后一张），不是整关的最后一张 c3。
    expect(plan.fadedCardId).toBe('c2');
  });

  it('P3 直接出题：从第一段带题的段开始', () => {
    const plan = planFirstRound(steps, 'P3');
    expect(plan.shape).toBe('direct');
    expect(plan.startStepIndex).toBe(2);
    expect(plan.cardMode).toBe('none');
  });

  it('整关没有题时 P3 退回第 0 段，不给出空白页', () => {
    const noItems: FirstRoundStepShape[] = [
      { kind: 'guide', cardIds: ['c1'], itemIds: [] },
      { kind: 'summary', cardIds: ['c2'], itemIds: [] },
    ];
    expect(planFirstRound(noItems, 'P3').startStepIndex).toBe(0);
  });

  it('整关没有卡时 fadedCardId 为 null，不抛错', () => {
    const noCards: FirstRoundStepShape[] = [{ kind: 'quiz', cardIds: [], itemIds: ['i1'] }];
    expect(planFirstRound(noCards, 'P2').fadedCardId).toBeNull();
  });

  it('三档对同一个关卡给出三种不同的计划', () => {
    // 这就是票面验收 2「参数改变能被观察到」在纯函数层的证据：
    // 同一份关卡规范，三档拿到的 plan 互不相同。
    const plans = TIERS.map((tier) => planFirstRound(steps, tier));
    expect(new Set(plans.map((plan) => `${plan.shape}:${plan.startStepIndex}:${plan.cardMode}`)).size).toBe(
      3,
    );
  });
});

describe('掌握判定', () => {
  it('P1/P2 需要连续答对 2 次，P3 只需 1 次', () => {
    const one = [{ correct: true }];
    expect(masteryRuleProgress(one, TIER_PARAMS.P3.masteryRule).satisfied).toBe(false);
    // P3 的一次还不够，因为还缺迁移题；补上迁移题就满足。
    expect(
      masteryRuleProgress([{ correct: true, knowledgeKind: 'comprehensive' }], TIER_PARAMS.P3.masteryRule)
        .satisfied,
    ).toBe(true);
    // P1 同样的记录不满足：连对次数不够。
    expect(
      masteryRuleProgress([{ correct: true, knowledgeKind: 'comprehensive' }], TIER_PARAMS.P1.masteryRule)
        .satisfied,
    ).toBe(false);
  });

  it('连续计数只看末尾：中间答错会清零', () => {
    const records = [
      { correct: true },
      { correct: true },
      { correct: false },
      { correct: true },
    ];
    expect(masteryRuleProgress(records, TIER_PARAMS.P1.masteryRule).consecutiveCorrect).toBe(1);
  });

  it('缺什么要说清楚，而不是只给一个 false', () => {
    const progress = masteryRuleProgress([{ correct: true }], TIER_PARAMS.P1.masteryRule);
    expect(progress.satisfied).toBe(false);
    expect(progress.missing).toEqual(['还要连续答对 1 次', '还要做一道迁移题']);
  });

  it('迁移题按 knowledge_kind 认，任何位置的 comprehensive 都算', () => {
    const records = [
      { correct: true, knowledgeKind: 'comprehensive' as const },
      { correct: true },
      { correct: true },
    ];
    expect(masteryRuleProgress(records, TIER_PARAMS.P1.masteryRule).hasTransferItem).toBe(true);
    expect(masteryRuleProgress(records, TIER_PARAMS.P1.masteryRule).satisfied).toBe(true);
  });
});

describe('反馈延迟', () => {
  it('只有 P3 不当场显示解析', () => {
    expect(showsFeedbackImmediately('P1')).toBe(true);
    expect(showsFeedbackImmediately('P2')).toBe(true);
    expect(showsFeedbackImmediately('P3')).toBe(false);
  });
});
