"""目录解析：把教材目录页解析成知识点树。

为什么用目录而不是「让模型从正文里抽知识点」：
目录自带页码，每个知识点天然可溯源到书上的第几页 —— 这是票 02 的硬验收项
（「每个知识点带页码溯源」）。模型抽出来的知识点没有页码，只能事后猜，而猜
错的页码比没有页码更糟。

实测康华光第 5 版目录页：PDF 第 16–22 页，7 页共 9450 字符，层级靠编号
（`1` / `1.1` / `1.1.1`）表达，页码在行尾，中间用 `⋯` 填充。这个格式很规整，
不需要 OCR 也不需要模型。
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

import pymupdf

# 一行目录：编号 + 标题 + 省略号填充 + 页码
# 例：`1.1.1数字技术的发展及其应用⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯2`
_ENTRY = re.compile(
    r'^(?P<num>\d+(?:\.\d+)*)\s*'
    r'(?P<title>[^\u22ef\d][^\u22ef]*?)'
    r'\s*[\u22ef\ufe19.\u2026]{2,}\s*'
    r'(?P<page>\d{1,4})\s*$'
)
# 无编号的顶层项：`小结⋯⋯35`、`习题⋯⋯36`
_BARE = re.compile(r'^(?P<title>小结|习题|复习思考题|本章小结)\s*[\u22ef.]{2,}\s*(?P<page>\d{1,4})\s*$')

# 无编号的**附件**条目：`参考文献⋯⋯524`、`部分习题答案⋯⋯530`、
# `附录ACMOS和TTL逻辑门电路的技术参数⋯⋯504`。
#
# 为什么需要它：`_ENTRY` 硬性要求行首是点分编号，`_BARE` 只白名单了 4 个词，
# 其余无编号行全被 `parse_toc_text` 静默跳过。实测康华光数字部分目录末页有
# 13 条这样的行（附录A/B/C/D、参考文献、索引、部分习题答案），**一个都没进
# 目录树** ⇒ 这本是 12 本里唯一 `appendix` 节点数为 0 的，`部分习题答案`
# 也不存在。
#
# 后果不是「少几个节点」：`assign.leaf_page_ranges` 让最后一个叶子
# `kp-kanghua-5e-p501-习题` 的区间一直开到书末，把印在 p530–536 的整本答案
# 吞成「习题正文」。于是答案块门控认不出它们（`chunk_kp_answer` 只标了其中
# 9/22 条），实测 300 次检索里这 7 页答案照旧被放行。
#
# 判据是「行首非数字 + 省略号填充 + 行尾页码」，**命中后还要再过一遍
# `is_appendix_title`**：不过这道闸会把 `B.1 基于Quartus Ⅱ软件的设计流程`
# 这类附录小节也收成顶级附件。反过来说，本正则 + 闸门组合会**丢掉附录C**
# （它的标题跨两行印，第一行没有页码），这是有意的取舍：附录C 是图形符号
# 对照表，不是可学知识点，它的页会按页区间落到相邻的附录节点上，内容不丢。
_BARE_APPENDIX = re.compile(
    r'^(?P<title>[\u4e00-\u9fffA-Za-z][^\u22ef\d][^\u22ef]*?)'
    r'\s*[\u22ef\ufe19.\u2026]{2,}\s*(?P<page>\d{1,4})\s*$'
)


# ---- 章节附件：目录里出现、但本身不是可学知识点的条目 ----
#
# 「小结」「习题」是每章末尾的内容段，不是可以出题、可以算掌握度的知识点。
# 建成叶节点会带来三个后果，实测都在康华光那本上发生过：地图上多出 20 个
# 「习题」格子、掌握度统计把习题算进章节、出题器拿习题当考点。
#
# 判据必须是**整名匹配**，不能用 `'小结' in title` —— 实测 18《原子核物理
# 实验方法》第 16 章有真知识点叫「脉冲探测器性能小结」，子串匹配会把它一起
# 降级，直接丢掉一章的正文归属。
#
# 括号后缀先剥掉再比：25《电路分析基础》印的是「部分习题答案（上册）」。
# 注意这里只认**整串**「附录」「附录I」这种，`_APPENDIX_PREFIX` 单独处理
# 「附录ACMOS和TTL逻辑门电路的技术参数」这类带正题的附录标题。
_APPENDIX_EXACT = frozenset(
    {
        '小结',
        '本章小结',
        '本章讨论的问题',
        '习题',
        '思考题',
        '复习思考题',
        '思考题与练习题',
        '思考题和练习题',
        '习题与思考题',
        '自测题',
        '部分习题答案',
        '部分自测题和习题答案',
        '习题答案',
        '参考答案',
        # 「解答」类与「答案」类是一回事，都必须当答案附录。实测 12 本里只有
        # 上述四条，这四条是先补的退路：以后加书时不用再回来改判据。
        '习题解答',
        '思考题解答',
        '习题答案与提示',
        '题解',
        '参考文献',
        '参考资料',
        '参考书目',
        '索引',
        '名词索引',
        '汉英索引',
        '中英名词对照',
        '中英文名词对照',
        '英汉名词对照',
        '中英名词索引',
        '前言',
        '序言',
        '后记',
        '致谢',
    }
)
_APPENDIX_PREFIX = re.compile(r'^附\s*录')
# 尾部的「（上册）」「(续)」不是标题主体，比对前剥掉
_TRAILING_PAREN = re.compile(r'[（(][^（()）]{1,8}[)）]\s*$')
_VER_TOKEN = re.compile(r'^(?:v(?:ol)?\.?|part|book)?\d+(?:e)?$', re.IGNORECASE)
# 方括号包起来的条目：王芝英那本印的是「［附录］」
_BRACKETED = re.compile(r'^[\[［【]\s*([^\[\]［］【】]{1,12})\s*[\]］】]$')
# 目录页自己的页眉被当成条目：`Ⅱ目录`、`V目录`、`И目录`（OCR 把 Ⅳ 认成 И）
# 、`目录XI`。罗马数字在前或在后都有，所以两边都允许。
_TOC_HEADER = re.compile(
    r'^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫIVXivxИи\d\s]*目\s*录[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫIVXivxИи\d\s]*$'
)


def is_appendix_title(title: str) -> bool:
    """这个目录标题是不是「章节附件」（小结/习题/附录/参考文献…）。"""
    t = re.sub(r'\s+', '', title or '')
    t = _TRAILING_PAREN.sub('', t)
    if not t:
        return False
    # 目录页自己的页眉（`Ⅱ目录`/`V目录`）会被 OCR 当成条目收进来，它既不是
    # 知识点也不是章节附件，但必须降级成非叶：实测童诗白 4 个、阎石 1 个
    # 都成了 isLeaf=true 的「目录」节点，地图上会多出 5 个空白格子。
    if _TOC_HEADER.match(t):
        return True
    m = _BRACKETED.match(t)
    if m:
        t = m.group(1)
    return t in _APPENDIX_EXACT or bool(_APPENDIX_PREFIX.match(t))


def is_answer_key_title(title: str) -> bool:
    """这条附件是不是「答案附录」—— 习题答案/参考解答这类整本答案汇编。

    判据是 `is_appendix_title` 为真 **且** 标题以「答案」「解答」收尾，两步缺一不可：

    - 先要求是附件，才谈得上答案附录。只按「含答案二字」判会误伤，`思考题`
      节点名字里没有「答案」，但真正要排除的是「思考题答案与提示」这种
      带正文的混合节点 —— 它确实该算答案附录，所以这一步不是防它。
    - 收尾判据而不是包含判据：`部分习题答案`、`部分自测题和习题答案`、
      `参考答案` 都命中；`答案要点` 这种反而不命中（它不是整本答案，是正文）。

    实测全 12 本命中 4 条，正好是 captain 点名的 4 个答案附录：
    `部分习题答案`（康华光模拟 p573、阎石 p464）、`部分自测题和习题答案`
    （童诗白 p609）、`部分习题答案（上册）`（李瀚荪 p305，括号后缀先剥掉）。

    为什么需要这个标记：这 4 个节点是 `isLeaf=false` 的容器，学习者永远不会
    以它们为当前知识点，所以 `answerChunkIdsFor(leafKp)` 永远查不到它们名下的
    514 个 chunk —— 票 09 的答案块门控对整本答案附录完全失效（实测 300 次
    检索里 29 次把答案 chunk 放行）。入库后检索侧按「同书 is_answer_key 的
    全部 chunk」取用，才能让这 514 条在 background/scaffold 档被拦、full 档放行。
    """
    t = re.sub(r'\s+', '', title or '')
    t = _TRAILING_PAREN.sub('', t)
    if not t or not is_appendix_title(t):
        return False
    return t.endswith(('答案', '解答', '题解'))


@dataclass
class TocEntry:
    num: str
    title: str
    printed_page: int
    children: list['TocEntry'] = field(default_factory=list)
    depth: int = 0
    # 章节附件（小结/习题/附录/参考文献…）：保留 chunk 归属，但不参与出题、
    # 掌握度与地图 —— 由调用方据此把节点写成 `isLeaf: false`。
    appendix: bool = False
    # 答案附录（习题答案/参考解答）：连 `is_answer_key` 一起进库，供检索侧
    # 按书取「整本答案」的全部 chunk 做门控。见 `is_answer_key_title`。
    answer_key: bool = False


def _clean_title(raw: str) -> str:
    t = raw.strip()
    t = t.replace('\u22ef', '').replace('\u2026', '')
    t = re.sub(r'\s+', ' ', t)
    return t.strip(' .·-')


def parse_toc_text(text: str) -> list[tuple[str, str, int]]:
    """从目录原文里抽出 (编号, 标题, 印刷页码)，按出现顺序。"""
    out: list[tuple[str, str, int]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        # 去掉页眉页脚噪声（`●1●`、`目录`、`●ⅡI ●`）
        if set(line) <= set('●· ⅠⅡⅢ0123456789') or line == '目录':
            continue
        m = _ENTRY.match(line)
        if m:
            title = _clean_title(m.group('title'))
            if title:
                out.append((m.group('num'), title, int(m.group('page'))))
            continue
        b = _BARE.match(line)
        if b:
            out.append(('', _clean_title(b.group('title')), int(b.group('page'))))
            continue
        # 无编号附件兜底。判据必须过 `is_appendix_title`，见 `_BARE_APPENDIX`
        # 的注释：不过闸会把附录小节（B.1/C.1）也收成顶级条目。
        a = _BARE_APPENDIX.match(line)
        if a:
            title = _clean_title(a.group('title'))
            if title and is_appendix_title(title):
                out.append(('', title, int(a.group('page'))))
    return out


def build_tree(entries: list[tuple[str, str, int]]) -> list[TocEntry]:
    """按编号前缀关系挂成树。`1` ← `1.1` ← `1.1.1`。"""
    roots: list[TocEntry] = []
    stack: list[TocEntry] = []
    for num, title, page in entries:
        node = TocEntry(
            num=num,
            title=title,
            printed_page=page,
            depth=num.count('.') + 1 if num else 0,
            appendix=is_appendix_title(title),
            answer_key=is_answer_key_title(title),
        )
        if not num:
            # 小结/习题属于**章**，不是「上一个出现的节点」。
            # 按 stack[-1] 挂会挂到最后一节（实测 10.4.2）下面去，因为
            # 目录里的最后一个编号条目未必是章。找 stack 里最浅的那个。
            chapter = stack[0] if stack else None
            if chapter is not None:
                node.depth = chapter.depth + 1
                chapter.children.append(node)
            else:
                roots.append(node)
            continue
        while stack and not num.startswith(stack[-1].num + '.'):
            stack.pop()
        if stack:
            stack[-1].children.append(node)
        else:
            roots.append(node)
        stack.append(node)
    return roots


def parse_toc_pages(pdf_path: str, first: int = 14, last: int = 24) -> list[TocEntry]:
    """在前若干页里找目录页并解析。返回森林（通常只有若干章的根）。"""
    doc = pymupdf.open(pdf_path)
    chunks: list[str] = []
    for i in range(first, min(last, doc.page_count)):
        t = doc[i].get_text()
        if '目录' in t or '\u22ef' in t:
            chunks.append(t)
    return build_tree(parse_toc_text('\n'.join(chunks)))


def _source_short(source_id: str) -> str:
    """把 sourceId 压成一个短前缀，用于知识点的跨书命名空间。

    为什么必须有命名空间
    --------------------
    12 本书各自从自己的目录生成 `kp-1`/`kp-1-1`/`kp-p120-小结` 这样的 id，
    书与书之间必然撞号：实测 2416 个节点只有 1531 个 unique id，**跨书重复
    301 个，49% 的节点导入时会被覆盖**。`import-content` 是
    `ON CONFLICT (id) DO UPDATE`，后导入的书会改掉前一本书那一行的
    `source_id`/`name`，而前一本书的 chunk 仍指着这个 id —— chunk 归属错书，
    全程无报错。所以 id 必须带书级前缀。

    前缀要短（不进前端展示，但会出现在 URL 与日志里）且可读。取 sourceId 里
    能区分书的最后几段：`nuclear-electronics-wangzhiying-1989` → `wangzhiying`，
    `digital-kanghua-5e` → `kanghua-5e`，`circuit-analysis-lihansun-5e-vol1` →
    `lihansun-5e-v1`。
    """
    parts = [p for p in source_id.replace('_', '-').split('-') if p]
    if not parts:
        return 'src'
    # 末尾的版次/年份是版本号，单独当后缀拼回去（1989 vs 1997 很有信息量）。
    ver: list[str] = []
    while parts and (_VER_TOKEN.match(parts[-1]) or parts[-1].isdigit()):
        ver.append(parts.pop())
    # 最后一段若长得很短（`5e` 这种已入 ver；剩下 `vol` 之类）或不是实词，
    # 再往前取一个。
    word = parts[-1] if parts else ''
    if len(word) < 3 and len(parts) > 1:
        word = f'{parts[-2]}-{word}'
    if not word:
        return 'src'
    return '-'.join([word, *reversed(ver)]) if ver else word


def flatten(
    tree: list[TocEntry], prefix: str = '', *, source_id: str | None = None
) -> list[tuple[str, TocEntry, str]]:
    """摊平成 [(id, 节点, 父 id)]。id 形如 `kp-1-1-1`，带书级命名空间时为
    `kp-wangzhiying-1-1-1`。

    **跨书命名空间**（`source_id` 非空时）：12 本书都有 `kp-1`，不加前缀会在
    入库时互相覆盖（详见 `_source_short` 的注释）。id 是确定性的 —— 同一本书
    重跑得同样 id，没有随机/哈希。

    **书内重复 id 加后缀去重**。目录本身有重复条目：OCR 把同一条印两遍（书 19
    的 `(α、n)反应型中子源` / `(、n)反应型中子源`），或者章号被重排（书 19 的
    `kp-1`/`kp-2`/`kp-3` 各两条）。撞 id 会在入库时静默丢节点 —— `import-content`
    按 `micro_kp_id` upsert，后一条盖掉前一条，但子节点全挂到前一条上。
    这里对已经出现过的 id 追加 `-2`/`-3`，保证每个节点都有自己的行。
    与书级前缀是两层修复，互不冲突。
    """
    ns = f'kp-{_source_short(source_id)}-' if source_id else 'kp-'
    out: list[tuple[str, TocEntry, str]] = []
    seen: dict[str, int] = {}

    def _unique(node_id: str) -> str:
        n = seen.get(node_id, 0) + 1
        seen[node_id] = n
        return node_id if n == 1 else f'{node_id}-{n}'

    def walk(nodes: list[TocEntry], parent: str) -> None:
        for n in nodes:
            if n.num:
                slug = re.sub(r'[^0-9a-zA-Z]+', '-', n.num).strip('-')
                node_id = f'{ns}{slug}'
            else:
                # 无编号节点（小结/习题）不能只用页码做 id：实测有 4 章把
                # 「小结」和「下章习题」印在同一页（如 p.64、p.237、p.318、
                # p.424），只用页码会撞 id 并静默丢节点。带上标题。
                tag = re.sub(r'[^0-9a-zA-Z\u4e00-\u9fff]+', '', n.title)
                node_id = f'{ns}p{n.printed_page}-{tag}'
            node_id = _unique(node_id)
            out.append((node_id, n, parent))
            walk(n.children, node_id)

    walk(tree, '')
    return out


def nodes_from_flat(flat: list[tuple[str, TocEntry, str]]) -> list[dict]:
    """把 `flatten()` 的结果变成入库用的节点字典。

    两个入口（`run.py` 处理电子版、`ocr_run.py` 处理扫描件）共用这一处，
    免得两边各写一遍再各自漂移。

    **章节附件的 `isLeaf` 一律为 false**：小结/习题/附录不是可学知识点。
    TS 侧只认 `is_leaf`，所以这样一处改动就能同时达到三个效果 —— 不进地图
    （`graph.controller.ts` 只取 `is_leaf = true`）、不算掌握度
    （`mastery.service.ts` 只对叶节点取快照）、不出题
    （`generation.service.ts` 的 `pickTargets` 带 `kp.is_leaf`）。
    节点的 chunk 归属不受影响：`assign.leaf_page_ranges` 把附件节点也算作
    区间所有者，chunk 仍旧挂在它名下（否则这些页会被相邻知识点按页区间吞掉）。

    `appendix` 只在**没有子节点**时为真。带子节的附录（康华光数字部分有
    「附录A CMOS 和 TTL 逻辑门电路的技术参数」，下面还挂着若干小节）本来
    就不是叶节点，它的小节是具体参数表，留着当知识点比合并更可核验。
    """
    return [
        {
            'microKpId': nid,
            'name': n.title,
            'num': n.num,
            'printedPage': n.printed_page,
            'depth': n.depth,
            'parentId': parent or None,
            'isLeaf': not n.children and not n.appendix,
            'appendix': bool(n.appendix and not n.children),
            # 答案附录必须**连子节点一起**标：这 4 条实测都没有子节点，但
            # 「附录A 习题答案」这种带小节的以后可能有，标记的是「这一整块
            # 是答案」，与有没有子节点无关。
            'answerKey': bool(n.answer_key),
        }
        for nid, n, parent in flat
    ]


if __name__ == '__main__':
    import sys

    tree = parse_toc_pages(sys.argv[1] if len(sys.argv) > 1 else '')
    flat = flatten(tree, source_id=sys.argv[2] if len(sys.argv) > 2 else None)
    with io.open('.scratch/t02/tree.txt', 'w', encoding='utf-8') as f:
        for nid, n, parent in flat:
            f.write(f'{"  " * n.depth}{nid}  {n.title}  p.{n.printed_page}  (parent={parent})\n')
    print('nodes:', len(flat), 'roots:', len(tree))
