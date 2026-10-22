/**
 * 进程级读数：健康检查。
 *
 * 归属：integrator（共享面）。
 */
import { useGetHealth } from '../generated/default/default';
import type { HealthResponse } from '../generated/model';

export function useHealth() {
  const query = useGetHealth();
  return { ...query, payload: query.data?.data as HealthResponse | undefined };
}
