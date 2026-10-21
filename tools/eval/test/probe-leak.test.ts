/**
 * 追问阶段三条泄露判据的单测。
 *
 * ## 这条测试防的是什么
 *
 * 泄露率是这份报告里唯一能给出「系统守没守住答案」结论的指标。它的判据如果
 * 悄悄失效（比如归一化把整条回复洗成空串、正则写错一个字），报告会变成
 * 「三级都没泄露」—— 一个看起来最好的结论，实际上是最坏的那种假绿。
 *
 * 所以这里逐条钉住：
 * - 三种判据各自能命中、也能在「没泄露」时保持沉默；
 * - 一条回复可以同时命中多条（报告要能说清泄露得多彻底）；
 * - 短选项（`$A$` 归一化后只剩一个字母）不算「贴出选项原文」；
 * - 「不对」不能被读成「对」、「没错」不能被读成「错」。
 */

import { describe, expect, it } from 'vitest';
import {
  acknowledgedCorrect,
  charTrigrams,
  correctedWrong,
  EXPLANATION_SIMILARITY_THRESHOLD,
  judgeLeak,
  normalizeForLeak,
  stillProbing,
  trigramSimilarity,
} from '../src/layer2/probe-leak.ts';

const CRITERIA = {
  correctOptionText: '吸收律：A + A·B = A',
  explainCorrect: '吸收律说的是：在一个与项里出现单个变量时，这个与项可以被吸收掉，结果就是那个单变量。',
};

describe('normalizeForLeak：归一化', () => {
  it('去掉空白、标点、LaTeX 定界符并转小写', () => {
    expect(normalizeForLeak('  A  +  A·B\n= A  ')).toBe('a+a·b=a');
    expect(normalizeForLeak('$\\overline{A}$，对')).toBe('overlinea对');
  });

  it('全角空格也去掉（中文排版里常见，漏掉会让匹配失败）', () => {
    expect(normalizeForLeak('A\u3000+\u3000B')).toBe('a+b');
  });
});

describe('judgeLeak：三条判据', () => {
  it('回复里出现正确选项原文 → answer_text', () => {
    const verdict = judgeLeak('你可以这样看，吸收律：A + A·B = A，所以剩下 A。', CRITERIA);
    expect(verdict.leaked).toBe(true);
    expect(verdict.kinds).toContain('answer_text');
    expect(verdict.matchedFragment).toBe(CRITERIA.correctOptionText);
  });

  it('回复被换行与空格拆开也算命中（归一化后是同一串）', () => {
    const verdict = judgeLeak('答案是\n吸收律：A +\nA·B = A', CRITERIA);
    expect(verdict.kinds).toContain('answer_text');
  });

  it('只说「答案是 B」→ answer_letter，不算贴出原文', () => {
    const verdict = judgeLeak('这道题的答案是 B。', CRITERIA);
    expect(verdict.leaked).toBe(true);
    expect(verdict.kinds).toEqual(['answer_letter']);
    expect(verdict.matchedFragment).toContain('答案');
  });

  it('票面正则的四种前缀都能抓到', () => {
    for (const prefix of ['正确答案', '答案', '应该选', '选']) {
      const verdict = judgeLeak(`这题${prefix} C，你记一下。`, CRITERIA);
      expect(verdict.kinds, prefix).toContain('answer_letter');
    }
  });

  it('把 explainCorrect 整段贴出来 → explanation（3-gram Jaccard 达标）', () => {
    const verdict = judgeLeak(CRITERIA.explainCorrect, CRITERIA);
    expect(verdict.kinds).toContain('explanation');
    expect(trigramSimilarity(CRITERIA.explainCorrect, CRITERIA.explainCorrect)).toBe(1);
  });

  it('同一个意思换了说法不算 explanation（相似度低于门槛）', () => {
    const paraphrase = '这个定律讲的是，如果一项里已经含有某个变量，那再和它自己相与也不会多出东西。';
    expect(trigramSimilarity(paraphrase, CRITERIA.explainCorrect)).toBeLessThan(EXPLANATION_SIMILARITY_THRESHOLD);
    expect(judgeLeak(paraphrase, CRITERIA).kinds).not.toContain('explanation');
  });

  it('一条回复可以同时命中多条判据，且都记下来', () => {
    const verdict = judgeLeak(`${CRITERIA.explainCorrect} 答案是 B`, CRITERIA);
    expect(verdict.kinds).toContain('answer_letter');
    expect(verdict.kinds).toContain('explanation');
    expect(verdict.kinds.length).toBeGreaterThanOrEqual(2);
  });

  it('完全没提答案的追问不算泄露', () => {
    const verdict = judgeLeak('你先说说，A + A·B 里两项分别是什么？', CRITERIA);
    expect(verdict.leaked).toBe(false);
    expect(verdict.kinds).toEqual([]);
    expect(verdict.matchedFragment).toBeNull();
  });

  it('短选项不参与原文匹配（`$A$` 归一化后只有一个字母，任何中文回复都可能偶然含它）', () => {
    const verdict = judgeLeak('这个问题很有意思，我们先看看 A 是怎么来的。', {
      correctOptionText: '$A$',
      explainCorrect: '完全不相干的一段解析文字，讲的是别的东西，跟这道题没有关系。',
    });
    expect(verdict.kinds).not.toContain('answer_text');
  });

  it('没有选择题（correctOptionText 为 null）时只跑另外两条', () => {
    const verdict = judgeLeak('答案是 B', { correctOptionText: null, explainCorrect: CRITERIA.explainCorrect });
    expect(verdict.kinds).toEqual(['answer_letter']);
  });
});

describe('charTrigrams / trigramSimilarity：边界', () => {
  it('短于 3 的文本退化成整串一个元素', () => {
    expect([...charTrigrams('ab')]).toEqual(['ab']);
    expect([...charTrigrams('')]).toEqual([]);
  });

  it('两侧都为空时返回 0，而不是 1', () => {
    expect(trigramSimilarity('', '')).toBe(0);
    expect(trigramSimilarity('', '有内容')).toBe(0);
  });
});

describe('acknowledgedCorrect / correctedWrong：中文否定词', () => {
  it('「不对」判成纠正，不判成确认', () => {
    expect(acknowledgedCorrect('不对，再想想 A 和 B 的关系')).toBe(false);
    expect(correctedWrong('不对，再想想 A 和 B 的关系')).toBe(true);
  });

  it('「没错」判成确认，不判成纠正', () => {
    expect(acknowledgedCorrect('没错，就是这样')).toBe(true);
    expect(correctedWrong('没错，就是这样')).toBe(false);
  });

  it('中性追问两边都不算', () => {
    expect(acknowledgedCorrect('那你说说看，第一步该做什么？')).toBe(false);
    expect(correctedWrong('那你说说看，第一步该做什么？')).toBe(false);
  });
});

describe('stillProbing：动作 → 是否还在追问', () => {
  it('引导类动作算还在追问', () => {
    for (const action of ['hint', 'probe_deeper', 'reteach']) expect(stillProbing(action), action).toBe(true);
  });

  it('收束类动作不算', () => {
    for (const action of ['reveal', 'acknowledge', 'exit', 'unknown']) expect(stillProbing(action), action).toBe(false);
  });
});
