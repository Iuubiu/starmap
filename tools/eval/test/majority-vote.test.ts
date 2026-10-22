/**
 * 多次采样取多数票的回归测试。
 *
 * 这条测试防的是一个**已经发生过**的缺陷：`run.ts` 回填 judge 判断时只读
 * `rounds[i][0]`，把另外两票丢掉。症状是某一档的答错识别率凭空掉一半，
 * 而报告上完全看不出这是工具的问题 —— 它读起来像「系统对老周的错误反馈变差了」。
 *
 * 三次采样是票 20 用来量 judge 漂移的；如果判断只取第一票，那三次采样就
 * 只剩「测漂移」一个用途，而「测准确率」用的是一票。测试把这两件事钉在一起。
 */

import { describe, expect, it } from 'vitest';
import { majorityVote } from '../src/metrics/compute.ts';
import { computeRecognition, type RecognitionObservation } from '../src/metrics/compute.ts';

describe('多次采样取多数票', () => {
  it('三票同向时取该值', () => {
    expect(majorityVote([true, true, true])).toBe(true);
    expect(majorityVote([false, false, false])).toBe(false);
  });

  it('2:1 时取多数，不是取第一票', () => {
    /* 这一条就是那个真实缺陷：P2 的 identifiesWrong 三票是 false/true/true。 */
    expect(majorityVote([false, true, true])).toBe(true);
    expect(majorityVote([true, false, false])).toBe(false);
  });

  it('平票返回 null，不猜', () => {
    expect(majorityVote([true, false])).toBeNull();
    expect(majorityVote([true, false, null])).toBeNull();
  });

  it('null 不参与计票，但不能把平局变多数', () => {
    expect(majorityVote([true, null, null])).toBe(true);
    expect(majorityVote([null, null, null])).toBeNull();
  });
});

describe('识别率的分母口径', () => {
  it('多数票为 null 的观察计入 unjudged，不进分母', () => {
    const observations: RecognitionObservation[] = [
      {
        turn: 1,
        stage: 'answer',
        correct: false,
        feedbackText: '再想想',
        judgement: { acknowledgesCorrect: null, identifiesWrong: null },
      },
      {
        turn: 2,
        stage: 'answer',
        correct: false,
        feedbackText: '你错在把与当成了或',
        judgement: { acknowledgesCorrect: null, identifiesWrong: true },
      },
    ];
    const metrics = computeRecognition(observations);
    expect(metrics.unjudged).toBe(1);
    expect(metrics.wrong.numerator).toBe(1);
    expect(metrics.wrong.denominator).toBe(1);
  });
});
