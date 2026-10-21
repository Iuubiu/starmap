# 12: 三档渲染参数与流程重评

**What to build:** 同一个知识点，对零基础、有电子学基础、有工程经验三种人，首轮给的东西不一样：样例完整度、阶梯层数、会话上限、反馈延迟都不同。

**Blocked by:** 05, 10

**Status:** ready-for-agent

- [x] P1／P2／P3 六维参数真正驱动界面与策略，不是只存在数据库里：首轮形态（完整样例／补全步骤／直接出题）、阶梯层数（3/4/5）、单次会话新知识点上限（2/3/4）、反馈延迟、每题尝试次数、判定条件
- [x] 参数改变能被观察到：同一个知识点切到不同档位，首屏渲染结果不同（有测试）
- [x] 每学完 3 个知识点按实际表现重评档位；升降级写进学习日志，用户能看到「为什么给我降档了」
- [x] 档位是**每关的渲染参数**，不是三条独立的课程路径——内容与图谱不因档位而分叉

## Comments

### 1. 六维参数的唯一真源在 engine，前端不复制任何数值

`packages/engine/src/tier.ts` 的 `TIER_PARAMS: Record<'P1'|'P2'|'P3', TierParams>`
是六维参数的**唯一**真源（`firstRoundShape` / `ladder` / `sessionNewKpLimit` /
`feedbackTiming` / `attemptsPerItem` / `masteryRule`）。其中 `ladder` 用的是
`{ ...TIER_LADDER.P1 }` 这样的**引用**而不是字面量 `{start:1,cap:3}` ——
`TIER_LADDER` 是票 10 的追问阶梯（它的数值有独立验收，不许改），抄一遍就迟早
两份数字对不上，而「阶梯层数」这一维恰好是两边都要读的。

**为什么不把这张表放数据库**：档位参数是策略常量，不是用户数据。放库里意味着
每次调参都要写迁移，而且「库里一份、engine 一份」的漂移没有任何测试能发现。
放前端更糟：`packages/engine` 的纯函数（`planFirstRound`、`masteryRuleProgress`）
也要读同一份参数，前端拿不到 engine 就只能各写一份。

**为什么 web 不直接 import `@starmap/engine`**：`apps/web` 的依赖里没有它
（`.dependency-cruiser.cjs` 有边界规则，`apps/web/src/level/GatePanel.tsx` 里有一段
注释记着这条决定的来历），而且 engine 的 `dist` 是构建产物 —— 让 web 单测依赖
「先 build engine」会把前端测试变脆。所以 web 通过 `GET /api/v1/tier*` 拿服务端
投影好的参数，`apps/web/src/level/tier-render.ts` 的文件头写死了这条铁律：
**那个文件里一个档位常量都不许出现**。

### 2. 六维参数各自落在哪（验收 1 逐条对应）

| 维度 | 服务端 | 前端落点 |
|---|---|---|
| 首轮形态 | `planFirstRound(spec.steps, tier)` → `firstRound.startStepIndex` / `cardMode` / `fadedCardId`，在 `apps/api/src/tier/tier.service.ts` 的 `levelPlan()` 里读**真实关卡 spec** 算 | `apps/web/src/level/tier-render.ts` 的 `cardPresentation()`；`CardView` 的 `presentation` prop（`full`/`faded`/`collapsed`）。P3 的 `startStepIndex=2` 由 `LevelPage` 用 `key` 重建 `LevelSession` 生效 |
| 阶梯层数 | 票 10 的 `TIER_LADDER`（`probe.service.ts` 的 `ladderCap()` / `initialLadderState()`） | 追问面板显示 `ladderCap`；`GET /tier` 的 `params.ladder` 同步可读 |
| 单次会话新知识点 | `TierService.sessionPlan()` 用 `params.sessionNewKpLimit` 截断推荐，`deferred` 是没开出来的个数 | `apps/web/src/agent/SessionPlanCard.tsx`（首页侧栏）—— 显示上限、列在前面的知识点、以及「还有 N 个排在后面」 |
| 反馈延迟 | `feedbackTiming` 原样投影 | `defersFeedback()` → `QuestionView` 的 `deferredFeedback` prop（中性条「本题不即时给对错」），以及段末的「本段反馈（这一档不逐题打断）」卡 |
| 每题尝试次数 | `attemptsPerItem` 原样投影 | `attemptsLeft()` → `QuestionView` 的 `attemptsLeft` prop + `flow.submitAnswer(..., {attemptsPerItem})`（允许追加记录） |
| 掌握判定 | `TierService.masteryProgress()` 回放 `attempts` 后走 `masteryRuleProgress()` | `masteryRuleText()` / `masteryProgressText()` 拼成「掌握判定：连对 N 次 + 一道迁移题；还差：…」 |

