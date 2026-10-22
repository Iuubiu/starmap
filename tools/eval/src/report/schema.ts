/**
 * 报告的数据模型。**schema 先于渲染**：字段定下来，渲染只是给它排版。
 *
 * 这个文件是产出的地基，因为它决定了报告能说什么、不能说什么：
 *  - `evidenceLevel` 是字面量 `'假设生成'`，不是自由字符串 —— 想把报告
 *    标成"已验收"或"可用性达标"的人，必须先改这里，改的时候会被看见。
 *  - `judgeMeta.agreementWithHumanKappa` 是 `null` 字面量。
 *  - `claimsUsabilityPassed` 是 `literal(false)`：报告**结构上**无法宣称
 *    可用性达标。这比在文档里写"请不要说过头话"更可靠。
 *
 * 阶段轴 S0–S9 来自 ux-eval-methods.md 的 S4–S10 定义，这里补齐 S0–S3 共十级。
 */

import { z } from 'zod';
import { JudgeDimensionSchema, JUDGE_DIMENSION_LABEL, JudgeMetaSchema } from '../layer3/judge.ts';

/** 漏斗的十级阶段。顺序即旅程顺序，`stage_reached` 取走到的最大一级。 */
export const STAGES = [
  { id: 'S0', label: '冷启动', detail: '首屏可见、底部输入框可见可聚焦、无 console error' },
  { id: 'S1', label: '首轮意图', detail: '输入框任意滚动位置可达、回车即发送、空输入被拒有提示' },
  { id: 'S2', label: '关卡卡产出', detail: '结构化关卡卡（topic_id / prerequisites / task / hint_level / expected_answer_spec）' },
  { id: 'S3', label: '图谱聚焦', detail: '聚焦节点 ⊆ 当前主题及邻域、可键盘到达、缩放不丢焦点' },
  { id: 'S4', label: '作答与判分', detail: '正确必判对、错误必判错、带单位答对被识别' },
  { id: 'S5', label: '追问表单', detail: '字段与 expected_answer_spec 一一对应、必填为空被拦并给具体错误' },
  { id: 'S6', label: '进度变化', detail: 'after > before 单调不减、刷新后保持、与数据库页一致' },
  { id: 'S7', label: '数据库检视', detail: '抽样记录在 DB 中存在且字段一致、无孤儿、时间戳单调' },
  { id: 'S8', label: '技能库', detail: '搜索命中、产物引用 skill_id、卸载后不再引用' },
  { id: 'S9', label: '会话恢复', detail: '历史与当前关卡完整恢复、无重复首轮问候、输入框仍可聚焦' },
] as const;

export const StageIdSchema = z.enum(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);
export type StageId = z.infer<typeof StageIdSchema>;

export const STAGE_IDS: readonly StageId[] = STAGES.map((stage) => stage.id);

export const OutcomeSchema = z.enum(['success', 'partial', 'give_up', 'crash']);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** 摩擦计数。报告里"点击几次、清空几次、刷新几次"全部出自这里。 */
export const FrictionSchema = z.object({
  rageClicks: z.number().int().min(0).default(0),
  deadClicks: z.number().int().min(0).default(0),
  uTurns: z.number().int().min(0).default(0),
  inputClears: z.number().int().min(0).default(0),
  refreshLoops: z.number().int().min(0).default(0),
  hintRequests: z.number().int().min(0).default(0),
  formSkips: z.number().int().min(0).default(0),
  locatorFailures: z.number().int().min(0).default(0),
  abandonmentTurn: z.number().int().min(0).nullable().default(null),
});

export type Friction = z.infer<typeof FrictionSchema>;

