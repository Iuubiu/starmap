/**
 * 术语桥的测试。
 *
 * ## 这份测试守的是什么
 *
 * `expandQuery` 本身很短，但它的两个失败模式都不会报错：
 *
 * 1. **展开不足**：`锗探测器` 没被认出来 ⇒ 中文 query 对英文正文仍然零命中，
 *    表现与「没有这个功能」一模一样。
 * 2. **展开过度**：`探测器` 在 `锗探测器` 之外又被单独展开一次 ⇒ 检索被
 *    「Microstrip detectors」「Diamond detectors」这类无关段落淹没，而
 *    「命中数变多」看起来像成功。
 *
 * 所以下面每组用例都成对写：一条证明该展开的展开了，一条证明不该展开的
 * 没展开。最长匹配优先是这两条之间的那根线。
 */
import { describe, expect, it } from 'vitest';
import { expandQuery } from './glossary.js';
import type { GlossaryEntry } from './glossary.js';

/** 真实词表里的几条（`content/glossary.json` 已生成，这里只挑验收要用的）。 */
const GLOSSARY: GlossaryEntry[] = [
  { zh: '锗探测器', en: ['Germanium Detectors'] },
  { zh: '探测器', en: ['Detector'] },
  { zh: '脉冲成形', en: ['Pulse shaping'] },
  { zh: '脉冲成形计数', en: ['Pulse Shaping, Counting, and Timing'] },
  { zh: '死时间', en: ['Dead Time'] },
  { zh: '多道分析器', en: ['Multichannel Analyzer'] },
  { zh: '能量分辨率', en: ['Energy resolution'] },
  { zh: '电荷灵敏前置放大器', en: ['Charge-Sensitive Preamplifiers'] },
];

describe('中文 query 展开成英文术语', () => {
  it('`锗探测器能量分辨` 展开出 Germanium Detectors', () => {
    const result = expandQuery('锗探测器能量分辨', GLOSSARY);
    expect(result.terms).toContain('Germanium Detectors');
    // 派单要求「terms 含 germanium」：真正进 BM25 的是 tokenize 之后的词，
    // 所以这里断言分词结果而不是整串（整串命中不代表能检索到）。
    const tokens = result.terms.join(' ').toLowerCase().split(/[^a-z0-9]+/);
    expect(tokens).toContain('germanium');
    expect(result.expansions).toEqual([{ zh: '锗探测器', en: 'Germanium Detectors' }]);
  });

  it('`脉冲成形` 展开出 Pulse shaping，且 `pulse` 是一个独立 token', () => {
    const result = expandQuery('脉冲成形', GLOSSARY);
    expect(result.terms).toContain('Pulse shaping');
    expect(result.terms.join(' ').toLowerCase()).toContain('pulse');
    expect(result.expansions).toEqual([{ zh: '脉冲成形', en: 'Pulse shaping' }]);
  });

  it('`死时间` 与 `多道分析器` 也各展开成一条', () => {
    expect(expandQuery('死时间是什么', GLOSSARY).terms).toEqual(['Dead Time']);
    expect(expandQuery('多道分析器的原理', GLOSSARY).terms).toEqual(['Multichannel Analyzer']);
  });

  it('一条 query 里的多个术语全部展开，按出现顺序排列', () => {
    const result = expandQuery('死时间与能量分辨率', GLOSSARY);
    expect(result.terms).toEqual(['Dead Time', 'Energy resolution']);
    expect(result.expansions.map((e) => e.zh)).toEqual(['死时间', '能量分辨率']);
  });

  it('同一个中文术语有多个英文写法时全部展开（每个写法一条 expansions）', () => {
    const glossary: GlossaryEntry[] = [{ zh: '脉冲成形', en: ['Pulse shaping', 'Pulse Shaping Networks'] }];
    const result = expandQuery('脉冲成形', glossary);
    expect(result.terms).toEqual(['Pulse shaping', 'Pulse Shaping Networks']);
    expect(result.expansions).toEqual([
      { zh: '脉冲成形', en: 'Pulse shaping' },
      { zh: '脉冲成形', en: 'Pulse Shaping Networks' },
    ]);
  });
});

