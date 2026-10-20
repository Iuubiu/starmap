/**
 * 票 16 的批量生成 Workflow。
 *
 * ## 为什么这里才该用 Workflow（ADR-0007 的判据）
 *
 * 「是否需要跨进程、跨重启、或无人值守继续跑」——批量生成三个都占：一次
 * 跑几十个知识点、每个要等模型几秒到几十秒、中途进程重启不该丢掉已完成的
 * 部分。单次生成直接调 `LlmPort` 就够了，多走一层 Workflow 只是加噪声。
 *
 * ## 为什么 `.foreach` 里的 step **绝不抛异常**
 *
 * 实测结论（`@mastra/core@1.78.0`，见 `generation.workflow.test.ts` 的
 * 「单个条目失败不拖垮整批」）：
 *
 *   一个 `foreach` 条目 execute 抛错 → 整个 workflow 的 `status` 变成
 *   `'failed'`，其余并行条目即使已经成功也一并作废，`run.start()` 不会
 *   返回已完成条目的结果。
 *
 * 票 16 要求「失败走 fallback 而不是让整批失败」。`@mastra/core` 的
 * `errorStrategy` 只存在于 agent 的结构化输出上（`'strict'|'warn'|'fallback'`），
 * Workflow 层**没有**这个声明式开关。所以 fallback 必须写在 step 内部：
 * 捕获一切、把失败变成一条**结构化结果**、照常 `return`。
 *
 * 这不是绕过要求，而是它在 Workflow 层的正确实现形态 —— 失败的数据和
 * 成功的数据一样是数据，只有这样才能计进「12 条里 5 条失败」并逐条给原因。
 *
 * ## 状态写在 DB 而不是 Mastra 的 snapshot 里
 *
 * Mastra 会把运行快照存进 `mastra` schema。但「进度」要能被一个普通的
 * `GET /market/generations/:runId` 读到，而这个端点不该依赖 Mastra 的内部
 * 表结构（升级会变）。所以每条任务的进度落在我们自己的
 * `level_generation_task` 上，Mastra 的快照只作为崩溃恢复的额外一层。
 */
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import type { DatabaseService } from '../db/database.service.js';
import type { LlmPort } from '../llm/llm.port.js';
import { assembleLevelSpec, parseQuestionOutput, type GenerationFailureKind } from './level-assembly.js';
import { buildQuestionMessages, type QuestionMaterial } from './question-prompt.js';
import { safeJsonParse } from '../llm/openai-compatible-llm.js';

/**
 * Workflow 的输入：一次运行要处理哪些知识点。
 *
 * 不传 `LlmPort` / `DatabaseService` 进来 —— step 的 input 必须是可序列化
 * 的（Mastra 会存快照）。依赖通过工厂函数闭包捕获，见 `createGenerationWorkflow()`。
 */
export const GenerationInputSchema = z.object({
  runId: z.string().min(1),
  /**
   * 要生成的知识点。**顺序即执行顺序**，且会被去重 —— 同一批里重复的
   * 知识点只跑一次，这是「幂等」在输入层的执行点。
   */
  microKpIds: z.array(z.string().min(1)).min(1),
});

export type GenerationInput = z.infer<typeof GenerationInputSchema>;

/**
 * 一个知识点的执行结果。
 *
 * `ok: false` 是**正常返回值**，不是异常。这个类型存在本身就是 fallback
 * 的实现：成功与失败走同一条返回通道。
 */
export const GenerationItemResultSchema = z.object({
  microKpId: z.string(),
  ok: z.boolean(),
  levelId: z.string().nullable(),
  failureKind: z
    .enum([
      'llm_error',
      'not_json',
      'schema_invalid',
      'missing_field',
      'language_not_compliant',
      'ungrounded_source',
      'practice_violation',
      'db_error',
    ])
    .nullable(),
  failureMessage: z.string().nullable(),
  /** 字段级明细（`{path,message,code}[]`），序列化成 unknown 以进快照 */
  failureDetail: z.unknown().nullable(),
  itemCount: z.number().int().min(0),
  durationMs: z.number().int().min(0),
});

export type GenerationItemResult = z.infer<typeof GenerationItemResultSchema>;

/** 步骤间传递的形状：把单个知识点摊成 list */
export const GenerationFanoutSchema = z.array(z.object({ microKpId: z.string().min(1) }));

export const GenerationOutputSchema = z.array(GenerationItemResultSchema);

export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;

