# t32 英文书检索可达性：中文 query 到英文语料的术语桥

> 本文件是 t32 的交付记录（团队任务号，不对应 `docs/spec/issues/`
> 里的 20 张票编号）。A 部分（双语查询扩展）已完成；B/C 未做，理由见末节。

## 一、问题：六成叶知识点对中文提问不存在

t26 把 15 本英文教材入库后，全库 27 本 / 6065 知识点 / **86076 chunk**（本机实测，
含 20 本中文书 + 15 本英文书 + 论文）。其中英文书占 **2652 个叶节点（60%）**。

而 `apps/api/src/retrieval/bm25.ts` 的 `tokenize()` 只做两件事：

- ASCII 词按 `[a-z0-9][a-z0-9._-]*` 切；
- 连续汉字切成**重叠二元组**（bigram）。

**没有任何跨语言能力**。中文 query 与英文正文之间不存在共同 token，于是：

```
GET /api/v1/agent/retrieval/debug?query=germanium detector resolution&microKpId=kp-knoll-4e-2010-1
→ totalMatched=200，前 3 条命中 knoll-4e / nakhostin-2018 的真实正文

GET /api/v1/agent/retrieval/debug?query=锗探测器能量分辨&microKpId=kp-knoll-4e-2010-1
→ totalMatched=0（修复前）
```

学生是全中文界面（D10 红线），所以这 60% 的知识点在检索门控下**等于不存在**。
这不是「检索质量不够好」，是「一半语料不可达」。

## 二、词表：从产物零成本导出，不调模型

`tools/ingest/export_glossary.py` 扫 `content/*/toc.json`。每本英文书的每个节点都有
`name`（中文译名）与 `nameOriginal`（英文原名）—— 后者是 t26 的
`toc_batch.py::translate_nodes()` 为了「原文不能丢」而保留的副产品。于是中英对照
表不需要再跑一次模型，也不需要人工维护。

**产物**：`content/glossary.json`，**1965 个中文术语 / 2184 条英文对照**，
来自 13 本英文书（`guojiang-2014` / `guojiang-2023` 是中文教材，它们的
`nameOriginal` 就是中文，被清洗规则排除）。

清洗规则（每条对应一类真实脏数据，`tools/ingest/test_export_glossary.py` 逐条守）：

| # | 规则 | 对应的真实脏数据 |
| --- | --- | --- |
| 1 | `zh` 或 `en` 长度 < 2 丢弃 | 「与」「或」不是术语，展开会把半个语料拉进来 |
| 2 | `zh` 含「未收录术语」丢弃 | `translate.py` 的翻译失败标记，不是译名 |
| 3 | `en` 里没有 ASCII 字母丢弃 | 12 本中文书的 `nameOriginal` 是中文原名 |
| 4 | `en` 里仍含汉字丢弃 | OCR 把 `YAP:Ce` 认成 `夀䄀倀㨀䌀攀` |
| 5 | 剥掉 `en` / `zh` 开头的章节编号 | `1.3 Radioactivity…` 与 `10.1.1 ADC性能`（`naming.py` 把编号拼回了重名叶节点的 `name`，而学习者提问不带编号） |
| 6 | 剥掉开头的 OCR 碎片（全小写 ≤3 字符的首 token） | `is Pulse Shaping`、`oe The field effect`、`eee Appendix D` |
| 7 | 同一 `zh` > 8 个 `en` 整条丢弃（**在规则 8–9 缩减之后才判**） | `能量` / `类型` / `方法` 是通用词，展开等于命中一切 |
| 8 | 大小写不同的 `en` 合并（取出现次数多的写法） | `Pulse shaping` / `Pulse Shaping` |
| 9 | 被别的 `en` 包含的长串丢掉 | `Pulse shaping` ⊂ `Semi-triangular pulse shaping` |
| 10 | 有单词写法就只留单词写法 | `探测器` 的 30 个写法（`Diamond detectors` / `Detector size` / …）缩成 `Detector` |

**规则 7 必须在 9–10 之后判**：`探测器` 原本 30 个写法（OCR 把 30 个「XX 探测器」
小节都译成「探测器」），按原始数会超上限被整条丢掉 —— 而缩减后只剩 `Detector`，
是最常用的术语之一。这是本票最容易做错的一处，`test_common_words_that_are_ocr_residue_are_dropped`
专门守它（断言 `探测器` 在表里、`能量`/`类型`/`方法` 不在）。

## 三、展开算法：最大化覆盖，不是「最长匹配优先」

派单原文写的是「最长匹配优先（`锗探测器` 命中后不再单独展开 `探测器`）」。这个
**目标**是对的，但按字面实现会在真实 query 上出错。

实测 `前置放大器噪声` 的候选：

