import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw';

/**
 * jsdom 缺三个浏览器 API，而 Fluent UI 的 MessageBar / TabList 会用到它们。
 *
 * 这不是「为了让测试通过而打桩」——这些 API 在真实浏览器里存在，缺失是
 * jsdom 的已知缺口。桩只保证「调用不抛异常」，不模拟尺寸计算，所以
 * 依赖真实布局的断言不该写在这里，那是 Playwright 的活。
 */
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

/**
 * MSW：默认拦截所有未匹配的请求并报错。
 *
 * `onUnhandledRequest: 'error'` 是刻意的 —— 组件测试里出现真实网络请求，
 * 说明要么忘了打桩、要么代码在测试环境还在打外网。两者都该立刻失败。
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' } as Parameters<typeof server.listen>[0]));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

