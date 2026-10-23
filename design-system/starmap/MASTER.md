# StarMap 设计系统 · Master

> **LOGIC:** 做某个页面前先看 `design-system/starmap/pages/[page-name].md`；存在则该页规则**覆盖**本文件，不存在则严格按本文件。
>
> 本文件由 `ui-ux-pro-max` 的 `--design-system --persist --density 8 --motion 4` 生成初稿后**整篇重写**。初稿是通用模板（AI 紫 `#7C3AED` + Inter 外链 + GSAP stagger + 4 档通用阴影），与本仓的玻璃拟态、红色 accent、零新增依赖三条硬约束全部冲突。**生成器的输出是输入，不是结论**；判据是仓库里已经跑着的代码。

---

## 0. 谁是真源

| 内容 | 真源（唯一） | 本文件 | 生成器初稿 |
| --- | --- | --- | --- |
| 颜色 / 间距 / 圆角 / 字号 / 阴影 | `apps/web/src/theme/tokens.ts` | 引用 + 判据 | ❌ 忽略 |
| 动效时长 / 缓动 / 位移 | `apps/web/src/motion/tokens.ts` | 引用 + 判据 | ❌ 忽略 |
| Fluent 槽位 → 本仓 token | `apps/web/src/theme/theme.ts` | 引用 | ❌ 忽略 |
| 玻璃材质原语 | `apps/web/src/theme/glass.css` | 引用 + 判据 | ❌ 忽略 |
| 设计判据（为什么这么定） | **本文件** | 唯一 | ❌ 忽略 |

**改值的规矩**：改 `tokens.ts` / `motion/tokens.ts`，不要改本文件去迁就代码。本文件里的数字若与代码不一致，**代码是错的**——因为本文件记录的是裁定，代码是裁定的实现。

反过来，本文件里没有的**新**决定，先在这里写清理由再落代码。这一条是本仓两次踩坑换来的：`theme/motion.css` 与 `glass.css` 各自写了一套时长（200/350 与 340/180），两套都"能跑"，但同一屏里两个动画速度不同，谁都说不清哪个是对的。

---

## 1. 材质：玻璃拟态三层

StarMap 的底不是纯色，是**流动的玻璃**。三层结构写死在 `apps/web/src/theme/glass.css`：

| 层 | 选择器 | 作用 | 关键值 |
| --- | --- | --- | --- |
| 背景层 | `.sm-liquid-bg` + 5 × `.sm-blob` | 五个模糊光团，全站唯一的"彩色"来源 | 深色紫 `rgba(126,110,255,.5)` / 青 `rgba(56,189,248,.4)` / 珊瑚 `rgba(255,107,107,.42)` / 薄荷 `rgba(72,233,196,.26)` / 淡紫 `rgba(196,132,252,.34)`（`glass.css:79-83`） |
| 膜层 | `.sm-liquid-sheet` | 全屏一张毛玻璃，背景与导航共用，因此**没有接缝** | `blur(26px) saturate(168%)` + `linear-gradient(158deg, --sm-sheet-a, --sm-sheet-b)` |
| 表面层 | `.sm-glass` / `.sm-glass--card` / `.sm-glass--inset` | 内容卡片、面板、内嵌区 | 见下 |

### 1.1 三个玻璃档位

```css
/* glass.css:262 —— 面板：最大圆角、最深填充、三层阴影 */
.sm-glass          { background-color: var(--sm-glass-fill);      border-radius: var(--sm-liquid-r-panel); }
/* glass.css:303 —— 卡片：次大圆角、最浅填充 */
.sm-glass--card    { background-color: var(--sm-glass-fill-soft); border-radius: var(--sm-liquid-r-card); }
/* glass.css:308 —— 内嵌：只留一道顶部高光，没有投影 */
.sm-glass--inset   { background-color: var(--sm-glass-fill-soft); border-radius: var(--sm-liquid-r-inset); box-shadow: var(--sm-liquid-hi); }
```

填充值（深 / 亮）：

| 变量 | 深色 | 明亮 |
| --- | --- | --- |
| `--sm-glass-fill` | `rgba(20, 22, 28, 0.55)` | `rgba(255, 255, 255, 0.55)` |
| `--sm-glass-fill-strong` | `rgba(16, 18, 24, 0.72)` | `rgba(255, 255, 255, 0.74)` |
| `--sm-glass-fill-soft` | `rgba(30, 32, 40, 0.38)` | `rgba(255, 255, 255, 0.38)` |
| `--sm-glass-fill-solid` | `rgba(20, 22, 28, 0.96)` | — |

**填充必须带 alpha。** 不透明填充会让 `backdrop-filter` 变成一个看不见的成本——GPU 照算，观感为零。

### 1.2 形状不是圆角矩形

`--sm-liquid-r-card: 28px 24px 30px 26px` 这类四角不等值是**故意的**。玻璃是吹出来的，四角曲率相同会读成塑料件。四个档位：

| 变量 | 值 | 用在哪 |
| --- | --- | --- |
| `--sm-liquid-r-panel` | `34px 30px 36px 32px` | 内容舞台 `.sm-stage`、Composer |
| `--sm-liquid-r-card` | `28px 24px 30px 26px` | 产物卡、学习日志卡 |
| `--sm-liquid-r-inset` | `20px 22px 18px 24px` | 右栏、内嵌面板 |
| `--sm-liquid-r-pill` | `999px` | 胶囊（导航项、建议、徽标） |

**不要**用 `RADIUS` 那套 4/6/10/12/16 去替代它们——那套是 Fluent 组件的几何（Button/Input/Card/Badge 读它），是"控件"，不是"玻璃"。

### 1.3 描边是不均匀的

