/**
 * 节点清单的按名字筛选 —— 纯函数，不碰 DOM、不碰 React。
 *
 * ## 为什么复用 `command/fuzzy.ts` 而不是另写一套
 *
 * 要的行为是「中文名 + 拼音首字母都能命中」，而拼音首字母这件事**已经实现
 * 过一遍**（`apps/web/src/command/fuzzy.ts` 的 `pinyinInitials`）：它靠
 * `Intl.Collator('zh-Hans-u-co-pinyin')` 二分出每个汉字的声母，还带按文本
 * 缓存。再写一份的代价不是那几十行，而是**两套声母表**：ICU 升级、或者哪天
 * 有人发现某个多音字归错了边界，改一处漏一处，于是命令面板搜得到、清单搜
 * 不到。所以这里 import 那个叶子模块（它不依赖任何东西，也不会与 `graph/`
 * 形成环 —— `command/items.ts` 反过来 import 的是 `graph/view-state.js` 与
 * `graph/topology.js`，与 `fuzzy.ts` 无关）。
 *
 * ## 为什么只过滤、不重排
 *
 * `fuzzyRank` 会按得分排序。清单**不能**排序：它按「模块 → 树深 → 模块内序」
 * 的主线顺序排，那是语义顺序（从上往下就是学习顺序），也是 Tab 顺序 ——
 * 见 `NodeRoster.tsx` 的说明。按得分重排会让同一次筛选的两次渲染顺序不同
 * （得分相同靠原始下标兜底，但过滤后下标已经变了），键盘用户刚摸到位置就被
 * 换走。过滤保持输入顺序，于是「筛完之后剩下的还是按学习顺序排」。
 *
 * ## 为什么不给命中的字加亮
 *
 * 命令面板会加亮（`FuzzyMatch.ranges`），清单不加。理由是这两个界面形状
 * 不同：面板是一行行「标题 + 副标题」的搜索结果，加亮是**唯一**能说明「为什
 * 么这条在结果里」的线索；清单每行有名字、状态、百分比三列，筛完通常只剩
 * 几条，命中的字本来就在眼前。而加亮要把名字拆成多个文本节点，`graph.spec.ts`
 * 有三处按 `textContent` 找清单项、`smoke.spec.ts` 按可访问名取节点名 ——
 * 为了一个看得见的次要收益去改被别处依赖的文本结构，不划算。
 */
import { fuzzyMatch } from '../command/fuzzy.js';

/** 清单里参与匹配的最小形状。`GraphNode` 满足它，测试可以传更小的对象。 */
export interface RosterSearchable {
  readonly name: string;
}

/**
 * 归一化查询串。
 *
 * 只做 `trim`：`fuzzyMatch` 自己会按空白切词元（多词是**且**关系）。这里
 * 单独抽一个函数是为了让「空查询 = 不过滤」这个判据只写一遍 —— 组件与测试
 * 都调它，而不是各自写 `query.trim().length === 0`。
 */
export function normalizeRosterQuery(query: string): string {
  return query.trim();
}

/** 查询是否为空（空 = 不过滤，清单显示全部）。 */
export function isRosterQueryEmpty(query: string): boolean {
  return normalizeRosterQuery(query).length === 0;
}

/**
 * 一个名字是否命中查询。
 *
 * 空查询恒为 `true`：空态是「显示全部」，不是「一条都不显示」。
 */
export function matchesRosterQuery(name: string, query: string): boolean {
  const normalized = normalizeRosterQuery(query);
  if (normalized.length === 0) return true;
  return fuzzyMatch({ text: name }, normalized) !== null;
}

/**
 * 过滤节点，**保持输入顺序**。
 *
 * 返回新数组（不原地改），且空查询时直接返回原数组的浅拷贝 —— 调用方可以
 * 安全地把它放进 `useMemo` 依赖里比较长度。
 */
export function filterRosterNodes<T extends RosterSearchable>(
  nodes: readonly T[],
  query: string,
): readonly T[] {
  if (isRosterQueryEmpty(query)) return nodes;
  return nodes.filter((node) => matchesRosterQuery(node.name, query));
}

/**
 * 清单顶部那行「筛选出 N 个」的文案。
 *
 * 抽成纯函数是为了让它可测（文案里的数字与「共 M 个」的关系最容易写错），
 * 也是为了让 `aria-live` 与可见文本用**同一份**字符串 —— 两处各拼一次时，
 * 读屏用户听到的和眼睛看到的迟早不一致。
 */
export function rosterSearchStatus(total: number, matched: number, query: string): string {
  if (isRosterQueryEmpty(query)) return `共 ${total} 个知识点`;
  return `筛选出 ${matched} 个，共 ${total} 个知识点`;
}
