import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { FluentProvider } from '@fluentui/react-components';
import { makeRaycastTheme } from './theme';
import { palettes, type ThemeMode, type ThemeName } from './tokens';

/**
 * 主题挂载点：唯一的 `FluentProvider`。
 *
 * ## 为什么 `main.tsx` 和 `App.tsx` 里那个 provider 要合并到这里
 *
 * 改之前这两处各写了一遍 `<FluentProvider theme={webLightTheme}>`（嵌套两层，
 * 内层覆盖外层，纯冗余）。主题一旦可切换，两处各自持有一个 `theme` 对象就会
 * 打架：外层切了、内层还钉着浅色，组件读到的是内层的。所以 provider 只留
 * 一处，位置在 `<StrictMode>` 里、`<QueryClientProvider>` 外 —— 它提供的是
 * design token 与方向上下文，所有子树（含查询错误提示）都要能读。
 *
 * ## 三个状态，两个值
 *
 * 用户能选三种（跟随系统 / 强制暗 / 强制暗），真正决定像素的只有两种
 * （`dark` / `light`）。把两者混成一个字段是常见错误：那样「跟随系统」就
 * 没有地方存，切到系统亮色再切回来时会丢掉用户原本的选择。
 *
 * - `data-sm-mode` = 用户的选择（`system` / `dark` / `light`）
 * - `data-sm-theme` = 解析后的主题（`dark` / `light`）
 *
 * `tokens.css` 只认后者，切换按钮只读前者。
 *
 * ## 为什么默认是「强制暗」而不是「跟随系统」
 *
 * 用户的原话是「用 raycast 风格代替 windows 的 f2 风格」。Windows 的默认
 * 外观就是跟随系统，而绝大多数 Windows 机器是浅色 —— 默认跟随系统，等于
 * 把用户刚要求换掉的那套浅灰界面原样还给他。所以「无人表态时是深色」，
 * 系统偏好是**可选项**而不是默认值。
 *
 * ## 为什么主题状态写在 `<html>` 上而不是 React state 里
 *
 * 首帧必须是对的主题。`index.html` 的内联脚本在 CSS 生效前就把
 * `data-sm-theme` 写好，`tokens.css` 用属性选择器命中颜色，于是深色用户
 * 从第一次绘制就是深色，不会白闪。React 这边的 `useState` 只是**镜像**这个
 * 属性：它是给需要知道当前主题的组件（切换按钮的 aria-pressed）用的，不是
 * 真源。真源是 DOM 属性，因为它比 React 早。
 */

export const THEME_STORAGE_KEY = 'starmap.theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'system' || value === 'dark' || value === 'light';

const isThemeName = (value: unknown): value is ThemeName =>
  value === 'dark' || value === 'light';

/** 系统当前偏好；系统说不出话（无匹配）时返回 `null`。 */
function systemPreference(): ThemeName | null {
  try {
    if (window.matchMedia?.(DARK_QUERY).matches) return 'dark';
    if (window.matchMedia?.(LIGHT_QUERY).matches) return 'light';
  } catch {
    /* matchMedia 在极老的浏览器里可能不存在 */
  }
  return null;
}

/** 把一个模式解析成真正生效的主题。`system` 说不出话时落到深色。 */
export function resolveTheme(mode: ThemeMode, system: ThemeName | null = systemPreference()): ThemeName {
  if (mode === 'system') return system ?? 'dark';
  return mode;
}

/**
 * 读用户的选择。顺序：localStorage 的显式选择 → 深色（默认）。
 *
 * 全程 try/catch：`localStorage` 在隐私模式 / 被策略禁用时**读**也会抛
 * （Safari 的 `SecurityError`），而主题读不出来不该让整个应用白屏。
 */
export function readStoredMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    /* 读不到就继续往下猜 */
  }
  return 'dark';
}

/** 把模式与解析后的主题写到 `<html>`，并同步 `color-scheme`。 */
export function applyThemeToDocument(mode: ThemeMode, theme: ThemeName): void {
  const root = document.documentElement;
  root.setAttribute('data-sm-mode', mode);
  root.setAttribute('data-sm-theme', theme);
  // `tokens.css` 里已经按属性选择器写了 `color-scheme`，这里再写一遍是为了
  // 覆盖「JS 先于 CSS 加载完」的时序，且让 SSR/快照测试能直接读到。
  root.style.colorScheme = theme;
}

type ThemeContextValue = {
  /** 用户的选择（三态）。 */
  mode: ThemeMode;
  /** 解析后真正生效的主题（两态）。 */
  theme: ThemeName;
  /** 显式切换并持久化。 */
  setMode: (next: ThemeMode) => void;
  /** 在深/浅之间来回（会把模式钉成强制，而不是跟随系统）。 */
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    // 内联脚本已经把属性写好了；以它为准，避免 React 首帧与 CSS 不一致。
    const fromDom = document.documentElement.getAttribute('data-sm-mode');
    return isThemeMode(fromDom) ? fromDom : readStoredMode();
  });

  // 系统偏好是外部状态：只在 `system` 模式下影响结果，但必须持续订阅 ——
  // 用户可能一边开着页面一边在系统设置里切外观。
  const [system, setSystem] = useState<ThemeName | null>(() => systemPreference());

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystem(systemPreference());
    mql.addEventListener('change', onChange);
    // 立刻同步一次：首次渲染到 effect 之间系统偏好可能已经变了。
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const theme: ThemeName = mode === 'system' ? (system ?? 'dark') : mode;

  useEffect(() => {
    applyThemeToDocument(mode, theme);
  }, [mode, theme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* 存不下就只在本次会话生效，不影响切换 */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setMode(theme === 'dark' ? 'light' : 'dark');
  }, [setMode, theme]);

  // 两套 Theme 对象都是纯数据，按主题名缓存一次即可。切主题时换引用，
  // FluentProvider 会重算它自己的 CSS 变量 —— 这正是我们要的。
  const fluentTheme = useMemo(() => makeRaycastTheme(palettes[theme], theme), [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, theme, setMode, toggleTheme }),
    [mode, setMode, theme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <FluentProvider theme={fluentTheme} style={{ height: '100%' }}>
        {children}
      </FluentProvider>
    </ThemeContext.Provider>
  );
}

/**
 * 读当前主题。
 *
 * 刻意**不**提供默认值：在 `ThemeProvider` 外面调用它说明组件挂错了层，
 * 静默返回 `dark` 会让这个错误一直藏着。抛错更早暴露。
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  return ctx;
}

/** 仅供测试与探针使用：判断一个值是不是合法的模式。 */
export const isThemeModeValue = isThemeMode;
export { isThemeName };
