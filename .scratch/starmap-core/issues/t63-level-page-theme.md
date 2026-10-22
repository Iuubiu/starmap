# t63: 关卡页深色 / 明亮双主题适配

**What to build:** 让关卡页（`apps/web/src/level/**` 与 `LevelPage.tsx`）在深色与明亮两套主题下都成立：七段导航、题目卡、选项三态、逐题与段末反馈、本关证据卡、掌握度双字段、出口门控、公式都清晰可读；「对/错」两态不能只靠色相区分。

**Blocked by:** t58（`apps/web/src/theme/` 由 ui-lead 落地）

**Status:** ready-for-agent（等 t58 completed）

---

## 契约

- **kind**: implementation
- **inScope**:
  - `apps/web/src/level/`
  - `apps/web/src/pages/LevelPage.tsx`
  - `.scratch/qa/scenarios/zz-level-theme.spec.ts`
  - `skills/web-design-engineer/references/contrast-check.mjs`（captain 2026-10-22 授权）
- **verify**:
  1. `pnpm --filter @starmap/web typecheck`
  2. `pnpm --filter @starmap/web test`
  3. `cd apps/web && npx playwright test e2e/smoke.spec.ts`
  4. `cd apps/web && npx playwright test --config=../../.scratch/qa/playwright.config.ts zz-level-theme --output=../../.scratch/pw-leveltheme`

## 验收

- [ ] `apps/web/src/level/**` 与 `LevelPage.tsx` 里不再出现字面 hex：`grep -rn "#[0-9a-fA-F]\{6\}" apps/web/src/level apps/web/src/pages/LevelPage.tsx` 为空（注释除外，需逐条列出）
- [ ] 七段导航条、题目卡、选项按钮、作答后反馈条（对/错两态）在两套主题下都满足：正文对比度 ≥ 4.5:1、对错两态各自与底色的对比度 ≥ 3:1，且「对」与「错」**不能只靠色相区分**（同时有图标或描边差异），逐元素输出最小比值
- [ ] 本关证据卡（作答/答对/已入档/计入掌握度四个数）与掌握度双字段（历史最高 / 当前熟练度 / 状态徽章）在两套主题下层级清楚：三个层级（标题/数值/说明）各给一个对比度数值
- [ ] 出口门控面板（含「不设门控」徽章、达标线 x/y、还差 N 题）在两套主题下都可读
- [ ] `QuestionView` 的选项在 `:focus-visible` 下两套主题都有清晰焦点环，键盘 Tab 走完四个选项能看出焦点在哪（探针给出焦点环颜色与对比度）
- [ ] **「答错」反馈条的边框在两套主题下都 ≥3:1，且不许用 `colorPaletteYellowBorder2` / `colorPaletteMarigoldBorder1` 的原始值**（实测 1.15 / 1.13，等于没有边框）。必须自定义 `--sm-warning-border`，键名两套主题一致、值分别定义；判据是对 `bg-surface`、`bg-canvas`、`warning-soft` **三个底分别** ≥3:1 取最小者。交付时给出推导过程与复算命令
- [ ] 题干与讲解里的公式（KaTeX）在两套主题下颜色都从 token 取，且与正文一致；不允许出现亮主题下公式仍是浅灰看不清
- [ ] 亮主题下关卡页不得出现深色残留块（如反馈条、代码块、徽章）—— 探针逐元素取 `backgroundColor` 的明度，断言没有「亮页面里嵌入的暗块」超过 2 处且每处都在报告里说明理由
- [ ] `pnpm --filter @starmap/web test` 全绿、`pnpm --filter @starmap/web typecheck` 6/6
- [ ] `cd apps/web && npx playwright test e2e/smoke.spec.ts` 全绿
- [ ] 截图存证 `.scratch/qa/shots/leveltheme-<dark|light>-<question|feedback-right|feedback-wrong|summary>.png` 八张

---

## Comments

### 一、口径裁定：`option-idle-border` 与 `border-control` 保持同值

**captain 2026-10-22 裁定（本票唯一持久记录）。**

`--sm-option-idle-border` 与 `--sm-border-control` 保持同一组值（深 `#6B7787` / 亮 `#7C8695`）。理由：选项未选中态的边框是**可点击区域的第一眼证据**。WCAG 1.4.11 要求「用户界面组件」边界 3:1，未选中的单选项正好属于这类 —— 它不是装饰，它是「这里能点」的承诺。为了视觉层次把它调淡，等于用可访问性换装饰性，方向是反的。

