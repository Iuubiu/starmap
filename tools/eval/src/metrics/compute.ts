/**
 * 从一次旅程里算出票 20 要求的四类数字。
 *
 * ## 关键设计：**能用确定性代码算的，绝不交给 judge**
 *
 * | 指标 | 算法 | 为什么不用 judge |
 * | --- | --- | --- |
 * | 答对/答错识别率 | 读 DOM 上「已作答 / 判对 / 判错」文本 + attempts 的客观对错 | 判分正确性是层①的断言，问模型只会引入噪声 |
 * | 泄露率 | 用 `chunk_kp_answer` 的原文片段做子串匹配 | 「你觉得泄露了吗」是 subjective，「这段原文出现过吗」是 `includes()` |
 * | 过度追问 | 从 stage 序列里数连续无进展的阶段 | 数数是确定性的 |
 * | 判分漂移 | judge 跑 3 次的标签做 Fleiss κ + 连续量 CV | 这**必须**用 judge —— 因为它测的就是 judge 自己稳不稳 |
 *
 * 换句话说：judge 在本工具里有两个角色，一个是「被测量的对象」（漂移），
 * 一个是「主观维度评分器」。它**不是**事实的来源。
 */

import { cohensKappa, coefficientOfVariation, fleissKappa, wilsonInterval, type Interval } from '../metrics/stats.ts';
import type { JourneyResult } from '../layer2/journey.ts';
import type { JudgeRunRecord } from '../layer3/llm-judge.ts';

/** 一条需要判别的观察：学生答了什么、系统说了什么、客观对错。 */
export interface RecognitionObservation {
  turn: number;
  stage: string;
  /** 客观对错（来自 attempts 表或 spec 的 answer），不是 judge 判断的。 */
  correct: boolean;
  /** 系统反馈的原文（judge 要看的就是它）。 */
  feedbackText: string;
  /** judge 对这一轮给出的判断；judge 失败时为 null。 */
  judgement: { acknowledgesCorrect: boolean | null; identifiesWrong: boolean | null } | null;
}

export interface RecognitionMetrics {
  correct: Interval;
  wrong: Interval;
  /** judge 没跑成 / 输出不可解析时的观察数，报告里要写「N 轮未判定」。 */
  unjudged: number;
  observations: RecognitionObservation[];
}

/**
 * 从同一个输入的多次采样里取一个判断（多数票）。
 *
 * **为什么不能只取第一次采样。** `judge.meta.samples` 默认是 3，票 20 用这 3 次
 * 算漂移；但把判断回填到识别率时，如果只读 `runs[0]`，等于把另外两票扔掉，
 * 而报告上完全看不出来 —— 那 3 次采样就只剩「测漂移」一个用途了。
 *
 * 实测过一次代价：P2 的答错识别率在某一轮报 50%（1/2），原因不是产品对老周
 * 的错误反馈变差，而是那一条输入的 `identifiesWrong` 三票是 `false/true/true`，
 * 只取第一票就成了「没识别出来」。换成多数票是 `true`。**一个只在第一票上
 * 出现的标签，不该比另外两票更重要。**
 *
 * 平票与含 null 的情况不猜：返回 null，由调用方计入 `unjudged`。
 * 宁可写「这一轮没测到」，也不要把 2:1 说成 3:0。
 */
export function majorityVote(values: ReadonlyArray<boolean | null>): boolean | null {
  let yes = 0;
  let no = 0;
  for (const value of values) {
    if (value === null) continue;
    if (value) yes += 1;
    else no += 1;
  }
  if (yes > no) return true;
  if (no > yes) return false;
  return null;
}

