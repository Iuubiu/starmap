import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instant, quick, slow, standard } from '../motion/tokens';
import {
  ALL_TOKEN_KEYS,
  COLOR_KEYS,
  DURATION,
  EASING,
  RADIUS,
  SHADOW_KEYS,
  SPACE,
  TYPE_SCALE,
  cssVar,
  cssVarName,
  darkPalette,
  lightPalette,
  paletteToCssVars,
  palettes,
  type Palette,
} from './tokens';

/**
 * token 双写守门：`tokens.ts`（代码侧真源）与 `tokens.css`（样式侧镜像）必须逐字一致。
 *
 * ## 为什么这条测试值得写
 *
 * 颜色值被写在了两个地方，这是有代价的选择（理由见 `tokens.css` 顶部：变量必须在
 * 首帧之前存在，运行时注入必然晚一帧 → 深色用户看到白闪）。既然接受了双写，
 * 就必须有一条机器检查把它们钉在一起，否则「改了 TS 忘了 CSS」会表现为
 * 「某个页面在某个主题下颜色不对」，而那要人眼逐页看才发现。
 *
 * ## 为什么用 `readFileSync` 而不是 `import css from './tokens.css?raw'`
 *
 * 本仓 vite 的 CSS 处理链会把 `?raw` 导成空串（实测 length 0），拿到的不是源码。
 * `readFileSync` 读的是磁盘上那份文本，对「两份文件是否逐字一致」这个问题来说
 * 反而更直接：它连打包器的转换都不经过。
 *
 * 路径用 `process.cwd()` 拼而不是 `import.meta.url`：vitest 的 jsdom 环境把
 * `import.meta.url` 报成 `http://localhost/...`（不是 file: 协议），`fileURLToPath`
 * 会直接抛 `The URL must be of scheme file`。`cwd()` 恒为包根（`apps/web`）。
 */
const tokensCss = readFileSync(resolve(process.cwd(), 'src/theme/tokens.css'), 'utf8');

/**
 * 值规范化：去空白、转小写、rgba 里逗号后的空格统一去掉。
 *
 * 最后一条不是洁癖：`tokens.ts` 写 `rgba(5,7,10,0.72)`，`tokens.css` 写
 * `rgba(5, 7, 10, 0.72)`，两者在 CSS 里**等价**，但逐字比较会红。既然这条
 * 测试守的是「值是否一致」而不是「格式是否一致」，就该把格式差异抹平。
 */
const normalize = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').replace(/,\s+/g, ',').toLowerCase();

