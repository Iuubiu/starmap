/**
 * 关卡领域的 query hook（票 04 / 05 / 06 / 07 / 11 的落点）。
 *
 * 归属泳道：level-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 *
 * ## 为什么作答是手写的 `useMutation`
 *
 * 与 `queries/market.ts` 同一个理由：`orval.config.mjs` 只开了 `useQuery`，
 * 生成的 `useSubmitAttempt` 其实是 `useQuery` —— 组件一挂载就会 POST 一次，
 * 于是「打开关卡页」等于「提交一次空作答」。这里只用生成的普通异步函数
 * `submitAttempt`（method 与 body 都已正确生成），外面套自己的 `useMutation`。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGetMasteryQueryKey,
  submitAttempt,
  useGetLevel,
  useGetMastery,
} from '../generated/default/default';
import type {
  AttemptRecord,
  AttemptSubmitRequest,
  AttemptSubmitResponse,
  LevelDetailResponse,
  LevelSpec,
  MasteryView,
} from '../generated/model';
import { ApiClientError } from '../fetcher';

/**
 * 取一张关卡的完整规范。
 *
 * 播放器整个生命周期只发这一个请求：卡片、七段步骤、每道题的选项/答案/
 * 预写反馈全在里面。作答不走后端 —— 反馈是作者写死在 spec 里的，
 * 不是模型现场生成的，所以「提交后立即显示」在实现上是零延迟而不是「很快」。
 *
 * `levelId` 为 `undefined` 时（路由还没取到参数）不发请求，避免打
 * `/api/v1/levels/undefined`。
 */
export function useLevel(levelId: string | undefined) {
  const query = useGetLevel(levelId ?? '', {
    query: { enabled: Boolean(levelId) },
  });
  return {
    ...query,
    payload: query.data?.data as LevelDetailResponse | undefined,
  };
}

/**
 * 一个知识点的双字段掌握度。
 *
 * 两个百分比在证据不足时都是 `null`（不是 0）—— 「不知道」和「零分」是两件事，
 * 渲染时必须显示「证据不足」。这一点在接口层就做死了：服务端根本不发数字。
 */
export function useMastery(microKpId: string | undefined) {
  const query = useGetMastery(microKpId ?? '', {
    query: { enabled: Boolean(microKpId) },
  });
  return {
    ...query,
    payload: query.data?.data as MasteryView | undefined,
  };
}

/**
 * 提交一次作答。
 *
 * 成功后会重算掌握度，所以顺带把那个知识点的掌握度缓存作废 —— 否则关卡页
 * 显示的是新的百分比，切回知识点页还是旧的。`microKpId` 从响应里取而不是
 * 从参数取：客户端本来就不知道这道题属于哪个知识点（那是服务端顺着
 * `level_items → levels` 查的），让调用方传等于多一处可漂移的副本。
 */
export function useSubmitAttempt() {
  const queryClient = useQueryClient();
  return useMutation<AttemptSubmitResponse, ApiClientError, AttemptSubmitRequest>({
    mutationFn: async (request) => {
      const res = await submitAttempt(request);
      // `customFetch` 的返回值是 `{ data, status, headers }`，不是裸 body —— 这里要
      // 取 `.data`。只写 `res as ...` 会把整个信封当成响应体，运行时 `data.mastery`
      // 就是 undefined（TypeScript 因为走了 `as unknown` 不会报错）。
      // 生成函数的返回类型是 200 | 400 | 404 | 422 | 500 的联合；`customFetch` 对
      // 非 2xx 已经 throw 了，能走到这里的一定是 200，但类型上没有收窄，故断言。
      return res.data as AttemptSubmitResponse;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: getGetMasteryQueryKey(data.mastery.microKpId),
      });
    },
  });
}

/** 契约生成的类型别名，供播放器组件使用，免得各处再记生成物路径。 */
export type { AttemptRecord, AttemptSubmitRequest, AttemptSubmitResponse, LevelSpec, MasteryView };
