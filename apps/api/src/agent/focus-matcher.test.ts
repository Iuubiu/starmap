import { describe, expect, it } from 'vitest';
import {
  FOCUS_MATCH_LIMITS,
  GENERIC_FOCUS_NAMES,
  matchFocus,
  normalizeFocusText,
  type FocusCandidate,
} from './focus-matcher.js';

/**
 * t56：未选知识点时，焦点必须跟着学习者说的话走。
 *
 * 这里测的是**匹配器本身**，不是接口。理由：t49 的回归测试在接口层，它只能证明
 * 「焦点不再是固定的那一个」；「说电离室就真的落到电离室」这种语义正确性必须
 * 在纯函数上逐条盯住，否则改一次排序规则就可能悄悄退化成「随便挑一个不同的」。
 *
 * 语料取自真实库（`app.knowledge_points`，4030 行）里真实存在的名字，包括那条
 * 会出问题的 `：工作原理` —— 用真名才测得出来通用词顶掉主题这个缺陷。
 */

const candidates: FocusCandidate[] = [
  { microKpId: 'kp-bool', name: '布尔代数基本运算', isLeaf: true, depth: 1 },
  { microKpId: 'kp-kmap', name: '卡诺图化简', isLeaf: true, depth: 1 },
  { microKpId: 'kp-yanshi-6e-2-6-2', name: '卡诺图化简法', isLeaf: true, depth: 3 },
  { microKpId: 'kp-kanghua-5e-2-2-4', name: '用卡诺图化简逻辑函数', isLeaf: true, depth: 4 },
  // 通用词节点：库里真有这个 id，整名就是「：工作原理」
  { microKpId: 'kp-jichangsong-1990-p204-：工作原理', name: '：工作原理', isLeaf: true, depth: 3 },
  { microKpId: 'kp-jichangsong-1990-p204-电离室', name: '电离室', isLeaf: true, depth: 3 },
  { microKpId: 'kp-chenboxian-2011-8-2', name: '电离室', isLeaf: true, depth: 2 },
  { microKpId: 'kp-dinghonglin-2010-3-2', name: '电离室', isLeaf: true, depth: 2 },
  { microKpId: 'kp-jichangsong-1990-4-2', name: '气体电离室', isLeaf: false, depth: 2 },
  { microKpId: 'kp-methods-1997-p237-一电离室', name: '一电离室', isLeaf: true, depth: 3 },
  { microKpId: 'kp-pulse-shaping', name: '脉冲成形', isLeaf: false, depth: 2 },
  { microKpId: 'kp-knoll-4e-2010-10-5', name: '密度修正与Fano因子', isLeaf: true, depth: 2 },
  // 习题/小结这类整名通用词：库里 85 个「习题」、20 个「小结」
  { microKpId: 'kp-knoll-4e-2010-1-习题', name: '习题', isLeaf: true, depth: 2 },
  { microKpId: 'kp-knoll-4e-2010-1-小结', name: '小结', isLeaf: true, depth: 2 },
  { microKpId: 'kp-knoll-4e-2010-1-参考文献', name: '参考文献', isLeaf: false, depth: 2 },
];

function focusOf(utterance: string): string | null {
  return matchFocus(utterance, candidates)?.microKpId ?? null;
}

describe('归一化', () => {
  it('去掉空白、中英文标点与破折号，并转小写', () => {
    expect(normalizeFocusText(' G-M 计数管 ')).toBe('g-m计数管'.replace('-', ''));
    expect(normalizeFocusText('：工作原理')).toBe('工作原理');
    expect(normalizeFocusText('卡诺图、化简。')).toBe('卡诺图化简');
    expect(normalizeFocusText('PN结（半导体）')).toBe('pn结半导体');
  });

  it('库里 U+2212 减号与 ASCII 连字符归一到同一个形式', () => {
    expect(normalizeFocusText('G−M计数管')).toBe(normalizeFocusText('G-M计数管'));
  });
});

