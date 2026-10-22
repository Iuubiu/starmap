/**
 * 推荐理由的结构化事实 → 中文。
 *
 * # 这个文件是什么，不是什么
 *
 * 这是**整个仓库里唯一一处**把 `ReasonFact` 拼成中文的地方。服务端只返回事实
 * （`{type:'current', value:0.32}`），不返回句子：句子在服务端拼好后，前端就
 * 没法把数字加粗、没法把「解开谁」渲染成可点链接，改一个措辞还要动后端和
 * 后端测试。
 *
 * **它不是数据一致性测试的落点。** 这里测的是「给定这些事实，中文里有没有把
 * 数字原样带出来、有没有把该说的说清」；「事实里的数字是不是库里的真值」由
 * `apps/api/src/recommend/recommend.controller.test.ts` 断言（那边不 mock
 * 掌握度，直接插 attempts 回放）。两层各管一件事，别在这里重测数据源。
 *
 * # 为什么每种 kind 都自己一段话
 *
 * 票 13 验收第 2 条：理由必须是具体事实，例如「你在 A 卡住，A 依赖 B，B 你
 * 只有 32%」——不能是「根据你的学习情况」这类空话。空话的特征是**可以套在
 * 任何节点上**；具体事实的特征是换一个节点就得换一句话。所以这里不给
 * `default:` 兜底句，而是让 `kind` 的每个取值各自成形。
 *
 * # `switch` 不带 default 的原因
 *
 * 加了 `default` 之后，`ReasonKind` 将来多一个值时编译器不会报错，界面会悄悄
 * 说一句兜底话——那是「空话」重新长回来的口子。用穷尽性检查（`never`）把它
 * 变成编译错误。
 */
import type { GraphNode } from '../api/generated/model';

/**
 * 与契约 `ReasonFactSchema` 逐字对应的联合。
 *
 * 从生成的模型里取（`...FactsItem`），而不是从 `@starmap/api-contract` 引：
 * 页面这一侧用的就是生成客户端，两处各引一套会让「后端改了契约但前端没重生成」
 * 变成类型检查看不见的运行时错误。
 */
export type ReasonFact = NonNullable<
  RecommendationItem['reason']
>['facts'][number];

type RecommendationItem = NonNullable<
  import('../api/generated/model').RecommendationListResponse['recommendations']
>[number];

/** 一条理由（kind + 事实）。 */
export type Reason = RecommendationItem['reason'];

/**
 * 理由的中文片段。
 *
 * 返回**片段数组而不是一整句字符串**：调用方要知道哪一段是数字（加粗）、哪一段
 * 是可点链接（先修节点）。如果这里返回 `"你在噪声系数上卡住，它依赖共模抑制比，
 * 你只有 32%"`，调用方就只能整段加粗或者正则找数字——前者难看，后者一改措辞
 * 就崩。
 */
export type ReasonSegment =
  | { kind: 'text'; text: string }
  /** 要重点显示的数字（百分比、次数）。`text` 已格式化（含 `%` 或「次」） */
  | { kind: 'number'; text: string }
  /** 一个可点链接的微知识点 */
  | { kind: 'node'; microKpId: string; text: string };

/**
 * 百分比格式化。
 *
 * 与 `graph/status.ts` 的 `formatPercent` 分开写，因为语义不同：
 * `formatPercent(null)` 是「证据不足」（没有数据源），而理由里的百分比**一定**
 * 来自事实（有数据才进来的），这里的 null 只可能意味着事实缺失，不该显示成
 * 「证据不足」那种强语义。事实缺失时整段跳过（见下面的 `pick`）。
 */
function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 在事实里找指定类型的那条。 */
function pick<K extends ReasonFact['type']>(
  facts: readonly ReasonFact[],
  type: K,
): Extract<ReasonFact, { type: K }> | undefined {
  return facts.find((fact): fact is Extract<ReasonFact, { type: K }> => fact.type === type);
}

/**
 * 拼一条理由。
 *
 * 事实缺失时**降级而不是崩溃**：后端若因为数据不全漏了某条事实，界面应该说
 * 它能说的那部分（「你再做几次就能判断了」），而不是白屏或抛出。这与
 * 「证据不足不给 0%」同一条原则：宁可少说，不可乱说。
 */
