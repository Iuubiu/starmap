import { z } from 'zod';

/**
 * 关卡规范（`level.spec.json`）。
 *
 * 关卡是**内容侧产物**：手写关卡、AI 生成关卡、用户自制关卡都是同一个文件格式，
 * 因此校验规则只能有一份 —— 就在这里。生成侧（票 16）、自制侧（票 14）、
 * 播放侧（票 04）与入库侧（迁移）都调 `validateLevelSpec()`，不存在第二套规则。
 *
 * ## 结构不变量（校验器强制，全部带字段级路径）
 *
 * - 每题必须同时有 `explainCorrect` 与 `explainWrong`：提交后要**立即**反馈，
 *   不能等模型现编，所以缺一个就是内容缺陷。
 * - `quiz` 步骤引用的题目必须有 `sourceRef`：否则「为什么判我错」无法回答。
 * - `deepen`（深究）步骤的题目必须位于练习池，且 `requiredCorrect` 必须为 0：
 *   这是「未掌握分支全程不扣掌握度」的结构表达（需求 17）。
 * - 教学关卡必须按 引导→展示细节→简单问题→判定→小结 的顺序排布；
 *   深究与进一步讲解只能出现在「简单问题」之后、「判定」之前。
 * - 门控通过数不能超过题量，也不能超过关卡实际拥有的题目数。
 *
 * ## 为什么错误路径要细到下标
 *
 * 一句「校验失败」对手写关卡和 AI 生成关卡都是废信息 —— 作者不知道该改哪个
 * 数组的第几项。所有 issue 都带 `steps.2.itemIds.0` 这种路径，播放器与将来的
 * 编辑器可以直接高亮到那一个字段。
 */

export const LevelItemKindSchema = z.enum(['fact', 'concept', 'comprehensive']);
export type LevelItemKind = z.infer<typeof LevelItemKindSchema>;

export const LevelItemPoolSchema = z.enum(['core', 'practice']);
export type LevelItemPool = z.infer<typeof LevelItemPoolSchema>;

/**
 * 关卡类型。两种类型的校验规则不同，所以它是一个**必填**字段：
 * 默认成 teaching 会让「本来只想出题」的关卡收到一堆「缺引导步骤」的错误，
 * 默认成 quiz 又会把教学关卡静默降级成只判定。宁可让作者写清楚。
 */
export const LevelTypeSchema = z.enum(['teaching', 'quiz']);
export type LevelType = z.infer<typeof LevelTypeSchema>;

export const LevelItemSchema = z.object({
  id: z.string().min(1),
  kind: LevelItemKindSchema,
  stem: z.string().min(1),
  /** 单选：2–6 个选项；填空题为空数组 */
  options: z.array(z.string()).max(6),
  /** 正确选项索引；填空题存标准答案文本 */
  answer: z.union([z.number().int().min(0), z.string().min(1)]),
  /** 同 variantGroup 的题目不算新变式；平行题与原题共用同组 */
  variantGroup: z.string().min(1),
  explainCorrect: z.string().min(1),
  explainWrong: z.string().min(1),
  misconceptionTags: z.array(z.string()),
  sourceRef: z.string().nullable(),
  pool: LevelItemPoolSchema,
  hintLadder: z.array(z.string()).max(4),
});
export type LevelItem = z.infer<typeof LevelItemSchema>;

export const LevelCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** 允许 Markdown + LaTeX */
  body: z.string(),
  figureRef: z.string().nullable(),
});
export type LevelCard = z.infer<typeof LevelCardSchema>;

export const LevelStepKindSchema = z.enum(['guide', 'detail', 'probe', 'deepen', 'reteach', 'quiz', 'summary']);
export type LevelStepKind = z.infer<typeof LevelStepKindSchema>;

export const LevelStepSchema = z.object({
  id: z.string(),
  kind: LevelStepKindSchema,
  title: z.string(),
  cardIds: z.array(z.string()),
  itemIds: z.array(z.string()),
  /** 判定这一步是否算「已掌握」的题目数量门槛 */
  requiredCorrect: z.number().int().min(0).default(0),
});
export type LevelStep = z.infer<typeof LevelStepSchema>;

