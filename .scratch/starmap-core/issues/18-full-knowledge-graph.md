# 18: 全量知识抽取与图谱构建

**What to build:** 把 27 本书 + 101 篇论文全部变成一张知识网络：知识点树按课程先修关系排（不是按某校课时表），每条先修边都有证据，缺口显式标注。

**Blocked by:** 02, 17

**Status:** ready-for-agent

- [x] 27 本书与 101 篇论文全部入图；论文用 `.doi_index.json` 建元数据，零 OCR（t26 + t34，取证见 Comments 第 1/6 节；库内 `sources` 128 = 27 book + 101 paper，`knowledge_points` 7277，论文 1212/叶 1054/chunk 3132）
- [x] 知识点树按**课程先修关系**排布：数字部分（第 3–4 学期）排在核电子学（第 4–6 学期）之前，中间经过模拟电子、电路分析、原子核物理（t36，取证见 Comments 第 4 节；`app.course_layers` 8 层 ordinal 10–80）
- [x] 每一条 `prereq` 边都能追到证据来源（课程大纲原文或教材小节）；无证据的边不建，可列出全部「有证据／无证据」的边数（t36，取证见 Comments 第 4 节；`kp_edges` 279 = 书内 247 + 跨书 32，`evidence` 无空值）
- [x] `18 原子核物理实验方法` 归为后继课而非先修；`05 汤彬` 归入探测／测量方法组——与证据一致的分类，不按书名猜（t36，取证见 Comments 第 4 节；`content/course-map.json` 逐本 `reason` 有原文引用）
- [x] 显式标注内容缺口：资源库没有「数字多道／FPGA／数字脉冲处理」的对口教材，该缺口在图上可见（t35，取证见 Comments 第 5 节）
- [x] 图上每个知识点都能点到它来自哪本书哪一页（t37，取证见 Comments 第 7 节；`NodeDetailResponse.source = {sourceId,title,page,pageLabel}`）
- [x] 修正已发现的元数据错误：1 个文件名与内容不符、3 个变音字母丢失（t34 + captain，取证见 Comments 第 6 节 AC7 与第 8 节）

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

### 5. AC5 取证：内容缺口的可见性（t35，2026-10-21 21:55）

**数据在哪**：`app.content_gaps`（迁移 `0060_content_gaps.sql`）三条种子 —— `gap-digital-mca` 数字多道分析器 / `gap-fpga` FPGA 可编程器件 / `gap-digital-pulse` 数字脉冲处理，全部 `expected_role='advanced'`。`nearest_kp_ids` 不建外键，由迁移执行那一刻按名字子查询解析（知识点 id 会随重导入漂移，写死就变成点不动的链接）。实查三条各解析出 3 个真实叶节点 id。

**为什么进库而不是前端常量**：缺口是内容侧事实，随资源库变化 —— 补了书应当删一行就消失，而不是发一次版。种子写在迁移里（不是 `seed.sql`）：seed 是演示数据、测试 schema 会跳过，缺口是产品内容。

**接口**：`GraphResponseSchema` 加 `contentGaps: z.array(ContentGapSchema)`（**必填**，空数组合法）。可选字段会让前端把「没实现」和「没有缺口」当成同一件事，功能静默死掉。`graph.controller.ts` 用第三条查询读表，按 id 排序（同毫秒插入分不出先后）；不过滤 `nearest_kp_ids` 解析不到的缺口 —— 缺口的事实与「有没有指得到的地方」是两件事。

**界面**：`MapPage.tsx` 页面底部「内容缺口」区（Fluent `MessageBar intent="warning"`），**不画在 sigma 画布上**：缺口指向图上不存在的节点，造虚拟节点会让布局变形，固定位置又和图无关。每条给一个「从最接近的知识点看起」入口，取第一个**在图中存在**的 `nearestKpIds`（不在图里就不给链接，但缺口照常显示）。

**实现时发现并修掉的真缺陷（本票最重要的一条）**：缺口区在屏幕上**完全看不到** —— 它在 DOM 里、在无障碍树里、Playwright 的 `isVisible()` 也报 true（它只判非空矩形与 visibility，**不判遮挡**），但屏幕上是整块深色画布。两个根因叠在一起：
1. 页面根是 `height: 100%` 的 flex 列，画布格子的 `minHeight: 0` 让它被下面的缺口区挤小，而 `.graph-canvas` 自己有 `min-height: 480px` 不会缩，于是溢出自己的格子盖在上面；
2. 修法第一版写成 `minHeight: 480`（裸数字）—— Griffel（`makeStyles`）**不给裸数字补 `px`**，生成一条无效声明被浏览器丢弃，计算值仍是 `auto`。`minHeight: 0` 能生效是因为 0 本来就无需单位，所以这个坑只在非零值上出现。

最终修法：`body.minHeight = '480px'`（与 `.graph-canvas` 的 `min-height` 同值），空间不够时整页变高、由 `AppShell` 的 `main { overflow: auto }` 滚，而不是画布压住别的内容；右栅清单仍在格子里自己滚。

**新守卫** `apps/web/e2e/content-gaps.spec.ts`（2 条）：判据是**命中测试** —— 把缺口区滚进视口，在它矩形内取三点 `elementFromPoint`，命中的元素必须落在缺口区内部。jsdom 测不出这件事（没有布局引擎），只断言 DOM 存在会给假绿。**反向验证**：把修复改回原样 → 三点全部命中 `DIV.sigma-mouse`，点击也被 `sigma-mouse` 拦截，2 条红；改回 → 2 条绿。

