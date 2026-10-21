# 18: 全量知识抽取与图谱构建

**What to build:** 把 27 本书 + 101 篇论文全部变成一张知识网络：知识点树按课程先修关系排（不是按某校课时表），每条先修边都有证据，缺口显式标注。

**Blocked by:** 02, 17

**Status:** ready-for-agent

- [ ] 27 本书与 101 篇论文全部入图；论文用 `.doi_index.json` 建元数据，零 OCR
- [ ] 知识点树按**课程先修关系**排布：数字部分（第 3–4 学期）排在核电子学（第 4–6 学期）之前，中间经过模拟电子、电路分析、原子核物理
- [ ] 每一条 `prereq` 边都能追到证据来源（课程大纲原文或教材小节）；无证据的边不建，可列出全部「有证据／无证据」的边数
- [ ] `18 原子核物理实验方法` 归为后继课而非先修；`05 汤彬` 归入探测／测量方法组——与证据一致的分类，不按书名猜
- [ ] 显式标注内容缺口：资源库没有「数字多道／FPGA／数字脉冲处理」的对口教材，该缺口在图上可见
- [ ] 图上每个知识点都能点到它来自哪本书哪一页
- [ ] 修正已发现的元数据错误：1 个文件名与内容不符、3 个变音字母丢失

## Comments

### 1. 进度账（2026-10-21 18:00，captain 实测）

| 项 | 数 | 取证 |
|---|---|---|
| `app.sources` | 27（全部 `kind='book'`） | `SELECT count(*) FROM app.sources` |
| 论文入图 | **0**（`kind='paper'` 零行） | 同上，见 t34 |
| `app.knowledge_points` | 6065（叶 4441） | 12 本扫描书 2440 + 15 本电子书 3625 |
| `content/*/toc.json` 节点合计 | 6062（unique microKpId 6062，零跨书冲突） | 27 本逐本比对，无一本「章节点 0 个」 |
| `app.chunks` | 82918 | `chunks_null_kp` 252 |
| `app.kp_edges` | 247（**全部书内，跨书 0**） | 见 t36 |
| `app.modules` | 352 行，**全部 `tier='D'`** | `import-content.ts:339` 写死；`tier` 列无任何代码读 |
| `app.subjects` | 1 行 `nuclear|核电子学` | 无课程层概念 |

### 2. 已量出的真缺陷：英文 chunk 粒度（影响 AC2/AC6，已派给 graph-dev 在本任务内修）

`tools/ingest/chunk.py:34` 的 `_SENTENCE_END = re.compile(r'(?<=[。！？；])')` **只认中文句末标点**。`_split_long()` 靠它切句，英文段落一个句号都切不开 ⇒ 整页变成 1 个巨型 chunk。`books_batch.py:104` 直接调 `blocks_to_chunks`，15 本全中招。

实测：
```
length(text) > MAX_CHARS(1200) 的 chunk: 6219 个
逐本：knoll-4e 792 / ahmed 625 / knoll-3e 620 / rivetti 585 / grupen 498 /
      tsoulfanidis 470 / nakhostin 465 / spieler 456 / gilmore 364 / leo 350 /
      debertin 329 / nicholson 316 / lutz 288
chunks / 不同页码：leo 1.0 / nicholson 1.0 / nakhostin 1.0 / knoll-3e 1.0 / 其余英文书 1.1
对照：guojiang-2023 3.1 / guojiang-2014 3.6 / 12 本中文书 2–8
最长 chunk 6866 字符（knoll-4e p273，内容是一整页参考文献）
零 chunk 叶节点 358 个，逐本：ahmed 115 / leo 64 / tsoulfanidis 57 / spieler 43 /
      nicholson 26 / guojiang-2014 13 / lutz 11 / grupen 9 / rivetti 9 /
      knoll-4e 5 / knoll-3e 3 / seed 2 / methods-1997 1
```

**两层后果**：① 零 chunk 叶节点 —— 一页只有 1 个 chunk，一页上若并列 2 个叶节点，切块必有一个拿 0（`assign.py` 的切块数是 chunk 数，不是叶节点数）；② 检索粒度失效 —— BM25 命中一个 6900 字符的 chunk 等于命中整页，而检索门控是按 chunk 判定的。

**修法**（已下发）：`_SENTENCE_END` 拆成中英两个正则，英文用 `(?<=[.!?])\s+`（**必须要求句号后空白**，否则 `Fig. 3.2` / `et al.` / `1.5 V` / `M. Moszynski` 会被切碎）；英文句子仍超 `MAX_CHARS` 时按词边界切，再兜底硬切。**回归基线：12 本中文书 chunkCount 必须逐本一字不变（73248）。**

### 3. 已知缺口（不在本票范围，记录以免被当成已做）