/** 工厂依赖：两个端口 + 两个参数化的回调，全部由调用方注入 */
export interface GenerationWorkflowDeps {
  llm: LlmPort;
  /**
   * 取一个知识点的生成材料（知识点名 + 相关教材片段）。
   *
   * 为什么是回调而不是让 step 直接查库：step 需要保持「一次调用 = 一次
   * 可重试的单元」，把 SQL 塞进去会让测试要么连库要么 mock 整个 pg。
   * 回调让 workflow 在测试里可以配一个纯内存实现。
   */
  loadMaterial: (microKpId: string) => Promise<QuestionMaterial | null>;
  /**
   * 落库。**幂等责任在这里**（确定性 levelId + upsert），不在 workflow。
   *
   * 返回 `{levelId}` 表示成功；抛错表示 db_error。
   */
  persist: (spec: unknown, microKpId: string) => Promise<{ levelId: string }>;
  /**
   * 进度回调。每条任务开始/结束时调用，用于把状态写进
   * `level_generation_task`。用回调而不是让 workflow 直接写库，理由同上。
   */
  onTaskStatus?: (update: {
    microKpId: string;
    status: 'running' | 'succeeded' | 'failed';
    levelId?: string | null;
    failureKind?: GenerationFailureKind | null;
    failureMessage?: string | null;
    failureDetail?: unknown;
    itemCount?: number;
    durationMs?: number;
  }) => Promise<void>;
  /** 单个条目的超时（毫秒）。超时算 `llm_error`，不拖垮整批。 */
  perItemTimeoutMs?: number;
}

/**
 * 确定性关卡 id：同一知识点 + 同一作者 → 永远同一个 id。
 *
 * 这是「重复执行不产生重复关卡」的实现基础。用 `ai` 前缀而不是随机后缀，
 * 让「哪些关卡是 AI 生成」在 id 上就能看出来（`app.levels` 没有 author 列，
 * 但 spec.meta.author 有）。
 *
 * 不用内容哈希：内容会随模型输出变化，那样每次重跑都会生成新 id，正好
 * 造成票 16 要防的「重复执行产生重复关卡」。
 */
export function generatedLevelId(microKpId: string): string {
  return `lv-ai-${microKpId}`;
}

/**
 * 带超时的模型调用。
 *
 * 用 `AbortSignal` 而不是 `Promise.race`，让底层 fetch 真的被取消 ——
 * 否则超时之后请求还在跑，会继续占着上游的并发配额。
 */
