/**
 * 可解释推荐。纯函数，无 IO、无时钟（`now` 是显式参数）。
 *
 * ── 为什么推荐按 `current` 而不是 `achieved` 排 ──────────────────
 * `GLOSSARY.md` 已经把分工定死了：`current` 管推荐与检索门控，`achieved`
 * 管解锁与成长记录。语义上也对——「今天该学什么」问的是**现在会不会**，
 * 而「曾经会不会」不改变今天的教学起点。
 *
 * ── 为什么入参是完整快照而不是单个 `current` ──────────────────────
 * `deriveState` 里的 `attempted` 是**两个完全不同状态**的并集：
 *
 *   · 证据不足（做过 1 题，还没到 8 题 / 3 变式的门槛）
 *   · 证据够了但 `current < 0.4`（做了 20 题还是没掌握）
 *
 * 这两种人下一步该做的事相反：前者再练几题就够，后者该回头补前置。
 * 只看一个 `current` 分不出来——证据不足时它干脆是 `null`。所以理由
 * 必须带上 `attemptCount` / `variantCount` / `evidenceSufficient`。
 *
 * ── 为什么返回结构化事实而不是中文句子 ────────────────────────────
 * 句子一旦在这里拼好，前端就没法把数字加粗、没法把先修节点渲染成可点
 * 链接，改一个措辞还要动后端。所以这里只给**事实**，中文由
 * `apps/web/src/board/reason.ts` 拼。测试因此可以直接断言
 * `facts` 里的数字等于库里的值，而不是正则抠字符串。
 *
 * ── 确定性 ────────────────────────────────────────────────────────
 * 同一串输入必然得出同一个输出：无随机、无隐式时钟（`now` 显式传入）、
 * 排序的最后一个键是 `microKpId`，不存在并列。
 */

import {
  FAMILIAR_THRESHOLD,
  MASTERY_MIN_ATTEMPTS,
  MASTERY_MIN_VARIANTS,
  PROFICIENT_THRESHOLD,
} from './mastery.js';

/** 默认给几条推荐。看板一屏放得下，且三条足够覆盖「复习/补前置/学新的」三种动作 */
export const RECOMMEND_DEFAULT_LIMIT = 3;

/**
 * 「衰减了多少才算该复习」。
 *
 * 判据是 `achieved - current > FADING_DROP`，不是「current 低于某值」——
 * 后者会把「从没学会」和「学会了但忘了」混成一类，而这两者的下一步
 * 完全不同：前者要重学，后者只要复习。
 *
 * 0.25 是设计推断：`achieved 0.95 / current 0.68` 时 drop = 0.27 即触发。
 * 取 0.25 而不是更小的值，是为了避免刚衰减一点点就把「已掌握」误报成
 * 「该复习了」——那会让复习列表永远清不空。
 */
export const FADING_DROP = 0.25;

/**
 * 「卡住」的作答次数下限。
 *
 * 只是 1 次答错不叫卡住，那可能只是手滑。要连续多次尝试仍然上不去，
 * 才值得建议「回头补前置，而不是在这里硬耗」。
 */
export const STUCK_MIN_ATTEMPTS = 3;

/**
 * 推荐候选。字段是 `MasteryView` 的超集，结构兼容即可——
 * engine 不能依赖 `@starmap/api-contract`（`engine-no-apps` 边界规则），
 * 所以这里自己定义，由调用方把两边对上。
 */
export interface RecommendCandidate {
  microKpId: string;
  name: string;
  /** 历史最高后验。证据不足时为 null */
  achieved: number | null;
  /** 按半衰期衰减后的当前后验。证据不足时为 null */
  current: number | null;
  attemptCount: number;
  variantCount: number;
  evidenceSufficient: boolean;
  halfLifeDays: number;
  /** 最后一条证据的时刻，没有证据为 null */
  lastEvidenceAt: string | null;
  /**
   * 到期复验时刻。由票 07 写入，票 03 只读。
   *
   * 在票 07 落地前这里恒为 null——这不是缺陷，是「写这一列的人还没写」。
   * 推荐逻辑对它做纯日期比较，不自己发明任何到期规则：否则图谱说
   * 「该复习了」而抽考说「不用」，学生会发现系统在骗人，且查不出是哪边错。
   */
  reviewDueAt: string | null;
  /** 主线顺序的三个键，用于新知识点的稳定排序（选填，缺省时按 id 排） */
  moduleOrdinal?: number;
  depth?: number;
  ordinal?: number;
}

/** 一条先修边。`from` 是前置，`to` 是后继（同 `app.kp_edges` 的方向） */
export interface RecommendEdge {
  from: string;
  to: string;
}

/**
 * 推荐理由的种类。**每一种都对应一个学习者可据以行动的事实**，
 * 不是「根据你的学习情况」这类空话。
 */
