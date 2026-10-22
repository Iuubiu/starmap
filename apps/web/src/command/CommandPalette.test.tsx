import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/msw';
import { CommandPalette } from './CommandPalette';
import { RECENT_STORAGE_KEY } from './recent.js';
import type { GraphResponse } from '../api/generated/model';

/**
 * 命令面板的组件测试。
 *
 * 这些用例钉的是**交互契约**（开合、方向键、Enter、焦点还原、空态、窗口化），
 * 不是像素表现 —— 像素归 `.scratch/qa/scenarios/zz-palette.spec.ts` 的真浏览器。
 *
 * 图谱走 MSW 的真实 fetch 路径（而不是 mock 掉 `useGetGraph`）：缓存键是
 * 与地图页共享的那一条 `/api/v1/graph`，一旦有人把它改成
 * `['graph']` 之类的私有键，mock hook 的测试不会红，而真实页面会多拉一次
 * 3085 个节点。
 */

type Node = GraphResponse['nodes'][number];

function node(microKpId: string, name: string, moduleName = '数字逻辑', state: Node['state'] = 'unseen'): Node {
  return {
    microKpId,
    name,
    moduleId: 'digital',
    moduleName,
    moduleOrdinal: 1,
    ordinal: 1,
    depth: 1,
    percent: null,
    reviewDueAt: null,
    state,
  };
}

const BASE_NODES: Node[] = [
  node('kp-bool', '布尔代数基本运算'),
  node('kp-kmap', '卡诺图化简'),
  node('kp-signal', '信号的频谱'),
];

function graphHandler(nodes: Node[]) {
  return http.get('*/api/v1/graph', () =>
    HttpResponse.json({ nodes, edges: [], contentGaps: [], recommendedIds: [] }),
  );
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function openWithKeyboard(meta = false) {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: !meta, metaKey: meta });
}

function paletteInput(): HTMLInputElement {
  return screen.getByLabelText('搜索知识点、页面或动作') as HTMLInputElement;
}

function list(): HTMLElement {
  return screen.getByRole('listbox', { name: '命令面板结果' });
}

function listAttr(name: string): string | null {
  return list().getAttribute(name);
}

function rowNames(): string[] {
  return screen.queryAllByRole('option').map((option) => option.getAttribute('data-kind') ?? '');
}

/** 让 `window.matchMedia` 对 reduced-motion 查询返回指定值。 */
function stubReducedMotion(reduce: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  server.use(graphHandler(BASE_NODES));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('开合与焦点', () => {
  it('Ctrl+K 打开：对话框出现、输入框拿到焦点、读屏能读到 aria-modal', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    openWithKeyboard();

    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(paletteInput()));
  });

  it('Cmd+K（macOS）同样能打开', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard(true);
    await screen.findByRole('dialog', { name: '命令面板' });
  });

  it('Esc 关闭，并把焦点还回打开前的元素', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = '打开面板';
    document.body.append(trigger);
    trigger.focus();

    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('Ctrl+K 是开关：面板开着时再按一次关掉', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    await screen.findByRole('dialog');
    openWithKeyboard();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('点遮罩关闭，但点面板内部不关闭', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(dialog);
    expect(screen.queryByRole('dialog')).not.toBeNull();

    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('键盘导航', () => {
  it('打开后焦点在输入框，↑/↓ 移动 aria-activedescendant，Enter 执行', async () => {
    /* 先塞一条最近访问：空态第一行是它，Enter 才会落到 /map/:id 上。
       没有历史时第一行是页面动作「学习」，那是空态定义的正常结果。 */
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(['kp-bool']));
    const onNavigate = vi.fn();
    wrap(<CommandPalette onNavigate={onNavigate} />);
    openWithKeyboard();

    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    await waitFor(() => expect(listAttr('data-palette-total')).not.toBe('0'));

    const first = listAttr('data-palette-active');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = listAttr('data-palette-active');
    expect(second).not.toBe(first);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(listAttr('data-palette-active')).toBe(first);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0]?.[0]).toMatch(/^\/map\//);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Tab / Shift+Tab 与方向键同义，焦点不离开输入框（票面验收第 4 条）', async () => {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(['kp-bool', 'kp-kmap']));
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    await waitFor(() => expect(Number(listAttr('data-palette-total'))).toBeGreaterThan(2));
    /* fireEvent 不会改变焦点，显式聚焦一次，才能验证 Tab 之后焦点仍留在输入框。 */
    input.focus();
    expect(document.activeElement).toBe(input);

    const first = listAttr('data-palette-active');
    fireEvent.keyDown(input, { key: 'Tab' });
    const second = listAttr('data-palette-active');
    expect(second).not.toBe(first);
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(listAttr('data-palette-active')).toBe(first);
    expect(document.activeElement).toBe(input);
  });

  it('Home / End 跳到首尾', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    await waitFor(() => expect(Number(listAttr('data-palette-total'))).toBeGreaterThan(1));

    fireEvent.keyDown(input, { key: 'End' });
    const last = listAttr('data-palette-active');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(listAttr('data-palette-active')).not.toBe(last);
  });

  it('换查询时高亮回到第一条（不会停在新结果集之外）', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    await waitFor(() => expect(Number(listAttr('data-palette-total'))).toBeGreaterThan(3));

    fireEvent.keyDown(input, { key: 'End' });
    fireEvent.change(input, { target: { value: '卡诺' } });

    await waitFor(() => expect(listAttr('data-palette-nodes')).toBe('1'));
    expect(listAttr('data-palette-active')).toBe('node:kp-kmap');
  });
});

