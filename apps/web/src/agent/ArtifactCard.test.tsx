/**
 * 票 81：问津卡选项的一键作答。
 *
 * 这里只测 `ArtifactCard` 自己的两种渲染形态（文本行 / 按钮）与回调契约。
 * 「点一下真的发出了一轮、连点只发一次」属于跨组件的接线，由
 * `.scratch/qa/scenarios/zz-clarify.spec.ts` 在真浏览器里量请求数 —— jsdom
 * 里没有真实网络，写在这里只会得到「mock 调用了一次」这种自我安慰。
 */
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactCard } from './ArtifactCard';
import type {
  AgentTurnResponseArtifact,
  AgentTurnResponseClarify,
} from '../api/generated/model';

const CLARIFY_ARTIFACT = {
  cardId: 'card-clarify-1',
  title: '问津：布尔代数基本运算',
  createdAt: '2026-10-22T15:00:00.000Z',
  kind: 'probe_form',
  probeId: 'clarify-turn-1',
  microKpId: 'kp-bool',
  question: '这一轮，你更想为了什么？',
  ladderLevel: 1,
  ladderCap: 1,
  inputKind: 'choice',
  choices: ['为了解题', '为了看懂论文或教材', '为了补基础', '为了考试'],
  actions: [],
  rationale: '先问一句，免得我按错的深度出题——选完我立刻给关卡。',
} as unknown as AgentTurnResponseArtifact;

const CLARIFY: AgentTurnResponseClarify = {
  question: '这一轮，你更想为了什么？',
  options: ['为了解题', '为了看懂论文或教材', '为了补基础', '为了考试'],
  why: '先问一句，免得我按错的深度出题——选完我立刻给关卡。',
} as AgentTurnResponseClarify;

function renderCard(props: {
  onClarifyChoice?: (text: string) => void;
  clarifyChoiceBusy?: boolean;
  clarify?: AgentTurnResponseClarify | undefined;
}) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <ArtifactCard artifact={CLARIFY_ARTIFACT} {...props} />
    </FluentProvider>,
  );
}

describe('问津卡：没有回调时保持文本行', () => {
  it('四个选项仍是 A./B./C./D. 文本，不渲染任何按钮', () => {
    renderCard({ clarify: CLARIFY });

    expect(screen.getByText('A. 为了解题')).toBeTruthy();
    expect(screen.getByText('B. 为了看懂论文或教材')).toBeTruthy();
    expect(screen.getByText('C. 为了补基础')).toBeTruthy();
    expect(screen.getByText('D. 为了考试')).toBeTruthy();
    // 卡片外壳本身没有按钮；有按钮就说明「向后兼容」被破坏了。
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('追问卡即使传了回调也不变按钮（做题的选项要能自由组织措辞）', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <ArtifactCard artifact={CLARIFY_ARTIFACT} onClarifyChoice={() => {}} />
      </FluentProvider>,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('A. 为了解题')).toBeTruthy();
  });
});

describe('问津卡：给了回调时选项是按钮', () => {
  it('四个选项都是 role=button，aria-label 带选项原文', () => {
    renderCard({ clarify: CLARIFY, onClarifyChoice: () => {} });

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(screen.getByRole('button', { name: '选择：为了解题' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '选择：为了看懂论文或教材' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择：为了补基础' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择：为了考试' })).toBeTruthy();
  });

  it('点第 2 个选项，回调收到选项原文而不是「B. …」', () => {
    const onClarifyChoice = vi.fn();
    renderCard({ clarify: CLARIFY, onClarifyChoice });

    fireEvent.click(screen.getByRole('button', { name: '选择：为了看懂论文或教材' }));

    expect(onClarifyChoice).toHaveBeenCalledTimes(1);
    expect(onClarifyChoice).toHaveBeenCalledWith('为了看懂论文或教材');
    // 前缀是给人看的，不许混进请求体。
    expect(onClarifyChoice.mock.calls[0]?.[0]).not.toContain('B.');
  });

  it('发送中四个按钮全部 disabled，点了也不会回调', () => {
    const onClarifyChoice = vi.fn();
    renderCard({ clarify: CLARIFY, onClarifyChoice, clarifyChoiceBusy: true });

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }

    fireEvent.click(buttons[1] as HTMLButtonElement);
    expect(onClarifyChoice).not.toHaveBeenCalled();
  });
});

/**
 * 票 84：两张组（目标 + 熟练度自评）必须同时选完才合成一句可编辑的话。
 *
 * 关键断言是「选一半不回调」——只拿到目标就发请求，等于让服务端替学生
 * 猜另一半自评，首轮渲染会赌在错误的档位上。
 */
describe('票 84 问津卡的两组选项', () => {
  const CLARIFY_WITH_LEVELS: AgentTurnResponseClarify = {
    ...CLARIFY,
    selfLevelOptions: ['完全没学过', '见过但不会用', '会做但慢', '很熟'],
  };

  it('两组都渲染，未选完时「就这样开始」不可用', () => {
    const onClarifyChoice = vi.fn();
    renderCard({ clarify: CLARIFY_WITH_LEVELS, onClarifyChoice });

    expect(screen.getByRole('group', { name: '学习目标' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '熟练度自评' })).toBeTruthy();
    const start = screen.getByRole('button', { name: /先选完上面两组/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it('只选目标不回调，两组都选完才合成一句话', () => {
    const onClarifyChoice = vi.fn();
    renderCard({ clarify: CLARIFY_WITH_LEVELS, onClarifyChoice });

    fireEvent.click(screen.getByRole('button', { name: '学习目标：为了考试' }));
    expect(onClarifyChoice).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '熟练度自评：见过但不会用' }));
    expect(onClarifyChoice).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /就这样开始/ }));
    expect(onClarifyChoice).toHaveBeenCalledTimes(1);
    const sent = onClarifyChoice.mock.calls[0]?.[0] ?? '';
    // 两个答案都要在句子里，且不带 A./✓ 这类渲染前缀。
    expect(sent).toContain('为了考试');
    expect(sent).toContain('见过但不会用');
    expect(sent).not.toContain('A.');
    expect(sent).not.toContain('✓');
  });

  it('选中项 aria-pressed 为真，切换后原项恢复', () => {
    renderCard({ clarify: CLARIFY_WITH_LEVELS, onClarifyChoice: vi.fn() });
    const first = screen.getByRole('button', { name: '熟练度自评：完全没学过' });
    const second = screen.getByRole('button', { name: '熟练度自评：很熟' });

    fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(second);
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(second.getAttribute('aria-pressed')).toBe('true');
  });

  it('没有自评组时退回 t79 行为：点一下就提交', () => {
    const onClarifyChoice = vi.fn();
    renderCard({ clarify: CLARIFY, onClarifyChoice });
    fireEvent.click(screen.getByRole('button', { name: '选择：为了补基础' }));
    expect(onClarifyChoice).toHaveBeenCalledWith('为了补基础');
  });
});
