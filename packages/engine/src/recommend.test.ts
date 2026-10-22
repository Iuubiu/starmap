import { describe, expect, it } from 'vitest';
import {
  FADING_DROP,
  RECOMMEND_DEFAULT_LIMIT,
  STUCK_MIN_ATTEMPTS,
  recommend,
  type RecommendCandidate,
  type RecommendEdge,
} from './recommend.js';
import {
  FAMILIAR_THRESHOLD,
  MASTERY_MIN_ATTEMPTS,
  MASTERY_MIN_VARIANTS,
  PROFICIENT_THRESHOLD,
} from './mastery.js';

const NOW = '2026-10-20T12:00:00.000Z';

/** 造一个候选。默认是「从未作答」——所有用例在此基础上改。 */
function node(id: string, overrides: Partial<RecommendCandidate> = {}): RecommendCandidate {
  return {
    microKpId: id,
    name: `知识点 ${id}`,
    achieved: null,
    current: null,
    attemptCount: 0,
    variantCount: 0,
    evidenceSufficient: false,
    halfLifeDays: 30,
    lastEvidenceAt: null,
    reviewDueAt: null,
    ...overrides,
  };
}

/** 一个「已经学会但开始衰减」的节点：achieved 高、current 低 */
function fadingNode(id: string, achieved: number, current: number): RecommendCandidate {
  return node(id, {
    achieved,
    current,
    attemptCount: 10,
    variantCount: 4,
    evidenceSufficient: true,
    lastEvidenceAt: '2026-09-01T00:00:00.000Z',
  });
}

/** 一个「做过题但掌握度还低」的节点（证据已充足） */
function weakNode(id: string, current: number, attemptCount = 12): RecommendCandidate {
  return node(id, {
    achieved: current,
    current,
    attemptCount,
    variantCount: 4,
    evidenceSufficient: true,
    lastEvidenceAt: '2026-10-01T00:00:00.000Z',
  });
}

const kinds = (list: ReturnType<typeof recommend>) => list.map((r) => r.reason.kind);
const ids = (list: ReturnType<typeof recommend>) => list.map((r) => r.microKpId);

describe('recommend：空输入与边界', () => {
  it('没有候选时返回空数组，不抛错', () => {
    expect(recommend({ candidates: [], edges: [], now: NOW })).toEqual([]);
  });

  it('limit 为 0 时返回空数组', () => {
    const result = recommend({ candidates: [node('a')], edges: [], now: NOW, limit: 0 });
    expect(result).toEqual([]);
  });

  it('limit 为负时返回空数组，而不是「返回全部」', () => {
    // slice(0, -1) 会砍掉最后一条而不是返回空——这是个真实的坑
    const result = recommend({ candidates: [node('a'), node('b')], edges: [], now: NOW, limit: -1 });
    expect(result).toEqual([]);
  });

  it('默认最多三条', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e'].map((id) => node(id));
    const result = recommend({ candidates, edges: [], now: NOW });
    expect(result.length).toBe(RECOMMEND_DEFAULT_LIMIT);
  });

  it('已熟练的节点不会被推荐', () => {
    const strong = weakNode('strong', PROFICIENT_THRESHOLD + 0.1);
    expect(recommend({ candidates: [strong], edges: [], now: NOW })).toEqual([]);
  });

  it('已掌握的节点（current 高、achieved 也是高）不会被推荐', () => {
    const mastered = fadingNode('m', 0.97, 0.96);
    expect(recommend({ candidates: [mastered], edges: [], now: NOW })).toEqual([]);
  });
});