**规模回归（现库 5495 叶节点；票面写的 4441 是 captain 写票时的旧快照，t26 又入库了几本）**：
```
GET /api/v1/graph        1,462,942 bytes（1.40 MB）  三次 424.5 / 96.0 / 97.3 ms
                         nodes 5495 / edges 279 / contentGaps 3（三条 nearestKpIds 全解析到真实节点）
/map 冷加载（Playwright）domcontentloaded 2691 / 2778 / 2576 ms；画布可见 15604 / 15928 / 15662 ms
GET /api/v1/nodes?limit=200    cursor 分页 28 页 / 5495 项 / 5495 unique（无重复无遗漏）
```
15.7 秒未超过任务书的 20 秒阈值，**未改任何渲染策略**（属票 03 范围）。同批另发现：5530 节点全图下单次 `mouse.wheel` 3.5–25 秒（`nodeCount=1` 时 69–81 ms），`graph.spec.ts` 两条滚轮用例超时 —— 把 `MapPage.tsx` 换回 `HEAD` 版本仍红，与 AC5 改动无关，已报 captain 另开任务。

**测试与全链**：`MapPage.test.tsx` 5 条（jsdom：三条 topic 渲染 / 不在画布容器内 / 空数组不渲染 / id 全失效仍显示 / 第一个可用 id 做成入口）；`graph.controller.test.ts` 4 条（迁移种子已在、UPDATE 后指得到、DELETE 后 200+空数组、指向不存在 id 的缺口不过滤）。全链：`pnpm typecheck` 6/6；`pnpm test` shared 32 / api-contract 3 / engine 242 / tools-eval 115 / web 422 / api 393；`pnpm check:boundaries` 662 modules / 1241 deps 无违规；`contract:check` 103 组件 / 361 文件同步；`check:migrations` 22 迁移 / 22 对 / 88 对象。e2e：`smoke` 13 passed、`content-gaps` 2 passed。

### 6. AC1 / AC7 取证：101 篇论文零 OCR 入图（t34，2026-10-21 22:00）

工具：`tools/papers/ingest_papers.py` + 四份术语表（`paper_glossary*.py`）+ `test_paper_names.py`（55 tests）。数据流、为什么按 DOI 对齐、为什么不做 chunk 切分、已知缺陷都写在 `tools/papers/README.md`。

**库内实数**（`.scratch/final-acceptance-t34.py` 一次跑出）：
```
app.sources kind='paper'      101
knowledge_points (paper)     1212   （depth0 101 + 叶 1054 + 中间层 57）
  叶节点                     1054
app.chunks (paper)           3132   （其中多叶共享页的副本 522）
app.modules (mod-paper-*)      10   （tier='C'，ordinal 100–109）
```

**零孤儿 / 零悬空**：kp 指向不存在 source **0** · chunk 指向不存在 kp **0** · 无叶节点的论文 **0** · 叶节点无 chunk **0**。

**AC1「零 OCR」的取证**：`ingest_papers.py` 全文没有 OCR 调用，只 `pypdf.PdfReader(...).extract_text()`。101 篇全部有完整文字层（实测每篇前 3 页字符数 6.5K–17.4K），无一篇全空页占比 >50%，所以「跳过 OCR」不是放弃数据，而是没有需要 OCR 的部分。

**AC1「用 `.doi_index.json` 建元数据」**：`cross_check_doi_index()` 硬校验 README 表格的 101 个 DOI 与 `.doi_index.json` 的 101 个键**集合相等**，不相等直接 exit 2。但 `.doi_index.json` 的 `file` 字段**不可信**（Windows 绝对路径 + GBK↔UTF-8 误解码，实测 101 条没有一条能对上磁盘文件名），所以只取 DOI 作主键，文件名从 README 的 `文件` 列取。

**AC7「修正已发现的元数据错误」**：
- 变音字母 3 条：`Mller1973_Dead.pdf` → `meta.correctedAuthor = "Jörg W. Müller"`、`Frhwirth1987_Application.pdf` → `"R. Frühwirth"`、`Kibdi2008_Evaluation.pdf` → `"T. Kibédi"`，各带 `fileNameNote` 说明「文件名不改（会断 .doi_index.json 的映射）」。`content/papers/index.json` 同样带这两个字段（验收要求「在 meta 里留 fileNameOriginal」，清单文件也要能反查）。
- 文件名与内容不符那条是 books 侧（`24_模拟电子技术基础…第5版.pdf` 实为第 4 版），不属本票范围。**captain 2026-10-21 22:30 已修**：`apps/api/scripts/import-content.ts` 的 `SOURCE_META['analog-electronics-tongshibai-5e'].title` 从「第5版」改为「第4版」，并加四行注释说明「版次以内容为准，不以文件名为准」，`pnpm content:import --dir ../../content/analog-electronics-tongshibai-5e` 重导后 `app.sources.title = 模拟电子技术基础（童诗白、华成英 第4版）`。取证链：`资源库/books/README.md` 第 24 行「版次 4th / ISBN 9787040425055」+ 版本说明第 46 行；PDF 内嵌元数据 Title 的 GBK 十六进制 `A1B6C4A3C4E2B5E7D7D3BCBCCAF5BBF9B4A1A1B7CDAFCAABB0B720B5DACBC4B0E62E706466` 解码为「《模拟电子技术基础》童诗胺 第四版」（「胺」是原作者名 OCR 错字，版次「第四版」清晰）。

**抽 3 篇翻回 PDF 核对**（`pypdf` 读首页文字层，肉眼比对）：

