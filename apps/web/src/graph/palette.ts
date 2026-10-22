/**
 * 图谱画布取色的唯一入口（票 62）。
 *
 * ## 为什么不直接调 `useTheme()`
 *
 * `apps/web/src/theme/ThemeProvider.tsx` 的 `useTheme()` 在 provider 外调用会
 * **故意抛错**（那个约定对页面组件是对的：没有 provider 就没有主题，渲染出
 * 半套颜色不如大声失败）。但地图的两条渲染路径——`GraphCanvas` 与
 * `StatusLegend`/`NodeRoster`——在 `MapPage.test.tsx` 里是裸渲染的，没有
 * provider；而且画布的颜色在 `<canvas>` 里，与 Fluent 的 theme 对象无关。
 *
 * 所以这里读的是**主题解析后的落点**：`<html data-sm-theme>`。那正是
 * `ThemeProvider.applyThemeToDocument()` 写入的属性，也是 `tokens.css` 里
 * `:root[data-sm-theme='light']` 命中的选择器。换主题时属性变、MutationObserver
 * 收到通知、组件重渲——与 Fluent 那条路互不依赖，也就不需要 provider。
 *
 * 属性缺失时回退 `'dark'`：与 `tokens.css` 的默认块（`:root` 即深色）一致。
 * 内联脚本被 CSP 拦掉时页面仍是深色，画布不能在这时变成另一套。
 *
 * ## 为什么画布两套主题都是深色
 *
 * 整张图数千个 2–9px 的点。亮色主题下把它们反相成「浅底深点」会得到一片
 * 噪点：点太小，明暗反转后边缘的对比只剩面积，形状编码（圆/方/菱/三角）反而
 * 先糊掉。所以画布是一个**图表面板**：底色、网格、连线、标签、焦点环各自成
 * 键（`graph-*`），两套主题各给一档近黑 / 深蓝黑，页面侧
 * 图例与清单仍用 `bg-*` 与 `text-*` —— 两套主题差在 chrome，不差在点上。
 *
 * ## 对比度基线（由 `palette.test.ts` 逐对复算）
 *
 * | 角色 | 深色 | 亮色 | 下限 |
 * |---|---|---|---|
 * | 标签正文 `graph-label` | 15.8:1 | 15.4:1 | 4.5:1（正文） |
 * | 弱标签 `graph-label-muted` | 7.5:1 | 7.1:1 | 4.5:1（正文） |
 * | 连线 `graph-edge` | 3.2:1 | 3.7:1 | 3:1（图形） |
 * | 四态节点 | 3.9–11.3:1 | 5.8–11.0:1 | 3:1（图形） |
 * | 焦点环 `graph-focus-ring` | 7.1:1 | 7.8:1 | 3:1（图形） |
 *
 * 网格（1.2–1.3:1）刻意低于 3:1：它是**装饰**（WCAG 1.4.11 不适用于纯装饰
 * 背景纹理），一旦提亮就会与数千个点抢注意力。
 */
import { useMemo, useSyncExternalStore } from 'react';
import { palettes, type ColorKey, type Palette, type ThemeName } from '../theme/tokens.js';
import type { DisplayStatus } from './status.js';

/** 主题解析结果落在 `<html>` 上的属性名，与 `ThemeProvider`/`tokens.css` 一致。 */
export const GRAPH_THEME_ATTRIBUTE = 'data-sm-theme';

/**
 * 四类状态对应的 token 键。
 *
 * 单独导出是为了让测试能机械地遍历「哪四对颜色」——在测试里手抄键名，
 * 改键时就会漏掉一处，然后那条断言悄悄测着旧键。
 */
export const GRAPH_NODE_TOKEN: Record<DisplayStatus, ColorKey> = {
  unseen: 'graph-node-unseen',
  learning: 'graph-node-learning',
  mastered: 'graph-node-mastered',
  review: 'graph-node-review',
};

/** 画布需要的那一小撮颜色。全部来自 token，组件里不出现字面量。 */
export interface GraphColors {
  /** 画布底色 */
  readonly canvas: string;
  /** 画布网格（装饰） */
  readonly grid: string;
  /** 连线 */
  readonly edge: string;
  /** 节点标签正文 */
  readonly label: string;
  /** 弱化的标签（提示行、降级说明） */
  readonly labelMuted: string;
  /** 焦点节点的底衬 */
  readonly backdrop: string;
  /** 画布上的焦点环（页面上的焦点环用 `border-focus`，那个在深底上不够亮） */
  readonly focusRing: string;
  /** 四态节点色 */
  readonly nodes: Readonly<Record<DisplayStatus, string>>;
}

/** 一套 palette → 画布颜色。纯函数，测试与探针都用它。 */
export function graphColors(palette: Palette): GraphColors {
  return {
    canvas: palette['graph-canvas'],
    grid: palette['graph-canvas-grid'],
    edge: palette['graph-edge'],
    label: palette['graph-label'],
    labelMuted: palette['graph-label-muted'],
    backdrop: palette['graph-node-backdrop'],
    focusRing: palette['graph-focus-ring'],
    nodes: {
      unseen: palette[GRAPH_NODE_TOKEN.unseen],
      learning: palette[GRAPH_NODE_TOKEN.learning],
      mastered: palette[GRAPH_NODE_TOKEN.mastered],
      review: palette[GRAPH_NODE_TOKEN.review],
    },
  };
}

/** 主题名 → 画布颜色。 */
export function graphColorsFor(theme: ThemeName): GraphColors {
  return graphColors(palettes[theme]);
}

/**
 * 从 DOM 读当前解析后的主题。
 *
 * 参数化 `root` 是为了单测能在没有全局 `document` 断言的情况下手造一个元素
 * （jsdom 里直接改 `documentElement` 也行，但那样测试之间会互相污染属性）。
 */
export function readThemeName(
  root: Element | null = typeof document === 'undefined' ? null : document.documentElement,
): ThemeName {
  return root?.getAttribute(GRAPH_THEME_ATTRIBUTE) === 'light' ? 'light' : 'dark';
}

/**
 * 订阅 `<html data-sm-theme>` 的变化。
 *
 * 用 `MutationObserver` 而不是自定义事件：主题的写入方是 `ThemeProvider`
 * （将来还可能有系统主题跟随）。让读取方去要求写入方发事件，等于给「换主题」
 * 增加一条必须记得走的路径；观察属性则对任何写入方都成立。
 */
function subscribeToThemeChange(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [GRAPH_THEME_ATTRIBUTE],
  });
  return () => {
    observer.disconnect();
  };
}

const serverThemeName = (): ThemeName => 'dark';

/** 当前解析后的主题名，随 `<html data-sm-theme>` 变化重渲。 */
export function useThemeName(): ThemeName {
  return useSyncExternalStore(subscribeToThemeChange, readThemeName, serverThemeName);
}

/** 当前主题下的画布颜色。主题不变时返回同一个对象，可以安全进依赖数组。 */
export function useGraphColors(): GraphColors {
  const theme = useThemeName();
  return useMemo(() => graphColorsFor(theme), [theme]);
}
