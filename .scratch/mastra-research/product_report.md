# 刷题 / 闯关式学习产品形态调研

> 目标：为「对话式 + 知识图谱闯关」的核电子学 / 数字电路学习应用提供**可实现的交互范本**。
> 结论先行：**没有现成产品同时做到"对话式交互 + 知识图谱导航 + 掌握度驱动闯关"**。最接近的三个拼图分别是 Duolingo（关卡节奏与失败处理）、Math Academy（掌握度判定与图谱着色）、Perplexity/Canvas（结构化产出替代消息流）——需要自己组装。
>
> 证据等级标注：`[一手]` = 官方文档/官方博客原文；`[论文]` = 可查 DOI 的学术文献；`[二手]` = 第三方整理、博客、评测、用户评论，数字**不可当作实验结论**。

---

## 1. 刷题 / 闯关类产品：界面结构与机制逐家拆解

### 1.1 Duolingo `[一手]`

**主界面**：一条纵向蜿蜒的**路径（path）**，替代了 2022 年之前的技能树。每个圆形节点 = 一节课；节点之间用路径连成线，滚动时能看到走过的部分。顶部只有三条信息：连胜火焰 🔥 + 宝石/能量 + 段位（Leagues）。`[一手] blog.duolingo.com/new-duolingo-home-screen-design/`

关键设计取舍（官方原话）：*"The map's winding path design also adds a confidence boost when you scroll back up through completed lessons."* —— **路径的"回望感"本身就是激励**。同时 **复习被塞进路径里作为"前进"**，而不是单独的"复习模式"，避免用户产生"我在倒退"的心理。

**一个"关卡"（lesson）的构成**：顶部一条进度条（本节还剩几题）+ 心/能量计数 + 连击（combo）——中间一道题（选择/拼写/听力/口语）——底部固定的「检查 CHECK」按钮——答对后弹绿色底栏，答错弹红色底栏并给出正确答案，底部按钮变成「继续 CONTINUE」。**全屏单题，一次只有一道题，没有题目列表。**这是"关卡化"最基本的物理形态：一屏一题 + 一个唯一前进按钮。

**掌握度可视化：不是百分比，是"颜色 + 皇冠 + 传奇"**：
- 路径节点：未开始（灰/彩）、进行中（进度环）、已完成（金色）。
- **Legendary（传奇）**：一个单元的全部课程做完后解锁，**难度更高、不给提示**，通过后该节点变**金色**。`[一手] blog.duolingo.com/different-kinds-of-practice-duolingo/`
- **不显示置信度**，也不显示"你 73% 掌握"。

**答错后发生什么**：
- 当场：红色底栏 + 正确答案 + 该题在本节末尾重排一次。
- 本节结束：**错误复习环节是免费的**（不消耗能量）。`[一手] blog.duolingo.com/duolingo-energy/`
- 跨节：点已完成节点 → 打开**快速复习课**；Super 订阅者另有 **Training Room**（哑铃图标，底部栏），内含错题复习 / 词汇配对 / 故事 / 口语训练。
- 全局：**Heart → Energy 的改版（2025-07）**是重要反面证据 → 见 §4。

**激励**：连胜（streak）、XP、段位（Leagues，按 XP 速率分组，周升降级）、Side quests（每个角色下方 3 颗星，限时挑战，"答对全部且在时限内"得第 1 颗星）、限时活动（如 Infinite カルタ，带倒计时与连击计数）、好友。

**非语言学科的先例（关键）**：
- **Duolingo Math**（2022-08 独立 App，2024 并入主 App 成为一门课程）：小学水平。数学的**知识组件没有统一形态**——同一个"加法"可能是方块、整数、应用题，同一个"周长"看起来和加法完全不像——所以他们不得不用代码**动态绘制视觉**（`GriddedGraphView` 类生成面积/周长/小数/形状/坐标图），后期移植到 Rive 做跨平台。`[一手] blog.duolingo.com/developing-math/` → **这是我们做电路图/波形图的直接前车之鉴：专业学科的"题目渲染"是主要工程量，不是判题逻辑。**
- **Duolingo Chess**（2025-04 beta）：**200 个 Unit、1845 节课**，Section 1（6 Unit）ELO 200 → Section 2（26 Unit）ELO 500 → Section 3（24）ELO 800 → Section 4（24）ELO 1000 → Section 5（24）ELO 1100 → 上限 ELO 1500。`[一手] blog.duolingo.com/chess-course/` + `duolingodata.com/dat/chfen200.html`
  → **这是最有价值的范式：当学科本身带有外部表征量（ELO / 分数 / 等级）时，把路径的 Section 直接映射到外部量表分档。** 对核电子学，等价物是"能独立完成哪一类实验/能读懂哪一级 datasheet"。

**独立性批评** `[二手]` `lichess.org/@/baihualin/blog/learning-chess-with-duolingo-the-truth-after-200-games` —— 200 局实战后的评估（值得一提：Duolingo 的国际象棋被棋类社区认为"教得会走子，教不会下棋"，这是闯关式在**深策略学科**上的已知天花板）。

---

### 1.2 Khan Academy `[一手]`

**主界面**：左侧课程导航（Course → Unit → Lesson → Skill 四层），中间是**单元页**，右上是 **Course Mastery 百分比**。

**掌握度的六级刻度**（这是全网最值得抄的一套）：
`Not started → Attempted → Familiar → Proficient → Mastered`
- 每个 skill 值 **100 Mastery Points**；**Proficient = 80 分，Mastered = 100 分**。
- **等级会掉**：官方原话 *"your skill level can move up and down based on your performance"*；答错可能掉回 **"Needs Practice"**。
- **课程掌握度 %** = (Proficient 或 Mastered 的 skill 数) ÷ (总 skill 数)。Familiar 及以下**不计入**。例：20 个 skill 里 5 个达标 = 25%。
- **升级路径被刻意限制**：*"once you get a skill to familiar or proficient, the only way to level it up to mastered is through a unit test or mastery challenge"* → **日常刷题只能到 Proficient，"Mastered"必须通过考试型环节**。这是把"熟练度"和"掌握度"分成两条通道的现成设计。

**Mastery Challenge（掌握度挑战）**：
- 内容 = 打散已学过的 skill，**"in a jumbled context and spaced out over time"**；
- 同一个 skill 在 Mastery Challenge 里**大约每 16 小时才出现一次**（这就是他们解决"间隔重复 vs 线性推进"冲突的答案：**间隔重复不放在主路径上，放在独立的挑战池里，由引擎控制出场间隔**）；
- 每答对一题 **+50 energy points**；答错掉级。
- 官方设计动机原话：*"we wanted more opportunities for students to review concepts they'd already worked on, rather than 'one and done' experience that often involved long gaps"*。

**Energy points**：明确声明是**努力的度量，不是能力的度量**（德文帮助页："Sie sind kein Maß für Können oder Fähigkeit"）。→ 与我们相关：**把"努力"和"掌握"用两个不同的数字表示，不要混成一个"进度条"。**

