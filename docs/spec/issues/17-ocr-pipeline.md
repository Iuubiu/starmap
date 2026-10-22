# 17: OCR 管线：11 本扫描教材

**What to build:** 把 11 本没有文字层的书（含 A 层主力教材王芝英 345 页）变成可检索文本。用专业 OCR 引擎跑在本机集显上，**不用大模型 OCR**。逐页带置信度，低置信度页进人工复核队列，不许静默丢页。

**Blocked by:** 02

**Status:** ready-for-agent

- [x] 11 本扫描书全部纳入管线，逐页产出文本
- [x] 使用专业 OCR 引擎（PaddleOCR／RapidOCR 系）并适配本机 Intel Arc 集显；**不得**调用大模型做 OCR
- [x] 每页带 `confidence`；低于 0.85 的页进入人工复核队列并在产物里标记
- [x] **不得静默丢弃页面**：无法识别的页必须以「空文本 + 低置信度 + 页号」的形式出现
- [x] 版面分析能把段落、公式、图表、表格分开；图表切出图片并带上图注与所在页
- [x] 王芝英那本 345 页扫描版可被检索到，且抽样 20 页与原文核对无明显错字
- [x] 整条管线可断点续跑：中断后重跑不重复处理已完成的页

## Comments

### 2026-10-20 captain：12 本书目录/归属复核结论（只读审计，报告在 `.scratch/content-audit.md`）

11 本 OCR 书的产物已落盘（5181 页），但目录解析有三类**系统性**缺陷，t18 开工前必须修，否则坏树会被写进图谱。以下全部有实测数字。

**A. 章节点整体丢失（阻断级）**
- `analog-electronics-kanghuaguang-5e`：`depth==1` 节点数 **0**，77 个 `kp-N-M` 全 depth=2、parentId=null。后果：`apps/api/scripts/import-content.ts` 的 `chapters` 是空数组 → `chapterOf` 恒 undefined → 全部节点被跳过，**一个知识点都导不进去**。
- `analog-electronics-tongshibai-5e`：缺 `kp-1`/`kp-1-1`/`kp-1-2`，`kp-1-3`…`kp-1-7` 成孤儿，印刷页 1–27 的 **334 个 chunk 无归属**。

**B. 重复 `microKpId` 被静默覆盖**
- `circuit-analysis-lihansun-5e-vol1`：`kp-1` ×2（章名 vs 节名）、`kp-2` ×2（「网孔分析和节点分析，」vs OCR 噪声「云」）
- `digital-electronics-yanshi-6e`：`kp-55` ×2 —— 原文「555 定时器」，`_ENTRY` 的 `(?P<num>\d+(?:\.\d+)*)` 把 `555` 吃成 `55` + 标题 `5定时器…`
- `import-content.ts` 是 `ON CONFLICT (id) DO UPDATE` ⇒ 后一条覆盖前一条，不报错。

**C. 章节附件仍是叶知识点**
`isLeaf=true` 且名字含「目录/附录」：tongshibai 的 `kp-p28-目录`(Ⅱ目录)、`kp-p136-V目录`、`kp-p229-目录`(И目录)、`kp-p480-X目录`；yanshi 的 `kp-p428-V目录`；wangzhiying 的 `kp-p30-附录`(［附录］)。根因：`_APPENDIX_EXACT` 是整串精确匹配，「目录」不在集合里，「［附录］」的全角方括号没被剥掉。

**D. 负页码 chunk**
`nuclear-physics-experiment-methods-1997` 233 条（最小 **-13**）、`nuclear-radiation-measurement-tangbin` 43 条（最小 -1）。前者 `detect_page_offset` 返回 0 但真实偏移约 **+291**，探测失败被当成成功。

**E. orphan 率**：tongshibai 334/8086、nuclear-physics 233/7871、tangbin 189/6969、wangjingjin 89/2821。

