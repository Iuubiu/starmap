# t63 改造清单：关卡页 53 处颜色 → `--sm-*` 语义 token

> 只读准备产物（t58 未 completed 前不动代码）。数据来源：
> `apps/web/src/theme/tokens.ts` 的 `lightPalette` / `darkPalette` 真值，
> 对比度按 WCAG 2.1 相对亮度公式现算（脚本 `.scratch/pw-t63-probes/contrast-targets.mjs`）。
> 完整数字见 `.scratch/qa/t63-baseline/target-contrast.txt`（45 组 × 2 主题，FAILURES 4）。

## 0. 口径

- **正文 ≥4.5:1；控件边界 / 关键边框 ≥3:1**（t58 与本票同一口径）。
- **底色对底色的比值不是 WCAG 判据**。表面之间的区分靠「边框 + 层级」而不是靠填充色差 ——
  所以下表里 `bg-*` 对 `bg-*` 的 1.0x 数字只作参考，凡不足 1.1 的一律**补 1px `border-hairline`**。
- 目标 token 全部来自 `apps/web/src/theme/tokens.ts` 的 `COLOR_KEYS`（35 色 + 语义族），
  **不新增 token、不改 token 值**。

## 1. 唯一需要换「色值来源」的一处

| 文件:行 | 现状 | 换成 | 理由 |
|---|---|---|---|
| `apps/web/src/level/VideoPanel.tsx:102` | `backgroundColor: '#000'` | `var(--sm-bg-sunken)` + `border: 1px solid var(--sm-border-hairline)` | 全页唯一字面 hex（验收 1）。`bg-sunken` 深色 #07080B（近黑，视频容器惯例）、亮色 #E9ECF2。`<video>` 无 poster 时本来就是黑底，不靠这个填充也能看。 |

## 2. 52 处 Fluent token → `--sm-*`（逐处）

### CardView.tsx（6 处）

| 行 | 现状 | 换成 | light | dark | 判据 |
|---|---|---|---|---|---|
| 51 | `colorNeutralForeground1` | `--sm-text-primary` | 18.15 | 15.83 | 正文 4.5 ✓ |
| 58 | `colorBrandStroke2` | **`--sm-accent`** | 4.80 | 6.52 | 3px 竖条 ≥3 ✓（`accent-soft` 只有 1.12 ✗） |
| 59 | `colorNeutralBackground2` | `--sm-bg-hover` | — | — | 底对底 1.12/1.18，另补 hairline |
| 62 | `colorNeutralForeground2` | `--sm-text-secondary` | 6.74 | 6.95 | 4.5 ✓ |
| 71 | `colorBrandForegroundLink` | `--sm-accent` | 5.38 | 7.71 | 链接 4.5 ✓ |
| 78 | `colorNeutralForeground3` | `--sm-text-tertiary` | 5.72 | 6.30 | 4.5 ✓ |

### GatePanel.tsx（4 处）

| 行 | 现状 | 换成 | light | dark | 判据 |
|---|---|---|---|---|---|
| 67 | `colorNeutralForeground3` | `--sm-text-tertiary` | 5.72 | 5.89 | 4.5 ✓ |
| 81 | `colorNeutralBackground3` | `--sm-bg-hover` | 1.12 | 1.11 | 底对底，补 hairline |
| 91 | `colorNeutralForeground3` | `--sm-text-tertiary` | 5.72 | 5.89 | 4.5 ✓ |
| 96 | `colorPaletteDarkOrangeForeground1` | `--sm-warning` | 6.39 | 8.01 | 4.5 ✓ |

### markdown.tsx（2 处）

| 行 | 现状 | 换成 | light | dark | 判据 |
|---|---|---|---|---|---|
| 26 | `colorNeutralBackground3` | `--sm-bg-sunken` | 1.18 | 1.09 | 底对底 → **补 hairline 边框**（代码块靠线定位，不靠底色） |
| 34 | `colorNeutralBackground3` | `--sm-bg-sunken` | 同上 | 同上 | 同上 |

### MasteryMeter.tsx（3 处）

