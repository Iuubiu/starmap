# @starmap/eval — 三档学生智能体的全流程仿真评估

票 20 的评估工具。它**不是产品运行时代码**，不进生产包，只在本机跑。

> 证据等级是**假设生成**：参与者是 LLM 扮演的模拟学习者，不是真人。
> 这份工具能找出界面上真点不动的位置、能暴露流程断裂、能生成待验证的假设；
> 它**不能**证明可用性达标。这一条在 `src/report/schema.ts` 里由
> `claimsUsabilityPassed: z.literal(false)` 结构上锁死，不是靠自觉。

## 一条命令复现

前置：PostgreSQL 起着、`pnpm db:migrate` 跑过、`.env` 里有 `LLM_API_KEY`。

```bash
# 终端 1
pnpm --filter @starmap/api dev
# 终端 2
pnpm --filter @starmap/web dev

# 终端 3：三档串行跑完（实测 5–6 分钟；judge 是 12 次 × 3 重放的模型延迟，不是页面等待）
pnpm --filter @starmap/eval eval --persona all
```

> **不要写成 `pnpm --filter @starmap/eval run -- --persona all`。**
> `run` 是 pnpm 的内建子命令不是 package.json 里的 script，那条命令报
> `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`；就算把 `run` 改成 `eval`，多写的 `--`
> 会作为一个字面量参数传给下游，报「不认识的参数「--」」。
> 正确形式就是上面这一行，或者 `cd tools/eval && node --env-file-if-exists=../../.env ./src/run.ts`。

产物落在 `.scratch/eval/<run-id>/`：

| 文件 | 内容 |
| --- | --- |
| `journey-<persona>.json` | 九阶段的原始记录：每段状态、耗时、证据、截图名 |
| `judge-runs-<persona>.json` | 每次 judge 的原始响应（解析失败也留原文，便于查 prompt） |
| `gold-check.json` | judge 自检（3 条 gold transcript）逐条结果 |
| `metrics.json` | 四类指标的机器可读形式 |
| `report.md` | 渲染后的报告（模板 + 本次数据段） |
| `journeys/*.png` | 每阶段截图，失败也截 |

常用参数：

```bash
--persona P1|P2|P3|all   跑哪一档（默认 all，串行）
--base-url URL           前端地址（默认 http://localhost:5173）
--api-url URL            后端地址（默认 http://127.0.0.1:3001/api/v1）
--output DIR             产物根目录（默认 .scratch/eval）
--model NAME             judge 模型（默认取 LLM_MODEL）
--no-judge               跳过层③，只跑 UI 旅程（不需要 LLM_API_KEY）
--help                   打印用法后退出 0
```

只验 judge 单独一条（调 prompt 时用，约 20 秒、不需要起前后端）：

```bash
pnpm --filter @starmap/eval gold
```

退出码：`0` 全过 / `1` 有 gold 判错（此时报告里的 judge 数字会被标成不可信）/ `2` 环境或参数问题。

**`--persona all` 必须串行**：三档共享同一套数据库，并行跑会互相污染 ——
P1 的作答会出现在 P2 的推荐里，P3 的复验队列会看到 P1 留下的到期项。

## 为什么是三层，不是一层

| 层 | 判据 | 谁来判断 | 典型输出 |
| --- | --- | --- | --- |
| 层① 确定性断言 | 契约形状、`percent: null`、门控结论、分页完整性 | 代码，无模型 | `eval:layer1`：10 条 check |
| 层② Playwright 旅程 | 界面上真能点到、数字与接口一致 | 浏览器 + 断言 | 九阶段的 passed / 三类失败 |
| 层③ LLM judge | 可执行性 / 清晰度 / 语气 / 脚手架贴合度 | 真模型 + gold 自检 | 四维分、识别率、泄露率、漂移 |

