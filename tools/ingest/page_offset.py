# -*- coding: utf-8 -*-
"""逐本实测页偏移（PDF 索引 − 印刷页码）。

## 为什么必须实测，且必须**自校验**

`assign` 按「印刷页码区间」把 chunk 挂到知识点上。偏移差一页，整本书的
chunk 会整体串位；差十几页，每个知识点的正文都是邻居的内容，而且**全程
不报错** —— 库里看起来一切正常，学生读到的是别的小节。

## 两步：先出候选，再用标题回验

1. **候选**来自两个独立信号：
   - 页眉/页脚的印刷页码（`7`、`· 12 ·`、`2  Measurement and Detection…`、
     全角 `６`）；
   - 目录条目里的印刷页码对正文里的同名标题（`pdf_index - printed`）。
2. **回验**：拿每个候选去「预测」正文页，统计有多少条目录标题真的落在
   预测的那一页上。**取命中率最高的候选**，并要求 ≥ 30% 才采用。

第二步是关键。只靠众数会被「页码被 OCR 认错一位」带偏（27 郭江旧版的全角
页码大量被认成 `１`，众数跑到 135）；而标题回验问的是「按这个偏移，目录与
正文对不对得上」，这正是这个偏移唯一的用途。

## 只探「书的前 260 页正文」

15 本里有 800 页的书，全书归一化一遍要 40 秒以上（实测 15 本跑不完一轮）。
但参与回验的只有 depth ≤ 2 的条目，它们全在书的**开头几章**，所以正文页
文本只需要覆盖 `body_start` 之后的前 `_PROBE_PAGES` 页。页码候选也只在同一
窗口里取（页脚数字的众数不依赖整本书）。
"""
from __future__ import annotations

import collections
import re
import unicodedata

import pymupdf

# 独占一行：`7`、`· 12 ·`、`- 7 -`、`_7_`
_ALONE = re.compile(r'^[\s·•.\-—–_|]*(?P<num>[0-9]{1,4})[\s·•.\-—–_|]*$')
# 数字在前：`2   Measurement and Detection of Radiation`
_LEAD = re.compile(r'^[\s·•.\-—–_|]*(?P<num>[0-9]{1,4})[\s\u2000-\u200b\u202f\u205f\u3000]+(?P<rest>\S.*)$')
# 数字在后：`Introduction to Radiation Measurements   3`
_TRAIL = re.compile(r'^(?P<rest>\S.*?)[\s\u2000-\u200b\u202f\u205f\u3000]+(?P<num>[0-9]{1,4})[\s·•.\-—–_|]*$')

_JUNK = re.compile(r'[^a-z\u4e00-\u9fff0-9]')
_MIN_TITLE_HIT = 0.30
#: 书签/正文标题来源的书只能靠页眉/页脚上的印刷页码。
#: 分母是「探测了多少页」而不是「总共投了多少票」——噪声票会摊到几十个
#: 互不相同的偏移上，拿总票数做分母会把一本好好的书算成 32%（10 Ahmed 实测：
#: 正确偏移 142 票、总票数 444，但 260 页里有 142 页认对，真实一致率 55%）。
_MIN_FOOTER_HIT = 0.35
#: 回验窗口：正文起始页之后这么多页。
_PROBE_PAGES = 260
#: 逐页偏移表的最低锚点密度（保留下来的锚点 / 正文页数）。低于它说明这本书的
#: 页码大多认不出来，逐页表只是把噪声拟合成台阶 —— 退回常数偏移更安全。
_MIN_ANCHOR_DENSITY = 0.40
#: 回验时每页只看前 3000 字符：章标题与小节标题都排在页首或页中。
_PAGE_PROBE_CHARS = 3000


def _normalize_title(text: str) -> str:
    return _JUNK.sub('', unicodedata.normalize('NFKD', text).lower())


def _alpha_count(text: str) -> int:
    return sum(1 for ch in text if ch.isalpha())


def _looks_like_running_head(text: str) -> bool:
    """页眉文字：足够长、以字母/汉字为主，且不含句读（正文行会有逗号句号）。"""
    if _alpha_count(text) < 8:
        return False
    if any(ch in text for ch in ',;'):
        return False
    return len(text.split()) <= 9


