# 16: AI 批量生成与校验关卡

**What to build:** 按知识点批量生成关卡：多线程跑、结构化校验、失败降级、全部幂等。生成的题**只进练习池**，不进判定池。

**Blocked by:** 14

**Status:** ready-for-agent

- [x] 用 Mastra Workflow 的 `.foreach(spec, { concurrency: 4 })` 批量生成，可后台跑并观察进度
- [x] 每一步幂等：重复执行不产生重复关卡；崩溃恢复重跑不会写坏数据
- [x] 每个产物过 Zod 结构化校验；失败走 `fallback` 而不是让整批失败
- [x] **AI 生成的关卡只进 `practice` 池**；进判定池必须经规则校验或人工过——这条有硬测试
- [x] 生成失败时记录具体失败原因（schema 非法／缺字段／语言不合规），可汇总查看

## Comments

> **读的时候注意时间线**：下面「真实批量生成实测」记的是**第一轮**（12 张）的过程与
> 成功率，那 12 张关卡**已经被删掉重生成**了 —— 它们全部挂在非叶节点上，
> 不产生掌握度。当前库里的 6 张、以及 `gating.mode` 的修正，见文末
> 「数据修正（2026-10-21）」一节。两处数字不同不是矛盾，是先后。

### 真实批量生成实测（走 `https://d1api.xin/v1`，模型 `deepseek-v4.1-flash`）

跑法：`cd apps/api && npx tsx .probe/real-generation.ts <N>`。脚本走的是与
`GenerationController` 完全相同的服务路径（`GenerationService` +
`createGenerationWorkflow`），只是不经过 HTTP 层 —— 要的是真实模型、真实落库、
真实耗时。

| 批次 | 知识点数 | 成功 | 失败 | 总耗时 |
| --- | --- | --- | --- | --- |
| 第一次（密钥无效） | 4 | 0 | 4 | 42.9s |
| 第二次 | 4 | 4 | 0 | 8.0s |
| 第三次 | 8 | 8 | 0 | 22.7s |

**合计 12/12 成功，成功率 100%（密钥可用之后）。** 每个知识点 1 道题，单条
耗时 5.2–20.8s（同一批内 4 并发，所以总耗时接近最慢那条）。

库内取证（跑完后直接查库，不是看日志）：

```
AI 关卡 12 张：全部 author=ai、每张 1 题、pools=practice
level_items 池归属：practice=12
生成运行 5 次：failed 1（密钥无效那次）/ succeeded 4（含两次幂等重跑）
任务状态分布：succeeded 24 / failed+llm_error 4
AI 关卡里不在 practice 池的题：0 条
```

24 条 succeeded = 12 张关卡 × 2（每批都跑了两遍验幂等），所以**幂等重跑没有
新建任何关卡** —— 12 个知识点最终就是 12 张，不是 24 张。

**第一次 4/4 失败是真实的失败路径取证，不是环境噪音。** 当时 `.env` 里
`LLM_API_KEY` 为空，上游返回 `401 {"error":{"message":"Invalid token",...}}`，
四条全部记为 `failure_kind = llm_error`，失败原因是上游原话（含 request id），
四条各自的耗时 42.7–42.9s 都被记下来 —— 这正是验收③⑤要的行为：**单条失败不
让整批崩，原因具体到可搜。** 换用可用密钥后同一份代码 12/12 通过，说明失败
分类不是「什么错都叫 llm_error」的兜底。

（补记：401 的根因不只是 `LLM_API_KEY` 空，而是**`.env` 从未被任何代码加载**
—— `main.ts` 没引 dotenv、`dev` 脚本也不带 `--env-file`，所以它永远是空串。
captain 已给 `apps/api/package.json` 的所有入口加 `--env-file=../../.env`
（Node 26 原生）。这个坑值得记住：**配置文件存在 ≠ 配置被读取**，
一条 `curl` 打 401 时先确认进程里真的拿到了值，再去怀疑密钥本身。）

