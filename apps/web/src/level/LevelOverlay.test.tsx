import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LevelOverlayHost } from './LevelOverlay';
import { closeLevel, openLevel, resetLevelOverlay } from './open';

/**
 * 关卡浮层的**行为**测试（票 68）。
 *
 * 分工：门面的状态机在 `open.test.ts`，动画起止值与 backdrop-filter 在
 * `apps/web/e2e/overlay.spec.ts`（jsdom 没有合成器，`getComputedStyle` 拿不到
 * 真实滤镜）。这里测的是「jsdom 能忠实回答的那些」——DOM 结构、ARIA、焦点、
 * inert、以及「reduce 下到底有没有调 animate()」。
 *
 * ## 为什么把 `LevelPage` 换掉
 *
 * 浮层里装的是真页面，它要拉两个 query、渲染一整关卡。本文件关心的是**容器**
 * 的行为，不是关卡内容；真的关卡渲染归 `LevelPage.test.tsx` 与 e2e。换成一个
 * 有标题、有按钮的小组件，还能顺带验证「焦点陷阱会在装进来的内容上生效」。
 */
vi.mock('../pages/LevelPage', () => ({
  LevelPage: () => (
    <div>
      <h3>关卡正文</h3>
      <button type="button">第一步</button>
      <button type="button">第二步</button>
    </div>
  ),
}));

vi.mock('../api/queries', () => ({
  useLevel: () => ({ payload: { level: { title: '布尔代数基本运算' } } }),
}));

/**
 * `Element.prototype.animate` 的记录桩。
 *
 * jsdom 没有 WAAPI。默认**不装**桩：浮层会走「没有动画可播」的分支，直接落回
 * 关闭态 —— 那正是无 JS 动画环境下该有的行为，也顺便测了这条兜底。需要验证
 * 「动画参数对不对」的用例再单独装桩。
 *
 * 桩默认**不会自动 finish**：`finish()` 由用例显式调用，这样「收回动画已开始、
 * 但面板还没卸载」那个中间状态才可观察 —— 验收第 4 条（收回过程中遮罩不提前撤）
 * 断言的正是那一瞬间。
 */
interface RecordedAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  finish: () => void;
}

function installAnimate(): {
  calls: RecordedAnimation[];
  finishAll: () => void;
  restore: () => void;
} {
  const calls: RecordedAnimation[] = [];
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const listeners: Array<() => void> = [];
      const finish = (): void => {
        for (const listener of listeners) listener();
      };
      calls.push({ keyframes, options, finish });
      const animation = {
        cancel: () => {},
        addEventListener: (type: string, handler: () => void) => {
          if (type === 'finish') listeners.push(handler);
        },
        removeEventListener: () => {},
        play: () => {},
        finish: () => {},
      };
      return animation as unknown as Animation;
    },
  });
  return {
    calls,
    finishAll: () => {
      for (const call of calls) call.finish();
    },
    restore: () => {
      if (original === undefined) {
        Reflect.deleteProperty(Element.prototype, 'animate');
      } else {
        Object.defineProperty(Element.prototype, 'animate', original);
      }
    },
  };
}

