---
name: web-design-engineer
description: 改动 StarMap 任何界面（页面、组件、样式、动效、主题）之前先读这份。它把「Raycast 风格深色设计语言」定成可直接抄的 token 表、Fluent v9 组件映射、动效规范与交付前自检清单，并写死本仓的既有约束（只换视觉不换组件库、导航仍是 role=tab、双主题、AA 对比度、零新依赖）。
version: 1.0.0
triggers:
  - 要新增、重画或改样式任何一个页面 / 组件
  - 要调整主题、配色、间距、圆角、字号、阴影
  - 要给界面加动效或页面转场
  - 评审一次前端改动是否合乎本仓设计语言
  - 需要在深色 / 明亮两套主题下各验一次对比度
metadata:
  owner: ui-dev
  ticket: '57'
---

# 界面实现规范：Raycast 风格深色设计语言

## 这份 skill 是给谁看的

**本 skill 只指导开发者与智能体的界面实现，不属于学生可见的技能库。**

它放在仓库根的 `skills/`，**不**放在 `apps/api/src/mastra/skills/`。后者是学生可见的技能库：
`/skills` 页面通过 `GET /api/v1/agent/skills` 列出它，学生看到的是 `question-author` /
`socratic-tutor` 这两条「教什么」的技能。设计规范混进去，学习者会多看到一条对自己毫无意义、
也无法开关出任何效果的条目，而「技能库」这个词对他就此失准。

机制上这件事有硬保证，不靠自觉：`apps/api/src/skills/skill-scanner.ts` 的
`defaultSkillsDir()`（第 72–92 行，注释见 60–71）只解析 `STARMAP_SKILLS_DIR` → 包根下
`src/mastra/skills` / `mastra/skills`（从模块目录向上最多 4 层找 `package.json`），
**从不扫描仓库根的 `skills/`**。所以本目录对运行时是隐形的。

验收时跑一遍，两条即可：

```bash
curl -s http://127.0.0.1:3001/api/v1/agent/skills | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.items.length, j.items.map(x=>x.name))})"
# 期望：2 [ 'question-author', 'socratic-tutor' ]

ls apps/api/src/mastra/skills/          # 期望只有 question-author、socratic-tutor 两个目录
```

> 注意路径：技能列表的**真实路由是 `GET /api/v1/agent/skills`**（见
> `apps/api/src/skills/skills.controller.ts:28,33`）。`/api/v1/skills` 会 404 —— 别拿 404
> 当成「条目数没变」的证据。

本 skill 自带两个零依赖探针，都能在仓库根直接跑：

```bash
node skills/web-design-engineer/references/contrast-check.mjs   # 98 条对比度断言（49 条 × 2 主题）
node skills/web-design-engineer/references/inventory-check.mjs  # §7 文件清单是否与磁盘一致
```

## 本仓既有约束（先读这一节，别重新踩）

| # | 约束 | 依据 / 后果 |
| --- | --- | --- |
| 1 | 栈是 React 19 + TypeScript + Vite + React Router + TanStack Query + **Fluent UI v9（`@fluentui/react-components` 9.74.9）** + Griffel `makeStyles` | 换栈不在本次范围 |
| 2 | **只换视觉，不换组件库** | 实测 **27** 个非测试文件用 `makeStyles`、**370** 处引用 `tokens.*`。全量替换组件库会让 **468** 条单测与 **7** 个 e2e 文件（**54** 个 `test`/`it` 块）的定位器同时失效；而这次要解决的是「长得像 Windows 设置面板」，不是「组件不好用」 |
| 3 | 保留 Fluent 的行为：无障碍语义、焦点陷阱、键盘导航、`aria-*` | 这些是**资产**。样式层可重写，行为层不许重写 |
| 4 | 导航仍是 `role=tab` | `apps/web/e2e/graph.spec.ts:682`、`apps/web/e2e/smoke.spec.ts:207` 按 `getByRole('tab', …)` 找入口；`tools/eval/src/layer2/driver.ts:310-311` 与 `resolve.ts:43` 也按 `role === 'tab'` 驱动阶段。改成 `role=link` 会一次性打断评估链路 |
| 5 | 深色基调下必须满足 **WCAG AA** | 正文 ≥ 4.5:1，控件边界与图形 ≥ 3:1。禁用态本仓加严到 3:1（WCAG 对它豁免，我们不豁免） |
| 6 | `prefers-reduced-motion: reduce` 时所有动效退化为瞬时 | 不是「慢一点」，是**零位移零时长** |
| 7 | 界面文案中文；代码标识符 / 文件名 / 提交信息英文 | 见 spec §10（D10） |
| 8 | **不许新增依赖** | 要动效库先来问。多半用 View Transitions API + CSS 就够 —— React 19.3.1 已内置 `<ViewTransition>` 与 `addTransitionType`，`@types/react@19.3.0` 已带类型 |
| 9 | 双主题（深色默认 + 明亮） | 两套 palette **语义键完全一致**，只换值。组件里禁止 `dark ? A : B` 分支 |
| 10 | 语义键优先 | 页面只许引用语义 token（`--sm-bg-surface`），不许直接写 hex、不许引用 Fluent 的 `colorNeutralBackground2` 这类物理键 |

## 一、设计 token 表

唯一真源是本文档的表格；`skills/web-design-engineer/references/contrast-check.mjs` 把同一组 hex
抄成数据并逐条断言 WCAG，任何一条不达标就以非零码退出。**实现侧必须抄同一组值**：

```bash
node skills/web-design-engineer/references/contrast-check.mjs
# 期望最后一行：TOTAL FAILURES: 0
```

### 1.1 颜色 —— 层级表面（深色基调的「层级」靠亮度递进，不靠阴影）

