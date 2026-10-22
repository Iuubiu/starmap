/**
 * Persona 配置的 Zod schema。
 *
 * 为什么加载时要校验而不是直接 `as Persona`：这三个 JSON 是**评估的输入**，
 * 一个字段拼错（比如把 `probeToleranceRounds` 写成 `probeTolerance`）不会
 * 报错，只会让三档人格悄悄退化成同一个 —— 那正是 NN/g 说的 mode collapse，
 * 而且从报告上完全看不出来。校验的目标是让「配置错了」比「评估结果难看」
 * 更早暴露。
 *
 * `isDesignAssumption` 相关字段是硬要求（票 20）：persona 的典型误解没有
 * 文献支撑，必须在数据里标清楚，不能只写在报告里靠人记得补。
 */

import { z } from 'zod';

const percent01 = z.number().min(0).max(1);

export const ProvenanceSchema = z.object({
  /* literal(true)：不允许某天有人把它改成 false 说「我们查过文献了」，
     除非同时改这个 schema —— 那是一次有意识的动作。 */
  isDesignAssumption: z.literal(true),
  statement: z.string().min(20),
  reviewRequired: z.string().min(10),
});

export const MisconceptionSchema = z.object({
  belief: z.string().min(4),
  whyPlausible: z.string().min(4),
  whatWouldCorrectIt: z.string().min(4),
  isDesignAssumption: z.literal(true),
});

export const IdentitySchema = z.object({
  summary: z.string().min(10),
  goal: z.string().min(4),
  motivation: z.string().min(4),
  timePressure: z.string().min(4),
});

export const PatienceSchema = z.object({
  level: z.enum(['很低', '低', '中', '中偏高', '高']),
  rule: z.string().min(6),
  maxReadableChars: z.number().int().positive(),
});

export const HelpSeekingSchema = z.object({
  level: z.enum(['很低', '低', '中', '中偏高', '高']),
  rule: z.string().min(6),
});

export const ProbeToleranceSchema = z.object({
  level: z.enum(['极低', '很低', '低', '中', '中偏高', '高']),
  /* 追问容忍轮数：被连续反问多少轮之后不再尝试。这是区分度自检三项之一，
     必须是整数，不写区间 —— 区间在报告里没法直接比。 */
  rounds: z.number().int().min(0),
  rule: z.string().min(6),
});

export const WrongAnswerHandlingSchema = z.object({ rule: z.string().min(6) });
export const StuckHandlingSchema = z.object({ rule: z.string().min(6) });

export const AbandonConditionSchema = z.object({
  rule: z.string().min(6),
  maxTurnsWithoutProgress: z.number().int().positive(),
});

export const BehaviorParamsSchema = z.object({
  patience: PatienceSchema,
  helpSeeking: HelpSeekingSchema,
  probeTolerance: ProbeToleranceSchema,
  wrongAnswerHandling: WrongAnswerHandlingSchema,
  stuckHandling: StuckHandlingSchema,
  abandonCondition: AbandonConditionSchema,
});

export const LanguageSchema = z.object({
  register: z.string().min(4),
  inputLengthChars: z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
    typical: z.number().int().positive(),
    noteOnFirstTurn: z.string().min(4),
  }),
  terminologyDensity: percent01,
  terminologyStyle: z.string().min(4),
  typos: z.string().min(2),
  examples: z.array(z.string().min(2)).min(3),
});

export const FeltScaleSchema = z.object({
  min: z.number().int(),
  max: z.number().int(),
  typical: z.tuple([z.number().int(), z.number().int()]),
});

export const OutputProtocolSchema = z.object({
  actionEnum: z.array(z.enum(['type', 'click', 'scroll', 'submit_form', 'skip', 'give_up'])).min(1),
  feltScales: z.object({
    effort: FeltScaleSchema,
    confusion: FeltScaleSchema,
    frustration: FeltScaleSchema,
  }),
  expectedArtifact: z.string().min(2),
  noteMaxChars: z.number().int().positive(),
});

export const DistinctivenessSchema = z.object({
  firstTurnLengthChars: z.number().int().positive(),
  probeToleranceRounds: z.number().int().min(0),
  terminologyDensity: percent01,
});

