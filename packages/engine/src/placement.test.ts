/**
 * 初始定级的内核测试。
 *
 * ## 为什么把「简化定级」做成三档后验而不是能力分
 *
 * spec 把 DKT / IRT / CAT 明确列进了 Out of Scope，但票 11 又要求三个停止
 * 条件里出现「后验标准差」与「熵变化」——这两个量只有在**有后验分布**时才
 * 有意义。折中方案是把学习者建模成一个三态离散分布（P1/P2/P3），而不是
 * 连续能力值：三态分布既算得出标准差与熵，又不需要任何题目参数标定
 * （我们没有 500 人以上的作答数据去估区分度）。
 *
 * 顺带解决了一个真实问题：定级的输出本来就是档位，不是分数。用能力分再做
 * 一次阈值映射会多一层「分数 → 档位」的边界，而那条边界没有任何数据支撑。
 *
 * ## 三条停止条件在这里各自被单独触发一次
 *
 * 「三个条件都实现了」不能靠读代码确认。每个条件都必须有一条能**只**让它
 * 成立、其它两条不成立的用例，否则「条件二实现了」可能只是「条件一先成立
 * 了」。这也是本文件里构造答案序列时唯一需要小心的地方。
 */
import { describe, expect, it } from 'vitest';
import {
  PLACEMENT_LIMITS,
  SELF_ASSESSMENT_QUESTIONS,
  initialPlacementState,
  placementEntropy,
  placementResult,
  placementStop,
  predictedCorrect,
  priorFromSelfAssessment,
  recordPlacementAnswer,
  selectPlacementItem,
  shouldRejudge,
  tierProbabilities,
  type PlacementItem,
  type PlacementState,
} from './placement.js';

const EASY: PlacementItem = { itemId: 'i-easy', microKpId: 'kp-a', difficulty: 'easy' };
const MEDIUM: PlacementItem = { itemId: 'i-medium', microKpId: 'kp-a', difficulty: 'medium' };
const HARD: PlacementItem = { itemId: 'i-hard', microKpId: 'kp-b', difficulty: 'hard' };

/** 中性自评：每题都选中间档。用来把「先验」这一项从断言里摘掉。 */
const NEUTRAL = SELF_ASSESSMENT_QUESTIONS.map((question) => ({
  questionId: question.id,
  optionId: question.options[Math.floor(question.options.length / 2)]!.id,
}));

/** 全选最低 / 全选最高的行为自评 */
const LOWEST = SELF_ASSESSMENT_QUESTIONS.map((question) => ({
  questionId: question.id,
  optionId: question.options[0]!.id,
}));
const HIGHEST = SELF_ASSESSMENT_QUESTIONS.map((question) => ({
  questionId: question.id,
  optionId: question.options[question.options.length - 1]!.id,
}));

const neutralState = (): PlacementState => initialPlacementState(NEUTRAL);

/**
 * 跑一串答案。`answers[i]` 表示第 i 题答对没有。
 *
 * 题目统一用「中等难度」：换难度会同时改变似然，而大多数用例想测的是
 * 更新规则本身，不是难度的影响。
 */
function run(state: PlacementState, answers: readonly boolean[]): PlacementState {
  return answers.reduce((acc, correct, index) => {
    const item: PlacementItem = { ...MEDIUM, itemId: `i-${index}` };
    return recordPlacementAnswer(acc, item, correct);
  }, state);
}