深色主题里阴影几乎看不见，所以**层级 = 表面色的亮度台阶 + 1px hairline**。
深色是默认主题。

| Token | 深色（默认） | 明亮 | 用在哪 |
| --- | --- | --- | --- |
| `--sm-bg-canvas` | `#0A0C10` | `#F2F4F8` | 应用最底层（页面背景、图谱画布底） |
| `--sm-bg-surface` | `#111419` | `#FFFFFF` | 卡片、面板、侧栏、表格容器 |
| `--sm-bg-elevated` | `#171B22` | `#FFFFFF` | 浮起来的东西：菜单、popover、tooltip、对话框 |
| `--sm-bg-hover` | `#1F242C` | `#F0F2F6` | 行 / 选项 / 图标的 hover 底色 |
| `--sm-bg-selected` | `#272E3A` | `#EDE9FC` | 选中态（列表行、tab、当前关卡） |
| `--sm-bg-input` | `#0D1015` | `#FFFFFF` | 输入框内部（比所在表面**更深**，制造凹槽感） |
| `--sm-bg-scrim` | `rgba(5,7,10,0.72)` | `rgba(18,22,28,0.32)` | 对话框 / 抽屉背后的遮罩 |

实测层级比（装饰性，不参与 AA 判定）：深色 `elevated/surface` 1.07、`hover/surface` 1.18、
`selected/surface` 1.35、`hairline/surface` 1.30。**台阶很窄是故意的** —— 层级靠 hairline 补齐，
一旦把 hover 做成 1.6 倍，界面就开始像 Material 而不是 Raycast。

### 1.2 颜色 —— 唯一强调色

**全站只有一个强调色系（紫罗兰 / 靛）**。不允许第二支彩色当强调色：需要「另一种颜色」时，
用语义色，或者用同一支强调色的不同不透明度。

| Token | 深色（默认） | 明亮 | 用在哪 |
| --- | --- | --- | --- |
| `--sm-accent` | `#A79BFF` | `#6A55D8` | **文字 / 图标**形态的强调（链接、当前 tab 文字、焦点环） |
| `--sm-accent-fill` | `#6E5AF0` | `#6A55D8` | **填充**形态：主按钮底色、选中指示条 |
| `--sm-accent-hover` | `#6350E0` | `#5B47C8` | 主按钮 hover |
| `--sm-accent-pressed` | `#4E3CB5` | `#4E3CB5` | 主按钮 pressed |
| `--sm-accent-soft` | `#1C1930` | `#EFECFD` | 强调色的极淡底（选中行、选项选中底） |
| `--sm-on-accent` | `#FFFFFF` | `#FFFFFF` | 压在 `accent-fill` 上的字 |

> 深色里 `accent`（`#A79BFF`，亮）与 `accent-fill`（`#6E5AF0`，暗）是**两个值**：文字要够亮才够
> 对比度，填充要够暗才压得住白字。别把它们合并成一个。

### 1.3 颜色 —— 语义色

每个语义色有「文字版」与「极淡底版」两个形态；`MessageBar`、`Badge`、关卡反馈都只用这两者。

| Token | 深色（默认） | 明亮 | 语义 |
| --- | --- | --- | --- |
| `--sm-success` / `--sm-success-soft` | `#3FBF7F` / `#10241B` | `#0E7A4A` / `#E6F5EE` | 通过、答对、已掌握、成功提示 |
| `--sm-warning` / `--sm-warning-soft` | `#E8A33D` / `#2A1E0C` | `#8A5200` / `#FBF0DF` | 未通过、需复验、警告提示 |
| `--sm-danger` / `--sm-danger-soft` | `#FF7A7A` / `#2C1414` | `#C62828` / `#FBEAEA` | 答错、错误、破坏性操作 |
| `--sm-info` / `--sm-info-soft` | `#5AA0FF` / `#101C2E` | `#1A5FD0` / `#E8F0FC` | 中性提示、在学状态 |

> **警告色 ≠ 错误色。** 关卡「未通过」用 `warning`（`#E8A33D`）而不是 `danger`：没通过是学习
> 过程的一部分，不是错误。`GatePanel.tsx:174-175` 已经把 `passed → success`、`failed → warning`
> 定死了，样式层不许改回红色。

### 1.4 颜色 —— 文字与边框

| Token | 深色（默认） | 明亮 | 用在哪 |
| --- | --- | --- | --- |
| `--sm-text-primary` | `#E9EEF5` | `#12161C` | 正文、标题 |
| `--sm-text-secondary` | `#A3AEBE` | `#4B5563` | 次要说明、表头、时间戳 |
| `--sm-text-tertiary` | `#8B98AA` | `#5F6773` | 三级信息、占位符、脚注 |
| `--sm-text-disabled` | `#727C8A` | `#767E8A` | 禁用态（本仓加严到 3:1） |
| `--sm-border-hairline` | `#242B36` | `#E3E7EE` | **唯一的边框色**：卡片边、分隔线、表格线 |
| `--sm-border-control` | `#6B7787` | `#7C8695` | 输入框 / 复选框等**控件的边界**（≥3:1，hairline 太淡不能当控件边界） |
| `--sm-border-focus` | `#A79BFF` | `#6A55D8` | 焦点环（≥3:1） |

### 1.5 颜色 —— 图谱画布与关卡选项（专有语义键）