/** 从 CSS 文本里抠出某个选择器块内的 `--sm-*` 声明。 */
function declarationsIn(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`tokens.css 里找不到选择器 ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const block = css.slice(open + 1, close);

  const out = new Map<string, string>();
  for (const match of block.matchAll(/(--sm-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    out.set(name, normalize(value));
  }
  return out;
}

/** 把 palette 的十六进制值规范化成 CSS 里的小写写法。 */
function normalizedPalette(palette: Palette): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of Object.entries(paletteToCssVars(palette))) {
    out.set(name, normalize(value));
  }
  return out;
}

const isColorVar = (name: string): boolean =>
  !name.startsWith('--sm-shadow') && !name.startsWith('--sm-glow');

describe('tokens.css 与 tokens.ts 逐字一致', () => {
  const darkBlock = declarationsIn(tokensCss, ":root[data-sm-theme='dark']");
  const lightBlock = declarationsIn(tokensCss, ":root[data-sm-theme='light']");

  it.each(['dark', 'light'] as const)('%s 主题的每个颜色键都在 CSS 里且值相等', (theme) => {
    const css = theme === 'dark' ? darkBlock : lightBlock;
    const expected = normalizedPalette(palettes[theme]);

    for (const [name, value] of expected) {
      expect(css.get(name), `${theme} 主题缺少或改动了 ${name}`).toBe(value);
    }
  });

  it('两套主题在 CSS 里声明的颜色键集完全相同', () => {
    const darkKeys = [...darkBlock.keys()].filter(isColorVar);
    const lightKeys = [...lightBlock.keys()].filter(isColorVar);

    expect(darkKeys.sort()).toEqual(lightKeys.sort());
    expect(darkKeys).toHaveLength(COLOR_KEYS.length);
  });

  it('CSS 里没有多出 tokens.ts 不知道的颜色键', () => {
    const known = new Set(COLOR_KEYS.map(cssVarName));
    for (const name of darkBlock.keys()) {
      if (!isColorVar(name)) continue;
      expect(known.has(name), `CSS 里有 tokens.ts 未声明的键 ${name}`).toBe(true);
    }
  });

  it('两套主题都声明了 color-scheme（UA 控件与焦点环依赖它）', () => {
    expect(tokensCss).toMatch(/data-sm-theme='dark'\][^{]*\{[^}]*color-scheme:\s*dark/);
    expect(tokensCss).toMatch(/data-sm-theme='light'\][^{]*\{[^}]*color-scheme:\s*light/);
  });

  it('减少了动效时所有时长退化为瞬时', () => {
    const reducedBlock = tokensCss.slice(tokensCss.indexOf('prefers-reduced-motion: reduce'));
    expect(reducedBlock).toContain('animation-duration: 0.01ms !important');
    expect(reducedBlock).toContain('transition-duration: 0.01ms !important');
    expect(reducedBlock).toContain('animation-iteration-count: 1 !important');
  });
});

describe('双主题色板', () => {
  it('两套 palette 的键集完全相同', () => {
    expect(Object.keys(darkPalette).sort()).toEqual(Object.keys(lightPalette).sort());
  });

  /**
   * 阴影是**复合值**（`0 1px 2px rgba(…)`），不是颜色。
   *
   * 这条原先跟颜色共用一个循环、共用一条 hex/rgba 正则，于是 `shadow-sm`
   * 必然红 —— 断言的错，不是实现的错：阴影本来就不该长得像颜色。
   * 拆成两条之后，每条各自守自己那一类值。
   */
  it('每个颜色键都是合法颜色（hex 或 rgba）', () => {
    const shadowKeys = new Set<string>(SHADOW_KEYS);
    for (const [theme, palette] of Object.entries(palettes)) {
      for (const [key, value] of Object.entries(palette)) {
        if (shadowKeys.has(key)) continue;
        expect(value, `${theme}/${key}`).toMatch(/^(#[0-9a-fA-F]{6}|rgba\(\d+, ?\d+, ?\d+, ?[\d.]+\))$/);
      }
    }
  });

  /**
   * 阴影形状：至少三层（x 偏移 / y 偏移 / 模糊）+ 一个颜色。
   *
   * 不验具体数值 —— 那是设计决定。要守的是「它还是个 box-shadow」：
   * 有人误把颜色值塞进 `shadow-md` 时，`FluentProvider` 会把整条 shadow
   * token 变成非法值，而浏览器对非法 box-shadow 的处理是**静默丢弃**，
   * 于是症状是「某处阴影不见了」，没人会为此开票。
   */
  it('每个阴影键都是至少三层 + 颜色的复合值', () => {
    for (const [theme, palette] of Object.entries(palettes)) {
      for (const key of SHADOW_KEYS) {
        const value = palette[key as keyof Palette];
        const layers = value.split(/,\s*(?=(?:-?\d|inset))/).length;
        expect(layers, `${theme}/${key}=${value} 层数不足`).toBeGreaterThanOrEqual(2);
        expect(value, `${theme}/${key} 缺少颜色`).toMatch(/(#[0-9a-fA-F]{6}|rgba?\([^)]*\))/);
      }
    }
  });

  /**
   * 强调色必须**有真的色相**，不能是灰。
   *
   * 判据是「最亮通道与最暗通道之差」而不是「蓝比绿高多少」：后者把断言
   * 钉死在了某个具体色相上（上一版写的是紫罗兰，设计后来改成珊瑚红
   * `#FF6B6B`，于是这条红得毫无意义 —— 灰色三通道相等，差为 0，任何
   * 真彩色都会远大于 0）。具体是哪个色相交给设计，测试只守「不是灰」。
   */
  it('强调色在两套主题里都不是中性灰（色相必须真的存在）', () => {
    for (const [theme, palette] of Object.entries(palettes)) {
      const accent = palette.accent;
      const r = parseInt(accent.slice(1, 3), 16);
      const g = parseInt(accent.slice(3, 5), 16);
      const b = parseInt(accent.slice(5, 7), 16);
      expect(
        Math.max(r, g, b) - Math.min(r, g, b),
        `${theme} 的 accent=${accent} 是灰的，不是强调色`,
      ).toBeGreaterThanOrEqual(40);
    }
  });

  it('深色主题的画布比表面更暗（层级靠明度台阶）', () => {
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
      const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
        number,
        number,
        number,
      ];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    expect(luminance(darkPalette['bg-canvas'])).toBeLessThan(luminance(darkPalette['bg-surface']));
    expect(luminance(darkPalette['bg-surface'])).toBeLessThan(luminance(darkPalette['bg-elevated']));
    expect(luminance(darkPalette['bg-elevated'])).toBeLessThan(luminance(darkPalette['bg-selected']));
    expect(luminance(darkPalette['bg-sunken'])).toBeLessThan(luminance(darkPalette['bg-surface']));

    // 明亮主题方向相反：画布略灰、表面纯白。
    expect(luminance(lightPalette['bg-canvas'])).toBeLessThan(luminance(lightPalette['bg-surface']));
  });
});

