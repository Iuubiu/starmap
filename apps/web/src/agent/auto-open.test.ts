/**
 * 票 69 / 72：对话里「该练了」的关卡自动弹出，卡片本体即入口。
 *
 * ## 这一层为什么值得单测这么细
 *
 * 「弹不弹」判错的代价不是一条文案，而是**打断学习者**：他正在打一句问题，
 * 浮层盖上来、焦点被抢走；或者他刚在三秒内按 Esc 说「这次不练」，下一轮又被
 * 同一张关卡怼回来。这两种失败都不会在「页面能打开」的验收里暴露。
 *
 * 所以判定写成 `shouldAutoOpen(artifact, state)`，测试直接造 `state`，不等真实
 * 的 3 秒、不渲染浮层；接线部分（`useAutoOpenLevel` + `ArtifactCard`）另用
 * jsdom 测「零点击进入」「没有按钮」「没注册 opener 时不报错」。
 *
 * ## 票 72 改了什么
 *
 * 票 69 的判定分两级：产物带 `start_practice` 动作，或者关卡 id 带 `lv-ai-`
 * 前缀（按需生成）。可契约里 `LevelCardArtifactSchema` 根本没有 `actions` 字段，
 * 而 `lv-ai-` 是生成器实现细节 —— 判定挂在它上面，等于让「弹不弹」取决于
 * id 怎么拼。票 72 收成一条：**任何 level_card 都算该练了**。撤销（3 秒内关掉）
 * 只撤「自动」，不撤「可进入」：卡片仍是入口，`openLevelFromCard` 刻意不看
 * `dismissedLevelIds`。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentTurnResponseArtifact } from '../api/generated/model';
import { palettes } from '../theme/tokens';
import { ArtifactCard } from './ArtifactCard';
import {
  closeAutoOpenedLevel,
  createAutoOpenState,
  evaluateAutoOpen,
  markOpened,
  notifyAutoOpenClosed,
  offerAutoOpen,
  openLevelFromCard,
  registerLevelOpener,
  resetAutoOpenState,
  shouldAutoOpen,
  UNDO_WINDOW_MS,
} from './auto-open';

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

type LevelCard = Extract<AgentTurnResponseArtifact, { kind: 'level_card' }>;

/**
 * 造一张关卡卡。默认 `levelId: 'lv-bool-1'` —— **不带** `lv-ai-` 前缀，
 * 因为票 72 之后前缀不再参与判定，测试应该从「普通关卡」出发。
 */
function levelCard(extra: Partial<LevelCard> = {}): AgentTurnResponseArtifact {
  const base: LevelCard = {
    cardId: 'card-seeded-1',
    title: '布尔代数：化简',
    createdAt: '2026-10-22T09:00:00.000Z',
    kind: 'level_card',
    levelId: 'lv-bool-1',
    microKpId: 'kp-bool',
    tier: 'P1',
    estimatedMinutes: 12,
    itemCount: 5,
    firstStepKind: 'quiz',
    rationale: '你说想练布尔代数，这张关卡从化简开始。',
  };
  return { ...base, ...extra } as AgentTurnResponseArtifact;
}

/** 判定用的「一切就绪」状态：有 opener、没有草稿、本会话没弹过这张。 */
const readyState = (overrides: Parameters<typeof createAutoOpenState>[0] = {}) =>
  createAutoOpenState({ sessionId: 'ses-test', hasOpener: true, ...overrides });

/** 组件测试里固定会话，避免 localStorage 里上一次跑出来的 id 把状态重置掉。 */
const TEST_SESSION = 'ses-auto-open-test';

const CARD_LABEL = '打开关卡：布尔代数：化简';

