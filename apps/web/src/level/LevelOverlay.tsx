import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { MemoryRouter, Route, Routes } from 'react-router';
import { notifyAutoOpenClosed } from '../agent/auto-open';
import { useLevel } from '../api/queries';
import { LevelPage } from '../pages/LevelPage';
import { flyIn, flyOut } from '../motion/camera-flight';
import { easeOut, quick, resolveDuration, slow, standard } from '../motion/tokens';
import { useReducedMotion } from '../motion/useReducedMotion';
import { closeLevel, getOpenLevel, getServerSnapshot, subscribeLevelOverlay } from './open';
import './overlay.css';

/**
 * 关卡浮层（票 68）。
 *
 * ## 为什么是浮层而不是路由
 *
 * 从对话里点开一关时，学习者正在**读一段解释**：输入框里可能有没发出去的问题、
 * 上面滚到一半的对话、刚看到的那个知识点。整页跳转把这些全部丢掉，回来还得
 * 重新找位置。浮层把「打开一关」降级成「在当前页上盖一层」，背景页一动不动。
 *
 * 所以本组件**不碰 `window.history`**：URL 不变、背景页不卸载、草稿还在输入框里。
 * 这也意味着浮层里的关卡**不能分享链接** —— 刷新之后没有对话上下文，深链仍走
 * `/level/:levelId` 的整页路径（那是刻意保留的，见设计文档 §7.2）。
 *
 * ## 为什么里面套一个 `MemoryRouter`
 *
 * 关卡页 `LevelPage` 用 `useParams` 取 `levelId`、用 `useNavigate` 做「返回地图」。
 * 它需要一个路由上下文，而浮层不是路由。`MemoryRouter` 正好是「有路由上下文、
 * 但不碰真实地址栏」的那件工具：给 `LevelPage` 一个 `/level/<id>` 的假地址，它
 * 就能照常工作，而浏览器地址栏一个字都不变。
 *
 * 代价写在明处：`LevelPage` 内部「返回地图」会 `navigate('/map/<id>')`，在内存
 * 路由里没有这条路由 —— 所以下面挂了兜底路由，任何非 `/level/` 的跳转都等价于
 * 「关掉浮层」。这比让 `LevelPage` 认识浮层要干净：页面不该知道自己被谁装着。
 *
 * ## 动画为什么用 WAAPI 而不是 CSS transition
 *
 * 与 `motion/EnterOnMount.tsx` 同一条理由：CSS transition 需要「先渲染起始态、
 * 再改成终止态」的间隙，那个间隙只能靠双 rAF 或强制回流换来，而 reduce 下必须
 * 连 rAF 都不能发。WAAPI 是一次调用、合成器驱动，**reduce 时干脆不调用** ——
 * 「不发任何 rAF」于是成为结构性事实。
 *
 * 收回比弹出快（`quick` 120ms vs `standard` 200ms）：关掉一个东西的心理预期
 * 比打开短，收回拖成 200ms 会让人觉得「卡住了」。收回期间遮罩**不提前撤** ——
 * 遮罩是面板与背景页之间的过渡带，先撤遮罩等于把面板直接怼在背景上。
 */

/** 浮层的三个阶段。`leaving` 期间 DOM 还在，动画结束后才真正卸载。 */
type Phase = 'closed' | 'entering' | 'open' | 'leaving';

/** 面板内的可聚焦元素。焦点陷阱用。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 弹出动画：淡入 + 轻微放大 + 16px 上移。 */
function enterKeyframes(): Keyframe[] {
  return [
    { opacity: 0, transform: 'scale(0.96) translateY(16px)' },
    { opacity: 1, transform: 'scale(1) translateY(0px)' },
  ];
}

/** 收回动画：入场关键帧的反向（不是另写一套，免得两头不对称）。 */
function exitKeyframes(): Keyframe[] {
  return [...enterKeyframes()].reverse();
}

/**
 * 兜底路由：内存路由里任何非 `/level/` 的跳转都关掉浮层。
 *
 * `LevelPage` 的「返回地图」与「关卡已锁定」两条路径都会 `navigate('/map/…')`。
 * 浮层没有地图可去，正确的语义就是关掉自己、把控制权还给背景页。
 */
function CloseOnNavigate(): null {
  useEffect(() => {
    closeLevel();
  }, []);
  return null;
}

/**
 * 浮层宿主。挂在 `App.tsx` 里、与 `CommandPaletteHost` 并列。
 *
 * 为什么挂在应用根：打开动作可能发生在任何路由（对话页、地图页、错误页），
 * 而浮层必须在这些页面上都活着。挂进路由树意味着「每个布局都得记得再挂一次」，
 * 漏一个就是「在那一页点开关卡没反应」。
 */
