import { useSyncExternalStore } from 'react';
import { REDUCED_MOTION_QUERY } from './tokens';

/**
 * 读一次系统的「减少动效」偏好。
 *
 * 每次调用都现场 `window.matchMedia`，不缓存：浏览器为同一查询串返回的每个
 * `MediaQueryList` 都是**活的**（读取 `.matches` 得到的是当前状态，`change`
 * 事件也会发给所有实例），所以「订阅 A、读 B」仍然正确。反过来缓存一个
 * 模块级实例会引入一处全局可变状态，测试之间互相污染，而省下的只是一次
 * 极小的对象分配。
 */
function queryList(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

function readReduced(): boolean {
  return queryList()?.matches ?? false;
}

function subscribeReduced(onStoreChange: () => void): () => void {
  const mql = queryList();
  if (mql === null) return () => {};

  // 老 Safari 只有 `addListener`。留着这条分支的成本是一行判断，收益是
  // 「用户改了系统偏好但页面不响应」这种只在旧设备上复现的缺陷。
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onStoreChange);
    return () => mql.removeEventListener('change', onStoreChange);
  }
  const legacy = mql as unknown as {
    addListener?: (cb: () => void) => void;
    removeListener?: (cb: () => void) => void;
  };
  legacy.addListener?.(onStoreChange);
  return () => legacy.removeListener?.(onStoreChange);
}

/**
 * 订阅 `prefers-reduced-motion`，返回当前是否要求减少动效。
 *
 * 为什么用 `useSyncExternalStore` 而不是 `useState + useEffect`：偏好可能在
 * 页面打开期间被改（macOS 的「减弱动态效果」就在系统设置里，用户随时会拨），
 * 而 `useState + useEffect` 的写法要么漏掉订阅、要么在订阅回调里读到一个
 * 闭包捕获的旧值。`useSyncExternalStore` 的 `getSnapshot` 每次渲染都重新读
 * 一次真实值，重渲染后必然正确——这正好是验收里「重渲染后仍正确」那条。
 *
 * 服务端快照恒为 `false`：这个应用是纯前端 SPA，没有 SSR 路径；给一个确定值
 * 只是为了让 `useSyncExternalStore` 在非浏览器环境不抛错。
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, () => false);
}
