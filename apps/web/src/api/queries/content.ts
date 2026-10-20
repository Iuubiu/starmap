/**
 * 内容库领域的 query hook。
 *
 * 归属泳道：content-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 */
import { useGetContentStats, useGetNodeSources } from '../generated/default/default';
import type { ContentStatsResponse, NodeSourcesResponse } from '../generated/model';

export function useContentStats() {
  const query = useGetContentStats();
  return { ...query, payload: query.data?.data as ContentStatsResponse | undefined };
}

export function useNodeSources(microKpId: string | undefined) {
  const query = useGetNodeSources(microKpId ?? '', { query: { enabled: Boolean(microKpId) } });
  return { ...query, payload: query.data?.data as NodeSourcesResponse | undefined };
}
