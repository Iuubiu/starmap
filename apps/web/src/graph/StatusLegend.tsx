/**
 * 图例：四类状态的形状 + 颜色 + 中文名。
 *
 * 票 03 第 7 条要求图谱状态变化有**非颜色的第二编码**。如果图例只画四个色块，
 * 用户就永远学不会「菱形 = 已掌握」—— 形状编码存在但不可学习，等于不存在。
 * 所以图例必须把**形状本身**画出来。
 *
 * 这里用内联 SVG 画形状，不依赖 sigma 的 SDF 渲染：图例是普通 DOM，与画布
 * 的渲染路径无关，改画布不影响图例，反之亦然。形状名与 `STATUS_SHAPE` 一一
 * 对应，测试会校验它们同步。
 *
 * 另外还有一个纯粹的可读性考虑：图例同时给出四类的**节点计数**。学习者打开
 * 地图第一件想知道的事是「我还有多少没学」—— 这句话用图例旁边的一个数字
 * 回答，比让人在画布上数点靠谱。
 */
import type { GraphNode } from '../api/generated/model';
import {
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_SHAPE,
  toDisplayStatus,
  type DisplayStatus,
} from './status.js';

/** 一个状态形状的 SVG 图形。尺寸固定 14px，与画布上的点视觉重量相当。 */
function StatusGlyph({ status }: { status: DisplayStatus }): React.JSX.Element {
  const color = STATUS_COLOR[status];
  const shape = STATUS_SHAPE[status];
  // 统一在 14×14 的框里画，视觉重量一致；各形状的几何差异正是要传递的编码
  if (shape === 'square') {
    return <rect x="2" y="2" width="10" height="10" rx="2" fill={color} />;
  }
  if (shape === 'diamond') {
    return <polygon points="7,1 13,7 7,13 1,7" fill={color} />;
  }
  if (shape === 'triangle') {
    return <polygon points="7,1.5 12.8,12.5 1.2,12.5" fill={color} />;
  }
  return <circle cx="7" cy="7" r="5.3" fill={color} />;
}

export interface StatusLegendProps {
  /** 全量节点（图例统计的是整张图，不是当前视野） */
  nodes: readonly GraphNode[];
  /** 当前视野里的节点，用于把「当前视野内有多少」也标出来 */
  visibleNodes: readonly GraphNode[];
  /** 点击某一类：把它设为筛选（null = 不筛选） */
  active?: DisplayStatus | null;
  onSelect?: (status: DisplayStatus | null) => void;
}

/**
 * 计数：按四类统计。
 *
 * 单独导出成函数是因为它有真实逻辑要测（到期判定依赖 `now`），而且图例与
 * 页面顶部摘要都要用同一份数字 —— 两处各算一遍迟早不一致。
 */
export function countByStatus(
  nodes: readonly GraphNode[],
  now: Date,
): Record<DisplayStatus, number> {
  const counts: Record<DisplayStatus, number> = { unseen: 0, learning: 0, mastered: 0, review: 0 };
  for (const node of nodes) {
    counts[toDisplayStatus(node, now)] += 1;
  }
  return counts;
}

export function StatusLegend({
  nodes,
  visibleNodes,
  active = null,
  onSelect,
}: StatusLegendProps): React.JSX.Element {
  const now = new Date();
  const total = countByStatus(nodes, now);
  const visible = countByStatus(visibleNodes, now);

  return (
    <div className="graph-legend" role="group" aria-label="掌握状态图例">
      {STATUS_ORDER.map((status) => {
        const isActive = active === status;
        return (
          <button
            key={status}
            type="button"
            className="graph-legend-item"
            data-status={status}
            data-shape={STATUS_SHAPE[status]}
            aria-pressed={isActive}
            title={`${STATUS_LABEL[status]}：全图 ${String(total[status])} 个，当前视野 ${String(
              visible[status],
            )} 个`}
            onClick={() => onSelect?.(isActive ? null : status)}
          >
            <svg width="14" height="14" aria-hidden="true" focusable="false">
              <StatusGlyph status={status} />
            </svg>
            <span className="graph-legend-label">{STATUS_LABEL[status]}</span>
            <span className="graph-legend-count">
              {visible[status]}
              <span className="graph-legend-total">/{total[status]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
