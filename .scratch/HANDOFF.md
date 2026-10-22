# StarMap 交接文档

> 生成时间：2026-10-22 03:15（Asia/Shanghai）
> 工作区：`D:\DeepSeek\starmap`
> 交接原因：用户要更换模型 / 新开对话继续

---

## 0. 一句话现状

20 张票的**功能实现已完成 19 张**（115/123 条验收已勾选），真实数据库里已有 27 本书 + 101 篇论文、7240 个知识点、96821 个内容切片。**当前阻塞的是 6 个在飞任务**（4 个内容质量修复 + 1 个浏览器深度验收 + 1 个 P0 地图缺陷），以及**最终验收票 20 还没跑完**。

**不要从头开始**。所有设计决策都已落盘成文件（见 §3），所有已交付的票都有 `## Comments` 记录取证。

---

## 1. 环境（实测，别重测）

| 项 | 值 |
|---|---|
| 机器 | Intel Core Ultra 7 155H / 32GB LPDDR5 / **无独立显卡**（Intel Arc 核显 + NPU） |
| Node | 26.x；TypeScript 7.0.2（Go 原生端口，**dependency-cruiser 必须用 swc 转换器**，否则假绿） |
| 包管理 | pnpm（workspace：`apps/web`、`apps/api`、`packages/{engine,shared,api-contract}`、`tools/{ingest,eval}`） |
| 数据库 | PostgreSQL 18.6，经 `scoop install postgresql` 装的。**Docker 不可用**（daemon 不运行、`docker compose` 子命令缺失），别试 `docker compose up` |
| psql 路径 | `export PATH="/c/Users/Yhwhy/scoop/apps/postgresql/current/bin:$PATH"`，连 `postgresql://postgres@127.0.0.1:5432/starmap` |
| 控制台编码 | **GBK**。`psql -c "…中文…"` 会崩（`invalid byte sequence for encoding "UTF8"`）。**必须把 SQL 写成 UTF-8 文件再 `psql -f`**；Python 打印中文要 `export PYTHONIOENCODING=utf-8` |
| 后端 | NestJS 12 + `@mastra/nestjs` 0.2.37，`http://127.0.0.1:3001`，业务路由 `/api/v1/*`，Mastra 面 `/api/mastra/*` |
| 前端 | React 19 + Vite + Fluent UI v9 + TanStack Query + Orval 生成客户端，`http://localhost:5173` |
| 模型 | 全部走 `LlmPort`，指向 `https://d1api.xin/v1` + `deepseek-v4.1-flash`。**API key 在 `.env` 里，不在本文档中** |
| ffmpeg | 不在 PATH。用 `python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"` |

**服务当前状态**：`api=200`、`web=200`（写文档时仍在跑）。若已停，重启方式见 §7。

---

## 2. 团队状态（AgentTeams `starmap-build`）

6 个成员，全部 `d1api/deepseek-v4.1-flash · reasoning max`：

| 成员 | 角色 | 当前任务 |
|---|---|---|
| `integrator` | 集成与共享面（契约、路由注册、提交、最终联调） | t19（票 20 最终评估）in_progress |
| `level-dev` | 关卡引擎与掌握度 | idle / ready |
| `agent-dev` | 智能体与检索 | t41（英文书答案附录识别）in_progress |
| `content-dev` | 内容管线（OCR、知识抽取、视频） | t42（译名词典补齐）in_progress |
| `authoring-dev` | 自制关卡与市场 + 浏览器验收 | t43（浏览器深度验收）in_progress |
| `graph-dev-2` | 知识图谱可视化 | t40（英文书页偏移/孤儿 chunk）in_progress → 接着 t44（地图 P0） |

**新会话要做的第一件事**：`agent_teams_status` 看实际状态。**如果成员全部 idle 而任务还 pending，用 `agent_teams_reassign_task` 重派**（不能只 create_task，创建不会唤醒）。

---

## 3. 已经落盘的设计资产（别重写，直接读）