export type ReasonKind =
  /** 到了该复验的时候（票 07 的数据） */
  | 'review_due'
  /** 你在某个节点上卡住，而它依赖的这个前置你也没掌握——先补这里更省力 */
  | 'blocked_by_prereq'
  /** 曾经掌握过，但衰减了 */
  | 'fading'
  /** 证据还不够，再做几题判断才准 */
  | 'needs_evidence'
  /** 做过题，但当前掌握度还低 */
  | 'low_mastery'
  /** 前置都满足了，可以开始学这个新知识点 */
  | 'next_in_line';

/**
 * 理由里的一条事实。
 *
 * 数值一律是**原值**（`0.32` 而不是 `'32%'`）：格式化是前端的事，图谱上
 * 保留一位小数、看板上取整，两处精度规则不同，在 engine 里定死就回不去了。
 */
export type ReasonFact =
  | { type: 'current'; value: number }
  | { type: 'achieved'; value: number }
  | { type: 'attempts'; value: number }
  | { type: 'variants'; value: number }
  /** 熟悉线，用于「低于 0.4」这类比较的语境 */
  | { type: 'familiarThreshold'; value: number }
  /** 报掌握所需的最少作答次数 */
  | { type: 'requiredAttempts'; value: number }
  /** 报掌握所需的最少变式数 */
  | { type: 'requiredVariants'; value: number }
  | { type: 'halfLifeDays'; value: number }
  /** 这个推荐会解开哪个卡住的节点 */
  | { type: 'unblocks'; microKpId: string; name: string; current: number }
  /** 这个节点有几个前置已经满足 */
  | { type: 'prereqsSatisfied'; value: number };

export interface RecommendationReason {
  kind: ReasonKind;
  facts: readonly ReasonFact[];
}

export interface Recommendation {
  microKpId: string;
  name: string;
  reason: RecommendationReason;
  /**
   * 排序分，越大越优先。对外只用于稳定排序与调试，**不建议展示给学习者**
   * ——学习者要看的是 `reason.facts` 里的数字，不是内部权重。
   */
  score: number;
}

export interface RecommendInput {
  /** 全部叶节点（含从未作答的）。非叶节点不持有掌握度，传进来会被忽略 */
  candidates: readonly RecommendCandidate[];
  /** 先修边。其它 kind 的边（related / part_of）不参与推荐 */
  edges: readonly RecommendEdge[];
  /**
   * 被用户拒绝过的推荐：`microKpId → 拒绝时刻 ISO`。
   *
   * 规则不是「拒绝一次就永远不推」——那会让用户错过一个后来确实该学的
   * 节点；也不是「换一个之后就把旧的放回来」——那会让用户觉得系统没记住
   * 他的选择。正确规则是：**拒绝的是「当前状态下的这个推荐」**，一旦这个
   * 知识点有了新证据（`lastEvidenceAt` 晚于拒绝时刻），理由就过期了，
   * 可以重新推荐。
   */
  redirects?: ReadonlyMap<string, string>;
  /** 当前时刻 ISO 8601 */
  now: string;
  limit?: number;
}

// 层级：数字越小越优先。同级内按「缺口」排，缺口大的在前。
const TIER: Record<ReasonKind, number> = {
  review_due: 0,
  blocked_by_prereq: 1,
  fading: 2,
  needs_evidence: 3,
  low_mastery: 4,
  next_in_line: 5,
};

interface Scored {
  node: RecommendCandidate;
  reason: RecommendationReason;
  tier: number;
  /** 缺口：越大表示离「够好」越远。未学过的节点没有 current，用固定值 */
  gap: number;
  score: number;
}

/** 解析 ISO 时刻，坏数据返回 NaN 而不是抛错——推荐不能因为一条脏数据整个挂掉 */
function parseTime(value: string | null): number {
  if (value === null) return Number.NaN;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.NaN;
}

/** 前置表：`to → 它的前置集合` */
function buildPrereqs(edges: readonly RecommendEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.to);
    if (list) list.push(edge.from);
    else map.set(edge.to, [edge.from]);
  }
  return map;
}

/**
 * 这个节点是否因为被拒绝过而需要排除。
 *
 * 拒绝之后**又有新证据**才解禁：状态变了，当初拒绝的理由就不成立了。
 * `lastEvidenceAt` 为 null 有两种情况，都继续排除——从没作答过（状态没变），
 * 或者数据缺失（宁可少推一次也不重复打扰）。
 */
