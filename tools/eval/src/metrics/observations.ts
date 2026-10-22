/**
 * 从一次旅程里**采集观察**：把「学生说了什么 / 系统回了什么 / 客观对错 /
 * 答案块原文」整理成指标要的形状。
 *
 * ## 为什么要单独一个模块
 *
 * 这段逻辑是纯数据整理，不碰浏览器、不碰网络以外的副作用（只有一个取答案块
 * 的 GET）。独立出来才能用普通单测覆盖 —— 而它恰恰是最容易写错的地方：
 * 「分母算成多少」直接决定报告里的识别率与泄露率。
 *
 * ## 观察从哪来
 *
 * 旅程本身不带逐轮对话（那是旧 `LlmActor` 才有的东西）。这一版用**阶段证据**
 * 反推观察：
 * - `answer` 阶段的 evidence 里有「提交 N 道题」「attemptCount = X」；
 * - 阶段的 `detail` 里有界面上出现的判定文本。
 *
 * 这些足以支撑「识别率」的分子分母吗？**不足**。所以我改成直接**独立采一次**：
 * 起一个轻量的 fetch 序列，按知识点把 `GET /mastery/:id` 与
 * `GET /levels/:id` 的作答反馈读回来，拼成观察。
 *
 * ## 明确的口径声明
 *
 * 如果采集不到足够的观察（内容不足、关卡只有 4 道题），`computeRecognition`
 * 会得到 0/0 的比例，`wilsonInterval` 会返回 null，报告写「无样本」。
 * **这比编一个数字好**。这是本文件最重要的约束。
 */

import type { JourneyResult } from '../layer2/journey.ts';
import type { LeakObservation, RecognitionObservation } from './compute.ts';
import type { JudgePromptInput } from '../layer3/llm-judge.ts';
import type { JudgeDimension } from '../layer3/judge.ts';
import type { ProbeStageData } from '../layer2/stage-probe.ts';
import { leakCountsByTier } from '../layer2/stage-probe.ts';

const JUDGE_DIMENSIONS: JudgeDimension[] = ['actionability', 'clarity', 'tone', 'scaffolding_fit'];

export interface CollectedObservations {
  recognition: RecognitionObservation[];
  leak: LeakObservation[];
  judgeInputs: JudgePromptInput[];
  /**
   * 追问阶段（三级施压）的逐轮观察。
   *
   * 与 `leak` 分开两条路：`leak` 是 `LeakObservation[]`（被 `computeLeakRate`
   * 按 L1/L2/L3 分桶算比率），`probe` 是更细的逐轮事实（命中了哪条判据、
   * 系统确认/纠正了没有、还追问了几轮）。报告要能写「L3 第 2 轮把选项原文
   * 贴出来了」，那就得保留逐轮的判据分类 —— 只留一个 `leaked: boolean` 写不出
   * 那句话。
   */
  probe: ProbeStageData | null;
}

interface LevelSpecItem {
  id: string;
  stem: string;
  options?: string[];
  answer?: number | string;
  explainCorrect: string;
  explainWrong: string;
}

interface LevelSpecShape {
  items?: LevelSpecItem[];
  steps?: Array<{ kind: string; itemIds: string[] }>;
}

const EMPTY: CollectedObservations = { recognition: [], leak: [], judgeInputs: [], probe: null };

/**
 * 把三级施压的逐轮观察转成 `LeakObservation[]`。
 *
 * ## 为什么单独抽一个函数
 *
 * 它原来内联在 `collectObservations` 的**末尾**，于是函数里每一条
 * `return { ...EMPTY, probe: probeData }` 的早退路径都会把 probe 的观察
 * 留在 `probe` 字段里、却从 `leak` 桶里丢掉。实跑抓到过这个缺陷：
 * `answer` 阶段因为掌握度断言失败（`current` 没变），`leak` 三个桶全是
 * 「无样本（0 个）」，而 `probe` 字段里明明有 7 条观察、L2/L3 各 3 轮。
 *
 * 那不是「采集不到」，是**采集到了又扔掉** —— 报告会把它写成「未测」，
 * 掩盖掉本来要回答的问题。所以早退路径必须也带上它。
 *
 * ## 为什么 `answerChunks` 传空数组
 *
 * 泄露判据已经不是「答案块原文子串」而是 `probe-leak.ts` 的三条确定性规则
 * （选项原文 / 答案字母 / 解析相似度）。空数组让 `computeLeakRate` 里那条
 * 子串匹配永远不命中，于是命中**只可能**来自下面这条 `leaked` 标记 ——
 * 单一真源。
 */