`.sm-glass::before`（`glass.css:278`）用 `padding: 1px` + 两层 mask 求差只保留 1px 环，渐变沿对角线走：`stroke-a 0% → stroke-b 34% → rgba(255,255,255,.02) 58% → stroke-a 88% → stroke-b 100%`。

- 深色 `--sm-glass-stroke-a: rgba(255,255,255,0.34)` / `-b: rgba(255,255,255,0.05)`
- 明亮 `-a: rgba(255,255,255,0.92)` / `-b: rgba(120,130,160,0.14)`

**均匀 1px 白线是禁止项。** 那是 Fluent 的 `neutralStroke`，在玻璃上读起来像贴了一张白胶带。

### 1.4 ⚠️ 已知缺陷：`.sm-glass` 挂在 Fluent `<Card>` 上不生效

`<Card className="sm-glass">` 的计算样式实测（`light@2566`、`dark@1280` 两组，`backdrop-filter` 有值但**底色是不透明的**）：

```
card rfxo2k2 sm-glass sm-study-card  bg rgb(255,255,255)  radius 10px  backdrop blur(34px) saturate(1.8)
card rfxo2k2 sm-glass sm-study-card  bg rgb(21, 21, 26)   radius 10px  backdrop blur(34px) saturate(1.8)
```

`rgb(255,255,255)` / `rgb(21,21,26)` 正是 `bg-surface`。原因是 Fluent 的 Card 内部类直接写了 `background-color: theme.colorNeutralCardBackground`，**特异性高于 `.sm-glass`**（`apps/web/src/theme/theme.ts` 里没有 `components:` 覆盖块）。后果三条：

1. 玻璃膜看不见（底下被不透明色挡住），但 GPU 仍在算 `backdrop-filter` —— **纯亏**；
2. `border-radius` 被 Fluent 的 `borderRadiusMedium: 10px` 顶掉，四角不等值失效；
3. 右栏那两张卡看起来是"白卡片贴在玻璃上"，不是"玻璃里的一块"。

**修法（不在本文件范围内，留给实现票）**：在 `theme.ts` 加 `components: { Card: { root: { backgroundColor: 'transparent' } } }`，或给 `.sm-glass` 规则加 `.fui-Card.sm-glass { background-color: var(--sm-glass-fill-soft) }` 这类同级提权。**在那之前，本文件的所有"玻璃卡"描述都按"预期"读，不按"现状"读。**

---

## 2. 颜色

`apps/web/src/theme/tokens.ts:27` 的 `COLOR_KEYS` 共 **52 键**，两套 palette 键集必须完全一致（`assertPaletteParity()` 在模块加载期就抛错）。Fluent 的语义槽位映射在 `theme.ts:113-266`，**那是唯一允许出现物理 token 名的地方**。

### 2.1 层级表面（9）

| 键 | 深色 | 明亮 | 语义 |
| --- | --- | --- | --- |
| `bg-canvas` | `#0B0B0F` | `#ECEDF0` | 页面底（玻璃之下的最底层） |
| `bg-surface` | `#15151A` | `#FFFFFF` | 卡片 / 面板 |
| `bg-elevated` | `#1C1C22` | `#F7F7F9` | 抬一档（hover 之上） |
| `bg-sunken` | `#08080B` | `#E2E3E8` | 下沉区（视频底、代码块） |
| `bg-hover` | `#22222A` | `#F1F1F4` | 悬停 |
| `bg-selected` | `#2A2A33` | `#FBEAEA` | 选中 |
| `bg-input` | `#101014` | `#FFFFFF` | 输入框 |
| `bg-scrim` | `rgba(5,5,8,0.72)` | `rgba(18,18,22,0.32)` | 遮罩 |
| `bg-disabled` | `#14141A` | `#F3F3F5` | 禁用底 |

### 2.2 边框（4）/ 文字（4）

| 键 | 深色 | 明亮 | 判据 |
| --- | --- | --- | --- |
| `border-hairline` | `rgba(255,255,255,0.09)` | `rgba(0,0,0,0.10)` | 分隔线，装饰性 |
| `border-control` | `#6E6E79` | `#71717D` | **可交互控件的边界**，≥3:1 |
| `border-focus` | `#FF6B6B` | `#C42B31` | 焦点环 |
| `border-disabled` | `#2A2A33` | `#DCDCE1` | 禁用边界，不要求对比度 |
| `text-primary` | `#F2F2F5` | `#16161A` | ≥4.5:1 |
| `text-secondary` | `#A8A8B3` | `#55555E` | ≥4.5:1 |
| `text-tertiary` | `#8F8F9B` | `#6B6B75` | ≥4.5:1（明亮下对 `bg-canvas` 恰好 4.50，卡线） |
| `text-disabled` | `#6E6E79` | `#8E8E98` | 3:1 对 surface；**对 canvas 只有 2.77（明亮）→ 不要把它画在页面底上** |

### 2.3 强调色（6）

| 键 | 深色 | 明亮 |
| --- | --- | --- |
| `accent` | `#FF6B6B` | `#C42B31` |
| `accent-fill` | `#CE2C34` | `#C42B31` |
| `accent-hover` | `#B8252C` | `#AE2429` |
| `accent-pressed` | `#9E1F25` | `#961D22` |
| `accent-soft` | `#2A1416` | `#FBEAEA` |
| `on-accent` | `#FFFFFF` | `#FFFFFF` |

### 2.4 语义色（9）

