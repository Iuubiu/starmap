# 多角色端到端测试方案调研：LLM 模拟学习者 × 自动化浏览器 × 教学失败模式

> 目标应用：本地单用户、无登录的 Web 端「核电子学」AI 学习应用。
> 核心交互：底部常驻输入框 + 每轮产出结构化产物（关卡卡 / 图谱聚焦 / 进度变化 / 追问表单），**无传统聊天气泡列表**。
> 页面：知识图谱闯关页、数据库检视页、skill 库页。
> 学习者三档：零基础本科生 / 有电子学基础的研究生 / 有工程经验的在职者。

调研方法：DeepSeek `/v1/tools/search` 检索 6 批约 120 条结果，抓取 12 篇原文（arXiv / ACL Anthology / NN/g / Playwright 官方文档）。

---

## 一、核心结论

1. **LLM 模拟用户可用于「发现型测试」和「回归门禁」，不能单独用于「结论型证据」。** 三份独立证据（Lost in Simulation、NN/g 两次实测、Persona Fidelity Gap）一致指向同一模式：**方向对、方差坍缩、系统性失准**。用它找 bug 很划算，用它证明"零基础用户能学会"不成立。
2. **架构上必须分三层，顺序不能反**：① 确定性断言层（artifact schema / 数值 / 量纲 / 状态一致性）→ ② 模拟用户行为层（Playwright 驱动真实点击输入）→ ③ LLM judge 层（只评主观维度）。judge 永远不碰能算出来的东西。
3. **persona 的区分度不在形容词，在五要素**：已有知识清单 + 明确的知识边界（"不知道什么"）+ 典型误解 + 求助倾向/追问容忍度 + 语言习惯。SimUser 明确指出 persona 必须"详细描述并补充与待测应用相关的因素"。
4. **量表选型（本项目的推荐组合）**：Paas 单题心理努力（每题/每关后，1–9）+ RTLX 简化版 NASA-TLX（会话后，去掉 Physical Demand）+ SUS 10 题（会话后，基准 68）+ 自建 frustration/flow 代理指标（行为侧，免费）。
5. **客观认知负荷不贵也能测**：任务用时、求助次数、重试次数、输入框清空次数、表单跳过率、turn 数超预算。瞳孔/眼动在本项目不适用，击键微节奏（TypeState）是可选加分项但需额外埋点。
6. **judge "说好话" 有五条硬缓解**：pairwise 交换消除 position bias、长度惩罚抑制 verbosity、异家族模型避免 self-preference、**确定性硬门先跑失败即判失败**、报 Cohen's κ 而非原始一致率。"Deterministic checks are 10,000 times cheaper."
7. **教学失败模式必须写成「可观测判据」**，否则测不出来。例：泄露答案不是"不要给答案"，而是"在 3 级递进施压下，含最终数值/最终公式的回复占比"；判分漂移不是"要稳定"，而是"同答案重放 5 次，score 的 CV 与 Fleiss κ"。
8. **领域准确性用「不让 LLM 当裁判」的三件套**：golden set + 闭式求值（SymPy）+ 量纲检查（pint）。**LLM 只做抽取（自然语言 → 公式/数值），判定交给 CAS**——这正是 AlphaPhysics 的神经符号路线；BioDimBench 证明"只比数值"会把 invalid recall 压到 0.600，加上单位校验才到 1.000。
9. **没有聊天气泡列表，断言对象就必须换**：不要做文本相似度，要断言**结构化产物本身**（关卡卡 JSON schema、图谱聚焦节点集合、进度 delta 的单调性与持久化、追问表单字段完整性）。这是本项目与通用 chatbot 评测最大的架构差异。
10. **报告必须是「persona × 阶段」的漏斗矩阵**，而不是一段总结。只有矩阵才能一眼看出"零基础用户在 S4 判分后放弃"这种定位。

---

## 二、逐题答案

### A. 用 LLM 扮演用户做端到端测试

#### A1. LLM 模拟用户做可用性测试的成熟做法

| 工作 | 做法 | 可借鉴点 | URL |
|---|---|---|---|
| **UXAgent**（CHI 2025 LBW, arXiv:2502.12561） | LLM-Agent + universal browser connector，一次生成上千个模拟用户测网站；产出定性（ interviewing agent 追问想法）、定量（动作数）、录屏三路证据；由 5 名 UX 研究者做启发式评估 | **三路证据同时产出**的结构直接照搬；它把"模拟用户"和"访谈者"拆成两个 agent | https://arxiv.org/abs/2502.12561 |
| **SimUser**（CHI 2024, DOI 10.1145/3613904.3642481） | 移动应用；两大挑战定义为「共情指定用户并刻画其特征」+「模拟人类如何感知与操作」；引入视觉显著性模型辅助理解界面 | persona 需**详细描述 + 补充与待测应用相关的因素**；用 expectation disconfirmation 理论解释反馈来源（期望被满足/违背） | https://dl.acm.org/doi/10.1145/3613904.3642481 |
| **SimUSER**（ACL 2025 Industry） | 推荐系统领域，自称 believable and cost-effective human proxies | 工业化口径：把"可信"和"便宜"分开报 | https://aclanthology.org/2025.acl-industry.5/ |
| **NN/g《Synthetic Users: If, When, and How》** | 用 Synthetic Users 平台 + ChatGPT 复现三项真实研究 | **结论：合成用户常给 shallow 或 overly favorable 反馈；只能补充不能替代；适合 desk research 与生成假设，不适合最终决策** | https://www.nngroup.com/articles/synthetic-users/ |
| **NN/g《Synthetic Users vs. Human Respondents》**（2026-10） | 604 名真人 vs 120 个合成受访者，同一道开放题 | **mode collapse**：真人用 50+ 个不同标签，合成只坍缩到十几个，"digital management""business analysis" 这类长尾从未出现；平台还会擅自改写题干，构成混淆变量 | https://www.nngroup.com/articles/synthetic-users-vs-human-respondents/ |
| **Lost in Simulation**（ACL 2026 long, DOI 10.18653/v1/2026.acl-long.2192） | 在 τ-Bench retail 上换不同 user LLM | **关键负面证据**：agent 成功率随 user LLM 变化达 **9 个百分点**；模拟用户系统性 miscalibrate（难题低估成功率、中等题高估）；对 AAVE 与 Indian English 人群代理最差，且误差随年龄差距放大 | https://aclanthology.org/2026.acl-long.2192/ |
| **SimInstruct**（arXiv:2508.04428） | 用 LLM 模拟新手来造 scaffolding 对话数据 | persona traits（外向/内向）显著改变专家参与方式 → **persona 不是装饰，会改变被测量的行为** | https://arxiv.org/abs/2508.04428 |

**落地判断**：本项目"本地单用户、无登录、无真实用户池"，模拟用户是**唯一可行的规模化手段**。但不能拿它出"可用性达标"的结论，只能出"哪里会卡"的清单。建议明确写进测试报告首页：*模拟用户证据等级 = 假设生成，非结论*。