### ⚠️ `@mastra/core` 的 Workflow 层没有 `errorStrategy`（适配器差异，会反复踩）

任务描述要求「每条产物过 Zod 校验 + `errorStrategy: 'fallback'` 兜底」。实测
结论：**这个选项在 Workflow 层不存在。** grep 全部 `@mastra/core/dist`，只有
`ModelErrorStrategy = 'strict' | 'warn' | 'fallback'`，它属于 agent 的结构化
输出/processors，`createWorkflow` / `createStep` / `.foreach` 都不接受它。

更要紧的是第二条：**单个 `.foreach` 条目抛错会让整批 `status = 'failed'`。**
失败那条在 `res.steps.work.payload`，成功条目的输出被塞进
`res.steps.work.suspendPayload.__workflow_meta.foreachOutput[]`，
但 `run.start()` **不返回**可用的结果数组。也就是说，指望 Workflow 层兜住
单条失败是行不通的 —— 一条坏数据会毁掉整批已成功的产物。

所以本票的 fallback 全部实现在 **step 内部**：`generate` 的六段（取材料 /
调模型 / 解析 JSON / Zod 校验 / 组装关卡 / 落库）各自 try/catch，**每条失败都
`return` 一个结构化结果而不是 `throw`**，workflow 因此永远看到「成功的数组」。
第一次真实运行 4/4 全失败时整批没有崩、四条原因各自可查，就是这条路径的现场
取证。

另外两条同源实测（免得下一个人再摸一遍）：

- `workflow.start()` **不存在**。要 `const run = await wf.createRun({runId});
  await run.start({inputData})`。
- `.foreach` 要求**上一步返回数组**；`ForeachOptions` 只有 `{ concurrency }`
  （可以是 number 或 resolver），没有重试、没有超时、没有错误策略。超时得自己
  在 step 里用 `AbortController` + `signal` 做（本票的 `completeWithTimeout`
  就是这么写的，用 signal 而非 `Promise.race`，好让底层 fetch 真被取消）。

### 批次内的验收取证

- **验收④（只进 practice）**：跑完后对每个生成关卡的 `level_items` 逐行核对，
  12 张关卡的题**全部** `pool = practice`。除了校验器里的 superRefine 与
  `level-assembly.ts` 里 `pool: 'practice' as const` 这层，迁移 `0041` 还加了
  DB 触发器 `levels_ai_practice_only`：`meta.author = 'ai'` 的关卡若要写入
  非 practice 的题，直接在库层 `RAISE EXCEPTION`。三层各自独立，绕开任何一层
  都还有下一层。
- **验收②（幂等）**：每批跑完立刻再跑一遍同样的知识点。`lv-ai-<microKpId>` 是
  确定性 id，`ON CONFLICT (id) DO UPDATE` + `level_items` 先删后插，所以第二遍
  结束后这 N 个知识点的 AI 关卡仍然恰好是 N 张（实测 4→4、8→8），没有重复。
- **验收①（可观察进度）**：`level_generation_task` 每条的 `status` /
  `started_at` / `finished_at` / `failure_*` 都在跑的过程中逐个更新，
  `GET /api/v1/market/generations/{runId}` 前端每 1s 轮询，跑到终态自动停。

### 一处如实记录的限制

当前每条产物是**一个知识点 → 一道题 → 一张关卡**（`assembleLevelSpec` 里
`questions: [parsed.question]`）。一次模型调用只要求产出一个 JSON 对象，是
刻意的：让「一次调用 = 一道题」使失败粒度与重试粒度都停在单题上，不会出现
「出了 4 道题、第 3 道校验失败，前两道要不要留」这种半成品状态。代价是
「每关题量」目前偏少（1 道）。要变成一关多题，扩 `question-prompt.ts` 的
输出模板与 `assembleLevelSpec` 的入参即可，不牵动幂等与池归属的任何逻辑。

### 数据修正（2026-10-21）：12 张早期关卡全挂在非叶节点上，已清掉重跑