> 票面写的是「Sauli1997_Gem / Knoll 相关 / 一篇 1959–1980 的奠基性论文」。**语料里没有 Knoll 的论文**
> —— `资源库/papers/` 的 101 篇里搜 `knoll` 命中 0（README 表格、`sources.title`、`meta.tableTitle`
> 三处都查过）。Knoll 是**教材**（`knoll-3e` / `knoll-4e` 两本书），不在论文库里。
> 所以第三篇换成 `Charpak1968_Use.pdf`（1968 年多丝正比室，奠基性），另加 `Radeka1974_Signal.pdf`
> 凑足三篇且覆盖「现代 / 奠基性 / 中文译名长标题」三种情况。

| 文件 | PDF 首页原文 | 入库 `sources.title` | `year` |
|---|---|---|---|
| `Sauli1997_Gem.pdf` | `GEM: A new concept for electron amplification in gas detectors` | GEM：气体探测器中电子倍增的新概念 | 1997 ✓（A 386 (1997) 531-534）|
| `Charpak1968_Use.pdf` | `THE USE OF MULTIWIRE PROPORTIONAL COUNTERS TO SELECT AND LOCALIZE CHARGED PARTICLES` | 用多丝正比计数器选择与定位带电粒子 | 1968 ✓（62 (1968) 262-268）|
| `Radeka1974_Signal.pdf` | `SIGNAL, NOISE AND RESOLUTION IN POSITION-SENSITIVE DETECTORS` | 位置灵敏探测器中的信号、噪声与分辨率 | 1974 ✓ |

**D10 中文名（captain 追加要求）**：纯 ASCII 节点名 **0** · 纯 ASCII 模块名 **0** · 含「未收录术语」的节点名 **0** · 以虚词结尾的节点名 **0** · 奠基性论文（`summary` 与 `sources.meta` 两处）**14 / 14**。英文原名全部保留在 `knowledge_points.summary` 的「原文：」后面（格式 `原文：<English>；DOI：…；<year> 年 · <venue>`），所以降级命名不丢信息。

**为什么 kp 总数是 1212 而不是 1247**：captain 的期望值 1247 是**首次落库**的快照。之后为修「译名残句」加了入口闸（`_is_measurement_fragment` / `_is_running_text_fragment` / 参考文献缩写链），拦掉 35 个**假节点**（PDF outline 把正文行当章节），它们的页归到前一个真叶节点，所以叶 1089→1054、kp 1247→1212、chunk 3162→3132。这是改进不是回退：那些假节点在图上永远是点不开的死点。

**降级命名从 77 压到 24（七轮）**：加完两道入口闸后剩 44 条，其中 20 条是**真标题被误降级**（`GEM chambers` → 「GEM 室」、`The ROOT Trees` → 「ROOT树」、`The TObject class` → 「TObject类」这类以拉丁缩写开头的名字），放宽判据到「2 汉字，或 1 汉字 + 拉丁缩写」后降到 24。剩 24 条逐条看过：参考文献条目 / PDF 版面碎片 / 单位量程 / 缩写，没有一条能靠补词表救回来。

**守门测试** `tools/papers/test_paper_names.py`（55 tests）：纯函数判据（`_strip_dangling_tail` / `_is_running_text_fragment` / `_is_measurement_fragment` / `merge_small_caps` / `_looks_like_name`）+ 5 条库内不变量（节点名不得纯 ASCII / 模块名必须中文 / 奠基性 14 篇 / 每叶有 chunk / 名字不得以虚词结尾）。**反向验证做过**：把一个叶节点名改成 `Introduction` → `test_paper_kp_names_are_not_ascii` 变红并点名那条 id；`ingest_papers.py` 重跑后恢复绿。

**一处如实记录的边界**：34 篇论文只有 1 个叶节点（`leafCount=1`，名字叫「全文」）—— 这些 PDF 没有 outline、正文也不符合行模式，典型是 Letter to the Editor / 4–6 页短会稿。退化成「整篇一个叶」是刻意的：宁可粒度粗，不造假节点。每篇叶节点数中位数 5，最多 146。

**全仓验证**：`python -m pytest tools/papers -q` → **55 passed**；`python -X utf8 tools/papers/ingest_papers.py --dry-run` 幂等；写库重跑输出「清理旧 chunk 3132 行 → sources 101 / modules 10 / kp 1212 / chunks 3132」。

**一条不属于本票的红（如实记录）**：`python -m pytest tools/` 全量跑时 `tools/ingest/test_content_artifacts.py::test_answer_key_flag_matches_the_rule_for_every_book` 失败 —— `grupen-2e-2008: 标记 ['kp-grupen-2e-2008-18'] != 期望 []`、`guojiang-2014: 标记 ['kp-guojiang-2014-20'] != 期望 []`。两个 `content/*/toc.json` 的 mtime 是 21:33，晚于我的所有改动（我只写 `tools/papers/` 与 `content/papers/`）；根因是这两个节点的名字不再匹配 `is_answer_key_title()` 的规则，属 content-dev 的 `content/*/toc.json` 重出与 `tools/ingest` 规则之间的不一致。**我没有改它**（不属于 `tools/papers/` 边界）。

**票 18 剩余（不属本票范围）**：AC2 先修关系排课、AC3 每条边有证据、AC4 课程归属、AC5 内容缺口、AC6 每个知识点能点到书页 —— 分别由 t36（AC2/AC3，见第 4 节）、t35（AC5，见第 5 节）与 graph-dev 承担。本节只看 AC1（论文入图、零 OCR）与 AC7（元数据修正）。

### 7. D10 译名兜底清零（t42，2026-10-22 03:20）

**起点**：生产库 `app.knowledge_points` 里 `name LIKE '%未收录术语%'` 有 **213** 条（其中叶子 191），
`translate.py` 的兜底形态是 `未收录术语（<原文>）`——它含汉字，所以「纯 ASCII 名 = 0」这条判据抓不到它，
图上却是一个点开只有一句英文原文的死节点。