- **教材插图未接通**：3529 张 PNG / 170 MB 零消费方 —— `import-content.ts:343-348` 的 chunk `meta` 只写 `{pdfPage,bbox,headingPath,tableRows}` 不含图片路径，`apps/api/src` 无静态服务，`apps/web/src` 无 `<img>`。三环全缺，任缺一件都是死代码。
- **`chunks.meta.headingPath` 无消费方**：`grep -rn "headingPath"` 在 `apps/api/src`、`apps/web/src`、`packages` 全 0 命中。
- **两条纯 ASCII 节点名**（`nuclear-electronics-wangjingjin-1983` 的 `1131` / `g:1343`，OCR 噪声）尚未修。
- **`app.modules` 同名重复 57 组**（「闪烁探测器」6 个、「概述」多处）：`modules` 是「一本书的一章」，同书同章名在两本书里各建一行是正确形态；但 `distinct name 295 / 352 行` 说明跨书同名无法在界面上区分。t36 用 `course_layer_id` 解决层归属，**没有**解决同名显示。

### 4. AC2 / AC3 取证（t36，2026-10-21 21:15）

票面 AC2「知识点树按课程先修关系排布」与 AC3「每条 prereq 边都能追到证据来源」要落地，缺的不是算法，是**课程层**这一层数据：`app.modules` 只知道「一本书的一章」，`ordinal` 是章在本书内的序号（每本书重新从 1 开始），跨书排序毫无意义。本任务补的就是这一层，以及建立在它之上的跨书先修边。

#### 4.1 八个课程层（迁移 `apps/api/migrations/0061_course_layers.sql`）

| ordinal | id | 名称 | 学期 | kind | 书 | 证据（`note` 列原文摘要） |
|---|---|---|---|---|---|---|
| 10 | `circuit-analysis` | 电路分析 | 2–3 | foundation | 1 | 兰大 2016《电子学基础》1403006 第 3 学期（4 学分 72 学时），内容以电路分析为起点 |
| 20 | `analog-electronics` | 模拟电子技术 | 3–4 | foundation | 2 | 南华/复旦两份《核电子学》大纲先修栏「模拟电子技术」 |
| 30 | `digital-electronics` | 数字电子技术 | 3–4 | foundation | 2 | 复旦「数字逻辑基础」INFO130331 第 3 学期；南华「数字电子技术 B」第 4–5 学期；必须先于核电子学 |
| 40 | `atomic-nuclear-physics` | 原子核物理 | 4–5 | core | 2 | 南华 2017《核电子学》先修栏第三项「原子核物理」 |
| 50 | `nuclear-electronics` | 核电子学 | 4–6 | core | 5 | 兰大第 4 学期 / 复旦第 4 学期 / 南华第 5–6 学期 / 清华第 6 学期 |
| 60 | `radiation-detection` | 探测与测量方法 | 4–6 | core | 10 | 汤彬《核辐射测量原理》9 章无核电子学章；与核电子学并行非先修 |
| 70 | `radiation-measurement-methods` | 实验方法与数据处理 | 6–8 | method | 5 | 兰大大纲先修栏「核电子学和原子核物理」→ 本层是后继课 |
| 80 | `advanced-digital` | 数字脉冲处理与可编程逻辑 | 9–10 | advanced | 0 | 本科三份大纲止于「多道分析器原理」；仅交大研究生 PHY8508 第 13–14 周 FPGA（6 学时） |

证据全文（含文件名与行号）在迁移的 `note` 列里，每一条都能回到 `.scratch/mastra-research/curriculum_report.md` 的具体小节。`test_course_map.py::test_layers_match_the_migration_seed` 逐字段核对 Python 常量表与迁移种子 —— 两处各写一份会漂移，这条测试是防漂移的闸。

#### 4.2 27 本逐本归层（`content/course-map.json`，由 `tools/ingest/course_map.py` 生成）

