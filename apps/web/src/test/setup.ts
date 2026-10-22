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
 * `WebGL2RenderingContext` 的常量表（jsdom 完全没有这个全局）。
 *
 * sigma 在**模块加载时**就读 `WebGL2RenderingContext.UNSIGNED_BYTE` 等常量来
 * 构造它的渲染层描述，所以只要任何组件（或它的 import 链）碰到 `sigma`，
 * jsdom 里就是 `ReferenceError` —— 连 import 都过不去，测试文件在收集阶段
 * 就红。
 *
 * 这里只补常量、不补构造函数：jsdom 没有 WebGL 上下文，`new Sigma(...)` 该
 * 失败还是失败。组件测试要测图谱交互，请 mock 掉 sigma 的实例（渲染逻辑归
 * Playwright 的端到端测试，见票 03）。数值是 WebGL 规范里的定值，抄错会让
 * 渲染参数静默变形，所以别改。
 */
if (!('WebGL2RenderingContext' in globalThis)) {
  (globalThis as Record<string, unknown>).WebGL2RenderingContext = {
    ZERO: 0,
    ONE: 1,
    FUNC_ADD: 0x8006,
    BOOL: 0x8b56,
    BYTE: 0x1400,
    UNSIGNED_BYTE: 0x1401,
    SHORT: 0x1402,
    UNSIGNED_SHORT: 0x1403,
    INT: 0x1404,
    UNSIGNED_INT: 0x1405,
    FLOAT: 0x1406,
    TEXTURE0: 0x84c0,
  };
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

