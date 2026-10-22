# `--sm-warning-border` 推导记录（t63）

captain 2026-10-22 裁定：**不接受「色板限制」作为结论**。
1.27:1 的边框在亮色底上等于没有边框 —— 这不是 WCAG 合规与否，是「这一块看着不像个控件」的视觉缺陷。
做法：不用 Fluent 调色板的现成值，自己定义 `--sm-warning-border`。

## 判据（比 captain 要求的多加一个底）

边框夹在**反馈条自身底色**与**页面底色**之间，所以必须同时对三者达标，取最坏的：

```
light: min( vs bg-surface #FFFFFF, vs bg-canvas #F2F4F8, vs warning-soft #FBF0DF ) >= 3
dark : min( vs bg-surface #111419, vs bg-canvas #0A0C10, vs warning-soft #2A1E0C ) >= 3
```

**为什么把 `warning-soft` 也算进去**：只验两个页面底会漏掉真正最坏的那个 ——
边框与它自己那条反馈条的填充色贴在一起，那一对才是学习者实际看到的边界。
只验 bg-surface / bg-canvas 会得到一个「对页面达标、对条内几乎看不见」的值。

## 现状：Fluent 的黄边全都不行

| 候选 | vs surface | vs canvas | vs warning-soft | worst | 判定 |
|---|---|---|---|---|---|
| `colorPaletteYellowBorder1`（`QuestionView.tsx:84` 现状用的） | 1.10 | 1.00 | 1.03 | **1.00** | FAIL |
| `colorPaletteYellowBorder2` | 1.30 | 1.18 | 1.15 | **1.15** | FAIL |
| `colorPaletteMarigoldBorder1` | 1.27 | 1.15 | 1.13 | **1.13** | FAIL |
| `colorPaletteMarigoldBorder2` | 2.16 | 1.96 | 1.91 | **1.91** | FAIL |

**连 MarigoldBorder2（调色板里最深的黄边）都只有 1.91** —— 确认「现成值里没有解」，所以必须自己定义。

## 推导规则

固定 Fluent 的 Marigold 色相 **H=42°、S=100%**，只扫明度 L，取**满足判据且最亮**的那一档
（最亮 = 视觉最轻，同时留出余量）。

### 亮主题（扫 L 0.40 → 0.28）

| L | hex | vs surface | vs canvas | vs warning-soft | worst | |
|---|---|---|---|---|---|---|
| 0.40 | `#CC8F00` | 2.80 | 2.54 | 2.49 | 2.49 | FAIL |
| 0.38 | `#C28800` | 3.08 | 2.80 | 2.73 | 2.73 | FAIL |
| 0.37 | `#BD8400` | 3.25 | 2.95 | 2.88 | 2.88 | FAIL |
| **0.36** | **`#B88100`** | 3.40 | 3.09 | 3.02 | **3.02** | 刚过线 |
| **0.33** | **`#A87600`** ← 选它 | 4.00 | 3.63 | **3.54** | **3.54** | PASS |
| 0.30 | `#996B00` | 4.71 | 4.28 | 4.18 | 4.18 | PASS（偏重） |

**选 `#A87600`**：3.02 是擦线过，一次 token 微调就会掉下去；3.54 有余量且视觉上仍是一条细边，不至于变成「错误红框」那种重量。

### 深色主题（扫 L 0.40 → 0.62）

| L | hex | vs surface | vs canvas | vs warning-soft | worst | |
|---|---|---|---|---|---|---|
| 0.40 | `#CC8F00` | 6.59 | 6.99 | 5.81 | 5.81 | PASS |
| **0.44** | **`#E09D00`** ← 选它 | 7.90 | 8.38 | **6.97** | **6.97** | PASS |
| 0.48 | `#F5AB00` | 9.41 | 9.98 | 8.30 | 8.30 | PASS（偏亮） |

深色底上要**提亮**才达标（与亮主题方向相反），这符合预期。

## 结论

| 语义键 | 亮主题 | 深主题 | worst（对三个底取最小） |
|---|---|---|---|
| `--sm-warning-border` | `#A87600` | `#E09D00` | 3.54 / 6.97 |

**键名两套主题一致**（都叫 `--sm-warning-border`），值分别定义 —— 与 t58 的双主题要求同一条。

## 两条硬约束（写进 t63 验收）

1. `--sm-warning-border` 两主题都 ≥3:1，**且不许用 `YellowBorder2` / `MarigoldBorder1` 的原始值**（1.15 / 1.13）。
2. `warning-soft` 是**绑定的那一环**（3.54 就是对着它算出来的）。**若 `warning-soft` 的任一主题值被改动，必须重跑本脚本重新推导**，不能沿用旧值。

## 复算

```bash
node .scratch/pw-t63-probes/derive-warning-border.mjs
```

脚本是只读的，不改任何文件。

## 与绿边的对称性

对条边用 `--sm-option-correct`（= `success`）：

| | vs surface | vs canvas | vs success-soft | worst |
|---|---|---|---|---|
| light `#0E7A4A` | 5.38 | 4.89 | 4.78 | 4.78 |
| dark `#3FBF7F` | 7.88 | 8.57 | 6.95 | 6.95 |

绿边两主题都过，且余量比黄边大 —— 因为深绿在亮底上本来就压得住。
这也解释了为什么「两主题坏的方向相反」：**绿在亮主题天然吃亏小，黄在亮主题天然吃亏大**，
所以只在一套主题下调好，另一套仍是坏的。
