# t30 归属算法修复（票 17 遗留缺陷单独立项）

> 本文件是 t30 的交付记录。票面编号沿用 t30（团队任务号），对应
> 票 17 Comments 里的「遗留（不属本票范围，已转 t30）」一节。

## 一、缺陷与根因

`tools/ingest/assign.py::leaf_page_ranges` 原实现按「同页并列第几条就往后推几页」
摊分区间（`_tie_offset` + 单调修正）：

```python
ordered = sorted(leaves, key=lambda n: n['printedPage'])
for i, n in enumerate(ordered):
    raw = n['printedPage'] + _tie_offset(ordered, i)   # 同页第几条就推几页
    starts.append(max(raw, starts[-1] + 1) if starts else raw)
```

正文里一页并列 2–3 个条目、渗透一两页可接受。但**附录区一页能并列 3–6 个**
（汲长松 p561 有 6 个：附录12 / 品质因数Q / 附录13 / 我国现行的剂量限值标准 /
附录14 / β粒子和中子注量（率）限值），偏移量逐条累积后整组被推过书末。

复现（`.scratch/repro-t30.py`，只读）：

```
radiation-detector-handbook-jichangsong-1990：节点 467、chunk 7033、max printed_page 562
  start 被摊分推后的条目：327 个
  start > max_page+1 的条目：17 个（最远 start 580，书只有 562 页）
  零 chunk 叶节点：9/391
nuclear-physics-experiment-methods-1997：节点 331、chunk 7650、max printed_page 475
  start 被摊分推后的条目：191 个
  start > max_page+1 的条目：11 个（最远 start 487）
  零 chunk 叶节点：7/273
```

后果两条：**挂空**（p558 之后的 chunk 找不到 owner）与**挂错**（p552–562 的真实
内容归给了被推后但仍落在书内的 p549/550 条目）。

## 二、修复方案（三处，都在 `assign.py`）

### 1. `start` 恒等于条目自己的 `printedPage`，一个偏移都不加

同页并列的条目**共享**同一段 `[p, 下一个不同起始页)`（区间允许重叠）。
「区间不可能被推出书末」于是成为结构性质：只要目录页码不超过书末，`start`
就不超过书末 —— 不靠任何数值约束去堵。

为什么不用票面提的「`[p, p)` 空区间 + 兜底归属」：空区间会让 `owner_of()` 对那
几页返回 None，所有同页条目都要走一条只在这种情况下才执行的兜底分支；而重叠
区间是「这页同时属于它们几个」的直接表达，`owner_of()` / `owners_at()` 两个查询
函数都能照常工作。

为什么不用票面提的「按内容关键词挑 owner」：归属必须可复现（同一份产物重跑要
字节相同，`manifest.contentHash` 才有意义），按内容挑会随 OCR 错字漂移。

### 2. `owner_of()` 的确定性规则 + 新增 `owners_at()`

- `owners_at(page)` 返回该页**全部**候选所有者（按目录顺序）。
- `owner_of(page)` 返回并列组里**目录顺序第一条**作为「代表」。

「代表」不是真实归属：真实归属由 `assign()` 分。两个函数分开，是因为
`owner_of()` 的调用方（测试、诊断脚本）需要单值答案，而 `assign()` 需要候选集合。

### 3. `assign()` 按页 chunk 顺序**连续切块**，叶节点优先

```
idx = 0 if k == 1 else min(k - 1, (i * k) // n)   # n = 该页 chunk 数，k = 该页所有者数
```

三条理由：
1. **连续** —— 轮转（`i % k`）会让一页的正文在几个知识点之间来回跳
   （`a1 b1 c1 a2 b2`），读起来是碎的；切块是 `a1 a2 b1 b2 c1`。
2. **页内顺序有意义** —— 先出现的段落属于哪个条目，通常就是该页开头那个条目。
3. **确定性** —— 不依赖随机数，也不依赖 chunk 的绝对 id。

**叶节点优先**：所有者 = 叶节点 + 章节附件。一页并列 3 个条目只有 1 个 chunk 时，
切块会让后两个什么也拿不到；让叶节点排在前面，饿着的是附件（「小结/习题/附录」
这类容器，零内容不影响地图与掌握度），而不是微知识点。

## 三、测试（`tools/ingest/test_assign.py`，34 条）

改了两条旧断言（它们钉的是旧契约），新增 `TestNoOverflow` 6 条：