**结果：0 条**（`select count(*) … where name like '%未收录术语%'` → `0`）。

**三类根因，处理方式不同**（先查清再动手，没有一刀切重译）：

| 类别 | 条数 | 根因 | 处置 |
|---|---|---|---|
| 产物过期 | 176 | 词典早就能译，只是 `content/*/toc.json` 是旧词典生成的 | 用当前 `translate.py` 拿 `nameOriginal` 原地重译，**逐字节只改这些 name** |
| 索引页假节点 | 25 | `spieler-2005` 的 PDF 书签里 `Index`(L1) 下面挂着 `A`–`Z`(L2)，页码 478–489，而第 9 章正文只到 434 页 | 重跑 `toc_batch.py --only spieler-2005` 走书签路径，`_OUTLINE_DROP_SUBTREE` 的 `'index'` 规则把整棵子树剔掉（324 → 286 节点），**不进词典**（补成「A」「B」毫无意义） |
| 真译不出 | 12 | 纯缩写/软件名（`ISOCS`/`GESPECOR`/`ROOT`/`MATLAB`/`ADCs`×2/`The ADC`）、`MDA: efficiency…`、`R´esum´e`、`B.4 Wilkinson ADC`、`A.4 The Laplace transform`、`9．3．1 1＋1≠2`、`6:2 Preservation of timing information` | 新建 `tools/ingest/names.zh.json`（**11 条**）做「原文 + 中文类别」覆盖；另小改 `translate_title` 三个分支 |

**`tools/ingest/translate.py` 的三处小改**（不是为了这 12 条硬编码，而是补通用能力）：
- `_LEAD_NUMBER` 扩成四分支，支持**字母段编号** `B.4` / `10.1.A` / `10.1.C`（原来只认 `\d+(\.\d+)*` 与罗马数字，整串进分词后 `B`/`ROOT` 无中文就兜底）；
- 新增 `_LEAD_ARTICLE = re.compile(r'^(?:The|A|An)\s+')`，编号剥完后再剥前导冠词（`The ADC` 的 `The` 原来留在词串里）；
- 冒号分支加条件 `if ':' in text and re.search(r'[A-Za-z]', text.partition(':')[0])`，**冒号左侧没有字母就不走冒号分支**（`6:2 Preservation of timing information` 原来被拆成「未收录术语（6）：定时信息的保持」）。

**`tools/ingest/names.zh.json`（11 条，`load_overrides()` 读它、`make_translator()` 优先于规则）**：
`B.4 Wilkinson ADC`→Wilkinson 型 ADC · `10.1.A ROOT`→ROOT 数据分析框架 · `10.1.C MATLAB`→MATLAB 数值计算软件 ·
`The ADC`→ADC 模数转换器 · `ISOCS`→ISOCS 无源效率刻度软件 · `GESPECOR`→GESPECOR 符合修正软件 ·
`MDA: efficiency, background and counting`→MDA（最小可探测活度）：效率、本底与计数 · `R´esum´e`→摘要 ·
`9．3．1 1＋1≠2`→1＋1≠2（超重元素稳定岛） · `ADCs`→ADC 模数转换器 · `A.4 The Laplace transform`→拉普拉斯变换。

**判据（按 captain 的裁定，不用「汉字占比下限」当主判据）**：
- 主判据 `FORBIDDEN = ('未收录术语', '未譯', 'TODO', '（原文）')` 在 27 本 `toc.json` 的 `name` 里为 **0**；
- 辅助判据纯 ASCII 名 **== 17 且逐条列白名单**（`SPICE`/`MOSFET`×2/`SPICE7`/`11.2 SPICE`/`1131`/`g:1343` 属已知 OCR 噪声，
  `NaI(TI)`/`ZnS(Ag)`/`Lil(Eu)`/`BiGeO,(BGO)`/`CdwO,`/`CaF,(Eu)`/`Li,B,O,`/`CaSO,`/`MgSiO:Tb`/`Mg,B,O,` 是正确的化学式），
  **新增一条就红**；
- `names.zh.json` 的 11 条必须全部可复现（`make_translator(load_overrides())(k) == v`）；
- 其余 name **逐字节不变**（重译脚本只碰 `name` 以 `未收录术语` 开头的节点）。

**27 本全量对账（重导后）**：`books 27 mismatch 0`，逐本 `toc.json` 节点数 == DB 节点数，合计 **6025** 节点
（比 captain 基线 6062 少 37 —— 少的是 `spieler-2005` 被剔掉的索引假节点）。

**汉字占比分布（6025 节点，重出后）**：`< 0.20` **82** 条 · `< 0.30` **316** 条 · `== 0`（纯 ASCII）**17** 条。
（captain 给的基线是 6062 / 161 / 470 / 17；`<0.30` 从 470 降到 316 的主因是 170 条重译 + spieler 剔除。）

**82 条低占比逐条有理由**（清单落 `.scratch/t42/low_ratio2.tsv`，列 `sourceId / microKpId / name / ratio / nameOriginal`）：
1. **真短节标题（保留原样，约 40 条）**：`1.5.2 源`、`1.6.1.1.1 射线`、`2.3.2.2 与`、`6.1.2 光`、`5.6.1 限`、`16.8 室`、`2.3.3 结`、`14.7 与` ——
   原文标题只有一个实词，中文占比天然低，**按占比拦会把真节点判成缺陷**；
2. **化学式/器件缩写（17 条纯 ASCII + 若干带 1 个汉字）**：见上面白名单；
3. **`ahmed-2e` 尾部私用区/扩展 A 乱码（11 条 `name` 已清洗）**：`C.6 Lead tungstate 倀圀伀`、`7.1.G Noise and signal-to-noise ratio 匀⼀一`、
   `C.2 X-ray photoelectron spectroscopy 堀倀匀`、`A.1 Roentgen 刀` 等；`nameOriginal` 保留原始 OCR 串（D10 只看 `name`）；
