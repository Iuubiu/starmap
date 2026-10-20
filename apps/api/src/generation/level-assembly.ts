/**
 * 把模型返回的一段 JSON 校验并组装成一张合法的 `level.spec`。
 *
 * ## 这个文件是票 16 验收③④⑤的交汇点
 *
 *   - ③ 「每个产物过 Zod 校验，失败走 fallback」→ `parseQuestionOutput()`
 *     对模型输出做**两层**校验：先 Zod 查结构与类型，再 `validateLevelSpec()`
 *     查跨字段规则。任何一层失败都返回一个带分类的失败结果，
 *     **不抛异常** —— 抛异常会让 `.foreach` 整批失败（已实测）。
 *   - ④ 「AI 生成的关卡只进 practice 池」→ `assembleLevelSpec()` 里题目池
 *     硬编码为 `'practice'`，且 `meta.author` 硬编码为 `'ai'`。这不是「记得
 *     填 practice」，而是**没有填 core 的代码路径**。
 *   - ⑤ 「记录具体失败原因」→ 失败结果是 `{kind, message, detail}`，
 *     `kind` 是与 DB CHECK 对应的枚举，`detail` 是字段级 issues。
 *
 * ## 为什么组装骨架不交给模型
 *
 * 一张 quiz 型关卡需要：唯一 id、正确的 steps 顺序、门控数量与题量一致、
 * 每题必须有 sourceRef。这些是**关卡规范**，不是**题目内容**。让模型一次
 * 输出完整关卡，它就会时不时漏 steps 或把 gating.itemCount 写得比题量大，
 * 而这些错误与「题出得好不好」完全无关，只是把规范负担转嫁给了模型。
 */
import { z } from 'zod';
import {
  LevelSpecSchema,
  validateLevelSpec,
  type LevelSpec,
  type LevelSpecIssue,
} from '@starmap/shared';
import { checkLanguage } from './question-prompt.js';

/**
 * 模型输出的一道题。**结构校验**在这里；跨字段与业务规则在 level 校验器里。
 *
 * 注意 `answer` 只接受非负整数下标：填空题（字符串答案）不适合自动生成 ——
 * 判分要靠字符串精确匹配，模型给的答案与学习者输入的一个空格差异就会判错，
 * 而选项题的下标配对是确定的。
 */
export const GeneratedQuestionSchema = z.object({
  stem: z.string().min(1),
  options: z.array(z.string()).min(2).max(6),
  answer: z.number().int().min(0),
  explainCorrect: z.string().min(1),
  explainWrong: z.string().min(1),
  misconceptionTags: z.array(z.string()).default([]),
  sourceRef: z.string().min(1),
  hintLadder: z.array(z.string()).max(4).default([]),
});

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

/** 失败分类，与 `level_generation_task.failure_kind` 的 CHECK 一一对应 */
export type GenerationFailureKind =
  | 'llm_error'
  | 'not_json'
  | 'schema_invalid'
  | 'missing_field'
  | 'language_not_compliant'
  | 'ungrounded_source'
  | 'practice_violation'
  | 'db_error';

export type QuestionResult =
  | { ok: true; question: GeneratedQuestion }
  | {
      ok: false;
      kind: GenerationFailureKind;
      message: string;
      /** 字段级明细，成功路径没有这个字段 */
      detail?: unknown;
    };

/**
 * 把 Zod 的 issue 列表压成一句人话 + 保留原始明细。
 *
 * 分 `missing_field` 与 `schema_invalid` 两种 kind：前者「压根没给这个字段」
 * 是提示词问题，后者「给了但类型不对」是模型理解问题 —— 修法不同，报告里
 * 分开统计才有用。
 */
function describeZodFailure(error: z.ZodError): QuestionResult {
  const issues = error.issues.map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
    code: i.code,
  }));
  const missing = error.issues.filter(
    (i) => i.code === 'invalid_type' && /undefined|nonoptional/i.test(i.message),
  );
  const kind: GenerationFailureKind = missing.length > 0 ? 'missing_field' : 'schema_invalid';
  const first = issues[0];
  const head =
    missing.length > 0
      ? `缺少必填字段：${missing.map((i) => i.path.map(String).join('.')).join('、')}`
      : `字段不合法：${first ? `${first.path || '(根)'} — ${first.message}` : '未知'}`;
  return { ok: false, kind, message: `${head}（共 ${issues.length} 处）`, detail: issues };
}