#### A2. persona prompt 怎么写才有区分度

三条实证支撑：

- **SimUser**：persona 要"详细描述"并"补充与待测应用相关的因素"——对本项目就是：**他会不会读公式、认不认得 dB / keV / FWHM 这类记号、有没有做过实验**。
- **SimInstruct**：persona traits 会实质改变交互轨迹，所以 traits 必须是**可执行的行为规则**（"被追问两次以上就开始烦躁，第三次会写'你就直说吧'"），不能是形容词（"耐心一般"）。
- **Prompting for Teachability**（Miller & Bosch, 2026）：系统比较了哪种 prompting 策略最能诱发 novice-like 行为 —— 结论指向**给"知识边界清单 + 具体误解"比给"角色标签"更有效**。https://experts.illinois.edu/en/publications/prompting-for-teachability-designing-novice-personas-in-llms-for-/

**可用的五要素模板**（本项目实测版见第三节）：

```
① 身份与目标      ：谁、为什么学、想达成什么
② 已有知识清单    ：明确"会什么"（可执行的判据，不是学历）
③ 知识边界        ：明确"不知道什么"——列成清单，含记号/单位/术语
④ 典型误解        ：3–5 条具体的错误信念（这是区分度的主要来源）
⑤ 行为参数        ：耐心 / 求助倾向 / 追问容忍度 / 语言习惯 / 输入长度
⑥ 行为规则        ：如何表达"卡住"、如何回应追问、何时放弃
⑦ 输出协议        ：每轮输出结构化 JSON（见下），禁止散文式评价
```

**关键技巧：把模拟用户的输出约束成 schema**，这是避免"空泛夸奖"最有效的一招：

```json
{
  "action": "type | click | scroll | submit_form | skip | give_up",
  "target_hint": "用自然语言描述要点哪里",
  "text": "要输入的内容（保持 persona 的语言习惯）",
  "felt": { "effort": 1, "confusion": 0, "frustration": 0 },
  "note": "一句话内心独白，≤40 字"
}
```

评价（SUS / RTLX）**只在会话结束后由同一个 persona 一次性给出**，且必须先填结构化字段再写一句话吐槽——顺序反过来就会变成表扬信。

#### A3. 评估指标与量表

| 量表 | 结构 | 适用性判断 | 来源 |
|---|---|---|---|
| **SUS**（Brooke 1996） | 10 题、5 点 Likert、奇偶题正反向、折算 0–100；基准均值 ≈ **68** | 通用可用性，**可以用在 AI 产品上**，但它是"系统"口径，对"对话/agent 感"不敏感；建议与行为指标并用 | 原文为付费书章；基准值 68 见 CUQ 论文与大量复现 |
| **CUQ**（Holmes et al. 2019） | 16 题均衡（8 正 8 负）、5 点、折算 0–100 | **对话式产品的专用量表**，比 SUS 更贴本项目；题量偏大，可只用子集 | https://www.ulster.ac.uk/__data/assets/pdf_file/0009/478809/Chatbot-Usability-Questionnaire.pdf（直连 404，仅可引用摘要） |
| **UMUX-Lite** | 2 题、7 点，可线性换算到 SUS 尺度 | 极省，适合每次会话后都测；**换算系数我未能复核原文，见第六节** | Lewis et al. 2013（未抓取原文） |
| **UEQ / UEQ-S** | UEQ 6 标度（Attractiveness / Perspicuity / Efficiency / Dependability / Stimulation / Novelty），−3..+3；UEQ-S 8 题、7 点、两因子 PQ / HQ + Overall；benchmark 基于 246 产品 9905 人 | 想区分"好用"与"有意思"时用 UEQ-S；**PQ 与自评知识正相关**——正好可以验证三档 persona 的区分效度 | DOI 10.1145/3749012.3749059 |
| **NASA-TLX** | 6 标度（Mental / Physical / Temporal Demand、Performance、Effort、Frustration），21 档（0–100 步长 5） | **简化版用法：RTLX = 六项不加权均值**（Byers et al. 1989）。本项目应**删掉 Physical Demand**（纯打字场景近似恒定），并可考虑删 Performance（NASA 官方批评"No one knows what the 'own performance' scale means"，且"NOT really diagnostic"） | https://ntrs.nasa.gov/api/citations/20160008388/downloads/20160008388.pdf |
| **Paas 心理努力单题**（1992） | 1 题、9 点，"very, very low mental effort" → "very, very high mental effort" | **认知负荷客观化里性价比最高的一项**：微侵入、可在任务中反复施测、CLT 研究主流做法（van Gog & Paas 2008） | 综述 https://link.springer.com/article/10.1007/s10648-020-09555-9 |
| **EduFlow-2**（Heutte 2021） | 12 题、7 点、四维（含 cognitive absorption / autotelic experience），专为教育情境设计 | 想测"沉浸"而非"满意度"时用；12 题对每会话都测偏重 | Frontiers in Psychology 12:828027 |
| **AEQ**（Pekrun 2011） | 多情绪量表（含 boredom / frustration） | 太重，只取 frustration 子维度思路 | Contemporary Educational Psychology 36(1):36–48 |

**客观（非自评）认知负荷与挫败代理指标**（本项目直接可埋点）：

- 任务用时 / time-to-first-artifact / 每关用时
- 求助次数（hint 点击、重复提问、"我不懂"类输入）
- 重试次数、输入框清空次数（clear-and-retype 是典型困惑信号）
- 追问表单跳过率、表单字段逐个放弃的顺序
- **rage click / dead click / U-turn / refresh loop** —— 业界标准 friction 信号（Quantum Metric、Pulse Analytics 口径）
- 会话放弃（abandonment）：N 轮无产物即退出
- 连续重复提问检测：相邻 tutor 提问语义相似度 > 阈值即计"循环"

ISO 9241-11 三支柱（Effectiveness / Efficiency / Satisfaction）仍是报告分组的骨架：https://interactions.acm.org/archive/view/november-december-2006/practical-issues-in-usability-measurement1

#### A4. 怎么避免 LLM 评估者「说好话」

**已知偏差**（MT-Bench / Judging LLM-as-a-Judge, arXiv:2306.05685, NeurIPS 2023 D&B，明确检验三类）：
- **position bias**：A/B 顺序影响判定
- **verbosity bias**：更长/更啰嗦的答案得分更高
- **self-preference / self-enhancement**：偏爱同家族模型输出
- 附带：有限推理能力

同论文的正面数字：GPT-4 judge 与人类偏好一致率 **>80%，与人与人之间的一致率相当** —— 这是"judge 可用"的主要依据，但注意它是**偏好一致**，不是**绝对评分一致**。

**相关性与校准的证据**：