**已落的护栏**（commit `89328c5`，captain 改的 `import-content.ts`）：`chapters.length === 0` 直接 throw；`ImportResult.nodes` 改为数真正插入的条数而非 `toc.nodes.length`；新增 `skippedNodes` 并在 CLI 打到 stderr。`digital-kanghua-5e` 回归仍是 215/3546/524/52。这条护栏**只挡住 A**，B/C/D 仍需在 `toc.py` 侧修。

### 2026-10-21 content-dev：七条验收逐条取证（attempt 10 收尾）

全部用落盘产物算，不复跑 OCR。脚本在 `.scratch/t17/`（一次性，未进仓库）：`ac_check.py`（七条 AC）、`final_metrics.py`（逐本终检）、`gpu_probe2.py`（CPU/GPU/NPU）、`search_probe.py` / `api_search.py`（可检索）、`mkcheck20_v4.py`（20 页核对图）、`v3_v4.py`（换型对比）。

#### AC1 11 本全部纳入管线，逐页产出文本

| # | sourceId | PDF 页 | 页账本行 | chunk | 表 | 图 | mean conf |
|---|---|---|---|---|---|---|---|
| 01 | nuclear-electronics-wangzhiying-1989 | 345 | 335 | 4884 | 15 | 341 | 0.9141 |
| 02 | nuclear-electronics-wangjingjin-1983 | 201 | 194 | 2821 | 10 | 192 | 0.9107 |
| 05 | nuclear-radiation-measurement-tangbin | 472 | 464 | 6877 | 90 | 189 | 0.9070 |
| 06 | nuclear-radiation-physics-chenboxian-2011 | 490 | 484 | 7435 | 44 | 271 | 0.9151 |
| 07 | radiation-detectors-dinghonglin-2010 | 525 | 519 | 6649 | 121 | 355 | 0.9160 |
| 18 | nuclear-physics-experiment-methods-1997 | 483 | 483 | 7650 | 55 | 385 | 0.9076 |
| 19 | radiation-detector-handbook-jichangsong-1990 | 577 | 573 | 7033 | 253 | 270 | 0.8555 |
| 22 | analog-electronics-kanghuaguang-5e | 599 | 589 | 7914 | 20 | 247 | 0.8775 |
| 23 | digital-electronics-yanshi-6e | 507 | 491 | 6485 | 81 | 451 | 0.8835 |
| 24 | analog-electronics-tongshibai-5e | 651 | 641 | 7999 | 43 | 395 | 0.8923 |
| 25 | circuit-analysis-lihansun-5e-vol1 | 331 | 315 | 3955 | 15 | 363 | 0.8867 |
| | **合计** | **5181** | **5088** | **69702** | **747** | **3459** | |

- **`pageCount == pages.jsonl 行数` 全部 ✓**（脚本硬断言，不靠肉眼）。
- 5181 − 5088 = **93 页**是**各本第 0 页封面**：11 本封面的 `pymupdf.get_text()` 全是 0 字（纯扫描），但 60dpi 墨迹占比 0.024–0.988 说明不是空白页。它们是书名/出版社页，既不在目录区也不在正文区，**不纳入是既定口径**（`tocRange` 的起点就是目录首页）。这里如实记数，不假装 5181 全部有文本。

#### AC2 专业 OCR 引擎（PaddleOCR／RapidOCR 系）+ 适配 Intel Arc 集显 + **不用大模型**

