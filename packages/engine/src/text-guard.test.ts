import { describe, expect, it } from 'vitest';
import { checkChinese, checkProbeForm, countQuestions } from './text-guard.js';

describe('全中文守卫（D10）', () => {
  it('正常的中文教学回复通过', () => {
    const r = checkChinese('这个探测器在 5.9 keV 处的能量分辨率是多少？');
    expect(r.ok).toBe(true);
    expect(r.offenders).toEqual([]);
  });

  it('纯英文回复必须被拦下——学习者读不懂', () => {
    const r = checkChinese('The energy resolution is determined by the Fano factor.');
    expect(r.ok).toBe(false);
    expect(r.offenders.length).toBeGreaterThan(0);
  });

  it('句子中间夹着未加注的英文短语也要被拦下', () => {
    const r = checkChinese('这里的载流子收集时间取决于 drift velocity 的大小。');
    expect(r.ok).toBe(false);
    expect(r.offenders).toContain('drift');
  });

  it('首字母缩略与单位不算未加注英文', () => {
    const r = checkChinese('前置放大器（PMT 输出）接到 ADC，采样率 40 MHz，噪声约 3 keV。');
    expect(r.ok).toBe(true);
  });

  it('括号里的英文注解是合规的写法', () => {
    const r = checkChinese('能量分辨率（energy resolution）主要由统计涨落决定。');
    expect(r.ok).toBe(true);
  });

  it('代码块与行内代码里的英文不参与判定', () => {
    const r = checkChinese('照这样改：`const fano = 0.12;` 然后重跑。\n```ts\nconst x = computeSnr();\n```');
    expect(r.ok).toBe(true);
  });

  it('公式里的符号不参与判定', () => {
    const r = checkChinese('分辨率先按 $\\sigma / \\mu \\times 100\\%$ 估个量级。');
    expect(r.ok).toBe(true);
  });

  it('型号名（含数字）不判违规', () => {
    const r = checkChinese('换成 AD9637 之后采样率够了，但 CR-110 成形时间要重新配。');
    expect(r.ok).toBe(true);
  });

  it('offenders 去重且保持出现顺序', () => {
    const r = checkChinese('先看 baseline，再看 baseline 的抖动，最后调 baseline。');
    expect(r.offenders).toEqual(['baseline']);
  });

  it('完全空白的输入不通过（不能拿空串糊弄过去）', () => {
    expect(checkChinese('   ').ok).toBe(false);
  });
});

describe('visibleResponse 的追问形态', () => {
  it('以问号结尾的追问通过', () => {
    expect(checkProbeForm('你觉得这一步的单位应该是什么？', true)).toEqual({ ok: true, reason: 'ok' });
  });

  it('英文问号结尾也算问号', () => {
    expect(checkProbeForm('Which relation applies here?', true).ok).toBe(true);
  });

  it('标记为追问但结尾没有问号 → 不通过', () => {
    const r = checkProbeForm('这一步应该用泊松统计。', true);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('marked_probe_without_question');
  });

  it('显式标记为非追问时允许陈述句', () => {
    const r = checkProbeForm('这一章你已经走完了，可以去下一关了。', false);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('问号后面带空白也算问号结尾', () => {
    expect(checkProbeForm('那换成 CR-RC 呢？  ', true).ok).toBe(true);
  });
});

describe('每轮最多一个问题', () => {
  it('一个问号计数为 1', () => {
    expect(countQuestions('这一步该用哪个公式？')).toBe(1);
  });

  it('两个问号计数为 2 —— 用于拦截连环追问', () => {
    expect(countQuestions('先算能量？还是先算分辨率？')).toBe(2);
  });

  it('没有问号计数为 0', () => {
    expect(countQuestions('换个讲法再说一遍。')).toBe(0);
  });
});