---

### 1.3 Brilliant `[一手]`

**主界面**：课程页是**扁平有序的课程列表**，按 Section 分组，标注 **"68 Lessons / 1159 Exercises"** 这类总量（Solving Equations 68/1159、Quadratics 80/1468、Introduction to Functions 68/877）。**每 4–6 节课插入一个 "Level Check" 检查点**——检查点是序列里的一个普通节点，不是独立模块。

**一节课的界面骨架（三段式）** `[二手]` `beginnersinai.org` 走查：
1. **上图下题**：屏幕上是一个**可拖动/可动画的图形**，下方一道题 + 3 个选项；
2. **答错 → 图形动画演示"为什么错"**，然后让用户改；
3. **答对 → 下一题在同一图形上加深一层**。
时长约 15 分钟，**用户先做预测，再看答案**。

官方方法论原话（这三句可以直接当设计原则）：
- *"Brilliant often asks a question **before** presenting a procedure"*
- *"**more support while an idea is new, steps back for independent practice**"*（脚手架随掌握度撤除）
- *"**getting a problem right doesn't always mean the underlying concept has fully landed**"* → 所以答对后仍引导读解析。
- 练习的四种变化：retrieval、**换表层情境**（"change surface details so learner must recognize the underlying idea"）、spacing、**interleaving**。

**AI 导师 Koji**：看得见题目 + 屏幕上的可交互元素 + 用户试过什么；**只提问、只高亮图的某一部分、只拆小步，从不直接给答案**。`[一手] brilliant.org/resources/choosing-brilliant/how-brilliant-teaches-math/`

**弱点（对我们最重要的一条）** `[论文/评测]`：Brilliant 的掌握判定**比 Math Academy 宽松**，官方评测明确"**不推荐给需要严格掌握度强制的学生**"。→ 说明"交互精美 + 概念探究"和"掌握度严格"存在张力，**Brilliant 选了前者**。

---

### 1.4 Math Academy `[一手]` —— 掌握度驱动 + 知识图谱最完整的公开实现

**主界面**：三块——(a) 今日任务（"今天要做 X XP"），(b) **知识图谱**（椭圆节点，**颜色越深蓝 = 知识越稳固**），(c) 课程/知识点页。

**推进机制（最严格的一套）**：
- 入学：**30–45 分钟自适应诊断** → 定位到 **"knowledge frontier"（知识前沿）**；诊断同时测 **mastery（会不会）** 和 **automaticity（熟不熟）**；报告含定位、各每日 XP 目标下的预计完成日期、基础漏洞清单。
- **1 XP ≈ 1 分钟专注投入**；有每日 XP 目标；满分有 bonus XP。
- 每个知识点：**先给完整例题（worked example）+ 双编码图示** → 然后**最多 5 道练习** → **连对 2 题即过关，否则继续加题**。每题都有解析。
- **每 150 XP 一次小测（quiz）**：限时、**例题不可见**、错的知识点**立刻被指派为复习项**、可选重考拿更多 XP。官方理由：频繁低风险小测能降低数学焦虑。

**掌握度可视化**：**图谱椭圆颜色深度 = 重复间隔的稳定性（stability）**。他们原话："a student's spaced repetition profile is a measure of how many spaced repetitions a student has completed for each topic"，"**the darker blue the oval, the more stable the knowledge**"。
→ **这是"用颜色深浅编码 FSRS stability"的现成做法，而且不需要显示任何数字。**

**反直觉但重要**：**Non-interference / interleaving** ——"conceptually related knowledge interferes"，所以**新概念要和"不相似"的内容并排教**。（对比：我们做电路时会本能地把"RC 充放电"和"RL 暂态"放一起教，恰好是反面。）

**Leagues**：按 **XP 获取速率**分组（不是总量），周升降级，**已积累的 XP 永不丢失**，可退出。

---

### 1.5 ALEKS `[一手]` —— 知识空间理论的原型

- **Knowledge Space Theory**：系统永远知道"这个学生**现在**能学会什么"。
- 关键数字：**"when ALEKS determines that the student is ready to learn a concept, the student is able to master it at least 90% of the time"（部分课程 >95%）** → **"就绪度"是可以被量化到 90% 命中的**，这是"知识图谱闯关"的合法性来源。
- 掌握度展示：**饼图（pie）**，每一片 = 一个学科分支，**明暗 = 该分支的掌握程度**。没有百分比数字。
- 刻意**不出选择题**，必须构造输入（"no multiple choice"）。
- Knowledge Check 构成"学习—评估"的连续循环。

---

### 1.6 Anki / SuperMemo —— 间隔重复的调度与 UI

**Anki** `[一手] docs.ankiweb.net/deck-options.html`：
- 学习步长默认 **1m / 10m**；第一步按 "Hard" = **6m**（取 1m 与 10m 的平均，即"部分成功要给部分前进"）；
- 复习卡按 "Again" = **lapse** → 进入重学步长（默认 **10m**）；最低间隔默认 **1 天**；
- **Leech（水蛭）**：默认累计 **8 次 lapse** → 自动打 tag / 暂停该卡；
- 每日上限存在的原因（官方原话）：有人头几天猛刷几百张新卡，"**then became overwhelmed**"。

**SM-2**（Wozniak 1990）：`I(1)=1`, `I(2)=6`, `I(n)=I(n-1)·EF`；EF 1.1–2.5，起始 2.5；**下限被抬到 1.3**，理由是低 EF 的卡片"repeated annoyingly often and always seemed to have inherent flaws"→ 这类卡片应该**重写题目**而不是继续重复。评分 0–5。

**FSRS**（当前主力算法，源码核实 `open-spaced-repetition/py-fsrs` 的 `fsrs/scheduler.py`）：
- DSR 三变量模型（Difficulty / Stability / Retrievability）；三条定律：材料越复杂→稳定性增幅越小；已有稳定性越高→增幅越小（stabilization decay）；**可提取性越低→增幅越大**（stabilization curve）。
- 默认参数 21 个：`0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542`；`FSRS_DEFAULT_DECAY = 0.1542`；`desired_retention=0.9`，`learning_steps=(1min,10min)`，`relearning_steps=(10min,)`，`maximum_interval=36500`，`enable_fuzzing=True`，`STABILITY_MIN=0.001`。
- 生态：`ts-fsrs`（TS）、`py-fsrs`（513★）、`go-fsrs`、`rs-fsrs`、`fsrs-optimizer`、`fsrs-rs`。→ **我们不需要自己实现调度，直接接 `ts-fsrs`。**

