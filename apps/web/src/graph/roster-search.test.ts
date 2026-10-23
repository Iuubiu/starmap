/**
 * 清单筛选的纯逻辑（票 86）。
 *
 * 这些断言钉住三件事：中文子串能命中、拼音首字母能命中、**过滤不重排**。
 * 第三条最容易被「顺手排个序」破坏，而它一旦破坏，Tab 顺序就跟学习顺序对不上
 * 了（见 `roster-search.ts` 的说明），所以单独一条断言。
 */
import { describe, expect, it } from 'vitest';
import {
  filterRosterNodes,
  isRosterQueryEmpty,
  matchesRosterQuery,
  normalizeRosterQuery,
  rosterSearchStatus,
} from './roster-search.js';

const NODES = [
  { name: '卡诺图' },
  { name: '布尔代数基本运算' },
  { name: '半导体探测器' },
  { name: '电荷灵敏前置放大器' },
] as const;

describe('normalizeRosterQuery / isRosterQueryEmpty', () => {
  it('只 trim，不改变中间的空格（多词是且关系）', () => {
    expect(normalizeRosterQuery('  布尔 运算  ')).toBe('布尔 运算');
  });

  it('纯空白等于空查询', () => {
    expect(isRosterQueryEmpty('   ')).toBe(true);
    expect(isRosterQueryEmpty('a')).toBe(false);
  });
});

describe('matchesRosterQuery', () => {
  it('空查询恒命中（空态 = 显示全部）', () => {
    expect(matchesRosterQuery('卡诺图', '')).toBe(true);
  });

  it('中文子串命中', () => {
    expect(matchesRosterQuery('卡诺图', '卡诺')).toBe(true);
    expect(matchesRosterQuery('卡诺图', '诺图')).toBe(true);
  });

  it('拼音首字母命中', () => {
    expect(matchesRosterQuery('卡诺图', 'knt')).toBe(true);
    expect(matchesRosterQuery('布尔代数基本运算', 'bedjs')).toBe(true);
  });

  it('多个词是且关系', () => {
    expect(matchesRosterQuery('布尔代数基本运算', '布尔 运算')).toBe(true);
    expect(matchesRosterQuery('布尔代数基本运算', '布尔 卡诺')).toBe(false);
  });

  it('不相关的名字不命中', () => {
    expect(matchesRosterQuery('卡诺图', '探测器')).toBe(false);
    expect(matchesRosterQuery('卡诺图', 'zzz')).toBe(false);
  });
});

describe('filterRosterNodes', () => {
  it('空查询原样返回，不做拷贝', () => {
    expect(filterRosterNodes(NODES, '   ')).toBe(NODES);
  });

  it('过滤保持输入顺序（不按得分重排）', () => {
    expect(filterRosterNodes(NODES, '器').map((node) => node.name)).toEqual([
      '半导体探测器',
      '电荷灵敏前置放大器',
    ]);
  });

  it('不命中时返回空数组而不是抛错', () => {
    expect(filterRosterNodes(NODES, 'zzz')).toEqual([]);
  });
});

describe('rosterSearchStatus', () => {
  it('空查询报总数', () => {
    expect(rosterSearchStatus(167, 167, '')).toBe('共 167 个知识点');
  });

  it('筛选中报「命中 / 总数」', () => {
    expect(rosterSearchStatus(167, 3, 'knt')).toBe('筛选出 3 个，共 167 个知识点');
  });
});
