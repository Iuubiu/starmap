/**
 * 设计 token 单一真源（代码侧）。
 *
 * ## 为什么是「两套 palette + 一个键集」
 *
 * 两套主题的语义键**完全一致**，只有值不同。这条不是洁癖：它让组件里永远
 * 不需要 `dark ? '#111' : '#fff'`。条件取色一旦出现，第三个主题（高对比）
 * 就会把它变成 if-else 迷宫，而真正需要区分的是「语义角色」而不是「明暗」。
 *
 * 阴影也是颜色的一种：深色下阴影几乎不可见、亮色下必须更淡，所以它同样
 * 进 palette（`shadow-*` / `glow-accent` 键），而不是在映射层写三元。
 *
 * ## 为什么颜色用 kebab-case 字符串键而不是驼峰
 *
 * 这些键同时是 CSS 自定义属性的后缀（`--sm-bg-surface`）。用同一套拼写，
 * `paletteToCssVars()` 与 `tokens.css` 才能机械对照。
 *
 * ## 时长/缓动的真源不在这里
 *
 * 唯一真源是 `src/motion/tokens.ts`（anim-dev 的 t65）。本文件只是把它换算成
 * CSS 变量名，**不重新定义毫秒数**——两份真源的典型症状是「同一界面两段动画
 * 速度不同」，而那种缺陷没人能一眼指出来。
 */
import { easeInOut, easeOut, quick, slow, standard, instant } from '../motion/tokens';

/** 语义色键。新增键必须同时加进两套 palette，否则 `Palette` 类型报错。 */
export const COLOR_KEYS = [
  // 层级表面
  'bg-canvas',
  'bg-surface',
  'bg-elevated',
  'bg-sunken',
  'bg-hover',
  'bg-selected',
  'bg-input',
  'bg-scrim',
  'bg-disabled',
  // 边框
  'border-hairline',
  'border-control',
  'border-focus',
  'border-disabled',
  // 文字
  'text-primary',
  'text-secondary',
  'text-tertiary',
  'text-disabled',
  // 唯一强调色
  'accent',
  'accent-fill',
  'accent-hover',
  'accent-pressed',
  'accent-soft',
  'on-accent',
  // 语义色
  'success',
  'warning',
  'danger',
  'info',
  'success-soft',
  'warning-soft',
  'danger-soft',
  'info-soft',
  // 图谱画布（专有语义）
  'graph-canvas',
  'graph-canvas-grid',
  'graph-edge',
  'graph-label',
  'graph-label-muted',
  'graph-node-backdrop',
  'graph-focus-ring',
  'graph-node-unseen',
  'graph-node-learning',
  'graph-node-mastered',
  'graph-node-review',
  // 关卡选项（专有语义）
  'option-idle-border',
  'option-hover-bg',
  'option-selected-bg',
  'option-selected-border',
  'option-correct',
  'option-wrong',
] as const;

/**
 * 阴影 / 发光键。
 *
 * 与颜色分开列，是因为它们的值不是颜色而是完整的 `box-shadow` 字符串；
 * 但**仍然进 palette**，这样映射层不需要 `isDark ? A : B`。
 */
export const SHADOW_KEYS = ['shadow-sm', 'shadow-md', 'shadow-lg', 'glow-accent'] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];
export type ShadowKey = (typeof SHADOW_KEYS)[number];
export type Palette = Record<ColorKey | ShadowKey, string>;

/** 解析后的主题（真正决定像素的那一个）。 */
export type ThemeName = 'dark' | 'light';

/**
 * 用户的选择：跟随系统 / 强制亮 / 强制暗。
 *
 * 三态而不是两态：`system` 不是「没选」，它是**一个有效的选择**，而且是最
 * 常见的那个。把它折叠成「没存东西 → 深色」，会让系统切到亮色的用户每次
 * 打开都要手动切一次。
 */
export type ThemeMode = 'system' | 'dark' | 'light';

/**
 * 深色 —— **默认主题**。
 *
 * 层级靠明度台阶 + 1px hairline，不靠投影：深底上阴影几乎不可见，而
 * `#0B0B0F → #15151A → #1C1C22` 这种台阶反而读得出来。台阶刻意做窄，
 * 一旦把 hover 做成 1.6 倍就开始像 Material 而不是 Raycast。
 *
 * 强调色只有一支（Raycast 红 `#FF6B6B`）：选中态指示条、主按钮、焦点环、
 * 当前进度。`accent` 是前景/指示用（在近黑底上 7:1），`accent-fill` 是
 * 实心填充用（白字在其上 4.9:1，过 AA）。
 */
