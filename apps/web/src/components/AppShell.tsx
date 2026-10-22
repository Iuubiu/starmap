import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { makeStyles, tokens, Button, TabList, Tab, Text, Spinner } from '@fluentui/react-components';
import {
  ArrowClockwise24Filled,
  ArrowClockwise24Regular,
  Board24Filled,
  Board24Regular,
  BrainCircuit24Filled,
  BookOpen24Filled,
  BookOpen24Regular,
  BrainCircuit24Regular,
  Clock24Filled,
  Clock24Regular,
  Database24Filled,
  Database24Regular,
  Dismiss24Regular,
  Map24Filled,
  Map24Regular,
  Navigation24Regular,
  Tag24Filled,
  Tag24Regular,
  Target24Filled,
  Target24Regular,
} from '@fluentui/react-icons';
import { useHealth } from '../api/queries';

/**
 * 主导航的八个入口。顺序与理由见 `AppShell.test.tsx`。
 *
 * `sub` 是「次级说明」（这个入口进去之后看到的是哪一层），显示在名称下方，
 * 不承载第二个导航目标 —— 真正的控件始终是 tab。
 *
 * `Icon` / `IconActive` 成对：未选中用 `...24Regular`（线性、退到次级文字色），
 * 选中用 `...24Filled`。图标库对八个入口都有成对变体，这是「激活态靠形状 +
 * 颜色一起说话」而不是只靠底色的前提。
 */
const NAV_ITEMS = [
  {
    value: '/learning',
    label: '学习记录',
    sub: '历次会话',
    Icon: Clock24Regular,
    IconActive: Clock24Filled,
  },
  {
    value: '/placement',
    label: '定级',
    sub: '三档判定',
    Icon: Target24Regular,
    IconActive: Target24Filled,
  },
  {
    value: '/review',
    label: '复验',
    sub: '间隔排期',
    Icon: ArrowClockwise24Regular,
    IconActive: ArrowClockwise24Filled,
  },
  {
    value: '/board',
    label: '看板',
    sub: '推荐与进度',
    Icon: Board24Regular,
    IconActive: Board24Filled,
  },
  {
    value: '/map',
    label: '知识地图',
    sub: '节点与出处',
    Icon: Map24Regular,
    IconActive: Map24Filled,
  },
  {
    value: '/market',
    label: '关卡市场',
    sub: '模板与生成',
    Icon: Tag24Regular,
    IconActive: Tag24Filled,
  },
  {
    value: '/database',
    label: '数据库',
    sub: '教材与索引',
    Icon: Database24Regular,
    IconActive: Database24Filled,
  },
  {
    value: '/library',
    label: '内容库',
    sub: '教材·期刊·题库·技能',
    Icon: BookOpen24Regular,
    IconActive: BookOpen24Filled,
  },
  {
    value: '/skills',
    label: '技能库',
    sub: '技能说明',
    Icon: BrainCircuit24Regular,
    IconActive: BrainCircuit24Filled,
  },
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

/**
 * 低端 GPU 退化探针。
 *
 * 背景是 5 个大半径 `blur()` 的漂移层 + 全屏 `backdrop-filter`，在集成显卡上
 * 可能掉到 20fps 以下。这里采样 45 帧：中位帧间隔超过 28ms（≈36fps）就认定
 * 这台机器吃不住，把 `<html data-sm-lowfx="true">` 打开，`glass.css` 里对应
 * 的规则会停掉漂移、关掉膜的高斯模糊，只留静态渐变。
 *
 * 判定**只降不升**：一旦退化就保持，避免「跑一会儿又试一次」造成的闪烁。
 * 探针本身在 rAF 里做，开销是一次减法 + 一次数组 push，可以忽略。
 */
function useLowFxProbe(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    const root = document.documentElement;
    if (root.dataset.smLowfx === 'true') return;

    const gaps: number[] = [];
    let last = 0;
    let raf = 0;
    let done = false;

    const tick = (now: number) => {
      if (done) return;
      if (last > 0) gaps.push(now - last);
      last = now;
      if (gaps.length < 45) {
        raf = window.requestAnimationFrame(tick);
        return;
      }
      done = true;
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      if (median > 28) root.dataset.smLowfx = 'true';
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      done = true;
      window.cancelAnimationFrame(raf);
    };
  }, []);
}

