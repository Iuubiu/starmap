/**
 * 检索门控。纯函数。ADR-0001：约束做成架构事实，不写成请求。
 *
 * 关键：`isAnswerChunk` 是 (chunk, 微知识点) 的关系，不是 chunk 的固有属性。
 * 同一个 chunk 对知识点 A 是答案块、对知识点 B 只是背景 —— 所以调用方传入的是
 * 针对「当前这一个知识点」已解析好的集合。
 *
 * 为什么不能靠提示词让模型「别给答案」：arXiv:2608.12292 实测表明，能把答案
 * 憋住的模型在压力下会失守，且能力越强泄露率上升；唯一稳健的做法是在检索层
 * 物理排除，让模型根本看不到。
 */

export type GateTier = 'background' | 'scaffold' | 'full';

export interface GateableChunk {
  id: string;
  kind: 'text' | 'formula' | 'figure' | 'table';
  text: string;
}

export interface GateDecision<T extends GateableChunk> {
  allowed: T[];
  excluded: Array<{ id: string; reason: string; tier: GateTier }>;
}

/** 阈值来自 spec 表 3：<0.4 背景 / 0.4–0.7 脚手架 / >0.7 全量 */
export const GATE_THRESHOLDS = { scaffold: 0.4, full: 0.7 } as const;

/**
 * `current` 为 null 表示证据不足 —— 按最保守档处理。
 * 不能因为「没有数据」就当成全量，那等于对新手直接给答案。
 */
export function gateTierFor(current: number | null): GateTier {
  if (current === null) return 'background';
  if (current < GATE_THRESHOLDS.scaffold) return 'background';
  if (current < GATE_THRESHOLDS.full) return 'scaffold';
  return 'full';
}

/**
 * 只有 full 档放行答案块。background 与 scaffold 都排除，区别在于
 * 上层如何使用剩余块：background 只喂背景，scaffold 额外喂结构与定义。
 */
export function filterChunks<T extends GateableChunk>(
  chunks: readonly T[],
  answerChunkIds: ReadonlySet<string>,
  tier: GateTier,
): GateDecision<T> {
  if (tier === 'full') {
    return { allowed: [...chunks], excluded: [] };
  }

  const allowed: T[] = [];
  const excluded: GateDecision<T>['excluded'] = [];

  for (const chunk of chunks) {
    if (answerChunkIds.has(chunk.id)) {
      excluded.push({
        id: chunk.id,
        tier,
        reason:
          tier === 'background'
            ? '该片段包含本知识点的答案内容，当前掌握度不足以查看答案'
            : '该片段包含最终答案，脚手架档只提供结构与定义',
      });
    } else {
      allowed.push(chunk);
    }
  }

  return { allowed, excluded };
}
