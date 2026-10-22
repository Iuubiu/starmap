import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';
import {
  DURATION,
  EASING,
  FONT_MONO,
  FONT_SANS,
  type Palette,
  type ThemeName,
} from './tokens';

/**
 * 把本仓的语义 palette 映射成 Fluent v9 的 `Theme` 对象。
 *
 * ## 为什么需要这一层
 *
 * 组件仍从 `@fluentui/react-components` 导入（只换视觉、不换组件库）。Fluent
 * 组件的内部样式全部读 `theme.colorNeutralBackground1` 这类**物理** token，
 * 我们改不动组件的 JSX，只能改它读到的值。所以：
 *
 *   语义 palette（我们的真源） → 本文件 → Fluent 物理 token → 组件外观
 *
 * 页面与自写样式**只许**用语义 token（`var(--sm-bg-surface)`）；这一层是唯一
 * 允许出现 `colorNeutralBackground2` 的地方，因为它就是「翻译表」。
 *
 * ## 为什么整份文件里没有 `isDark ? A : B`
 *
 * 阴影也是颜色：深色下阴影几乎不可见、亮色下必须更淡。把它写成三元表达式
 * 会让「主题」这件事在两个地方各自判断一次（palette 里一次、这里一次），
 * 于是第三个主题出现时必然漏改。所以阴影进 palette（`shadow-*` 键），本文件
 * 只做**无分支查表**。这条由 `theme.test.tsx` 用正则守住。
 *
 * ## 打底 + 覆盖
 *
 * `createDarkTheme` / `createLightTheme` 需要一个 brand ramp。它们算出来的
 * colorNeutral* 是 Fluent 自己的一套灰阶，与我们的层级台阶不同，所以下面逐条
 * 覆盖。打底的作用是**保证 Theme 类型完整**（130+ 个键），漏键时不会拿到
 * undefined。
 */

/**
 * 强调色 ramp（Raycast 红）。
 *
 * 只保留一支彩色：`10..160` 是 Fluent 需要的 10 个色阶（它要求 15 个键，
 * 索引 10–160）。深色与亮色各一条，因为同一个 `#FF6B6B` 在亮底上过不了
 * AA（2.6:1），亮色主题必须整体压深到 `#C42B31` 一系。
 */
const brandRamp = (name: ThemeName): BrandVariants => {
  const ramps: Record<ThemeName, BrandVariants> = {
    dark: {
      10: '#1A0A0B',
      20: '#2A1416',
      30: '#3D181B',
      40: '#5A1C20',
      50: '#7E2026',
      60: '#9E1F25',
      70: '#B8252C',
      80: '#CE2C34',
      90: '#FF6B6B',
      100: '#FF8A8A',
      110: '#FFA3A3',
      120: '#FFC2C2',
      130: '#FFDDDD',
      140: '#FFEFEF',
      150: '#FFF7F7',
      160: '#FFFFFF',
    },
    light: {
      10: '#2A0A0B',
      20: '#3D1013',
      30: '#521519',
      40: '#6B1A1F',
      50: '#851F25',
      60: '#961D22',
      70: '#AE2429',
      80: '#C42B31',
      90: '#E04A4F',
      100: '#F08084',
      110: '#F7A9AC',
      120: '#FBCBCD',
      130: '#FDE3E4',
      140: '#FEF1F1',
      150: '#FFF8F8',
      160: '#FFFFFF',
    },
  };
  return ramps[name];
};

/** Fluent 自带主题打底（保证 130+ 个键都有值），随后由本文件逐条覆盖。 */
const createThemeFor = (name: ThemeName, brand: BrandVariants): Theme =>
  name === 'dark' ? createDarkTheme(brand) : createLightTheme(brand);

/**
 * 构造 Fluent `Theme`。
 *
 * 返回类型是 `Theme`（不是 `PartialTheme`）：我们要的是「130 个键全都在」，
 * 漏一个就该编译报错。
 */
