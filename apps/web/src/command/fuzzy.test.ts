import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyRank, pinyinInitials } from './fuzzy.js';

/**
 * 模糊匹配的规则测试。
 *
 * 这些断言钉的是**产品决策**（前缀优先、短名称优先、中文不分词），不是
 * 实现细节：换一套打分公式时它们应该仍然成立。
 */
describe('fuzzyMatch', () => {
  it('中文不分词：同一个名字能被「布尔」和「代数」分别命中', () => {
    const target = { text: '布尔代数基本运算' };

    const first = fuzzyMatch(target, '布尔');
    const second = fuzzyMatch(target, '代数');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // 加亮区间要落在真实位置上，否则界面上高亮会错位
    expect(second?.ranges[0]).toEqual([2, 4]);
  });

  it('前缀命中优先于中段命中，即使中段那条更短', () => {
    const ranked = fuzzyRank(
      [{ name: '逻辑代数' }, { name: '代数基本运算' }],
      '代数',
      (item) => ({ text: item.name }),
    );

    // 「逻辑代数」是中段命中（400 档），「代数基本运算」是前缀命中（800 档）
    expect(ranked.map((entry) => entry.item.name)).toEqual(['代数基本运算', '逻辑代数']);
  });

  it('同分时短名称排前', () => {
    const ranked = fuzzyRank(
      [{ name: '卡诺图化简的三种情形' }, { name: '卡诺图' }],
      '卡诺图',
      (item) => ({ text: item.name }),
    );

    expect(ranked[0]?.item.name).toBe('卡诺图');
  });

  it('大小写无关', () => {
    expect(fuzzyMatch({ text: 'CMOS 反相器' }, 'cmos')).not.toBeNull();
    expect(fuzzyMatch({ text: 'cmos 反相器' }, 'CMOS')).not.toBeNull();
  });

  it('空格分隔的多个词是「且」关系，可以分别命中名字与副标注', () => {
    const target = { text: '卡诺图化简', hint: '数字逻辑' };

    expect(fuzzyMatch(target, '卡诺 逻辑')).not.toBeNull();
    expect(fuzzyMatch(target, '卡诺 模拟')).toBeNull();
  });

  it('子序列命中：拼音输入法用户敲的首字 + 尾字', () => {
    const match = fuzzyMatch({ text: '卡诺图化简' }, '卡化');

    expect(match).not.toBeNull();
    // 区间是半开区间 [start, end)：'卡诺图化简' 里「卡」= 0，「化」= 3
    expect(match?.ranges).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  it('拼音首字母也能命中：布尔→「be」，卡诺图化简→「knt」', () => {
    expect(pinyinInitials('布尔代数基本运算')).toBe('BEDSJBYS');
    expect(pinyinInitials('卡诺图化简')).toBe('KNTHJ');
    /* 标点、数字、拉丁字母不参与首字母串。 */
    expect(pinyinInitials('一、火花放电室')).toBe('YHHFDS');

    const viaInitials = fuzzyMatch({ text: '布尔代数基本运算' }, 'be');
    expect(viaInitials).not.toBeNull();
    /* 首字母命中不产出加亮区间：中文原文里没有对应字符可标。 */
    expect(viaInitials?.ranges).toEqual([]);
    expect(fuzzyMatch({ text: '卡诺图化简' }, 'knt')).not.toBeNull();
    expect(fuzzyMatch({ text: '卡诺图化简' }, 'be')).toBeNull();
  });

  it('空查询返回 null（空态由调用方决定，不是「全都匹配」）', () => {
    expect(fuzzyMatch({ text: '布尔代数' }, '   ')).toBeNull();
  });

  it('完全不相干时不命中', () => {
    expect(fuzzyMatch({ text: '布尔代数' }, '量子')).toBeNull();
  });

  it('3086 条全量匹配 + 排序在 100ms 内完成（票面验收第 2 条）', () => {
    const nodes = Array.from({ length: 3086 }, (_, index) => ({
      name: `第${index}条知识点：布尔代数与卡诺图化简`,
      moduleName: '数字逻辑',
    }));

    const started = performance.now();
    const ranked = fuzzyRank(nodes, '卡诺', (node) => ({
      text: node.name,
      hint: node.moduleName,
    }));
    const elapsed = performance.now() - started;

    expect(ranked).toHaveLength(3086);
    expect(elapsed).toBeLessThan(100);
  });
});
