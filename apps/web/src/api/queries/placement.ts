/**
 * 定级领域的 query/mutation hook（票 11 的落点）。
 *
 * 归属泳道：agent-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 *
 * ## 为什么写操作是手写的 `useMutation`
 *
 * 与 `queries/levels.ts`、`queries/market.ts` 同一个理由：`orval.config.mjs`
 * 只开了 `useQuery`，生成的 `useStartPlacement` / `useSubmitPlacementAnswer`
 * 其实都是 `useQuery`。挂在组件上就会立刻 POST —— 打开定级页等于开一次
 * 定级会话，而且每改一个参数就再开一次。这里只用生成的**普通异步函数**
 * （method 与 body 都已正确生成），外面套自己的 `useMutation`。
 *
 * ## 会话 id 为什么只存在内存里
 *
 * 服务端持有作答历史（`app.placement_sessions.state`），前端只需要一个 id。
 * 但定级是**一次性的**：刷新页面后从第 1 题重来是合理的（8–18 题，几十秒），
 * 而把 id 存进 localStorage 会让「同一台电脑上下一个人」接着上一个人的
 * 定级继续答。所以 id 不落盘，页面自己持有。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGetPlacementResultQueryKey,
  getGetPlacementSessionQueryKey,
  getGetPlacementStatusQueryKey,
  getPlacementResult,
  getPlacementSession,
  getSelfAssessmentForm,
  rejudgePlacement,
  startPlacement,
  submitPlacementAnswer,
  submitSelfAssessment,
  useGetPlacementResult,
  useGetPlacementSession,
  useGetPlacementStatus,
  useGetSelfAssessmentForm,
} from '../generated/default/default';
import type {
  PlacementAnswerRequest,
  PlacementAnswerResponse,
  PlacementRejudgeResponse,
  PlacementResultResponse,
  PlacementSessionResponse,
  PlacementStartRequest,
  PlacementStatusResponse,
  SelfAssessmentFormResponse,
  SelfAssessmentSubmitRequest,
  SelfAssessmentSubmitResponse,
} from '../generated/model';
import { ApiClientError } from '../fetcher';

export const placementKeys = {
  selfAssessment: () => ['placement', 'self-assessment'] as const,
  status: () => ['placement', 'status'] as const,
  session: (sessionId: string) => ['placement', 'session', sessionId] as const,
  result: (sessionId: string) => ['placement', 'result', sessionId] as const,
};

/** 4 道行为自评题。**不含权重**：先验怎么算只有一处实现。 */
export function useSelfAssessmentForm() {
  const query = useGetSelfAssessmentForm();
  return { ...query, payload: query.data?.data as SelfAssessmentFormResponse | undefined };
}

/**
 * 提交自评，拿起手先验。
 *
 * 只回平移量与三档先验概率，**不建会话**：会话要等第一题真正发出去。
 * 分成两步是为了让页面能在自评后说一句「我们据此把你的起点略微挪了一点」，
 * 那正是自评该有的分量 —— 它不直接定档。
 */
export function useSubmitSelfAssessment() {
  return useMutation<SelfAssessmentSubmitResponse, ApiClientError, SelfAssessmentSubmitRequest>({
    mutationFn: async (request) => {
      const res = await submitSelfAssessment(request);
      return res.data as SelfAssessmentSubmitResponse;
    },
  });
}

/** 开一次定级，拿到会话 id 与第一道题。 */
export function useStartPlacement() {
  return useMutation<PlacementSessionResponse, ApiClientError, PlacementStartRequest>({
    mutationFn: async (request) => {
      const res = await startPlacement(request);
      return res.data as PlacementSessionResponse;
    },
  });
}

/** 会话当前状态。刷新与「提交后拿下一题」都走它（提交回执里也带一份）。 */
export function usePlacementSession(sessionId: string | undefined) {
  const query = useGetPlacementSession(sessionId ?? '', {
    query: { enabled: Boolean(sessionId) },
  });
  return { ...query, payload: query.data?.data as PlacementSessionResponse | undefined };
}

/**
 * 提交一道作答。
 *
 * 回执自带正确答案与解析（票 11 验收 4）—— 学习者必须能当场判断系统有没有
 * 判错，而不是等全部答完才看到结论。成功时把会话缓存直接写成回执里的
 * `session`，避免多一次往返，也避免「下一题还没换、上一题已经判对」的那一帧。
 */
export function useSubmitPlacementAnswer() {
  const queryClient = useQueryClient();
  return useMutation<
    PlacementAnswerResponse,
    ApiClientError,
    { sessionId: string; request: PlacementAnswerRequest }
  >({
    mutationFn: async ({ sessionId, request }) => {
      const res = await submitPlacementAnswer(sessionId, request);
      return res.data as PlacementAnswerResponse;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(getGetPlacementSessionQueryKey(variables.sessionId), { data });
      // 会话结束后结果才可读；这一次失效让结果页一进去就有数据
      void queryClient.invalidateQueries({
        queryKey: getGetPlacementResultQueryKey(variables.sessionId),
      });
    },
  });
}

/** 定级结果。会话没结束时接口回 409，页面据此不展示档位。 */
export function usePlacementResult(sessionId: string | undefined, enabled: boolean) {
  const query = useGetPlacementResult(sessionId ?? '', {
    query: { enabled: Boolean(sessionId) && enabled, retry: false },
  });
  return { ...query, payload: query.data?.data as PlacementResultResponse | undefined };
}

/** 当前档位状态。没定过级时是 `status: 'none'`、`tier: null`，不是 404。 */
export function usePlacementStatus() {
  const query = useGetPlacementStatus();
  return { ...query, payload: query.data?.data as PlacementStatusResponse | undefined };
}

/** 用已有学习证据重判（不是重考）。成功后档位状态与会话结果都要重新取。 */
export function useRejudgePlacement() {
  const queryClient = useQueryClient();
  return useMutation<PlacementRejudgeResponse, ApiClientError, void>({
    mutationFn: async () => {
      const res = await rejudgePlacement();
      return res.data as PlacementRejudgeResponse;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetPlacementStatusQueryKey() });
      /**
       * 票 12：重判会**改变档位**，所以所有按档位算出来的东西都失效了。
       *
       * 用 `predicate` 而不是逐个列举 key：`/tier/levels/{levelId}/plan` 的 key
       * 带着任意一个 levelId，这里无法穷举。不失效的后果是「定级页说档位已经从
       * P2 升到 P3 了，关卡页还是按 P2 渲染」——两页各说一套，而学习者只能信一个。
       *
       * 只失效 `/api/v1/tier` 这一前缀，不动别的查询：重判不影响知识点、图谱、
       * 作答记录（那些是证据本身，没变）。
       */
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === '/api/v1/tier',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// 直接可用的普通异步函数（页面以外的调用方，例如看板上的「去定级」提示）
// ---------------------------------------------------------------------------

export {
  getPlacementResult,
  getPlacementSession,
  getSelfAssessmentForm,
  rejudgePlacement,
  startPlacement,
  submitPlacementAnswer,
  submitSelfAssessment,
};

export type {
  PlacementAnswerRequest,
  PlacementAnswerResponse,
  PlacementRejudgeResponse,
  PlacementResultResponse,
  PlacementSessionResponse,
  PlacementStartRequest,
  PlacementStatusResponse,
  SelfAssessmentFormResponse,
  SelfAssessmentSubmitRequest,
  SelfAssessmentSubmitResponse,
};
