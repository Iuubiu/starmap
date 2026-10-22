# 界面视觉语言从 Fluent 2 浅色切到 Raycast 风格深色，但保留 Fluent v9 组件库

**Status: Accepted**

## 背景

用户指令（原话）：「用 raycast 风格代替 windows 的 f2 风格」；随后追加「UI 才是面向投资者的第一生产力，全力完善一个新 UI 的可用版本，并**附带黑暗和明亮两个主题**」。

现状是 Fluent 2 的默认浅色：`apps/web/src/main.tsx:3,9` 与 `apps/web/src/App.tsx:3,32` 都硬编码
`webLightTheme`，全站没有一个自定义 token。结果是界面读起来像 Windows 设置面板 —— 4px 圆角、
`#0f6cbd` 蓝色 brand、`#fafafa` 灰底、`Segoe UI` 字族、Fluent 自带的 2/4/6/8px 圆角刻度。
这套视觉是**组件库的默认值，不是我们的选择**：仓库里没有任何一份 ADR 记录过「选 Fluent 2 浅色」，
它是 `FluentProvider` 一句默认参数带进来的隐性决定。

## 决定

**只换视觉，不换组件库。** 具体地：

1. 组件仍然从 `@fluentui/react-components`（9.74.9）导入，`makeStyles` 仍是唯一样式方案。
2. 换掉的是**主题层**：新建 `apps/web/src/theme/`，把一套自定义 token（Raycast 风格的深色基调 +
   对应的明亮版）映射进 Fluent 的 `Theme` 对象，交给 `FluentProvider`；再用 `--sm-*` CSS 自定义属性
   承载语义层，页面只许引用语义键。
3. 保留 Fluent 的**行为层**：无障碍语义（`role` / `aria-*`）、焦点陷阱、键盘导航、`TabList` 的
   方向键切换、`Dialog` 的焦点归还、`MessageBar` 的 `role="alert"`。
4. 导航仍然是 `role=tab`，不改成语义上的链接或按钮。

设计语言本身（token 表、组件映射、动效规范、自检清单）落在
`skills/web-design-engineer/SKILL.md`，本 ADR 只记录「为什么」。

## 影响面（实测，不是估计）

在 `apps/web/src` 下用脚本统计（排除 `generated/` 与 `*.test.*`）：

| 指标 | 实测值 |
| --- | --- |
| 用 `makeStyles` 的非测试文件 | **27** |
| 引用 `tokens.*` 的次数 | **370**（分布在同样的 27 个文件里） |
| 从 `@fluentui/react-components` 导入的非测试文件 | **29**（27 个样式文件 + `main.tsx` / `App.tsx` 只用 `FluentProvider`） |
| 用到的 Fluent 组件种类 | **34** 个具名导出（含 `makeStyles` / `tokens` / `webLightTheme` 三个非组件导出，即 31 个真组件） |
| 单元测试 | **468** 条，**33** 个测试文件通过 |
| e2e | **7** 个 spec 文件，**54** 个 `test`/`it` 块 |
| 完全不经过 Fluent 的样式 | `apps/web/src/graph/graph.css` 的 **34** 条类规则（图谱画布走纯 CSS + sigma） |

27 个文件 = 基础组件层 13 个（`components/AppShell` 1 + `level/*` 7 + `agent/*` 5）+ 页面层 14 个。
没有第三类。清单在 SKILL.md §7。

## Considerations

### 替代方案 A：全量换组件库（Radix / shadcn / 自研）

否决。代价是 **468 条单测与 54 个 e2e 块的定位器同时失效** —— 现有测试大量按
`getByRole('tab' | 'button' | 'dialog')`、`getByLabelText` 找元素，这些查询依赖 Fluent 渲染出的
DOM 结构与 `aria` 连线。换库意味着测试要按新 DOM 重写一遍，而这次要解决的是「长得像 Windows 设置面板」，
不是「组件不好用」。Fluent 的焦点陷阱、`TabList` 的漫游 tabindex、`Dialog` 的焦点归还都是做对了的东西，
扔掉它们再自己实现一遍，是拿确定性的回归风险换不确定性的观感收益。

### 替代方案 B：只覆盖 Fluent 的 token 值，不写语义层

否决。直接改 `webLightTheme` 的字段名（`colorNeutralBackground2` 之类）能最快出效果，但那样
「哪个表面是画布、哪个是卡片、哪个是 hover」这层语义就永远只存在于每个人的记忆里，两套主题也没法
保证结构一致。用 `--sm-*` 语义键做中间层，代价是多一次映射（`theme/theme.ts`），换来的是
「换主题只换值、不换结构」这条可以被测试和评审检查的性质。