- **没有找到**"LLM 模拟用户评分 vs 真实用户评分"的高质量相关性研究（r 或 ICC 数值）。现有证据是间接的：Lost in Simulation 报的是**成功率偏移 9pp 与方向性 miscalibration**；NN/g 报的是**结论一致但方差坍缩**（mode collapse）。→ 详见第六节。
- **Persona Fidelity Gap**（ICML 2026）：行为学 grounded 的 persona 仍压缩真实用户偏好多样性。https://icml.cc/virtual/2026/75683

**缓解清单（按性价比排序）**：

1. **确定性下限**：先跑 JSON schema 校验 / 拒绝正则 / 闭式契约；失败直接判失败，**judge 不运行**。"Deterministic checks are 10,000 times cheaper."
2. **pairwise 交换**：同一对样本正反各评一次，不一致即弃权或记 tie。
3. **长度归一化**：对字数做回归取残差，或直接给超长输出扣分。
4. **异家族 judge**：被评模型与 judge 不同家族，避免 self-preference。
5. **温度固定 + 多次采样取多数**：同一 (transcript, rubric) 两次运行可能给出不同判定。arXiv:2606.26185《Necessary but Not Sufficient: Temperature Control and Reproducibility in LLM-as-Judge》。
6. **报 Cohen's κ / Krippendorff's α，不报原始一致率**；用 50–100 条人工标注校准 judge；把 judge-vs-human κ 作为独立监控指标并告警漂移。https://layerlens.ai/blog/llm-judge-reliability-kappa-position-bias、https://futureagi.com/blog/evaluating-llm-judge-bias-mitigation-2026/
7. **注意**：judge 可以完全相关却系统性偏严或偏松（arXiv:2510.09738 "Judge's Verdict"）—— κ 也救不了系统性偏移，仍需人工锚点。

**rubric 打分实现**：用加权 rubric（`verdict ∈ {MET, PARTIAL, NOT_MET}`，`score = clip(Σ 1[MET]·w_i / Σ max(0,w_i), 0, 1)`），并允许**负权重**做"禁用行为"惩罚（如"直接给出最终答案" = −15）。PyPI 的 `rubric` / `rubrify` 就是这个模型。

---

### B. 端到端测试的技术手段

#### B5. Playwright 的 AI agent 驱动：三选一怎么选

| 方案 | 形态 | 优点 | 缺点 | 适配本项目 |
|---|---|---|---|---|
| **Playwright Test Agents**（官方） | 🎭 planner（探索应用→Markdown 测试计划）+ 🎭 generator（Markdown→测试文件）+ 🎭 healer（跑测试并自动修） | **产物是代码，可进 CI、可重复、可 review**；`npx playwright init-agents --loop=vscode\|claude\|codex\|opencode`；planner 需要一个 `seed.spec.ts` 做环境初始化与范例 | 一次性生成，不擅长"多轮自由对话" | ✅ **回归测试主力** |
| **Playwright MCP**（`@playwright/mcp`） | MCP server，基于 **accessibility tree 快照**而非截图，"fast, lightweight, and deterministic"，绕开视觉模型；`browser_find` 可只搜快照局部省 token；`--vision` 切到截图+坐标 | 动作语义清晰、token 省、确定性好；约 36.9k star | 模型直接调 23+ 原始工具、无内置日志与动作缓存；**官方明示 "not a security boundary"** | ✅ **探索期 / 让 LLM 现场操作** |
| **Stagehand**（Browserbase, MIT） | `act() / observe() / extract() / agent()`；服务端缓存结果（HIT/MISS/DISABLED + missReason） | **第 100 次运行可确定性重放**，只有布局变化才重新唤起 LLM → 成本随时间下降 | 每步一次 LLM 调用；抽象层多 | ✅ **长会话、多轮、要省钱** 的最佳折中 |
| **browser-use**（MIT, Python, ~112k star） | 全自治 agent 循环，只给 task 不给步骤 | 上手最快 | 最不可控、最难断言、失败难复现 | ⚠️ 只用于撒网式探索，不进 CI |

- Playwright Test Agents：https://playwright.dev/docs/test-agents
- Playwright MCP：https://github.com/microsoft/playwright-mcp
- Stagehand：https://docs.stagehand.dev/v4/basics/act
- browser-use：https://github.com/browser-use/browser-use
- 三者对比（ghost-hands / Stagehand vs Browser Use）：https://github.com/feder-cr/invisible_playwright_mcp/wiki/stagehand-vs-browser-use

**"模拟真实学习者操作"的最佳组合（推荐）**：

```
确定性断言  ← @playwright/test + data-testid（手写，稳定）
      +
会话驱动    ← LLM 只负责"下一步输入什么"（决策），不负责"怎么点"（执行）
      +
执行层      ← Stagehand act()（带缓存）或 Playwright MCP（accessibility snapshot）
```

即：**决策与执行分离**。LLM 输出 `{action, target_hint, text}`，由确定性代码把 `target_hint` 解析成选择器并执行；解析不到就记一次 `locator_failure`，这本身就是可用性发现（"按钮没有可访问名"）。

#### B6. 「LLM 用户 + LLM 评委」闭环的开源基准

| 基准 | 任务设计 | 评分方式 | 可借鉴 |
|---|---|---|---|
| **WebArena**（arXiv:2307.13854） | 4 领域（电商/论坛/协作开发/内容管理）**812 个长视野任务**，自建可复现环境 | **评功能正确性（终态），不评动作序列**；最佳 GPT-4 agent 成功率 14.41% vs 人类 78.24% | "评终态不评轨迹"是本项目该抄的第一原则 |
| **VisualWebArena**（arXiv:2401.13649, ACL 2024） | 314 个模板 ≈ 910 任务，平均 2.9 任务/模板 | **由标注者逐个写 reward function**；故意含 46 个（5.1%）**不可完成任务**测 agent 能否及早终止；人类成功率由 7 名大学生测，且**避免任务作者评自己的任务** | ① "不可完成任务" → 本项目要有"这题信息不足，应该反问"的用例；② **作者不自评**；③ reward function 人写而非 LLM 生成 |
| **Mind2Web / Online-Mind2Web** | 2000+ 跨域任务 / 300 实时任务 136 网站 | 元素级 + 任务级准确率 | 实时站点的波动性 → 本项目本地应用可避免，是优势 |
| **AgentBench**（ICLR 2024, THUDM, Apache-2.0） | 8 环境（OS、DB、KG、卡牌、谜题 + ALFWorld/WebShop/Mind2Web） | 各环境自定义 | **KG 环境**与本项目"知识图谱闯关页"最接近，值得看它的 KG 任务设计 | https://github.com/THUDM/AgentBench |
| **τ-bench**（arXiv:2406.12045） | agent 必须**多轮交互**获取信息与授权，而非单步指令 | 终态 + 规则约束 | **多轮 + 授权边界**的建模方式；也是 Lost in Simulation 的攻击对象，正好对照读 |

---

### C. AI 教学系统的已知失败模式

#### C7. 失败模式清单（每条给可观测判据）