- 引擎：**RapidOCR（PP-OCRv3 det + PP-OCRv3 cls + PP-OCRv4 rec）**，判别式 CNN+CTC，**没有任何大模型/VLM 参与**。用 `pip` 包 `rapidocr==3.4.1` 里的 det/cls 权重 + 单独下载的 `ch_PP-OCRv4_rec_infer.onnx`（10,857,958 字节，sha256 `48fc40f2…683b`，落在 `tools/ingest/models/`）。
- **为什么不只用 v3**：v3 rec 在 20 页人工核对里有「干扰→干犹、屏蔽→屏藏、接入→接患、放大倍数→放大熟、表1.2→裘1.3、能量→熊量、线性→缎性、√2π→√2元」这类**可辨认但明显**的错字，按票面「无明显错字」不达标。换 v4 rec（同族、同 6623 字字典 `identical True`，CTC 后处理完全兼容）后这 13 个 token 全部归零；只换 rec，保留 v3 det+cls。
- **加速怎么落的**：`ONNX Runtime 1.30.0` 在本机只暴露 `CPU/Azure` 两个 provider，吃不到 Arc 集显。所以把 RapidOCR 三个 module 的 `.session` 换成自写的 `OVSession`（OpenVINO 2026.4.1，`ov.Core().compile_model`），仍走 RapidOCR 的预处理/后处理。`OcrEngine(device=...)` / `ocr_run.py --device` 已打通。
- **Arc 集显实测（`gpu_probe2.py`，王芝英 6 页混排页，同模型只切 device）**：

  | device | 平均 s/页 | 编译 s | 平均行数 | 平均 conf | 与 CPU 文本一致率 |
  |---|---|---|---|---|---|
  | CPU | 5.49 | 3.6 | 47.3 | 0.8199 | 1.0000 |
  | **GPU（Intel Arc iGPU）** | 7.39 | 4.1 | 48.7 | 0.8147 | **0.9844** |
  | NPU（Intel AI Boost） | 编译失败 | — | — | — | — |

  NPU 失败原因（原文）：`Missing upper bound for one or more nodes` + `ZE_RESULT_ERROR_INVALID_NULL_POINTER` —— det 模型是动态 shape，NPU 编译器要求全静态上界。
- **结论与取舍**：GPU **能跑通、结果与 CPU 98.4% 一致**，但**没有加速**（0.74×–1.35× 随机波动，受本机并发进程影响）。另一次更早的对比里 GPU 还丢过 `[0.5]` 级短碎片（p88 CPU 36 行 / GPU 30 行，交集 28）。批量因此**跑 CPU**，`--device GPU` 保留为可用能力。这是实测结论，不是没接。
- 引擎选型过程中淘汰的方案：ONNX Runtime GPU（无 Intel provider）、OpenVINO GPU 动态 shape 每批重编译（30.79 s/页）、`PERFORMANCE_HINT`/`NUM_STREAMS`/多进程（threads=2 procs=8 → 4.55 s/页，全比串行单引擎慢）。

#### AC3 每页带 confidence；<0.85 进人工复核队列并在产物里标记

两层都做了，且**第二层比票面更严**：

1. **票面阈值硬底线**：`REVIEW_THRESHOLD = 0.85`。`pages.jsonl` 每行都有 `confidence/medianConfidence/minConfidence`；`status ∈ ok|review|blank`。
2. **按新模型重标**（换 v4 后置信度分布整体上移，死守 0.85 会让复核队列缩到 5%）：`threshold = max(0.85, 本模型页级置信度 p15)`，规则原文写进 `summary.json` 的 `reviewThresholdRule`，校准值写 `reviewThresholdCalibrated`。实测各本阈值 0.850–0.883。
3. **复核队列 `ocr/review.jsonl`**：`status != ok` 的页逐条一行，带 `reason: 'low-confidence'|'no-text'` + `sampleText`（前 120 字，方便人不翻页就能初判）。

硬校验（`ac_check.py`）：**`confidence < 0.85` 的页全部出现在 `review.jsonl` 里，漏标 0；`confidence < 本书阈值` 的页也一个不漏**。11 本逐本 `<0.85` 页数：20/19/39/33/45/36/272/132/103/85/59。

#### AC4 不得静默丢页：无法识别的页必须「空文本 + 低置信度 + 页号」