**如果将来确实要让两者有区别（例如未选边略淡以突出已选），必须同时满足三条，缺一不可：**

1. 仍然 ≥3:1，且要对 `bg-surface` 与 `bg-canvas` **两个底分别**成立，取更小的那个；
2. `apps/web/src/theme/tokens.ts` + `apps/web/src/theme/tokens.css` + `skills/web-design-engineer/SKILL.md` §1.5 + `skills/web-design-engineer/references/contrast-check.mjs` **四处同时改**；
3. **先经 captain 确认**再动 —— 这是跨泳道的共享值。

**没有这个前提就不许改。**

表达层次不要用「略淡」，用**形状**（未选实心圆 vs 已选实心圆 + 内点）或**位置**；边框亮度是最后才该动的东西。

### 二、`contrast-check.mjs` 的两个断言盲区已补（本票的前置工作，已完成）

captain 指示「现在就补，不要等 t63 claim」。补的是探针本身，不是关卡页样式。

**改前是假绿**：`rules: 46, all pass: true` / `TOTAL FAILURES: 0`，但 `text-disabled` 只断言了对 `bg-surface`/`bg-hover`/`bg-selected`（漏 `bg-canvas`），`option-idle-border` 一条断言都没有。

**只补断言、不动值 → 立刻红了 4 条**：

```
FAIL 选项未选边 option-idle-border / bg-surface   1.66  (>= 3)
FAIL 选项未选边 option-idle-border / bg-canvas    1.76  (>= 3)
FAIL 选项未选边 option-idle-border / bg-surface   1.55  (>= 3)
FAIL 选项未选边 option-idle-border / bg-canvas    1.41  (>= 3)
rules: 49, all pass: false    TOTAL FAILURES: 4    exit=1
```

`text-disabled / bg-canvas` 那条**没红**（3.23 深 / 3.45 亮，本来就达标）—— 它只是漏了断言，值本身没问题。

**根因不是值不对，是规范侧抄旧了**：

```
DIFF option-idle-border  规范 #333C49/#C9D0DB  vs  实现 #6B7787/#7C8695
```

`apps/web/src/theme/tokens.ts:127,183` 与 `tokens.css:152,209` 早就是 `border-control` 那组值（3.68–4.30:1），只有 `contrast-check.mjs` 与 `SKILL.md §1.5` 还停在旧稿（1.41–1.76:1）。**以真源为准改规范侧** —— 反过来做会等于把已经合格的边界改成 1.4:1，而且探针会变绿，是一次静默的倒退。

**改完**：`rules: 49, all pass: true` / `TOTAL FAILURES: 0` / exit=0。
**反向验证**：把两处值临时改回旧稿 → `TOTAL FAILURES: 4`、exit=1；还原 → exit=0。双向成立。
**一致性**：`SKILL.md 表格 vs tokens.ts` → 30 键 0 差异；`probe palette vs tokens.ts` → 33 键 0 差异。

连带改动：`contrast-check.mjs`（断言 46→49、补 3 条、值改、`worstByRole` 加一行、文件头补「假绿教训」）、`SKILL.md` §1.5（值）、`SKILL.md` §1.6 + 命令清单（「46 条 × 2 = 92 条」→「49 条 × 2 = 98 条」，最差值表加一行）。

证据：`.scratch/qa/t63-baseline/probe-evidence.md`，配套 `probe-before.txt` / `probe-after-assertions.txt` / `probe-final.txt`。

### 三、探针出证据的通用格式（captain 升级为全队规则）

一个「全通过」的探针必须同时报出**三个数**：

```
断言条数 / 最差值 / 判定
```

只有 `0 failures` 一个数字时，无法区分「真的没问题」和「压根没测」。本次做对的形状：`rules: 46 → 49`（条数变了）+ `worstByRole` 加了行（最差值可见）+ 反向验证双向成立（改坏会红）。三件凑齐才算有证据。

### 四、勘察结论（t58 落地前完成的只读准备）

