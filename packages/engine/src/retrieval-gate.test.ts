import { describe, expect, it } from 'vitest';
import { filterChunks, gateTierFor } from './retrieval-gate.js';

const C = (id: string, kind: 'text' | 'formula' | 'figure') => ({ id, kind, text: `内容 ${id}` });

describe('gateTierFor', () => {
  it('按 current 掌握度分三档', () => {
    expect(gateTierFor(0)).toBe('background');
    expect(gateTierFor(0.39)).toBe('background');
    expect(gateTierFor(0.4)).toBe('scaffold');
    expect(gateTierFor(0.69)).toBe('scaffold');
    expect(gateTierFor(0.7)).toBe('full');
    expect(gateTierFor(1)).toBe('full');
  });

  it('证据不足时按 background 处理，不因为「没数据」就给全量答案', () => {
    expect(gateTierFor(null)).toBe('background');
  });
});

describe('filterChunks', () => {
  const chunks = [C('a', 'text'), C('b', 'text'), C('c', 'formula')];
  // 只有 chunk a 对该知识点是答案块
  const answerChunks = new Set(['a']);

  it('background 档完全排除答案块', () => {
    const r = filterChunks(chunks, answerChunks, 'background');
    expect(r.allowed.map((c) => c.id)).toEqual(['b', 'c']);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]?.reason).toContain('答案');
  });

  it('scaffold 档仍排除答案块，但保留公式与结构', () => {
    const r = filterChunks(chunks, answerChunks, 'scaffold');
    expect(r.allowed.map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('full 档放行全部，包括答案块', () => {
    const r = filterChunks(chunks, answerChunks, 'full');
    expect(r.allowed.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(r.excluded).toHaveLength(0);
  });

  it('被排除的块必须带理由，否则检索调试器无法解释', () => {
    const r = filterChunks(chunks, answerChunks, 'background');
    for (const e of r.excluded) {
      expect(e.reason.length).toBeGreaterThan(0);
      expect(e.tier).toBe('background');
    }
  });

  it('同一个 chunk 在不同知识点下可以得出相反结论', () => {
    // 这是 ADR-0001 的核心：答案块是 (chunk, 微知识点) 的关系，不是 chunk 的固有属性
    const shared = [C('shared', 'text')];
    const isAnswerForKp1 = new Set(['shared']);
    const isAnswerForKp2 = new Set<string>();
    expect(filterChunks(shared, isAnswerForKp1, 'background').allowed).toHaveLength(0);
    expect(filterChunks(shared, isAnswerForKp2, 'background').allowed).toHaveLength(1);
  });
});