**SuperMemo 增量阅读（incremental reading）** —— **这是"线性推进 vs 打散复习"冲突的经典解** `[一手] mail.super-memory.com/help/read.htm`：
- 把文章切成**小块**读，随时跳走再回来；官方原话："**interrupted reading is a rule, not an exception**"（被打断是常态，不是异常）。
- **read-point**：标记"读到哪儿了"，下次回来从原处继续。
- **extract（摘录）→ 转成 Q&A（topic → item）**。
- **优先级 0–100%，0% 最高**；所有到期项按优先级从高到低排队，**做不完就自动顺延低优先级项**——"如果今天做不完，只有低优先级材料受损"。
- → **对我们的直接含义：不要做"第 3 章没通关就不能进第 4 章"的硬门禁，要做"一个按优先级排序的队列 + 可任意粒度断点续读"。**

---

### 1.7 国内产品

**猿题库** `[一手] yuantiku.com/activity/gaokao/tutorial`
- **预测分**：由练习历史预测考试分数；练习量不足时**显示 "？"** 而不是给一个假数字。
- **快速智能练习**：*"综合你对考点的掌握情况、易错题等信息从**全部考点**中快速智能出题"*。
- **专项智能练习（最重要）**：*"详细拆分知识点，记录你的答题进度并进行能力评估，通过**点击考点名称可展开到更细的考点划分**。**香蕉越多代表对考点的掌握情况越好**"*
  → **掌握度 = 每个考点一个"香蕉数量"（0–3 个香蕉），并且考点是可点击下钻的层级节点。** 这是最适合直接搬的"轻量掌握度"表示：不需要百分比，不假装精确。
- **全站预测分分布**：直方图上标出你的位置（社会比较）。