| 键 | 深色 | 明亮 | 用途 |
| --- | --- | --- | --- |
| `success` / `success-soft` | `#4ADE80` / `#10231A` | `#0E7A4A` / `#E6F5EE` | 答对、达标、已完成 |
| `warning` / `warning-soft` | `#F5A524` / `#2A1E0C` | `#8A5200` / `#FBF0DF` | 警示文字 / 警示区底 |
| `warning-border` | `#F5A524` | `#8A5200` | **警示区边界**（与 `warning` 语义独立、值当前相同） |
| `danger` / `danger-soft` | `#FF7A7A` / `#2C1414` | `#C62828` / `#FBEAEA` | 答错、破坏性操作 |
| `info` / `info-soft` | `#7AA2FF` / `#101A2E` | `#1A5FD0` / `#E8F0FC` | 中性提示 |

`warning-border` 为什么要单独一个键：`warning` 承担前景/填充（4.5:1），`warning-border` 承担描边（3:1）。今天算出来同值，不代表以后还该同值；合并成别名会让两种调整重新耦合。

### 2.5 用色规约（六条，**违反即驳回**）

**① 红色在本仓一律只表示「告警 / 答错」，不参与进度表达。**

`accent` 本身就是红（深 `#FF6B6B` / 亮 `#C42B31`）。用 accent 画进度条，屏幕上就是一条红杠——而红色在这个仓里的含义是"你出问题了"。

进度条走**中性阶**：

```
轨道  background-color: var(--sm-border-control)
填充  background-color: var(--sm-text-secondary)
达标  background-color: var(--sm-success)   /* 仅「本关判定已达标」这一种状态 */
```

落地位置：`apps/web/src/theme/glass.css:905`（`.sm-study-track`）、`:912`（`.sm-study-fill`）、`:921`（`.sm-study-row[data-reached='true'] .sm-study-fill`），判定在 `apps/web/src/components/StudySidebar.tsx:186`（`Row`）、`:198`（`data-reached`）。实测（明亮、1280）：轨道 `rgb(113,113,125)`、填充 `rgb(85,85,94)`。

**② 进度条是门槛尺，不是比例尺。**

`作答 8 / 8` 里的分母是**本关门槛**（`ATTEMPT_TARGET = 8`），分子是**跨关卡累计作答数**，两个量纲。显示时分子按门槛封顶（`Math.min(row.value, row.target)`，`StudySidebar.tsx:206`），真实累计数进 `title`（`:203`）。**不要做 schema 拆分**——现在没有"本关作答数"这个真实概念，硬拆会造出假数据。

**③ 颜色不能是唯一指示器。**

对/错、选中/未选中、跳过/未开始，每处都要有第二通道（图标 / 位置 / 线型 / 文字）。见 §9。

**④ 语义色只在 `theme.ts` 的槽位表里接到 Fluent，页面里不写 hex。**

`grep -rnE '#[0-9a-fA-F]{6}' apps/web/src --include=*.tsx --include=*.ts | grep -v theme/` 必须为空（`level/VideoPanel.tsx` 曾有 `#000`，已改 `--sm-bg-sunken`）。

**⑤ 遮罩对着真实背景量过，不靠推算。**

`bg-scrim` 是半透明的，它的实际观感 = 遮罩色与底下内容的合成。任何"遮罩上文字能不能读"的判断都必须实测（`zz-level-theme.spec.ts` 的 `effectiveBg()` 沿 DOM 逐层合成）。

**⑥ 明亮主题也要独立量一遍，绝不假设深色值可以沿用。**

本仓明亮主题的 `text-tertiary` 对 `bg-canvas` 是 **4.50**（卡线），对 `bg-selected` 曾只有 4.45（已由 `bg-selected` 调暗一档修到 4.71，commit `0e0a883`）。这类"只差 0.05"的失败，靠肉眼永远发现不了。

### 2.6 实测对比度（WCAG 2.1，脚本现算，24 对 / 主题）

| 配对 | 深色 | 明亮 |
| --- | --- | --- |
| `text-primary` / `bg-surface` | 16.29 | 18.04 |
| `text-secondary` / `bg-surface` | 7.73 | 7.38 |
| `text-tertiary` / `bg-surface` | 5.69 | 5.27 |
| `text-tertiary` / `bg-canvas` | 6.15 | **4.50** |
| `text-disabled` / `bg-surface` | 3.61 | 3.24 |
| `text-disabled` / `bg-canvas` | 3.90 | **2.77 ❌ 不要用** |
| `border-control` / `bg-surface` | 3.61 | 4.82 |
| `border-control` / `bg-elevated` | 3.37 | 3.03 |
| `option-correct` / `bg-surface` | 10.44 | 5.38 |
| `option-wrong` / `bg-surface` | 7.21 | 5.62 |
| `success` / `success-soft` | 9.43 | 4.78 |
| `warning` / `warning-soft` | 7.98 | 5.67 |
| `danger` / `danger-soft` | 6.83 | 4.83 |
| `warning-border` / `bg-canvas` | 8.41 | 3.41 |
| `warning-border` / `bg-hover` | 6.76 | 3.54 |
| `accent` / `bg-surface` | 6.56 | 5.62 |
| `on-accent` / `accent-fill` | 5.21 | 5.62 |

**两套主题最差值**：深色 **3.37**（段轨 chip 描边 / `bg-elevated`）、明亮 **4.50**（副标题 / `bg-canvas`）。全部 ≥ 各自角色门槛。

---

## 3. 排版

### 3.1 字族

```
--sm-font-sans: 'Inter','SF Pro Text',-apple-system,'Segoe UI Variable Text','Segoe UI',
                'PingFang SC','Hiragino Sans GB','Microsoft YaHei UI','Microsoft YaHei',
                system-ui,sans-serif
--sm-font-mono: 'SF Mono','JetBrains Mono','Cascadia Code',Consolas,'Liberation Mono',…
```

