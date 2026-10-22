/**
 * 初始定级：4 题行为自评 + 8–18 道自适应定级题。纯函数，无 IO。
 *
 * ## 为什么是「三档后验」而不是能力分
 *
 * spec 把 DKT / IRT / CAT 的完整实现明确列进 Out of Scope，但票 11 又要求
 * 停止条件里出现「后验标准差」与「熵变化」——这两个量需要有**分布**才说得通。
 * 折中：把学习者建模成三态离散分布（P1/P2/P3），而不是连续能力值。
 *
 * - 定级的输出本来就是档位（决定每关的渲染参数），不是分数；用一个能力分
 *   再映射到档位会多出一条没有任何数据支撑的边界。
 * - 三态分布算得出标准差与熵，且**不需要标定任何题目参数**：我们没有几百人
 *   的作答数据去估区分度，硬套 2PL 会让「难度」变成编出来的数字。
 *
 * 三档的「能力」在 logit 空间取 -1 / 0 / +1，题目难度取 -1 / 0 / +1，
 * 似然用 sigmoid(θ − b)。这三个数字是粗粒度假设，不是标定结果 —— 它们只
 * 需要保证「难题上 P3 比 P1 更容易答对」这个方向是对的。
 *
 * ## 自评只值 ±0.4 logit（spec:283）
 *
 * 自评不是「你是什么水平」，而是四道**行为频率**题（最近有没有手算过、
 * 有没有推导过）。四题的选择被归一化成一个 −1…+1 的量，再乘以 0.4 得到
 * 一个 logit 平移量，作用在「能力先验的中心」上。
 *
 * 上限 0.4 是硬约束，写进 `PLACEMENT_LIMITS.priorShiftLogit`：自评与实测
 * 能力的相关性一直不稳定，让它超过半档就会把「自称学过」的人直接放进 P3，
 * 而定级题存在的意义正是不信这句话。所以自评只能让起手的第一题稍微好一点，
 * 不能决定档位。
 *
 * ## 三个停止条件（票 11 验收 3）
 *
 * 1. 后验标准差 ≤ 0.35 —— 档位已经稳了；
 * 2. 最近三题的正确率落在 40–70% —— 题目难度带宽匹配学习者，再问也问不出
 *    更有用的信息（全对说明太简单，全错说明太难；这两种都会让后验快速跑偏）；
 * 3. 熵变化 < 0.01 —— 这一题几乎没有改变任何东西，继续问是浪费。
 *
 * 三者都是「可以停」，不是「必须停」之外的强制项：`minItems` = 8 与
 * `maxItems` = 18 是硬边界（票面「题量落在 8–18 之间」）。所以 8 题之前
 * 即使三条全满足也继续，18 题必停。
 */

/** 题目的粗粒度难度。三档，与三档能力的 logit 取值对齐。 */
export type PlacementDifficulty = 'easy' | 'medium' | 'hard';

export type ProficiencyTier = 'P1' | 'P2' | 'P3';

/** 一道可用的定级题。只要这三个字段——题干与选项由调用方按 itemId 自己取。 */
export interface PlacementItem {
  itemId: string;
  /** 这道题测的微知识点。**必须来自「马上要学的知识点池」**（票 11 验收 2）。 */
  microKpId: string;
  difficulty: PlacementDifficulty;
}

export interface SelfAssessmentOption {
  id: string;
  label: string;
  /** −1…+1，负数表示「没怎么做过」，正数表示「经常做」 */
  weight: number;
}

export interface SelfAssessmentQuestion {
  id: string;
  prompt: string;
  options: readonly SelfAssessmentOption[];
}

export interface SelfAssessmentAnswer {
  questionId: string;
  optionId: string;
}

/**
 * 4 道行为自评。
 *
 * 措辞上只问**过去发生过的行为**（做过几次、能不能独立完成），不问自我评价。
 * 原因是票 11 验收 1 的原文：只问行为（最近学过什么／能不能手算某类题），
 * 不问「你觉得自己几分」。行为频率是可回忆的事实，自评分是主观标定。
 */
