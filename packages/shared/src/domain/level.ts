import { z } from 'zod';

/**
 * 关卡规范。结构不变量（校验器强制）：
 * - 每题必须同时有 explainCorrect 与 explainWrong（提交后立即反馈，故必须预写）
 * - quiz 类题目必须有 sourceRef
 * - pool 为 'practice' 的题目只能来自 AI 生成或用户自制，不能进正式判定
 */
export const LevelItemKindSchema = z.enum(['fact', 'concept', 'comprehensive']);
export type LevelItemKind = z.infer<typeof LevelItemKindSchema>;

export const LevelItemPoolSchema = z.enum(['core', 'practice']);
export type LevelItemPool = z.infer<typeof LevelItemPoolSchema>;

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

export const LevelSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    meta: z.object({
      id: z.string().min(1),
      microKpId: z.string().min(1),
      title: z.string().min(1),
      /** 水平档：同一关卡按档位渲染不同参数，不是三条课程路径 */
      tier: z.enum(['P1', 'P2', 'P3']).default('P1'),
      estimatedMinutes: z.number().int().min(1),
      author: z.enum(['system', 'teacher', 'self', 'ai']),
      /** 是否是该微知识点的入口关卡 */
      isEntry: z.boolean().default(false),
    }),
    sources: z.array(z.object({ ref: z.string(), locator: z.string().nullable() })),
    cards: z.array(LevelCardSchema),
    steps: z.array(LevelStepSchema),
    items: z.array(LevelItemSchema),
    gating: LevelGatingSchema,
  })
  /**
   * 跨字段不变量。
   *
   * 单字段校验器能保证「每题都有 explainCorrect」，但保证不了「step 引用的 item
   * 真的存在」——后者要跨两个数组看。这些不变量如果只在生成侧遵守，
   * 手写关卡和 AI 生成关卡就会各错各的；放在 schema 里就只有一个真源。
   */
  .superRefine((spec, ctx) => {
    const cardIds = new Set(spec.cards.map((c) => c.id));
    const itemById = new Map(spec.items.map((i) => [i.id, i]));

    for (const step of spec.steps) {
      for (const cardId of step.cardIds) {
        if (!cardIds.has(cardId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps'],
            message: `步骤 ${step.id} 引用了不存在的内容卡 ${cardId}`,
          });
        }
      }
      for (const itemId of step.itemIds) {
        const item = itemById.get(itemId);
        if (!item) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps'],
            message: `步骤 ${step.id} 引用了不存在的题目 ${itemId}`,
          });
          continue;
        }
        // 正式判定用的题目必须可溯源 —— 否则「为什么判我错」无法回答
        if (step.kind === 'quiz' && !item.sourceRef) {
          ctx.addIssue({
            code: 'custom',
            path: ['items'],
            message: `判定题 ${itemId} 缺少 sourceRef，无法溯源到教材`,
          });
        }
      }
    }

    // AI 生成题只进练习池，不得参与掌握度判定（spec 的硬约束）
    if (spec.meta.author === 'ai') {
      const offending = spec.items.filter((i) => i.pool !== 'practice');
      for (const item of offending) {
        ctx.addIssue({
          code: 'custom',
          path: ['items'],
          message: `AI 生成关卡里的题目 ${item.id} 必须标记 pool='practice'`,
        });
      }
    }

    if (spec.gating.passCount > spec.gating.itemCount) {
      ctx.addIssue({
        code: 'custom',
        path: ['gating'],
        message: `门控通过数 ${spec.gating.passCount} 不能超过题量 ${spec.gating.itemCount}`,
      });
    }
  });
export type LevelSpec = z.infer<typeof LevelSpecSchema>;