**不引外链字体。** 生成器初稿给了 `@import url('https://fonts.googleapis.com/css2?family=Inter…')`——本地单用户应用，外链字体等于把首屏押在网络上，而 Inter 已经在系统字体栈的第一位，装了就用，没装就落到 `Segoe UI Variable`/`PingFang SC`，两者都是合格的中文正文脸。

### 3.2 字号阶梯（`tokens.ts:389` `TYPE_SCALE`）

| 角色 | 字号 / 行高 | 字重 | 字距 | 用在哪 |
| --- | --- | --- | --- | --- |
| `display` | 28 / 36 | 600 | -0.02em | 页面标题（「学习」） |
| `title` | 20 / 28 | 600 | -0.01em | 区块标题、卡标题、学习记录页标题 |
| `subtitle` | 16 / 24 | 600 | -0.005em | 小节标题 |
| `body` | 14 / 22 | 400 | 0 | 正文、说明 |
| `body-strong` | 14 / 22 | 500 | 0 | 强调正文 |
| `caption` | 12 / 18 | 400 | 0.005em | 标签、元信息 |
| `micro` | 11 / 16 | 500 | 0.02em | 极小徽标 |
| `code` | 13 / 20 | 400 | 0 | 代码、公式 |

### 3.3 Fluent 槽位（`theme.ts:274-291`）

```
fontSizeBase100..600   = 10 / 12 / 14 / 16 / 20 / 24 px
fontSizeHero700/800    = 28 / 32 px
lineHeightBase100..600 = 14 / 16 / 22 / 24 / 28 / 32 px
```

`lineHeightBase300 = 22px` 是**覆盖过的**：Fluent 默认 20px，对 14px 中文正文太挤（汉字没有西文的小写字母高度落差，20px 行高会让密排段落糊成一片）。

### 3.4 中文排版三条

1. **行高 ≥ 1.5×字号**（14/22 = 1.57）。低于 1.5 的中文正文在 1280 宽度下会读串行。
2. **正文测度 ≤ 40 个汉字/行**。14px 汉字宽约 14px，40 字 ≈ 560px。本文件把上限定在 **760px**（≈ 54 字），因为产物卡里混有数字与英文术语，纯汉字不会占满。
3. **字距只在大字号用负值**。`display` 的 -0.02em 是让"学习"两个字不显得松散；正文用负字距会让汉字挤在一起。

---

## 4. 间距

`tokens.ts:314` 的 `SPACE` 九档，**4/8 节奏**：

| token | 值 | 典型用途 |
| --- | --- | --- |
| `space-0` | 0 | — |
| `space-1` | 4px | 图标与文字之间、紧邻标签 |
| `space-2` | 8px | 控件内 padding、行内间隔 |
| `space-3` | 12px | **卡片之间的默认间距** |
| `space-4` | 16px | 卡片内 padding、区块内元素 |
| `space-5` | 24px | 区块之间 |
| `space-6` | 32px | 页面级分节 |
| `space-7` | 48px | 大留白（Composer 上方上限） |
| `space-8` | 64px | 极端留白，慎用 |

生成器初稿给的是 2/4/8/12/16/24/32——**少了 48 与 64**，而本仓用 48 表达"这里可以停一下"。以 `tokens.ts` 为准。

---

## 5. 圆角

`RADIUS`（`tokens.ts:345`）：`xs 4` / `sm 6` / `md 10` / `lg 12` / `xl 16` / `full 9999`。

`RADIUS_ROLE`（`tokens.ts:355`）把它们映射到组件角色：

| 角色 | 值 | 谁读它 |
| --- | --- | --- |
| `card` | 12px（lg） | Card |
| `control` | 10px（md） | Button / Input |
| `chip` | 6px（sm） | Badge |
| `overlay` | 16px（xl） | 浮层 |
| `pill` | 9999px | 胶囊 |

这组 12/10/6 是抓 raycast.com 6 个生产 CSS chunk 统计出来的，不是拍的。

**玻璃原语另有一套（§1.2），两套不要混用。**

---

## 6. 阴影

`SHADOW_KEYS`（`tokens.ts:105`）只有 **4 个键**：

| 键 | 深色 | 明亮 |
| --- | --- | --- |
| `shadow-sm` | 深色下的弱投影 | `0 1px 2px rgba(16,18,24,0.06)` |
| `shadow-md` | — | `0 4px 12px rgba(16,18,24,0.08)` |
| `shadow-lg` | — | `0 16px 48px rgba(16,18,24,0.12)` |
| `glow-accent` | — | `0 0 0 1px #C42B31, 0 0 16px rgba(196,43,49,0.16)` |

生成器给了 4 档 `rgba(0,0,0,…)`——**没有 `glow-accent`**，而本仓的强调态靠它。以 `tokens.ts` 为准。

**玻璃的阴影不是这套**：`.sm-glass` 用 `--sm-liquid-hi`（顶部内高光）+ `--sm-liquid-deposit`（底部沉积）+ `--sm-liquid-shadow`（`0 28px 64px -34px rgba(0,0,0,0.86)`）。三层叠出来的"厚度"，单层投影做不出来。

---

## 7. 动效

### 7.1 真源与语义

`apps/web/src/motion/tokens.ts`：

| 导出 | 值 | 语义 |
| --- | --- | --- |
| `instant` | 0ms | 状态同步：值已变、界面立刻反映，**不播**过渡 |
| `quick` | 120ms | 卡片/列表入场、按钮按下这类"一眼就该结束"的微反馈 |
| `standard` | 200ms | 抽屉滑入、面板展开、悬停变色 |
| `slow` | 350ms | 镜头推进、跨区域位移 |
| `easeOut` | `cubic-bezier(0.22, 1, 0.36, 1)` | 入场（起步快、收尾慢） |
| `easeInOut` | `cubic-bezier(0.65, 0, 0.35, 1)` | 状态切换（两头都慢） |
| `ENTER_OFFSET_PX` | 8 | 入场位移上限 |