export const LevelGatingSchema = z.object({
  /** 出口门控只在章末与高入度先修节点启用；关内不设硬门 */
  mode: z.enum(['none', 'exit', 'prereq']),
  itemCount: z.number().int().min(1),
  passCount: z.number().int().min(1),
});
export type LevelGating = z.infer<typeof LevelGatingSchema>;

/** 步骤类型的中文名。校验错误与播放器共用同一套措辞，避免两处各叫一个名字。 */
export const LEVEL_STEP_LABEL: Record<LevelStepKind, string> = {
  guide: '引导',
  detail: '展示细节',
  probe: '简单问题',
  deepen: '深究',
  reteach: '进一步讲解',
  quiz: '判定',
  summary: '小结',
};

/** 教学关卡的必经骨架（需求 17）。深究与进一步讲解在失败分支上，不在此列。 */
const TEACHING_SPINE: readonly LevelStepKind[] = ['guide', 'detail', 'probe', 'quiz', 'summary'];

/** 卡片正文的最小长度。一句话题干不能当讲解卡 —— 这是内容量的下限，不是上限。 */
const TEACHING_CARD_MIN_BODY = 40;

/**
 * 跨字段不变量。
 *
 * 单字段校验器能保证「每题都有 explainCorrect」，但保证不了「step 引用的 item
 * 真的存在」—— 后者要跨两个数组看。这些不变量如果只在生成侧遵守，
 * 手写关卡和 AI 生成关卡就会各错各的；放在 schema 里就只有一个真源。
 *
 * 每条 issue 都带下标路径（`['steps', i, 'itemIds', j]`），错误信息里同时重复
 * 一遍人可读的位置（步骤 id / 题目 id），因为看日志的人未必拿得到 JSON。
 */
