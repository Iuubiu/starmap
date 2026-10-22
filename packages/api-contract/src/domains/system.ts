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
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