| 候选 | 覆盖字符 | 展开成 |
| --- | --- | --- |
| `放大器噪声` | 2–6（5 字） | `Amplifier noise matching` |
| `前置放大器` | 0–4（5 字） | `Preamplifier` |
| `放大器` | 2–4（3 字） | `Amplifier` |
| `噪声` | 5–6（2 字） | `Noise` |

「最长优先」会先吃掉 `放大器噪声`（5 字），于是 `前置放大器` 再也匹配不上。而
`放大器噪声 → Amplifier noise matching` 是一条小节标题，正文里几乎不出现；
`Preamplifier` + `Noise` 才是学生要找的词。

所以 `packages/engine/src/glossary.ts` 用**加权区间调度 DP**：在互不重叠的候选里
选覆盖字符数最多的那组。并列时取「词条数更少」的那组（`探测器` 一条优于
`探测` + `测器` 两条），再并列按固定枚举顺序，保证同一输入永远得到同一输出。

实现 30 行，复杂度 O(query 长度 × 候选数) —— query 几十字、词表 1965 条，
每次检索几千次比较，与 BM25 检索本身比可以忽略。

`expansions`（`{zh, en}` 数组）随检索结果返回，调试器用它回答「一句中文为什么
命中了英文正文」。

## 四、检索侧接线

### `apps/api/src/retrieval/bm25.ts`

`ChunkIndex.search(query, {limit?, hardCap?, extraTerms?})`。`extraTerms` 非空时用
MiniSearch 的查询表达式树：

```ts
this.mini.search({ combineWith: 'OR', queries: [query, ...extra] })
```

每个子查询各自被 `tokenize` 处理，所以 `Germanium Detectors` 会被切成
`germanium` + `detectors` —— 正文里不会连写这两个词，这是必需的。

**`extraTerms` 为空时直接 `this.mini.search(query)`，不进表达式树分支。** 这是
「不改变原有单语行为」的落地方式：不依赖「单元素 OR 树 == 字符串查询」这种隐式
性质。`bm25.test.ts` 断言空数组/全空白数组与不传选项的结果**逐位相同（含分数）**。

`buildSnippet(text, query, width, extraTerms)` 也接了扩展词：中文 query 命中的是
英文正文，只用中文 token 找命中点会找不到，摘要会退回「从头截 160 字」，而命中点
可能在 2000 字之后。

### `apps/api/src/retrieval/glossary-store.ts`

启动时 `readFileSync` + `JSON.parse` 读一次，挂在 `RetrievalService` 的索引缓存旁。

- 路径解析与 `skill-scanner.ts::defaultSkillsDir()` 同一思路：从模块位置往上找带
  `package.json` 的目录（`src/retrieval` 与 `dist/retrieval` 都能落到 `apps/api`），
  再上两级到仓库根。`STARMAP_GLOSSARY_PATH` 可覆盖。
- **文件不存在时降级为不扩展 + `logger.warn`，不抛错。** 抛错会让整个 API 起不来，
  包括看板/图谱/技能库这些与检索无关的页面；而代价本该只有「中文 query 搜不到
  英文正文」。`glossary-store.test.ts` 有一条专门守这个。
- `parseGlossary` 只做**形状**校验，不做业务清洗 —— 清洗是
  `export_glossary.py` 的责任。这里再洗一遍会让「产物有脏条目」在运行时被静默
  修好，而产物才是要审查的东西。

## 五、真实验收（本机 3001 端口，真实库 86076 chunk）

修复前后对比（`.scratch/probe-before-after.mts` 直连 pg 建同一份 `ChunkIndex`，
对「英文书子集」单独排名以排除 200 条硬顶的影响）：

| 中文 query | 英文书命中（无扩展 → 有扩展） | 展开词 |
| --- | --- | --- |
| `锗探测器能量分辨` | **0 → 5** | `Germanium Detectors` |
| `脉冲成形` | **0 → 125** | `Pulse shaping` |
| `死时间` | **0 → 48** | `Dead Time` |
| `多道分析器` | **0 → 5** | `Multichannel Analyzer` |
| `电荷灵敏前置放大器` | **0 → 5** | `Charge-Sensitive Preamplifiers` |
| `半导体探测器` | **0 → 5** | `Semiconductor Detectors` / `Semiconductor microstrip detector` |
| `硅微条探测器` | **0 → 141** | `Double-sided strip detector` / `Strip Detectors` |
| `热噪声与散粒噪声` | **0 → 145** | `Thermal (Johnson) noise` / `Thermal Noise` / `Shot noise` |
| `量子色动力学禁闭`（词表无此术语） | 0 → 0（对照） | 无 |
| `germanium detector resolution`（纯英文） | 192 → 192（对照） | 无 |