/**
 * 校验模型输出并转成一道题。
 *
 * `allowedChunkIds` 用来查 `sourceRef` 是否编造 —— 这是「溯源」的实际执行点。
 * 模型很愿意编一个看起来合理的 chunkId，而播放器会用它去取教材片段；指向
 * 不存在的片段就是死链，且比缺字段更难发现（它结构完全合法）。
 */
export function parseQuestionOutput(
  raw: unknown,
  allowedChunkIds: ReadonlySet<string>,
): QuestionResult {
  const parsed = GeneratedQuestionSchema.safeParse(raw);
  if (!parsed.success) return describeZodFailure(parsed.error);

  const q = parsed.data;

  // 下标越界单独报：它结构合法（是 int 且 >= 0），但语义上是死题。
  if (q.answer >= q.options.length) {
    return {
      ok: false,
      kind: 'schema_invalid',
      message: `answer=${q.answer} 超出选项范围（共 ${q.options.length} 个选项）`,
      detail: [{ path: 'answer', message: '答案下标越界', code: 'out_of_range' }],
    };
  }

  if (!allowedChunkIds.has(q.sourceRef)) {
    return {
      ok: false,
      kind: 'ungrounded_source',
      message: `sourceRef=${q.sourceRef} 不在本次提供的教材片段里（模型编造了出处）`,
      detail: [{ path: 'sourceRef', message: '出处不存在于提供的片段中', code: 'ungrounded' }],
    };
  }

  // 语言合规逐字段查，报第一个不合规的字段并点名。
  //
  // 题干的门槛是 2 个汉字而不是 5：`A·B + A·C = A(B+C) 对吗` 是合法且自足的
  // 题干，但它只有 2 个汉字。用 5 会把这类纯公式题误判成「不是中文」——
  // 判据给错原因比不给原因更糟，排障的人会去改提示词的语言要求。
  // 题干是否「太空」是质量问题，不是语言问题，不归这个函数管。
  const languageProblems: Array<{ field: string; reason: string }> = [];
  const stemProblem = checkLanguage('stem', q.stem, 2);
  if (stemProblem) languageProblems.push({ field: 'stem', reason: stemProblem });
  // 选项**不做**语言判定：合法选项常常是单个符号（`A`、`0`、`A+B`），
  // 它们本来就不该有汉字。对选项跑 checkLanguage 会把每一道正常的题拦下。
  for (const field of ['explainCorrect', 'explainWrong'] as const) {
    const problem = checkLanguage(field, q[field], 8);
    if (problem) languageProblems.push({ field, reason: problem });
  }
  if (languageProblems.length > 0) {
    return {
      ok: false,
      kind: 'language_not_compliant',
      message: languageProblems[0]!.reason,
      detail: languageProblems.map((p) => ({
        path: p.field,
        message: p.reason,
        code: 'language',
      })),
    };
  }

  // 重复选项：两个一模一样的选项会让「答案唯一」变成假话。
  const seen = new Set<string>();
  for (const [i, opt] of q.options.entries()) {
    const key = opt.trim();
    if (seen.has(key)) {
      return {
        ok: false,
        kind: 'schema_invalid',
        message: `options.${i} 与前面的选项重复：${key.slice(0, 20)}`,
        detail: [{ path: `options.${i}`, message: '选项重复', code: 'duplicate' }],
      };
    }
    seen.add(key);
  }

  return { ok: true, question: q };
}

/** `assembleLevelSpec()` 的输入：一个知识点 + 若干已通过校验的题 */
export interface AssembleInput {
  microKpId: string;
  microKpName: string;
  questions: GeneratedQuestion[];
  /** 关卡 id 由调用方给（确定性 id，用于幂等），不由这里生成 */
  levelId: string;
  title?: string;
}

/**
 * 组装一张 quiz 型关卡。
 *
 * ## 池的归属在这里是**结构性**的
 *
 * `pool: 'practice'` 与 `meta.author: 'ai'` 是字面量，不接受参数。想产出
 * 一道 core 池的 AI 题，必须改这个文件——没有一个配置项能把它打开。
 * 这是验收④「AI 生成的关卡只进 practice 池」最实在的表达：不是运行时判断，
 * 而是根本不存在的代码路径。
 *
 * ## 为什么组装完还要再跑一次 `validateLevelSpec()`
 *
 * 因为组装本身可能出错（比如 gating.itemCount 与题量不一致）。这一步是
 * 自检：如果组装产物不合法，那是**我们的 bug** 而不是模型的错，返回的失败
 * 分类是 `schema_invalid` 且 message 会点明「组装产物不合法」。
 */