| # | sourceId | 课程层 | 理由（完整文本在 JSON 的 `reason` 字段） |
|---|---|---|---|
| 1 | `circuit-analysis-lihansun-5e-vol1` | `circuit-analysis` | 电路分析是电子技术课的第一门：兰大 2016 版《电子学基础》1403006 在第 3 学期开课，内容以电路分析为起点（curriculum_report.md 第 2 节）。李瀚荪《电路分析基础》上册覆盖集总参数约束关系、网孔/节点分析、一阶与二阶电路 —— 正是核电子学里RC 成形电路的数学基础。 |
| 2 | `analog-electronics-kanghuaguang-5e` | `analog-electronics` | 南华 2024 版核专业方向「模拟电子技术」课教材（第 6 版）；南华/复旦两份《核电子学》大纲的先修栏都写明「模拟电子技术」（curriculum_report.md 第 1、2 节）。 |
| 3 | `analog-electronics-tongshibai-5e` | `analog-electronics` | 国内工科最通用的模拟电子技术教材之一，兰大 2016 版《电子学基础》列为参考书（curriculum_report.md 第 2 节兰大行）；与康华光同层，覆盖放大电路频率响应与反馈 ——核电子学「最佳滤波」「谱仪放大器」两章的直接先修。 |
| 4 | `digital-electronics-yanshi-6e` | `digital-electronics` | 阎石《数字电子技术基础》第 6 版：南华核专业列为参考书、成都理工研究生「核电子学基础」参考书、多所工科院校数字电子技术课选用教材（curriculum_report.md 第 2 节）。**本层（ordinal 30）必须排在 nuclear-electronics（50）之前** —— 票 18 AC2 的核心断言。 |
| 5 | `digital-kanghua-5e` | `digital-electronics` | 康华光《电子技术基础·数字部分》第 5 版：南华电类专业「数字电子技术 A」教材（curriculum_report.md 第 2 节）。与阎石同层，两本互补（康华光偏器件与系统设计，阎石偏逻辑代数与经典时序电路）。 |
| 6 | `guojiang-2014` | `atomic-nuclear-physics` | 郭江《原子及原子核物理》旧版：覆盖原子结构、原子核性质、放射性衰变、核反应、射线与物质相互作用 —— 南华《核电子学》先修栏第三项「原子核物理」的对口教材（curriculum_report.md 第 1 节南华行）。 |
| 7 | `guojiang-2023` | `atomic-nuclear-physics` | 同上的第 2 版。与 2014 旧版同层：两版章节结构一致（第 9 章核性质、第 10–11 章衰变、第 12 章核反应、第 14 章相互作用），保留两版是因为旧版的章节编号更细、新版补了应用。 |
| 8 | `nuclear-electronics-wangzhiying-1989` | `nuclear-electronics` | **本层的基准教材**：兰大 2016/2019 版、南华核工程/核物理/辐射防护三专业、东华理工都把它列为《核电子学》选用教材（curriculum_report.md 第 1 节「关于三本教材的采用面」表）。6 章结构即三校一致的教学顺序：信号与噪声 →前置放大器 → 放大器 → 脉冲幅度分析 → 时间分析 → 数据获取。 |
| 9 | `nuclear-electronics-wangjingjin-1983` | `nuclear-electronics` | 王经瑾《核电子学》上册：多数学校列为参考书，华北电力实验课用作教材、兰大《核数据获取与处理》用下册（curriculum_report.md 第 1 节）。上册从第 9 章起（幅度甄别/时间信息/谱仪 ADC/计数设备/多道分析器/计算机多道），与王芝英后四章重叠但更细 —— 同层作为加深读物。 |
| 10 | `nicholson-1974` | `nuclear-electronics` | Nicholson《Nuclear Electronics》1974：书名即课程名，内容为脉冲成形、放大器、甄别器、定时电路 —— 核电子学经典体系的英文源头（书目清单第 16 行 C 专题）。年代早，作为历史参考同层放置。 |
| 11 | `nakhostin-2018` | `nuclear-electronics` | Nakhostin《Signal Processing for Radiation Detectors》2018：10 章里 8 章是核电子学主线（信号产生、噪声与干扰、前置放大器、能量测量、脉冲计数与电流测量、时间测量、位置灵敏、脉冲形状甄别），只有第 9–10 章是数字信号处理。**按主体归核电子学层**：把整本归到 advanced-digital 会让「前置放大器」「噪声」这些核心概念出现在研究生层，与王芝英的同名节点分处两层，学习者按层学习时必然漏掉。第 9–10 章属 advanced-digital —— 该层因此没有整本对口教材，正是 0060_content_gaps 里 gap-digital-pulse 声明的内容缺口。 |
| 12 | `rivetti-2015` | `nuclear-electronics` | Rivetti《CMOS Front-End Electronics for Radiation Sensors》2015：输入级、频域输入级、噪声、时间成形器、甄别器、数据转换器 —— 全是核电子学链路的 ASIC 实现，不是数字逻辑设计。同层作为前端电子学的现代专题（书目清单第 14 行 C 专题）。 |
| 13 | `knoll-3e-2000` | `radiation-detection` | Knoll 第 3 版：探测方法课的通用教材，20 章里 1–15、19–20 是探测器与测量，只有 16–18 章（脉冲处理与成形、线性与逻辑脉冲函数、多道脉冲分析）是电子学（curriculum_report.md 第 5 节分级表 A 主干 = 内容核心度高，但课程归属是探测方法）。 |
| 14 | `knoll-4e-2010` | `radiation-detection` | Knoll 第 4 版：与第 3 版同层，章节重排（15 脉冲处理 / 16 脉冲成形计数与定时 /17 多道脉冲分析）。两版并存是因为第 3 版的章节编号被大量旧文献引用。 |
| 15 | `nuclear-radiation-physics-chenboxian-2011` | `radiation-detection` | 陈伯显《核辐射物理及探测学》：前 6 章核物理与相互作用、后 7 章探测器与测量方法 ——课程归属是探测方法（书名即「探测学」）。它同时是原子核物理层的复习材料，但主体在探测（curriculum_report.md 第 5 节 B 探测）。 |
| 16 | `radiation-detectors-dinghonglin-2010` | `radiation-detection` | 丁洪林《核辐射探测器》：14 章全部是探测器类型与工艺（气体/闪烁/半导体/硅锂/高纯锗/化合物/低温量热），无核电子学章（书目清单第 7 行 B 探测）。 |
| 17 | `radiation-detector-handbook-jichangsong-1990` | `radiation-detection` | 汲长松《核辐射探测器及其实验技术手册》：12 章探测器 + 实验技术 + 数据统计处理，是探测层的手册型参考（书目清单第 19 行 D 实验；按课程归属放探测层，第 11–12 章的实验技术与统计与 methods 层重叠）。 |
| 18 | `nuclear-radiation-measurement-tangbin` | `radiation-detection` | 汤彬《核辐射测量原理》：9 章无核电子学章，「核电子学的基础知识」只是第 4 章探测器内容里的一句话；它是「核辐射测量原理」课教材（东华理工 68 学时）（curriculum_report.md 第 1 节「关于三本教材的采用面」表 + 第 6 节反常发现）。**按证据归探测层，不按书目清单的 A 主干** —— 清单的 A/B/C/D 是内容类型，不是课程层（见模块 docstring）。 |
| 19 | `ahmed-2e` | `radiation-detection` | Ahmed《Physics and Engineering of Radiation Detection》第 2 版：13 章里1–7 章探测器与相互作用、8 章信号处理、9–10 章统计与数据分析、11–13 章剂量/能谱/数据获取。主体是探测物理与工程（书目清单第 10 行 B 探测）。 |
| 20 | `grupen-2e-2008` | `radiation-detection` | Grupen《Particle Detectors》第 2 版：探测器特性、径迹探测器、量能器、粒子识别、中微子探测器，仅第 14 章「电子学」一章讲电子学（书目清单第 9 行 B 探测）。 |
| 21 | `lutz-2007` | `radiation-detection` | Lutz《Semiconductor Radiation Detectors》：半导体物理、探测器结构、能量与位置测量、读出电子学（第 7 章）。主体是半导体探测器（书目清单第 15 行 C 专题），第 7 章的读出电子学与核电子学层重叠但只是一章。 |
| 22 | `spieler-2005` | `radiation-detection` | Spieler《Semiconductor Detector Systems》：探测器系统、信号形成、电子学噪声、信号处理、基础数字电子学、晶体管与放大器。**按主体归探测层**（探测器系统），其中第 3–4 章（噪声、信号处理）是核电子学层的重要补充 —— 这也是它与 Nakhostin 分层的理由：Spieler 从探测器出发讲电子学，Nakhostin 从电子学出发讲信号处理。 |
| 23 | `nuclear-physics-experiment-methods-1997` | `radiation-measurement-methods` | 《原子核物理实验方法》修订第 3 版：**后继课教材**。兰州大学大纲的先修栏写「核电子学和原子核物理」，即它排在核电子学之后（curriculum_report.md 第 7 节结论 4 明确要求从书目清单的 D 实验层移到后继位置）。15 章覆盖统计、探测器、符合法、活度/能谱/中子/低水平测量、截面与寿命测量。 |
| 24 | `leo-2e` | `radiation-measurement-methods` | Leo《Techniques for Nuclear and Particle Physics Experiments》第 2 版：实验技术总论，18 章里 11、14–18 章是电子学（脉冲信号、脉冲处理电子学、幅度选择与符合、逻辑、定时、CAMAC），其余是探测器与统计。**按主体归实验方法层**：它的组织方式是「怎么做实验」，电子学章节是为实验服务的（书目清单第 12 行 C 专题）。 |
| 25 | `debertin-1988` | `radiation-measurement-methods` | Debertin & Helmer《Gamma- and X-Ray Spectrometry with Semiconductor Detectors》：本底材料、实验装置、能谱分析与能量测量、效率刻度、应用、原子与核数据 —— 典型的测量方法与数据处理（书目清单第 20 行 D 实验）。 |
| 26 | `gilmore-2e-2008` | `radiation-measurement-methods` | Gilmore《Practical Gamma-ray Spectrometry》第 2 版：计数统计、分辨率、谱仪刻度、真符合相加、能谱分析、故障排查、低/高计数率系统 —— 测量方法与数据处理（书目清单第 17 行 C 专题）。 |
| 27 | `tsoulfanidis-4e` | `radiation-measurement-methods` | Tsoulfanidis《Measurement and Detection of Radiation》第 4 版：计数误差、能量损失、各类探测器、相对与绝对测量、能谱学、数据分析方法、活化分析 —— 测量方法课教材（书目清单第 8 行 B 探测，但按课程归属是测量方法）。 |