| Token | 深色（默认） | 明亮 | 说明 |
| --- | --- | --- | --- |
| `--sm-graph-canvas` | `#0A0C10` | `#F2F4F8` | 画布底 |
| `--sm-graph-node-unseen` | `#5A6A80` | `#6B7787` | 未学 |
| `--sm-graph-node-learning` | `#4C8DFF` | `#1A5FD0` | 在学 |
| `--sm-graph-node-mastered` | `#3FBF7F` | `#0E7A4A` | 已掌握 |
| `--sm-graph-node-review` | `#E8A33D` | `#8A5200` | 需复验 |
| `--sm-option-idle-border` | `#6B7787` | `#7C8695` | 选项未选边界（≥3:1；值同 `border-control`，旧稿的 `#333C49`/`#C9D0DB` 只有 1.4–1.8:1，已废） |
| `--sm-option-hover-bg` | `#1F242C` | `#F0F2F6` | 选项 hover 底 |
| `--sm-option-selected-bg` | `#1C1930` | `#EFECFD` | 选项选中底 |
| `--sm-option-selected-border` | `#A79BFF` | `#6A55D8` | 选项选中边界 |
| `--sm-option-correct` | `#3FBF7F` | `#0E7A4A` | 答对（≥4.5:1，是文字不是纯图形） |
| `--sm-option-wrong` | `#FF7A7A` | `#C62828` | 答错（同上） |

### 1.6 实测对比度（评审看这一组就够）

`contrast-check.mjs` 跑 **49 条规则 × 2 套主题 = 98 条断言，全部通过**。按角色取最差值：

| 角色 | 深色最差 | 明亮最差 | 门槛 |
| --- | --- | --- | --- |
| 正文 `text-primary` | 11.71 | 15.26 | 4.5 |
| 次要 `text-secondary` | 6.08 | 6.36 | 4.5 |
| 三级 `text-tertiary` | 4.66 | 4.81 | 4.5 |
| 禁用 `text-disabled` | 3.23 | 3.45 | 3.0（本仓加严） |
| 强调 `accent`（文字 / 图标） | 6.52 | 4.63 | 4.5 |
| 按钮字 `on-accent` | 4.79 | 5.38 | 4.5 |
| 控件边界 `border-control` | 4.05 | 3.35 | 3.0 |
| 选项未选边 `option-idle-border` | 4.05 | 3.35 | 3.0 |
| 图谱节点四态 | 3.55 | 4.13 | 3.0 |
| 关卡选项 对 / 错 | 7.31 | 5.38 | 4.5 |

### 1.7 间距：8px 栅格 + 三条例外

`--sm-space-*` 只有 9 档。**布局间距只能从这 9 档里取**：

| Token | 值 | 典型用途 |
| --- | --- | --- |
| `--sm-space-0` | `0` | 归零 |
| `--sm-space-1` | `4px` | 图标与文字之间、徽章内上下 |
| `--sm-space-2` | `8px` | 默认 gap、行内元素间距 |
| `--sm-space-3` | `12px` | 紧凑列表行内边距、按钮组间距 |
| `--sm-space-4` | `16px` | 卡片内边距、栅格 gutter |
| `--sm-space-5` | `24px` | 卡片与卡片之间、区块内分隔 |
| `--sm-space-6` | `32px` | 页面左右留白（窄屏） |
| `--sm-space-7` | `48px` | 页面上下大留白、空状态 |
| `--sm-space-8` | `64px` | 空状态插画区、全屏提示的上下留白 |

**三条例外，写死，不许扩散。** 每条例外都绑死一个范围，出了范围立刻回到栅格：

1. **`2px`** —— 只用于**光学对齐**：图标与文字基线的微调、焦点环 `outline-offset: 2px`。
   永远不作为两个块之间的间距。
2. **`6px`** —— 只用于 **20px 高的 chip / badge 内部**（`6 + 8 + 6 = 20`）。
3. **`6px`** —— 只用于**表单标签与控件之间**（`Field` 的 `label` → 控件）。这是刻意的紧：
   标签与控件在视觉上属于同一个单元，用 8px 会让它们看起来像两个不相关的块。

例外之外一律回到 9 档栅格；出现第四种「小数字」就说明栅格不够用，要改的是栅格而不是再加例外。

现状里的 `10 / 14 / 18 / 20 / 22 / 28px` 全部属于历史遗留，迁移方向：

| 现值 | 改成 | 理由 |
| --- | --- | --- |
| `10px` | `8px` 或 `12px` | 贴最近的栅格档 |
| `14px` | `12px` 或 `16px` | 同上 |
| `18px` | `16px` | 同上 |
| `20px` | `16px` 或 `24px` | 卡片内边距统一走 16 |
| `22px` | `24px` | 同上 |
| `28px` | `24px` 或 `32px` | 同上 |

### 1.8 圆角

| Token | 值 | 用在哪 |
| --- | --- | --- |
| `--sm-radius-xs` | `4px` | 复选框、小标签、代码块内联片段 |
| `--sm-radius-sm` | `6px` | 按钮、输入框、tab、徽章（非药丸） |
| `--sm-radius-md` | `8px` | 菜单项、列表行、tooltip |
| `--sm-radius-lg` | `12px` | 卡片、面板、表格容器 |
| `--sm-radius-xl` | `16px` | 对话框、命令面板 |
| `--sm-radius-full` | `9999px` | 药丸徽章、头像、进度条 |

Fluent 的 `borderRadiusSmall/Medium/Large/XLarge` = 2/4/6/8，与本表不同，**必须在主题层覆盖**：
`Small→4`、`Medium→6`、`Large→8`、`XLarge→12`。

### 1.9 字号 / 行高 / 字重 / 字距

字族（不引入 webfont 文件，`Inter` 仅在本机已安装时生效 —— 加 webfont 会增加打包体积与首屏阻塞，
违反「零新依赖」）：

```
--sm-font-sans: 'Inter', 'SF Pro Text', -apple-system, 'Segoe UI Variable Text',
                'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI',
                'Microsoft YaHei', system-ui, sans-serif;
--sm-font-mono: 'SF Mono', 'JetBrains Mono', 'Cascadia Code', Consolas,
                'Liberation Mono', monospace;
```

