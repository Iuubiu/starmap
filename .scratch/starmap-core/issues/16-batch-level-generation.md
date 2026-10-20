# 16: AI 批量生成与校验关卡

**What to build:** 按知识点批量生成关卡：多线程跑、结构化校验、失败降级、全部幂等。生成的题**只进练习池**，不进判定池。

**Blocked by:** 14

**Status:** ready-for-agent

- [ ] 用 Mastra Workflow 的 `.foreach(spec, { concurrency: 4 })` 批量生成，可后台跑并观察进度
- [ ] 每一步幂等：重复执行不产生重复关卡；崩溃恢复重跑不会写坏数据
- [ ] 每个产物过 Zod 结构化校验；失败走 `fallback` 而不是让整批失败
- [ ] **AI 生成的关卡只进 `practice` 池**；进判定池必须经规则校验或人工过——这条有硬测试
- [ ] 生成失败时记录具体失败原因（schema 非法／缺字段／语言不合规），可汇总查看

## Comments

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
