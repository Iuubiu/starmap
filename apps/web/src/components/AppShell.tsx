import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import {
  makeStyles,
  tokens,
  Button,
  TabList,
  Tab,
  Text,
  Spinner,
} from '@fluentui/react-components';
import {
  ArrowClockwise24Regular,
  Board24Regular,
  BookOpen24Regular,
  BrainCircuit24Regular,
  Database24Regular,
  Dismiss24Regular,
  Map24Regular,
  Navigation24Regular,
  Tag24Regular,
  Target24Regular,
} from '@fluentui/react-icons';
import { useHealth } from '../api/queries';

/**
 * 主导航的八个入口。顺序与理由见 `AppShell.test.tsx`。
 *
 * 图标只是**补充**，不是唯一的识别方式：窄屏下也始终保留文字（见下面
 * 宽度断点的说明），所以不会出现「只有图标、靠猜」的导航。
 */
const NAV_ITEMS = [
  { value: '/', label: '学习', Icon: BookOpen24Regular },
  { value: '/placement', label: '定级', Icon: Target24Regular },
  { value: '/review', label: '复验', Icon: ArrowClockwise24Regular },
  { value: '/board', label: '看板', Icon: Board24Regular },
  { value: '/map', label: '知识地图', Icon: Map24Regular },
  { value: '/market', label: '关卡市场', Icon: Tag24Regular },
  { value: '/database', label: '数据库', Icon: Database24Regular },
  { value: '/skills', label: '技能库', Icon: BrainCircuit24Regular },
] as const;

/**
 * 窄屏判定：宽度 ≤767px 时导航变成抽屉。
 *
 * ## 为什么用 matchMedia 而不是只在 CSS 里写媒体查询
 *
 * 纯 CSS 的写法在浏览器里没问题，但它让「抽屉按钮」在桌面宽度下也存在于
 * DOM 中（`display:none`）。这样两件事都测不到：单测里 jsdom 会应用 Griffel
 * 注入的样式表，于是按钮不可见、`getByRole` 找不到它；而人审代码时会误以为
 * 桌面也有一个多余的按钮。把分支放进 JS 之后，「窄屏才有抽屉入口」这件事
 * 既是**代码事实**，也能被测试直接驱动。
 *
 * 「不渲染」与「渲染但 CSS 藏起来」对无障碍是等价的（`display:none` 的元素
 * 本来就不可聚焦、不在无障碍树里），所以这里没有牺牲可达性换可测性。
 */
function useIsNarrow(query = '(max-width: 767px)'): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    /* 立刻同步一次：首次渲染到 effect 之间窗口可能已经变了。 */
    setNarrow(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return narrow;
}

/** 侧栏在 1024px 以上、收窄侧栏在 768–1023px、抽屉在 768px 以下。 */
const RAIL_WIDE = '240px';
const RAIL_NARROW = '200px';