beforeEach(() => {
  window.localStorage.setItem('starmap.session', TEST_SESSION);
  resetAutoOpenState(TEST_SESSION);
  registerLevelOpener(null);
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * 验收③（票 72 版）：触发判定是纯函数，任何 level_card 都为 true
 * ------------------------------------------------------------------ */

describe('shouldAutoOpen：任何 level_card 都算该练了', () => {
  it('普通关卡（没有 lv-ai- 前缀）→ true', () => {
    const artifact = levelCard();
    expect(shouldAutoOpen(artifact, readyState())).toBe(true);
    expect(evaluateAutoOpen(artifact, readyState())).toMatchObject({ open: true, reason: 'open' });
  });

  it('按需生成的关卡（lv-ai- 前缀）→ true（判定已不看来源）', () => {
    const artifact = levelCard({ levelId: 'lv-ai-kp-bool', cardId: 'card-gen-1' });
    expect(shouldAutoOpen(artifact, readyState())).toBe(true);
  });

  it('产物上多余字段（比如将来补的 actions）不影响结论', () => {
    const withActions = levelCard({
      actions: [{ kind: 'start_practice', label: '现在开始练', enabled: true }],
    } as Partial<LevelCard>);
    expect(shouldAutoOpen(withActions, readyState())).toBe(true);
  });

  it('graph_focus → false', () => {
    const artifact = {
      cardId: 'card-graph',
      title: '布尔代数的邻居',
      createdAt: '2026-10-22T09:00:00.000Z',
      kind: 'graph_focus',
      microKpId: 'kp-bool',
      name: '布尔代数',
      neighbors: [],
      rationale: '你问它和谁相关。',
    } as unknown as AgentTurnResponseArtifact;
    expect(shouldAutoOpen(artifact, readyState())).toBe(false);
    expect(evaluateAutoOpen(artifact, readyState()).reason).toBe('not_level_card');
  });

  it('progress_change → false', () => {
    const artifact = {
      cardId: 'card-progress',
      title: '掌握度变化',
      createdAt: '2026-10-22T09:00:00.000Z',
      kind: 'progress_change',
      microKpId: 'kp-bool',
      name: '布尔代数',
      before: { achieved: 0.2, current: 0.3, state: 'learning' },
      after: { achieved: 0.4, current: 0.5, state: 'learning' },
      reason: '刚做完 5 题。',
      evidenceCount: 5,
    } as unknown as AgentTurnResponseArtifact;
    expect(shouldAutoOpen(artifact, readyState())).toBe(false);
  });

  it('probe_form（自带 retry / show_evidence 动作）→ false', () => {
    const artifact = {
      cardId: 'card-probe',
      title: '追问一步',
      createdAt: '2026-10-22T09:00:00.000Z',
      kind: 'probe_form',
      probeId: 'pr-1',
      microKpId: 'kp-bool',
      question: '这一步该用哪个关系式？',
      ladderLevel: 1,
      ladderCap: 3,
      inputKind: 'free_text',
      choices: [],
      actions: [
        { kind: 'retry', label: '再问一次', enabled: true },
        { kind: 'show_evidence', label: '看依据', enabled: true },
      ],
      rationale: '你卡住了。',
    } as unknown as AgentTurnResponseArtifact;
    expect(shouldAutoOpen(artifact, readyState())).toBe(false);
    expect(evaluateAutoOpen(artifact, readyState()).reason).toBe('not_level_card');
  });

  it('没注册 opener → false（退化为不弹，不报错）', () => {
    const artifact = levelCard();
    expect(evaluateAutoOpen(artifact, readyState({ hasOpener: false })).reason).toBe('no_opener');
    expect(() => offerAutoOpen(artifact)).not.toThrow();
    expect(offerAutoOpen(artifact).opened).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 验收④：3 秒撤销窗口
 * ------------------------------------------------------------------ */

describe('3 秒撤销窗口', () => {
  const opened = (levelId = 'lv-bool-1') => markOpened(readyState(), levelId, 1_000);

  it('窗口内（2999ms）关闭 → 这次不练，该关卡进黑名单', () => {
    const { state, intent } = closeAutoOpenedLevel(opened(), 'lv-bool-1', 3_999);
    expect(intent).toBe('this_time');
    expect(state.dismissedLevelIds).toContain('lv-bool-1');
    expect(state.openedLevelIds).not.toContain('lv-bool-1');
    expect(evaluateAutoOpen(levelCard({ cardId: 'card-2' }), state).reason).toBe('dismissed');
  });

  it('窗口边界：恰好 3000ms 算「下次再说」', () => {
    const { state, intent } = closeAutoOpenedLevel(opened(), 'lv-bool-1', 1_000 + UNDO_WINDOW_MS);
    expect(intent).toBe('later');
    expect(state.dismissedLevelIds).not.toContain('lv-bool-1');
    expect(state.openedLevelIds).not.toContain('lv-bool-1');
  });

  it('窗口外（4000ms）关闭 → 下次再说，后续仍可再弹', () => {
    const { state, intent } = closeAutoOpenedLevel(opened(), 'lv-bool-1', 5_000);
    expect(intent).toBe('later');
    expect(shouldAutoOpen(levelCard({ cardId: 'card-later' }), state)).toBe(true);
  });

  it('接线层：关闭事件由浮层报上来，本会话内不再弹 / 之后仍可弹', () => {
    const opener = vi.fn();
    registerLevelOpener(opener);

    const first = levelCard({ cardId: 'card-1' });
    expect(offerAutoOpen(first, { nowMs: 1_000 }).opened).toBe(true);
    expect(notifyAutoOpenClosed('lv-bool-1', 2_500)).toBe('this_time');

    const second = levelCard({ cardId: 'card-2' });
    expect(offerAutoOpen(second, { nowMs: 3_000 }).reason).toBe('dismissed');
    expect(opener).toHaveBeenCalledTimes(1);

    // 换成「超过 3 秒关闭」→ 同一关卡在后续一轮里可以再弹
    resetAutoOpenState(TEST_SESSION);
    registerLevelOpener(opener);
    const third = levelCard({ cardId: 'card-3' });
    expect(offerAutoOpen(third, { nowMs: 10_000 }).opened).toBe(true);
    expect(notifyAutoOpenClosed('lv-bool-1', 15_000)).toBe('later');
    const fourth = levelCard({ cardId: 'card-4' });
    expect(offerAutoOpen(fourth, { nowMs: 20_000 }).opened).toBe(true);
    expect(opener).toHaveBeenCalledTimes(3);
  });
});

/* ------------------------------------------------------------------ *
 * 验收②（票 72 版）：同会话去重 / 连续两轮只弹一次
 * ------------------------------------------------------------------ */

describe('同会话去重', () => {
  it('同一张卡重渲（同一 cardId）不会弹第二次', async () => {
    const opener = vi.fn();
    registerLevelOpener(opener);
    const artifact = levelCard();

    const { rerender } = render(createElement(ArtifactCard, { artifact }));
    await waitFor(() => expect(opener).toHaveBeenCalledTimes(1));

    rerender(createElement(ArtifactCard, { artifact }));
    await Promise.resolve();
    await Promise.resolve();
    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('连续两轮都产同一关卡的卡（cardId 不同）只弹一次', () => {
    const opener = vi.fn();
    registerLevelOpener(opener);

    const firstTurn = levelCard({ cardId: 'turn-1' });
    const secondTurn = levelCard({ cardId: 'turn-2' });

    expect(offerAutoOpen(firstTurn, { nowMs: 1_000 }).opened).toBe(true);
    expect(offerAutoOpen(secondTurn, { nowMs: 2_000 }).reason).toBe('already_opened');
    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('「这次不练」的关卡在后续轮次也不再自动弹', () => {
    const opener = vi.fn();
    registerLevelOpener(opener);

    expect(offerAutoOpen(levelCard({ cardId: 'c1' }), { nowMs: 1_000 }).opened).toBe(true);
    notifyAutoOpenClosed('lv-bool-1', 1_500); // 0.5 秒就关了 = 这次不练

    expect(offerAutoOpen(levelCard({ cardId: 'c2' }), { nowMs: 9_000 })).toMatchObject({
      opened: false,
      reason: 'dismissed',
    });
    expect(opener).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ *
 * 验收⑤：草稿推迟
 * ------------------------------------------------------------------ */

describe('草稿挡弹', () => {
  it('纯判定：草稿非空 → 不弹（reason=draft）；空白草稿等于没有草稿', () => {
    const artifact = levelCard();
    expect(evaluateAutoOpen(artifact, readyState({ draftText: '帮我看看' })).reason).toBe('draft');
    expect(shouldAutoOpen(artifact, readyState({ draftText: '   ' }))).toBe(true);
  });

  it('接线层：有草稿先挂起，草稿清空后补弹', () => {
    const opener = vi.fn();
    registerLevelOpener(opener);
    const artifact = levelCard({ cardId: 'card-draft' });

    expect(offerAutoOpen(artifact, { draftText: '我在打一半的问' }).reason).toBe('draft');
    expect(opener).not.toHaveBeenCalled();

    const flushed = offerAutoOpen(artifact, { draftText: '' });
    expect(flushed.opened).toBe(true);
    expect(opener).toHaveBeenCalledWith('lv-bool-1');
  });

  it('组件层：草稿提交/清空后才弹，不吞掉正在打的字', async () => {
    const opener = vi.fn();
    registerLevelOpener(opener);
    const artifact = levelCard();

    const Harness = ({ draft }: { draft: string }) =>
      createElement(
        'div',
        null,
        createElement('textarea', {
          'aria-label': '这一轮想说的话',
          value: draft,
          readOnly: true,
        }),
        createElement(ArtifactCard, { artifact }),
      );

    const { rerender } = render(createElement(Harness, { draft: '我想练布尔代数' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(opener).not.toHaveBeenCalled();

    rerender(createElement(Harness, { draft: '' }));
    await waitFor(() => expect(opener).toHaveBeenCalledWith('lv-bool-1'));
  });
});

/* ------------------------------------------------------------------ *
 * 验收⑥：reduce 下仍然弹
 * ------------------------------------------------------------------ */

describe('prefers-reduced-motion', () => {
  it('纯判定：reduce 不影响结论（降级的只是动画）', () => {
    const artifact = levelCard();
    expect(shouldAutoOpen(artifact, readyState({ reducedMotion: false }))).toBe(true);
    expect(shouldAutoOpen(artifact, readyState({ reducedMotion: true }))).toBe(true);
  });

  it('组件层：matchMedia 报 reduce 时仍然调用 opener', async () => {
    const opener = vi.fn();
    registerLevelOpener(opener);
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;

    try {
      render(createElement(ArtifactCard, { artifact: levelCard() }));
      await waitFor(() => expect(opener).toHaveBeenCalledWith('lv-bool-1'));
    } finally {
      window.matchMedia = original;
    }
  });
});

/* ------------------------------------------------------------------ *
 * 验收⑨：registerLevelOpener 解耦
 * ------------------------------------------------------------------ */

describe('registerLevelOpener', () => {
  it('未注册时不弹、不报错、不跳页', async () => {
    expect(() => render(createElement(ArtifactCard, { artifact: levelCard() }))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(offerAutoOpen(levelCard({ cardId: 'other-card', levelId: 'lv-other' })).opened).toBe(
      false,
    );
    expect(window.location.pathname).toBe('/');
  });

  it('注册后收到 levelId，卸载注册后不再收到', () => {
    const opener = vi.fn();
    registerLevelOpener(opener);
    offerAutoOpen(levelCard({ levelId: 'lv-kp-a', cardId: 'a1' }));
    expect(opener).toHaveBeenCalledWith('lv-kp-a');

    registerLevelOpener(null);
    resetAutoOpenState(TEST_SESSION);
    offerAutoOpen(levelCard({ levelId: 'lv-kp-b', cardId: 'b1' }));
    expect(opener).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ *
 * 票 72 验收②③⑤：卡片本体即入口
 * ------------------------------------------------------------------ */

describe('卡片本体即入口', () => {
  it('没有可见按钮，但整卡可点：role=button、tabIndex=0、带无障碍名', async () => {
    registerLevelOpener(vi.fn());
    render(createElement(ArtifactCard, { artifact: levelCard() }));
    await Promise.resolve();
    await Promise.resolve();

    // 票面的「对话里没有按钮」= 没有一颗**独立**的按钮，卡本身是入口。
    expect(document.querySelector('button')).toBeNull();
    expect(screen.queryByText('进入关卡')).toBeNull();
    expect(screen.queryByText('打开关卡')).toBeNull();

    const card = screen.getByRole('button', { name: CARD_LABEL });
    expect(card).toHaveAttribute('tabindex', '0');
    // 可点性不能只有 aria：手型指针是「这里能点」最直接的视觉线索。
    expect(getComputedStyle(card).cursor).toBe('pointer');
    // 卡还在、事实还在：删掉的只是那颗按钮，不是内容。
    expect(screen.getByText('5 题')).toBeInTheDocument();
    expect(screen.getByText('12 分钟')).toBeInTheDocument();
  });

  it('点击整卡 → 调用已注册的 opener（不整页跳转）', async () => {
    const opener = vi.fn();
    registerLevelOpener(opener);
    render(createElement(ArtifactCard, { artifact: levelCard() }));
    await waitFor(() => expect(opener).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: CARD_LABEL }));
    expect(opener).toHaveBeenCalledTimes(2);
    expect(opener).toHaveBeenLastCalledWith('lv-bool-1');
    expect(window.location.pathname).toBe('/');
  });

  it('键盘可达：Enter 与 Space 都能开', async () => {
    const opener = vi.fn();
    registerLevelOpener(opener);
    render(createElement(ArtifactCard, { artifact: levelCard() }));
    await waitFor(() => expect(opener).toHaveBeenCalledTimes(1));

    const card = screen.getByRole('button', { name: CARD_LABEL });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(opener).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(card, { key: ' ' });
    expect(opener).toHaveBeenCalledTimes(3);
    expect(opener).toHaveBeenLastCalledWith('lv-bool-1');
  });

  it('未注册 opener 时点击不报错、不跳页（保持无反应）', () => {
    render(createElement(ArtifactCard, { artifact: levelCard() }));
    expect(() => fireEvent.click(screen.getByRole('button', { name: CARD_LABEL }))).not.toThrow();
    expect(window.location.pathname).toBe('/');
    expect(openLevelFromCard('lv-bool-1')).toBe('no_opener');
  });

  it('3 秒内关掉（这次不练）之后，卡片仍可点重开 —— 撤的是自动，不是可进入', async () => {
    const opener = vi.fn();
    registerLevelOpener(opener);

    expect(offerAutoOpen(levelCard({ cardId: 'first' }), { nowMs: 1_000 }).opened).toBe(true);
    expect(notifyAutoOpenClosed('lv-bool-1', 1_500)).toBe('this_time');

    const dismissed = levelCard({ cardId: 'second' });
    render(createElement(ArtifactCard, { artifact: dismissed }));
    await Promise.resolve();
    await Promise.resolve();
    // 自动弹被挡：只有最早那次调用。
    expect(opener).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: CARD_LABEL }));
    expect(opener).toHaveBeenCalledTimes(2);
    expect(opener).toHaveBeenLastCalledWith('lv-bool-1');
    expect(openLevelFromCard('lv-bool-1')).toBe('opened');
  });
});

/* ------------------------------------------------------------------ *
 * 票 72 验收③：焦点描边对比度 ≥ 3:1（两套主题的真实色值）
 * ------------------------------------------------------------------ */

describe('焦点描边的对比度', () => {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  const luminance = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16);
    return (
      0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff)
    );
  };

  const contrast = (a: string, b: string): number => {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  it.each(['dark', 'light'] as const)('%s 主题：焦点环对卡面与画布都 ≥ 3:1', (name) => {
    const palette = palettes[name];
    const ring = palette['border-focus'];
    // 卡面（Card 的底色）与画布（描边落在卡外 2px，相邻的是画布）。
    expect(contrast(ring, palette['bg-surface'])).toBeGreaterThanOrEqual(3);
    expect(contrast(ring, palette['bg-canvas'])).toBeGreaterThanOrEqual(3);
  });

  it('样式确实用主题的焦点色与 hover 表面色（不是写死的十六进制）', () => {
    const themeSource = readFileSync(resolve(process.cwd(), 'src/theme/theme.ts'), 'utf8');
    expect(themeSource).toContain("colorStrokeFocus2: palette['border-focus']");
    expect(themeSource).toContain("colorNeutralBackground1: palette['bg-surface']");

    const cardSource = readFileSync(resolve(process.cwd(), 'src/agent/ArtifactCard.tsx'), 'utf8');
    expect(cardSource).toContain('tokens.colorStrokeFocus2');
    expect(cardSource).toContain('tokens.colorNeutralBackground1Hover');
  });
});

/* ------------------------------------------------------------------ *
 * 票 72 验收⑦：回归 —— 对话里没有整页跳转，浮层只有一条打开路径
 * ------------------------------------------------------------------ */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('回归：对话里不整页跳转，开浮层只有一条路', () => {
  it('ArtifactCard 不再 import useNavigate、不再有指向 /level/ 的导航', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/agent/ArtifactCard.tsx'), 'utf8');
    // 注释里会提到 `/level/:id`（解释为什么不再跳整页），所以先剥注释再看代码。
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/navigate/);
    expect(code).not.toMatch(/['"`]\/level\//);
    expect(code).not.toMatch(/>\s*进入关卡\s*</);
    expect(code).not.toMatch(/>\s*打开关卡\s*</);
  });

  it('除 t68 的 level/open.ts 之外，没有第二处直接调用 opener', () => {
    const root = resolve(process.cwd(), 'src');
    const offenders = sourceFiles(root)
      .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
      .filter((file) => !file.endsWith(join('level', 'open.ts')))
      .filter((file) => /(?<![\w.])openLevel\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });
});
