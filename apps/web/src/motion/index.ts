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
  cinematicCap,
  cinematicDuration,
  cinematicFullDistance,
  cinematicMax,
  cinematicMin,
  clampCinematicMs,
  easeEnter,
  easeExit,
  easeInOut,
  easeOut,
  easeOutProgress,
  instant,
  panel,
  quick,
  resolveDuration,
  slow,
  standard,
} from './tokens';

export { useReducedMotion } from './useReducedMotion';
export { useCountUp, type CountUpOptions } from './useCountUp';
export { EnterOnMount, useEnterAnimation, type EnterOnMountProps } from './EnterOnMount';

// t60：阶段转场的编排层。用 View Transitions 起手，不支持时退化为 200ms
// 推近；reduce 下只做更新、不做动画。
export {
  FALLBACK_OPACITY_FLOOR,
  FALLBACK_SCALE_FROM,
  TRANSITION_ATTR,
  fallbackKeyframes,
  playScaleOpacityFallback,
  runStageTransition,
  stageDepth,
  stageTransitionKind,
  supportsViewTransitions,
  type StageTransitionKind,
  type StageTransitionOptions,
  type StageTransitionOutcome,
  type ViewTransitionLike,
} from './transitions';

export { useRouteTransition, runRouteTransition, type RouteTransitionApi, type RouteTransitionOptions } from './useRouteTransition';

// t60：连续缩放镜头（地图全局 → 知识点近景）。
export {
  AVOID_CORRIDOR,
  AVOID_DETOUR,
  AVOID_TRIGGER,
  MIN_RATIO,
  PATH_SAMPLES,
  cancelCinematicZoom,
  densityAlong,
  planCinematicZoom,
  prefersReducedMotion,
  runCinematicZoom,
  stateAt,
  useCinematicZoom,
  zoomToNode,
  type CinematicZoomPlan,
  type NearbyNode,
  type PlanCinematicZoomInput,
  type ZoomCameraSink,
  type ZoomCameraState,
  type ZoomSample,
  type ZoomTarget,
} from './useCinematicZoom';
