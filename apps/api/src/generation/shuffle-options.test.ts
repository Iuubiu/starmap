/**
 * 选项重排的守门测试。
 *
 * 缺陷背景：库里 44 道题有 37 道正确答案在下标 0（5 道题 5/5 全在 0，
 * 真随机概率 0.25^5 ≈ 0.098%）。若不在服务端重排，学生「永远选第一个」
 * 就能拿满分，而界面上完全看不出来。
 */
import { describe, expect, it } from 'vitest';
import { assembleLevelSpec, shuffleOptions } from './level-assembly.js';
import type { GeneratedQuestion } from './level-assembly.js';

function q(over: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    stem: '化简 Y = A·B + A·B̄，结果是哪一个？',
    options: ['A', 'B', 'A·B', 'A + B'],
    answer: 0,
    explainCorrect: '吸收律：A·B + A·B̄ = A·(B + B̄) = A。',
    explainWrong: '把 A·B + A·B̄ 当成 A + B 是漏掉了公共因子 A。',
    misconceptionTags: ['漏提公因子'],
    sourceRef: 'ck-001',
    hintLadder: ['先找公共因子', '把 B + B̄ 化成 1'],
    ...over,
  };
}

describe('shuffleOptions', () => {
  it('打乱后 answer 指向的仍是原来那条正确选项', () => {
    const item = { id: 'lv-auth-q1', options: ['正确', '错1', '错2', '错3'], answer: 0 };
    const out = shuffleOptions(item);
    expect(out.options[out.answer]).toBe('正确');
    expect([...out.options].sort()).toEqual([...item.options].sort());
  });

  it('同一 id 两次调用给出同一排列（可复现，产物 diff 稳定）', () => {
    const item = { id: 'lv-auth-q2', options: ['a', 'b', 'c', 'd'], answer: 2 };
    expect(shuffleOptions(item)).toEqual(shuffleOptions(item));
  });

  it('答案不落在 0 的比例足够高（不允许把 37/44 的老毛病换成本地化偏移）', () => {
    let notZero = 0;
    for (let i = 0; i < 200; i += 1) {
      const out = shuffleOptions({
        id: `lv-x-q${i}`,
        options: ['正确', '错1', '错2', '错3'],
        answer: 0,
      });
      if (out.answer !== 0) notZero += 1;
    }
    // 理论 75%；取 55% 作下界，避免抖动
    expect(notZero / 200).toBeGreaterThan(0.55);
  });

  it('只有一个选项时原样返回', () => {
    const item = { id: 'lv-one', options: ['唯一'], answer: 0 };
    expect(shuffleOptions(item)).toEqual(item);
  });
});

describe('assembleLevelSpec 之后答案位置不再挤在 0', () => {
  it('五道全 answer=0 的题，组装后至少有一道不在下标 0', () => {
    const questions = Array.from({ length: 5 }, (_, i) => q({ stem: `第 ${i + 1} 题的题干在这里？` }));
    const built = assembleLevelSpec({
      microKpId: 'kp-bool',
      microKpName: '逻辑代数基本定律',
      questions,
      levelId: 'lv-shuffle-check',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const answers = built.spec.items.map((it) => it.answer);
    expect(answers.length).toBe(5);
    expect(answers.some((a) => a !== 0)).toBe(true);
    // 每道题的 answer 仍然指向文本为 'A' 的选项
    for (const it of built.spec.items) {
      expect(it.options[it.answer]).toBe('A');
    }
  });
});
