/**
 * 关卡市场领域的 query/mutation hook（票 14 / 16 的落点）。
 *
 * 归属泳道：authoring-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 *
 * ## 为什么写操作是手写的 `useMutation`
 *
 * `orval.config.mjs` 只开了 `useQuery`（全仓库 0 个 `useMutation`），于是
 * 生成的 `useCreateMarketDraft` / `useSaveMarketLevel` / `useStartGenerationRun`
 * 其实是 `useQuery` —— 它们会在组件挂载时立即发请求、并按参数做缓存。对
 * 「点一下才保存」「点一下才开跑」的写操作这是错的：挂载即保存，输入框每改
 * 一个字符就换一个 queryKey 再发一次。
 *
 * 所以这里只用生成的**普通异步函数**（`createMarketDraft` / `saveMarketLevel` /
 * `startGenerationRun`，它们内部走 `customFetch`，method 与 body 都已正确生成），
 * 外面套自己写的 `useMutation`。改 orval 配置开 `useMutation` 是更彻底的做法，
 * 但那会重写全仓库所有领域的生成物，不是我这一条泳道该单手做的决定。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createMarketDraft,
  getGetGenerationRunQueryKey,
  getGetMarketLevelQueryKey,
  getListGenerationRunsQueryKey,
  getListMarketLevelsQueryKey,
  saveMarketLevel,
  startGenerationRun,
  useGetGenerationRun,
  useGetMarketLevel,
  useListGenerationRuns,
  useListMarketLevels,
} from '../generated/default/default';
import type {
  GenerationRun,
  GenerationRunListResponse,
  GenerationRunRequest,
  MarketDraftRequest,
  MarketDraftResponse,
  MarketLevelDetailResponse,
  MarketLevelListResponse,
  MarketSaveLevelRequest,
  MarketSaveLevelResponse,
} from '../generated/model';
import { ApiClientError } from '../fetcher';

/** 市场列表：预制关卡与「我保存的」都在同一个响应里，分组在页面上做。 */
export function useMarketLevels() {
  const query = useListMarketLevels();
  return { ...query, payload: query.data?.data as MarketLevelListResponse | undefined };
}

/** 单张关卡 + 完整 spec。编辑器与「重新开始」都走这个。 */
export function useMarketLevel(levelId: string | undefined) {
  const query = useGetMarketLevel(levelId ?? '', { query: { enabled: Boolean(levelId) } });
  return { ...query, payload: query.data?.data as MarketLevelDetailResponse | undefined };
}

/**
 * 把一段学习过程打包成草稿。
 *
 * 草稿本身可能带 `issues`（校验器说还缺什么），那是**正常返回**不是错误：
 * 草稿本来就允许不完整。只有知识点/会话不存在（404）才是真的失败。
 */
export function useCreateMarketDraft() {
  return useMutation<MarketDraftResponse, ApiClientError, MarketDraftRequest>({
    mutationFn: async (request) => {
      const res = await createMarketDraft(request);
      // 生成函数的返回类型是 200 | 404 | 422 | 500 的联合；`customFetch` 对非 2xx
      // 已经 throw 了，能走到这里的一定是 200，但类型上没有收窄，故断言。
      return res.data as MarketDraftResponse;
    },
  });
}

/**
 * 保存自制关卡。
 *
 * 成功后让市场列表失效：保存的意义就是「它出现在市场页」，不刷新列表的话
 * 用户会以为没存上 —— 那恰好是这张票最不能出现的错觉。
 */
export function useSaveMarketLevel() {
  const queryClient = useQueryClient();
  return useMutation<MarketSaveLevelResponse, ApiClientError, MarketSaveLevelRequest>({
    mutationFn: async (request) => {
      const res = await saveMarketLevel(request);
      return res.data as MarketSaveLevelResponse;
    },
    onSuccess: (payload) => {
      void queryClient.invalidateQueries({ queryKey: getListMarketLevelsQueryKey() });
      // 用生成函数算 key，而不是手写模板串：key 的拼法由 Orval 决定，
      // 手抄一份就等于把「路径长什么样」这个知识复制到第二个地方。
      void queryClient.invalidateQueries({
        queryKey: getGetMarketLevelQueryKey(payload.level.levelId),
      });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 票 16：AI 批量生成
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一次批量生成的详情。
 *
 * `refetchInterval` 只在「还没跑完」时生效：跑完的运行不该继续轮询，否则
 * 停留在进度页上的用户会一直发请求。传入函数形式而不是固定值，就是为了
 * 让这个开关由数据自己决定。
 */
export function useGenerationRun(runId: string | undefined) {
  const query = useGetGenerationRun(runId ?? '', {
    query: {
      enabled: Boolean(runId),
      refetchInterval: (q) => {
        const data = q.state.data?.data as GenerationRun | undefined;
        if (!data) return 1000;
        const settled = data.tasks.every((t) => t.status === 'succeeded' || t.status === 'failed');
        return settled ? false : 1000;
      },
    },
  });
  return { ...query, payload: query.data?.data as GenerationRun | undefined };
}

/** 最近的运行列表。历史页用，不轮询（历史不需要实时）。 */
export function useGenerationRuns() {
  const query = useListGenerationRuns();
  return { ...query, payload: query.data?.data as GenerationRunListResponse | undefined };
}

/**
 * 发起一次批量生成。
 *
 * 成功后的失效策略：只让**这一次**的详情与运行列表失效，不去动市场列表 ——
 * 关卡要等这一批真跑完才出现，此刻让市场列表重取只会取到一半结果。
 * 市场列表的刷新放在进度页看到关卡落库之后（用户点「回到关卡市场」时
 * 那个页面自己会重新取一次）。
 */
export function useStartGeneration() {
  const queryClient = useQueryClient();
  return useMutation<GenerationRun, ApiClientError, GenerationRunRequest>({
    mutationFn: async (request) => {
      const res = await startGenerationRun(request);
      return res.data as GenerationRun;
    },
    onSuccess: (payload) => {
      void queryClient.invalidateQueries({ queryKey: getListGenerationRunsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetGenerationRunQueryKey(payload.runId) });
    },
  });
}