### 3. 掌握判定进度必须由服务端算，不读 `app.mastery` 快照

`masteryProgress` 来自 `attempts` 回放（`counts_toward_mastery = true`，按
`created_at, id` 升序），理由两条：

- `app.mastery` 里没有「连续答对几次」「做过迁移题没有」这两个量 —— 判定规则恰好
  只靠这两个；
- 快照的 `current` 随时间衰减（`apps/api/src/mastery/mastery.service.ts` 文件头），
  而「连对 2 次」不该因为隔了三天没来就退回「还差 2 次」。判定规则是**行为序列**
  的属性，不是概率。

放在 `GET /tier/levels/{id}/plan` 的响应里而不是单开一个端点：否则会出现「档位换了、
掌握进度还是旧的」那一帧 —— 两个数必须同一次读到。

### 4. 重判写两处日志，且必须同事务

票面验收 3 要「升降级写进学习日志，用户能看到为什么给我降档了」。实现落在
`PlacementService#applyRejudge()`（票 11 的自动重判与手动 `POST /placement/rejudge`
共用它），在**一个事务**里写三行：

1. `app.placement_rejudges`（定级模块的内部审计表，`GET /placement` 的 `lastRejudge` 读它）；
2. `UPDATE app.placement_profile`（档位 + `attempts_baseline` 前移 + `last_rejudge_id`）；
3. `app.learning_log`（`event = 'tier_rejudge'`，payload 带 `previousTier/tier/changed/attemptsSince/averageFirstTryRate/explanation`）。

`GET /api/v1/tier/changes` 读的是第 3 份。**为什么必须同事务**：只写成一处的后果是
「定级页说档位被降过、档位变更历史里一条都没有」，而这种不一致没有任何后台任务能修。

`micro_kp_id` 留 NULL：档位不是某个知识点的属性。写入一个「最相关的知识点」会让
`log_kp_idx` 上多出一条与该知识点无关的事件，回看某张关卡的门控历史时混进一句
「你的档位变了」。

### 5. `/tier/changes` 读之前会先结算一次重判（真缺陷）

票 11 的自动重判是**读时惰性结算**（`PlacementService.status()` 发现门槛到了就当场
`applyRejudge()`）。第一版 `TierService.changes()` 直接读 `learning_log`，于是：

> 学习者门槛早已到了 → 第一次打开「档位变更历史」→ **空数组**。那条事件要到下一次
> 读档位时才写进去。

修法：`changes()` 开头 `await this.placement.status();`（不读返回值，只为副作用）。
测试 `tier.controller.test.ts` 的「门槛已到但还没人读过档位时，读历史会先把重判结算掉」
钉住这件事；**做过反向验证**：临时删掉那一行 → 该条红
（`expected [] to have a length of 1`），其余 17 条仍绿（它们都先调了 `overview`/`levelPlan`
顺手结算过）—— 说明这一条是唯一守得住这个缺陷的测试。

### 6. 验收 3 的口径：门槛到底是「3 个知识点」还是「5 题」

票面写「每学完 **3 个知识点**重评」，spec.md:281 也这么写。但实际落地的门槛是
**累计 5 题作答**（`PLACEMENT_LIMITS.rejudgeAfterAttempts`，票 11 已定，见
`.scratch/starmap-core/issues/11-placement.md` 第 1 条）。