export const LevelSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    meta: z.object({
      id: z.string().min(1),
      microKpId: z.string().min(1),
      title: z.string().min(1),
      /** teaching = 教学关卡（七段流程）；quiz = 题目关卡（只判定） */
      type: LevelTypeSchema,
      /** 水平档：同一关卡按档位渲染不同参数，不是三条课程路径 */
      tier: z.enum(['P1', 'P2', 'P3']).default('P1'),
      estimatedMinutes: z.number().int().min(1),
      author: z.enum(['system', 'teacher', 'self', 'ai']),
      /** 是否是该微知识点的入口关卡 */
      isEntry: z.boolean().default(false),
      /** 小结页的「下一关」。null = 回到知识点详情，不硬编下一关的 id。 */
      nextLevelId: z.string().min(1).nullable().default(null),
    }),
    sources: z.array(z.object({ ref: z.string(), locator: z.string().nullable() })),
    cards: z.array(LevelCardSchema),
    steps: z.array(LevelStepSchema),
    items: z.array(LevelItemSchema),
    gating: LevelGatingSchema,
  })
  .superRefine((spec, ctx) => {
    const addIssue = (path: (string | number)[], message: string): void => {
      ctx.addIssue({ code: 'custom', path, message });
    };

    // ---- 1. id 唯一性：重复 id 会让「按 id 找题」静默取到第一条 ----------
    const cardIndexById = new Map<string, number>();
    spec.cards.forEach((card, i) => {
      const first = cardIndexById.get(card.id);
      if (first !== undefined) {
        addIssue(['cards', i, 'id'], `内容卡 id 重复：${card.id}（与 cards.${first} 相同）`);
      } else {
        cardIndexById.set(card.id, i);
      }
    });

    const itemIndexById = new Map<string, number>();
    spec.items.forEach((item, i) => {
      const first = itemIndexById.get(item.id);
      if (first !== undefined) {
        addIssue(['items', i, 'id'], `题目 id 重复：${item.id}（与 items.${first} 相同）`);
      } else {
        itemIndexById.set(item.id, i);
      }
    });

    const stepIds = new Set<string>();
    spec.steps.forEach((step, i) => {
      if (stepIds.has(step.id)) {
        addIssue(['steps', i, 'id'], `步骤 id 重复：${step.id}`);
      }
      stepIds.add(step.id);
    });

    // ---- 2. 每道题的答案必须落在自己的选项里 -----------------------------
    // 越界的下标在播放器里会渲染成「没有正确选项」，学生永远答不对却看不出为什么。
    spec.items.forEach((item, i) => {
      if (typeof item.answer !== 'number') return;
      if (item.options.length < 2) {
        addIssue(
          ['items', i, 'options'],
          `题目 ${item.id} 用下标作答，但只有 ${item.options.length} 个选项（选择题至少要有 2 个）`,
        );
        return;
      }
      if (item.answer >= item.options.length) {
        addIssue(
          ['items', i, 'answer'],
          `题目 ${item.id} 的正确答案下标 ${item.answer} 超出选项个数 ${item.options.length}`,
        );
      }
    });

    // ---- 3. 步骤引用必须存在，且判定题要能溯源 ---------------------------
    spec.steps.forEach((step, stepIndex) => {
      step.cardIds.forEach((cardId, cardRefIndex) => {
        if (!cardIndexById.has(cardId)) {
          addIssue(
            ['steps', stepIndex, 'cardIds', cardRefIndex],
            `步骤 ${step.id} 引用了不存在的内容卡 ${cardId}`,
          );
        }
      });

      step.itemIds.forEach((itemId, itemRefIndex) => {
        const item = spec.items[itemIndexById.get(itemId) ?? -1];
        if (!item) {
          addIssue(
            ['steps', stepIndex, 'itemIds', itemRefIndex],
            `步骤 ${step.id} 引用了不存在的题目 ${itemId}`,
          );
          return;
        }
        // 正式判定用的题目必须可溯源 —— 否则「为什么判我错」无法回答
        if (step.kind === 'quiz' && !item.sourceRef) {
          addIssue(
            ['items', itemIndexById.get(itemId)!, 'sourceRef'],
            `判定题 ${itemId} 缺少 sourceRef，无法溯源到教材`,
          );
        }
        // 深究是诊断环节，不能改变掌握度：进了练习池就证明它不参与判定
        if (step.kind === 'deepen' && item.pool !== 'practice') {
          addIssue(
            ['steps', stepIndex, 'itemIds', itemRefIndex],
            `深究步骤 ${step.id} 的题目 ${itemId} 必须位于练习池（pool='practice'），否则会让「未掌握分支不扣掌握度」失效`,
          );
        }
      });

      if (step.kind === 'deepen' && step.requiredCorrect !== 0) {
        addIssue(
          ['steps', stepIndex, 'requiredCorrect'],
          `深究步骤 ${step.id} 的 requiredCorrect 必须为 0：深究作答只做诊断，不计入掌握度`,
        );
      }

      const judgedCount = step.itemIds.length;
      if (step.requiredCorrect > judgedCount) {
        addIssue(
          ['steps', stepIndex, 'requiredCorrect'],
          `步骤 ${step.id} 要求答对 ${step.requiredCorrect} 题，但只引用了 ${judgedCount} 道题`,
        );
      }
    });

    // ---- 4. AI 生成题只进练习池，不得参与掌握度判定（spec 的硬约束）-------
    if (spec.meta.author === 'ai') {
      spec.items.forEach((item, i) => {
        if (item.pool !== 'practice') {
          addIssue(['items', i, 'pool'], `AI 生成关卡里的题目 ${item.id} 必须标记 pool='practice'`);
        }
      });
    }

    // ---- 5. 门控数字要自洽 -----------------------------------------------
    if (spec.gating.passCount > spec.gating.itemCount) {
      addIssue(
        ['gating', 'passCount'],
        `门控通过数 ${spec.gating.passCount} 不能超过题量 ${spec.gating.itemCount}`,
      );
    }
    if (spec.gating.itemCount > spec.items.length) {
      addIssue(
        ['gating', 'itemCount'],
        `门控题量 ${spec.gating.itemCount} 超过关卡总题量 ${spec.items.length}`,
      );
    }

    // ---- 6. 类型相关的流程规则 -------------------------------------------
    if (spec.meta.type === 'quiz') {
      // 题目关卡就是「只判定」：混进教学步骤说明 type 写错了，而不是关卡更丰富
      spec.steps.forEach((step, i) => {
        if (step.kind !== 'quiz' && step.kind !== 'summary') {
          addIssue(
            ['steps', i, 'kind'],
            `题目关卡不能包含「${LEVEL_STEP_LABEL[step.kind]}」步骤；要放讲解与深究请把 meta.type 改成 'teaching'`,
          );
        }
      });
      if (!spec.steps.some((s) => s.kind === 'quiz')) {
        addIssue(['steps'], '题目关卡至少要有一个「判定」步骤，否则不计任何证据');
      }
    } else {
      validateTeachingFlow(spec, addIssue);
    }
  });