describe('recommend：四种理由各自能被触发', () => {
  it('到期复验优先级最高，压过更「欠学」的节点', () => {
    const due = node('due', {
      achieved: 0.96,
      current: 0.9,
      attemptCount: 12,
      variantCount: 4,
      evidenceSufficient: true,
      reviewDueAt: '2026-10-19T00:00:00.000Z', // 昨天到期
      lastEvidenceAt: '2026-10-01T00:00:00.000Z',
    });
    const veryWeak = weakNode('veryWeak', 0.05);
    const result = recommend({ candidates: [veryWeak, due], edges: [], now: NOW });
    expect(result[0]?.microKpId).toBe('due');
    expect(result[0]?.reason.kind).toBe('review_due');
  });

  it('未到期（复验时刻在未来）不触发 review_due', () => {
    const notDue = node('nd', {
      achieved: 0.96,
      current: 0.9,
      attemptCount: 12,
      variantCount: 4,
      evidenceSufficient: true,
      reviewDueAt: '2026-11-01T00:00:00.000Z', // 未来
    });
    const result = recommend({ candidates: [notDue], edges: [], now: NOW });
    expect(kinds(result)).not.toContain('review_due');
  });

  it('reviewDueAt 为坏字符串时既不触发也不抛错', () => {
    const broken = node('broken', {
      achieved: 0.9,
      current: 0.85,
      attemptCount: 10,
      variantCount: 4,
      evidenceSufficient: true,
      reviewDueAt: '这不是时间',
    });
    expect(() => recommend({ candidates: [broken], edges: [], now: NOW })).not.toThrow();
    expect(kinds(recommend({ candidates: [broken], edges: [], now: NOW }))).not.toContain(
      'review_due',
    );
  });

  it('卡住的节点会把弱前置顶上来，理由带出被解开的节点', () => {
    // b 依赖 a；b 做了很多题还是 0.2（卡住），a 从未作答 → 该推 a
    const a = node('a');
    const b = weakNode('b', 0.2, 15);
    const edges: RecommendEdge[] = [{ from: 'a', to: 'b' }];
    const result = recommend({ candidates: [a, b], edges, now: NOW, limit: 5 });

    const forA = result.find((r) => r.microKpId === 'a');
    expect(forA?.reason.kind).toBe('blocked_by_prereq');
    const unblocks = forA?.reason.facts.find((f) => f.type === 'unblocks');
    expect(unblocks).toBeDefined();
    if (unblocks?.type === 'unblocks') {
      expect(unblocks.microKpId).toBe('b');
      // 这条事实里的数字必须等于 b 的真实 current，不是编的
      expect(unblocks.current).toBe(0.2);
    }
  });

  it('前置已满足时不构成阻塞', () => {
    const a = weakNode('a', 0.8); // 已过熟练线
    const b = weakNode('b', 0.2, 15);
    const result = recommend({ candidates: [a, b], edges: [{ from: 'a', to: 'b' }], now: NOW });
    expect(kinds(result)).not.toContain('blocked_by_prereq');
  });

  it('作答次数没到门槛就谈不上「卡住」', () => {
    const a = node('a');
    const b = weakNode('b', 0.2, STUCK_MIN_ATTEMPTS - 1);
    const result = recommend({
      candidates: [a, b],
      edges: [{ from: 'a', to: 'b' }],
      now: NOW,
      limit: 5,
    });
    expect(kinds(result)).not.toContain('blocked_by_prereq');
  });

  it('衰减触发 fading，且 facts 里同时有 current 与 achieved', () => {
    const faded = fadingNode('f', 0.9, 0.9 - FADING_DROP - 0.01);
    const result = recommend({ candidates: [faded], edges: [], now: NOW });
    expect(result[0]?.reason.kind).toBe('fading');
    const types = result[0]?.reason.facts.map((f) => f.type) ?? [];
    expect(types).toContain('current');
    expect(types).toContain('achieved');
    expect(types).toContain('halfLifeDays');
  });

  it('衰减幅度不足 FADING_DROP 时不误报「该复习」', () => {
    // 只掉了一点，不该进复习列表——否则列表永远清不空
    const slightly = fadingNode('s', 0.9, 0.9 - FADING_DROP / 2);
    const result = recommend({ candidates: [slightly], edges: [], now: NOW });
    expect(kinds(result)).not.toContain('fading');
  });

  it('证据不足触发 needs_evidence，且 facts 带出两个门槛', () => {
    const few = node('few', {
      attemptCount: 3,
      variantCount: 1,
      evidenceSufficient: false,
      lastEvidenceAt: '2026-10-10T00:00:00.000Z',
    });
    const result = recommend({ candidates: [few], edges: [], now: NOW });
    expect(result[0]?.reason.kind).toBe('needs_evidence');
    const facts = result[0]?.reason.facts ?? [];
    expect(facts.find((f) => f.type === 'requiredAttempts')).toEqual({
      type: 'requiredAttempts',
      value: MASTERY_MIN_ATTEMPTS,
    });
    expect(facts.find((f) => f.type === 'requiredVariants')).toEqual({
      type: 'requiredVariants',
      value: MASTERY_MIN_VARIANTS,
    });
  });

  it('做过题但掌握度低（证据已够）触发 low_mastery，不是 needs_evidence', () => {
    // 这正是 `attempted` 两个分支必须分开的地方：证据够但 current<0.4
    const struggling = weakNode('st', 0.3, 20);
    const result = recommend({ candidates: [struggling], edges: [], now: NOW });
    expect(result[0]?.reason.kind).toBe('low_mastery');
  });

  it('从未作答但前置已满足 → next_in_line', () => {
    const done = weakNode('done', 0.8);
    const fresh = node('fresh');
    const result = recommend({
      candidates: [done, fresh],
      edges: [{ from: 'done', to: 'fresh' }],
      now: NOW,
    });
    expect(result.some((r) => r.reason.kind === 'next_in_line')).toBe(true);
  });

  it('从未作答且前置没满足 → 不推荐（先学前置）', () => {
    const weakPrereq = weakNode('weak', 0.2);
    const fresh = node('fresh');
    const result = recommend({
      candidates: [weakPrereq, fresh],
      edges: [{ from: 'weak', to: 'fresh' }],
      now: NOW,
      limit: 1,
    });
    // 只推了 1 条，且不是 fresh
    expect(ids(result)).not.toContain('fresh');
  });

  it('边指向不在候选集里的节点时静默忽略，不抛错', () => {
    const a = node('a');
    expect(() =>
      recommend({ candidates: [a], edges: [{ from: 'ghost', to: 'a' }], now: NOW }),
    ).not.toThrow();
  });
});

