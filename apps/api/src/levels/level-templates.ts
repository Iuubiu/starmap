/**
 * 内置关卡模板（票 66）。
 *
 * ## 模板与关卡的区别
 *
 * 关卡里写着具体的讲解与题目；模板只写着**骨架**：有哪些段、每段几张卡几道题、
 * 什么顺序、这一段为什么存在。骨架按学习者状态填成草稿（`fillLevelTemplate`），
 * 作者再往里换正文 —— 这是「先看见结构，再往里填内容」。
 *
 * 模板放在代码里而不是数据库里，理由见 `0070_level_templates.sql` 的
 * `template_id` 注释：模板要跟着代码一起版本化。代价是**模板 id 一旦发布就不再
 * 改名**（`levels.template_id` 会留下引用）。
 *
 * ## 三档差异为什么长在骨架上
 *
 * 三档不是「同一份关卡换三个数字」，而是**不同的骨架**：
 *
 * - P1（完整样例）：七段全走，含深究与进一步讲解 —— 学生还没建立直觉，需要
 *   补救分支在场。
 * - P2（补全步骤）：保留深究，去掉进一步讲解 —— 能自己从深究里爬出来。
 * - P3（直接出题）：两段补救都不要 —— 直接判定。
 *
 * 这正好是 `LevelTemplateSegment.tiers` 的意义：段在不在，由档位决定。所以
 * 三档填出来的 `steps` 段数是 7 / 6 / 5，肉眼可辨。
 *
 * `reteach` 的 `tiers` 必须是 `deepen` 的**子集**：校验器要求「进一步讲解」排在
 * 「深究」之后，没有深究的档位不能单独出现进一步讲解（`level.ts` 的
 * `validateTeachingFlow` 6.2 节）。P1 的 `['P1']` 是 `['P1','P2']` 的子集，成立。
 *
 * ## 为什么练习与复验模板不随档位变
 *
 * 它们的 `type` 是 `quiz`，只允许「判定」与「小结」两种段 —— 没有可增删的补救
 * 分支。五道练习题对 P1 和 P3 是同一份骨架，**真正随档位变的是渲染计划**
 * （`planFirstRound()` 决定从哪一段开始、卡片是全部展示还是淡出），那是运行时
 * 的事，不该把关卡结构也复制三份。硬要在 `quiz` 模板里塞档位差异，只能靠
 * 「同类型两段」，而那会让槽位键撞车（见 `expandTemplateSlots` 的注释）。
 */

import {
  expandTemplateSlots,
  LevelTemplateSchema,
  type LevelGating,
  type LevelStepKind,
  type LevelTemplate,
  type LevelTemplateSegment,
} from '@starmap/shared';

/** 段定义的入参形态：`requiredCorrect` 与 `tiers` 都给默认值，免得每段都写。 */
interface SegmentInput {
  kind: LevelStepKind;
  title: string;
  cardCount: number;
  itemCount: number;
  requiredCorrect: number;
  tiers: ('P1' | 'P2' | 'P3')[];
  purpose: string;
}

/**
 * 教学模板：七段流程的骨架，档位决定补救分支在不在。
 *
 * 题量分配的依据：简单问题 1 道（够判「有没有听懂这一段」）、判定 2 道（够判
 * 「会不会用」）、深究 1 道（够暴露具体卡点）。少于这个数量，段就变成摆设。
 */
const teachingSegments: SegmentInput[] = [
  {
    kind: 'guide',
    title: '引导',
    cardCount: 1,
    itemCount: 0,
    requiredCorrect: 0,
    tiers: ['P1', 'P2', 'P3'],
    purpose: '用一句学生认得的场景把知识点拽进来，并说清这一关要解决什么问题。',
  },
  {
    kind: 'detail',
    title: '展示细节',
    cardCount: 2,
    itemCount: 0,
    requiredCorrect: 0,
    tiers: ['P1', 'P2', 'P3'],
    purpose: '完整讲解：推导一步不漏，公式要说明适用条件，配一张图或表指向教材。',
  },
  {
    kind: 'probe',
    title: '简单问题',
    cardCount: 0,
    itemCount: 1,
    requiredCorrect: 1,
    tiers: ['P1', 'P2', 'P3'],
    purpose: '一道只考「这一段讲了什么」的题。答错说明讲解没读懂，该走深究。',
  },
  {
    kind: 'deepen',
    title: '深究',
    cardCount: 0,
    itemCount: 1,
    // 深究只做诊断，不计入掌握度 —— 校验器会强制这一条（level.ts 规则 3）
    requiredCorrect: 0,
    tiers: ['P1', 'P2'],
    purpose: '把学生具体的卡点问出来：是哪一步推不动、还是哪个前提没记住。',
  },
  {
    kind: 'reteach',
    title: '进一步讲解',
    cardCount: 1,
    itemCount: 0,
    requiredCorrect: 0,
    // 必须是 deepen 的 tiers 子集：没有深究就没有可解答的困惑
    tiers: ['P1'],
    purpose: '针对深究暴露出来的那个卡点重讲一遍，换一种讲法而不是重复原文。',
  },
  {
    kind: 'quiz',
    title: '判定',
    cardCount: 0,
    itemCount: 2,
    requiredCorrect: 1,
    tiers: ['P1', 'P2', 'P3'],
    purpose: '两道正式判定题，答案进掌握度证据序列。题目必须能溯源到教材。',
  },
  {
    kind: 'summary',
    title: '小结',
    cardCount: 0,
    itemCount: 0,
    requiredCorrect: 0,
    tiers: ['P1', 'P2', 'P3'],
    purpose: '收束这一关：本关证据、掌握度双字段、出口门控判定。',
  },
];