export type LevelSpec = z.infer<typeof LevelSpecSchema>;

/** 教学关卡的七段流程规则（需求 17）。深究→进一步讲解是失败分支，故不强制存在。 */
function validateTeachingFlow(
  spec: LevelSpec,
  addIssue: (path: (string | number)[], message: string) => void,
): void {
  // 6.1 主干顺序：引导→展示细节→简单问题→判定→小结
  let cursor = 0;
  spec.steps.forEach((step, i) => {
    if (step.kind === 'deepen' || step.kind === 'reteach') return;
    const expected = TEACHING_SPINE[cursor];
    if (expected === undefined) return;
    if (step.kind === expected) {
      cursor += 1;
      return;
    }
    // 重复出现的同一类步骤（例如两道判定）不算错序
    if (TEACHING_SPINE.indexOf(step.kind) < cursor) return;
    addIssue(
      ['steps', i, 'kind'],
      `教学关卡的步骤顺序应为 引导→展示细节→简单问题→判定→小结；这里出现了「${LEVEL_STEP_LABEL[step.kind]}」，但「${LEVEL_STEP_LABEL[expected]}」还没出现`,
    );
  });
  const missing = TEACHING_SPINE[cursor];
  if (missing !== undefined) {
    addIssue(['steps'], `教学关卡缺少「${LEVEL_STEP_LABEL[missing]}」步骤（七段流程见 spec 需求 17）`);
  }

  // 6.2 深究与进一步讲解只能挂在失败分支上：简单问题之后、判定之前
  const probeIndex = spec.steps.findIndex((s) => s.kind === 'probe');
  const quizIndex = spec.steps.findIndex((s) => s.kind === 'quiz');
  const deepenIndex = spec.steps.findIndex((s) => s.kind === 'deepen');
  spec.steps.forEach((step, i) => {
    if (step.kind === 'deepen') {
      if (!(probeIndex >= 0 && quizIndex > i && probeIndex < i)) {
        addIssue(
          ['steps', i, 'kind'],
          '「深究」必须位于「简单问题」之后、「判定」之前 —— 它是未掌握时的补救分支',
        );
      }
    }
    if (step.kind === 'reteach') {
      if (!(deepenIndex >= 0 && i > deepenIndex)) {
        addIssue(['steps', i, 'kind'], '「进一步讲解」必须排在「深究」之后，否则深究出来的困惑没有被解答');
      }
      if (quizIndex >= 0 && i > quizIndex) {
        addIssue(['steps', i, 'kind'], '「进一步讲解」必须在「判定」之前，判定之后不该再补讲');
      }
    }
  });

  // 6.3 教学关卡必须有讲解卡，且不能是一句话卡片
  if (spec.cards.length === 0) {
    addIssue(['cards'], '教学关卡至少要有一张讲解卡，否则「展示细节」没有内容可展示');
  }
  spec.cards.forEach((card, i) => {
    if (card.body.trim().length < TEACHING_CARD_MIN_BODY) {
      addIssue(
        ['cards', i, 'body'],
        `讲解卡 ${card.id} 的正文只有 ${card.body.trim().length} 个字符，低于教学关卡的下限 ${TEACHING_CARD_MIN_BODY}：这里要放完整讲解，不是一句话卡片`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 字段级校验结果
// ---------------------------------------------------------------------------

/** 一条字段级错误。`path` 用点号连接（`steps.2.itemIds.0`），空字符串表示整个文件。 */
export interface LevelSpecIssue {
  path: string;
  message: string;
  /** Zod 的 issue code（`invalid_type` / `too_small` / `custom` …），前端按它选图标 */
  code: string;
}

export type ValidateLevelSpecResult =
  | { ok: true; spec: LevelSpec }
  | { ok: false; issues: LevelSpecIssue[] };

const ROOT_NOT_OBJECT_MESSAGE = '关卡文件必须是一个 JSON 对象（包含 schemaVersion / meta / cards / steps / items / gating）';

/** 把 Zod 的路径段拼成点号形式。数字段与字符串段一视同仁。 */
export function formatIssuePath(path: readonly (string | number | symbol)[]): string {
  return path.map((segment) => String(segment)).join('.');
}

/**
 * 点号路径 → 人能读的下标形式：`steps.1.itemIds.0` → `steps[1].itemIds[0]`。
 *
 * 校验器对外给点号（机器用，稳定、好比较），界面显示用这个。
 */
export function prettyIssuePath(dotted: string): string {
  if (dotted === '') return '（根）';
  return dotted
    .split('.')
    .reduce((acc, segment) => {
      if (/^\d+$/.test(segment)) return `${acc}[${segment}]`;
      return acc === '' ? segment : `${acc}.${segment}`;
    }, '');
}

/**
 * 校验一个 `level.spec.json`。
 *
 * 与直接 `LevelSpecSchema.safeParse` 的区别：这个函数**不抛异常**、把错误整理成
 * 带路径的扁平列表，且对「传进来的压根不是对象」给出与人话一致的提示。生成侧
 * （票 16）、自制侧（票 14）、入库侧都走这个函数，错误文案因此完全一致。
 *
 * 空输入（`undefined` / `null` / 字符串 / 数组）返回 `ok:false` 且只有一条
 * `path:''` 的 issue —— 调用方不必为「文件读出来是空的」写分支。
 */
export function validateLevelSpec(input: unknown): ValidateLevelSpecResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: '', message: ROOT_NOT_OBJECT_MESSAGE, code: 'invalid_type' }] };
  }

  const parsed = LevelSpecSchema.safeParse(input);
  if (parsed.success) return { ok: true, spec: parsed.data };

  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      // 跨字段规则的文案是我们自己写的中文（code 为 custom），原样用；
      // Zod 内置校验的文案是英文，前面补一句中文，原文留在括号里备查。
      message: issue.code === 'custom' ? issue.message : `${describeZodIssue(issue)}（原文：${issue.message}）`,
      code: issue.code,
    })),
  };
}

