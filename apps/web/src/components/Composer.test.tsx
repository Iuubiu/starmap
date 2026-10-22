/**
 * Composer（票 83）：唯一输入条的组件测试。
 *
 * 重点不在「渲染出来了」，而在三条**行为契约**：
 * 1. 三层都在（框、框内底行、框下工具条）—— 工具条的显隐由 CSS
 *    `:focus-within` 负责，jsdom 不算样式，所以这里只断言结构存在，
 *    淡入淡出交给 `zz-layout-2560` 的真实浏览器探针。
 * 2. Enter 提交、Shift+Enter 换行、输入法选词时 Enter 不提交。
 * 3. 提交中与空文本时发送按钮禁用 —— 一条都不能漏，否则同一句话会发两轮。
 */
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const value = overrides.value ?? '';
  const props = {
    value,
    onChange,
    onSubmit,
    ...overrides,
  } as Parameters<typeof Composer>[0];
  const view = render(
    <FluentProvider theme={webLightTheme}>
      <Composer {...props} />
    </FluentProvider>,
  );
  return { ...view, onChange, onSubmit };
}

describe('Composer：三层结构', () => {
  it('输入框带占位文案与可访问名', () => {
    renderComposer({ placeholder: '说一句你想学什么' });
    const input = screen.getByLabelText('这一轮想说的话');
    expect(input.tagName).toBe('TEXTAREA');
    expect(input).toHaveAttribute('placeholder', '说一句你想学什么');
  });

  it('框内底行有 ＋ / 档位 / 模型 / 麦克风 / 圆形发送', () => {
    renderComposer({ tierLabel: 'P2' });
    expect(screen.getByRole('button', { name: '添加内容' })).toBeInTheDocument();
    expect(screen.getByLabelText('当前档位 P2')).toHaveTextContent('P2');
    expect(screen.getByRole('button', { name: '选择模型（当前 默认模型）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '语音输入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交这一轮' })).toBeInTheDocument();
  });

  it('框下工具条是四件事：期刊下载器 / 文件 / 插件 / 视图切换', () => {
    renderComposer();
    const toolbar = screen.getByLabelText('输入区工具');
    expect(toolbar).toBeInTheDocument();
    for (const label of ['期刊下载器', '文件', '插件', '视图切换']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('context 与 hint 是插槽：传了才渲染', () => {
    const { rerender } = renderComposer({ context: <span>当前知识点 A</span> });
    expect(screen.getByText('当前知识点 A')).toBeInTheDocument();

    rerender(
      <FluentProvider theme={webLightTheme}>
        <Composer value="" onChange={vi.fn()} onSubmit={vi.fn()} hint={<span>还能写 12 字</span>} />
      </FluentProvider>,
    );
    expect(screen.getByText('还能写 12 字')).toBeInTheDocument();
    expect(screen.queryByText('当前知识点 A')).not.toBeInTheDocument();
  });
});

describe('Composer：键盘', () => {
  it('Enter 提交一次', () => {
    const { onSubmit } = renderComposer({ value: '我想学布尔代数' });
    fireEvent.keyDown(screen.getByLabelText('这一轮想说的话'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Shift+Enter 不提交（换行）', () => {
    const { onSubmit } = renderComposer({ value: '我想学布尔代数' });
    fireEvent.keyDown(screen.getByLabelText('这一轮想说的话'), { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('输入法选词时的 Enter 不提交', () => {
    const { onSubmit } = renderComposer({ value: '布尔' });
    fireEvent.keyDown(screen.getByLabelText('这一轮想说的话'), {
      key: 'Enter',
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('空文本按 Enter 不发', () => {
    const { onSubmit } = renderComposer({ value: '   ' });
    fireEvent.keyDown(screen.getByLabelText('这一轮想说的话'), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('Composer：发送按钮与禁用', () => {
  it('点发送把这一轮交出去', () => {
    const { onSubmit } = renderComposer({ value: '我想学布尔代数' });
    fireEvent.click(screen.getByRole('button', { name: '提交这一轮' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('空文本时发送按钮禁用', () => {
    renderComposer({ value: '' });
    expect(screen.getByRole('button', { name: '提交这一轮' })).toBeDisabled();
  });

  it('提交中：输入框与发送都禁用，发送按钮改口径为「正在发送」', () => {
    renderComposer({ value: '我想学布尔代数', busy: true });
    expect(screen.getByLabelText('这一轮想说的话')).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在发送' })).toBeDisabled();
  });

  it('maxLength 透传给 textarea（契约上限 2000 字）', () => {
    renderComposer({ maxLength: 2000 });
    expect(screen.getByLabelText('这一轮想说的话')).toHaveAttribute('maxlength', '2000');
  });

  it('输入触发 onChange', () => {
    const { onChange } = renderComposer();
    fireEvent.change(screen.getByLabelText('这一轮想说的话'), { target: { value: '卡诺图' } });
    expect(onChange).toHaveBeenCalledWith('卡诺图');
  });
});