describe('recommend：改道（用户拒绝）', () => {
  it('被拒绝的节点不再推荐', () => {
    const rejected = weakNode('r', 0.1);
    const other = weakNode('o', 0.2);
    const redirects = new Map([['r', '2026-10-15T00:00:00.000Z']]);
    // r 的最后证据早于拒绝时刻 → 状态没变 → 继续排除
    const result = recommend({ candidates: [rejected, other], edges: [], now: NOW, redirects });
    expect(ids(result)).not.toContain('r');
    expect(ids(result)).toContain('o');
  });

  it('拒绝后有了新证据就解禁——用户拒绝的是当时那个推荐，不是这个知识点', () => {
    const rejected = weakNode('r', 0.1);
    // 最后证据晚于拒绝时刻 → 状态已变 → 可以重新推荐
    const changed: RecommendCandidate = {
      ...rejected,
      lastEvidenceAt: '2026-10-18T00:00:00.000Z',
    };
    const redirects = new Map([['r', '2026-10-15T00:00:00.000Z']]);
    const result = recommend({ candidates: [changed], edges: [], now: NOW, redirects });
    expect(ids(result)).toContain('r');
  });

  it('拒绝后一直没有新证据（lastEvidenceAt 为 null）时保持排除', () => {
    const never = node('n', { attemptCount: 2, evidenceSufficient: false });
    const redirects = new Map([['n', '2026-10-15T00:00:00.000Z']]);
    const result = recommend({ candidates: [never], edges: [], now: NOW, redirects });
    expect(ids(result)).not.toContain('n');
  });

  it('拒绝记录里的时刻是坏字符串时不生效（宁可多推一次也不永久噤声）', () => {
    const n = weakNode('n', 0.1);
    const redirects = new Map([['n', '坏时间']]);
    const result = recommend({ candidates: [n], edges: [], now: NOW, redirects });
    expect(ids(result)).toContain('n');
  });

  it('被拒绝的节点即使卡住别人，也不该被顶上来', () => {
    const a = node('a');
    const b = weakNode('b', 0.2, 15);
    const redirects = new Map([['a', '2026-10-15T00:00:00.000Z']]);
    const result = recommend({
      candidates: [a, b],
      edges: [{ from: 'a', to: 'b' }],
      now: NOW,
      redirects,
      limit: 5,
    });
    // a 被排除后，b 自己仍然是 low_mastery，但不能推 a
    expect(ids(result)).not.toContain('a');
  });
});

