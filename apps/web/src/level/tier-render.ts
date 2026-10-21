/**
 * 三档渲染参数 → 界面决策的**纯函数层**（票 12）。
 *
 * 归属泳道：agent-dev。
 *
 * ## 为什么要有这一层
 *
 * 票 12 验收 2 要的是「同一个知识点切到不同档位，首屏渲染结果不同（有测试）」。
 * 如果把「档位 → 界面」的判断散在 `LevelPage` 的 JSX 里，测试就只能靠点击
 * 去观察，而点击测不出「P3 的卡片模式是 none、P1 是 all」这类映射本身 ——
 * 它只会测出「某个按钮在不在」。所以映射先写成纯函数，页面只做接线。
 *
 * ## 硬约束：这里**不许出现任何档位常量**
 *
 * 六维参数的唯一真源是 `packages/engine/src/tier.ts` 的 `TIER_PARAMS`，经
 * `GET /api/v1/tier/levels/{id}/plan` 投影到前端。这个文件只做**形状换算**
 * （`cardMode` → 每张卡的呈现方式、`records` → 还剩几次机会），
 * 一个 `2`/`3`/`4` 都不写死。写死就会出现「engine 改了参数、界面还是老样子」
 * 而没有任何测试能发现的漂移。
 *
 * ## 没有档位参数时怎么办
 *
 * `plan` 为 `null` 表示「这次请求没拿到档位参数」（接口失败、或页面在测试里
 * 没打桩）。此时一律回落到**票 04 的原始行为**：讲解全展开、每题一次提交即
 * 锁定、反馈即时。这不是「降级」，而是「还没有档位结论时按已经验收过的那套
 * 渲染」—— 凭空猜一个档位会让学习者看到一套没人验证过的界面。
 */
import type { AnswerRecord, FlowState, LevelItem } from './flow';

/**
 * 渲染决策需要的参数子集。
 *
 * 刻意声明成结构类型而不是直接用生成的 `TierLevelPlanResponse`：
 * 测试要能只给三五个字段就构造出一份「P3 档」的输入，而不用把整个响应
 * （含 `levelId`/`microKpId`/`source`）都写一遍。生成类型是它的超集，
 * 所以真实响应可以直接传进来。
 */
export interface TierRenderPlan {
  params: {
    /** 档位名。只用于顶部徽章「按 P2 档渲染」，不参与任何映射判断。 */
    tier: 'P1' | 'P2' | 'P3';
    firstRoundShape: 'worked_example' | 'completion' | 'direct';
    ladder: { start: number; cap: number };
    sessionNewKpLimit: number;
    feedbackTiming: 'step_immediate' | 'step_immediate_with_summary' | 'item_deferred_with_summary';
    attemptsPerItem: number;
    masteryRule: { consecutiveCorrect: number; requiresTransferItem: boolean };
  };
  firstRound: {
    shape: 'worked_example' | 'completion' | 'direct';
    startStepIndex: number;
    cardMode: 'all' | 'faded' | 'none';
    fadedCardId: string | null;
  };
  masteryProgress: {
    consecutiveCorrect: number;
    hasTransferItem: boolean;
    satisfied: boolean;
    missing: string[];
  };
}

/** 一张卡的呈现方式。`faded` = forward fading 藏掉正文；`collapsed` = 默认收起。 */
export type CardPresentation = 'full' | 'faded' | 'collapsed';

/** 首轮从第几段开始。没有参数时从第 1 段（下标 0）开始。 */
export function startStepIndex(plan: TierRenderPlan | null): number {
  return plan?.firstRound.startStepIndex ?? 0;
}

/**
 * 某张卡该怎么呈现。
 *
 * `faded` 只作用于服务端点名的那一张（`fadedCardId`），其余卡照常展开 ——
 * forward fading 的语义是「**最后一步**留给你补」，不是「把讲解全藏起来」。
 * 把整关的卡都藏掉会让 P2 学习者连样例都看不到，那比 P1 更差。
 */
export function cardPresentation(cardId: string, plan: TierRenderPlan | null): CardPresentation {
  const mode = plan?.firstRound.cardMode ?? 'all';
  if (mode === 'all') return 'full';
  if (mode === 'faded') return plan?.firstRound.fadedCardId === cardId ? 'faded' : 'full';
  return 'collapsed';
}

/** 这一档每题允许提交几次。没有参数时是 1（票 04 的行为：一次提交即锁定）。 */
export function attemptsPerItem(plan: TierRenderPlan | null): number {
  return Math.max(1, plan?.params.attemptsPerItem ?? 1);
}

/**
 * 这道题还剩几次机会。
 *
 * 三种收尾都要照顾到：
 * - 没答过 → 满额；
 * - 答对了 → 0（答对就没有「再试」的理由，重答只会污染证据）；
 * - 答错过但还有次数 → 剩余次数（界面据此不锁题）。
 *
 * 「还剩几次」是从**作答记录**现算的，不是存下来的：存一个计数器就会有
 * 「刷新后计数器归零、题又可以重答」的漏洞，而记录是证据、刷新不会消失。
 */