describe('空态', () => {
  it('最近访问的 3 个知识点 + 全部页面动作，不是一片空白', async () => {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(['kp-kmap', 'kp-bool', 'kp-signal']));
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    await screen.findByRole('dialog');

    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(11));
    const names = screen.getAllByRole('option').map((option) => option.textContent ?? '');
    expect(names[0]).toContain('卡诺图化简');
    for (const page of ['学习', '定级', '复验', '看板', '知识地图', '关卡市场', '数据库', '技能库']) {
      expect(screen.getByText(page, { selector: '.sm-palette__name' })).toBeInTheDocument();
    }
    /* 空查询不自动落锚点 —— 动作行只在用户把高亮移到知识点上之后出现。 */
    expect(screen.queryByText('打开详情')).toBeNull();
  });

  it('最近访问里已经失效的知识点 id 被过滤，不产生死链', async () => {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(['kp-gone', 'kp-bool']));
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));

    const text = screen.getAllByRole('option').map((option) => option.textContent ?? '').join('\n');
    expect(text).not.toContain('kp-gone');
    expect(screen.queryByText('卡诺图化简')).toBeNull();
  });
});

describe('模糊搜索与窗口化', () => {
  it('「布尔」与「卡诺」各命中，且高亮行跟着结果走', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');

    fireEvent.change(input, { target: { value: '布尔' } });
    await waitFor(() => expect(listAttr('data-palette-nodes')).toBe('1'));
    expect(screen.getByText('布尔代数基本运算', { selector: '.sm-palette__name' })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '卡诺' } });
    await waitFor(() => expect(listAttr('data-palette-nodes')).toBe('1'));
    expect(screen.getByText('卡诺图化简', { selector: '.sm-palette__name' })).toBeInTheDocument();
    expect(screen.queryByText('布尔代数基本运算')).toBeNull();
  });

  it('拼音首字母命中：输入 knt 找到「卡诺图化简」（票面验收第 2 条）', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.change(input, { target: { value: 'knt' } });

    await waitFor(() => expect(listAttr('data-palette-nodes')).toBe('1'));
    expect(screen.getByText('卡诺图化简', { selector: '.sm-palette__name' })).toBeInTheDocument();
    expect(listAttr('data-palette-active')).toBe('node:kp-kmap');
  });

  it('窗口化：DOM 行数不随结果总数增长（400 条与 1200 条渲染的一样多）', async () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => node(`kp-${index}`, `第${index}条布尔代数知识点`));

    server.use(graphHandler(many(400)));
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    let input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.change(input, { target: { value: '布尔' } });
    await waitFor(() => expect(Number(listAttr('data-palette-nodes'))).toBe(400));
    const rowsAt400 = Number(listAttr('data-palette-rows'));

    cleanup();
    server.use(graphHandler(many(1200)));
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.change(input, { target: { value: '布尔' } });
    await waitFor(() => expect(Number(listAttr('data-palette-nodes'))).toBe(1200));
    const rowsAt1200 = Number(listAttr('data-palette-rows'));

    expect(rowsAt400).toBeGreaterThan(0);
    expect(rowsAt400).toBeLessThanOrEqual(30);
    expect(rowsAt1200).toBe(rowsAt400);
  });

  it('3086 条全量排序在 100ms 内（票面验收第 2 条的组件侧证据）', async () => {
    const nodes = Array.from({ length: 3086 }, (_, index) =>
      node(`kp-${index}`, `第${index}条：布尔代数与卡诺图化简`),
    );
    server.use(graphHandler(nodes));

    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.change(input, { target: { value: '卡诺' } });

    await waitFor(() => expect(Number(listAttr('data-palette-matches'))).toBe(3086));
    const ms = Number(listAttr('data-palette-ms'));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(100);
  });
});

