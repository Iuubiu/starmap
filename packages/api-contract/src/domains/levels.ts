/**
 * 关卡领域契约：关卡摘要、关卡规范（level.spec.json）。
 *
 * 归属泳道：level-dev。领域文件由该泳道增改，`src/index.ts` 的 re-export 行
 * 已经预先写好，加 schema 不需要动共享文件。
 *
 * 关卡规范的真源在 `packages/shared/src/domain/level.ts`（校验器需要能在
 * 纯函数环境跑，契约包不是它的住所）。这里只放「对外形状」：列表/详情
 * 里出现的那一层摘要。
 */
import { z } from 'zod';
import { LevelSpecSchema } from '@starmap/shared';

export const LevelSummarySchema = z.object({
  levelId: z.string(),
  microKpId: z.string(),
  title: z.string(),
  itemCount: z.number().int().min(0),
  kind: z.enum(['teach', 'quiz', 'mixed']),
});

export type LevelSummary = z.infer<typeof LevelSummarySchema>;

/**
 * 关卡详情：摘要 + 完整 `level.spec`。
 *
 * `spec` 直接引用 `@starmap/shared` 的 `LevelSpecSchema`，**不在契约里另抄一份
 * 形状**。抄一份的后果是内容格式演进时两处各改各的，前端的播放器和后端的
 * 校验器会对同一份文件产生不同理解 —— 那正是票 04 要防的事。
 *
 * 代价是：改 spec 结构会连带改动 `openapi.yaml`（spec 的 JSON Schema 内联在
 * 这个组件里）。这是可接受的，因为 **API 确实把这个形状暴露给了前端**；
 * 隐藏它就等于让前端 `as any`。
 */
export const LevelDetailResponseSchema = z.object({
  level: LevelSummarySchema,
  spec: LevelSpecSchema,
});

export type LevelDetailResponse = z.infer<typeof LevelDetailResponseSchema>;
