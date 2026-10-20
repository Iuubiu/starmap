import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DashboardPage } from './pages/DashboardPage';
import { MapPage } from './pages/MapPage';
import { NodeDetailPage } from './pages/NodeDetailPage';
import { DatabasePage } from './pages/DatabasePage';
import { LevelPage, SkillsPage } from './pages/PlaceholderPages';
import { AppShell } from './components/AppShell';

/**
 * 应用根。
 *
 * 分层理由：`FluentProvider` 必须在最外层（它提供 design token 与方向上下文），
 * `QueryClientProvider` 次之（所有页面都要读数据），`RouterProvider` 最内
 * （只有页面组件关心路由）。
 *
 * QueryClient 默认 `staleTime: 30s` —— 学习工作台的数据（掌握度、节点列表）
 * 在一次会话内变动不频繁，切页面就重新拉会把后端打满且造成闪烁。
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * 六个页面在票 01 就全部定下路由，后面每票只填内容不改路由。
 * 后三个（数据库、技能库、关卡播放）当前是占位页。
 */
const router = createBrowserRouter([
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
]);

export function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </FluentProvider>
  );
}
