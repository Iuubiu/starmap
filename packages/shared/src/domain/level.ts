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
      message: issue.message,
      code: issue.code,
    })),
  };
}