合计 **27 本**，8 层里 7 层有书，`advanced-digital` 为空 —— 这不是漏映射，而是票面 AC5 要求的**内容缺口**：资源库没有「数字多道／FPGA／数字脉冲处理」的对口教材，已在 `0060_content_gaps` 的 `gap-digital-pulse` 里显式声明。`test_no_book_maps_to_advanced_digital` 记录这个事实：将来补了书，这条测试会红，提醒同步改缺口声明。

**注意：`资源库/books/README.md` 的 A/B/C/D 不是课程层。** 那是「内容类型」分级（A 主干 / B 探测 / C 专题 / D 先修）。两者会给出不同答案：Knoll 在清单里是 A 主干，在培养方案里是探测方法课（与核电子学并行）；汤彬在清单里是 A 主干，实际是「核辐射测量原理」课教材、9 章无核电子学章。`course_map.py` 的模块 docstring 写明了这个区分，逐本理由里也标注了「按证据归 X 层，不按清单的 A 主干」这类说明。

AC4 的两条具体要求都落在映射里：**`nuclear-physics-experiment-methods-1997`（18 原子核物理实验方法）→ `radiation-measurement-methods`（后继课）**、**`nuclear-radiation-measurement-tangbin`（05 汤彬）→ `radiation-detection`（探测／测量方法组）** —— 两条都有课程大纲原文作证，不是按书名猜。

