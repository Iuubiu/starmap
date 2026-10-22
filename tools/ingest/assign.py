"""把 chunk 挂到微知识点上，并标注答案块。

两件事分开做，因为它们的证据强度不同：

1. **归属（`microKpId`）—— 确定性**。目录里每个条目的起始印刷页码严格单调递增
   （已实测：215 个节点、0 处逆序），所以「chunk 落在哪个叶节点的页码区间内」
   唯一可判。区间取左闭右开 `[leaf.printedPage, nextLeaf.printedPage)`，
   最后一个叶节点开到正无穷兜住书末没有目录条目覆盖的页（索引、附录）。

2. **答案块（`answerFor`）—— 规则推定，必须可复核**。

   规则原文（ticket 02 的「标注规则须写明并可复核」指的就是这一段）：

   chunk `c` 是微知识点 `K` 的答案块，当且仅当下面两类之一成立：

   **(A) 结构型 —— 只看归属，不看文字**
   `c` 的 `kind` 是 `formula` 或 `table`，且归属是 `K`。

   这里**故意不要求**公式/表格的文本里出现知识点名字。实测数据否定了那个
   想法：795 个公式块中只有 30% 提到所属知识点名，59 个表格块是 **0%** ——
   表格正文全是 `0 | 0001 | 0011` 这种纯符号，永远不可能含中文标题词。
   若要求提及，真值表会被全部漏标，而真值表恰恰是数字电路最典型的答案。

   **(B) 定义型 —— 看文字**
   `c` 的 `kind` 是 `text`，且**同时**满足：
   - 出现 `K` 名字里的核心词（`_core_terms`，去编号与标点）；
   - 含定义连接词之一（`DEFINITION_MARKERS`）—— 教材陈述「X 是什么」的固定句式。

   反例（**不**标为答案块，尽管和 `K` 同页）：讲历史背景、讲应用举例、
   讲发展脉络的段落。它们回答不了「X 是什么」，正是要留给低掌握度学习者的
   脚手架材料。

   **粒度限制（必须知道）**：归属是**页级**的，不是段落级。康华光这本书每个
   叶节点平均只有 3.24 页，所以页级归属已经很接近正确；但仍会出现「这页确实
   属于 K，可这个公式是给下一节的预告」。这类错误无法用页面区间修掉，只能靠
   抽检发现。

   **已知局限**：推导的最终结论句若既不含定义连接词也不是公式，会漏标；
   含「即」的过渡句会误标。因此标注结果**必须人工抽检**，`--review-sample N`
   输出随机样本（答案块与背景块各半）供核对。实测分布：结构型 854 条
   （28.2%）、定义型 142 条（4.7%），合计 32.8%。
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

# 定义句式的固定连接词。顺序无关，用 `in` 判定。
#
# 刻意只收「陈述 X 是什么」的强标记。实测排除掉两个看起来像但实际不是的：
# - `即`（「也就是」）：`十进制数49表示为二进制时，即为110001` —— 是举例不是定义
# - `表达式`：`数字信号的表示方式可以是数学表达式，也可以是波形图` —— 是并列宾语
# 放宽到这两个会把真定义句从 79 条虚增到 142 条，多出来的全是背景叙述。
DEFINITION_MARKERS = (
    '称为',
    '叫做',
    '定义为',
    '是指',
    '可表示为',
)

# 公式块里允许的最大标点数（，。、；：）。超过就说明这是**散文**被误判成了公式。
#
# 为什么需要这一条：`extract._looks_like_formula` 只要见到一个 `=`/`<` 就判公式，
# 于是整段带公式的说明文字全进了 formula 类。实测 p.106「当输入为低电平，
# 并且v?<V?时，T,管截止，输出为高电平…」就是 formula，标点 9 个。若规则 (A)
# 无条件信任 kind，这些散文会被标成答案块，直接破坏检索门控。
#
# 阈值 4 是量出来的：795 个 formula 块里标点 ≤4 的有 316 个（40%），抽检这
# 316 个全是真公式（`(N)D=b0×2n−1+b1×2n−2+⋯`、进制转换竖式），而标点 >4 的
# 479 个抽检全是散文。判据是「标点密度」而不是「汉字数」—— 公式两侧的说明
# 词（`式中`、`为基数`）汉字也不少，但不会带一串逗号句号。
MAX_FORMULA_PUNCT = 4

_PUNCT = '，。、；：'

# 章节编号前缀（`1.1.1`、`10.4`）
_NUM_PREFIX = re.compile(r'^\d+(\.\d+)*')
# 标题里的噪声：省略号、装饰、空白
_JUNK = re.compile(r'[\s\u22ef\u2026·•●.，,、：:；;（）()【】\[\]“”\'"]')


@dataclass
class Assignment:
    """一个 chunk 的归属与答案块标注。"""

    chunk_id: str
    micro_kp_id: str
    answer_for: list[str] = field(default_factory=list)


def _core_terms(name: str) -> list[str]:
    """
    从知识点名字里取出「核心词」，用于判断 chunk 是否在谈这件事。

    教材目录标题常带编号前缀、括号补充和连接成分：
    `1.1.1 数字技术的发展及其应用`、`2.4 逻辑函数的表示方法（真值表）`。
    直正需要的是里面的**实词段**，去掉虚词后按词切。

    刻意不做 n-gram 滑窗：实测滑窗会在词边界上拼出 `方法真值` 这种不存在的
    词，并让它去匹配正文，结果是误标。宁可漏标也不制造假词 —— 误标会让
    答案提前泄露给学生，漏标只是退化成多给一段背景材料。

    括号里的补充词单独收一份（`（真值表）` → `真值表`），因为正文常用
    括号里的说法而不用主标题的说法。
    """
    bare = _NUM_PREFIX.sub('', name)
    # 括号内补充先单独收，再把括号从主串里去掉
    extra = re.findall(r'[（(]([^）)]{2,})[）)]', bare)
    bare = re.sub(r'[（(][^）)]*[）)]', '', bare)
    # 中英混排（`Verilog HDL描述`）在去空格前先把英文词捞出来，
    # 否则 `_JUNK` 吃掉空格后会被切成 `Verilo` 这种残词
    latin = re.findall(r'[A-Za-z][A-Za-z0-9]{1,}', bare)
    bare = _JUNK.sub('', bare)
    if len(bare) < 2:
        return [t for t in dict.fromkeys(extra + latin) if len(t) >= 2]

    # 虚词切分。`的`/`和`/`与`/`及` 这些在标题里只起连接作用，不是术语的一部分
    segs = [s for s in re.split(r'及其|以及|与|和|的|及', bare) if len(s) >= 2]
    terms: list[str] = []
    for s in segs:
        # 含拉丁字母的段不做截断 —— 截断会切出 `Verilo` 这种残词，
        # 它在正文里永不出现，等于这个知识点的拉丁术语完全失配
        if re.search(r'[A-Za-z]', s):
            rest = re.sub(r'[A-Za-z][A-Za-z0-9]*', '', s)
            if len(rest) >= 2:
                terms.append(rest)
            continue
        if len(s) <= 8:
            terms.append(s)
        else:
            # 超长标题（>8 字）才退而求其次取前 6 字，因为整串几乎不会在正文
            # 里原样出现，但开头部分通常会出现
            terms.append(s[:6])
    terms.extend(extra)
    terms.extend(latin)
    return [t for t in dict.fromkeys(terms) if len(t) >= 2]


def leaf_page_ranges(flat_nodes: list[dict]) -> list[tuple[str, str, int, int]]:
    """
    把区间所有者摊成 `[(microKpId, name, start, end)]`，左闭右开。

    **同页并列的条目共享同一段区间**，因此区间可以重叠。这是本函数唯一非平凡
    的决定，也是 t30 修的那个缺陷的根：

    原来的实现按「同页并列第几条就往后推几页」摊分（`_tie_offset`），在正文里
    看似合理（一页并列 2–3 个叶子，渗透一两页可接受）。但**附录区一页能并列
    3–6 个条目**（汲长松 p557 有 附录5/常用物理常数表/附录6/基本粒子表，
    methods-1997 p470 有 6 个），偏移量逐条累积，最后把整组推过书末：

    - 汲长松 562 页的书，30 个附录条目被推到 `[580, 1000000)` —— p558 之后
      的 chunk 找不到 owner（9 个叶节点零 chunk），而 p552–562 的真实内容被
      错误地归给了前面那些被推后但仍落在书内的条目（p559–562 的 32 个
      chunk 全挂到 `source_page` 549–552 的节点上）；
    - methods-1997 同病但没完全溢出，表现为「挂错」而非「挂空」。

    新的规则只有一条：**`start` 永远等于条目自己的 `printedPage`，一个偏移
    都不加**。同页并列的条目拿到完全相同的 `[p, 下一个不同起始页)`，一页的
    内容怎么在它们之间分，交给 `assign()` 按 chunk 顺序切块（见那里）。这样
    区间在结构上不可能被推出书末 —— 只要目录页码不超过书末，`start` 就
    不超过书末。

    为什么不是「让并列的共享 `[p, p)` 空区间再加兜底归属」：空区间会让
    `owner_of()` 对那几页返回 None，于是所有同页条目都要走一条只在这种情况
    下才执行的兜底分支；而重叠区间是「这页同时属于它们几个」的直接表达，
    `owner_of()` / `owners_at()` 两个查询函数都能照常工作。

    为什么不是「按内容关键词挑 owner」：归属必须可复现（同一份产物重跑要
    字节相同，`manifest.contentHash` 才有意义），按内容挑会随 OCR 的错字漂移。

    `end` 一律取**下一个不同的起始页**，不是下一个条目的 start（后者在并列
    时等于 p，区间会变成空）。最后一个条目开到正无穷兜住书末索引与附录。

    排序按 `printedPage` 稳定排序：同一页的几条保持目录里的先后 ——
    `assign()` 的切块顺序依赖它。

    **章节附件（小结/习题/附录）也算区间所有者**，虽然它们不是叶节点。
    目录里附件条目带着自己的起始页，那几页的正文（习题题干、本章要点）
    本来就属于它；若不占区间，这些页会被相邻的**真**知识点按页区间吞掉，
    变成「知识点 A 的内容里混进一章的习题」。实测康华光 20 个附件节点挂着
    707 个 chunk（20%），全部并回相邻知识点会同时污染两侧。
    """
    owners = [n for n in flat_nodes if n['isLeaf'] or n.get('appendix')]
    if not owners:
        return []
    ordered = sorted(owners, key=lambda n: n['printedPage'])
    pages = sorted({n['printedPage'] for n in ordered})
    ends = {
        p: (pages[i + 1] if i + 1 < len(pages) else 10**6)
        for i, p in enumerate(pages)
    }
    return [
        (n['microKpId'], n['name'], n['printedPage'], ends[n['printedPage']])
        for n in ordered
    ]


def _first_cover(page: int, ranges: list[tuple[str, str, int, int]]) -> int:
    """
    覆盖该页的**第一条**区间的下标；没有覆盖返回 -1。

    二分先找一个命中的，再往前走回到并列组的第一条 —— 同页并列时几条区间
    完全相同，二分会落在哪一条取决于数组长度，不往回走就不确定。
    """
    lo, hi = 0, len(ranges) - 1
    hit = -1
    while lo <= hi:
        mid = (lo + hi) // 2
        _kp, _name, start, end = ranges[mid]
        if page < start:
            hi = mid - 1
        elif page >= end:
            lo = mid + 1
        else:
            hit = mid
            break
    if hit < 0:
        return -1
    while hit > 0 and ranges[hit - 1][2] <= page < ranges[hit - 1][3]:
        hit -= 1
    return hit


def owner_of(page: int, ranges: list[tuple[str, str, int, int]]) -> tuple[str, str] | None:
    """
    该页的**代表**所有者。用二分而不是线性扫描：3032 个 chunk × 165 个叶节点
    的暴力匹配在测试里明显变慢，而这张表是有序的。

    同页并列时返回并列组里**目录顺序第一条** —— 规则确定，但它只是「代表」，
    不代表整页内容都归它。真实归属是 `assign()` 按 chunk 顺序在并列组内切块
    分配的；想知道一页的全部候选请用 `owners_at()`。

    返回 `(microKpId, name)`；页码落在所有区间之外（目录页之前的封面等）返回 None。
    """
    i = _first_cover(page, ranges)
    return None if i < 0 else (ranges[i][0], ranges[i][1])


def owners_at(
    page: int, ranges: list[tuple[str, str, int, int]]
) -> tuple[tuple[str, str, int, int], ...]:
    """该页的全部候选所有者，按目录顺序。单条时长度为 1，区间外为空元组。"""
    i = _first_cover(page, ranges)
    if i < 0:
        return ()
    out: list[tuple[str, str, int, int]] = []
    while i < len(ranges) and ranges[i][2] <= page < ranges[i][3]:
        out.append(ranges[i])
        i += 1
    return tuple(out)


def is_answer_block(text: str, kind: str, terms: list[str]) -> bool:
    """
    规则实现。判据原文见模块 docstring 的 (A)/(B) 两型。

    注意 (A) 型**不看 `text` 是否提及知识点名**：真值表的正文是
    `0 | 0001 | 0011`，永远不含中文标题词，要求提及等于全部漏标。

    但 (A) 型要看 `text` 像不像公式：`extract` 的公式判据只认一个 `=`，
    散文段落会被误归入 formula。误归的散文**不直接丢掉**，而是退回 (B) 型
    再判一次 —— 它可能恰好是个定义句（`称为` 之类），那就该按定义型算答案。
    """
    if kind == 'table':
        return True
    if kind == 'formula':
        if sum(1 for ch in text if ch in _PUNCT) <= MAX_FORMULA_PUNCT:
            return True
        # 落回定义型判据
        return any(t in text for t in terms) and any(m in text for m in DEFINITION_MARKERS)
    if not any(t in text for t in terms):
        return False
    return any(m in text for m in DEFINITION_MARKERS)


def assign(chunks: list, flat_nodes: list[dict]) -> list:
    """
    给每个 chunk 补 `micro_kp_id` 与 `answer_for`。原地修改并返回同一批对象。

    没有归属的 chunk（页码落在所有目录区间之前）保留 `micro_kp_id=None`，
    不硬塞给第一个叶节点 —— 那会让封面和版权页变成「数字逻辑概论」的内容。

    **一页有多个所有者怎么分**：按这一页 chunk 的顺序（`blocks_to_chunks`
    产出的就是自上而下的阅读顺序）**连续切块**，第一个 chunk 归第一个所有者、
    最后一段归最后一个，中间按 `i * k // n` 均分。三条理由：

    1. 切块保持同一条内容内部的连续 —— 轮转（`i % k`）会让一页的正文在几个
       知识点之间来回跳，读起来是碎的；
    2. 页内顺序是有意义的（先出现的段落属于哪个条目，通常就是该页开头的
       那个条目），切块保留了这层信号，轮转丢掉了它；
    3. 确定性：不依赖随机数，也不依赖 chunk 的绝对 id。

    **叶节点优先**：所有者 = 叶节点 + 章节附件。一页并列 3 个条目只有 1 个
    chunk 时，切块会让后两个什么也拿不到；让叶节点排在前面，饿着的是附件
    （它是「小结/习题/附录」这类容器，零内容不影响地图与掌握度），而不是
    微知识点（零内容会让它在图谱上永远是一块空白）。

    没有引入「按题干关键词挑所有者」：那会让归属随 OCR 错字漂移，同一份
    产物重跑不再是同一份。
    """
    ranges = leaf_page_ranges(flat_nodes)
    leaf_ids = {n['microKpId'] for n in flat_nodes if n['isLeaf']}
    terms_cache: dict[str, list[str]] = {}

    by_page: dict[int, list] = {}
    for c in chunks:
        by_page.setdefault(c.printed_page, []).append(c)

    for page, page_chunks in by_page.items():
        owners = owners_at(page, ranges)
        if not owners:
            for c in page_chunks:
                c.micro_kp_id = None
                c.answer_for = []
            continue
        ordered = [o for o in owners if o[0] in leaf_ids]
        ordered += [o for o in owners if o[0] not in leaf_ids]
        k, n = len(ordered), len(page_chunks)
        for i, c in enumerate(page_chunks):
            idx = 0 if k == 1 else min(k - 1, (i * k) // n)
            kp_id, name = ordered[idx][0], ordered[idx][1]
            terms = terms_cache.get(kp_id)
            if terms is None:
                terms = terms_cache[kp_id] = _core_terms(name)
            c.micro_kp_id = kp_id
            c.answer_for = [kp_id] if is_answer_block(c.text, c.kind, terms) else []
    return chunks


def assign_front_matter(chunks: list, flat_nodes: list[dict]) -> int:
    """
    把「第一个叶节点之前」的正文 chunk 归到首章容器，返回改动条数。

    `assign` 对页码落在所有叶节点区间之前的 chunk 保留 `micro_kp_id=None`
    （见其 docstring：封面和版权页不该变成「数字逻辑概论」的内容）。但一本书的
    第一个叶节点之前常常还有**正文**：章首页、章首概述、整版图页，以及目录里
    没有细目的章首小节 —— 这些页有实质内容，留成孤儿就是检索侧不可见
    （`content.controller.ts` 的子树 JOIN 直接跳过 `micro_kp_id IS NULL`）。

    两者的区别不是「页码小于首个叶节点」，而是**有没有落在正文范围内**：调用方
    （`books_batch` / `ocr_run`）已经在抽取阶段把印刷页 < 1 的前置页（前言、
    致谢、符号表，罗马页码）挡掉了，所以进到这里、页码仍 >= 0 且小于首个叶节点
    的 chunk 就是正文。

    挂到**章容器**（`depth == 1` 的节点）而不是叶节点：容器不是可掌握知识点，
    不会把章首页冒充成某个微知识点，也不会稀释叶节点的内容占比
    （`audit_assignment` 的零 chunk 叶子占比与最大单节点占比都不受影响）。

    这是 opt-in 的独立函数：`assign` 的默认行为不变，所以
    `test_assign.py::test_chunk_before_first_leaf_gets_no_kp` 仍然成立。
    """
    chapters = [n for n in flat_nodes if n.get('depth') == 1]
    if not chapters:
        return 0
    leaf_pages = [n['printedPage'] for n in flat_nodes if n['isLeaf']]
    if not leaf_pages:
        return 0
    first_leaf_page = min(leaf_pages)
    head = min(chapters, key=lambda n: n['printedPage'])
    moved = 0
    for c in chunks:
        if c.micro_kp_id is not None:
            continue
        if 0 <= c.printed_page < first_leaf_page:
            c.micro_kp_id = head['microKpId']
            c.answer_for = []
            moved += 1
    return moved


# 归属自检的判定阈值。两个数都是从两本已知书量出来的，不是拍脑袋：
#
# - **零 chunk 叶子占比**：干净的康华光（215 节点、目录排版规范）是 10/165
#   = 6.1%；王芝英修复前是 26/69 = 37.7%。门限取 15%，在两倍基线和故障值
#   之间。
# - **最大单节点占比**：康华光是 161/3546 = 4.5%；王芝英修复前 `kp-5`
#   2585/4884 = 52.9%。门限取 25% —— 一本教材的单个知识点占掉四分之一以上
#   内容必然是区间算错了。
#
# 刻意**不**用「合成节点（`kp-pNN-*`）占比」当指标：无编号目录行（`习题`、
# `小结`、`附录`）本来就该落到合成节点上，康华光这种干净数据也有 19.9%，
# 用它当报警线会在正常书上误报。
MAX_EMPTY_LEAF_SHARE = 0.15
MAX_SINGLE_NODE_SHARE = 0.25


def audit_assignment(chunks: list, flat_nodes: list[dict]) -> dict:
    """
    归属结果自检：把「目录解析坏了」从静默错误变成可见的警告。

    为什么必须有这一步：`assign` 永远会「成功」—— 每个 chunk 都会拿到某个
    `microKpId`，哪怕目录页码全错。修复前的王芝英就是这样：4884 个 chunk
    全部「归属成功」，实际上 52.9% 挤在一个知识点里、37.7% 的叶子颗粒无收。
    这种错误在 t17 建图谱时会原样放大成「第 6 章之后全是时间分析」。

    返回 `{total, emptyLeaves, leafCount, largest, largestShare, emptyShare,
    appendixCount, appendixChunks, warnings}`；`warnings` 为空表示没有发现异常。

    `appendixCount/appendixChunks` 是章节附件（小结/习题/附录）的节点数与
    挂在其下的 chunk 数。附件**不算叶节点**，所以不进 `emptyLeaves` 的
    分母 —— 否则一本把附录单独列出来的书会凭空多出一堆「零内容叶子」。
    """
    counts: dict[str, int] = {}
    for c in chunks:
        if c.micro_kp_id:
            counts[c.micro_kp_id] = counts.get(c.micro_kp_id, 0) + 1
    leaves = [n for n in flat_nodes if n['isLeaf']]
    appendix = [n for n in flat_nodes if n.get('appendix')]
    empty = [n['microKpId'] for n in leaves if not counts.get(n['microKpId'])]
    total = len(chunks) or 1
    largest, largest_n = ('', 0)
    if counts:
        largest, largest_n = max(counts.items(), key=lambda kv: kv[1])
    empty_share = len(empty) / len(leaves) if leaves else 0.0
    largest_share = largest_n / total

    warnings: list[str] = []
    if empty_share > MAX_EMPTY_LEAF_SHARE:
        warnings.append(
            f'零 chunk 叶子 {len(empty)}/{len(leaves)}（{empty_share:.1%}），'
            f'超过 {MAX_EMPTY_LEAF_SHARE:.0%} —— 目录页码可能有误'
        )
    if largest_share > MAX_SINGLE_NODE_SHARE:
        warnings.append(
            f'单知识点 {largest} 吞掉 {largest_n}/{len(chunks)}（{largest_share:.1%}），'
            f'超过 {MAX_SINGLE_NODE_SHARE:.0%} —— 页区间可能算错'
        )
    return {
        'total': len(chunks),
        'leafCount': len(leaves),
        'emptyLeaves': empty,
        'largest': largest,
        'largestShare': largest_share,
        'emptyShare': empty_share,
        'appendixCount': len(appendix),
        'appendixChunks': sum(counts.get(n['microKpId'], 0) for n in appendix),
        'warnings': warnings,
    }


def review_sample(chunks: list, flat_nodes: list[dict], n: int = 20) -> list[dict]:
    """
    抽检样本：一半来自被标为答案块的，一半来自同页未被标为答案块的。

    这个 1:1 是刻意的。只抽答案块只能看误标（假阳性），看不到漏标（假阴性）；
    两类错误在低掌握度学习者身上后果不同 —— 误标会让答案提前泄露，
    漏标会让背景材料被误当答案而拒答。
    """
    names = {n['microKpId']: n['name'] for n in flat_nodes}
    yes = [c for c in chunks if c.answer_for]
    no = [c for c in chunks if c.micro_kp_id and not c.answer_for]
    rng = random.Random(20261020)  # 固定种子，复核可重跑出同一批样本
    half = max(1, n // 2)
    picked = rng.sample(yes, min(half, len(yes))) + rng.sample(no, min(n - half, len(no)))
    rng.shuffle(picked)
    return [
        {
            'chunkId': c.id,
            'kp': names.get(c.micro_kp_id, '—'),
            'printedPage': c.printed_page,
            'kind': c.kind,
            'markedAsAnswer': bool(c.answer_for),
            'text': c.text[:160],
        }
        for c in picked
    ]