上面「真实批量生成实测」那三批（12 张）产出的关卡**挂错了知识点层级**：
它们全部指向 `is_leaf=false` 的「小结 / 习题」容器节点。这是 `pickTargets`
修复（见下节）**之前**的产物 —— 当时的排序末位是 `kp.ordinal, kp.id`，
而章末「小结 / 习题」节点的 `ordinal` 是默认值 0，永远赢过正常节点的 1。

**为什么这不只是「内容不理想」，而是功能失效**：`attempts.service.ts:167-203`
对非叶节点「作答照样落库，但掌握度只能走聚合读路径」，不写 `mastery` 行。
也就是说这 12 张关卡做了也不产生任何掌握度 —— 票 16 的验收「生成的关卡能被
学习者用起来」在这一层是空的。

**处置：删除而不是标记 invalid**（三条理由）：
1. `levels` 表没有 validity 列，标 invalid 要改表结构；而验收要求
   `levels_on_nonleaf = 0`，只要行还在就仍是 12。
2. `level_generation_task.failure_kind` 的 CHECK 枚举里没有 invalid，
   要标就得为一次性数据修正扩生产枚举。
3. 取证结论是可安全删除：`attempts` 引用 0、`node_unlocks` 指向 lv-ai-* 的 0、
   `level_market` 引用 0（只有 `level_items` 12 行与 `generation_task` 24 行随级联走）。
   **知识点一行没动** —— `kp-*-小结 / 习题` 是合法的内容容器，chunk 还挂在上面。

删除前整份导出到 `.scratch/lv-ai-defect-dump.json`（levels 12 / items 12 /
runs 5 / tasks 28），`.scratch/` 已 gitignore。执行时顺序是**先删
`level_generation_run`（task 随 run_id 级联）再删 `levels`（items 随 level_id
级联）** —— 反过来会让现存 task 的 `level_id` 被 `ON DELETE SET NULL` 置空，
留下「成功但没有关卡」的假记录。

**重跑结果（走 `POST /api/v1/market/generations`，concurrency 4，真实 d1api）**：

| 项 | 值 |
| --- | --- |
| 新生成关卡 | **6** |
| `levels_on_nonleaf` | **0** |
| `levels_on_leaf` | **7**（6 张 AI + `lv-bool-laws`） |
| 每张关卡 `itemCount` | **1** |

挑中的 6 个都是真实内容节点（不是「小结 / 习题」）：
`kp-tangbin-1-2 放射性衰变和衰变规律`、`kp-dinghonglin-2010-10-4 碲锌镉核辐射探测器`、
`kp-tangbin-6-7 射线测量方法的应用`、`kp-tangbin-5-2 α，β射线样品的活度测量方法`、
`kp-dinghonglin-2010-2-4 中子的探测方法`、`kp-chenboxian-2011-8-2 电离室`。

跑了两轮，因为第一轮之后又改了 `gating.mode`（见下一节）：
- `run-7accbc1c-…` → `succeeded 6/6`，7.0s（`gating.mode='exit'`）
- `run-4a0a43e2-…` → `succeeded 6/6`，7.0s（`gating.mode='none'`，**库里当前是这一版**）

两轮都是同一个确定性 id `lv-ai-<microKpId>`，所以第二轮是**覆盖**第一轮，不是新增 ——
全库 AI 关卡始终是 6 张。6 张全部 `is_leaf=true`、`spec.items=1` /
`level_items=1` / `pool=practice=1`、`sourceRef` 6/6 能 join 回 `app.chunks`，
并且 **6/6 通过 `validateLevelSpec`**（跑的是 `packages/shared` 里的真源，不是副本）。
`GET /api/v1/levels/<id>` 也能取回可播放的 spec。

### `pickTargets` 的排序修正：材料量进 tiebreak、0 材料变成硬前置

原排序是「① 该 kp 的 AI 关卡数 ② 最久没生成 ③ `kp.ordinal` ④ `kp.id`」。
第 ①② 顺位在「全都没生成过」时完全并列，实际由 ordinal 决定 —— 而 ordinal
没有区分力（噪声节点默认 0、正常节点 1）。改成：

