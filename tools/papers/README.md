# tools/papers —— 101 篇论文零 OCR 入图

把 `资源库/papers/` 下的 101 篇 PDF 论文变成可检索的图谱节点：

```
资源库/papers/*.pdf + README.md + .doi_index.json
        │
        ├─ parse_readme()        101 行表格 → PaperRow（DOI / 年 / 被引 / 标题 / 期刊 / 文件名 / 主题）
        ├─ cross_check_doi_index()  与 .doi_index.json 交叉校验 DOI 集合（101/101 相等才继续）
        │
        ├─ 读 PDF 文字层（零 OCR）  pypdf 抽每页文本
        │     ├─ extract_sections()     PDF outline 优先；无 outline 时用行模式 `^\d+(\.\d+)*\.?\s+[A-Z]`
        │     ├─ _is_plausible_section_name() / _is_paper_title()   过滤图注、作者列表、正文残句
        │     └─ assign_pages_to_leaves()   一页可归多个叶（论文排版密，一对一会让 348 个叶分不到页）
        │
        ├─ 译名（D10 红线）
        │     ├─ translate_name()            论文标题：101 条人工译名 + 归一化匹配 + 前缀匹配
        │     └─ translate_section_name()    章节名：规则翻译 → 短语降级 → 「原文见摘要」
        │
        └─ write_db()            sources / modules / knowledge_points / chunks 四张表
```

产物：`content/papers/index.json`（101 条，`title` 中文 + `titleOriginal` 英文）。

## 用法

```bash
# 只解析、不写库，打印统计
python -X utf8 tools/papers/ingest_papers.py --dry-run

# 只重出 content/papers/index.json
python -X utf8 tools/papers/ingest_papers.py --index-only

# 真写库（默认连 postgres://postgres:postgres@127.0.0.1:5432/starmap）
python -X utf8 tools/papers/ingest_papers.py --database-url "postgres://..."

# 测试
python -m pytest tools/papers/ -q
```

写库是**幂等**的：每次先按 `source_id LIKE 'paper-%'` 清掉旧的 chunk 再重写，关卡与作答记录不受影响
（`video_clips.micro_kp_id` 与 `chunks.micro_kp_id` 是 `ON DELETE SET NULL`，`knowledge_points` 用的是
UPSERT 而非 DELETE —— 见下面「为什么不敢 DELETE 知识点」）。

## 为什么按 DOI 对齐，而不是按文件名

`.doi_index.json` 的 `file` 字段是**不可信**的：它是从 Windows 机器上抓下来的绝对路径，
且中文文件名经过一次 GBK↔UTF-8 误解码，实测 101 条里没有一条能直接对上磁盘上的文件名：

```
"10.1016/S0168-9002(96)01172-2": "D:\\DeepSeek\\资源下载\\papers\\Sauli1997_Gem.pdf"   ← 目录都不对
```

而 **DOI 集合是可信的**：`.doi_index.json` 的 101 个键与 `README.md` 表格的 101 个 DOI 完全相等
（`cross_check_doi_index()` 会硬校验这一点，不相等直接退出）。所以整条流水线以 DOI 为主键：

- `source_id = paper-<slug_doi>`，例如 `10.1016/s0168-9002(96)01172-2` → `paper-10-1016-s0168-9002-96-01172-2`
- 文件名只用来**读 PDF**（README 的 `文件` 列是可信的，因为它就在表格里）
- 两者对不上时按 DOI 找文件（用 `_norm_for_match` 在 `资源库/papers/` 里做模糊匹配）

## 为什么不做 chunk 切分

`tools/ingest/`（15 本书）按段落切 chunk，因为书有章节结构、段落边界清晰。
论文不一样：**双栏排版 + 公式 + 脚注 + 图表标题混排**，按段落切会把一个公式切成三段、
把图注粘进正文。本票只做「一页一行 chunk」：

- `chunk.id = <sourceId>-p0001`（多叶共享同一页时，第 2、3 个叶加 `-k2`/`-k3` 后缀）
- `chunk.text` = 该页全文（已 `sanitize_pdf_text`）
- `chunk.meta` = `{pdfPage, sectionId, sharedPage?}`

代价：单页可能有 3000+ 字，检索粒度粗。收益：**不会切坏公式**，且 `sectionId` 指向的叶节点
仍然精确（一页归多个叶时每个叶都有一条 chunk 副本）。要做细粒度检索的话，正确做法是在
chunk 之上做句级索引，而不是把这一层改回段落切分。

## 为什么不敢 DELETE 知识点

指向 `app.knowledge_points` 的 `ON DELETE CASCADE` 有 **11 条**（实测 `pg_constraint`）：