CSS 侧镜像在 `apps/web/src/theme/tokens.css:93-101`：`--sm-dur-instant/fast/base/slow/scene` = `0/120/200/350/350ms`，`--sm-ease-out/-in-out/-linear`。

### 7.2 ⚠️ 已知漂移：`glass.css` 自己又写了一套

```css
/* apps/web/src/theme/glass.css:54-55 */
--sm-glass-dur: 340ms;
--sm-glass-dur-fast: 180ms;
```

`340/180` 与 `--sm-dur-slow 350` / `--sm-dur-fast 120` **都对不上**。`--sm-glass-ease` 恰好等于 `easeOut`（`cubic-bezier(0.22,1,0.36,1)`），所以曲线没问题，只有时长是第二份真源。消费者有 9 处（`:335` 外壳列宽、`:445-448` 导航项、`:674` 页面入场、`:789/:813` Composer、`:917` 进度填充、`:1017` 跳过链接、`:1050` 淡入、`:1079` 抽屉）。

**这一处要不要收敛，等实现票定**。本文件的态度是：新代码一律用 `--sm-dur-*`，不再新增 `--sm-glass-dur*` 的消费者。

### 7.3 四条硬规矩

1. **只用 `transform` / `opacity`。** 不动 `width` / `height` / `top` / `margin` —— 那是布局属性，每帧都会触发重排。
2. **入场自上而下 8px + 120ms ease-out。** 不给每张卡加不同延迟：一屏三张卡各自 0/60/120ms 延迟，在 120fps 采样里就是三次独立的抖动，读起来像页面在抽搐。
3. **`prefers-reduced-motion: reduce` 时全站零动画。** 是"瞬时"不是"淡入"——用更柔和的过渡冒充降级，等于没降级。
4. **转场是连续缩放，不是淡入淡出。** 见 `apps/web/src/theme/motion.css`：`/map` → `/map/:id` → `/level/:id` 的层级差决定 `data-sm-transition` 是 `zoom-in` / `zoom-out` / `none`。缩放只做 **1.06 / 0.94**，幅度越大文字越糊（浏览器按位图缩放快照）。

---

## 8. 布局骨架

### 8.1 外壳三列（`AppShell.tsx:370`，`glass.css:323`）

```
.sm-shell-grid {
  grid-template-columns: var(--sm-rail-icons) var(--sm-rail-labels) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
--sm-rail-icons: 56px;   /* 图标轨：品牌标记 + 窄屏抽屉入口 */
--sm-rail-labels: 216px; /* 导航列：宽屏常驻，窄屏整列不渲染 */
```

`≤767px` 变两列（`glass.css:1026`），导航进抽屉。

### 8.2 内容区

```
.sm-content { grid-column: 3; padding: 12px 16px 0; }   /* glass.css:582 */
.sm-stage   { border-radius: 34px 30px 0 0; background: var(--sm-glass-fill); backdrop-filter: blur(34px) saturate(180%); }
.sm-main    { overflow: auto; scrollbar-gutter: stable both-edges; }   /* glass.css:637 */
```

`scrollbar-gutter: stable both-edges` 不是可选：滚动条只吃一侧时，同一页有无滚动条两态的正文会横跳 15px。

### 8.3 页面内容测度（本文件新增裁定）

| 量 | 目标 | 依据 |
| --- | --- | --- |
| 页面根 `maxWidth` | `min(1120px, 100%)` | 2566 下正文列 762 太窄、1080 太宽；1120 是"卡 760 + 右栏 320 + 缝 32"的精确和 |
| 正文气泡 `maxWidth` | `760px` | ≈ 54 汉字/行，超过就要用视线回扫 |
| 产物卡 `maxWidth` | `720px`（现状保留） | 卡内是数字 + 短句，比正文窄一档更聚拢 |
| 右栏宽 | `320px` | 三门槛 + 建议 + 日志，300 会让"累计 8 次，本关需 ≥8"折行 |
| 内容列 ↔ 右栏缝 | `≤ 32px` | 现状 18px 网格 gap + 卡片居中余量；32 是上限不是目标 |
| Composer 上方留白 | `≤ 48px` | `space-7`；再大就是"内容和输入框没关系了" |
| Composer 宽度 | `= 内容列宽` | 现状已满足（628@1280 / 762@2566） |

### 8.4 ⚠️ 已知缺陷：粘底 Composer 没有底部内衬

`HomePage.tsx` 的 `composer` 是 `position: sticky; bottom: 0`，而 `.sm-page-in` 是 `grid-template-rows: 1fr auto` 的网格，`stage` 行内容高于视口时**溢出而不收缩**（`stage` 没有 `minHeight: 0`）。

实测 `1280×800`：

```
pageRoot   y=32  h=768  bottom=800
stage      y=54  h=976  bottom=1030
composer   y=608 h=174  bottom=782
stageToComposer = 608 - 1030 = -422   ← 内容伸到 Composer 底下 422px
main.scrollHeight = 1222 > 视口
```

即：**滚到底时最后一块内容被 Composer 挡住**（`pro-layout-scroll-not-obscured` 违规）。修法两条，实现票选一：

- (a) `.sm-stage` 加 `padding-bottom: <Composer 高度>`，或
- (b) 给 `.sm-page-in` 的 `stage` 行加 `min-height: 0` + `overflow: auto`，让 Composer 真正占据网格行。

