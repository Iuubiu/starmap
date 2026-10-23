# 学习页 `/`（HomePage）

> **覆盖 `../MASTER.md` 的部分**：本页的测度、右栏、Composer 粘底规则优先于 Master §8.3。颜色、材质、字号、间距、动效一律仍按 Master。
>
> 参考图：`.scratch/design/cx-1.png`（1240×700）。基准结构 = Linear 桌面端；材质 = 玻璃拟态（不改成纯色卡片）。

---

## 0. 这一页在做什么

用户说一句"我想学布尔代数的基本运算"，智能体回一句 + 一张产物卡（关卡卡 / 问津卡 / 掌握度卡 / 图谱卡）。右栏是"我走过的路"：三门槛 + 建议 + 会话日志。

**这一页只有一个主体：对话。** 所有布局决定都服从"让正文列读起来像一张纸，而不是一个表单"。

---

## 1. 现状实测（改前基线）

脚本：`.scratch/qa/tmp/measure-t87-before.mjs` 等（一次性，可删）。JSON 在 `.scratch/qa/tmp/t87-*.json`。截图 `.scratch/qa/shots/t87-before-home-{1280,2566}.png`。

**所有测量必须先写 `localStorage['profileDone'] = '1'`**：`FirstVisitGate`（`apps/web/src/pages/WelcomePage.tsx:91`）在它缺失时把 `/` 重定向到 `/welcome`，量到的会是欢迎页。

| 量 | 1280×800 | 2566×1080 | 判据 |
| --- | --- | --- | --- |
| 页面根宽 | 946 | 1080 | 声明 `maxWidth: min(1080px, 100%)`（`HomePage.tsx:86`） |
| 左右留白 | 15 / 15 | **591 / 591** | 太宽：2566 下正文列只占 42% 屏宽 |
| 网格列 | `628px 300px` | `762px 300px` | 声明 `minmax(0,1fr) minmax(240px,300px)`（`:97`），右栏实际渲染 272 |
| 正文气泡宽 | 628 | 762 | **无 `max-width`**（`:135`），宽度 = 内容列宽 |
| 产物卡宽 | 628（受列宽限） | 720 | 声明 `maxWidth: 720px`（`ArtifactCard.tsx:55`） |
| Composer y / h | 608 / 174 | 888 / 174 | `position: sticky; bottom: 0`（`:172`） |
| Composer 底距视口 | 18 | 18 | — |
| stage 底 | 1030 | 1008 | — |
| **stageToComposer** | **−422** | **−120** | 负数 = 内容伸到 Composer 底下 |

`main.scrollHeight = 1222 > 800`：`stage` 行溢出而不收缩（`stage` 没有 `minHeight: 0`），**滚到底时最后一块内容被粘底 Composer 挡住 422px**。

---

## 2. 六条差距与目标值

| # | 现状 | 目标 | 为什么 |
| --- | --- | --- | --- |
| ① | 内容列 1080，正文 628–762，两侧各空 591 | 页面根 `min(1120px, 100%)`；正文气泡 `max-width: 760px` | 1080 是"卡 720 + 右栏 272 + 缝 18"的旧和。新和 = **卡 760 + 右栏 320 + 缝 32 = 1112**，取 1120。760px ≈ 54 汉字/行，超过就要视线回扫 |
| ② | 右栏实测宽 272（声明 `minmax(240px, 300px)`），与内容列之间的网格 gap 18 | 右栏 `320px`；缝 `≤32px` | 右栏是参照物，不是第二主体。300 会让「累计 8 次，本关需 ≥8」这类 `title` 折行，而它只在 hover 时出现，折行后不可读 |
| ③ | 右栏 `children = 2`、gap 10、**嵌套带背景色的后代 4 个**（2 张 `sm-study-card` + 2 个 `sm-study-suggestion` `rgba(255,255,255,.38)`） | 一列、卡间距 **12**、**不嵌套深色小盒** | 玻璃套玻璃 → 两层半透明叠加后底色变浑浊，且 `backdrop-filter` 套 `backdrop-filter` 在核显上是真实成本 |
| ④ | 进度条曾用 accent（红）；`作答 474 / 8` 超上限 | 中性阶 + 分子封顶 | Master §2.5 ①②，已由 `baa7b06` 修 |
| ⑤ | 关卡卡四格是**灰底小盒**（`colorNeutralBackground2` = `bg-canvas`，比卡片底更暗） | **无框四组数字**，靠字重与留白分层 | 四个数字不需要四个盒子。盒子把"信息"降级成"表单项"，还制造了 4 个深色块 |
| ⑥ | Composer 粘底但内容伸到它下面 422px | 粘底，上方留白 `≤48px`，宽度 = 内容列宽 | 输入框和正文要有关系。500px 空白让"我在跟谁说话"断掉 |