**纯英文 query 的命中逐位不变**（`192 → 192`，且 `expansions` 为空）—— 这是
「不改变原有单语行为」的端到端证据。

真实后端响应（`GET /api/v1/agent/retrieval/debug`，`limit=3`）：

```json
{
  "query": "锗探测器能量分辨",
  "microKpId": "kp-knoll-4e-2010-1",
  "current": null,
  "gateTier": "background",
  "totalMatched": 200,
  "expansions": [{ "zh": "锗探测器", "en": "Germanium Detectors" }],
  "hits": [
    { "chunkId": "ck-radiation-detectors-dinghonglin-2010-0291-16-…", "allowed": true,
      "snippet": "要取决于探测器的固有分辨能力。很明显，由于锗探测器能量分辨率高，…" },
    …
  ]
}
```

修复前同一请求是 `{"totalMatched": 0, "hits": []}`。

## 六、已知局限（诚实记录）

1. **中文书仍然排在前面。** `锗探测器能量分辨` 的 top10 全是中文书（分数 260–360），
   英文书排在其后（英文书内部 top1 分数 19.6）。原因是 BM25 的分数按 token 命中
   累加，而中文 query 的中文二元组在中文正文里能命中十几个，扩展词只贡献 2 个
   英文 token。**本票修的是「可达性」（从 0 到有），不是「排序质量」**。
   要改排序需要给扩展词加权，但「加权多少」没有可靠依据 —— 派单也明确要求
   「与 query 同等权重」，所以保持等权。
2. **中文术语必须是词表里有的。** `能量分辨` 单独查没有条目（词表里是
   `能量分辨率`），所以 `锗探测器能量分辨` 只展开 `锗探测器`。这是词表覆盖问题，
   不是算法问题：`export_glossary.py` 只从目录标题生成，不生成子串术语。
3. **英文书的 chunk 粒度没有改**（B 部分）。`tools/ingest/chunk.py:34` 的
   `_SENTENCE_END = re.compile(r'(?<=[。！？；])')` 只认中文句末标点，
   `_split_long()` 对英文完全不生效 ⇒ 英文书 80–90% 的 chunk 超 `MAX_CHARS=1200`
   （中位数 ahmed 1857 / knoll-4e 2900 / leo 2295）。**英文 chunk 数没有变化**
   （本票没有重跑任何入库）。改它要重跑 15 本书并重导入（chunk id 会变），
   工作量与风险都不小，留给后续票。
4. **`nameOriginal` 没有入库**（C 部分）。`app.knowledge_points` 没有
   `name_original` 列，英文原名只留在 `toc.json` 里。塞进 `summary` 会污染学习者
   可见的知识点摘要，正确做法是加一列（迁移编号在 0020-0029 之外，需先问 captain）。
   本票的术语表走文件系统，不需要这一列，所以没做。

## 七、测试面

| 层 | 文件 | 条数 | 守什么 |
| --- | --- | --- | --- |
| engine 纯函数 | `packages/engine/src/glossary.test.ts` | 17 | 展开规则、最长匹配、DP 选词、纯英文不展开、去重、空输入 |
| Python 产物 | `tools/ingest/test_export_glossary.py` | 16 | 产物最新性、10 条清洗规则逐条、13 本英文书都贡献、4 条验收术语在表里 |
| 检索纯函数 | `apps/api/src/retrieval/bm25.test.ts` | 14 | `extraTerms` 为空时逐位相同、扩展能命中英文、OR 语义、token 匹配、snippet 取词 |
| 词表加载 | `apps/api/src/retrieval/glossary-store.test.ts` | 10 | 文件缺失/损坏/空数组降级不崩、路径解析、真实产物可读 |
| 接口级 | `apps/api/src/retrieval/retrieval.controller.test.ts` | 21（+5） | 端到端：中文 query 从 0 命中变命中、`expansions` 出现在响应里、纯英文不展开、bands 也带 expansions |
| 前端 | `apps/web/src/pages/RetrievalDebugger.test.tsx` | 15（+3） | 展开记录在页面上摊开、无展开时不渲染空框、多写法时条数说的是术语数 |

## 八、复现命令

```bash
# 重新生成词表（改了 toc.json 或清洗规则之后）
python tools/ingest/export_glossary.py
python tools/ingest/export_glossary.py --check   # 只校验产物是否最新

# 词表测试
python -m pytest tools/ingest/test_export_glossary.py -q
cd packages/engine && npx vitest run src/glossary.test.ts
cd apps/api && npx vitest run src/retrieval/

# 前后对比（直连 pg，需要本机 5432 上的 starmap 库）
cd apps/api && node_modules/.bin/tsx probe-before-after.mts
```