4. **已修好的新译名（ratio 低但正确）**：`Wilkinson 型 ADC`(0.067)、`Bethe-Bloch 公式`(0.143)、`CRRC成形`(0.167)、`双斜 Wilkinson`(0.167)、`ADC性能`(0.167)。

**`content/glossary.json` 已重生成**：**2174 个中文术语 / 2384 条英文对照**（原 1965），`export_glossary.py --check` rc=0。
（新词条补进这份既有清单，没有另起一份。）

**守门测试 `tools/ingest/test_translate.py`（24 条，新建）**：
`_LEAD_NUMBER` 四类编号各一条 · 冠词剥离 · 冒号左侧纯数字不走冒号分支 · 中文原样返回 ·
`load_overrides()` 读到 11 条 · 11 条覆盖逐条参数化 · 词典优先于规则 · 全库 FORBIDDEN 扫描 ·
纯 ASCII 名 == 17 且逐条白名单 · `spieler-2005` 单字母节点归零。

**全仓验证**：`python -m pytest tools/ingest/ -q` → **352 passed**；
`python -m pytest tools/ingest/test_content_artifacts.py -q` → **8 passed**
（**顺带修掉了第 6 节记录的那条「不属于本票的红」**：`test_answer_key_flag_matches_the_rule_for_every_book`
的 `grupen-2e-2008` / `guojiang-2014` 两处不一致，根因正是这两个节点名当时还是 `未收录术语（…）` 形态，
重译后重新匹配 `is_answer_key_title()` 的规则，现已绿）。

**重导**：受影响 13 本全部重导（`apps/api` 下 `node_modules/.bin/tsx ./scripts/import-content.ts`），
`spieler-2005` 用 `--prune-kp`（会删 50 个索引假节点，其 24 条索引页 chunk 变无归属 —— 它们本来就是索引页文字）。

**边界（如实记录）**：`nameOriginal` 里仍保留 OCR 原始串（含私用区乱码、`ﬁ` 连字、`7°U` 这类噪声），
D10 只看 `name` 所以不阻塞；若将来要做「原文对照」的严格展示，需要再清洗一轮 `nameOriginal`。

### 8. 英文书答案附录识别：`is_answer_key` 从 5 到 8（t41，2026-10-22 03:35）

**起点**：`select count(*) from app.knowledge_points where is_answer_key` → **5**，全是中文书
（康华光 573 / 童诗白 609 / 李瀚荪上册 305 / 阎石 464 / 康华数字 530），**15 本英文书里 0 个**。
`tools/ingest/books_batch.py` 的书目是 **13 本英文 + 2 本中文**（`guojiang-2023` / `guojiang-2014` 走同一套书签解析），
所以「15 本」在代码里其实是「books_batch 的 15 条」。

**先判定再动手**：用 PyMuPDF 逐页扫 15 本的页首（四轮，探针脚本用完即删），
**只有 `grupen-2e-2008` 有整本答案附录**：

| 书 | 页数 | 命中 | 判定 |
|---|---|---|---|
| grupen-2e-2008 | 677 | PDF p558 `18 \| Solutions`，p559–585 是 `Chapter 1`–`Chapter 16` 逐章题解（`1.1 100 keV ≪mec2 …`） | **真答案附录**，印刷页 533 |
| knoll-4e-2010 | 866 | p13 `Solutions Manual` | **不是**：那是 Preface 里的教师资源说明（「The following resources are available to instructors: Solutions Manual」） |
| tsoulfanidis-4e | 595 | p153/161/164 `Answer` | **不是**：正文里「Answer」小节的解题示范（`Equation 4.12 will be used, but first dE/dx …`） |
| spieler-2005 | 506 | p471 `solution` | **不是**：正文句子 |
| 其余 9 本英文 | — | 0 命中 | 无答案附录（英文教材答案通常在教师手册里） |

中文两本各有 `习题参考答案`：`guojiang-2023` 印刷页 309、`guojiang-2014` 印刷页 231。

**两类根因，都不是「判据写错了」**

1. **`guojiang-2023` 的答案附录根本没进产物**。PDF 书签里有 `[2, '习题参考答案', 316]`，正文 PDF p315 页首就是
   `习题参考答案 / 第1 章 / 1. b=3.97×10–15m …`。但 `_parse_outline_levels` 有一条「最浅一层里不像章的都丢掉」的规则
   （`top = min(level)` 且 `_OUTLINE_CHAPTER_TITLE` 不匹配就丢），而 `习题参考答案` 既不匹配章号也不匹配「第 N 章」，
   于是被当成「书名与前言残渣」删掉，它的 5 页题解随后被相邻章按页区间吞成正文。
2. **`grupen-2e-2008` 的 `解答` 节点 `answerKey=true` 但 `appendix=false`**，而 `assign.leaf_page_ranges` 只让
   `n['isLeaf'] or n.get('appendix')` 当区间所有者 → p533–576 的 62 个 chunk 全挂在上一节 `kp-grupen-2e-2008-17` 名下。
   `answerKey` 与 `appendix` 是两个字段、两条写入路径（`_build_tree` 算前者，`fix_answer_key.py` 才补后者），重生成时后者会被重置。

**修法（三处代码 + 两个幂等补丁脚本）**

