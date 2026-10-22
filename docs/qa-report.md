# 浏览器深度验收报告（票 20 / t43）

**证据等级：假设生成。** 本报告的全部结论来自本机开发环境的真实浏览器
（Playwright + Chromium，web `http://localhost:5173`，api `http://127.0.0.1:3001`）
与真实数据库，**未做任何生产环境验证**。所有「已修复」都附了可复跑的命令与
反向验证；所有「未修复」都写清了为什么不修。

**不宣称可用性达标。** 本报告证明的是「下面这些具体路径在真人手里会 / 不会卡住」，
不是「产品可用了」。20 个场景全绿也只说明这 20 条路走得通。

## 套件现状

| 套件 | 结果 | 复跑时间 |
|---|---|---|
| `00-patrol.spec.ts` + `01-home.spec.ts` + `02-stages-s2-s5-s9.spec.ts` | **17 passed** | 2026-10-22 17:26 |
| `03-twenty.spec.ts`（20 个使用场景矩阵） | **21 passed / 0 failed / 0 skipped** | 2026-10-22 17:14 |
| `zz-demo.spec.ts` + `zz-demo-tiers.spec.ts`（演示主线与零模型五连） | **2 passed / 0 failed** | 2026-10-22 21:04 |
| 合计 | **40 passed，零 skip** | — |

演示套件的一键复现命令（也是 t64 的 verify）：

```bash
cd apps/web && npx playwright test --config=../../.scratch/qa/playwright.config.ts demo \
  --output=../../.scratch/pw-demo
```

最近一次输出摘录（真实日志，未删改）：

```
[demo] P1 shape=worked_example ladder=1-3 newKp=2 关卡首屏=讲解全展开 起始=第 1 段 · 引导
[demo] P2 shape=completion ladder=2-4 newKp=3 关卡首屏=讲解留最后一步给你补 起始=第 1 段 · 引导
[demo] P3 shape=direct ladder=3-5 newKp=4 关卡首屏=讲解默认收起，需要时展开 起始=第 3 段 · 简单问题
[demo] 零模型断言通过：模型端点命中 0 次
[demo] 合计 6 步 / 失败 0 / 总耗时 37.6s
  2 passed (1.8m)
```

零模型五连那一条的六步耗时（2026-10-22 21:04 那次）：前置 0.5s / 13 市场 5.9s /
16 数据库 6.1s / 05 图谱 7.6s / 08 溯源 3.4s / 10 关卡 14.1s，全程
`/agent/turns` 与 `/agent/probes` 命中 **0** 次。各步比 19:22 那次慢 1–3 秒，
是并行泳道在同一台机器上跑构建导致的，不是回归。

**演示套件在 2026-10-22 20:42–21:15 期间连红四次，原因不在产品也不在断言**：
默认通道（非 `DEMO_LLM=1`）那次的上游模型 45 秒超时，`/agent/turns` 返回的是
「模型暂时不可用」错误卡而不是产物卡，于是 `zz-demo-tiers` 等不到「难度档 P?」标签。
逐次实测（同一句话连打 6 次）：4 次 2–8 秒正常返回、2 次各卡满 45 秒回错误卡。

已按下面的方式硬化脚本，**没有放宽任何档位断言**（六维 / 首轮形态 / 三处界面差异
的硬断言一行未动）：每档提交后若看到「模型暂时不可用」，就重发**同一句话**，
最多 3 次；3 次都失败仍判红 —— 那时演示本身也跑不下去了，红是对的信号。

硬化过程本身踩了两个 Playwright 坑，都记在这里以免下一个人重踩：

1. `getByText('模型暂时不可用')` 会命中 2 个元素（错误卡标题 + 左侧学习日志里
   那条同名历史条目按钮），抛 strict mode violation。改为
   `page.locator('main').getByRole('heading', ...)`。
2. 点错误卡上的「再试一次」按钮不可靠：点下去它立刻被「正在生成」的骨架替换，
   Playwright 的 click 在「元素已稳定 → 派发前一刻被卸载」时会一直重试到超时
   （`element was detached from the DOM, retrying`）。改为**重新填一次输入框 +
   点「提交这一轮」**，语义等价（都是重发同一句话），但输入框始终在。

硬化后连续 **3 次** verify 全绿，用时 3.8 分钟 / 2.5 分钟 / 2.0 分钟。

早先的 `18 passed / 2 failed / 1 skipped` 已全部消解，三条的来龙去脉见第四节：
两条红是共享库被清空导致的前置数据缺失（场景自己造数后转绿），一条 skip 是
U-1 的 `test.fixme`（t56 修复后解禁，断言零改动转绿）。