export const darkPalette: Palette = {
  'bg-canvas': '#0B0B0F',
  'bg-surface': '#15151A',
  'bg-elevated': '#1C1C22',
  'bg-sunken': '#08080B',
  'bg-hover': '#22222A',
  'bg-selected': '#2A2A33',
  'bg-input': '#101014',
  'bg-scrim': 'rgba(5,5,8,0.72)',
  'bg-disabled': '#14141A',

  'border-hairline': 'rgba(255,255,255,0.09)',
  'border-control': '#6E6E79',
  'border-focus': '#FF6B6B',
  'border-disabled': '#2A2A33',

  'text-primary': '#F2F2F5',
  'text-secondary': '#A8A8B3',
  'text-tertiary': '#8F8F9B',
  'text-disabled': '#8A8A95',

  accent: '#FF6B6B',
  'accent-fill': '#CE2C34',
  'accent-hover': '#B8252C',
  'accent-pressed': '#9E1F25',
  'accent-soft': '#2A1416',
  'on-accent': '#FFFFFF',

  success: '#4ADE80',
  warning: '#F5A524',
  danger: '#FF7A7A',
  info: '#7AA2FF',
  'success-soft': '#10231A',
  'warning-soft': '#2A1E0C',
  'danger-soft': '#2C1414',
  'info-soft': '#101A2E',

  /*
   * 图谱画布 —— **两套主题都是一种浅底深色的「图表面板」**（票 62）。
   *
   * 这不是偷懒地把亮色主题做成深色：整张图有数千个 2–9px 的点，浅底上
   * 深点会糊成噪点，而深底上的浅点才读得出「星图」这个隐喻。所以画布自己
   * 带一组六件套（底/网格/连线/正文标签/弱标签/焦点底衬/焦点环），页面
   * 的图例与清单仍走 bg-* / text-* 这些页面语义键 —— 两套主题差在 chrome，
   * 不差在画布上那数千个点。
   *
   * 每个值的对比度下限写在 `src/graph/palette.ts` 的 docblock 里，测试
   * `src/graph/palette.test.ts` 按 WCAG 公式逐对复算（正文 4.5:1、图形 3:1）。
   */
  'graph-canvas': '#0B0B0F',
  'graph-canvas-grid': '#1E2632',
  'graph-edge': '#55637A',
  'graph-label': '#E6E6EC',
  'graph-label-muted': '#9AA0AC',
  'graph-node-backdrop': '#1C1C22',
  'graph-focus-ring': '#FF6B6B',
  'graph-node-unseen': '#6E6E79',
  'graph-node-learning': '#7AA2FF',
  'graph-node-mastered': '#4ADE80',
  'graph-node-review': '#F5A524',

  'option-idle-border': '#6E6E79',
  'option-hover-bg': '#22222A',
  'option-selected-bg': '#2A1416',
  'option-selected-border': '#FF6B6B',
  'option-correct': '#4ADE80',
  'option-wrong': '#FF7A7A',

  'shadow-sm': '0 1px 2px rgba(0,0,0,0.32)',
  'shadow-md': '0 4px 12px rgba(0,0,0,0.40), 0 1px 2px rgba(0,0,0,0.32)',
  'shadow-lg': '0 16px 48px rgba(0,0,0,0.56), 0 2px 8px rgba(0,0,0,0.40)',
  'glow-accent': '0 0 0 1px #FF6B6B, 0 0 20px rgba(255,107,107,0.22)',
};

/**
 * 明亮。
 *
 * **不是深色的反相**：亮底上阴影看得见，所以浮层给阴影、卡片给纯白 +
 * 更浅的 hairline。强调色在亮底上要更深才够 4.5:1（`#FF6B6B` 在 `#FFFFFF`
 * 上只有 2.6），所以这里 accent 与 accent-fill 同值 `#C42B31`。
 */