export const PersonaSchema = z.object({
  $schema_note: z.string().optional(),
  id: z.string().min(2),
  displayName: z.string().min(1),
  tier: z.enum(['P1', 'P2', 'P3']),
  tierLabel: z.string().min(1),
  provenance: ProvenanceSchema,
  identity: IdentitySchema,
  knownKnowledge: z.array(z.string().min(2)).min(2),
  unknownKnowledge: z.array(z.string().min(2)).min(2),
  misconceptions: z.array(MisconceptionSchema).min(3).max(5),
  behaviorParams: BehaviorParamsSchema,
  language: LanguageSchema,
  outputProtocol: OutputProtocolSchema,
  distinctiveness: DistinctivenessSchema,
});

export type Persona = z.infer<typeof PersonaSchema>;
export type Misconception = z.infer<typeof MisconceptionSchema>;
export type BehaviorParams = z.infer<typeof BehaviorParamsSchema>;

/**
 * 内部一致性检查：JSON 里同一件事存了两份（如 patience.maxReadableChars 与
 * language.inputLengthChars.max，probeTolerance.rounds 与 distinctiveness
 * 里那份），两份不一致时以哪份为准都是错的 —— 只能报错。
 *
 * 返回人类可读的问题列表，空数组表示通过。单独成函数而不是塞进 schema，
 * 是因为这些是**跨字段**约束，Zod 的 superRefine 报错信息会挤在一起，
 * 而这里希望每个问题一行、能直接抄进 issue。
 */
export function checkPersonaCoherence(persona: Persona): string[] {
  const problems: string[] = [];

  const { distinctiveness: d, behaviorParams: bp, language: lang } = persona;

  if (d.probeToleranceRounds !== bp.probeTolerance.rounds) {
    problems.push(
      `probeToleranceRounds 不一致：distinctiveness=${d.probeToleranceRounds} 而 behaviorParams.probeTolerance.rounds=${bp.probeTolerance.rounds}`,
    );
  }
  if (d.terminologyDensity !== lang.terminologyDensity) {
    problems.push(
      `terminologyDensity 不一致：distinctiveness=${d.terminologyDensity} 而 language=${lang.terminologyDensity}`,
    );
  }
  if (
    d.firstTurnLengthChars < lang.inputLengthChars.min ||
    d.firstTurnLengthChars > lang.inputLengthChars.max
  ) {
    problems.push(
      `firstTurnLengthChars=${d.firstTurnLengthChars} 落在 inputLengthChars [${lang.inputLengthChars.min}, ${lang.inputLengthChars.max}] 之外`,
    );
  }
  if (lang.inputLengthChars.min > lang.inputLengthChars.typical) {
    problems.push('inputLengthChars.min 大于 typical');
  }
  if (lang.inputLengthChars.typical > lang.inputLengthChars.max) {
    problems.push('inputLengthChars.typical 大于 max');
  }
  /* 行为规则必须写成「可执行的触发条件」，不是形容词。粗略判据：含数字或
     引号里的台词。这条不完美，但能拦住「耐心很低」这种只有形容词的写法。 */
  const ruleTexts: Array<[string, string]> = [
    ['patience.rule', bp.patience.rule],
    ['helpSeeking.rule', bp.helpSeeking.rule],
    ['probeTolerance.rule', bp.probeTolerance.rule],
    ['wrongAnswerHandling.rule', bp.wrongAnswerHandling.rule],
    ['stuckHandling.rule', bp.stuckHandling.rule],
    ['abandonCondition.rule', bp.abandonCondition.rule],
  ];
  for (const [field, text] of ruleTexts) {
    const hasNumber = /\d/.test(text);
    const hasQuote = /[「『"]/.test(text);
    if (!hasNumber && !hasQuote) {
      problems.push(`${field} 既没有数字也没有引述台词，可能写成了形容词而不是行为规则：${text}`);
    }
  }
  if (persona.misconceptions.length !== 4 && persona.misconceptions.length !== 3) {
    /* 4 条是模板给的；3 条也允许（P1 才有 4 条的空间）。多于 4 条要说明为什么，
       但 schema 已经限了上限 5，这里只提示。 */
    problems.push(`misconceptions 有 ${persona.misconceptions.length} 条，模板建议 3–4 条`);
  }

  return problems;
}
