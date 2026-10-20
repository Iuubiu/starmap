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


@dataclass
class TocEntry:
    num: str
    title: str
    printed_page: int
    children: list['TocEntry'] = field(default_factory=list)
    depth: int = 0


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
    return out


def build_tree(entries: list[tuple[str, str, int]]) -> list[TocEntry]:
    """按编号前缀关系挂成树。`1` ← `1.1` ← `1.1.1`。"""
    roots: list[TocEntry] = []
    stack: list[TocEntry] = []
    for num, title, page in entries:
        node = TocEntry(num=num, title=title, printed_page=page, depth=num.count('.') + 1 if num else 0)
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


def flatten(tree: list[TocEntry], prefix: str = '') -> list[tuple[str, TocEntry, str]]:
    """摊平成 [(id, 节点, 父 id)]。id 形如 `kp-1-1-1`。"""
    out: list[tuple[str, TocEntry, str]] = []

    def walk(nodes: list[TocEntry], parent: str) -> None:
        for n in nodes:
            if n.num:
                slug = re.sub(r'[^0-9a-zA-Z]+', '-', n.num).strip('-')
                node_id = f'kp-{slug}'
            else:
                # 无编号节点（小结/习题）不能只用页码做 id：实测有 4 章把
                # 「小结」和「下章习题」印在同一页（如 p.64、p.237、p.318、
                # p.424），只用页码会撞 id 并静默丢节点。带上标题。
                tag = re.sub(r'[^0-9a-zA-Z\u4e00-\u9fff]+', '', n.title)
                node_id = f'kp-p{n.printed_page}-{tag}'
            out.append((node_id, n, parent))
            walk(n.children, node_id)

    walk(tree, '')
    return out


if __name__ == '__main__':
    import sys

    tree = parse_toc_pages(sys.argv[1] if len(sys.argv) > 1 else '')
    flat = flatten(tree)
    with io.open('.scratch/t02/tree.txt', 'w', encoding='utf-8') as f:
        for nid, n, parent in flat:
            f.write(f'{"  " * n.depth}{nid}  {n.title}  p.{n.printed_page}  (parent={parent})\n')
    print('nodes:', len(flat), 'roots:', len(tree))