**2026-10-22 18:30 的一次全站白屏不计入本报告的产品缺陷**：那是并行泳道正在写的
`apps/web/src/theme/tokens.ts` 里，块注释正文出现 `bg-*/text-*`，其中 `*/` 提前
闭合了注释，导致 Vite 对整份模块报 `PARSE_ERROR`、所有页面白屏。属主在 40 秒内
修好（`bg-* / text-*`），修复后 `document.body.innerText` 恢复为 375 字符、
无 4xx/5xx。它值得记一笔的地方不是产品，而是**注释里写 glob 通配会把 `*/` 喂给
词法器，而 TypeScript 不会报「注释未闭合」，只在 120 行之外报「期望逗号」** ——
定位信息完全指错地方。

---

## 一、范围与分工

票 20 的浏览器验收按阶段切分。t19（integrator）的全流程评估器已覆盖
`S0 / S1 / S3 / S4 / S6 / S7 / S8`（`tools/eval/src/report/render.ts:38` 的
`COVERED_STAGE_IDS`，三档 persona 实跑零失败）。**本报告只负责剩下的三段**：

| 阶段 | 含义 | 场景文件 |
|---|---|---|
| **S2** | 关卡卡产出 → 点进关卡 → 关卡真的能打 | `02-stages-s2-s5-s9.spec.ts` 场景 S2 |
| **S5** | 追问表单能连续作答、退出后不留可点的空框 | `02-stages-s2-s5-s9.spec.ts` 场景 S5 |
| **S9** | 刷新后会话与学习日志还在，开新会话才清空 | `02-stages-s2-s5-s9.spec.ts` 场景 S9 |

另有三个文件作为底座：`00-patrol.spec.ts`（8 页巡检，无报错无白屏）、
`01-home.spec.ts`（首页四场景）、`03-twenty.spec.ts`（20 个使用场景矩阵），
以及 t64 加进来的两个演示 spec。

复跑（**必须带 `--output`**，否则并发 run 会互相清空 `test-results`；
配置在 `.scratch/qa/playwright.config.ts`，`baseURL` 是 `http://localhost:5173`）：

```bash
cd apps/web
PLAYWRIGHT_OUTPUT_DIR=../../.scratch/pw-qa-$(date +%s)   npx playwright test --config=../../.scratch/qa/playwright.config.ts --reporter=list
```

> `.scratch/` 下的脚本与 spec 不进版本库（`.gitignore` 里 `.scratch/*.mjs`、
> `.scratch/pw-*/` 等）。本报告落在 `docs/` 就是为了让结论进版本库；**复跑需要
> 先确认 `.scratch/qa/` 这套夹具在本机还在**。

---

## 二、演示主线：三种学习者学同一个知识点（t64）

用户当场否掉了原来的演示主线，原话是「软件的核心功能没有展示，就是三类人群的
学习，这个必须要有」。所以这一段不是「三档都能跑通」，而是：

> **同一句开场话术 + 同一个知识点，三档拿到的第一屏肉眼可见地不一样，
> 而且不一样的地方正好是六维参数里那几维。**

### 2.1 三段共用的输入

| 项 | 值 |
|---|---|
| 开场话术 | `我想学布尔代数的基本运算`（`zz-demo-tiers.spec.ts:40` 的 `UTTERANCE` 常量） |
| 知识点 | `kp-bool`（布尔代数基本运算） |
| 关卡 | `lv-bool-laws`（逻辑代数基本律：吸收律与德摩根律） |
| 切档 | `node .scratch/demo-set-tier.mjs <P1\|P2\|P3>` |

切档必须走脚本、不能手改数据库：脚本在**一个事务**里同时改 `tier` /
`status` / `attempts_baseline` 三列，少改一列都会被「够 5 题就重判」的逻辑
立刻改回去。

### 2.2 六维真值（全部来自 `GET /api/v1/tier`，不是从界面文案猜的）

| 维度 | P1 小陈（211 零基础） | P2 林（研二有基础） | P3 老周（现场工程师） |
|---|---|---|---|
| `firstRoundShape` | `worked_example` | `completion` | `direct` |
| `ladder.start` / `ladder.cap` | 1 / 3 | 2 / 4 | 3 / 5 |
| `feedbackTiming` | `step_immediate` | `step_immediate_with_summary` | `item_deferred_with_summary` |
| `attemptsPerItem` | 2 | 2 | 1 |
| `masteryRule.consecutiveCorrect` | 2 | 2 | 1 |
| `sessionNewKpLimit` | 2 | 3 | 4 |

