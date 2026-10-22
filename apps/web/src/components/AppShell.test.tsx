import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AppShell, selectedNavValue } from './AppShell';

/**
 * 侧栏「当前在哪」的测试。
 *
 * 为什么需要它：仓库里所有导航测试都在测「点了会跳转」，没有一个测「当前
 * 路径对应哪个标签被选中」。于是 `selected` 的推导链曾被漏掉一整条分支 ——
 * `/market` 一路落到默认 `'/'`，在市场页时顶栏五个标签一个都不高亮。这类
 * bug 不会让任何现有测试变红，也不会抛异常，只有人眼在浏览器里才发现。
 *
 * 断言对象是 ARIA 状态（`aria-selected`）与**可访问名**，不是 class 名，也
 * 不是 `textContent`：Fluent UI 的 Tab 在 DOM 里有一份视觉隐藏的副本用于
 * 测量，`textContent` 会得到「知识地图知识地图」，而屏幕阅读器读到的是
 * 「知识地图」。用 `getByRole('tab', { name })` 走的就是可访问名计算，
 * 顺便把这个差异钉住 —— 我在票 20 的 Playwright 采集器里正是踩了这个坑，
 * 它一度让报告里出现一堆「采集器制造的」假可访问名缺陷。
 *
 * 用 MSW 而不是 mock hook：AppShell 的依赖只有 `useHealth` 一个，走真实
 * fetch 的代价很小，换来的是「不会因为查询层重命名而整片测试失效」。
 */

const renderAt = (path: string) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<div>学习内容</div>} />
              <Route path="board" element={<div>看板内容</div>} />
              <Route path="placement" element={<div>定级内容</div>} />
              <Route path="map" element={<div>地图内容</div>} />
              <Route path="map/:microKpId" element={<div>详情内容</div>} />
              <Route path="market" element={<div>市场内容</div>} />
              <Route path="database" element={<div>数据库内容</div>} />
              <Route path="skills" element={<div>技能库内容</div>} />
              {/*
               * 兜底路由：`/level/:levelId` 在这里没有声明对应的页面，但不该
               * 因此让整个 AppShell 不渲染 —— 顶栏是否高亮与「这个路径有没有
               * 页面」是两件事。真实 App 里 routes.tsx 声明了 level 路由，
               * 这里故意留着不声明，好让「未知子路径下顶栏仍然正确」也被测到。
               */}
              <Route path="*" element={<div>其他内容</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
};

/** 当前被选中的标签的可访问名；一个都没选中时返回 null。 */
const selectedTabLabel = (): string | null => {
  const tabs = screen.getAllByRole('tab');
  const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
  if (selected.length === 0) return null;
  // 多于一个说明 TabList 的受控值写错了，直接报出来比返回第一个更有用。
  expect(selected).toHaveLength(1);
  // 用 `getByRole` 反查可访问名：它吃的就是 aria-selected 为 true 的那个元素。
  const el = selected[0] as HTMLElement;
  for (const name of ['学习', '定级', '复验', '看板', '知识地图', '关卡市场', '数据库', '技能库']) {
    if (screen.queryByRole('tab', { name, selected: true }) === el) return name;
  }
  throw new Error(`选中的标签可访问名不在预期列表里：${el.outerHTML.slice(0, 120)}`);
};

