/**
 * 图谱领域的 query hook。
 *
 * 归属泳道：graph-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 */
import { useGetGraph, useGetNode, useListNodes } from '../generated/default/default';
import type {
  GraphResponse,
  ListNodesParams,
  NodeDetailResponse,
  NodeListResponse,
} from '../generated/model';

export function useNodeList(params?: ListNodesParams) {
  const query = useListNodes(params);
  return { ...query, payload: query.data?.data as NodeListResponse | undefined };
}

export function useNodeDetail(microKpId: string | undefined) {
  const query = useGetNode(microKpId ?? '', { query: { enabled: Boolean(microKpId) } });
  return { ...query, payload: query.data?.data as NodeDetailResponse | undefined };
}

/**
 * 整张知识图谱：全部微知识点 + 先修边 + 掌握状态。
 *
 * **一次取全量**而不是按视野分页：力导向布局需要看到自己的邻居才知道往哪推；
 * 分页进来的半个图会让每次翻页都重排一遍。返回体积也不大（167 个叶节点 +
 * 52 条边约 20KB，即使涨到 2000 节点也在百 KB 量级），一次性取回比反复请求
 * 更省。
 *
 * 缓存策略刻意比全局默认（30 秒）长：图谱是别的页面的导航底座，短时间内
 * 反复进出地图页不该反复拉全量。真正变化时由用户操作（答题结算）触发
 * invalidate，而不是靠时间猜。
 */
export function useGraph() {
  const query = useGetGraph({ query: { staleTime: 60_000 } });
  return { ...query, payload: query.data?.data as GraphResponse | undefined };
}
