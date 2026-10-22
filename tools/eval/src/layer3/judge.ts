/**
 * 第三层（LLM judge）的接口与 schema。**这里不接真模型**，只定契约。
 *
 * 为什么这一层必须最后跑、而且只能评主观：
 * 能算出来的东西让模型去"感觉"，等于把确定的事实换成不确定的猜测，还会
 * 让分数随模型版本漂移。所以本文件做了两件事：
 *  ① 把 judge 的输出**限制在四个主观维度**上（1–5 分），结构上一旦越界就
 *     schema 校验失败；
 *  ② 提供 `JUDGE_MUST_NOT_DECIDE` 清单，列出"永远不许交给 judge 的问题"，
 *     报告生成时对照检查。
 *
 * `agreement_with_human_kappa` 恒为 null：LLM 模拟用户的评分与真人评分之间
 * 的一致性，在本项目里**没有任何人工标注数据**。填一个数字出去，无论编的
 * 还是拿模型自洽性凑的，都是在把"未校准"伪装成"已校准"。
 */

import { z } from 'zod';

/**
 * judge 只评这四维。它们共同的特征是：没有确定答案，只能靠人（或人训出来的
 * 模型）判断"这样写对学习者够不够好"。
 *
 * 五维裁剪自 BEA 2025 的作文批改维度。刻意**不收** accuracy / correctness ——
 * 那类判断在层①里是断言，在层③里就会变成两次结果不一致的来源。
 */
export const JudgeDimensionSchema = z.enum(['actionability', 'clarity', 'tone', 'scaffolding_fit']);
export type JudgeDimension = z.infer<typeof JudgeDimensionSchema>;

export const JUDGE_DIMENSION_LABEL: Record<JudgeDimension, string> = {
  actionability: '可执行性',
  clarity: '清晰度',
  tone: '语气',
  scaffolding_fit: '脚手架贴合度',
};

export const JUDGE_DIMENSION_HINT: Record<JudgeDimension, string> = {
  actionability: '学生读完这段话，能不能立刻知道下一步做什么',
  clarity: '有没有需要回读、或需要先懂别的才能懂的句子',
  tone: '是否像一位耐心的老师，而不是评判者或客服话术',
  scaffolding_fit: '提示给多了（直接给答案）还是给少了（学生无从下手）',
};

/** 单维评分：1–5 的整数，必须带一句理由。没有理由的分数无法审计。 */
export const DimensionScoreSchema = z.object({
  dimension: JudgeDimensionSchema,
  score: z.number().int().min(1).max(5),
  rationale: z.string().min(10, '评分理由至少 10 字，否则无法审计'),
  /** 支撑该分数的界面原文片段（不是模型转述）。 */
  evidenceQuote: z.string().min(1, '必须引用界面原文，否则分数不可追溯'),
});

export const JudgeVerdictSchema = z.object({
  scores: z.array(DimensionScoreSchema).min(1),
  /** judge 认为需要人工复核的地方；空数组是合法值。 */
  needsHumanReview: z.array(z.string()).default([]),
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

/**
 * judge 的元信息。`agreement_with_human_kappa` 用 `z.null()` 锁死 ——
 * 想填数字必须同时改这个 schema，让"声称已校准"变成一次有意识的动作。
 */
export const JudgeMetaSchema = z.object({
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  /** 同一段材料评几次取中位数；轨迹里必须留痕。 */
  samples: z.number().int().min(1).default(1),
  temperature: z.number().min(0).max(2).default(0),
  agreementWithHumanKappa: z
    .null()
    .describe('恒为 null：无人工标注数据，未与真人评分做过一致性校准（κ/r/ICC/Bland-Altman 均未测）'),
});

export type JudgeMeta = z.infer<typeof JudgeMetaSchema>;

/**
 * 永远不许交给 judge 的问题。
 *
 * 每条都对应层①里的一个断言 —— 也就是说，这些问题**已经有确定答案**了，
 * 再问一遍模型只会引入噪声。当成提示词误写时的检查清单用。
 */
export const JUDGE_MUST_NOT_DECIDE: ReadonlyArray<{ question: string; deterministicHome: string }> = [
  { question: '学生这道题答对了吗', deterministicHome: '层① 判分断言：正确必判对、错误必判错' },
  { question: '掌握度是否达到门槛', deterministicHome: '层① 出口门控断言（passed/failed/undetermined 三态）' },
  { question: '证据是否足够', deterministicHome: '层① 断言 percent === null 而非 0' },
  { question: '同一个 chunk 在这个知识点下该不该放行', deterministicHome: '层① 检索门控断言（retrieval-gate 纯函数）' },
  { question: '进度是涨了还是没涨', deterministicHome: '层① 进度单调性断言（after > before，刷新后保持）' },
  { question: '这一轮泄漏答案了吗', deterministicHome: '层① 答案块命中判定（按 chunk id 比对，不靠语义相似）' },
  { question: '判分结果稳定吗', deterministicHome: '层① 同答案重放 n 次算 CV 与 Fleiss κ' },
];

/** judge 的唯一入口。实现方可以是真模型，也可以是测试里的脚本。 */
export interface Judge {
  readonly meta: JudgeMeta;
  /** 待评材料 = 界面原文 + 该回合学生说了什么。judge 不许看层①的结论。 */
  judge(input: JudgeInput): Promise<JudgeVerdict>;
}

export interface JudgeInput {
  readonly turn: number;
  readonly stage: string;
  /** 界面上的原文（学习者实际看到的字）。 */
  readonly screenText: string;
  /** 学习者这一轮的输入。 */
  readonly learnerInput: string;
  /** 只评这些维度；调用方按阶段裁剪，不要每次都全评。 */
  readonly dimensions: readonly JudgeDimension[];
}

/**
 * judge 的纪律检查：返回问题清单，空数组才算合格。
 *
 * 这不是形式主义 —— judge 一旦被问到"这题答对了吗"，它就会开始给分数，
 * 而那些分数会与层①的断言打架，最后报告里出现两个互相矛盾的结论，
 * 谁也不知道该信哪一个。
 */
export function checkJudgeDiscipline(verdict: JudgeVerdict, allowed: readonly JudgeDimension[]): string[] {
  const problems: string[] = [];
  const allowedSet = new Set(allowed);
  for (const entry of verdict.scores) {
    if (!allowedSet.has(entry.dimension)) {
      problems.push(`judge 评了本次未授权的维度「${JUDGE_DIMENSION_LABEL[entry.dimension]}」`);
    }
  }
  const seen = new Set<JudgeDimension>();
  for (const entry of verdict.scores) {
    if (seen.has(entry.dimension)) problems.push(`维度「${JUDGE_DIMENSION_LABEL[entry.dimension]}」被重复评分`);
    seen.add(entry.dimension);
  }
  return problems;
}
