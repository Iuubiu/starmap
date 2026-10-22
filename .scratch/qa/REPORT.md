# 浏览器深度验收报告（票 20 / t43）

**证据等级：假设生成。** 本报告的全部结论来自本机开发环境的真实浏览器
（Playwright + Chromium，web `http://localhost:5173`，api `http://127.0.0.1:3001`）
与真实数据库，**未做任何生产环境验证**。所有「已修复」都附了可复跑的命令与
反向验证；所有「未修复」都写清了为什么不修。

**不宣称可用性达标。** 本报告证明的是「下面这些具体路径在真人手里会 / 不会卡住」，
不是「产品可用了」。20 个场景全绿也只说明这 20 条路走得通。

**当前套件状态（2026-10-22 17:26 复跑）**：

| 套件 | 结果 |
|---|---|
| `00-patrol.spec.ts` + `01-home.spec.ts` + `02-stages-s2-s5-s9.spec.ts` | **17 passed**（3.6 分钟） |
| `03-twenty.spec.ts` | **21 passed / 0 failed / 0 skipped**（2.6 分钟） |
| 合计 | **38 passed**，无 skip |

早先的 `18 passed / 2 failed / 1 skipped` 已全部消解，三条的来龙去脉见第四节：
两条红是共享库被清空导致的前置数据缺失（场景自己造数后转绿），一条 skip 是
U-1 的 `test.fixme`（t56 修复后解禁，断言零改动转绿）。

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
`01-home.spec.ts`（首页四场景）、`03-twenty.spec.ts`（20 个使用场景矩阵）。

复跑（**必须带 `--output`**，否则并发 run 会互相清空 `test-results`；
配置在 `.scratch/qa/playwright.config.ts`，`baseURL` 是 `http://localhost:5173`）：

```bash
cd apps/web
PLAYWRIGHT_OUTPUT_DIR=../../.scratch/pw-qa-$(date +%s)   npx playwright test --config=../../.scratch/qa/playwright.config.ts --reporter=list
```

---

## 二、已修复（含反向验证）

### 1. 【blocker】知识地图画布一整块纯色，5495 个节点全部不可见

- **现象**：`/map` 打开后画布是一整块均匀的浅灰，没有任何点；控制台无报错。
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
代码里正在被移除，**这不是回归，是产品决定**。接手的票：

| 票 | 负责什么 |
|---|---|
| **t69** | 删掉 `ArtifactCard.tsx:211` 的「进入关卡」按钮，改成触发浮层的状态机 |
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

## 三、未修复的问题及原因

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
  跑会改同一批表，断言里的计数可能抖动。
- **为什么不修**：本套件被要求「跑已经在跑的开发服务」（不起独立 DB），
  隔离只能靠 `workers: 1` + 只读优先的写法。已在本报告里如实标注。

---

## 四、20 个使用场景矩阵（`03-twenty.spec.ts`）

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

## 五、过程中的方法论更正（留给下一个人）

1. **「页面上出现过某个词」不能当断言**。17 号场景最初断言
   `/布尔/`，而学习者自己那句话会被学习日志原样回显 —— 断言永远绿。改成断言
   「当前知识点」那一行之后才暴露出 U-1。**同理**：图例的「未学 3083/3086」
   里那个 3086 是**这一档**的全图数，不是节点总数；把 3083 当总数会与接口差 3
   （这是我自己写错的断言，不是产品缺陷）。
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

---

## 六、可复跑的证据清单

| 文件 | 内容 |
|---|---|
| `.scratch/qa/scenarios/00-patrol.spec.ts` | 8 页巡检 |
| `.scratch/qa/scenarios/01-home.spec.ts` | 首页四场景 |
| `.scratch/qa/scenarios/02-stages-s2-s5-s9.spec.ts` | S2 / S5 / S9 |
| `.scratch/qa/scenarios/03-twenty.spec.ts` | 20 场景矩阵（含 17b） |
| `.scratch/qa/scenarios/_helpers.ts` | 造数 helper（`ensurePlacementHistory` / `ensureMasteryEvidence`）与诊断工具 |
| `.scratch/qa/shots/_twenty-results.json` | 20 场景的机读结果 |
| `.scratch/qa/shots/scene-*.png` | 每个场景的截图（文件名见第四节表格） |
| `.scratch/probe-focus-17.json` | U-1 的五轮焦点取证（修复前） |
| `.scratch/qa/probe-latency2.py` | 真实回合耗时（n=8，median 3.2s，max 5.2s） |
| `.scratch/starmap-core/issues/03-knowledge-graph-map.md` §7 | `layout.ts` 的 `RENDER_SYNC_MS` 改动的归属、改前改后数字与反向验证 |

### 复跑全部四套

```bash
cd apps/web
PLAYWRIGHT_OUTPUT_DIR=../../.scratch/pw-qa-$(date +%s)   npx playwright test --config=../../.scratch/qa/playwright.config.ts --reporter=list
```

`--output` 是必需的：并发跑会用同一个 `test-results` 目录互相清 trace，
导致「找不到截图」这类假失败。