/**
 * 练习模板：只判定，五道题五个变式组。
 *
 * 五题的依据是票面的「每关 5–8 题」下界与「≥3 变式」门槛：5 题 5 变式，两遍
 * 作答即 10 次证据 ≥ 8，才够判「已掌握」。变式组由 `fillLevelTemplate` 按段内
 * 序号生成，互不相同。
 */
const practiceSegments: SegmentInput[] = [
  {
    kind: 'quiz',
    title: '判定',
    cardCount: 0,
    itemCount: 5,
    requiredCorrect: 3,
    tiers: ['P1', 'P2', 'P3'],
    purpose: '五道同知识点不同侧面的题，逐题判定，全部计入掌握度证据。',
  },
  {
    kind: 'summary',
    title: '小结',
    cardCount: 0,
    itemCount: 0,
    requiredCorrect: 0,
    tiers: ['P1', 'P2', 'P3'],
    purpose: '收束这一关：本关证据与掌握度双字段。',
  },
];

/**
 * 复验模板：三题起步。
 *
 * 三道是 `REVIEW_ITEMS_MIN` 的下界 —— 复验的目的不是「再考一遍」，是「隔了几天
 * 还记不记得」，题量再少就只是抽签。复验轮次的题量由后端 `selectReviewItems()`
 * 决定（3–5 题），这里给的是**关卡骨架**的下限。
 */
const reviewSegments: SegmentInput[] = [
  {
    kind: 'quiz',
    title: '判定',
    cardCount: 0,
    itemCount: 3,
    requiredCorrect: 2,
    tiers: ['P1', 'P2', 'P3'],
    purpose: '三道到期的复验题，跨变式组抽，答对推进间隔、答错回落档位。',
  },
  {
    kind: 'summary',
    title: '小结',
    cardCount: 0,
    itemCount: 0,
    requiredCorrect: 0,
    tiers: ['P1', 'P2', 'P3'],
    purpose: '收束这一轮复验：下一次到期时间与掌握度双字段。',
  },
];

/**
 * 组装一个模板。
 *
 * `segments` 与 `slots` 都过 `LevelTemplateSchema.parse()`：模板自己是一份会被
 * 前端枚举、会被存进 `levels.template_id` 的数据，写错一个字段应该在服务启动时
 * 就炸，而不是等到作者点「预览」。这里多一次 parse 的成本是一次性的。
 */
function makeTemplate(
  templateId: string,
  name: string,
  summary: string,
  type: 'teaching' | 'quiz',
  segments: SegmentInput[],
  gating: LevelGating,
): LevelTemplate {
  const parsedSegments: LevelTemplateSegment[] = segments.map((segment) => ({ ...segment }));
  return LevelTemplateSchema.parse({
    templateId,
    version: 1,
    name,
    summary,
    type,
    segments: parsedSegments,
    // 槽位是从段派生的，但必须出现在响应里 —— 前端要枚举「这一关有哪些坑」，
    // 而不是自己去数 cardCount（见 LevelTemplateSlotSchema 的注释）。
    slots: expandTemplateSlots(parsedSegments),
    gating,
  });
}

/** 三个内置模板。顺序即列表顺序：教学 → 练习 → 复验，由浅入深。 */
export const LEVEL_TEMPLATES: readonly LevelTemplate[] = [
  makeTemplate(
    'teaching',
    '教学关卡（七段）',
    '引导→展示细节→简单问题→深究→进一步讲解→判定→小结；P1 全走，P2 去掉进一步讲解，P3 只留主干。',
    'teaching',
    teachingSegments,
    // 教学关卡不设硬门：关内允许自由尝试，硬门槛只设在章末出口与高入度先修节点
    { mode: 'none', itemCount: 2, passCount: 2 },
  ),
  makeTemplate(
    'practice',
    '练习关卡（五题五变式）',
    '五道同知识点不同侧面的判定题，全部计入掌握度证据；不设讲解段。',
    'quiz',
    practiceSegments,
    { mode: 'none', itemCount: 5, passCount: 3 },
  ),
  makeTemplate(
    'review',
    '复验关卡（三题）',
    '三道跨变式组的到期复验题；答对推进间隔，答错回落档位。',
    'quiz',
    reviewSegments,
    { mode: 'none', itemCount: 3, passCount: 2 },
  ),
];

/** 按 id 找模板。找不到返回 `undefined` —— 调用方决定是 404 还是回落。 */
export function findLevelTemplate(templateId: string): LevelTemplate | undefined {
  return LEVEL_TEMPLATES.find((template) => template.templateId === templateId);
}
