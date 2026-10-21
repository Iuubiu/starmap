/**
 * 三档（P1/P2/P3）渲染参数的**唯一真源**（票 12）。
 *
 * ## 为什么这张表在 engine 而不是数据库或前端
 *
 * 参数要同时驱动两条链：界面（首轮形态、反馈延迟、尝试次数）与策略
 * （追问阶梯层数、单次会话新知识点上限、掌握判定）。放在前端，后端做门控
 * 与出题时读不到；放在数据库，界面上每改一个数字都要一次迁移，而且「P2 的
 * 阶梯上限是 4」这种事实会与 `probe-ladder.ts` 里的 `TIER_LADDER` 变成两份。
 *
 * 放在 engine 的第三个理由最实际：它是**纯函数包**，可以在浏览器外被穷举测试，
 * 没有 IO、没有时钟。`TIER_LADDER` 已经在这里，阶梯维度直接引用它而不是抄一遍
 * 数字——抄一遍的后果不是「多写四行」，而是某天有人只改了其中一份。
 *
 * ## 为什么 web 不直接 import 这个包
 *
 * `apps/web` 的依赖里没有 `@starmap/engine`（`GatePanel.tsx` / `MasteryMeter`
 * 都记录过这条边界，且 engine 的 `dist` 是构建产物，让 web 的单测依赖
 * 「先 build engine」会引入一个只在 CI 偶发失败的时序问题）。所以 web 通过
 * `GET /api/v1/tier` 拿这份参数的投影：单一真源仍然是本文件，web 拿到的
 * 是服务端算好的值，**禁止在 web 里再写一份硬编码表**。
 *
 * ## 四类「已知未覆盖」写在票面 Comments 里
 *
 * 「迁移题」在当前语料里没有真实数据支撑（`level_items` 的 kind 只存在于
 * `levels.spec.items[].kind`，且现有 10 道叶节点题里 comprehensive 数量极少），
 * 所以 `masteryRule.requiresTransferItem` 只做界面呈现与本地判定展示，
 * 不改变后端 BKT 的写入语义——那属于票 05 的既定规则，本票不动。
 */
import type { ProficiencyTier } from './placement.js';
import { TIER_LADDER } from './probe-ladder.js';
import type { LadderLevel } from './probe-ladder.js';

/**
 * 关卡首轮形态（spec §5 表第一行）。
 *
 * - `worked_example`：完整样例。整段讲解全摊开，学习者先照着看一遍。
 * - `completion`：补全步骤（forward fading）。讲解仍然给，但**第一段的最后
 *   一张卡只给标题**，让学习者自己补出内容再看。
 * - `direct`：直接出题。跳过纯讲解段，从第一段带题的段开始。
 */
export type FirstRoundShape = 'worked_example' | 'completion' | 'direct';

/**
 * 反馈延迟（spec §5 表第四行）。
 *
 * - `step_immediate`：步骤级即时（P1）。
 * - `step_immediate_with_summary`：步骤级即时 + 关末总结（P2）。
 * - `item_deferred_with_summary`：整题提交后延迟 + 关末总结（P3）。
 *
 * 三档**都有关末总结**，差别只在「当场看不看解析」。
 */
export type FeedbackTiming =
  | 'step_immediate'
  | 'step_immediate_with_summary'
  | 'item_deferred_with_summary';

/** 掌握判定条件（spec §5 表第六行）。三档都要迁移题，只有连对次数不同。 */
export interface TierMasteryRule {
  /** 需要连续答对几次 */
  consecutiveCorrect: number;
  /** 是否需要一道迁移题（`knowledge_kind = 'comprehensive'`） */
  requiresTransferItem: boolean;
}

/** 六维参数。字段顺序与 spec 表格一致，便于逐行对照。 */
export interface TierParams {
  tier: ProficiencyTier;
  /** ① 关卡首轮形态 */
  firstRoundShape: FirstRoundShape;
  /** ② 追问阶梯起始与上限（引用 `TIER_LADDER`，不复制数值） */
  ladder: { start: LadderLevel; cap: LadderLevel };
  /** ③ 单次会话可引入的新知识点上限 */
  sessionNewKpLimit: number;
  /** ④ 反馈延迟 */
  feedbackTiming: FeedbackTiming;
  /** ⑤ 每题尝试次数 */
  attemptsPerItem: number;
  /** ⑥ 掌握判定 */
  masteryRule: TierMasteryRule;
}

/**
 * 三档参数表。数值逐字来自 spec §5（`:272-280`）。
 *
 * `ladder` 用 `TIER_LADDER[tier]` 展开：**这是刻意的引用而不是字面量**，
 * `tier.test.ts` 有一条断言守着两者恒等，谁改了一边都会红。
 */
export const TIER_PARAMS: Record<ProficiencyTier, TierParams> = {
  P1: {
    tier: 'P1',
    firstRoundShape: 'worked_example',
    ladder: { ...TIER_LADDER.P1 },
    sessionNewKpLimit: 2,
    feedbackTiming: 'step_immediate',
    attemptsPerItem: 2,
    masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
  },
  P2: {
    tier: 'P2',
    firstRoundShape: 'completion',
    ladder: { ...TIER_LADDER.P2 },
    sessionNewKpLimit: 3,
    feedbackTiming: 'step_immediate_with_summary',
    attemptsPerItem: 2,
    masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
  },
  P3: {
    tier: 'P3',
    firstRoundShape: 'direct',
    ladder: { ...TIER_LADDER.P3 },
    sessionNewKpLimit: 4,
    feedbackTiming: 'item_deferred_with_summary',
    attemptsPerItem: 1,
    masteryRule: { consecutiveCorrect: 1, requiresTransferItem: true },
  },
};

