"""正文标题兜底解析：给目录页文字层已经烂掉的书（17 Gilmore / 20 Debertin）。

## 为什么需要它

17 Gilmore 的目录页**没有页码**（只有编号与标题，页码在另一层），20 Debertin
的目录页文字层是 OCR 垃圾（`lip ElectromagnelicHAdlatlonimawen mien`）。这两本
的目录页救不回来 —— 再写一百条正则也只是在拟合噪声。

但它们的**正文**是干净的：章首页有 20pt 的章标题（正文 10pt），节标题带编号
（`1.1 Electromagnetic radiation`）。真相源本来就该是正文，目录只是它的副本。

## 结构从哪儿来

**只从节标题推**：节号 `1.1` / `2.6.2` 的第一段就是章号，章数、章序、章标题
全部由节序列决定。反过来「先扫大字号行当章」会多扫出几十个假章（正文里的
图注、表标题、页首大字都会命中，实测 Debertin 出 85 个章、Gilmore 107 个）。

章标题取**章首页上那几行大字号文字**（Debertin 页首印 `1` 与
`Background material`；Gilmore 印 `Radioactive Decay and the Origin of` +
`Gamma and X-Radiation`，折行要拼）。找不到就退化成「第 N 章」，但不许丢章 ——
丢了章这一整节的 chunk 就挂到别的章名下。

## 两级判据

- **节**：行首 `数字.数字`，标题词数 ≤ 14，且**文本要干净**（字母占比够高、
  数字不超过 1 个）。不按字号筛：Debertin 的节标题与正文同号（8.8pt vs 9.3pt
  中位数），按字号筛会把整本的节丢光（实测只剩 4 个）。
- **节号必须比上一节大**。挡住正文里偶然以 `1.2 MeV` 开头的折行，也挡住
  书末索引页里的 `2.4, 238` 这类交叉引用。
"""
from __future__ import annotations

import re

import pymupdf

from toc_books import BookTocEntry, _norm

# 节：`1.1 Electromagnetic radiation` / `2.6.2 Generation of charge carriers`
_BODY_SECTION = re.compile(r'^(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+([A-Z][^\n]{2,90})$')