| 文件 | 改动 |
|---|---|
| `tools/ingest/toc_books.py` | 新增 `is_answer_appendix_title(name, name_original='')`：中文支走 `toc.is_answer_key_title` + `_cn_answer_key`，英文支走 `is_en_answer_key`，两边都认；`_parse_outline_levels` 对「顶层但被判成答案附录」的条目给**哨兵层级 0**，让它不进 `levels` 集合、按页序插回，`_assign_numbers_from_levels` 对 level 0 输出无编号 → `_build_tree` 的 `if not num` 分支把它挂成章下的一节 |
| `tools/ingest/fix_answer_key.py`（112 行，新） | 只改 `toc.json`：命中判据的节点置 `{answerKey: True, isLeaf: False, appendix: True}`。幂等。**重生成后必须再跑一次**（`books_batch.py` 会重置 `appendix`） |
| `tools/ingest/fix_chunk_owner.py`（约 150 行，新） | 只重跑 `assign.assign()` 并回写 `chunks.jsonl` + `manifest.json`，**不重解 PDF**。理由：`books_batch.py` 全量重跑会让 93689 这个幂等基线数变掉，且 `chunk.py` 当时正被别的泳道改。`--dry-run` 二次执行 0 改动（幂等成立） |

**逐本 `answerKey` / `appendix` 计数（重出后，`books_batch.BOOKS` 15 本）**

```
knoll-3e-2000    answerKey 0  appendix 2      ahmed-2e        0   20
knoll-4e-2010    0   2                        spieler-2005    0    0
tsoulfanidis-4e  0  56  ← 全是 Problems/References/Bibliography，每章末尾
grupen-2e-2008   1  39  ← 解答 p533           leo-2e          0    2
nakhostin-2018   0  11                        rivetti-2015    0   15
lutz-2007        0   8                        nicholson-1974  0    2
gilmore-2e-2008  0   0                        debertin-1988   0    0
guojiang-2023    1  17  ← 习题参考答案 p309   guojiang-2014   1   21  ← 习题参考答案 p231
```

`tsoulfanidis-4e` 的 56 个 `appendix=True` 而 `answerKey=False`，是「正常附录不被误标成答案」的最强证据 ——
它们要是被标成答案，检索门控会把每章末尾的习题清单当答案屏蔽掉。

**结果**

- `app.knowledge_points` 里 `is_answer_key` **5 → 8**，全 `is_leaf=false`：
  5 本中文书 + `kp-grupen-2e-2008-18 解答` p533 + `kp-guojiang-2014-20 习题参考答案` p231 + `kp-guojiang-2023-p308-习题参考答案` p309。
- **误标 0 行**：`where is_answer_key and name ~ '常数|符号|单位|能级|Index|Constant|Symbol|Unit'` → `0`。
- 答案节点直挂 chunk **603**（grupen 62 / guojiang-2014 6 / guojiang-2023 7 / 康华光 210 / 康华数字 22 / 李瀚荪 73 / 童诗白 94 / 阎石 129）。
- `content/*/toc.json`（27 本）扫描出的 `answerKey=true` **8 个**，与 DB 逐一一致。
- grupen p533–576 的 62 个 chunk：修复前「被答案子树覆盖」**0**，修复后 **62/62**。
- 重导：`content:import` 跑 `grupen-2e-2008` / `guojiang-2014` / `guojiang-2023` 三本（知识点 205 / chunk 1520 / 答案块 960 等逐本核对）。

**验证**：`python -m pytest tools/ingest/ -q` → **352 passed**（此前 6 条红全消，其中 `test_content_artifacts.py`
的两条正是 grupen / guojiang-2014 的 `answerKey` 与规则不一致）；`pnpm typecheck` → 6/6 Done；
`pnpm --filter @starmap/api test` → 31 files / 393 tests passed。

**边界（如实记录）**
1. 13 本英文书确认**没有**答案附录，正确答案是保持 0 —— 没有为了凑数硬标。`knoll-4e` 的 `Solutions Manual`
   是 Preface 里的教师资源说明，标了会让整本书被门控当成答案。
2. `tools/ingest/test_content_artifacts.py` 的 `test_the_answer_appendixes_are_flagged` 写成**子集断言**
   （5 个已知中文答案附录不能丢），不是 `==` —— 写成相等会让下一个人加书时被迫回来改清单。
3. `fix_answer_key.py` / `fix_chunk_owner.py` 目前**没有单测**，只有产物不变量测试
   （`test_answer_key_flag_matches_the_rule_for_every_book` 对 27 本逐本比对规则与产物）在守。
4. `content/grupen-2e-2008`、`guojiang-2014`、`guojiang-2023` 三个目录在 `git status` 里是 `??`（未被 git 跟踪），
   产物变更**无法用 git diff 取证**，只能靠 `.scratch/*.bak` 备份对比。

### 9. t40：英文书页偏移与孤儿 chunk 清零（t40，2026-10-22 05:55）

票面把根因写成「`toc_books.py` 的页偏移探测对这些书返回 0」。**实测不是**：三本书的偏移探测都成功
（grupen 25 / tsoulfanidis 31 / rivetti 25，标题回验 95%/100%/82%），负页码来自**抽取起点**。

#### 9.1 三个真实根因

| # | 位置 | 缺陷 | 后果 |
|---|---|---|---|
| A | `books_batch.py` `build_one()` | `start = min(BODY_START[sid], first_body)` —— `BODY_START` 本意是「正文起点下界」，被 `min` 变成了**上界** | 从目录页/前言页开始抽 → 负页码 + 孤儿 |
| B | `assign.py` `assign()` | 首个叶节点之前的页一律 `micro_kp_id=None`（这条规则本身是对的，封面/版权页不该有归属） | 章首页/章首概述/整版图页（**是正文**）变孤儿，在 `content.controller.ts` 的子树 JOIN 里对学生完全不可见 |
| C | `toc.py` `nodes_from_flat()` | `'appendix': bool(n.appendix and not n.children)` —— **有子节点就 False** | grupen 的 `Solutions`（有 5 个子条目）丢 `appendix`，p533–576 的 62 条解答正文被「术语表」吞掉 |