#### 4.3 跨书先修边 32 条（`content/cross-edges.json`，由 `tools/ingest/cross_edges.py` 生成）

| 层对（ordinal 递增） | 条数 |
|---|---|
| `circuit-analysis`(10) → `analog-electronics`(20) | 2 |
| `analog-electronics`(20) → `nuclear-electronics`(50) | 3 |
| `digital-electronics`(30) → `nuclear-electronics`(50) | 5 |
| `atomic-nuclear-physics`(40) → `nuclear-electronics`(50) | 1 |
| `atomic-nuclear-physics`(40) → `radiation-detection`(60) | 5 |
| `nuclear-electronics`(50) → `radiation-measurement-methods`(70) | 6 |
| `radiation-detection`(60) → `radiation-measurement-methods`(70) | 10 |
| **合计** | **32** |

判据分布：`layer_order+term_match`（两端名字确有共同术语）**19** 条；`whitelist`（无共同术语，靠人工判定的应用关系）**13** 条。每条边同时满足「层序严格递增」（必要条件）+「术语对应」或「人工白名单」之一。

**32 条全文**（`from → to`｜书对｜层对｜依据）：

1. `kp-lihansun-5e-vol1-6-3` → `kp-tongshibai-5e-5-6-1`
   `circuit-analysis-lihansun-5e-vol1` → `analog-electronics-tongshibai-5e`｜circuit-analysis → analog-electronics｜术语命中 「阶跃响应」
2. `kp-lihansun-5e-vol1-7-3` → `kp-tongshibai-5e-5-1-2`
   `circuit-analysis-lihansun-5e-vol1` → `analog-electronics-tongshibai-5e`｜circuit-analysis → analog-electronics｜人工白名单
3. `kp-tongshibai-5e-6-2-1` → `kp-wangzhiying-1989-p42-电荷灵敏前置放大器的基本电路和实例分析`
   `analog-electronics-tongshibai-5e` → `nuclear-electronics-wangzhiying-1989`｜analog-electronics → nuclear-electronics｜人工白名单
4. `kp-tongshibai-5e-6-6-4` → `kp-wangzhiying-1989-3-4`
   `analog-electronics-tongshibai-5e` → `nuclear-electronics-wangzhiying-1989`｜analog-electronics → nuclear-electronics｜人工白名单
5. `kp-tongshibai-5e-5-1-2` → `kp-wangzhiying-1989-p16-时域和频域分析`
   `analog-electronics-tongshibai-5e` → `nuclear-electronics-wangzhiying-1989`｜analog-electronics → nuclear-electronics｜人工白名单；同义 「频率响应」≈「频域分析」
6. `kp-yanshi-6e-6-3-2` → `kp-wangzhiying-1989-6-1`
   `digital-electronics-yanshi-6e` → `nuclear-electronics-wangzhiying-1989`｜digital-electronics → nuclear-electronics｜术语命中 「计数」