function isRedirected(node: RecommendCandidate, redirects: ReadonlyMap<string, string>): boolean {
  const rejectedAt = redirects.get(node.microKpId);
  if (rejectedAt === undefined) return false;
  const rejected = parseTime(rejectedAt);
  if (!Number.isFinite(rejected)) return false; // 坏数据不生效，宁可多推一次
  const changed = parseTime(node.lastEvidenceAt);
  if (!Number.isFinite(changed)) return true; // 拒绝后一直没有新证据
  return changed <= rejected;
}

/** 前置是否已经「够了」：掌握了才算够，未学过 / 证据不足都不算 */
function prereqSatisfied(prereq: RecommendCandidate | undefined): boolean {
  if (!prereq) return false;
  return prereq.current !== null && prereq.current >= FAMILIAR_THRESHOLD;
}

/**
 * 算出推荐。
 *
 * 分两趟：
 *
 * 1. **先找「卡住」的节点，把它们弱的前置提升上来。** 这一步必须在前，
 *    否则那些前置会以「未学过」的身份落在最低优先级里，永远排不上来。
 * 2. **再评估其余节点。** 已经被第一趟提升过的节点跳过（它已经拿到更强的
 *    理由了）。
 *
 * 为什么要做第一趟：这是 spec 用户故事 17 的原话——「你刚在 A 卡住，
 * A 依赖 B，B 你只有 32%」。只按 `current` 排序永远说不出这句话：B 的
 * `current` 可能比别的节点还高一点，但它才是真正的瓶颈。
 */