/** 让 `matchMedia('(prefers-reduced-motion: reduce)')` 返回指定值。 */
function setReducedMotion(reduced: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('关卡浮层', () => {
  beforeEach(() => {
    resetLevelOverlay();
    setReducedMotion(false);
    document.body.innerHTML = '';
    // 浮层把背景 `#root` 设成 inert，所以测试里要有这个元素。
    const root = document.createElement('div');
    root.id = 'root';
    const composer = document.createElement('textarea');
    composer.setAttribute('aria-label', '这一轮想说的话');
    root.append(composer);
    document.body.append(root);
  });

  describe('打开', () => {
    it('没打开时什么都不渲染', () => {
      render(<LevelOverlayHost />);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('打开后是一个带标题的模态对话框', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      const labelId = dialog.getAttribute('aria-labelledby');
      expect(labelId).toBeTruthy();
      const heading = document.getElementById(labelId!);
      expect(heading).not.toBeNull();
      expect(heading!.textContent).toBe('布尔代数基本运算');
    });

    it('装进来的关卡正文可见（浮层真的装的是页面，不是占位符）', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));

      expect(await screen.findByText('关卡正文')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '第一步' })).toBeInTheDocument();
    });

    it('打开时焦点落在面板容器上，不是第一个按钮', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));

      const dialog = await screen.findByRole('dialog');
      expect(document.activeElement).toBe(dialog);
      expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '关闭关卡' }));
    });

    it('背景页被设为 inert，输入框仍在 DOM 里（没被 display:none 抽走）', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');

      const root = document.getElementById('root')!;
      expect(root.hasAttribute('inert')).toBe(true);
      const composer = root.querySelector('textarea[aria-label="这一轮想说的话"]');
      expect(composer).not.toBeNull();
    });

    it('浮层渲染在 body 下（不在 #root 里），所以 #root 变 inert 也不影响它', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));

      const dialog = await screen.findByRole('dialog');
      expect(document.getElementById('root')!.contains(dialog)).toBe(false);
      expect(document.body.contains(dialog)).toBe(true);
    });
  });

  describe('三条关闭路径', () => {
    it('Esc 关闭', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');

      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('点遮罩关闭', async () => {
      const { container } = render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');

      const scrim = document.querySelector('.level-overlay-scrim');
      expect(scrim).not.toBeNull();
      await userEvent.click(scrim as Element);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(container).toBeTruthy();
    });

    it('面板内关闭按钮关闭', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');

      await userEvent.click(screen.getByRole('button', { name: '关闭关卡' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('三条路径都让门面回到「没开」', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      // 关掉之后还能再开：门面没有被卡在某个中间态。
      act(() => openLevel('lv-a'));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('焦点', () => {
    it('关闭后焦点回到打开前的位置', async () => {
      const trigger = document.createElement('button');
      trigger.textContent = '进入关卡';
      document.getElementById('root')!.prepend(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');
      expect(document.activeElement).not.toBe(trigger);

      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    it('触发处已卸载时回落到输入框', async () => {
      const trigger = document.createElement('button');
      document.getElementById('root')!.prepend(trigger);
      trigger.focus();

      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');

      trigger.remove();
      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(document.activeElement).toBe(
          document.querySelector('textarea[aria-label="这一轮想说的话"]'),
        ),
      );
    });

    it('Tab 在面板内循环：最后一个之后回到第一个', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      const dialog = await screen.findByRole('dialog');

      const close = screen.getByRole('button', { name: '关闭关卡' });
      const second = screen.getByRole('button', { name: '第二步' });
      second.focus();
      expect(document.activeElement).toBe(second);

      await userEvent.tab();
      // 面板内最后一个可聚焦元素之后应该绕回第一个，而不是跑到背景页去。
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(close);
    });

    it('Shift+Tab 从第一个绕到最后一个', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      const dialog = await screen.findByRole('dialog');

      const close = screen.getByRole('button', { name: '关闭关卡' });
      close.focus();
      await userEvent.tab({ shift: true });

      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '第二步' }));
    });
  });

  describe('动效', () => {
    it('弹出用 standard + easeOut，关键帧是 opacity/scale/translateY', async () => {
      const animate = installAnimate();
      try {
        render(<LevelOverlayHost />);
        act(() => openLevel('lv-a'));
        await screen.findByRole('dialog');

        const enter = animate.calls[0]!;
        expect(enter).toBeDefined();
        expect(enter.options.duration).toBe(200);
        expect(enter.options.easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
        expect(enter.keyframes[0]).toMatchObject({ opacity: 0 });
        expect(String(enter.keyframes[0]!.transform)).toContain('scale(0.96)');
        expect(String(enter.keyframes[0]!.transform)).toContain('translateY(16px)');
        expect(enter.keyframes[1]).toMatchObject({ opacity: 1 });
        expect(String(enter.keyframes[1]!.transform)).toContain('scale(1)');
        expect(String(enter.keyframes[1]!.transform)).toContain('translateY(0px)');
      } finally {
        animate.restore();
      }
    });

    it('收回比弹出快（quick 120ms），且遮罩在收回期间还在', async () => {
      const animate = installAnimate();
      try {
        render(<LevelOverlayHost />);
        act(() => openLevel('lv-a'));
        await screen.findByRole('dialog');
        // 弹出动画播完（真实浏览器里 200ms 后），面板进入稳定态。
        act(() => animate.finishAll());

        await userEvent.click(screen.getByRole('button', { name: '关闭关卡' }));

        const exit = animate.calls[1]!;
        expect(exit).toBeDefined();
        expect(exit.options.duration).toBe(120);
        expect(exit.options.duration).toBeLessThan(animate.calls[0]!.options.duration as number);
        // 收回动画已经开始，但 DOM 要等 finish 才撤 —— 所以此刻遮罩仍在。
        // 这就是验收第 4 条「收回过程中遮罩不提前撤」要盯的那一瞬间。
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(document.querySelector('.level-overlay-scrim')).not.toBeNull();

        act(() => animate.finishAll());
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      } finally {
        animate.restore();
      }
    });

    it('reduce 下不调 animate，但遮罩与对话框照常出现', async () => {
      setReducedMotion(true);
      const animate = installAnimate();
      try {
        render(<LevelOverlayHost />);
        act(() => openLevel('lv-a'));

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(document.querySelector('.level-overlay-scrim')).not.toBeNull();
        expect(animate.calls).toHaveLength(0);

        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(animate.calls).toHaveLength(0);
      } finally {
        animate.restore();
      }
    });
  });

  describe('换关与卸载', () => {
    it('换到另一关时内容替换，不叠第二层', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');

      act(() => openLevel('lv-b'));
      await waitFor(() =>
        expect(document.querySelector('[data-level-overlay]')?.getAttribute('data-level-overlay')).toBe(
          'lv-b',
        ),
      );
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('卸载时移除背景 inert，不留悬空属性', async () => {
      const view = render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');
      expect(document.getElementById('root')!.hasAttribute('inert')).toBe(true);

      view.unmount();
      expect(document.getElementById('root')!.hasAttribute('inert')).toBe(false);
    });

    it('关闭之后门面回到未打开状态（可以重新打开）', async () => {
      render(<LevelOverlayHost />);
      act(() => openLevel('lv-a'));
      await screen.findByRole('dialog');

      await userEvent.click(screen.getByRole('button', { name: '关闭关卡' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      act(() => closeLevel());
      act(() => openLevel('lv-a'));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });
  });
});