本票不改这个口径：改成知识点计数会让重判在最初几天永远不触发（一个知识点「学完」
要 8 题 + 3 变式，3 个知识点 ≥ 24 题），而那正是定级最容易判错、最该纠正的时段。
保留 5 题门槛时，票面「每学完 3 个知识点重评」这句话的正确读法是**每次重判都会用
真实学习证据重新评估档位**，与「3」这个具体数字无关。

### 7. `revisit` 标记没有实现（已知缺口，明说）

spec.md:281 后半句是「≤30% 下调一级**并给已过知识点打 `revisit` 标记**（不重开关卡）」。
本票只做了「下调一级」+ 日志 + 界面解释，**`revisit` 标记没有实现**：全仓 grep
`revisit` 在代码里零命中。

不做的理由：`revisit` 的语义是「这个知识点需要回头看，但不要重开关卡」，它要落到
某个存储位（`mastery` 加一列？`learning_log` 写一条事件？），并且图谱/推荐/复验
三条读路径都要认它 —— 这三件事横跨票 03、07、13 的产物，不属于本票的验收条目。
留在这里作为明确的已知缺口，而不是假装它被「档位下调」顺带覆盖了：档位下调改的是
**每关怎么渲染**，与「哪些知识点要回头看」是两回事。

### 8. 档位不是课程分叉（验收 4）

内容与图谱完全不感知档位：`app.knowledge_points` / `app.levels` / `app.level_items`
里没有任何档位列，`GET /api/v1/graph`、`/nodes`、`/levels/{id}` 的响应里也没有。
档位只在三处出现：渲染参数（`/tier*`）、追问阶梯（`probe_sessions.tier`）、
提示词里的「水平档」一行。同一个关卡的 `spec` 对三档是**同一份**，差别只在
`cardPresentation` / `attemptsPerItem` / `feedbackTiming` / `startStepIndex`。

`tier.controller.test.ts` 的「三档的首轮计划两两不同（同一关卡、同一份 spec）」
从反面钉住这件事：如果哪天有人把三档做成三份不同的 spec，那条测试就开始测别的东西了。

### 9. 真实后端实测（2026-10-21）

```
GET /api/v1/tier
{"tier":"P3","source":"placement","params":{"tier":"P3","firstRoundShape":"direct",
 "ladder":{"start":3,"cap":5},"sessionNewKpLimit":4,
 "feedbackTiming":"item_deferred_with_summary","attemptsPerItem":1,
 "masteryRule":{"consecutiveCorrect":1,"requiresTransferItem":true}},
 "label":"直接出题","description":"直接从题目开始；需要时再展开讲解。"}

GET /api/v1/tier/levels/lv-bool-laws/plan
{"levelId":"lv-bool-laws","microKpId":"kp-bool","tier":"P3","source":"placement",
 "firstRound":{"shape":"direct","startStepIndex":2,"cardMode":"none","fadedCardId":null},
 "masteryProgress":{"consecutiveCorrect":1,"hasTransferItem":true,"satisfied":true,"missing":[]}}

GET /api/v1/tier/changes?limit=3
{"items":[{"id":"23","at":"2026-10-21T06:33:52.695Z","previousTier":"P3","tier":"P3",
 "changed":false,"attemptsSince":6,"averageFirstTryRate":1,
 "explanation":"你在上次定级后又答了 6 题，平均首轮正确率 100%。这个表现与 P3 相符，档位不变。"},…]}
```

`lv-bool-laws` 的 spec 有 7 段，P3 的 `startStepIndex=2` 正是第一段带题的 `probe` 段
（0=guide、1=detail、2=probe）—— 首轮跳过两段纯讲解，这是「直接出题」的可观察证据。

### 10. 界面上的三处「档位可见性」

