/**
 * 图谱领域的 query hook。
 *
 * 归属泳道：graph-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGetRecommendationsQueryKey,
  getGetGraphQueryKey,
  redirectRecommendation,
  useGetGraph,
  useGetNode,
  useGetRecommendations,
  useListNodes,
} from '../generated/default/default';
import type {
  GraphResponse,
  ListNodesParams,
  NodeDetailResponse,
  NodeListResponse,
  RecommendationListResponse,
  RedirectRequest,
  RedirectResponse,
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

/**
 * 今日推荐与今日学习摘要。
 *
 * 缓存策略与 `useGraph()` 一致（60 秒）：看板与图谱是同一批推荐的两个视图，
 * 一个刷新另一个不刷新会让用户在两页之间看到不同的推荐。真正的失效由
 * 作答结算与改道成功触发（`invalidateQueries`），而不是靠时间猜。
 *
 * **不在这里拼中文**：`reason` 是结构化事实（`{kind, facts}`），中文由
 * `apps/web/src/board/reason.ts` 渲染 —— 那样数字能被加粗、先修节点能做成
 * 链接，且改措辞不用动后端。
 */
export function useRecommendations() {
  const query = useGetRecommendations({ query: { staleTime: 60_000 } });
  return { ...query, payload: query.data?.data as RecommendationListResponse | undefined };
}

/**
 * 改道：拒绝当前推荐并选别的节点。
 *
 * ## 为什么不直接用生成的 `useRedirectRecommendation`
 *
 * `orval.config.mjs` 只开了 `useQuery`，所以生成器对 POST 也产出 useQuery hook
 * —— 组件一挂载就 POST 一次，于是「打开看板」等于「默默拒绝了一条推荐」。
 * 这与 `queries/levels.ts` / `queries/agent.ts` 处理的问题同一个，解法也是同一个：
 * 只拿生成的普通异步函数（method 与 body 都已正确），外面套 `useMutation`。
 *
 * ## 为什么成功后要失效两个 key
 *
 * 改道改变的是「推荐」，而图谱响应里也带 `recommendedIds`（票 13 验收第 5 条
 * 要求两处一致）。只失效推荐、不失效图谱，切到地图页会看到旧的那批被标为
 * 「推荐」，而看板已经换了——那正是「两处矛盾」。
 */
export function useRedirectRecommendation() {
  const queryClient = useQueryClient();
  return useMutation<RedirectResponse, Error, RedirectRequest>({
    mutationFn: async (request) => {
      const response = await redirectRecommendation(request);
      return response.data as RedirectResponse;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetRecommendationsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetGraphQueryKey() }),
      ]);
    },
  });
}