export function LevelOverlayHost(): React.JSX.Element | null {
  const openLevelId = useSyncExternalStore(subscribeLevelOverlay, getOpenLevel, getServerSnapshot);
  const reduced = useReducedMotion();

  /**
   * `shown` 与 store 里的 `openLevelId` 是**两份**状态，刻意不同步：
   * store 说「该不该开着」，`shown` 说「DOM 里现在挂着哪一关」。收回动画期间
   * store 已经是 `null`，但面板还得再活 120ms 把动画播完。
   */
  const [shown, setShown] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('closed');

  /**
   * 标题从关卡本身取，而不是从调用方传进来。
   *
   * 理由：打开浮层的只有一个 `levelId`（`LevelOpener = (levelId: string) => void`），
   * 触发处手里没有标题。让浮层自己用同一个 query 缓存取，既不多一次请求
   * （`LevelPage` 里也用 `useLevel`，TanStack Query 会命中同一条缓存），
   * 也不会出现「标题和内容对不上」。
   */
  const level = useLevel(shown ?? undefined);
  const title = level.payload?.level.title ?? '关卡';

  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const animationRef = useRef<Animation | null>(null);
  /**
   * 刚收完、还没上报关闭意图的那一关。
   *
   * 为什么需要这个 ref：收回动画结束时 `setPhase('closed')` 与 `setShown(null)`
   * 在同一次提交里，等上报的 effect 跑起来时 `shown` 已经是 `null` —— 光看
   * state 会以为「本来就没开过」，关闭意图永远报不出去（t69 的「这次别再弹」
   * 就失效了）。用 ref 把 levelId 带过这一帧。
   */
  const closedLevelRef = useRef<string | null>(null);

  /**
   * 关闭：先把门面关掉，再播收回动画，播完才真正卸载。
   *
   * 三条关闭路径（Esc、点遮罩、面板内按钮）都走这一个函数，所以「收回过程中
   * 遮罩不提前撤」「关闭意图只上报一次」这两件事只需要在一个地方保证。
   *
   * 为什么必须先 `closeLevel()`：门面是唯一真源。只改本地 `phase` 的话，
   * 下一次任何无关的重渲染都会让「门面说开着 / 本地说关了」这对矛盾重新
   * 偏向门面，面板又自己弹回来 —— 症状是「点了关闭没反应」。
   */
  const requestClose = useCallback(() => {
    setPhase((current) => (current === 'leaving' || current === 'closed' ? current : 'leaving'));
    closeLevel();
  }, []);

  // 打开 / 替换 / 关闭 的状态机。
  useEffect(() => {
    if (openLevelId !== null) {
      // 幂等替换：已经开着同一关时什么都不做（不重播动画）。
      if (shown === openLevelId && phase !== 'closed') return;
      const wasClosed = shown === null || phase === 'closed';
      setShown(openLevelId);
      setPhase(wasClosed ? 'entering' : 'open');
      return;
    }
    // store 说该关了。已经在收就让它收完。
    if (shown !== null && phase !== 'leaving') setPhase('leaving');
  }, [openLevelId, shown, phase]);

  // 进入 / 离开动画 + 相机。
  useEffect(() => {
    if (phase === 'entering') {
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      const ms = resolveDuration(standard, reduced);
      if (panel !== null && scrim !== null && ms > 0 && typeof panel.animate === 'function') {
        animationRef.current?.cancel();
        const animation = panel.animate(enterKeyframes(), { duration: ms, easing: easeOut, fill: 'both' });
        animationRef.current = animation;
        animation.addEventListener(
          'finish',
          () => {
            animation.cancel();
            if (animationRef.current === animation) animationRef.current = null;
          },
          { once: true },
        );
      }
      // 相机推近与面板同时开始：两者都是「进入关卡」这一个动作的一部分。
      void flyIn({ reduced, duration: resolveDuration(slow, reduced) });
      setPhase('open');
      return;
    }

    if (phase === 'leaving') {
      const panel = panelRef.current;
      const ms = resolveDuration(quick, reduced);
      const finish = (): void => {
        closedLevelRef.current = shown;
        setPhase('closed');
        setShown(null);
      };
      // reduce：没有动画可播，直接落到 closed（下一帧卸载）。
      if (panel === null || ms === 0 || typeof panel.animate !== 'function') {
        finish();
        void flyOut({ reduced, duration: 0 });
        return;
      }
      animationRef.current?.cancel();
      const animation = panel.animate(exitKeyframes(), { duration: ms, easing: easeOut, fill: 'both' });
      animationRef.current = animation;
      const done = (): void => {
        animation.cancel();
        if (animationRef.current === animation) animationRef.current = null;
        finish();
      };
      animation.addEventListener('finish', done, { once: true });
      // 相机拉回与面板收回同步；reduce 下 flyOut 内部走 setState，不发 rAF。
      void flyOut({ reduced, duration: resolveDuration(slow, reduced) });
      return () => {
        animation.removeEventListener('finish', done);
      };
    }

    return undefined;
  }, [phase, reduced, shown]);

  // 打开时：记住焦点 → 移入面板 → 背景 inert；关闭时全部还原。
  useEffect(() => {
    if (shown === null) return undefined;

    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;

    // 背景页 `inert`：不是 `display:none`。抽走 DOM 会让布局塌陷（CLS）并且
    // 学习者看不到自己刚打的那句话 —— 而「草稿还在」正是浮层存在的理由。
    const root = document.getElementById('root');
    const hadInert = root?.hasAttribute('inert') ?? false;
    root?.setAttribute('inert', '');

    const panel = panelRef.current;
    // 焦点移到**面板容器**而不是第一个按钮：读屏会先把「这是一个对话框、
    // 标题是什么」念完，再让用户自己决定往哪走。直接落在关闭按钮上会让
    // 「按空格」意外关掉刚打开的东西。
    panel?.focus({ preventScroll: true });

    return () => {
      if (root !== null && !hadInert) root.removeAttribute('inert');

      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // 焦点归还：触发处的元素可能已经被卸载（比如对话又推进了一轮）。
      // 那时回落到输入框 —— 学习者本来就是从那儿来的。
      if (target !== null && target.isConnected) {
        target.focus({ preventScroll: true });
        return;
      }
      const composer = document.querySelector<HTMLElement>('textarea[aria-label="这一轮想说的话"]');
      composer?.focus({ preventScroll: true });
    };
  }, [shown]);

  // Esc：捕获阶段处理。
  useEffect(() => {
    if (shown === null) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Fluent 的 Dialog 也监听 Esc，浮层必须先拿到，否则会出现「按一下关了
      // 两层」或「谁都没关」两种都难查的现象。
      event.stopPropagation();
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [shown, requestClose]);

  // 关闭完成：上报关闭意图（t69 用它判断「这次别再弹」还是「下次再说」）。
  useEffect(() => {
    if (phase !== 'closed') return;
    const closed = closedLevelRef.current;
    if (closed === null) return;
    closedLevelRef.current = null;
    notifyAutoOpenClosed(closed);
  }, [phase, shown]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (panel === null) return;
    /**
     * 可聚焦候选。
     *
     * 为什么不用 `node.offsetParent !== null` 判「可见」：jsdom 里 `offsetParent`
     * 恒为 `null`，那样写会让单测里一条候选都挑不出来（焦点被弹回面板本身），
     * 而真实浏览器里 `position: fixed` 的祖先同样会让它返回 `null`。这里只排除
     * 显式标了不可见的元素 —— 与浮层里实际的显隐手段一致。
     */
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => !node.hasAttribute('hidden') && node.getAttribute('aria-hidden') !== 'true',
    );
    if (items.length === 0) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const routerEntries = useMemo(() => [`/level/${shown ?? ''}`], [shown]);

  if (shown === null || phase === 'closed') return null;

  const tree = (
    <div className="level-overlay" data-level-overlay={shown}>
      {/* 遮罩：点它等价于关闭。`aria-hidden` 是因为「点外面关掉」对读屏用户
          没有意义 —— 他们有 Esc 与关闭按钮两条更明确的路径。 */}
      <div
        className="level-overlay-scrim"
        data-overlay-scrim=""
        aria-hidden="true"
        ref={scrimRef}
        onClick={requestClose}
      />
      <div
        className="level-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="level-overlay-title"
        tabIndex={-1}
        ref={panelRef}
        data-overlay-phase={phase}
        onKeyDown={handleKeyDown}
      >
        <div className="level-overlay-head">
          <h2 className="level-overlay-title" id="level-overlay-title">
            {title}
          </h2>
          <button
            type="button"
            className="level-overlay-close"
            aria-label="关闭关卡"
            onClick={requestClose}
          >
            ✕
          </button>
        </div>
        <div className="level-overlay-body">
          <MemoryRouter initialEntries={routerEntries} key={shown}>
            <Routes>
              <Route path="/level/:levelId" element={<LevelPage />} />
              <Route path="*" element={<CloseOnNavigate />} />
            </Routes>
          </MemoryRouter>
        </div>
      </div>
    </div>
  );

  return createPortal(tree, document.body);
}