export const lightPalette: Palette = {
  'bg-canvas': '#ECEDF0',
  'bg-surface': '#FFFFFF',
  'bg-elevated': '#F7F7F9',
  'bg-sunken': '#E2E3E8',
  'bg-hover': '#F1F1F4',
  'bg-selected': '#FBEAEA',
  'bg-input': '#FFFFFF',
  'bg-scrim': 'rgba(18,18,22,0.32)',
  'bg-disabled': '#F3F3F5',

  'border-hairline': 'rgba(0,0,0,0.10)',
  'border-control': '#71717D',
  'border-focus': '#C42B31',
  'border-disabled': '#DCDCE1',

  'text-primary': '#16161A',
  'text-secondary': '#55555E',
  'text-tertiary': '#6B6B75',
  'text-disabled': '#63636D',

  accent: '#C42B31',
  'accent-fill': '#C42B31',
  'accent-hover': '#AE2429',
  'accent-pressed': '#961D22',
  'accent-soft': '#FBEAEA',
  'on-accent': '#FFFFFF',

  success: '#0E7A4A',
  warning: '#8A5200',
  danger: '#C62828',
  info: '#1A5FD0',
  'success-soft': '#E6F5EE',
  'warning-soft': '#FBF0DF',
  'danger-soft': '#FBEAEA',
  'info-soft': '#E8F0FC',

  /*
   * 明亮主题的图谱画布：**也是深色**，但比深色主题那一档浅一阶（#14181F
   * 对 #0B0B0F）。理由见 darkPalette 上方那段 —— 差的是「面板在页面里的
   * 层次」，不是「这张图变成白底」。
   *
   * 节点四色因此不是 light 语义色（#1A5FD0 这类深蓝压在 #14181F 上只有
   * 1.6:1），而是专为深底调亮的一套；连线（#64728C）与标签（#ECEFF4）
   * 同样按深底重算，实测比值见 src/graph/palette.test.ts。
   */
  'graph-canvas': '#14181F',
  'graph-canvas-grid': '#242A33',
  'graph-edge': '#64728C',
  'graph-label': '#ECEFF4',
  'graph-label-muted': '#9AA4B2',
  'graph-node-backdrop': '#1F2530',
  'graph-focus-ring': '#FF8A8A',
  'graph-node-unseen': '#8A93A3',
  'graph-node-learning': '#8FAEFF',
  'graph-node-mastered': '#5FD79A',
  'graph-node-review': '#FFC061',

  'option-idle-border': '#71717D',
  'option-hover-bg': '#F1F1F4',
  'option-selected-bg': '#FBEAEA',
  'option-selected-border': '#C42B31',
  'option-correct': '#0E7A4A',
  'option-wrong': '#C62828',

  'shadow-sm': '0 1px 2px rgba(16,18,24,0.06)',
  'shadow-md': '0 4px 12px rgba(16,18,24,0.08)',
  'shadow-lg': '0 16px 48px rgba(16,18,24,0.12)',
  'glow-accent': '0 0 0 1px #C42B31, 0 0 16px rgba(196,43,49,0.16)',
};

export const palettes: Record<ThemeName, Palette> = {
  dark: darkPalette,
  light: lightPalette,
};

/**
 * 两套 palette 必须键集相同。
 *
 * 在模块加载期就抛，而不是等到某个页面在某个主题下渲染出 `undefined` 颜色 ——
 * 那种 bug 只在切主题时才出现，最容易漏。
 */
export function assertPaletteParity(): void {
  const darkKeys = Object.keys(darkPalette).sort().join(',');
  const lightKeys = Object.keys(lightPalette).sort().join(',');
  if (darkKeys !== lightKeys) {
    throw new Error(
      `两套 palette 的语义键不一致：\n dark = ${darkKeys}\n light = ${lightKeys}`,
    );
  }
}

assertPaletteParity();

/** 8px 栅格，9 档。布局间距只能从这里取。 */
export const SPACE = {
  'space-0': '0',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '24px',
  'space-6': '32px',
  'space-7': '48px',
  'space-8': '64px',
} as const;

/**
 * 圆角阶梯。
 *
 * ## 数字来源（不是拍脑袋）
 *
 * 2026-10 抓 raycast.com 的 6 个生产 CSS chunk（389 KB），统计 `border-radius`
 * 声明并按选择器归类：
 *
 * | 值 | 出现处 |
 * |---|---|
 * | 12px | `.qDZGta_popover`、`.YrhMfW_announcement`、`.wHs0Qq_focusBar` |
 * | 10px | `.ppYp9a_cardWrapper`、`.YkiDJG_extensionCard`、`.f0hM2W_callToAction` |
 * | 6px  | `.IS8qgq_searchItem`、`.wHs0Qq_timer` |
 *
 * 用途映射：卡片 12px、按钮/输入/下拉 10px、小徽章 6px 或胶囊、抽屉 16px。
 *
 * Fluent v9 默认 Small/Medium/Large/XLarge = 2/4/6/8px，所以必须覆盖，
 * 否则整站看起来是「Windows 设置面板」。
 */
