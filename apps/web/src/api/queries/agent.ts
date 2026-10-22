/**
 * 智能体、检索、技能库三个领域的 query / mutation hook。
 *
 * 归属泳道：agent-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 *
 * ## 为什么提交类调用要自己包 `useMutation`
 *
 * Orval 这份配置只开了 `query.useQuery`（见 `packages/api-contract/orval.config.mjs`），
 * 没开 `useMutation`。生成器对 POST / PATCH 也照样产出 `useStartProbe` 这类
 * **useQuery** hook —— 那不是笔误，是配置的结果，但它有两个真实后果：
 *
 *   1. 一个「提交一句话」的按钮会走 GET 语义：会被重试、会在窗口重新聚焦时
 *      重发。对学生来说就是「我点了没反应，过一会儿突然冒出三张卡」。
 *   2. 提交的内容进了 queryKey，缓存里堆满再也不会复用的 key。
 *
 * 所以这里统一用 `useMutation` + 直接调生成的原生函数（`createAgentTurn` 等）。
 * 原生函数的签名是类型安全的，绕过的只是「生成器把动词搞错了」这一层。
 *
 * ## payload 命名
 *
 * 和 `queries/*.ts` 的其它文件保持一致：把 `res.data` 收窄后叫 `payload`。
 * `customFetch` 在 `!res.ok` 时直接 throw，所以运行时 `data` 永远是成功体。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAgentTurn,
  debugRetrieval,
  getAgentTurn,
  getAgentTurnEvidence,
  getProbeMetrics,
  getProbeSession,
  getRetrievalBands,
  getSkill,
  getSkillSystemPreview,
  listAgentTurns,
  listSkills,
  replyProbe,
  startProbe,
  toggleSkill,
} from '../generated/default/default';
import type {
  AgentTurnEvidenceResponse,
  AgentTurnHistoryResponse,
  AgentTurnRequest,
  AgentTurnResponse,
  DebugRetrievalParams,
  GetRetrievalBandsParams,
  ProbeMetricsResponse,
  ProbeReplyRequest,
  ProbeSessionResponse,
  ProbeStartRequest,
  ProbeTurnResponse,
  RetrievalBandsResponse,
  RetrievalDebugResponse,
  SkillDetailResponse,
  SkillListResponse,
  SkillSystemPreviewResponse,
} from '../generated/model';

/** 所有本领域的 query key 集中在这里，失效时不用去猜前缀。 */
export const agentKeys = {
  turns: (sessionId: string) => ['agent', 'turns', sessionId] as const,
  turn: (turnId: string) => ['agent', 'turn', turnId] as const,
  evidence: (turnId: string) => ['agent', 'evidence', turnId] as const,
  skills: () => ['agent', 'skills'] as const,
  skill: (name: string) => ['agent', 'skills', 'detail', name] as const,
  systemPreview: () => ['agent', 'skills', 'system-preview'] as const,
  retrievalDebug: (params: DebugRetrievalParams) =>
    ['agent', 'retrieval', 'debug', params.query, params.microKpId, params.limit ?? 10] as const,
  retrievalBands: (params: GetRetrievalBandsParams) =>
    ['agent', 'retrieval', 'bands', params.query, params.microKpId, params.limit ?? 20] as const,
  probe: (probeId: string) => ['agent', 'probe', probeId] as const,
  probeMetrics: () => ['agent', 'probe', 'metrics'] as const,
};

// ---------------------------------------------------------------------------
// 票 08：结构化回合
// ---------------------------------------------------------------------------

/**
 * 一次提交 = 一张新卡。
 *
 * `onSuccess` 里失效学习日志而不是自己往缓存里塞一条：日志的顺序由
 * 服务端 `ordinal` 决定，前端拼一条就会在「两轮几乎同时返回」时错序。
 */
export function useSubmitTurn(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation<AgentTurnResponse, Error, Omit<AgentTurnRequest, 'sessionId'>>({
    mutationFn: async (body) =>
      (await createAgentTurn({ ...body, sessionId })).data as AgentTurnResponse,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.turns(sessionId) });
    },
  });
}

/**
 * 学习日志。
 *
 * 关掉窗口聚焦重取：日志是「这一会话发生过什么」的记录，不是实时流。
 * 每次切标签页回来都重拉一遍，会让正在读的那一段闪一下。
 */
export function useAgentTurns(sessionId: string | undefined, limit = 50) {
  const query = useQuery({
    queryKey: agentKeys.turns(sessionId ?? ''),
    queryFn: async () =>
      (await listAgentTurns({ sessionId: sessionId as string, limit })).data as AgentTurnHistoryResponse,
    enabled: Boolean(sessionId),
    refetchOnWindowFocus: false,
  });
  return { ...query, payload: query.data };
}

/** 「看依据」用：这一轮到底检索到了什么、哪些被门控挡掉了。 */
export function useTurnEvidence(turnId: string | undefined) {
  const query = useQuery({
    queryKey: agentKeys.evidence(turnId ?? ''),
    queryFn: async () =>
      (await getAgentTurnEvidence(turnId as string)).data as AgentTurnEvidenceResponse,
    enabled: Boolean(turnId),
  });
  return { ...query, payload: query.data };
}

