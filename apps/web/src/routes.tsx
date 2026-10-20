import type { RouteObject } from 'react-router';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { MapPage } from './pages/MapPage';
import { NodeDetailPage } from './pages/NodeDetailPage';
import { DatabasePage } from './pages/DatabasePage';
import { LevelPage } from './pages/LevelPage';
import { SkillsPage } from './pages/PlaceholderPages';

/**
 * 路由表 —— **新增页面只改这一个文件**。
 *
 * 原来这张表写在 `App.tsx` 里，而 `App.tsx` 同时承担 Provider 分层与
 * QueryClient 配置。结果是「加一张页面」要改一个和页面无关的文件；多条
 * 泳道并行时，那是必然的撞车点。拆出来后：
 *
 *   - 本文件只管「路径 → 组件」；
 *   - `App.tsx` 只管 Provider 分层与路由实例化，不再认识任何页面。
 *
 * 页面直接 import，不用 `React.lazy`：六个页面都在首屏导航里，懒加载只会把
 * 「点一下菜单」换成一次网络往返 + 一次布局跳动，得不偿失。将来图谱画布这类
 * 重页面真要分包时，把它换成 `lazy(() => import(...))` 即可，本文件结构不变。
 *
 * 顶栏标签**不在这里**：导航文案住在 `components/AppShell.tsx`。反过来让
 * AppShell 从这里读会形成 `routes.tsx ↔ AppShell.tsx` 的循环 import（本仓库
 * 的 dependency-cruiser 有 `no-circular` 规则，会直接判违规）。
 */
export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'map', element: <MapPage /> },
      { path: 'map/:microKpId', element: <NodeDetailPage /> },
      { path: 'level/:levelId', element: <LevelPage /> },
      { path: 'database', element: <DatabasePage /> },
      { path: 'skills', element: <SkillsPage /> },
    ],
  },
];
