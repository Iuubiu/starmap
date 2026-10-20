/**
 * 图谱领域的 query hook。
 *
 * 归属泳道：graph-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 */
import { useGetNode, useListNodes } from '../generated/default/default';
import type { ListNodesParams, NodeDetailResponse, NodeListResponse } from '../generated/model';

export function useNodeList(params?: ListNodesParams) {
  const query = useListNodes(params);
  return { ...query, payload: query.data?.data as NodeListResponse | undefined };
}

export function useNodeDetail(microKpId: string | undefined) {
  const query = useGetNode(microKpId ?? '', { query: { enabled: Boolean(microKpId) } });
  return { ...query, payload: query.data?.data as NodeDetailResponse | undefined };
}