describe('AppShell 顶栏选中态', () => {
  it('八个标签按顺序渲染，且可访问名正确', () => {
    renderAt('/');
    // 顺序 + 可访问名一次断言。`getAllByRole` 返回的是文档顺序，正是标签的
    // 视觉顺序；用可访问名而不是 textContent，理由见文件头。
    //
    // 「学习」排第一不是排版偏好：`/` 是智能体主页，最常用的入口必须最左。
    // 票 01 时这里第一项是「看板」（知识点陈列），票 08 之后 `/` 换成
    // 结构化回合页，看板退到 `/board`。
    //
    // 「定级」紧跟「学习」而不放最后：定级是**入学时要走一次**的入口，
    // 放在一排功能页的最右边等于把它当成又一个查询工具，而它其实是
    // 「我是谁」这个前提。放第二位也不会挤掉五个主页面。
    //
    // 「复验」跟在「定级」之后：两者都是「系统叫你去做一件事」的入口，
    // 不是查询工具。复验的依据是到期了（`next_review_at <= now`），
    // 而不是学生自己想看什么。
    const names = ['学习', '定级', '复验', '看板', '知识地图', '关卡市场', '数据库', '技能库'];
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(names.length);
    for (const name of names) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    // 再钉一次顺序：每个标签的可访问名必须能在对应位置上找到。
    for (const [i, name] of names.entries()) {
      expect(screen.getAllByRole('tab')[i]).toBe(screen.getByRole('tab', { name }));
    }
    for (const tab of tabs) {
      expect(tab).toHaveAttribute('aria-selected');
    }
  });

  it.each([
    ['/', '学习'],
    ['/placement', '定级'],
    ['/review', '复验'],
    ['/board', '看板'],
    ['/map', '知识地图'],
    ['/database', '数据库'],
    ['/skills', '技能库'],
    ['/market', '关卡市场'],
  ])('路径 %s 时选中的是「%s」', (path, expected) => {
    renderAt(path);
    expect(selectedTabLabel()).toBe(expected);
  });

  it.each([
    ['/map/kp-bool', '知识地图'],
    ['/map/kp-bool/extra', '知识地图'],
    // `/placement/...` 这类子路径也归到「定级」，而不是掉回默认的「学习」。
    ['/placement/result', '定级'],
    ['/review/rounds/r-1', '复验'],
    // 关卡内页不属于任何顶栏标签，按「回到最常用的那个」处理。
    ['/level/lv-bool-laws', '学习'],
  ])('子路径 %s 时选中的是「%s」', (path, expected) => {
    renderAt(path);
    expect(selectedTabLabel()).toBe(expected);
  });

  it('/market 不会误选「知识地图」', () => {
    // `/market`.startsWith('/map') 是 false（第 4 个字符是 r 不是 p），
    // 但这个判断值得钉死：`/map` 和 `/market` 共享前四个字符，任何人把
    // startsWith 换成 includes 或 startsWith('/ma') 都会让市场页高亮错。
    renderAt('/market');
    expect(selectedTabLabel()).toBe('关卡市场');
  });

  it('任何路径都恰好有一个标签被选中（不会出现零个或多个）', () => {
    // 反向验证过：把 `/market` 分支删掉，这条**仍然是绿的** —— 因为
    // `/market` 会落到默认 `'/'`，仍然恰好一个被选中，只是选错了。
    // 「选中了错误的标签」由上面的 `it.each` 抓。这条守的是另一类问题：
    // 推导链被改成返回 undefined / 返回多个，那会让 TabList 完全不高亮
    // 或同时高亮两个，而 `it.each` 在那种情况下报的是「期望 A 得到 B」，
    // 不如这条直接。两条一起才盖住「选中错、没选中、选中多个」。
    for (const path of [
      '/',
      '/placement',
      '/review',
      '/board',
      '/map',
      '/market',
      '/database',
      '/skills',
      '/level/lv-1',
    ]) {
      const { unmount } = renderAt(path);
      const tabs = screen.getAllByRole('tab');
      const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
      expect(selected, `路径 ${path} 应恰好选中一个标签`).toHaveLength(1);
      unmount();
    }
  });

  it('内容区渲染子路由，且侧栏不随路径消失', () => {
    renderAt('/market');
    expect(screen.getByText('市场内容')).toBeInTheDocument();
    /* 改成侧栏之后品牌不再在 `banner` 里：宽屏没有顶栏（窄屏那条 48px 窄条
       是 `display:none`，从无障碍树里被移除）。所以断言落在**主导航地标**
       里 —— 那才是「外壳的固定部分」现在所在的位置。 */
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav.closest('aside') as HTMLElement).getByText('StarMap')).toBeInTheDocument();
  });
});