/** 内容区留白与外壳自身的样式（液态形状在 `theme/glass.css`）。 */
const useStyles = makeStyles({
  compactBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 4px 10px',
  },
  compactTitle: {
    fontSize: '13px',
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '0.01em',
  },
  drawerClose: {
    marginLeft: 'auto',
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
 * 没有命中时返回 `null`（而不是偷偷落回第一项）：
 * - `/` 是「对话」本身，不是「学习记录」列表。把它高亮成学习记录会让
 *   「我现在在哪」说谎 —— 首页的标题已经写着「学习」，导航再去抢这一格
 *   没有必要。同理 `/level/...`、`/welcome`、`/me` 也不属于任何一项。
 * - `TabList` 的 `selectedValue` 传 `undefined` 就是不选中任何项，行为明确；
 *   悄悄落回第一项则会让「什么路径都不匹配」这个 bug 变成一次高亮。
 */
export function selectedNavValue(pathname: string): string | null {
  let best: string | null = null;
  for (const item of NAV_ITEMS) {
    if (pathname === item.value || pathname.startsWith(`${item.value}/`)) {
      if (best === null || item.value.length > best.length) best = item.value;
    }
  }
  return best;
}

/**
 * 应用外壳：液态玻璃 + 液态流动的导航与内容容器。
 *
 * ## 结构（三层，z 轴自下而上）
 *
 * 1. `.sm-liquid-bg`：5 个 blur 光团在缓慢漂移/缩放/形变（40–90s）。
 * 2. `.sm-liquid-sheet`：一张**全屏**毛玻璃膜。它同时盖住背景与导航，所以
 *    导航和背景是同一张玻璃 —— 侧栏没有自己的背景色、没有右侧描边，中间
 *    不存在接缝。这是「一体化」的物理实现，不是靠把两块颜色调成一样。
 * 3. `.sm-shell-grid`：三列 —— 图标轨道 56px + 导航列 216px + 内容列
 *    `minmax(0, 1fr)`。窄屏只有两列（56px + 内容），导航进抽屉。
 *
 * ## 为什么是「三列」而不是「一条会伸缩的侧栏」
 *
 * 票 76 的验收是「正文左右间隙相等」。间隙不对称的来源有两个：滚动条只吃
 * 一侧、居中算式叠在滚动容器上。三列结构把这两件事都从结构上消掉：图标轨
 * 与导航列都是定宽，内容列吃掉剩余宽度，再从内容列里划出对称的三段。
 *
 * ## 无障碍
 *
 * - `<nav aria-label="主导航">` 一个地标，八个入口全在里面。
 * - 保留 `TabList`/`Tab` 与 `role=tab`：仓库里的 e2e（`graph.spec.ts`、
 *   `smoke.spec.ts`）与 `tools/eval` 的阶段驱动都按 `role=tab` +
 *   `aria-selected` 找导航项。宽屏名称常驻；窄屏名称在抽屉里，可访问名由
 *   `aria-label` 提供 —— 名字在任何形态下都不丢。
 * - 首个可聚焦元素是「跳到主要内容」。
 * - 抽屉按钮带 `aria-expanded` 与 `aria-controls="app-nav"`，`Esc` 可关，
 *   选中入口后自动收起；宽屏下这个按钮根本不渲染。
 */
export function AppShell() {
  const styles = useStyles();
  const location = useLocation();
  const navigate = useNavigate();
  const health = useHealth();
  const narrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useLowFxProbe();

  const selected = selectedNavValue(location.pathname);
  /*
   * 票 83：地图页走 wide 模式。
   *
   * 「wide」只表示**不进阅读式列**：内容区不再给自己加阅读宽度上限，整幅交给
   * 页面（地图页内部是 `minmax(0,1fr) 340px`：画布 + 右侧节点清单）。
   * 这里按路径判断而不是给 `Outlet` 传 context：只有一个页面需要 wide，
   * 为它引入一层路由上下文会把「外壳不知道页面」这条线弄脏。
   */
  const wide = location.pathname === '/map' || location.pathname.startsWith('/map/');

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

  const onTabSelect = useCallback(
    (value: string) => {
      navigate(value);
      setDrawerOpen(false);
    },
    [navigate],
  );

  const tabList = (
    <TabList
      vertical
      className="sm-tablist"
      selectedValue={selected ?? undefined}
      onTabSelect={(_, data) => onTabSelect(data.value as string)}
    >
      {NAV_ITEMS.map(({ value, label, Icon, IconActive }) => {
        const active = value === selected;
        const Glyph = active ? IconActive : Icon;
        return (
          <Tab key={value} value={value} className="sm-nav-item" aria-label={label}>
            {/*
             * 激活项换成 `...24Filled`，并把变体名写进 className：
             * 图标「实心」这件事是**元素事实**，不靠 CSS 伪装。`sm-nav-icon-Filled`
             * 是给验收脚本与后来人看的锚点（`classList` 里能直接读到 Filled）。
             */}
            <span
              className={active ? 'sm-nav-icon sm-nav-icon-Filled' : 'sm-nav-icon'}
              aria-hidden="true"
            >
              <Glyph />
            </span>
            <span className="sm-nav-label">{label}</span>
          </Tab>
        );
      })}
    </TabList>
  );

  const status = (
    <div className="sm-status">
      {health.isPending && <Spinner size="extra-tiny" />}
      {health.isError && <span className="sm-status-text">后端未连接</span>}
      {health.payload && <span className="sm-status-text">数据库 {health.payload.dbNow.slice(11, 19)}</span>}
    </div>
  );

  const brandMark = (
    <span className="sm-brand-mark" aria-hidden="true">
      S
    </span>
  );

  return (
    <div
      className="sm-shell"
      data-nav={narrow ? 'narrow' : 'wide'}
      data-drawer={drawerOpen ? 'open' : 'closed'}
    >
      {/* 1. 流动的背景：五个 blur 光团。装饰性，不进无障碍树。 */}
      <div className="sm-liquid-bg" aria-hidden="true">
        <div className="sm-blob" />
        <div className="sm-blob" />
        <div className="sm-blob" />
        <div className="sm-blob" />
        <div className="sm-blob" />
      </div>
      {/* 2. 全屏毛玻璃膜：背景与导航共用这一张，因此没有接缝。 */}
      <div className="sm-liquid-sheet" aria-hidden="true" />

      <a className="sm-skip" href="#main">
        跳到主要内容
      </a>

      <div className="sm-shell-grid">
        {/* 第 1 列：56px 图标轨道。只放品牌标记与窄屏的抽屉入口。 */}
        <aside className="sm-rail">
          {brandMark}
          {narrow && (
            <Button
              appearance="subtle"
              icon={<Navigation24Regular />}
              aria-label="打开导航"
              aria-expanded={drawerOpen}
              aria-controls="app-nav"
              onClick={() => setDrawerOpen(true)}
            />
          )}
        </aside>

        {/* 第 2 列：216px 导航列。宽屏常驻；窄屏整列不渲染（导航进抽屉）。 */}
        {!narrow && (
          <div className="sm-nav-panel">
            <div className="sm-brand-row">
              <span className="sm-brand-text">
                <span className="sm-brand-name">StarMap</span>
                <span className="sm-brand-caption">核电子学学习工作站</span>
              </span>
            </div>
            <nav className="sm-nav" id="app-nav" aria-label="主导航">
              {tabList}
            </nav>
          </div>
        )}

        {narrow && drawerOpen && (
          <div className="sm-scrim" role="presentation" onClick={() => setDrawerOpen(false)} />
        )}

        {narrow && (
          <div className="sm-drawer" id="app-nav" data-open={drawerOpen ? 'true' : 'false'}>
            <div className="sm-brand-row">
              {brandMark}
              <span className="sm-brand-text">
                <span className="sm-brand-name">StarMap</span>
                <span className="sm-brand-caption">核电子学学习工作站</span>
              </span>
              <Button
                appearance="subtle"
                className={styles.drawerClose}
                icon={<Dismiss24Regular />}
                aria-label="收起导航"
                onClick={() => setDrawerOpen(false)}
              />
            </div>
            <nav className="sm-nav" aria-label="主导航">
              {tabList}
            </nav>
          </div>
        )}

        {/* 第 3 列：内容区。三段式对称留白在 `glass.css` 的 `.sm-page-in` 上。 */}
        <div className="sm-content">
          {narrow && (
            <header className={styles.compactBar}>
              <Text className={styles.compactTitle}>StarMap</Text>
            </header>
          )}
          {status}
          <div className="sm-stage">
            <main className="sm-main" id="main">
              <div
                className="sm-page-in"
                key={location.pathname}
                data-wide={wide ? 'true' : undefined}
              >
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
