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
import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useGraph } from '../api/queries';
import type { ContentGap } from '../api/generated/model';
import { provideFlightCamera } from '../motion/camera-flight';
import { GraphCanvas } from '../graph/GraphCanvas';
import type { CinematicCamera } from '../graph/camera.js';
import { NodeRoster } from '../graph/NodeRoster';
import { useGraphColors } from '../graph/palette.js';
import { StatusLegend } from '../graph/StatusLegend';
import {
  formatPercent,
  nodeAccessibleLabel,
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

/**
 * 画布区域的最小高度，与 `graph.css` 的 `.graph-canvas { min-height }` 同值。
 *
 * 两边必须对得上：这个数写小了，画布会溢出自己的格子去盖住下面的内容；
 * 写大了，页面会多出一块空白。宽屏 480px / 窄屏（≤1080px）380px，
 * 取大的那个 —— 窄屏时多出 100px 空白，不会出错；取小的则宽屏会被盖。
 */
const CANVAS_MIN_HEIGHT = 480;

const useStyles = makeStyles({
  page: {
    padding: '24px 32px 32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    height: '100%',
    minHeight: 0,
    /**
     * `page` 是 `AppShell` 的 `main`（`overflow: auto`）里唯一的块级子元素，
     * 默认宽度是 `auto`（撑满），但它的**内容**（工具栏、缺口区、清单）里有
     * 若干 `white-space: nowrap` 的短标签，`min-width: auto` 会把它顶到
     * min-content 宽度 —— 实测 320px 视口下整页宽 395px、横向滚动条出现。
     * 写 0 之后 `page` 老实收到 320px，内部靠 `body`/`side` 自己的 `minWidth: 0`
     * 和画布的 `min-width: 240px` 兜底。
     */
    minWidth: 0,
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
  /**
   * 画布 + 右侧清单。
   *
   * `minHeight` 必须是**带单位的具体值**，两个坑都在这里：
   * - 写 `0`：这一格会被下面的内容缺口区挤小，而画布本身有 `min-height: 480px`
   *   （见 `graph.css`），它不会跟着缩，只会溢出自己的格子，**盖住**缺口区 ——
   *   缺口区在 DOM 里、在无障碍树里、`isVisible()` 也报可见（它只判矩形与
   *   visibility，不判遮挡），但屏幕上看到的是深色画布。
   * - 写裸数字 `480`：Griffel（makeStyles）不会给裸数字补 `px`，会生成一条
   *   无效声明并被浏览器丢弃，计算值仍是 `auto`。而 `minHeight: 0` 能生效是
   *   因为 0 本来就无需单位 —— 所以这个坑只在非零值上出现。
   *
   * 空间不够时是**整页变高、由 `AppShell` 的 `main { overflow: auto }` 滚**，
   * 而不是画布压住别的内容；右栅清单仍然在格子里自己滚（`.graph-roster`
   * 是滚动容器）。这里刻意不给 `page` 加 `overflow` —— `main` 已经在滚了，
   * 再套一层会多出一条滚动条。
   */
  body: {
    display: 'grid',
    /*
     * 票 83：画布 = 内容区宽度 − 340px。
     *
     * 列间距写在右侧清单自己的 `padding-inline-start` 上，而不是 `columnGap`：
     * 判据是「画布宽度 = 100% − 340px」，有 columnGap 就会多减一次 16px，
     * 数字对不上。视觉上的空隙一点没少，只是它属于清单列的内部留白。
     */
    gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 34%)',
    columnGap: 0,
    rowGap: '16px',
    minHeight: `${CANVAS_MIN_HEIGHT}px`,
    flex: '1 1 auto',
    /**
     * 窄视口把清单落到画布**下方**，而不是继续挤在同一行。
     *
     * 这一条是票 47 的正解：`minmax(0, 1fr)` 允许第一列缩到 0，而右列
     * 固定 340px —— 视口 400px 时左列算出来是 `400 - 64(padding) - 16(gap)
     * - 340 = -20`，被 `minmax(0, …)` 夹到 0，画布容器宽度归零，sigma 在
     * `resize()` 里抛 `Sigma: Container has no width`（在 window resize
     * 回调链里，React 错误边界接不住 → 真 pageerror）。
     *
     * 为什么不直接把 340px 那一列在窄屏藏掉：清单是地图页的另一半（票 03
     * 第 7 条：画布的等价文本在清单里，键盘可达）。藏掉等于把无障碍出口
     * 一起删了。改单列后画布拿到整行宽度（320px 视口 → 256px），清单仍在
     * 文档流里、仍在无障碍树里，只是换了一行。
     *
     * 阈值 1080px 与 `graph.css` 里那条 `@media (max-width: 1080px)` 一致：
     * 同一档宽度下，画布的最小高度和栅格列数一起切换，不会出现「高度已经
     * 按窄屏算了、列数还是两列」的错位。
     */
    /* v2 外壳里中栏只占视口的 50%，1440 下中栏约 677px：340px 的清单会把画布
       挤到 240px（实测）。阈值抬到 1500 让 1080–1500 也走单列，清单落到画布下方。 */
    '@media (max-width: 1500px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
    /**
     * 允许栅格**本身**收缩到父级宽度以内。
     *
     * `minmax(0, 1fr)` 只约束「列」，不约束「栅格容器」。`body` 是 `page`
     * 这个 flex 列里的一个 flex 项，flex 项默认 `min-width: auto`，也就是
     * 「不小于内容的 min-content 宽度」—— 清单里那条「状态 / 百分比」两列
     * 加一条长知识点名，就能把整个栅格撑到 331px。实测 320px 视口（可用
     * 256px）与 375px 视口（可用 311px）下画布与清单**都是 331px**，整页
     * 横向滚动。写 `minWidth: 0` 之后栅格才真的收到可用宽度，画布靠自己的
     * `min-width: 240px` 兜底（见 `graph.css`）。
     */
    minWidth: 0,
  },
  side: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minHeight: 0,
    /* 与画布之间的那条 16px 空隙（原 `body` 的 columnGap）。 */
    paddingInlineStart: '16px',
    boxSizing: 'border-box',
    /**
     * 单列时给侧栏一个**具体高度**，否则清单会塌成 0。
     *
     * 两列时 `side` 与画布同处一行，行高由 `body` 的 `minHeight: 480px`
     * 撑出来，`side` 拿到 480px，里面的 `.graph-roster`（`flex: 1 1 auto`
     * 配 `min-height: 0`）自然分到剩余高度（实测 348px）。切到单列后画布
     * 与侧栏各占一行，第二行是 `auto` —— 而 `auto` 行的固有高度来自内容，
     * 内容里的清单是滚动容器（`overflow-y: auto` + `min-height: 0`），对
     * 固有高度的贡献是 0，于是行高只剩图例 32 + 按钮 34 + 两个 gap，清单
     * 被压成 0px。实测 1024 / 900 / 375 三档：`ul.graph-roster` 高度都是
     * 0（宽度 720 / 636 / 311 正确、400 条 `li` 也都在 DOM 与无障碍树里），
     * 屏幕上只剩「图例 + 显示更多按钮」，中间一片空白 —— 票 47 第 3 条
     * 「清单始终可浏览」在视觉层其实没达成。
     *
     * 写 `min-height` 之后这个 flex 列有了确定高度，清单才分得到空间。阈值
     * 320px 的理由：窄屏下画布已经是 380px，清单再占 320px 刚好让「一屏
     * 看得到十行左右」，同时不会把页面撑得太长（整页本来就可以滚）。
     */
    '@media (max-width: 1080px)': {
      minHeight: '320px',
    },
    /**
     * 同理：`side` 是栅格项，`min-width: auto` 会让它的 min-content（清单里
     * 「状态 / 百分比」两列都是 `white-space: nowrap`）反过来撑大整列。
     * 实测 320px 视口下这一条不做，栅格列被撑到 331px、整页横向滚动。
     */
    minWidth: 0,
  },
  status: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  /**
   * 内容缺口区（票 18 AC5）。
   *
   * 放在页面最底部、图例与清单之下 —— 它是一句「往后没有教材了」的说明，
   * 不是当前视野的一部分，所以不该抢画布上方或右侧栏的位置。
   */
  gaps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  gapList: {
    margin: 0,
    paddingLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  gapTopic: {
    fontWeight: tokens.fontWeightSemibold,
  },
  gapReason: {
    color: tokens.colorNeutralForeground2,
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

/**
 * 内容缺口列表（票 18 AC5）。
 *
 * ## 为什么不画在 sigma 画布上
 *
 * 缺口指向的是「图上不存在的节点」。真要在画布上表示它，要么造一批虚拟节点
 * （4441 个真实节点的力导向布局会被这些凭空出现的点拉变形，而且它们没有边、
 * 会漂到外围去），要么画在固定位置（那就与图毫无关系了）。更实际的问题是：
 * 缺口的语义是「课程到这儿为止」，它不属于任何一个具体节点，不属于任何一条
 * 边 —— 它属于**整张图**。所以它渲染在图下方，作为一句面向整张图的说明。
 *
 * ## 为什么跳转入口取 `nearestKpIds[0]` 而不是渲染全部
 *
 * 数组里是同一主题在不同书里的几节（「多道分析器」在 Ahmed / Knoll / Leo 各
 * 有一节）。三个链接指向三个名字一样的节点，对学习者没有额外信息量。只给
 * 第一个做入口，其余不渲染 —— 数组顺序就是「最接近课程终点」的顺序（见
 * `ContentGapSchema`）。
 *
 * ## 为什么 id 不在当前图里就不给链接
 *
 * `nearestKpIds` 是迁移执行时按名字解析的，知识点重导入后 id 会漂移。那时
 * 点进去就是一个 404。所以先查一下它在不在 `nodes` 里：在就给按钮，不在就
 * 只显示 topic + reason。**缺口本身照常显示** —— 「这里缺内容」是内容侧的
 * 事实，不因为提示链接失效而不再成立。
 */
function ContentGaps({
  gaps,
  nodeIds,
  onOpen,
}: {
  gaps: readonly ContentGap[];
  nodeIds: ReadonlySet<string>;
  onOpen: (microKpId: string) => void;
}) {
  const styles = useStyles();
  if (gaps.length === 0) return null;

  return (
    <section className={styles.gaps} aria-label="内容缺口" data-content-gaps>
      <MessageBar intent="warning">
        <MessageBarBody>
          <strong>资源库里没有对口教材的几处内容</strong>
          <br />
          下面这些主题在本科课程里本该有位置，但资源库没有能支撑它们的教材。
          缺口不是「还没录完」，而是这门课在本科层面就到这儿为止。
        </MessageBarBody>
      </MessageBar>
      <ul className={styles.gapList}>
        {gaps.map((gap) => {
          const nearest = gap.nearestKpIds.find((id) => nodeIds.has(id)) ?? null;
          return (
            <li key={gap.id} data-content-gap-id={gap.id}>
              <span className={styles.gapTopic}>{gap.topic}</span>
              {' — '}
              <span className={styles.gapReason}>{gap.reason}</span>
              {nearest !== null && (
                <>
                  {' '}
                  <Button
                    appearance="transparent"
                    size="small"
                    onClick={() => onOpen(nearest)}
                    data-content-gap-nearest={nearest}
                  >
                    从最接近的知识点看起
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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
  // 线性主线视图里的形状色与画布同源（票 62）
  const colors = useGraphColors();

  const view = useMemo(() => parseViewState(searchParams), [searchParams]);

  /**
   * 把画布的相机交给「镜头通道」（票 68）。
   *
   * 关卡浮层挂在应用根上，与地图页不在同一棵子树里 —— 它拿不到这里的 ref。
   * `motion/camera-flight.ts` 就是那条单向通道：地图页登记「此刻活跃的相机」，
   * 浮层开合时问一句「现在有没有相机可飞」。
   *
   * 登记的是 **ref 本身**而不是相机实例：`GraphCanvas` 在重建画布时会把
   * `cameraRef.current` 换成新实例、卸载时置 `null`，浮层永远读到「此刻」的
   * 那台，不会飞给一个已经被 kill 的幽灵。
   */
  const cameraRef = useRef<CinematicCamera | null>(null);
  useEffect(() => {
    provideFlightCamera(cameraRef);
    return () => provideFlightCamera(null);
  }, []);

  const index = useMemo(
    () => (graph.payload ? buildGraphIndex(graph.payload.nodes, graph.payload.edges) : null),
    [graph.payload],
  );

  /* 无焦点时自动落在一个「枢纽点」上：邻居最多的那个节点。
     确定性选法（邻居数优先、同数按 id 排序），刷新同一屏结果不变。
     这样打开地图永远看到一张**能读的**局部网络，而不是 3085 点的密点圆环。 */
  const autoFocus = useMemo(() => {
    if (!index || view.focus !== null) return null;
    let hubId: string | null = null;
    let hubDeg = -1;
    for (const node of index.nodes) {
      const deg = index.neighbors.get(node.microKpId)?.size ?? 0;
      if (deg > hubDeg || (deg === hubDeg && hubId !== null && node.microKpId < hubId)) {
        hubDeg = deg;
        hubId = node.microKpId;
      }
    }
    return hubId !== null && hubDeg >= 2 ? hubId : null;
  }, [index, view.focus]);

  /** 真正用于渲染的视图状态：无焦点时等价于「以 autoFocus 为中心看 2 跳」。 */
  const renderView = useMemo(
    () => (autoFocus === null ? view : { ...view, focus: autoFocus, hops: 2 }),
    [view, autoFocus],
  );

  const visible = useMemo(() => {
    if (!index) return { nodes: [], edges: [], focusVisible: false };
    return visibleSubgraph(index, renderView.focus, renderView.hops);
  }, [index, renderView.focus, renderView.hops]);

  const focusNode =
    index && renderView.focus !== null ? (index.byId.get(renderView.focus) ?? null) : null;
  const mainline = useMemo(() => groupMainline(visible.nodes), [visible.nodes]);
  const pickerNodes = useMemo(
    () => (index ? orderMainline(index.nodes) : []),
    [index],
  );

  /**
   * 此刻被推荐的节点（票 13 验收第 5 条）。
   *
   * 来源是**图谱响应自带的** `recommendedIds`，不是另外调一次推荐接口。两处
   * 各查一次的话，两次之间只要有人作答，地图标的和看板推的就不是同一批 ——
   * 而验收第 5 条要的恰恰是「同一时刻指向同一批」。服务端已经把推荐算在图谱
   * 响应里了，这里只做投影。
   */
  const recommended = useMemo(
    () => new Set(graph.payload?.recommendedIds ?? []),
    [graph.payload],
  );

  /**
   * 图里现有的节点 id。内容缺口的 `nearestKpIds` 可能指向已经不在图里的
   * 知识点（重导入后 id 漂移），这里先建一份集合，缺口区据此决定给不给
   * 跳转按钮。建一次复用，不在每条的 `find()` 里各扫一遍。
   */
  const nodeIdSet = useMemo(
    () => new Set((graph.payload?.nodes ?? []).map((node) => node.microKpId)),
    [graph.payload],
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
          默认显示一个知识点两跳以内的知识网络（先自动落在连接最多的那个点上）。点任一节点进入它的关卡，用 −1 跳 / +1 跳 扩缩范围；颜色与形状同时表示掌握状态。
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
        {describeView(renderView, visible.nodes.length, focusName)}
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
              cameraRef={cameraRef}
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
                    // 与 NodeRoster 同一套标记：推荐要在两条渲染路径上都出现，
                    // 否则切到线性主线视图推荐就消失了（票 13 验收第 5 条）。
                    const isRecommended = recommended.has(node.microKpId);
                    return (
                      <button
                        key={node.microKpId}
                        type="button"
                        className={`${styles.row}${isFocus ? ` ${styles.rowFocus}` : ''}`}
                        data-node-id={node.microKpId}
                        data-status={status}
                        data-focus={isFocus ? 'true' : undefined}
                        data-recommended={isRecommended ? 'true' : undefined}
                        aria-label={nodeAccessibleLabel(node)}
                        aria-current={isFocus ? 'true' : undefined}
                        onClick={() => openNode(node.microKpId)}
                      >
                        <ShapeMark shape={STATUS_SHAPE[status]} color={colors.nodes[status]} />
                        <span className={styles.rowName}>{node.name}</span>
                        {isRecommended && (
                          <span className="graph-roster-rec" aria-hidden="true">
                            推荐
                          </span>
                        )}
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
              recommendedIds={graph.payload?.recommendedIds}
              onOpen={(microKpId) => {
                // 记下回来时的落点：详情页读 location.state 后再拼出地址
                navigate(`/map/${microKpId}`, { state: { returnHref: returnHref(microKpId) } });
              }}
            />
          </div>
        </div>
      )}

      {/*
       * 内容缺口（票 18 AC5）。放在画布与清单之外、页面最底部：它描述的是
       * **整张图**「往后没有教材了」，而不是当前视野里某几个节点的状态。
       * 不渲染在 `.graph-canvas` 容器内 —— 画布只画真实节点。
       */}
      {index !== null && (
        <ContentGaps gaps={graph.payload?.contentGaps ?? []} nodeIds={nodeIdSet} onOpen={openNode} />
      )}
    </div>
  );
}
