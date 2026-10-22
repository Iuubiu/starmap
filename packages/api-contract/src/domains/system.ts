/**
 * 进程级契约：健康检查。
 *
 * 归属：integrator（共享面）。它不属于任何学习领域，只用来确认连的是真库。
 */
import { z } from 'zod';

/** GET /api/v1/health */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  /** 便于「骨架跑通」时用肉眼确认连的是真库 */
  dbNow: z.string(),
  version: z.string(),
  /**
   * 语义检索是否在线（t82）。
   *
   * **必填、不做 optional** —— 「可选」等于允许忘了报，而这个字段存在的全部
   * 意义就是降级必须可见。检索悄悄退回纯 BM25 时，界面上没有任何区别，
   * 只有这里能看出来。
   */
  semanticSearch: z.enum(['on', 'off']),
  /**
   * 不可用时的**具体原因**（人话，例如「向量库文件不存在：…（先跑 pnpm
   * index:embeddings 建索引）」）。可用时为 `null`。
   *
   * 契约层只能要求「是字符串」，要求不了「写得像人话」—— 那条由
   * `apps/api/src/retrieval/semantic-search.ts` 的 `status()` 负责，
   * 每个分支都写死了具体原因。
   */
  semanticSearchReason: z.string().nullable(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
