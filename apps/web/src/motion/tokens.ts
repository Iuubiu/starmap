/**
 * 全站动效的唯一真源：时长、缓动、位移。
 *
 * 为什么要有这个文件：`t58` 的 Raycast 重制会带来一批新组件，而在此之前全站
 * **唯一的动效只有 `AppShell.tsx` 里的三行抽屉滑入**。没有 token 层，各人会
 * 在自己的页面里各写一套 `transition: 0.2s ease`，等页面转场落地时必然对不上
 * ——「同一个界面里两段动画速度不同」是那种所有人都觉得别扭、但没人能指出
 * 具体哪里错的问题。
 *
 * 这里只放**语义**，不放具体场景：`quick` 不是「卡片入场」，是「一次短暂的
 * 反馈」。场景决定用哪个语义，语义决定具体毫秒数。想让全站动效统一变慢，改
 * 这一个文件就够了。
 */

/**
 * `prefers-reduced-motion` 的媒体查询串。
 *
 * 抽成常量是因为它要出现在三个地方（hook 的订阅、文档里的说明、Playwright
 * 探针的断言），三处各写一遍字符串迟早会有一处打错——而打错的表现是「对
 * 无障碍用户播动画」，属于最不该靠人眼发现的那类缺陷。
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 0ms。状态同步用：值已经变了、界面立刻反映，**不播**任何过渡。 */
export const instant = 0;

/** 120ms。卡片/列表入场、按钮按下这类「一眼就该结束」的微反馈。 */
export const quick = 120;

/** 200ms。抽屉滑入、面板展开、悬停变色这类需要被看见过程的过渡。 */
export const standard = 200;

/** 350ms。镜头推进、跨区域位移这类「空间在动」的大范围移动。 */
export const slow = 350;

/**
 * 出场减速：起步快、收尾慢。
 *
 * 入场的默认曲线。人眼对「突然出现」最敏感，对「缓缓停稳」最不设防，所以
 * 入场一律用减速曲线——反过来（加速收尾）会让元素看起来是被甩出去的，像
 * 报错，不像出现。
 */
export const easeOut = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * 对称缓入缓出：两头都慢。
 *
 * 用于「状态切换」——同一个位置上的东西换成另一个，起点与终点都是静止的，
 * 中间加速再减速。如果这种场景用 `easeOut`，元素会一上来就冲出去，看起来
 * 像被弹开而不是被替换。
 */
export const easeInOut = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * 入场位移：8px。
 *
 * 8px 是「能感觉到有方向、但不至于被当成从屏幕外飞进来」的上限。再大就要
 * 求观察者的视线跟着走，一屏里放三张卡就变成三只乱飞的东西。
 */
export const ENTER_OFFSET_PX = 8;

/**
 * 时长换算的**唯一入口**：把「想要的时长」换算成「这次真的该用多久」。
 *
 * 业务侧不许自己写 `reduced ? 0 : ms`。理由不是洁癖——这个判断只要允许各人
 * 自己写一次，就一定会有某处写错，而写错的表现是「对声明了 reduced-motion
 * 的用户播动画」。那是用户已经明确关掉的东西，却要靠人眼逐个页面去看才能
 * 发现漏了哪个。
 *
 * 非正数、`NaN`、`Infinity` 一律归 0：调用方传进一个算错的值时，正确行为是
 * 「不动」，而不是「用默认值动一下」——后者会让一个本可以被测试发现的错误
 * 变成一段静默播放的动画。
 *
 * @param ms 期望时长（毫秒）
 * @param reduced 用户是否要求减少动效
 * @returns 实际时长；`reduced` 为真时恒为 0
 */
export function resolveDuration(ms: number, reduced: boolean): number {
  if (reduced) return 0;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms;
}

/**
 * `easeOut` 的数值版本：`t` 从 0 到 1，返回同区间的进度。
 *
 * 为什么需要它：CSS 缓动是字符串，浏览器自己解析；但数字滚动是逐帧算出来
 * 的，`requestAnimationFrame` 只吃函数。如果这里随便挑一条别的曲线，同一个
 * 界面里「卡片滑入」和「数字滚动」就会有不同的加速度，看起来像两套动效。
 *
 * 曲线与 `easeOut` 对应：`1 - (1 - t)^3`（easeOutCubic）。不追求与
 * `cubic-bezier(0.22, 1, 0.36, 1)` 逐点相等——那是 easeOutQuint 附近的手感，
 * 对数字滚动而言两者肉眼不可分，而三次方足够便宜，可以每帧算。
 */
export function easeOutProgress(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (t >= 1) return 1;
  const inverted = 1 - t;
  return 1 - inverted * inverted * inverted;
}
