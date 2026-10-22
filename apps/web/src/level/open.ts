/**
 * 关卡浮层的门面（票 68）。
 *
 * ## 为什么要有这一层
 *
 * 浮层要能被三类调用方打开：`auto-open.ts` 的自动弹出（t69）、对话卡片的
 * 手动重开（t69）、关卡内部「进入下一关」的幂等替换。这三处都不该认识浮层
 * 的渲染方式（React 组件？DOM？iframe？），也不该认识它在组件树的哪个位置。
 * 所以外面只有两个动词：`openLevel(levelId)` 与 `closeLevel(reason)`。
 *
 * 反过来的方向也只有一条线：浮层关闭时调 `notifyAutoOpenClosed`，让 t69 的
 * 判定知道「这次是窗口内关的」还是「下次再说」。浮层不 import 判定逻辑，
 * 判定逻辑也不 import 浮层 —— 两边的测试各自独立（票 68 的 e2e 在真浏览器里
 * 量动画起止值，票 69 的单测在纯函数上穷举六条否决）。
 *
 * ## 为什么是「订阅」而不是 React state
 *
 * 打开动作发生在 React 之外（`auto-open.ts` 的 `queueMicrotask`、卡片上的
 * 键盘事件），而且 `LevelOverlay` 可能还没挂载。用订阅的好处是：宿主组件
 * 挂载时立刻拿到「现在该开着的是哪一关」，卸载时自动退订；期间任何一次
 * `openLevel` 都会推给它，不需要把状态提升到 App 层。
 *
 * `useSyncExternalStore` 要求 `getSnapshot()` 返回**引用稳定**的值：同一个
 * levelId 反复读必须得到同一个字符串（原始值天然满足），而「没开」用 `null`
 * 表示。不要在这里返回对象 —— 每次新建对象会让 React 无限重渲染。
 *
 * ## 幂等替换，不是叠一层
 *
 * 设计文档 §1.3 第 7 条：关卡内点「进入下一关」时，`openLevel` 会被再次调用
 * 且 `levelId` 不同。规格是**替换内容**而不是「先收再开」——连播两段动画会
 * 让 350ms 变成 700ms，而学习者的心智是「换了一关」，不是「关掉又打开」。
 * 所以这里只改 levelId、不重置任何「是否可见」的状态，浮层看到 levelId 变了
 * 就换内容、动画不重播。
 */

/** 浮层此刻该显示哪一关；`null` 表示没开。 */
export type LevelOverlayState = string | null;

type Listener = () => void;

let current: LevelOverlayState = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * 打开（或替换成）某一关。
 *
 * 同一个 `levelId` 重复调用是**无操作**：不重新挂载、不重播动画、不重置作答
 * 进度。这既服务「卡片被连点两下」，也服务「React 严格模式下 effect 跑两遍」。
 *
 * ⚠️ 这个函数名是**唯一允许**在非测试代码里出现 `openLevel(` 字面量的地方
 * （`apps/web/src/agent/auto-open.test.ts` 有一条守门测试钉着）。别处要调就
 * `import { openLevel as requestOpen }` 起个别名。
 */
export function openLevel(levelId: string): void {
  if (levelId === current) return;
  current = levelId;
  emit();
}

/** 关闭浮层。已经关着时是空操作（三条关闭路径可能在同一帧都触发）。 */
export function closeLevel(): void {
  if (current === null) return;
  current = null;
  emit();
}

/** 订阅开关变化。返回退订函数，`useSyncExternalStore` 直接用它。 */
export function subscribeLevelOverlay(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前该开着的关卡（给 `useSyncExternalStore` 的 getSnapshot）。 */
export function getOpenLevel(): LevelOverlayState {
  return current;
}

/**
 * 服务端快照：恒 `null`。
 *
 * 浮层是纯客户端状态（打开动作来自用户交互与后端产物），没有任何理由在
 * SSR 首帧就声称「有一关开着」。恒返回 `null` 也让 hydration 的首帧与
 * 服务端一致，不会因为快照不同而报 mismatch。
 */
export function getServerSnapshot(): LevelOverlayState {
  return null;
}

/**
 * 清空（单测用）。
 *
 * 模块级状态在同一个测试文件里会跨用例泄漏 —— 上一条用例打开过 A，下一条
 * 用例的 `getOpenLevel()` 会读到 A。每次 `beforeEach` 调一次即可。
 */
export function resetLevelOverlay(): void {
  current = null;
  listeners.clear();
}