**两两比较的维度数**（硬断言要求「任意两档 ≥4 维不同」，不是只比 P1 vs P3）：

| 比较 | 不同的维度 | 维数 |
|---|---|---|
| P1 vs P2 | `firstRoundShape` / `ladder` / `feedbackTiming` / `sessionNewKpLimit` | **4** |
| P1 vs P3 | 六维全不同 | 6 |
| P2 vs P3 | `firstRoundShape` / `ladder` / `feedbackTiming` / `attemptsPerItem` / `masteryRule` / `sessionNewKpLimit` | 6 |

最紧的是 **P1 vs P2 恰好 4 维**：`attemptsPerItem`（2 / 2）与
`masteryRule.consecutiveCorrect`（2 / 2）在这两档上**是相同的**。这正是不许
「只比 P1 vs P3」的原因 —— 那样会掩盖 P1 与 P2 在「给几次机会、连对几次算掌握」
上完全一致这件事，而这两维恰恰是最容易被误认为「档位越高要求越松」的地方
（实际是 P3 才放宽到 1 次）。

**第一轮形态三档两两不同**：`worked_example` / `completion` / `direct`。

### 2.3 界面上肉眼可见的三处差异

| # | 屏幕位置 | P1 | P2 | P3 |
|---|---|---|---|---|
| 1 | 首屏产物卡右上角徽标 | `难度档 P1` | `难度档 P2` | `难度档 P3` |
| 2 | 首屏卡片右侧的推进上限 | `按 P1 档，一次最多推进 2 个新知识点。` | `… 3 个 …` | `… 4 个 …` |
| 3 | 进关卡后的第一屏（首轮形态） | `第 1 段 · 引导`，`讲解全展开`，DOM 里 0 个 `<details>` | `第 1 段 · 引导`，`讲解留最后一步给你补`，1 个 `<details>` 且默认关着 | `第 3 段 · 简单问题`，`讲解默认收起，需要时展开`，直接出题 |

第 3 条是**唯一能看见首轮形态的地方** —— 六维参数本身只活在 `/api/v1/tier` 里，
观众看不见；卡片文案是自然语言、可能被模型改写。所以档位标签与首轮形态
（两者都是前端按 `TIER_PARAMS` 确定性渲染的）才是硬证据。

### 2.4 六张截图与机读结果

| 文件 | 内容 |
|---|---|
| `.scratch/demo/tier-P1-card.png` | P1 首屏产物卡 |
| `.scratch/demo/tier-P1-level.png` | P1 进关卡第一屏（讲解全展开） |
| `.scratch/demo/tier-P2-card.png` | P2 首屏产物卡 |
| `.scratch/demo/tier-P2-level.png` | P2 进关卡第一屏（最后一步待补全） |
| `.scratch/demo/tier-P3-card.png` | P3 首屏产物卡 |
| `.scratch/demo/tier-P3-level.png` | P3 进关卡第一屏（跳到第 3 段出题） |
| `.scratch/demo/tiers.json` | 三段的六维真值 + 首屏文字 + 关卡第一屏 DOM 事实 + 截图路径 |

`tiers.json` 的字段名与 `GET /api/v1/tier` 的返回**逐字一致**（含
`masteryRule.consecutiveCorrect` 这一层嵌套），所以对照时不需要翻译表：
`jq '.[] | {tier, firstRoundShape, ladder, feedbackTiming, attemptsPerItem, masteryRule, sessionNewKpLimit}' .scratch/demo/tiers.json`。

**演示怎么讲、手指标哪里、出问题怎么办**：见 `.scratch/DEMO.md`
（操作卡：三段话术 + 每段手指标点 + 切档命令 + 现场顺序 + 演示前自检三条命令）。

### 2.5 为什么三段不能同时开三个标签页

档位存在 `app.placement_profile` 里，**全站共享一行**。三个标签页同时开，读到的
都是同一档 —— 三段画面会完全一样。这不是理论风险：这个 spec 第一次跑就是这么
失败的（两次都读到 P1，六维全部相同，硬断言直接红）。所以必须逐档切换、
每档单独开 `browser.newContext()`。

---

## 三、已修复（含反向验证）

### 1. 【blocker】知识地图画布一整块纯色，全部节点不可见

- **现象**：`/map` 打开后画布是一整块均匀的浅灰，没有任何点；控制台无报错。
- **规模**：发现时（13 本英文教材移除前）是 **5495** 个节点全部不可见；
  这些教材被物理移除后同一现象仍复现，只是规模降到 **3085**（2026-10-22 19:22
  实测 `GET /api/v1/graph` 的 `nodes.length`，与画布 `data-node-count` 相等）。
