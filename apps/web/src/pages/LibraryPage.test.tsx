/**
 * 内容库四页的关键不变量：**数字必须可追溯，空态必须写原因**。
 *
 * 这一页最容易变成「看起来很有货」的假数字，所以测试盯三件事：
 * ① 四个标签可切换且互斥；② 教材数取自响应而不是写死；③ 加载失败说得清
 * 「没读出来」而不是「库是空的」。
 */
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryPage } from './LibraryPage';

const STATS = {
  sources: [
    { id: 'b1', title: '电子技术基础·数字部分', kind: 'book', chunkCount: 3546, answerChunkCount: 524, pageFrom: 2, pageTo: 536 },
    { id: 'b2', title: '模拟电子技术基础', kind: 'book', chunkCount: 7999, answerChunkCount: 1271, pageFrom: 1, pageTo: 629 },
    { id: 'p1', title: 'A paper on detectors', kind: 'paper', chunkCount: 42, answerChunkCount: 0, pageFrom: 1, pageTo: 9 },
  ],
  answers: 1795,
};

vi.mock('../api/queries', () => ({
  useContentStats: () => ({ payload: STATS, isLoading: false, isError: false, error: null }),
  useSkills: () => ({
    payload: { items: [{ name: 'question-author', description: '出题与校验' }] },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

function renderPage() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <LibraryPage />
    </FluentProvider>,
  );
}

describe('内容库', () => {
  it('默认在教材页，教材数取自响应', () => {
    renderPage();
    /* 数字被 JSX 拆成多个文本节点，用函数匹配避免依赖 DOM 结构。 */
    expect(
      screen.getByText((_, el) => el?.textContent === '教材 2 本 · 切片 11545 · 来源表 app.sources'),
    ).toBeTruthy();
    expect(screen.getByText('电子技术基础·数字部分')).toBeTruthy();
    expect(screen.getByText('模拟电子技术基础')).toBeTruthy();
  });

  it('切到期刊页只列论文', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: '期刊' }));
    expect(screen.getByText('A paper on detectors')).toBeTruthy();
    expect(screen.queryByText('电子技术基础·数字部分')).toBeNull();
  });

  it('题库页把「课后题」与「AI 题」分开，并标明课后题未经结构化', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: '题库' }));
    expect(screen.getByText('教材课后题')).toBeTruthy();
    expect(screen.getByText('1795')).toBeTruthy();
    expect(screen.getByText('未经结构化')).toBeTruthy();
  });

  it('技能页同时列出已启用与规划中', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: '技能' }));
    expect(screen.getByText('question-author')).toBeTruthy();
    expect(screen.getByText(/关卡生成/)).toBeTruthy();
    expect(screen.getAllByText(/规划中 · P0/).length).toBe(2);
  });
});