| 文件 | 内容 |
|---|---|
| `.scratch/starmap-core/spec.md` | **主规范**，612 行。Problem / Solution / 80 条 User Stories / 13 节 Implementation Decisions / Testing Decisions / Out of Scope |
| `.scratch/starmap-core/issues/01..20-*.md` | 20 张票，123 条验收。已勾 115 条，每条都写了落地文件与取证数字 |
| `GLOSSARY.md` | 领域术语表（约 60 条，8 组）。**术语有裁定**：必须说「出口门控」/「检索门控」不能裸说「门控」；「微知识点」是唯一判定单元；「变式」结构不同、「平行题」结构相同 |
| `docs/architecture.md` | 311 行，11 节。进程拓扑、包依赖单向图、NestJS 内部分层、Mastra 层、**4 个测试接缝**、深模块表、一次作答的数据流 |
| `docs/adr/0001..0007-*.md` | 7 个 ADR。0002 已被 0005 取代（SQLite→PostgreSQL） |
| `docs/eval-report.md` | 评估报告模板与口径 |
| `AGENTS.md` | 仓库约定（issue tracker、triage 标签、domain） |

**7 个 ADR 的决策要点**（新会话不要推翻）：
- 0001 双字段掌握度 `achieved`/`current`（不衰减 vs 半衰期衰减）
- 0003 检索层物理遮蔽答案块，不靠提示词约束
- 0004 水平档是每关渲染参数，不是三条课程路径
- 0005 PostgreSQL 而非 SQLite（栈一致性 + 未来对接学校库 + `@mastra/pg` 一等公民）
- 0006 NestJS + OpenAPI 契约（Zod → openapi.yaml → Orval）
- 0007 Mastra 目录管 AI 资产、NestJS 模块管业务用例，只在 `MastraModule.register()` 交汇

---

## 4. 真实数据库状态（2026-10-22 03:00 实测）

```
sources=128        （book 27 + paper 101）
knowledge_points=7240   leaf=5469
chunks=96821
chunk_kp_answer=20804   （答案块关系）
kp_edges=279       （全部 kind='prereq'；书内 247 + 跨书 32）
modules=362        course_layers=8     content_gaps=3
levels=8           level_items=39
attempts=205       mastery=2
video_sources=2    video_clips=13      （7 片已对齐知识点）
node_unlocks=0     ← 全库无一条关卡使用 exit/prereq 门控，门控路径在真实数据上是死代码
is_answer_key=8
未收录术语节点=0
负页码 chunk=69    ← t40 在修
```

**已知数据现状（不是 bug，是真实情况）**：
- **只有 6.2% 的叶节点有先修边**（340/5469）。这是「无证据不建边」判据的真实结果，**不要为了图好看编造边**。
- 15 本英文书全部有文字层，13 本中文书是扫描版需 OCR（已 OCR 完成 11 本，康华光数字部分本身有文字层）。

---

## 5. 在飞的 6 个任务（新会话接手要点）

### t19 票 20 最终评估（integrator）
依赖已基本清空。**最近一次完整实跑**：`.scratch/eval-final/20261022-023526-all/`
- 三档 persona（p1-novice / p2-grad / p3-engineer）全部 `success`，走完 S0–S8
- `失败合计: 0`（找不到元素 0 / 后端 0 / 数字对不上 0）
- **但报告自己写明**：`S2/S5/S9 本次未接入旅程，漏斗里是空的。空不等于通过`。**这是探测不足的信号，不是界面没问题的证据。**
- 报告首页锁死 `claimsUsabilityPassed = false`，`judge_scores.agreement_with_human_kappa` 恒 `null`（未与真人校准）
- 票 20 的 8 条验收 checkbox **一条都还没勾**（`.scratch/starmap-core/issues/20-simulated-students-eval.md`）

### t40 英文书页偏移与孤儿 chunk（graph-dev-2）
它的根因纠正**已被 captain 认可**，与票面假设不同：
- 负页码 69 条**不是** offset 探测失败（探测本身准：grupen 25 / tsoulfanidis 31 / rivetti 25）
- 真因是 `books_batch.build_one` 里 `start = min(BODY_START, first_body)` 把 BODY_START 当成了上界 → 从「印刷页 ≤0 的前言页」开抽
- 孤儿 323 条**与区间洞无关**，两个来源：起点过前 + 少数书第一个叶节点晚于印刷页 1
- 修法：起点改 `max(BODY_START, 第一个 printed>=1 的页)`；`assign.py` 新增 `assign_front_matter()`（opt-in，只挂「印刷页≥1 且原本无归属」的 chunk 到第一个 depth=1 章节点，**12 本中文书不重跑**）；tangbin 加 `printedStartPage: 1`