const useStyles = makeStyles({
  root: {
    display: 'grid',
    gridTemplateColumns: `${RAIL_WIDE} minmax(0, 1fr)`,
    height: '100vh',
    backgroundColor: tokens.colorNeutralBackground2,
    '@media (max-width: 1023px)': {
      gridTemplateColumns: `${RAIL_NARROW} minmax(0, 1fr)`,
    },
    /* 窄屏侧栏变成抽屉，不再占列 —— 这一行同时消掉「固定宽度把 shell
       撑宽」那类横向溢出（顶栏版本的实测症状是 375px 窗口溢出 304px）。 */
    '@media (max-width: 767px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },

  skipLink: {
    position: 'absolute',
    left: '8px',
    top: '8px',
    zIndex: 3,
    padding: '8px 12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    boxShadow: tokens.shadow16,
    transform: 'translateY(-200%)',
    ':focus': { transform: 'translateY(0)' },
  },

  rail: {
    gridColumn: '1',
    gridRow: '1',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    /* 窄屏：脱离网格流，变成从左滑入的抽屉。关闭态用 `translateX(-100%)`
       而不是 `display:none`，这样过渡动画存在、且元素始终可被 `aria-controls`
       指向（`display:none` 会让它从无障碍树里消失，按钮的 aria-controls
       就指向一个不存在的东西）。 */
    '@media (max-width: 767px)': {
      position: 'fixed',
      top: '0',
      bottom: '0',
      left: '0',
      width: RAIL_WIDE,
      zIndex: 2,
      transform: 'translateX(-100%)',
      transitionProperty: 'transform',
      transitionDuration: tokens.durationNormal,
      transitionTimingFunction: tokens.curveEasyEase,
      boxShadow: tokens.shadow64,
      '&[data-open="true"]': { transform: 'translateX(0)' },
    },
  },

  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '16px 16px 12px',
  },
  brand: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    letterSpacing: '0.02em',
  },
  brandCaption: {
    color: tokens.colorNeutralForeground3,
    padding: '0 16px 12px',
  },
  /* 抽屉里的「收起」只在窄屏渲染（见 useIsNarrow），宽屏没有可收的东西。 */
  closeButton: {
    marginLeft: 'auto',
  },

  nav: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '0 8px',
  },
  tabList: {
    width: '100%',
    alignItems: 'stretch',
  },
  tab: {
    justifyContent: 'flex-start',
    width: '100%',
    paddingLeft: '10px',
  },

  status: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '12px 16px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    minHeight: '44px',
  },

  content: {
    gridColumn: '2',
    gridRow: '1',
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr)',
    minWidth: 0,
    minHeight: 0,
    '@media (max-width: 767px)': { gridColumn: '1' },
  },

  /* 窄屏顶部只留一条「打开导航」的窄条；宽屏根本不渲染它。 */
  compactBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 12px',
    height: '48px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },

  main: {
    overflow: 'auto',
    /* `minmax(0,1fr)` + `minWidth:0` 一起用：只写其中一个时，网格项仍然会被
       内部超宽内容（表格、画布）顶出去，表现为整页横向滚动。 */
    minWidth: 0,
  },

  scrim: {
    display: 'none',
    '@media (max-width: 767px)': {
      display: 'block',
      position: 'fixed',
      inset: 0,
      zIndex: 1,
      backgroundColor: tokens.colorBackgroundOverlay,
    },
  },
});

/**
 * 把当前路径映射到主导航的一个入口。
 *
 * 用「最长前缀 + 路径边界」而不是一串 `startsWith`：`/map` 与 `/market`
 * 共享前四个字符，靠人肉排分支顺序判断的写法一旦被改成 `includes` 或
 * `startsWith('/ma')`，市场页就会高亮成知识地图。这里要求 `value` 之后
 * 紧跟 `/` 或结束，且取最长命中，所以 `/market` 只会命中 `/market`。
 *
 * 关卡内页（`/level/...`）不属于任何一个入口，落回默认的「学习」。
 */
export function selectedNavValue(pathname: string): string {
  let best = '/';
  for (const item of NAV_ITEMS) {
    if (item.value === '/') continue;
    if (pathname === item.value || pathname.startsWith(`${item.value}/`)) {
      if (item.value.length > best.length) best = item.value;
    }
  }
  return best;
}