| 行 | 现状 | 换成 | light | dark | 判据 |
|---|---|---|---|---|---|
| 53 / 69 / 74 | `colorNeutralForeground3` | `--sm-text-tertiary` | 5.72 | 6.30 | 4.5 ✓（三个层级里「说明」这一档） |

### QuestionView.tsx（13 处）

| 行 | 现状 | 换成 | light | dark | 判据 |
|---|---|---|---|---|---|
| 79 | `colorPaletteGreenBackground1` | `--sm-success-soft` | 1.13 | 1.13 | 底对底，靠边框 |
| 80 | `colorPaletteGreenBorder1` | **`--sm-success`** | **4.78** | **6.95** | 现 1.64/2.71 ✗ → 达标 |
| 83 | `colorPaletteYellowBackground1` | `--sm-warning-soft` | 1.13 | 1.13 | 底对底，靠边框 |
| 84 | `colorPaletteYellowBorder1` | **`--sm-warning`** | **5.67** | **7.55** | 现 1.10/11.20 ✗ → 达标 |
| 88 | `colorNeutralBackground3` | `--sm-bg-hover` | 1.12 | 1.18 | 底对底，靠边框 |
| 89 | `colorNeutralStroke2` | `--sm-border-control` | 3.29 | 3.43 | 3 ✓（`border-hairline` 只有 1.1 ✗） |
| 106 | `colorNeutralForeground2` | `--sm-text-secondary` | 7.56 | 8.22 | 4.5 ✓ |
| 115 / 123 | `colorNeutralForeground3` | `--sm-text-tertiary` | 5.72 | 6.30 | 4.5 ✓ |
| 130 / 335 | `colorPaletteDarkOrangeForeground1` | `--sm-warning` | 6.39 | 8.56 | 4.5 ✓ |
| 280 | `colorNeutralForeground2` | `--sm-text-secondary` | 7.56 | 8.22 | 4.5 ✓ |
| 329 | `colorNeutralForeground3` | `--sm-text-tertiary` | 5.72 | 6.30 | 4.5 ✓ |

### StepRail.tsx（10 处）

| 行 | 现状 | 换成 | light | dark | 判据 |
|---|---|---|---|---|---|
| 29 | `colorNeutralStroke2` | `--sm-border-control` | 3.35 | 4.30 | chip 边界 3 ✓ |
| 35 | `colorNeutralBackground3` | `--sm-bg-hover` | 1.12 | 1.18 | done 底，靠边框 |
| 36 | `colorNeutralForeground2` | `--sm-text-secondary` | 6.74 | 6.95 | 4.5 ✓ |
| 40 | `colorBrandBackground2` | `--sm-accent-soft` | 1.05 | 1.15 | 当前段底（另有 41 的描边） |
| 41 | `colorBrandStroke1` | **`--sm-option-selected-border`** | 4.89 | 8.18 | 当前段描边 3 ✓（`accent` 亦 5.38/7.71） |
| 42 | `colorBrandForeground2` | `--sm-text-primary` | 15.63 | 14.63 | 4.5 ✓ |
| 46 | `colorNeutralBackground1` | `--sm-bg-canvas` | — | — | 未到段无底 |
| 47 | `colorNeutralForeground4` | `--sm-text-tertiary` | 5.19 | 6.68 | 4.5 ✓ |
| 51 | `colorNeutralBackground1` | `--sm-bg-canvas` | — | — | 同上 |
| 52 | `colorNeutralForegroundDisabled` | `--sm-text-disabled` | **3.72** | **4.63** | 现 1.88/2.18 ✗ → 达标 |

### VideoPanel.tsx（4 处）

| 行 | 现状 | 换成 | light | dark | 判据 |
|---|---|---|---|---|---|
| 71 | `colorNeutralBackground2` | `--sm-bg-hover` | 1.12 | 1.18 | 卡底，补 hairline |
| 80 | `colorNeutralForeground3` | `--sm-text-tertiary` | 5.10 | 5.32 | 4.5 ✓ |
| 84 | `colorNeutralForeground2` | `--sm-text-secondary` | 6.74 | 6.95 | 4.5 ✓ |
| 95 | `colorNeutralForeground4` | `--sm-text-tertiary` | 5.10 | 5.32 | 4.5 ✓ |
| 102 | `#000` | `--sm-bg-sunken` + hairline | 1.18 | 1.09 | 见 §1 |

