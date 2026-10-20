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
 */
import { useState } from 'react';
import type { GraphNode } from '../api/generated/model';
import {
  FINE_LABEL,
  formatPercent,
  nodeAccessibleLabel,
  STATUS_COLOR,
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
}

/**
 * 首批渲染条数。
 *
 * 167 个真实叶节点（整库也就这么多）一次全进，用户感觉不到分批；只有把图谱
 * 灌到 1000+ 时才会看到「继续显示」。选 400 是因为它在慢机器上仍是毫秒级挂载，
 * 而 400 条清单已经足够长到需要用滚动条 —— 不会让用户觉得「内容被藏了」。
 */
const ROSTER_PAGE = 400;

export function NodeRoster({ nodes, focusId, onOpen }: NodeRosterProps): React.JSX.Element {
  // 语义顺序：模块 → 树深 → 模块内序。与线性主线视图一致，见上方注释。
  const ordered = orderMainline(nodes);
  const now = new Date();
  const [limit, setLimit] = useState(ROSTER_PAGE);

  const shown = ordered.length > limit ? ordered.slice(0, limit) : ordered;
  const remaining = ordered.length - shown.length;
  const truncation = getTruncation();

  return (
    <>
      <ul className="graph-roster" aria-label="当前视野内的微知识点">
        {shown.map((node) => {
          const status = toDisplayStatus(node, now);
          const isFocus = node.microKpId === focusId;
          return (
            <li key={node.microKpId}>
              <button
                type="button"
                className="graph-roster-item"
                data-node-id={node.microKpId}
                data-status={status}
                data-shape={STATUS_SHAPE[status]}
                data-focus={isFocus ? 'true' : undefined}
                // 可访问名沿用票 02 定下的形状：名称，五档状态，百分比/证据不足。
                // smoke.spec.ts 靠 split('，')[0] 取节点名，改格式会连带改测试。
                aria-label={nodeAccessibleLabel(node)}
                aria-current={isFocus ? 'true' : undefined}
                onClick={() => onOpen(node.microKpId)}
              >
                <span
                  className="graph-roster-glyph"
                  style={{ backgroundColor: STATUS_COLOR[status] }}
                  data-shape={STATUS_SHAPE[status]}
                  aria-hidden="true"
                />
                <span className="graph-roster-name">{node.name}</span>
                <span className="graph-roster-state">
                  {STATUS_LABEL[status]}
                  <span className="graph-roster-fine">（{FINE_LABEL[node.state]}）</span>
                </span>
                <span className="graph-roster-percent">{formatPercent(node.percent)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {remaining > 0 && (
        <button type="button" className="graph-roster-more" onClick={() => setLimit(truncation)}>
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
