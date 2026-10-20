/**
 * 跨领域共用的契约碎片：错误码与统一错误体。
 *
 * 为什么单独一个文件：每个领域都会返回错误，错误体形状必须只有一份 ——
 * 前端按 `code` 分支（NOT_FOUND 显示空态、VALIDATION_FAILED 显示字段错误），
 * 前端不认识 `message` 之外的任何东西。
 *
 * 归属：integrator（共享面）。领域文件不要在这里加东西。
 */
import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL',
]);

export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
