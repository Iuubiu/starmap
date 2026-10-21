# -*- coding: utf-8 -*-
"""15 本英文（+2 本中文）教材的**完整**产物生成：目录 + chunk + 先修边 + manifest。

## 与 `run.py` 的关系

`run.py` 是通用入口，目录固定走 `toc.parse_toc_pages`（只认中文点线版式）。
这 15 本书的目录版式各不相同，走 `toc_books.parse_book` / `toc_body`，页偏移
要逐本实测，所以单开一条批处理。**下游完全一致**：产物形状与 `run.py` 逐字
相同（`toc.json` / `chunks.jsonl` / `edges.json` / `manifest.json`），
`apps/api/scripts/import-content.ts` 不需要知道是谁生成的。

## 顺序不能换

1. 目录（先 `page_offset=0` 拿条目，供页偏移回验）
2. **页偏移**（靠英文标题在正文页的位置自校验 —— 一旦先译名就再也对不上）
3. 目录（用真偏移重解）
4. **译名**（到这里才开始改 `name`，`nameOriginal` 原样留着）
5. chunk（按印刷页切）、页眉页脚过滤、归属
6. 先修边、manifest

## 正文起始页

每本书的目录页之后还有前言/致谢/符号表，直接接着扫会把这些当正文。
`BODY_START` 逐本记实测的正文首页（PDF 索引），与 `toc_batch.BOOKS` 里的
`bodyStart` 是两件事：后者是 page_offset 的探测窗口，这里是真正抽取的起点。
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from assign import assign  # noqa: E402
from chunk import blocks_to_chunks, drop_furniture, write_content_dir  # noqa: E402
from edges import build_edges, summarize, write_edges  # noqa: E402
from extract import extract_page  # noqa: E402
from toc_batch import BOOKS, build_nodes, pdf_path, resolve_page_offset, translate_nodes  # noqa: E402

import pymupdf  # noqa: E402

CONTENT_DIR = 'content'

#: 正文首页（PDF 索引）。目录页之后往往还有前言、致谢、符号表、图表清单，
#: 逐本实测过：16/20 的目录页文字层不可用、走正文标题重建，正文起点 = bodyStart。
BODY_START: dict[str, int] = {
    'knoll-3e-2000': 21,
    'knoll-4e-2010': 30,
    'tsoulfanidis-4e': 19,
    'grupen-2e-2008': 14,
    'ahmed-2e': 22,
    'spieler-2005': 17,
    'leo-2e': 15,
    'nakhostin-2018': 8,
    'rivetti-2015': 17,
    'lutz-2007': 10,
    'nicholson-1974': 18,
    'gilmore-2e-2008': 24,
    'debertin-1988': 17,
    'guojiang-2023': 8,
    'guojiang-2014': 15,
}

#: 中文排版的书的 sourceId。与 `BODY_START` 无关，是**文字层排版规律**的区分：
#: 中文书的「词间距」不存在，空白 span 只是行首缩进或公式里的间隙。
#:
#: 实测把 `word_spaces=True` 开在郭江 2023 的公式行上，会把 `nmEERchcmn`（四个
#: 变量紧挨在一起是**正确的数学排版**）拆成 `n m E E R c h c m n` —— 这不是修
#: 复，是制造错误。英文书相反：空白 span 就是词间空格，不补就是 `GENERALPROPERTIESOF`。
#: 所以按书开关，不按语言/字符集猜。
CJK_BOOKS = frozenset({'guojiang-2023', 'guojiang-2014'})


def build_one(book: dict, *, limit: int | None = None) -> dict:
    sid = book['sourceId']
    pdf = pdf_path(book['prefix'])

    probe, _ = build_nodes(book, pdf, 0)
    offset, how = resolve_page_offset(book, pdf, probe)
    nodes, layout = build_nodes(book, pdf, offset)
    nodes = translate_nodes(nodes)
    chapters = [n for n in nodes if n['depth'] == 1]
    if not chapters:
        raise RuntimeError(f'{sid}: 章节点 0 个 —— import-content 会静默产出空书')

    start = BODY_START[sid]
    # 中文书的公式里变量之间**不该**有空格（`nmEERchcmn` 是对的），英文书的
    # 空白 span 就是词间空格（不补就是 `GENERALPROPERTIESOF`）。逐本开关。
    word_spaces = sid not in CJK_BOOKS
    doc = pymupdf.open(pdf)
    end = doc.page_count if limit is None else min(start + limit, doc.page_count)
    all_chunks = []
    for i in range(start, end):
        blocks = extract_page(doc[i], i, word_spaces=word_spaces)
        all_chunks.extend(blocks_to_chunks(blocks, sid, page_offset=offset))
    doc.close()

    # 页眉页脚二次过滤：判据是「去掉编号与空白后正好等于某个目录标题」。
    # 中文名与原名都要进集合 —— 正文里印的是原文，而节点名此时已译成中文。
    titles: set[str] = set()
    for node in nodes:
        for name in (node['name'], node.get('nameOriginal') or ''):
            if not name:
                continue
            titles.add(re.sub(r'\s+', '', re.sub(r'^\d+(\.\d+)*', '', name)))
            titles.add(re.sub(r'\s+', '', name))
    all_chunks, dropped = drop_furniture(all_chunks, titles)

    assign(all_chunks, nodes)
    answers = sum(1 for c in all_chunks if c.answer_for)
    orphans = sum(1 for c in all_chunks if c.micro_kp_id is None)

    out = Path(CONTENT_DIR) / sid
    out.mkdir(parents=True, exist_ok=True)
    with io.open(out / 'toc.json', 'w', encoding='utf-8') as handle:
        json.dump(
            {'sourceId': sid, 'nodeCount': len(nodes), 'nodes': nodes},
            handle,
            ensure_ascii=False,
            indent=2,
        )

    chunk_dicts = [c.__dict__ for c in all_chunks]
    edge_list, _stats = build_edges(chunk_dicts, nodes)
    write_edges(str(out / 'edges.json'), edge_list, summarize(edge_list, nodes))
    manifest = write_content_dir(all_chunks, out)

    return {
        'sourceId': sid,
        'title': book['title'],
        'layout': layout,
        'offset': offset,
        'offsetHow': how,
        'nodes': len(nodes),
        'chapters': len(chapters),
        'leaves': sum(1 for n in nodes if n['isLeaf']),
        'answerKey': sum(1 for n in nodes if n.get('answerKey')),
        'chunks': manifest['chunkCount'],
        'answers': answers,
        'orphans': orphans,
        'droppedFurniture': len(dropped),
        'pages': [start, end - 1],
        'pageRange': [min(n['printedPage'] for n in nodes), max(n['printedPage'] for n in nodes)],
        'edges': len(edge_list),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default=None, help='只跑一个 sourceId')
    ap.add_argument('--limit', type=int, default=None, help='只抽前 N 页正文（抽查用）')
    args = ap.parse_args()

    rows = []
    failures: list[tuple[str, str]] = []
    for book in BOOKS:
        sid = book['sourceId']
        if args.only and sid != args.only:
            continue
        try:
            row = build_one(book, limit=args.limit)
            rows.append(row)
            print(
                f"{sid:20s} {row['layout']:11s} offset={row['offset']:>3} "
                f"nodes={row['nodes']:4d} ch={row['chapters']:2d} leaves={row['leaves']:4d} "
                f"chunks={row['chunks']:5d} ans={row['answers']:4d} orphan={row['orphans']:4d} "
                f"answerKey={row['answerKey']} pages={row['pages']} printed={row['pageRange']} "
                f"edges={row['edges']}"
            )
        except Exception as exc:  # noqa: BLE001 —— 批处理要跑完 15 本，不能停在第一本
            failures.append((sid, f'{type(exc).__name__}: {exc}'))
            print(f'{sid:20s} FAILED {type(exc).__name__}: {exc}')

    print(f'\n成功 {len(rows)} 本，失败 {len(failures)} 本')
    for sid, message in failures:
        print(f'  - {sid}: {message.splitlines()[0]}')
    if rows:
        print(
            f"合计 节点 {sum(r['nodes'] for r in rows)} / 叶 {sum(r['leaves'] for r in rows)} "
            f"/ chunk {sum(r['chunks'] for r in rows)} / 答案块 {sum(r['answers'] for r in rows)} "
            f"/ 无归属 {sum(r['orphans'] for r in rows)} / 先修边 {sum(r['edges'] for r in rows)}"
        )
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
