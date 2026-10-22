import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, type NavigateOptions, type To } from 'react-router';

/**
 * 动效接缝：本仓唯一允许「动起来」的地方。
 *
 * ## 为什么不是动画库
 *
 * SKILL.md §0 第 9 条：零新依赖。`<ViewTransition>`（React 19 内置）+
 * `document.startViewTransition`（浏览器原生）已经能做共享元素与整页转场，
 * 再引一个 200KB 的库只会让包体变大、并且和 View Transitions 抢同一件事。
 *
 * ## 为什么转场类型靠 `<html data-sm-transition>` 而不是 React 的 addTransitionType
 *
 * React 19 的 `addTransitionType` 要求整棵树包在 `<ViewTransition>` 里，并且
 * 只在 React 自己的过渡里生效；而本仓的导航发生在 React Router 的 loader 之外，
 * 用原生 API 更直接。把类型写在 DOM 属性上还有一个好处：**CSS 与 JS 都能读到**，
 * 快照测试可以直接断言「这次导航被判定为 zoom-in」，不用去嗅探伪元素。
 */

/** 阶段转场的三种镜头运动。`none` = 同层级切换，不做缩放。 */
export type StageTransitionKind = 'zoom-in' | 'zoom-out' | 'none';

/**
 * 判断一次导航是「钻进去」还是「退出来」。
 *
 * 空间模型（SKILL.md §3.4）：`/map` 是整张星图，`/map/:microKpId` 是某个
 * 分支的近景，`/level/:levelId` 是地面。层级越深，数字越大。
 *
 * 判断只看**路径层级**，不看具体 id —— 这保证「同层级平移」（如两个节点
 * 详情之间切换）被判成 `none`，不做缩放：那是横向移动，不是钻进钻出。
 * 缩放一个没有纵深变化的切换，会让学习者以为自己进错了层。
 */
export function stageTransitionKind(from: string, to: string): StageTransitionKind {
  const depth = (path: string): number => {
    if (path.startsWith('/level/')) return 3;
    if (path.startsWith('/map/')) return 2;
    if (path === '/map') return 1;
    return 0;
  };

  const a = depth(from);
  const b = depth(to);
  if (a === 0 || b === 0) return 'none'; // 离开或进入图谱世界：不是镜头运动
  if (b > a) return 'zoom-in';
  if (b < a) return 'zoom-out';
  return 'none';
}

/** 系统是否要求减少动效。初始值同步读，避免首帧先动一下再停。 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished: Promise<void>;
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
    skipTransition: () => void;
  };
};

/** 当前环境是否真的能跑 View Transitions（jsdom 里没有，必须能安全降级）。 */
export function supportsViewTransitions(): boolean {
  return typeof (document as DocumentWithViewTransition).startViewTransition === 'function';
}

/**
 * 带镜头运动的导航。
 *
 * 行为分三种：
 * 1. 减少动效 / 浏览器不支持 → 直接 `navigate`，一次跳变（**瞬时**，不是
 *    「淡入淡出」——见 SKILL.md §3.5：降级后不能留下任何过渡）。
 * 2. 同层级导航 → 直接 `navigate`，不做整页转场（只靠元素自身的 hover/active）。
 * 3. 跨层级 → `startViewTransition` 包住 `navigate(..., { flushSync: true })`。
 *    `flushSync` 是必须的：View Transitions 在回调返回后立刻拍「新状态」快照，
 *    若 React 异步提交，快照会拍到旧 DOM，于是整页不动、然后突然换掉。
 */
export function useStageNavigate(): (to: To, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = usePrefersReducedMotion();

  return useCallback(
    (to: To, options?: NavigateOptions) => {
      const target = typeof to === 'string' ? to : `${to.pathname ?? ''}${to.search ?? ''}`;
      const kind = stageTransitionKind(location.pathname, target);

      if (reduced || kind === 'none' || !supportsViewTransitions()) {
        navigate(to, options);
        return;
      }

      const root = document.documentElement;
      root.setAttribute('data-sm-transition', kind);
      const transition = (document as DocumentWithViewTransition).startViewTransition!(() => {
        navigate(to, { ...options, flushSync: true });
      });
      // 转场结束后一定要摘掉属性：留着会让下一次普通导航也被 CSS 命中，
      // 表现为「点了没反应却闪了一下」。
      void transition.finished.finally(() => {
        root.removeAttribute('data-sm-transition');
      });
    },
    [location.pathname, navigate, reduced],
  );
}

/**
 * 给共享元素起名。
 *
 * View Transitions 靠 `view-transition-name` 把两个页面上的同一个东西
 * **配成一对**，然后从旧矩形连续动画到新矩形 —— 这就是「连续缩放」的实现：
 * 学习者点的那个节点在下一个页面里还是同一个元素，它自己飞过去，而不是
 * 整页淡出再淡入。
 *
 * 名字必须**全局唯一**：同屏出现两个同名元素，浏览器会整段转场失效（并且
 * 不报错，只是不动）。所以调用方要带上 id。
 */
export function sharedElementName(prefix: string, id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `sm-${prefix}-${safe}`;
}

/** 写 `view-transition-name` 的内联样式对象，省得每处手拼。 */
export function viewTransitionStyle(
  name: string | null,
): { viewTransitionName?: string } | undefined {
  if (!name) return undefined;
  return { viewTransitionName: name } as { viewTransitionName: string };
}
