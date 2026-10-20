import { describe, expect, it } from 'vitest';
import { reasonKindLabel, reasonText, renderReason, type Reason } from './reason';

/**
 * `board/reason.ts` 的单元测试。
 *
 * # 这不是数据一致性测试
 *
 * 这些用例断言的是**事实 → 中文**这一层：数字有没有原样带出来、该说的有没有
 * 说清、缺事实时会不会崩。「事实里的数字是不是库里的真值」由
 * `apps/api/src/recommend/recommend.controller.test.ts` 断言（那边直接插
 * `attempts` 再回放，不 mock 掌握度）。两层分开，才不会出现「两边都改了、测试
 * 都绿、但产品还是错的」。
 *
 * 下面的数字刻意选得难看（0.3167、0.0842），好让「四舍五入后看起来像别的值」
 * 这类错误暴露：0.3167 → 32%，如果实现写错成 0.31 → 31%，断言立刻红。
 */

function reason(kind: Reason['kind'], facts: Reason['facts']): Reason {
  return { kind, facts } as Reason;
}

describe('renderReason', () => {
  it('blocked_by_prereq 说得清「你在 A 卡住、A 依赖这里、你在这只有 32%」', () => {
    const segments = renderReason(
      reason('blocked_by_prereq', [
        { type: 'current', value: 0.3167 },
        { type: 'attempts', value: 5 },
        { type: 'unblocks', microKpId: 'kp-top', name: '噪声系数', current: 0.0842 },
      ]),
    );

    // 票面第 2 条的原话形状：具体到「哪个节点、什么数」。
    const text = segments.map((s) => s.text).join('');
    expect(text).toContain('噪声系数');
    expect(text).toContain('卡住');
    expect(text).toContain('32%'); // 0.3167 → 32%
    expect(text).toContain('8%'); // 0.0842 → 8%
    expect(text).not.toContain('根据你的学习情况');

    // 被卡住的节点必须是**可点链接片段**，不是混在文字里的字符串 —— 否则
    // 页面没法把它做成链接。
    const node = segments.find((segment) => segment.kind === 'node');
    expect(node).toMatchObject({ kind: 'node', microKpId: 'kp-top', text: '噪声系数' });

    // 数字也必须是独立片段，界面才能加粗。
    const numbers = segments.filter((segment) => segment.kind === 'number');
    expect(numbers.map((segment) => segment.text)).toContain('32%');
    expect(numbers.map((segment) => segment.text)).toContain('8%');
  });

  it('blocked_by_prereq 缺 unblocks 事实时降级，不抛错也不编节点名', () => {
    const text = reasonText(
      reason('blocked_by_prereq', [
        { type: 'current', value: 0.2 },
        { type: 'attempts', value: 2 },
      ]),
    );
    expect(text).toContain('前置');
    expect(text).toContain('20%');
    expect(text).not.toContain('undefined');
  });

  it('review_due 同时给出「上次达到」和「现在约」两个数', () => {
    const text = reasonText(
      reason('review_due', [
        { type: 'achieved', value: 0.91 },
        { type: 'current', value: 0.6123 },
        { type: 'attempts', value: 12 },
        { type: 'halfLifeDays', value: 30 },
      ]),
    );
    expect(text).toContain('91%');
    expect(text).toContain('61%');
    expect(text).toContain('30 天');
    // 不写「你忘了」：那是推断，不是事实
    expect(text).not.toContain('你忘了');
  });

  it('fading 的两个数字都在，否则「衰减」二字无处落脚', () => {
    const text = reasonText(
      reason('fading', [
        { type: 'achieved', value: 0.9234 },
        { type: 'current', value: 0.4102 },
        { type: 'halfLifeDays', value: 45 },
      ]),
    );
    expect(text).toContain('92%');
    expect(text).toContain('41%');
    expect(text).toContain('45 天');
  });

  it('needs_evidence 给出「已做几次 / 需要几次」，让差距可算', () => {
    const text = reasonText(
      reason('needs_evidence', [
        { type: 'attempts', value: 3 },
        { type: 'variants', value: 2 },
        { type: 'requiredAttempts', value: 8 },
        { type: 'requiredVariants', value: 3 },
      ]),
    );
    expect(text).toContain('3 题');
    expect(text).toContain('8 题');
    expect(text).toContain('2 个变式');
    expect(text).toContain('3 个');
  });

  it('low_mastery 的百分比与熟悉线都在', () => {
    const text = reasonText(
      reason('low_mastery', [
        { type: 'current', value: 0.1855 },
        { type: 'attempts', value: 7 },
        { type: 'familiarThreshold', value: 0.4 },
      ]),
    );
    expect(text).toContain('19%');
    expect(text).toContain('40%');
    expect(text).toContain('7 题');
  });

  it('next_in_line 没有前置时说「没有前置要求」，有前置时说清几个', () => {
    expect(reasonText(reason('next_in_line', [{ type: 'prereqsSatisfied', value: 0 }]))).toContain(
      '没有前置要求',
    );
    const withPrereqs = reasonText(reason('next_in_line', [{ type: 'prereqsSatisfied', value: 2 }]));
    expect(withPrereqs).toContain('2 个前置');
  });

  it('每种 kind 都产出非空文本（没有兜底空话，但也不能是空白）', () => {
    const kinds: Array<Reason['kind']> = [
      'review_due',
      'blocked_by_prereq',
      'fading',
      'needs_evidence',
      'low_mastery',
      'next_in_line',
    ];
    for (const kind of kinds) {
      // 最少事实：一个都不给，也不许崩
      const text = reasonText(reason(kind, []));
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('NaN');
    }
  });

  it('事实全缺时也不抛（后端改契约不该把页面打白）', () => {
    expect(() => renderReason(reason('review_due', []))).not.toThrow();
    expect(() => renderReason(reason('fading', []))).not.toThrow();
    expect(() => renderReason(reason('blocked_by_prereq', []))).not.toThrow();
  });
});

describe('reasonKindLabel', () => {
  it('六个种类各有自己的标题（不是同一个兜底词）', () => {
    const labels = [
      reasonKindLabel('review_due'),
      reasonKindLabel('blocked_by_prereq'),
      reasonKindLabel('fading'),
      reasonKindLabel('needs_evidence'),
      reasonKindLabel('low_mastery'),
      reasonKindLabel('next_in_line'),
    ];
    expect(new Set(labels).size).toBe(6);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
  });
});