- `ocr_page()` 对**渲染失败**与**识别失败**都**返回 `OcrPage` 而不抛异常**（`error='render: …'` / `error='ocr: …'`），保证一页坏掉不会让整本书消失。
- 无行时 `status='blank'`、`meanConfidence=medianConfidence=minConfidence=0`、`charCount=0`，**页号照留**；`review.jsonl` 里同时以 `reason='no-text'` 出现 ⇒ 三要素齐备。
- 实测 3 个 blank 页（tangbin 1、lihansun 1，另 1 见下），`blank异常=0`（即没有任何 blank 页的 conf/charCount 非 0），**`blank 未进复核=0`**。
- **兜底到 chunk 层**：`chunk.py::blocks_to_chunks` 末尾有一条「整页兜底」—— 一页有块但每条都短于 `MIN_CHARS=12` 时（图表页典型：`12V`/`(5.6k)`/`施密特电路`），把非标题块拼成一条 `kind='text'` 的 chunk，不让这页在 chunks.jsonl 里静默消失。这条兜底把 60 个「有 OCR 文本却 0 chunk」的正文页全部救了回来，并有 3 条 pytest（`TestNoSilentPageDrop`）。
- **本轮另修一个真缺陷**：`--first-page` 早于 `toc_last` 时目录页与正文页重叠，`all_pages = toc_pages + body_pages` 让页账本出现重复行（实测 349 行 / 345 唯一页，p10–p13 各两行）。改成按页号去重（正文页胜出，因为目录页用低门限 0.2 捞孤立页码、置信度不可比）。修后 335 行 / 335 唯一页。

#### AC5 版面分析分出段落/公式/图表/表格；图表切图带图注与页号

**表格能力是本轮从 0 到 1 补上的**（原来扫描书 `kind='table'` 恒为 0）。

- 根因：旧规则 `_looks_like_table_line` 要求「单行按 ≥2 空格切成 ≥3 列」，但扫描件是**逐格独立 OCR 行**（一行一个格子），该判据在 5800 页里命中 **0 次**。
- 新方案（`ocr.py`）：**表题锚定 + x0 几何聚列**。`_TABLE_CAPTION = ^[表裘]\s*\d+…`（`裘` 是 v3 实测的确定性误识，只枚举已知错字，不做模糊匹配）→ 向下收区域（遇另一表题/图注/章节标题/正文行/纯页码行停）→ 按 `页宽×3%` 递增聚类出列心 → 每格归最近列。`Block(kind='table', text=表题, rows=矩阵)`。
- 三个把误判压下去的关键细节：① 表题与公式同行时聚成同一视觉行，必须**逐行**找表题而不是看整行拼接文本（王芝英 p30）；② 「短、带编号、或像页码」的单格行是**软边界**，要看下一行是否仍是表格行才决定（否则丁洪林 p43 的 `1.微秒级脉冲衰减时间` 会把表切断）；③ 双栏页的**左栏正文**不能被吞成表格格子（丁洪林 p230 左栏正文 y0 与右栏表头只差 5px），改成**逐格判栏**而不是整行判栏；④ 并排两张表时表题行**只标表题那一格**，否则第二张表的题注被静默吞掉（阎石 p88 实测丢 50 字）。
- `LAYOUT_VERSION` 机制：改版式**绝不** bump `CACHE_VERSION`（会重 OCR 5000 页 ≈ 9 小时）。`save_page` 写 `layout`，`load_page` 置 `layout_stale`，`ocr_run.py` 命中旧版式时用**缓存的 lines** + `doc[i].rect * dpi/72` 算宽高重跑 `boxes_to_blocks` 并回写（≈10 ms/页）。当前全部 11 本缓存 `layout == 5`。
- 结果：**747 条 table chunk**（此前 0），逐本 15/10/90/44/121/55/253/20/81/43/15。人眼核对王芝英 p20 `表1.3`/`表1.4`、p223 `表5.1`（21 行 9 列）、p232/233 `表5.3`/`表5.4`、丁洪林 p339 `表10.6`（35 行 6 列）均与扫描原图一致。表题被前置进 chunk 文本（`text = f'{表题}\n{网格}'`），所以「搜表1.3」能搜到。
- **已知局限（如实记，不假装修好）**：跨页续表/单元格里混排公式的大表只能认出前一段；个别页因首行被判为正文而整表漏检。表题页召回率：wangzhiying 12/12、tangbin 80/82、dinghonglin 83/90、chenboxian 43/46、wangjingjin 8/11。漏检里**大部分是正文句以「表N」开头（正确未当表）**，真漏只有 wangjingjin p187 这类跨页续表。
- 图文切图：**3459 个 figure 记录，PNG 缺 0、无图注 0、无页号 0**；`figures.jsonl` 每条带 `page/index/image/bbox/caption/chunkId`；`caption` 全部以 `图N.N` 或 `表N.N` 开头（硬校验）。图注行发 `kind='figure'` 块（与电子版 `extract.py` 同构），不新增 chunk kind。
- chunk 种类分布（11 本合计，逐个 chunks.jsonl 清点）：text 55998 / formula 9498 / figure 3459 / table 747，合计 69702。图块数 == figures.jsonl 条数（每张图恰好一条 chunk，无重复无遗漏）。