中文界面必须在字族里带 `PingFang SC` / `Microsoft YaHei UI`，否则 macOS 上会掉到 Times 之类的衬线兜底。

| 角色 | 字号 | 行高 | 字重 | 字距 | 用途 |
| --- | --- | --- | --- | --- | --- |
| `display` | `28px` | `36px` | `600` | `-0.02em` | 页面主标题（每页至多一个） |
| `title` | `20px` | `28px` | `600` | `-0.01em` | 区块标题、卡片组标题 |
| `subtitle` | `16px` | `24px` | `600` | `-0.005em` | 卡片标题、对话框标题 |
| `body` | `14px` | `22px` | `400` | `0` | 正文（默认字号） |
| `body-strong` | `14px` | `22px` | `500` | `0` | 表格首列、强调正文 |
| `caption` | `12px` | `18px` | `400` | `0.005em` | 次要说明、表头、时间戳 |
| `micro` | `11px` | `16px` | `500` | `0.02em` | 徽章内文字、计数、元数据（**不是标题**） |
| `code` | `13px` | `20px` | `400` | `0` | 公式、路径、命令 |

Fluent 映射：`fontSizeBase200→12`、`300→14`、`400→16`、`500→20`、`600→24`、`700→28`；
`lineHeightBase300` 由 `20px` 改为 `22px`；`fontWeightSemibold` 保持 `600`。

### 1.10 边框

- **只有一种边框宽度：`1px` hairline**（`--sm-border-hairline`）。2px 边框一律不许用于装饰。
- 例外：焦点环用 `2px solid var(--sm-border-focus)` + `outline-offset: 2px`（或 `box-shadow: 0 0 0 2px`）。
- 表格：行之间 `1px` hairline；表头下方 `1px` hairline；**不用竖线**。
- 卡片：`1px solid var(--sm-border-hairline)` + 无阴影（深色下阴影看不见，边框就是分层手段）。

### 1.11 阴影与发光

深色主题下阴影的作用被 hairline 取代，阴影只用于**真正浮起的层**（菜单、popover、对话框）。
发光（glow）只给**当前焦点 / 当前活动的那一个元素**，一屏最多一处。

| Token | 深色（默认） | 明亮 |
| --- | --- | --- |
| `--sm-shadow-sm` | `0 1px 2px rgba(0,0,0,0.24)` | `0 1px 2px rgba(16,24,40,0.06)` |
| `--sm-shadow-md` | `0 4px 12px rgba(0,0,0,0.32), 0 1px 2px rgba(0,0,0,0.24)` | `0 4px 12px rgba(16,24,40,0.08)` |
| `--sm-shadow-lg` | `0 16px 48px rgba(0,0,0,0.48), 0 2px 8px rgba(0,0,0,0.32)` | `0 16px 48px rgba(16,24,40,0.12)` |
| `--sm-glow-accent` | `0 0 0 1px var(--sm-accent), 0 0 24px rgba(167,155,255,0.24)` | `0 0 0 1px var(--sm-accent), 0 0 16px rgba(106,85,216,0.16)` |

### 1.12 动效 token

| Token | 值 | 用在哪 |
| --- | --- | --- |
| `--sm-dur-instant` | `80ms` | 按下反馈、开关拨动 |
| `--sm-dur-fast` | `140ms` | hover / 颜色 / 边框变化（最高频，必须最短） |
| `--sm-dur-base` | `180ms` | tooltip、popover、菜单开合 |
| `--sm-dur-slow` | `240ms` | 对话框、抽屉、tab 指示条 |
| `--sm-dur-scene` | `320ms` | **阶段转场**（连续缩放镜头），唯一超过 300ms 的档位，理由见 §3.4 |
| `--sm-ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | 进场、退出（默认） |
| `--sm-ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | 屏幕内的位移 / 形变 |
| `--sm-ease-linear` | `linear` | 进度条、加载条、持续运动 |

内置的 CSS `ease-out` 太弱（前段不够快），**刻意动效一律用上表三条曲线**，不手搓新的。

## 二、Fluent v9 → Raycast 风格的组件映射

**总原则：行为层原样保留，样式层全部重写。**
每一条都分两栏 —— 「保留」（不许动）与「改视觉」（必须动）。组件仍从
`@fluentui/react-components` 导入；改变的是传给它的 `className` / `appearance` / `size`，
以及 `makeStyles` 里的规则。