describe('对选中知识点的三个动作', () => {
  it('搜到知识点后，动作段给出「打开详情 / 去地图定位 / 生成关卡」', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.change(input, { target: { value: '布尔' } });

    await waitFor(() => expect(screen.getByText('打开详情')).toBeInTheDocument());
    expect(screen.getByText('去地图定位')).toBeInTheDocument();
    expect(screen.getByText('生成关卡')).toBeInTheDocument();
    /* 动作行挂在知识点这一行下面，锚点是 kp-bool */
    expect(listAttr('data-palette-active')).toBe('node:kp-bool');
  });

  it('「打开详情」落到 /map/:id', async () => {
    const onNavigate = vi.fn();
    wrap(<CommandPalette onNavigate={onNavigate} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.change(input, { target: { value: '卡诺' } });
    await waitFor(() => expect(screen.getByText('打开详情')).toBeInTheDocument());

    fireEvent.click(screen.getByText('打开详情'));
    expect(onNavigate).toHaveBeenCalledWith('/map/kp-kmap');
  });

  it('「去地图定位」落到 /map?focus=…（复用地图页的 viewHref 形状）', async () => {
    const onNavigate = vi.fn();
    wrap(<CommandPalette onNavigate={onNavigate} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.change(input, { target: { value: '卡诺' } });
    await waitFor(() => expect(screen.getByText('去地图定位')).toBeInTheDocument());

    fireEvent.click(screen.getByText('去地图定位'));
    const path = onNavigate.mock.calls[0]?.[0] as string;
    expect(path.startsWith('/map?')).toBe(true);
    expect(path).toContain('focus=kp-kmap');
  });

  it('「生成关卡」落到生成页并带上 microKpIds（不自动开跑）', async () => {
    const onNavigate = vi.fn();
    wrap(<CommandPalette onNavigate={onNavigate} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.change(input, { target: { value: '卡诺' } });
    await waitFor(() => expect(screen.getByText('生成关卡')).toBeInTheDocument());

    fireEvent.click(screen.getByText('生成关卡'));
    expect(onNavigate).toHaveBeenCalledWith('/market/generate?microKpIds=kp-kmap');
  });

  it('键盘也能走到动作行：End + Enter 执行最后一个动作', async () => {
    const onNavigate = vi.fn();
    wrap(<CommandPalette onNavigate={onNavigate} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    fireEvent.change(input, { target: { value: '卡诺' } });
    await waitFor(() => expect(screen.getByText('生成关卡')).toBeInTheDocument());

    fireEvent.keyDown(input, { key: 'End' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('/market/generate?microKpIds=kp-kmap');
  });
});

describe('无障碍与动效', () => {
  it('输入框有 aria-label，列表是 listbox，aria-activedescendant 指向高亮项', async () => {
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    const input = await screen.findByLabelText('搜索知识点、页面或动作');
    await waitFor(() => expect(Number(listAttr('data-palette-total'))).toBeGreaterThan(0));

    const active = input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    const option = document.getElementById(active as string);
    expect(option).not.toBeNull();
    expect(option?.getAttribute('role')).toBe('option');
    expect(option?.getAttribute('aria-selected')).toBe('true');
  });

  it('prefers-reduced-motion: reduce 时 data-motion=none，否则 enter', async () => {
    const restore = stubReducedMotion(true);
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    expect((await screen.findByRole('dialog')).getAttribute('data-motion')).toBe('none');
    cleanup();

    restore();
    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    expect((await screen.findByRole('dialog')).getAttribute('data-motion')).toBe('enter');
  });

  it('面板打开时侧栏的 role=tab 仍在 DOM 里（浮层不把外壳从无障碍树里摘掉）', async () => {
    const nav = document.createElement('div');
    nav.setAttribute('role', 'tablist');
    nav.innerHTML = '<button role="tab" aria-selected="true">学习</button><button role="tab">知识地图</button>';
    document.body.append(nav);

    wrap(<CommandPalette onNavigate={vi.fn()} />);
    openWithKeyboard();
    await screen.findByRole('dialog');

    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tablist')).toBe(nav);
    nav.remove();
  });
});
