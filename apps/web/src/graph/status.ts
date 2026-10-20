/**
 * 掌握状态的显示映射：五档引擎状态 → 四类显示桶 → 颜色 + 形状。
 *
 * ## 为什么要在前端再折一次
 *
 * 引擎（`app.mastery.state`）有**五档**：mastered / proficient / familiar /
 * attempted / unseen。票 03 要求画布上能辨**四类**：已掌握 / 在学 / 未学 /
 * 需复验。这两套词表不是一一对应（proficient 与 familiar 都归「在学」），
 * 所以必须有一层显式映射 —— 而且这层映射是**显示逻辑**，不进契约，也不该
 * 进 `packages/engine`（那是纯领域内核，掌握度的判定归它，分类展示归 UI）。
 *
 * ## 为什么「需复验」不在这里判定
 *
 * 票 07 才是复验排期的真相源（1/3/7/21/60 天），它的验收第 5 条明确禁止
 * 「图谱说有、抽考说没有」。所以这里**只读** `reviewDueAt` 与 `now` 做比较，
 * 不自己造「上次作答过了 N 天算到期」这种第二套规则。今天这个字段恒为
 * `null`（票 07 尚未落地），此时四类里「需复验」自然为空 —— 这是正确的
 * 缺席，而不是 bug。
 *
 * ## 为什么形状不是装饰
 *
 * 票 03 第 7 条：图谱状态变化必须有**非颜色**的第二编码。色觉障碍（约 8%
 * 男性）无法区分红绿，而「已掌握」与「需复验」恰恰是最需要区分的一对。
 * 形状在缩到很小、以及色盲、以及灰度打印下都还在，所以它是这里的主编码，
 * 颜色只是加强。图例也必须同时画出形状与文字，否则形状就只是无意义的球和
 * 方块。
 */
import type { GraphNode } from '../api/generated/model';

/** 引擎的五档状态（`app.mastery.state` 的 CHECK 约束）。 */
export type MasteryState = GraphNode['state'];

/** 画布上的四类。票 03 第 3 条逐个要求可辨。 */
export type DisplayStatus = 'unseen' | 'learning' | 'mastered' | 'review';

/**
 * 五档 → 四类。
 *
 * - `unseen`：没学过（没有 mastery 行，或 state 就是 unseen）
 * - `attempted` / `familiar`：做过题但没稳 → 在学
 * - `proficient` / `mastered`：稳了 → 已掌握
 *
 * `proficient` 归「已掌握」而不是「在学」：引擎的 `isMastered` 门槛是
 * `pKnown >= 0.95 && attempts >= 8`，proficient 已经过了 0.8 的证据线，
 * 在画布上把它画成「还没学会」会让 90% 的节点看起来都是未完成状态，地图
 * 失去导航价值。真正的「还没稳」由 familiar 代表。
 */
const STATUS_BY_STATE: Record<MasteryState, DisplayStatus> = {
  unseen: 'unseen',
  attempted: 'learning',
  familiar: 'learning',
  proficient: 'mastered',
  mastered: 'mastered',
};

/**
 * 一个节点现在的显示类别。
 *
 * `reviewDueAt` 已到期（`<= now`）时**覆盖**上面的一切：一个已掌握的节点
 * 到期了就该被看见并去复验，这正是票 07 抽考会抽到它的那一批。
 *
 * `now` 作为参数传入（而不是读 `Date.now()`）是为了可测 —— 否则测试只能
 * 断言「现在不是到期」，明天就跑红了。
 */
export function toDisplayStatus(node: GraphNode, now: Date): DisplayStatus {
  if (node.reviewDueAt !== null) {
    const due = new Date(node.reviewDueAt);
    // 脏数据（null 之外的非法字符串）不该把节点变成需复验，也不该抛错
    if (!Number.isNaN(due.getTime()) && due.getTime() <= now.getTime()) return 'review';
  }
  return STATUS_BY_STATE[node.state] ?? 'unseen';
}

/**
 * 四类的中文名。
 *
 * 与票面用词逐字一致（未学 / 在学 / 已掌握 / 需复验），这样验收时人对得上。
 * `aria-label` 与图例都用这一份，避免两处文案漂移。
 */