| 用例 | 守什么 |
|---|---|
| `test_start_is_always_the_printed_page` | `start` 恒等于 `printedPage` |
| `test_no_start_past_the_last_page` | 30 个同页条目也不越过 `maxPage + 1` |
| `test_last_page_chunks_do_not_go_to_early_appendix` | p559–562 的 chunk 不得归 549/550 的节点 |
| `test_same_page_chunks_are_split_in_reading_order` | 切块不是轮转（`a a b b c`） |
| `test_leaf_wins_over_appendix_when_there_is_only_one_chunk` | 1 个 chunk 时叶节点优先 |
| `test_owners_at_is_deterministic` | 同一并列组永远返回同一顺序 |

改掉的两条旧断言：
- `test_same_page_leaves_both_get_a_non_empty_range` → `test_same_page_leaves_share_the_same_range`
  （原来断言 `[7,8)` / `[8,9)`，现在断言两条都是 `[7,9)`）
- `test_last_leaf_by_page_absorbs_tail_not_last_in_document_order` 里的
  `owner_of(200) == ('kp-5','时间分析')` → `('kp-4-3-3', …)`，并补
  `owners_at(200) == ['kp-4-3-3', 'kp-5']`。

`python -m pytest tools/ingest/ -q` → **189 passed**（原 174+）。

## 四、重跑与入库

三本重跑（OCR 页面缓存全命中，每本几十秒，**chunk 数不变**说明只是重新归属不是
重新抽取）：

| 书 | chunk 数 | 零 chunk 叶（前 → 后） | start 推出书末（前 → 后） | 正文区中位数（前 → 后） |
|---|---|---|---|---|
| `radiation-detector-handbook-jichangsong-1990` | 7033（不变） | 9 → **0** | 17 → **0** | 3 → **0** |
| `nuclear-physics-experiment-methods-1997` | 7650（不变） | 7 → **1** | 11 → **0** | 1.0 → 1.0 |
| `nuclear-radiation-physics-chenboxian-2011` | 7435（不变） | 2 → **0** | 3 → **0** | 3.0 → 3.0 |

第三本（陈伯显）是 captain 追加批准的：它与前两本是**同一缺陷类**（p477 有 7 个
chunk、p478 有 19 个，都挂在同页的「附录V / 附录VI」上），只重跑它不扩大风险面。

入库命令：`npx tsx scripts/import-content.ts <content 目录>`。三本都是
「清理旧 chunk 0」—— 重跑后 chunk id 集合与库里**逐条相同**（`_stable_id` 是
`source_id|pdf_page|index|text[:80]` 的哈希，重新归属不改这三项）。

### misowned 真值判据（12 本逐本对比）

定义：「该页应该归谁」= `source_page <= page` 的所有者里 `source_page` 最大的一组。
owner 的 `source_page` 不等于这个最大值即挂错。**这个判据不依赖 `ranges`**，
所以修复前后可以公平比较。

| 书 | chunk | 叶 | 零 chunk 叶 | misowned | 推出书末 | 正文中位数 |
|---|---|---|---|---|---|---|
| analog-electronics-kanghuaguang-5e | 7914 | 168 | 0→0 | 211→0 | 0→0 | 1→1.0 |
| analog-electronics-tongshibai-5e | 7999 | 208 | 0→0 | 573→0 | 0→0 | 1.0→1.0 |
| circuit-analysis-lihansun-5e-vol1 | 3955 | 61 | 0→0 | 0→0 | 0→0 | 2→2.0 |
| digital-electronics-yanshi-6e | 6485 | 127 | 0→0 | 57→0 | 0→0 | 1→1.0 |
| digital-kanghua-5e | 3546 | 145 | 0→0 | 0→0 | 0→0 | 1→1 |
| nuclear-electronics-wangjingjin-1983 | 2821 | 106 | 0→0 | 359→0 | 0→0 | 1.0→1 |
| nuclear-electronics-wangzhiying-1989 | 4884 | 98 | 0→0 | 87→0 | 0→0 | 2→2 |
| nuclear-physics-experiment-methods-1997 | 7650 | 273 | **7→1** | **1842→0** | **11→0** | 1.0→1.0 |
| nuclear-radiation-measurement-tangbin | 6877 | 47 | 0→0 | 0→0 | 0→0 | 5.0→5 |
| nuclear-radiation-physics-chenboxian-2011 | 7435 | 69 | **2→0** | **88→0** | **3→0** | 3.0→3.0 |
| radiation-detector-handbook-jichangsong-1990 | 7033 | 390 | **9→0** | **3839→0** | **17→0** | 3→0 |
| radiation-detectors-dinghonglin-2010 | 6649 | 95 | 0→0 | 31→0 | 0→0 | 4→4 |
| **合计** | **73248** | — | **18→1** | **7087→0** | **31→0** | **无一本变差** |