| 组件 | 保留什么行为（不许动） | 改什么视觉（必须动） |
| --- | --- | --- |
| **Button** | `onClick`、`disabled`、`aria-disabled`、键盘 `Enter/Space`、`:focus-visible` 焦点环、`type` 透传、loading 时的 `aria-busy` | 圆角 6px；高度 32px（`size="medium"`）；`primary` → `accent-fill` 底 + `on-accent` 字；`secondary` → 透明底 + hairline 边 + `text-primary` 字，hover 才上 `bg-hover`；`subtle` → 无边框无底，hover 上 `bg-hover`；按下 `transform: scale(0.98)` + `--sm-dur-instant`。**不要**保留 Fluent 默认的 4px 圆角与蓝色 brand 底 |
| **TabList / Tab** | **`role=tab` / `role=tablist` 不变**（e2e 与 eval 按它找入口）、左右方向键切换、`aria-selected`、焦点跟随选中、`Home/End` | 指示条从「底部 2px 蓝色下划线」改成「选中项整块 `bg-selected` 底 + 左侧 2px `accent-fill` 竖条」（侧栏导航形态）；圆角 6px；未选中文字 `text-secondary`，选中 `text-primary`；hover 上 `bg-hover`。横向 tab 时改为「整块药丸底 + 无下划线」 |
| **Card** | `CardHeader` 的 DOM 结构、`focusMode`、可点击卡片仍是可聚焦元素（`tabIndex` 与 `onClick` 成对出现）、`aria-labelledby` | 圆角 12px；`bg-surface` 底 + **1px hairline 边 + 无阴影**；内边距 `16px`（`--sm-space-4`）；卡片之间间距 `24px`；hover 只把边框变 `bg-selected` 的亮度、不位移、不放大 |
| **Badge** | `aria-label` / 文本可读、`size` 语义、颜色**不能是唯一信息载体**（必须带文字） | 高度 20px；内边距 `6px 8px`（那条 6px 例外）；圆角：计数用 `full`、状态用 `6px`；底色一律用语义 `-soft` 变体 + 语义色文字；边框 `1px` 同色 20% 不透明度；字号 `11px / 500` |
| **Input** | `value` / `onChange`、`aria-invalid`、`aria-describedby` 指向错误文案、`:focus` 时 `border-focus`、`type` 与 `inputMode` 透传、IME 组合输入不被打断 | 高度 32px；圆角 6px；底色 `bg-input`（比所在表面更深）；边框 `1px border-control`；focus 时边框换 `border-focus` + `0 0 0 2px` 同色 20% 外环；**不要** Fluent 默认的「底部 2px 下划线」形态 |
| **Textarea** | 与 Input 同（含 `aria-invalid`、`aria-describedby`、IME）；`resize` 至少保留 `vertical` | 与 Input 同一套底色 / 边框 / 圆角；最小高度 `88px`（约 4 行 × 22px）；内边距 `8px 12px`；行高必须 `22px`，与 Input 的单行高度对齐 |
| **Table** | `TableHeaderCell` 的 `role=columnheader`、`TableRow` 的 `role=row`、排序按钮仍是真 `<button>`、键盘可达、`aria-sort` | 无竖线；行高 `40px`（紧凑表 `32px`）；表头 `caption` 字号 / `text-secondary` / `bg-surface` 且**粘顶**（`position: sticky; top: 0`）；行 hover `bg-hover`；选中行 `bg-selected`；单元格左右内边距 `12px`；数字右对齐 + `font-variant-numeric: tabular-nums` |
| **Dialog** | **焦点陷阱**、`Esc` 关闭、`aria-modal="true"`、`aria-labelledby` 指向标题、关闭后焦点回到触发元素、初始焦点落在第一个可操作元素 | 圆角 16px；`bg-elevated` 底 + `1px hairline` + `--sm-shadow-lg`；宽度 `min(560px, calc(100vw - 32px))`；内边距 `24px`；遮罩 `bg-scrim`；进出 `--sm-dur-slow` + `--sm-ease-out`，`scale(0.96)→1` + `opacity 0→1`（**不是** `scale(0)`） |
| **MessageBar** | `intent` 的语义映射（`success/warning/error/info`）、`role="alert"`（错误）/ `role="status"`（提示）、`MessageBarTitle` 与 `MessageBarBody` 的层级 | 圆角 8px；底色 = 对应语义 `-soft`；**左侧 3px 语义色竖条**代替 Fluent 的整块彩色底；无边框；内边距 `12px 16px`；标题 `body-strong`、正文 `body`；图标与文字间距 `8px`。**不许**把 `warning` 改成 `danger` |
| **ProgressBar** | `value` / `max`、`role="progressbar"`、`aria-valuenow/min/max`、不确定态不带 `aria-valuenow` | 高度 `6px`；轨道 `bg-hover`；填充 `accent-fill`；圆角 `full`；无内阴影；不确定态用 `linear` 循环（`--sm-ease-linear`）。**不许**做条纹或彩虹渐变 |
| **Spinner** | `aria-label` / 可见的加载文案、`size` 语义、不阻塞其余内容的可交互性 | 直径 `16px`（行内）/ `24px`（区块）；描边 `2px`；颜色 `text-tertiary`，主区域可用 `accent`；转速 `900ms/圈` 线性。**深色下不许用纯白描边**（会盖过内容）。加载超过 400ms 才显示，避免闪一下就没 |
| **Tooltip** | `relationship="label" / "description"` 的选择、`aria-describedby` 关联、`Esc` 关闭、hover 与 focus **都**触发、离开延时 | 圆角 8px；`bg-elevated` 底 + `1px hairline`；`--sm-shadow-md`；内边距 `6px 8px`；字号 `12px`；最大宽 `280px`；进场 `--sm-dur-base` + `--sm-ease-out`（`opacity` + `translateY(4px)`）；`transform-origin` 必须跟着触发元素（不许固定 center） |
| **Divider** | 语义是「分隔」不是「装饰」，`role="separator"` | 颜色 `border-hairline`；粗细 `1px`；上下外边距 `--sm-space-3`（12px）；**不许**用 `border-hairline` 之外的任何颜色 |
| **Field** | `label` 的 `htmlFor` 关联、`required` 标记、`validationMessage` 的 `aria-describedby` | 标签 `caption` 字号 / `text-secondary`；标签与控件间距 `6px`（§1.7 第三条例外）；错误文案 `12px` + `danger` |

## 三、动效规范

### 3.1 时长区间

| 场景 | 时长 | 曲线 |
| --- | --- | --- |
| 按下反馈（`transform: scale(0.98)`） | `80ms` | `--sm-ease-out` |
| hover / 颜色 / 边框 | `140ms` | `--sm-ease-out` |
| tooltip、popover、菜单 | `180ms` | `--sm-ease-out` |
| 对话框、抽屉、tab 指示条 | `240ms` | `--sm-ease-out` |
| 阶段转场（连续缩放镜头） | `320ms` | `--sm-ease-in-out` |
| 进度条 / 骨架屏持续动画 | 不限 | `linear` |