- **定位**：sigma 4.0.3 的 `itemSizesReference` 默认是 `'positions'` —— 节点 `size`
  的单位是**图坐标**而不是屏幕像素。7px 的半径被按图坐标放大到约 3000px，
  于是第一个点就把整个视口涂满了。
- **修法**：`apps/web/src/graph/*` 显式钉住 `itemSizesReference: 'screen'`。
- **反向验证**：把该选项去掉，`/map` 立刻回到纯色画布（截图对照见
  `.scratch/qa/shots/03-map.png` 与 `_map-fixed.png`）。
- **commit**：`1818d0a`（后续 `7708d4a` 把「糊成一坨」进一步做到「逐点可分」，
  那是 t44 的范围）。

### 2. 【major】知识点详情页的「用 AI 给这个知识点生成关卡」是一个走不通的死按钮

- **现象**：`/node/:microKpId` 的关卡区在「这个知识点还没有关卡」时，只有一句
  「内容入库后会生成关卡」——没有任何控件。学生按字面理解会一直等。
- **修法**：给出真正能走通的入口，跳到 `/market/author/:microKpId`。
- **commit**：`b768401`。

### 3. 【major】`level_card` 上没有「进入关卡」按钮（D-02）—— **后续被取代**

- **现象（当时的）**：首页拿到关卡卡后，卡上只有标题与理由，没有可点的东西；
  学生只能自己猜 `/level/:id` 这个 URL。
- **修法（当时的）**：`apps/web/src/agent/ArtifactCard.tsx` 的 LevelCard 加主按钮
  `navigate('/level/' + artifact.levelId)`。
- **commit**：`7cb07c4`（本泳道实现，由 captain 的批量提交收录）。

**【后续被取代】** 2026-10-22 17:33 用户明确要求：**不要设计打开按钮**，关卡要
**自动弹出浮层** —— 对话里连按钮都不该存在。因此上面那个「加按钮」的修法在当前
代码里已被移除，**这不是回归，是产品决定**。接手的票：

| 票 | 负责什么 |
|---|---|
| **t69 / t72** | 删掉「进入关卡」按钮，卡片本体即入口，任何 `level_card` 都自动弹 |
| **t68** | 浮层容器与动效 |
| **t71** | 交互规格文档 `docs/design/auto-open-level.md` |

保留上面两段原始事实的理由：将来的读者看到「加按钮」被记为 major 修复、而代码里
没有按钮，会以为有人把它删错了 —— 这正是文档最容易制造的那种假故障。**当时判断
「卡片产出了关卡却没给入口，等于把『去做』这一步退回给记忆」是成立的**；产品后来
选了更彻底的答案（根本不用点），两者不矛盾。

### 4. 【major】追问面板在「已经结束」的轮次里仍然留着能打字、按不动的输入框（D-03）

- **现象**：追问阶梯退出（`reveal` / `exit` / `reteach`）之后，作答区仍然渲染，
  学生可以打字但提交按钮是灰的 —— 输入框会被清空，写进去的话丢掉了。
- **根因**：`ProbePanel.tsx` 原来只把 `reveal | exit` 当作「已揭示」，漏了
  `acknowledge` 与 `reteach`。
- **修法**：把 `acknowledged` 一并纳入守卫，两种退出方式都收起作答区。
- **反向验证**：临时把 `acknowledged` 改回常量 `false` → 相关 2 条测试红；
  还原 → 11 passed。
- **commit**：`1c1c69b`。

### 5. 【major】刷新后首页回到空白，会话与学习日志都丢了（S9）

- **现象**：在首页说一句话、拿到卡片、按 F5 —— 卡片没了，输入框空着，学习日志
  显示「共 0 轮记录」，但 `localStorage['starmap.session']` 里的会话 id 没变
  （所以不是「换了会话」，是「有会话但没恢复」）。
- **修法**：`HomePage.tsx` 增加 `RESTORING_HINT` 恢复态，并把最后一轮产物从
  会话日志里读回来；焦点从 URL `?kp=` 初始化，不再被历史首轮劫持。
- **commit**：`94e04d9`。

### 6. 【major】冷启动会话里 S2 / S5 在真实 UI 上不可达（D-01）

- **现象**：首页的焦点只存在内存 state 里，没有任何 URL / localStorage 承载。
  从地图选一个点、跳到详情页、再回首页 —— 焦点丢了。于是「要一张关卡」这类
  输入没有 `microKpId` 可依据。
