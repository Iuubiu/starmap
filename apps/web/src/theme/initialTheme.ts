import type { ThemeMode, ThemeName } from './tokens';

/**
 * 「首帧该用哪套色」的**唯一判定**。
 *
 * ## 为什么单独一个模块
 *
 * 同一个判定要出现在两个地方：`index.html` 的 `<head>` 内联脚本（在 React
 * 挂载之前同步跑，决定第一帧是什么颜色）与 React 这边的初始化（决定
 * `FluentProvider` 拿到哪套 theme）。两处各写一遍 if-else，是「首帧闪一下」
 * 的经典成因 —— 两份代码今天一样、半年后不一定一样，而且差异只在某台机器
 * 的某次冷启动里出现，谁也不会复现。
 *
 * 所以判定抽成**纯函数**（只吃两个入参，不碰 window）：`ThemeProvider` 与
 * `initialTheme.test.ts` 都用它；`index.html` 里那段脚本是它的直译，
 * `initialTheme.test.ts` 会**真的执行** `<head>` 里的脚本文本、把结果与本
 * 函数逐项比对 —— 不是靠注释提醒，而是靠测试钉住。
 *
 * ## 判定顺序
 *
 * 用户显式选择 → 系统偏好 → 深色。
 *
 * 「未表态」不是第四种状态：它落到 `system`，也就是**跟随系统**。这条与
 * `index.html` 里那段脚本原本的注释一致（"用户显式选择 → 系统偏好 → 深色"）。
 * 曾经有一版注释说「默认强制暗，因为用户要求换掉 Windows 的浅灰」，但那样
 * 会在**深色系统**上表现不出任何差别、在浅色系统上违背用户自己的系统设置，
 * 而且与内联脚本的实际行为不一致 —— 不一致的代价就是首帧闪一下。默认值
 * 由 `DEFAULT_MODE` 一处给出，改它只需改这一个常量。
 */

/** `localStorage` 的键。改了要同步 `index.html` 与 e2e。 */
export const THEME_STORAGE_KEY = 'starmap.theme';

/** 无人表态时生效的模式：跟随系统。 */
export const DEFAULT_MODE: ThemeMode = 'system';

/** 系统也说不出话时落到哪套色。 */
export const FALLBACK_THEME: ThemeName = 'light';

export const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'system' || value === 'dark' || value === 'light';

export const isThemeName = (value: unknown): value is ThemeName => value === 'dark' || value === 'light';

export type InitialThemeDecision = {
  /** 用户的选择；没有合法存储值时是 `DEFAULT_MODE`。 */
  mode: ThemeMode;
  /** 真正决定像素的那一个。 */
  theme: ThemeName;
};

/**
 * 纯函数：给定存储值与该时刻的系统偏好，算出首帧的模式与主题。
 *
 * @param stored `localStorage.getItem(THEME_STORAGE_KEY)` 的原始值（可能是
 *   `null`、也可能是被别的程序写坏的垃圾）
 * @param system 系统偏好；`null` 表示「系统说不出话」（无 `matchMedia`、
 *   或被隐私设置挡住）。刻意不是 `boolean`：`false` 与「说不出话」在
 *   语义上不同 —— 前者是「系统明确要亮色」，后者是「不知道」。用布尔会
 *   把这两种情况压成一个，于是「系统说不出话」会被误判成「亮色」。
 */
export function decideInitialTheme(stored: string | null, system: ThemeName | null): InitialThemeDecision {
  const mode: ThemeMode = isThemeMode(stored) ? stored : DEFAULT_MODE;
  if (mode === 'system') return { mode, theme: system ?? FALLBACK_THEME };
  return { mode, theme: mode };
}