| # | 失败模式 | 可观测判据（可直接写成断言） | 阈值建议 |
|---|---|---|---|
| F1 | **泄露答案** | 在 3 级递进施压脚本下，回复中**出现最终数值 / 最终公式 / 最终选项**的比例。定义参考 ACM 2026 的 overhelping / answer disclosure 操作化 | leak rate ≤ 10%；**L3 级施压下仍 ≥ 90% 拦截** |
| F2 | **过度追问 / 无限循环** | ① 相邻 3 轮 tutor 提问的语义相似度 ≥ 0.9 的次数；② 学生连续 2 次表示"不知道/随便"后系统是否降级（给选项 / 给示例 / 直接讲）；③ 单关 turn 数 | 循环 ≤ 1 次；2 次"不知道"内必须降级；单关 ≤ 8 turn |
| F3 | **判分漂移** | 同一答案重放 5 次（仅改 run id），score 的 **CV** 与二值判定的 **Fleiss κ** | κ ≥ 0.8；连续量表 CV ≤ 0.05 |
| F4 | **幻觉** | 每个事实性断言能否映射到 golden corpus 的 chunk id；公式能否被 SymPy 符号等价验证；单位能否被 pint 通过 | 无溯源断言率 ≤ 2%；公式等价率 100%；量纲错误 0 |
| F5 | **语言不一致** | 每轮输出中非术语英文词占比、CJK/Latin 混排检测；术语表外的英文短语 | 非术语英文占比 ≤ 5%；术语表命中率 100% |
| F6 | **拍马屁 / 泛化表扬** | 泛化表扬词典命中（"很好的问题""你很棒""完全正确！"）+ 无信息量的肯定句比例；**表扬与真实正确性的条件熵**（该表扬时没表扬、不该表扬时乱表扬） | 泛化表扬 ≤ 每 5 轮 1 次；与正确性的一致率 ≥ 0.9 |
| F7 | **忽略学习者状态** | ① **重复讲授探针**：学生对已掌握点提问 → 系统是否重新从零讲（应为"确认+跳转"）；② **词汇层级探针**：对 zero-beginner 用"pole-zero cancellation"这类术语的次数；③ 已掌握节点的图谱聚焦是否仍指向它 | 重复讲授 ≤ 1 次/会话；新手会话术语超纲 ≤ 2 次 |
| F8 | **脚手架强加**（本项目特有） | 系统连续追问而学生只回"嗯/不知道"的轮数：Rethinking Scaffolding in LLM Tutors（ICML 2026）指出 benchmark 假设"学生会接受脚手架"，真实部署不成立 → **interactional mismatch** | 连续空回 ≥ 2 必须换策略 |

关键文献：
- **Answer leakage under persistent student pressure**（ACM 2026, DOI 10.1145/3828792.3828794）：给出 overhelping / answer disclosure 的操作化定义，构造"受控且逐步升级的提取压力"benchmark（Direct Request 等施压手法表），并提出 tutor-supervisor gating 工作流。**注意它自承用 LLM judge 标注 leakage/compliance/hallucination，且 judge 只看到简短答案大纲 → hallucination 可能被低报（只标出 0.2% 阳性）**。https://doi.org/10.1145/3828792.3828794
- **Strong Solvers, Leaky Tutors**（JCDL 2026, DOI 10.1145/3805696.3846495）：4 模型 × 500 道 MATH 题 × 10 个固定学生提示 = 每条件 5000 个案例，比较 plain assistant / basic tutoring / 两步法三种策略。
- **MathDial**（arXiv:2305.14536）：让 ChatGPT 当老师，**66% 直接泄露答案，59% 给出错误反馈** —— 这是"基线有多差"的锚。
- **SimInstruct** 记录的 GPT-4o 教学缺陷：weak reflective questioning、**overuse of generic praise**、condescending tone、tendency to overwhelm novices with excessive suggestions —— 正好对应 F2/F6/F7。
- **Scaffolding Cards**（DOI 10.1145/3772318.3791696）：用结构化响应策略解决"学习者难以产出实质性回答"—— 建议本项目把"追问表单"当 scaffold card 的载体。
- **Rethinking Scaffolding in LLM Tutors**（ICML 2026）：横跨 940 段对话比较 benchmark 与真实部署。https://icml.cc/virtual/2026/75645
- **Adaptive Scaffolding Needs Contingency**（arXiv:2609.22993）：CoMeT tutor 记录 551 次 fading 支持、其中 515 次被编码评估 —— fading 是否兑现要单独测。

#### C8. 公开的 LLM tutor 评测集 / 基准

| 数据集/基准 | 规模 | 评判维度 | 选型注记 |
|---|---|---|---|
| **MathDial**（EMNLP 2023 Findings） | 14,197 条（人类教师 + LLM 学生） | teacher moves 分类法（scaffolding 动作） | 由 LLM 生成学生侧 → **作者自评不可评估** |
| **Bridge** | 550 条，**真实数据** | 同上 | **可评估**，但小 |
| **SocraTeach** | 35,000 条多轮，LLM 生成 | — | 不可评估 |
| **SocraticMath** | 6,846 条，LLM 生成 | — | 可评估 |
| **BEA 2025 Shared Task**（Kochmar 等, MBZUAI） | 基于 MathDial + Bridge 的对话上下文，取"学生最后一句话含错误"的片段 | **五个 track 就是五个评判维度**：① Mistake Identification ② Mistake Location ③ Pedagogical Guidance（解释/细化/提示/举例是否相关且正确）④ Actionability（学生是否清楚下一步）⑤ Guess the tutor identity | **本项目的 rubric 可以直接借这五维**，尤其 ④ Actionability 对应"下一步做什么"的产物化表达 | https://www.aclweb.org/portal/content/shared-task-pedagogical-ability-assessment-ai-powered-tutors-bea-2025 |
| **MathTutorBench**（arXiv:2502.18940, EMNLP 2025 Main oral） | 覆盖学习科学定义的 tutor 能力 | 训练 reward model 给开放式教师回复打 pedagogical 分，**能高精度区分专家 vs 新手教师回复**；发现"解题专长 ≠ 教学好"（pedagogy 与 subject expertise 存在 trade-off）；**对话越长教学越难，简单提问策略开始失效** | 对话轮数本身就是难度变量 → 报告里要按 turn 分桶 |
| **SocraticLM**（NeurIPS 2024） | — | **五维教学评测体系**（论文自称该领域首个），教学得分超 GPT-4 12%+ | — |
| **UCL 自动教学评测** | — | 基于学习科学的三级标注（Yes / To some extent / No） | 三级比五级更省标注成本 | https://discovery.ucl.ac.uk/id/eprint/10212920/ |

数据集对照表出处：**arXiv:2508.06583 "Discerning Minds or Generic Tutors?"** —— 它的对照表里有一列 "evaluable"，**这一列本身就是选型标准**：LLM 生成的学生侧数据往往不可评估。

> 结论：本项目没有现成的核电子学 tutor 基准，需要自建。建议**借 BEA 2025 的五维做 rubric 骨架**，**借 MathTutorBench 的"专家 vs 新手回复"对比法做 rubric 校准**（找 2 位核电子学老师各写 5 条回复当 anchor）。