/**
 * 判分识别的两组**独立**埋点：答对识别率与答错识别率。
 *
 * 为什么必须两个分母、两个分子，而不是一个"识别准确率"：
 * GuideEval 的结论是模型**倾向肯定正确、对错误给模糊反馈**。合并成一个
 * 数字时，"答对全认、答错全放水"照样能拿到 80% 这种看起来及格的分 ——
 * 两种偏差互相抵消了。分开记，才知道到底是哪一侧在漏水。
 *
 * `wrongRecognized` 的口径是**明确判错**：出现"再想想""差一点"这类
 * 模糊反馈**不计入**已识别 —— 它没有告诉学生错在哪，学生下一轮仍然
 * 不知道往哪改。判据写在这里而不是留在统计脚本里，否则两处口径会分叉。
 *
 * 分母为 0 时比率是 `null` 而不是 0：没有答错的样本不等于答错全认出来了。
 * 这与 `percent: null`（证据不足）是同一条纪律。
 */
export const RecognitionSchema = z.object({
  correctTotal: z.number().int().min(0).default(0),
  correctRecognized: z.number().int().min(0).default(0),
  wrongTotal: z.number().int().min(0).default(0),
  wrongRecognized: z.number().int().min(0).default(0),
});

export type Recognition = z.infer<typeof RecognitionSchema>;

/** 比率；分母为 0 返回 null（不是 0 —— 见 RecognitionSchema 注释）。 */
export function recognitionRates(recognition: Recognition): { correct: number | null; wrong: number | null } {
  const ratio = (numerator: number, denominator: number): number | null => (denominator === 0 ? null : numerator / denominator);
  return {
    correct: ratio(recognition.correctRecognized, recognition.correctTotal),
    wrong: ratio(recognition.wrongRecognized, recognition.wrongTotal),
  };
}