- **颜色来源盘点**：`apps/web/src/level/**` + `LevelPage.tsx` 共 **53 处** —— 字面 hex **1 处**（`VideoPanel.tsx:102` 的 `'#000'`）、Fluent token **52 处**、语义别名 0 处。0 处 `rgb()/hsl()` 字面量、0 处命名色。
- **「对/错只靠色相」唯一一处**：`QuestionView.tsx:77-90`。答对底 `#f1faf1` vs 答错底 `#fffef5` = **1.05:1**；答对边 `#9fd89f` vs 答错边 `#fef7b2` = **1.50:1**。目前唯一可辨的是标题文字里的 `✓`/`△`，而那两个符号在 `aria-hidden` 里，读屏用户完全拿不到。→ 定为「色弱与读屏用户无法区分对错」，不是配色偏好。
- **黄边：不是色板限制，是必须自定义 token**（captain 2026-10-22 裁定否掉了「色板限制」这个结论）。Fluent 调色板里最深的黄边 `MarigoldBorder2` 也只有 1.91:1 —— 但「调色板里没有解」不等于「没有解」。1.27:1 的边框在亮色底上等于没有边框，这是「这一块看着不像个控件」的**视觉缺陷**，不是 WCAG 合规与否的问题。做法见 §六。
- **焦点环**：关卡页 radio 的焦点环是浏览器 UA 的 `outline: auto`，不是 Fluent 自绘。`tokens.css:110` 已设 `color-scheme: dark`，深色下 UA 环自动翻白（实测 `rgb(238,238,238) auto 1px`）。**这是前提条件，若 t58 返工把它删了，焦点环会在深底上消失。**
- **深色残留块基线**：走完整旅程只数到 **1 处**（Fluent primary Button，亮主题下本来就该是深蓝实心），远低于 2 处上限。`VideoPanel.tsx:102` 的 `#000` 在该旅程未渲染（该知识点无视频片段）。
- **两主题「坏的方向相反」**（这是双主题改造最容易漏的点）：绿边 亮 1.64 / 深 2.71（**两个都不达标**）；黄边 亮 1.10 / 深 11.20（**亮主题极差、深主题反而很好**）。所以只在一套主题下调好，另一套可能仍是坏的。
- 完整数字见 `.scratch/qa/t63-baseline/theme-migration-table.md`（改造清单，文件 × 位置 × 目标 token）与 `baseline.json` / `baseline-dark.json` / `sm-contrast.txt` / `target-contrast.txt`。

### 五、实施时的一条纪律

`contrast-check.mjs` 读的是 `theme/tokens.ts` 与 `tokens.css`，而这两份文件**正在 t58 里被重写**。t58 落地后重跑探针，红了先判「谁的值对」，判完把结论报给 captain；**不要趁 t58 在飞的时候去改 token 值**，那会互相覆盖。

### 六、`--sm-warning-border` 推导（captain 裁定后已算好，t58 落地即可写入）

**captain 裁定**：不接受「色板限制」作为结论。补偿（图标 + 文案）是对的，但 1.27:1 的边框在亮色底上等于没有边框。**不用 Fluent 现成值，自己定义 `--sm-warning-border`。**

#### 判据（比 captain 要求的多加一个底）

边框夹在**反馈条自身底色**与**页面底色**之间，所以必须同时对三者达标，取最坏的：

```
light: min( vs bg-surface #FFFFFF, vs bg-canvas #F2F4F8, vs warning-soft #FBF0DF ) >= 3
dark : min( vs bg-surface #111419, vs bg-canvas #0A0C10, vs warning-soft #2A1E0C ) >= 3
```

**为什么把 `warning-soft` 也算进去**：只验两个页面底会漏掉真正最坏的那个 —— 边框与它自己那条反馈条的填充色贴在一起，那一对才是学习者实际看到的边界。只验 `bg-surface`/`bg-canvas` 会得到一个「对页面达标、对条内几乎看不见」的值。

#### 现状：Fluent 的黄边全都不行

| 候选 | vs surface | vs canvas | vs warning-soft | worst | 判定 |
|---|---|---|---|---|---|
| `colorPaletteYellowBorder1`（`QuestionView.tsx:84` 现状用的） | 1.10 | 1.00 | 1.03 | **1.00** | FAIL |
| `colorPaletteYellowBorder2` | 1.30 | 1.18 | 1.15 | **1.15** | FAIL |
| `colorPaletteMarigoldBorder1` | 1.27 | 1.15 | 1.13 | **1.13** | FAIL |
| `colorPaletteMarigoldBorder2`（调色板里最深的黄边） | 2.16 | 1.96 | 1.91 | **1.91** | FAIL |