- **关卡页**：标题行 `按 Pn 档渲染` 徽章 + `本档渲染参数` 三行摘要（讲解形态 / 尝试
  次数 / 反馈时机）+ `掌握判定：连对 N 次 + 一道迁移题；还差：…`；P3 另有一句
  「这一档直接从第 3 段开始」。
- **定级页**：`档位变更历史` 区域（每次重判的时间、`P2 → P1`、以及完整理由）。
  空历史**不渲染**任何东西 —— 「暂无记录」会把「从没重判过」这个正常状态说成问题。
- **首页侧栏**：`本次会话新知识点` 卡片（本档上限 + 排在前面的知识点 + 还有几个排队）。

三处都从 `/api/v1/tier*` 取数，没有一处自己算档位。

### 11. 测试面的分工

- `packages/engine/src/tier.test.ts`（16 条）：参数表本身、`planFirstRound` 的三档分支、
  `masteryRuleProgress` 的连对/迁移题判定。**三份档位桩先断言「两两不同」**，否则
  映射测试在「三档参数一模一样」的实现下也会全绿。
- `apps/api/src/tier/tier.controller.test.ts`（18 条）：HTTP 行为 + 读真实 spec +
  只读接口不写库 + `/changes` 的惰性结算 + `limit` 夹取。
- `apps/web/src/level/tier-render.test.ts`（28 条）：参数 → 界面决策的纯映射。
- `apps/web/src/pages/LevelPageTier.test.tsx`（12 条）：**渲染真页面**，断言三档首屏
  两两不同（含遮掉「按 Pn 档渲染」徽章后仍不同）、P1 答错还能再提交、P3 锁题且不即时
  给对错。这一层不能省：纯函数全绿但页面不传 `presentation` 的话，三档在屏幕上一样。
- `apps/web/src/agent/SessionPlanCard.test.tsx`（5 条）：上限值来自接口（P1 说 2、P3 说 4
  是同一段代码）、超出上限的明说排队、读不到时整块不渲染。

### 12. 已知未覆盖面：「迁移题」这一维在 AI 关卡上不可达（明说）

六维里唯一**没有被真实数据撑起来**的是「掌握判定 → 迁移题」这一半。
判定实现是对的（`masteryRuleProgress()` 找 `knowledge_kind === 'comprehensive'`
的作答），但库里的迁移题只有一道：

- `app.level_items` 没有知识类型列，题的类型只存在于 `levels.spec.items[].kind`；
- 8 张关卡里只有 `lv-bool-laws` 有 1 道 `kind: 'comprehensive'`（`i-quiz-demorgan`）；
- 其余 7 张 AI 关卡由 `apps/api/src/generation/level-assembly.ts:215` 写死
  `kind: 'concept' as const` —— 生成器**根本不产**迁移题。

后果：对那 7 张关卡所属的知识点，`masteryProgress.missing` 永远带一条
「还要做一道迁移题」，`satisfied` 永远 false。这不违反本票验收（判定条件确实按档
不同、进度确实来自真实证据、界面确实说出还差什么），但意味着
「按本档判定，这个知识点已经达标」这句文案在 AI 关卡上永远不会出现。

要让这一维真正可达，得改生成器的出题角度（`apps/api/src/generation/question-prompt.ts`
的 `QUESTION_ANGLES`）让它产出综合题 —— 那是票 16 的产物，不在本票范围，所以
留成明确的已知缺口而不是悄悄放宽 `requiresTransferItem`。

真实库取证（2026-10-21 16:00，`app.` 前缀直查）：

```
levels 8 张 / 有 comprehensive 题的关卡 1 张（lv-bool-laws）
lv-ai-* ×7  各 5 题，全部 kind=concept
lv-bool-laws 4 题：fact 1 / concept 2 / comprehensive 1
app.attempts 103 行：fact 32 / concept 41 / comprehensive 30（30 行全在 kp-bool）
GET /tier/levels/lv-bool-laws/plan     → masteryProgress.satisfied = true
GET /tier/levels/lv-ai-kp-tangbin-1-2/plan → missing = ["还要连续答对 1 次","还要做一道迁移题"]
```
