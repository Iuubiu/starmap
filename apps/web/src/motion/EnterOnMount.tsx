import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ENTER_OFFSET_PX, easeOut, quick, resolveDuration } from './tokens';
import { useReducedMotion } from './useReducedMotion';

/** 入场动画的 DOM 形状。抽出来给组件与 hook 共用，避免两处 keyframes 走样。 */
function enterKeyframes(): Keyframe[] {
  return [
    { opacity: 0, transform: `translateY(${ENTER_OFFSET_PX}px)` },
    { opacity: 1, transform: 'translateY(0px)' },
  ];
}

/**
 * 给一个已存在的元素加入场动画（8px 上移 + 淡入），**不额外产生 DOM 节点**。
 *
 * 什么时候用这个而不是 `<EnterOnMount>`：元素本身是网格/弹性布局的直接子项，
 * 外面再包一层 `<div>` 会改变布局归属（卡片高度塌成内容高度、`gap` 落到包装
 * 层上）。这种情况直接 `ref` 拿元素交给这里。
 *
 * ## 为什么用 Web Animations 而不是 CSS transition
 *
 * CSS transition 需要一个「先渲染成起始态、再改成终止态」的间隙，那个间隙只能
 * 靠两次 `requestAnimationFrame` 或者强制回流来保证。两条路都有代价：双 rAF
 * 在 `prefers-reduced-motion` 下必须跳过（否则就违背了「不发任何 rAF」的验收），
 * 于是代码里出现「这里发 rAF、那里不发」的分叉；强制回流（读 `offsetWidth`）
 * 则是每次挂载都同步布局一次。
 *
 * WAAPI 的 `element.animate()` 是一次调用、由合成器驱动、与主线程布局无关，
 * 而且**在 reduced 下干脆不调用**——「不发任何 rAF」于是变成结构性事实，不靠
 * 断言守。
 *
 * ## 为什么没有 delay 参数
 *
 * 列表入场刻意**不做错峰**：每张卡延迟 40ms 看起来像「依次弹出来」，但一屏
 * 十几张卡时，最后一张要等半秒，而且滚动时新进入视口的卡会各自重播一遍，
 * 连拍抖动比整齐的淡入难看得多。所有卡同一时刻开始、同一时刻结束。
 *
 * @param ref 目标元素
 * @param active 为 false 时不播（例如内容还没加载完，先别演一遍空壳）
 */
export function useEnterAnimation(ref: RefObject<HTMLElement | null>, active = true): void {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (el === null) return;

    const ms = resolveDuration(quick, reduced);
    // reduced：直接返回，不建动画、不发 rAF。元素保持自然样式，页面完整可用。
    if (ms === 0) return;

    // jsdom 没有 `Element.animate`。测试环境里静默跳过，真实浏览器里才播。
    // 不 throw 是因为这个组件本身没有「动画失败」这种状态——没动画也是完整
    // 可用的界面，抛错只会把一次降级变成一次白屏。
    if (typeof el.animate !== 'function') return;

    const animation = el.animate(enterKeyframes(), { duration: ms, easing: easeOut, fill: 'both' });

    // `fill: 'both'` 让起始帧在动画真正开始前就生效（否则第一帧会闪一下元素
    // 的自然样式）；结束时取消，是因为终止帧与自然样式完全一致，取消不会
    // 有任何视觉变化，却能避免一个已完成的动画长期挂在 `getAnimations()` 里。
    const cleanup = () => animation.cancel();
    animation.addEventListener('finish', cleanup, { once: true });

    return () => {
      animation.removeEventListener('finish', cleanup);
      animation.cancel();
    };
  }, [ref, active, reduced]);
}

/** `<EnterOnMount>` 的属性。 */
export interface EnterOnMountProps {
  children: ReactNode;
  /** 透传给包装层的 class（Fluent 的 `makeStyles` 产物走这里）。 */
  className?: string;
  /** 透传的内联样式。 */
  style?: CSSProperties;
  /** 为 false 时不播。 */
  active?: boolean;
  /** 语义标签，默认 `div`。需要 `li` / `section` 时换掉，别用 div 破坏语义。 */
  as?: 'div' | 'li' | 'section' | 'article';
}

/**
 * 挂载时播一次「8px 上移 + 淡入」的包装组件。
 *
 * 这是 `useEnterAnimation` 的便捷外壳，用于新写的、可以自由决定 DOM 结构的
 * 地方。已有布局里加不进去时请改用 hook 版本。
 */
export function EnterOnMount({
  children,
  className,
  style,
  active = true,
  as: Tag = 'div',
}: EnterOnMountProps) {
  const ref = useRef<HTMLElement | null>(null);
  useEnterAnimation(ref, active);
  return (
    <Tag ref={ref as never} className={className} style={style}>
      {children}
    </Tag>
  );
}