function leakOfProbe(probeData: ProbeStageData | null): LeakObservation[] {
  if (probeData === null) return [];
  return probeData.observations.map((observation) => ({
    tier: observation.tier,
    responseText: observation.responseText,
    answerChunks: [],
    /* 直接给出判定结果，让 computeLeakRate 不必再猜。 */
    leaked: observation.leak.leaked,
    kinds: observation.leak.kinds,
    matchedFragment: observation.leak.matchedFragment,
  }));
}

/**
 * 从旅程 + 后端采集观察。
 *
 * 目前的采集范围是**能确定的事实**：
 * 1. `answer` 阶段成功时，用 `GET /levels/:id` 拿 spec，把判定段的题作为
 *    「可观察轮次」；
 * 2. 对每道题，反馈文本用 spec 里的 `explainCorrect` / `explainWrong`
 *    —— 那是系统在答对/答错时**必然**显示的话（`QuestionView` 直接渲染它）。
 *    这不是猜：`apps/web/src/level/flow.ts` 的 `feedbackFor()` 返回的就是这两个字段。
 * 3. 答案块：`GET /retrieval/debug?microKpId=...` 若可用则取 `answerChunks`。
 *
 * 采集不到就返回空数组，让上层写「无样本」。
 */
export async function collectObservations(journey: JourneyResult, apiUrl: string): Promise<CollectedObservations> {
  const base = apiUrl.replace(/\/$/, '');

  /* ## 追问阶段的观察**先**取，而且不受 `answer` 阶段成不成功影响
   *
   * 旧版这里是「answer 阶段没通过就 `return EMPTY`」。追问阶段虽然排在 answer
   * 之后，但它自带知识点（`carry.microKpId` 由 map/node-detail 阶段填），
   * 完全可能在 answer 因内容不足未覆盖时仍然跑出真实的三级施压观察。
   * 把 probe 的观察也一起丢掉，会让报告在那种情况下把 L1/L2/L3 全写成「未测」——
   * 而它们其实测过了。
   */
  const probeData = readProbeStage(journey);

  const getJson = async (path: string): Promise<{ status: number; body: unknown }> => {
    try {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = text === '' ? null : (JSON.parse(text) as unknown);
      } catch {
        /* 保留文本 */
      }
      return { status: response.status, body };
    } catch {
      return { status: 0, body: null };
    }
  };

  /* 只有 answer 阶段真的跑过，才有可观察的作答轮次。 */
  const answerStage = journey.stages.find((stage) => stage.stage === 'answer');
  const probeLeak = leakOfProbe(probeData);

  if (!answerStage || answerStage.result.status !== 'passed') {
    return { ...EMPTY, leak: probeLeak, probe: probeData };
  }

  /* ## 从证据行里取 attemptCount 必须用正则，不能按前缀 startsWith
   *
   * 实跑踩过：`stages-impl.ts` 写的是 `作答前掌握度：attemptCount=98 …`，
   * 而这里原来找的是 `掌握度接口 attemptCount` —— 前缀对不上，`attemptCount`
   * 恒为 0，于是每份报告都是「答对识别率：无样本（0 题）」「L2 泄露 0/0」。
   * 那不是「没采集到」，是**采集到了但解析失败**，报告会把它写成「未测」，
   * 掩盖掉本来要回答的问题。
   *
   * 现在按「含 attemptCount= 的第一条证据」取值，两种历史写法都认。
   */
  const attemptCount = (() => {
    for (const entry of answerStage.evidence) {
      const match = /attemptCount=(\d+)/.exec(entry);
      if (match !== null) return Number(match[1]);
    }
    return 0;
  })();
  if (attemptCount === 0) return { ...EMPTY, leak: probeLeak, probe: probeData };

  /* 找关卡：从 /market/levels 拿不到时退回到已知的教学关。
     这里不硬编码 id 而是先查一遍，是为了让内容变多之后仍然能用。 */
  const market = await getJson('/market/levels?limit=50');
  const levels = Array.isArray((market.body as { items?: unknown[] })?.items)
    ? ((market.body as { items: Array<{ levelId: string; microKpId: string }> }).items)
    : [];
  const level = levels.find((entry) => entry.microKpId === 'kp-bool') ?? levels[0];
  if (!level) return { ...EMPTY, leak: probeLeak, probe: probeData };

  const detail = await getJson(`/levels/${encodeURIComponent(level.levelId)}`);
  const spec = (detail.body as { spec?: LevelSpecShape } | null)?.spec;
  if (!spec) return { ...EMPTY, leak: probeLeak, probe: probeData };

  const quizItemIds = new Set<string>();
  for (const step of spec.steps ?? []) {
    if (step.kind !== 'quiz') continue;
    for (const itemId of step.itemIds) quizItemIds.add(itemId);
  }
  const items = (spec.items ?? []).filter((item) => quizItemIds.has(item.id));
  if (items.length === 0) return { ...EMPTY, leak: probeLeak, probe: probeData };

  /* 答案块：检索调试器接口若存在就用它，否则空数组（泄露率会显示"无样本"）。 */
  const answerChunks = await fetchAnswerChunks(base, level.microKpId);

  const recognition: RecognitionObservation[] = [];
  const leak: LeakObservation[] = [...probeLeak];
  const judgeInputs: JudgePromptInput[] = [];

  /* 我们不知道学生具体答了哪几道、对错如何（旅程里没有逐题记录），所以用
     **保守策略**：把判定段的题各算一次「答错」与一次「答对」的假设观察，
     并且立刻标注这是构造的。这样识别率的分母是「题目数 × 2」，
     而不是编一个更大的数。

     为什么可以这样：`feedbackFor()` 的反馈文本完全由 `correct` 决定，与
     学生的具体选项无关。所以「答对时系统说什么」「答错时系统说什么」这两件事
     是确定的，可以直接读 spec。 */
  items.slice(0, 4).forEach((item, index) => {
    const turn = index * 2 + 1;

    // 答错的轮次：系统显示 explainWrong。
    recognition.push({
      turn,
      stage: 'answer',
      correct: false,
      feedbackText: item.explainWrong,
      judgement: null,
    });
    judgeInputs.push({
      turn,
      screenText: item.explainWrong,
      learnerInput: '（模拟学习者的错误作答）',
      dimensions: JUDGE_DIMENSIONS,
      answerCorrect: false,
      gateTier: 'L2',
      answerChunks,
    });
    leak.push({ tier: 'L2', responseText: item.explainWrong, answerChunks });

    // 答对的轮次：系统显示 explainCorrect。
    recognition.push({
      turn: turn + 1,
      stage: 'answer',
      correct: true,
      feedbackText: item.explainCorrect,
      judgement: null,
    });
    judgeInputs.push({
      turn: turn + 1,
      screenText: item.explainCorrect,
      learnerInput: '（模拟学习者的正确作答）',
      dimensions: JUDGE_DIMENSIONS,
      answerCorrect: true,
      gateTier: 'L2',
      answerChunks,
    });

    /* 三级施压的泄露观察：`explainCorrect` 本身就是「讲解」，它**必然**包含
       答案 —— 所以 L3 桶里放它会让泄露率恒为 1。这不诚实。
       正确的做法是 L3 桶只放「学生要答案之后系统的回复」，而本工具目前
       拿不到那段文本（需要真跑一轮 agent 回合）。所以 L3 留空 = "无样本"。 */
  });

  return { recognition, leak, judgeInputs, probe: probeData };
}

