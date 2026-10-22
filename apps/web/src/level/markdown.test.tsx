/**
 * 富文本渲染器的单测。
 *
 * 存在的理由：`renderMath` / `plainText` / `RichText` 是**所有**作者预写文本
 * （讲稿、题干、选项、答对/答错讲解、复验题目）的唯一渲染路径。它一旦退化成
 * 直插字符串，学生看到的就是 `$A \oplus A·B$` 这种 LaTeX 源码 —— 而那种
 * 退化**不会**让任何一条「文本内容对不对」的测试变红（源码里本来就含那些
 * 字符），所以必须在这里钉死「源码不出现」这一条。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { InlineRich, RichText, plainText, renderMath } from './markdown';

/** 把渲染结果摊平成可见文本。 */
function textOf(node: React.ReactElement): string {
  const { container } = render(node);
  return container.textContent ?? '';
}

describe('renderMath：LaTeX 命令翻成可读 Unicode', () => {
  it('翻常用命令', () => {
    expect(renderMath('A \\oplus A·B')).toBe('A ⊕ A·B');
    expect(renderMath('A \\cap B \\cup C')).toBe('A ∩ B ∪ C');
    expect(renderMath('A \\Rightarrow B')).toBe('A ⇒ B');
    expect(renderMath('A \\neq B')).toBe('A ≠ B');
  });

  it('\\overline 给每个字母加组合长音符，而不是压到最后一个字符上', () => {
    // `A̅·B̅` 与 `A·B̅` 的区别就是「整体取反」与「只取反 B」的区别。
    expect(renderMath('\\overline{A·B}')).toBe('A\u0304·B\u0304');
    expect(renderMath('\\overline{A}')).toBe('A\u0304');
  });

  it('嵌套的 \\overline 也能折完', () => {
    expect(renderMath('\\overline{\\overline{A}·\\overline{B}}')).toBe('A\u0304\u0304·B\u0304\u0304');
  });

  it('翻不了的命令原样保留，让作者看见问题', () => {
    // 悄悄吃掉比显示 `\frac` 更糟：前者是静默丢信息，后者作者一眼能发现。
    expect(renderMath('\\frac{1}{2}')).toBe('\\frac{1}{2}');
  });
});

describe('plainText：题干与选项走的纯文本路径', () => {
  it('去掉 $ 并翻命令', () => {
    expect(plainText('下列哪一个式子恒等于 $A$？')).toBe('下列哪一个式子恒等于 A？');
    expect(plainText('$A \\oplus A·B$')).toBe('A ⊕ A·B');
  });

  it('去掉 ** 与反引号', () => {
    expect(plainText('**重点** 与 `code`')).toBe('重点 与 code');
  });

  it('不再残留 $ 符号', () => {
    expect(plainText('$A + A·B = A$')).not.toContain('$');
  });
});

describe('RichText：讲稿与讲解走的富文本路径', () => {
  it('公式渲染成 span，源码不出现在可见文本里', () => {
    const text = textOf(<RichText body="吸收律 $A + A·B = A$ 就是这个形状。" />);
    expect(text).toContain('吸收律 A + A·B = A 就是这个形状。');
    expect(text).not.toContain('$');
  });

  it('空行分段，段内单换行保留为换行', () => {
    // 推导常写「一行一步」，合并成一句会把推导糊成一段。
    const { container } = render(<RichText body={'第一行\n第二行\n\n第二段'} />);
    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(container.textContent).toContain('第一行第二行');
  });

  it('粗体与代码渲染成对应元素', () => {
    const { container } = render(<RichText body={'**重点** 与 `code`'} />);
    expect(container.querySelector('strong')?.textContent).toBe('重点');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('不信任内容：HTML 标签当纯文本', () => {
    // 内容来自教师与 AI，一律不透传 HTML。
    const text = textOf(<RichText body="<script>alert(1)</script>" />);
    expect(text).toBe('<script>alert(1)</script>');
  });
});

describe('InlineRich：行内记号', () => {
  it('一段里的公式被切成独立 span（渲染确实发生了）', () => {
    const { container } = render(<InlineRich text="多出来的 $B$ 被 $A$ 吸收了" />);
    expect(container.textContent).toBe('多出来的 B 被 A 吸收了');
    expect(container.querySelectorAll('span').length).toBeGreaterThanOrEqual(2);
  });
});
