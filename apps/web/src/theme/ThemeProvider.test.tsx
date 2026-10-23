import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, readInitialTheme, useTheme } from './ThemeProvider';

/**
 * 主题切换的守门测试。
 *
 * 这里只测**行为契约**（属性写没写、localStorage 记没记、按钮读到的状态对不对），
 * 不测具体颜色 —— 颜色由 `tokens.test.ts` 与 `contrast-check.mjs` 负责，
 * 而且 jsdom 不做布局与配色计算，在这里断言颜色只会得到假绿。
 */

function Probe(): React.ReactElement {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme} aria-pressed={theme === 'dark'}>
      {theme}
    </button>
  );
}

const originalMatchMedia = window.matchMedia;

/** 让 `matchMedia` 只对指定查询返回 true。 */
function stubColorScheme(scheme: 'dark' | 'light' | 'none'): void {
  window.matchMedia = ((query: string) => ({
    matches: scheme === 'none' ? false : query.includes(scheme),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * 两个属性都要清。
 *
 * `applyThemeToDocument` 会**同时**写 `data-sm-mode` 与 `data-sm-theme`，
 * 而 jsdom 的 `document` 是跨用例共享的。只清 theme 会留下上一用例的 mode：
 * 下一个用例里 `ThemeProvider` 读到 `data-sm-mode='light'`，就从亮色开始
 * 切换 —— 断言「切一次变亮」自然失败。这不是实现的问题，是用例之间漏了隔离。
 */
function resetDocumentTheme(): void {
  document.documentElement.removeAttribute('data-sm-mode');
  document.documentElement.removeAttribute('data-sm-theme');
  document.documentElement.style.colorScheme = '';
}

beforeEach(() => {
  window.localStorage.clear();
  resetDocumentTheme();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  resetDocumentTheme();
  vi.restoreAllMocks();
});

describe('readInitialTheme', () => {
  it('优先用 localStorage 里的显式选择', () => {
    window.localStorage.setItem('starmap.theme', 'light');
    stubColorScheme('dark');
    expect(readInitialTheme()).toBe('light');
  });

  it('没有显式选择时跟随系统', () => {
    stubColorScheme('light');
    expect(readInitialTheme()).toBe('light');
  });

  it('系统也说不出话时落到浅色（默认主题已改为浅色，见 56b7d08）', () => {
    stubColorScheme('none');
    expect(readInitialTheme()).toBe('light');
  });

  it('localStorage 抛异常不影响出结果（隐私模式）', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    stubColorScheme('dark');
    expect(() => readInitialTheme()).not.toThrow();
    expect(readInitialTheme()).toBe('light');
  });

  it('localStorage 里是垃圾值时忽略它', () => {
    window.localStorage.setItem('starmap.theme', 'solarized');
    stubColorScheme('light');
    expect(readInitialTheme()).toBe('light');
  });
});

describe('ThemeProvider', () => {
  it('挂载时把主题写到 <html data-sm-theme>', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-sm-theme')).toMatch(/^(dark|light)$/);
  });

  it('优先沿用内联脚本已经写好的属性（避免首帧与 CSS 不一致）', () => {
    document.documentElement.setAttribute('data-sm-theme', 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('light');
  });

  it('切换会同时更新 DOM 属性与 localStorage', async () => {
    document.documentElement.setAttribute('data-sm-theme', 'dark');
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('dark');

    await user.click(button);

    expect(button).toHaveTextContent('light');
    expect(document.documentElement.getAttribute('data-sm-theme')).toBe('light');
    expect(window.localStorage.getItem('starmap.theme')).toBe('light');
  });

  it('localStorage 写入失败也不影响本次切换', async () => {
    document.documentElement.setAttribute('data-sm-theme', 'dark');
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await act(async () => {
      await user.click(screen.getByRole('button'));
    });

    expect(screen.getByRole('button')).toHaveTextContent('light');
  });

  it('在 Provider 外调用 useTheme 会立刻抛错（不静默兜底）', () => {
    // React 会把渲染期异常打到 console.error，测试输出里不该有噪音。
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    consoleError.mockRestore();
  });
});