### LevelPage.tsx（10 处）

| 行 | 现状 | 换成 | light | dark | 判据 |
|---|---|---|---|---|---|
| 149 / 194 / 508 / 671 / 676 / 881 | `colorNeutralForeground3` | `--sm-text-tertiary` | 5.72 | 6.30 | 4.5 ✓ |
| 175 | `colorNeutralBackground1` | `--sm-bg-surface` | 1.10 | 1.06 | 卡底 vs 画布 → **补 hairline** |
| 213 | `colorPaletteDarkOrangeForeground1` | `--sm-warning` | 6.39 | 8.56 | 4.5 ✓ |
| 498 / 651 | `colorNeutralForeground2` | `--sm-text-secondary` | 7.56 | 8.22 | 4.5 ✓ |

### 徽章（t51 产物，2 个 color 由 `summaryPathBadge()` 决定）

| 位置 | 现状 | 换成 | light | dark | 判据 |
|---|---|---|---|---|---|
| `summaryPathBadge(false)` | `Badge color='subtle'` | 保持（Fluent 语义） | — | — | 走 `--sm-text-*`，随主题 |
| `summaryPathBadge(true)` | `Badge color='informative'` | 保持 | — | — | 同上 |

> t51 的措辞与判据**一行不改**，只换颜色来源。`summaryPathBadge()` 的返回类型已写死
> `'subtle' | 'informative'`，`success` 在类型层就进不来 —— 这条不变。

## 3. 四处「底对底不足 1.1」的处置（不是 WCAG 缺陷，但要有说法）

| 位置 | light | dark | 处置 |
|---|---|---|---|
| markdown 代码块 `bg-sunken` vs `bg-surface` | 1.18 | 1.09 | 补 `1px border-hairline`，块边界靠线 |
| StepRail 当前段 `accent-soft` vs `bg-canvas` | 1.05 | 1.15 | 已有 41 行的 `option-selected-border`（4.89/8.18），填充只是辅助 |
| VideoPanel 视频容器 `bg-sunken` vs `bg-surface` | 1.18 | 1.09 | 视频容器惯例即近黑，补 hairline 定界 |
| LevelPage 卡片 `bg-surface` vs `bg-canvas` | 1.10 | 1.06 | 补 `1px border-hairline`（Fluent Card 已有描边时复用，不叠加） |

## 4. 改完后验收 1 的 grep 会剩下什么

`grep -rn "#[0-9a-fA-F]\{6\}" apps/web/src/level apps/web/src/pages/LevelPage.tsx`
改完应为 **0 行**。当前唯一命中是 `VideoPanel.tsx:102`（§1）。

## 5. 与 t58 的接缝

- 本票**不新增 token**；若 t58 的 `COLOR_KEYS` 落地时有增删，本表按 `cssVarName()` 自动跟随。
- **硬前提**：`tokens.css` 的 `:root[data-sm-theme='dark']` 必须带 `color-scheme: dark`（实测已在 `tokens.css:110`），
  否则 radio 的 UA 焦点环仍画黑色、在深底上消失（`QuestionView` 的焦点环全靠它，见 b210 §八）。
- `apps/web/src/App.tsx:32` 与 `main.tsx:9` 目前仍是 `<FluentProvider theme={webLightTheme}>`；
  t58 落地后应改为 `makeRaycastTheme(palette, name)`。**这两处不在我 inScope**，由 t58 负责。

---

## 6. 附：深色主题基线（t58 落地前的「现状」）

探针 `combos.spec.ts` 把 `webDarkTheme` 的全部 token 逐个注入**每一个** `.fui-FluentProvider`
（页面有两个 provider，内层会用 lightTheme 重声明变量，只注外层等于没注），并设
`color-scheme: dark`。原始数据 `.scratch/qa/t63-baseline/baseline-dark.json`（22 行）与
`combos.txt`（四段 × 两主题 × 12–13 组去重组合）。