- **修法（两处入口）**：
  - `apps/web/src/pages/NodeDetailPage.tsx` 的关卡卡区加「问助手」按钮，
    `navigate('/?kp=' + microKpId)`；
  - `apps/web/src/pages/HomePage.tsx` 从 `searchParams.get('kp')` 读初始焦点。
- **反向验证**：把 `focusKpId` 改回 `currentKpId`（被历史首轮劫持的旧实现）→
  测试红；恢复 → 绿。
- **commit**：`b768401`（入口）+ `94e04d9`（焦点）。

### 7. 【minor】5 处把 Markdown 字面量直接渲染给学生看

- **现象**：讲解正文里出现 `**粗体**`、`_斜体_` 这样的星号与下划线原文。
- **修法**：改为 `plainText()`（剥掉标记后按纯文本渲染）。
- **commit**：`061e838` 的同一批改动。

### 8. 【blocker，由 captain 亲修，本报告只登记】答对/答错讲解里的 LaTeX 公式显示成源码

- **现象**：学生看到 `$A + A·B = A·(1 + B) = A$` 这样的原文。
- **commit**：`061e838`。本泳道不重复修，也不重复验证（captain 已验）。

---

## 四、未修复的问题及原因

### U-1【已修复，2026-10-22 17:14 复核】焦点完全忽略学习者说的话（t56）

- **当时的可观测事实**：首页不选知识点，连续说五句话，逐轮的「当前知识点」都是同一个
  与内容无关的节点：
  ```
  说「我想学布尔代数」     → 当前知识点 一、核衰变的统计分布
  说「吸收律是什么意思」   → 当前知识点 一、核衰变的统计分布
  说「为什么 A + A·B = A」 → 当前知识点 一、核衰变的统计分布
  说「能给我一道练习题吗」 → 当前知识点 一、核衰变的统计分布
  说「我答错了，错在哪」   → 当前知识点 一、核衰变的统计分布
  ```
  取证脚本 `.scratch/probe-focus-17.json`（五轮逐轮快照）。
- **根因**：`apps/api/src/agent/turn.service.ts` 的 `resolveFocus` 按推荐挑焦点，
  不读 `utterance`。当时归 agent 泳道（t56），本泳道不重复改同一个函数。
- **修复**：t56 已由 captain 收尾（`abd041c` 主体 + `f131f0b` 整名命中优先的排序修正）。
- **复验（本报告负责）**：`17b` 的 `test.fixme` 已去掉，变成常驻回归，实测
  `当前知识点 → 布尔代数基本运算`，**绿**。断言口径没有放宽 —— 仍然只认
  「当前知识点」后面那 24 个字符，不认「页面上出现过布尔」（学习者那句话本身会被
  日志回显，那种断言永远绿）。

### U-2【major，不属本泳道】有关卡的知识点上，S5 追问表单不可达

- **可观测事实**：`POST /api/v1/agent/turns` 用四句都在要「先提问」的说法
  （「先别给答案，问我一个问题。」等）打 `kp-bool`（有关卡），四句全部返回
  `artifact.kind = level_card`；同样的四句打 `kp-chenboxian-2011-8-3`（无关卡）
  则返回 `probe_form`。
- **根因**：`turn.service.ts:768` 写的是「模型说要 `level_card`、且有可打开的
  关卡就给关卡卡；关卡事实不足时才退化成 `probe_form`」。也就是说追问表单
  成了「关卡拿不到时的退路」，而不是「学习者说要先被问时该给的东西」——
  模型判成 `level_card` 就没有任何机制把它改成 `probe_form`。
- **为什么不修**：同样是 agent 泳道的意图判定，改它要动 prompt 或加规则，
  与本泳道「浏览器验收」的边界冲突。
- **现状**：S5 场景用「有切片、还没有关卡」的叶节点（`kp-chenboxian-2011-8-3`）
  跑通，**场景验证的是「追问表单能用」**；这条缺陷单独记在这里，两者不混。

### U-3【minor】十轮长对话里产物卡类型几乎不变

- **可观测事实**：十轮里 `probe_form` 占 10/10（`.scratch/qa/shots/_twenty-results.json`
  与 `.scratch/probe-focus-17.json`）。学习者说「能给我一道练习题吗」时得到的
  仍是追问表单，不是关卡卡。
- **为什么不修**：与 U-2 同源（产物类型由模型的 `cardKind` 单点决定，
  服务端只做「事实不足则退化」）。属于意图判定质量问题，不属浏览器验收。
- **影响**：不阻塞流程（十轮无报错、输入框始终可用），但「学生要什么给什么」
  这一层实际上没有兑现。

### U-4【环境限制】Playwright 场景与并行泳道共用真实库

