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
每页 OCR 完立刻落 `--cache`（默认 `data/ocr-cache/<source-id>/<rec>/page-NNNN.json`，
`data/` 在 .gitignore 里），重跑时命中缓存的页直接读回，不重新识别。所以中断
后重跑只补没跑完的页。缓存带 `version` + `dpi` + `rec` 三个校验位：换了识别
模型要重新识别，换了 dpi 坐标就变了。

但**改版式规则不该要重跑识别**（5000 页 ≈ 9 小时）。缓存里存了原始行，所以
另有一个 `LAYOUT_VERSION`：旧版式的页命中时仍返回对象（只打 `layout_stale`），
`_ocr_range` 就地用缓存行重算块并回写，每页几毫秒。`boxes_to_blocks` 改了
就 +1 这个数，不要动 `CACHE_VERSION`。
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

from assign import assign, assign_front_matter, audit_assignment, review_sample  # noqa: E402
from chunk import blocks_to_chunks, drop_furniture, write_content_dir  # noqa: E402
from frontmatter import demote_front_matter_leaves, report_demotions  # noqa: E402
from naming import disambiguate_duplicate_names, report_renames, unresolved_duplicates  # noqa: E402
from merge_fragments import format_changes, merge_fragments, report_changes  # noqa: E402
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
    relayout_page,
    resolve_page_offsets,
    save_page,
    apply_review_threshold,
    choose_review_threshold,
    write_page_artifacts,
)
from toc import build_tree, flatten, nodes_from_flat  # noqa: E402

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
    relaid = 0
    t0 = time.time()
    rec = getattr(engine, 'rec', 'v3')
    for n, i in enumerate(indexes, 1):
        cached = load_page(cache_dir, i, dpi, rec=rec)
        if cached is not None:
            hits += 1
            # 缓存里的识别结果是对的，只是版式规则变了一一用现成的行重算块，
            # 不重跑识别，然后把新块回写，下次命中就不再重算。
            if cached.layout_stale:
                relayout_page(doc, cached, dpi=dpi)
                try:
                    save_page(cache_dir, cached, dpi, rec=rec)
                except OSError:
                    pass  # 回写失败不影响本次产物，只是下次还得重算
                relaid += 1
            pages.append(cached)
            continue
        page = ocr_page(engine, doc, i, dpi=dpi, text_score=text_score)
        save_page(cache_dir, page, dpi, rec=rec)
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
    if relaid:
        print(f'{label}：{relaid}/{hits} 页命中旧版式，已用缓存行重算块并回写')
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
    # 输出里有 ⚠ / ✓，Windows 把 stdout 重定向到文件时默认 GBK 会直接抛
    # UnicodeEncodeError 把整本书跑挂。统一改成 utf-8 + replace。
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
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
    ap.add_argument(
        '--rec',
        default='v4',
        choices=('v4', 'v3'),
        help='识别模型：v4（默认，PP-OCRv4）/ v3（旧模型，只重算目录与归属时用）',
    )
    ap.add_argument('--cache', default=None, help='页缓存目录，默认 .cache/ocr/<source-id>')
    ap.add_argument('--review-sample', type=int, default=0, metavar='N', help='输出 N 条抽检样本')
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    cache_dir = Path(args.cache) if args.cache else DEFAULT_CACHE / args.source_id

    print(f'打开 {Path(args.pdf).name}：{doc.page_count} 页；引擎启动…', flush=True)
    t_engine = time.time()
    engine = OcrEngine(device=args.device, rec=args.rec)
    print(
        f'引擎就绪 {time.time() - t_engine:.2f}s'
        f'（OpenVINO {args.device}，识别模型 {engine.rec_model}，dpi={args.dpi}）'
    )

    # 1. 页偏移：auto 就抽样扫页眉页脚
    offset_confident = True
    if args.page_offset == 'auto':
        print('探测页偏移：抽样扫上下 12% 带…', flush=True)
        offset, agreement, hits = detect_page_offset(engine, doc)
        if hits:
            print(f'  命中 {len(hits)} 页，众数偏移 {offset}，一致率 {agreement:.2f}')
            print(f'  样本: {hits[:8]}')
        else:
            print('  一页页码都没认出来')
        # `detect_page_offset` 证据不足时返回 0 —— 但 0 也可能是真偏移
        # （PDF 首页就是印刷第 1 页），要靠这两个值区分「可信的 0」和「放弃」。
        if len(hits) < 3 or agreement < 0.5:
            offset_confident = False
            print(
                f'  ⚠ 页码证据不足（命中 {len(hits)} 页、一致率 {agreement:.2f}），'
                f'偏移按 0 处理'
            )
            print('  ⚠ 请用 --page-offset 显式指定；否则 printed_page 不可信')
    else:
        offset = int(args.page_offset)
    print(f'页偏移 = {offset}（PDF 页 i → 印刷页 i-{offset}）')
    if not offset_confident:
        print('  ⚠ 本次运行的印刷页码仅供参考，不要直接入库')

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
    # 目录页与正文页**可以重叠**：`--first-page` 早于 `toc_last` 时（书首前置页
    # 要收进正文，比如王芝英要收 p0–p9 的封面/序/目录），同一页会同时出现在
    # `toc_pages` 与 `body_pages` 里。直接相加会让页账本出现重复页 —— 实测
    # 349 行 / 345 个唯一页（p10–p13 各两行），`pageCount == 账本行数` 的完整性
    # 检查随之失真，`--first-page` 一改就悄悄多出几行。正文页胜出：它是按正文
    # 门限识别的，而目录页用低门限捞孤立页码，置信度不可比。
    merged: dict[int, OcrPage] = {p.page: p for p in toc_pages}
    merged.update({p.page: p for p in body_pages})
    all_pages = [merged[i] for i in sorted(merged)]
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
        # 书级命名空间：12 本书都有 `kp-1`，不带前缀会在入库时互相覆盖（跨书
        # 重复 301 个 id、49% 节点被改掉 source_id，chunk 归属错书且无报错）。
        flat = flatten(tree, source_id=args.source_id)
        nodes = nodes_from_flat(flat)
        # 书首前置页（卷名/目录/书前绪论）会被建 tree 时挂到 stack[0]，变成
        # depth=0 的叶知识点 —— 它们不是可掌握知识点，降级成容器。chunk 仍挂
        # 在它下面所以内容不丢，但地图/掌握度/出题/推荐四处都只看 is_leaf。
        demoted = demote_front_matter_leaves(nodes)
        print(report_demotions(demoted))
        # 目录碎片：去起首标点 + 合并折行续行。必须在消歧**之前** —— 去标点后
        # 可能与既有节点重名，要靠消歧拼编号分开（判据见 merge_fragments.py）。
        _frag = merge_fragments(nodes)
        print(report_changes(_frag))
        for _line in format_changes(_frag):
            print(_line)
        # 同书同名的叶节点在界面上分不清（前端 `GraphNode` 不带 `num`）：把编号
        # 拼回 name。判据与理由见 naming.py 的模块 docstring。
        print(report_renames(disambiguate_duplicate_names(nodes)))
        for _g in unresolved_duplicates(nodes):
            print(f"  ⚠ 仍重名：{_g['name']!r} ids={_g['ids']} pages={_g['pages']}")
        print(f'目录：{len(toc_indexes)} 页 → {len(nodes)} 个知识点')
    if not nodes:
        nodes = _fallback_node(args.limit or doc.page_count)
        print(f'⚠ 目录没解析出条目，退化成单节点「全书」')

    # 5. 逐页偏移：锚定用每页自己认出的页脚页码，不是全书一个常数。
    #    05《核辐射测量原理》实测真偏移从 14 一路漂到 32（中间夹整页图版），
    #    全书一个常数会让 pdf 320 之后每页的 printed_page 错 10 页以上。
    #    页码证据不足的书退化成常数，行为与之前一致。
    offsets, offset_report = resolve_page_offsets(all_pages, fallback=offset)
    if offset_report['pagesWithNumber']:
        print(
            f"逐页偏移：{offset_report['pagesWithNumber']}/{offset_report['pages']} 页有页码，"
            f"偏移取值 {offset_report['distinctOffsets']} 种、跨度 {offset_report['drift']}"
        )
        if offset_report['distinctOffsets'] > 1:
            print(f"  偏移随页漂移，按 {offset_report['window']} 页滑窗取众数逐页校正")
    else:
        print('逐页偏移：一页页码都没认出来，全书用常数偏移')

    # 6. 正文 → chunk（走的是和 run.py 完全相同的函数）
    all_chunks = []
    for i in body_indexes:
        p = by_index.get(i)
        if p is None:  # 理论上不会发生：todo 覆盖了 body_indexes
            continue
        all_chunks.extend(
            blocks_to_chunks(p.blocks, args.source_id, page_offset=offsets.get(i, offset))
        )

    titles = {re.sub(r'\s+', '', re.sub(r'^\d+(\.\d+)*', '', n['name'])) for n in nodes}
    titles |= {re.sub(r'\s+', '', n['name']) for n in nodes}
    all_chunks, dropped = drop_furniture(all_chunks, titles)
    if dropped:
        print(f'丢弃页眉页脚 {len(dropped)} 条，例: {dropped[:2]}')

    assign(all_chunks, nodes)
    # 首个叶节点之前的正文（章首页、章首概述、整版图页）归首章容器。
    # OCR 书的目录也常把章首小节漏掉（汤彬第1章 1.1 之前有 8 个印刷页），
    # 这些页有实质内容，留成孤儿就是检索侧不可见。详见 `assign.assign_front_matter`。
    front_matter = assign_front_matter(all_chunks, nodes)
    if front_matter:
        print(f'首个叶节点之前的 {front_matter} 条 chunk 归到首章容器')
    n_ans = sum(1 for c in all_chunks if c.answer_for)
    n_orphan = sum(1 for c in all_chunks if c.micro_kp_id is None)
    print(f'答案块 {n_ans} 条；无归属 {n_orphan} 条')
    # 归属自检：`assign` 永远会「成功」（每个 chunk 都拿到某个 kp），所以
    # 目录解析坏了它也不会报错 —— 必须显式检查。见 `assign.audit_assignment`
    # 的阈值来由：干净的康华光是 6.1% 叶子零内容 / 4.5% 最大节点。
    audit = audit_assignment(all_chunks, nodes)
    print(
        f'归属自检：叶子 {audit["leafCount"]} 个、零内容 {len(audit["emptyLeaves"])} 个'
        f'（{audit["emptyShare"]:.1%}）、最大节点 {audit["largest"]} '
        f'占 {audit["largestShare"]:.1%}'
    )
    for w in audit['warnings']:
        print(f'⚠ {w}')
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
    # 6.5 人工复核阈值按**本识别模型的实际分布**定，票面 0.85 当下限
    confs = [p.mean_conf for p in all_pages if p.status != 'blank']
    threshold_info = choose_review_threshold(confs)
    apply_review_threshold(all_pages, threshold_info['threshold'])
    print(
        f'复核阈值 {threshold_info["threshold"]:.3f}'
        f'（{threshold_info["rule"]}；校准值 {threshold_info["calibrated"]}）'
    )

    fig_dir = out / 'ocr' / 'figures'
    figures: list[dict] = []
    for p in all_pages:
        if p.figures:
            figures.extend(crop_figures(doc, p, fig_dir, dpi=args.dpi))
    summary = write_page_artifacts(
        all_pages, out / 'ocr', figures, chunk_index, threshold_info=threshold_info
    )
    # 页偏移的可信度必须进产物，不能只打印在终端：下游 t18 入库时无法看到
    # 控制台输出，`printed_page` 不可信这件事必须跟着数据走。
    summary['recModel'] = engine.rec_model
    summary['pageOffset'] = offset
    summary['pageOffsetConfident'] = offset_confident
    summary['pageOffsetPerPage'] = offset_report['distinctOffsets'] > 1
    summary['pageOffsetReport'] = offset_report
    audit_path = out / 'ocr' / 'summary.json'
    audit_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

    print(
        f'页数 {summary["pageCount"]}；ok {summary["okPages"]}、'
        f'review {summary["reviewPages"]}、blank {summary["blankPages"]}；'
        f'均置信度 {summary["meanConfidence"]:.3f}（阈值 {summary["threshold"]:.3f}）'
    )
    print(f'图 {len(figures)} 张；chunk {manifest["chunkCount"]} 个 {manifest["byKind"]}')
    print(f'页范围 {start}..{end - 1}; 产物在 {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