/**
 * Zod 内置文案是英文的（`Too small: expected string to have >=1 characters`）。
 *
 * 写关卡的是中文作者，D10 也要求全中文，所以在这一层把最常见的几种错误翻过来，
 * 再拼上原文 —— 保留原文不是偷懒：Zod 的表述精确（`>=1 characters`、`received
 * 'string'`），翻译容易丢细节，两者并置既好读又不失真。
 *
 * 只翻 Zod **内置**的几类（类型不符、长度、枚举、必填）。跨字段规则的中文文案
 * 是我们在 superRefine 里自己写的，不走这里。
 */
function describeZodIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.length > 0 ? formatIssuePath(issue.path) : '根';

  if (issue.code === 'invalid_type') {
    const expected = 'expected' in issue ? String(issue.expected) : '其他类型';
    return `字段 ${where} 应当是 ${expected} 类型。`;
  }
  if (issue.code === 'too_small') {
    if ('minimum' in issue && typeof issue.minimum === 'number') {
      return `字段 ${where} 至少要 ${issue.minimum}${'origin' in issue && issue.origin === 'string' ? ' 个字符' : ''}。`;
    }
    return `字段 ${where} 的内容太短。`;
  }
  if (issue.code === 'too_big') {
    if ('maximum' in issue && typeof issue.maximum === 'number') {
      return `字段 ${where} 最多 ${issue.maximum}${'origin' in issue && issue.origin === 'string' ? ' 个字符' : ''}。`;
    }
    return `字段 ${where} 的内容太长。`;
  }
  if (issue.code === 'invalid_value') {
    return `字段 ${where} 的取值不在允许范围内。`;
  }
  if (issue.code === 'invalid_union') {
    return `字段 ${where} 不符合任何一种允许的形态（例如答案既要能是选项下标、也要能是填空文本）。`;
  }
  return `字段 ${where} 不合法。`;
}