- **可观测事实**：`02-stages-s2-s5-s9.spec.ts` 的 S9 会新开一个会话；
  `03-twenty.spec.ts` 场景 04（改道）会写 `learning_log`。若同时有别的泳道在
  跑会改同一批表，断言里的计数可能抖动。**2026-10-22 18:44 这次 demo 复跑就撞上
  过 `connect ECONNREFUSED 127.0.0.1:3001`**（别的泳道在重启 API），重试即绿。
- **为什么不修**：本套件被要求「跑已经在跑的开发服务」（不起独立 DB），
  隔离只能靠 `workers: 1` + 只读优先的写法。已在本报告里如实标注。
- **操作建议**：跑之前先轮询 `/api/v1/health` 拿到 200，**不要一次 000 就下结论**。

---

## 五、20 个使用场景矩阵（`03-twenty.spec.ts`）

**当前状态：21 passed / 0 failed / 0 skipped（3.9 分钟）**，2026-10-22 17:14 复跑。
早先的 18 passed / 2 failed / 1 skipped 已全部消解：两条红是共享库被清空导致的
前置数据缺失（场景自己造数后转绿），一条 skip 是 U-1 的 `fixme`（t56 修好后解禁）。

复跑：

```bash
cd apps/web
PLAYWRIGHT_OUTPUT_DIR=../../.scratch/pw-qa-t43-final-$(date +%s)   npx playwright test --config=../../.scratch/qa/playwright.config.ts   03-twenty.spec.ts --reporter=line
```

| # | 场景 | 关键断言 | 结果 | 截图 |
|---|---|---|---|---|
| 01 | 冷启动：首页能说话，历史为空，无报错 | 输入框可见；`scrollWidth <= clientWidth`（无横向溢出）；pageErrors 为空 | 绿 | `scene-01-home.png` |
| 02 | 初始定级页：档位、理由、历史三块都在 | `region[档位变更历史]` 可见（**前置由 `ensurePlacementHistory()` 自造**，否则该卡片按设计 return null）；`重新定级` 按钮可见 | 绿 | `scene-02-placement.png` |
| 03 | 看板：推荐带理由，理由数字来自作答记录 | `heading[看板]`；`今日推荐` ≥1 条；`不学这个，换一个` 可见 | 绿 | `scene-03-board.png` |
| 04 | 看板改道：选一个想学的 → 真的落库 | 下拉展开且选项 >1；`POST /board/redirect` <400；改道后首推仍存在 | 绿 | `scene-04-redirect.png` |
| 05 | 知识图谱：节点渲染并显示计数 | 画布可见；`data-node-count` **等于** `/api/v1/graph` 的节点数（不写死数字）；`data-camera-ratio` >0 | 绿 | `scene-05-map.png` |
| 06 | 图谱状态筛选：四个图例计数与总数自洽 | 4 个 `.graph-legend-item`；每个 `visible <= total`；**四档 `total` 之和 = 接口节点数** | 绿 | `scene-06-legend.png` |
| 07 | 图谱跳数：−1 / +1 / 回全图 改变可见子图 | 无焦点时三键 disabled；两跳邻域 `< 全图` 且 `>1`；+1 跳后增多；−1 跳后回到原值；回全图后重新 disabled | 绿 | `scene-07-hops.png` |
| 08 | 节点详情：掌握度双字段 + 来自哪本书哪一页 | **前置由 `ensureMasteryEvidence()` 自造**（8 题 + 3 变式）；`历史最高` 与 `当前熟练度` 都在；真实节点给出 `第 N 页` 与教材名 | 绿 | `scene-08-node.png` |
| 09 | 无关卡知识点：给出「用 AI 生成关卡」的出口 | 说明文字含「关卡」；存在可走通的出口（生成入口；**关卡不再由按钮进入** —— t69 起改为自动弹出浮层） | 绿 | `scene-09-node-no-level.png` |
| 10 | 关卡播放：七段可推进到小结 | `第 N 段` 出现；至少推进 1 段 | 绿 | `scene-10-level.png` |
| 11 | 关卡门控面板：说明当前门控状态 | 首屏若出现「门控」则匹配 `不设门控\|出口门控\|先修`；否则记录为「在小结段落」 | 绿 | `scene-11-gate.png` |
| 12 | 复验页：无到期内容时给出可操作的下一步 | `heading[复验]`；正文匹配 `要复验\|复验的内容`；存在 `回到看板\|开始复验` 按钮 | 绿 | `scene-12-review.png` |
| 13 | 关卡市场：预制关卡可列出并进入 | `heading[关卡市场]`；`重新开始` 按钮 ≥1 | 绿 | `scene-13-market.png` |
| 14 | AI 批量生成：表单可填、能发起一批 | `heading[AI 批量生成关卡]`；输入框可填；`开始生成` enabled | 绿 | `scene-14-generate.png` |
| 15 | 技能库：列出 skill、开关可用、正文只读 | `heading[技能库]`；开关 ≥2 个；`正文（只读）` 可见 | 绿 | `scene-15-skills.png` |
| 16 | 数据库页：统计数字与 API 一致（不是示例数据） | 页面文本含 `/api/v1/stats` 的知识点数与切片数（**从接口读，不写死**） | 绿 | `scene-16-database.png` |
| 17 | 十轮长对话：每轮都有产物卡，焦点不卡死 | 10 轮全部完成；末轮后输入框仍可见；正文不含 `服务不可用\|请求失败\|出了点问题` | 绿 | `scene-17-long-chat.png` |
| 17b | **焦点跟随学习者的话** | 「当前知识点」后 24 字符内含「布尔」（**不是**全文匹配 `/布尔/` —— 那是假绿） | **绿（原 fixme，t56 修复后解禁）** | `scene-17b-focus.png` |
| 18 | 未知路由：给中文兜底并指路 | `这一页不存在`；`回看板` 与 `打开知识地图` 两个按钮 | 绿 | `scene-18-notfound.png` |
| 19 | 窄视口 375px：地图画布不塌、无横向溢出 | 画布宽 311px > 0；`scrollWidth <= clientWidth`；无 pageErrors | 绿 | `scene-19-narrow.png` |
| 20 | 沉浸输入在刷新后仍可用（会话续接） | 刷新后页面文本长度 > 0 且仍含刷新前那句话 | 绿 | `scene-20-refresh.png` |