连最深的都只有 1.91 —— 确认「现成值里没有解」，所以必须自定义。

#### 推导规则

固定 Fluent 的 Marigold 色相 **H=42°、S=100%**，只扫明度 L，取**满足判据且最亮**的那一档（最亮 = 视觉最轻，同时留余量）。

亮主题（扫 L 0.40 → 0.28）：

| L | hex | vs surface | vs canvas | vs warning-soft | worst | |
|---|---|---|---|---|---|---|
| 0.40 | `#CC8F00` | 2.80 | 2.54 | 2.49 | 2.49 | FAIL |
| 0.38 | `#C28800` | 3.08 | 2.80 | 2.73 | 2.73 | FAIL |
| 0.37 | `#BD8400` | 3.25 | 2.95 | 2.88 | 2.88 | FAIL |
| 0.36 | `#B88100` | 3.40 | 3.09 | 3.02 | 3.02 | 刚过线 |
| **0.33** | **`#A87600`** ← 选它 | 4.00 | 3.63 | **3.54** | **3.54** | PASS |
| 0.30 | `#996B00` | 4.71 | 4.28 | 4.18 | 4.18 | PASS（偏重） |

**选 `#A87600`**：3.02 是擦线过，一次 token 微调就会掉下去；3.54 有余量且视觉上仍是一条细边，不至于变成「错误红框」那种重量。

深色主题（扫 L 0.40 → 0.62）：

| L | hex | vs surface | vs canvas | vs warning-soft | worst | |
|---|---|---|---|---|---|---|
| 0.40 | `#CC8F00` | 6.59 | 6.99 | 5.81 | 5.81 | PASS |
| **0.44** | **`#E09D00`** ← 选它 | 7.90 | 8.38 | **6.97** | **6.97** | PASS |
| 0.48 | `#F5AB00` | 9.41 | 9.98 | 8.30 | 8.30 | PASS（偏亮） |

深色底上要**提亮**才达标（与亮主题方向相反），符合预期。

#### 结论

| 语义键 | 亮主题 | 深主题 | worst（对三个底取最小） |
|---|---|---|---|
| `--sm-warning-border` | `#A87600` | `#E09D00` | **3.54 / 6.97** |

**键名两套主题一致**（都叫 `--sm-warning-border`），值分别定义 —— 与 t58 的双主题要求同一条。

#### 两条硬约束

1. 不许用 `YellowBorder2` / `MarigoldBorder1` 的原始值（1.15 / 1.13）。
2. **`warning-soft` 是绑定的那一环**（3.54 就是对着它算出来的）。若 `warning-soft` 的任一主题值被改动，必须重跑脚本重新推导，不能沿用旧值。

#### 与绿边的对称性

对条边用 `--sm-option-correct`（= `success`），对 `success-soft` 分别是 4.78（亮）/ 6.95（深），两主题都过。这也解释了「两主题坏的方向相反」的成因：**绿在亮主题天然吃亏小，黄在亮主题天然吃亏大**，所以只在一套主题下调好，另一套仍是坏的。

#### 复算

```bash
node .scratch/pw-t63-probes/derive-warning-border.mjs
```

脚本只读，不改任何文件。推导全过程与候选表见 `.scratch/qa/t63-baseline/warning-border-derivation.md`。

### 七、验收第 6 条的落地记录（`--sm-warning-border` 已写入，且 §六 的推导输入已过期）

#### 7.1 §六 的推导输入已经不是今天的 token 值 —— 结论要按现值复算

§六 是在 t58 落地**之前**算的，当时读到的 `warning-soft` 是 `#FBF0DF`（亮）/ `#2A1E0C`（深），
`warning` 是旧的黄。t58 落地后 `apps/web/src/theme/tokens.ts` 的实际值是：

| 键 | 亮 | 深 |
|---|---|---|
| `warning` | `#8A5200` | `#F5A524` |
| `warning-soft` | `#FBF0DF` | `#2A1E0C` |

用**现值**按 §六 同一判据（对 `bg-surface` / `bg-canvas` / `warning-soft` 三个底取最小）复算：

| 候选 | 亮 worst | 深 worst | 判定 |
|---|---|---|---|
| `warning` 现值（`#8A5200` / `#F5A524`） | **5.46** | **7.98** | PASS |
| §六 推导的 `#A87600` / `#E09D00` | 3.54 | 6.97 | PASS（但比现值紧） |