```sql
SELECT kp.id
  FROM knowledge_points kp
  CROSS JOIN LATERAL (
        SELECT count(*) AS n
          FROM chunks c
         WHERE c.micro_kp_id = kp.id
           AND c.kind IN ('text', 'formula')
           AND length(c.text) >= $2
      ) material
 WHERE kp.is_leaf
   AND material.n > 0
 ORDER BY
   (SELECT count(*) FROM levels lv WHERE lv.micro_kp_id = kp.id AND lv.id LIKE 'lv-ai-%') ASC,
   (SELECT max(t.finished_at) FROM level_generation_task t
     WHERE t.micro_kp_id = kp.id AND t.status = 'succeeded') ASC NULLS FIRST,
   material.n DESC,
   kp.ordinal, kp.id
 LIMIT $1
```

两处改动的理由各不相同：
- **`material.n DESC` 插在 ordinal 之前**：「材料多的先出题」是内容驱动的判据，
  换一本教材自动成立；「ordinal 小的先出题」是位置驱动的判据，除了「排前面」
  没有别的含义。把「小结 / 习题」硬编码进生成逻辑是最差选择 —— 那等于把数据
  缺陷固化成代码。
- **`material.n > 0` 是 WHERE 硬前置，不是排序项**：挂 0 个 chunk 的节点生成
  出来必然是模型凭空编的题，违反「每条内容可溯源到教材」的红线。排到后面不够，
  必须根本不出现。
- 用 `CROSS JOIN LATERAL` 而不是在 ORDER BY 里再写一遍子查询：算一次，
  否则两处判据迟早漂移。

两条回归测试锁住这个行为（`generation.service.test.ts`）：
`pickTargets 按材料量排序：ordinal 更小但材料更少的排在后面`（ordinal 0/1 chunk
vs ordinal 1/3 chunk，断言后者在前 —— 与 ordinal 大小正好相反）、
`pickTargets 把「零材料」当硬前置，而不是只排到后面`（ordinal 0/0 chunk vs
ordinal 9/1 chunk，断言前者根本不在结果里）。

真实库复核（只跑 `pickTargets`，不重跑生成）：挑中 12 个里噪声节点从
**12/12 降到 1/12**（残留的 `kp-p501-习题` 材料 113 片，是全库最多的 ——
材料量判据本身如实，不是「一定避开噪声」）。

### ⚠️ `gating.mode` 从 `'exit'` 改成 `'none'`：1 题关卡会把下游锁死

这是数据修正过程中发现的**产品层缺陷**，比「面板上多一句提示」严重得多。

`packages/engine/src/gating.ts:28-31` 的 `GATE_RULES` 是写死的：
`exit = { itemCount: 8, passCount: 7 }`、`prereq = { itemCount: 10, passCount: 9 }`。
`gating.service.ts:333-338` 的 `ruleFor()` 对 exit / prereq **直接返回
`GATE_RULES[mode]`，忽略 spec 里声明的 `itemCount`/`passCount`**。而
`assembleLevelSpec` 一次只产 **1 道题**，于是这张关卡算出来的判定永远是
`undetermined / insufficient_items`。

**真正的后果**：`gating/repository.ts` 的 `gatedPrerequisites` 按
`lv.ordinal, lv.id` 取先修知识点的**第一张**关卡当作门；AI 关卡的 ordinal
从 0 起算，很容易就是第一张。于是它把下游节点锁死，而学习者做满也只有 1 道题、
永远达不到 8 题。

**这个后果是实测出来的，不是推断**：临时把 `lv-ai-kp-chenboxian-2011-8-2`
的 `gating.mode` 单独翻转（spec 其余部分逐字节不变），问同一句 HTTP，然后
在 `finally` 里把整份 spec 原样写回：