**关于「skip 的那条为什么还能 skip」**：没有 skip 了。`17b` 在 t56 修复前用
`test.fixme` 挂着是当时的正确做法（断言原样保留、不放宽，缺陷修好就去掉）；
t56 于 2026-10-22 修复后本报告已把它改成必跑，并实测转绿。

**两条前置造数的说明（为什么场景要自己造数据）**：场景 02 与 08 原本假设库里
已有定级历史与掌握度证据。共享真实库被其他泳道清空后，这两条变成了假红 ——
产品行为其实是对的（`TierHistoryCard` 在 `items.length === 0` 时按设计
return null；`MasteryMeter` 在证据不足时只渲染「证据不足」）。修法是**场景自己
造前置数据**（`_helpers.ts` 的 `ensurePlacementHistory()` / `ensureMasteryEvidence()`，
全走真实接口），**断言一条都没有放宽**。这两个 helper 本身也是本票的交付物。

---

## 六、过程中的方法论更正（留给下一个人）

1. **「页面上出现过某个词」不能当断言**。17 号场景最初断言
   `/布尔/`，而学习者自己那句话会被学习日志原样回显 —— 断言永远绿。改成断言
   「当前知识点」那一行之后才暴露出 U-1。**同理**：图例的「未学 3083/3086」
   里那个 3086 是**这一档**的全图数，不是节点总数；把 3083 当总数会与接口差 3
   （这是我自己写错的断言，不是产品缺陷）。**这两个数现在都过期了** ——
   英文教材移除后全图是 3085，图例写的是「未学 3082/3085」；判据不变，
   但**任何写死图例数字的断言都会随内容库变动而红**，要断言就断言
   「画布 `data-node-count` === `GET /api/v1/graph` 的 `nodes.length`」。
2. **「等 URL 变了」不等于「页面渲染完了」**。S2 最初在 `page.goto` 之后立刻读
   `innerText`，只拿到 58 字符（顶栏 + 标题），于是「关卡页没有可读文本」误报。
   改成轮询整页文本长度 > 80，对任何关卡都成立。
3. **场景必须自己造前置数据**。共享真实库会被别的泳道清空；依赖「库里已经有」
   的场景会在别人的清理之后变成假红，看起来像产品坏了。`_helpers.ts` 的
   `ensurePlacementHistory()` / `ensureMasteryEvidence()` 就是这条的产物 ——
   造数走真实接口，**断言仍然只看界面**。
4. **`test.fixme` 优于放宽断言**。缺陷不属本泳道时，正确做法是把断言原样留着、
   标 `fixme`，而不是把正则改松到能过。U-1/17b 就是靠这条在 t56 修好后
   **零改动**转绿的。