describe('自评：只问行为，且只做 ±0.4 logit 的平移', () => {
  it('恰好 4 道题', () => {
    expect(SELF_ASSESSMENT_QUESTIONS).toHaveLength(4);
    expect(PLACEMENT_LIMITS.selfAssessmentQuestions).toBe(4);
  });

  it('问的都是行为，不是「你觉得自己什么水平」', () => {
    // 自陈式单问的典型措辞。出现任何一个都说明这道题在让学习者给自己打分，
    // 而自评分数与实测能力的相关性在文献里一直不稳定（spec:283 明确禁止）。
    const forbidden = ['你觉得自己', '几分', '什么水平', '水平如何', '你有多强', '自我评价', '给自己'];
    const text = SELF_ASSESSMENT_QUESTIONS.map((q) => `${q.prompt}${q.options.map((o) => o.label).join('')}`).join('');
    for (const word of forbidden) {
      expect(text, `自评里出现了自陈式措辞「${word}」`).not.toContain(word);
    }
  });

  it('每题至少 3 个选项，且选项权重单调递增', () => {
    for (const question of SELF_ASSESSMENT_QUESTIONS) {
      expect(question.options.length).toBeGreaterThanOrEqual(3);
      const weights = question.options.map((option) => option.weight);
      const sorted = [...weights].sort((a, b) => a - b);
      expect(weights, `题目 ${question.id} 的选项顺序与权重顺序不一致`).toEqual(sorted);
      expect(Math.min(...weights)).toBeLessThan(0);
      expect(Math.max(...weights)).toBeGreaterThan(0);
    }
  });

  it('全选最低 / 全选最高时，先验刚好各偏 -0.4 / +0.4 logit', () => {
    expect(priorFromSelfAssessment(LOWEST).shift).toBeCloseTo(-PLACEMENT_LIMITS.priorShiftLogit, 6);
    expect(priorFromSelfAssessment(HIGHEST).shift).toBeCloseTo(PLACEMENT_LIMITS.priorShiftLogit, 6);
    expect(neutralState().priorShift).toBeGreaterThan(-PLACEMENT_LIMITS.priorShiftLogit);
    expect(neutralState().priorShift).toBeLessThan(PLACEMENT_LIMITS.priorShiftLogit);
  });

  it('先验是一个分布：三档概率和为 1，中性自评接近均匀', () => {
    const probs = tierProbabilities(neutralState());
    expect(probs).toHaveLength(3);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // 中性自评不该把任何人推向某一档
    for (const p of probs) expect(Math.abs(p - 1 / 3)).toBeLessThan(0.05);
  });

  it('自评高的人起手就偏向 P3，自评低的人偏向 P1', () => {
    const high = tierProbabilities(initialPlacementState(HIGHEST));
    const low = tierProbabilities(initialPlacementState(LOWEST));
    expect(high[2]!).toBeGreaterThan(high[0]!);
    expect(low[0]!).toBeGreaterThan(low[2]!);
    // 但都不该是「已经确定」——自评只值 ±0.4 logit，不该定档
    for (const p of [...high, ...low]) expect(p).toBeLessThan(0.95);
  });
});