export function makeRaycastTheme(palette: Palette, name: ThemeName): Theme {
  const base = createThemeFor(name, brandRamp(name));

  return {
    ...base,

    /* ---- 层级表面 ---------------------------------------------------- */
    // Fluent 的 1..6 是「从低到高」。我们的映射：
    //   1 = 卡片/面板表面  2 = 页面画布  3 = 略高一档的浮层  4/5/6 = hover 起的层级
    colorNeutralBackground1: palette['bg-surface'],
    colorNeutralBackground2: palette['bg-canvas'],
    colorNeutralBackground3: palette['bg-elevated'],
    colorNeutralBackground4: palette['bg-hover'],
    colorNeutralBackground5: palette['bg-selected'],
    colorNeutralBackground6: palette['bg-selected'],
    colorNeutralBackground1Hover: palette['bg-hover'],
    colorNeutralBackground1Pressed: palette['bg-selected'],
    colorNeutralBackground1Selected: palette['bg-selected'],
    colorNeutralBackground2Hover: palette['bg-hover'],
    colorNeutralBackground2Pressed: palette['bg-selected'],
    colorNeutralBackground2Selected: palette['bg-selected'],
    colorNeutralBackground3Hover: palette['bg-hover'],
    colorNeutralBackground3Pressed: palette['bg-selected'],
    colorNeutralBackground3Selected: palette['bg-selected'],
    colorNeutralBackground4Hover: palette['bg-hover'],
    colorNeutralBackground4Pressed: palette['bg-selected'],
    colorNeutralBackground4Selected: palette['bg-selected'],
    colorSubtleBackground: 'transparent',
    colorSubtleBackgroundHover: palette['bg-hover'],
    colorSubtleBackgroundPressed: palette['bg-selected'],
    colorSubtleBackgroundSelected: palette['bg-selected'],
    colorTransparentBackground: 'transparent',
    colorTransparentBackgroundHover: palette['bg-hover'],
    colorTransparentBackgroundPressed: palette['bg-selected'],
    colorTransparentBackgroundSelected: palette['bg-selected'],
    colorBackgroundOverlay: palette['bg-scrim'],
    colorNeutralBackgroundDisabled: palette['bg-disabled'],
    colorNeutralBackgroundDisabled2: palette['bg-disabled'],
    colorNeutralCardBackground: palette['bg-surface'],
    colorNeutralCardBackgroundHover: palette['bg-hover'],
    colorNeutralCardBackgroundPressed: palette['bg-hover'],
    colorNeutralCardBackgroundSelected: palette['bg-selected'],
    colorNeutralCardBackgroundDisabled: palette['bg-disabled'],

    /* ---- 边框 -------------------------------------------------------- */
    // 只有 hairline 一档用于装饰；控件边界单独一档（hairline 太淡，当输入框
    // 边界过不了 3:1）。
    colorNeutralStroke1: palette['border-hairline'],
    colorNeutralStroke2: palette['border-hairline'],
    colorNeutralStroke3: palette['border-control'],
    colorNeutralStroke1Hover: palette['border-control'],
    colorNeutralStroke1Pressed: palette['border-control'],
    colorNeutralStroke1Selected: palette['border-focus'],
    colorNeutralStrokeAccessible: palette['border-control'],
    colorNeutralStrokeAccessibleHover: palette['border-control'],
    colorNeutralStrokeAccessiblePressed: palette['border-control'],
    colorNeutralStrokeAccessibleSelected: palette['border-focus'],
    colorNeutralStrokeDisabled: palette['border-disabled'],
    colorStrokeFocus1: palette['bg-canvas'],
    colorStrokeFocus2: palette['border-focus'],

    /* ---- 文字 -------------------------------------------------------- */
    colorNeutralForeground1: palette['text-primary'],
    colorNeutralForeground2: palette['text-secondary'],
    colorNeutralForeground3: palette['text-tertiary'],
    colorNeutralForeground4: palette['text-tertiary'],
    colorNeutralForegroundDisabled: palette['text-disabled'],
    colorNeutralForeground1Hover: palette['text-primary'],
    colorNeutralForeground1Pressed: palette['text-primary'],
    colorNeutralForeground1Selected: palette['text-primary'],
    colorNeutralForeground2Hover: palette['text-primary'],
    colorNeutralForeground2Pressed: palette['text-primary'],
    colorNeutralForeground2Selected: palette['text-primary'],
    colorNeutralForeground2BrandHover: palette['accent'],
    colorNeutralForeground2BrandPressed: palette['accent-pressed'],
    colorNeutralForeground2BrandSelected: palette['accent'],
    colorNeutralForeground3Hover: palette['text-secondary'],
    colorNeutralForeground3Pressed: palette['text-secondary'],
    colorNeutralForeground3Selected: palette['text-secondary'],
    colorNeutralForeground3BrandHover: palette['accent'],
    colorNeutralForeground3BrandPressed: palette['accent-pressed'],
    colorNeutralForeground3BrandSelected: palette['accent'],

    /* ---- 强调（唯一一支彩色） ---------------------------------------- */
    colorBrandBackground: palette['accent-fill'],
    colorBrandBackgroundHover: palette['accent-hover'],
    colorBrandBackgroundPressed: palette['accent-pressed'],
    colorBrandBackgroundSelected: palette['accent-pressed'],
    colorBrandBackground2: palette['accent-soft'],
    colorBrandBackground2Hover: palette['accent-soft'],
    colorBrandBackground2Pressed: palette['accent-soft'],
    colorBrandBackgroundStatic: palette['accent-fill'],
    colorCompoundBrandBackground: palette['accent-fill'],
    colorCompoundBrandBackgroundHover: palette['accent-hover'],
    colorCompoundBrandBackgroundPressed: palette['accent-pressed'],
    colorBrandStroke1: palette['accent'],
    colorBrandStroke2: palette['accent-soft'],
    colorBrandStroke2Hover: palette['accent-soft'],
    colorBrandStroke2Pressed: palette['accent-soft'],
    colorCompoundBrandStroke: palette['accent'],
    colorCompoundBrandStrokeHover: palette['accent-hover'],
    colorCompoundBrandStrokePressed: palette['accent-pressed'],
    colorBrandForeground1: palette['accent'],
    colorBrandForeground2: palette['accent'],
    colorBrandForeground2Hover: palette['accent'],
    colorBrandForeground2Pressed: palette['accent-pressed'],
    colorBrandForegroundLink: palette['accent'],
    colorBrandForegroundLinkHover: palette['accent-hover'],
    colorBrandForegroundLinkPressed: palette['accent-pressed'],
    colorBrandForegroundLinkSelected: palette['accent'],
    colorNeutralForegroundOnBrand: palette['on-accent'],
    colorNeutralForegroundInvertedLink: palette['on-accent'],
    colorNeutralForegroundInvertedLinkHover: palette['on-accent'],
    colorNeutralForegroundInvertedLinkPressed: palette['on-accent'],
    colorNeutralForegroundInvertedLinkSelected: palette['on-accent'],

    /* ---- 语义色（Fluent 的 palette 键） ------------------------------- */
    // Fluent 组件（MessageBar / Badge / Toast）读的是 colorPalette*，
    // 不是我们自己的 --sm-success，所以语义色必须两边都写。
    colorPaletteGreenForeground1: palette['success'],
    colorPaletteGreenForeground2: palette['success'],
    colorPaletteGreenBackground1: palette['success-soft'],
    colorPaletteGreenBackground2: palette['success-soft'],
    colorPaletteGreenBackground3: palette['success'],
    colorPaletteGreenBorder1: palette['success'],
    colorPaletteGreenBorder2: palette['success'],
    colorPaletteGreenBorderActive: palette['success'],

    colorPaletteDarkOrangeForeground1: palette['warning'],
    colorPaletteDarkOrangeForeground2: palette['warning'],
    colorPaletteDarkOrangeBackground1: palette['warning-soft'],
    colorPaletteDarkOrangeBackground2: palette['warning-soft'],
    colorPaletteDarkOrangeBackground3: palette['warning'],
    colorPaletteDarkOrangeBorder1: palette['warning'],
    colorPaletteDarkOrangeBorder2: palette['warning'],
    colorPaletteDarkOrangeBorderActive: palette['warning'],

    colorPaletteRedForeground1: palette['danger'],
    colorPaletteRedForeground2: palette['danger'],
    colorPaletteRedForeground3: palette['danger'],
    colorPaletteRedBackground1: palette['danger-soft'],
    colorPaletteRedBackground2: palette['danger-soft'],
    colorPaletteRedBackground3: palette['danger'],
    colorPaletteRedBorder1: palette['danger'],
    colorPaletteRedBorder2: palette['danger'],
    colorPaletteRedBorderActive: palette['danger'],

    // Fluent 的 Blue 档只有三个键（不像 Green/Red 有完整 10 档），写多出来
    // 的键会直接编译报错 —— 这正是逐条覆盖而不是 spread 一个对象的原因。
    colorPaletteBlueForeground2: palette['info'],
    colorPaletteBlueBackground2: palette['info-soft'],
    colorPaletteBlueBorderActive: palette['info'],

    // 黄色在本仓没有独立语义（警告用 DarkOrange）。留成 warning 同值，
    // 避免拿到 Fluent 默认亮黄（深底上 1.8:1）。
    colorPaletteYellowForeground1: palette['warning'],
    colorPaletteYellowForeground2: palette['warning'],
    colorPaletteYellowBackground1: palette['warning-soft'],
    colorPaletteYellowBackground2: palette['warning-soft'],
    colorPaletteYellowBackground3: palette['warning'],
    colorPaletteYellowBorder1: palette['warning'],
    colorPaletteYellowBorder2: palette['warning'],
    colorPaletteYellowBorderActive: palette['warning'],

    /* ---- 字体 / 字号 / 行高 / 字重 ----------------------------------- */
    fontFamilyBase: FONT_SANS,
    fontFamilyMonospace: FONT_MONO,
    fontFamilyNumeric: FONT_SANS,

    // 正文 14px 而不是 Fluent 默认的 16px：Raycast 的信息密度来自紧凑字号。
    fontSizeBase100: '10px',
    fontSizeBase200: '12px',
    fontSizeBase300: '14px',
    fontSizeBase400: '16px',
    fontSizeBase500: '20px',
    fontSizeBase600: '24px',
    fontSizeHero700: '28px',
    fontSizeHero800: '32px',
    fontSizeHero900: '40px',
    fontSizeHero1000: '48px',

    // Fluent 默认 lineHeightBase300 是 20px，对中文 14px 正文太挤。
    lineHeightBase100: '14px',
    lineHeightBase200: '16px',
    lineHeightBase300: '22px',
    lineHeightBase400: '24px',
    lineHeightBase500: '28px',
    lineHeightBase600: '32px',
    lineHeightHero700: '36px',
    lineHeightHero800: '40px',
    lineHeightHero900: '48px',
    lineHeightHero1000: '56px',

    // 只留 400 / 500 / 600 三档（Fluent 还有 700 bold）。中文 700 在 14px
    // 上会糊成一团。这几个键在 Fluent 里是 **number** 而不是字符串。
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightSemibold: 600,
    fontWeightBold: 600,

    /* ---- 圆角 -------------------------------------------------------- */
    // Fluent 默认 Small/Medium/Large/XLarge = 2/4/6/8，比 Raycast 小两档。
    // 这里按「卡片 12 / 控件 10 / 小 chip 6 / 浮层 16」重映射：
    //   Card 读 XLarge（12），Button/Input 读 Medium（10），Badge 读 Small（6）。
    borderRadiusSmall: '6px',
    borderRadiusMedium: '10px',
    borderRadiusLarge: '12px',
    borderRadiusXLarge: '16px',
    borderRadiusCircular: '9999px',

    /* ---- 阴影（全部查表，无分支） ------------------------------------ */
    shadow2: palette['shadow-sm'],
    shadow4: palette['shadow-sm'],
    shadow8: palette['shadow-md'],
    shadow16: palette['shadow-md'],
    shadow28: palette['shadow-lg'],
    shadow64: palette['shadow-lg'],
    shadow2Brand: palette['glow-accent'],
    shadow4Brand: palette['glow-accent'],
    shadow8Brand: palette['glow-accent'],
    shadow16Brand: palette['glow-accent'],
    shadow28Brand: palette['glow-accent'],
    shadow64Brand: palette['glow-accent'],

    /* ---- 动效（值来自 src/motion/tokens.ts，不写毫秒字面量） --------- */
    durationUltraFast: DURATION['dur-instant'],
    durationFaster: DURATION['dur-fast'],
    durationFast: DURATION['dur-fast'],
    durationNormal: DURATION['dur-base'],
    durationGentle: DURATION['dur-base'],
    durationSlow: DURATION['dur-slow'],
    durationSlower: DURATION['dur-slow'],
    durationUltraSlow: DURATION['dur-slow'],
    curveAccelerateMax: 'cubic-bezier(0.9, 0.1, 1, 0.2)',
    curveAccelerateMid: 'cubic-bezier(1, 0, 1, 1)',
    curveAccelerateMin: 'cubic-bezier(0.8, 0, 0.78, 1)',
    curveDecelerateMax: 'cubic-bezier(0, 0, 0.1, 1)',
    curveDecelerateMid: 'cubic-bezier(0, 0, 0, 1)',
    curveDecelerateMin: 'cubic-bezier(0.33, 0, 0.1, 1)',
    curveEasyEase: EASING['ease-out'],
    curveEasyEaseMax: EASING['ease-in-out'],
    curveLinear: EASING['ease-linear'],
  };
}