- chunk 总数 73248 → 73248（**±0%**，远在 ±2% 内）。
- 正文区中位数：**0 本变差**，1 本变好（汲长松 3 → 0）。
- misowned 7087 → 0：修复前 9.7% 的 chunk 挂在页码范围覆盖不到它的知识点上
  （与票 17 Comments 记录的 7796/73248 = 10.6% 同量级；差异来自判据口径 ——
  票 17 那个数是「page 落在 owner 区间之外」，本表用 source_page 真值判据）。

### p559–p562 归属实测（汲长松）

| 页 | chunk 数 | owner 的 source_page |
|---|---|---|
| p559 | 7 | 559 |
| p560 | 16 | 560 |
| p561 | 7 | 561 |
| p562 | 2 | 562 |

修复前：这 32 个 chunk 全挂在 `source_page` 549–552 的节点上。

## 五、三层数字（captain 指定的交付口径）

| 层 | 数字 | 说明 |
|---|---|---|
| **库级** | 全库零 chunk 叶节点 **3** | 见下方豁免说明（核对时点：2026-10-21 16:00Z） |
| **产物级**（12 本用新算法重算） | **1** | `kp-methods-1997-p457-放射性衰变计算表`，粒度上限非算法缺陷 |
| **修复前后** | 20 → 3（库级）／18 → 1（产物级） | — |

库级 3 条按来源分布（`SELECT coalesce(source_id,'(seed)'), count(*) … GROUP BY 1`）：
`(seed) 2` / `nuclear-physics-experiment-methods-1997 1`。构成：

| id | 类别 | 为什么正确 |
|---|---|---|
| `kp-bool` | **seed 手造** | `seed.sql` 里是手写教学关卡 `lv-bool-laws` 的挂载点，内容在 `content/levels/lv-bool-laws.spec.json` 而非 `chunks` |
| `kp-kmap` | **seed 手造** | 同上，卡诺图化简的手写关卡挂载点 |
| `kp-methods-1997-p457-放射性衰变计算表` | **页级粒度上限** | 见下 |

> **中途曾出现第 4 条 `kp-zzz-t24-prune-probe`**（content-dev 的 t24 用来验证
> `--prune-kp` 的活探针，`.scratch/t24/fake_stale.sql` 注释写「用完必须删掉」）。
> 本票取证期间它一直在库里，报数时按 4 记；t24 收尾后已被删除，现在库级是 **3**
> （`SELECT count(*) FROM knowledge_points WHERE id LIKE 'kp-zzz%'` = 0）。它不是
> 内容缺陷，也不在本票范围内 —— 记在这里只为解释两个数字的差。

> **库在变大，报数必须限定口径。** 本票开工时库里是 12 本书 / 1940 节点；
> 收尾时已远超此数（graph-dev 的 t26 / 票 18 在并行往库里导入有文字层的电子书，
> 取证期间从 2440 节点一路涨到 4101）。因此全库零 chunk 叶的绝对数会被 t26 的新书
> 不断抬高（实测 184 条，其中 181 条属于 t26 新书）。那 181 条**不是本缺陷**：用修好的
> `assign()` 对同一批产物重算，数字一条不变（`.scratch/t30-newbooks.py` 的
> `zero_now == zero_new`，且 27 本里每一本的 `starts!=p` 都是 **0** —— 说明它们的产物
> 本来就是新算法出的）。它们零内容是因为那几本是有文字层的电子书，每页 chunk 产量远
> 低于扫描件（例：`leo-2e` 387 chunk / 280 叶、`spieler-2005` 529 / 249），是另一个
> 问题，不属于 t30。**本票所有结论一律限定在 12 本口径内**，对应的可复核查询在
> `.scratch/t30-final-scoped.sql`（把 12 个 source_id 写死在 CTE 里）。

