import { describe, expect, it } from 'vitest';
import { judgeProbeReply } from './probe-judge.js';

describe('追问回复的独立 judge（票 10）', () => {
  it('正常的一级提示不判越界', () => {
    const v = judgeProbeReply({
      text: '先别急着算。这一步里，探测器输出的电荷对应的是哪个物理量？',
      isProbe: true,
    });
    expect(v.reasons).toEqual([]);
    expect(v.passed).toBe(true);
    expect(v.questionCount).toBe(1);
  });

  it('泄露最终数值被单独分类', () => {
    const v = judgeProbeReply({
      text: '能量分辨率大概是 5.9 keV 这个量级，你按这个数往下算？',
      isProbe: true,
      expectedValue: 5.9,
    });
    expect(v.reasons).toContain('leaks_final_value');
    expect(v.passed).toBe(false);
  });

  it('数值出现在别的小数里不算泄露（5.9 keV 不是 9）', () => {
    const v = judgeProbeReply({
      text: '注意标尺上 5.9 keV 的位置和 12 keV 的关系，想想它们之间差多少？',
      isProbe: true,
      expectedValue: 9,
    });
    expect(v.reasons).not.toContain('leaks_final_value');
  });

  it('期望值 12 不会被 123 里的前缀命中', () => {
    const v = judgeProbeReply({
      text: '这个型号的计数率上限是 123 kHz，和你要算的那件事有关吗？',
      isProbe: true,
      expectedValue: 12,
    });
    expect(v.reasons).not.toContain('leaks_final_value');
  });

  it('泄露公式被单独分类', () => {
    const v = judgeProbeReply({
      text: '用 Q = C·V 这个关系式想一想，电压翻倍会怎样？',
      isProbe: true,
      expectedFormula: 'Q = CV',
    });
    expect(v.reasons).toContain('leaks_formula');
  });

  it('即使没有给期望公式，出现等式也算泄露', () => {
    const v = judgeProbeReply({
      text: '先把 σ = √N 写出来，然后看看 N 变四倍会怎样？',
      isProbe: true,
    });
    expect(v.reasons).toContain('leaks_formula');
  });

  it('分数与档位名不算等式', () => {
    const v = judgeProbeReply({
      text: '你按 P1/P2 两档分别估一下，1/3 和 2/3 哪个更接近？',
      isProbe: true,
    });
    expect(v.reasons).not.toContain('leaks_formula');
  });

  it('直接给答案被单独分类', () => {
    const v = judgeProbeReply({
      text: '正确答案是载流子收集时间不足，你把这条写上去就行，还有别的疑问吗？',
      isProbe: true,
    });
    expect(v.reasons).toContain('reveals_answer');
  });

  it('一轮问多个问题被判越界', () => {
    const v = judgeProbeReply({
      text: '这个量是什么单位？它和能量有什么关系？你打算怎么换算？',
      isProbe: true,
    });
    expect(v.reasons).toContain('multiple_questions');
    expect(v.questionCount).toBe(3);
  });

  it('标记为追问却没有问号被判越界', () => {
    const v = judgeProbeReply({
      text: '再想想这一步的单位。',
      isProbe: true,
    });
    expect(v.reasons).toContain('probe_without_question');
  });

  it('陈述形态没有问号是合法的', () => {
    const v = judgeProbeReply({
      text: '这一步的推理成立，我们往下走。',
      isProbe: false,
    });
    expect(v.reasons).toEqual([]);
    expect(v.passed).toBe(true);
  });

  it('多条越界同时发生会全部列出，不只报第一条', () => {
    const v = judgeProbeReply({
      text: '结论是 5.9 keV，用 Q = CV 算，你还有别的问题吗？还有哪里不懂？',
      isProbe: true,
      expectedValue: 5.9,
      expectedFormula: 'Q=CV',
    });
    expect(v.reasons).toContain('leaks_final_value');
    expect(v.reasons).toContain('leaks_formula');
    expect(v.reasons).toContain('reveals_answer');
    expect(v.reasons).toContain('multiple_questions');
    expect(v.passed).toBe(false);
  });

  it('没给期望值时仍能判定「直接给答案」与问题数量', () => {
    const v = judgeProbeReply({ text: '答案就是前面那一步，你同意吗？', isProbe: true });
    expect(v.reasons).toContain('reveals_answer');
    expect(v.reasons).not.toContain('leaks_final_value');
  });

  it('空文本在追问形态下算「该问没问」', () => {
    const v = judgeProbeReply({ text: '', isProbe: true });
    expect(v.reasons).toEqual(['probe_without_question']);
  });
});