### 替代方案 C：保留浅色基调，只换配色与圆角

否决。用户要的是 Raycast 风格，它的识别度主要来自**深色底 + 极窄的亮度台阶 + 单一紫色强调 + hairline 分层**，
这四件事互相咬合：浅色底上 hairline 会显得脏，亮度台阶在浅色里需要靠阴影补齐，而阴影正是 Fluent 2
观感的来源。抽掉深色基调，剩下的只是「换了颜色的 Windows 设置面板」。

### 双主题：为什么明亮版不是深色版的反相

深色里「更高层」= 更亮，浅色里「更高层」= 更白 + 更浅的 hairline。直接把深色的值取反会得到
`#F5F3EF` 这类发黄的表面，以及一片糊在一起的边框。两套 palette 的**语义键完全一致、值各自独立推导**，
`dark ? A : B` 分支在组件里是被禁止的 —— 否则两套主题一定会漂移。

## Consequences

- **必须**先做主题层再做页面（顺序写死在 SKILL.md §7）：反过来做，每改一个页面都要回头改一次 token。
- Fluent 的物理 token（`colorNeutral*` / `colorBrand*`）在页面里变成**禁用词**。这是可 grep 的规则，
  进自检清单第 2 条。
- 深色基调下 AA 对比度成为硬约束：正文 ≥ 4.5:1、控件边界与图形 ≥ 3:1、禁用态本仓加严到 3:1。
  `skills/web-design-engineer/references/contrast-check.mjs` 把 token 值抄成数据逐条断言，
  **46 条规则 × 2 套主题 = 92 条断言，当前全部通过**；改坏一个 hex 会在一条命令里暴露。
- `graph.css` 那 34 条规则是**例外而非漏洞**：图谱画布需要自己的底色与绝对定位，混进 Fluent 的
  token 体系会让「画布是另一个世界」变含糊。它同样要换成 `--sm-graph-*`，只是走 CSS 变量而不是 `makeStyles`。
- 不新增依赖。动效用 View Transitions（React 19.3.1 已内置 `<ViewTransition>` / `addTransitionType`，
  `@types/react@19.3.0` 已带类型）+ CSS，不引入动效库、不引入 webfont。
- 阶段转场用**连续缩放镜头**（地球 → 地面近景）而不是淡入淡出。理由在 SKILL.md §3.4：
  连续缩放让学习者保持空间感（我在整张图的哪里、现在钻进哪个分支、怎么退回来），
  淡入淡出把这份空间感切断。
- 代价：深色基调下现有的浅色截图基线（`.scratch/eval-*/` 里那些）全部失效，需要重拍。这条是明知的。

## 取代关系

**本 ADR 没有取代任何既有 ADR。** 逐份核对 `docs/adr/0001`–`0007`：

| ADR | 是否被本决定取代 | 为什么 |
| --- | --- | --- |
| 0001 检索门在检索层 | 否 | 后端检索逻辑，与视觉无关 |
| 0002 SQLite | 否 | 已被 ADR-0005 取代，与视觉无关 |
| 0003 追问循环在 engine | 否 | 教学状态机，与视觉无关 |
| 0004 掌握度落在叶节点 | 否 | 领域模型，与视觉无关 |
| 0005 PostgreSQL | 否 | 存储选型，与视觉无关 |
| 0006 NestJS + OpenAPI 契约 | 否 | 后端框架与契约，与视觉无关 |
| 0007 Mastra 分层 | 否 | AI 资产目录约定，与视觉无关 |

它取代的是**一份从未写下来的决定**：「前端沿用 Fluent 2 的默认浅色视觉」。
那件事过去只存在于 `webLightTheme` 这个默认参数里，没有 ADR 编号。本 ADR 把它显式化并推翻它。
若将来有人要重新讨论视觉方向，取代的对象是 **ADR-0008（本文件）**。

## Related

- `skills/web-design-engineer/SKILL.md` —— 设计 token 表、Fluent v9 → Raycast 组件映射、动效规范、交付前自检 10 条、分层文件清单
- `skills/web-design-engineer/references/contrast-check.mjs` —— 双主题 92 条对比度断言的探针
- [ADR-0006](0006-nestjs-and-openapi-contract.md) —— 前端类型由 OpenAPI 契约生成，所以视觉层改动不触碰 `apps/web/src/api/generated/`