def _page_candidates(line: str) -> list[int]:
    """一行里可能的页码。"""
    text = unicodedata.normalize('NFKC', line.strip())
    if not text:
        return []
    m = _ALONE.match(text)
    if m:
        return [int(m.group('num'))]
    out: list[int] = []
    m = _LEAD.match(text)
    if m and _looks_like_running_head(m.group('rest')):
        out.append(int(m.group('num')))
    m = _TRAIL.match(text)
    if m and _looks_like_running_head(m.group('rest')):
        out.append(int(m.group('num')))
    return out


def _edge_lines(page: pymupdf.Page) -> list[str]:
    """页面上最靠上 3 块与最靠下 3 块的文字行。

    **不能按 block 顺序取**：27 郭江旧版的页脚 `６` / `·` / 书名分在三个
    独立的 block 里，`blocks[-3:]` 取不到它（实测页码命中率因此掉到 3%）。
    按 y 坐标排序后取首尾才与「视觉上的页首页尾」一致。

    用 `get_text('blocks')` 而不是 `'dict'`：dict 每页要建几千个 span 对象，
    15 本 × 160 页会把这一趟从几十秒拖到几分钟（实测直接超时）。
    """
    blocks = page.get_text('blocks')
    if not blocks:
        return []
    ordered = sorted(blocks, key=lambda b: b[1])
    lines: list[str] = []
    for block in ordered[:3] + ordered[-3:]:
        lines.extend(str(block[4]).splitlines())
    return lines


class BookProbe:
    """一本书的正文页文本（归一化）与页眉页脚数字，只读一遍。"""

    def __init__(self, pdf_path: str, body_start: int, pages: int = _PROBE_PAGES) -> None:
        self.body_start = body_start
        self._pdf_path = pdf_path
        self._footer_votes: collections.Counter[int] = collections.Counter()
        self._pages: dict[int, str] | None = None
        self._probe_pages = pages
        #: 实际探测了多少页。页眉/页脚一致率的分母是它，不是总票数。
        self.probed_pages = 0
        #: 逐页锚点 `(pdf_index, pdf_index - 印刷页码)`，供 `measure_pages` 用。
        #: 与 `_footer_votes` 是同一批观测的两种视图：一个是全书汇总，
        #: 一个是按页保留 —— 逐页偏移必须知道「哪一页说了什么」。
        self.anchors: list[tuple[int, int]] = []
        doc = pymupdf.open(pdf_path)
        try:
            self.page_count = doc.page_count
            end = min(body_start + pages, doc.page_count)
            self.probed_pages = max(0, end - body_start)
            for i in range(body_start, end):
                numbers: list[int] = []
                for line in _edge_lines(doc[i]):
                    numbers.extend(_page_candidates(line))
                # 一页一票。同一页可能同时印页眉与页脚页码（Spieler 实测每页
                # 两个数字），两个数字给出同一个偏移，但计两票会让一致率的
                # 分子超过分母（跑出过「261/260 页 = 100%」这种自相矛盾的输出）。
                if not numbers:
                    continue
                number = numbers[0]
                if 1 <= number <= doc.page_count:
                    self._footer_votes[i - number] += 1
                    self.anchors.append((i, i - number))
        finally:
            doc.close()

    @property
    def pages(self) -> dict[int, str]:
        if self._pages is None:
            doc = pymupdf.open(self._pdf_path)
            try:
                end = min(self.body_start + self._probe_pages, doc.page_count)
                self._pages = {
                    i: _normalize_title(doc[i].get_text()[:_PAGE_PROBE_CHARS])
                    for i in range(self.body_start, end)
                }
            finally:
                doc.close()
        return self._pages

    def footer_candidates(self, top: int = 8) -> list[int]:
        return [offset for offset, _votes in self._footer_votes.most_common(top)]

    def title_candidates(self, nodes: list[dict], top: int = 8, max_samples: int = 60) -> list[int]:
        votes: collections.Counter[int] = collections.Counter()
        pages = self.pages
        tried = 0
        for node in nodes:
            if node['depth'] > 2 or (node.get('printedPage') or 0) < 1:
                continue
            if tried >= max_samples:
                break
            key = _normalize_title(node['name'])[:18]
            if len(key) < 8:
                continue
            tried += 1
            for i, text in pages.items():
                if key in text:
                    votes[i - node['printedPage']] += 1
                    break
        return [offset for offset, _votes in votes.most_common(top)]

    def score(self, nodes: list[dict], offset: int, max_samples: int = 40) -> tuple[float, int, int]:
        """按这个偏移，有多少条目录标题真的落在预测页上。"""
        pages = self.pages
        tried = hit = 0
        for node in nodes:
            if node['depth'] > 2 or (node.get('printedPage') or 0) < 1:
                continue
            if tried >= max_samples:
                break
            key = _normalize_title(node['name'])[:18]
            if len(key) < 8:
                continue
            tried += 1
            text = pages.get(node['printedPage'] + offset)
            if text is not None and key in text:
                hit += 1
        return (hit / tried if tried else 0.0), hit, tried


