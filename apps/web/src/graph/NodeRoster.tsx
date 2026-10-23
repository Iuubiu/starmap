/**
 * 节点清单：图谱的**等价文本替代**，也是键盘与读屏用户的唯一入口。
 *
 * ## 为什么这不是「多余的列表」
 *
 * canvas 对辅助技术不可见。WCAG 1.1.1 要求的不是「给 canvas 加个 aria-label」
 * 就算完，而是要有**承载相同信息与操作**的等价内容。这个清单就是它：每个
 * 可见微知识点一个真按钮，可访问名是「名称，状态，百分比」，Tab 逐个聚焦、
 * Enter 进入关卡。
 *
 * 顺带解决了件实际的事：`apps/web/e2e/smoke.spec.ts` 从票 02 起就在 `/map`
 * 上找 `role=button` + 形如「名，状态，66%」的可访问名。这个清单让那些断言
 * 继续成立，而不是逼着别人去改测试。
 *
 * ## 为什么按主线顺序而不是画布位置
 *
 * 按画布坐标排会让 Tab 在图上左右横跳（上、下、左、右、又回上），读屏用户
 * 完全建立不了「我在哪」的空间感。按线性主线（模块 → 树深 → 模块内序）排
 * 是**语义顺序**：从上往下就是学习顺序，而且与「线性主线视图」一致 ——
 * 两种视图下同一个节点的位置关系不变，切换时不会迷失。
 *
 * ## 为什么分批渲染
 *
 * 2000 个按钮 ≈ 14000 个 DOM 节点，一次性挂载在主线程上要 3 秒以上 —— 实测
 * 在 Playwright 的 Chromium 里是 3.6s 的单个长任务，比同步力导向还糟，恰好
 * 撞在票 03 第 1 条「拖动缩放仍可交互」上。所以清单默认只渲染头 `ROSTER_PAGE`
 * 条，其余用「继续显示」按钮按批展开：全部节点仍然可达（等价替代的完整性不
 * 打折），但首屏 DOM 成本有上限。167 个真实叶节点全部落在首批内，行为与不分
 * 批完全一致。
 *
 * ## 推荐标记（票 13 验收第 5 条）
 *
 * 看板推荐的节点在地图上也要能认出来，否则「两处指向同一批」只对得上接口、
 * 对不上眼睛。标记分两条通道：
 *
 * - 视觉：名字后面一个「推荐」小徽标（`.graph-roster-rec`）；
 * - 语义：`data-recommended="true"` 供测试与样式钩取，另有 `aria-describedby`
 *   指向一段隐藏说明「系统推荐」——读屏用户听到的是完整的「名称，状态，66%，
 *   系统推荐」。
 *
 * **推荐标记绝不进 `aria-label`。** 那个字符串的格式（`名称，状态，百分比`）
 * 是票 02 定下的接口，`smoke.spec.ts` 靠 `split('，')[0]` 取节点名，
 * `graph.spec.ts` 有多处按位置断言第 2 段是状态词。往里塞第三个语义会让那些
 * 断言按位置取到「推荐」而不是状态。加 `aria-describedby` 是同样的信息、
 * 零破坏。
 */
import { useState } from 'react';
import type { GraphNode } from '../api/generated/model';
import { useGraphColors } from './palette.js';
import { RosterSearch } from './RosterSearch.js';
import { filterRosterNodes, isRosterQueryEmpty } from './roster-search.js';
import {
  FINE_LABEL,
  formatPercent,
  nodeAccessibleLabel,
  STATUS_LABEL,
  STATUS_SHAPE,
  toDisplayStatus,
} from './status.js';
import { orderMainline } from './topology.js';

export interface NodeRosterProps {
  /** 当前视野内的节点（已按拓扑裁过） */
  nodes: readonly GraphNode[];
  /** 焦点节点 id：高亮并显示「当前焦点」标记 */
  focusId: string | null;
  /** 打开某个微知识点的详情页 */
  onOpen: (microKpId: string) => void;
  /**
   * 此刻被推荐的节点 id（来自 `/api/v1/graph` 的 `recommendedIds`）。
   *
   * 由调用方从图谱响应里传进来，而不是本组件自己去调推荐接口：地图页手上
   * 已经有一份带 `recommendedIds` 的响应，再发一次请求就可能拿到另一批
   * ——「同一时刻指向同一批」正是要避免的东西。
   */
  recommendedIds?: readonly string[];
}

/**
 * 首批渲染条数。
 *
 * 167 个真实叶节点（整库也就这么多）一次全进，用户感觉不到分批；只有把图谱
 * 灌到 1000+ 时才会看到「继续显示」。选 400 是因为它在慢机器上仍是毫秒级挂载，
 * 而 400 条清单已经足够长到需要用滚动条 —— 不会让用户觉得「内容被藏了」。
 */
const ROSTER_PAGE = 400;