7. `kp-yanshi-6e-8-6-3` → `kp-wangzhiying-1989-4-3-4`
   `digital-electronics-yanshi-6e` → `nuclear-electronics-wangzhiying-1989`｜digital-electronics → nuclear-electronics｜人工白名单；同义 「逐次逼近」≈「逐次比较」
8. `kp-yanshi-6e-8-6-4` → `kp-wangzhiying-1989-4-3-3`
   `digital-electronics-yanshi-6e` → `nuclear-electronics-wangzhiying-1989`｜digital-electronics → nuclear-electronics｜人工白名单；同义 「双积分型A/D转换」≈「线性放电型模数变换」
9. `kp-yanshi-6e-8-6-1` → `kp-wangzhiying-1989-4-3-5`
   `digital-electronics-yanshi-6e` → `nuclear-electronics-wangzhiying-1989`｜digital-electronics → nuclear-electronics｜人工白名单；同义 「并联比较」≈「闪电」
10. `kp-yanshi-6e-7-3-2` → `kp-wangzhiying-1989-4-3-2`
   `digital-electronics-yanshi-6e` → `nuclear-electronics-wangzhiying-1989`｜digital-electronics → nuclear-electronics｜人工白名单；同义 「单稳态」≈「展宽」
11. `kp-guojiang-2023-14-1` → `kp-wangzhiying-1989-p10-五核辐射探测器输出信号的数学模拟`
   `guojiang-2023` → `nuclear-electronics-wangzhiying-1989`｜atomic-nuclear-physics → nuclear-electronics｜人工白名单
12. `kp-guojiang-2023-14-1` → `kp-chenboxian-2011-6-2`
   `guojiang-2023` → `nuclear-radiation-physics-chenboxian-2011`｜atomic-nuclear-physics → radiation-detection｜术语命中 「重带电粒子」、「相互作用」、「物质」
13. `kp-guojiang-2023-14-2` → `kp-chenboxian-2011-6-3`
   `guojiang-2023` → `nuclear-radiation-physics-chenboxian-2011`｜atomic-nuclear-physics → radiation-detection｜术语命中 「相互作用」、「物质」；同义 「快速电子」≈「快电子」
14. `kp-guojiang-2023-14-3` → `kp-chenboxian-2011-6-4`
   `guojiang-2023` → `nuclear-radiation-physics-chenboxian-2011`｜atomic-nuclear-physics → radiation-detection｜术语命中 「射线」、「相互作用」、「物质」
15. `kp-guojiang-2023-14-4` → `kp-chenboxian-2011-13-3`
   `guojiang-2023` → `nuclear-radiation-physics-chenboxian-2011`｜atomic-nuclear-physics → radiation-detection｜术语命中 「中子」、「相互作用」、「物质」
16. `kp-guojiang-2014-9-5-1` → `kp-chenboxian-2011-1-7`
   `guojiang-2014` → `nuclear-radiation-physics-chenboxian-2011`｜atomic-nuclear-physics → radiation-detection｜术语命中 「宇称」
17. `kp-wangzhiying-1989-5-3` → `kp-methods-1997-p190-第一节符合法的基本原理`
   `nuclear-electronics-wangzhiying-1989` → `nuclear-physics-experiment-methods-1997`｜nuclear-electronics → radiation-measurement-methods｜术语命中 「符合」
18. `kp-wangzhiying-1989-5-5` → `kp-methods-1997-p389-第一节脉冲形状甄别方法`
   `nuclear-electronics-wangzhiying-1989` → `nuclear-physics-experiment-methods-1997`｜nuclear-electronics → radiation-measurement-methods｜术语命中 「甄别」；同义 「脉冲波形甄别」≈「脉冲形状甄别」
19. `kp-wangzhiying-1989-5-4-1` → `kp-methods-1997-p422-第二节短核寿命的测量方法`
   `nuclear-electronics-wangzhiying-1989` → `nuclear-physics-experiment-methods-1997`｜nuclear-electronics → radiation-measurement-methods｜人工白名单
20. `kp-wangzhiying-1989-4-2` → `kp-tsoulfanidis-4e-9-4`
   `nuclear-electronics-wangzhiying-1989` → `tsoulfanidis-4e`｜nuclear-electronics → radiation-measurement-methods｜术语命中 「单道」
21. `kp-wangzhiying-1989-6-4-1` → `kp-leo-2e-18-1`
   `nuclear-electronics-wangzhiying-1989` → `leo-2e`｜nuclear-electronics → radiation-measurement-methods｜人工白名单
22. `kp-nakhostin-2018-4-4` → `kp-tsoulfanidis-4e-9-3`
   `nakhostin-2018` → `tsoulfanidis-4e`｜nuclear-electronics → radiation-measurement-methods｜人工白名单
23. `kp-knoll-4e-2010-17-1` → `kp-tsoulfanidis-4e-9-4`
   `knoll-4e-2010` → `tsoulfanidis-4e`｜radiation-detection → radiation-measurement-methods｜术语命中 「单道」