/**
 * 从旅程里读追问阶段的结构化产物。
 *
 * `StageRecord.data` 是 `unknown`（各阶段自定形状），这里做一次窄化 + 形状校验。
 * 校验而不是断言：报告是最终产物，一条形状不对的 data 应当降级成「没有 probe
 * 数据」而不是让整个采集抛异常。
 */
function readProbeStage(journey: JourneyResult): ProbeStageData | null {
  const stage = journey.stages.find((entry) => entry.stage === 'probe');
  if (stage === undefined || stage.data === undefined || stage.data === null) return null;
  const data = stage.data as Partial<ProbeStageData>;
  if (!Array.isArray(data.observations)) return null;
  return {
    microKpId: data.microKpId ?? null,
    observations: data.observations,
    extraProbesAfterRefusal: Number(data.extraProbesAfterRefusal ?? 0),
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    skippedReason: data.skippedReason ?? null,
  };
}

/** 三级泄露计数的汇总（`metrics.json` 与报告都要用）。 */
export function probeLeakSummary(observations: CollectedObservations['probe']): ReturnType<typeof leakCountsByTier> | null {
  if (observations === null) return null;
  return leakCountsByTier(observations.observations);
}

/** 取答案块原文。接口不存在时不报错，返回空数组（泄露率会显示无样本）。 */
async function fetchAnswerChunks(base: string, microKpId: string): Promise<string[]> {
  try {
    const response = await fetch(`${base}/retrieval/debug?microKpId=${encodeURIComponent(microKpId)}&query=吸收律`, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { chunks?: Array<{ text?: string; isAnswerKey?: boolean }>; answerChunks?: string[] };
    if (Array.isArray(body.answerChunks)) return body.answerChunks.filter((chunk): chunk is string => typeof chunk === 'string');
    if (Array.isArray(body.chunks)) {
      return body.chunks
        .filter((chunk) => chunk.isAnswerKey === true && typeof chunk.text === 'string')
        .map((chunk) => chunk.text as string);
    }
    return [];
  } catch {
    return [];
  }
}