/**
 * 答对识别率 / 答错识别率。
 *
 * **两个独立比率，绝不合成一个「准确率」。** 理由在 `report/schema.ts` 的
 * `RecognitionSchema` 注释里写得很清楚：模型倾向肯定正确、对错误给模糊反馈，
 * 合并后两种偏差互相抵消。
 *
 * 分母口径的细节：只算 **judge 给出明确布尔判断**的观察。judge 返回 null
 * （这一轮没有对错可言）或 judge 整轮失败时，该观察不进分母 —— 但会计入
 * `unjudged`，报告里要能看到「有多少轮其实没测到」。把失败的算成「未识别」
 * 会让识别率凭空变低，那是把工具故障伪装成产品缺陷。
 */
export function computeRecognition(observations: readonly RecognitionObservation[]): RecognitionMetrics {
  let correctTotal = 0;
  let correctRecognized = 0;
  let wrongTotal = 0;
  let wrongRecognized = 0;
  let unjudged = 0;

  for (const observation of observations) {
    if (observation.judgement === null) {
      unjudged += 1;
      continue;
    }
    if (observation.correct) {
      if (observation.judgement.acknowledgesCorrect === null) {
        unjudged += 1;
        continue;
      }
      correctTotal += 1;
      if (observation.judgement.acknowledgesCorrect) correctRecognized += 1;
    } else {
      if (observation.judgement.identifiesWrong === null) {
        unjudged += 1;
        continue;
      }
      wrongTotal += 1;
      /* 口径：只算**明确判错**。「再想想」「差一点」这类模糊反馈不算识别 ——
         它没有告诉学生错在哪，学生下一轮仍然不知道往哪改。 */
      if (observation.judgement.identifiesWrong) wrongRecognized += 1;
    }
  }

  return {
    correct: wilsonInterval(correctRecognized, correctTotal),
    wrong: wilsonInterval(wrongRecognized, wrongTotal),
    unjudged,
    observations: [...observations],
  };
}

// ---------------------------------------------------------------------------
// 泄露率（确定性判据）
// ---------------------------------------------------------------------------

export interface LeakObservation {
  tier: 'L1' | 'L2' | 'L3';
  /** 系统这一轮的回复原文。 */
  responseText: string;
  /** 该知识点的答案块原文（来自 `chunk_kp_answer` join `chunks`）。 */
  answerChunks: readonly string[];
}

export interface LeakMetrics {
  L1: { rate: Interval; leaked: number; total: number };
  L2: { rate: Interval; leaked: number; total: number };
  L3: { rate: Interval; leaked: number; total: number };
  /** 每次命中的证据（引原文片段），报告里逐条列出。 */
  hits: Array<{ tier: string; matchedFragment: string; responseExcerpt: string }>;
}

/**
 * 判据：回复里是否出现答案块的原文片段。
 *
 * ## 为什么是子串匹配而不是 judge
 *
 * 「这段原文出现在回复里了吗」有确定答案。交给模型判断，等于把一个 `includes()`
 * 换成一次可能出错、且无法审计的推理。
 *
 * ## 为什么去掉空白再比
 *
 * 答案块与回复都可能含 markdown、公式、换行。直接比会漏掉「答案被换行拆开」
 * 这种真实泄露。归一化规则：把连续空白折成单个空格、去掉行内 `$` 与反引号。
 * 这会略微提高误报（不同排版被当成同一段），但泄露的方向上宁可严一点 ——
 * 漏报一个真泄露比多报一个假泄露严重得多。
 *
 * ## 片段长度门槛
 *
 * 太短的片段（<12 字符）会在任何中文回复里偶然命中。所以只对 ≥12 字符的
 * 连续片段做匹配。12 是经验值：一个中文术语约 4–8 字，两个术语加连接词就够。
 */
const MIN_FRAGMENT_CHARS = 12;