def parse_body_headings(
    pdf_path: str,
    *,
    source_id: str,
    body_start: int,
    page_offset: int,
    min_sections: int = 10,
) -> list[BookTocEntry]:
    """从正文标题重建知识点树。返回 `list[BookTocEntry]`，结构与 `parse_book()` 一致。"""
    doc = pymupdf.open(pdf_path)
    try:
        # 逐页取（大字号行, 全部行）
        pages: list[tuple[list[str], list[tuple[float, str]]]] = []
        for i in range(body_start, doc.page_count):
            page = doc[i]
            lines: list[tuple[float, str, float]] = []
            for block in page.get_text('dict')['blocks']:
                if block['type'] != 0:
                    continue
                for line in block['lines']:
                    text = _norm(''.join(span['text'] for span in line['spans']))
                    if not text:
                        continue
                    size = max([span['size'] for span in line['spans']] or [10.0])
                    lines.append((line['bbox'][1], text, size))
            if not lines:
                pages.append(([], []))
                continue
            lines.sort()
            sizes = sorted(line[2] for line in lines)
            median = sizes[len(sizes) // 2]
            big = [text for _y, text, size in lines if size >= median * 1.5 and _looks_like_chapter_title(text)]
            pages.append((big, [(y, text) for y, text, _s in lines]))

        sections: list[tuple[str, str, int]] = []
        last_section = (0, 0, 0)
        for idx, (_big, lines) in enumerate(pages):
            for _y, text in lines:
                m = _BODY_SECTION.match(text)
                if not m:
                    continue
                num = _canonical(m.group(1))
                title = m.group(2).strip(' .-')
                if len(title.split()) > 14 or not _looks_clean(title) or not _looks_like_heading(title):
                    continue
                key = _tuple(num)
                if not _accept_section(key, last_section):
                    continue
                last_section = key
                sections.append((num, title, body_start + idx - page_offset))
                break

        if len(sections) < min_sections:
            raise RuntimeError(
                f'{source_id}: 正文只找到 {len(sections)} 个节标题（至少要 {min_sections} 个）。'
                f'目录页与正文都救不回来时不要静默返回空树。'
            )

        # 按章号分组，章标题取该章首页的大字号行
        chapters: list[tuple[str, str, int]] = []
        groups: list[list[tuple[str, str, int]]] = []
        for entry in sections:
            chapter_num = entry[0].split('.')[0]
            if not groups or groups[-1][0][0].split('.')[0] != chapter_num:
                groups.append([entry])
            else:
                groups[-1].append(entry)
        for group in groups:
            chapter_num = group[0][0].split('.')[0]
            first_page = group[0][2] + page_offset - body_start
            title = _chapter_title(pages, first_page)
            chapters.append((chapter_num, title, group[0][2]))
        return _to_forest(chapters, sections)
    finally:
        doc.close()


# 以计量单位开头的一定不是节标题（`1.96 MeV of energy. ...`）
_UNIT_PREFIX = re.compile(r'^(MeV|keV|eV|GeV|meV|keV/|MeV/|mCi|\u00b5Ci|Bq|Gy|Sv)\b')


def _looks_like_heading(title: str) -> bool:
    """标题是短语，不是句子。

    正文折行被误认成标题是这套兜底解析最容易出的错：`1.96 MeV of energy.
    The reason that this, and most other` 完全符合「编号 + 大写开头」，只有
    「句号后面还有一整句」这一点能把它与真标题（`1.96 ...` 里没有句号）分开。
    """
    if '. ' in title:
        return False
    if _UNIT_PREFIX.match(title):
        return False
    return len(title.split()) <= 12


def _accept_section(key: tuple[int, int, int], last: tuple[int, int, int]) -> bool:
    """节号是否接着上一节。

    - 同章（major 相同）：minor 必须递增；
    - 下一章（major +1）：minor 任意；
    - 章号跳两章以上：一定是误匹配（Debertin 的 `7.3 Channels`），拒绝。

    这条比「全序递增」严，但正是它挡住了单个误匹配顶掉整章的问题。
    """
    major, minor, patch = key
    last_major, last_minor, last_patch = last
    if last_major == 0:
        return True
    if major == last_major:
        return (minor, patch) > (last_minor, last_patch)
    return major == last_major + 1


def _chapter_title(pages: list[tuple[list[str], list[tuple[float, str]]]], page_idx: int) -> str:
    """章首页的大字号行拼成章标题；找不到就用「第 N 章」。"""
    for probe in (page_idx, page_idx - 1):
        if 0 <= probe < len(pages):
            big = pages[probe][0]
            if big:
                title = ' '.join(big).strip(' .-')
                if len(title.split()) <= 16:
                    return title
    return ''



def _looks_clean(title: str) -> bool:
    """标题是不是干净文字（OCR 垃圾会有一堆符号与数字）。"""
    letters = sum(1 for ch in title if ch.isalpha())
    digits = sum(1 for ch in title if ch.isdigit())
    if letters < 3:
        return False
    if digits > 1:
        return False
    junk = sum(1 for ch in title if not (ch.isalnum() or ch in ' .,-()/&\'+:;'))
    return junk <= max(2, len(title) // 12)


def _looks_like_chapter_title(text: str) -> bool:
    """大字号行是不是章标题（排除页首的大号页码与图注）。"""
    if not text or len(text) < 6:
        return False
    if re.fullmatch(r'[\d\s.,]+', text):
        return False
    letters = sum(1 for ch in text if ch.isalpha())
    if letters < max(6, len(text) // 2):
        return False
    if len(text.split()) > 14:
        return False
    return _looks_clean(text)


def _canonical(num: str) -> str:
    """`01.02` → `1.2`；`2.6.02` → `2.6.2`。"""
    return '.'.join(str(int(part)) for part in num.split('.'))


def _tuple(num: str) -> tuple[int, int, int]:
    parts = [int(p) for p in num.split('.')]
    while len(parts) < 3:
        parts.append(0)
    return (parts[0], parts[1], parts[2])


def _to_forest(
    chapters: list[tuple[str, str, int]],
    sections: list[tuple[str, str, int]],
) -> list[BookTocEntry]:
    """章与节合成森林：节挂到同章号下；更深的小节挂到最近的浅层兄弟下。"""
    roots: list[BookTocEntry] = []
    by_num: dict[str, BookTocEntry] = {}
    for num, title, page in chapters:
        node = BookTocEntry(
            num=num,
            title=title or f'第 {num} 章',
            printed_page=page,
            depth=1,
            appendix=False,
            answer_key=False,
            name_original=title or f'Chapter {num}',
        )
        roots.append(node)
        by_num[num] = node

    for num, title, page in sections:
        node = BookTocEntry(
            num=num,
            title=title,
            printed_page=page,
            depth=num.count('.') + 1,
            appendix=False,
            answer_key=False,
            name_original=title,
        )
        parent = by_num.get(num.split('.')[0])
        if parent is None:
            roots.append(node)
            continue
        target = parent
        for existing in reversed(parent.children):
            if existing.num.count('.') < node.num.count('.'):
                target = existing
                break
        target.children.append(node)
    return roots
