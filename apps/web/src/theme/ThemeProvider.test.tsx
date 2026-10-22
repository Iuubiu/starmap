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

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-sm-theme');
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.documentElement.removeAttribute('data-sm-theme');
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

  it('系统也说不出话时落到深色', () => {
    stubColorScheme('none');
    expect(readInitialTheme()).toBe('dark');
  });

  it('localStorage 抛异常不影响出结果（隐私模式）', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    stubColorScheme('dark');
    expect(() => readInitialTheme()).not.toThrow();
    expect(readInitialTheme()).toBe('dark');
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