export const SELF_ASSESSMENT_QUESTIONS: readonly SelfAssessmentQuestion[] = [
  {
    id: 'recent-study',
    prompt: '最近三个月里，你系统学过与电路、信号相关的课程吗？',
    options: [
      { id: 'never', label: '没有', weight: -1 },
      { id: 'once', label: '只看过一点零散材料', weight: -0.5 },
      { id: 'course', label: '跟过一门课，但没做完', weight: 0 },
      { id: 'finished', label: '完整学完过一门课', weight: 0.5 },
      { id: 'several', label: '学过多门，且做过课程作业', weight: 1 },
    ],
  },
  {
    id: 'hand-calc',
    prompt: '像「已知电阻与温度，估算热噪声电压」这样的题，你现在能独立手算吗？',
    options: [
      { id: 'cannot', label: '完全不知道从哪下手', weight: -1 },
      { id: 'recall-only', label: '记得有公式，但写不出来', weight: -0.5 },
      { id: 'with-help', label: '查着公式能算，但容易错', weight: 0 },
      { id: 'sure', label: '基本能算对', weight: 0.5 },
      { id: 'fast', label: '能算，还能估算结果是否合理', weight: 1 },
    ],
  },
  {
    id: 'boolean',
    prompt: '给你一个布尔表达式，你能用代数化简法把它化成最简与或式吗？',
    options: [
      { id: 'never-heard', label: '没听过这个方法', weight: -1 },
      { id: 'seen', label: '见过例题，自己动手会卡住', weight: -0.5 },
      { id: 'slow', label: '能做，但要多花些时间', weight: 0 },
      { id: 'ok', label: '大部分题能一次做对', weight: 0.5 },
      { id: 'teach', label: '能做得又快又稳，还能给别人讲', weight: 1 },
    ],
  },
  {
    id: 'instruments',
    prompt: '示波器、信号发生器、万用表这类仪器，你实际动过手吗？',
    options: [
      { id: 'never', label: '没有碰过', weight: -1 },
      { id: 'demo', label: '只看别人演示过', weight: -0.5 },
      { id: 'lab', label: '实验课上按步骤用过', weight: 0 },
      { id: 'alone', label: '能自己搭一套测量', weight: 0.5 },
      { id: 'debug', label: '能自己搭，还能定位测量里的问题', weight: 1 },
    ],
  },
];

export const PLACEMENT_LIMITS = {
  selfAssessmentQuestions: 4,
  /** 票面：题量落在 8–18 之间 */
  minItems: 8,
  maxItems: 18,
  /** 停止条件一：后验标准差 ≤ 0.35 */
  posteriorSdStop: 0.35,
  /** 停止条件二：最近三题正确率落在 40–70% 带 */
  bandLow: 0.4,
  bandHigh: 0.7,
  bandWindow: 3,
  /** 停止条件三：熵变化 < 0.01 */
  entropyStop: 0.01,
  /** 自评最多把先验中心平移 ±0.4 logit（spec:283） */
  priorShiftLogit: 0.4,
  /**
   * 先验在档位上的宽度。取 1.8 是让「中性自评」的分布接近均匀
   * （三档概率都在 0.315–0.368），也就是**默认不预设任何人是什么档**。
   */
  priorSpread: 1.8,
  /** 三档对应的能力（logit） */
  tierAbility: { P1: -1, P2: 0, P3: 1 } as const,
  /** 三档难度的 b 参数（logit） */
  difficulty: { easy: -1, medium: 0, hard: 1 } as const,
  /**
   * 累计多少道「计入掌握度」的作答后自动重判。
   *
   * 票 11 票面写的是「学满 3 个知识点后自动重判」，但那是从票 12 抄错的：
   * spec.md:52 与 spec.md:283 两处都写「学 5 题后可重判」。而 spec.md:281 的
   * 「每完成 3 个知识点重评」属于票 12 的流程重评（档位渲染参数调整），
   * 与本票的「定级结果重判」是两件事。
   *
   * 为什么不保留两个门槛取先到者：3 个知识点按 `evidenceSufficient`（8 题 +
   * 3 变式）算至少 24 题，5 题门槛永远先到 ⇒ 「3 个知识点」这条分支在数学上
   * 永远不会起作用，留着它就是一条永远不会红的测试加一段死代码。要么它真
   * 起作用，要么删掉，不能摆着当装饰。
   */
  rejudgeAfterAttempts: 5,
} as const;

const TIERS: readonly ProficiencyTier[] = ['P1', 'P2', 'P3'];