5. **服务不可用不是产品缺陷**。`ECONNREFUSED 127.0.0.1:3001` 说明别的泳道在重启
   API，重试即绿。判断「服务活着」要靠轮询 health 拿到 200，而不是一次失败就
   把 spec 判红 —— 这条在 18:44 那次复跑上真实发生过。
6. **注释里写 glob 通配会把 `*/` 喂给词法器**。`bg-*/text-*` 提前闭合块注释，
   报错却指向 120 行之外的 `{`。写文档里的通配符时要么加空格（`bg-* / text-*`），
   要么用行注释。

---

## 七、可复跑的证据清单

| 文件 | 内容 |
|---|---|
| `.scratch/qa/scenarios/00-patrol.spec.ts` | 8 页巡检 |
| `.scratch/qa/scenarios/01-home.spec.ts` | 首页四场景 |
| `.scratch/qa/scenarios/02-stages-s2-s5-s9.spec.ts` | S2 / S5 / S9 |
| `.scratch/qa/scenarios/03-twenty.spec.ts` | 20 场景矩阵（含 17b） |
| `.scratch/qa/scenarios/zz-demo-tiers.spec.ts` | 演示主线：三档学习（P1/P2/P3 逐档切） |
| `.scratch/qa/scenarios/zz-demo.spec.ts` | 零模型五连（13→16→05→08→10，断言模型端点命中 0 次） |
| `.scratch/qa/scenarios/_helpers.ts` | 造数 helper（`ensurePlacementHistory` / `ensureMasteryEvidence`）与诊断工具 |
| `.scratch/qa/shots/_twenty-results.json` | 20 场景的机读结果 |
| `.scratch/qa/shots/scene-*.png` | 每个场景的截图（文件名见第五节表格） |
| `.scratch/demo/tiers.json` | 三档六维真值 + 首屏文字 + 关卡第一屏 DOM 事实 |
| `.scratch/demo/tier-*-card.png` / `tier-*-level.png` | 6 张对照截图 |
| `.scratch/DEMO.md` | **演示操作卡**：三段话术 + 每段手指标点 + 切档命令 + 现场顺序 + 演示前自检三条命令 |
| `.scratch/demo-set-tier.mjs` | 切档脚本（一次事务改 `tier` / `status` / `attempts_baseline` 三列） |
| `.scratch/demo-data-check.mjs` | 演示前「学习数据是否干净」的只读报告（一行都不删） |
| `.scratch/demo-llm-latency.mjs` | 量每轮耗时的脚本（官方通道 3011 / 默认通道 3001） |
| `.scratch/probe-focus-17.json` | U-1 的五轮焦点取证（修复前） |
| `.scratch/qa/probe-latency2.py` | 真实回合耗时（n=8，median 3.2s，max 5.2s） |

### 复跑全部套件

```bash
cd apps/web
PLAYWRIGHT_OUTPUT_DIR=../../.scratch/pw-qa-$(date +%s)   npx playwright test --config=../../.scratch/qa/playwright.config.ts --reporter=list
```

`--output` 是必需的：并发跑会用同一个 `test-results` 目录互相清 trace，
导致「找不到截图」这类假失败。

---

## 八、三档每轮耗时（演示话术节奏的依据）

用**官方演示 key**（`DEMO_LLM=1`，起在 3011，不动 3001 的默认通道）与默认通道
各打 4 轮 `/api/v1/agent/turns`，wall clock 毫秒，含网络与排队。会话 id 每档独立
（避免同会话第 2 轮起命中缓存把数字量得过于乐观）。

| 档 | 官方 key min / median / max | 默认通道 min / median / max |
|---|---|---|
| P1 | 1169 / **1808** / 1963 ms | 4261 / **6373** / 8535 ms |
| P2 | 1217 / **1421** / 1767 ms | 3953 / **5928** / 36008 ms |
| P3 | 1258 / **1361** / 1798 ms | 3171 / **4180** / 5032 ms |

**话术节奏**：官方 key 下每轮约 **1.4–1.8 秒**，可以连着说、不用刻意填话；
默认通道 median **4.2–6.4 秒**、最坏一次 **36 秒**（P2 第 1 轮），现场等这么久
观众会以为卡死。所以演示**必须**用 `DEMO_LLM=1`。

**首轮更慢是正常的**：官方通道第一次跑时 P1 #1 用了 16143ms（冷启动），
之后稳定在 1–2 秒。预热一轮再开始录。

复跑：

```bash
node .scratch/demo-llm-latency.mjs 3011 4   # 官方 key（需先起 DEMO_LLM=1 的实例）
node .scratch/demo-llm-latency.mjs 3001 4   # 默认通道，做对比
```