---

## 3. 结构（三行两列网格）

```
.sm-stage
└── page            max-width: min(1120px, 100%); margin-inline: auto; width: 100%;
    │               display: grid; gap: 18px 32px;
    │               grid-template-columns: minmax(0, 1fr) 320px;
    │               grid-template-rows: 1fr auto;
    │               padding: 22px 0 0; min-height: 100%;
    ├── stage        grid-column: 1; display: flex; flex-direction: column;
    │                gap: 14px; padding-bottom: 16px; min-height: 0;   ← ⑥ 的关键
    │   ├── title      「学习」display 28/36/600/-0.02em
    │   ├── cardArea   flex column; gap: 12px
    │   │   ├── visibleResponse   正文气泡，max-width: 760px
    │   │   └── ArtifactCard      产物卡，max-width: 720px; margin-inline: 0
    │   └── …
    ├── side         grid-column: 2; grid-row: 1 / span 2;   ← 跨两行
    │                display: flex; flex-direction: column; gap: 12px;
    │                padding: 14px; border-radius: var(--sm-liquid-r-inset);
    │                background-color: var(--sm-glass-fill-soft);
    └── composer     grid-column: 1; position: sticky; bottom: 0;
                     padding: 14px 0 18px; margin-top: auto;
                     background-color: var(--sm-glass-fill-strong);
                     backdrop-filter: blur(24px) saturate(170%);
```

**`width: 100%` 是必须显式写的**：`marginInline: auto` 会让网格项失去 stretch，宽度退回 `fit-content`，`max-width` 根本没机会生效（`HomePage.tsx:81` 的注释记着这个坑，实测 2560 下只有 980px）。

---

## 4. 正文气泡

```ts
visibleResponse: {
  maxWidth: '760px',          // ← 新增，⑥/① 的落点
  padding: '14px 16px',
  borderRadius: 'var(--sm-liquid-r-card)',
  backgroundColor: 'var(--sm-glass-fill-soft)',
  boxShadow: 'var(--sm-liquid-hi)',
  fontSize: '14px', lineHeight: '22px',
  wordBreak: 'break-word',
}
```

**现状没有 `max-width`**，宽度跟着内容列走。改成固定 760 之后，2566 下正文宽度从 762 → 760（几乎不变），但**列宽改成 1120 后内容列会变成 768**，此时 760 是必要的收口。

**要不要区分用户气泡与助手气泡？** 参考图 `cx-1.png` 里用户消息是右对齐深色胶囊、助手是左对齐无框。**本轮不改**——那会动 `HomePage.tsx` 的渲染逻辑，而本票范围是规范文件。记为实现票的候选，理由写在下面：

> 现在两者都是左对齐的同一个 `<Text>`（`HomePage.tsx:496`），读长对话时无法一眼分出"我说的"和"它说的"。但改成分气泡会引入新问题：助手回复里有产物卡，卡片必须与文字同列左对齐；用户气泡右对齐后，两者宽度上限不同（760 vs 560），一屏里出现三种宽度。**先收口测度，再谈气泡形状。**