function normalize(text: string): string {
  return text
    .replace(/[`$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从答案块里切出可匹配的片段（按句子切，太短的丢弃）。 */
export function answerFragments(answerChunks: readonly string[]): string[] {
  const fragments: string[] = [];
  for (const chunk of answerChunks) {
    const normalized = normalize(chunk);
    if (normalized === '') continue;
    for (const piece of normalized.split(/[。；;!?！？\n]/)) {
      const fragment = piece.trim();
      if (fragment.length >= MIN_FRAGMENT_CHARS) fragments.push(fragment);
    }
    /* 整块也算一个片段：有时答案是一句长话，按标点切完反而都太短。 */
    if (normalized.length >= MIN_FRAGMENT_CHARS) fragments.push(normalized);
  }
  return [...new Set(fragments)];
}

export function computeLeakRate(observations: readonly LeakObservation[]): LeakMetrics {
  const buckets: Record<'L1' | 'L2' | 'L3', { leaked: number; total: number }> = {
    L1: { leaked: 0, total: 0 },
    L2: { leaked: 0, total: 0 },
    L3: { leaked: 0, total: 0 },
  };
  const hits: LeakMetrics['hits'] = [];

  for (const observation of observations) {
    const bucket = buckets[observation.tier];
    bucket.total += 1;
    const response = normalize(observation.responseText);
    const fragments = answerFragments(observation.answerChunks);
    const matched = fragments.find((fragment) => response.includes(fragment));
    if (matched !== undefined) {
      bucket.leaked += 1;
      hits.push({
        tier: observation.tier,
        matchedFragment: matched.slice(0, 120),
        responseExcerpt: response.slice(0, 200),
      });
    }
  }

  return {
    L1: { rate: wilsonInterval(buckets.L1.leaked, buckets.L1.total), ...buckets.L1 },
    L2: { rate: wilsonInterval(buckets.L2.leaked, buckets.L2.total), ...buckets.L2 },
    L3: { rate: wilsonInterval(buckets.L3.leaked, buckets.L3.total), ...buckets.L3 },
    hits,
  };
}

// ---------------------------------------------------------------------------
// 过度追问分布
// ---------------------------------------------------------------------------

export interface StallMetrics {
  maxStall: number;
  stalls: number[];
  stallsOver2: number;
}

/**
 * 从阶段序列里数「连续无进展」的长度。
 *
 * 定义（与 `report/schema.ts` 的 `StallSchema` 一致）：学生连续回「不知道」而
 * 系统没有降级（`degraded=false`）的轮数。这里的输入是 judge 对每一轮的
 * `consecutiveProbes` 与 `degraded`，按轮次排序后切成段。
 *
 * 记分布而不是平均值：平均值会把「每次卡 2 轮」和「一次卡 10 轮」抹平，
 * 后者才是学生放弃的真实原因。
 */
export function computeStalls(
  turns: ReadonlyArray<{ turn: number; consecutiveProbes: number; degraded: boolean }>,
): StallMetrics {
  const sorted = [...turns].sort((left, right) => left.turn - right.turn);
  const stalls: number[] = [];
  let current = 0;
  for (const entry of sorted) {
    if (entry.degraded) {
      if (current > 0) stalls.push(current);
      current = 0;
      continue;
    }
    current = Math.max(current, entry.consecutiveProbes);
    /* consecutiveProbes 是从 1 开始数的（含本轮）。到 3 就记一段，
       然后清零重新数 —— 不然后面每轮都会再加进同一段。 */
    if (current >= 3) {
      stalls.push(current);
      current = 0;
    }
  }
  if (current > 0) stalls.push(current);
  return {
    maxStall: stalls.length === 0 ? 0 : Math.max(...stalls),
    stalls,
    stallsOver2: stalls.filter((length) => length >= 3).length,
  };
}

// ---------------------------------------------------------------------------
// 判分漂移
// ---------------------------------------------------------------------------

export interface DriftMetrics {
  /** 多分类标签的 Fleiss κ（judge 跑 n 次的「是否识别答错」标签）。 */
  fleissKappa: number | null;
  fleissReason: string | null;
  /** 连续量（judge 四维总分的均值）的 CV。 */
  cv: number | null;
  /** 实际参与计算的样本轮数。 */
  nSamples: number;
  /** 每组重放次数。 */
  nReplays: number;
  /** 两两 Cohen's κ（第一轮 vs 第 k 轮），报告里作为漂移的细粒度证据。 */
  pairwise: Array<{ sampleA: number; sampleB: number; kappa: number | null; reason: string | null }>;
}

/**
 * 从「同一批轮次 × n 次重放」的 judge 结果算漂移。
 *
 * `runs[roundIndex][sampleIndex]` 是第 roundIndex 轮、第 sampleIndex 次重放的
 * judge 结果。每个结果给两样东西：
 *  - 一个**标签**（这一轮是否明确判错）：算 Fleiss κ；
 *  - 一个**连续量**（四维总分均值）：算 CV。
 *
 * 两者都要，理由见 `report/schema.ts` 的 `ScoringConsistencySchema`：只报原始
 * 一致率是错的（任务太简单时 5 次全一样），κ 扣掉了随机一致的基线；而 κ 只
 * 适用于离散标签，连续量得看 CV。
 */
export function computeDrift(runs: ReadonlyArray<ReadonlyArray<JudgeRunRecord>>): DriftMetrics {
  const labelRows: string[][] = [];
  const scoreRows: number[][] = [];

  for (const round of runs) {
    const labels: string[] = [];
    const totals: number[] = [];
    for (const record of round) {
      if (!record.assessment) continue;
      const judgement = record.assessment.identifiesWrong;
      /* null 不进标签列 —— 那一轮没有对错可言，塞进去会污染 κ。 */
      if (judgement === null) continue;
      labels.push(judgement ? 'identified' : 'missed');
      const sum = record.assessment.scores.reduce((total, entry) => total + entry.score, 0);
      totals.push(sum / record.assessment.scores.length);
    }
    if (labels.length >= 2) labelRows.push(labels);
    if (totals.length >= 2) scoreRows.push(totals);
  }

  const fleiss = fleissKappa(labelRows);

  const cvs: number[] = [];
  for (const row of scoreRows) {
    const cv = coefficientOfVariation(row);
    if (cv !== null) cvs.push(cv);
  }
  const meanCv = cvs.length === 0 ? null : cvs.reduce((sum, value) => sum + value, 0) / cvs.length;

  /* 两两 Cohen's κ：第一轮作为基准。比 Fleiss 更细，能看出「第 3 次特别飘」。 */
  const pairwise: DriftMetrics['pairwise'] = [];
  for (let sample = 1; sample < (runs[0]?.length ?? 0); sample += 1) {
    const left: string[] = [];
    const right: string[] = [];
    for (const round of runs) {
      const a = round[0]?.assessment?.identifiesWrong;
      const b = round[sample]?.assessment?.identifiesWrong;
      if (a === null || a === undefined || b === null || b === undefined) continue;
      left.push(a ? 'identified' : 'missed');
      right.push(b ? 'identified' : 'missed');
    }
    const kappa = cohensKappa(left, right);
    pairwise.push({ sampleA: 0, sampleB: sample, kappa: kappa.value, reason: kappa.reason });
  }

  return {
    fleissKappa: fleiss.value,
    fleissReason: fleiss.reason,
    cv: meanCv,
    nSamples: labelRows.length,
    nReplays: runs[0]?.length ?? 0,
    pairwise,
  };
}

/** 旅程里的三类失败计数。报告里单独一节。 */
export function failureBreakdown(journey: JourneyResult): {
  locatorFailure: number;
  backendError: number;
  assertionMismatch: number;
  total: number;
  byStage: Array<{ stage: string; label: string; status: string; detail: string }>;
} {
  const failed = journey.stages.filter((stage) => stage.result.status !== 'passed');
  return {
    locatorFailure: journey.failures.locatorFailure,
    backendError: journey.failures.backendError,
    assertionMismatch: journey.failures.assertionMismatch,
    total: failed.length,
    byStage: failed.map((stage) => ({
      stage: stage.stage,
      label: stage.label,
      status: stage.result.status,
      detail: stage.result.detail,
    })),
  };
}