**结论比 §六 更宽松**：现值本身就过 3:1，不需要另造一组更暗/更亮的色。

#### 7.2 仍然单列一个键的理由（不是复述「值不同」，而是「判据不同」）

`warning` 承担的是警示**文字/图标**，受 WCAG 1.4.3 管，门槛 **4.5:1**；
`warning-border` 承担的是警示**区域边界**，受 WCAG 1.4.11 管，门槛 **3:1**。

两者今天恰好同值，但这是巧合不是约束：将来调警示文字的可读性时，不该被迫连边框一起动；
调边框可见度时，也不该连带把警示文字变淡。**合并成一个键（`warning-border: warning` 式别名）
会让这两种调整重新耦合**，而这正是票面要求「键名两套主题一致、值分别定义」的用意。

#### 7.3 落盘位置（4 处，纯增）

| 文件 | 改动 |
|---|---|
| `apps/web/src/theme/tokens.ts` | `COLOR_KEYS` 增 `'warning-border'`（带 9 行语义说明）；`darkPalette` 增 `'warning-border': '#F5A524'`；`lightPalette` 增 `'warning-border': '#8A5200'` |
| `apps/web/src/theme/tokens.css` | `:root[data-sm-theme='dark']` 增 `--sm-warning-border: #f5a524;`；`[data-sm-theme='light']` 增 `--sm-warning-border: #8a5200;`（各带一行注释） |
| `apps/web/src/level/QuestionView.tsx` | `wrongBar` 的 `border` / `borderLeft` 从 `tokens.colorPaletteDarkOrangeBorder1` 改成 `var(--sm-warning-border)`，注释重写为三条理由（判据不同 / Fluent 没有这个键 / 本仓已有 30 处直取 `var(--sm-*)` 的先例） |
| `skills/web-design-engineer/references/contrast-check.mjs` | `componentRules()` 增 3 条 `warning-border` 断言（对 surface / canvas / warning-soft，均 ≥3，`WCAG 1.4.11`）；`worstByRole()` 增 `'警示边框 warning-border'` 一行 |

**为什么 `QuestionView` 直写 `var()` 而不是走 Fluent token**：`theme.ts` 把
`colorPaletteDarkOrangeBorder1` 映射到 `palette['warning']`，拿不到 `warning-border`；
而给 `palette['warning']` 改名会波及所有拿它当文字色的地方（警示文字、图谱「需复验」节点等），
改动面远大于收益。`HomePage.tsx` / `LearningPage.tsx` 里已有 30 处 `var(--sm-*)` 直取，
语义 token 本来就是这个层的公开接口。

#### 7.4 实测（`node skills/web-design-engineer/references/contrast-check.mjs`）

```
DARK   警示边框 warning-border / bg-surface        8.92  (>= 3)
DARK   警示边框 warning-border / bg-canvas         9.63  (>= 3)
DARK   警示边框 warning-border / warning-soft      7.98  (>= 3)   ← 最坏
LIGHT  警示边框 warning-border / bg-surface        6.39  (>= 3)
LIGHT  警示边框 warning-border / bg-canvas         5.46  (>= 3)   ← 最坏
LIGHT  警示边框 warning-border / warning-soft      5.67  (>= 3)
worst-per-role: "警示边框 warning-border": 7.98 / 5.46
```

`rules: 53`（原 50 + 新增 3）。镜像守门 `apps/web/src/theme/tokens.test.ts` → **21 passed**
（它逐条断言 `tokens.css` 里每个 `--sm-*` 与 `tokens.ts` 逐字相等、且两套主题键集相同，
所以新键在两侧都到位才可能绿）。

#### 7.5 仍然红的那一条（**不在本票范围，需 captain 裁定**）

```
FAIL 三级 text-tertiary / bg-selected   4.45  (>= 4.5)  WCAG 1.4.3
```

深主题 `text-tertiary #8F8F9B` / `bg-selected #2A2A33` = **4.447**，差 0.053。
`bg-selected` 的实际消费点是**知识地图页**（t62 域）的选中行，不是关卡页；
`tokens.ts` 属 t58 域。**这两处都不在 t63 inScope，所以不放宽断言、不改 token 值**，
作为 finding 上报，由 captain 决定是调 `text-tertiary`、调 `bg-selected`，还是接受并在票面写明。