export function attemptsLeft(
  plan: TierRenderPlan | null,
  records: readonly AnswerRecord[],
  itemId: string,
): number {
  const allowed = attemptsPerItem(plan);
  const mine = records.filter((record) => record.itemId === itemId);
  const latest = mine[mine.length - 1];
  if (!latest) return allowed;
  if (latest.correct) return 0;
  return Math.max(0, allowed - mine.length);
}

/** 这一档是不是「整题提交后统一反馈」（P3）。 */
export function defersFeedback(plan: TierRenderPlan | null): boolean {
  return plan?.params.feedbackTiming === 'item_deferred_with_summary';
}

/**
 * 掌握判定的条件，直接由参数拼出来（不是抄一句固定文案）。
 *
 * 用 `masteryRule` 的两个字段拼，而不是按档位查一张文案表：查表就是第二份
 * 真源，engine 把 P2 的 `consecutiveCorrect` 从 2 改成 3 之后，界面还会说
 * 「连对 2 次」。
 */
export function masteryRuleText(plan: TierRenderPlan | null): string {
  const rule = plan?.params.masteryRule;
  if (!rule) return '掌握判定：按服务端证据回放';
  const streak = `连对 ${rule.consecutiveCorrect} 次`;
  return rule.requiresTransferItem ? `掌握判定：${streak} + 一道迁移题` : `掌握判定：${streak}`;
}

/**
 * 距离满足判定还差什么。
 *
 * `missing` 由 engine 的 `masteryRuleProgress` 生成（中文、直接给学习者看），
 * 这里只负责把「已满足」和「还差 N 项」两种情况说清 —— 不再自己编措辞，
 * 否则同一件事会有两份中文描述。
 */
export function masteryProgressText(plan: TierRenderPlan | null): string {
  const progress = plan?.masteryProgress;
  if (!progress) return '掌握进度：等档位参数';
  if (progress.satisfied) return '按本档判定，这个知识点已经达标。';
  if (progress.missing.length === 0) {
    return `已连对 ${progress.consecutiveCorrect} 次，还差一点。`;
  }
  return `还差：${progress.missing.join('；')}。`;
}

/**
 * 档位在关卡页上的「可观察摘要」。
 *
 * 每一条都从参数**算出来**，不查标签表：这样验收 2「参数改变能被观察到」
 * 在界面上是真的能观察到的，而不只是接口返回里变了一个枚举。
 *
 * 顺序固定为「讲解形态 → 尝试次数 → 反馈时机」，因为它对应学习者这一关
 * 会依次遇到的三个问题：先看什么、错了能不能再来、什么时候知道对错。
 */
export function tierSummaryLines(plan: TierRenderPlan | null): string[] {
  if (!plan) return [];
  const lines: string[] = [];
  if (plan.firstRound.cardMode === 'all') {
    lines.push('讲解全展开');
  } else if (plan.firstRound.cardMode === 'faded') {
    lines.push('讲解留最后一步给你补');
  } else {
    lines.push('讲解默认收起，需要时展开');
  }
  lines.push(
    attemptsPerItem(plan) > 1 ? `每题最多 ${attemptsPerItem(plan)} 次` : '每题只有 1 次机会',
  );
  lines.push(defersFeedback(plan) ? '整段提交后统一给反馈' : '答完立刻给反馈');
  return lines;
}

/**
 * 本段里「要等统一反馈」的那些题的答案与解析。
 *
 * 只有 `defersFeedback` 为真时才用得上：P3 档不逐题打断，反馈攒到本段末尾
 * 一次给出。返回的每一项都带 `item`，页面据此渲染题干与解析，不必再自己
 * 从 spec 里反查（反查会让「反馈里的题」与「刚答的题」有机会不是同一道）。
 */
export interface DeferredFeedbackEntry {
  itemId: string;
  item: LevelItem;
  correct: boolean;
  choice: number | string;
}

export function deferredFeedbackFor(
  plan: TierRenderPlan | null,
  items: readonly LevelItem[],
  records: readonly AnswerRecord[],
): DeferredFeedbackEntry[] {
  if (!defersFeedback(plan)) return [];
  const entries: DeferredFeedbackEntry[] = [];
  for (const item of items) {
    const mine = records.filter((record) => record.itemId === item.id);
    const latest = mine[mine.length - 1];
    if (!latest) continue;
    entries.push({ itemId: item.id, item, correct: latest.correct, choice: latest.choice });
  }
  return entries;
}

/**
 * 首轮是不是「从中间某段开始」。
 *
 * 界面据此在顶部说明「这一档跳过了前面的讲解」—— 否则学习者会以为关卡坏了
 * （一进来就在做题，前面明明有 7 段）。
 */
export function skipsIntro(plan: TierRenderPlan | null): boolean {
  return startStepIndex(plan) > 0;
}

/** 建一份按本档首轮计划开始的流程状态。 */
export function createTierFlow(plan: TierRenderPlan | null): FlowState {
  return {
    stepIndex: startStepIndex(plan),
    choices: {},
    records: [],
    probePassed: null,
    tookRemediation: false,
    skippedStepIds: [],
    finished: false,
  };
}