describe('跟着说的话挑焦点', () => {
  it('「我想学布尔代数」落到布尔代数基本运算', () => {
    expect(focusOf('我想学布尔代数')).toBe('kp-bool');
  });

  it('「教我卡诺图化简」落到卡诺图化简（不是那个更长的「用卡诺图化简逻辑函数」）', () => {
    const match = matchFocus('教我卡诺图化简', candidates);
    expect(match?.microKpId).toBe('kp-kmap');
    // 这句话里整名都出现了，所以命中片段就是整个名字、覆盖率 1.0。
    // 关键点是它赢过「卡诺图化简法」（命中 5/6 = 0.83）与「用卡诺图化简逻辑函数」
    // （命中 5/10 = 0.5）—— 排序看命中长度与覆盖率，不是「名字越短越优先」。
    expect(match?.matchedText).toBe('卡诺图化简');
    expect(match?.coverage).toBeCloseTo(1, 5);
  });

  it('「我想了解电离室的工作原理」落到电离室，而不是那条叫「：工作原理」的节点', () => {
    const match = matchFocus('我想了解电离室的工作原理', candidates);
    expect(match?.microKpId).not.toBe('kp-jichangsong-1990-p204-：工作原理');
    expect(match?.name).toBe('电离室');
  });

  it('整名是通用词的候选一律不进结果（即使句子里原样出现）', () => {
    // 「习题」「小结」「参考文献」在库里成百上千个，它们不是任何一句话的主题。
    expect(focusOf('帮我看看这一章的习题')).toBeNull();
    expect(focusOf('我想复习一下小结')).toBeNull();
    expect(focusOf('参考文献在哪')).toBeNull();
    expect(GENERIC_FOCUS_NAMES.has(normalizeFocusText('习题'))).toBe(true);
    expect(GENERIC_FOCUS_NAMES.has(normalizeFocusText('：工作原理'))).toBe(true);
  });
});

describe('没有线索时返回 null（交给推荐回落）', () => {
  it.each([
    ['我不知道从哪开始'],
    ['随便'],
    [''],
    ['   '],
    ['你好'],
  ])('「%s」不算线索', (utterance) => {
    expect(focusOf(utterance)).toBeNull();
  });

  it('只说了一个通用词也不算线索', () => {
    expect(focusOf('工作原理是什么')).toBeNull();
  });
});

describe('确定性', () => {
  it('同样的输入连算两次结果完全一样', () => {
    const first = matchFocus('教我卡诺图化简', candidates);
    const second = matchFocus('教我卡诺图化简', candidates);
    expect(second).toEqual(first);
  });

  it('候选顺序被打乱也不改变结果（同名同分时用 microKpId 兜底）', () => {
    const shuffled = [...candidates].reverse();
    expect(matchFocus('我想了解电离室的工作原理', shuffled)?.microKpId).toBe(
      matchFocus('我想了解电离室的工作原理', candidates)?.microKpId,
    );
  });
});

describe('排序规则', () => {
  it('命中片段更长的赢：电离室（3 字）胜过只沾两字的候选', () => {
    const withDistractor: FocusCandidate[] = [
      ...candidates,
      // 只共享「电离」两字，覆盖率 2/6 < 0.5，本来也进不来
      { microKpId: 'kp-noise', name: '电离辐射防护', isLeaf: true, depth: 2 },
    ];
    expect(matchFocus('我想了解电离室的工作原理', withDistractor)?.name).toBe('电离室');
  });

  it('覆盖率不足一半的候选被丢弃（沾两个字的长名字不该淹没精确匹配）', () => {
    const only: FocusCandidate[] = [
      { microKpId: 'kp-long', name: '气体电离室的饱和特性与复合损失', isLeaf: true, depth: 4 },
    ];
    // 命中「电离室」3 字，但只占 16 字名字的 0.1875 → 不算
    expect(matchFocus('我想了解电离室的工作原理', only)).toBeNull();
  });

  it('叶节点优先：同名的章节节点让位给能打开关卡的叶节点', () => {
    const sameName: FocusCandidate[] = [
      { microKpId: 'kp-branch', name: '脉冲成形', isLeaf: false, depth: 2 },
      { microKpId: 'kp-leaf', name: '脉冲成形', isLeaf: true, depth: 3 },
    ];
    expect(matchFocus('教我脉冲成形', sameName)?.microKpId).toBe('kp-leaf');
  });

  it('两字名字整名出现才算命中（minCommonLength 对短名字退化为整名匹配）', () => {
    expect(FOCUS_MATCH_LIMITS.minCommonLength).toBe(3);
    const twoChar: FocusCandidate[] = [{ microKpId: 'kp-x', name: '计数', isLeaf: true, depth: 1 }];
    expect(matchFocus('教我计数', twoChar)?.microKpId).toBe('kp-x');
    // 只共享一个字不算
    expect(matchFocus('教我计一计', twoChar)).toBeNull();
  });
});
