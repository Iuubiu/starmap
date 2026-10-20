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
    把叶节点按页码摊成 `[(microKpId, name, start, end)]`，左闭右开。

    前提：`flat_nodes` 是目录的**深度优先**顺序且页码单调不减 —— 这是
    `toc.py` 的 `flatten()` 保证的，且有测试守着（215 节点 0 处逆序）。
    最后一个叶节点的 `end` 用一个足够大的数，兜住书末索引与附录。
    """
    leaves = [n for n in flat_nodes if n['isLeaf']]
    out: list[tuple[str, str, int, int]] = []
    for i, n in enumerate(leaves):
        start = n['printedPage']
        end = leaves[i + 1]['printedPage'] if i + 1 < len(leaves) else 10**6
        out.append((n['microKpId'], n['name'], start, end))
    return out


def owner_of(page: int, ranges: list[tuple[str, str, int, int]]) -> tuple[str, str] | None:
    """
    哪一页归哪个叶节点。用二分而不是线性扫描：3032 个 chunk × 165 个叶节点
    的暴力匹配在测试里明显变慢，而这张表是有序的。

    返回 `(microKpId, name)`；页码落在所有区间之外（目录页之前的封面等）返回 None。
    """
    lo, hi = 0, len(ranges) - 1
    best: tuple[str, str] | None = None
    while lo <= hi:
        mid = (lo + hi) // 2
        kp_id, name, start, end = ranges[mid]
        if page < start:
            hi = mid - 1
        elif page >= end:
            lo = mid + 1
        else:
            best = (kp_id, name)
            break
    return best


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
    """
    ranges = leaf_page_ranges(flat_nodes)
    names = {n['microKpId']: n['name'] for n in flat_nodes}

    for c in chunks:
        owner = owner_of(c.printed_page, ranges)
        if owner is None:
            c.micro_kp_id = None
            c.answer_for = []
            continue
        kp_id, name = owner
        c.micro_kp_id = kp_id
        c.answer_for = (
            [kp_id] if is_answer_block(c.text, c.kind, _core_terms(name)) else []
        )
    return chunks


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