#### 9.2 修法（4 个文件，+195/−11）

- `books_batch.py`：删掉 `first_printed/first_body/start=min(...)`，改为逐页判据
  `if i - offsets.get(i, offset) < 1: skipped_front += 1; continue`（**印刷页 < 1 的页不产生 chunk**，
  这才是「前言/致谢/符号表用罗马页码」的正确表达）；`BODY_START` 三处校正
  （`knoll-4e-2010 30→29`、`ahmed-2e 22→8`、`guojiang-2023 8→9`）。
- `assign.py`：新增 **opt-in** 的 `assign_front_matter(chunks, flat_nodes) -> int`，把「印刷页 ≥ 0 且 < 首个叶节点页」
  的孤儿挂到 `printedPage` 最小的 `depth==1` **章容器**（不是叶节点，不污染 `audit_assignment` 的两个阈值）。
  **没有改 `assign()` 的默认行为** —— `test_assign.py::test_chunk_before_first_leaf_gets_no_kp` 钉住了「封面不硬塞」。
- `ocr_run.py`：`assign()` 后同样调 `assign_front_matter`（中文 OCR 书同样受益）。
- `toc_batch.py`：新增 `mark_answer_appendixes(nodes)`，对 `is_answer_appendix_title` 命中的节点
  置 `answerKey=True / isLeaf=False / appendix=True`，`main()` 与 `books_batch` 各调一次。

#### 9.3 修前 / 修后

| 指标 | 修前 | 修后 |
|---|---|---|
| `chunks_negpage`（`page < 0`） | **69** | **0** |
| `chunks_orphan`（`micro_kp_id IS NULL`） | **323** | **0** |
| book chunk 总数 | 96821 | 93597 |
| 27 本逐本覆盖率 | 12 本 <100% | **27 本全部 100.0%** |

逐本（total / orphan→0 / neg→0）：

| 书 | 修前 total | 修前 orphan | 修前 neg | 修后 total | 修后 orphan | 修后 neg | 覆盖率 |
|---|---|---|---|---|---|---|---|
| nuclear-radiation-measurement-tangbin | 6877 | 186 | 0 | 6877 | 0 | 0 | 100% |
| grupen-2e-2008 | 1520 | 33 | 28 | 1492 | 0 | 0 | 100% |
| rivetti-2015 | 1699 | 24 | 19 | 1678 | 0 | 0 | 100% |
| tsoulfanidis-4e | 1370 | 23 | 22 | 1347 | 0 | 0 | 100% |
| lutz-2007 | 901 | 14 | 0 | 895 | 0 | 0 | 100% |
| knoll-4e-2010 | 2774 | 11 | 0 | 2770 | 0 | 0 | 100% |
| circuit-analysis-lihansun-5e-vol1 | 3955 | 8 | 0 | 3955 | 0 | 0 | 100% |
| analog-electronics-kanghuaguang-5e | 7914 | 6 | 0 | 7911 | 0 | 0 | 100% |
| guojiang-2014 | 822 | 4 | 0 | 819 | 0 | 0 | 100% |
| guojiang-2023 | 1009 | 4 | 0 | 1008 | 0 | 0 | 100% |
| leo-2e | 959 | 3 | 0 | 959 | 0 | 0 | 100% |
| nakhostin-2018 | 1251 | 3 | 0 | 1248 | 0 | 0 | 100% |
| knoll-3e-2000 | 1694 | 2 | 0 | 1694 | 0 | 0 | 100% |
| debertin-1988 | 927 | 1 | 0 | 927 | 0 | 0 | 100% |
| spieler-2005 | 1270 | 1 | 0 | 1270 | 0 | 0 | 100% |
| 其余 12 本 | — | 0 | 0 | 不变 | 0 | 0 | 100% |

**前置页策略（选择与理由）**：不做「前置页归第一个叶节点」，也不 `clamp` 页码。
- 印刷页 < 1 的页（罗马页码的前言/致谢/符号表/图表清单）**直接不产生 chunk** —— 它们不是正文，
  生成 chunk 只会污染检索。丢弃页数：grupen 12、tsoulfanidis 13、rivetti 10、nakhostin 2、guojiang-2014 1。
- 印刷页 ≥ 1 但早于首个叶节点的页（章首页、章首概述、整版图页）**归 depth==1 章容器**。
  共 353 条，逐本：tangbin 186、jichangsong 77、yanshi 35、lutz 8、lihansun 8、tongshibai 7、knoll-4e 7、
  kanghuaguang 6、grupen 5、rivetti 3、leo 3、guojiang-2023 3、knoll-3e 2、spieler 1、debertin 1、guojiang-2014 1。
  抽查语义正确：lutz p3 → `引言`「The detection of nuclear charged particles…」；knoll-4e p2 → `辐射源`
  「Chapter1 Radiation Sources I. UNITS AND DEFINITIONS」；rivetti p1 → `前端指标与架构概述`；
  grupen p1 → `粒子与辐射带物质的相互作用`「1 Interactions of particles and radiation with matter」。
- **不是硬塞给叶节点**：章容器是目录里的真实节点（`import-content.ts` 里章节点 id === `depth==1` 的
  `microKpId`，是合法外键），它本来就代表「本章尚未细分的内容」。

#### 9.4 顺带修掉的两个回归（都是我重跑产物引入的，已回滚）