```
原始 gating: {"mode":"none","itemCount":1,"passCount":1}
修后（库里 mode=none）→ 200 {"microKpId":"kp-chenboxian-2011-8-3","unlocked":true,"blockers":[]}

已临时改成 gating: {"mode":"exit","itemCount":1,"passCount":1}
修前（临时 mode=exit）→ 200 {"microKpId":"kp-chenboxian-2011-8-3","unlocked":false,
  "blockers":[{"prerequisiteId":"kp-chenboxian-2011-8-2","prerequisiteName":"电离室",
    "levelId":"lv-ai-kp-chenboxian-2011-8-2","levelTitle":"电离室·AI 练习",
    "gateMode":"exit","lastVerdict":null,"shortfall":null,"lastAttemptedItemIds":[]}]}

已恢复 gating: {"mode":"none","itemCount":1,"passCount":1}
恢复后 → 200 {"microKpId":"kp-chenboxian-2011-8-3","unlocked":true,"blockers":[]}
```

一个字段的差别 = 下游节点永久进不去。脚本 `.scratch/flip-gating-measure.mjs`
（已 gitignore），恢复后复查过 spec 与原值逐字段相同。

一共只有 2 条先修边指向「第一张关卡是 lv-ai-*」的知识点
（`kp-chenboxian-2011-8-2 → kp-chenboxian-2011-8-3`、
`kp-tangbin-1-2 → kp-tangbin-1-5`），两条都会被永久拦住。

**修法**：`assembleLevelSpec` 的 `gating.mode` 改成 `'none' as const`（和
`pool: 'practice'` 一样是字面量，不接受参数）。`unlockStateWith` 对
`mode === 'none'` 直接跳过这道门，下游恢复可解锁。修复后实测：

```
GET /api/v1/nodes/kp-chenboxian-2011-8-3/unlock → {"unlocked":true,"blockers":[]}
GET /api/v1/nodes/kp-tangbin-1-5/unlock          → {"unlocked":true,"blockers":[]}
```

语义上也更对：AI 生成的内容只进 practice 池（验收④），**练习内容不该决定
谁能解锁下一个知识点** —— 那是核心判定内容 + 人工复核的事。

**顺带记一条给下一个人**：`GATE_RULES.exit` 是 8 题 ≥7，所以**任何**题量
少于 8 的关卡都不该声明 `gating.mode: 'exit'`，它会静默变成一道永不开启的门。
要么攒够 8 题，要么用 `'none'`。

### `sourceRef` 有两种语义，不是数据坏了

- **AI 生成的关卡**：`sourceRef` 是 **chunk id**（如
  `ck-nuclear-radiation-measurement-tangbin-0024-12-cbaa7fd2ec13`），因为它出题时
  唯一可信的溯源就是喂给模型的那几段教材片段。6/6 都能
  `JOIN app.chunks ON chunks.id = sourceRef`。
- **手写关卡 `lv-bool-laws`**：`sourceRef` 是**引用文本**
  （`康华光·数字技术基础·数字部分·第5版·表 2.1.1`），因为作者引的是书。

`packages/shared/src/domain/level.ts` 的 schema 两者都允许（`sourceRef: string | null`），
所以这不是 bug。但**下游若要做「点开出处」功能，要按关卡来源分流**：
AI 关卡拼 `/api/v1/...chunks/{id}`，手写关卡只能展示文本。

### AI 关卡不参与出口门控（设计决定，不是缺陷）

由上面两条共同决定：题量 1 < `GATE_RULES.exit.itemCount = 8`，且
`gating.mode` 是 `'none'`。

- 这些关卡**只能当练习**，永远不能当出口门控。
- 它们**计入掌握度**（`attempts.service.ts` 的 `countsTowardMastery` 只看步骤类型
  不看 `level_items.pool`，AI 关卡的题在 `quiz` 段 → 计入）。
- 要变成可当门控的内容，得先让 `assembleLevelSpec` 一次产 8–10 道题，再把
  `gating.mode` 改回 `'exit'` 并把 `ruleFor()` 改成尊重 spec 声明的题量
  （现在它不尊重）。这两件事要一起做，只做一件都会留下静默失效的门。