**硬上限：常规 UI 动效 ≤ 300ms。** 唯一例外是 `--sm-dur-scene`（320ms），只在阶段转场出现，
且必须写注释说明原因（见 §3.4）。

### 3.2 允许的动效

- `opacity`、`transform`（`translate` / `scale` / `rotate`）、`color`、`background-color`、
  `border-color`、`box-shadow` —— 这些走合成层或代价极低。
- 共享元素连续变形（View Transitions）：卡片 → 详情、节点 → 关卡。
- 进度条 / 骨架屏的 `linear` 循环。
- 一次性入场编排（一屏一次，30–80ms 错开），且只用于「内容首次出现」。

### 3.3 禁止的动效

| 禁止 | 改成 |
| --- | --- |
| `transition: all` | 逐个列出属性 |
| 动画 `width` / `height` / `margin` / `padding` / `top` / `left` | `transform` 或 `opacity`（布局属性会触发重排） |
| `scale(0)` 入场 | `scale(0.96)` + `opacity: 0` |
| UI 元素上用 `ease-in` | `--sm-ease-out`（`ease-in` 前段慢，正好拖住用户最关注的那一刻） |
| 键盘快捷键触发的高频操作加动效（100+ 次/天） | 不动 |
| 每个卡片 / 每个区块都 fade-and-slide-up 入场 | 一屏只编排一次 |
| 无限循环的装饰性动画（呼吸光、漂浮粒子、彩色渐变流转） | 静态；只有真实状态变化才动 |
| 给 `role=tab` 的导航加滑动指示条动画以外的位移 | 只做颜色 / 底色过渡（e2e 定位器要求元素位置稳定） |
| 弹窗从 `transform-origin: center` 缩放（对锚定触发器的 popover） | `transform-origin` 跟随触发元素 |

### 3.4 阶段转场：连续缩放镜头，不是淡入淡出

**规则：知识地图的三层阶段（地球 → 区域 → 微知识点近景）之间用连续缩放镜头过渡 ——
相机从当前视口连续 `scale + translate` 到目标视口，图层在同一坐标系里放大；禁止用
`opacity` 交叉淡化切换阶段。**

理由不是审美，是**认知**：学习者在这张图上建立的是空间记忆 ——
「我在整张图的哪里」「这个分支是从哪个主干长出来的」「刚才那道题属于哪个角落」。
连续缩放把起点和终点放进**同一个连续空间**，动画本身就是答案：你能看见自己是怎么钻进去的，
于是随时知道怎么退回来。淡入淡出则把两帧切成两个互不相干的画面，中间那段「我是怎么到这儿来的」
被抹掉了 —— 空间感一断，退路就得靠面包屑重新学一遍。

三条配套约束：

1. **时长 `320ms`**（`--sm-dur-scene`），曲线 `--sm-ease-in-out`。缩放比超过 4× 时分两段，不要拉长单段。
2. **缩放中心是目标节点，不是画布中心**。以画布中心缩放会让目标飞出视口，观感像「随机平移」。
3. **`prefers-reduced-motion: reduce` 时退化为瞬时切换**（`duration: 0`），而不是改成淡入淡出 ——
   降级的目标是「不动」，不是「换一种动」。

实现用 View Transitions（React 19 内置 `<ViewTransition>` / `addTransitionType`，
或原生 `document.startViewTransition` + CSS 伪元素），**不引入动效库**。