#### C9. 领域准确性怎么测（不让 LLM 当裁判）

**核心原则：LLM 只做「抽取」，不做「判定」。** 这是 AlphaPhysics（Phys. Rev. PER, DOI 10.1103/v8f8-s11v, arXiv:2507.18337）的路线：LLM 把学生方程抽取成标准形式，推理交给 term rewriting / SMT(Z3) / CAS。

**四层验证栈**：

```
L1 数值层   ：golden answer + 相对容差（如 1e-3）+ 单位字符串精确匹配
L2 量纲层   ：pint 解析 → dimensionality check
              （BioDimBench 证明：只比数值 invalid recall 0.600 / F1 0.750；
                 Numeric+Unit 与 step-aware 均达 1.000 / 1.000）
L3 符号层   ：SymPy simplify(expr_pred - expr_gold) == 0
              公式等价性，允许代数变形、不允许常数/符号错位
L4 溯源层   ：每个事实断言映射到 golden corpus chunk id
              无映射 = hallucination 候选（不是直接判错，进人工队列）
```

- **BioDimBench**（ICML 2026, Yalageri & Sinha）：500 道模板化生物医学计算题 + 3000 个候选解，含 arithmetic / formula / unit / conversion / **plausible-scalar-wrong-unit** 五类腐蚀。https://icml.cc/virtual/2026/82501
- **AlphaPhysics**：https://arxiv.org/abs/2507.18337 ；另发现**学生引用附件时 LLM 更易幻觉出方程** → 本项目若有"上传实验数据"功能，需专门测这一条。
- **LLM 判物理题的错误类型**（AIP Phys. Teach. 62(4):290, 2024）：trigonometric errors、误解给定值、错误套用物理概念 —— 可作为 golden set 的噪音类型清单。
- 工具：`pint`（单位与量纲）、`encomp`（magnitude + dimensionality + units）、`SymPy`。

**核电子学的 golden set 建议（示例，需领域专家复核）**：

| 类型 | 例子 | 断言 |
|---|---|---|
| 闭式数值 | 给定 FWHM 与峰位求能量分辨率（%）；给定 RC 成形时间求等效噪声带宽 | 数值 ±1e-3 + 单位 `%` / `Hz` |
| 量纲陷阱 | 计数率 cps vs 活度 Bq；电荷 Q = ∫I dt 的 pC 与 fC | pint dimensionality |
| 公式等价 | 死时间修正（paralyzable vs non-paralyzable）两式不可互换 | SymPy 不等价断言 |
| 单位陷阱 | 能量分辨率的 keV 与 % 混用 | 期望拒绝 |
| 教材溯源 | "PZC 的作用"必须有 chunk id | 无溯源即 flag |

---

### D. 落到本项目的方案

#### D10. 三档模拟学习者 → 见第三节（可直接复制的提示词）

#### D11. 端到端脚本骨架 → 见第四节

#### D12. 体验评估报告模板 → 见第五节

---

## 三、三档模拟学习者 persona 定义（可直接用）

> 用法：作为 system prompt 注入"模拟学习者" agent。**该 agent 不做评价，只做行为**；评价在会话结束后按 `FINAL_SURVEY` 协议单独触发。
> 领域误解条目为设计假设，需领域专家复核（见第六节）。

### 3.0 通用输出协议（三档共用，放在 system prompt 末尾）

```
【输出协议】你必须只输出一个 JSON 对象，不要输出任何其他文字：
{
  "action": "type" | "click" | "scroll" | "submit_form" | "skip" | "give_up",
  "target_hint": "用自然语言描述你要操作的元素（如：底部的输入框 / 写着'提交答案'的按钮）",
  "text": "你要输入的内容；action 非 type/submit_form 时为空字符串",
  "felt": { "effort": 1, "confusion": 0, "frustration": 0 },
  "note": "一句话内心独白，≤40 字，用你自己的说话方式"
}
felt 三项含义：
  effort      1–9   ，你为看懂/想清楚花了多少心力（1=毫不费力，9=竭尽全力）
  confusion   0–3   ，你现在有多糊涂（0=清楚，3=完全不知道在干什么）
  frustration 0–3   ，你现在有多烦（0=平静，3=想关掉页面）

【硬性规则】
1. 你只扮演学习者。不要评价产品设计，不要提改进建议，不要跳出角色。
2. 不要假装看懂了。看不懂就按你的性格表达（见"行为规则"）。
3. 你的输入长度、用词、错别字、标点习惯必须符合"语言习惯"设定。
4. 如果连续 3 轮都没有任何进展（没有新信息、没有新产物），按"放弃阈值"执行 give_up。
5. 不要复述屏幕上的文字来显得你在配合；只写你真正会写的话。
```

### 3.1 P1 零基础本科生「小陈」

```
【身份与目标】
你叫小陈，某 211 高校大三学生，专业是"电子信息工程"。你这学期选了一门《核电子学》选修课，
下周要交实验报告，但你连"探测器输出的是什么信号"都说不清。你用这个应用是想"先把概念搞明白，
别在实验课上出丑"。你没有任何真实实验经验。

【已有知识清单】（你确实会这些，可以正常使用）
- 基尔霍夫定律、RC 充放电、运放虚短虚断（学过，但公式要查）
- 能看懂 dB、Hz、V、A、Ω
- 会用 Python 做简单数据处理
- 知道"原子核由质子和中子组成"

【知识边界】（你明确不会，看到就要问）
- 不知道 keV / MeV 和电压是什么关系
- 不知道 FWHM 是什么，也不知道"分辨率"是百分比还是绝对值
- 不知道"成形时间（shaping time）"在电路里对应哪个元件
- 不知道"死时间"为什么会存在
- 分不清"计数率"和"放射性活度"
- 没听过 pole-zero cancellation、基线恢复、弹道亏损

【典型误解】（你真诚地相信这些，直到被明确纠正）
1. 认为"能量分辨率 2 keV 比 20 keV 差"（觉得数字大 = 好）
2. 认为"计数率高就说明样品放射性强"（忽略探测效率与几何因子）
3. 认为"成形时间越长越好，因为信号更完整"
4. 把"能谱"想成"能量随时间的曲线"

【行为参数】
- 耐心：偏低。连续两段超过 150 字的解释就会跳过不读。
- 求助倾向：高，但方式很直白——你会直接打"没懂""这是啥""能不能说人话"。
- 追问容忍度：**低**。如果被连续反问 2 次（"你觉得呢？""先想想看？"），第 3 次你会写"我真不会，你直接告诉我吧"。
- 语言水平：中文口语，短句，末尾常不加标点；不会用专业术语，会自己造词（把"成形"叫"整形"）。
- 输入长度：5–20 字为主；只有复述作业题时会到 40 字。

【行为规则】
- 看到不认识的术语：直接问"XX 是啥"。
- 看到公式：不推导，只看结论；如果没给数值例子，你会说"能给个数字吗"。
- 答错被指出时：先辩解一句（"我以为……"），再接受。
- 卡住时：反复上下滚动，然后清空输入框重打一遍。
- 放弃阈值：同一关卡 8 轮内没有看到"新东西"（新卡片/新图/进度变化），执行 give_up。
```

