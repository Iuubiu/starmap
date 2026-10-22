/**
 * 全站动效底座的公开面。
 *
 * 只导出**语义**，不导出「某个页面用的某个数值」：调用方写
 * `transition: opacity ${standard}ms ${easeOut}`，不写 `transition: opacity 200ms`。
 * 想让全站动效统一变慢，改 `tokens.ts` 一处即可。
 *
 * 与 `seams.ts` 的关系：`seams.ts` 是 t58 给页面侧留的挂点（路由转场、镜头
 * 缩放），它属于页面接线的契约；本文件是**底座**，页面直接从这里取 token 与
 * 入场组件，不经过 seams。两者不互相 import，避免循环。
 */

export {
  ENTER_OFFSET_PX,
  REDUCED_MOTION_QUERY,
  easeInOut,
  easeOut,
  easeOutProgress,
  instant,
  quick,
  resolveDuration,
  slow,
  standard,
} from './tokens';

export { useReducedMotion } from './useReducedMotion';
export { useCountUp, type CountUpOptions } from './useCountUp';
export { EnterOnMount, useEnterAnimation, type EnterOnMountProps } from './EnterOnMount';