### 3.5 `prefers-reduced-motion` 降级规则

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}
```

- 降级 = **瞬时**（`0.01ms` 而不是 `0`，因为部分浏览器对 `0s` 仍会排队一帧）。
- **不降级**：`opacity` 为 0 的元素必须立刻变为可见（不能靠动画出现，否则用户永远看不到）。
- 加载态（Spinner）保留旋转：它是状态指示，不是装饰。降级时把转速降到 `2s/圈`。
- 焦点环的过渡也归零，但焦点环本身必须始终可见。

## 四、Do / Don't

### Do

- **Do** 只用语义 token（`--sm-bg-surface`、`--sm-text-secondary`）。换主题只换值，不换结构。
- **Do** 用 1px hairline + 表面亮度台阶表达层级；阴影只给真正浮起的层。
- **Do** 全站只用一个强调色系（紫罗兰 / 靛），需要第二种颜色时用语义色。
- **Do** 每个交互元素都有可见的 `:focus-visible` 焦点环（`2px border-focus` + `offset 2px`）。
- **Do** 状态一律「颜色 + 文字 / 图标」双编码：色弱用户看到的是文字，不是红色。
- **Do** 让数字用 `font-variant-numeric: tabular-nums`，表格右对齐。
- **Do** 动效只回答「刚才发生了什么」；用户高频操作（键盘、快捷键）不加动效。
- **Do** 两套主题各跑一次 `contrast-check.mjs` 与一次页面截图对比。
- **Do** 保留 Fluent 的 `role`、`aria-*`、键盘行为，改样式时先确认这些没被 `className` 破坏。
- **Do** 中文文案走 UI、英文标识符走代码。

### Don't

- **Don't** 在组件里写 `dark ? '#111' : '#fff'` 或任何 hex 字面量 —— 语义 token 之外一律不许有颜色值。
- **Don't** 引用 Fluent 的物理 token（`colorNeutralBackground2`、`colorBrandBackground`）—— 它们绕过本仓的语义层。
- **Don't** 把 `role=tab` 改成 `role=link` / `role=button`（会打断 2 处 e2e 与 eval 阶段驱动）。
- **Don't** 用 `transition: all`、动画布局属性、`scale(0)` 入场。
- **Don't** 给 `warning` 套 `danger` 的颜色（关卡未通过不是错误）。
- **Don't** 加第二支强调色、加渐变按钮、加玻璃拟态、加发光边框（除 `--sm-glow-accent` 那一处）。
- **Don't** 用 2px 以上的装饰边框、用阴影代替 hairline 分层。
- **Don't** 为了「更像 Raycast」引入 UI 库 / 动效库 / webfont（零新依赖）。
- **Don't** 用 `!important` 盖 Fluent 内部样式 —— 优先在主题层覆盖 token，其次用 `className`。
- **Don't** 在样式层顺手改文案逻辑、条件渲染、`data-testid`。

## 五、交付前自检 10 条（可直接当评审清单）

改完任何一个界面，逐条勾。**任一条不过就不许提「完成」。**

1. [ ] **零 hex 字面量**：`grep -rn "#[0-9a-fA-F]\{3,8\}" apps/web/src --include="*.tsx" --include="*.css"` 在改动的文件里没有新增命中；颜色全部来自 `--sm-*` 或主题层。
2. [ ] **零物理 token**：改动文件里不再新增 `colorNeutral*` / `colorBrand*` 这类 Fluent 物理 token 引用。
3. [ ] **两套主题都看过**：深色与明亮各截一张图，层级、边界、选中态都读得出来；切换后没有元素「消失」。
4. [ ] **对比度**：`node skills/web-design-engineer/references/contrast-check.mjs` 输出 `TOTAL FAILURES: 0`；新引入的颜色组合要么进了探针，要么手算过 ≥4.5:1（正文）/ ≥3:1（图形与控件边界）。
5. [ ] **间距在栅格上**：新增间距全部取自 `--sm-space-*`（例外只有 §1.7 那三条：2px 光学对齐、徽章内 6px、表单标签间距 6px）。
6. [ ] **行为没丢**：键盘 Tab 能到达每个可交互元素、焦点环可见、`Esc` 能关浮层、`role`/`aria-*` 与改动前一致；`role=tab` 仍在。
7. [ ] **动效合规**：只动 `opacity/transform/color/background-color/border-color/box-shadow`；常规时长 ≤300ms；无 `transition: all`；无装饰性无限动画。
8. [ ] **降级可用**：系统开 `prefers-reduced-motion: reduce` 后，页面内容全部立即可见（没有靠动画才出现的元素），Spinner 仍在转。
9. [ ] **测试没变红**：`pnpm --filter @starmap/web typecheck` 与 `pnpm --filter @starmap/web test` 通过；改动若触及 e2e 定位器，`apps/web/e2e` 里按 role 找元素的地方同步复核。
10. [ ] **文案与标识符**：用户可见文案是中文；代码标识符、文件名、`data-testid` 是英文；没有把中文塞进变量名或 CSS 类名。

## 六、与上游 skill 的关系

本 skill 的素材来自四个上游 skill，但**本仓的约束优先**。冲突时的裁决顺序：

```
本仓既有约束（§0 表格） > 本 skill 的 token / 映射 / 动效表 > 上游 skill 的一般建议
```

| 上游 skill | 取什么 | 不取什么 / 为什么 |
| --- | --- | --- |
| `~/.dsh/skills/frontend-design/SKILL.md` | 「视觉结构即信息」、克制（boldness 只花在一处）、不套模板默认值、交付前自我批判 | 它的「每个项目从零定一套 palette / 字体」不适用 —— 本仓已有既定 palette 与双主题，改的是**实现**不是**方向**。它建议的自由选型会与本仓 AA 基线和「唯一强调色」冲突 |
| `~/.dsh/skills/animate/SKILL.md` | 三条缓动曲线（`0.23,1,0.32,1` / `0.77,0,0.175,1` / `linear`）、时长分档、`ease-in` 禁令、`scale(0)` 禁令、`transition: all` 禁令、退出与进入同路径、`prefers-reduced-motion` 必须随动效一起交付 | 它的「spring / 手势驱动 / drag-to-dismiss」不适用 —— 本仓是桌面学习工作站，没有拖拽手势；且引入 spring 需要动效库（零新依赖）。它的「reduced motion 保留更温和的动效」在本仓改为**瞬时**（§3.5） |
| `~/.dsh/skills/ui-ux-pro-max/SKILL.md` | 「先定设计系统再写页面」的顺序、交付前检查清单的思路、可访问性优先级 | 它的 79 种风格 / 192 套 palette 的检索流程不适用 —— 本仓风格已由本文件定死，再检索只会得到互相矛盾的候选 |
| `~/.dsh/skills/vercel-react-view-transitions/SKILL.md` | `<ViewTransition>` / `addTransitionType` / `::view-transition-*` 伪元素、共享元素变形、`default="none"` 的刻意用法、Next.js 之外的可用性说明 | 它偏 Next.js（`next/link` 的 `transitionTypes`）；本仓是 Vite + React Router 8，走原生 `startViewTransition` 或 React 的 `<ViewTransition>`，路由切换由 `RouterProvider` 触发 |

**上游 skill 若与本文件冲突，以本文件为准，并把冲突记进 PR 描述** —— 否则下一个人会以为两份文档里有一份过期了。

## 七、给后续任务的文件清单（t58 按序改）

<!-- inventory: 27 -->

分三层。**顺序不能乱**：主题层 → 基础组件层 → 页面层。反过来做会导致每改一个页面都要回头再改一次 token。

> 上面那行 `<!-- inventory: 27 -->` 是机器可读的计数，`references/inventory-check.mjs` 拿它跟磁盘
> 对照。**新增/删除任何一个用 `makeStyles` 的文件，都要同时改这个数字与下面 §7.2 / §7.3 的清单**，
> 否则探针会以非零码退出。

### 7.1 主题层（新建，t58 第一个做）

| 文件 | 作用 |
| --- | --- |
| `apps/web/src/theme/tokens.ts` | 本文 §1 全部 token 的**代码侧真源**：`darkTokens` / `lightTokens` 两个对象，语义键完全一致 |
| `apps/web/src/theme/tokens.css` | `:root[data-sm-theme="dark"]` / `[data-sm-theme="light"]` 下的 `--sm-*` 自定义属性声明（由 tokens.ts 抄写，禁止手改不同步） |
| `apps/web/src/theme/theme.ts` | `makeRaycastTheme(tokens)` → 返回 Fluent `Theme` 对象：把 §1 的值映射进 `colorNeutralBackground1…4`、`colorNeutralForeground1…3`、`colorNeutralStroke1/2`、`colorStrokeFocus2`、`colorBrandBackground`、`borderRadius*`、`fontFamilyBase`、`fontSizeBase*`、`lineHeightBase300`、`shadow*` |
| `apps/web/src/theme/ThemeProvider.tsx` | 主题状态 + `data-sm-theme` 属性 + `localStorage` 记忆 + 跟随系统（`prefers-color-scheme`）+ 包一层 `FluentProvider` |
| `apps/web/src/theme/motion.ts` | §1.12 的时长 / 曲线常量 + `useReducedMotion()` |
| `apps/web/src/theme/motion.css` | `::view-transition-*` 规则、阶段缩放镜头关键帧、`prefers-reduced-motion` 降级块 |
| `apps/web/src/styles.css` | 改：`body` 字族换成 `--sm-font-sans`、底色换成 `--sm-bg-canvas`、`color-scheme` 跟随主题 |

挂载点（改两处，别漏）：`apps/web/src/main.tsx:3,9` 与 `apps/web/src/App.tsx:3,32` 现在都硬编码
`webLightTheme` —— 换成 `ThemeProvider`，否则所有页面永远是浅色。

### 7.2 基础组件层（13 个 `makeStyles` 文件 + 图谱那 3 个纯 `className` 组件与其 `graph.css`）

**共享外壳（1）**
- `apps/web/src/components/AppShell.tsx` —— 侧栏导航（`role=tab` 保留）、skip link、抽屉

**关卡（7）**
- `apps/web/src/level/CardView.tsx`
- `apps/web/src/level/QuestionView.tsx` —— 选项三态（idle / hover / selected）与对错反馈
- `apps/web/src/level/GatePanel.tsx` —— `passed→success`、`failed→warning` 的映射不许改
- `apps/web/src/level/MasteryMeter.tsx`
- `apps/web/src/level/StepRail.tsx`
- `apps/web/src/level/VideoPanel.tsx`
- `apps/web/src/level/markdown.tsx`

**智能体面板（5）**
- `apps/web/src/agent/ArtifactCard.tsx`
- `apps/web/src/agent/EvidencePanel.tsx`
- `apps/web/src/agent/ProbePanel.tsx`
- `apps/web/src/agent/SessionPlanCard.tsx`
- `apps/web/src/agent/TurnLog.tsx`

**图谱（4）** —— 前三个**不走 Fluent**（纯 `className` + `graph.css`），改的是 CSS 变量而不是 `makeStyles`
- `apps/web/src/graph/graph.css` —— 34 条类规则，底色与节点四态色换成 `--sm-graph-*`
- `apps/web/src/graph/GraphCanvas.tsx` —— `graph-canvas*` 类名（改样式只动 CSS，不动类名，e2e 与 eval 按类名找元素）
- `apps/web/src/graph/NodeRoster.tsx` —— `graph-roster*` 类名
- `apps/web/src/graph/StatusLegend.tsx` —— 同上

### 7.3 页面层（改样式，共 14 个文件，按此顺序）

路由表 `apps/web/src/routes.tsx:46-62` 是权威顺序（`/board` 复用的是 `DashboardPage`，没有独立的 `BoardPage`）：

1. `apps/web/src/pages/HomePage.tsx`（`/`）—— 主入口，先立样板
2. `apps/web/src/pages/DashboardPage.tsx`（`/board`）
3. `apps/web/src/pages/MapPage.tsx`（`/map`）—— 图谱画布 + 两跳视野
4. `apps/web/src/pages/NodeDetailPage.tsx`（`/map/:microKpId`）
5. `apps/web/src/pages/LevelPage.tsx`（`/level/:levelId`）
6. `apps/web/src/pages/PlacementPage.tsx`（`/placement`）
7. `apps/web/src/pages/ReviewPage.tsx`（`/review`）
8. `apps/web/src/pages/MarketPage.tsx`（`/market`）
9. `apps/web/src/pages/MarketAuthorPage.tsx`（`/market/author/:microKpId`）
10. `apps/web/src/pages/GenerationPage.tsx`（`/market/generate`）
11. `apps/web/src/pages/DatabasePage.tsx`（`/database`）
12. `apps/web/src/pages/RetrievalDebugger.tsx`（嵌在 `DatabasePage` 里）
13. `apps/web/src/pages/SkillsPage.tsx`（`/skills`）
14. `apps/web/src/pages/NotFoundPage.tsx`（`*`）

> 页面层的判据：**一个页面改完，不该在它里面看到任何 hex 字面量或物理 token**。
> 27 个 `makeStyles` 文件 = 7.2 的 13 个 + 7.3 的 14 个，没有第三类。

### 7.4 明确不在本次范围

- `apps/web/src/api/generated/**` —— 生成物，不手改。
- 任何 `*.test.tsx` / `*.test.ts` —— 样式改动不许顺手改断言；若定位器因 DOM 变化失效，
  单独提交并说明原因。
- `apps/api/src/**`、`packages/**` —— 本 skill 与视觉层不触碰后端与引擎。