---

## 5. 右栏

```
side
├── StudySidebar         三门槛（作答 / 变式 / 连续）+ 最多 3 条建议
├── sideTitle            「学习日志」+ 「开新会话」按钮
├── SessionPlanCard
├── DispensableHint
└── logScroll            max-height: calc(100vh - 220px); overflow-y: auto
    └── TurnLog
```

改动三条：

1. **`gap: 10px → 12px`**（`HomePage.tsx:153`），对齐 `SPACE` 的 `space-3`。右栏是密集列表，10 不在刻度上。
2. **去掉嵌套背景色**。`sm-study-card` 与 `sm-study-suggestion` 现在各自带 `--sm-glass-fill-soft` / `rgba(255,255,255,.38)`，叠在右栏自身的 `--sm-glass-fill-soft` 上就是两层玻璃。改为：右栏一层玻璃，内部卡**无背景**，只靠 `padding` 与分隔线分节。
3. **右栏宽 320**（网格列写死 320，不再 `minmax(240px, 300px)`）。300 会让「累计 8 次，本关需 ≥8」这类 `title` 折行，而它是 hover 时才出现的说明，折行后不可读。

**三门槛的颜色与数值语义**（Master §2.5 ①②，已落地，不要改）：

```tsx
// apps/web/src/components/StudySidebar.tsx:196
const reached = row.value !== null && row.value >= row.target;
// :203  真实累计进 title
title={row.value === null ? undefined : `累计 ${row.value} 次，本关需 ≥${row.target}`}
// :206  显示值按门槛封顶
{row.value === null ? '证据不足' : `${Math.min(row.value, row.target)} / ${row.target}`}
```

`row.value === null` 时显示「证据不足」而**不是 `0 / 8`**——"我们还不知道"和"你一题都没答对"是两件事。

---

## 6. 关卡卡（产物卡里最常出现的一种）

参考图 `cx-1.png` 的关卡卡：白底、圆角、标题 + 一句理由 + **四组无框数字** + 「进入关卡 →」。

**现状**（`apps/web/src/agent/ArtifactCard.tsx`）：

```ts
// :100
factGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' }
// :105
fact: { display: 'flex', flexDirection: 'column', gap: '2px',
        padding: '8px 10px',
        backgroundColor: tokens.colorNeutralBackground2,   // ← 问题所在
        borderRadius: tokens.borderRadiusMedium }          // = 10px
// :113
factValue: { fontSize: tokens.fontSizeBase500 /* 20px */, fontWeight: tokens.fontWeightSemibold }
```

`tokens.colorNeutralBackground2` 在 `apps/web/src/theme/theme.ts:114` 映射到 **`palette['bg-canvas']`**（不是 `bg-surface`）。深色下四格底 `#0B0B0F`、卡片底 `#15151A` —— **四格比卡片更暗**，看起来像四个凹进去的槽。明亮下四格底 `#ECEDF0`、卡片底 `#FFFFFF`，是灰块。参考图里四组数字**没有底**。

**改成无框**：

```ts
factGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '4px 24px' }
fact:     { display: 'flex', flexDirection: 'column', gap: '2px', padding: 0 }   // 去掉 backgroundColor / borderRadius / padding
factValue:{ fontSize: '20px', lineHeight: '28px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }
```

分层靠三件事，不靠盒子：

1. **标签 12px `text-tertiary`**（`Caption1`），**值 20px `text-primary` 600**；
2. **列间距 24px**（`space-5`），行间距 4px——横向的空隙比纵向大，四组数字才会读成一行；
3. **`tabular-nums`**：`8 分钟` / `12 题` / `2 档` 这些数字在各卡之间要能对齐。

`gap: '4px 24px'` 是 `row-gap: 4px; column-gap: 24px`。窄屏（<520px）时 `auto-fit` 会折成 2×2，行间距 4 太挤 → 加 `@media (max-width: 520px) { row-gap: 12px }`。

