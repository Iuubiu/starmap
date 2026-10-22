/**
 * 学习者画像契约（票 78）。归属：agent-dev。
 *
 * ## 为什么画像只有六个字段
 *
 * 这六个字段不是「能想到的背景信息」，而是**会被下游真正读取**的六个值：
 * `background`/`mathLevel` 决定讲解从哪一层起步，`goal` 决定练习偏考试还是
 * 偏工程，`weeklyHours` 决定会话新知识点上限，`explanationDensity` 决定一段
 * 讲解给几句推导，`priorCourses` 决定引用哪些先修语言。
 *
 * 字段少是刻意的：每多一个字段就多一问，而「初识」的预算是 8–12 问。宁可
 * 问得深一点，不要问得散。
 *
 * ## 为什么每个值都允许 `null`
 *
 * 票面的硬约束：学生可以跳过任意一题，**跳过项记 `null`**，不得用默认值
 * 伪装成已答。所以契约里没有「可选但有默认」的写法 —— 唯一表达「没问过」
 * 的方式就是 `null`，前端据此显示「未填写」。
 */
import { z } from 'zod';

/** 学段。 */
export const LearnerBackgroundSchema = z.enum(['undergraduate', 'graduate', 'working']);

/** 数学手感（自评，不是考试分数）。 */
export const MathLevelSchema = z.enum(['weak', 'basic', 'solid', 'strong']);

/** 当前目标。 */
export const LearningGoalSchema = z.enum(['exam', 'research', 'work']);

/** 讲解密度偏好：一句结论 / 结论+关键一步 / 完整推导。 */
export const ExplanationDensitySchema = z.enum(['concise', 'balanced', 'detailed']);

/** 画像字段名 —— PATCH 与「改单题」都按这个枚举定位字段。 */
export const ProfileFieldSchema = z.enum([
  'background',
  'mathLevel',
  'goal',
  'weeklyHours',
  'explanationDensity',
  'priorCourses',
]);
export type ProfileField = z.infer<typeof ProfileFieldSchema>;

/**
 * 画像本体。
 *
 * `priorCourses` 是 `string[] | null`：跳过时是 `null`，答了但一门课都没选是
 * `[]` —— 这两种情况含义不同（「没问」vs「问过，没有」），合并成一种会丢掉
 * 学生明确表达过的信息。
 */
