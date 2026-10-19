# 学习者初始水平判定与按水平分化教学流程：实证依据

> 面向产品：核电子学学科学习应用
> 检索截止：2026-10-20。工具：DeepSeek `/v1/tools/search`（`dsweb.py` / `batch_search.py`），原始结果留在 `.scratch/lit/a.txt`–`n.txt`。
> 写作原则：只写查到的数字。查不到的进第五节，不拿相邻领域数字冒充。
> 一句话立场：**ERE 是全文档唯一一个「效应量足够大、方向明确、且在本学科（电路分析）上被单独验证过」的规律**。整个产品的能力分级应当围绕它建，其余结论都是它的边界条件或补丁。

---

## 一、核心结论

1. **专长逆转效应成立，但它是「不对称」的**：给低先备者加脚手架 d = 0.505（95% CI [0.260, 0.750]，k=88，60 项实验，5924 人）；给高先备者撤脚手架带来的损害显著更小。→ 产品上"多给帮助"的风险远低于"少给帮助"，默认值应当偏向高指导。
   Tetzlaff, Simonsmeier, Peters & Brod (2025), *Learning and Instruction* 98: 102142，[10.1016/j.learninstruc.2025.102142](https://doi.org/10.1016/j.learninstruc.2025.102142)

2. **ERE 在电路分析上被直接验证过**，这是本学科最重要的一条：低先备者最受益于「样例→练习」，高先备者最受益于「练习→样例」，同一份材料最优顺序相反。
   Reisslein, Atkinson, Seeling & Reisslein，*Computers & Education*（Electrical circuit analysis），[专家库条目](https://experts.azregents.edu/en/publications/encountering-the-expertise-reversal-effect-with-a-computer-based-/)

3. **「撤脚手架」不该按固定节拍，该按成功与否**：adaptive fading（上一步做对才减少样例步）在 retention 和 transfer 上显著优于 static fading，**且不增加学习时间或材料**。这是产品里最便宜的一个可实现改动。
   Reisslein, Seeling & Reisslein (2006), *J. Engineering Education* 95(3)，[10.1002/j.2168-9830.2006.tb00894.x](https://doi.org/10.1002/j.2168-9830.2006.tb00894.x)

4. **少量题就能定级，而且精度不靠题量靠选题**：schema-based 快速知识测量与传统知识测验 r = .92，用时缩短 4.9× / 2.5×；CAT 仿真中后验方差准则下平均 8.5 题（低能力端）到 17 题收敛。
   Kalyuga & Sweller (2004), *J. Educ. Psychol.* 96(3), 558–568（[ERIC EJ685015](https://eric.ed.gov/?id=EJ685015)）；CAT 收敛数字见 [ERIC ED230615](https://eric.ed.gov/?id=ED230615)

5. **自评完全不能当定级依据**：自评与客观表现的平均相关 M = .29（22 项元分析的元分析），另一项元分析 pooled r = .32 [.29, .35]；最低四分位者平均高估 37.4 个百分位点。
   Zell & Krizan (2014), *Perspectives on Psych Sci* 9(2)，[10.1177/1745691613518075](https://doi.org/10.1177/1745691613518075)

6. **前测的收益是「点对点」的，不是「通用热身」**：prequestion 对**被问到的那部分内容** g = 0.58（k=90），对未被问到的内容 g = 0.04（k=85），几乎为零。
   St. Hilaire 元分析（Iowa State，[OATD 记录](https://www.oatd.org/oatd/search?q=subject%3A%28Prequestion%20Effect%29)）；综述见 Pan & Carpenter (2023), *Educ Psychol Rev* 35:97，[10.1007/s10648-023-09814-5](https://doi.org/10.1007/s10648-023-09814-5)
   → **产品含义：定级题必须从「即将要学的那批知识点」里抽，才能一举两得；抽自无关章节等于白烧题量。**

7. **分化要在班内/人内做，不要把人分成固定层级**：班内分组 g = 0.19–0.30，班间分组 g = 0.04–0.06（基本无效）；同质能力分组本身无显著正效应，对弱生甚至有小的负效应。
   Steenbergen-Hu, Makel & Olszewski-Kubilius (2016), *RER* 86(4)，[10.3102/0034654316675417](https://doi.org/10.3102/0034654316675417)；Deunk et al. (2018), *Educ Res Rev* 24, 31–54，[10.1016/j.edurev.2018.02.002](https://doi.org/10.1016/j.edurev.2018.02.002)

8. **「先问题后讲解」对成人有效，但对低先备者可能失效**：PS-I 总体 +0.36，但显著调节变量是「指导是否建基于学生自己提出的解法」（+0.56 vs +0.20）与年级（年龄越大越受益，2–5 年级反而 I-PS 更好）。
   Sinha & Kapur (2021), *RER*，[10.3102/00346543211019105](https://doi.org/10.3102/00346543211019105)
   → 低先备者用 PS-I 时，若不接住他的错误解法，收益塌回 +0.20；**核电子学零基础用户不该直接进 PS-I**。

9. **反馈时机其实不重要，反馈内容才重要**：51 项研究 160 个效应量的最新元分析，即时 vs 延迟 g = 0.03 [−0.08, 0.13]，p = .61，无显著差异；但「只告知对错」ES = 0.05（ns），「详细解释」ES = 0.49。
   Educational Psychology Review 38(1):13 (2026)，[ERIC EJ1504374](https://eric.ed.gov/?id=EJ1504374)；van der Kleij et al. (2015), *RER* 85(4)
   → **产品别再纠结即时/延迟；把预算全押在「解析的信息量」上。**

10. **掌握阈值可以被大幅放松**：连续答对 2 / 3 / 4 / 5 次，学习效果无显著差异，但题量显著增加。作者建议用 2 或 3。
    Kelly & Heffernan (2016), *Learning@Scale*，[10.1145/2876034.2893393](https://doi.org/10.1145/2876034.2893393)
    → 「连对 5 题」是行业惯性（Khan Academy 旧规则），不是证据。

---

## 二、逐题答案

### A. 专长逆转效应

#### A1. Kalyuga 团队的关键论文与效应量；新手/熟手边界在哪

**结论**：ERE 是稳健现象，但效应量高度依赖调节变量；它是**序数交互**（ordinal interaction），不是对称的"你多我就少"。

**数字**：
- 最新元分析：Tetzlaff, Simonsmeier, Peters & Brod (2025), *Learning and Instruction* 98: 102142。60 项实验、176 个效应量（每水平 88 个）、5924 名被试、样本量 17–357（中位 73）。
  - 低先备知识者：高支持 > 低支持 **d = 0.505，95% CI [0.260, 0.750]，k=88, j=60**；异质性极强 Q(df=87)=475.233, p<.001。
  - 高先备知识者：Q(df=88)=284.457, p<.001，效应量显著更小。
  - 原文明确："should not be conceptualized as a symmetrical effect"。
  - DOI [10.1016/j.learninstruc.2025.102142](https://doi.org/10.1016/j.learninstruc.2025.102142)
- 奠基与综述：Kalyuga, Ayres, Chandler & Sweller (2003)；Kalyuga (2007), *Educ Psychol Rev* 19, 509–539（[ERIC EJ785056](https://eric.ed.gov/?id=EJ785056)）；Kalyuga & Renkl (2010)。
- 纵向演示（"边界"最直观的证据）：Kalyuga, Chandler & Sweller (2000), *J Educ Psychol* 92(1), 126–136。新手时「图 + 听觉文本」最优；**经过两次专门训练后该优势消失**。

**边界在哪**：不是"新手/熟手"的二分点，而是**「该学习者对这个具体任务图式的自动化程度」**。Kalyuga 系列反复显示：同一个人，在领域 A 是专家、领域 B 是新手；在任务 T1 上训练两次后就跨过了临界点。所以边界必须**按知识点（knowledge component）粒度判定**，不能按人判定。

**对产品的含义**：
- 用户画像不能只存一个 `level ∈ {1,2,3}`。必须存 `per-KC mastery`，且 ERE 判定读的是**当前 KC 的掌握度**，不是用户整体等级。
- 因为不对称，默认策略应为：**不确定时给高指导**。误判成"高先备"（给了低指导）的代价，大于误判成"低先备"（给了高指导）的代价。

#### A2. 技术性学科（电路/电子学/物理）上效应量是否更大

**结论**：方向一致，且**有本领域的独立验证**，但"效应量更大"这一条**没有直接数字支持**——元分析只报告了 content domain 是显著调节变量，没有给出电子学单独的分组效应量。

**证据**：
- Tetzlaff et al. (2025) 明确把 **content domain** 列为显著调节变量，但公开摘要层面未披露各领域的分组 d。
- 领域内直接验证：Reisslein, Atkinson, Seeling & Reisslein，用三种基于样例的程序（example-problem、problem-example、fading）教**串并联电路分析**，按先备知识分高低两组。**总体上三种程序无差异，但低先备者最受益于传统 example-problem pairs，高先备者最受益于 problem-example pairs**。这一条比任何元分析分组都更有说服力，因为它是同一份材料、同一批任务、只翻转顺序。
- 电气工程材料的其他 CLT 效应量：Pollack, Chandler & Sweller (2002) 报告 **ES = 1.21 和 1.15**（在电气工程学习材料上）。
- 相关：van Gog, Kester & Paas (2011), *Contemp Educ Psychol* 36(3), 212–218，用**电路故障排查**任务、中学生新手，比较 WE / WE-PS / PS-WE / PS 四条件，[10.1016/j.cedpsych.2010.10.004](https://doi.org/10.1016/j.cedpsych.2010.10.004)。

**对产品的含义**：在核电子学里，**"样例在前还是练习在前"这个开关的产品价值 > 任何视觉/交互层面的优化**。它值得做成显式的、可 A/B 的实验变量。

#### A3. 「指导量随专长增长而撤减」的实证依据

**结论**：有，而且是**整条 fading 文献线**，不是单点。但 fading 单独用只对 near transfer 可靠。

**数字与设计**：
- Renkl, Atkinson, Maier & Staley (2002), *J Exp Educ* 70(4), 293–315：完整样例 → 逐步不完整样例 → 独立解题的**连续过渡**优于传统 example-problem pairs。
- Renkl, Atkinson & Große (2004), *Instructional Science* 32, 59–82：两个实验。**淡出步骤的位置（前淡出/后淡出）不影响结果**；**学习者对自己动手解出的那些步骤学得最多**。→ 关键不是"淡出哪一步"，而是"让学习者亲手做哪一步"。
- Atkinson, Renkl & Merrill (2003), *J Educ Psychol* 95(4), 774–783：**fading 单独对 near transfer 可靠有效，对 far transfer 不可靠**；**fading + self-explanation prompts 组合在 near 和 far transfer 上都产生 medium-to-large 效应，且不增加学习时间**。
- Renkl & Atkinson (2003)：内在认知负荷随技能习得逐渐降低，因此可以逐步增加解题要求。
- 工程域的直接验证：Reisslein, Seeling & Reisslein (2006), *JEE* 95(3)，[10.1002/j.2168-9830.2006.tb00894.x](https://doi.org/10.1002/j.2168-9830.2006.tb00894.x)。2（static/adaptive fading）× 2（低/高学业能力）ANOVA，**adaptive fading 在 retention 和 transfer 上显著优于 static fading，且不增加学习时间或材料**。
- Moreno, Reisslein & Delgoda (2006), FIE：**forward fading 与 adaptive feedback practice 比 backward fading 更能促进 near transfer**（大学工程新生，电路问题）。

**对产品的含义（可直接实现）**：
1. 淡出必须**绑定上一步的正确性**（adaptive），不能按题目序号固定节拍（static）。
2. 淡出方向优先 **forward**（从第一步开始逐步让学习者接手），而不是 backward。
3. 只做 fading 不做 self-explanation，等于放弃了 far transfer。**"为什么这一步可以这样近似"的追问不是锦上添花，是 fading 生效的必要组件。**

#### A4. 样例学习 → 补全步骤 → 独立解题的转换判据

**结论**：文献给的是**机制判据**（"上一步成功才前进"），**不是数值阈值**。所有"正确率 ≥ X% 就升级"的数字都是产品侧的经验值，不是实证结论——这一点必须诚实。

**能拿到的硬依据**：
- **机制判据（强）**：adaptive fading 的规则是 "learner assumes more problem solving responsibility **only if her or his previous solution attempt is successful**"。这就是可执行判据：**单步成功 → 下一步撤一格；单步失败 → 不退格，保持在当前格并给完整示范**。
- **掌握阈值（中，且是反直觉的）**：Kelly & Heffernan (2016) 的 RCT 表明连续答对 2/3/4/5 次学习效果无显著差异，只是耗时不同；作者建议 **2 或 3**。
- **BKT 侧的标准做法**：mastery threshold 通常取 **P(mastered) > 0.95**（"Mastery Learning Heuristics and Their Hidden Models", [Springer](https://rd.springer.com/chapter/10.1007/978-3-030-52240-7_16)）。
- **窗口限制（重要，容易被忽略）**：ASSISTments 数据上，**第 3 次遇到某技能时平均流失 20%，第 8 次时 45%**（EDM21 paper 126）。→ 单个知识点的练习机会窗口只有 3–5 次左右，超过这个长度，用户不是"学不会"而是"走了"。

**对产品的含义**：三级状态机 + 单步驱动，不要全局正确率阈值：
```
state ∈ {FULL_EXAMPLE, PARTIAL, INDEPENDENT}
FULL_EXAMPLE → PARTIAL : 连续 2 道完整样例的自解释追问正确
PARTIAL     → INDEPENDENT : PARTIAL 内连续 3 步「未给提示即正确」
任意 → 回退一格 : 同一 KC 连续 2 步失败
```
"连续 2 / 连续 3" 取的是 Kelly & Heffernan 的下界，理由是**练习窗口只有 3–5 次**，阈值设高了根本走不完一个循环。

---

### B. 初始水平判定

#### B5. 前测效应：全错也有用？效应量多大？前提是什么？

**结论**：有用，但**收益高度局部化**，且**前提是随后必须给出正确答案**。

**数字**：
- **prequestion（前问）**：St. Hilaire (2022) 预注册元分析 —— **specific effect g = 0.58 (k=90)**，**general effect g = 0.04 (k=85)**。这是目前最干净的分解：收益只落在被问到的材料上。
- **pretesting（前测）**：Richland, Kornell & Kao (2009), *JEP:Applied* 15(3), 243–257，**DOI [10.1037/a0016496](https://doi.org/10.1037/a0016496)**。5 个实验，读一篇 vision 文章；前测组（大量答错）优于"延长学习时间"对照组；实验 5 只呈现问题不要求作答，仍然有效 → 说明起作用的不只是"检索努力"。
- **答错也有用**：Kornell, Hays & Bjork (2009), *JEP:LMC* 35(4), 989–998，**DOI [10.1037/a0015729](https://doi.org/10.1037/a0015729)**。**答错的试次被排除分析后仍有收益**；反馈延迟约 6 分钟与即时反馈效果相当，均优于纯学习对照组。
- **答对率参考**：Pan & Carpenter (2023) 综述，prequestion 表现 **M = 0.35（SD = 0.12）** —— 即"多数答错"是正常状态，不是异常。
- **前提条件**：Pan & Carpenter (2023) 明确 —— **必须有随后学习正确答案的机会**。Kornell 的实验里，反馈是必要条件之一。

**对产品的含义（这条很值钱）**：
- 定级题**必须从「该用户接下来要学的那批 KC」里抽**。抽自学过的旧章节 → general effect g=0.04，纯消耗。
- 定级题结束后**必须展示正确答案**（哪怕只是一句话）。否则前测收益归零，只剩"被考了一次"的负面体验。
- 前测做错**不要给挫败性反馈**（"你基础很差"），因为答错本身就是有效学习事件。

#### B6. 自适应定级测验的信度效度；ALEKS 的公开数据

**结论**：自适应定级在测量学上是成熟的，但**ALEKS 的"效果数据"是相关性证据，不是因果证据**，官方没有公开 RCT。

**数字**：
- **ALEKS PPL 规格**：基于 Knowledge Space Theory，**314 个 item（problem types）**；每次评估 **29 题** 后给出 course placement recommendation（EDM 论文原文 "after question 29"）。
- **信度**："A Data-Based Simulation Study of Reliability for an Adaptive Assessment Based on Knowledge Space Theory", *IJAIED* (2019)，**DOI [10.1007/s40593-019-00176-0](https://doi.org/10.1007/s40593-019-00176-0)**。**CSEM（条件测量标准误）在 40%–80% 分数区间最大** —— 也就是**最需要区分的那一段，测量精度最差**。作者同时指出 AIED/ITS 文献里此前没有自适应测评的信度研究。
- **效度（弱）**："An Evaluation of a Placement Assessment for an Adaptive Learning System", EDM 2024 industry track（[链接](https://educationaldatamining.org/edm2024/proceedings/2024.EDM-industry.61)）。placement score 与 initial score、final score 正相关；"Stay"（按建议选课）学生表现随 placement recommendation 单调上升。**但作者明确这是非受控比较，存在选择偏差。**
- **ALEKS 官方 initial knowledge check 的效果数据**：**未找到**。见第五节。

**对产品的含义**：
- 不要在"中间段"（40%–80%）指望高精度。**中段用户应当更快进入学习、用行为数据继续修正**，而不是在定级环节硬抠。
- 定级结果必须**可撤销**：给 `provisional` 标记，学 5 题后允许重判。

#### B7. 冷启动：BKT prior 怎么初始化；少题收敛的方法；多少题

**结论**：有成熟的工程解，而且**最有效的那个几乎不需要建模**。

**方法**：
- **Prior Per Student Model（Pardos & Heffernan）**：把 BKT 的 L0 拆成 per-student 节点，冷启动启发式直接取 **"was a success"**（首次作答视为正确先验）。结果：**在 30/42 个 problem set 上优于标准 KT**，只需 **3 个自由参数**（标准 BKT 4 个），且**只需要该 problem set 内部的作答**，不依赖任何外部信息（人口学、先修课成绩）。
- PC-BKT（[IEEE 7100688](https://ieeexplore.ieee.org/document/7100688)）：对学生与技能双向聚类来学 prior，缓解新学生/新技能冷启动。
- **警告**："Evolutionary Features for Mitigating Cold Starts in Logistic Knowledge Tracing"（[Zenodo 15870270](https://zenodo.org/records/15870270), 2025）区分 global cold start（模型参数）与 per-student 冷启动，并指出**用人口学变量做冷启动会放大系统性偏差**。—— 这直接否掉了"让用户填专业/年级然后查表定先验"的常见做法。
- **CAT 选题**：最大 Fisher 信息 / 最小后验熵。后验熵准则：`H_t(Item(i)) = Σ_u H_t(u, Item(i)) · p_t(u | Item(i))`，选 `arg min`。
- **收敛题数**：
  - ERIC ED230615（Owen Bayesian adaptive testing 仿真）：后验方差终止准则 0.10 下，θ 低端平均 **8.5 题**，θ=+3 需 **17.0 题**；固定 30 题池"generally not sufficient"。
  - [core.ac.uk 343435287](https://core.ac.uk/works/343435287)：**15–20 题**（题库 50–100 题）能力估计精度合理；超过约 15 题收益甚微，**尤其在能力分布两端**。
  - [iacat.org ru02-01](https://iacat.org/sites/default/files/basic-page/uploads/ru02-01.pdf)：分类准确率在 **10–15 题**后基本稳定。

**对产品的含义**：
- 冷启动先验用 **"was a success" + per-student 参数**，不要用人口学查表。
- 定级题数目标 **12–18**，不是 29（ALEKS 的 29 是"给出精确百分位分数"的需求，我们只需要"分到 3 个层级之一"，分类任务比估计任务需要的信息少）。

#### B8. 自陈 vs 客观测验的相关性

**结论**：相关性中低，且**偏差方向可预测（低能力者高估）**，因此**不能作为定级依据，只能作为先验或 tie-breaker**。

**数字**：
- Zell & Krizan (2014), *Perspectives on Psychological Science* 9(2)，**DOI [10.1177/1745691613518075](https://doi.org/10.1177/1745691613518075)**。22 项元分析的元综合：单项元分析效应 **.09–.63**，跨元分析平均 **M = .29, SD = .11**。→ 自评解释约 **8–9%** 的客观表现方差。
- 另一项元分析（*JEMS*）：**pooled r = .32, 95% CI [.29, .35]**；**最低四分位者高估 37.44 个百分位点（g = 2.17, CI [1.74, 2.60]）**，最高四分位者低估 **−19.96 个百分位点（g = −1.22, CI [−1.43, −1.01]）**。
- **重要限定**：Dunning-Kruger 的"组间差异"部分来自 regression to the mean / better-than-average 效应（Krueger & Mueller 2002）；近年用 Glejser 异方差检验 + 非线性二次回归的复现研究**未能稳定支持** DK 效应（*Intelligence* 96 (2023) 101717）。→ **不要在产品文案里引用"达克效应"这个说法**，它是被质疑的。但"低分者系统性高估"这个**测量事实**（r=.29–.32，最低四分位高估 37 个百分点）是稳的。

**对产品的含义**：
- 自评可以作为**贝叶斯先验**（`prior_shift = 0.5 × z(self_report)`，因为 r≈.3，只能解释很小一部分），绝不能作为主判据。
- 自评只在**同一层级的两个候选之间**做 tie-break（例如都落在 L2 区间，自评"做过课程设计"→ 取 L2 上沿）。
- 不要问"你是什么水平"这种全局问题（r 最低的那类）。要问**可验证的行为**："你独立焊过并调试过哪怕一个含运放的电路吗"——行为频率题的自评效度高于能力自评（Zell & Krizan 的调节变量：自评与表现的相关在**具体、可观察**的能力上更高）。

---

### C. 按水平分化的教学流程

#### C9. 分层教学的元分析效应量；同质分组 vs 组内分化

**结论**：**组内分化有效，分班/同质分组基本无效**。这是本领域方向最明确的一条之一。

**数字**：
- Deunk, Smale-Jacobse, de Boer, Doolaard & Bosker (2018), *Educational Research Review* 24, 31–54，**DOI [10.1016/j.edurev.2018.02.002](https://doi.org/10.1016/j.edurev.2018.02.002)**。21 项研究、78 个效应量。**用计算机系统做分化工具、或把分化作为更广项目/改革的一部分 → 小到中等正效应；班间或班内同质能力分组（homogeneous ability grouping）本身无显著正效应。** 荷兰硕士论文转述：同质分组对较弱学生有小的**负**显著效应。
  - **年份更正**：用户提到的 "Deunk 2014" 实际对应 **Deunk et al. 2018**（2015 年的是 GION 报告，非同行评议）。
- Steenbergen-Hu, Makel & Olszewski-Kubilius (2016), *Review of Educational Research* 86(4), 849–899，**DOI [10.3102/0034654316675417](https://doi.org/10.3102/0034654316675417)**。13 项元分析的二阶元分析：
  - **班内分组 g = 0.19–0.30**
  - 跨年级按科目分组 g = 0.26
  - 天才特殊分组 g = 0.37
  - **班间分组 g = 0.04–0.06（无效）**
  - 效应不随高/中/低能力学生而变化。
- Tomlinson 的相关工作：**未找到可引用的实证效应量**（其贡献主要是框架与质性研究）。见第五节。

**对产品的含义**：
- **绝对不要做"分班"**：不要有"基础班/进阶班"两条独立课程线，不要让用户一开始就选轨道。这正是 g=0.04 的那一类。
- **要做"组内分化"**：同一条知识图谱、同一个关卡序列，**只改每关的首轮指导形态与追问深度**。用户的层级是"每关的渲染参数"，不是"一条不同的路径"。

#### C10. 先备知识对 PS-I 的调节；低先备者会不会反转

**结论**：**没有找到按先备知识分亚组的公开数字**。能找到的调节变量是「指导是否建基于学生自己的解法」和「年级」。这两条合起来**间接支持**低先备者不适用裸 PS-I。

**数字**：
- Sinha & Kapur (2021), *RER*，**DOI [10.3102/00346543211019105](https://doi.org/10.3102/00346543211019105)**。53 项研究。
  - **PS-I > I-PS，总体 ES = +0.36。**
  - **建基于学生自己提出的解法的指导：+0.56 vs +0.20**（这是最大的调节变量）。
  - **小组协作：+0.49 vs +0.19。**
  - **年级调节：年龄越大越受益于 PS-I；2–5 年级反而 I-PS 更好。**
- 对"低先备者是否反转"的直接回答：**没有**。见第五节。

**对产品的含义**：
- 若给高先备者用 PS-I，**必须实现"接住他的解法"**：用户提交的错误解法要能被系统引用（"你刚才写的这个方法在 X 条件下会失效，因为…"）。做不到这一点，PS-I 的收益从 +0.56 掉到 +0.20，得不偿失。
- 低先备者（零基础本科生）**不进 PS-I**，走 example-problem。这不是保守，是 Reisslein 的电路实验直接支持的。

#### C11. 元素交互性极高时，样例效应本身会不会失效

**结论**：**不会失效，反而更适用**——而且反过来，**测试效应会在高元素交互性下减弱甚至消失**。这两条方向相反，必须分开记。

**结论先说清楚一个容易搞反的地方**：高元素交互性**不会**让样例效应失效，它让**测试效应（检索练习）失效**。两者方向相反，这是本项目最关键的一条边界。

**机制**：
- **van Gog & Sweller (2015)** 的实际标题是 *"Not New, but Nearly Forgotten: the Testing Effect Decreases or even Disappears as the Complexity of Learning Materials Increases"*，**DOI [10.1007/s10648-015-9310-x](https://doi.org/10.1007/s10648-015-9310-x)**。它讲的是：材料元素交互性越高，**测试效应越小甚至消失**，此时**样例学习优于做题**。→ 对高元素交互性材料（电路图 + 公式 + 单位），"多做几道题"是低效的，"看透一道样例"是高效的。
- worked example effect 本身也只在高元素交互性材料上出现；材料元素交互性低时该效应消失或反转（Sweller 系）。
- **ERE 的适用条件明确要求教学内容的内在认知负荷具有高元素交互性**（Sweller et al., 2011）。反过来说，**电路图 + 公式 + 单位正是典型的高元素交互性材料，因此是范例效应最该生效的地方，不是最不该生效的地方**。
- 电气工程材料的实证效应量：Pollack, Chandler & Sweller (2002) **ES = 1.21 和 1.15**。

**真正的风险不是"样例失效"，而是"外在负荷被当成内在负荷"**：如果电路图、公式、单位三者是**分散呈现**的（图在一屏、公式在另一屏、单位靠记），那增加的是 split-attention 外在负荷，此时加样例当然没用——**因为用户连读题都在耗资源**。这不是元素交互性边界，是设计缺陷。

**对产品的含义**：
- 电路题必须**图、式、单位同屏**，单位就地标注在数值旁而不是集中列表。
- 高元素交互性正是"为什么需要完整样例"的理由。**不要因为"题目看起来很复杂"就退回分步小问**——那会把内在负荷拆散，反而让用户学不到"整体图式"。
- **同一条原理也规定了"什么时候不该刷题"**：当一个 KC 的元素交互性还很高（用户尚未建立该图式）时，堆题量的收益是负的；此时应回到样例。只有当该 KC 的图式已建立（mastery ≥ 0.7）、材料对该用户而言元素交互性已降低，刷题才开始产生测试效应。**这就是状态机里 FULL_EXAMPLE → INDEPENDENT 的理论依据，而不只是经验规则。**

#### C12. 有无人机对照的 ITS 亚组分析（按先备知识）

**结论**：**有，但都是单项研究，不是元分析亚组**。方向与 ERE 完全一致：同一 ITS，低先备与高先备的最优形态相反。

**证据**：
- **最直接的同类系统**：**ElectronixTutor**（Nye, Hu, VanLehn, Heffernan, Koedinger, Graesser 等；ONR STEM Challenge 四团队系统集成，主题就是**电子电路**）。实证："The Effect of ElectronixTutor on Undergraduate Students' Acquisition of Conceptual Learning, Problem Solving, and Model Building of Electronic Circuits"，[IEEE 9637314](https://ieeexplore.ieee.org/abstract/document/9637314)。
- **按先备知识分亚组的 ITS 研究**："Exploring the Design and Impact of Interactive Worked Examples for Learners with Varying Prior Knowledge"（[ACM 10.1145/3772318.3791631](https://dl.acm.org/doi/full/10.1145/3772318.3791631)）。在 propositional logic tutor 中加入 Buggy examples 与 Guided examples：
  - **Buggy examples 对高先备知识者更有效；Guided examples 对低先备知识者更有效。**
  - 高先备知识者在 Guided 条件下错误恢复率 54.9%。
  - 作者结论原文："suggests the need for adaptive problem selection based on learner expertise"。
- **ITS 总体效应量**（作为基线，不是亚组）：
  - VanLehn (2011), *Educational Psychologist* 46(4), 197–221：**step-based ITS vs no tutoring d = 0.76 (n=28)**；human tutoring d = 0.79 (n=10)。"interaction granularity hypothesis"：粒度越细越好，但 **step-based 与 substep-based 等效** → 步骤级是最优粒度，不必再细。
  - Ma, Adesope, Nesbit & Liu (2014), *J Educ Psychol* 106(4), 901–918，[10.1037/a0037123](https://doi.org/10.1037/a0037123)。107 个效应量、14321 人。vs 教师大班 g=0.42；vs 非智能 CBI g=0.57；vs 教材/练习册 g=0.35；**vs 人类一对一辅导 g=−0.11（ns）**；vs 小班 g=0.05（ns）。
  - Kulik & Fletcher (2016), *RER* 86(1), 42–78，[10.3102/0034654315581420](https://doi.org/10.3102/0034654315581420)。50 项对照评估，**中位效应 0.66 SD**；但效应量极大取决于用自编测验还是标准化测验。
  - Steenbergen-Hu & Cooper (2013), *J Educ Psychol* 105(4), 970–987，[10.1037/a0032447](https://doi.org/10.1037/a0032447)。K-12 数学：**"overall, ITS had no negative and perhaps a small positive effect"** —— 注意这和上面几个大效应的反差，说明**效应量对学科、对照条件、测验对齐极度敏感**。

**对产品的含义**：
- 别指望"ITS"这个标签本身带来 g=0.66。Kulik & Fletcher 的关键调节是**测验与教学目标的对齐**——如果用自编题测自己的教学，效应会虚高。**内部评估必须用外部/标准化题或迁移题**。
- 步骤级反馈粒度就是最优粒度（VanLehn 的 granularity hypothesis），**不要做子步骤级**——成本高、收益为零。

---

### D. 「不做死板流程」的产品侧证据

#### D13. 固定流程 vs 动态调整；adaptivity 本身的效应量

**结论**：**没有元分析把 "adaptivity" 作为独立调节变量算出干净效应量**。能说的是：ITS 的效应主要来自**交互粒度**（VanLehn）和**指导内容**（Kulik & Fletcher 的对齐度），而不是笼统的"自适应"。

**证据**：
- VanLehn (2011)：step-based d=0.76 vs answer-based 更小；**granularity hypothesis 是当前最有解释力的机制**。→ "自适应"若只做到"答对就下一题、答错就重来"（answer-based），效应接近 0。
- Ma et al. (2014)：**vs 非智能 CBI g=0.57** —— 这个对比最能说明"智能"部分的价值，但它混合了选题、提示、步骤分解等多种成分。
- Kulik & Fletcher (2016)：**中位 0.66 SD，但极大依赖测验对齐**。
- **Assistance dilemma**：Koedinger & Aleven (2007), *Educ Psychol Rev* 19(3), 239–264，[10.1007/s10648-007-9049-0](https://doi.org/10.1007/s10648-007-9049-0)。核心问题就是「何时该告诉（tell）、何时该引出（elicit）」。这是把"动态调整"形式化为**每步一个二元决策**的最实用框架，且已被写进 ITS 的 pedagogical policy（每步可选 elicit 或 tell，hint 按 increasingly specific 顺序排列）。

**对产品的含义**：
- 不要做"自适应"这个大词。做**每步的二选一**：这一步是 `tell`（直接展示）还是 `elicit`（追问）？决策依据 = 该 KC 的当前掌握度 + 上一步的对错 + 该步的元素交互性。
- 这比"动态调整整条学习路径"便宜得多，且证据链完整得多。

#### D14. 过度个性化/过度自适应的反面证据

**结论**：**有三条独立的负面证据线，但没有一条是"高自适应 vs 低自适应"的直接 RCT**。这一点必须诚实。

**三条负面证据**：
1. **学习者控制（learner control）平均为负**：*IJETI* (1996) 的元分析，24 项研究，**平均效应量小且为负** —— "the average student would be slightly better off without it"；且**在年轻/低能力学生身上更差**。→ 把选择权交给用户（"你想看例题还是直接做题？"）在统计上是亏的。
2. **Desirable difficulties**：Bjork 的五条 desirable difficulties 中，**reduced feedback 是被遗忘的第五条**。逐题即时对错会制造"流畅但短命"的学习错觉 —— 表现提升，长期保持下降（Soderstrom & Bjork 2015 的 performance vs learning 区分）。
3. **Assistance dilemma 的另一面**：提示给得太快太具体，学生会学会"点提示"而不是"想问题"。Roll, Baker, Aleven & Koedinger 的 help-seeking 研究（38 名高中生，Geometry Cognitive Tutor，两个月）显示 help-seeking 模式与后续同技能步骤成功率关联 —— 即 **hint 的使用方式本身是可训练的行为，系统设计会塑造它**。

**明确的缺口**：**没有找到**"高自适应导致学习下降"的直接实验。见第五节。

**对产品的含义**：
- 不做"用户选难度"。难度由系统定，用户只能选"我现在想休息"。
- 追问阶梯要**有上限**。无限深追 = 无限提示 = 学会点提示。
- 即时对错反馈只用于**步骤级**（VanLehn 的粒度），关末/章节末用**延迟的总结性反馈**，制造一点"必要难度"。

---

### E. 落到本项目的具体建议

#### E15. 三级学习者画像的差异化参数

完整参数表见 **第三节（3.1 表 + 3.2 状态机 + 3.3 追问层级 + 3.4 升降级）**。这里给出一句话版的定位理由：

- **P1 零基础本科生** → 起点 **L1 电路基本定律**，首轮 **完整样例**，追问 **L1 起 / 最多 3 层**，单次 **2 个**新知识点，**步骤级即时反馈**，**2 次**尝试。
  依据：Reisslein 电路实验低先备者最受益 example-problem；ERE d=0.505；高元素交互性材料需要完整样例（van Gog & Sweller 2015）。
- **P2 有电子学基础的研一** → 起点 **L3 器件与基本电路**，首轮 **补全步骤（forward fading）**，追问 **L2 起 / 最多 4 层**，单次 **3 个**，步骤级即时 + **关末延迟总结**，**2 次**尝试。
  依据：adaptive fading 优于 static（Reisslein 2006）；Atkinson 2003 的 fading + self-explanation 组合。
- **P3 有工程经验的在职** → 起点 **L4 核电子学专门**，首轮 **直接出题**，追问 **L3 起 / 最多 5 层**，单次 **4 个**，**整题提交后延迟反馈**，**1 次**尝试。
  依据：高先备者最受益 problem-example（Reisslein）；reduced feedback 作为 desirable difficulty；ERE 高先备端。

**三个画像共用同一张知识图谱、同一个关卡序列，只改渲染参数** —— 这是 C9 的直接推论（班内分化 g=0.19–0.30 vs 班间 g=0.04–0.06）。

#### E16. 初始水平判定：多少题、什么难度分布、如何终止

完整伪代码见 **第四节（4.2）**，关键约束见 **4.3 表**。核心参数：

| 参数 | 值 | 依据 |
|---|---|---|
| **题量** | 下限 **8**，上限 **18**，目标 **12–15** | CAT 仿真 8.5–17 题达后验 SD 0.10；分类准确率 10–15 题后稳定；ALEKS 用 29 题是为了精确分数，3 分类不需要 |
| **难度分布** | 先 **4 题粗筛**（L1/L2/L3/L4 各 1 题中位难度）；再 **自适应**，只在 `abs(difficulty − θ) ≤ 1.0` 内选题 | 最大 Fisher 信息在 p≈0.5 附近；两端题信息量低（题库小时 >15 题收益甚微，尤其在两端） |
| **选题准则** | **最大 Fisher 信息**（二分题即最小后验熵）：`H_t(i) = Σ_u H_t(u,i)·p_t(u|i)`，取 `arg min` | 标准 CAT 选题 |
| **目标成功率带** | **40%–70%** | 信息量最大区间，同时避免挫败 |
| **终止（任一满足，但先满 8 题）** | ① 后验 SD ≤ **0.35**；② 连续 **3** 题落在 40–70% 带内；③ 后验熵 3 题内变化 < **0.01** | 三重冗余；SD 0.35 ≈ 3 层分类所需精度 |
| **来源约束** | 定级题**必须从即将要学的 KC 池抽** | prequestion specific g=0.58 vs general g=0.04 |
| **结束后动作** | **必须展示正确答案**（一句话即可） | 前测生效前提（Pan & Carpenter 2023） |
| **置信度低时** | 落到相邻两层下沿 + `provisional` 标记，学 **5 题**后允许重判 | CSEM 在 40%–80% 区间最大（IJAIED 2019） |

---

## 三、三级学习者差异化参数表

> 使用说明：这张表是**每关的渲染参数**，不是三条不同的课程路径（C9：班间分组 g=0.04，班内分化 g=0.19–0.30）。所有用户走同一张知识图谱、同一个关卡序列，只有下面这几个旋钮不同。

### 3.1 三个画像的默认参数

| 维度 | P1 零基础本科生 | P2 有电子学基础的研一 | P3 有工程经验的在职 |
|---|---|---|---|
| **典型特征** | 学过大学物理电磁学，没独立搭过电路；分不清 KCL/KVL 的适用条件 | 学过模电/数电，做过实验课；对噪声、带宽有概念但不成体系 | 做过实际读出电子学/探测器信号链；知道"为什么这里要 50Ω" |
| **起始知识点在图谱的层** | **L1 电路基本定律**（欧姆定律、串并联、KCL/KVL、戴维南）—— 不从半导体物理起步 | **L3 器件与基本电路**（PN 结、BJT/MOS 工作点、运放理想模型） | **L4 核电子学专门**（探测器信号形成、电荷灵敏前放、成形放大、噪声与信噪比） |
| **每关首轮形态** | **完整样例（FULL_EXAMPLE）** | **补全步骤（PARTIAL，forward fading，首步留空）** | **直接出题（INDEPENDENT）** |
| **依据** | Reisslein 电路实验：低先备者最受益 example-problem；ERE d=0.505 | adaptive fading 优于 static；高先备者最受益 problem-example | 同上；且 P3 的元素交互性已内化，样例会成为冗余（ERE 高先备端） |
| **追问阶梯起始层级** | **L1（概念辨认 / 量纲与单位）** | **L2（公式选择与适用条件）** | **L3（近似与误差的合理性）** |
| **追问阶梯最大层数** | **3 层** | **4 层** | **5 层** |
| **依据** | 有限工作记忆；D14 的"无限深追 = 学会点提示" | 中等 | 高先备者可承受更深追问；但仍设上限 |
| **单次会话新知识点上限** | **2 个** | **3 个** | **4 个** |
| **依据** | 高元素交互性材料的 intrinsic load 高；且练习窗口仅 3–5 次（第 3 次遇某技能流失 20%） | 中等 | 已内化的图式可承载更多新元素 |
| **反馈延迟策略** | **步骤级即时**（对/错 + 一句为什么）+ 关末不额外总结 | **步骤级即时** + **关末延迟总结**（本关 3 个共性错误） | **整题提交后延迟反馈**（不逐步骤打断）+ 关末延迟总结 |
| **依据** | 反馈时机 g=0.03 无差异，**内容才是关键**；但 P1 需要即时纠错防止错误图式固化 | 同上 | reduced feedback 作为 desirable difficulty；P3 能自行检出错误 |
| **每题允许尝试次数** | **2 次**（第 2 次失败即展示完整解并记为"未掌握"） | **2 次** | **1 次**（错了直接进解析，不重试） |
| **依据** | 避免挫败；前测/错误本身是有效学习事件 | 中等 | 工程场景不允许"再试一次"；且重试会污染掌握度估计 |
| **掌握判定** | 连对 **2** 次 + 一次迁移题 | 连对 **2** 次 + 一次迁移题 | 连对 **1** 次 + 一次迁移题 |
| **依据** | Kelly & Heffernan 2016：2/3/4/5 无差异，2 或 3 即可 | 同上 | 高先备者 guess 概率低，单次正确信息量更大 |

### 3.2 每关内的状态机（三个画像共用，参数不同）

```
进入关卡 KC
  ├─ mastery(KC) < 0.3  → FULL_EXAMPLE  （完整样例 + 自解释追问）
  ├─ 0.3 ≤ mastery < 0.7 → PARTIAL       （forward fading，首步留空）
  └─ mastery ≥ 0.7       → INDEPENDENT   （直接出题）

PARTIAL 的淡出规则（adaptive，非 static）：
  上一步「未看提示且正确」 → 下一步多留一格空白
  上一步「错误或看了提示」 → 保持当前格数，给出该步完整示范
  连续 2 步失败 → 回退到 FULL_EXAMPLE
```

**关键**：`mastery(KC)` 的初值来自定级测验（第四节），进入关卡后**每答一题更新一次**。这就是 A1 说的"边界按 KC 粒度判定，不按人判定"。

### 3.3 三个画像的追问阶梯层级定义

| 层级 | 追问内容 | 例子（核电子学） |
|---|---|---|
| L1 | 概念辨认 / 量纲与单位 | "这个量的单位是 V 还是 keV？" |
| L2 | 公式选择与适用条件 | "这里为什么可以用理想运放虚短？条件满足吗？" |
| L3 | 近似与误差的合理性 | "把漏电流忽略掉，会带来多大误差？" |
| L4 | 边界情形与失效模式 | "如果探测器电容增大 10 倍，这条链还成立吗？" |
| L5 | 设计权衡 | "要在 2 ns 上升时间和 1000 e⁻ 噪声之间取舍，你改哪个电阻？" |

P1 最高到 L3，P2 到 L4，P3 到 L5 —— 与"最大层数 3/4/5"一致。

### 3.4 升降级规则（画像不是终身制）

```
每完成 3 个 KC 重新评估：
  若 3 个 KC 的平均首轮正确率 ≥ 80% 且平均用时 ≤ 画像中位数
    → 上调一级（P1→P2, P2→P3），仅影响后续关卡的渲染参数
  若 3 个 KC 的平均首轮正确率 ≤ 30%
    → 下调一级，并对已过的 KC 打 "revisit" 标记（不重开关卡）
```

依据：Tetzlaff et al. (2025) 的实践结论 —— 需要**随时间追踪 expertise 增长并逐步撤除指导**（引 Kalyuga & Renkl 2010）。ERE 是动态的，画像也必须是动态的。

---

## 四、初始水平判定的可执行规则

### 4.1 输入

```python
inputs = {
  "self_report": {
      "behavioral_items": [   # 行为频率题，不是能力自评题
          "独立搭过含运放的电路并调试成功",   # never / once / several / many
          "用示波器测过 ns 级信号",
          "读过探测器或前放的 datasheet 并据此选过件",
          "处理过噪声/屏蔽/接地问题",
      ],
      "global_self_rating": 1..5,   # 只作 tie-breaker，不作主判据
  },
  "placement_items": [...],   # 从「即将要学的 KC 池」中抽
}
```

### 4.2 主流程（伪代码）

```python
def place_learner(user, kc_pool):
    # ---- 0. 先验：行为题 + 全局自评 ----
    # r(self_report, ability) ≈ .29–.32  → 只能解释 ~9% 方差
    # 因此先验只在小范围内平移，不决定层级
    behavioral = sum(user.self_report.behavioral_items) / 4      # 0..1
    theta = 0.0 + 0.8 * (behavioral - 0.5)                       # 先验中心，±0.4 logit
    theta += 0.15 * (user.self_report.global_self_rating - 3)    # 全局自评权重极低
    sd = 1.2                                                     # 先验很宽

    responses = []
    MIN_ITEMS, MAX_ITEMS = 8, 18
    SD_STOP = 0.35          # 后验 SD 阈值（logit 尺度，≈ 3 层分类所需）
    BAND = (0.40, 0.70)     # 目标成功率的"信息带"

    # ---- 1. 粗筛：4 题，每层 1 题（图谱主要层）----
    for layer in ["L1", "L2", "L3", "L4"]:
        item = pick_representative(kc_pool, layer)   # 中位难度代表题
        r = administer(item)
        responses.append(r); theta, sd = bayes_update(theta, sd, item, r)

    # ---- 2. 自适应精化：最大 Fisher 信息 / 最小后验熵 ----
    while len(responses) < MAX_ITEMS:
        # 候选：只在当前 theta 的 ±1.0 logit 内取，避免极端题
        cands = [i for i in kc_pool
                 if i not in used and abs(i.difficulty - theta) <= 1.0]
        if not cands: break

        # 选信息量最大的题（二分题即最小后验熵）
        item = max(cands, key=lambda i: fisher_info(theta, i))   # p(1-p)
        r = administer(item)
        responses.append(r); theta, sd = bayes_update(theta, sd, item, r)

        # ---- 3. 终止条件（满足任一即停，但先满足 MIN_ITEMS）----
        if len(responses) >= MIN_ITEMS:
            if sd <= SD_STOP:                       # (a) 后验足够确定
                break
            if last_3_all_in_band(responses, BAND):  # (b) 连续 3 题落在 40–70% 成功率带
                break                               #     说明已在"信息最多"的区域收敛
            if entropy_delta_last_3 < 0.01:         # (c) 后验熵 3 题内几乎不变
                break

    # ---- 4. 分档 ----
    # 3 层切点（logit），可按实际分布校准
    if   theta < -0.7: level = "P1"
    elif theta <  0.7: level = "P2"
    else:              level = "P3"

    confidence = "high" if sd <= 0.35 else ("medium" if sd <= 0.55 else "low")

    # ---- 5. 低置信度的处理：不要硬判 ----
    if confidence == "low":
        # 落到相邻两层的下沿，并打 provisional 标记
        level = lower_of_adjacent(level)
        provisional = True
    else:
        provisional = False

    # ---- 6. 定级题必须展示答案（前测生效的前提）----
    show_correct_answers(responses)   # 一句话解释即可，不必长解析

    return Placement(
        level=level,
        provisional=provisional,
        per_kc_prior=seed_mastery(theta, responses),   # 每 KC 的 mastery 初值
        recheck_after=5,                                # 学 5 题后允许重判
    )
```

### 4.3 关键设计约束（每条都有出处）

| 约束 | 值 | 理由 |
|---|---|---|
| 题量下限 / 上限 | **8 / 18** | CAT 仿真：8.5–17 题达后验方差 0.10；分类准确率 10–15 题后稳定；ALEKS 用 29 题是为了给精确分数，我们只需 3 分类 |
| 起始难度 | 先验 theta，**不是最难题** | 最大 Fisher 信息在 p=0.5 附近 |
| 选题范围 | `abs(difficulty - theta) ≤ 1.0` | 避免"两端题"浪费（题库小时 >15 题收益甚微，尤其在两端） |
| 目标成功率带 | **40%–70%** | 信息量最大区间；同时避免挫败 |
| 停止条件 | 后验 SD ≤ 0.35 / 连续 3 题在带内 / 熵变化 <0.01 | 三重冗余，任一满足即停 |
| 定级题来源 | **必须来自即将要学的 KC 池** | prequestion specific g=0.58 vs general g=0.04 |
| 定级后动作 | **必须展示正确答案** | 前测生效的前提（Pan & Carpenter 2023） |
| 自评权重 | 仅 ±0.4 logit 先验 + tie-breaker | r = .29–.32 |
| 冷启动先验 | per-student，**"was a success"** 式；**不用人口学查表** | Pardos prior-per-student 在 30/42 上优于 KT；Zenodo 15870270 警告人口学先验放大偏差 |
| 结果可撤销 | 学 5 题后允许重判 | CSEM 在 40%–80% 区间最大（IJAIED 2019）→ 中段本就不准 |

### 4.4 不要做的三件事

1. **不要问"你是什么水平"然后直接分层**。r=.29，等于用 9% 的信息决定 100% 的流程。
2. **不要用专业/年级查表定先验**。见 Zenodo 15870270 的偏差警告。
3. **不要把定级做成"考试"**。定级题会答错很多（正常答对率约 35%），文案必须是"帮我找到合适的起点"，不是"测试你的水平"。

---

## 五、明确「找不到文献」的条目

以下条目我检索过但**没有找到可引用的数字**。列在这里，不用相邻领域的数字冒充。

1. **Sinha & Kapur (2021) 按先备知识分亚组的效应量**。元分析报告了「建基于学生解法」(+0.56 vs +0.20)、「小组协作」(+0.49 vs +0.19)、「年级」三个显著调节变量，**但公开材料中未见 prior knowledge 作为调节变量的分组数字**。文献本人在讨论中承认需要更多同时纳入 prior knowledge 与 effort regulation 的研究。
   → 产品含义：我们关于"低先备者不适用裸 PS-I"的判断，依据是 Reisslein 的电路实验（ERE 方向），**不是** PS-I 元分析的亚组数据。这两条证据独立，不要混为一谈。

2. **Tomlinson 分层教学的实证效应量**。Tomlinson 的贡献是框架与质性/设计研究，**未见可引用的元分析效应量**。分层教学的量化证据应引 Deunk et al. (2018) 与 Steenbergen-Hu et al. (2016)。

3. **ITS 按先备知识分亚组的元分析数字**。Ma et al. (2014)、Kulik & Fletcher (2016)、VanLehn (2011) 都做了大量调节变量分析，**但没有把 prior knowledge 作为调节变量报告分组 g**。现有亚组证据全部来自单项研究（Reisslein 电路实验、ACM 3772318.3791631 的 Guided vs Buggy examples）。

4. **pretesting 的单一 pooled 效应量**。Pan & Carpenter (2023) 是叙述性综述，未做元分析；St. Hilaire (2022) 是 prequestion（不是 pretesting）的元分析（g=0.58 specific / 0.04 general）。**"pretesting"作为一个整体的 pooled g，本次检索未找到。**

5. **ALEKS initial knowledge check 的官方效果数据**。ALEKS 官方未公开 RCT。能找到的是：EDM 2024 industry track 的相关性研究（作者自认有选择偏差）、IJAIED 2019 的信度仿真。**没有"用了 ALEKS 定级的学生比不用的人学得更好"的因果证据。**

6. **BKT prior 的"标准"初始化公式/默认值**。文献里 prior (L0) 是**拟合出来的参数**，没有公认默认值；工程实践常用 0.3–0.6 的经验值但缺出处。**唯一有实证支持的是 Pardos 的 per-student "was a success" 启发式**（30/42 优于 KT），而不是某个固定数值。

7. **"高自适应 vs 低自适应"的直接 RCT**。D14 的三条负面证据（learner control meta 为负、desirable difficulties、help-seeking 行为）都是**间接**的。**没有找到以"自适应程度"为自变量的对照实验。**

8. **adaptivity 作为独立调节变量的元分析效应量**。见 D13。VanLehn 的 granularity hypothesis 是机制解释，不是效应量。

9. **Deunk 2014**。用户提到的这个年份对应的同行评议文献是 **Deunk et al. (2018)**（*Educational Research Review* 24, 31–54）。2015 年的是 GION 报告（荷兰，非同行评议）。文中已按 2018 引用。

10. **核电子学领域本身的 ERE 研究**。检索到的电路分析 ERE 研究全部是**基础电路（串并联、故障排查）**，**没有针对核电子学专门内容（探测器信号链、成形放大、噪声）的 ERE 实验**。这是本产品必须自己产出的证据——也是最好的机会：做一个 P1/P2/P3 × example-first/problem-first 的 2×2，就是这个领域的第一篇。

**检索中断说明**：DeepSeek 检索 API 在最后一轮返回 `402 Insufficient Balance`，第 7–9 项（尤其"高自适应 vs 低自适应 RCT"）可能还有未检索到的文献。以上标注基于已完成的 14 轮检索（`a.txt`–`n.txt`）。

---

## 六、被证据否掉的流行做法

| 流行做法 | 为什么被否 | 证据 |
|---|---|---|
| **"让用户自己选难度/自己选学习路径"** | learner control 元分析平均效应**小且为负**："the average student would be slightly better off without it"；年轻/低能力学生更差 | *IJETI* (1996), 24 项研究元分析 |
| **"分基础班/进阶班，两条课程线"** | 班间分组 g = 0.04–0.06，基本无效；同质分组对弱生甚至有小的负效应 | Steenbergen-Hu et al. (2016) [10.3102/0034654316675417](https://doi.org/10.3102/0034654316675417)；Deunk et al. (2018) |
| **"连对 5 题才算掌握"** | 2/3/4/5 次无显著差异，只是多花时间；Khan Academy 自己也从 10 降到 5 | Kelly & Heffernan (2016) [10.1145/2876034.2893393](https://doi.org/10.1145/2876034.2893393) |
| **"即时反馈一定优于延迟反馈"（或反过来）** | 51 项研究 160 个效应量：g = 0.03 [−0.08, 0.13], p=.61，**无差异**。真正有区别的是反馈内容：只告知对错 ES=0.05 (ns)，详细解释 ES=0.49 | *Educ Psychol Rev* 38(1):13 (2026)；van der Kleij et al. (2015) |
| **"问用户你什么水平"作为定级主依据** | 自评-表现相关 M=.29 / pooled r=.32；最低四分位者高估 37 个百分点 | Zell & Krizan (2014) [10.1177/1745691613518075](https://doi.org/10.1177/1745691613518075) |
| **"用专业/年级/学历查表定先验"** | 用人口学变量做冷启动**会放大系统性偏差** | Zenodo 15870270 (2025) |
| **"固定节拍撤脚手架"（第 1 关全样例、第 2 关半样例…）** | adaptive fading 在 retention 和 transfer 上显著优于 static fading，**且不增加时间或材料** | Reisslein, Seeling & Reisslein (2006) [10.1002/j.2168-9830.2006.tb00894.x](https://doi.org/10.1002/j.2168-9830.2006.tb00894.x) |
| **"只做 fading，不加自解释追问"** | fading 单独对 near transfer 可靠、**对 far transfer 不可靠**；fading + self-explanation 在 near 和 far 上都 medium-to-large，且不增加学习时间 | Atkinson, Renkl & Merrill (2003), *J Educ Psychol* 95(4) |
| **"素材太复杂，拆成很多小问降低难度"** | 电路图+公式+单位是**高元素交互性**材料，这正是 worked example effect 生效的前提；拆散会把内在负荷转成 split-attention 外在负荷 | van Gog & Sweller (2015) [10.1007/s10648-015-9310-x](https://doi.org/10.1007/s10648-015-9310-x)；Pollack et al. (2002) ES=1.21/1.15 |
| **"把刷题量当作主要学习手段"（在高元素交互性材料上）** | 材料越复杂，**测试效应越小甚至消失**；此时样例学习优于做题 | van Gog & Sweller (2015)，标题即结论：[10.1007/s10648-015-9310-x](https://doi.org/10.1007/s10648-015-9310-x) |
| **"零基础用户也走先问题后讲解（PS-I）"** | PS-I 总体 +0.36，但低先备者最优形态是 example-problem（Reisslein 电路实验）；且 PS-I 收益严重依赖"接住学生的错误解法"（+0.56 vs +0.20） | Sinha & Kapur (2021) [10.3102/00346543211019105](https://doi.org/10.3102/00346543211019105)；Reisslein et al. |
| **"ITS 自带 g=0.66 的魔法"** | 中位 0.66 SD 极大依赖**测验与教学目标的对齐**；K-12 数学的独立元分析只有"no negative and perhaps a small positive effect" | Kulik & Fletcher (2016)；Steenbergen-Hu & Cooper (2013) |
| **"做子步骤级反馈，越细越好"** | VanLehn 的 granularity hypothesis：**step-based 与 substep-based 等效**，步骤级已是最优粒度 | VanLehn (2011), *Educational Psychologist* 46(4) |
| **"追问越深越好，无限追问"** | 无限追问 = 无限提示 = 训练用户"点提示"而非"想问题"；help-seeking 行为会被系统塑形 | Roll, Baker, Aleven & Koedinger（help-seeking 研究）；Koedinger & Aleven (2007) |
| **"引用达克效应解释用户高估自己"** | DK 的组间差异部分来自 regression to the mean / better-than-average；用 Glejser 检验 + 非线性回归的复现**未能稳定支持** | *Intelligence* 96 (2023) 101717；Krueger & Mueller (2002)。**但"低分者系统性高估"这个测量事实本身是稳的（r=.29–.32）**，只是不要叫它"达克效应" |
| **"Bloom 2 sigma，做到一对一就能翻倍"** | 复核中约为 0.76–0.79，不是 2σ；且 2σ 混合了掌握学习 + 一对一辅导两个成分 | Bloom (1984) 原始主张 vs 后续复核（见 `evidence-tables.md` 第 3 行） |

---

## 附：本文档的证据分级

| 级别 | 含义 | 本文档中的条目 |
|---|---|---|
| **A（可直接进规格）** | 元分析或多次独立复现，方向明确，效应量可引用 | ERE 及其不对称性；fading > static；前测的 specific/general 分解；自评 r≈.3；班内 vs 班间分组；反馈内容 > 反馈时机；2/3 连对阈值 |
| **B（可用，需标注为启发式）** | 单项高质量实验，或元分析的调节变量但无分组数字 | 电路分析上的 ERE；adaptive fading 的具体实现；PS-I 的 +0.56/+0.20 分解；Guided vs Buggy examples；CAT 收敛题数 |
| **C（工程经验值）** | 无直接实证，由 A/B 级证据推导 | 三级画像的具体参数（2/3/4 个新知识点、3/4/5 层追问、1/2/2 次尝试）；状态机的 0.3/0.7 切点；升降级的 80%/30% 阈值 |
| **D（缺口）** | 检索未找到 | 见第五节 10 条 |
