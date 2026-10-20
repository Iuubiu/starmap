/**
 * 知识地图页：图谱画布 / 线性主线两种视图 + 三档视野。
 *
 * ## 状态住在 URL 里（票 03 第 4、5 条）
 *
 * 焦点、跳数、视图模式全部进 query。理由不是「URL 好看」，而是这个页面会被
 * **卸载再重建**：点进节点 → 详情 → 关卡 → 返回地图，每一次跳转都会让
 * `MapPage` 重新挂载，`useState` 里的焦点必然丢。URL 是唯一跨导航存活的地方。
 * 顺带的好处：刷新保持原位、链接可分享。
 *
 * ## 为什么默认是全图而不是两跳
 *
 * 票 03 第 2 条要求「默认只显示当前焦点节点的两跳邻域」。但**冷启动时没有
 * 焦点** —— 直接打开 `/map` 的人还没选过任何节点。这时硬选一个焦点（比如
 * 主线第一个）会带来两个问题：一是屏幕阅读器/新用户看到的是「某个随机节点
 * 周围 3 个点」，完全无法建立「这门学科有多大」的印象；二是真实数据里
 * 109/167 个节点没有任何先修边，万一选中孤立节点，两跳邻域就只有它自己。
 *
 * 所以规则是：**有焦点就默认两跳，没有焦点就看全图**。焦点从三个地方来
 * —— 从节点详情页返回（`?focus=`）、URL 手写、以及页面上的「聚焦」选择器。
 * 一旦有了焦点，`+1 跳 / −1 跳 / 回全图` 三个按钮就按票面的语义工作。
 *
 * ## 两种视图共用同一份「可见集」
 *
 * 主线视图不是另一张页面，而是同一批节点的另一种排列。这样「切换视图位置
 * 不丢」是**结构上成立**的，而不是靠两个组件各自记得同步焦点：可见集由
 * `visibleSubgraph` 一次算出，两种视图都读它。
 */
import {
  Body1,
  Button,
  Divider,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useGraph } from '../api/queries';
import { GraphCanvas } from '../graph/GraphCanvas';
import { NodeRoster } from '../graph/NodeRoster';
import { StatusLegend } from '../graph/StatusLegend';
import {
  formatPercent,
  nodeAccessibleLabel,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_SHAPE,
  toDisplayStatus,
} from '../graph/status.js';
import {
  buildGraphIndex,
  groupMainline,
  orderMainline,
  visibleSubgraph,
} from '../graph/topology.js';
import {
  canZoomInHops,
  canZoomOutHops,
  describeView,
  nextHops,
  parseViewState,
  serializeViewState,
  withMode,
  type ViewState,
} from '../graph/view-state.js';
import '../graph/graph.css';

const useStyles = makeStyles({
  page: {
    padding: '24px 32px 32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    height: '100%',
    minHeight: 0,
  },
  heading: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  title: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  spacer: { flex: '1 1 auto' },
  focusPicker: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: tokens.fontSizeBase200,
  },
  select: {
    maxWidth: '280px',
    padding: '5px 8px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    fontSize: tokens.fontSizeBase300,
  },
  body: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 340px',
    gap: '16px',
    minHeight: 0,
    flex: '1 1 auto',
  },
  side: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minHeight: 0,
  },
  status: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  mainline: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    overflow: 'auto',
    padding: '4px 2px 24px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    position: 'sticky',
    top: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    padding: '4px 0',
    zIndex: 1,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '18px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
    ':hover': { border: `1px solid ${tokens.colorBrandStroke1}` },
  },
  rowFocus: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1Selected,
  },
  rowName: {
    fontSize: tokens.fontSizeBase300,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'nowrap',
  },
});