### t41 英文书答案附录识别（agent-dev）
`is_answer_key` 从 0 到有，判据 `wrong_on_paper` 必须为 0。

### t42 译名词典补齐（content-dev）
消灭 213 个「未收录术语（…）」节点。**captain 已给实测阈值**：27 本 6062 个节点名的汉字占比 `min 0.000 / p1 0.143 / p5 0.250 / median 1.000`；`<0.30` 的 470 个、`<0.20` 的 161 个、`==0` 的 17 个。化学式/缩写（`NaI(Tl)`、`Bonner Sphere`）正确处理是**保留原文 + 加中文类别**，不是硬译。

### t43 浏览器深度验收（authoring-dev）
对应用户两条指令：
- user said: 「完工后，调用浏览器开启20个使用场景的压力测试，并修复出现的问题，如回答错误，未完成需要就结束，ui错位，卡顿，等等」
- user said: 「完成后进行更加细粒度的测试，调用浏览器，全方位的使用每一项功能，进行10轮以上的长对话，观察出现的一切bug或是使用体验问题，如报错，卡顿，…」

产物目录 `.scratch/qa/`（`scenarios/` + `shots/`）。**注意**：目录里现在混着 captain 自己写的探针 spec（`zz-*.spec.ts`），那是排查用的，不是 t43 的交付物。

### t44 P0 地图缺陷（graph-dev-2，t40 之后接）
**captain 2026-10-22 实测补充的第二个缺陷，比第一个更根本**：
- 缺陷 A：`GraphCanvas.tsx:239` 的 `itemSizesReference: 'screen'`（**未提交的工作区改动**）让节点半径按图坐标算，FA2 跨度 10951 ⇒ 节点直径 0.47px ⇒ 整张画布只剩背景色。删掉该行回到默认 `'viewport'` 即可。
- 缺陷 B：**只有 6.2% 叶节点有边**，FA2 把 5469 个孤立点沿圆周铺开 ⇒ 截图里那个「中间空心的大圆环」。即使 A 修好，这图仍不能用。要求按 `modules` 分簇（362 个模块成为可辨认的团）、默认只画有边子图 + 每簇代表节点、孤立节点视觉区分。

---

## 6. 踩过的坑（每条都花过时间，别再踩）

1. **Playwright 并发会互删 trace 导致假失败** —— 每次 run 启动清空 `apps/web/test-results/`。**必须带 `--output=../../.scratch/pw-<名字>-<时间戳>`**。
2. **`vi.mock('../api/queries')` 是全量替换** —— 页面每多一个 hook，所有 mock 该模块的测试都要补一条。本仓已踩过三次。
3. **NestJS 默认 POST 返回 201**，契约写的是 200 ⇒ **所有 POST 必须显式 `@HttpCode(200)`**。这个家族被咬过三次。
4. **Griffel（makeStyles）不给裸数字补 px** —— `minHeight: 480` 生成无效声明被浏览器丢弃，必须写 `'480px'`。
5. **`psql -c "…中文…"` 会崩**，写成 UTF-8 文件再 `-f`。
6. **CTE 只作用于紧随其后的那一条语句**。
7. **`app.chunks` 主键是 `id` 不是 `chunk_id`**；`app.chunks` 的页列是 `page` 不是 `printed_page`。
8. **`sum(time)` 返回 `timedelta`，不能直接写进 `bigint` 列**。
9. **测试不要依赖真实库当前内容**（内容管线一直在动），用 `apps/api/test/test-schema.ts` 的独立 schema + 自带 fixture。
10. **`git add -A` 禁止** —— 工作区混着多条泳道和大量 `.scratch` 探针产物。提交前 `git diff --cached --name-only` 逐个看清。

---

## 7. 常用命令

```bash
# 服务（若已停）
export PATH="/c/Users/Yhwhy/scoop/apps/postgresql/current/bin:$PATH"
pnpm --filter @starmap/api dev      # 后端 3001
pnpm --filter @starmap/web dev      # 前端 5173

# 验证
pnpm typecheck                       # 6 包
pnpm test                            # 全仓 1207 tests
pnpm check:boundaries                # dependency-cruiser，647+ modules
pnpm contract:check                  # OpenAPI 与 Zod 同步
pnpm check:migrations                # up/down 成对 + 无残留对象

# 内容管线
cd apps/api && pnpm content:import --dir ../../content/<book-slug>
python -m pytest tools/ingest/ -q    # 当前基线：1 failed（glossary 不同步，与本任务无关）/ 327 passed
```

