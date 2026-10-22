/**
 * 命令面板 —— `Cmd/Ctrl + K`，一个输入框同时是搜索、跳转、执行动作。
 *
 * ## 为什么挂在应用根部而不是某个页面里
 *
 * 它要在**任何**页面上被一个快捷键唤起，包括 404 页。挂在页面里意味着每个
 * 页面各挂一次、各自持有一份打开状态，而且「在 A 页打开、跳到 B 页之后它还
 * 开着」这件事会变成未定义行为。挂在根上就只有一份状态。
 *
 * ## 为什么导航是注入的 `onNavigate` 而不是 `useNavigate()`
 *
 * 挂载点在 `App.tsx` 的 `<RouterProvider>` **外面**（它和路由树是兄弟节点，
 * 不是子节点），那里没有 router context，`useNavigate()` 会抛
 * `useNavigate() may be used only in the context of a <Router>`。把导航收成
 * 一个 `(path) => void` 回调，面板就只依赖「跳转」这一个能力 —— 单测里传一个
 * spy 就能断言落点，不需要为了一个函数去搭整棵路由树。
 *
 * ## 键盘是主路径，鼠标是补充
 *
 * `Cmd/Ctrl+K` 开、`Esc` 关、`↑/↓` 选、`Enter` 执行。鼠标 hover 会同步高亮，
 * 点击执行 —— 两条路径操作的是同一个 `activeIndex`，所以「鼠标划过之后按
 * Enter」不会执行一个和你看到的高亮不同的项。
 *
 * ## 焦点管理
 *
 * 打开时把焦点送进输入框，同时**记住打开前聚焦的元素**；关闭时还回去。不记
 * 这一步的后果是：用键盘唤起面板、Esc 之后焦点落到 `<body>`，接着按 Tab 会
 * 从页面第一个可聚焦元素重新开始 —— 对键盘用户等于「位置丢了」。
 *
 * ## 为什么结果列表是窗口化的
 *
 * 3085 个知识点全量进 DOM，每次按键都要 diff 三千个节点。窗口化之后 DOM 里
 * 恒定是「可见行 + 上下各 6 行」，与总条数无关（见 `virtualize.ts`）。
 *
 * ## 动作段的「锚点」为什么是状态而不是从高亮算出来的
 *
 * 三个动作（打开详情 / 去地图定位 / 生成关卡）作用在**某一个知识点**上。
 * 如果锚点每次渲染都从「当前高亮项」反推，那么当高亮落在动作行上时，反推
 * 只能得到「它自己所属的那个点」—— 看起来对，实际会抖动：用户把鼠标移到
 * 「打开详情」上，锚点瞬间变成另一条（因为动作行本身不带锚点信息，只能退回
 * 「最近一个知识点」），于是鼠标下的那一行在点击前变成了别的知识点的动作。
 * 把锚点存成状态、只在**高亮落到知识点行**时更新，就消除了这个抖动。
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useGetGraph } from '../api/generated/default/default';
import type { GraphNode, GraphResponse } from '../api/generated/model';
import { useReducedMotion } from '../motion';
import { fuzzyRank } from './fuzzy.js';
import {
  defaultItems,
  groupBySection,
  nodeActions,
  nodeItem,
  pageItem,
  type PaletteItem,
} from './items.js';
import { buildPageActions } from './pages.js';
import { appRoutes } from '../routes';
import { nodeIdFromPath, readRecentNodes, recordRecentNode, RECENT_VISIBLE } from './recent.js';
import { computeWindow } from './virtualize.js';
import './palette.css';

/**
 * 行高，与 `palette.css` 的 `.sm-palette__row { height }` 同值。
 *
 * 两处写同一个数字是本模块唯一需要人工保持一致的约定：改这里必须同步改 CSS
 * （反之亦然），否则窗口化会算错偏移，表现为滚动时行跳动。
 */
const ROW_HEIGHT = 30;

/** 上下各多渲染几行，抵消快速滚动时的空白。 */
const OVERSCAN = 6;

/** 列表可视高度。窗口化需要它；CSS 里 `.sm-palette__list` 由 flex 撑开。 */
const LIST_VIEWPORT = 320;

export interface CommandPaletteProps {
  /** 跳转。挂载点注入（`App.tsx` 传 `router.navigate`）。 */
  onNavigate?: (to: string) => void;
  /** 覆盖路由表（测试用）。默认就是真路由表。 */
  routes?: Parameters<typeof buildPageActions>[0];
}

/** 从动作 id 里取回它所属的知识点 id（`action:<verb>:<microKpId>`）。 */
export function actionNodeId(actionId: string): string | null {
  const parts = actionId.split(':');
  if (parts.length < 3 || parts[0] !== 'action') return null;
  return parts.slice(2).join(':');
}