async function completeWithTimeout(
  llm: LlmPort,
  material: QuestionMaterial,
  timeoutMs: number,
): Promise<{ raw: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await llm.complete({
      messages: buildQuestionMessages(material),
      schema: { type: 'object' },
      temperature: 0.4,
      signal: controller.signal,
    });
    // `parsed` 为 null 说明模型没给出可解析的 JSON（夹了中文解释，或压根不是
    // JSON）。这里不直接判失败——先看 text 里有没有嵌着 JSON，再决定。
    return { raw: result.parsed ?? safeJsonParse(result.text) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 建 Workflow。
 *
 * 形状：`then(fanout)` → `foreach(generate, {concurrency})`。
 * `.foreach` 要求前一步返回数组，所以 `fanout` 把 `{runId, microKpIds}` 摊成
 * `[{microKpId}, ...]`；`runId` 通过闭包捕获（它在这个 workflow 实例里是常量）。
 */
export function createGenerationWorkflow(
  deps: GenerationWorkflowDeps,
  options: { concurrency: number; runId: string },
) {
  const timeoutMs = deps.perItemTimeoutMs ?? 60_000;

  const fanout = createStep({
    id: 'fanout',
    inputSchema: GenerationInputSchema,
    outputSchema: GenerationFanoutSchema,
    execute: async ({ inputData }) => {
      // 去重但保持传入顺序：调用方给了重复 id 时只跑一次，
      // 且结果顺序可预测（便于测试与复现）。
      const seen = new Set<string>();
      const out: Array<{ microKpId: string }> = [];
      for (const id of inputData.microKpIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ microKpId: id });
      }
      return out;
    },
  });

  const generate = createStep({
    id: 'generate',
    inputSchema: z.object({ microKpId: z.string().min(1) }),
    outputSchema: GenerationItemResultSchema,
    execute: async ({ inputData }) => {
      const startedAt = Date.now();
      const microKpId = inputData.microKpId;

      const fail = (
        kind: GenerationFailureKind,
        message: string,
        detail?: unknown,
      ): GenerationItemResult => ({
        microKpId,
        ok: false,
        levelId: null,
        failureKind: kind,
        failureMessage: message,
        failureDetail: detail ?? null,
        itemCount: 0,
        durationMs: Date.now() - startedAt,
      });

      try {
        await deps.onTaskStatus?.({ microKpId, status: 'running' });

        // ── 1. 取材料 ───────────────────────────────────────────────────
        const material = await deps.loadMaterial(microKpId);
        if (!material) {
          const result = fail('ungrounded_source', `知识点 ${microKpId} 没有可用的教材片段`);
          await deps.onTaskStatus?.({
            microKpId,
            status: 'failed',
            failureKind: result.failureKind,
            failureMessage: result.failureMessage,
          });
          return result;
        }

        // ── 2. 调模型（超时算 llm_error）───────────────────────────────
        let raw: unknown;
        try {
          ({ raw } = await completeWithTimeout(deps.llm, material, timeoutMs));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const kind: GenerationFailureKind = /abort|timeout/i.test(message)
            ? 'llm_error'
            : 'llm_error';
          const result = fail(kind, `模型调用失败：${message}`);
          await deps.onTaskStatus?.({
            microKpId,
            status: 'failed',
            failureKind: result.failureKind,
            failureMessage: result.failureMessage,
          });
          return result;
        }

        // ── 3. 解析不出 JSON ────────────────────────────────────────────
        if (raw === null || raw === undefined) {
          const result = fail('not_json', '模型输出不是可解析的 JSON（可能夹了中文解释）');
          await deps.onTaskStatus?.({
            microKpId,
            status: 'failed',
            failureKind: result.failureKind,
            failureMessage: result.failureMessage,
          });
          return result;
        }

        // ── 4. 校验 + 语言 + 出处 ──────────────────────────────────────
        const allowed = new Set(material.excerpts.map((e) => e.chunkId));
        const parsed = parseQuestionOutput(raw, allowed);
        if (!parsed.ok) {
          const result = fail(parsed.kind, parsed.message, parsed.detail);
          await deps.onTaskStatus?.({
            microKpId,
            status: 'failed',
            failureKind: result.failureKind,
            failureMessage: result.failureMessage,
            failureDetail: result.failureDetail,
          });
          return result;
        }

        // ── 5. 组装成关卡（这里强制 practice + author='ai'）────────────
        const levelId = generatedLevelId(microKpId);
        const assembled = assembleLevelSpec({
          microKpId,
          microKpName: material.microKpName,
          questions: [parsed.question],
          levelId,
        });
        if (!assembled.ok) {
          const result = fail(assembled.kind, assembled.message, assembled.detail);
          await deps.onTaskStatus?.({
            microKpId,
            status: 'failed',
            failureKind: result.failureKind,
            failureMessage: result.failureMessage,
            failureDetail: result.failureDetail,
          });
          return result;
        }

        // ── 6. 落库（幂等 upsert，db_error 不拖垮整批）──────────────────
        try {
          const saved = await deps.persist(assembled.spec, microKpId);
          const result: GenerationItemResult = {
            microKpId,
            ok: true,
            levelId: saved.levelId,
            failureKind: null,
            failureMessage: null,
            failureDetail: null,
            itemCount: assembled.spec.items.length,
            durationMs: Date.now() - startedAt,
          };
          await deps.onTaskStatus?.({
            microKpId,
            status: 'succeeded',
            levelId: saved.levelId,
            itemCount: result.itemCount,
            durationMs: result.durationMs,
          });
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const result = fail('db_error', `落库失败：${message}`);
          await deps.onTaskStatus?.({
            microKpId,
            status: 'failed',
            failureKind: result.failureKind,
            failureMessage: result.failureMessage,
          });
          return result;
        }
      } catch (err) {
        // 兜底：上面每一段都自己接了错误，能走到这里说明有意料之外的抛错
        // （比如 onTaskStatus 自己失败）。仍然返回结构化结果而不是抛出去 ——
        // 抛出去会让整批失败，那正是这张票要防的。
        const message = err instanceof Error ? err.message : String(err);
        const result = fail('db_error', `未预期的错误：${message}`);
        // 这里刻意不再调 onTaskStatus：如果它是失败源，再调一次只会再抛一次。
        return result;
      }
    },
  });

  return createWorkflow({
    id: `level-generation-${options.runId}`,
    inputSchema: GenerationInputSchema,
    outputSchema: GenerationOutputSchema,
  })
    .then(fanout)
    .foreach(generate, { concurrency: options.concurrency })
    .commit();
}

/**
 * 把 workflow 的输出折算成运行级状态。
 *
 * `partial` 是单独的状态（见契约里 `GenerationRunStatus` 的注释）：全成功是
 * `succeeded`，全失败是 `failed`，中间是 `partial`。一条都没跑（空输入）
 * 也归 `failed` —— 空跑不是成功。
 */
export function summarizeRun(results: readonly GenerationItemResult[]): {
  status: 'succeeded' | 'partial' | 'failed';
  succeededCount: number;
  failedCount: number;
} {
  const succeededCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - succeededCount;
  if (results.length === 0) return { status: 'failed', succeededCount, failedCount };
  if (failedCount === 0) return { status: 'succeeded', succeededCount, failedCount };
  if (succeededCount === 0) return { status: 'failed', succeededCount, failedCount };
  return { status: 'partial', succeededCount, failedCount };
}