/** 状态形状的小 SVG，与图例共用同一套形状名 —— 两处各画一遍迟早会漂。 */
function ShapeMark({ shape, color }: { shape: string; color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      {shape === 'square' ? (
        <rect x="2" y="2" width="10" height="10" rx="2" fill={color} />
      ) : shape === 'diamond' ? (
        <polygon points="7,1 13,7 7,13 1,7" fill={color} />
      ) : shape === 'triangle' ? (
        <polygon points="7,1.5 12.8,12.5 1.2,12.5" fill={color} />
      ) : (
        <circle cx="7" cy="7" r="5.3" fill={color} />
      )}
    </svg>
  );
}

export function MapPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const graph = useGraph();

  const view = useMemo(() => parseViewState(searchParams), [searchParams]);

  const index = useMemo(
    () => (graph.payload ? buildGraphIndex(graph.payload.nodes, graph.payload.edges) : null),
    [graph.payload],
  );

  const visible = useMemo(() => {
    if (!index) return { nodes: [], edges: [], focusVisible: false };
    return visibleSubgraph(index, view.focus, view.hops);
  }, [index, view.focus, view.hops]);

  const focusNode = index && view.focus !== null ? (index.byId.get(view.focus) ?? null) : null;
  const mainline = useMemo(() => groupMainline(visible.nodes), [visible.nodes]);
  const pickerNodes = useMemo(
    () => (index ? orderMainline(index.nodes) : []),
    [index],
  );

  /**
   * 写回 URL。
   *
   * `replace: true` 是刻意的：调跳数/切视图是**同一个位置上的观察方式变化**，
   * 不是新的位置。用 push 的话，用户连点三次「+1 跳」再按浏览器返回，要按
   * 三次才回到上一页 —— 而他想回去的显然是「点进地图之前」那一页。
   */
  const update = (next: ViewState): void => {
    setSearchParams(serializeViewState(next), { replace: true });
  };

  const openNode = (microKpId: string): void => {
    navigate(`/map/${microKpId}`);
  };

  /**
   * 从详情页/关卡返回地图时的地址。
   *
   * 带 `focus` 与 `hops`：回来时以刚才看的那个节点为中心看两跳，相机也落在
   * 它身上。这就是票 03 第 4 条「从关卡返回时焦点保持原位」。
   */
  const returnHref = (microKpId: string): string => {
    const params = serializeViewState({
      ...view,
      focus: microKpId,
      hops: view.hops ?? 2,
    });
    return `/map?${params.toString()}`;
  };

  const focusName = focusNode?.name ?? null;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text className={styles.title} as="h1">
          知识地图
        </Text>
        <Body1>
          深色画布上的每个点是一个微知识点，颜色与形状同时表示掌握状态。点击进入该知识点的关卡。
        </Body1>
      </div>

      <div className={styles.toolbar}>
        <Button
          appearance={view.mode === 'graph' ? 'primary' : 'secondary'}
          aria-pressed={view.mode === 'graph'}
          onClick={() => update(withMode(view, 'graph'))}
        >
          图谱视图
        </Button>
        <Button
          appearance={view.mode === 'mainline' ? 'primary' : 'secondary'}
          aria-pressed={view.mode === 'mainline'}
          onClick={() => update(withMode(view, 'mainline'))}
        >
          线性主线
        </Button>

        <Divider vertical style={{ height: '24px' }} />

        {/*
         * 三个跳数按钮的可访问名就是可见文字（`−1 跳` / `+1 跳` / `回全图`）。
         * 早先给它们写过 aria-label="减少一跳" 之类的释义，结果是可见文字与
         * 可访问名不一致 —— 语音控制用户念屏幕上的字点不动，测试也只在
         * 恰好用了 aria-label 时才通。释义改放 title（悬停提示），两者不再打架。
         */}
        <Button
          disabled={!canZoomOutHops(view)}
          title="把视野缩到更近一跳"
          onClick={() => update(nextHops(view, -1))}
        >
          −1 跳
        </Button>
        <Button
          disabled={!canZoomInHops(view)}
          title="把视野往外扩一跳"
          onClick={() => update(nextHops(view, 1))}
        >
          +1 跳
        </Button>
        <Button
          disabled={view.hops === null}
          title="取消焦点，显示整张图谱"
          onClick={() => update({ ...view, hops: null })}
        >
          回全图
        </Button>

        <span className={styles.spacer} />

        <label className={styles.focusPicker}>
          <span>以谁为中心</span>
          <select
            className={styles.select}
            aria-label="选择焦点知识点"
            value={view.focus ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              update({
                ...view,
                focus: value === '' ? null : value,
                // 选焦点即进入两跳视野；清空则回全图
                hops: value === '' ? null : (view.hops ?? 2),
              });
            }}
          >
            <option value="">（不设焦点，看全图）</option>
            {pickerNodes.map((node) => (
              <option key={node.microKpId} value={node.microKpId}>
                {node.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/*
       * aria-live：画布内容对读屏用户不可见，所以「现在看到的是哪一块」必须
       * 用一句话播报出来。这是画布的主要可访问替代之一，另一个是节点清单。
       */}
      <p className={styles.status} aria-live="polite" data-view-description>
        {describeView(view, visible.nodes.length, focusName)}
        {view.focus !== null && !visible.focusVisible ? '（该知识点已不在图谱里）' : ''}
      </p>

      <Divider />

      {graph.isPending && <Spinner label="加载地图…" />}
      {graph.isError && (
        <MessageBar intent="error">
          <MessageBarBody>地图加载失败，请检查后端是否运行。</MessageBarBody>
        </MessageBar>
      )}

      {index !== null && index.nodes.length === 0 && (
        <MessageBar>
          <MessageBarBody>
            这片图谱还是空的。先运行内容入库流程（票 02），知识点才会出现在这里。
          </MessageBarBody>
        </MessageBar>
      )}

      {index !== null && index.nodes.length > 0 && (
        <div className={styles.body}>
          {view.mode === 'graph' ? (
            <GraphCanvas
              nodes={visible.nodes}
              edges={visible.edges}
              focusId={visible.focusVisible ? view.focus : null}
              onOpenNode={openNode}
            />
          ) : (
            <div className={styles.mainline} data-mainline>
              {mainline.length === 0 && (
                <MessageBar>
                  <MessageBarBody>这个视野里没有知识点。试试「回全图」。</MessageBarBody>
                </MessageBar>
              )}
              {mainline.map((section) => (
                <section
                  key={section.moduleId}
                  className={styles.section}
                  aria-label={section.moduleName}
                  data-module-id={section.moduleId}
                >
                  <div className={styles.sectionTitle}>
                    <span>{section.moduleName}</span>
                    <span className={styles.status}>{section.nodes.length} 个微知识点</span>
                  </div>
                  {section.nodes.map((node) => {
                    const status = toDisplayStatus(node, new Date());
                    const isFocus = node.microKpId === view.focus;
                    return (
                      <button
                        key={node.microKpId}
                        type="button"
                        className={`${styles.row}${isFocus ? ` ${styles.rowFocus}` : ''}`}
                        data-node-id={node.microKpId}
                        data-status={status}
                        data-focus={isFocus ? 'true' : undefined}
                        aria-label={nodeAccessibleLabel(node)}
                        aria-current={isFocus ? 'true' : undefined}
                        onClick={() => openNode(node.microKpId)}
                      >
                        <ShapeMark shape={STATUS_SHAPE[status]} color={STATUS_COLOR[status]} />
                        <span className={styles.rowName}>{node.name}</span>
                        <span className={styles.rowMeta}>
                          <span>{STATUS_LABEL[status]}</span>
                          <span>{formatPercent(node.percent)}</span>
                        </span>
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          )}

          <div className={styles.side}>
            <StatusLegend nodes={index.nodes} visibleNodes={visible.nodes} />
            <NodeRoster
              nodes={visible.nodes}
              focusId={visible.focusVisible ? view.focus : null}
              onOpen={(microKpId) => {
                // 记下回来时的落点：详情页读 location.state 后再拼出地址
                navigate(`/map/${microKpId}`, { state: { returnHref: returnHref(microKpId) } });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