/** 一条渲染行：分区标题或可选项。 */
type Row =
  | { type: 'header'; key: string; title: string }
  | { type: 'item'; key: string; item: PaletteItem; index: number };

export function CommandPalette({ onNavigate, routes = appRoutes }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentNodes());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const baseId = useId();

  /**
   * 图数据。`enabled` 只在**第一次打开过之后**为真：面板挂在根上，若一进站
   * 就拉 874KB 的图，等于给每个页面加一次冷启动成本。打开过一次之后就一直
   * 开着，缓存键与地图页完全一致（`/api/v1/graph`），所以两边共用同一份。
   */
  const graph = useGetGraph({
    query: { enabled: open || recentIds.length > 0, staleTime: 60_000 },
  });
  const payload = graph.data?.data as GraphResponse | undefined;

  const byId = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of payload?.nodes ?? []) map.set(node.microKpId, node);
    return map;
  }, [payload]);

  const pageActions = useMemo(() => buildPageActions(routes), [routes]);

  /**
   * 知识点 + 页面（不含动作）—— 动作由 `anchorId` 算出。
   *
   * `ms` 是**排序本身**的耗时（`fuzzyRank` 两遍 + 组装），不是整个按键到
   * 出结果的时间：后者包含 React 提交与浏览器绘制，同一份代码在快慢机器上
   * 能差一个数量级，拿它当验收数字没有意义。这个值写到
   * `data-palette-ms` 上，e2e 探针直接读它，而不是在测试里猜时间。
   */
  const search = useMemo<{ items: PaletteItem[]; ms: number; matches: number }>(() => {
    const started = performance.now();
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      /* 空查询不排序：默认态的成本是「拼几条固定项」，不是搜索路径。 */
      return { items: defaultItems(recentIds, byId, pageActions, RECENT_VISIBLE), ms: 0, matches: 0 };
    }

    const rankedNodes = fuzzyRank(payload?.nodes ?? [], trimmed, (node) => ({
      text: node.name,
      hint: node.moduleName,
    }));
    const rankedPages = fuzzyRank(pageActions, trimmed, (page) => ({
      text: page.label,
      hint: page.hint,
    }));

    const items = [
      ...rankedNodes.map((entry) => nodeItem(entry.item)),
      ...rankedPages.map((entry) => pageItem(entry.item)),
    ];
    return { items, ms: performance.now() - started, matches: rankedNodes.length };
  }, [query, payload, pageActions, recentIds, byId]);

  const baseItems = search.items;

  const anchorNode = anchorId === null ? null : (byId.get(anchorId) ?? null);

  const actionItems = useMemo<PaletteItem[]>(
    () => (anchorNode === null ? [] : nodeActions(anchorNode)),
    [anchorNode],
  );

  const allItems = useMemo<PaletteItem[]>(
    () => [...baseItems, ...actionItems],
    [baseItems, actionItems],
  );

  const clampedIndex =
    allItems.length === 0 ? 0 : Math.min(Math.max(activeIndex, 0), allItems.length - 1);
  const activeItem = allItems[clampedIndex];

  /* 打开或换查询之后，如果还没有锚点，就把锚点落在第一条知识点上。
     只在 `null` 时写，所以不会自激；换查询时 `onQueryChange` 会先把它清空，
     于是「搜什么就操作什么」。

     **空查询不自动落锚点**：空态的定义是「最近访问的 3 个知识点 + 全部页面
     动作」（票面第 3 条），多出来的三个动作行会让它看起来像另一个页面。用户
     把高亮移到某个知识点上时 `pick()` 会落锚点，动作仍然随手就有。 */
  useEffect(() => {
    if (!open || anchorId !== null) return;
    if (query.trim().length === 0) return;
    const first = baseItems[0];
    if (first?.kind === 'node') setAnchorId(first.node.microKpId);
  }, [open, anchorId, baseItems, query]);

  /* 行模型：分区标题 + 可选项，都是定高 30px，所以窗口化只需要一个行数组。 */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const group of groupBySection(allItems)) {
      out.push({ type: 'header', key: `h:${group.section}`, title: group.title });
      for (const item of group.items) {
        const index = allItems.indexOf(item);
        if (index < 0) continue;
        out.push({ type: 'item', key: item.id, item, index });
      }
    }
    return out;
  }, [allItems]);

  const rowOfActive = useMemo(
    () => rows.findIndex((row) => row.type === 'item' && row.index === clampedIndex),
    [rows, clampedIndex],
  );

  const viewport = useMemo(
    () =>
      computeWindow({
        total: rows.length,
        rowHeight: ROW_HEIGHT,
        viewportHeight: LIST_VIEWPORT,
        scrollTop,
        overscan: OVERSCAN,
      }),
    [rows.length, scrollTop],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    setScrollTop(0);
    setAnchorId(null);
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    /* 目标可能在打开期间被卸载（例如点了会导航的按钮）—— `isConnected`
       拦掉这种情况，否则 `focus()` 作用在一个游离节点上什么都不会发生，
       而焦点会留在 `<body>`，与「不还回去」是同一个结果，只是更难查。 */
    if (target !== null && target.isConnected) target.focus({ preventScroll: true });
  }, []);

  const openPalette = useCallback(() => {
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;
    /* 记下「用户此刻正待在哪」：详情页上的那个知识点就是最近访问的第一个。 */
    const onDetail = nodeIdFromPath(window.location.pathname);
    if (onDetail !== null) setRecentIds(recordRecentNode(onDetail));
    else setRecentIds(readRecentNodes());
    setOpen(true);
    setQuery('');
    setActiveIndex(0);
    setScrollTop(0);
    setAnchorId(null);
  }, []);

  /* 全局快捷键。`capture` 阶段监听：面板要在页面自己的 `keydown` 之前拿到
     `Cmd/Ctrl+K`（浏览器里它是「聚焦地址栏搜索」，必须 preventDefault）。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault();
        if (open) close();
        else openPalette();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, close, openPalette]);

  /* 打开后把焦点送进输入框。放在 effect 里而不是 `autoFocus`：`autoFocus`
     在 StrictMode 的双挂载下会触发两次 focus 事件，而这里需要的是「一次，
     且发生在面板已经挂载之后」。 */
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  /* 高亮行滚进视野。用 `scrollTop` 直接赋值而不是 `scrollIntoView`：
     后者会连带滚动外层容器（整个页面），面板浮在页面上时那会把底下的页面
     也一起滚走。 */
  useEffect(() => {
    if (!open || rowOfActive < 0) return;
    const list = listRef.current;
    if (list === null) return;
    const top = rowOfActive * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [open, rowOfActive]);

  /**
   * 移动高亮。
   *
   * 唯一一个「改高亮」的入口（键盘、鼠标、Home/End 都走它），因为锚点必须
   * 跟着高亮一起更新 —— 两处各写一遍就会有一处忘了写，表现为「鼠标划过的
   * 知识点和动作段操作的不是同一个」。
   */
  const pick = useCallback(
    (index: number) => {
      if (allItems.length === 0) return;
      const next = Math.min(Math.max(index, 0), allItems.length - 1);
      setActiveIndex(next);
      const item = allItems[next];
      if (item !== undefined && item.kind === 'node') setAnchorId(item.node.microKpId);
    },
    [allItems],
  );

  /* 给 window 捕获阶段的 Tab 拦截用：那里拿不到最新的 pick/clampedIndex，
     而重建监听器会让「按下的那一帧」和「监听器重挂」赛跑。 */
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const indexRef = useRef(clampedIndex);
  indexRef.current = clampedIndex;

  const execute = useCallback(
    (item: PaletteItem | undefined) => {
      if (item === undefined) return;
      let path: string;
      if (item.kind === 'node') {
        path = `/map/${encodeURIComponent(item.node.microKpId)}`;
        setRecentIds(recordRecentNode(item.node.microKpId));
      } else {
        path = item.path;
        if (item.kind === 'action') {
          const nodeId = actionNodeId(item.id);
          if (nodeId !== null) setRecentIds(recordRecentNode(nodeId));
        }
      }
      close();
      onNavigate?.(path);
    },
    [close, onNavigate],
  );

  /* Tab 与方向键同义：在 listbox 模式里 Tab 不该把焦点带出面板 —— 带出去之后
     `aria-activedescendant` 指向的项就不在焦点路径上，读屏会念一段和当前项
     无关的内容。
     
     为什么不在输入框的 `onKeyDown` 里处理：Fluent 的焦点守卫（Tabster）在
     document 的**捕获**阶段就把 Tab 拿去移动焦点了，React 的冒泡处理器根本
     轮不到 `preventDefault` —— 真浏览器里表现为「高亮动了，焦点却跳到侧栏
     图标上」。只能在 window 捕获阶段、比 Tabster 更早地把这次 Tab 吃掉。 */
  useEffect(() => {
    if (!open) return undefined;
    const onTabCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (event.target !== inputRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      pickRef.current(indexRef.current + (event.shiftKey ? -1 : 1));
      /* Tabster 的焦点守卫会在浏览器的焦点遍历里把焦点丢给它的 dummy 哨兵
         （`<i data-tabster-dummy>`）—— `preventDefault()` 在真浏览器里挡不住
         那一步。下一帧把焦点收回来，代价是一帧的焦点抖动，换的是「Tab 不移出
         输入框」这条契约真的成立。 */
      window.requestAnimationFrame(() => {
        if (document.activeElement !== inputRef.current) {
          inputRef.current?.focus({ preventScroll: true });
        }
      });
    };
    window.addEventListener('keydown', onTabCapture, true);
    return () => window.removeEventListener('keydown', onTabCapture, true);
  }, [open]);

  const onInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          pick(clampedIndex + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          pick(clampedIndex - 1);
          break;
        case 'Home':
          event.preventDefault();
          pick(0);
          break;
        case 'End':
          event.preventDefault();
          pick(allItems.length - 1);
          break;
        case 'Enter':
          event.preventDefault();
          execute(activeItem);
          break;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          close();
          break;
        default:
          break;
      }
    },
    [pick, clampedIndex, allItems.length, execute, activeItem, close],
  );

  if (!open) return null;

  const optionId = (item: PaletteItem): string => `${baseId}-opt-${item.id}`;
  const activeDomId = activeItem === undefined ? undefined : optionId(activeItem);
  const visibleRows = rows.slice(viewport.start, viewport.end);
  const renderedOptions = visibleRows.filter((row) => row.type === 'item').length;

  return (
    <div
      className="sm-palette__scrim"
      data-palette="open"
      /* 点遮罩关闭。`mousedown` 而不是 `click`：click 要等到 mouseup，而
         mouseup 可能发生在面板里（按下遮罩、拖进面板再松手），那时按
         click 语义不该关闭 —— 但更常见的是「按下遮罩」这个意图已经足够。 */
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="sm-palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        data-motion={reduced ? 'none' : 'enter'}
      >
        <div className="sm-palette__field">
          <input
            ref={inputRef}
            className="sm-palette__input"
            type="text"
            role="combobox"
            aria-label="搜索知识点、页面或动作"
            aria-expanded="true"
            aria-controls={`${baseId}-list`}
            aria-autocomplete="list"
            aria-activedescendant={activeDomId}
            placeholder="搜索知识点、页面或动作…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              /* 查询变了，结果集也变了 —— 高亮必须回到第一条，否则会出现
                 「高亮停在第 7 条，而新结果只有 3 条」这种越界状态。锚点一并
                 清空，由上面的 effect 重新落在新结果的第一条知识点上。 */
              setActiveIndex(0);
              setScrollTop(0);
              setAnchorId(null);
              if (listRef.current !== null) listRef.current.scrollTop = 0;
            }}
            onKeyDown={onInputKeyDown}
            data-palette-input="true"
          />
          <span className="sm-palette__esc">esc</span>
        </div>

        <div
          ref={listRef}
          id={`${baseId}-list`}
          className="sm-palette__list"
          role="listbox"
          aria-label="命令面板结果"
          data-palette-rows={visibleRows.length}
          data-palette-options={renderedOptions}
          data-palette-total={allItems.length}
          data-palette-nodes={baseItems.filter((item) => item.kind === 'node').length}
          data-palette-active={activeItem?.id ?? ''}
          data-palette-ms={search.ms.toFixed(2)}
          data-palette-matches={search.matches}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {rows.length === 0 ? (
            <div className="sm-palette__empty">没有匹配的知识点或页面</div>
          ) : (
            <div className="sm-palette__spacer" style={{ height: viewport.totalHeight }}>
              <div
                className="sm-palette__window"
                style={{ transform: `translateY(${viewport.offset}px)` }}
              >
                {visibleRows.map((row) =>
                  row.type === 'header' ? (
                    <div
                      key={row.key}
                      className="sm-palette__row"
                      data-kind="header"
                      role="presentation"
                    >
                      {row.title}
                    </div>
                  ) : (
                    <div
                      key={row.key}
                      id={optionId(row.item)}
                      className="sm-palette__row"
                      role="option"
                      aria-selected={row.index === clampedIndex}
                      data-active={row.index === clampedIndex ? 'true' : 'false'}
                      data-kind={row.item.kind}
                      onMouseMove={() => pick(row.index)}
                      onClick={() => execute(row.item)}
                    >
                      <span className="sm-palette__name">{row.item.label}</span>
                      <span className="sm-palette__hint">{row.item.hint}</span>
                      {row.item.kind !== 'node' && (
                        <span className="sm-palette__badge">
                          {row.item.kind === 'page' ? '页面' : '动作'}
                        </span>
                      )}
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </div>

        <div className="sm-palette__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>选择
          </span>
          <span>
            <kbd>↵</kbd>执行
          </span>
          <span>
            <kbd>esc</kbd>关闭
          </span>
        </div>
      </div>
    </div>
  );
}