export function renderReason(reason: Reason): ReasonSegment[] {
  const { facts } = reason;
  const current = pick(facts, 'current');
  const attempts = pick(facts, 'attempts');
  const variants = pick(facts, 'variants');
  const unblocks = pick(facts, 'unblocks');
  const prereqsSatisfied = pick(facts, 'prereqsSatisfied');
  const halfLifeDays = pick(facts, 'halfLifeDays');
  const requiredAttempts = pick(facts, 'requiredAttempts');
  const requiredVariants = pick(facts, 'requiredVariants');

  switch (reason.kind) {
    case 'review_due': {
      // 「到了该复验的时候」+ 上次的最高水平 + 半衰期。
      // 不说「你忘了」——那是推断；说「上次达到 X%，半衰期 Y 天」才是事实。
      const segments: ReasonSegment[] = [
        { kind: 'text', text: '到了该复验的时候' },
      ];
      const achieved = pick(facts, 'achieved');
      if (achieved) {
        segments.push({ kind: 'text', text: '：上次达到 ' });
        segments.push({ kind: 'number', text: percent(achieved.value) });
        segments.push({ kind: 'text', text: '，' });
      }
      if (current) {
        segments.push({ kind: 'text', text: '现在约 ' });
        segments.push({ kind: 'number', text: percent(current.value) });
      }
      if (halfLifeDays) {
        segments.push({ kind: 'text', text: `，记忆半衰期 ${Math.round(halfLifeDays.value)} 天` });
      }
      segments.push({ kind: 'text', text: '。' });
      return segments;
    }

    case 'blocked_by_prereq': {
      // 票面举的例子就是这个形状：「你在 A 卡住，A 依赖 B，B 你只有 32%」。
      const segments: ReasonSegment[] = [];
      if (unblocks) {
        segments.push({ kind: 'text', text: '你在' });
        segments.push({ kind: 'node', microKpId: unblocks.microKpId, text: unblocks.name });
        segments.push({ kind: 'text', text: '上卡住了，它依赖这里，而你在这只有 ' });
        segments.push({ kind: 'number', text: percent(unblocks.current) });
        segments.push({ kind: 'text', text: '。先把这里补上更省力' });
      } else {
        segments.push({ kind: 'text', text: '这是某个卡住的知识点的前置' });
      }
      if (current) {
        segments.push({ kind: 'text', text: '：你目前 ' });
        segments.push({ kind: 'number', text: percent(current.value) });
      }
      if (attempts && attempts.value > 0) {
        segments.push({ kind: 'text', text: `，做过 ${attempts.value} 题` });
      }
      segments.push({ kind: 'text', text: '。' });
      return segments;
    }

    case 'fading': {
      // 「学到了 X% 但衰减到 Y%」——两个数字都要，只给一个就说不出「衰减」。
      const achieved = pick(facts, 'achieved');
      const segments: ReasonSegment[] = [
        { kind: 'text', text: '曾经掌握到 ' },
      ];
      segments.push({ kind: 'number', text: achieved ? percent(achieved.value) : '较高水平' });
      segments.push({ kind: 'text', text: '，现在衰减到 ' });
      segments.push({ kind: 'number', text: current ? percent(current.value) : '更低' });
      if (halfLifeDays) {
        segments.push({ kind: 'text', text: `（半衰期 ${Math.round(halfLifeDays.value)} 天）` });
      }
      segments.push({ kind: 'text', text: '，复习一下就能捡回来。' });
      return segments;
    }

    case 'needs_evidence': {
      // 「再练几题才判断得准」：给出已做/需要的次数，让「还差多少」可算。
      const segments: ReasonSegment[] = [{ kind: 'text', text: '证据还不够判断你掌握没有：已做 ' }];
      segments.push({ kind: 'number', text: `${attempts?.value ?? 0} 题` });
      if (requiredAttempts) {
        segments.push({ kind: 'text', text: `，至少需要 ${requiredAttempts.value} 题` });
      }
      if (variants) {
        segments.push({ kind: 'text', text: `、${variants.value} 个变式` });
      }
      if (requiredVariants) {
        segments.push({ kind: 'text', text: `（要 ${requiredVariants.value} 个）` });
      }
      segments.push({ kind: 'text', text: '。再练几题就能判断。' });
      return segments;
    }

    case 'low_mastery': {
      const segments: ReasonSegment[] = [{ kind: 'text', text: '你做过 ' }];
      segments.push({ kind: 'number', text: `${attempts?.value ?? 0} 题` });
      segments.push({ kind: 'text', text: '，当前掌握度只有 ' });
      segments.push({ kind: 'number', text: current ? percent(current.value) : '很低' });
      const threshold = pick(facts, 'familiarThreshold');
      if (threshold) {
        segments.push({ kind: 'text', text: `，还没到「已熟悉」的 ${percent(threshold.value)}` });
      }
      segments.push({ kind: 'text', text: '。' });
      return segments;
    }

    case 'next_in_line': {
      // 前置都满足了：说的是「可以开始了」，不是「你必须学这个」。
      const count = prereqsSatisfied?.value ?? 0;
      if (count === 0) {
        return [{ kind: 'text', text: '这个知识点没有前置要求，可以从这里开始。' }];
      }
      return [
        { kind: 'text', text: `它的 ${count} 个前置都已达到熟悉线，可以开始学了。` },
      ];
    }
  }
}

/**
 * 把片段拼成纯文本（给 `aria-label`、测试断言、导出用）。
 *
 * 界面上要的是**分段渲染**（数字加粗、节点可点），所以不要拿这个函数的输出
 * 去 `dangerouslySetInnerHTML`——那样又把结构化信息丢回字符串了。它只服务
 * 「需要一个扁平句子」的场合。
 */
export function reasonText(reason: Reason): string {
  return renderReason(reason)
    .map((segment) => segment.text)
    .join('');
}

/** 理由的分类标题。界面把它当小标题，读屏也念得到「为什么推荐这个」。 */
export function reasonKindLabel(kind: Reason['kind']): string {
  switch (kind) {
    case 'review_due':
      return '该复验了';
    case 'blocked_by_prereq':
      return '先补前置';
    case 'fading':
      return '该复习了';
    case 'needs_evidence':
      return '再练几题';
    case 'low_mastery':
      return '还没学会';
    case 'next_in_line':
      return '可以开始';
  }
}

/**
 * 这一批推荐涉及的节点 id（去重、保持顺序）。
 *
 * 图谱页用它把推荐标到画布/清单上。它读的是**响应里的推荐列表**，不是本地
 * 再算一遍——票 13 验收第 5 条：两处的推荐必须来自同一批。
 */
export function recommendedIdsOf(
  recommendations: readonly RecommendationItem[] | undefined,
): string[] {
  if (!recommendations) return [];
  return recommendations.map((item) => item.microKpId);
}

/** 便于单测构造节点（不导出：只在本文件与测试里用）。 */
export type { GraphNode };