24. `kp-knoll-4e-2010-17-2` → `kp-methods-1997-p243-三描述谱仪性能的几个量`
   `knoll-4e-2010` → `nuclear-physics-experiment-methods-1997`｜radiation-detection → radiation-measurement-methods｜人工白名单
25. `kp-knoll-4e-2010-16-5` → `kp-methods-1997-p389-第一节脉冲形状甄别方法`
   `knoll-4e-2010` → `nuclear-physics-experiment-methods-1997`｜radiation-detection → radiation-measurement-methods｜术语命中 「甄别」
26. `kp-knoll-4e-2010-16-4` → `kp-leo-2e-17-4-3`
   `knoll-4e-2010` → `leo-2e`｜radiation-detection → radiation-measurement-methods｜术语命中 「定时」
27. `kp-knoll-4e-2010-p641-isPulseShaping` → `kp-tsoulfanidis-4e-10-6`
   `knoll-4e-2010` → `tsoulfanidis-4e`｜radiation-detection → radiation-measurement-methods｜术语命中 「脉冲成形」、「成形」
28. `kp-chenboxian-2011-7-2` → `kp-methods-1997-p6-第二节放射性测量的统计误差`
   `nuclear-radiation-physics-chenboxian-2011` → `nuclear-physics-experiment-methods-1997`｜radiation-detection → radiation-measurement-methods｜术语命中 「统计误差」
29. `kp-chenboxian-2011-8-3` → `kp-methods-1997-p82-第三节正比计数器`
   `nuclear-radiation-physics-chenboxian-2011` → `nuclear-physics-experiment-methods-1997`｜radiation-detection → radiation-measurement-methods｜术语命中 「正比计数器」、「计数器」、「计数」
30. `kp-chenboxian-2011-11-2` → `kp-methods-1997-p186-第七节热释光探测器`
   `nuclear-radiation-physics-chenboxian-2011` → `nuclear-physics-experiment-methods-1997`｜radiation-detection → radiation-measurement-methods｜术语命中 「热释光」
31. `kp-chenboxian-2011-6-2` → `kp-methods-1997-p30-第二节重带电粒子与物质的相互作用`
   `nuclear-radiation-physics-chenboxian-2011` → `nuclear-physics-experiment-methods-1997`｜radiation-detection → radiation-measurement-methods｜术语命中 「重带电粒子」、「相互作用」、「物质」
32. `kp-tangbin-6-4` → `kp-debertin-1988-4-1-2`
   `nuclear-radiation-measurement-tangbin` → `debertin-1988`｜radiation-detection → radiation-measurement-methods｜术语命中 「效率」

每条边的完整 `evidence` 文本（含课程层学期区间、章节路径、为什么是应用关系）在 `content/cross-edges.json` 的 `edges[].evidence` 里，可直接读。`evidence_detail` 结构：`{type:"cross_book", from_book, to_book, fromLayer, toLayer, matchedTerms, synonymPairs, basis, curriculumSource}`。

**候选拒绝统计（AC3 要求「可列出全部有证据／无证据的边数」）**

| 项 | 数 | 说明 |
|---|---|---|
| 归一化后名字 | 2932 | 去编号/括号/标点，过滤「未收录术语」「目录」等噪声名 |
| 跨书同名概念 | 214 | 至少两本书有同名叶节点 |
| 层序合法 | 274 | from 层 ordinal < to 层的**叶对**数 |
| 白名单采用 | 7 | 其中被策展成边的 |
| 非应用关系被拒 | 267 | 层序合法但只是「同一概念各书都讲一遍」 |
| 同层被拒 | 524 | 并行课，无先后（radiation-detection 内部 342 对最多） |
| 反向被拒 | 274 | 层序高的书讲得更细，反向同名对 |
| 书未映射被拒 | 0 | 0（27 本全有映射） |

**为什么不是自动匹配**：三种自动方案实测全部否决 —— ①共享中文二元组：216 对相邻层精确同名，但绝大多数是「光电效应／康普顿散射／轫致辐射」这类同层重复或反向内容（`ahmed→leo` 20 对、`jichangsong→methods` 13 对），连上去会让学习者被要求先掌握一个还没学的同名节点；②术语表子串：971 个原始叶对，噪声更大（「计数器」480 对）；③归一化整名相等：7582 对，大量是 `未收录术语（…）` 归一化后撞名。真正的判据不是「两个名字有共同词」，是「后一本书这一节在讲前一本书那一节的**直接应用**」——这是教学判断，只能逐条写下来并附理由。32 条不是 200 条，但每条都能被审。

#### 4.4 `import-content.ts` 的接线（diff 摘要）