describe('recommend：确定性与排序', () => {
  it('同一输入两次调用结果逐字相同', () => {
    const candidates = [weakNode('a', 0.2), weakNode('b', 0.2), weakNode('c', 0.3)];
    const first = recommend({ candidates, edges: [], now: NOW });
    const second = recommend({ candidates, edges: [], now: NOW });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('打乱候选顺序不改变输出（排序键是全序，最后一级是 id）', () => {
    const candidates = [weakNode('a', 0.2), weakNode('b', 0.2), weakNode('c', 0.2)];
    const forward = recommend({ candidates, edges: [], now: NOW, limit: 5 });
    const reversed = recommend({ candidates: [...candidates].reverse(), edges: [], now: NOW, limit: 5 });
    expect(ids(forward)).toEqual(ids(reversed));
  });

  it('同层级里缺口大的排前面', () => {
    const shallowGap = weakNode('shallow', 0.35);
    const deepGap = weakNode('deep', 0.1);
    const result = recommend({ candidates: [shallowGap, deepGap], edges: [], now: NOW });
    expect(result[0]?.microKpId).toBe('deep');
  });

  it('层级压过缺口：一个刚过期的复验排在深度欠学之前', () => {
    const due = node('due', {
      achieved: 0.98,
      current: 0.97,
      attemptCount: 12,
      variantCount: 5,
      evidenceSufficient: true,
      reviewDueAt: '2026-10-20T00:00:00.000Z', // 今天刚到期
    });
    const weak = weakNode('weak', 0.01);
    const result = recommend({ candidates: [weak, due], edges: [], now: NOW });
    expect(result[0]?.microKpId).toBe('due');
  });

  it('新知识点按主线顺序排（moduleOrdinal → depth → ordinal）', () => {
    const done = weakNode('done', 0.8);
    const later = node('later', { moduleOrdinal: 2, depth: 1, ordinal: 1 });
    const earlier = node('earlier', { moduleOrdinal: 1, depth: 1, ordinal: 2 });
    const result = recommend({
      candidates: [done, later, earlier],
      edges: [
        { from: 'done', to: 'later' },
        { from: 'done', to: 'earlier' },
      ],
      now: NOW,
      limit: 5,
    });
    const freshOnly = result.filter((r) => r.reason.kind === 'next_in_line');
    expect(freshOnly.map((r) => r.microKpId)).toEqual(['earlier', 'later']);
  });
});

describe('recommend：理由里的数字必须等于输入', () => {
  /**
   * 这一组是票 13 第 4 条在引擎层的一半。
   *
   * 另一半（数字是否等于**库里**的值）在 `apps/api` 的集成测试里——那里
   * 真的插 attempts、真的回放。这里只保证「引擎没有在传递途中篡改数字」。
   */
  it('low_mastery 的 current 事实逐字等于输入', () => {
    const n = weakNode('x', 0.31234567);
    const result = recommend({ candidates: [n], edges: [], now: NOW });
    const fact = result[0]?.reason.facts.find((f) => f.type === 'current');
    expect(fact?.type === 'current' ? fact.value : null).toBe(0.31234567);
  });

  it('needs_evidence 的 attempts / variants 等于输入', () => {
    const n = node('x', {
      attemptCount: 5,
      variantCount: 2,
      evidenceSufficient: false,
      lastEvidenceAt: '2026-10-10T00:00:00.000Z',
    });
    const result = recommend({ candidates: [n], edges: [], now: NOW });
    const facts = result[0]?.reason.facts ?? [];
    expect(facts.find((f) => f.type === 'attempts')).toEqual({ type: 'attempts', value: 5 });
    expect(facts.find((f) => f.type === 'variants')).toEqual({ type: 'variants', value: 2 });
  });

  it('fading 的 halfLifeDays 用节点自己的半衰期，不是常量 30', () => {
    const faded = fadingNode('f', 0.9, 0.5);
    const withFact = { ...faded, halfLifeDays: 14 }; // 事实类
    const result = recommend({ candidates: [withFact], edges: [], now: NOW });
    const fact = result[0]?.reason.facts.find((f) => f.type === 'halfLifeDays');
    expect(fact?.type === 'halfLifeDays' ? fact.value : null).toBe(14);
  });

  it('low_mastery 的熟悉线事实等于导出的常量', () => {
    const result = recommend({ candidates: [weakNode('x', 0.3)], edges: [], now: NOW });
    const fact = result[0]?.reason.facts.find((f) => f.type === 'familiarThreshold');
    expect(fact?.type === 'familiarThreshold' ? fact.value : null).toBe(FAMILIAR_THRESHOLD);
  });
});