---

## 9. 交互态

| 态 | 做法 | 判据 |
| --- | --- | --- |
| hover | `background-color` 换一档（`bg-hover` / `--sm-glass-fill-strong`） | **不做 `translateY(-2px)`**：悬停位移会改布局包围盒，一列卡片依次 hover 会互相推挤 |
| pressed | 只换色 / 换阴影，**不位移** | `pro-visual-pressed-no-shift` |
| focus | `outline: 2px solid var(--sm-border-focus); outline-offset: 2px` | 面积 ≥2px、状态对比 ≥3:1 |
| disabled | `opacity` + `cursor: not-allowed`，且 `pointer-events` 真的不通 | 禁用态必须"看得出来且点不动" |
| 可点元素 | `cursor: pointer` | 关卡卡整卡可点（`ArtifactCard.tsx:69`），必须给 |

焦点环**不覆盖 UA 的 `outline: auto`**：`color-scheme: dark` 已在 `tokens.css:118` 落好（`:root` 与 `[data-sm-theme='dark']`），明亮在 `:185`。这是 UA 能画出可见焦点环的前提。

---

## 10. 可达性硬要求

1. **颜色不是唯一指示器。** 每个用色表达的状态都要有第二通道：
   - 答题对/错 → `CheckmarkCircleFilled` / `DismissCircleFilled`（**不进 `aria-hidden`**，它是语义）+ 左侧 3px 语义竖条 + 文字
   - 段轨跳过态 → 虚线边 + 删除线 + `text-tertiary`（三通道）
   - 进度达标 → `success` + 数值 `8 / 8` + `data-reached`
2. **`prefers-reduced-motion: reduce` 时零动画**，且页面完整可用。`glass.css:1110` 已停掉光团/页面入场/抽屉/遮罩，`motion.css` 停掉所有 `::view-transition-*`。
3. **粘性 UI 与浮层不遮挡键盘焦点**（WCAG 2.2 AA）。§8.4 那条缺陷同时是这条的违规。
4. **跳过链接**：`.sm-skip`（`glass.css:1017`）在 `:focus` 时 `translateY(0)` 滑出，`href="#main"`。
5. **读屏顺序 = 视觉顺序**：`.sm-rail` → `.sm-nav-panel` → `.sm-content`，DOM 顺序即视觉顺序，不用 `order` 重排。
6. **装饰图标 `aria-hidden="true"`**，有意义图标给替代文本，图标按钮给可访问名。

---

## 11. 已解决 / 不要重开

后面的人（或 agent）看到这几条**不要"顺手改回去"**。每条都踩过。

| # | 现象 | 裁定 | 为什么不要重开 |
| --- | --- | --- | --- |
| 1 | 侧栏显示 `作答 474 / 8` | 已在后端修（`baa7b06`）：分子按门槛封顶、累计数进 `title` | 474 是跨关卡累计作答、8 是 `GATE_RULES.exit.itemCount`，**两个量纲**。进度条是门槛尺不是比例尺。**不做 schema 拆分**——现在没有"本关作答数"这个真实概念，硬拆字段会造出假数据。侧栏 20 条测试钉着。 |
| 2 | 进度条是红色 | 走中性阶，只有"达标"换 `success` | `accent` 本身就是红；红色在本仓表示告警/答错。见 §2.5 ① |
| 3 | 关卡卡里没有"进入关卡"按钮 | 保持没有 | 票 72：整卡可点、可 Tab、Enter/Space 重开。按钮会把"多久、几题、第一步"降级成"按钮上方的说明文字"，还会在打字时和输入框抢注意力 |
| 4 | 问津卡不走 `ProbePanel` | 保持 | `probeId` 是 `clarify-<turnId>` 伪 id，服务端没有对应记录 |
| 5 | 页面不用 `React.lazy` | 保持 | 六个页面都在首屏导航里，懒加载只会把"点一下菜单"换成一次网络往返 + 一次布局跳动 |
| 6 | 同一屏里两个动画速度不同 | `motion/tokens.ts` 是唯一真源 | 见 §7.2，`--sm-glass-dur*` 是遗留，新代码不要消费 |
| 7 | `text-disabled` 在明亮主题的 `bg-canvas` 上只有 2.77 | 不要把它画在页面底上 | 已由段轨改用 `text-tertiary` 绕过。要改就改 token，别在页面里绕过 |

---

## 12. 反模式（本仓专属，比生成器那份更严）

- ❌ 用 `accent`（红）表达进度、完成度、正常状态
- ❌ 均匀 1px 白线当卡片描边（用 `.sm-glass::before` 的不均匀渐变）
- ❌ 不透明 `background-color` 上再挂 `backdrop-filter`（GPU 照算，观感为零）
- ❌ hover 时 `transform: translateY()`（改布局包围盒）
- ❌ 给列表里每张卡加不同 `animation-delay`
- ❌ 在页面里写 `#RRGGBB`（只允许 `var(--sm-*)` 或 Fluent `tokens.*`）
- ❌ 用 emoji 当图标
- ❌ `prefers-reduced-motion` 下"改用淡入"（那是没降级）
- ❌ 外链字体 / 新引动画库（零新增依赖）
- ❌ 用 `RADIUS` 那套去替代 `--sm-liquid-r-*`（控件几何 ≠ 玻璃形状）

---

## 13. Pre-Delivery Checklist

来源：`~/.dsh/skills/ui-ux-pro-max/references/pro-rules.md:64-117`（canonical，五组共 **39 条**）。