export type PlacementStopReason = 'sd' | 'band' | 'entropy' | 'max_items' | 'no_more_items';

export interface PlacementAnswerLog {
  itemId: string;
  microKpId: string;
  correct: boolean;
  /** 答题前模型对「这题会做对」的预测，用于事后核对定级是否合理 */
  predicted: number;
}

export interface PlacementState {
  /** 三档后验，顺序同 `TIERS`，和为 1 */
  posterior: readonly number[];
  /** 自评带来的先验平移量（logit），便于展示「自评把起点挪了多少」 */
  priorShift: number;
  answered: number;
  history: readonly PlacementAnswerLog[];
  /** 最近若干题的对错，最多保留 `bandWindow` 条 */
  recentResults: readonly boolean[];
  /** 最近一次更新前的熵 */
  entropyBefore: number;
  /** 最近一次更新的熵变化（正数表示不确定度下降） */
  entropyChange: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function sigmoid(x: number): number {
  // 数值稳定写法：x 很大或很小时不溢出
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

function normalize(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    // 全部下溢成 0 时退回均匀分布，不抛错：定级不能因为数值极端就中断
    return TIERS.map(() => 1 / TIERS.length);
  }
  return weights.map((value) => value / total);
}

/** 熵（以 2 为底，单位 bit；三档最大 1.585） */
function entropyOf(probs: readonly number[]): number {
  return probs.reduce((sum, p) => (p > 0 ? sum - p * Math.log2(p) : sum), 0);
}

/**
 * 把 4 题自评折算成一个 logit 平移量。
 *
 * 归一化方式是「实际得分 / 满分」，所以四题全选最负 → −1，全选最正 → +1，
 * 与题目数量无关（将来加题不会悄悄把平移上限撑大）。再乘以
 * `priorShiftLogit` = 0.4，得到 ±0.4 的硬上限。
 */
export function priorFromSelfAssessment(answers: readonly SelfAssessmentAnswer[]): {
  shift: number;
  raw: number;
} {
  let score = 0;
  let maxAbs = 0;
  for (const question of SELF_ASSESSMENT_QUESTIONS) {
    const answer = answers.find((candidate) => candidate.questionId === question.id);
    const option = answer
      ? question.options.find((candidate) => candidate.id === answer.optionId)
      : undefined;
    // 缺答按中性处理：跳过不计分，分母也跳过 —— 否则缺一题会被当成「选了最负」
    if (!option) continue;
    score += option.weight;
    maxAbs += Math.max(...question.options.map((o) => Math.abs(o.weight)));
  }
  const raw = maxAbs === 0 ? 0 : clamp(score / maxAbs, -1, 1);
  return { shift: raw * PLACEMENT_LIMITS.priorShiftLogit, raw };
}

/**
 * 初始状态：先验是「以 shift 为中心、宽度 priorSpread 的离散高斯」。
 * 中性自评（shift = 0）时为近似均匀分布，即不预设档位。
 */
export function initialPlacementState(answers: readonly SelfAssessmentAnswer[] = []): PlacementState {
  const { shift } = priorFromSelfAssessment(answers);
  const spread = PLACEMENT_LIMITS.priorSpread;
  const weights = TIERS.map((tier) => {
    const gap = PLACEMENT_LIMITS.tierAbility[tier] - shift;
    return Math.exp(-(gap * gap) / (2 * spread * spread));
  });
  const posterior = normalize(weights);
  return {
    posterior,
    priorShift: shift,
    answered: 0,
    history: [],
    recentResults: [],
    entropyBefore: entropyOf(posterior),
    entropyChange: 0,
  };
}

/** 三档概率（拷贝，避免调用方改到内部状态） */
export function tierProbabilities(state: PlacementState): number[] {
  return [...state.posterior];
}

export function placementEntropy(state: PlacementState): number {
  return entropyOf(state.posterior);
}

/** 某一题在当前后验下的预测正确率 */
export function predictedCorrect(state: PlacementState, item: PlacementItem): number {
  const b = PLACEMENT_LIMITS.difficulty[item.difficulty];
  return TIERS.reduce((sum, tier, index) => {
    const p = sigmoid(PLACEMENT_LIMITS.tierAbility[tier] - b);
    return sum + (state.posterior[index] ?? 0) * p;
  }, 0);
}

/** 某档能力在某一题上答对的概率（更新的似然项） */
function tierLikelihood(tier: ProficiencyTier, item: PlacementItem, correct: boolean): number {
  const b = PLACEMENT_LIMITS.difficulty[item.difficulty];
  const p = sigmoid(PLACEMENT_LIMITS.tierAbility[tier] - b);
  return correct ? p : 1 - p;
}

/**
 * 记一次作答，返回新状态（不修改入参）。
 *
 * 同时更新 `entropyBefore` 与 `entropyChange` —— 停止条件三要的是**这一题**
 * 带来的熵变化，不是「从开始到现在的总变化」。用总变化会让一个已经收敛的
 * 分布永远显示「变化很大」，条件三就永远不会触发。
 */
export function recordPlacementAnswer(
  state: PlacementState,
  item: PlacementItem,
  correct: boolean,
): PlacementState {
  const predicted = predictedCorrect(state, item);
  const weights = TIERS.map(
    (tier, index) => (state.posterior[index] ?? 0) * tierLikelihood(tier, item, correct),
  );
  const posterior = normalize(weights);
  const entropyBefore = entropyOf(state.posterior);
  const entropyAfter = entropyOf(posterior);
  const recentResults = [...state.recentResults, correct].slice(-PLACEMENT_LIMITS.bandWindow);
  return {
    posterior,
    priorShift: state.priorShift,
    answered: state.answered + 1,
    history: [...state.history, { itemId: item.itemId, microKpId: item.microKpId, correct, predicted }],
    recentResults,
    entropyBefore,
    entropyChange: entropyBefore - entropyAfter,
  };
}

export interface PlacementStopInput {
  /** 题池里还剩几道没问过。缺省表示「不限」，只看其它条件 */
  remainingItems?: number;
}

export interface PlacementStop {
  stopped: boolean;
  reason: PlacementStopReason | null;
  posteriorSd: number;
  recentBandRate: number | null;
  entropyChange: number;
}

/** 后验标准差（档位取 0/1/2 计） */
export function posteriorStandardDeviation(state: PlacementState): number {
  const mean = state.posterior.reduce((sum, p, index) => sum + p * index, 0);
  const variance = state.posterior.reduce((sum, p, index) => sum + p * (index - mean) ** 2, 0);
  return Math.sqrt(Math.max(0, variance));
}

/**
 * 该不该停。
 *
 * 顺序：硬边界（题量上限 / 题池用尽）→ 题量下限 → 三条收敛条件。
 * 硬边界优先是因为它们与后验无关：题问完了就是问完了，跟分布窄不窄没关系。
 * 三条收敛条件之间按「哪条更确定先」排：标准差是最终的判据，带宽是过程
 * 判据，熵变化是兜底。
 */
export function placementStop(state: PlacementState, input: PlacementStopInput = {}): PlacementStop {
  const posteriorSd = posteriorStandardDeviation(state);
  const window = state.recentResults;
  const recentBandRate =
    window.length >= PLACEMENT_LIMITS.bandWindow
      ? window.filter(Boolean).length / window.length
      : null;
  const base = { posteriorSd, recentBandRate, entropyChange: state.entropyChange };

  if (state.answered >= PLACEMENT_LIMITS.maxItems) {
    return { ...base, stopped: true, reason: 'max_items' };
  }
  if (input.remainingItems !== undefined && input.remainingItems <= 0) {
    return { ...base, stopped: true, reason: 'no_more_items' };
  }
  if (state.answered < PLACEMENT_LIMITS.minItems) {
    return { ...base, stopped: false, reason: null };
  }
  if (posteriorSd <= PLACEMENT_LIMITS.posteriorSdStop) {
    return { ...base, stopped: true, reason: 'sd' };
  }
  if (
    recentBandRate !== null &&
    recentBandRate >= PLACEMENT_LIMITS.bandLow &&
    recentBandRate <= PLACEMENT_LIMITS.bandHigh
  ) {
    return { ...base, stopped: true, reason: 'band' };
  }
  // 取绝对值：熵**增加**说明这一题反而把分布推宽了（答案出乎意料），
  // 那不是「收敛」，不能当成停下的理由。只有「无论往哪个方向都没动」
  // 才是条件三想表达的意思。写成有符号比较会把大额负变化也判成收敛，
  // 于是刚刚被搅乱的后验反而触发停止。
  if (state.answered >= 2 && Math.abs(state.entropyChange) < PLACEMENT_LIMITS.entropyStop) {
    return { ...base, stopped: true, reason: 'entropy' };
  }
  return { ...base, stopped: false, reason: null };
}

export interface PlacementResult {
  tier: ProficiencyTier;
  /** 后验里最高那一档的概率。**不是正确率** */
  confidence: number;
  /** 定级永远是 provisional（票 11 验收 5：允许日后重判） */
  status: 'provisional';
  /** 题量不足或置信度低时为 true，前端要显式说明「这个结果还不太准」 */
  lowConfidence: boolean;
  answered: number;
  stopReason: PlacementStopReason | null;
  entropy: number;
  posteriorSd: number;
  probabilities: number[];
}

/** 置信度低于这个值就标 lowConfidence，前端会提示「多答几题会更准」 */
export const PLACEMENT_LOW_CONFIDENCE = 0.5;

export function placementResult(state: PlacementState): PlacementResult {
  let bestIndex = 0;
  state.posterior.forEach((p, index) => {
    if (p > (state.posterior[bestIndex] ?? 0)) bestIndex = index;
  });
  const probabilities = [...state.posterior];
  const confidence = probabilities[bestIndex] ?? 0;
  const stop = placementStop(state);
  return {
    tier: TIERS[bestIndex] ?? 'P2',
    confidence,
    status: 'provisional',
    lowConfidence: state.answered < PLACEMENT_LIMITS.minItems || confidence < PLACEMENT_LOW_CONFIDENCE,
    answered: state.answered,
    stopReason: stop.reason,
    entropy: entropyOf(probabilities),
    posteriorSd: stop.posteriorSd,
    probabilities,
  };
}

/**
 * 选题：挑「预测正确率最接近 50%」的那一道。
 *
 * 这是没有 IRT 参数时的最大信息量近似：一题的信息量在 p≈0.5 时最大，
 * 而 p 越接近 0 或 1，答对答错都几乎推不动后验。同时跳过已答过的题。
 */
export function selectPlacementItem(
  state: PlacementState,
  items: readonly PlacementItem[],
): PlacementItem | null {
  const answered = new Set(state.history.map((entry) => entry.itemId));
  let best: PlacementItem | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (answered.has(item.itemId)) continue;
    const distance = Math.abs(predictedCorrect(state, item) - 0.5);
    // 平手时取先遇到的，保证同样的输入永远给同样的题（纯函数可重放）
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

export interface RejudgeInput {
  /**
   * 定级档案的状态。**只有 `provisional` 一种真实值**：
   *
   * `confirmed` 曾经在契约与类型里声明过，但全仓没有任何写入路径能把它写进
   * 库里（`upsertProfile` 写 `'provisional'`，`applyRejudge` 不碰 status 列），
   * 也就是一个从入口就不可达的死枚举值。spec.md:283 与票 11 验收 5 的语义是
   * 「定级结果永远是临时的、随时会被学习证据修正」，本来就不存在「确认后
   * 不再改」这个终态。所以这里收窄成 `'provisional'`，让类型说出真相。
   */
  status: 'provisional';
  /** 自上次定级/重判以来，累计「计入掌握度」的作答数 */
  attemptsSince: number;
}

/**
 * 该不该自动重判。
 *
 * 门槛是「自上次定级/重判以来累计 5 题作答」（spec.md:52 / spec.md:283），
 * **不是**「学完 3 个知识点」。票面那句「学满 3 个知识点」来自票 12
 * （spec.md:281 的流程重评），见 `PLACEMENT_LIMITS.rejudgeAfterAttempts` 的注释。
 *
 * 用作答数而不是「学完的知识点数」还有一个实质理由：`evidenceSufficient`
 * 要求至少 8 题 + 3 变式，一个刚开始学的新人做完 5 题时一个知识点都还没
 * 「学完」，按知识点计数等于让重判在最初几天永远不触发 —— 恰是定级最容易
 * 判错、也最需要纠正的那段时间。
 */
export function shouldRejudge(input: RejudgeInput): boolean {
  if (input.status !== 'provisional') return false;
  return input.attemptsSince >= PLACEMENT_LIMITS.rejudgeAfterAttempts;
}