**边界**：判分正确性、门控结论、答案泄漏这些是**确定性事实**，属层①，
不交给 judge。`src/layer3/judge.ts` 的 `JUDGE_MUST_NOT_DECIDE` 列了七条，
`checkJudgeDiscipline` 在评分时校验。

## 九阶段旅程

`src/layer2/stages-impl.ts` 的 `STAGE_DEFINITIONS`，顺序由 `assertStageOrder()` 校验：

| stage | 断言什么 | 映射到漏斗 |
| --- | --- | --- |
| `cold-start` | H1 可见、输入框可见可聚焦可写入 | S0 |
| `placement` | 入口 → 自评 → 答题 → 判定，全流程走得通 | S1 |
| `map` | 清单节点数 > 0；接口推荐集合投影到当前清单窗口后双向一致（窗口内一个不少、一个不多） | S3 |
| `node-detail` | 详情页 H1 与清单项一致；可用关卡区至少一个可进入 | S3 |
| `answer` | 进关卡、逐题作答、`attemptCount` 真的涨了 | S4 |
| `board` | 推荐卡数与接口一致；今日摘要区存在 | S6 |
| `review` | 接口到期条数与页面说法一致 | S6 |
| `database` | 图谱节点数在统计卡上出现同一数字 | S7 |
| `skills` | 接口返回的每个 skill 都渲染出来了 | S8 |

失败分三类，**不合并**：

- `locator_failure` — 找不到元素（界面上真点不动）
- `backend_error` — 后端报错（HTTP 非 2xx）
- `assertion_mismatch` — 数字对不上（页面说的和接口说的不一致）

分三类的理由：它们指向三种完全不同的修法。合并成"失败 5 条"等于把
"按钮不存在"和"计数差 1"当成同一件事。

## 四类可算数字

`src/metrics/` 里全是纯函数，有单测，不需要起浏览器：

1. **答对识别率 / 答错识别率**（两个独立指标，不合并）。合并会掩盖
   "答对全认、答错放水"这种一侧漏水的情况。分母为 0 写"无样本"，不写 0%。
   judge 每条输入跑 3 次采样，**回填识别率时取多数票**（`majorityVote`）——
   只读第一次采样会把另外两票丢掉，而报告上完全看不出来。实测过代价：
   某一档的答错识别率因此从 100% 掉到 50%，读起来像产品缺陷。
2. **泄露答案率**，按 L1（只给背景）/ L2（脚手架）/ L3（全量施压）分桶，
   判据是答案块原文的子串匹配 —— 确定性，不靠 judge。少于 3 次观察的比率
   拒绝引用，写"样本不足"。
3. **判分漂移**：同一批 transcript 跑 3 次，Fleiss κ（达标线 ≥0.8）与
   四维均分 CV（≤0.05）。未做重放时写"未测 ≠ 稳定"，不许填 κ = 1。
4. **过度追问分布**：按 `consecutiveProbes ≥ 3` 切段，报最长停滞与各次长度。
   报分布不报平均值 —— 平均值会把"每次卡 2 轮"和"一次卡 10 轮"抹平。

所有比率都带 Wilson 95% 区间（`src/metrics/stats.ts`），且**分子分母总是
一起打出来**（`formatInterval` → `62.5%（5/8，95% CI 30.6%–86.3%，样本不足）`）。
样本数 < 30 时后缀"样本不足"，防止 5/8 被当成 62.5% 的真值。

## 报告里的两个诚实性约定

这两条不是排版偏好，是读数错误的高发点，都有测试钉住
（`test/funnel-honesty.test.ts`）：

1. **漏斗里 `未测` 与 `·` 分开。** `stageReached` 按旅程阶段算，而漏斗是十级；
   S2/S5/S9 在本版工具里没有对应阶段，拿它比全部十级会让结论栏稳定地写
   "最先掉队的位置是 S2" —— 一句永远成立、且永远错的话。`未测` = 工具没接，
   `·` = 没走到。