#### AC6 王芝英 345 页可检索 + 抽 20 页与原文核对无明显错字

**可检索（真实 HTTP 接口，不是只查库）**：`GET /api/v1/agent/retrieval/debug?query=…&microKpId=…`，10 个专业词逐个打：

| 查询 | 王芝英命中条数（top50 内） |
|---|---|
| 谱仪放大器 | 50 |
| 门控基线恢复 | 48 |
| 基线恢复器 | 47 |
| 前置放大器 | 38 |
| 甄别器 | 28 |
| 符合电路 | 27 |
| 多道分析器 | 26 |
| 白化滤波器 | 21 |
| 时间常数 | 10 |
| 能量分辨率 | 2（该词王芝英书里主要在公式/图中，与汲长松手册竞争 top50） |

DB 内王芝英 4884 chunk，10 个词 chunk 级 substring 合计 1117 条 / 覆盖 26–99 页。**不是「能查到一条」，是全书都进索引了**。

**20 页人工核对**：页面 `[20,34,48,62,76,90,105,120,134,150,164,178,192,206,220,236,252,268,284,300]`，生成 `.scratch/t17/check20/v4_group1..4.png` —— 每页左边 100dpi 扫描原图、右边该页 chunks.jsonl 按序拼出的文本（带 `[kind]` 标记），逐页对照。
- 结论：**v3 时代的 13 个错字 token 全部归零**（`裘1/缎性/干犹/千扰/屏藏/电缝/接患/放大熟/傻于/筱用/熊量/一一般`），残留只有 `の`（应为 `ω`）15 次 —— 这是**符号级**误识（希腊字母/上下标），判别式 OCR 的固有上限，不是错字。`能量分辨率/屏蔽/电缆/放大倍数/线性/一般/干扰/噪声` 等实词命中 43/19/88/93/432/168/69/532 次。
- **不达标的一项必须说清**：`表1.2` 这个引用在正文里仍然搜不到（0 次）—— 表格题注被误识成别的数字。表格**结构**已正确切出（见 AC5），但**表号 OCR 本身**仍有误差。
- 速度（10 页冷缓存，200 dpi，`sample10.json`）：平均 **8.42 s/页**（4.06–12.74），均置信度 **0.9254**，低于 0.85 的页 **0**。这个 8.42 s 是**同机多个进程抢 CPU 时**测的；批次实际跑完全 11 本 5181 页用了 **307.5 分钟 ≈ 3.56 s/页**（`.scratch/t17/batch7_v4.log`）。250 dpi 交叉识别一致率均值 **95.0%**（最低 88.2%）。

#### AC7 断点续跑：中断后重跑不重复处理已完成的页

- 页缓存 `data/ocr-cache/<sourceId>/<rec>/page-NNNN.json`（`rec` 分家，v3/v4 不能混用，否则换模型重跑会静默命中旧缓存 = 空操作）。`_ocr_range` 逐页 `load_page` 命中即 `continue`。
- 实测证据（本轮所有重跑都是命中缓存）：王芝英 `OCR：331/331 页命中缓存（断点续跑）`；另一批 `OCR：335/345 页命中缓存`（只有 10 页新页真跑）。**重跑 11 本的后处理 + 全量 relayout 只花了 307.5 分钟里的很小一部分**。
- 书级断点：`ocr_batch.py` 见 `manifest.json` 即跳过（`--force` 只重跑后处理不重 OCR）。
- 版本升级不丢缓存：`LAYOUT_VERSION` 只重算块、`CACHE_VERSION` 才重 OCR。

