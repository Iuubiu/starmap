import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EnterOnMount } from './EnterOnMount';
import { useCountUp } from './useCountUp';
import { useReducedMotion } from './useReducedMotion';

/**
 * 给 Playwright 探针用的**浏览器内夹具**（不是应用代码）。
 *
 * ## 为什么这个文件在 `src/` 里
 *
 * 门禁要断言的是 `document.getAnimations()`——一个只有真实浏览器才有的东西。
 * jsdom 里的 `motion.test.tsx` 只能证明「我们调用了 `element.animate()`」，
 * 证明不了「动画真的被浏览器接受并合成」。两者之间隔着 WAAPI 的实现，
 * 而 reduce 降级的整个承诺就落在那一层。
 *
 * 夹具要 import 真实的动效模块，于是它必须能被 Vite 当作项目内模块解析。
 * 放在 `.scratch/` 里虽然也能通过 `/@fs/` 被 Vite 服务，但那要求探针在 URL
 * 里拼一个**绝对路径**（`D:/DeepSeek/starmap/...`），换一台机器、换一个
 * checkout 目录就断；而 `/src/motion/qaHarness.tsx` 是稳定相对路径。
 *
 * 代价是它躺在 `src/` 里。可以接受，因为：
 * - 没有任何应用入口 import 它 → Vite 打包时不可达 → **不会进产物**；
 * - 它只依赖 `react` / `react-dom`（本来就在依赖里），不新增任何包；
 * - 它不改变任何运行时代码路径，删掉它对应用零影响。
 *
 * ## 探针报告什么
 *
 * 挂载当帧（同一个 commit 的 effect 里）同步抓一次，而不是让探针轮询——
 * 动画只有 120ms，Playwright 的一次 `evaluate` 往返就可能错过窗口，那样
 * 「非 reduce 下确实播了」会变成一条**随机失败**的断言。
 */

/** 挂载当帧抓到的快照。探针读 `window.__motionProbe`。 */
export interface MotionProbeReport {
  /** 挂载时 `matchMedia` 报的 reduce 偏好 */
  reduced: boolean;
  /** 夹具子树里当帧存在的动画时长（ms）。reduce 下应为空数组。 */
  subtreeDurations: number[];
  /** 整个 document 当帧的动画数量。验收原文用的是这个口径。 */
  documentAnimations: number;
  /** 整个 document 当帧的动画时长，便于失败时定位「是谁在动」 */
  documentDurations: number[];
  /** `useCountUp` **第一次渲染**的输出（不是最终值） */
  countUpFirstRender: string;
}

declare global {
  interface Window {
    __motionProbe?: MotionProbeReport;
    __mountMotionHarness?: (host: HTMLElement) => { unmount: () => void };
    /** `qaHarness.html` 里的内联模块跑完后置真，探针用它等模块加载。 */
    __motionHarnessReady?: boolean;
  }
}

function durationsOf(animations: readonly Animation[]): number[] {
  return animations.map((animation) => {
    const timing = animation.effect?.getTiming();
    return typeof timing?.duration === 'number' ? timing.duration : -1;
  });
}

function Harness() {
  const reduced = useReducedMotion();
  const shown = useCountUp(1234);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const firstRenderRef = useRef<string[]>([]);

  // 记录**第一次渲染**的字符串。写在渲染体里而不是 effect 里：effect 跑的是
  // 「渲染之后」，那时首帧已经过去了。
  if (firstRenderRef.current.length === 0) firstRenderRef.current.push(String(shown));

  useEffect(() => {
    const host = hostRef.current;
    // effect 的执行顺序是「子先父后」，所以这里跑的时候 `<EnterOnMount>`
    // 已经调过 `element.animate()` 了。同一个 commit、同步读取，不存在
    // 错过窗口的可能。
    window.__motionProbe = {
      reduced,
      subtreeDurations: host === null ? [] : durationsOf(host.getAnimations({ subtree: true })),
      documentAnimations: document.getAnimations().length,
      documentDurations: durationsOf(document.getAnimations()),
      countUpFirstRender: firstRenderRef.current[0] ?? '',
    };
  }, [reduced]);

  return (
    <div ref={hostRef} data-qa="motion-harness">
      <EnterOnMount>
        <p data-qa="enter-target">入场卡片</p>
      </EnterOnMount>
      <p data-qa="count-up">{String(shown)}</p>
    </div>
  );
}

/**
 * 在给定容器里挂一个 React 根，返回卸载句柄。
 *
 * 探针拿到的 DOM 结构与真实页面里 `EnterOnMount` 的用法一致（同组件、同
 * token），所以「浏览器接受了这个动画」这句话对应用代码同样成立。
 */
export function mountMotionHarness(host: HTMLElement): { unmount: () => void } {
  const root: Root = createRoot(host);
  root.render(<Harness />);
  return {
    unmount() {
      root.unmount();
      delete window.__motionProbe;
    },
  };
}

window.__mountMotionHarness = mountMotionHarness;