/**
 * 侧栏改造（顶栏 → 侧边导航栏）新增的行为。
 *
 * 为什么要单独一组：上面那组测的是「路径 → 哪个入口高亮」，与外壳长什么样
 * 无关，改布局时它们应当全部保持绿。这一组测的是**新布局才有的东西**：
 * 导航地标、抽屉开合、跳过导航的跳转链接，以及那个把顶栏撑爆的宽度问题
 * 在结构上是否真的消失了。
 */
/**
 * 把 `matchMedia` 伪装成「窄屏」，让 `useIsNarrow()` 走抽屉分支。
 *
 * jsdom 的 `matchMedia` 恒返回 `matches: false`（永远当宽屏），所以抽屉相关的
 * 断言必须先改造它。只对窄屏那条 query 返回 true，其它 query 保持 false ——
 * Fluent 自己也会问 matchMedia（强制色、减弱动效），全局返回 true 会顺带改变
 * 它们的渲染，让这条测试的失败原因变得不可信。
 */
function stubNarrowViewport() {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('max-width: 767px'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe('AppShell 侧栏与抽屉', () => {
  it('宽屏下不渲染抽屉入口（导航是常驻侧栏，没有可展开的东西）', () => {
    renderAt('/');
    expect(screen.queryByRole('button', { name: '打开导航' })).toBeNull();
    expect(screen.queryByRole('button', { name: '收起导航' })).toBeNull();
  });

  it('侧栏是带名字的 navigation 地标，八个入口都在它里面', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: '主导航' });
    const tabs = within(nav).getAllByRole('tab');
    expect(tabs).toHaveLength(8);
    // 全部入口必须在导航地标内，不能散落在页面其它地方 —— 否则屏幕阅读器
    // 的「跳到导航」会漏掉一部分。
    for (const name of ['学习', '定级', '复验', '看板', '知识地图', '关卡市场', '数据库', '技能库']) {
      expect(within(nav).getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('第一个可聚焦元素是「跳到主要内容」，且它指向 main', () => {
    renderAt('/');
    const skip = screen.getByRole('link', { name: '跳到主要内容' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(document.getElementById('main')).not.toBeNull();
  });

  it('抽屉按钮存在、默认收起，点击后展开', () => {
    const restore = stubNarrowViewport();
    renderAt('/');
    const opener = screen.getByRole('button', { name: '打开导航' });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    // 指向抽屉本体：`aria-controls` 指错 id 时，辅助技术会认为「没有可展开的东西」。
    expect(opener).toHaveAttribute('aria-controls', 'app-nav');
    expect(document.getElementById('app-nav')).not.toBeNull();
    restore();
  });

  it('选中任一个入口后，抽屉自己收起', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const restore = stubNarrowViewport();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: '打开导航' }));
    expect(screen.getByRole('button', { name: '打开导航' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: '看板' }));
    restore();
    /* 换页会触发 `setDrawerOpen(false)`；断言回到收起态而不是断言 DOM 被移除，
       因为收起态的抽屉仍然在文档里（靠 translateX 移出视野）。 */
    expect(screen.getByRole('button', { name: '打开导航' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('抽屉开着时按 Esc 收起', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const restore = stubNarrowViewport();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: '打开导航' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: '打开导航' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    restore();
  });
});

describe('selectedNavValue：路径 → 入口', () => {
  it.each([
    ['/', '/'],
    ['/board', '/board'],
    ['/market', '/market'],
    ['/market/generate', '/market'],
    ['/map', '/map'],
    ['/map/kp-bool', '/map'],
    ['/placement/result', '/placement'],
    ['/review/rounds/r-1', '/review'],
    // 关卡内页不属于任何入口，落回「学习」。
    ['/level/lv-bool-laws', '/'],
    // 前缀相同但不是同一段路径：不能因为 `/maple` 以 `/map` 开头就算地图。
    ['/maple', '/'],
  ])('%s → %s', (pathname, expected) => {
    expect(selectedNavValue(pathname)).toBe(expected);
  });
});