/**
 * 回看某一轮。
 *
 * 卡片的完整内容在服务端落库时就已经存好了（`app.agent_turns.artifact`），
 * 这里只是把它取回来 —— **不重新调模型**。重放会漂移：同一个问题两次生成的
 * 卡不一样，历史会自己变形，而「可回看」的前提是历史不变。
 *
 * 关掉窗口聚焦重取：历史记录不会因为切了个标签页就变。
 */
export function useAgentTurn(turnId: string | undefined) {
  const query = useQuery({
    queryKey: agentKeys.turn(turnId ?? ''),
    queryFn: async () => (await getAgentTurn(turnId as string)).data as AgentTurnResponse,
    enabled: Boolean(turnId),
    refetchOnWindowFocus: false,
  });
  return { ...query, payload: query.data };
}

// ---------------------------------------------------------------------------
// 票 09：检索调试器
// ---------------------------------------------------------------------------

export function useRetrievalDebug(params: DebugRetrievalParams | undefined) {
  const query = useQuery({
    queryKey: agentKeys.retrievalDebug(params ?? { query: '', microKpId: '' }),
    queryFn: async () =>
      (await debugRetrieval(params as DebugRetrievalParams)).data as RetrievalDebugResponse,
    enabled: Boolean(params?.query && params?.microKpId),
  });
  return { ...query, payload: query.data };
}

/**
 * 三档并排对比。
 *
 * 只在调试器点「对比三档」时才有用，所以不主动触发：它一次发三个检索，
 * 而页面上真正在看的是单个档位的结果。
 */
export function useRetrievalBands(params: GetRetrievalBandsParams | undefined) {
  const query = useQuery({
    queryKey: agentKeys.retrievalBands(params ?? { query: '', microKpId: '' }),
    queryFn: async () =>
      (await getRetrievalBands(params as GetRetrievalBandsParams)).data as RetrievalBandsResponse,
    enabled: Boolean(params?.query && params?.microKpId),
  });
  return { ...query, payload: query.data };
}

// ---------------------------------------------------------------------------
// 票 10：苏格拉底追问
// ---------------------------------------------------------------------------

export function useProbeSession(probeId: string | undefined) {
  const query = useQuery({
    queryKey: agentKeys.probe(probeId ?? ''),
    queryFn: async () => (await getProbeSession(probeId as string)).data as ProbeSessionResponse,
    enabled: Boolean(probeId),
  });
  return { ...query, payload: query.data };
}

export function useStartProbe() {
  const queryClient = useQueryClient();
  return useMutation<ProbeSessionResponse, Error, ProbeStartRequest>({
    mutationFn: async (body) => (await startProbe(body)).data as ProbeSessionResponse,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent', 'probe'] });
    },
  });
}

export function useReplyProbe(probeId: string) {
  const queryClient = useQueryClient();
  return useMutation<ProbeTurnResponse, Error, ProbeReplyRequest>({
    mutationFn: async (body) => (await replyProbe(probeId, body)).data as ProbeTurnResponse,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.probe(probeId) });
      void queryClient.invalidateQueries({ queryKey: agentKeys.probeMetrics() });
    },
  });
}

export function useProbeMetrics() {
  const query = useQuery({
    queryKey: agentKeys.probeMetrics(),
    queryFn: async () => (await getProbeMetrics()).data as ProbeMetricsResponse,
  });
  return { ...query, payload: query.data };
}

// ---------------------------------------------------------------------------
// 票 15：技能库
// ---------------------------------------------------------------------------

export function useSkills() {
  const query = useQuery({
    queryKey: agentKeys.skills(),
    queryFn: async () => (await listSkills()).data as SkillListResponse,
  });
  return { ...query, payload: query.data };
}

export function useSkill(name: string | undefined) {
  const query = useQuery({
    queryKey: agentKeys.skill(name ?? ''),
    queryFn: async () => (await getSkill(name as string)).data as SkillDetailResponse,
    enabled: Boolean(name),
  });
  return { ...query, payload: query.data };
}

export function useSkillSystemPreview() {
  const query = useQuery({
    queryKey: agentKeys.systemPreview(),
    queryFn: async () => (await getSkillSystemPreview()).data as SkillSystemPreviewResponse,
  });
  return { ...query, payload: query.data };
}

/**
 * 开关一个 skill。
 *
 * 成功后必须同时处理三个 key：列表的 `enabled` 字段、system message 预览，
 * 以及按名字取的那份详情。只失效列表的话，页面上「已禁用」和预览里
 * 「它还在」会同时成立 —— 那正好是这个功能最不能出的错；只失效列表而不
 * 管详情，则左边写着「已禁用」、右边正文卡还挂着「启用中」。
 *
 * 详情不失效而是直接写入：响应体就是最新的详情，省一次往返，也省掉
 * 「请求已发出、新数据还没回来」那一帧的相反结论。
 */
export function useToggleSkill() {
  const queryClient = useQueryClient();
  return useMutation<SkillDetailResponse, Error, { name: string; enabled: boolean }>({
    mutationFn: async ({ name, enabled }) =>
      (await toggleSkill(name, { enabled })).data as SkillDetailResponse,
    onSuccess: (data, variables) => {
      queryClient.setQueryData(agentKeys.skill(variables.name), data);
      void queryClient.invalidateQueries({ queryKey: agentKeys.skills() });
      void queryClient.invalidateQueries({ queryKey: agentKeys.systemPreview() });
    },
  });
}