**范围声明**：该文件 `:5` 自己写明"整份面向 native/mobile app UI，web/desktop 交互模式应看 `references/quick-reference.md`"。StarMap 是**桌面优先的本地 Web 应用**（最小支持宽度 375px，主用宽度 1280–2566）。因此凡涉及"触摸目标 / 安全区 / 手势"的条目，判据改用 `quick-reference.md` 的 web 口径（`web-target-size` 24×24 CSS px）而非 44pt。

### Process（6）

| # | 条目 | 判定 | 依据 |
| --- | --- | --- | --- |
| P1 | 只跑了与本界面相关的检索 | ✅ 已满足 | 本轮只用了 `ui-ux-pro-max` 的 `--design-system`（一次），未做无关 domain 检索 |
| P2 | 复审 `quick-reference.md` §1–§3 | ✅ 已满足 | §1 Accessibility / §2 Touch & Interaction / §3 Performance 全读，判据已并入 §9、§10、§13 |
| P3 | 375px 与横屏测过 | ⚠️ 部分满足 | 375×720 已由 `.scratch/qa/scenarios/zz-shell-fit.spec.ts`、`zz-narrow.spec.ts` 覆盖；**横屏（如 812×375）未单独测** → 记为实现票待办 |
| P4 | reduced-motion + 最大字号验过 | ⚠️ 部分满足 | reduced-motion 有双向断言（`zz-motion*.spec.ts`：`document.getAnimations().length === 0` / `> 0`）；**Dynamic Type / 系统最大字号未验**（浏览器 `font-size` 缩放不等于系统字号） |
| P5 | 深色对比度独立检查 | ✅ 已满足 | §2.6 的 24 对/主题是**分别现算**的，没有任何一行从另一主题抄 |
| P6 | 触摸目标 ≥44pt 且无内容被安全区挡 | ➖ 不适用（改为 web 口径） | 桌面应用，无 notch / 安全区。web 口径 `web-target-size` 24×24 CSS px。**实测**（`.scratch/qa/tmp/measure-t87-a11y.mjs`，四页 1280×800）：可点元素 `/` 23 个、`/learning` 122、`/map` 427、`/market` 41；**唯一小于 24×24 的真实目标**是 `/market` 的文件选择 `<input>`（253×21，高 21 < 24）。另有两个 1×1 命中框，实测是 Fluent Tabster 的焦点哨兵（`<i tabindex="0" role="none" aria-hidden="true" data-tabster-dummy>`，`opacity: 0.001`），不是用户目标，不计 |

### Visual Quality（5）

| # | 条目 | 判定 | 依据 |
| --- | --- | --- | --- |
| V1 | 不用 emoji 当图标 | ✅ 已满足 | 全站图标来自 `@fluentui/react-icons`（已在依赖里，2.0.344）。`✓`/`△`/`⤼` 是**文字符号**不是图标，且都在 `aria-hidden` 的装饰位或带文字标签 |
| V2 | 图标同一族同一风格 | ✅ 已满足 | 只用 Fluent 图标（Regular 为主，Filled 只用于"已确认"状态如 `CheckmarkCircleFilled`） |
| V3 | 官方品牌资产比例正确 | ✅ 已满足 | 品牌标记只有 `StarMap` 文字 + 圆形 `S` 徽标（`AppShell.tsx` `brandMark`），自绘 SVG，无第三方商标 |
| V4 | 按压态不改布局、不抖 | ✅ 已满足 | §9：pressed 只换色/换阴影，无位移。`.sm-nav-item` 的 `transition` 只列 `transform / border-radius / background-color / color`（`glass.css:445-448`），不含 `width`/`margin` |
| V5 | 语义 token 一致，无逐屏硬编码色 | ✅ 已满足（含一处例外） | `grep -rnE '#[0-9a-fA-F]{6}' apps/web/src --include=*.tsx --include=*.ts \| grep -v theme/` → **0 命中**。例外：`glass.css` 里的光团色（`rgba(...)`）与 `--sm-glass-*` 填充是**材质定义**，属于"玻璃原语"而非"逐屏颜色"，且只在 `:root` 声明一次 |

### Interaction（6）

| # | 条目 | 判定 | 依据 |
| --- | --- | --- | --- |
| I1 | 可点元素有按压反馈 | ✅ 已满足 | Fluent Button 自带；关卡卡 hover 换底 + 抬阴影（`ArtifactCard.tsx:68`）；会话列表项 hover 换 `--sm-glass-fill-strong`（`LearningPage.tsx:123`） |
| I2 | 触摸目标 ≥44pt/48dp | ➖ 不适用 | 桌面应用，改用 `web-target-size` 24×24 CSS px，见 P6 |
| I3 | 微交互时长用共享 token | ⚠️ 部分满足 | 新代码全部读 `--sm-dur-*`（§7.1）；**`glass.css` 仍有 9 处消费 `--sm-glass-dur*`（340/180ms）**，见 §7.2 |
| I4 | 禁用态清晰且不可交互 | ✅ 已满足 | Fluent `disabled` 自带 `pointer-events` 拦截；`.sm-study-row` 的"证据不足"是**无值**不是禁用态（显示"证据不足"而非 `0 / 8`），语义正确 |
| I5 | 读屏焦点顺序 = 视觉顺序，标签有描述 | ✅ 已满足 | DOM 顺序即视觉顺序（§10 第 5 条）。**实测**四页 `unnamedIconButtons = 0`：所有 `<button>` 都有可访问名。导航项实测 206×44、`aria-selected` 齐备；关卡卡有 `aria-label={\`打开关卡：${title}\`}`（`ArtifactCard.tsx:250`） |
| I6 | 手势区域不嵌套冲突 | ➖ 不适用 | 无滑动手势、无拖拽交互（`GraphCanvas` 明确 `enableNodeDrag: false`） |