2. **摩擦计数里 `未采集` 与 `0` 分开。** 本版旅程是确定性阶段脚本，不模拟
   狂点/空输入/刷新循环，那几个计数恒为 0 是「没数」不是「数出来是 0」。

## judge 自检（gold check）

跑 judge 前先跑 3 条人工标注的 transcript（`GOLD_TRANSCRIPTS`）：

| id | 标签 | 期望 |
| --- | --- | --- |
| `gold-good` | good | 学生答错时系统指出错在哪、不泄露答案 |
| `gold-leaks-answer` | leaks_answer | 系统直接给出答案与推导 |
| `gold-false-praise` | false_praise | 学生答错系统却说"很好" |

**自检不过 = 退出码 1**，且报告里所有 judge 相关数字被标记为不可信。
理由：一个连"直接给答案"都判不出来的 judge，它的四维分只是随机数，
写进报告比空着更糟。

## 纪律用测试锁死

`test/discipline.test.ts`（26 tests）拦的不是代码 bug，是**写文章时最容易
顺手犯的错**：

- 报告里出现"可用性达标""已验证"这类断言 → 红（`FORBIDDEN_CLAIMS`）
- persona 被悄悄改了却没重跑区分度 → 红（三项两两相对差须 ≥20%）
- judge 被问到确定性问题（判分对错、门控结论） → 红（`JUDGE_MUST_NOT_DECIDE`）
- `docs/eval-report.md` 与渲染输出同样受措辞守卫约束

`test/settle.test.ts` 覆盖 `waitForSettled`：页面 Spinner 永远不消失时
到点返回而不是挂死。

## 目录

```
src/
  layer1/     层①：契约与确定性断言（10 条 check，打真 API）
  layer2/     层②：Playwright 驱动
    driver.ts        EvalDriver + COLLECT_SCRIPT（采集屏幕文本与摩擦信号）
    stages.ts        阶段协议：StageDefinition / VerifyResult / 三类失败
    stages-impl.ts   九个阶段的具体断言
    voice.ts         三档 persona 的确定性台词（不用 LLM 扮演，避免第二层方差）
    journey.ts       按顺序跑、失败不中断、每段截图
  layer3/     层③：judge
    judge.ts         schema 与纪律（JUDGE_MUST_NOT_DECIDE）
    llm-judge.ts     真 LLM 调用 + gold 自检
  metrics/    纯函数：Wilson / bootstrap / κ / CV / 识别率 / 泄露率 / 停滞
  personas/   三档 persona（JSON）+ 加载 + 区分度自检
  report/     Report schema（纪律锁死）+ 渲染
  run.ts      执行器：一条命令跑完三档
  cli.ts      参数解析（未知参数直接抛错，不静默忽略）
```

## 已知缺口（写在这里，不藏在代码注释里）

- `agreement_with_human_kappa` 是 `null`：judge 与真人评分的一致性**无数据**，
  跑过 50–100 条人工标注校准前不得声称 judge 分数可信。
- 三档串行但共享同一套库：前一档留下的作答会影响后一档的推荐与复验队列。
  完全隔离需要重建库，本工具没做。
- `answer` 阶段的识别率观察是**按 spec 构造**的（`explainCorrect` /
  `explainWrong` 是系统必然显示的话），不是逐轮真实对话记录。构造过程在
  `src/metrics/observations.ts` 顶部写明了，报告里也会标注。
- L3（三级施压）泄露率目前多为"无样本"：要真跑一轮 agent 回合才能拿到
  "学生明着要答案时系统回了什么"，这一版没接。
- **judge 标签在两次运行间有 16%–19% 的翻转率**（同一版代码、同一批构造输入，
  三个字段合计不一致 6/36、6/36、7/36）。四维分平均绝对差 0.40–0.79，
  这就是 CV 全部超标的来源。多数票能让识别率跨运行可复现，但**单次 judge
  输出的布尔字段不能当事实用**。详见 `docs/eval-report.md` 的「judge 的复现性」。