export function assembleLevelSpec(input: AssembleInput):
  | { ok: true; spec: LevelSpec }
  | { ok: false; kind: GenerationFailureKind; message: string; detail?: unknown } {
  const questions = input.questions;
  if (questions.length === 0) {
    return { ok: false, kind: 'schema_invalid', message: '没有可组装的题目' };
  }

  const items = questions.map((q, i) => ({
    id: `${input.levelId}-q${i + 1}`,
    kind: 'concept' as const,
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    variantGroup: `${input.levelId}-vg${i + 1}`,
    explainCorrect: q.explainCorrect,
    explainWrong: q.explainWrong,
    misconceptionTags: q.misconceptionTags,
    sourceRef: q.sourceRef,
    // ↓ 这一行是验收④。它是字面量，不是变量。
    pool: 'practice' as const,
    hintLadder: q.hintLadder,
  }));

  const draft = {
    schemaVersion: 1 as const,
    meta: {
      id: input.levelId,
      microKpId: input.microKpId,
      title: input.title ?? `${input.microKpName}·AI 练习`,
      // quiz 型：只允许 quiz 与 summary 步骤，正好是「一批练习 + 小结」
      type: 'quiz' as const,
      tier: 'P1' as const,
      estimatedMinutes: Math.max(3, questions.length * 2),
      // ↓ 验收④的另一半：author 是字面量 'ai'，校验器会据此强制所有题 practice
      author: 'ai' as const,
      isEntry: false,
      nextLevelId: null,
    },
    sources: [],
    cards: [],
    steps: [
      {
        id: `${input.levelId}-s-quiz`,
        kind: 'quiz' as const,
        title: '练习',
        cardIds: [],
        itemIds: items.map((it) => it.id),
        requiredCorrect: 0,
      },
      {
        id: `${input.levelId}-s-summary`,
        kind: 'summary' as const,
        title: '小结',
        cardIds: [],
        itemIds: [],
        requiredCorrect: 0,
      },
    ],
    items,
    gating: {
      // 评分门控走「退出」而非「前置」：练习题不该拦住学习者去下一节。
      mode: 'exit' as const,
      itemCount: items.length,
      // 60% 及格线向上取整，但至少 1 题
      passCount: Math.max(1, Math.ceil(items.length * 0.6)),
    },
  };

  const validated = validateLevelSpec(draft);
  if (!validated.ok) {
    return {
      ok: false,
      kind: 'schema_invalid',
      message: `组装出的关卡不合法（这是生成侧的缺陷，不是模型的错）：${validated.issues[0]?.message ?? '未知'}`,
      detail: validated.issues,
    };
  }

  // 二次确认：校验器和触发器都该同意「ai → 全 practice」。
  // 这里断言一次是为了让「校验器规则被改松」这件事在测试里立刻暴露。
  const offending = validated.spec.items.filter((it) => it.pool !== 'practice');
  if (offending.length > 0) {
    return {
      ok: false,
      kind: 'practice_violation',
      message: `组装产物中有 ${offending.length} 道题不在 practice 池`,
      detail: offending.map((it) => ({
        path: `items.${it.id}.pool`,
        message: 'AI 生成的题必须在 practice 池',
        code: 'practice_violation',
      })),
    };
  }

  return { ok: true, spec: validated.spec };
}

/**
 * 用 level 校验器检查一张由**外部**提供的 spec（比如落库前从 JSON 读回的）。
 *
 * 导出它是因为落库路径也需要「读出来的东西还能过校验」这道保障，
 * 而那条路径不该 import `assembleLevelSpec`（它不组装）。
 */
export function validateAssembled(
  spec: unknown,
): { ok: true; spec: LevelSpec } | { ok: false; kind: GenerationFailureKind; message: string; detail?: unknown } {
  const validated = validateLevelSpec(spec);
  if (validated.ok) return { ok: true, spec: validated.spec };
  return {
    ok: false,
    kind: 'schema_invalid',
    message: `落库前的关卡不合法：${validated.issues[0]?.message ?? '未知'}`,
    detail: validated.issues,
  };
}

export type { LevelSpecIssue };
export { LevelSpecSchema };
