import { useGetHealth, useGetNode, useListNodes } from './generated/default/default';
import type {
  HealthResponse,
  ListNodesParams,
  NodeDetailResponse,
  NodeListResponse,
} from './generated/model';

/**
 * 生成客户端的薄包装，只做一件事：把 `data` 收窄成成功响应体。
 *
 * 为什么需要这层：Orval 会把 `data` 类型化成「成功体 | 各错误体」的联合，
 * 因为 OpenAPI 里列出了 400/404/500。但我们的 `customFetch` 在 `!res.ok`
 * 时**直接 throw**，所以运行时 `data` 永远是成功体 —— 联合类型的错误分支
 * 是可达性为零的死路。每张页面各自写 `as` 是重复的噪音，收在一处更好。
 *
 * 顺带统一了 `payload` 命名，页面不需要记住 `data.data` 这种嵌套。
 */
export function useNodeList(params?: ListNodesParams) {
  const query = useListNodes(params);
  return { ...query, payload: query.data?.data as NodeListResponse | undefined };
}

export function useNodeDetail(microKpId: string | undefined) {
  const query = useGetNode(microKpId ?? '', { query: { enabled: Boolean(microKpId) } });
  return { ...query, payload: query.data?.data as NodeDetailResponse | undefined };
}

export function useHealth() {
  const query = useGetHealth();
  return { ...query, payload: query.data?.data as HealthResponse | undefined };
}