/** 未知档位（数据库里有脏值、或旧客户端传了 'L1'）时回落到 P1，而不是抛错。 */
export function tierParams(tier: string | null | undefined): TierParams {
  if (tier === 'P1' || tier === 'P2' || tier === 'P3') return TIER_PARAMS[tier];
  return TIER_PARAMS.P1;
}

/** 三档的展示名。界面与解释文案共用，避免两处对同一档位用不同说法。 */
export const TIER_LABEL: Record<ProficiencyTier, string> = {
  P1: '完整样例',
  P2: '补全步骤',
  P3: '直接出题',
};

/** 首轮形态的中文说明，直接给学习者看。 */
export const FIRST_ROUND_DESCRIPTION: Record<FirstRoundShape, string> = {
  worked_example: '先完整看一遍样例，再自己动手。',
  completion: '讲解会留最后一步给你补，补完再看下一段。',
  direct: '直接从题目开始；需要时再展开讲解。',
};

/** 关卡规范里与首轮形态相关的部分。只声明用到的字段，避免 engine 依赖 api-contract。 */
export interface FirstRoundStepShape {
  kind: string;
  cardIds: readonly string[];
  itemIds: readonly string[];
}

/** 首轮计划：界面据此决定从哪一段开始、卡片怎么摊。 */
export interface FirstRoundPlan {
  shape: FirstRoundShape;
  /** 从第几段开始（0 基）。`direct` 会跳过前面所有纯讲解段。 */
  startStepIndex: number;
  /**
   * 卡片呈现方式。
   * - `all`：全部展开
   * - `faded`：第一段最后一张卡只给标题（forward fading）
   * - `none`：默认收起，可按需展开
   */
  cardMode: 'all' | 'faded' | 'none';
  /** 首个带卡的段的最后一张卡 id（`faded` 时要藏它的正文）；没有卡时为 null。 */
  fadedCardId: string | null;
}

/**
 * 计算首轮计划。
 *
 * 三条规则都只依赖「段的顺序与每段有什么」，不依赖卡片正文——正文是内容作者的
 * 东西，参数不该改写它（改写正文等于给不同档位看不同教材，票面第 4 条禁止）。
 */
export function planFirstRound(
  steps: readonly FirstRoundStepShape[],
  tier: string | null | undefined,
): FirstRoundPlan {
  const params = tierParams(tier);
  const firstCardStep = steps.find((step) => step.cardIds.length > 0);
  const fadedCardId = firstCardStep?.cardIds[firstCardStep.cardIds.length - 1] ?? null;

  if (params.firstRoundShape === 'worked_example') {
    return { shape: 'worked_example', startStepIndex: 0, cardMode: 'all', fadedCardId: null };
  }

  if (params.firstRoundShape === 'completion') {
    return { shape: 'completion', startStepIndex: 0, cardMode: 'faded', fadedCardId };
  }

  // direct：从第一段带题的段开始；整关都没题（纯教学关）时退回第 0 段，
  // 否则学习者会看到一个没有任何交互的空白页。
  const firstItemIndex = steps.findIndex((step) => step.itemIds.length > 0);
  return {
    shape: 'direct',
    startStepIndex: firstItemIndex === -1 ? 0 : firstItemIndex,
    cardMode: 'none',
    fadedCardId: null,
  };
}

/** 一次作答的摘要，供掌握判定使用。字段名与 `app.attempts` 的列同名。 */
export interface MasteryRuleRecord {
  correct: boolean;
  /** `knowledge_kind`；null 表示这条证据没分类（历史行）。 */
  knowledgeKind?: 'fact' | 'concept' | 'comprehensive' | null;
}

/** 掌握判定的当前进度。 */
export interface MasteryRuleProgress {
  /** 从最后一条往前数，连续答对了几次 */
  consecutiveCorrect: number;
  /** 是否已经出现过迁移题（comprehensive）的作答 */
  hasTransferItem: boolean;
  /** 按这一档的规则，当前是否满足 */
  satisfied: boolean;
  /** 还差什么（中文，直接给学习者看）；已满足时为空数组 */
  missing: string[];
}

/**
 * 按档位的掌握规则算出「这一关的证据够不够」。
 *
 * **注意**：这不改变后端 BKT 的掌握度写入判据（票 05 定的 `MASTERY_MIN_ATTEMPTS`
 * + 阈值），只回答一个学习者能看懂的问题：「按我这一档的判定条件，我现在够了没有」。
 * 两件事分开是刻意的：前者决定数据库里 `achieved` 是多少，后者决定界面上要不要
 * 说「再做一道迁移题就够」。混在一起会让 P3 学习者看到「已掌握」而 BKT 仍是 0.4。
 */
export function masteryRuleProgress(
  records: readonly MasteryRuleRecord[],
  rule: TierMasteryRule,
): MasteryRuleProgress {
  let consecutiveCorrect = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (!record || !record.correct) break;
    consecutiveCorrect += 1;
  }
  const hasTransferItem = records.some((record) => record.knowledgeKind === 'comprehensive');

  const missing: string[] = [];
  if (consecutiveCorrect < rule.consecutiveCorrect) {
    missing.push(`还要连续答对 ${rule.consecutiveCorrect - consecutiveCorrect} 次`);
  }
  if (rule.requiresTransferItem && !hasTransferItem) {
    missing.push('还要做一道迁移题');
  }

  return { consecutiveCorrect, hasTransferItem, satisfied: missing.length === 0, missing };
}

/** 是否当场显示解析（P3 的「整题提交后延迟」= 不当场显示）。 */
export function showsFeedbackImmediately(tier: string | null | undefined): boolean {
  return tierParams(tier).feedbackTiming !== 'item_deferred_with_summary';
}