export function NodeRoster({
  nodes,
  focusId,
  onOpen,
  recommendedIds,
}: NodeRosterProps): React.JSX.Element {
  // 清单里的形状色与画布同源（票 62）：两处各写一份 hex 时，切主题会只换一边
  const colors = useGraphColors();
  // 语义顺序：模块 → 树深 → 模块内序。与线性主线视图一致，见上方注释。
  const ordered = orderMainline(nodes);
  const now = new Date();
  /**
   * 搜索串与「继续显示」的分页状态（票 86）。
   *
   * 分页状态带着**它是在哪个查询下展开的**：查询一变，展开量就作废、回到
   * 首批 400 条 —— 否则「在 3000 条里展开全部之后搜『knt』」会一次性渲染
   * 全部命中项，慢机器上又是一次长任务。回到同一个查询串时（比如删掉刚打的
   * 字）展开量恢复，学生不会因为改主意而重新点一次。
   */
  const [query, setQuery] = useState('');
  const [paging, setPaging] = useState<{ query: string; limit: number }>({
    query: '',
    limit: ROSTER_PAGE,
  });
  const recommended = new Set(recommendedIds ?? []);

  const filtered = filterRosterNodes(ordered, query);
  const effectiveLimit = paging.query === query ? paging.limit : ROSTER_PAGE;
  const shown = filtered.length > effectiveLimit ? filtered.slice(0, effectiveLimit) : filtered;
  const remaining = filtered.length - shown.length;
  const truncation = getTruncation();
  const searching = !isRosterQueryEmpty(query);

  return (
    <>
      <RosterSearch
        query={query}
        onQueryChange={setQuery}
        total={ordered.length}
        matched={filtered.length}
      />
      {searching && filtered.length === 0 ? (
        /*
         * 空结果要**说清楚是筛没了**，而不是渲染一个空列表。空列表与「还没
         * 加载完」在视觉上无法区分，学生只会以为清单坏了。
         */
        <p className="graph-roster-empty" data-roster-empty="true">
          没有找到叫「{query.trim()}」的知识点。试试中文名或拼音首字母，例如「knt」。
        </p>
      ) : (
        <ul className="graph-roster" id="graph-roster-list" aria-label="当前视野内的微知识点">
          {shown.map((node) => {
          const status = toDisplayStatus(node, now);
          const isFocus = node.microKpId === focusId;
          const isRecommended = recommended.has(node.microKpId);
          const noteId = isRecommended ? `roster-rec-${node.microKpId}` : undefined;
          return (
            <li key={node.microKpId}>
              <button
                type="button"
                className="graph-roster-item"
                data-node-id={node.microKpId}
                data-status={status}
                data-shape={STATUS_SHAPE[status]}
                data-focus={isFocus ? 'true' : undefined}
                data-recommended={isRecommended ? 'true' : undefined}
                // 可访问名沿用票 02 定下的形状：名称，五档状态，百分比/证据不足。
                // smoke.spec.ts 靠 split('，')[0] 取节点名，改格式会连带改测试。
                aria-label={nodeAccessibleLabel(node)}
                aria-current={isFocus ? 'true' : undefined}
                // 「推荐」走 aria-describedby 而不是塞进 aria-label：追加说明
                // 不改变可访问名，按位置解析标签的既有断言因此不受影响。
                aria-describedby={noteId}
                onClick={() => onOpen(node.microKpId)}
              >
                <span
                  className="graph-roster-glyph"
                  style={{ backgroundColor: colors.nodes[status] }}
                  data-shape={STATUS_SHAPE[status]}
                  aria-hidden="true"
                />
                <span className="graph-roster-name">{node.name}</span>
                {isRecommended && (
                  <span className="graph-roster-rec" aria-hidden="true">
                    推荐
                  </span>
                )}
                <span className="graph-roster-state">
                  {STATUS_LABEL[status]}
                  <span className="graph-roster-fine">（{FINE_LABEL[node.state]}）</span>
                </span>
                <span className="graph-roster-percent">{formatPercent(node.percent)}</span>
              </button>
              {isRecommended && (
                <span id={noteId} hidden>
                  系统推荐
                </span>
              )}
            </li>
          );
        })}
        </ul>
      )}
      {remaining > 0 && (
        <button
          type="button"
          className="graph-roster-more"
          onClick={() => setPaging({ query, limit: truncation })}
        >
          继续显示（还有 {remaining} 个）
        </button>
      )}
    </>
  );
}

/**
 * 「继续显示」一次放出的条数。
 *
 * 分批的价值在于首屏，不在于每次只放 400 —— 用户点「继续显示」的意图是「把
 * 剩下的都给我」。所以第二次直接给全量：中途再点一次才看到结果，比一路点十
 * 次烦人得多。
 */
function getTruncation(): number {
  return Number.POSITIVE_INFINITY;
}