/** 目标产物与它的结构化校验结果（不比对文案，比对字段）。 */
export const ArtifactSchema = z.object({
  type: z.enum(['level_card', 'graph_focus', 'progress_delta', 'followup_form']),
  turn: z.number().int().min(1),
  schemaOk: z.boolean(),
  missingFields: z.array(z.string()).default([]),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

/** 失败模式 F1–F8 的逐条留痕：发生了几次、第一次在第几轮、证据是什么。 */
export const FailurePatternSchema = z.object({
  occurrences: z.number().int().min(0),
  firstTurn: z.number().int().min(1).nullable(),
  evidence: z.array(z.string()).default([]),
});
export type FailurePattern = z.infer<typeof FailurePatternSchema>;

export const FAILURE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'] as const;

export const FAILURE_LABEL: Record<(typeof FAILURE_IDS)[number], string> = {
  F1: '泄露答案',
  F2: '过度追问 / 循环',
  F3: '判分漂移',
  F4: '幻觉 / 无溯源',
  F5: '语言不一致',
  F6: '泛化表扬',
  F7: '忽略学习者状态',
  F8: '脚手架强加',
};

/**
 * 泄露答案率：按施压等级分开记。
 *
 * 分母是**该等级下的回复数**，不是总回复数 —— 混着算会让"只压了 1 次"和
 * "压了 20 次"看起来一样。资产报告里真正要回答的是「学生三级追问之后，
 * 系统还能不能守住答案」，那是 L3 那一格。
 *
 * 判据：回复里出现最终数值、完整公式或选项答案即算泄露 —— 由确定性代码
 * 比对 `expected_answer_spec`，不交给 judge。没跑过该等级时为 `null`，
 * 不能默认成 0（"没测"和"守住了"是两件事）。
 */
export const LeakRateSchema = z.object({
  L1: z.number().min(0).max(1).nullable().default(null),
  L2: z.number().min(0).max(1).nullable().default(null),
  L3: z.number().min(0).max(1).nullable().default(null),
  /** 每级实际观察到几个样本 —— 少于 3 个时上面的比率不该被引用。 */
  samples: z.object({ L1: z.number().int().min(0).default(0), L2: z.number().int().min(0).default(0), L3: z.number().int().min(0).default(0) }).default({ L1: 0, L2: 0, L3: 0 }),
});

/**
 * 判分漂移：同一份答案重放 n 次（只改 run id）后判分结果的稳定性。
 *
 * 两个数字各有分工，不能只留一个：
 *  - 连续量表（percent）看 **CV**，`cv <= 0.05`；
 *  - 二值判定（对/错）看 **Fleiss κ**，`kappa >= 0.8`。
 *
 * 只报原始一致率是错的（调研里明确写了）：5 次全一样也可能只是任务太简单，
 * κ 扣掉了随机一致的基线。`null` = 没跑重放，不是"稳定"。
 */
export const ScoringConsistencySchema = z.object({
  fleissKappa: z.number().min(-1).max(1).nullable().default(null),
  cv: z.number().min(0).nullable().default(null),
  nReplays: z.number().int().min(0).default(0),
});

/**
 * 过度追问的可观测分布。
 *
 * 「连续无进展轮次」= 学生连续回「不知道/随便/嗯」而系统没有降级策略的轮数。
 * 记分布而不是平均值：平均值会把"每次卡 2 轮"和"一次卡 10 轮"抹平，
 * 而后者才是学生放弃的真实原因。`maxStall` 是单次最长停滞，`stalls` 是
 * 每次停滞的长度序列，`stallsOver2` 是长度 ≥3 的次数（达标线 ≤1）。
 */
export const StallSchema = z.object({
  maxStall: z.number().int().min(0).default(0),
  stalls: z.array(z.number().int().min(0)).default([]),
  stallsOver2: z.number().int().min(0).default(0),
});

/**
 * 追问阶段（三级施压）的结果。
 *
 * ## 为什么单独一块，不并进 `leakRate`
 *
 * `leakRate` 只有三个比率 + 三个样本数，它是「指标」。这一段是「证据」：
 * 每一级命中了哪条判据、系统有没有确认/纠正、学生明说要答案之后系统还问了
 * 几轮。报告里要写「L3 第 2 轮把正确选项原文贴出来了」—— 那句话需要判据分类，
 * 一个 `0.33` 写不出来。
 *
 * ## 为什么 `observations` 不在这里
 *
 * 逐轮原文（每级 3 轮 × 3 级 = 9 条）进 `metrics.json`。报告正文只放计数与
 * 至多两条引用：再多读者就不看了，而完整证据在 journey JSON 与 metrics.json 里。
 */
export const ProbeLeakTierSchema = z.object({
  /** 该级泄露了几轮。 */
  leaked: z.number().int().min(0).default(0),
  /** 该级一共观察了几轮。 */
  total: z.number().int().min(0).default(0),
  /** 三条判据各自命中几次（一条回复可同时命中多条）。 */
  answerText: z.number().int().min(0).default(0),
  answerLetter: z.number().int().min(0).default(0),
  explanation: z.number().int().min(0).default(0),
});

export const ProbeLeakSchema = z.object({
  microKpId: z.string().nullable().default(null),
  L1: ProbeLeakTierSchema.default({ leaked: 0, total: 0, answerText: 0, answerLetter: 0, explanation: 0 }),
  L2: ProbeLeakTierSchema.default({ leaked: 0, total: 0, answerText: 0, answerLetter: 0, explanation: 0 }),
  L3: ProbeLeakTierSchema.default({ leaked: 0, total: 0, answerText: 0, answerLetter: 0, explanation: 0 }),
  /** 学生 L3 明说要答案之后，系统还继续追问的轮数。 */
  extraProbesAfterRefusal: z.number().int().min(0).default(0),
  /** 系统明确确认学生答对的轮数。 */
  acknowledged: z.number().int().min(0).default(0),
  /** 系统明确指出学生答错的轮数。 */
  corrected: z.number().int().min(0).default(0),
  /** 每条观察的原文摘录（至多 3 条）。 */
  quotes: z.array(z.string().min(1)).max(3).default([]),
  /** 没测到的原因（没有可追问的知识点时）。 */
  skippedReason: z.string().nullable().default(null),
});

/** 单个 persona 的一次旅程。 */
export const JourneySchema = z.object({
  personaId: z.string().min(1),
  tier: z.enum(['P1', 'P2', 'P3']),
  scenarioId: z.string().min(1),
  outcome: OutcomeSchema,
  stageReached: StageIdSchema,
  stageDurations: z.partialRecord(StageIdSchema, z.number().min(0)),
  turnsPerStage: z.partialRecord(StageIdSchema, z.number().int().min(0)),
  artifacts: z.array(ArtifactSchema).default([]),
  friction: FrictionSchema,
  failures: z.record(z.enum(FAILURE_IDS), FailurePatternSchema),
  /** 学生原话，每处卡点配一句，最多 5 条 —— 再多读者就不看了。 */
  quotes: z.array(z.object({ turn: z.number().int().min(1), text: z.string().min(1) })).max(5).default([]),
  /** 判分识别的两组独立埋点（答对/答错分开记，见 RecognitionSchema 注释）。 */
  recognition: RecognitionSchema.default({ correctTotal: 0, correctRecognized: 0, wrongTotal: 0, wrongRecognized: 0 }),
  leakRate: LeakRateSchema.default({ L1: null, L2: null, L3: null, samples: { L1: 0, L2: 0, L3: 0 } }),
  /**
   * 追问阶段的证据。`null` = 本版没跑（不是「没泄露」）。
   *
   * 与 `leakRate` 的关系：`leakRate` 的 L1/L2/L3 现在**主要**由这一段的观察
   * 产生（见 `metrics/observations.ts`），但两者不能合并 —— `leakRate` 是
   * 跨来源的统一比率（还包含被动泄露），这一段是追问阶段独有的证据。
   */
  probeLeak: ProbeLeakSchema.nullable().default(null),
  scoringConsistency: ScoringConsistencySchema.default({ fleissKappa: null, cv: null, nReplays: 0 }),
  stall: StallSchema.default({ maxStall: 0, stalls: [], stallsOver2: 0 }),
  paasSeries: z.array(z.number().min(1).max(9)).default([]),
  /**
   * 这组旅程没有采集到的字段名。
   *
   * **摩擦计数默认为 0，但 0 有两种含义：「数了，是 0」与「根本没数」。**
   * 本版旅程是确定性阶段脚本，不模拟点击狂点/空输入/刷新循环，所以那一组计数
   * 恒为 0 —— 那是「没采」，不是「没发生」。不标出来的话，报告上的
   * 「死点 0 次 · 狂点 0 次」读起来像已经验过一遍。
   */
  unsampled: z.array(z.string()).default([]),
});

export type Journey = z.infer<typeof JourneySchema>;

export const DisciplineSchema = z.object({
  evidenceLevel: z.literal('假设生成'),
  /** 结构上禁止宣称可用性达标。想改必须改这个字面量。 */
  claimsUsabilityPassed: z.literal(false),
  /** 三 persona 的区分度自检结果（由 checkDistinctiveness 产生）。 */
  distinctivenessChecked: z.boolean(),
  distinctivenessViolations: z.array(z.string()).default([]),
  /** 典型误解是否为设计假设（无文献支撑）。恒为 true。 */
  misconceptionsAreDesignAssumptions: z.literal(true),
});

export const ReportSchema = z.object({
  meta: z.object({
    runId: z.string().min(1),
    appVersion: z.string().min(1),
    llmModel: z.string().min(1),
    modelTemperature: z.number().min(0).max(2),
    startedAt: z.string().min(1),
    durationS: z.number().min(0),
  }),
  discipline: DisciplineSchema,
  journeys: z.array(JourneySchema).min(1),
  judgeScores: z
    .array(
      z.object({
        personaId: z.string(),
        dimension: JudgeDimensionSchema,
        score: z.number().min(1).max(5),
      }),
    )
    .default([]),
  judgeMeta: JudgeMetaSchema,
  topBlockers: z
    .array(
      z.object({
        stage: StageIdSchema,
        element: z.string().min(1),
        description: z.string().min(10),
        severity: z.enum(['blocker', 'major', 'minor']),
      }),
    )
    .max(3)
    .default([]),
  suggestedFixes: z
    .array(
      z.object({
        blockerRef: z.number().int().min(0),
        hypothesis: z.string().min(10),
        effort: z.enum(['trivial', 'small', 'medium', 'large']),
      }),
    )
    .default([]),
  /** 找得到的与找不到的东西都要写，缺口本身是结论的一部分。 */
  unknownItems: z.array(z.string()).default([]),
});

export type Report = z.infer<typeof ReportSchema>;

/** 表格行：一个 persona 在十级阶段上的到达情况，供矩阵渲染。 */
export function buildFunnelMatrix(report: Report): {
  stages: typeof STAGES;
  rows: Array<{ personaId: string; tier: string; reached: StageId; cells: Array<'reached' | 'blocked'> }>;
} {
  const rows = report.journeys.map((journey) => {
    const reachedIndex = STAGE_IDS.indexOf(journey.stageReached);
    return {
      personaId: journey.personaId,
      tier: journey.tier,
      reached: journey.stageReached,
      cells: STAGE_IDS.map((_, index) => (index <= reachedIndex ? ('reached' as const) : ('blocked' as const))),
    };
  });
  return { stages: STAGES, rows };
}

/**
 * 措辞守卫：报告正文里出现这些说法就是越界。
 *
 * 放在代码里而不是只写进文档，因为文档没人跑。测试会用它对整份 markdown
 * 逐句扫描 —— 一旦有人写出"可用性达标"，CI 就红。
 *
 * 分两类，因为报告本身必须能**声明缺失**：
 *  - `negationAware: true` 的规则查"声称"，命中后看前后文有没有否定词
 *    （未/无/不/null…）。「judge 与真人评分的一致性 κ = null」是在说"没校准"，
 *    这是报告必须写的话；若守卫连它一起拦，作者只能把这句话删掉，
 *    而那恰恰是最该留的一句。
 *  - `negationAware: false` 的规则查的是**以否认形式出现的过度断言**：
 *    「未发现明显问题」的否定义项是"问题"，整句仍是一句越界结论。
 */
export const FORBIDDEN_CLAIMS: ReadonlyArray<{ pattern: RegExp; why: string; negationAware: boolean }> = [
  { pattern: /可用性(已)?达标|usability\s+passed/i, why: '模拟用户只能生成假设，不能证明可用性达标', negationAware: true },
  { pattern: /用户体验(良好|优秀|合格)|UX\s+is\s+good/i, why: '同一句：模拟数据不足以支撑体验结论', negationAware: true },
  { pattern: /(与真人|与人类)评分(高度)?一致|agreement.*(high|excellent)/i, why: 'agreement_with_human_kappa 恒为 null，未做校准', negationAware: true },
  { pattern: /未发现(明显)?(缺陷|问题)|无(明显)?(缺陷|问题)|no\s+issues\s+found/i, why: '没发现问题 ≠ 没有问题，只说明没覆盖到', negationAware: false },
  { pattern: /风险(已)?可控|ready\s+for\s+(release|production)/i, why: '证据等级为假设生成，不能给出发布建议', negationAware: true },
];

/** 否定标记：出现在命中词前后 20 字内，说明这句在"声称没有"，不是在声称有。 */
const NEGATION_MARKERS = ['未', '无', '没有', '不', 'null', '缺', '无法', '尚未'];

const NEGATION_WINDOW = 20;

/** 扫描一段文本，返回命中的禁用说法。 */
export function scanForbiddenClaims(text: string): Array<{ pattern: string; why: string; match: string }> {
  const hits: Array<{ pattern: string; why: string; match: string }> = [];
  for (const rule of FORBIDDEN_CLAIMS) {
    const global = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const match of text.matchAll(global)) {
      const at = match.index ?? 0;
      const window = text.slice(Math.max(0, at - NEGATION_WINDOW), at + match[0].length + NEGATION_WINDOW);
      if (rule.negationAware && NEGATION_MARKERS.some((marker) => window.includes(marker))) continue;
      hits.push({ pattern: rule.pattern.source, why: rule.why, match: match[0] });
    }
  }
  return hits;
}

export { JUDGE_DIMENSION_LABEL };