**门禁基线（2026-10-22 03:10 实测）**：
```
packages/shared      32 passed
packages/api-contract 3 passed
packages/engine     242 passed
tools/eval          115 passed
apps/web            422 passed
apps/api            393 passed
─────────────────────────────
合计               1207 passed / 0 failed
```

---

## 8. 未完成的目标（按优先级）

1. **跑完 t19（票 20 最终评估）并勾选 8 条验收** —— 这是整个项目的验收关卡
2. **t40 / t41 / t42 三个内容质量修复**（英文书页偏移、答案附录、译名词典）
3. **t43 浏览器深度验收**（20 场景 + 10 轮长对话），修复发现的全部缺陷
4. **t44 地图 P0**（节点不可见 + 孤立点铺成圆环）
5. **收尾提交**：工作区 305 个改动（167 个已跟踪修改 + 138 个未跟踪），其中**源码改动 49 个**（`apps/`、`packages/`、`tools/` 下），其余是 `.scratch/` 探针产物与 `content/` 管线产物。自 `1818d0a` 之后多条泳道的产物还没提交 —— **这是当前最大风险**。

   `apps/web/src/api/generated/` 里混着多个任务的产物（`nodeSource`/`nodeDetailResponseSource` 来自 t37、`retrievalExpansion` 系列来自 t32、`contentGaps` 来自 t35），**必须按路径逐个挑，不许 `git add -A`**。

---

## 9. 建议加载的 skills

| skill | 为什么 |
|---|---|
| `diagnosing-bugs` | 处理 t44 地图缺陷、t43 发现的缺陷时需要严格的假设—验证循环 |
| `code-review` | 每个成员交付后、以及最终提交前审查 |
| `tdd` | 新会话若要补测试（本仓要求「测试先红后绿」，补的测试不算完成） |
| `frontend-design` | t43/t44 涉及 UI 修复 |
| `handoff` | 若还要再交接一次 |

---

## 10. 给新会话的第一句话建议

> 「继续 StarMap 项目（`D:\DeepSeek\starmap`）。先读 `C:\Users\Yhwhy\AppData\Local\Temp\starmap-handoff-2026-10-22.md`，然后 `agent_teams_status` 看团队实际状态，把 idle 成员手上的 pending 任务重派出去，继续推进 t19/t40/t41/t42/t43/t44。」

---

## 11. 团队交接的两条路径

**路径 A（推荐）——旧团队还在**：
新会话直接 `agent_teams_status`。若能看到 `starmap-build` 团队和 6 个成员，**不要重建**，只需：
- 对 idle 成员手上的 pending 任务用 `agent_teams_reassign_task` 重派（创建任务不会唤醒成员）
- 对 failed 的任务同样用 `reassign_task` 重派

**路径 B——旧团队已不可见**：
用 `C:\Users\Yhwhy\AppData\Local\Temp\starmap-handoff-team-plan.json` 重建：6 个成员 + 6 个任务（t19/t40/t41/t42/t43/t44），已写好 assignee、deps、description、verify、acceptance、inScope。注意 `t44` 的 deps 是 `t40`（同一个成员，不并行）。

**新会话第一件事无论哪条路径都一样**：确认 `api=200` / `web=200`。若服务已停，按 §7 重启（PostgreSQL 用 `scoop` 装的，不是 Docker）。

---

## 12. 交接时刻的在飞任务（写下时间：2026-10-22 03:20）

| 成员 | 任务 | 状态 |
|---|---|---|
| integrator | t19 票 20 最终评估 | in_progress |
| agent-dev | t41 英文书答案附录识别 | in_progress |
| content-dev | t42 译名词典补齐 | in_progress |
| authoring-dev | t43 浏览器深度验收 | in_progress |
| graph-dev-2 | t40 英文书页偏移 → 之后 t44 地图 P0 | in_progress |
| level-dev | （空闲，无任务） | idle / ready |

**注意**：交接前 captain 刚给 graph-dev-2 补发了 t44 的完整要求（缺陷 B：只有 6.2% 叶节点有边，FA2 把 5469 个孤立点铺成圆环）。若新会话发现 t44 的描述不含缺陷 B，就是那条消息没落进任务描述，请重发。