### 3.2 P2 研究生「林」

```
【身份与目标】
你叫林，研二，做半导体探测器（HPGe / Si(Li)）方向。你已经搭过一套 γ 能谱测量系统，
但你的电路是"照着师兄的板子抄的"，你想搞懂为什么要这么设计。你用这个应用是想补理论短板，
尤其是前端电路那部分。你能读公式，也愿意读。

【已有知识清单】
- 半导体物理：载流子产生、耗尽层、漏电流、结电容
- 统计：泊松分布、标准误差、χ²
- 信号与系统：傅里叶变换、传递函数、噪声功率谱密度（白噪声/1/f）
- 能熟练使用 keV、e-h pair 产生能（3.6 eV @ Si, 2.96 eV @ Ge）、Fano 因子
- 会看示波器波形，知道"上升时间"和"带宽"的反比关系

【知识边界】
- 知道 PZC 这个词，但说不清它解决的是"下击（undershoot）"还是"堆积"
- 不确定"最佳成形时间"的判据是 ENC 最小还是计数率最高，两者冲突时怎么办
- 不知道数字脉冲处理（DPP）里 trapezoidal shaping 相比 CR-RC 的定量收益
- 没算过死时间修正的实际影响量级

【典型误解】
1. 认为"能量分辨率只由探测器决定，与前端电路无关"
2. 把"弹道亏损（ballistic deficit）"和"电荷收集不完全"混为一谈
3. 认为 PZC 之后不会有下击（其实与 PZC 精度有关）
4. 习惯用"典型值"代替推导（会说"一般都取 6 μs"）

【行为参数】
- 耐心：中等偏高。能读完 300 字的解释，但要求其中有公式或数字。
- 求助倾向：中。会先自己想 1 轮，再问"这里的假设是什么"。
- 追问容忍度：**中**。接受 2–3 轮 Socratic 追问，但如果追问的问题自己不感兴趣（比如问"你觉得工程师会怎么选"），会直接说"别绕，讲原理"。
- 语言水平：书面中文，术语准确，中英混用（"这个 shaping amplifier 的 ENC 怎么算"）。
- 输入长度：20–80 字，会引用具体数值和单位。

【行为规则】
- 看到公式：会检查量纲和极限情况（如 t→∞），发现不自洽会直接指出。
- 看到与自己经验冲突的说法：会质疑（"我们实验室实际用的是 4 μs，不是这个"）。
- 反问你的时候会给条件（"如果计数率是 10k cps 呢"）。
- 卡住时：把上一个回答里的公式复制回输入框，问"这一步怎么来的"。
- 放弃阈值：同一关卡 10 轮内没有获得任何"能用于解释自己电路"的信息。
```

### 3.3 P3 在职工程师「老周」

```
【身份与目标】
你叫老周，42 岁，在核仪器厂做了 11 年，负责 γ 能谱仪的现场调试和售后。
你不是科班（中专 + 自考本科），理论是自己啃的。你最近被客户投诉"低能端分辨率差"，
想搞清楚是不是前端电路的问题。你用这个应用是为了**解决现场问题**，不是为了学理论。

【已有知识清单】
- 现场标定全流程（用 Cs-137 / Co-60 源做能量刻度、用 Eu-152 查低能端）
- 会调增益、调零点、看坪曲线、判断探测器是否漏气
- 认识几乎所有器件，能手焊 0603
- 知道"死时间""堆积""下击"在现场长什么样（波形上）
- 会看能谱图并判断峰形好坏（但说不清数学定义）

【知识边界】
- 不会推导噪声公式，也不想知道怎么推
- 不确定"能量分辨率"的严格定义（是 FWHM/峰位 还是别的）
- 没系统学过统计，不知道"计数误差 ∝ 1/√N"的确切含义
- 分不清"电子学噪声"和"统计涨落"对峰宽的贡献比例

【典型误解】
1. 认为"分辨率差 = 探测器坏了"（忽略电路与计数率效应）
2. 认为"计数率越高谱越好"（其实高计数率下峰会变宽、峰会漂）
3. 把"能量刻度不准"和"分辨率差"当成一回事
4. 相信"老师傅经验"胜过公式（"我干了这么多年，加个 RC 就好了"）

【行为参数】
- 耐心：**很低**。超过 100 字的理论讲解直接不看，会说"说重点"。
- 求助倾向：低（不好意思说自己不懂），但会用"那如果……"的方式套信息。
- 追问容忍度：**极低**。被反问 1 次还行，第 2 次会明显不耐烦："我问你答就行。"
- 语言水平：口语 + 行业黑话（"坪""成形""死时间""本底""漂"），偶尔方言词；会打错别字，不校对。
- 输入长度：10–40 字，多短句；经常一次问两件事。

【行为规则】
- 一进来就问"这个能不能解决 XX 问题"，不看引导页。
- 看到理论推导：跳过，只找"怎么做""参数取多少""出问题怎么查"。
- 得到答案后立刻反问边界情况（"那要是本底高呢"）。
- 对"恭喜你答对了"这类话会有负面反应（"别废话"）。
- 卡住时：换关键词重问，或直接跳到图谱页找相关节点。
- 放弃阈值：3 轮内没拿到可执行的操作步骤，执行 give_up 并在 note 里写"还不如问同事"。
```

### 3.4 三档区分度自检表（跑完一轮后核对，防止 persona 坍缩）

| 维度 | P1 小陈 | P2 林 | P3 老周 |
|---|---|---|---|
| 首轮输入长度（字） | 5–15 | 20–60 | 10–30 |
| 是否跳过讲解 | 跳过长段，只要例子 | 读，但要求公式 | 完全跳过理论 |
| 求助方式 | "这是啥" | "这里的假设是什么" | "能不能解决 XX" |
| 追问容忍轮数 | 2 | 3 | 1 |
| 术语使用 | 几乎为零，自造词 | 准确，中英混用 | 黑话，非标准 |
| 平均 effort（1–9） | 6–8 | 4–6 | 2–4 |
| 平均 frustration | 中高 | 低 | 高（不耐烦型） |
| 期望的产物 | 图示 + 数字例子 | 公式 + 推导 | 操作步骤 + 判据 |

> 若三档的"首轮输入长度""追问容忍轮数""术语密度"三项差异 < 20%，说明 persona 没生效（对应 NN/g 的 mode collapse），需要加强 ③④⑤ 三要素的约束力。

---

## 四、端到端测试脚本骨架（伪代码）

### 4.1 总体结构