// ---------------------------------------------------------------------------
// 关卡模板（票 66）
// ---------------------------------------------------------------------------

/**
 * 模板是**关卡骨架**，不是关卡。
 *
 * 区别在于「谁决定内容」：关卡里的卡片正文与题目是内容作者的产物，模板只决定
 * 「有哪些段、每段几张卡几道题、什么顺序」。所以模板填出来的东西是一份**草稿**
 * （`meta.author = 'system'`），作者拿到它之后要替换掉占位正文 —— 这正是
 * 「按学习者状态填充预览」的用途：先看见结构，再往里填内容。
 *
 * ## 为什么模板也要走校验器
 *
 * 模板自己是一份数据（会被前端枚举、会存进 `levels.template_id`），但它填出来的
 * 是 `LevelSpec`。如果模板能拼出非法关卡，错误会以「播放器白屏」的形式出现在
 * 学习者面前，而不是在作者点「预览」的时候。所以 `fillLevelTemplate()` 的产物
 * 一律再过 `validateLevelSpec()`（调用方负责，见 `LevelsController#preview`）。
 */

/** 槽位装的是卡还是题。前端据此决定渲染成卡片位还是题目位。 */
export const LevelTemplateSlotKindSchema = z.enum(['card', 'item']);
export type LevelTemplateSlotKind = z.infer<typeof LevelTemplateSlotKindSchema>;

/**
 * 一段：在填出来的关卡里对应一个 `LevelStep`。
 *
 * `tiers` 决定这一段**在哪些档位出现** —— 这是三档差异的结构表达。P3 直接出题，
 * 不需要「进一步讲解」这种为补全式学习准备的段落，于是 `reteach` 的 `tiers`
 * 里没有 P3，填出来的 `steps` 就少一段。差异发生在**骨架**上，不是给同一份骨架
 * 换个数字 —— 后者会让人以为三档只是参数不同。
 */
export const LevelTemplateSegmentSchema = z.object({
  kind: LevelStepKindSchema,
  title: z.string().min(1),
  /** 这一段要几张卡。0 表示纯题目段 */
  cardCount: z.number().int().min(0),
  /** 这一段要几道题。0 表示纯讲解段 */
  itemCount: z.number().int().min(0),
  /** 与 `LevelStep.requiredCorrect` 同义；深究段必须为 0（校验器会查） */
  requiredCorrect: z.number().int().min(0).default(0),
  /** 这一段在哪些档位出现。三档都在也要显式写出来，缺省值会让「谁漏了」看不出来 */
  tiers: z.array(z.enum(['P1', 'P2', 'P3'])).min(1),
  /** 这一段为什么存在。写进模板 JSON，前端可以直接展示给作者看 */
  purpose: z.string().min(1),
});
export type LevelTemplateSegment = z.infer<typeof LevelTemplateSegmentSchema>;

/**
 * 一个槽位 = 关卡里的一个坑。
 *
 * 槽位是**派生**的（由 `expandTemplateSlots()` 从 `segments` 展开），但它必须
 * 出现在响应里：前端要枚举「这一关有哪些坑、哪些是必填」，而不是自己去数
 * `cardCount`。派生关系留在代码里，形状留在 JSON 里。
 */
export const LevelTemplateSlotSchema = z.object({
  key: z.string().min(1),
  kind: LevelTemplateSlotKindSchema,
  /** 这个槽位属于哪一段 */
  segmentKind: LevelStepKindSchema,
  /** 段内序号（0 基） */
  index: z.number().int().min(0),
  label: z.string().min(1),
  /** 必填槽位缺内容时，填出来的关卡会缺段 —— 作者不能跳过 */
  required: z.boolean(),
});
export type LevelTemplateSlot = z.infer<typeof LevelTemplateSlotSchema>;