**`kp-bool` / `kp-kmap` 必须在测试与报告里显式豁免**：它们是手写关卡的挂载点，
零 chunk 是正确的。下一个人不该把这两个当 bug 再「修」一遍。

## 六、`kp-methods-1997-p457-放射性衰变计算表` 的可复核证据

这一条是**页级归属的粒度上限**，不是算法缺陷。证据（SQL 在
`.scratch/t30-final-check.sql`）：

**(a) p457 上只有 1 个 chunk：**

```
ck-nuclear-physics-experiment-methods-1997-0464-00-b0d127bfd582 | text | 附录 4 放射性衰变计算表 t/tl t/g t/es …
```

**(b) p457 上有 2 个叶条目 + 1 个附录，共 3 个区间所有者：**

| id | is_leaf | source_page | 当前 chunk 数 |
|---|---|---|---|
| `kp-methods-1997-p457-常用核素表` | t | 457 | 1 |
| `kp-methods-1997-p457-放射性衰变计算表` | t | 457 | **0** |
| `kp-methods-1997-p457-附录4` | f（附件） | 457 | 0 |

1 个 chunk < 2 个叶节点，切块必然有一个拿到 0 个。这是页级归属的固有上限
（模块 docstring 的「粒度限制」一节早已写明：「归属是页级的，不是段落级的」）——
要修只能做到段落级归属，那是另一个量级的改动（需要按标题与段落边界切页），
不在本票范围。

顺带说明：这 1 个 chunk 的文本是「附录 4 放射性衰变计算表 …」的**表格内容**，
按内容它更接近「附录4」，但它先被「常用核素表」拿走 —— 这同样是页级粒度的
表现，不是这次改动引入的。

## 七、同类问题在别的书也存在（只报告不修，票面要求 5）

正文区同页并列 ≥ 4 个条目的组（12 本入库书，脚本 `.scratch/report-t30.py`）：

| 书 | 组数与位置 |
|---|---|
| `analog-electronics-tongshibai-5e` | 1 组：p63 ×4（全叶）集成电路中的无源元件 / 集成电路中元件的特点 / Multisim应用举例 / 二极管特性的研究 |
| `nuclear-electronics-wangjingjin-1983` | 1 组：p187 ×4（附/叶/附/叶）附录 / 电缆分支节点的阻抗匹配 / 附录二 / 谱数据二阶多项式5点平滑公式 |
| `nuclear-physics-experiment-methods-1997` | 4 组：p453 ×5、p466 ×4、p468 ×4、p470 ×6（多为附/叶混排） |
| `radiation-detector-handbook-jichangsong-1990` | 11 组：p205 ×6、p236 ×4、p238 ×4、p271 ×4、p352 ×4、p354 ×4、p416 ×4、p531 ×5、p557 ×4、p559 ×4、p561 ×6 |

合计 **17 组，分布在 4 本书**。这些组现在都能正确分到内容（切块让每个条目至少
拿到该页的一段，只要该页 chunk 数 ≥ 条目数），但「一页 6 个条目只有 3 个 chunk」
时仍会有条目零内容 —— 那同样是页级粒度上限。**只报告，本票不修**。

另有 3 组出现在 `content/` 下但未入库的 t26 在途书（`ahmed-2e` p311/p337、
`leo-2e` p341/p353、`spieler-2005` p483/p489 等），不在本票统计口径内。

## 八、改动文件

- `tools/ingest/assign.py`（重写 `leaf_page_ranges` / `owner_of`，新增 `_first_cover` / `owners_at`，重写 `assign`；删除 `_tie_offset`）
- `tools/ingest/test_assign.py`（改 2 条旧断言 + 新增 `TestNoOverflow` 6 条 + `_node` 支持 `appendix` 参数）
- `content/radiation-detector-handbook-jichangsong-1990/`（toc/chunks/edges/manifest/ocr，重跑）
- `content/nuclear-physics-experiment-methods-1997/`（同上）
- `content/nuclear-radiation-physics-chenboxian-2011/`（同上）

未改：`tools/ingest/toc.py`（票面明令）、`tools/ingest/chunk.py`、`tools/ingest/edges.py`、
`apps/api/scripts/import-content.ts`。数据库侧只有这三本的 `chunks` / `chunk_kp_answer` /
`kp_edges` / `knowledge_points` 被 `import-content.ts` 幂等更新，**没有任何
`DELETE FROM knowledge_points`**。

## 九、复现命令

