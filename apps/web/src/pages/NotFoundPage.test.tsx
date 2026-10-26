import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { appRoutes } from '../routes';

/**
 * 兜底路由的守门测试。
 *
 * 为什么值得单独钉住：`path: '*'` 一旦被删掉，React Router 会静默回退到它
 * 内置的开发者错误页 —— 一整屏英文 +「💿 Hey developer 👋」。代码编译通过、
 * 类型检查通过、其它页面测试全绿，只有「学生改错一个字符的 URL」这一条路径会撞见它。
 * 这条测试存在的唯一目的就是让那个删除动作变红。
 */
function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  // V2Shell 挂载时会读会话列表（fetch + react-query），不套 QueryClientProvider
  // 会抛错并被 errorElement 接住 —— 那样测到的就是「出错页」而不是 404 页。
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <FluentProvider theme={webLightTheme}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </FluentProvider>,
  );
}

describe('未知路由的兜底页', () => {
  it('给中文说明与两个出口，而不是 React Router 的开发者错误页', () => {
    renderAt('/node/kp-does-not-exist-xyz');
    expect(screen.getByText('这一页不存在')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回看板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开知识地图' })).toBeInTheDocument();
    // 开发者错误页的特征串，出现即说明兜底没生效
    expect(screen.queryByText(/Hey developer/)).toBeNull();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  });

  it('把撞上的地址原样显示出来，学生才能看出哪里打错了', () => {
    renderAt('/mapp/kp-bool');
    expect(screen.getByText('/mapp/kp-bool')).toBeInTheDocument();
  });
});