```
attempts.micro_kp_id          mastery.micro_kp_id         levels.micro_kp_id
kp_edges.from_id / .to_id    knowledge_points.parent_id  level_generation_task.micro_kp_id
node_unlocks.*                probe_sessions.micro_kp_id  review_round_items.*   learning_log.micro_kp_id
```

也就是说 `DELETE FROM knowledge_points WHERE source_id LIKE 'paper-%'` 会**连带删掉学习者的作答记录、
掌握度、解锁状态**。所以 `write_db()` 只做 UPSERT（`ON CONFLICT (id) DO UPDATE`），
只有 `chunks` 是「先删后插」（它没有下游依赖，且 `chunks.micro_kp_id` 是 `SET NULL`）。

清理孤儿节点用的是**定向 DELETE**：只删「`source_id LIKE 'paper-%'` 且 id 不在本次生成集合里」的行
（即上一次运行留下的、这次已经不再产生的节点）。这个 DELETE 仍然受 CASCADE 影响，所以执行前
`check_no_references()` 会拿差集再跑一遍 —— **只要有一个孤儿被 attempts / mastery / levels /
node_unlocks / kp_edges / video_clips / chunk_kp_answer 任何一张表引用，整批放弃清理并打印警告**
（宁可留几个死点，也不级联删掉别人的作答记录）。

## 已知缺陷（如实记录）

### 1. 少数「章节名」其实是正文残句

`_is_plausible_section_name()` 有 7 条判据（长度 3–90 / 2–14 词 / 不以句号逗号分号结尾 / 有字母 /
不含黑名单词 / 不含邮箱 / 首字母大写占比 ≥0.5），但它拦不住所有情况。初版实测残留：

```
MEV在MEV质子束流      ← 原文 "MeV at Ep ~ 1.9 MeV. The proton beam"
MEV在                 ← 原文 "MeV at Ed ="
```

后来加了 `_is_measurement_fragment()`（数值 + 单位）与 `_is_running_text_fragment()`（句中句号 /
参考文献条目）两道，这类残句从名字里消失了（现在只在降级命名的 `summary` 原文里看得到）。
仍有极少数 PDF outline 会把正文行当章节标题，这是**数据源的缺陷，不是解析器的**——
那些页确实有内容，硬丢掉会让它变成不可检索的死页。

实测七轮收紧的累计效果（叶节点数 / 降级命名数）：

| 轮次 | 改了什么 | 叶节点 | 降级命名 |
| --- | --- | --- | --- |
| 初版 | — | 1089 | 77 |
| 二 | 加 `_is_measurement_fragment` | 1089 | 77 |
| 三 | 加 `_is_running_text_fragment` | 1059 | 45 |
| 四 | 参考文献缩写链（`W. S. Means and E. R. Harold, …`） | 1054 | 44 |
| 五 | PDF small-caps 伪影（`I NTRODUCTION` → `INTRODUCTION`） | 1054 | 32 |
| 六 | 通用词表（`paper_glossary_common` / `_generic`） | 1054 | 27 |
| 七 | 放宽名字判据（允许「拉丁缩写 + 1 汉字」） | 1054 | 24 |

### 2. 24 条章节名走降级命名

实测当前 24 条，全部是**真噪声**（不是翻译失败）：参考文献条目（`Roney JM, Thompson CJ:
Detector`）、PDF 版面碎片（`I 8.1 1 3.9f0.7 1 lOXlOxl0 R1306`）、单位与量程（`MeV - 1 GeV`、
`FWH M`）、缩写（`RICH 1`、`CVJ`、`PCI block`）、作者名（`Jian Song, Qi An, and Shubin Liu`）。
拿这 24 条逐条对照过：没有一个能靠补词表救回来。

规则翻译覆盖不了 PDF 噪声（`I 8.1 1 3.9f0.7 1 lOXlOxl0 R1306`、`Dept. Elect. Eng. Comput., Ph.D.
dissertation`、`November 2024`）。这些走三级降级：

```
第 N 节 · <第一个能译出的词>      （有可译词时）
第 N 节 · 原文见摘要              （一个词都译不出）
```

降级命名**不丢信息**：英文原名始终在 `knowledge_points.summary` 的「原文：」后面。

### 3. 7 条标题补全失败

`complete_title()` 从 PDF 首页补全 README 里被 `...` 截断的 22 条标题，成功 15 条、失败 7 条
（`Dorenbos1995_Non` / `Pivk2005_Lot` / `Anghinolfi2004_Nino` / `Arnold2014_Mantid` /
`Bar1995_Penelope` / `Radford1995_Escl` / `Balian1977_Figure` / `Cecil1979_Improved` 中的 7 条）。
这 7 条走 `TRUNCATED_TITLES` 里的人工译名（前缀匹配），所以最终标题**仍然是中文**，
只是英文原题可能不完整。

### 4. 8 个 PDF 的文字层含 NUL 字节