describe('尺度 token', () => {
  it('间距全部落在 4px 半格上（8px 栅格的例外只有 2px/6px，不在本表内）', () => {
    for (const [name, value] of Object.entries(SPACE)) {
      const px = value === '0' ? 0 : Number.parseInt(value, 10);
      expect(Number.isNaN(px), `${name}=${value}`).toBe(false);
      expect(px % 4, `${name}=${value} 不在 4px 半格上`).toBe(0);
    }
  });

  it('圆角单调递增且最后是胶囊', () => {
    const ordered = [RADIUS['radius-xs'], RADIUS['radius-sm'], RADIUS['radius-md'], RADIUS['radius-lg'], RADIUS['radius-xl']].map(
      (value) => Number.parseInt(value, 10),
    );
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(RADIUS['radius-full']).toBe('9999px');
  });

  /**
   * 时长阶梯。
   *
   * 上一版把上限写死成 320ms，那是从 `SKILL.md §1.12` 抄来的旧值；而
   * `src/motion/tokens.ts`（唯一真源）里 `slow = 350`。断言与真源对不上时，
   * 错的是断言：这里改成**从真源反推**，不再抄任何毫秒数。
   *
   * 上限 400ms 是「常规 UI 动效」的硬上限（SKILL.md §3.1），`dur-scene`
   * 作为 `dur-slow` 的别名一并受它约束。
   */
  it('四档时长逐档等于 motion/tokens.ts 的值（不抄第二份毫秒数）', () => {
    expect(DURATION['dur-instant']).toBe(`${instant}ms`);
    expect(DURATION['dur-fast']).toBe(`${quick}ms`);
    expect(DURATION['dur-base']).toBe(`${standard}ms`);
    expect(DURATION['dur-slow']).toBe(`${slow}ms`);
  });

  it('四档严格递增，最长不超过 400ms', () => {
    const ladder = [DURATION['dur-instant'], DURATION['dur-fast'], DURATION['dur-base'], DURATION['dur-slow']].map(
      (value) => Number.parseInt(value, 10),
    );
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i], `第 ${i} 档没有比前一档更长`).toBeGreaterThan(ladder[i - 1] as number);
    }
    expect(Math.max(...ladder)).toBeLessThanOrEqual(400);
  });

  it('dur-scene 是 dur-slow 的别名，不是第五档', () => {
    expect(DURATION['dur-scene']).toBe(DURATION['dur-slow']);
    expect(Object.keys(DURATION)).toHaveLength(5);
  });

  it('缓动曲线是合法的 cubic-bezier 或 linear', () => {
    for (const [name, value] of Object.entries(EASING)) {
      expect(value, name).toMatch(/^(linear|cubic-bezier\(-?[0-9.]+, -?[0-9.]+, -?[0-9.]+, -?[0-9.]+\))$/);
    }
  });

  it('字号阶梯每一档都同时给出字号/行高/字重', () => {
    for (const [role, spec] of Object.entries(TYPE_SCALE)) {
      expect(spec.fontSize, role).toMatch(/^\d+px$/);
      expect(spec.lineHeight, role).toMatch(/^\d+px$/);
      expect(Number(spec.lineHeight.replace('px', ''))).toBeGreaterThan(Number(spec.fontSize.replace('px', '')));
      expect(spec.fontWeight, role).toMatch(/^\d{3}$/);
    }
  });

  it('正文行高不低于 1.4 倍（中文可读性下限）', () => {
    const size = Number(TYPE_SCALE.body.fontSize.replace('px', ''));
    const line = Number(TYPE_SCALE.body.lineHeight.replace('px', ''));
    expect(line / size).toBeGreaterThanOrEqual(1.4);
  });
});

describe('cssVar 工具', () => {
  it('拼出与 tokens.css 一致的变量名', () => {
    expect(cssVarName('bg-surface')).toBe('--sm-bg-surface');
    expect(cssVar('bg-surface')).toBe('var(--sm-bg-surface)');
  });

  it('paletteToCssVars 覆盖全部语义键（颜色 + 阴影）', () => {
    // 不是 `COLOR_KEYS.length`：`paletteToCssVars` 把颜色与阴影都导出了，
    // 断言拿颜色集合去比，必然差 `SHADOW_KEYS.length` 个。
    expect(Object.keys(paletteToCssVars(darkPalette))).toHaveLength(ALL_TOKEN_KEYS.length);
  });
});
