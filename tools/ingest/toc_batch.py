"""逐本跑 15 本书的目录解析 → toc.json（不含 chunk 抽取）。

## 为什么单独一个脚本

`run.py` 的 chunk 抽取要遍历几百页、每本几分钟。解析这一步只读目录页
（最多十几页），秒级完成。先单独跑解析、确认 15 本都过了「章数 > 0 / 版式
合理」这一关，再去跑几个小时的抽取，否则抽完才发现目录是空的重跑一次不值。

## 用法

    python tools/ingest/toc_batch.py            # 解析并写 content/<sid>/toc.json
    python tools/ingest/toc_batch.py --check    # 只诊断，不写盘

产物只有 `toc.json`。`chunks.jsonl` / `edges.json` / `manifest.json` 由
`run.py` 写 —— 那一步才是重活。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from page_offset import measure  # noqa: E402
from naming import disambiguate_duplicate_names, report_renames  # noqa: E402
from toc import flatten, nodes_from_flat  # noqa: E402
from toc_body import parse_body_headings  # noqa: E402
from toc_books import TocParseError, is_answer_appendix_title, parse_book  # noqa: E402
from translate import load_overrides, make_translator  # noqa: E402

#: 译名词典（`names.zh.json`，由 `translate_titles.mjs` 或人工产出）。
#: 不存在时 `make_translator` 退化成 `translate.py` 里的术语表 + 句式规则。
TRANSLATE = make_translator(load_overrides())

BOOKS_DIR = '资源库/books'
CONTENT_DIR = 'content'

#: 15 本书的目录来源。`tocRange` 是目录页的 PDF 索引区间（含头不含尾）。
#: `bodyStart` + `bodyOffset` 仅 `parser='body'` 用（17/20 的两条兜底路）。
#: `outline=True` 表示这本书的真目录源是 PDF 内置书签：此时解析出来的
#: `printedPage` 是 **PDF 索引**而不是书上印的页码，所以页偏移只能靠
#: 页眉页脚上的页码算，不能用「标题回验」（那会退化成恒真）。
BOOKS: list[dict] = [
    {'prefix': '03', 'sourceId': 'knoll-3e-2000', 'title': 'Knoll 辐射探测与测量（第3版 2000）',
     'tocRange': (14, 19), 'parser': 'toc'},
    {'prefix': '04', 'sourceId': 'knoll-4e-2010', 'title': 'Knoll 辐射探测与测量（第4版 2010）',
     'tocRange': (24, 30), 'parser': 'toc'},
    {'prefix': '08', 'sourceId': 'tsoulfanidis-4e', 'title': 'Tsoulfanidis 辐射测量与探测（第4版）',
     'tocRange': (8, 19), 'parser': 'toc'},
    {'prefix': '09', 'sourceId': 'grupen-2e-2008', 'title': 'Grupen 粒子探测器（第2版 2008）',
     'tocRange': (8, 14), 'parser': 'toc'},
    {'prefix': '10', 'sourceId': 'ahmed-2e', 'title': 'Ahmed 辐射探测物理与工程（第2版）',
     'tocRange': (7, 20), 'parser': 'auto', 'outline': True},
    {'prefix': '11', 'sourceId': 'spieler-2005', 'title': 'Spieler 半导体探测器系统（2005）',
     'tocRange': (9, 17), 'parser': 'auto', 'outline': True},
    {'prefix': '12', 'sourceId': 'leo-2e', 'title': 'Leo 核与粒子物理实验技术（第2版）',
     'tocRange': (7, 15), 'parser': 'toc'},
    {'prefix': '13', 'sourceId': 'nakhostin-2018', 'title': 'Nakhostin 辐射探测器信号处理（2018）',
     'tocRange': (5, 8), 'parser': 'toc'},
    {'prefix': '14', 'sourceId': 'rivetti-2015', 'title': 'Rivetti 辐射传感器 CMOS 前端电子学（2015）',
     'tocRange': (10, 17), 'parser': 'toc'},
    {'prefix': '15', 'sourceId': 'lutz-2007', 'title': 'Lutz 半导体辐射探测器（2007）',
     'tocRange': (5, 10), 'parser': 'toc'},
    {'prefix': '16', 'sourceId': 'nicholson-1974', 'title': 'Nicholson 核电子学（1974）',
     'tocRange': (12, 18), 'parser': 'toc'},
    {'prefix': '17', 'sourceId': 'gilmore-2e-2008', 'title': 'Gilmore 实用γ射线能谱学（第2版 2008）',
     'tocRange': (10, 17), 'parser': 'body', 'bodyStart': 24, 'bodyOffset': 23},
    {'prefix': '20', 'sourceId': 'debertin-1988', 'title': 'Debertin & Helmer γ与X射线能谱学（1988）',
     'tocRange': (10, 14), 'parser': 'body', 'bodyStart': 17, 'bodyOffset': 13},
    {'prefix': '26', 'sourceId': 'guojiang-2023', 'title': '原子及原子核物理（郭江 第2版 2023）',
     'tocRange': (5, 8), 'parser': 'auto', 'outline': True},
    {'prefix': '27', 'sourceId': 'guojiang-2014', 'title': '原子及原子核物理（郭江 2014 旧版）',
     'tocRange': (8, 15), 'parser': 'auto', 'outline': True, 'bodyOffset': 15},
]


def pdf_path(prefix: str) -> str:
    names = [n for n in os.listdir(BOOKS_DIR) if n.startswith(prefix + '_') and n.endswith('.pdf')]
    if not names:
        raise FileNotFoundError(f'{BOOKS_DIR} 里找不到 {prefix}_*.pdf')
    return os.path.join(BOOKS_DIR, names[0])


def resolve_page_offset(book: dict, pdf: str, nodes: list[dict]) -> tuple[int, str]:
    """逐本实测页偏移（PDF 索引 − 印刷页）。**不沿用别的书的偏移。**

    调用方先按 `page_offset=0` 解析一遍拿到 `nodes`（此时 `printedPage` 对目录页
    来源的书已经是真印刷页，对书签/正文来源的书还是 PDF 索引），再拿这批条目
    去正文里回验候选偏移 —— 目录标题在正文页的位置是唯一能自校验的信号。
    """
    if 'bodyOffset' in book:
        return int(book['bodyOffset']), 'explicit'
    body_start = book.get('bodyStart') or book['tocRange'][1]
    return measure(pdf, nodes, body_start, pages_are_pdf_index=bool(book.get('outline')))


def pages_are_derived(book: dict) -> bool:
    """这本书的 `printedPage` 是不是「PDF 索引 − 偏移」推出来的。

    两类是：书签（outline）与正文标题（body）。目录页（toc）来源的不是 ——
    它的页码是从书上目录里直接读到的印刷页码，是唯一的第一手真值。
    """
    return bool(book.get('outline')) or book['parser'] == 'body'


def align_printed_pages(
    nodes: list[dict], *, constant_offset: int, offsets: dict[int, int]
) -> list[dict]:
    """把推导出来的 `printedPage` 换成逐页表口径。

    先还原出 PDF 索引（`printedPage + constant_offset`），再用这一页自己的
    偏移换算成印刷页。**必须与 `chunk.blocks_to_chunks` 用同一张表**，否则
    节点的章节区间与 chunk 的页码会差几页，`assign` 静默错配。

    还原不出来的（`pdf_index` 落在表外）保持原值：宁可保留常数口径的旧值，
    也不要凭空造一个页码。
    """
    for node in nodes:
        pdf_index = node['printedPage'] + constant_offset
        actual = offsets.get(pdf_index)
        if actual is not None:
            node['printedPage'] = max(0, pdf_index - actual)
    return nodes


def build_nodes(book: dict, pdf: str, offset: int) -> tuple[list[dict], str]:
    if book['parser'] == 'body':
        tree = parse_body_headings(
            pdf,
            source_id=book['sourceId'],
            body_start=book['bodyStart'],
            page_offset=offset,
        )
        layout = 'body'
    else:
        # `auto` 与 `toc` 都让 `parse_book` 自己仲裁（它会在 outline 与目录页
        # 版式之间按命中条数取最大者）；`toc` 只在诊断时用来对比。
        tree = parse_book(
            pdf,
            source_id=book['sourceId'],
            toc_pages=book['tocRange'],
            page_offset=offset,
        )
        layout = 'toc/outline'
    flat = flatten(tree, source_id=book['sourceId'])
    return nodes_from_flat(flat), layout


def mark_answer_appendixes(nodes: list[dict]) -> list[dict]:
    """把答案附录补标成 `answerKey=True` / `isLeaf=False` / `appendix=True`。

    ## 为什么产物生成后还要再标一遍

    `nodes_from_flat`（`toc.py`）算的是 `'appendix': bool(n.appendix and not
    n.children)` —— 有子节点的条目会被算成 False。09 Grupen 的 `Solutions`
    正好有 6 个子条目（Appendix 1–5 + 一个无名子项），于是它自己不再是
    「附件」，`assign.leaf_page_ranges()` 的所有者集合（`isLeaf or appendix`）
    里就没有它了，p533–576 的 62 条解答正文全部被上一个所有者「术语表」
    （p512）吞掉 —— 实测 `content/grupen-2e-2008/chunks.jsonl` 里
    `printed_page ∈ [533, 576]` 的 chunk 全部 `micro_kp_id = kp-grupen-2e-2008-17`。

    `toc.py` 不能改（12 本中文书在用它那条判据），所以在解析**之后**补标：
    与 `fix_answer_key.py` 同一套三个布尔，判据也同一份
    （`toc_books.is_answer_appendix_title`，名字两列各归各位）。

    补标是幂等的，且不改 `microKpId` —— chunk 归属在重算 `assign` 时自然跟着对。
    """
    for node in nodes:
        if not is_answer_appendix_title(node.get('name') or '', node.get('nameOriginal') or ''):
            continue
        node['answerKey'] = True
        node['isLeaf'] = False
        node['appendix'] = True
    return nodes


def translate_nodes(nodes: list[dict]) -> list[dict]:
    """把英文名译成中文，**原文留在 `nameOriginal`**（D10 红线）。

    ## 为什么用 `nameOriginal` 而不是把英文塞进 `name`

    `import-content.ts` 把 `name` 写成 `knowledge_points.name`，学生直接看到它 ——
    所以必须是中文。原文另存一列，回答的是另一个问题：「这条知识点来自原书的
    哪一节」。两者用途不同，不能合并。

    ## 为什么先译父节点再译子节点

    子节点标题经常省略上下文（`Noise` 在「前置放大器」章下就是「前置放大器
    噪声」）。但那属于 LLM 译名词典的活，规则路不假装能做到 —— 这里只保证每个
    名字自己可读，不造出「前置放大器：噪声」这种依赖父节点的写法（父节点一改名，
    子节点就错位了）。
    """
    out: list[dict] = []
    for node in nodes:
        original = node['name']
        chinese = TRANSLATE(original) or original
        out.append({**node, 'name': chinese, 'nameOriginal': original})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只诊断，不写 toc.json')
    ap.add_argument('--only', default=None, help='只跑一个 sourceId')
    args = ap.parse_args()

    ok = 0
    failed: list[tuple[str, str]] = []
    for book in BOOKS:
        sid = book['sourceId']
        if args.only and sid != args.only:
            continue
        try:
            pdf = pdf_path(book['prefix'])
            # 两遗：先按零偏移解析拿条目，再用条目回验出真偏移，然后重解。
            # 目录页来源的书零偏移就已经是真印刷页，重解得到同一棵树；
            # 书签/正文来源的书第二遗才把 PDF 索引换算成印刷页。
            probe, _ = build_nodes(book, pdf, 0)
            offset, how = resolve_page_offset(book, pdf, probe)
            nodes, layout = build_nodes(book, pdf, offset)
            # **译名要等页偏移定下来再做**：`resolve_page_offset` 靠「目录标题
            # 出现在哪一页」回验偏移，标题一旦译成中文就和书里的英文对不上了。
            nodes = translate_nodes(nodes)
            # 答案附录的三个布尔要在译名之后补：判据同时看译名与原书标题。
            # `toc.py` 的 `nodes_from_flat` 只对「没有子节点」的附件置
            # `appendix=True`，有子条目的 `Solutions` 会漏（详见本函数 docstring）。
            nodes = mark_answer_appendixes(nodes)
            # 译名之后再做同名消歧：前缀用的是 `num`，与中英文无关，但改名必须
            # 发生在译名之后，否则译名会盖掉刚拼上去的编号。
            print("  " + report_renames(disambiguate_duplicate_names(nodes)))
            chapters = [n for n in nodes if n['depth'] == 1]
            leaves = [n for n in nodes if n['isLeaf']]
            answers = [n for n in nodes if n.get('answerKey')]
            if not chapters:
                raise RuntimeError('章节点 0 个 —— import-content 会静默产出空书')
            print(
                f'{sid:22s} layout={layout:11s} offset={offset:>3} ({how}) '
                f'nodes={len(nodes):4d} chapters={len(chapters):3d} leaves={len(leaves):4d} '
                f'answerKey={len(answers)}'
            )
            if not args.check:
                out = Path(CONTENT_DIR) / sid
                out.mkdir(parents=True, exist_ok=True)
                with io.open(out / 'toc.json', 'w', encoding='utf-8') as f:
                    json.dump(
                        {'sourceId': sid, 'nodeCount': len(nodes), 'nodes': nodes},
                        f,
                        ensure_ascii=False,
                        indent=2,
                    )
            ok += 1
        except (TocParseError, RuntimeError, FileNotFoundError) as exc:
            failed.append((sid, str(exc)))
            print(f'{sid:22s} FAILED: {exc}')

    print(f'\n成功 {ok} 本，失败 {len(failed)} 本')
    for sid, msg in failed:
        print(f'  - {sid}: {msg.splitlines()[0]}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