**「进入关卡」按钮**：参考图有一个主按钮。**本仓故意没有**（票 72 改成整卡可点 + Tab + Enter/Space）。这条写进 Master §11 第 3 条"不要重开"。

---

## 7. Composer

三层结构（`apps/web/src/components/Composer.tsx`）：

```
.sm-composer              flex column; gap 6px
├── .sm-composer-box      大圆角玻璃框
│   └── .sm-composer-row  ＋ / 档位 / 模型 / 麦克风 / 圆形发送
└── .sm-composer-toolbar  工具条，**只在 :focus-within 时可见**
```

**工具条用 CSS `:focus-within` 而不是 React state**（`glass.css:706-855` 的注释）：抄进 state 就多一份真相，键盘 Tab 进来那一瞬会闪。

改三条：

1. **`margin-top: auto`** 让 Composer 贴住网格最后一行；`padding: 14px 0 18px` 不变。
2. **上方留白 ≤48px**。当前 `stageToComposer = −422`，修法是给 `stage` 加 `min-height: 0` + `padding-bottom` 预留 Composer 高度（`<Composer>` 实测 174px @1280 / 174 @2566），或者让 `stage` 行 `overflow: auto`。**两种都行，选一种，不要两种都上**——同时上会得到两倍预留。
3. **宽度 = 内容列宽**（已满足：`grid-column: 1`）。

`context` 行（「当前知识点」Badge + 「去地图选」）保留：它回答"我在学哪个点"，而地图不在这一屏。

---

## 8. 交互与可达性（本页专属）

| 项 | 要求 | 现状 |
| --- | --- | --- |
| 焦点环 | 2px `--sm-border-focus` + `offset 2px`，不覆盖 UA `outline: auto` | ✅ `color-scheme` 已落（`tokens.css:118` / `:185`） |
| Composer 焦点 | 键盘 Tab 进输入框时工具条出现，焦点不跳位 | ✅ `:focus-within`，无 JS |
| 粘底遮挡焦点 | **❌ 未满足**：§1 的 422px 遮挡同时是 `focus-not-obscured` 违规 | 见 §7 第 2 条 |
| 可点目标 | ≥24×24 CSS px | ✅ 实测四页无小于 24 的按钮；导航项 206×44 |
| 图标按钮可访问名 | 必须有 | ✅ 实测 `unnamedIconButtons = 0` |
| 空态 | 无会话时显示什么 | 右栏三门槛全是「证据不足」，正文列只有标题 + Composer |
| reduced-motion | 光团 / 页面入场全停 | ✅ `glass.css:1110` |

---

## 9. 验收（本页）

改前 / 改后各量一遍，存 `.scratch/qa/shots/t87-{before,after}-home-{1280,2566}.png`：

| 指标 | 改前 1280 | 改前 2566 | 改后目标 |
| --- | --- | --- | --- |
| 页面根宽 | 946 | 1080 | 946（受视口限） / **1120** |
| 左右留白 | 15 / 15 | 591 / 591 | 15 / 15 · **723 / 723**（2566 − 1120 ÷ 2） |
| 正文气泡宽 | 628 | 762 | ≤**760** |
| 右栏宽 | 272 | 272 | **320** |
| 内容 ↔ 右栏缝 | 18 | 18 | ≤**32** |
| 右栏嵌套带底色后代 | 4 | 4 | **0** |
| 四格底色 | `rgb(236,237,240)` / `rgb(11,11,15)` | 同 | **transparent** |
| stageToComposer | **−422** | **−120** | ≥ **0**（不遮挡） |
| Composer 上方留白 | — | — | ≤**48** |

**回归**：`.scratch/qa/scenarios/zz-layout-2560.spec.ts` 的四页 × 四档左右留白差必须仍是 `0.00`（现在断言 `≤2px`）。改 `maxWidth` 会同时移动四页的居中算式——**这是本页最容易打破的一条**。