### 6.1 深色下已经达标的部分（现状就没有问题）

| 元素 | 比值 |
|---|---|
| 选项·未选中（描边/文字） | 6.48 |
| 选项·已选中（描边/内点） | 6.00 |
| 选项·已选中（文字） | 14.55 |
| 焦点环（UA `outline: auto`，`color-scheme: dark` 后自动翻白 `#eeeeee`） | **12.54** |
| 反馈条·答对（文字 on 绿底） | 16.49 |
| 反馈条·答错（文字 on 黄底） | 9.84 |
| 反馈条·待提交 | 12.68 |
| 证据卡·正文 / statLabel | 14.55 / 6.48 |
| 出口门控·徽章 | 5.87 |
| 小结徽章·直达路径 | 14.55 |

### 6.2 深色下不达标的部分（现状）

| 元素 | 比值 | 判定 |
|---|---|---|
| 反馈条·答对 绿边 `#107c10` vs 页底 | **2.71** | ✗ <3（`GreenBorder2 #9fd89f` 为 8.87，可解） |
| StepRail·跳过 `#5c5c5c` vs 页底 | **2.18** | ✗ <3 |
| StepRail·未到 chip 边 `#525252` vs 页底 | **1.86** | ✗ <3 |
| 禁用按钮文字 `#5c5c5c` on `#141414` | **2.76** | ✗ <3 |
| 反馈条·答错 黄边 `#fde300` vs 页底 | 11.20 | ✓（深色下反而是亮的，与亮主题相反） |

> **注意这张表的结论方向与亮主题相反**：亮主题里「黄边 1.10 几乎不可见」，深色里黄边是
> 11.20 很清楚，反而是**绿边**掉到 2.71。这说明「对/错靠色相」在两个主题下坏的方向不同 ——
> 只修亮主题会在深色里留下另一个洞。这正是验收 2 要求「非颜色通道」的原因：颜色通道的
> 达标情况随主题翻转，只有形状/图标/文字是两主题都不变的。

### 6.3 深色下「暗块」不是缺陷（验收 7 只针对亮主题）

`census.spec.ts` 的判据是「亮页面里嵌入的暗块」。深色主题下 `bg-canvas #0A0C10` 本身
亮度 0.006，全页都是暗块 —— 该判据在深色下无意义，验收 7 明确限定「亮主题」。

### 6.4 深色下的品牌色方向反转（易误判）

```
light: colorBrandBackground #6A55D8 lum 0.106 ; hover #5B47C8 lum 0.083
dark : colorBrandBackground #6E5AF0 lum 0.130 ; hover #6350E0 lum 0.100
```
深色下 `accent-fill` 反而比亮主题**更亮**（0.130 > 0.106），而页面底从 0.90 掉到 0.006，
所以白字对比：light 5.38 / dark 4.79，都合格。不要因为「深色主题里按钮看起来更亮」就当成缺陷。

## 7. 交付给 t63 的三条硬约束（写在最前面，实施时先看这里）

1. **`color-scheme: dark` 必须存在**（`tokens.css:110` 已实测有）。否则 `QuestionView` 的
   radio 焦点环（UA `outline: auto`）仍画黑色 `#101010`，在 `#0A0C10` 底上等于消失。
   对比度从 19.03（亮）/ 12.54（暗）直接掉到 1.02。
2. **底色之间的区分不许靠填充色差**。`bg-surface` vs `bg-canvas` 亮 1.10 / 暗 1.06，
   `bg-sunken` vs `bg-surface` 亮 1.18 / 暗 1.09 —— 这些数字在 WCAG 里不是判据，
   但视觉上确实分不开，必须补 `1px var(--sm-border-hairline)`（1.24 / 1.30）。
3. **反馈条的对/错必须同时有：图标（`CheckmarkCircleFilled` / `DismissCircleFilled`，去掉
   `aria-hidden`）+ 左侧 3px 语义竖条 + 文字**。颜色在两个主题下坏的方向相反（亮主题黄边
   1.10、深色绿边 2.71），任何「只调色」的方案都会在另一个主题留洞。