describe('选词：最大化覆盖的字符数', () => {
  it('`锗探测器` 命中时不再单独展开 `探测器`', () => {
    const result = expandQuery('锗探测器能量分辨', GLOSSARY);
    expect(result.expansions.map((e) => e.zh)).toEqual(['锗探测器']);
    // 反向对照：`探测器` 确实在词表里，没被展开不是因为词表里没有它
    expect(expandQuery('探测器', GLOSSARY).terms).toEqual(['Detector']);
  });

  it('`脉冲成形计数` 命中时不再单独展开 `脉冲成形`', () => {
    const result = expandQuery('脉冲成形计数电路', GLOSSARY);
    expect(result.expansions.map((e) => e.zh)).toEqual(['脉冲成形计数']);
    expect(result.terms).toEqual(['Pulse Shaping, Counting, and Timing']);
  });

  it('短术语在长术语**未覆盖**的字符上仍然展开', () => {
    // `锗探测器` 占前 4 字，`探测器` 在「与」之后又出现一次 —— 那次是真命中
    const result = expandQuery('锗探测器与探测器的区别', GLOSSARY);
    expect(result.expansions.map((e) => e.zh)).toEqual(['锗探测器', '探测器']);
    expect(result.terms).toEqual(['Germanium Detectors', 'Detector']);
  });

  it('**不**是「最长优先」：`前置放大器噪声` 要选 `前置放大器` + `噪声`', () => {
    // 真实词表里三条候选：`放大器噪声`（5 字，一条小节标题）、
    // `前置放大器`（5 字）、`放大器`（3 字）、`噪声`（2 字）。
    // 「最长优先」会先吃掉 `放大器噪声`，于是 `前置放大器` 匹配不上 ——
    // 而 `放大器噪声 → Amplifier noise matching` 在正文里几乎不出现，
    // `Preamplifier` + `Noise` 才是学生要找的词。
    // 最大化覆盖：5 + 2 = 7 > 5。
    const glossary: GlossaryEntry[] = [
      { zh: '放大器噪声', en: ['Amplifier noise matching'] },
      { zh: '前置放大器', en: ['Preamplifier'] },
      { zh: '放大器', en: ['Amplifier'] },
      { zh: '噪声', en: ['Noise'] },
    ];
    const result = expandQuery('前置放大器噪声', glossary);
    expect(result.expansions.map((e) => e.zh)).toEqual(['前置放大器', '噪声']);
    expect(result.terms).toEqual(['Preamplifier', 'Noise']);
  });

  it('并列覆盖时取词条数更少的那组', () => {
    // `abcd` 可以被 `abcd`（4 字，1 条）或 `ab` + `cd`（2 条）覆盖，
    // 两者覆盖字符数相同 —— 选 1 条，因为它更像「一个术语」。
    const glossary: GlossaryEntry[] = [
      { zh: 'abcd', en: ['one'] },
      { zh: 'ab', en: ['two'] },
      { zh: 'cd', en: ['three'] },
    ];
    // 用汉字构造（CJK 判定要求 query 里有汉字）
    const zhGlossary: GlossaryEntry[] = [
      { zh: '甲乙丙丁', en: ['one'] },
      { zh: '甲乙', en: ['two'] },
      { zh: '丙丁', en: ['three'] },
    ];
    expect(expandQuery('甲乙丙丁', zhGlossary).terms).toEqual(['one']);
    // 反向对照：拆开的两条也能单独命中
    expect(expandQuery('甲乙', zhGlossary).terms).toEqual(['two']);
    expect(expandQuery('丙丁', zhGlossary).terms).toEqual(['three']);
    expect(glossary).toHaveLength(3);
  });

  it('词表顺序不影响结果（区间调度与数组顺序无关）', () => {
    const reversed = [...GLOSSARY].reverse();
    expect(expandQuery('锗探测器能量分辨', reversed)).toEqual(
      expandQuery('锗探测器能量分辨', GLOSSARY),
    );
  });
});

describe('不该展开的情况', () => {
  it('纯英文 query 不展开 —— 它直接就能命中英文正文', () => {
    const result = expandQuery('germanium detector resolution', GLOSSARY);
    expect(result.terms).toEqual([]);
    expect(result.expansions).toEqual([]);
  });

  it('中英混合 query 只展开中文部分', () => {
    const result = expandQuery('germanium 死时间', GLOSSARY);
    expect(result.terms).toEqual(['Dead Time']);
    expect(result.expansions.map((e) => e.zh)).toEqual(['死时间']);
  });

  it('空 query / 空词表 / 没有命中时返回空结构，而不是抛错', () => {
    expect(expandQuery('', GLOSSARY)).toEqual({ terms: [], expansions: [] });
    expect(expandQuery('锗探测器', [])).toEqual({ terms: [], expansions: [] });
    expect(expandQuery('完全无关的一句话', GLOSSARY)).toEqual({ terms: [], expansions: [] });
  });

  it('单字术语不参与匹配（词表里就算有也不展开）', () => {
    const glossary: GlossaryEntry[] = [
      { zh: '与', en: ['and'] },
      { zh: '死时间', en: ['Dead Time'] },
    ];
    const result = expandQuery('死时间与噪声', glossary);
    expect(result.expansions.map((e) => e.zh)).toEqual(['死时间']);
    expect(result.terms).toEqual(['Dead Time']);
  });

  it('展开词按小写去重（`Pulse shaping` / `pulse shaping` 只留一个）', () => {
    const glossary: GlossaryEntry[] = [
      { zh: '脉冲成形', en: ['Pulse shaping', 'pulse shaping'] },
    ];
    const result = expandQuery('脉冲成形', glossary);
    expect(result.terms).toEqual(['Pulse shaping']);
    // 但 expansions 仍然两条：调试器要看到「词表里有两个写法」这件事
    expect(result.expansions).toHaveLength(2);
  });

  it('纯空白 en 被跳过，不会造出空 term', () => {
    const glossary: GlossaryEntry[] = [{ zh: '死时间', en: ['   ', 'Dead Time'] }];
    expect(expandQuery('死时间', glossary).terms).toEqual(['Dead Time']);
  });
});