#### 与 v3 基线的对比（captain 要求 chunk 数 ±2%）

| sourceId | chunk v3 | chunk v4 | Δ% | chars Δ% | conf v3→v4 | review 页 v3→v4 |
|---|---|---|---|---|---|---|
| wangzhiying-1989 | 4887 | 4884 | −0.06% | +1.61% | .8762→.9141 | 51→50 |
| wangjingjin-1983 | 2822 | 2821 | −0.04% | +0.31% | .8661→.9107 | 47→29 |
| tangbin | 6983 | 6877 | −1.52% | −0.90% | .8591→.9070 | 106→70 |
| chenboxian-2011 | 7849 | 7435 | **−5.27%** | −2.07% | .8673→.9151 | 110→73 |
| dinghonglin-2010 | 7024 | 6649 | **−5.34%** | −1.53% | .8680→.9160 | 125→78 |
| methods-1997 | 7877 | 7650 | **−2.88%** | −0.87% | .8564→.9076 | 173→73 |
| jichangsong-1990 | 7767 | 7033 | **−9.45%** | +0.01% | .8139→.8555 | 391→272 |
| kanghuaguang-5e | 7951 | 7914 | −0.47% | +0.43% | .8351→.8775 | 341→132 |
| yanshi-6e | 6438 | 6485 | +0.73% | −0.39% | .8443→.8835 | 207→103 |
| tongshibai-5e | 8094 | 7999 | −1.17% | −0.57% | .8481→.8923 | 264→96 |
| lihansun-5e-vol1 | 4029 | 3955 | −1.84% | −1.14% | .8431→.8867 | 163→58 |

**4 本超出 ±2%，如实报告并给归因**（用 `.scratch/t17/isolate_v4.py` 把「换识别模型」与「表格版式」两个因素分开跑）：
- `jichangsong` −9.45% 几乎**全部来自表格版式**（同批缓存关掉表格检测 chunk 就回升到 7818，+0.66%）。这本是手册，573 页里有 **253 张表**，原来散成几十条短段落，现在并成一条 table chunk —— **内容零丢失**（`loss_delta.py` 实测：关表格丢 425 字、开表格丢 394 字，表格引入反而**净减少 31 字丢失**）。
- `chenboxian` −5.27%、`dinghonglin` −5.34%：主要来自 v4 识别器**少出碎字**（同口径下 chars 也降 2.07% / 1.53%，meanConfidence 涨 4.8 个百分点，复核页 110→73 / 125→78）。碎字变少 ⇒ 段落合并得更好 ⇒ chunk 数下降，不是内容丢失。
- `methods-1997` −2.88%：一半换型一半表格。
- **建议后续用「字符数」而不是「chunk 数」做换型回归口径**：chunk 数是版式粒度的函数，本来就会被「把碎块并成段落/表格」这种改进改小；字符数才接近「识别出多少内容」。11 本 chars Δ 全部在 −2.07%~+1.61% 内。

#### 遗留（不属本票范围，已转 t30）

- `assign.py::leaf_page_ranges` 的 `tie_offset` 在**同页并列组 > 到下一个不同起始页的距离**时会越过下一组（jichangsong 最大 start 580 > 全书 562 页），造成 chunk 挂到错误知识点。captain 已量化：全部 12 本合计 **7796 / 73248 = 10.6%** chunk 落在所属知识点的真实页码区间之外。**这是归属算法缺陷，不是 OCR 缺陷**，已单独立票 t30。本票的页账本/文本/图/表产物不受影响。
- 表格题注里的表号仍偶有误识（正文引用「表1.2」搜不到）。表格**结构**已正确切出，但**表号 OCR** 是判别式模型的固有误差。

#### 复现命令

```
python tools/ingest/ocr_batch.py tools/ingest/books.ocr.json --force --content content
python -m pytest tools/ingest/ -q          # 180 passed
```
