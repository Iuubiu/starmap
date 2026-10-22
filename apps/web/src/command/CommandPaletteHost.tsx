/**
 * 命令面板的挂载宿主 —— 把「路由实例」翻译成面板需要的两样东西。
 *
 * ## 为什么宿主在 `command/` 里，而不是直接写在 `App.tsx`
 *
 * `App.tsx` 的职责被刻意收窄成「Provider 分层 + 路由实例化」，它不认识任何
 * 页面、也不该认识任何功能的心智细节。宿主只有一件事：把 `router` 的
 * `navigate` 与「当前地址」接出来。把它放在面板旁边，`App.tsx` 只多一行
 * `<CommandPaletteHost router={router} />`。
 *
 * ## 为什么是 `router.subscribe` 而不是 `useLocation`
 *
 * 面板挂在 `<RouterProvider>` **外面**（它要能盖住任何路由，包括 404 与
 * 错误页；挂进路由树意味着每次加布局都要记得再挂一次）。路由上下文在那里
 * 不存在，`useLocation()` 会直接抛错。`router.subscribe` 是 react-router 暴露
 * 的稳定订阅口，拿到的是同一个 location，而且不依赖组件树位置。
 *
 * ## 「最近访问」为什么不挂在详情页里
 *
 * 挂在 `NodeDetailPage` 里最直观，但那意味着面板的可用性依赖某一个页面记得
 * 记录 —— 新增页面、深链、返回键都可能绕过它。挂在路由订阅上，**任何**进入
 * `/map/:microKpId` 的方式都会被记下来，且只需要一个文件。
 */

import { useCallback, useEffect } from 'react';
import type { RouteObject } from 'react-router';
import { CommandPalette } from './CommandPalette';
import { nodeIdFromPath, recordRecentNode } from './recent.js';

/**
 * 面板需要的最小路由能力。
 *
 * 刻意不 import react-router 的 `Router` 类型：那份类型把一个内部字段
 * （`state.history`）也带进来，于是测试里想喂一个假路由就得伪造整棵 history。
 * 结构化地声明「我只要这三个成员」，`createBrowserRouter()` 的返回值天然满足，
 * 单测里的假对象也天然满足。
 */
export interface PaletteRouter {
  navigate: (to: string) => unknown;
  subscribe: (listener: () => void) => () => void;
  state: { location: { pathname: string } };
}

export interface CommandPaletteHostProps {
  router: PaletteRouter;
  /** 覆盖路由表（测试用）。默认是真路由表，由面板自己兜底。 */
  routes?: RouteObject[];
}

/** 把 `/map/:id` 记进「最近访问」。其它地址忽略。 */
function rememberVisit(pathname: string): void {
  const microKpId = nodeIdFromPath(pathname);
  if (microKpId !== null) recordRecentNode(microKpId);
}

export function CommandPaletteHost({ router, routes }: CommandPaletteHostProps) {
  useEffect(() => {
    /* 订阅之前先把当前页记一次：用户可能直接深链进详情页再按 Cmd+K，
       那时一次导航都还没有发生。 */
    rememberVisit(router.state.location.pathname);
    return router.subscribe(() => rememberVisit(router.state.location.pathname));
  }, [router]);

  const onNavigate = useCallback(
    (to: string) => {
      void router.navigate(to);
    },
    [router],
  );

  return <CommandPalette onNavigate={onNavigate} routes={routes} />;
}
