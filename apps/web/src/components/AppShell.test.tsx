import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AppShell } from './AppShell';

/**
 * 顶栏「当前在哪」的测试。
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
              <Route index element={<div>看板内容</div>} />
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
  for (const name of ['学习', '看板', '知识地图', '关卡市场', '数据库', '技能库']) {
    if (screen.queryByRole('tab', { name, selected: true }) === el) return name;
  }
  throw new Error(`选中的标签可访问名不在预期列表里：${el.outerHTML.slice(0, 120)}`);
};

describe('AppShell 顶栏选中态', () => {
  it('六个标签按顺序渲染，且可访问名正确', () => {
    renderAt('/');
    // 顺序 + 可访问名一次断言。`getAllByRole` 返回的是文档顺序，正是标签的
    // 视觉顺序；用可访问名而不是 textContent，理由见文件头。
    //
    // 「学习」排第一不是排版偏好：`/` 是智能体主页，最常用的入口必须最左。
    // 票 01 时这里第一项是「看板」（知识点陈列），票 08 之后 `/` 换成
    // 结构化回合页，看板退到 `/board`。
    const names = ['学习', '看板', '知识地图', '关卡市场', '数据库', '技能库'];
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

  it('内容区渲染子路由，且顶栏不随路径消失', () => {
    renderAt('/market');
    expect(screen.getByText('市场内容')).toBeInTheDocument();
    const header = screen.getByRole('banner');
    expect(within(header).getByText('StarMap')).toBeInTheDocument();
  });
});