export function recommend(input: RecommendInput): Recommendation[] {
  const limit = input.limit ?? RECOMMEND_DEFAULT_LIMIT;
  if (limit <= 0) return [];

  const byId = new Map<string, RecommendCandidate>();
  for (const node of input.candidates) byId.set(node.microKpId, node);

  const prereqsOf = buildPrereqs(input.edges);
  const redirects = input.redirects ?? new Map<string, string>();
  const now = parseTime(input.now);

  // ── 第一趟：找卡住的节点，收集它们弱的前置 ──────────────────────
  // blockedBy: 前置 id → 被它卡住的后继节点列表
  const blockedBy = new Map<string, Array<{ node: RecommendCandidate; current: number }>>();
  for (const node of input.candidates) {
    if (node.attemptCount < STUCK_MIN_ATTEMPTS) continue;
    // 证据不足时 current 为 null，说不上「卡住」——那可能只是做得太少
    if (node.current === null) continue;
    if (node.current >= PROFICIENT_THRESHOLD) continue; // 到熟练就不算卡
    for (const prereqId of prereqsOf.get(node.microKpId) ?? []) {
      const prereq = byId.get(prereqId);
      if (!prereq) continue; // 边指向了不在候选集里的节点（非叶节点），忽略
      if (prereqSatisfied(prereq)) continue; // 前置够了，不构成阻塞
      if (isRedirected(prereq, redirects)) continue;
      const list = blockedBy.get(prereqId);
      if (list) list.push({ node, current: node.current });
      else blockedBy.set(prereqId, [{ node, current: node.current }]);
    }
  }

  const scored: Scored[] = [];

  for (const node of input.candidates) {
    if (isRedirected(node, redirects)) continue;

    // ── 到期复验：优先级最高。到期了就先复习，哪怕别的节点更「欠学」──
    const dueAt = parseTime(node.reviewDueAt);
    if (Number.isFinite(dueAt) && Number.isFinite(now) && dueAt <= now) {
      const facts: ReasonFact[] = [];
      if (node.current !== null) facts.push({ type: 'current', value: node.current });
      if (node.achieved !== null) facts.push({ type: 'achieved', value: node.achieved });
      facts.push({ type: 'attempts', value: node.attemptCount });
      facts.push({ type: 'halfLifeDays', value: node.halfLifeDays });
      scored.push({
        node,
        reason: { kind: 'review_due', facts },
        tier: TIER.review_due,
        gap: 1 - (node.current ?? 0),
        score: 0,
      });
      continue;
    }

    // ── 被别的节点卡住：它自己是那个「该补的前置」 ──────────────────
    const blockers = blockedBy.get(node.microKpId);
    if (blockers && blockers.length > 0) {
      // 挑最弱的那个后继来说明「解开谁」，最弱 = current 最低
      const weakest = blockers.reduce((a, b) => (b.current < a.current ? b : a));
      const facts: ReasonFact[] = [];
      if (node.current !== null) facts.push({ type: 'current', value: node.current });
      facts.push({ type: 'attempts', value: node.attemptCount });
      facts.push({
        type: 'unblocks',
        microKpId: weakest.node.microKpId,
        name: weakest.node.name,
        current: weakest.current,
      });
      if (node.evidenceSufficient) facts.push({ type: 'familiarThreshold', value: FAMILIAR_THRESHOLD });
      scored.push({
        node,
        reason: { kind: 'blocked_by_prereq', facts },
        tier: TIER.blocked_by_prereq,
        // 缺口按「它自己多欠」+「它卡住了几个节点」一起算：卡住 3 个的前置
        // 比卡住 1 个的更值得先补
        gap: 1 - (node.current ?? 0) + 0.1 * (blockers.length - 1),
        score: 0,
      });
      continue;
    }

    // ── 曾经掌握但衰减了 ────────────────────────────────────────────
    if (
      node.current !== null &&
      node.achieved !== null &&
      node.achieved >= PROFICIENT_THRESHOLD &&
      node.achieved - node.current > FADING_DROP
    ) {
      scored.push({
        node,
        reason: {
          kind: 'fading',
          facts: [
            { type: 'current', value: node.current },
            { type: 'achieved', value: node.achieved },
            { type: 'halfLifeDays', value: node.halfLifeDays },
            { type: 'attempts', value: node.attemptCount },
          ],
        },
        tier: TIER.fading,
        gap: node.achieved - node.current,
        score: 0,
      });
      continue;
    }

    // ── 证据不足：做过题但还没到门槛 ────────────────────────────────
    if (node.attemptCount > 0 && !node.evidenceSufficient) {
      scored.push({
        node,
        reason: {
          kind: 'needs_evidence',
          facts: [
            { type: 'attempts', value: node.attemptCount },
            { type: 'variants', value: node.variantCount },
            { type: 'requiredAttempts', value: MASTERY_MIN_ATTEMPTS },
            { type: 'requiredVariants', value: MASTERY_MIN_VARIANTS },
          ],
        },
        tier: TIER.needs_evidence,
        // 离门槛越近越值得推：差 1 题就够的，比差 6 题的更该先做完
        gap: 1 - node.attemptCount / MASTERY_MIN_ATTEMPTS,
        score: 0,
      });
      continue;
    }

    // ── 做过题但掌握度仍低 ──────────────────────────────────────────
    if (node.current !== null && node.current < PROFICIENT_THRESHOLD) {
      scored.push({
        node,
        reason: {
          kind: 'low_mastery',
          facts: [
            { type: 'current', value: node.current },
            { type: 'attempts', value: node.attemptCount },
            { type: 'familiarThreshold', value: FAMILIAR_THRESHOLD },
          ],
        },
        tier: TIER.low_mastery,
        gap: 1 - node.current,
        score: 0,
      });
      continue;
    }

    // 剩下的：要么已经熟练（不该推），要么从未作答（走 next_in_line）
    if (node.attemptCount > 0) continue; // 已熟练，跳过

    // ── 从未作答：前置都满足了才可以推 ──────────────────────────────
    const prereqs = prereqsOf.get(node.microKpId) ?? [];
    if (!prereqs.every((id) => prereqSatisfied(byId.get(id)))) continue;

    scored.push({
      node,
      reason: {
        kind: 'next_in_line',
        facts: [{ type: 'prereqsSatisfied', value: prereqs.length }],
      },
      tier: TIER.next_in_line,
      // 新知识点没有「缺口」可比，统一按主线顺序排（见 compare 的最后几级）
      gap: 0,
      score: 0,
    });
  }

  for (const item of scored) {
    // score 只用于排序与调试。层级权重必须远大于缺口（缺口最大为 1），
    // 否则「缺口大」会越过「层级高」，那就等于没分层
    item.score = (6 - item.tier) * 100 + Math.round(item.gap * 100) / 100;
  }

  scored.sort(compareScored);

  return scored.slice(0, limit).map((item) => ({
    microKpId: item.node.microKpId,
    name: item.node.name,
    reason: item.reason,
    score: item.score,
  }));
}

/**
 * 全序比较。**最后一级必须是 id**，否则同一份数据在不同 V8 版本、不同
 * 插入顺序下会给出不同顺序——那会让「同一串作答输入输出确定可重复」
 * （票 05 验收第 7 条）在推荐这一层失效。
 */
function compareScored(a: Scored, b: Scored): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.gap !== b.gap) return b.gap - a.gap;
  // 新知识点按主线顺序：模块序号 → 深度 → 章内序号
  const am = a.node.moduleOrdinal ?? Number.MAX_SAFE_INTEGER;
  const bm = b.node.moduleOrdinal ?? Number.MAX_SAFE_INTEGER;
  if (am !== bm) return am - bm;
  const ad = a.node.depth ?? Number.MAX_SAFE_INTEGER;
  const bd = b.node.depth ?? Number.MAX_SAFE_INTEGER;
  if (ad !== bd) return ad - bd;
  const ao = a.node.ordinal ?? Number.MAX_SAFE_INTEGER;
  const bo = b.node.ordinal ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.node.microKpId < b.node.microKpId ? -1 : a.node.microKpId > b.node.microKpId ? 1 : 0;
}