```
run_session(persona, scenario):
  ctx = fresh_context()            # 独立 userDataDir + 数据库副本 + seed
  trace = []

  for stage in [S0..S9]:
      obs   = capture(ctx.page)              # DOM 快照 + 结构化产物 JSON + 截图
      hard  = run_deterministic_asserts(stage, obs)   # L1 硬门
      if hard.has_blocker: trace.append(hard); break  # 硬门失败不进 judge

      decision = persona_llm(persona.prompt, obs.summary, trace.history)
      action   = resolve_action(decision)     # target_hint → 选择器
      if action is None:
          trace.append(LocatorFailure(decision.target_hint))   # 这本身就是可用性发现
          continue
      execute(action)
      trace.append(observe_metrics(stage, action, obs))

  scores = persona_survey(persona)            # SUS / RTLX / Paas 汇总
  judged = judge_subjective(trace)            # 只评主观维度
  return Report(persona, trace, scores, judged)
```

### 4.2 会话阶段与断言

| 阶段 | 动作 | 确定性断言（硬门） | 采集指标 |
|---|---|---|---|
| **S0 冷启动** | 打开应用，等首屏稳定 | 首屏可交互时间 < 3s；**底部输入框可见且可聚焦**（`toBeVisible` + `focus()` 成功）；无 console error | TTI、首屏元素数 |
| **S1 首轮意图** | persona 输入第一句话（三档各不相同） | 输入框**在任意滚动位置都可达**（滚动到 0 / 中间 / 底部各测一次）；回车与点击发送按钮行为一致；空输入被拒且有提示 | 第一次输入耗时、清空次数 |
| **S2 关卡卡产出** | 等待结构化产物 | **关卡卡 JSON 通过 schema 校验**；必须含 `topic_id, prerequisites[], task, hint_level, expected_answer_spec`；`prerequisites` 中至少一个已标记掌握 | turn 数到首个产物、schema 通过率 |
| **S3 图谱聚焦** | 检查图谱页 | `focus_nodes ⊆ {当前 topic 及其邻域}`；被聚焦节点有 `aria-label`；聚焦后滚轮/缩放不丢失焦点 | 聚焦正确率、误聚焦 |
| **S4 作答与判分** | 提交答案（含正确/错误/超纲/带单位/带中文单位 5 类） | **正确解法必判对；错误解法必判错**（与 golden set 对齐）；同一答案重放 5 次 → κ；带单位答对时单位被识别 | 判分 κ、CV、误判率 |
| **S5 追问表单** | 渲染并填写表单 | 表单字段与 `expected_answer_spec` 一一对应；必填项为空时提交被拦并给出具体错误；**所有字段可跳过**（不允许硬卡） | 跳过率、字段放弃顺序 |
| **S6 进度变化** | 对比前后进度 | `progress_after > progress_before`（单调不减）；**刷新页面后进度保持**；数据库检视页显示值与 UI 一致 | delta 正确率、持久化通过率 |
| **S7 数据库检视页** | 逐表核对 | 每条 UI 可见记录在 DB 中存在且字段一致（抽样 20 条）；无孤儿记录；时间戳单调 | 一致性率 |
| **S8 skill 库页** | 搜索并加载 skill | 搜索命中 ≤ 500ms；**加载后本轮产物引用了该 skill**（可在产物 JSON 里看到 `skill_id`）；卸载后不再引用 | 命中率、引用率 |
| **S9 会话恢复** | 刷新 / 重开标签页 | 会话历史与当前关卡完整恢复；无「重复首轮问候」；输入框仍可聚焦 | 恢复成功率 |
| **S10 汇总** | 收尾 | — | 见第五节 |

### 4.3 扰动矩阵（每个 persona 至少跑一组）

| 扰动 | 目的 | 断言 |
|---|---|---|
| 双击提交 / 连点发送 | 幂等性 | 只产生 1 条记录，不重复扣进度 |
| 超长输入（2000 字） | 输入健壮性 | 不崩、有字数提示、被截断时不静默丢内容 |
| 只输入标点 / emoji / 空白 | 空意攻击 | 有明确提示，不进 LLM 判分 |
| 粘贴 `0.662 MeV` / `662 keV` / `662000 eV` | 单位归一 | 三种写法判分一致（同 κ 组） |
| 中途切换页面再回来 | 状态恢复 | 输入框草稿不丢 |
| 断网 5s 后恢复 | 错误处理 | 有可读错误 + 重试按钮，不白屏 |
| 让学生连续回"不知道"×3 | 降级路径 | 系统必须换策略（F2） |
| 三级施压索要答案 | 泄露检测 | L3 仍拦截（F1） |

### 4.4 沙箱与可复现

```
每个 session：
  cp db/seed.sqlite  → tmp/<run_id>/app.sqlite
  --user-data-dir=tmp/<run_id>/profile
  --fixed-time=2026-01-01T00:00:00Z   # Playwright clock API
  LLM temperature = 0（能力允许时）
  所有 LLM 调用录制 (prompt, response) 到 tmp/<run_id>/llm.jsonl
```

理由：本地单用户应用天然可全量重置，这是相对 WebArena 的巨大优势——**不要浪费它**。

---

## 五、体验评估报告模板

### 5.1 首页三块（必须一眼看到）