### Light/Dark Mode（5）

| # | 条目 | 判定 | 依据 |
| --- | --- | --- | --- |
| L1 | 主文字两主题 ≥4.5:1 | ✅ 已满足 | `text-primary` 深 16.29 / 亮 18.04（§2.6） |
| L2 | 次要文字两主题 ≥4.5:1 | ✅ 已满足（有一处卡线） | `text-secondary` 深 7.73 / 亮 7.38；`text-tertiary` 深 6.15 / 亮 **4.50**（对 `bg-canvas`，恰好达标） |
| L3 | 分隔线/边框与交互态两主题可辨 | ✅ 已满足 | `border-control` 深 3.37–3.90 / 亮 3.03–4.82，全部 ≥3:1；`border-hairline` 是装饰线，不要求 3:1 |
| L4 | 遮罩对着真实背景量过 | ✅ 已满足 | `zz-level-theme.spec.ts` 的 `measure()` 在浏览器里沿 DOM 逐层合成半透明层再算对比度，不是按单层推算 |
| L5 | 两主题都实测过 | ✅ 已满足 | `zz-level-theme.spec.ts` 两主题各跑一遍完整七段链路 + 18 张截图；`.scratch/qa/shots/theme-level-*` |

### Layout（6）

| # | 条目 | 判定 | 依据 |
| --- | --- | --- | --- |
| Y1 | 安全区（header / tab bar / 底部 CTA） | ➖ 不适用 | 桌面浏览器，无 notch / home indicator |
| Y2 | 滚动内容不被固定条遮挡 | ❌ **未满足** | §8.4：粘底 Composer 让内容伸到它底下 422px（1280×800 实测）。**这是本轮唯一一条硬违规，必须修** |
| Y3 | 小/大手机、平板竖横都验过 | ⚠️ 部分满足 | 375×720 已验（`zz-narrow`）；**横屏与平板未验**，同 P3 |
| Y4 | 留白按设备与朝向自适应 | ✅ 已满足 | `.sm-content` 三段式对称留白；`zz-layout-2560.spec.ts` 断言四页 × 四档（1280/1440/1920/2560）左右留白差 ≤2px |
| Y5 | 4/8dp 节奏贯穿组件-区块-页面 | ✅ 已满足 | `SPACE` 九档全为 4 的倍数（§4）；实测页面 padding 22px 是唯一例外（`22 = 4×5.5`），它是**上下不对称留白**（上 22 下 0），不是节奏断点 |
| Y6 | 长文测度在大屏仍可读 | ⚠️ 部分满足 | 产物卡 `maxWidth: 720px` 已收口；**正文气泡无 `max-width`**，2566 下宽 762（≈54 汉字/行，勉强可读）。目标 760，见 §8.3 |

### Accessibility（11）

| # | 条目 | 判定 | 依据 |
| --- | --- | --- | --- |
| A1 | 装饰图标 `aria-hidden` | ✅ 已满足 | 段轨的 `✓`/`⤼`、Composer 的图标按钮内图标、`.sm-blob` 容器都 `aria-hidden="true"` |
| A2 | 有意义图标有替代文本 | ✅ 已满足 | 对/错图标**已从 `aria-hidden` 移出**（`QuestionView.tsx`，票 t63），因为它是"对错"的语义载体 |
| A3 | 图标控件有可访问名与状态 | ✅ 已满足 | `aria-label` + `aria-expanded`（抽屉）、`aria-current="step"`（段轨当前）、`aria-pressed`（档位切换） |
| A4 | 表单有标签/提示/错误 | ✅ 已满足 | Composer `ariaLabel="这一轮想说的话"` + `placeholder` + 字数提示（>80% 才出现）；填空 `<Textarea aria-label="答案填空" />`；错误用 `MessageBar intent="error"` 就近显示 |
| A5 | 颜色不是唯一指示器 | ✅ 已满足 | §10 第 1 条，三处状态各有第二通道 |
| A6 | reduced-motion 与动态字号不破版 | ⚠️ 部分满足 | reduced-motion 双向断言已有；**动态字号未验**，同 P4 |
| A7 | 粘性 UI 与浮层不遮挡键盘焦点 | ❌ **未满足** | 同 Y2。另外 `t68` 的关卡浮层已验过焦点不逃逸，但**粘底 Composer 遮挡**是独立问题 |
| A8 | 拖拽有按钮/键盘替代 | ➖ 不适用 | 无拖拽交互 |
| A9 | 认证支持密码管理器 | ➖ 不适用 | 本地单用户、无登录 |
| A10 | 自动轮播有暂停且焦点/减少动效时停 | ➖ 不适用 | 无轮播。`.sm-blob` 光团是无限背景动画，但**在 `prefers-reduced-motion` 与 `data-sm-lowfx='true'` 下都已 `animation: none !important`**（`glass.css:1111`、`:1133`） |
| A11 | 表单失败保留行内错误 + 焦点落到错误摘要 | ⚠️ 部分满足 | 行内错误已有（`MessageBar` 就近）；**多错时焦点不自动落到错误摘要**。本仓表单都是单字段（Composer / 填空），暂无多错场景 → 记为实现票待办 |

**汇总：39 条中 ✅ 23 / ⚠️ 7 / ❌ 2 / ➖ 7。**

两条 ❌ 都是同一个根因（粘底 Composer 无底部内衬，§8.4），修一处即可。八条 ⚠️ 里，横屏/平板、Dynamic Type 是**验证缺口**（代码可能没问题，只是没测），`--sm-glass-dur*` 是**真源漂移**，正文气泡 `max-width` 是**已知设计目标**。