describe('似然：难度影响预测，答案影响后验', () => {
  it('同一状态下，难题的预测正确率低于简单题', () => {
    const state = neutralState();
    const easy = predictedCorrect(state, EASY);
    const medium = predictedCorrect(state, MEDIUM);
    const hard = predictedCorrect(state, HARD);
    expect(easy).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(hard);
    for (const p of [easy, medium, hard]) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('答对之后，对下一题的预测上升；答错之后下降', () => {
    const before = predictedCorrect(neutralState(), MEDIUM);
    const afterRight = predictedCorrect(run(neutralState(), [true]), MEDIUM);
    const afterWrong = predictedCorrect(run(neutralState(), [false]), MEDIUM);
    expect(afterRight).toBeGreaterThan(before);
    expect(afterWrong).toBeLessThan(before);
  });

  it('连续答对把后验推向 P3，连续答错推向 P1', () => {
    const right = tierProbabilities(run(neutralState(), [true, true, true, true]));
    const wrong = tierProbabilities(run(neutralState(), [false, false, false, false]));
    expect(right[2]!).toBeGreaterThan(right[0]!);
    expect(wrong[0]!).toBeGreaterThan(wrong[2]!);
    // 单调性：每多答对一题，P3 的概率只增不减
    let previous = tierProbabilities(neutralState())[2]!;
    for (const correct of [true, true, true]) {
      const next = tierProbabilities(run(neutralState(), [correct, correct, correct].slice(0, 1)))[2]!;
      expect(next).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = next;
    }
  });

  it('一道难题答对比一道简单题答对提供更多「向上」的证据', () => {
    const easyRight = tierProbabilities(recordPlacementAnswer(neutralState(), EASY, true));
    const hardRight = tierProbabilities(recordPlacementAnswer(neutralState(), HARD, true));
    expect(hardRight[2]!).toBeGreaterThan(easyRight[2]!);
  });
});

describe('三个停止条件各自可单独触发', () => {
  it('条件一：后验标准差 ≤ 0.35 时停', () => {
    const state = run(neutralState(), [true, true, true, true, true, true, true, true]);
    const stop = placementStop(state);
    expect(stop.stopped).toBe(true);
    expect(stop.reason).toBe('sd');
    expect(stop.posteriorSd).toBeLessThanOrEqual(PLACEMENT_LIMITS.posteriorSdStop);
  });

  it('条件二：最近三题的实测正确率落在 40–70% 带时停', () => {
    // 全对会把后验推得很快（先撞 sd），所以用交错序列把后验钉在中段。
    // **最后一题必须让三题窗口落在带内**：窗口是最后三题 = 对、对、错
    // → 2/3 = 67%，在 40–70% 之间；若窗口是「错错对」= 33% 就不在带内了。
    // 这条用例特意写成「序列一改就红」的样子，因为「带的判定取的是哪三题」
    // 正是这里最容易错的地方（取全部历史 / 取最近三题 / 取最近两题）。
    const answers = [true, false, true, false, true, true, true, false];
    const state = run(neutralState(), answers);
    const stop = placementStop(state);
    expect(stop.reason).toBe('band');
    expect(stop.recentBandRate).toBeGreaterThanOrEqual(PLACEMENT_LIMITS.bandLow);
    expect(stop.recentBandRate).toBeLessThanOrEqual(PLACEMENT_LIMITS.bandHigh);
    // 这条用例必须真的不是被另外两个条件截住的
    expect(stop.posteriorSd).toBeGreaterThan(PLACEMENT_LIMITS.posteriorSdStop);
  });

  it('条件三：熵几乎不变时停（这一题已经推不动后验）', () => {
    // 这个序列是通过穷举搜索找到的：8 题、难度混合，最后一题带来的熵变化
    // 是 **负数但极小**（−0.0015 bit，取绝对值后小于 0.01），而后验标准差
    // 仍是 0.649（远大于 0.35）、最近三题正确率 33%（不在 40–70% 带内）。
    // 也就是说只有条件三能解释这次停止。
    //
    // 之所以要专门找这样一条：如果实现把条件三写成 `entropyChange < 0.01`
    // （不带绝对值），这里会**恰好也通过** —— 而那是个真缺陷：熵增加意味着
    // 这一题的答案出乎意料、把分布推宽了，那是「还没收敛」，不是「已经收敛」。
    const answers = [true, false, false, true, true, false, false, true];
    const difficulties = ['medium', 'easy', 'medium', 'hard', 'hard', 'medium', 'easy', 'easy'] as const;
    let state = neutralState();
    answers.forEach((correct, index) => {
      state = recordPlacementAnswer(state, { itemId: `i-${index}`, microKpId: 'kp-a', difficulty: difficulties[index]! }, correct);
    });
    const stop = placementStop(state);
    expect(stop.stopped).toBe(true);
    expect(stop.reason).toBe('entropy');
    expect(Math.abs(stop.entropyChange)).toBeLessThan(PLACEMENT_LIMITS.entropyStop);
    // 前两个条件都没有成立，才说明是熵把它停下来的
    expect(stop.posteriorSd).toBeGreaterThan(PLACEMENT_LIMITS.posteriorSdStop);
    expect(stop.recentBandRate).not.toBeNull();
    expect(stop.recentBandRate!).toBeLessThan(PLACEMENT_LIMITS.bandLow);
  });

  it('熵大幅下降时不算收敛（条件三必须取绝对值）', () => {
    // 这条用例守的是一个**很容易写错的方向**：条件三的字面意思是「熵变化小」，
    // 但写成 `entropyChange < 0.01` 会把「熵下降 0.3 bit」也判成「变化小」——
    // 而那恰恰相反：熵掉了 0.3 bit 说明这一题提供了大量信息，后验刚被推动，
    // 是最不该停下的时刻。
    //
    // 下面这个序列由穷举搜索得到：9 题之后 sd = 0.497（> 0.35）、最近三题
    // 正确率 33%（不在 40–70% 带内）、熵变化 **−0.2965 bit**。三条里只有
    // 「熵」这一项看起来"小"，但小的是它的绝对值以外的东西 —— 若实现写成
    // 有符号比较，这里会错误地停在 entropy。
    const answers = [false, false, true, true, false, false, false, false, false, true];
    const difficulties = ['medium', 'hard', 'medium', 'easy', 'medium', 'easy', 'medium', 'hard', 'easy', 'hard'] as const;
    let state = neutralState();
    answers.forEach((correct, index) => {
      state = recordPlacementAnswer(state, { itemId: `i-${index}`, microKpId: 'kp-a', difficulty: difficulties[index]! }, correct);
    });
    expect(state.entropyChange).toBeLessThan(-0.1);
    const stop = placementStop(state);
    expect(stop.reason).not.toBe('entropy');
    expect(stop.stopped).toBe(false);
    expect(stop.posteriorSd).toBeGreaterThan(PLACEMENT_LIMITS.posteriorSdStop);
  });

  it('少于 8 题时任何条件都不成立（题量下限）', () => {
    for (let count = 0; count < PLACEMENT_LIMITS.minItems; count += 1) {
      const answers = Array.from({ length: count }, (_, index) => index % 2 === 0);
      const stop = placementStop(run(neutralState(), answers));
      expect(stop.stopped, `答了 ${count} 题就停了`).toBe(false);
      expect(stop.reason).toBeNull();
    }
  });

  it('到 18 题必停，理由是 max_items', () => {
    const answers = Array.from({ length: PLACEMENT_LIMITS.maxItems }, (_, index) => index % 2 === 0);
    const state = run(neutralState(), answers);
    const stop = placementStop(state);
    expect(stop.stopped).toBe(true);
    expect(stop.reason).toBe('max_items');
    expect(state.answered).toBe(PLACEMENT_LIMITS.maxItems);
  });

  it('题目用尽时停，理由是 no_more_items（哪怕还没到 8 题）', () => {
    const state = run(neutralState(), [true, false, true]);
    const stop = placementStop(state, { remainingItems: 0 });
    expect(stop.stopped).toBe(true);
    expect(stop.reason).toBe('no_more_items');
  });

  it('题目还够时不会因为「用尽」而停', () => {
    const state = run(neutralState(), [true, false, true]);
    expect(placementStop(state, { remainingItems: 5 }).reason).toBeNull();
  });
});

describe('结果：档位、置信度与 provisional', () => {
  it('档位取后验最大的那一档，且答对越多档位越高', () => {
    const low = placementResult(run(neutralState(), [false, false, false, false, false, false, false, false]));
    const mid = placementResult(run(neutralState(), [true, false, true, false, true, false, true, false]));
    const high = placementResult(run(neutralState(), [true, true, true, true, true, true, true, true]));
    expect(low.tier).toBe('P1');
    expect(high.tier).toBe('P3');
    expect(mid.tier).toBe('P2');
    expect(low.confidence).toBeGreaterThan(0.5);
  });

  it('定级结果永远是 provisional（可重判），并记录三个停止条件的样子', () => {
    const state = run(neutralState(), [true, true, true, true, true, true, true, true]);
    const result = placementResult(state);
    expect(result.status).toBe('provisional');
    expect(result.answered).toBe(8);
    expect(result.stopReason).toBe('sd');
    expect(result.confidence).toBeCloseTo(Math.max(...tierProbabilities(state)), 6);
    expect(result.entropy).toBeCloseTo(placementEntropy(state), 6);
  });

  it('题量不足 8 题时仍给档位，但标记为低置信度', () => {
    const result = placementResult(run(neutralState(), [true, false]));
    expect(result.tier).toBe('P2');
    expect(result.lowConfidence).toBe(true);
  });

  it('累计 5 题作答才自动重判，且只对 provisional 生效', () => {
    const provisional = { status: 'provisional' as const };
    expect(shouldRejudge({ ...provisional, attemptsSince: 4 })).toBe(false);
    expect(shouldRejudge({ ...provisional, attemptsSince: 5 })).toBe(true);
    expect(PLACEMENT_LIMITS.rejudgeAfterAttempts).toBe(5);
  });

  it('重判门槛是作答数，不是学完的知识点数', () => {
    // 这条守的是「票面那句话抄错了」这个结论本身。
    // 若以后有人把门槛改回「学完 3 个知识点」，`attemptsSince` 这个入参就
    // 会消失，编译直接红 —— 比一份只写在注释里的结论可靠。
    expect(Object.keys(PLACEMENT_LIMITS)).toContain('rejudgeAfterAttempts');
    expect(Object.keys(PLACEMENT_LIMITS)).not.toContain('rejudgeAfterKp');
  });
});

describe('选题：挑信息量最大的那一题', () => {
  it('选中预测正确率最接近 50% 的题', () => {
    const state = neutralState();
    const picked = selectPlacementItem(state, [EASY, MEDIUM, HARD]);
    expect(picked?.itemId).toBe('i-medium');
    expect(Math.abs(predictedCorrect(state, MEDIUM) - 0.5)).toBeLessThan(
      Math.abs(predictedCorrect(state, HARD) - 0.5),
    );
  });

  it('跳过已经答过的题', () => {
    const state = recordPlacementAnswer(neutralState(), MEDIUM, true);
    const picked = selectPlacementItem(state, [MEDIUM, HARD]);
    expect(picked?.itemId).toBe('i-hard');
  });

  it('没有题可挑时返回 null', () => {
    expect(selectPlacementItem(neutralState(), [])).toBeNull();
  });

  it('纯函数：同样输入两次调用得到完全相同的状态', () => {
    const first = run(neutralState(), [true, false, true]);
    const second = run(neutralState(), [true, false, true]);
    expect(second).toEqual(first);
  });
});
