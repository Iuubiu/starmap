/**
 * 面板里的三类可执行项，以及「从图谱 + 路由表拼出它们」的那一步。
 *
 * ## 三类项
 *
 * 1. **知识点**（3086 个）—— 从 `GET /api/v1/graph` 来，走 TanStack Query 的
 *    同一份缓存，不额外发请求。
 * 2. **页面**（8 个）—— 从路由表生成，见 `pages.ts`。
 * 3. **动作**（3 个）—— 只对「当前高亮的知识点」存在：打开详情 / 去地图定位 /
 *    生成关卡。它们不是全局命令，而是**选中项的操作菜单**，所以它们跟着高亮
 *    走，而不是常驻列表。
 *
 * ## 为什么动作是「跟着高亮走」而不是「先选中再展开」
 *
 * 后者要多一次按键（选中 → Enter 展开 → 再选动作 → Enter），而 Raycast 的
 * 观感恰恰是「一个列表里什么都能做」。把动作直接排在结果列表末尾，↑↓ 就能
 * 走到它们，键盘路径没有多一步。
 *
 * ## 为什么动作的落点是 URL 而不是命令对象
 *
 * 面板挂在应用根部（`App.tsx`），拿不到路由上下文里的 navigate 之外的任何
 * 东西 —— 但 `useNavigate` 是全局可用的。把落点表达成**路径**，面板就只需要
 * 「关掉自己 + navigate」，不需要知道任何页面的 props 形状。副作用是这些
 * 动作可以顺手做成可复制的链接，也便于 e2e 断言 URL。
 */

import type { GraphNode } from '../api/generated/model';
import { masteryLabel } from '../mastery/labels';
import { viewHref } from '../graph/view-state.js';
import { DEFAULT_HOPS } from '../graph/topology.js';
import type { PageAction } from './pages.js';

/** 面板里的一行。`id` 全局唯一，`aria-activedescendant` 与测试都按它定位。 */
export type PaletteItem =
  | {
      kind: 'node';
      id: string;
      /** 主文本：知识点名 */
      label: string;
      /** 副标注：所属模块 · 掌握状态 */
      hint: string;
      node: GraphNode;
    }
  | {
      kind: 'page';
      id: string;
      label: string;
      hint: string;
      path: string;
    }
  | {
      kind: 'action';
      id: string;
      label: string;
      hint: string;
      path: string;
    };

/** 分区标题。列表按这三段排，段内各自有序。 */
export type PaletteSection = 'node' | 'page' | 'action';

export const SECTION_TITLE: Record<PaletteSection, string> = {
  node: '知识点',
  page: '页面',
  action: '动作',
};

export function nodeItem(node: GraphNode): PaletteItem {
  return {
    kind: 'node',
    id: `node:${node.microKpId}`,
    label: node.name,
    hint: `${node.moduleName} · ${masteryLabel(node.state)}`,
    node,
  };
}

export function pageItem(action: PageAction): PaletteItem {
  return {
    kind: 'page',
    id: action.id,
    label: action.label,
    hint: action.hint,
    path: action.path,
  };
}

/**
 * 选中一个知识点时给出的三个动作。
 *
 * 三个落点都是**已有的**页面，不新增路由：
 * - 「打开详情」→ `/map/:microKpId`（节点详情页）
 * - 「去地图定位」→ `/map?focus=…&hops=2`（地图页自己的焦点视野，与从详情页
 *   返回时用的是同一套 URL 形状 —— 复用 `viewHref`，不另拼一份）
 * - 「生成关卡」→ `/market/generate?microKpIds=…`（生成页的预填参数，**不自动
 *   开跑**：那个页面刻意把参数当预填，见它的注释）
 */
export function nodeActions(node: GraphNode): PaletteItem[] {
  const id = node.microKpId;
  return [
    {
      kind: 'action',
      id: `action:detail:${id}`,
      label: '打开详情',
      hint: node.name,
      path: `/map/${encodeURIComponent(id)}`,
    },
    {
      kind: 'action',
      id: `action:locate:${id}`,
      label: '去地图定位',
      hint: '以该点为中心看两跳',
      path: viewHref({ focus: id, hops: DEFAULT_HOPS, mode: 'graph' }),
    },
    {
      kind: 'action',
      id: `action:generate:${id}`,
      label: '生成关卡',
      hint: '把该知识点带进生成页',
      path: `/market/generate?microKpIds=${encodeURIComponent(id)}`,
    },
  ];
}

/**
 * 空态：最近访问的 3 个知识点 + 全部页面动作。
 *
 * 最近访问的 id 可能已经不在图里（内容重导入后 id 会漂），所以这里按图过滤，
 * 而不是把历史原样显示 —— 点一个已经不存在的知识点会 404，那比「少一条快捷
 * 方式」糟得多。
 */
export function defaultItems(
  recentIds: readonly string[],
  byId: ReadonlyMap<string, GraphNode>,
  pages: readonly PageAction[],
  visible = 3,
): PaletteItem[] {
  const out: PaletteItem[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
    if (seen.has(id)) continue;
    const node = byId.get(id);
    if (node === undefined) continue;
    seen.add(id);
    out.push(nodeItem(node));
    if (out.length >= visible) break;
  }
  for (const page of pages) out.push(pageItem(page));
  return out;
}

/**
 * 按分区把已排序的结果切开，同时保留「同分时知识点优先」这件事。
 *
 * 不直接用 `fuzzyRank` 的全局排序：跨类型的分数没有可比性（一个 4 字知识点名
 * 的前缀命中会得到 798，而「知识地图」这个页面名同样前缀命中得到 795，谁在前
 * 全靠字数）。分区之后，用户在「知识点」段里找知识点、在「页面」段里找页面，
 * 段内仍然按分数排 —— 这才是可预测的。
 */
export function groupBySection(items: readonly PaletteItem[]): Array<{
  section: PaletteSection;
  title: string;
  items: PaletteItem[];
}> {
  const buckets: Record<PaletteSection, PaletteItem[]> = { node: [], page: [], action: [] };
  for (const item of items) buckets[item.kind].push(item);

  return (['node', 'page', 'action'] as const)
    .filter((section) => buckets[section].length > 0)
    .map((section) => ({ section, title: SECTION_TITLE[section], items: buckets[section] }));
}