1. **grupen `Solutions` 丢 `appendix`**：重跑后 `answerKey=True` 但 `appendix=False`，
   `assign` 的所有者集合 `isLeaf or appendix` 里没有它 → p533–576 的 62 条解答正文全部被「术语表」(p512) 吞。
   修法见 9.2 的 `mark_answer_appendixes`。验证：`fix_answer_key.py --dry-run` 全 27 本「无需修改」；
   `pages 533-576 owners: {'kp-grupen-2e-2008-18': 62}`。
2. **重跑把 content-dev 新词典的塌缩译名写进 13 本 toc.json**：`translate.py` 在 04:29 被加入 +187 行单词级词条，
   使 `Critical Energy` / `Energy straggling` / `Energy reconstruction` / `Energy Dependence` / `Lineal energy`
   **全部译成「能量」**。已按 `nameOriginal` 逐节点从 `git show HEAD:` 恢复人工校对过的译名
   （ahmed 138 / grupen 9 / knoll-3e 11 / knoll-4e 14 / leo 52 / lutz 39 / nakhostin 4 / nicholson 25 /
   rivetti 44 / spieler 32 / tsoulfanidis 77）。
   恢复时发现 ahmed 有 **10 处按 id 错贴**（`BODY_START 22→8` 后 13-4..13-8 的节点编号位移），
   已用「当前代码重算的 `nameOriginal` 为真源」修正；另有 **11 处重算侧 OCR 乱码**
   （`(NaI:Tl)` → `一愀䤀㨀吀氀`、`χ²` → `윀㈀`），保留盘上干净值。修正后「真实 nameOriginal 不一致 = 0」。

#### 9.5 验证

- `python -m pytest tools/ingest/ -q` → **350 passed, 2 failed**
- `pnpm typecheck` → **6/6 Done**
- DB 复测：`negpage=0`、`orphan=0`、`book_chunks=93597`、27 本覆盖率 100%
- 重导入 16 本（13 本英文书 + tangbin + 康华光 + 李瀚孙），逐本 rc=0；`ahmed-2e` 加 `--prune-kp` 清掉 22 个
  stale 知识点（先逐个查过：chunk=0、edges=0、children 只指向集合内部）。

**两条红是别人的改动，不是 t40 引入的**（已用决定性实验归因）：

1. `test_export_glossary.py::test_common_words_that_are_ocr_residue_are_dropped` ——
   `能量`/`类型`/`方法` 本应因「缩减后仍 > `MAX_EN_PER_ZH=8`」被丢弃。现在它们的写法数从
   10/9/12 掉到 1/1/3（因为 `translate.py` 把它们全译成同一个中文词），反而**不再超上限**，于是被保留。
   **归因实验**：把 `translate.py` 换回 `git show HEAD:` 版、toc 保持当前工作区 → 三条仍然 KEPT
   （`能量 → ['Energy reconstruction']`、`类型 → ['MOSFET types']`、`方法 → ['Risetime Method', …]`）。
   即：**当前工作区的 toc 用 HEAD 词典跑也不绿**，红由 `translate.py` 的未提交改动决定，与 t40 无关。
   这是 t45「53 组译名塌缩」的同一根因，由 content-dev 处理。
2. `test_translate.py::test_title_rules_that_t42_added[A.4 The Laplace transform-未收录术语（Laplace transform）]` ——
   测试断言 `translate_title('A.4 The Laplace transform') == '未收录术语（Laplace transform）'`，
   但当前 `translate.py` 返回 `'变换'`（新加的 `laplace`/`transform` 词条）。
   **归因实验**：`git show HEAD:tools/ingest/translate.py` 跑同一函数 → 返回 `'未收录术语（Laplace transform）'`（测试期望值）。
   即测试与**已提交版**一致，是 `translate.py` 的未提交改动让它红。

**边界与如实记录**
1. tangbin 的 `min(page)=0` 没消除：OCR 把 pdf 11–14（第一章首页 + 两页整版图）的页码识别成 0（`resolve_page_offsets`
   的 `offsets[p]=min(off,p)` 夹紧所致，真实印刷页是 1/2/3/4）。修它要动 `toc.py`/OCR 页码判据（本票禁止 / 超范围），
   186 条已全部挂到 `kp-tangbin-1` 章容器，对学习者可见且语义正确。
   另外 `toc.py` 把 `1.1 原子与原子核` 的页码配成了 `1.2` 的 9（目录里 1.1 无页码），是同一个 OCR 页码缺陷的另一面。
2. `ahmed-2e` 的 toc 从 637 节点变 626（−22 +11）：10 个 `Bibliography` 节点消失是 `toc_books.py` 的
   `_OUTLINE_DROP_SUBTREE` 既有规则（HEAD 与工作区**都**含 `'bibliography'`，HEAD 里那 10 个是更早规则留下的陈旧产物）；
   其余是 `Appendix A/B/C` 的子条目浮上来变成 `13.4`–`13.8`。**不是 `BODY_START 22→8` 造成的**：
   `python tools/ingest/toc_batch.py --only ahmed-2e`（完全不读 `BODY_START`）产出的 id 集合与 `books_batch` 完全一致。
3. `grupen-2e-2008` 与 `ahmed-2e` 的 `toc.json` HEAD 版是 LF、重出后是 CRLF，`git diff` 会显示整文件重写；
   已按 HEAD 的行尾写回，`git diff --ignore-cr-at-eol --numstat` 现在只剩真实内容改动。
4. 丢弃的 38 页前置页（9.3）没有任何 chunk 代表 —— 这是刻意的：它们是罗马页码的前言/致谢/符号表，
   不是可学习的知识点。若将来要做「前言可检索」，应作为独立 `kind` 入库，而不是塞进章节归属。