export const STATUS_LABEL: Record<DisplayStatus, string> = {
  unseen: '未学',
  learning: '在学',
  mastered: '已掌握',
  review: '需复验',
};

/**
 * 五档的中文明细。用在 `aria-label` 与详情摘要里 —— 四类太粗，念给屏幕阅读器
 * 听的时候「已掌握」不如「已熟练」有信息量。
 *
 * 这份词表沿用票 03 之前地图页就有的措辞（未学习 / 刚接触 / 已熟悉 / 已熟练 /
 * 已掌握），因为 `apps/web/e2e/smoke.spec.ts` 用 `/未学习|已熟悉|已掌握|生疏/`
 * 匹配可访问名。改词会连带改别人的测试，不值得。
 */
export const FINE_LABEL: Record<MasteryState, string> = {
  unseen: '未学习',
  attempted: '刚接触',
  familiar: '已熟悉',
  proficient: '已熟练',
  mastered: '已掌握',
};

/**
 * 四类的颜色。
 *
 * 深色画布（`#12161C`）上的选择标准是**明度差**优先于色相差**：灰度打印或
 * 单色屏下仍然能分出层级。未学用低饱和的灰蓝（不抢注意力），在学用蓝色
 * （「正在进行」的通用语义），已掌握用绿（完成），需复验用琥珀/橙（警示但
 * 不是错误 —— 它不是失败，只是到期）。
 *
 * 不用纯红：红在深色底上既刺眼又与「错误」强绑定，而复验不是错误。
 */
export const STATUS_COLOR: Record<DisplayStatus, string> = {
  unseen: '#5A6A80',
  learning: '#4C8DFF',
  mastered: '#3FBF7F',
  review: '#E8A33D',
};

/**
 * 四类的形状 —— **第二编码**，票 03 第 7 条的正面回答。
 *
 * 名字必须是 sigma 内置 SDF 形状的注册名（`circle` / `square` / `diamond` /
 * `triangle`）：传错名字时 sigma 会静默回退到第一个形状（circle），不会报错，
 * 于是「形状编码」会悄悄退化成「全是圆」而没人发现。这个映射的测试就是
 * 为了防止那种静默失败。
 *
 * 语义上的挑选理由：
 * - 未学 = 圆（中性、无方向）
 * - 在学 = 方（「进行中」的块状感，与圆形成最强烈的轮廓差）
 * - 已掌握 = 菱形（完成标记的形状，也是四者中面积最小的轮廓，视觉上「收紧」）
 * - 需复验 = 三角（唯一有尖角的形状，警示感，且在低分辨率下与圆/方区分度最高）
 */
export const STATUS_SHAPE: Record<DisplayStatus, string> = {
  unseen: 'circle',
  learning: 'square',
  mastered: 'diamond',
  review: 'triangle',
};

/** 画布上四种形状的注册顺序。sigma 用第一个作为回退，所以圆必须在前。 */
export const SHAPE_NAMES = ['circle', 'square', 'diamond', 'triangle'] as const;

/** 图例的渲染顺序：未学 → 在学 → 已掌握 → 需复验（学习的自然时间线）。 */
export const STATUS_ORDER: readonly DisplayStatus[] = ['unseen', 'learning', 'mastered', 'review'];

/**
 * 掌握度百分比的显示：`null` 时是「证据不足」而不是 `0%`。
 *
 * 这条规则从票 03 之前就存在，并被 `smoke.spec.ts` 专门断言（「证据不足的知识点
 * 显示『证据不足』而不是 0%」）。`null` 意味着**没有作答证据**，`0%` 意味着
 * 「答过，全错」—— 对学习者是完全不同的两件事，混为一谈会让人以为自己很差。
 */
export function formatPercent(percent: number | null): string {
  return percent === null ? '证据不足' : `${Math.round(percent * 100)}%`;
}

/** 一个节点的完整可访问名：`名称，五档状态，百分比或证据不足`。 */
export function nodeAccessibleLabel(node: GraphNode): string {
  const state = FINE_LABEL[node.state] ?? node.state;
  return `${node.name}，${state}，${formatPercent(node.percent)}`;
}
