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
  completeReviewRound,
  evaluateGate,
  exportLevel,
  getCompleteReviewRoundQueryKey,
  getGetGateHistoryQueryKey,
  getGetMasteryQueryKey,
  getGetNodeUnlockQueryKey,
  getGetReviewQueueQueryKey,
  getGetReviewRoundQueryKey,
  getListMarketLevelsQueryKey,
  importLevel,
  previewLevelTemplate,
  startReviewRound,
  submitAttempt,
  useGetGateHistory,
  useGetLevel,
  useGetMastery,
  useGetNodeUnlock,
  useGetReviewQueue,
  useGetReviewRound,
  useListLevelTemplates,
} from '../generated/default/default';
import type {
  AttemptRecord,
  AttemptSubmitRequest,
  AttemptSubmitResponse,
  GateEvaluation,
  GateHistoryResponse,
  GateResponse,
  LevelDetailResponse,
  LevelExportFile,
  LevelImportResponse,
  LevelSpec,
  LevelTemplateListResponse,
  LevelTemplatePreviewRequest,
  LevelTemplatePreviewResponse,
  MasteryView,
  ReviewCompleteResponse,
  ReviewQueueResponse,
  ReviewRoundDetailResponse,
  ReviewRoundStartResponse,
  UnlockState,
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
export type {
  AttemptRecord,
  AttemptSubmitRequest,
  AttemptSubmitResponse,
  GateEvaluation,
  GateHistoryResponse,
  GateResponse,
  LevelSpec,
  MasteryView,
  ReviewCompleteResponse,
  ReviewQueueResponse,
  ReviewRoundDetailResponse,
  ReviewRoundStartResponse,
  UnlockState,
};

// ---------------------------------------------------------------------------
// 票 06：出口门控与解锁
// ---------------------------------------------------------------------------

/**
 * 一个知识点的解锁状态。
 *
 * `unlocked=false` 时 `blockers` 会说清楚被哪几道门挡着、各差多少 —— 前端
 * 不只需要一个布尔，还需要一句「先学完《XX》并通过它的出口测试（还差 2 题）」。
 *
 * 默认可关闭轮询：解锁状态只会在「通过门控」这个明确动作后变，而那个动作
 * 就是本文件的 `useEvaluateGate()` 的 mutation，成功后我们主动作废缓存。
 */
export function useNodeUnlock(microKpId: string | undefined) {
  const query = useGetNodeUnlock(microKpId ?? '', {
    query: { enabled: Boolean(microKpId) },
  });
  return {
    ...query,
    payload: query.data?.data as UnlockState | undefined,
  };
}

/** 一张关卡的门控判定历史（新的在前）。历史是回看用的，不是准实时数据。 */
export function useGateHistory(levelId: string | undefined) {
  const query = useGetGateHistory(levelId ?? '', {
    query: { enabled: Boolean(levelId) },
  });
  return {
    ...query,
    payload: query.data?.data as GateHistoryResponse | undefined,
  };
}

/**
 * 评一次出口门控。
 *
 * 与 `useSubmitAttempt` 同一个理由手写 `useMutation`：orval 只开了 `useQuery`，
 * 生成的 `useEvaluateGate` 是 query —— 组件一挂载就会 POST 一次判定。而判定
 * 有副作用（写学习日志、通过时写解锁行），挂载即触发会让「打开小结页」变成
 * 一次考试。
 *
 * 成功后作废三个缓存：解锁状态（刚解锁的节点要亮起来）、门控历史（多了一条）、
 * 掌握度（判定的同时可能刚提交过作答）。失败时**不自动重试**：判定有副作用，
 * 重试会多写一条日志；409（未解锁）是业务状态而不是网络抖动，重试也不会变。
 */
export function useEvaluateGate() {
  const queryClient = useQueryClient();
  return useMutation<GateResponse, ApiClientError, string>({
    mutationFn: async (levelId) => {
      const res = await evaluateGate(levelId);
      return res.data as GateResponse;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: getGetGateHistoryQueryKey(data.evaluation.levelId),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetNodeUnlockQueryKey(data.evaluation.microKpId),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetMasteryQueryKey(data.evaluation.microKpId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// 票 07：掌握度复验与间隔排期
// ---------------------------------------------------------------------------

/**
 * 此刻到期的复验队列。
 *
 * `due` 为空数组是**正常状态**：没到期的日子本来就不该有复验。它不是一个
 * 「加载失败」也不是「没有数据」，所以前端不要在这上面画空状态，画一句
 * 「今天没有要复验的内容」就够。
 *
 * 队列项里的 `nextDueAt` 与图谱节点的 `reviewDueAt` 是**同一列**
 * （`mastery.next_review_at`）。票 07 验收第 5 条要求两边不能互相打脸，
 * 而两边读同一列、用同一条 `<= now` 比较，靠的是这一点而不是两次计算。
 */
export function useReviewQueue() {
  const query = useGetReviewQueue();
  return {
    ...query,
    payload: query.data?.data as ReviewQueueResponse | undefined,
  };
}

/**
 * 读一次已开始的复验会话（刷新页面后回到同一份题单与结果）。
 *
 * 题单在**开始时**就落库了，所以这里读到的题与学习者屏幕上看到的必定
 * 是同一批 —— 不是重新抽一次。
 */
export function useReviewRound(roundId: string | undefined) {
  const query = useGetReviewRound(roundId ?? '', {
    query: { enabled: Boolean(roundId) },
  });
  return {
    ...query,
    payload: query.data?.data as ReviewRoundDetailResponse | undefined,
  };
}

/**
 * 开始一轮复验。
 *
 * 手写 `useMutation` 的理由同 `useSubmitAttempt`：这一下有副作用（写
 * `review_rounds` 与 `review_round_items`），生成物是 `useQuery`，挂载即触发
 * 会让「打开复验页」直接消耗掉一次复验机会。
 *
 * 失败不自动重试：409（没有到期 / 到期但没有题）是业务状态，重试不会变。
 */
export function useStartReviewRound() {
  const queryClient = useQueryClient();
  return useMutation<ReviewRoundStartResponse, ApiClientError, void>({
    mutationFn: async () => {
      const res = await startReviewRound();
      return res.data as ReviewRoundStartResponse;
    },
    onSuccess: (data) => {
      // 队列没变（复验还没判分，排期要等过了才推进），但会话本身要能被读到
      void queryClient.invalidateQueries({ queryKey: getGetReviewQueueQueryKey() });
      void queryClient.invalidateQueries({
        queryKey: getGetReviewRoundQueryKey(data.round.roundId),
      });
    },
  });
}

/**
 * 给一轮复验判分。
 *
 * 判分是**显式动作**而不是「最后一题提交后自动触发」：学习者可能中途离开，
 * 判早了就把没做的题算成答错。判分成功后作废复验队列、本轮会话、以及每个
 * 受影响知识点的掌握度（`current` 会降，`achieved` 不降）。
 */
export function useCompleteReviewRound() {
  const queryClient = useQueryClient();
  return useMutation<ReviewCompleteResponse, ApiClientError, string>({
    mutationFn: async (roundId) => {
      const res = await completeReviewRound(roundId);
      return res.data as ReviewCompleteResponse;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: getGetReviewQueueQueryKey() });
      void queryClient.invalidateQueries({
        queryKey: getGetReviewRoundQueryKey(data.round.roundId),
      });
      void queryClient.invalidateQueries({
        queryKey: getCompleteReviewRoundQueryKey(data.round.roundId),
      });
      for (const view of data.mastery) {
        void queryClient.invalidateQueries({ queryKey: getGetMasteryQueryKey(view.microKpId) });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// 票 66 / 67：关卡模板、按档位预览、导出与导入
// ---------------------------------------------------------------------------

/**
 * 三个内置模板（教学关 / 练习关 / 复习关）。
 *
 * 模板是**服务端常量**而不是前端配置：段骨架与档位过滤（P1 七段、P2 六段、
 * P3 五段）决定填出来的 spec 长什么样，写在前端就会出现「预览七段、真打五段」
 * 这种两套真源。所以前端只读，不复制任何段定义。
 */
export function useLevelTemplates() {
  const query = useListLevelTemplates();
  return {
    ...query,
    payload: query.data?.data as LevelTemplateListResponse | undefined,
  };
}

/**
 * 按模板 + 知识点 + 档位填一份**未持久化**的草稿。
 *
 * 为什么是 `useMutation` 而不是 `useQuery`：预览的输入是「用户当前选的模板 /
 * 知识点 / 档位」，不是 URL。做成 query 会让每次改下拉都写进缓存键，
 * 缓存里堆满没人再看的组合；而它本来就没有「重新读取」的价值 —— 同样的输入
 * 服务端每次算出同一份草稿（`fillLevelTemplate` 是纯函数）。
 *
 * 预览**不落库**（响应里 `persisted: false` 就是这个意思），所以这里不作废
 * 任何列表缓存：保存是另一个动作（`useSaveMarketLevel`）。
 */
export function usePreviewLevelTemplate() {
  return useMutation<
    LevelTemplatePreviewResponse,
    ApiClientError,
    { templateId: string; request: LevelTemplatePreviewRequest }
  >({
    mutationFn: async ({ templateId, request }) => {
      const res = await previewLevelTemplate(templateId, request);
      return res.data as LevelTemplatePreviewResponse;
    },
  });
}

/**
 * 导出一张关卡成 `starmap.level/1` 文件内容。
 *
 * 这里只负责拿到响应体，落盘（`Blob` + `a[download]`）由页面做 —— 把
 * `URL.createObjectURL` 塞进 query 层会让 jsdom 里的测试要么打桩要么崩。
 */
export function useExportLevel() {
  return useMutation<LevelExportFile, ApiClientError, string>({
    mutationFn: async (levelId) => {
      const res = await exportLevel(levelId);
      return res.data as LevelExportFile;
    },
  });
}

/**
 * 导入一个 `starmap.level/1` 文件，得到一张新关卡。
 *
 * 成功后必须作废市场列表：导入的关卡是新建的（`origin='imported'`），
 * 它会出现在「预制关卡」组里（不是「我保存的」—— 导入不等于我编的）。
 *
 * 失败**不重试**：400 是文件形状不对、422 是内容不合法，重发同一份文件
 * 只会得到同一个错误，而每次重试都会真的打一次服务端。
 */
export function useImportLevel() {
  const queryClient = useQueryClient();
  return useMutation<LevelImportResponse, ApiClientError, LevelExportFile>({
    mutationFn: async (file) => {
      const res = await importLevel(file);
      return res.data as LevelImportResponse;
    },
    onSuccess: () => {
      // 导入是新建一张关卡（origin='imported'），列表必须重读才能看到它。
      // 不额外作废「这一关的详情」缓存：导入的 id 是新的，缓存里本来就没有。
      void queryClient.invalidateQueries({ queryKey: getListMarketLevelsQueryKey() });
    },
  });
}

/**
 * 把一份导出文件落成浏览器下载。
 *
 * 抽成纯函数是为了能在测试里断言「文件名与内容对得上」而不真的下载：
 * jsdom 没有 `URL.createObjectURL`，页面里调用它就必须在测试里打桩，
 * 而打桩后断言的是桩而不是产物。这里让页面只负责「调它」，文件名的规则
 * 单独可测。
 */
export function exportFileName(file: LevelExportFile): string {
  const title = file.spec.meta.title.trim() || file.spec.meta.id;
  // 文件名里的路径分隔符与 Windows 保留字符会静默截断下载，统一换成下划线。
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
  return `${safeTitle}__${file.spec.meta.microKpId}.level.json`;
}