def measure_pages(
    pdf_path: str,
    *,
    body_start: int,
    fallback: int,
    window: int = 15,
    pages: int | None = None,
) -> tuple[dict[int, int], dict]:
    """逐页偏移表：`{pdf_index: offset}`，覆盖 `[body_start, page_count)`。

    与 `ocr.resolve_page_offsets()` 同一套算法（那边是 OCR 路径的实测产物）。
    每页的 `pdf_index - 印刷页码` 是锚点，对每一页取**附近 ±window 页内**的
    众数。漂移是分段常数，局部投票能吃掉单页误读；附近没有锚点时用全书众数。

    为什么常数偏移不够：实测 10 Ahmed 的偏移从 7 一路漂到 1、15 Lutz 从 7 漂到
    2、13 Nakhostin 从 9 漂到 5 —— 书里夹了没编号的插页/整版图，偏移在那一页
    之后整体平移。常数偏移必然让一侧错页，而 `assign` 按印刷页码分区间，错页
    = 整章内容挂到邻居知识点上，全程不报错。

    四条清洗规则（照抄 OCR 路径的理由，实测同样成立）：

    1. **丢掉负偏移锚点**。印刷页从 1 开始，`pdf_index - printed < 0` 只可能是
       把目录页的表格数字当成了页码（03 Knoll 3e 的 pdf 15–18 认出了
       `163/306/508/730`，偏移是 -148…-712）。
    2. **只保留离全书众数 ±40 页以内的锚点**（一个都不剩时退回全部）。
    3. **每页偏移夹到 `min(offset, pdf_index)`**，保证 `printed_page >= 0`。
    4. **附近没有锚点时用全书众数**，不用「最近的锚点」—— 最近的很可能正是噪声页。

    返回 `(offsets, report)`。`report.drift` 是全书出现过的偏移极差，用来判断
    这本书到底需不需要逐页表（drift 为 0 时逐页表退化成常数，与 `measure()`
    完全一致）。
    """
    probe = BookProbe(pdf_path, body_start, pages=pages if pages is not None else 10**9)
    anchors = list(probe.anchors)
    page_count = probe.page_count

    global_offset = fallback
    if anchors:
        global_offset = collections.Counter(off for _, off in anchors).most_common(1)[0][0]

    kept = [(idx, off) for idx, off in anchors if off >= 0]
    near = [(idx, off) for idx, off in kept if abs(off - global_offset) <= 40]
    if near:
        kept = near
    elif not kept:
        kept = anchors

    # 锚点太稀时逐页表是**外推**而不是测量，必须退回常数偏移。
    #
    # 实测 27 郭江旧版：186 页里有页码的只有 186 个锚点，但清洗后只剩 47 个
    # （`anchorsKept`），占正文页数的 25%。这点支撑下算出来的「众数」在
    # 16…25 与 42/43 之间乱跳，drift 报 49 页 —— 而这本书真实偏移是常数 15
    # （页脚 6 对 PDF 21，逐页都对得上）。逐页表把整本书的印刷页整体推后 10 页，
    # `assign` 全程不报错，只是每章内容都挂到下一个知识点上。
    #
    # 判据用「保留下来的锚点 / 正文页数」而不是「锚点绝对数」：800 页的书有
    # 200 个锚点仍然可能是稀疏外推，200 页的书有 150 个锚点就是密集实测。
    # 40% 这个门槛是拿 15 本实测分布定的：最稀的 nakhostin 61%、其余 ≥ 78%，
    # 而郭江旧版 25%，中间没有样本，取整到 40% 不会误伤任何一本。
    density = len(kept) / max(1, page_count - body_start)
    if density < _MIN_ANCHOR_DENSITY:
        offsets = {i: min(fallback, i) for i in range(body_start, page_count)}
        report = {
            'pages': page_count,
            'anchors': len(anchors),
            'anchorsKept': len(kept),
            'globalOffset': fallback,
            'distinct': 1,
            'distinctOffsets': [min(fallback, body_start)],
            'drift': 0,
            'window': window,
            'noiseDropped': len(anchors) - len(kept),
            'firstPageOffset': offsets.get(body_start),
            'anchorDensity': round(density, 3),
            'fallbackReason': (
                f'逐页锚点只覆盖 {density:.0%} 的正文页，逐页表是外推而不是测量，'
                f'退回自校验过的常数偏移 {fallback}'
            ),
        }
        return offsets, report

    offsets: dict[int, int] = {}
    for i in range(body_start, page_count):
        local = [off for idx, off in kept if abs(idx - i) <= window]
        offset = collections.Counter(local).most_common(1)[0][0] if local else global_offset
        offsets[i] = min(offset, i)

    distinct = sorted(set(offsets.values()))
    report = {
        'pages': page_count,
        'anchors': len(anchors),
        'anchorsKept': len(kept),
        'globalOffset': global_offset,
        'distinct': len(distinct),
        'distinctOffsets': distinct[:12],
        'drift': (distinct[-1] - distinct[0]) if distinct else 0,
        'window': window,
        'noiseDropped': len(anchors) - len(kept),
        'firstPageOffset': offsets.get(body_start),
    }
    return offsets, report


