import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { appRoutes } from './routes';

/**
 * 应用根。
 *
 * 分层理由：`FluentProvider` 必须在最外层（它提供 design token 与方向上下文），
 * `QueryClientProvider` 次之（所有页面都要读数据），`RouterProvider` 最内
 * （只有页面组件关心路由）。
 *
 * QueryClient 默认 `staleTime: 30s` —— 学习工作台的数据（掌握度、节点列表）
 * 在一次会话内变动不频繁，切页面就重新拉会把后端打满且造成闪烁。
 *
 * 本文件**不认识任何页面**：路由表在 `routes.tsx`，加页面改那里。
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

const router = createBrowserRouter(appRoutes);

export function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </FluentProvider>
  );
}