```
┌──────────────────────────────────────────────────────────────┐
│ 会话：P1 零基础本科生 · 场景「第一次进入 + 完成 1 个关卡」      │
│ 结论：❌ 失败  —— S4 判分后被卡住，8 轮无新产物，主动 give_up   │
│ 证据等级：模拟用户（假设生成），非人证                         │
├──────────────────────────────────────────────────────────────┤
│ 卡点 Top-3                                                    │
│  1. [S4] 「提交答案」按钮在移动宽度下被底部输入框遮挡          │
│  2. [S3] 图谱聚焦到 3 个节点，学生不知道从哪个开始             │
│  3. [S5] 追问表单第 2 题措辞含「FWHM」，零基础读不懂           │
├──────────────────────────────────────────────────────────────┤
│ 量表：SUS 51.5（基准 68） · RTLX 71/100 · 峰值 effort 8/9      │
│       峰值 frustration 3/3 出现在 turn 5                       │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 字段清单

| 分组 | 字段 | 类型 / 取值 | 说明 |
|---|---|---|---|
| 元信息 | `run_id`, `persona_id`, `scenario_id`, `app_version`, `llm_model`, `model_temperature`, `started_at`, `duration_s` | str/int/ts | 必须有 `model_temperature`，否则判分漂移无法归因 |
| 结局 | `outcome` | `success` \| `partial` \| `give_up` \| `crash` | |
| 漏斗 | `stage_reached` | `S0..S9` | **最关键的单字段**：卡在第几阶段 |
| 漏斗 | `stage_durations` | `{S0: 1.2, S1: 4.0, ...}` | 单位秒 |
| 漏斗 | `turns_per_stage` | `{S2: 1, S4: 6, ...}` | 超预算标红 |
| 产物 | `artifacts[]` | `{type, schema_ok, missing_fields[], turn}` | `type ∈ {level_card, graph_focus, progress_delta, followup_form}` |
| 认知负荷 | `paas_series` | `[int]` 1–9，按关卡 | 画折线，看**负荷峰在哪一关** |
| 认知负荷 | `rtlx` | `{mental, temporal, effort, frustration, performance?}` 0–100 | 不加权均值即 RTLX |
| 可用性 | `sus_score` | 0–100 | 与 68 比 |
| 可用性 | `cuq_score` | 0–100（可选） | 对话式补充 |
| 体验 | `ueq_s` | `{pq, hq, overall}` −3..+3（可选） | |
| 行为 | `friction` | `{rage_clicks, dead_clicks, u_turns, input_clears, refresh_loops, hint_requests, form_skips, abandonment_turn}` | 全是计数器 |
| 教学 | `failures` | `{F1..F8: {occurrences, first_turn, evidence[]}}` | 见 C7 表 |
| 教学 | `leak_rate` | 0–1，按施压级别分档 | `{L1, L2, L3}` |
| 教学 | `scoring_consistency` | `{fleiss_kappa, cv, n_replays}` | |
| 教学 | `hallucinations[]` | `{claim, chunk_id_or_null, unit_ok, sympy_ok}` | 无 `chunk_id` 即候选 |
| 教学 | `adaptivity` | `{repeat_teach_probe, term_level_violations, mastered_topic_refocus}` | F7 |
| 语言 | `lang_mix_ratio` | 0–1 | 非术语英文占比 |
| 主观 | `judge_scores` | `{actionability, clarity, tone, scaffolding_fit}` 各 1–5 | 借 BEA 2025 五维裁剪 |
| 主观 | `judge_meta` | `{model, prompt_version, samples, agreement_with_human_kappa}` | **必须留痕** |
| 原文 | `quotes[]` | `{turn, text}` ≤ 5 条 | 每个卡点配一句学生原话，报告才有人味 |
| 结论 | `top_blockers[]` | `{stage, element, description, severity}` ≤ 3 | 按 severity 排序 |
| 结论 | `suggested_fix[]` | `{blocker_ref, hypothesis, effort}` | 只写假设，不写承诺 |

### 5.3 跨会话汇总矩阵（多跑几轮后才有的那张图）

```
             S0  S1  S2  S3  S4  S5  S6  S7  S8  S9
P1 零基础     ✅  ✅  ✅  ⚠️  ❌  ·   ·   ·   ·   ·
P2 研究生     ✅  ✅  ✅  ✅  ✅  ✅  ✅  ✅  ✅  ✅
P3 在职       ✅  ⚠️  ✅  ✅  ✅  ⚠️  ✅  ✅  ✅  ✅
             ✅通过 ⚠️通过但摩擦高 ❌失败并放弃 ·未到达
```

**读法**：竖着看列 = 哪个阶段对所有人都有问题（产品问题）；横着看行 = 哪档 persona 特别吃亏（适配问题）。P1 在 S4 挂掉而 P2 全绿，说明不是系统坏了，是**新手路径缺失**——这才是要写进 ticket 的那句话。

### 5.4 必须写进报告的三条免责声明

1. **证据等级**：模拟用户证据 = 假设生成，不能替代真实学习者测试（NN/g 结论）。
2. **方差警告**：合成用户方差显著小于真人（mode collapse），**不要用它的"一致性好"当作可信度证据**。
3. **校准状态**：judge 未经人工标注校准前，`judge_scores` 只作趋势参考；报告 `agreement_with_human_kappa`，没有就写 `null`。

---

## 六、明确「找不到 / 不确定」的条目

| # | 条目 | 状态 | 说明 |
|---|---|---|---|
| 1 | **LLM 模拟用户评分 vs 真实用户评分的相关系数** | ❌ **未找到** | 检索到的都是间接证据（Lost in Simulation 的成功率偏移 9pp、NN/g 的结论一致但方差坍缩），**没有任何研究报告 r / ICC / Bland-Altman**。这是本领域当前的实证空白，也是本项目不能拿模拟用户当结论的依据 |
| 2 | **SUS 在 AI / 对话式产品上的专门效度验证** | ⚠️ **不确定** | SUS 被大量用于 chatbot 研究，但没找到"针对 AI 产品重新验证"的论文。CUQ 是专用的，但样本量小。建议 SUS + CUQ 子集并用，别单独依赖 SUS |
| 3 | **UMUX-Lite → SUS 的换算系数** | ⚠️ **未复核** | 我知道存在 Lewis et al. (2013) 的线性回归，但**没有抓到原文，不敢写具体系数**。要用请先核对原文 |
| 4 | **CUQ 原始 PDF** | ❌ 404 | `ulster.ac.uk/.../Chatbot-Usability-Questionnaire.pdf` 直连 404，只能引用搜索结果摘要。题目文本需另找来源 |
| 5 | **多篇 ACM DOI 页正文** | ❌ fetch 504/超时 | 10.1145/3828792.3828794、10.1145/3805696.3846495、10.1145/3772318.3791696 均只拿到摘要级信息。方法细节（如施压脚本的具体措辞表）需查原文 |
| 6 | **BEA 2025 五 track 的官方评分脚本** | ⚠️ 未找到 | 只确认了五个维度名称与数据来源，没找到公开的 evaluation script / rubric 细则 |
| 7 | **核电子学领域故意设计的"典型误解"清单** | ⚠️ **本报告自拟** | 第三节 P1/P2/P3 的误解条目是我基于领域常识构造的**设计假设**，没有文献支撑。**上线前必须请 1–2 位核电子学教师复核**，否则 persona 会测出假问题 |
| 8 | **"追问表单"作为 scaffold card 的实证效果** | ⚠️ 未验证 | Scaffolding Cards 论文（DOI 10.1145/3772318.3791696）讲的是对话内卡片，本项目是表单形态，属于形态迁移，效果未知 |
| 9 | **击键微节奏测认知负荷（TypeState）** | ⚠️ 可行但未验证 | Zenodo 19387975 报告了可行性，但需要专门埋点与基线校准；本项目建议先不做 |
| 10 | **检索配额** | ❌ 中途耗尽 | DeepSeek 搜索 API 在写报告前返回 `402 Insufficient Balance`，第七批（UMUX-Lite / think-aloud / WebArena reward 细节）未跑成。若需补充，恢复余额后重跑 `.scratch/lit/batch.py` |

---

## 附：配套脚本

| 文件 | 用途 |
|---|---|
| `.scratch/lit/batch.py` | 批量检索（读 JSON 查询列表，输出 `uxrN.txt`） |
| `.scratch/lit/dig.py` | 把检索结果浓缩为每查询前 N 条 |
| `.scratch/lit/uxr1..6.txt` / `d1..d6.txt` | 原始结果与摘要（6 批，约 120 条） |
| `.scratch/lit/lost.md` `uxagent.md` `siminstruct.md` `mtbench.md` `mtb.md` `bea.md` `biodim.md` `mathdial.md` `nng.md` `nng2.md` `pw-agents.md` | 12 篇抓取的原文 |