/**
 * 模板本体。
 *
 * `version` 是**模板自己的**版本号，与导出格式的 `starmap.level/1` 无关：前者随
 * 骨架变化（加一段、改题量）而升，后者只在整个文件格式不兼容时升。两个数字
 * 混在一起会让「只是加了一段」变成一次格式迁移。
 */
export const LevelTemplateSchema = z.object({
  templateId: z.string().min(1),
  version: z.number().int().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  /** 填出来的关卡是教学型还是题目型 —— 校验规则按它分派 */
  type: LevelTypeSchema,
  segments: z.array(LevelTemplateSegmentSchema).min(1),
  slots: z.array(LevelTemplateSlotSchema).min(1),
  /** 门控预设。填出来的关卡用它，作者可以改 */
  gating: LevelGatingSchema,
});
export type LevelTemplate = z.infer<typeof LevelTemplateSchema>;

/**
 * 从段展开槽位。
 *
 * 键的形态是 `<段类型>-<序号>`：段类型在模板里唯一（同一个模板不会有两段
 * 「判定」），所以这个键既稳定又可读。真要出现同类型两段，键会撞 —— 这一点由
 * `level-template.test.ts` 守着，而不是在这里悄悄加一层去重后缀（那样前端拿到的
 * 键会变成 `quiz-1-2` 这种猜不出含义的东西）。
 */
export function expandTemplateSlots(
  segments: readonly LevelTemplateSegment[],
): LevelTemplateSlot[] {
  const slots: LevelTemplateSlot[] = [];
  for (const segment of segments) {
    for (let index = 0; index < segment.cardCount; index += 1) {
      slots.push({
        key: `${segment.kind}-card-${index}`,
        kind: 'card',
        segmentKind: segment.kind,
        index,
        label: `${segment.title}：第 ${index + 1} 张讲解卡`,
        // 每段的第一张卡必填：整段没有卡时「展示细节」就没有内容可展示
        required: index === 0,
      });
    }
    for (let index = 0; index < segment.itemCount; index += 1) {
      slots.push({
        key: `${segment.kind}-item-${index}`,
        kind: 'item',
        segmentKind: segment.kind,
        index,
        label: `${segment.title}：第 ${index + 1} 道题`,
        required: index === 0,
      });
    }
  }
  return slots;
}

/** 填充模板所需的外部输入。`cards`/`items` 给了就用真的，没给就合成占位。 */
export interface LevelTemplateFillContext {
  microKpId: string;
  microKpName: string;
  /** 缺省 P1。未知值同样回落 P1（与 `tierParams()` 的容错一致） */
  tier?: string | null;
  title?: string;
  cards?: readonly LevelCard[];
  items?: readonly LevelItem[];
  sources?: readonly { ref: string; locator: string | null }[];
}

/** 档位归一：只认 P1/P2/P3，其余回落 P1。 */
function normalizeTier(tier: string | null | undefined): 'P1' | 'P2' | 'P3' {
  return tier === 'P2' || tier === 'P3' ? tier : 'P1';
}

/** 占位讲解卡的正文。**必须 ≥ `TEACHING_CARD_MIN_BODY`**，否则教学关卡校验不过。 */
function placeholderCardBody(segment: LevelTemplateSegment, kpName: string): string {
  return (
    `这里是「${kpName}」在「${segment.title}」这一段要讲的内容（草稿占位）。` +
    `${segment.purpose}作者需要把这段话替换成真正的讲解：一段完整的推导或一个工程例子，` +
    '而不是一句结论。讲解卡里可以写公式与图文引用，播放器会按 Markdown 渲染。'
  );
}

/** 占位题目的题干。 */
function placeholderStem(segment: LevelTemplateSegment, kpName: string, index: number): string {
  return `（草稿占位）关于「${kpName}」的「${segment.title}」第 ${index + 1} 题：下面哪一项最符合本段讲的内容？`;
}

