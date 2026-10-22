"""非中文点线目录的解析：15 本英文/中文教材的目录 → 知识点树。

## 为什么需要这个模块

`toc.py` 的 `parse_toc_text` 只认一种版式：`编号 + 标题 + ⋯ 填充 + 页码`
**同一行**。中文点线目录（康华光、童诗白、李瀚荪…）是这个版式，12 本老书
就是这么进来的。但资源库里剩下 15 本书的目录是另外几种版式，一条都认不出：

| 版式 | 代表书 | 长相 |
|---|---|---|
| A 点线引导单行 | 08/14/15 | `2.4\tProbability Distributions and Random Variables. . . . . . 20` |
| B 编号独占一行 | 09/13/16 | `2.4` / `Probability Distributions…` / `20` |
| C 罗马数字章标题 | 03/04 | `CHAPTER 6` / `PROPORTIONAL COUNTERS` / `182`，小节用 `I. II. III.` |
| D 标题行 + 页码在下一行 | 12 | `1. Basic Nuclear Processes ….` / `1` |
| E 章标题带页码，节编号独立成行 | 14 | `Chapter 1` / `Front-end Specifications ….1` / `1.1` / `Basic features ….2` |
| F 中文 outline | 26/27 | PDF 内置书签 |

## 对外只有 `parse_book()`

它**不静默返回空树**。票 02 的教训：目录解析失败时如果返回 `[]`，
`import-content` 会照常 COMMIT、照常打印「导入完成」，只是这本书一个知识点
都没进库，而库里看不出少过。所以解析不出东西时必须抛错，并把没解析出来的
原始行打出来，让人能照着补规则。

## 与 `toc.py` 的分工

`toc.py` 一行不改（content-dev 正在同一目录做 OCR 侧的票 17）。本模块复用
它的 `TocEntry` / `build_tree` / `flatten` / `nodes_from_flat`，只在解析这一段
另起一套。产出仍是 `list[TocEntry]`，下游完全一致。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf

from toc import TocEntry, is_answer_key_title, is_appendix_title


# ---------------------------------------------------------------------------
# 条目
# ---------------------------------------------------------------------------


@dataclass
class BookTocEntry(TocEntry):
    """带原始英文标题的目录条目。

    `name` 会译成中文（D10 红线：面向用户的名称必须是中文），原始英文留在
    `name_original`，否则「这个知识点来自 Knoll 的哪一节」无法追查 ——
    译者永远可能译错，可追溯性不能依赖译者的正确性。
    """

    name_original: str = ''


# 前置内容：不进知识点树（不是可学内容，也没有页码意义）
_FRONT_MATTER = frozenset(
    {
        'contents',
        'table of contents',
        'brief contents',
        'preface',
        'preface to the first edition',
        'preface to the second edition',
        'preface to the third edition',
        'preface to the fourth edition',
        'dedication',
        'about the author',
        'about the cover',
        'credits',
        'table index',
        'list of tables',
        'list of figures',
        'acknowledgements',
        'acknowledgments',
        'foreword',
        'symbols',
        'abbreviations',
    }
)

# 书末附件：保留成附录节点（页区间要用它们兜住书末，否则最后一章会把整本
# 索引/答案吞成自己的正文 —— 票 02 在康华光上踩过这个，514 个答案 chunk
# 因此全被算成正文）。
_EN_APPENDIX_EXACT = frozenset(
    {
        'index',
        'references',
        'bibliography',
        'further reading',
        'appendix',
        'appendices',
        'problems',
        'exercises',
        'summary',
        'solutions to problems',
        'answers to problems',
        'solutions to exercises',
        'answers to exercises',
        'answers',
    }
)
_EN_APPENDIX_PREFIX = re.compile(r'^(appendix|appendices)\b', re.IGNORECASE)
# 答案附录：整本答案汇编，票 09 的答案块门控要靠它按书取 chunk
#
# 旧判据（**整名** 之外的那条 `.*` 分支）保留作退路：`Answers to Selected
# Problems` 这种带限定词的写法整名正则认不出，但它确实是答案附录。两条都要求
# 先过 `is_en_appendix` 或整名匹配，所以不会命中正文里以 Solution 开头的句子。
_EN_ANSWER_KEY = re.compile(
    r'^(answers?|solutions?)\b.*\b(problems?|exercises?)\b|^(answers?|solutions?)$',
    re.IGNORECASE,
)
#: 英文答案附录的**整名**判据（票 38）。
#:
#: 为什么必须整名而不是包含：15 本英文书里有大量正文小节的名字带
#: `problems`/`exercises` —— 17 Gilmore 的 `Electronic timing problems`
#: （p160）、`Assessment of intercomparison exercises`（p311）都是可学知识点，
#: 不是答案附录。用 `'answers' in title` 这种包含判据会把它们一起降级。
#: 整名还挡得住 15 Lutz 的 `Numerical Solution of Stationary Situations`。
_EN_ANSWER_APPENDIX = re.compile(
    r'^\s*(?:appendix\s*[A-Z0-9]?\s*[:.]?\s*)?'
    r'(?:answers?|solutions?|answer\s*key|selected\s+(?:answers?|solutions?))'
    r'(?:\s+(?:to|for))?\s*(?:the\s+)?'
    r'(?:problems?|exercises?|questions?)?\s*$',
    re.IGNORECASE,
)

#: 中文答案附录里必须出现的「学科词」。
#:
#: `toc.is_answer_key_title()` 要求标题先被判成附件（在 `_APPENDIX_EXACT` 词表
#: 里），而郭江 2014 的「习题参考答案」不在那张表里 —— 它一直是个 `isLeaf=true`
#: 的可学知识点，正文就是整本答案。补这一条：**以答案类词收尾 + 含学科词**
#: 才算，`答案要点`（正文小节）不会命中。
_CN_EXERCISE_WORDS = ('习题', '练习题', '思考题', '自测题', '试题', '复习题')
#: 中文标题尾部的「（上册）」不是标题主体，比对前剥掉（与 `toc._TRAILING_PAREN` 同义）。
_CN_TRAILING_PAREN = re.compile(r'[（(][^（()）]{1,8}[)）]\s*$')


def is_en_appendix(title: str) -> bool:
    t = re.sub(r'\s+', ' ', title or '').strip().lower()
    if not t:
        return False
    return t in _EN_APPENDIX_EXACT or bool(_EN_APPENDIX_PREFIX.match(t))


def is_en_answer_key(title: str) -> bool:
    t = re.sub(r'\s+', ' ', title or '').strip()
    if not t:
        return False
    if _EN_ANSWER_APPENDIX.match(t):
        return True
    return is_en_appendix(t) and bool(_EN_ANSWER_KEY.match(t))


def _cn_answer_key(title: str) -> bool:
    """中文答案附录：`toc.is_answer_key_title` 之外的补充判据。

    只补一类：**带学科词、以答案类词收尾、但不在 `toc._APPENDIX_EXACT` 词表里**
    的标题（27 郭江 2014 的「习题参考答案」）。故意**不**接受光杆的「解答」
    「答案」「题解」：它们自己在中文口径里不被当成附件（`toc.is_appendix_title`
    返回 False），这里放宽会让正文小节被误降级。09 Grupen 那一本靠英文原名
    `Solutions` 命中，不靠这一支。
    """
    t = re.sub(r'\s+', '', title or '')
    t = _CN_TRAILING_PAREN.sub('', t)
    if not t or not t.endswith(('答案', '解答', '题解')):
        return False
    return any(word in t for word in _CN_EXERCISE_WORDS)


def is_appendix(title: str) -> bool:
    """中英统一口径的附件判定。

    英文书用本模块的 `_EN_APPENDIX_*`；中文书（26/27 郭江）必须回到
    `toc.is_appendix_title` —— 它在票 02 已经把「小结/习题/参考答案/附录/
    参考文献」这套中文词表调好了，再写一份英文正则去认中文等于两套真源。
    """
    return is_en_appendix(title) or is_appendix_title(title)


def is_answer_appendix_title(name: str, name_original: str = '') -> bool:
    """这条目录条目是不是「答案附录」（整本习题答案/参考解答）。

    ## 为什么要新开一个函数而不是改 `toc.is_answer_key_title`

    `toc.py` 那条是**中文**判据，且被 12 本已入库中文书的 5 个答案附录钉住了；
    改它等于同时动 5 个既有节点的判定。这里把「中文复用 + 英文整名」合在一处，
    只影响 `toc_books.py` 解析的 15 本书。

    ## 两个入参的分工

    - `name` 是**译名**（入库后学习者看到的那一列）。中文判据看它。
    - `name_original` 是原书标题。英文判据看它 —— 中文译名会把 `Solutions`
      译成「解答」，只靠译名就再也认不出原文是答案附录。

    两个都试、任一中即算：`_build_tree` 挂树时两者都还是原文标题，调用方也只
    传一个参数；产物补丁脚本拿的是 toc.json 里的两列，各归各位。

    ## 实测覆盖（15 本，2026-10-21）

    - 09 Grupen 的 `Solutions`（p533，章 18）：旧判据漏它，因为它既不在
      `_EN_APPENDIX_EXACT` 里、也不是 `answers to problems` 这种完整写法。
      它名下的正文是第 1–16 章习题解答。
    - 27 郭江 2014 的「习题参考答案」（p221）：旧判据漏它，因为它不在
      `toc._APPENDIX_EXACT` 词表里。
    - 反例（必须不命中）：17 Gilmore 的 `Electronic timing problems` /
      `Assessment of intercomparison exercises`、15 Lutz 的
      `Numerical Solution of Stationary Situations`。

    两个入参是 **OR** 关系而不是「译名优先」：任一侧能独立判成答案附录就够了，
    两侧都判不成才是否。译名「解答」单独拿出来不算（它不是附件），但配上原名
    `Solutions` 就算 —— 这正是 09 Grupen 那一行的形态。
    """
    if is_answer_key_title(name):
        return True
    if _cn_answer_key(name):
        return True
    return is_en_answer_key(name_original) or is_en_answer_key(name)


def is_answer_key(title: str) -> bool:
    """兼容旧调用：只看一个标题时的答案附录判定。"""
    return is_answer_appendix_title(title, title)


# ---------------------------------------------------------------------------
# 文本归一化
# ---------------------------------------------------------------------------

# 目录页里常见两种空白：`\u2003`（em space，08 用它在编号与标题间留空）、
# `\xa0`（不换行空格，08/14 的标题里混着）。统一成普通空格再折叠，否则
# `1.3 Errors and Accuracy …` 会在标题中间带一个不可见字符，翻译与比对都会
# 莫名其妙地不匹配。
_WS = re.compile(r'[\s\u00a0\u2000-\u200b\u202f\u205f\u3000]+')

#: C0 控制字符（含 NUL）。
#:
#: 两个真实来源，都不是我们造的：
#: 1. **PDF 书签里的内嵌字体表**：10 Ahmed 的 outline 里 `D.1 Anthracene`
#:    后面跟着 `\x00\u3100...`（一段被当成字符的字体名），它会变成知识点名，
#:    `import-content` 直接报 `invalid byte sequence for encoding "UTF8": 0x00`。
#: 2. **正文 span 里的残留**：14 Rivetti 的公式行夹着 `\x00\x01`。
#:
#: 不洗的后果不是「难看」，是**整本书导不进去**。所以目录标题走 `_norm`、
#: 正文走 `extract.py` 的 `_spans_of`，两层都洗。
_CTRL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
# 点线/引导符：`.` `·` `•` `…` `⋯`，允许中间夹空格（` . . . ` 是 08 的写法）
_LEADERS = re.compile(r'(?:\s*[.·•…⋯]\s*){3,}')


def _norm(raw: str) -> str:
    return _WS.sub(' ', _CTRL.sub('', raw).replace('\t', ' ')).strip()


# ---------------------------------------------------------------------------
# 行模式
# ---------------------------------------------------------------------------

_PAGE_ONLY = re.compile(r'^[.·•\-—–_|]*\s*(\d{1,4})\s*$')
# 页码行被 OCR 弄脏：`M4`、`|4`、`_4`（04 Knoll 4th 的实测长相）
_PAGE_MESSY = re.compile(r'^[A-Za-z|_]{1,3}\s*(\d{1,4})$')
_CHAPTER = re.compile(r'^(?:CHAPTER|Chapter|chapter)\s*([0-9IlOo]{1,3}(?:\s+[0-9IlOo]{1,2})?)?\s*\.?$')
_SECTION = re.compile(r'^SECTION\s+([A-Z])\s*$', re.IGNORECASE)
# 编号独占一行：`2.4`、`1.`、`4.2.1`
_NUM_ONLY = re.compile(r'^(\d{1,2}(?:\.\d{1,3}){0,3})\.?\s*$')
# 编号 + 同行内容：`1.1 Nuclear Level Diagrams ....... 2`
_LEAD_NUM = re.compile(r'^(\d{1,2}(?:\.\d{1,3}){0,3})\.?\s+(\S.*)$')
# 点线引导 + 页码
_DOTLEAD = re.compile(r'^(.*?)[\s.]*(?:[.·•…⋯]\s*){3,}\s*(\d{1,4})\s*$')
# 点线引导但页码在下一行（12 Leo）
_DOTLEAD_NO_PAGE = re.compile(r'^(.*?)[\s.]*(?:[.·•…⋯]\s*){3,}\s*$')
# 罗马小节标记。04 的 OCR 把它认成 `it`/`Ill.`/`VU.`/`_`，所以字符集放宽到
# `t T U u`，并且**不信任字面值**：按出现次序数第几个（见 `_roman_index`）。
_ROMAN_TOKEN = re.compile(r'^[IVXivxIl1|._tTUu]{1,6}\s*\.?$')
_PLAIN_TITLE = re.compile(r'^[A-Za-z\u4e00-\u9fff(].*$')


@dataclass
class _Raw:
    num: str
    title: str
    page: int


def _roman_index(token: str) -> int:
    """罗马数字标记 → 1 起的序号。**只用于校验，不用于取值**。

    04 的目录里 `I.` 之后的那个标记 OCR 成了 `it`，`III.` 成了 `Ill.`；
    字面解析会把 `it` 当成 0 或抛错。调用方按出现次序递增，这里给出的值
    只用来在两者一致时确认没有漏行。
    """
    t = re.sub(r'[^IVXivx]', '', token)
    if not t:
        return 0
    vals = {'I': 1, 'V': 5, 'X': 10}
    total = 0
    prev = 0
    for ch in t.upper()[::-1]:
        v = vals.get(ch, 0)
        total += -v if v < prev else v
        prev = max(prev, v) if v >= prev else prev
    return total


# ---------------------------------------------------------------------------
# 版式识别
# ---------------------------------------------------------------------------


@dataclass
class ParseReport:
    """解析过程的账本。出问题时靠它定位，不靠猜。"""

    layout: str = ''
    entries: int = 0
    numbered: int = 0
    chapters: int = 0
    skipped_front: int = 0
    page_repaired: int = 0
    unparsed: list[str] = field(default_factory=list)


class TocParseError(RuntimeError):
    """目录解析失败。**不允许降级成空树**。"""


def _collect_rows(doc: pymupdf.Document, toc_pages: tuple[int, int] | list[int]) -> list[list[str]]:
    """把目录页按**基线**聚成行，行内按 x 排序。

    ## 为什么不能按 `get_text().splitlines()`

    03 Knoll 3rd 的目录是双栏排版：`CHAPTER 6` 在左栏、`PROPORTIONAL COUNTERS`
    在中栏、`182` 在右栏，三者**基线相同**。按纯文本流取回来会丢掉这层关系，
    再靠行序猜「谁是页码、谁是标题」必然出错（实测丢了 40% 条目、39 个假根）。

    同一基线的单元格本来就是同一行，分开取等于把版式信息扔掉再猜回来。
    这里保留 `(x, 基线)` 两个坐标，行内左右拼接，行间按基线排序。

    容差取「页内字号中位数 × 0.4」而不是固定磅值：目录页上标字号 20pt、
    正文 10pt，固定 2pt 会把上标行与邻行粘在一起（实测把 `CONTENTS` 页眉
    粘到了 `SECTION A`）。
    """
    if isinstance(toc_pages, (tuple, list)) and len(toc_pages) == 2 and isinstance(toc_pages[0], int):
        first, last = int(toc_pages[0]), int(toc_pages[1])
        pages = list(range(first, min(last, doc.page_count)))
    else:
        pages = [p for p in toc_pages if 0 <= p < doc.page_count]

    rows: list[list[str]] = []
    for i in pages:
        items: list[tuple[float, float, str, float]] = []
        for block in doc[i].get_text('dict')['blocks']:
            if block['type'] != 0:
                continue
            for line in block['lines']:
                text = _norm(''.join(span['text'] for span in line['spans']))
                if not text:
                    continue
                origins = [span['origin'][1] for span in line['spans']] or [line['bbox'][1]]
                base = sorted(origins)[len(origins) // 2]
                size = max([span['size'] for span in line['spans']] or [10.0])
                items.append((base, line['bbox'][0], text, size))
        if not items:
            continue
        sizes = sorted(it[3] for it in items)
        tol = max(2.0, sizes[len(sizes) // 2] * 0.4)
        items.sort()
        groups: list[list] = []
        for base, x, text, size in items:
            if groups and abs(base - groups[-1][0]) <= tol:
                groups[-1][1].append((x, text))
            else:
                groups.append([base, [(x, text)]])
        for _base, cells in groups:
            rows.append([text for _x, text in sorted(cells)])
    return rows


# 页码单元格：纯数字，允许前后有 `.·-—_|` 与括注
_CELL_PAGE = re.compile(r'^[.·•\-—–_|(\[\s]*(\d{1,4})[).\]\s]*$')
# 页码被 OCR 弄脏：`M4`、`|4`、`_4`（04 Knoll 4th 的实测长相）
_CELL_PAGE_MESSY = re.compile(r'^[A-Za-z|_]{1,3}\s*(\d{1,4})$')
# 页码被 OCR 拆成两段：03 Knoll 3rd 的 `1 04`（=104）/ `1 69` / `1 91`。
# 百位与后两位之间多了一个空格，靠 `_CELL_PAGE` 认不出来。
_CELL_PAGE_SPLIT = re.compile(r'^(\d)\s+(\d{2})$')
# 章标记单独一格。末尾的 `S?` 必须留着：03 Knoll 3rd 把 `CHAPTER 5` OCR 成了
# `CHAPTERS`，整行匹配不上时章标题会被拼进上一节的标题（实测得到
# `GAS-FILLED DETECTORS CHAPTERS IONIZATION CHAMBERS`）。章号本身按「上一个+1」
# 递增，字面数字丢了不影响编号。
_CELL_CHAPTER = re.compile(r'^(?:CHAPTER|Chapter|chapter)S?\s*([0-9IlOo]{1,3}(?:\s+[0-9IlOo]{1,2})?)?\s*\.?$')
# 章标记被 OCR 拆成两格：`Chapter` | `3`（04 Knoll 4th 的 `Chapter 3` 有时如此）。
_CELL_CHAPTER_BARE = re.compile(r'^(?:CHAPTER|Chapter|chapter)S?\s*\.?$')
_CELL_CHAPTER_NUM = re.compile(r'^([0-9IlOo]{1,2})\s*\.?$')
# 章标记与标题同格（08 Tsoulfanidis 的 `Chapter 2. Errors of Radiation Counting`）
_CELL_CHAPTER_INLINE = re.compile(
    r'^(?:CHAPTER|Chapter|chapter)\s+([0-9IlOo]{1,3})\.?\s+(\S.*)$'
)
_CELL_SECTION = re.compile(r'^SECTION\s+([A-Z])\s*$', re.IGNORECASE)
_CELL_NUM = re.compile(r'^(\d{1,2}(?:\.\d{1,3}){0,3})\.?$')
_CELL_LEAD_NUM = re.compile(r'^(\d{1,2}(?:\.\d{1,3}){0,3})\.?\s+(\S.*)$')
_CELL_ROMAN = re.compile(r'^[IVXivxIl1|._tTUu]{1,6}\s*\.?$')

# 点线引导（leader dots）：标题与页码之间那串 `. . . . .`，08/14/15 的版式。
# 16 进制这类假点线（`0.504`）只有 1 个点，不会命中 `{3,}`。
_CELL_PAGE_LEADERS = re.compile(r'^(.*?)[\s.]*(?:[.·•…⋯]\s*){3,}\s*(\d{1,4})$')
_CELL_ROMAN_PAGE_LEADERS = re.compile(r'^(.*?)[\s.]*(?:[.·•…⋯]\s*){3,}\s*([ivxlcdm]{1,8})\s*$', re.IGNORECASE)
_CELL_LEADERS_ONLY = re.compile(r'^(.*?)[\s.]*(?:[.·•…⋯]\s*){3,}\s*$')
_CELL_PAGE_ROMAN = re.compile(r'^[.\s]*([ivxlcdm]{1,8})[.\s]*$', re.IGNORECASE)

_ROMAN_VALUES = {'i': 1, 'v': 5, 'x': 10, 'l': 50, 'c': 100, 'd': 500, 'm': 1000}


def _roman_to_int(token: str) -> int:
    """罗马数字 → 整数。只用于目录页码（xix / xxiii），不用于章节编号。"""
    total = 0
    prev = 0
    for ch in token.lower()[::-1]:
        value = _ROMAN_VALUES.get(ch, 0)
        total += -value if value < prev else value
        prev = max(prev, value)
    return total


def _row_cell_page(cell: str) -> tuple[str, int] | None:
    """把「标题 + 点线 + 页码」的一格拆成 (标题, 页码)。

    返回 None 表示这一格不是「标题带页码」。罗马页码（`xix`）换成负数：
    前置内容的页码对正文没有意义，标记成负数让 `_score` 与正文条目区分开，
    同时保留「这一行确实有页码」的信息。
    """
    m = _CELL_PAGE_LEADERS.match(cell)
    if m and m.group(1).strip(' .'):
        return m.group(1).strip(' .'), int(m.group(2))
    m = _CELL_ROMAN_PAGE_LEADERS.match(cell)
    if m and m.group(1).strip(' .'):
        return m.group(1).strip(' .'), -_roman_to_int(m.group(2))
    return None


# 标题正文前残留的竖线 / 引号 / 下划线（OCR 把分栏线当字符）：
# 04 Knoll 4th 的 `| Heavy Charged Particle Sources`、`‘Interaction of Fast Electrons`。
_TITLE_LEAD_JUNK = re.compile(r'^[|\u2018\u2019\u201c\u201d\'"_~^*\-\u2013\u2014\s]+')


def _clean_title(title: str) -> str:
    return _TITLE_LEAD_JUNK.sub('', title).strip(' .·-')


#: 标题至少要有一个字母/汉字，且不短于 3 个字符。16 Nicholson 的目录里混着
#: `s` / `X` / `‘` 这类单字符行（页码列的残渣），当成条目会造出名叫「s」的章。
#: 宁可漏掉一条，也不造假知识点 —— 漏条还可以从条数统计里发现。
_TITLE_TEXT = re.compile(r'[A-Za-z\u4e00-\u9fff]')


def _looks_like_title(title: str) -> bool:
    if not (_TITLE_TEXT.search(title) and len(title.strip()) >= 3):
        return False
    # 图表清单（`Table 11.2 Parameters of the PACH Fission Fragment Spectrum`）
    # 不是章节，但它的行长得和目录条目一样。03/04 Knoll 的目录页后面跟着一整页
    # 这类清单，不滤掉就会造出一批名叫「Table …」的知识点，其中一条还把那
    # 整页表格串成了一个 600 字的标题。
    if _TITLE_TABLE_LIST.match(title.strip()):
        return False
    # 目录页被 OCR 污染时偶尔会把两三行粘成一条。长度本身就是证据：
    # 最长的正经标题（`Semiconductor Materials Other Than Silicon or Germanium`）
    # 不到 70 字符，120 留了一倍余量。
    return len(title.strip()) <= 120


_TITLE_TABLE_LIST = re.compile(r'^(tables?|figures?)\b', re.IGNORECASE)


# 罗马小节标记与标题同格：`I. | Simplified Detector Model`。
# 行的单元格被 OCR 粘成一格（分栏线变成 `|`），`_CELL_ROMAN` 只认整格是罗马数字。
_CELL_ROMAN_INLINE = re.compile(r'^([IVX]{1,6})\s*\.\s*(?:\|\s*)?(\S.*)$')


def _roman_at_start(text: str) -> tuple[int, str] | None:
    """`I. Title` → (1, 'Title')；不是罗马标记就返回 None。"""
    m = _CELL_ROMAN_INLINE.match(text.strip())
    if not m:
        return None
    token = m.group(1)
    # 只要规范的罗马串：`III` 可以，`IIII` / `VX` 不行（那些是 OCR 噪声）。
    if _roman_to_int(token) < 1 or token != _int_to_roman(_roman_to_int(token)):
        return None
    return _roman_to_int(token), _clean_title(m.group(2))


def _int_to_roman(value: int) -> str:
    pairs = ((10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I'))
    out = []
    for number, symbol in pairs:
        while value >= number:
            out.append(symbol)
            value -= number
    return ''.join(out)

def _row_page(cells: list[str]) -> tuple[int | None, list[str]]:
    """从行尾找页码。返回 (页码, 去掉页码后的单元格)。

    三种页码形态都要认：
    - 独占一格（09/13/16）：`['2.4', 'Title', '20']`
    - 与标题同格、点线引导（08/14）：`['2.4', 'Title. . . . . 20']`
    - 独占一行、前面一行只有点线（15 Lutz）：`['Introduction . . . . .']` / `['1']`
    """
    for idx in range(len(cells) - 1, -1, -1):
        cell = cells[idx]
        split = _CELL_PAGE_SPLIT.match(cell)
        if split:
            return int(split.group(1)) * 100 + int(split.group(2)), cells[:idx] + cells[idx + 1:]
        m = _CELL_PAGE.match(cell) or _CELL_PAGE_MESSY.match(cell)
        if m:
            return int(m.group(1)), cells[:idx] + cells[idx + 1:]
        split = _row_cell_page(cell)
        if split is not None:
            title, page = split
            return page, cells[:idx] + [title] + cells[idx + 1:]
    return None, cells


def _strip_leaders(cells: list[str]) -> list[str]:
    """去掉只有点线没有页码的格尾（12 Leo / 15 Lutz 的折行版式）。"""
    out = []
    for cell in cells:
        m = _CELL_LEADERS_ONLY.match(cell)
        out.append(m.group(1).strip(' .') if m and m.group(1).strip(' .') else cell)
    return out


# 纯标点垃圾格：16 Nicholson 的目录被 OCR 弄出大量 `:` `;` `‘` `-` `_` 孤格，
# 拼进标题会变成「Pulse Shaping Methods for Spectroscopy . ; : ‘ a」。
# 只丢**完全没有文字与数字**的短格，正常标题不会长成这样。
_CELL_JUNK = re.compile(r'^[^\w\u4e00-\u9fff]{0,4}$')


def _drop_junk(cells: list[str]) -> list[str]:
    return [c for c in cells if not _CELL_JUNK.match(c.strip())]


# 12 Leo：`1 .11.1 Fluctuations in Radioactive Decay` —— 编号里的第一个点前被
# OCR 插了一个空格，`_CELL_LEAD_NUM` 只吃到 `1`，剩下 `11.1 ...` 被当标题，
# 结果 1.11.1 变成 depth-1 的第 1 章。先把 `1 .11` 粘回 `1.11` 再分词。
_CELL_NUM_GLUE = re.compile(r'^(\d{1,2})\s+\.\s*(\d)', re.UNICODE)


def _glue_number(cells: list[str]) -> list[str]:
    out: list[str] = []
    for cell in cells:
        out.append(_CELL_NUM_GLUE.sub(r'\1.\2', cell))
    return out


def _parse_numeric(rows: list[list[str]]) -> tuple[list[_Raw], ParseReport]:
    """行（而非文本流）驱动的目录解析，一次覆盖 A/B/C/D/E 五种版式。

    这些版式的区别只在「编号、标题、页码」各占几个单元格、怎么排布。按行
    处理后它们退化成同一个问题：这一行里有页码吗？有章标记吗？有编号吗？
    剩下的单元格就是标题。

    ## 逐行判定顺序（顺序本身是规则的一部分）

    1. `CONTENTS`/`Preface` 等前置内容 → 整行跳过；
    2. 章标记（`CHAPTER 6` / `Chapter 1` / OCR 的 `CHAPTERS`）→ 章号按
       「上一个 + 1」递增（字面值只用来确认没漏章）；
    3. 编号独占单元格（`2.4`）→ 记为待用编号；
    4. 罗马小节标记（`I.`/`II`，OCR 可能认成 `it`/`Ill.`）→ 按出现次序编号；
    5. 其余单元格拼成标题；有页码就落一条，没有就进 pending 等下一页续行。

    **页码判定先于编号判定**：`3` 既是合法页码也是合法章号，靠位置分不清，
    但「标题已经读到、同一行又有纯数字」只可能是页码。03 的
    `CHAPTER 1 / RADIATION SOURCES / 3` 就是这么被吃掉 40 条条目的。
    """
    out: list[_Raw] = []
    rep = ParseReport(layout='numeric')
    chapter: int | None = None
    roman_at = 0
    pending_num: str | None = None
    pending_title: str | None = None

    def flush(page: int) -> bool:
        nonlocal pending_num, pending_title
        if pending_title is None:
            return False
        if not _looks_like_title(pending_title):
            # 16 Nicholson 的目录被 OCR 弄出 `s` / `X` / `‘` 这类单字符行，
            # 当成条目会造出名叫「s」的章。宁可漏一条也不造假节点。
            # **判据必须放在 flush 里，不能放在主循环的 continue**：这些书的
            # 页码经常单独一行跟在标题后面，主循环里 continue 会连页码一起
            # 吃掉，后面所有条目都接不上页码（实测 04 Knoll 4th 的 3.x/4.x
            # 整段丢完，140 条掉到 116 条）。
            pending_num, pending_title = None, None
            return False
        # `pending_num` 明确是空串时**不要**回落成当前章号：无编号条目
        # （`References`/`Index`/`Further Reading`）一旦继承章号，就会变成
        # 一个新的 depth-1 章，把后面真正的章挤成它的子节点。
        raw_num = pending_num if pending_num is not None else ''
        out.append(_Raw(raw_num, pending_title, page))
        pending_num, pending_title = None, None
        return True

    for cells in rows:
        if not cells:
            continue
        joined = ' '.join(cells).strip()
        low = joined.lower()
        if low in _FRONT_MATTER or low.rstrip('.') in _FRONT_MATTER or _looks_like_front_matter(low):
            rep.skipped_front += 1
            pending_num, pending_title = None, None
            continue

        page, rest = _row_page(list(cells))
        rest = _strip_leaders(rest)
        rest = _drop_junk(rest)
        rest = _glue_number(rest)

        chapter_marked = False
        for idx, cell in enumerate(rest):
            inline = _CELL_CHAPTER_INLINE.match(cell)
            if inline:
                rest[idx] = inline.group(2)
                chapter_marked = True
                break
            if _CELL_CHAPTER.match(cell):
                rest.pop(idx)
                chapter_marked = True
                break
            if _CELL_CHAPTER_BARE.match(cell) and idx + 1 < len(rest) and _CELL_CHAPTER_NUM.match(rest[idx + 1]):
                # `Chapter` 与 `3` 各占一格：两格一起吃掉，章号依旧走「上一个+1」
                del rest[idx : idx + 2]
                chapter_marked = True
                break
        if chapter_marked:
            chapter = (chapter or 0) + 1
            roman_at = 0
            pending_num, pending_title = None, None
            if not rest and out:
                # 04 Knoll 4th 的章标题与 `Chapter N` 行**不在同一基线**：OCR 把它们
                # 拆成两行，标题行在前（看起来像个无编号条目），标记行在后。
                # 实测缺了 3/13/14 三章 —— 标题都被当成上一章的节。这里回看一条：
                # 若上一条是「刚落的无编号条目」，它就是这个章的标题。
                prev = out[-1]
                if prev.num == '' and not is_en_appendix(prev.title):
                    prev.num = str(chapter)

        rest = [c for c in rest if not _CELL_SECTION.match(c)]

        num_token: str | None = None
        for idx, cell in enumerate(rest):
            m = _CELL_NUM.match(cell)
            if m:
                num_token = m.group(1)
                rest.pop(idx)
                break
        if num_token is None and chapter is not None and not chapter_marked:
            for idx, cell in enumerate(rest):
                if _CELL_ROMAN.match(cell):
                    roman_at += 1
                    num_token = f'{chapter}.{roman_at}'
                    rest.pop(idx)
                    break

        lead_num: str | None = None
        if num_token is None and len(rest) == 1:
            m = _CELL_LEAD_NUM.match(rest[0])
            if m:
                lead_num, rest = m.group(1), [m.group(2)]

        title = _clean_title(' '.join(rest))
        if chapter_marked:
            num_token = str(chapter)
        elif num_token is None and not chapter_marked and rest:
            # 罗马小节标记与标题粘成一格：`I. | Simplified Detector Model`。
            roman = _roman_at_start(rest[0]) if len(rest) == 1 else None
            if roman is not None and chapter is not None:
                roman_at += 1
                num_token = f'{chapter}.{roman_at}'
                title = roman[1]
        elif num_token is None and is_en_appendix(title):
            # 书末附件没有编号。给空串让 `_build_tree` 把它挂到当前章下面
            # （`stack[0]` 是当前这一章的根），而不是让 `flush()` 回落成章号。
            num_token = ''

        if page is None and chapter_marked and title:
            # 章标记行没有页码（04 的 `Chapter 2 / Radiation Interactions`，
            # 页码在别处）。**立刻落一条**，否则后面第一节的标题会被拼进
            # 章名（实测得到「Radiation Interactions Interaction of Heavy
            # Charged Particles」）。页码先用上一条，最后一遍单调修复兜底。
            page = out[-1].page if out else 1

        if page is None:
            # 没有页码：可能是折行续写的标题，也可能是「编号与标题都读到了、
            # 页码在下一行」（15 Lutz / 12 Leo 的版式）。
            if title:
                if pending_title is not None:
                    pending_title = f'{pending_title} {title}'
                else:
                    pending_title = title
                if num_token is not None and pending_num is None:
                    pending_num = num_token
            continue

        if page < 0:
            # 罗马页码 = 前置内容（Preface / Contents / Authors），不进知识点树
            rep.skipped_front += 1
            pending_num, pending_title = None, None
            continue

        if lead_num is not None:
            out.append(_Raw(lead_num, title, page))
            pending_num, pending_title = None, None
            rep.entries += 1
            continue

        if num_token is not None:
            pending_num = num_token
        if title:
            if pending_title is not None and pending_num is None:
                pending_title = f'{pending_title} {title}'
            elif pending_title is not None and pending_num is not None and pending_num != num_token:
                pending_title = f'{pending_title} {title}'
            else:
                pending_title = title
        if flush(page):
            rep.entries += 1

    rep.page_repaired = _repair_pages(out)

    return out, rep


# 前置内容的宽松判据：`Contents` / `Preface to the Fourth Edition` /
# `Authors` / `List of Tables` / `Internet Resources within the Book` 等。
# 精确集合（`_FRONT_MATTER`）认不出带副标题与出版信息的变体。
_FRONT_MATTER_PREFIX = re.compile(
    r'^(contents|table of contents|brief contents|preface|foreword|dedication|'
    r'about the author|about the cover|credits|list of (tables|figures)|'
    r'acknowledg|internet resources|symbols|abbreviations|authors?|'
    r'封面|目录|内容简介|前言|序言|凡例)',
    re.IGNORECASE,
)


def _looks_like_front_matter(low: str) -> bool:
    return bool(_FRONT_MATTER_PREFIX.match(low.strip(' .·-')))


def _repair_pages(entries: list[_Raw], window: int = 3, tolerance: int = 100) -> int:
    """目录页码的两类 OCR 损伤，两种修法。

    ## 一、离群点（Hampel 滤波）

    OCR 会把数字认错：04 Knoll 4th 有一条 `829)`，真值是 `329`。这类错误
    不能靠「单调递增」修 —— 单向拉平会把它之后所有页号都抬到 829，等于
    毁掉后半本书（实测 10~19 章全变成 829 页）。

    改法：取前后各 `window` 条的中位数，偏离超过 `tolerance` 页就当离群点
    换成中位数。目录里相邻条目最多差几十页，100 页的容差不会误伤正常的
    跨章跳跃（03 Knoll 3rd 最长一章 65 页）。

    ## 二、单调性

    修完离群点后再拉成非降序：目录页码沿书递增，剩下的递减只可能是 OCR
    丢位（03 的 `21` 本该是 215）。拉平到前一条而不是丢掉，因为知识点还在，
    页码退化成「上一节的位置」仍能让 `assign` 把 chunk 挂到大致正确的节；
    丢条目会让这一节的正文全挂到上一节名下。

    返回修过的条数，写进 `ParseReport.page_repaired` 供诊断。
    """
    if len(entries) < 3:
        return 0
    repaired = 0
    pages = [e.page for e in entries]
    for i, entry in enumerate(entries):
        lo = max(0, i - window)
        hi = min(len(pages), i + window + 1)
        neighbours = sorted(pages[lo:i] + pages[i + 1 : hi])
        if not neighbours:
            continue
        median = neighbours[len(neighbours) // 2]
        if abs(entry.page - median) > tolerance:
            entry.page = median
            repaired += 1
    previous = 0
    for entry in entries:
        if entry.page < previous:
            entry.page = previous
            repaired += 1
        else:
            previous = entry.page
    return repaired


def _score(entries: list[_Raw], rows: list[list[str]]) -> tuple[int, int]:
    """(有效条目数, 目录页里带页码的行数)。

    判据是「命中条数与带页码的行数比对取最大者」：哪套版式解释得最多就用
    哪套，解释不了的条数就是漏掉的知识点。

    行内页码与行尾页码都算：08/14 的页码在最后一格（`Title. . . 20`），
    09/13/16 的页码独占一格但同一行只有它一个，两种在这里都体现为
    「这一行能取出一个页码」。
    """
    page_rows = sum(1 for row in rows if _row_page(list(row))[0] is not None)
    return len([e for e in entries if e.title and e.page > 0]), page_rows


def _parse_from_outline(doc: pymupdf.Document) -> tuple[list[_Raw], ParseReport]:
    """PDF 内置书签（10 Ahmed / 11 Spieler / 26 / 27）。

    书签是出版社给的目录，比 OCR 出来的文字层可靠得多，所以只要有就用。
    但它混着两类不该进知识点树的东西：
    - 前置内容（`Contents` / `Preface` / `Copyright` / 26-27 的 `目录` `封面`
      `内容简介`）—— 没有可学内容；
    - 出版元数据（11 Spieler 的首条是 ISBN `0198527845`）—— 纯数字串。

    `_FRONT_MATTER` 是精确集合，认不出 `Preface to the Fourth Edition` 与
    中文的 `封面`，所以这里用 `_looks_like_front_matter` 的宽松前缀判据。
    """
    rep = ParseReport(layout='outline')
    toc = doc.get_toc(simple=True)
    out: list[_Raw] = []
    for _level, title, page in toc:
        t = _norm(title)
        if not t:
            continue
        if t.lower() in _FRONT_MATTER or _looks_like_front_matter(t) or _is_metadata_title(t):
            rep.skipped_front += 1
            continue
        # 书签给的是 PDF 页（1 起），统一换成 0 起，与 `printed_page` 的
        # 计算口径一致（`printed = pdf_index - offset`）。
        out.append(_Raw('', t, page - 1))
    rep.entries = len(out)
    return out, rep


def _is_metadata_title(title: str) -> bool:
    """出版元数据，不是章节。11 Spieler 的 ISBN、`Copyright` 都属于这类。"""
    t = title.strip()
    if t.lower() in {'copyright', 'isbn', 'title page', 'cover', 'half title'}:
        return True
    # ISBN / 纯数字串（含 `-`）
    return bool(re.fullmatch(r'[\d\-Xx]{6,}', t))


# 「篇 / Part」是比章高一层的容器。知识点树已经有「模块」这一层，再留一个
# 只装章节的中间层会让模块名变成「第1篇 原子物理」而不是「第1章 …」——
# 12 本老书的模块都是章（`digital-kanghua-5e` 的 221 个节点挂在 9 个章下）。
_PART_TITLE = re.compile(r'^(第[0-9一二三四五六七八九十]+篇|part\s+[IVXLC0-9]+)\b', re.IGNORECASE)


def _parse_outline_levels(doc: pymupdf.Document) -> list[tuple[int, str, int]]:
    """书签 → `(层级, 标题, PDF 页索引)`，同时做三件规整。

    ## 一、过滤前置内容与出版元数据

    书签里混着 `Contents` / `Preface to the second edition` / `Copyright` /
    `Dedication` / 11 Spieler 的 ISBN `0198527845` / 26-27 的 `目录` `封面`
    `内容简介`。这些没有可学内容，而且 26/27 的 level 1 就是 `目录` 本身 ——
    不滤掉的话整棵树的根变成「目录」，模块名会叫「目录」。

    ## 二、把 `篇`/`Part` 这一层压平

    `import-content.ts` 把 `depth===1` 的节点建成模块。26 郭江的层级是
    `目录(1) → 第1篇(2) → 第1章(3) → 1.1(4)`，篇留在树上会让模块变成
    「第1篇 原子物理 / 第2篇 原子核物理」两个，102 个知识点全挤在下面。
    压平后模块就是章，与 12 本老书一致。

    ## 三、层级归一化成从 1 起连续

    节 2 之后，剩下的原始层级可能是 `2,3,4`（26/27）或 `1,2,3`（10/11）。
    `_assign_numbers_from_levels` 按层级计数器摊编号，层级不连续会摊出
    `1.0.1` 这种编号。这里把「出现过的层级」升序映射成 `1..n`。
    """
    raw: list[tuple[int, str, int]] = []
    drop_below: int | None = None
    for level, title, page in doc.get_toc(simple=True):
        t = _norm(title)
        if not t:
            continue
        # 已经决定丢掉某个容器的整棵子树：层级比它深的条目全部跳过。
        # 见 `_OUTLINE_DROP_SUBTREE` 的注释（11 Spieler 的 Index → A..Z）。
        if drop_below is not None:
            if int(level) > drop_below:
                continue
            drop_below = None
        if t.lower() in _FRONT_MATTER or _looks_like_front_matter(t) or _is_metadata_title(t):
            continue
        if t.lower() in _OUTLINE_DROP_SUBTREE:
            drop_below = int(level)
            continue
        if _PART_TITLE.match(t):
            continue
        raw.append((int(level), t, page - 1))

    # 过滤之后**最浅的那一层**才是「章一级」。这一层里没有编号、也不像
    # 「第N章」的是书名与前言残渣：10 Ahmed 的首条是书名
    # `Physics and Engineering of Radiation Detection`；27 郭江因为 level 1
    # 的 `目录` 被滤掉，`原子及原子核物理`/`绪论` 就从 level 2 浮上来当了一级。
    # 但**答案附录**是例外：它的标题本来就不带章号（`习题参考答案` / `Solutions`），
    # 却在最浅一层上，跟书名长得很像。26 郭江 2023 的 `习题参考答案`（PDF p316）
    # 就这样被当成书名丢掉，它名下 p315-p320 的题解随后被相邻章按页区间吞成正文
    # —— 产物里连这个节点都不存在，票 41 要识别的答案附录自然也就无从识别。
    #
    # 处理办法是给它一个**哨兵层级 0**：不进 `levels` 集合（否则会把章整体压到
    # 第 2 层），也不动层级计数器（`_assign_numbers_from_levels` 直接跳过它），
    # 于是它拿到空编号，由 `_build_tree` 的「无编号条目」分支挂到当前章下面 ——
    # 和 12 本老书的答案附录一样是「章下的一个知识点」。最后按页序插回原位置，
    # 因为 `stack[0]` 决定它挂在谁下面，位置错了就会挂到附录Ⅰ底下。
    sentinel: list[tuple[int, str, int]] = []
    if raw:
        top = min(level for level, _t, _p in raw)
        kept: list[tuple[int, str, int]] = []
        for level, title, page in raw:
            if level == top and not _OUTLINE_CHAPTER_TITLE.match(title):
                if is_answer_appendix_title(title, title):
                    sentinel.append((0, title, page))
                    continue
                continue
            kept.append((level, title, page))
        raw = kept

    levels = sorted({level for level, _t, _p in raw})
    remap = {level: idx + 1 for idx, level in enumerate(levels)}
    out = [(remap[level], title, page) for level, title, page in raw]
    out.extend(sentinel)
    # 稳定排序：同页的条目保持书签原顺序。
    out.sort(key=lambda e: e[2])
    return out


# 书签里「一级标题」的正经长相：`1 Detector systems overview` /
# `第1章 原子的核式结构` / `Chapter 3 ...`。没有这些前缀的一级标题是书名。
_OUTLINE_CHAPTER_TITLE = re.compile(r'^(\d{1,3}\b|第\s*\d+\s*章|chapter\s+\d+)', re.IGNORECASE)

# 「容器型附录」：它们的子条目是索引词条/文献列表，不是可学知识点，
# **子条目要连根丢掉**。
#
# 11 Spieler 的书签里 `[1,'Index',495]` 后面跟着 `[2,'A',495]` … `[2,'Z',506]`
# （索引按首字母分组）。`Index` 不是 chapter 形状 → 被上面「最浅一层过滤」
# 丢掉；但它的 25 个子条目还挂在 level 2，被 `_build_tree` 按深度栈挂到了
# **上一个幸存的章（第 9 章）** 下面，产出 9.38=`C`、9.40=`D` 这种假节
# （实测 spieler 因此多出 25 个 `未收录术语（A）` 叶子，页码 478–489，
# 而第 9 章正文只到 434 页）。
#
# 只收「整名匹配」的终止性附录，不用 `is_en_appendix` 的宽前缀：
# `Appendix A: Essential electronic measuring devices` 那类是有正文的附录章，
# 该保留（由 `is_appendix` 标成非叶容器），而不是连子树丢掉。
_OUTLINE_DROP_SUBTREE = frozenset(
    {
        'index',
        'references',
        'bibliography',
        'further reading',
        'glossary',
        'symbols and abbreviations',
    }
)


def _assign_numbers_from_levels(entries: list[tuple[int, str, int]]) -> list[_Raw]:
    """把 (level, title, pdf_page) 摊成带层级编号的条目。

    书签只有层级没有编号，而 `build_tree` 靠编号前缀挂树。按层级维护一个
    计数器：遇到 level L 的条目就把 L 层计数 +1、更深的层清零。
    """
    counters: dict[int, int] = {}
    out: list[_Raw] = []
    for level, title, page in entries:
        # 层级 0 是 `_parse_outline_levels` 给「最浅一层上的答案附录」留的哨兵：
        # 它要拿空编号（挂到当前章下面），而且**不能动计数器** —— 一旦
        # `counters[0] += 1` 就会触发下面「清更深层」的循环，把章计数清零，
        # 下一个章又变回第 1 章，整本书的编号全撞。
        if level == 0:
            out.append(_Raw('', title, page))
            continue
        counters[level] = counters.get(level, 0) + 1
        for deeper in [d for d in counters if d > level]:
            del counters[deeper]
        if level == 1:
            num = str(counters[1])
        else:
            parts = [str(counters.get(d, 0)) for d in range(1, level + 1)]
            num = '.'.join(parts)
        out.append(_Raw(num, title, page))
    return out



def parse_book(
    pdf_path: str,
    *,
    source_id: str,
    toc_pages: tuple[int, int] | list[int],
    page_offset: int | None = None,
) -> list[BookTocEntry]:
    """解析一本书的目录，返回森林（`list[TocEntry]`）。

    `page_offset` 为 None 时用 PDF 页索引本身当印刷页码（调用方随后应当用
    `detect_page_offset_text` 的结果校正，见 `run.py --page-offset auto`）。

    解析失败抛 `TocParseError`，消息里带未解析行 —— 不许静默返回空树。
    """
    if not source_id:
        raise ValueError('source_id 必填：知识点 id 需要书级命名空间，否则跨书撞号')
    doc = pymupdf.open(pdf_path)
    try:
        rows = _collect_rows(doc, toc_pages)
        lines = [cell for row in rows for cell in row]
        if not rows:
            raise TocParseError(
                f'{source_id}: 目录页 {toc_pages} 没有任何文字。可能目录不在这个范围，'
                f'或者这本是扫描件（应走 tools/ingest/ocr_run.py）。'
            )

        candidates: list[tuple[str, list[_Raw], ParseReport]] = []
        numeric, nrep = _parse_numeric(rows)
        candidates.append(('numeric', numeric, nrep))

        outline_entries, orep = _parse_from_outline(doc)
        if len(outline_entries) >= 20:
            # 书签的 page 是 PDF 页索引（已 -1），但 `printed` 需要减去偏移。
            # 交给调用方统一算，这里先保持 PDF 索引。
            candidates.append(('outline', outline_entries, orep))

        best_name, best_entries, best_rep = '', [], ParseReport()
        best_score = (-1, -1)
        for name, entries, rep in candidates:
            s = _score(entries, rows)
            if s > best_score:
                best_name, best_entries, best_rep, best_score = name, entries, rep, s

        if best_name == 'outline':
            by_level = _parse_outline_levels(doc)
            numbered = _assign_numbers_from_levels(by_level) if by_level else best_entries
        else:
            numbered = best_entries

        if len(numbered) < 10:
            raise TocParseError(
                f'{source_id}: 目录解析只得到 {len(numbered)} 条（版式判定为 {best_name}）。'
                f'这不是「书没有目录」，是规则没覆盖这个版式。\n'
                f'未解析行（前 40 条）：\n' + '\n'.join(f'  {l!r}' for l in (best_rep.unparsed or lines)[:40])
            )

        # 只有书签给的是 PDF 页索引，需要减偏移换算成印刷页。目录页里读到
        # 的数字**本来就是印刷页码**，再减一次会把整本书的页码压成 0。
        tree = _to_tree(numbered, page_offset=page_offset if best_name == 'outline' else 0)
        from toc import flatten

        n_chapters = sum(1 for _, n, _ in flatten(tree, source_id=source_id) if n.depth == 1)
        if n_chapters == 0:
            raise TocParseError(
                f'{source_id}: 解析出 {len(numbered)} 条目录项，但没有一条成为 depth==1 的章。'
                f'`import-content` 会因此静默产出 0 个知识点（库里的表现是一本空书）。\n'
                f'前 20 条：{[ (e.num, e.title, e.page) for e in numbered[:20] ]}'
            )
        return tree
    finally:
        doc.close()


def _build_tree(entries: list[tuple[str, str, int]]) -> list[BookTocEntry]:
    """按**深度栈**挂树。**与 `toc.build_tree` 的差别见下。**

    ## 为什么不复用 `toc.build_tree` 的前缀规则

    它按编号前缀找父节点：`4.10` 去找 `4.1`，命中就把 `4.10` 挂到 `4.1`
    下面。中文点线目录的编号是补零对齐的（`01.02.03`），前缀规则恰好成立；
    但 08 Tsoulfanidis / 12 Leo 的编号是 `4.1` 与 `4.10` 并列的十进制写法，
    前缀规则会把 `4.10`~`4.19` 全挂到 `4.1` 底下 —— 实测 08 出 254 个根、
    12 出 21 个根，而两本书都只有十几章。

    这里改成看条目自己的 `depth`（编号里点的个数 + 1）：维护一个栈，遇到
    depth L 就把栈弹到只剩 L-1 层，再挂上去。**这条规则只依赖编号的层级
    结构，不依赖编号的字典序**，所以对两种写法都成立。

    ## 为什么节点类型是 `BookTocEntry` 而不是 `TocEntry`

    `name_original` 要在挂树这一步保住，否则下游 `nodes_from_flat` 拿不到
    原始英文名，「这个知识点来自 Knoll 的哪一节」就追不回去了。
    """
    roots: list[BookTocEntry] = []
    stack: list[BookTocEntry] = []
    for num, title, page in entries:
        # 答案附录同时是章节附件：`assign.leaf_page_ranges` 只让「叶节点或附件」
        # 当区间所有者，不把答案附录算成附件的话，它的页会被上一个叶子按页区间
        # 吞成正文（09 Grupen 的 p533–576 就全挂在「术语表」名下）。
        answer_key = is_answer_appendix_title(title, title)
        node = BookTocEntry(
            num=num,
            title=title,
            printed_page=page,
            depth=num.count('.') + 1 if num else 0,
            appendix=is_appendix(title) or answer_key,
            answer_key=answer_key,
            name_original=title,
        )
        if not num:
            # 无编号条目：挂到当前章（栈底）下面。`Index` / `References` 这类
            # 附件条目没有编号，但如果当成根就会在树顶造出一堆假章。
            chapter = stack[0] if stack else None
            if chapter is not None:
                node.depth = chapter.depth + 1
                chapter.children.append(node)
            else:
                roots.append(node)
            continue
        while stack and stack[-1].depth >= node.depth:
            stack.pop()
        if stack:
            stack[-1].children.append(node)
        else:
            roots.append(node)
        stack.append(node)
    return roots


def _to_tree(entries: list[_Raw], *, page_offset: int | None) -> list[BookTocEntry]:
    """`_Raw` 列表 → `BookTocEntry` 森林，同时算印刷页码、判附件。"""
    # 同一编号重复（04 有 `II.` 被认成 `II.` 两次）会让挂树把后一个挂到前一个
    # 下面，反而更乱。先按「编号首次出现」去重，重复的加 `-2` 后缀交给
    # `flatten` 的 `_unique` 处理 —— 这里只保证编号不互相吞。
    seen: dict[str, int] = {}
    items: list[tuple[str, str, int]] = []
    for e in entries:
        num = e.num
        if num:
            seen[num] = seen.get(num, 0) + 1
            if seen[num] > 1:
                num = f'{num}-{seen[num]}'
        items.append((num, e.title, e.page))
    if page_offset is not None:
        items = [(n, t, max(0, p - page_offset)) for n, t, p in items]
    return _build_tree(items)


# ---------------------------------------------------------------------------
# 页偏移
# ---------------------------------------------------------------------------

_NUM_LINE = re.compile(r'^[^\w]{0,3}(\d{1,4})[^\w]{0,3}$')


def detect_page_offset_text(pdf_path: str, *, body_start: int, samples: int = 24) -> tuple[int, float, list[tuple[int, int]]]:
    """从页脚数字反推「PDF 页索引 − 印刷页码」。

    与 `ocr.detect_page_offset` 同一个思路，但不吃 OCR：这些书有文字层，
    页脚那一行 `pymupdf` 直接能取到。取页高下 12% 带里的最后一两个非空行，
    能解析成纯数字就当页码。

    返回 `(偏移, 一致率, [(pdf_index, printed)])`。一致率低时调用方必须
    改用显式 `--page-offset` —— 错的偏移比「不知道」坏得多（会让全书每页的
    `printed_page` 都错几十页，而 `assign` 是按页码区间挂 chunk 的）。
    """
    doc = pymupdf.open(pdf_path)
    try:
        counts: dict[int, int] = {}
        hits: list[tuple[int, int]] = []
        step = max(1, (doc.page_count - body_start) // samples)
        for i in range(body_start, doc.page_count, step):
            page = doc[i]
            height = page.rect.height
            found = None
            blocks = page.get_text('blocks')
            for b in blocks:
                x0, y0, x1, y1, text = b[0], b[1], b[2], b[3], b[4]
                if y0 < height * 0.88:
                    continue
                line = _norm(str(text).splitlines()[0] if str(text).splitlines() else '')
                m = _NUM_LINE.match(line)
                if m:
                    found = int(m.group(1))
                    break
            if found is None:
                continue
            hits.append((i, found))
            d = i - found
            counts[d] = counts.get(d, 0) + 1
            if len(hits) >= samples:
                break
        if not counts:
            return 0, 0.0, hits
        best, n = max(counts.items(), key=lambda kv: kv[1])
        total = sum(counts.values())
        return best, n / total, hits
    finally:
        doc.close()


if __name__ == '__main__':  # pragma: no cover - 手工探针
    import sys

    path = sys.argv[1]
    sid = sys.argv[2]
    a, b = int(sys.argv[3]), int(sys.argv[4])
    tree = parse_book(path, source_id=sid, toc_pages=(a, b))
    from toc import flatten

    flat = flatten(tree, source_id=sid)
    print(f'nodes={len(flat)} roots={len(tree)}')
    for nid, n, parent in flat[:40]:
        print(f'{"  " * n.depth}{nid}  {n.title}  p.{n.printed_page}  (parent={parent})')