**作业帮 / 小猿搜题** `[二手] php.cn 教程，细节具体但权威性低`
- 学习报告：时间筛选（近 7 天 / 本月 / 本学期 / 自定义）+ 学习总时长 + 完成题数 + **知识点掌握雷达图**（轴长 = 掌握强度）+ **错题高频知识点**（红色感叹号 + "待提升"标签）+ 进步趋势折线 + 学习记录（含**解析页停留时长**）。
- 小猿 AI 作业报告：顶部 = 得分/用时/**知识点覆盖率**；中部 = **饼图 + 每章正确率文字**；底部 = **薄弱知识点 2–4 条，且必须描述到错误机制**，例如"'一元一次方程**去分母步骤**错误'"、"'三角形全等**判定条件混淆**'"，每条挂教材位置（如"人教版七下 P42 例3"）。
  → **这是"反馈粒度"的最佳范本：不是"你错了"，而是"你在这一步用了错误的规则"。**
- **举一反三**：从错题入口推送 **3–5 道变式题**，按知识点图谱 + 当前掌握度挑，每题带**显式训练意图**；**只有掌握度未达"良好"才解锁**；≥2 道同标签错题可批量合并成 **8–12 题专项训练包**。

**头歌 EduCoder**（工科实验平台，最接近我们的"工科闯关"先例）
- 一关 = 左侧任务描述 + 右侧代码/答题区 + **「评测」按钮**；几秒后返回结果，错的用**红色 icon** 标出；循环"改→再评测"直到通过；**通过 = 停止计时 + 自动解锁下一关**。部分关卡是 VNC 图形化实训。
- 重庆工程学院 2026 教学案例「智闯相评」：把《Web前端开发技术》ES6 知识点**解构成更细的关卡**，重排"学/练/评/教"全流程。
  → **工科闯关成立的前提只有一个：每一关都有一个"可自动判定的产物"（代码能跑/电路能仿真/数值能收敛）。** 没有可判定产物的关卡就是纯选择题，会退化成刷题。

**得到 听书知识地图** `[一手]`
- 4600 本书 → **11 座"知识大陆" + 几十个二级领域**；官方文案："随便点进一座大陆、一个领域，就能找到方向，**能看到进度，能知道自己走到哪了**"。
- 循环：听完一本 → **点亮该领域的碎片 → 集齐大陆勋章 → 合成终极奖杯**（+ 限定实物拼图）。
- 界面上的计数："正在探索：9/147 本"。
  → **"有限、命名、可收集"的地图远胜"无限发散的节点网络"**。

**极客时间「学习地图」** `[一手] b.geekbang.org/mall/path/86`、`time.geekbang.org/learning/path-detail/41`
- 形态：`学习路线` = 若干阶段（初级/中级/高级），每阶段标注 **"约 88 小时"** + **段位能力描述**（"能够独立完成一个系统的架构设计…"）+ 阶段下挂具体课程卡片（作者 + 你将获得）。顶部汇总"25 门课程 / 294 小时 / 154.3w 人次正在学习"。
  → **路线用"小时"和"能力句"计价，不用"章节数"**——因为用户真正想知道的"还要投入多少"和"学完能做什么"。

---

### 1.8 产品形态对比表

| 产品 | 类型 | 推进机制 | 关卡形态 | 掌握度展示 | 失败处理 | 激励 | 反馈粒度 | 开源 |
|---|---|---|---|---|---|---|---|---|
| **Duolingo** | 语言/通识闯关 | 线性路径 + 引擎重排课程顺序 | 线性路径（单元=段），节点=一节课 | 节点颜色 + 金色 + Legendary；**无百分比、无置信度** | 错题本节末尾重排；扣能量（原为心）；错误复习免费 | 连胜 / XP / 段位 / Side quests / 限时活动 | 对错 + 正确答案；Legendary 无提示 | 否 |
| **Duolingo Chess** | 深策略学科 | 线性路径 | **200 Unit / 1845 课**，Section 映射 ELO 200→1500 | 节点 + ELO 段位名 | 同 Duolingo | 同 Duolingo | 走子对错 + 最佳着法 | 否 |
| **Khan Academy** | 学科掌握度 | 单元顺序 + **Mastery Challenge 打散复习** | 课程→单元→课→技能（树，非路径） | **5 级：Not started/Attempted/Familiar/Proficient/Mastered**；课程 % = Proficient+ 占比；**会掉级** | 掉级到 Needs Practice；Mastery Challenge 掉级 | Energy points（**明示=努力非能力**）+ 徽章 | 对错 + 分步解析 + 定位到 skill | 否 |
| **Brilliant** | 概念探究 | 固定顺序 + 每 4–6 课一个 Level Check | 扁平有序列表（Section 分组） | 课程完成度 + Level Check；**掌握判定宽松** | 答错→图形动画解释→当场改 | 连续天数 / 课程完成 | **解释为什么错**（视觉化） | 否 |
| **Math Academy** | 掌握度驱动 | **诊断定位 + 连对 2 题过关 + 每 150 XP 小测** | **知识图谱**（椭圆节点） | **椭圆颜色深浅 = FSRS stability**；无百分比 | 错题**立刻进复习队列**；小测限时、无例题 | XP（1 XP≈1 分钟）/ 每日目标 / Leagues（按速率） | 每题解析 + 立即指派复习 | 否 |
| **ALEKS** | 知识空间理论 | **就绪度驱动**（判定 ready 后 90%+ 掌握率） | 饼图分片（非路径） | **饼图明暗 = 分支掌握度** | 未掌握即不进下一步；Knowledge Check 循环 | 弱 | 构造式作答，逐步判定 | 否 |
| **Anki** | 间隔重复 | **SM-2 / FSRS 调度** | 无关卡，队列 | 卡片状态（new/learning/review/relearning）+ 到期数 | lapse → 重学步长；8 次 lapse 自动 leech 暂停 | 仅连续天数 | 自评 0–5（Again/Hard/Good/Easy） | **是**（AGPL，32k★） |
| **SuperMemo** | 增量阅读 | **优先级队列 0–100%** + 自动顺延 | 无关卡，可断点续读 | 优先级 + 下次复习日 | 做不完只损失低优先级项 | 弱 | 摘录→自制 Q&A | 否 |
| **猿题库** | 刷题 | 按考点掌握度 + 易错题从**全部考点**抽题 | 考点树（可点击下钻） | **每个考点 0–3 个香蕉**；预测分（样本不足显示"？"） | 记入易错题；预测分下降 | 排名分布 / 预测分 | 对错 + 解析 + 考点归属 | 否 |
| **小猿搜题** | 刷题+诊断 | 错题 → 变式题（图谱 + 掌握度） | 错题本 / 专项训练包（8–12 题） | 知识点覆盖率 + 雷达图 + 薄弱点 2–4 条 | 生成变式题重练；"掌握度未达良好"才解锁 | 学习时长/连续 | **定位到错误机制 + 教材页码** | 否 |
| **头歌 EduCoder** | 工科实验闯关 | 通过即解锁下一关 | 线性关卡（任务描述 + 代码区 + 评测按钮） | 关卡通过数 + 计时 | 红色 icon 标错，改到过为止 | 计时 / 闯关榜 | 测试用例级（哪条 case 挂） | 否 |
| **Obsidian** | 知识图谱 | 用户自选（无推进） | **全局图 + 局部图（深度滑块）** | 无 | — | 无 | — | 否（免费闭源） |
| **Kumu** | 图谱导航 | 用户自选 | **Focus（按跳数聚焦）** | 无 | — | — | — | 否 |
| **Neo4j Bloom** | 图谱导航 | 用户自选 | 场景 + Perspective | 无 | — | — | — | 否 |
| **Perplexity** | 结构化产出 | 用户提问 | **答案页（非气泡）** | 无 | — | — | 引用到句 | 否 |
| **ChatGPT Canvas** | 结构化产出 | 用户提问 | **左提示词 / 右文档**，内联编辑 | 无 | — | — | 段落级 diff | 否 |

---

## 2. 知识图谱作为主导航：2000+ 节点的可用性做法

> 核心事实：**没有一个成熟产品把"全图"当主界面。**所有产品都在做同一件事——**默认只显示一小部分，其余靠交互展开**。Obsidian 社区的判词最直接：*"the global graph … at two hundred pages it is a hairball, and a hairball tells you nothing except that you have pages."*
> 所以问题不是"怎么画 2000 个节点"，而是"**怎么让用户永远只看见 20–80 个节点**"。

### 2.1 防迷失（Orientation）

| 手法 | 出处 | 具体做法 |
|---|---|---|
| **两点入场** | Neo4j Bloom | 空场景只给两个入口：**"Show a graph snippet"（先看样例）** 或 **"Search the graph"（先搜）**。永远不从"全图"开始。 |
| **按跳数聚焦（Focus / degree walk）** | Kumu | 点击并按住元素 → 聚焦；**用 `+`/`-` 或数字键精确走 1/2/3 跳**；`Esc` 恢复全图；可预设 `@settings { focus: #jack out 2 }`。 |
| **Prompted 模式** | Kumu | 用户**从搜索框开始**而不是从地图开始：输入若干节点名 → 指定各自 `out n` 跳 → "Build map" 生成一张小图。 |
| **局部图 + 深度滑块** | Obsidian | 全局图旁并列一个**局部图**，滑块直接控制"看几跳"；插件 `obsidian-clew` 加准星按钮，**只保留 N 跳内的节点，其余隐藏**。 |
| **Dismiss / 去毛球** | Neo4j Bloom | 右键 **Dismiss** 移除某节点；**"Dismiss single nodes" 自动删掉所有"没有可见邻居"的节点**——一次操作把毛球瘦成骨架。 |
| **Inspector 而非弹窗跳转** | Neo4j Bloom | 双击节点在**右侧检查器面板**展开详情，**不离开图谱**（保持空间记忆）。 |

### 2.2 渐进展开（Progressive disclosure）

- **默认只显示父级，点击展开子级** —— 国内教育平台的通行做法（"默认显示父级知识点、点击展开子级"），单课程支持 **10000+ 节点**。→ **层级树是图谱的第一层遮罩，不是它的替代品。**
- **数据量上限即是 UI 参数**：Bloom 用 **"Node query limit"** 硬性限制一次展开的节点数；**Advanced Expansion** 让你指定"沿哪种关系、哪个方向、最多几个"再展开。
- **LOD（level of detail）**：Obsidian 有 **text fade threshold**（缩放到一定程度文字淡出，只剩点）；Bloom 里**节点文字大小随节点大小缩放**。→ 低缩放级别只显示形状和颜色，把文字留给放大后。

### 2.3 标注已学 / 未学（这是教育产品独有的层）

三家的答案各不相同，但都不给百分比：

| 做法 | 出处 | 机制 |
|---|---|---|
| **颜色深浅 = 记忆稳定性** | Math Academy | 椭圆越深蓝 = spaced repetition 越稳定。**直接把 FSRS stability 映射到明度**，零数字。 |
| **饼图明暗 = 分支掌握** | ALEKS | 每个学科分支一片，明暗表示掌握程度。 |
| **颜色 + "水位" = 完成率/掌握率** | 国内平台规范 | 双重编码；另有 **多维筛选**（标签 / 层级 / **认知维度** / 分类）。 |
| **Groups 按表达式上色** | Obsidian | 一条搜索表达式 = 一组颜色，例如 `tag:#未学` 灰、`tag:#待复习` 橙。**上色规则是用户可编程的**。 |
| **点亮碎片 → 勋章** | 得到 | 完成一个区域 → 点亮该区域的碎片/勋章。**收集物绑定到区域而非节点**。 |

**共识**：节点数量超过约 300，**任何"逐节点标注"都会失效**，必须改成"**区域级状态 + 节点级按需查询**"。

---

## 3. 取代聊天气泡：结构化产出范式

> 结论：**聊天气泡的本质缺陷是"信息的时间顺序取代了信息的组织结构"**——Claude Artifacts 的观察最准：*artifacts "behave more like files or apps than transient chat messages — they have names, persist, and can be found without scrolling history."*

### 3.1 五个可拆的骨架

**A. Perplexity —— "每次提问 = 一份小报告"** `[一手] aiuxplayground.com/teardowns/perplexity/output`
- 官方定位原话：*"treats each query as a **small report**, not a chat bubble"*。
- **一个答案 = 三个 tab**（Answer / Links / Images）——但拆解明确指出代价：*tabs compete with prose on first load, default tab must carry the full story*。
- **折叠的检索过程**：一行 "Completed 3 steps"，步骤名用人话（"Searching the web"），**步骤数放在 header 里用来设定延迟预期**。
- **追问 chips 在答案下方**，每个 chip 一键进 composer——代价：*"long follow-up lists push the composer down — cap visible chips or collapse after three"*。
- **划词菜单二分**：**"Add to follow-up"（继续追问）** vs **"Check sources"（去核实）**——**迭代和验证是两个动作，不能混**。
- 每份答案可**导出 PDF / Markdown / DOCX**；Rewrite 带具名模式（"Deep research" / "Learn step by step"）。

**B. Notion AI —— "产出落在文档里，不落在对话里"** `[一手] notion.com/help/guides/notion-ai-for-docs`
- 三个入口：侧栏 agent（跨工作区任务）、**划词 → "Edit with AI" → accept / discard / try again**、**空行按空格 → 输入提示词 → "Notion AI writes directly on the page"**。
- **没有聊天记录页**。输入是"文档里的一次空格"，产出是"文档里的文字"，历史 = 文档的版本历史。

**C. ChatGPT Canvas —— 双栏** `[一手]`
- **左侧提示词栏，右侧回复/文档窗口**，官方表述是"摒弃了聊天式单屏结构"。
- 内联编辑 + track changes（段落级 diff）。

**D. Claude Artifacts —— 侧栏 preview** `[一手]`
- 生成的 HTML/CSS/JS 在**沙箱 iframe 里实时渲染**，与对话**并列**；改 = 继续说一句；产物**有名字、会持久、可被单独找到**。

**E. Cursor Composer —— checkpoint + diff 审阅** `[二手]`
- 改动以 **diff 视图**提出，逐块 accept/reject；
- **每次生成创建一个 checkpoint，点击 checkpoint 可 checkout / undo**。
  → **"每轮产出物 = 一个可回滚的版本"，而不是"一段聊天记录"。**

### 3.2 抽出通用骨架

```
┌──────────────────────────────────────────────────────────────┐
│ [上下文条]  当前聚焦：RC 暂态  ·  掌握度：Familiar  ·  剩余 3 张卡  │  ← 状态，不是标题
├───────────────────────────────────┬──────────────────────────┤
│                                   │                          │
│   产出区（结构化卡片，非文本流）      │   右侧：知识图谱 / 进度    │
│   ┌─────────────────────────────┐ │   （聚焦模式，只显示邻域） │
│   │ 卡片 1：今天的关卡            │ │                          │
│   │ 卡片 2：为什么你错了（图示）    │ │                          │
│   │ 卡片 3：进度变化（哪种颜色变了）│ │                          │
│   │ 卡片 4：追问表单（可选项，非自由 │ │                          │
│   │         输入）                 │ │                          │
│   └─────────────────────────────┘ │                          │
│                                   │                          │
├───────────────────────────────────┴──────────────────────────┤
│ 底部常驻输入框（无气泡列表；历史 = 上方卡片栈，可折叠/可回溯）      │
└──────────────────────────────────────────────────────────────┘
```

三条硬规则（都有出处）：
1. **产物要有名字、要持久、要能单独打开**（Artifacts）——所以每张卡是一个**对象**（`card_id`），不是一个 DOM 消息。
2. **迭代与验证分离**（Perplexity 的 "Add to follow-up" vs "Check sources"）——"再来一题"和"我要看依据"必须是两个按钮。
3. **每轮都可回滚**（Cursor checkpoint）——关卡卡要能"撤销这一轮"，否则用户不敢试。

---

## 4. 反面教训（游戏化在学习产品里的失败模式）

> 先说结论：**游戏化的收益证据是混合的**。Sage Open 2026 元分析（DOI `10.1177/21582440261421375`）摘要原话："empirical evidence on gamification's impact remains **mixed and inconclusive**"；ScienceDirect 社论标题直接问 "The future of gamification: **beyond performance metrics and leaderboards**?"（PII `S1041608026000993`）。

### 4.1 生命/能量惩罚 = 直接的退出原因 `[论文]`

Duolingo 自己的数据（`[一手] blog.duolingo.com/duolingo-energy/`）：旧的心机制"**especially frustrating for beginners, who were still figuring things out and 2X more likely to run out of hearts mid-lesson**" → 2025-07 改成 Energy（按课时消耗、连对回能、错题复习免费、约一天充满）。

学生访谈证据（Örebro 论文 `hj.diva-portal.org/smash/get/diva2:1971949/FULLTEXT01.pdf`，仅拿到摘要片段）：
> "**many users ceased their daily learning immediately after depleting their life points. A total of five participants indicated that they ended their learning due to insufficient life points.**"

→ **规则：不要用"答错就锁关卡"作为惩罚。** Duolingo 自己在 2025 年已经放弃了它。

### 4.2 连胜 = 双刃剑 `[论文/二手]`

- Oulu 论文（`oulurepo.oulu.fi/bitstream/10024/54117/1/nbnfioulu-202502121605.pdf`）：学习者同时把 streak 描述为"有用的追踪工具"和"**a bully**"；原话："R1: I lost my streak (~850 days) due to not being able to access internet."
- UX University（`[二手]`，数字不可当实验结论）：streak ≈ +60% commitment、XP+排行榜 ≈ +40% engagement、徽章 ≈ +30% completion；7 天连胜用户 **3.6× 更可能长期留存**；引入 **Streak Freeze 后高危用户流失降 21%**；机制是损失厌恶；并且承认风险——"**the same mechanic that helps someone build a healthy habit can also make disengaging feel unnecessarily difficult**"。
- → **规则：连胜必须配"豁免机制"（freeze / 补打卡），且连续天数不能是唯一进度指标。**

### 4.3 排行榜 = 对尾部用户的负向激励 `[论文]`

ACM `10.1145/3555649`（Tsvetkova et al.）：**相对排名反馈改善头部表现，但降低尾部参与度**；建议在"需要普遍参与"的场景**不要用相对表现反馈**。
→ **规则：不做全班/全站排名。要做也只做"与自己过去比"。**（对比：猿题库的"预测分分布"是**位置图**而非排行榜，且练习量不足时显示"？"——比排行榜温和。）

### 4.4 虚假成就感：刷分会替代学习 `[论文]`

里斯本论文（`run.unl.pt/bitstream/10362/171644/1/...Wallenwein.pdf`）摘要片段：
> "high-XP Duolingo users often lose motivation due to **perceived inefficiency and ineffectiveness**, resorting to only one lesson a day."

→ **规则：XP/关卡数不能替代掌握度数字。Khan 的做法（Energy=努力，Mastery=能力，两个数分开）是标准答案。**

### 4.5 闯关节奏 ≠ 认知节奏

- **Brilliant 的公开承认**：*"getting a problem right doesn't always mean the underlying concept has fully landed"* —— 关卡"通过"这件事本身不能证明理解。
- **Math Academy 的反向补偿**：所以他们把"过关"定成"**连对 2 题**"，并把"稳定"单独编码成图谱颜色。
- **SuperMemo**：*"interrupted reading is a rule, not an exception"* —— 强行要求"这一关必须一次做完"本身就违反认知节奏。
- **Duolingo Chess 的社区评价** `[二手]`：200 局后仍被棋类玩家评为"教得会走子、教不会下棋"——**闯关能覆盖"知识"，很难覆盖"策略深度"**。
- → **规则：把关卡设计成"可中断、可续"的最小单元（5–10 分钟），并用"复习队列"承担跨关卡的巩固，而不是要求一关打到底。**

---

## 5. 给我们的界面骨架建议

**已定方向**：浅色学术工作台 + 深色知识图谱画布、底部常驻输入框、**没有聊天气泡列表**、每轮产出结构化产物。

### 5.1 一屏布局

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ── 顶栏（浅色，48px，极简）──────────────────────────────────────────────── │
│  核电子学 ▸ 探测器与前置放大          [今日: 3/5 卡]  [🔥 12]  [⚙]        │
├──────────────────────────────────────┬──────────────────────────────────────┤
│  主工作台（浅色 #FAFAFA，最大 720px）   │  知识图谱画布（深色 #0E1116）          │
│                                      │                                      │
│  ① 关卡卡（当前唯一动作）              │   ┌ 聚焦模式（默认）──────────────┐   │
│  ┌────────────────────────────────┐  │   │   只显示当前知识点的 2 跳邻域    │   │
│  │ 前置放大器 · 电荷灵敏度          │  │   │                              │   │
│  │ ──────────────────────────────  │  │   │      (  )──(  )──( ◉ )        │   │
│  │ [题目/电路图/波形 —— 主视觉区]    │  │   │        │       │              │   │
│  │                                │  │   │      (  )    (  )             │   │
│  │ ○ A   ○ B   ○ C   ○ D          │  │   │                              │   │
│  │                    [检查 ↵]     │  │   │   深蓝=稳固 灰=未学 橙=待复习   │   │
│  └────────────────────────────────┘  │   └──────────────────────────────┘   │
│                                      │                                      │
│  ② 反馈卡（答后原地替换①，不新开）      │   [ +2 跳 ] [ −1 跳 ] [ 全图 ]       │
│  ┌────────────────────────────────┐  │   [ 搜节点… ]                        │
│  │ ✗ 你选了 B。                    │  │                                      │
│  │   你把"电荷灵敏度"当成了"能量分辨率"│  │   ┌ 本轮进度变化 ─────────────┐    │
│  │   [图示：两条曲线重叠区域]        │  │   │ 电荷灵敏度  Familiar → Proficient │
│  │   依据：教材 §3.2 / 本次错因       │  │   │ 噪声模型    Mastered → Proficient │
│  │   [看依据] [再来一题] [我懂了]     │  │   └────────────────────────────┘   │
│  └────────────────────────────────┘  │                                      │
│                                      │                                      │
│  ③ 追问表单（可选，结构化）            │                                      │
│  ┌────────────────────────────────┐  │                                      │
│  │ 你想深入哪一层？                 │  │                                      │
│  │ □ 推导    □ 数量级    □ 实测陷阱   │  │                                      │
│  └────────────────────────────────┘  │                                      │
├──────────────────────────────────────┴──────────────────────────────────────┤
│ ── 底部常驻输入框（浅色，64px，无气泡）────────────────────────────────────── │
│  [ 问点什么，或直接说"下一题" ]                    [📎] [↑]                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 五个位置的设计依据

| 位置 | 设计 | 依据 |
|---|---|---|
| **主区一次只有一张卡** | 关卡卡答完**原地被反馈卡替换**，不产生第二条消息 | Duolingo 的一屏一题 + continue；Brilliant 的"上图下题" |
| **反馈卡第一行是"你的错误机制"** | 不是"答错了" | 小猿"'去分母步骤'错误"、Brilliant 的"答错→动画演示为什么错" |
| **反馈卡三按钮 = 迭代 / 验证 / 前进** | `[再来一题]`（迭代）、`[看依据]`（验证）、`[我懂了]`（前进） | Perplexity 的 "Add to follow-up" vs "Check sources" 二分 |
| **右栏图谱默认聚焦 1–2 跳** | `[+2 跳] [−1 跳] [全图]` 三键；全图**不是默认态** | Kumu 的 degree walk、Obsidian 的 local graph、Bloom 的 snippet-first |
| **进度变化是独立卡片** | 只显示"这轮哪个节点的颜色/等级变了" | Khan 的"活动后总结哪些升级哪些降级"；Math Academy 的椭圆变深 |

### 5.3 色彩语义（一套，不混用）

| 状态 | 图谱节点 | 含义 | 出处 |
|---|---|---|---|
| 未学 | `#3A4048` 描边，无填充 | 只有名字 | 国内平台"默认显示父级" |
| 学过但不稳 | `#5A6472` | FSRS stability 低 | Math Academy 明度编码 |
| Familiar | `#8FA0B8` | 能做对但需提示 | Khan 的五级命名 |
| Proficient | `#4C8DFF` | 独立做对 | Khan |
| Mastered | `#2E5FCC` + 细金边 | 间隔挑战也过 | Khan + Duolingo Legendary |
| 待复习（衰减中） | 橙色脉冲环 | retrievability 下降 | FSRS 的 R 值 |
| **掌握度掉级** | 蓝色→灰色 + **一次性闪白** | 显式告知"你丢了它" | Khan "levels can move down" |

> **不显示百分比**。Khan 给百分比是在课程维度（"25% of course mastered"），节点维度全是等级名 + 颜色。2000 节点上显示"73.2%"既不准确也不可行动。

---

## 附录 A：三种形态的取舍 + 必答问题

### A.1 纯刷题 / 纯闯关 / 掌握度驱动

| | 纯刷题 | 纯闯关 | 掌握度驱动 |
|---|---|---|---|
| **代表** | 猿题库、小猿 | Duolingo、头歌 | Math Academy、ALEKS、Khan |
| **强项** | 覆盖率、熟练度、题量大时提分快 | 日活/留存、上手门槛低、动机强 | 理解深度、可解释、知道"下一步该学什么" |
| **弱项** | 无结构、容易"刷了很多但不会"；错了只知对错 | 通过 ≠ 掌握（Brilliant 自己承认）；深策略学科有天花板（Duolingo Chess）；节奏僵化 | 慢、冷启动诊断成本高、短期成就感弱 |
| **适合** | 已有体系的考前冲刺 | 语言/词汇/语法/可自动判定的实验 | 概念密集、有前置依赖的学科 |
| **不适合** | 概念密度高、需推导的学科 | 需要长链推理的内容（证明、设计、调试） | 用户只想快速过一遍 |
| **失败模式** | 虚假熟练（里斯本论文的"high-XP 但无效率感"） | 心/能量惩罚导致直接退出（Örebro 论文） | 挫败感、进度看起来不动 |

### A.2 有没有产品成功融合了"刷题"和"掌握度学习"？

**有，三家，各融合了一半：**

1. **Khan Academy** —— 融合点在**通道分离**：日常刷题只能升到 **Proficient**（刷题负责熟练），**Mastered 必须通过 Mastery Challenge / 单元测试**（考试负责掌握）。而且 **Mastery Challenge 自己负责间隔调度**：同一个 skill 大约每 16 小时才出现一次，打散在"jumbled context"里。
   → **这是最完整的一个答案：刷题管熟练度，考试管掌握度，间隔由考试池控制。**
2. **Math Academy** —— 融合点在**判定阈值**：刷题本身就是判定，但过关阈值是"**连对 2 题**"，并且稳定性被单独编码进图谱颜色。刷题（练习）与掌握（stability）在同一个动作里产出两个信号。
3. **小猿/猿题库** —— 融合点在**错题 → 变式题**：刷题产生错题 → 错题聚合出"薄弱知识点"（描述到错误机制）→ 从图谱 + 掌握度生成 8–12 题专项包。**掌握度不是独立模块，是刷题的副产物。**

### A.3 必答：核电子学 + 数字电路，哪种形态最合适？

**答案：掌握度驱动为骨（70%），刷题式关卡为肉（25%），纯闯关的路径壳只用于"导航感"（5%）。不要做纯闯关。**

四条理由：

1. **这门学科的可判定单位是"计算/推导/设计"，不是"选择"。** 头歌的先例说明工科闯关成立的前提是**每关有可自动判定的产物**。核电子学里能自动判定的产物很多（算出的灵敏度、算出的噪声、写出的 Verilog 通过 testbench、化简后的卡诺图），但**如果关卡退化成四选一，它就自动变成纯刷题**——那不如直接承认是刷题。→ **关卡的核心资产是"可判定的产物生成器"，不是关卡动画。**

2. **前置依赖是硬约束，图谱是必需的导航。** "电荷灵敏度"依赖"噪声模型"依赖"概率统计"；"时序逻辑"依赖"布尔代数"。ALEKS 的 90% 就绪度命中率说明：**只要正确地识别"现在该学什么"，掌握率会跳到 90%+**。这个杠杆比任何游戏化奖励都大一个数量级。

3. **闯关的线性门禁与这门学科的"回头路"冲突。** 电路题的一个错误常常因为**三章前的一个概念**（比如把"分贝"当线性量）。硬门禁会阻止用户回到三章前。→ 必须是 **SuperMemo 式的优先级队列 + 可任意断点续读**，而不是"第 3 章不通过不能进第 4 章"。

4. **纯闯关的动机机制在专业学科上的证据是负向的。** Duolingo 自己在 2025 年撤掉了心机制（初学者 2× 更容易在中途耗尽心）；Örebro 论文记录"生命值耗尽后立即停止学习"；Duolingo Chess 被棋类社区评为"教得会走子、教不会下棋"；Brilliant 自称掌握判定比 Math Academy 宽松、不推荐给需要严格掌握度的学生。→ **把 Duolingo 的皮（路径 + 一屏一题 + 连胜）拿来做导航和节奏是可以的，但把它的"心"和"关卡门禁"拿来做学科推进是错的。**

**具体配比**：
- **骨**：知识图谱 + FSRS 调度 + "就绪度"判定 + Khan 五级掌握度。
- **肉**：Duolingo 的一屏一题物理形态 + Brilliant 的"先做预测再给方法" + Math Academy 的"先例题、连对 2 题过关"。
- **壳**：Duolingo 的蜿蜒路径（**只在一个"章节"内提供方向感**，不跨章节做门禁）、Duolingo Chess 的"Section 映射到外部量表"（核电子学的对应物 = "能读懂哪一级 datasheet / 能独立完成哪类实验"）。

---

## 附录 B：可直接借鉴的 5 个机制（具体到能实现）

### 机制 1｜Khan 的 Mastery Challenge：16 小时间隔的"抽考池"

**做什么**：一个 skill 到达 Familiar/Proficient 后，**不准**再靠普通练习升到 Mastered。系统把它放进"挑战池"，同一 skill **每 16 小时最多抽到一次**，抽到时题目**混在别的 skill 中间**（jumbled context），限时、不给例题。

**实现**：`challenge_pool` 表存 `(user_id, skill_id, last_challenged_at)`；生成挑战时 `WHERE last_challenged_at < now() - interval '16 hours'`；抽 8–12 个不同 skill 交错排列；答对 +50 分（对应 energy points），答错则 `mastery_level -= 1`，`needs_practice = true`。

**为什么值得抄**：这是**唯一一个同时解决"刷题 vs 掌握度"和"间隔重复 vs 线性闯关"的现成设计**。间隔重复不占主路径，由池子控制出场。

来源：`support.khanacademy.org`（Mastery Challenges 帮助页）

---

### 机制 2｜Math Academy 的"连对 2 题过关 + 每 150 XP 小测"

**做什么**：一个知识点**先给完整例题**（worked example + 图示），然后最多 5 道练习。**连对 2 题 → 过关**；否则继续加题（不设上限，但每题都有解析）。累计 **150 XP**（≈150 分钟专注）触发一次限时小测，**小测里例题不可见**，错的知识点**立刻变成明天的复习项**。

**实现**：
```
advance = (consecutive_correct >= 2)
xp += 1 per minute of focused work (计时器 / 题目难度加权)
if (xp_since_last_quiz >= 150) open_quiz(timer, hide_examples=true)
on_quiz_wrong(topic) -> review_queue.enqueue(topic, due=tomorrow, priority=high)
```

**为什么值得抄**：把"过关"从"做完 N 题"改成"**连续正确**"，成本几乎为零，但直接消除了"蒙对也算过"。配合"每 150 XP 小测"，构成"练习—验证"两段式。

来源：`mathacademy.com/how-it-works/`

---

### 机制 3｜Duolingo 的"复习即前进"+ Legendary（无提示的复战）

**做什么**：路径上不允许出现"复习"作为独立入口。点已完成节点 → 打开**快速复习课**，它以"路径上的下一格"的形态出现，走完照样推进路径进度。一个单元全部完成后解锁 **Legendary**：**同样的内容，难度更高，且完全不给提示**，通过后节点变**金色**。

**实现**：
- 复习课生成时 `is_review = true`，但 `path_position` 照常 `+1`（心理上"前进"，实际是复习）；
- `legendary_unlocked = (unit.lessons_completed == unit.lessons_total)`；Legendary 模式 `hints_enabled = false`，`pass_threshold` 抬高；
- 通过后 `node.style = gold`。

**为什么值得抄**：它把"回头看"变成"往前走"，这是路径化设计最重要的心理杠杆（官方原话：路径的蜿蜒"adds a confidence boost when you scroll back up through completed lessons"）。**Legendary = 用视觉奖励（金色）替代数字奖励，且天然是"掌握度"的证明。**

来源：`blog.duolingo.com/new-duolingo-home-screen-design/`、`blog.duolingo.com/different-kinds-of-practice-duolingo/`

---

### 机制 4｜SuperMemo 的优先级队列 + read-point（解决"闯关门禁 vs 打散复习"）

**做什么**：不做线性门禁。所有到期项（新知识点 + 复习项）进**同一个队列**，按优先级 0–100% 排序（0% = 最高）。**今天做不完就自动顺延低优先级项**，用户永远不会"卡住"。每张卡/每篇文章都有 **read-point**，下次从断点继续。

**实现**：
```ts
priority = w1 * overdue_days + w2 * (1 - stability) + w3 * prereq_gap + w4 * user_goal_weight
// 0 = 最高优先级（注意方向与常见排序相反）
queue = items.filter(due <= today).sort((a,b) => priority(a) - priority(b))
// 今日配额满 → 剩余项 rollover，不报错、不锁界面
```
`read_point: { item_id, fragment_index, updated_at }`

**为什么值得抄**：官方原话"**interrupted reading is a rule, not an exception**"。对我们要做的应用，这意味着**用户随时可以中途切走，回来从原处继续**——这恰好也是"底部常驻输入框"这个交互形态的前提（用户随时会插话）。

来源：`mail.super-memory.com/help/read.htm`

---

### 机制 5｜Neo4j Bloom 的"两点入场 + Dismiss 去毛球 + 按跳数展开"

**做什么**：**永远不从全图开始。**空画布只给两个入口：**"看个样例"** 或 **"搜一个节点"**。展开时指定"沿哪种关系、哪个方向、最多几个节点"。一次 `Dismiss` 删掉所有"没有可见邻居"的节点——毛球立刻瘦成骨架。

**实现**：
```
entry: [snippet] | [search]
expand(node, {relTypes, direction, maxNodes=20})
dismiss(node) → remove node
dismissOrphans() → remove all nodes with visibleDegree == 0
focus(node, hops) → visible = bfs(node, hops); rest.hidden
```
配合 Obsidian 式的 **Groups 上色**（一条规则 = 一组颜色）和 **text fade threshold**（缩放 < 0.6 时只画点不画字）。

**为什么值得抄**：这是我们"深色知识图谱画布"能承载 2000+ 节点的唯一可行路径。Obsidian 社区的判词已经说死了：**全图在 200 节点时就是毛球，毛球什么也告诉不了你**。

来源：`neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/bloom-scene-interactions/`、`docs.kumu.io/guides/focus`、`help.obsidian.md/plugins/graph`

---

## 附录 C：引用 URL 列表

**一手（官方文档 / 官方博客 / 官方源码）**
1. https://blog.duolingo.com/new-duolingo-home-screen-design/
2. https://blog.duolingo.com/different-kinds-of-practice-duolingo/
3. https://blog.duolingo.com/duolingo-energy/
4. https://blog.duolingo.com/review-exercises-help-measure-learner-recall/
5. https://blog.duolingo.com/developing-math/
6. https://blog.duolingo.com/chess-course/
7. https://duolingodata.com/dat/chfen200.html
8. https://blog.duolingo.com/duolingo-launches-math-app/
9. https://duolingo-papers.s3.us-east-2.amazonaws.com/reports/Duolingo_whitepaper_language_read_listen_write_speak_2024.pdf
10. https://support.khanacademy.org/hc/en-us （Mastery levels / Mastery Challenges / Energy points 系列帮助页）
11. https://mathacademy.com/how-it-works/
12. https://www.aleks.com/about_aleks
13. https://brilliant.org/resources/choosing-brilliant/how-brilliant-teaches-math/
14. https://brilliant.org/resources/choosing-brilliant/is-brilliant-good-for-remediation/
15. https://docs.ankiweb.net/deck-options.html
16. https://www.super-memory.com/english/ol/sm2.htm
17. https://github.com/open-spaced-repetition/py-fsrs （`fsrs/scheduler.py`）
18. https://mail.super-memory.com/help/read.htm
19. https://yuantiku.com/activity/gaokao/tutorial
20. https://b.geekbang.org/mall/path/86 ・ https://time.geekbang.org/learning/path-detail/41
21. https://help.obsidian.md/plugins/graph
22. https://docs.kumu.io/guides/focus
23. https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/bloom-scene-interactions/
24. https://www.notion.com/help/guides/notion-ai-for-docs
25. https://aiuxplayground.com/teardowns/perplexity/output
26. https://www.duolingo.com/static/investors/ （10-K：streak/DAU 口径）
27. https://www.boot.dev/

**论文 / 研究（DOI 可查）**
28. https://doi.org/10.1177/21582440261421375 （Sage Open 2026，游戏化元分析：证据 mixed）
29. https://doi.org/10.1145/3555649 （相对反馈加剧努力与绩效差距）
30. https://doi.org/10.1145/3506860.3506916 （绩效反馈 vs 掌握度反馈对动机的影响，LAK22）
31. https://doi.org/10.1109/educon45650.2020.9125395 （STEM 编程课游戏化综述）
32. https://doi.org/10.1109/educon45650.2020.9125283 （游戏化提升编程动机）
33. https://aclanthology.org/P16-1174/ （Duolingo HLR 半衰期回归模型）
34. https://www.sciencedirect.com/science/article/pii/S1041608026000993 （"The future of gamification: beyond performance metrics and leaderboards?"）
35. https://urn.kb.se/resolve?urn=urn:nbn:se:oru:diva-1971949 （Duolingo 惩罚机制与动机，Örebro）
36. https://oulurepo.oulu.fi/handle/10024/54117 （streak 作为"bully"的定性研究）
37. https://run.unl.pt/handle/10362/171644 （高 XP 用户的"无效率感"）

**二手（评测 / 教程 / 社区，数字不可当实验结论）**
38. https://lichess.org/@/baihualin/blog/learning-chess-with-duolingo-the-truth-after-200-games
39. https://newsletter.uxuniversity.io/p/streaks-are-the-most-effective-and （streak/freeze/流失数字，二手）
40. https://beginnersinai.org （Brilliant 课程页/上课流程走查）
41. https://m.php.cn/faq/2475417.html （作业帮学习报告）
42. https://www.php.cn （小猿 AI 作业报告 / 举一反三 / 72 小时学情更新）
43. https://www.educoder.net （头歌关卡形态、评测按钮、解锁机制）
44. https://www.dedao.cn （得到听书知识地图：11 座大陆、碎片、勋章）

---

*调研方式说明：本机 `web_search` / `web_fetch` 因 DNS 劫持到内网段不可用，改用 DeepSeek Search API（`api.deepseek.com/v1/tools/search`、`/v1/tools/fetch`）与 `raw.githubusercontent.com` 直取源码完成。国内平台（educoder / chaoxing / yuantiku 登录后页面）有反爬，机制细节来自官方教程页与教学案例 PDF，已在正文标注二手。*