ATLAS / CMS / LHCb / BABAR / Evans2008 / Abazov2006 / GENIE / CMS-tracking 的字体表里有 `\x00`，
psycopg 会报 `DataError: PostgreSQL text fields cannot contain NUL (0x00) bytes` 并回滚**整个事务**。
`sanitize_pdf_text()` 去掉 `\x00`、C0 控制符（保留 `\t\n\r`）、`\ufeff`、孤立代理项。

## 译名体系（三份词表，为什么这么多）

D10 红线要求知识点名全中文，但论文标题/章节名是英文。规则翻译（`tools/ingest/translate.py`）的
`GLOSSARY` 是为 15 本**教科书**写的，缺大量论文/加速器术语。补了三层：

| 文件 | 内容 | 规模 |
| --- | --- | --- |
| `paper_glossary.py` | `PAPER_TITLES` 101 条人工标题译名 + `TRUNCATED_TITLES` 8 条 + `SECTION_GLOSSARY` 593 条专业术语 | 702 |
| `paper_glossary_extra.py` | 按 `untranslated_terms()` 频次补的装置代号与部件名 | 698 |
| `paper_glossary_common.py` | 通用学术词 + 整条短语（`drift chamber` 漂移室、`resistive plate chamber` 阻性板室） | 213 |
| `paper_glossary_generic.py` | 通用英语词（`estimation` 估计、`equalization` 均衡、`scoring` 评分）—— 不是专业术语，但缺一个就毁一条名字 | 385 |

合计 **1961** 条（`PAPER_TITLES` 101 + `TRUNCATED_TITLES` 8 + `SECTION_GLOSSARY` 593 + `EXTRA` 661 +
`COMMON` 213 + `GENERIC` 385）。

**为什么不调 LLM 翻译**：`tools/ingest/translate_titles.mjs` 是现成的 LLM 批量翻译器，但它要
`node --env-file=.env`，而本机安全策略拦这条命令（规则 `secret.basename.env`）。规则翻译 + 人工
词表是唯一可复现、可进 CI 的路。代价是覆盖不全（24 条降级），收益是**同样的输入永远得到同样的输出**。

## 不变量（`test_paper_names.py` 守着）

| 不变量 | 期望 | 守它的测试 |
| --- | --- | --- |
| `source_id LIKE 'paper-%'` 的节点名不得是纯 ASCII | 0 条 | `test_paper_kp_names_are_not_ascii` |
| 十个主题模块名必须含汉字 | 10/10 | `test_paper_module_names_are_chinese` |
| 奠基性论文（1980 含以前）标进 summary 与 meta | 14 篇 | `test_foundational_papers_are_marked` |
| 每个论文叶节点至少有一条 chunk | 0 个死点 | `test_every_paper_leaf_has_a_chunk` |
| 节点名不得以「与/和/的/在/或/及」结尾 | 0 条 | `test_no_paper_kp_name_ends_with_a_conjunction` |
| 译名必须「像个名字」：2 个汉字，或 1 个汉字 + 拉丁缩写 | — | `test_rejects_bare_hanzi_names` / `test_accepts_meaningful_names` |

`test_paper_kp_names_are_not_ascii` **能反向验证**：把任一节点名改回英文它必须变红，
步骤写在文件末尾 `if __name__ == "__main__"` 里。

## 当前库内数字（2026-10-21）

```
paper sources            101
paper modules             10   （tier='C'，ordinal 100–109）
paper kp 总数           1212   （depth0 101 + 叶 1054 + 中间层 57）
paper 叶节点            1054
paper chunks            3132
纯 ASCII 节点名            0
纯 ASCII 模块名            0
奠基性论文                14
孤儿 kp / 孤儿 chunk       0 / 0
无叶论文 / 无 chunk 叶     0 / 0
降级命名（「第 N 节 · …」）  24
含「未收录术语」的节点名       0
单汉字译名                    3   （`GEM 室` / `ROOT树` / `TObject类`，均为真名字）
```

## 已知边界（谁也别指望它们）

- **34 篇论文只有 1 个叶节点**（`leafCount=1`，名字叫「全文」）。原因：这些 PDF 没有 outline，
  正文也不符合行模式 `^\d+(\.\d+)*\.?\s+[A-Z]`（典型是 Letter to the Editor / 短会议稿，
  全文 4–6 页且无小节标题）。退化成「整篇一个叶」是刻意的：**宁可粒度粗，不造假节点**。
  分布从 1 叶到 146 叶都有，中位数 5 叶。
- **降级命名 24 条只存在降级，不会再优化**。逐条看过：全是参考文献条目 / PDF 版面碎片 /
  单位量程 / 缩写，没有一条能靠补词表救回来。它们的信息不丢：英文原名在 `summary` 的
  「原文：」后面。
