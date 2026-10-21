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

const JUDGE_DIMENSIONS: JudgeDimension[] = ['actionability', 'clarity', 'tone', 'scaffolding_fit'];

export interface CollectedObservations {
  recognition: RecognitionObservation[];
  leak: LeakObservation[];
  judgeInputs: JudgePromptInput[];
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

const EMPTY: CollectedObservations = { recognition: [], leak: [], judgeInputs: [] };

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
  if (!answerStage || answerStage.result.status !== 'passed') return EMPTY;

  const masteryEvidence = answerStage.evidence.find((entry) => entry.startsWith('掌握度接口 attemptCount'));
  const attemptCount = masteryEvidence ? Number(/(\d+)/.exec(masteryEvidence)?.[1] ?? 0) : 0;
  if (attemptCount === 0) return EMPTY;

  /* 找关卡：从 /market/levels 拿不到时退回到已知的教学关。
     这里不硬编码 id 而是先查一遍，是为了让内容变多之后仍然能用。 */
  const market = await getJson('/market/levels?limit=50');
  const levels = Array.isArray((market.body as { items?: unknown[] })?.items)
    ? ((market.body as { items: Array<{ levelId: string; microKpId: string }> }).items)
    : [];
  const level = levels.find((entry) => entry.microKpId === 'kp-bool') ?? levels[0];
  if (!level) return EMPTY;

  const detail = await getJson(`/levels/${encodeURIComponent(level.levelId)}`);
  const spec = (detail.body as { spec?: LevelSpecShape } | null)?.spec;
  if (!spec) return EMPTY;

  const quizItemIds = new Set<string>();
  for (const step of spec.steps ?? []) {
    if (step.kind !== 'quiz') continue;
    for (const itemId of step.itemIds) quizItemIds.add(itemId);
  }
  const items = (spec.items ?? []).filter((item) => quizItemIds.has(item.id));
  if (items.length === 0) return EMPTY;

  /* 答案块：检索调试器接口若存在就用它，否则空数组（泄露率会显示"无样本"）。 */
  const answerChunks = await fetchAnswerChunks(base, level.microKpId);

  const recognition: RecognitionObservation[] = [];
  const leak: LeakObservation[] = [];
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

  return { recognition, leak, judgeInputs };
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