/**
 * 用模板 + 学习者状态填出一份 `LevelSpec` 草稿。
 *
 * 三条刻意的设计：
 *
 * 1. **占位内容是「能跑的」而不是空的**。空题干会让播放器渲染出空白卡片，作者
 *    看不出结构对不对；占位正文写清楚「这里该放什么」，既通过校验器（正文有下限）
 *    又提示了下一步动作。
 * 2. **`meta.author = 'system'`**。模板填出来的不是 AI 产物，不该受「AI 只能进
 *    练习池」那条约束；同时它也不是 `teacher`，因为还没有人写过。
 * 3. **深究段的题一律 `pool: 'practice'`、`requiredCorrect: 0`**。这不是可选项：
 *    「未掌握分支不扣掌握度」的结构表达就在这两处，模板必须天生满足它。
 */
export function fillLevelTemplate(
  template: LevelTemplate,
  context: LevelTemplateFillContext,
): LevelSpec {
  const tier = normalizeTier(context.tier);
  const kpName = context.microKpName;
  const specId = `${context.microKpId}--${template.templateId}--${tier}`;
  const sources = [...(context.sources ?? [])];
  if (sources.length === 0) {
    // 判定题必须有 sourceRef（校验器强制），所以草稿也要有一个可追溯的出处占位。
    sources.push({ ref: `草稿：${kpName}`, locator: null });
  }
  const firstSourceRef = sources[0]?.ref ?? null;

  const cards: LevelCard[] = [];
  const items: LevelItem[] = [];
  const steps: LevelStep[] = [];

  template.segments
    .filter((segment) => segment.tiers.includes(tier))
    .forEach((segment) => {
      const stepId = `${specId}-s-${segment.kind}`;
      const stepCardIds: string[] = [];
      const stepItemIds: string[] = [];

      for (let index = 0; index < segment.cardCount; index += 1) {
        const real = context.cards?.[cards.length];
        const cardId = `${stepId}-c${index + 1}`;
        cards.push(
          real
            ? { ...real, id: cardId }
            : {
                id: cardId,
                title: `${segment.title}：${kpName}`,
                body: placeholderCardBody(segment, kpName),
                figureRef: null,
              },
        );
        stepCardIds.push(cardId);
      }

      for (let index = 0; index < segment.itemCount; index += 1) {
        const real = context.items?.[items.length];
        const itemId = `${stepId}-q${index + 1}`;
        const pool: LevelItemPool = segment.kind === 'deepen' ? 'practice' : 'core';
        items.push(
          real
            ? { ...real, id: itemId, pool }
            : {
                id: itemId,
                kind: 'concept',
                stem: placeholderStem(segment, kpName, index),
                options: ['（占位）正确选项', '（占位）干扰项 A', '（占位）干扰项 B', '（占位）干扰项 C'],
                answer: 0,
                variantGroup: `${specId}-${segment.kind}-vg${index + 1}`,
                explainCorrect: `答对了。这一段讲的是「${segment.title}」；真正的解析要由作者写清「为什么是它」。`,
                explainWrong: `没答对。回到「${segment.title}」那张讲解卡，先找出题干问的是哪一步，再看选项。`,
                misconceptionTags: [],
                sourceRef: firstSourceRef,
                pool,
                hintLadder: [],
              },
        );
        stepItemIds.push(itemId);
      }

      steps.push({
        id: stepId,
        kind: segment.kind,
        title: segment.title,
        cardIds: stepCardIds,
        itemIds: stepItemIds,
        requiredCorrect: segment.requiredCorrect,
      });
    });

  const minutes = Math.max(1, Math.round(cards.length * 2 + items.length * 1.5));

  return {
    schemaVersion: 1,
    meta: {
      id: specId,
      microKpId: context.microKpId,
      title: context.title ?? `${kpName}（${template.name}）`,
      type: template.type,
      tier,
      estimatedMinutes: minutes,
      author: 'system',
      isEntry: false,
      nextLevelId: null,
    },
    sources,
    cards,
    steps,
    items,
    gating: { ...template.gating },
  };
}