/**
 * 应用外壳：左侧导航 + 内容区。
 *
 * ## 为什么是侧栏而不是顶栏
 *
 * 顶栏要横着排八个入口，宽度是由**最长的标签组合**决定的固定值（实测
 * `TabList` 固定 500px 把 shell 撑到 679px），于是任何比它窄的窗口都会
 * 横向溢出：375px 窗口溢出 304px —— 整页可横向拖动，顶栏被截断。侧栏
 * 把导航放在竖直方向，宽度是**我们选的**而不是内容撑出来的，横向溢出
 * 这个失效模式就从结构上消失了。
 *
 * 侧栏还能放两样顶栏放不下的东西：产品定位（副标题）与后端状态。状态
 * 放在最底部而不是右上角，是因为它验证的是「后端真的连上了数据库」这条
 * 最小闭环（票 01 的验收要求），属于常驻但不打扰的信息。
 *
 * ## 为什么窄屏用抽屉而不是图标栏
 *
 * 八个入口里有五个是两个字、三个是四个字的中文。图标栏要用户先学会
 * 「哪个图标是复验」，而抽屉只在需要时占屏，文字始终在。抽屉打开时
 * 背景压一层遮罩、`Esc` 可关、选中入口后自动收起。
 *
 * ## 无障碍
 *
 * - `<nav aria-label="主导航">` 给侧栏一个地标名（页面里只有一个导航地标）。
 * - 保留 `TabList`/`Tab` 而不改成链接：仓库里的 e2e（`graph.spec.ts`、
 *   `smoke.spec.ts`）与 `tools/eval` 的阶段驱动都按 `role=tab` +
 *   `aria-selected` 找导航项，改成链接会同时改三处调用方，而这次改动
 *   要解决的是**布局**问题。语义化改造（`<a aria-current="page">`）单独做。
 * - 抽屉按钮带 `aria-expanded` 与 `aria-controls`，并在窄屏外不渲染。
 * - 首屏第一个可聚焦元素是「跳到主要内容」，跳过八个导航项。
 */
export function AppShell() {
  const styles = useStyles();
  const location = useLocation();
  const navigate = useNavigate();
  const health = useHealth();
  const narrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const selected = selectedNavValue(location.pathname);

  /* 回到宽屏时抽屉没有意义了（那时导航是常驻侧栏），顺手收起状态，
     否则下次缩到窄屏会突然发现抽屉是开着的。 */
  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);

  /* 换页面就收起抽屉：抽屉是「临时展开」，留在别的页面上开着没有意义。 */
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  /* 抽屉开着时 `Esc` 关闭。挂在 window 上而不是抽屉节点上，因为焦点可能
     还在触发按钮上（用户点开就按 Esc 是最自然的动作）。 */
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const status = (
    <div className={styles.status}>
      {health.isPending && <Spinner size="extra-tiny" />}
      {health.isError && <Text size={200}>后端未连接</Text>}
      {health.payload && <Text size={200}>数据库 {health.payload.dbNow.slice(11, 19)}</Text>}
    </div>
  );

  return (
    <div className={styles.root}>
      <a className={styles.skipLink} href="#main">
        跳到主要内容
      </a>

      <aside className={styles.rail} id="app-nav" data-open={drawerOpen ? 'true' : 'false'}>
        <div className={styles.brandRow}>
          <Text className={styles.brand}>StarMap</Text>
          {narrow && (
            <Button
              appearance="subtle"
              className={styles.closeButton}
              icon={<Dismiss24Regular />}
              aria-label="收起导航"
              onClick={() => setDrawerOpen(false)}
            />
          )}
        </div>
        <Text size={200} className={styles.brandCaption}>
          核电子学学习工作站
        </Text>

        <nav className={styles.nav} aria-label="主导航">
          <TabList
            vertical
            className={styles.tabList}
            selectedValue={selected}
            onTabSelect={(_, data) => {
              navigate(data.value as string);
              setDrawerOpen(false);
            }}
          >
            {NAV_ITEMS.map(({ value, label, Icon }) => (
              <Tab
                key={value}
                value={value}
                className={styles.tab}
                icon={<Icon />}
                aria-label={label}
              >
                {label}
              </Tab>
            ))}
          </TabList>
        </nav>

        {status}
      </aside>

      {narrow && drawerOpen && (
        <div
          className={styles.scrim}
          role="presentation"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div className={styles.content}>
        {narrow && (
          <header className={styles.compactBar}>
            <Button
              appearance="subtle"
              icon={<Navigation24Regular />}
              aria-label="打开导航"
              aria-expanded={drawerOpen}
              aria-controls="app-nav"
              onClick={() => setDrawerOpen(true)}
            />
            <Text className={styles.brand}>StarMap</Text>
          </header>
        )}
        <main className={styles.main} id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