export const LearnerProfileSchema = z.object({
  background: LearnerBackgroundSchema.nullable(),
  mathLevel: MathLevelSchema.nullable(),
  goal: LearningGoalSchema.nullable(),
  weeklyHours: z.number().int().min(0).max(80).nullable(),
  explanationDensity: ExplanationDensitySchema.nullable(),
  priorCourses: z.array(z.string().min(1).max(60)).nullable(),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

/** 部分更新：只提交这一题对应的那一个字段，其它字段服务端原样保留。 */
export const LearnerProfilePatchSchema = LearnerProfileSchema.partial();
export type LearnerProfilePatch = z.infer<typeof LearnerProfilePatchSchema>;

/** GET /api/v1/profile 与 PATCH 的响应。 */
export const ProfileResponseSchema = z.object({
  profile: LearnerProfileSchema,
  /** 画像最后一次写入的 ISO 时间；从没写过时为 null（而不是「现在」）。 */
  updatedAt: z.string().nullable(),
  /** 六个字段里非 null 的个数 —— 前端用它画「已答 4/6」。 */
  answeredCount: z.number().int().min(0).max(6),
});
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

/** 一个可点选项。`value` 直接写进对应字段。 */
export interface ProfileQuestionOption {
  readonly value: string;
  readonly label: string;
  /** 括号里的一句解释，帮学生理解这个选项的差别。 */
  readonly hint?: string;
}

/**
 * 一道「初识」问题。
 *
 * 注意 `field` 可以重复：`mathLevel` 与 `priorCourses` 各有两道题，第二道是
 * 深挖（「学过复变函数吗」能纠正第一道自评的偏差）。同一字段后答的覆盖先答的，
 * 所以每道题的 `value` 都必须是该字段的合法取值 —— 这一条由
 * `profile.test.ts` 对着 schema 逐题断言，防止手滑写出一个 `'P2'` 这种值。
 */
export interface ProfileQuestion {
  readonly id: string;
  readonly field: ProfileField;
  readonly prompt: string;
  /** 「为什么问这个」——一屏一问时必须给出，学生要知道这问题有什么用。 */
  readonly why: string;
  readonly options: readonly ProfileQuestionOption[];
  /** 多选（`priorCourses`）。 */
  readonly multi?: boolean;
  /** 允许「其他」自由输入。 */
  readonly allowsOther?: boolean;
}

/**
 * 十个问题：六道主干 + 四道深挖。
 *
 * 顺序即界面顺序。深挖题插在对应主干题后面，学生感觉是「顺着聊下去」，而不是
 * 答完六题又被拉回来补四题。
 */
export const PROFILE_QUESTIONS: readonly ProfileQuestion[] = [
  {
    id: 'stage',
    field: 'background',
    prompt: '你现在处在哪个阶段？',
    why: '同一个概念，给本科生讲我会用课程作业举例，给在职工程师讲会用现场调试举例。',
    options: [
      { value: 'undergraduate', label: '本科在读', hint: '有课表、有考试' },
      { value: 'graduate', label: '研究生在读', hint: '要读论文、做实验' },
      { value: 'working', label: '在职', hint: '边工作边学' },
    ],
  },
  {
    id: 'courses',
    field: 'priorCourses',
    prompt: '下面这些课，你学过哪些？（可多选）',
    why: '讲新概念时我会直接引用你学过的语言，而不是从零铺一遍。',
    multi: true,
    allowsOther: true,
    options: [
      { value: '电路分析', label: '电路分析' },
      { value: '模拟电子技术', label: '模拟电子技术' },
      { value: '数字电子技术', label: '数字电子技术' },
      { value: '信号与系统', label: '信号与系统' },
    ],
  },
  {
    id: 'recent',
    field: 'priorCourses',
    prompt: '最近在啃的内容是什么？（可多选，也可以写自己的）',
    why: '刚碰过的东西最容易被讲「通」，我会从它切入。',
    multi: true,
    allowsOther: true,
    options: [
      { value: '核电子学', label: '核电子学' },
      { value: '概率论与数理统计', label: '概率论与数理统计' },
      { value: '复变函数与积分变换', label: '复变函数与积分变换' },
    ],
  },
  {
    id: 'math',
    field: 'mathLevel',
    prompt: '遇到公式推导时，你的手感更接近哪一种？',
    why: '这决定我在推导上停在哪一层：给结论、给关键一步，还是从头推。',
    options: [
      { value: 'weak', label: '能看懂结论就够了', hint: '推导可以跳过' },
      { value: 'basic', label: '能跟着步骤走', hint: '跳步会卡住' },
      { value: 'solid', label: '能自己补上一步', hint: '偶尔需要提示' },
      { value: 'strong', label: '喜欢从定义推起', hint: '越严谨越舒服' },
    ],
  },
  {
    id: 'goal',
    field: 'goal',
    prompt: '这段时间学它，主要是为了什么？',
    why: '考试、科研、工作三条线要练的东西不一样：刷题、读文献、还是能上手搭电路。',
    options: [
      { value: 'exam', label: '应付考试 / 考研' },
      { value: 'research', label: '科研需要' },
      { value: 'work', label: '工作要用' },
    ],
  },
  {
    id: 'hours',
    field: 'weeklyHours',
    prompt: '你每周大概能投入多少小时？',
    why: '我会按这个安排一次会话推进几个知识点，排太满你完不成，排太少又拖太久。',
    options: [
      { value: '2', label: '2 小时以内', hint: '碎片时间' },
      { value: '4', label: '3–5 小时' },
      { value: '8', label: '6–10 小时' },
      { value: '12', label: '10 小时以上' },
    ],
  },
  {
    id: 'density',
    field: 'explanationDensity',
    prompt: '一段讲解里，你希望我给到多细？',
    why: '有人要一句结论就去做题，有人要看到完整推导才安心。',
    options: [
      { value: 'concise', label: '先给结论', hint: '不懂再展开' },
      { value: 'balanced', label: '结论 + 关键一步' },
      { value: 'detailed', label: '完整推导' },
    ],
  },
  {
    id: 'anything',
    field: 'priorCourses',
    prompt: '上面没列到、但你已经学过的课，还有哪些？（可留空）',
    why: '列出来我就不会从头讲；没写到的课我不猜，跳过就行。',
    allowsOther: true,
    multi: true,
    options: [
      { value: '量子力学', label: '量子力学' },
      { value: '原子物理', label: '原子物理' },
      { value: '核物理基础', label: '核物理基础' },
    ],
  },
];

/** 字段的中文名 —— 画像页与「改」按钮共用，避免两处文案漂移。 */
export const PROFILE_FIELD_LABEL: Readonly<Record<ProfileField, string>> = {
  background: '学段',
  mathLevel: '数学底子',
  goal: '学习目标',
  weeklyHours: '每周可投入',
  explanationDensity: '讲解密度',
  priorCourses: '已学 / 在学',
};

/** 枚举值的中文显示名（`null` 由调用方渲染成「未填写」）。 */
export const PROFILE_VALUE_LABEL: Readonly<Record<string, string>> = {
  undergraduate: '本科在读',
  graduate: '研究生在读',
  working: '在职',
  weak: '能看懂结论',
  basic: '能跟步骤',
  solid: '能补一步',
  strong: '能从定义推',
  exam: '应付考试 / 考研',
  research: '科研需要',
  work: '工作要用',
  concise: '先给结论',
  balanced: '结论 + 关键一步',
  detailed: '完整推导',
};