def measure(
    pdf_path: str,
    nodes: list[dict],
    body_start: int,
    *,
    pages_are_pdf_index: bool = False,
) -> tuple[int, str]:
    """返回 (偏移, 判定依据)。回验命中率不够时抛错要求显式指定。

    ## `pages_are_pdf_index` 不是个小开关，它决定回验能不能做

    - **目录页来源**（`pages_are_pdf_index=False`）：`printedPage` 已经是书上
      印的页码，`偏移` 是「正文 PDF 索引 − 印刷页」。此时标题回验是有意义的：
      拿 `printedPage + offset` 去正文里找，对上了就是对的。
    - **书签/正文标题来源**（`pages_are_pdf_index=True`）：`printedPage` 此时
      是 PDF 页索引，而 `偏移` 的定义是「PDF 索引 − 印刷页」。回验退化成
      「标题在不在它自己那页」—— 恒真，毫无信息量。这类书的唯一可信信号是
      **页眉/页脚印的页码**：`PDF索引 − 页码` 的众数与一致率。
    """
    probe = BookProbe(pdf_path, body_start)

    if pages_are_pdf_index:
        if not probe._footer_votes:
            raise RuntimeError('页眉/页脚没读到任何页码，必须显式写 bodyOffset。')
        best_offset, votes = probe._footer_votes.most_common(1)[0]
        rate = votes / max(1, probe.probed_pages)
        if rate < _MIN_FOOTER_HIT:
            raise RuntimeError(
                f'页眉/页脚页码一致率只有 {rate:.0%}（偏移 {best_offset} 在 '
                f'{probe.probed_pages} 页里认对 {votes} 页），'
                f'低于 {_MIN_FOOTER_HIT:.0%}。必须在 toc_batch.BOOKS 里显式写 bodyOffset。'
            )
        return best_offset, f'页眉页脚 {votes}/{probe.probed_pages} 页 ({rate:.0%})'

    candidates: list[int] = []
    for offset in probe.footer_candidates() + probe.title_candidates(nodes):
        if offset not in candidates:
            candidates.append(offset)
    if not candidates:
        raise RuntimeError('页眉/页脚与目录标题都没给出候选偏移，必须显式写 bodyOffset。')

    best_offset, best_rate, best_hit, best_tried = 0, -1.0, 0, 0
    for offset in candidates:
        rate, hit, tried = probe.score(nodes, offset)
        if rate > best_rate:
            best_offset, best_rate, best_hit, best_tried = offset, rate, hit, tried
    if best_rate < _MIN_TITLE_HIT:
        raise RuntimeError(
            f'页偏移回验不过：最好的候选 {best_offset} 只让 {best_hit}/{best_tried} '
            f'条目录标题落在预测页上（{best_rate:.0%}）。必须在 toc_batch.BOOKS 里显式写 bodyOffset。'
        )
    return best_offset, f'标题回验 {best_hit}/{best_tried} ({best_rate:.0%})'
