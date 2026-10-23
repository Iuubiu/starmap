/**
 * 清单搜索的组件行为（票 86）。
 *
 * 纯函数（中文子串、拼音首字母、保序）在 `roster-search.test.ts` 里测；这里
 * 测的是**接起来之后**学生看到的东西：敲字就筛、数字跟着变、筛空有话说、
 * 清除与 Esc 能回到全部、清单项点下去仍然进关卡。
 *
 * 这些断言刻意不碰画布：搜索只改变清单显示哪几条，画布渲染归 Playwright。
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../api/generated/model';
import { GraphNodeState } from '../api/generated/model';
import { NodeRoster } from './NodeRoster.js';

function node(microKpId: string, name: string, ordinal: number): GraphNode {
  return {
    microKpId,
    name,
    moduleId: 'm-digital',
    moduleName: '数字逻辑基础',
    moduleOrdinal: 1,
    depth: 1,
    ordinal,
    percent: 0.5,
    reviewDueAt: null,
    state: GraphNodeState.attempted,
  };
}

const NODES: readonly GraphNode[] = [
  node('kp-1', '卡诺图', 1),
  node('kp-2', '布尔代数基本运算', 2),
  node('kp-3', '半导体探测器', 3),
];

function setup() {
  const onOpen = vi.fn();
  render(<NodeRoster nodes={NODES} focusId={null} onOpen={onOpen} />);
  const input = screen.getByRole('searchbox', { name: '按名字筛选知识点' });
  return { onOpen, input };
}

function rosterItems(): HTMLElement[] {
  const list = screen.getByRole('list', { name: '当前视野内的微知识点' });
  return within(list).getAllByRole('button');
}

describe('NodeRoster 按名字找点', () => {
  it('初始显示全部，并报总数', () => {
    setup();
    expect(rosterItems()).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent('共 3 个知识点');
  });

  it('输入中文片段即筛，状态行给出命中数', async () => {
    const user = userEvent.setup();
    const { input } = setup();

    await user.type(input, '卡诺');

    expect(rosterItems()).toHaveLength(1);
    expect(rosterItems()[0]).toHaveTextContent('卡诺图');
    expect(screen.getByRole('status')).toHaveTextContent('筛选出 1 个，共 3 个知识点');
  });

  it('输入拼音首字母同样命中', async () => {
    const user = userEvent.setup();
    const { input } = setup();

    await user.type(input, 'knt');

    expect(rosterItems()).toHaveLength(1);
    expect(rosterItems()[0]).toHaveTextContent('卡诺图');
  });

  it('筛空时给出去向，而不是渲染空列表', async () => {
    const user = userEvent.setup();
    const { input } = setup();

    await user.type(input, 'zzz');

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText(/没有找到叫「zzz」的知识点/)).toBeInTheDocument();
  });

  it('「清除」回到全部，并把焦点还给输入框', async () => {
    const user = userEvent.setup();
    const { input } = setup();

    await user.type(input, '卡诺');
    await user.click(screen.getByRole('button', { name: '清除' }));

    expect(rosterItems()).toHaveLength(3);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('Esc 也能清空搜索', async () => {
    const user = userEvent.setup();
    const { input } = setup();

    await user.type(input, 'knt');
    await user.type(input, '{Escape}');

    expect(input).toHaveValue('');
    expect(rosterItems()).toHaveLength(3);
  });

  it('筛出的清单项仍然点击进关卡（保留原行为）', async () => {
    const user = userEvent.setup();
    const { input, onOpen } = setup();

    await user.type(input, '卡诺');
    await user.click(rosterItems()[0]!);

    expect(onOpen).toHaveBeenCalledWith('kp-1');
  });
});