- 新增 `CourseMap` 类型 + `COURSE_MAP_PATH` + `loadCourseMap()`（带缓存、文件缺失时**打警告**而不是抛错，让旧环境仍能导入，模块的 `course_layer_id` 显式留 NULL）+ `courseLayerOf(sourceId)`；
- 模块 INSERT 从 `(id, subject_id, name, tier, ordinal) VALUES ($1,'nuclear',$2,'D',$3)` 改成 6 列带 `course_layer_id`，`tier` 由课程层 `kind` 接管（`foundation/core/advanced/method`）；`ON CONFLICT DO UPDATE` 同时更新 `tier` 与 `course_layer_id`；
- 没有改 `SOURCE_META`（27 本的 title/path 原样）；没有改任何 chunk / 知识点 / 边的逻辑。

**为什么 `tier` 可以接管**：`tier` 列原本是 A/B/C/D 内容分级，t36 实测 `grep -rn "modules.tier"` 在 `apps/api/src`、`apps/web/src`、`packages` **零命中** —— 没有任何代码读它。论文模块仍是 `tier='C'`，不受影响。迁移 0061 把 `modules_tier_check` 放宽成同时接受 `A|B|C|D|foundation|core|advanced|method`，因为 12 处测试夹具直接插 `tier='A'|'D'`，只允许新值会让别人的测试全红。

#### 4.5 真实库报数（2026-10-21 21:15）

```
app.course_layers        8 行（ordinal 10/20/30/40/50/60/70/80）
app.modules             362 行
  按 course_layer_id:
    radiation-detection            135
    radiation-measurement-methods   74
    digital-electronics             38   ← 含 m-digital
    nuclear-electronics             38
    atomic-nuclear-physics          37
    analog-electronics              23
    circuit-analysis                 7
    NULL                            10   ← 全部 mod-paper-*（论文主题，正确）
  按 tier: core 210 / method 74 / foundation 68 / C 10（论文模块）
app.kp_edges            279 = 书内 247 + 跨书 32
app.knowledge_points    7277
app.chunks              96821（chunks→missing kp = 0）
GET /api/v1/graph       200 / nodes 5495 / edges 279 / recommendedIds 3 / contentGaps 3
```

**`m-digital` 的处理（captain 补充 1）**：归 `digital-electronics`（`tier=foundation`）。它不是任何一本书的章节，所以不经过 `content/course-map.json`（那份产物只管「书 → 层」），而是在 `apps/api/migrations/seed.sql` 里显式写 `course_layer_id` + 一条幂等 `UPDATE`（因为 `INSERT ... ON CONFLICT DO NOTHING` 对 0061 之前已存在的行什么都不做）。**10 个 `mod-paper-*` 保持 NULL 是正确形态** —— 它们是文献主题分类（`collider-detectors`、`readout-asics` 等），横跨所有课程层，不属于任何一门课。两者混在一起就无法区分「漏了」与「本来就不该有」。这条区分已写进 `seed.sql` 的注释。

#### 4.6 验证（全部实跑）

```
python -m pytest tools/ingest/ -q          → 304 passed（t36 新增 34 条：test_course_map 15 + test_cross_edges 19）
pnpm --filter @starmap/api test            → 31 files / 393 tests passed, 61.10s
npx tsc --noEmit -p apps/api/tsconfig.json → rc=0
node scripts/check-migrations.mjs          → 3 项全过（22 个迁移 / 22 对 up-down / 88 个对象 / 无残留）
```

**变异测试（证明测试有判别力，每次变异后都还原并复跑全绿）**：
- `course_map.py` 把 `advanced-digital` 的 ordinal 80 改成 35 → 4 条红（升序、迁移种子一致、终点层、产物同步）；
- `course_map.py` 删掉 `nicholson-1974` 的映射 → 3 条红（27 本齐全、仓库书双向相等、产物同步）；
- `cross_edges.py` 对调第一条边两端 → 3 条红（白名单齐全、反向候选被拒、产物同步）。

**端到端验证**：`pnpm --filter @starmap/api content:import` 重导 `circuit-analysis-lihansun-5e-vol1`，7 个模块的 `course_layer_id` 全部写成 `circuit-analysis`、`tier=foundation`，32 条跨书边未被 `import-content.ts` 的「删本书旧边」逻辑误删（它只删两端都在本书里的边）。

#### 4.7 红线合规

- 没有 `DELETE FROM app.knowledge_points`（无 id 条件的更没有）；
- 跨书边只增不删：247 条书内边一条未动，`DELETE` 只用于 `evidence_detail->>'type' = 'cross_book'`；
- 没有 `git add -A`（提交只 `git add` 具体路径）；
- 没有改 `chunk.py` / `assign.py` / `books_batch.py` / `toc.py` / `tools/eval/**` / `packages/api-contract/**` / `apps/web/**`。