```bash
# 只读：复现缺陷与逐本对比
python .scratch/repro-t30.py                # 修复前/后的区间诊断
python .scratch/t30-final-report.py         # 12 本逐本对比表
python .scratch/report-t30.py               # 同页并列 ≥4 报告 + 确定性检查

# 修后的验证
python -m pytest tools/ingest/ -q           # 189 passed

# 重跑产物（配置在 tools/ingest/books.ocr.json）
python tools/ingest/ocr_run.py "资源库/books/19_核辐射探测器及其实验技术手册_汲长松_1990.pdf" \
    --source-id radiation-detector-handbook-jichangsong-1990 \
    --page-offset auto --toc-range 4 15 --first-page 15 \
    --out content/radiation-detector-handbook-jichangsong-1990

# 入库（幂等）
cd apps/api && npx tsx scripts/import-content.ts "D:/DeepSeek/starmap/content/<book>"

# 库级核对
export PATH="/c/Users/Yhwhy/scoop/apps/postgresql/current/bin:$PATH"
tr -d '\r' < .scratch/t30-final-check.sql | psql "postgresql://postgres@127.0.0.1:5432/starmap"
```

## 九之二、与 Python 报告独立的 SQL 交叉验证

上面那张 12 本对比表来自 `.scratch/t30-final-report.py`（把产物重算一遍）。为了
不放任「脚本自己验自己」，另用**直接查库**的 SQL 复核了三件事：

**(a) 产物与库逐条一致**（证明入库忠实、没有半写）：把三本 `chunks.jsonl` 的
`micro_kp_id` 与库内 `chunks.micro_kp_id` 逐条比对 —— 7033 + 7650 + 7435 =
**22118 行，mismatch 0，库内缺行 0**。

**(b) p559–p562 之外，没有任何 chunk 被「越过更靠后的叶节点」**（`.scratch/t30-suspicious.sql`）：
判据是「owner 的 `source_page` 早于另一个叶节点的 `source_page`，而后者仍 ≤ chunk 页」
—— 这正是旧缺陷 p559 挂给 p549 的形态。三本合计 **0 条**。

**(c) 没有任何 chunk 的 owner 页码越过书末**（`.scratch/t30-p559.sql`）：
汲长松「owner 页码 > 562」= **0**；methods-1997「owner 页码 > chunk 页 + 1」= **0**；
chenboxian-2011 = **0**。p559–p562 每页的 chunk 全部落在同页 owner 上：

| 页 | chunk 数 | owner 的 source_page 范围 | 落在 559–562 的条数 |
|---|---|---|---|
| p559 | 7 | 559–559 | 7 |
| p560 | 16 | 560–560 | 16 |
| p561 | 7 | 561–561 | 7 |
| p562 | 2 | 562–562 | 2 |

**一次走过弯路要记下来**：我第一版 SQL 把「应该是哪一页」定义成「**只取叶节点**的
`source_page` 求最大值」，算出来三本分别是 294 / 524 / 583 条「挂错」，和 Python
报告的 0 冲突。抽样本一看：`chunk.page=187`、owner=`参考文献`（`is_leaf=false`、
`source_page` 也是 187）—— 页码完全相等，根本不是错位。原因是真值集漏掉了
**章节附件节点**，而 `assign()` 的所有者定义是「叶节点 + 附件」。按 owner 是否叶
分组再看，三本的错位条数**全部**记在非叶 owner 上，叶 owner 一条都没有。
**Python 报告的 0 是对的，那两个 SQL 作废。**

## 十、遗留观察（供 captain 判断）

1. **零 chunk 叶节点的「正常值」是 3 条**（2 seed + 1 粒度上限）。以后再加书，
   这个数字涨了就是回归。原来那个 20 条的基线（含 2 seed）里没有任何一条是
   「真空页」—— 全是摊分溢出造成的挂空。
2. **`assign()` 现在是「按页切块」，不是「按内容挑」**：一页 6 个条目只有 3 个 chunk
   时仍会有条目零内容。要根治得做段落级归属（按标题与段落边界切页），
   那是独立一票的量级。
3. **`content/` 下 27 个书目录，只有 12 本在库里**：另 15 本是 t26（票 18 前半，
   graph-dev 在途）生成的有文字层书。本票所有统计都限定在这 12 本，
   脚本里 `assert len(BOOKS) == 12` 硬卡住，避免下次有人把在途产物算进基线。