export const RADIUS = {
  'radius-xs': '4px',
  'radius-sm': '6px',
  'radius-md': '10px',
  'radius-lg': '12px',
  'radius-xl': '16px',
  'radius-full': '9999px',
} as const;

/** 用途别名：写页面时用语义名，不要记「卡片是第几档」。 */
export const RADIUS_ROLE = {
  card: RADIUS['radius-lg'],
  control: RADIUS['radius-md'],
  chip: RADIUS['radius-sm'],
  overlay: RADIUS['radius-xl'],
  pill: RADIUS['radius-full'],
} as const;

/**
 * 时长阶梯 —— **值来自 `src/motion/tokens.ts`，这里只是换名字**。
 *
 * 不写毫秒字面量：那是第二份真源，将来症状是「同一界面两段动画速度不同」。
 */
export const DURATION = {
  'dur-instant': `${instant}ms`,
  'dur-fast': `${quick}ms`,
  'dur-base': `${standard}ms`,
  'dur-slow': `${slow}ms`,
  'dur-scene': `${slow}ms`,
} as const;

/** 缓动 —— 同样来自 `src/motion/tokens.ts`。 */
export const EASING = {
  'ease-out': easeOut,
  'ease-in-out': easeInOut,
  'ease-linear': 'linear',
} as const;

export const FONT_SANS =
  "'Inter', 'SF Pro Text', -apple-system, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif";
export const FONT_MONO =
  "'SF Mono', 'JetBrains Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace";

/** 字号阶梯。键是语义角色，不是 Fluent 的物理档位。正文 14/13，标题 20/28。 */
export const TYPE_SCALE = {
  display: { fontSize: '28px', lineHeight: '36px', fontWeight: '600', letterSpacing: '-0.02em' },
  title: { fontSize: '20px', lineHeight: '28px', fontWeight: '600', letterSpacing: '-0.01em' },
  subtitle: { fontSize: '16px', lineHeight: '24px', fontWeight: '600', letterSpacing: '-0.005em' },
  body: { fontSize: '14px', lineHeight: '22px', fontWeight: '400', letterSpacing: '0' },
  'body-strong': { fontSize: '14px', lineHeight: '22px', fontWeight: '500', letterSpacing: '0' },
  caption: { fontSize: '12px', lineHeight: '18px', fontWeight: '400', letterSpacing: '0.005em' },
  micro: { fontSize: '11px', lineHeight: '16px', fontWeight: '500', letterSpacing: '0.02em' },
  code: { fontSize: '13px', lineHeight: '20px', fontWeight: '400', letterSpacing: '0' },
} as const;

export type TypeRole = keyof typeof TYPE_SCALE;

/**
 * 阴影 / 发光（按主题取）。
 *
 * 保留这个导出是为了给「需要按主题拿阴影」的调用方（测试、探针）一个入口；
 * 映射层请直接用 `palette['shadow-md']`，不要用它做条件判断。
 */
export const SHADOWS: Record<ThemeName, Record<string, string>> = {
  dark: {
    'shadow-sm': darkPalette['shadow-sm'],
    'shadow-md': darkPalette['shadow-md'],
    'shadow-lg': darkPalette['shadow-lg'],
    'glow-accent': darkPalette['glow-accent'],
  },
  light: {
    'shadow-sm': lightPalette['shadow-sm'],
    'shadow-md': lightPalette['shadow-md'],
    'shadow-lg': lightPalette['shadow-lg'],
    'glow-accent': lightPalette['glow-accent'],
  },
};

/** `bg-surface` → `--sm-bg-surface`。 */
export const cssVarName = (key: string): string => `--sm-${key}`;

/** `var(--sm-bg-surface)`。 */
export const cssVar = (key: string): string => `var(${cssVarName(key)})`;

/** 一套 palette → CSS 自定义属性表（供运行时注入 / 测试断言用）。 */
export function paletteToCssVars(palette: Palette): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of COLOR_KEYS) out[cssVarName(key)] = palette[key];
  for (const key of SHADOW_KEYS) out[cssVarName(key)] = palette[key];
  return out;
}

/** 全部语义键（颜色 + 阴影），顺序稳定，供 parity 断言用。 */
export const ALL_TOKEN_KEYS = [...COLOR_KEYS, ...SHADOW_KEYS] as const;
