"""扫描版教材的入库入口：OCR → 与 `run.py` 完全相同的产物。

用法：
    python tools/ingest/ocr_run.py "资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf" \
        --source-id nuclear-electronics-wangzhiying-1989 \
        --page-offset auto --toc-range 10 15 \
        --out content/nuclear-electronics-wangzhiying-1989

产物（都在 --out 下，和 `run.py` 一字不差）：
    toc.json      知识点树
    chunks.jsonl  可检索切片
    edges.json    后向交叉引用
    manifest.json 计数与内容哈希

外加 OCR 特有的三份证据（票 17 的硬要求，`ocr/` 子目录）：
    ocr/pages.jsonl     **每一页**一行，含 confidence / 页号 / 页状态
    ocr/review.jsonl    <0.85 或认不出字的页（人工复核队列）
    ocr/figures.jsonl   切出来的图 + 图注 + 所属 chunk
    ocr/figures/*.png   图本身
    ocr/summary.json   页数/复核数/均置信度/秒每页

为什么单独一个入口而不是给 `run.py` 加 `--ocr` 开关：两条路径的**目录来源**
就不一样（文本版读目录页的文字层，扫描件只能 OCR 目录页），进度条也不一样
（OCR 每页 2–3 秒，要打印页账）。共用一个 main 会写成一堆 if。但下游产物是
同一套，`import-content.ts` 不用改。

断点续跑
--------
每页 OCR 完立刻落 `--cache`（默认 `data/ocr-cache/<source-id>/page-NNNN.json`，
`data/` 在 .gitignore 里），重跑时命中缓存的页直接读回，不重新识别。所以中断
后重跑只补没跑完的页。缓存带 `version` + `dpi` 两个校验位，改了版式规则或换了
dpi 会自动失效。
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from assign import assign, review_sample  # noqa: E402
from chunk import blocks_to_chunks, drop_furniture, write_content_dir  # noqa: E402
from edges import build_edges, summarize, write_edges  # noqa: E402
from ocr import (  # noqa: E402
    OCR_DPI,
    REVIEW_THRESHOLD,
    OcrEngine,
    OcrPage,
    crop_figures,
    detect_page_offset,
    load_page,
    ocr_page,
    parse_toc_pages,
    save_page,
    write_page_artifacts,
)
from toc import build_tree, flatten  # noqa: E402

import pymupdf  # noqa: E402

DEFAULT_CACHE = Path('data/ocr-cache')
# 目录页专用识别门限。印刷页码只有 1–2 位、周围全是引导符，默认 0.5 会把
# 单数字页码整个丢掉（实测王芝英 p10 缺 `1`/`1`/`1`/`1`/`2`/`5` 共 6 个）；
# 压到 0.2 补齐 19 行、页码一个不缺，多出来的噪声由 `_toc_denoise` 清掉。
TOC_TEXT_SCORE = 0.2


def _ocr_range(
    engine: OcrEngine,
    doc,
    indexes: list[int],
    *,
    dpi: int,
    cache_dir: Path,
    label: str,
    text_score: float | None = None,
) -> list[OcrPage]:
    """按顺序 OCR 一批页，命中缓存就跳过。返回**每页都有**的列表。"""
    pages: list[OcrPage] = []
    hits = 0
    t0 = time.time()
    for n, i in enumerate(indexes, 1):
        cached = load_page(cache_dir, i, dpi)
        if cached is not None:
            hits += 1
            pages.append(cached)
            continue
        page = ocr_page(engine, doc, i, dpi=dpi, text_score=text_score)
        save_page(cache_dir, page, dpi)
        pages.append(page)
        done = n - hits
        eta = (time.time() - t0) / done * (len(indexes) - n)
        print(
            f'\r{label} {n}/{len(indexes)} 页 {i:4d} '
            f'conf={page.mean_conf:.3f} {page.status:6s} '
            f'{page.elapsed:4.1f}s  ETA {eta / 60:5.1f}min   ',
            end='',
            flush=True,
        )
    print()
    if hits:
        print(f'{label}：{hits}/{len(indexes)} 页命中缓存（断点续跑）')
    return pages


def _toc_from_pages(
    engine: OcrEngine,
    doc,
    pages: list[OcrPage],
    *,
    dpi: int = OCR_DPI,
    max_page: int | None = None,
) -> list:
    """OCR 出来的目录页 → 知识点森林。

    三件事都必须做对：
    1. 喂进去的是**原始行**，不是合并后的块 —— 块会把整个标题列并成长行，
       页码列和标题的对应关系就没了（实测只配出 36 条，真值 61 条）；
    2. **逐页配对**再跨页去噪 —— y 是页内坐标，把几页的行拼一起配对会把
       不同页同高度的行配到一起（实测 4 页拼一起只配出 7 条，页码全乱）；
    3. 页码要**单独扫一遍右侧竖带**（`toc_band_lines`）—— 整页识别会漏掉
       1–2 位的印刷页码，实测王芝英 p10 的 1/2/5/8/10 全丢。

    `max_page` 传全书页数，用来修掉 `189`→`681` 这种跑飞的页号。
    """
    entries = parse_toc_pages(pages, engine=engine, doc=doc, dpi=dpi, max_page=max_page)
    return build_tree(entries)


def _fallback_node(count: int) -> list[dict]:
    """目录没解析出来时的兜底：整本书作为一个节点，而不是让所有 chunk 无归属。"""
    return [
        {
            'microKpId': 'kp-all',
            'name': '全书',
            'num': '',
            'printedPage': 1,
            'depth': 0,
            'parentId': None,
            'isLeaf': True,
        }
    ]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--source-id', required=True)
    ap.add_argument(
        '--page-offset',
        default='0',
        help='PDF 页索引 → 印刷页码的偏移；传 auto 就抽样扫页眉页脚自动判定',
    )
    ap.add_argument('--toc-range', nargs=2, type=int, default=(0, 0), help='目录页的 PDF 索引范围')
    ap.add_argument('--out', required=True)
    ap.add_argument('--first-page', type=int, default=None, help='从这页开始抽正文（跳过封面与目录）')
    ap.add_argument('--limit', type=int, default=None, help='只抽前 N 页，用于小样本测量')
    ap.add_argument('--dpi', type=int, default=OCR_DPI)
    ap.add_argument('--device', default='CPU', help='OpenVINO 设备：CPU / GPU / NPU')
    ap.add_argument('--cache', default=None, help='页缓存目录，默认 .cache/ocr/<source-id>')
    ap.add_argument('--review-sample', type=int, default=0, metavar='N', help='输出 N 条抽检样本')
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    cache_dir = Path(args.cache) if args.cache else DEFAULT_CACHE / args.source_id

    print(f'打开 {Path(args.pdf).name}：{doc.page_count} 页；引擎启动…', flush=True)
    t_engine = time.time()
    engine = OcrEngine(device=args.device)
    print(f'引擎就绪 {time.time() - t_engine:.2f}s（OpenVINO {args.device}，dpi={args.dpi}）')

    # 1. 页偏移：auto 就抽样扫页眉页脚
    if args.page_offset == 'auto':
        print('探测页偏移：抽样扫上下 12% 带…', flush=True)
        offset, agreement, hits = detect_page_offset(engine, doc)
        if hits:
            print(f'  命中 {len(hits)} 页，众数偏移 {offset}，一致率 {agreement:.2f}')
            print(f'  样本: {hits[:8]}')
        else:
            print('  一页页码都没认出来 → 偏移按 0 处理，请改用 --page-offset 显式指定')
        if agreement < 0.5 and hits:
            print(f'  ⚠ 一致率 {agreement:.2f} < 0.5，页码不可信；印刷页码仅供参考')
    else:
        offset = int(args.page_offset)
    print(f'页偏移 = {offset}（PDF 页 i → 印刷页 i-{offset}）')

    # 2. 要处理哪些页：目录页 ∪ 正文页
    toc_first, toc_last = args.toc_range
    toc_indexes = list(range(toc_first, min(toc_last, doc.page_count))) if toc_last > toc_first else []
    start = args.first_page if args.first_page is not None else (toc_last if toc_last > 0 else 0)
    end = doc.page_count if args.limit is None else min(start + args.limit, doc.page_count)
    body_indexes = list(range(start, end))
    todo = sorted(set(toc_indexes) | set(body_indexes))

    # 3. OCR：目录页用低识别门限（捞孤零零的页码），正文页用默认
    toc_pages: list[OcrPage] = []
    if toc_indexes:
        toc_pages = _ocr_range(
            engine, doc, toc_indexes, dpi=args.dpi, cache_dir=cache_dir,
            label='目录', text_score=TOC_TEXT_SCORE,
        )
    body_pages = _ocr_range(engine, doc, body_indexes, dpi=args.dpi, cache_dir=cache_dir, label='OCR')
    all_pages = sorted(toc_pages + body_pages, key=lambda p: p.page)
    by_index = {p.page: p for p in all_pages}

    # 4. 目录 → 知识点树（扫描件的目录页只有 OCR 文本，没有文字层）
    nodes: list[dict] = []
    if toc_indexes:
        tree = _toc_from_pages(
            engine,
            doc,
            [by_index[i] for i in toc_indexes if i in by_index],
            dpi=args.dpi,
            max_page=doc.page_count,
        )
        flat = flatten(tree)
        nodes = [
            {
                'microKpId': nid,
                'name': n.title,
                'num': n.num,
                'printedPage': n.printed_page,
                'depth': n.depth,
                'parentId': parent or None,
                'isLeaf': not n.children,
            }
            for nid, n, parent in flat
        ]
        print(f'目录：{len(toc_indexes)} 页 → {len(nodes)} 个知识点')
    if not nodes:
        nodes = _fallback_node(args.limit or doc.page_count)
        print(f'⚠ 目录没解析出条目，退化成单节点「全书」')

    # 5. 正文 → chunk（走的是和 run.py 完全相同的函数）
    all_chunks = []
    for i in body_indexes:
        p = by_index.get(i)
        if p is None:  # 理论上不会发生：todo 覆盖了 body_indexes
            continue
        all_chunks.extend(blocks_to_chunks(p.blocks, args.source_id, page_offset=offset))

    titles = {re.sub(r'\s+', '', re.sub(r'^\d+(\.\d+)*', '', n['name'])) for n in nodes}
    titles |= {re.sub(r'\s+', '', n['name']) for n in nodes}
    all_chunks, dropped = drop_furniture(all_chunks, titles)
    if dropped:
        print(f'丢弃页眉页脚 {len(dropped)} 条，例: {dropped[:2]}')

    assign(all_chunks, nodes)
    n_ans = sum(1 for c in all_chunks if c.answer_for)
    n_orphan = sum(1 for c in all_chunks if c.micro_kp_id is None)
    print(f'答案块 {n_ans} 条；无归属 {n_orphan} 条')
    if args.review_sample:
        for s in review_sample(all_chunks, nodes, args.review_sample):
            mark = '答案' if s['markedAsAnswer'] else '背景'
            print(f"[{mark}] p.{s['printedPage']} {s['kind']} 「{s['kp']}」 {s['text']}")

    # 6. 落盘：产物格式与 run.py 一致
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with io.open(out / 'toc.json', 'w', encoding='utf-8') as f:
        json.dump(
            {'sourceId': args.source_id, 'nodeCount': len(nodes), 'nodes': nodes},
            f,
            ensure_ascii=False,
            indent=2,
        )

    chunk_dicts = [c.__dict__ for c in all_chunks]
    edge_list, edge_stats = build_edges(chunk_dicts, nodes)
    edge_summary = summarize(edge_list, nodes)
    write_edges(str(out / 'edges.json'), edge_list, edge_summary)
    print(f'先修边 {edge_summary["edgeCount"]} 条（跨章 {edge_summary["crossChapter"]} 条）')

    manifest = write_content_dir(all_chunks, out)

    # 7. OCR 证据：页账本 / 复核队列 / 图
    chunk_index = {
        (c.pdf_page, tuple(round(v, 1) for v in c.bbox)): c.id
        for c in all_chunks
        if c.kind == 'figure'
    }
    fig_dir = out / 'ocr' / 'figures'
    figures: list[dict] = []
    for p in all_pages:
        if p.figures:
            figures.extend(crop_figures(doc, p, fig_dir, dpi=args.dpi))
    summary = write_page_artifacts(all_pages, out / 'ocr', figures, chunk_index)

    print(
        f'页数 {summary["pageCount"]}；ok {summary["okPages"]}、'
        f'review {summary["reviewPages"]}、blank {summary["blankPages"]}；'
        f'均置信度 {summary["meanConfidence"]:.3f}（阈值 {REVIEW_THRESHOLD}）'
    )
    print(f'图 {len(figures)} 张；chunk {manifest["chunkCount"]} 个 {manifest["byKind"]}')
    print(f'页范围 {start}..{end - 1}; 产物在 {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
