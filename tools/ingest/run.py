"""内容入库管线的入口。

用法：
    python tools/ingest/run.py "资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf" \
        --source-id digital-kanghua-5e --page-offset 22 --toc-range 14 24 \
        --out content/digital-kanghua-5e

产物（都在 --out 下）：
    toc.json      知识点树（含页码溯源与父子关系）
    chunks.jsonl  可检索切片
    manifest.json 计数与内容哈希，用于幂等导入

这个脚本**只做离线抽取**，不碰数据库。入库由 apps/api/scripts/import-content.ts
负责 —— 分开的原因：抽取要迭代（版面规则改一次要重跑 559 页），入库要幂等
（重跑不能产生重复行）。两者节奏不同，混在一起每次调规则都要连库。
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path

# 允许 `python tools/ingest/run.py` 直接跑（不要求 -m）
sys.path.insert(0, str(Path(__file__).parent))

from assign import assign, review_sample  # noqa: E402
from chunk import blocks_to_chunks, drop_furniture, write_content_dir  # noqa: E402
from frontmatter import demote_front_matter_leaves, report_demotions  # noqa: E402
from naming import disambiguate_duplicate_names, report_renames, unresolved_duplicates  # noqa: E402
from merge_fragments import format_changes, merge_fragments, report_changes  # noqa: E402
from edges import build_edges, summarize, write_edges  # noqa: E402
from extract import extract_page  # noqa: E402
from toc import flatten, nodes_from_flat, parse_toc_pages  # noqa: E402

import pymupdf  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--source-id', required=True)
    ap.add_argument('--page-offset', type=int, default=0, help='PDF 页索引 → 印刷页码的偏移')
    ap.add_argument('--toc-range', nargs=2, type=int, default=(14, 24), help='目录页的 PDF 索引范围')
    ap.add_argument('--out', required=True)
    ap.add_argument('--first-page', type=int, default=None, help='只抽从这页开始的正文（跳过封面与目录）')
    ap.add_argument('--limit', type=int, default=None, help='只抽前 N 页，用于抽查')
    ap.add_argument(
        '--review-sample',
        type=int,
        default=0,
        metavar='N',
        help='输出 N 条答案块标注的抽检样本（答案块与背景块各半）到 stdout',
    )
    args = ap.parse_args()

    # 1. 目录 → 知识点树
    tree = parse_toc_pages(args.pdf, args.toc_range[0], args.toc_range[1])
    # 书级命名空间：12 本书都有 `kp-1`，不带前缀会在入库时互相覆盖（实测跨书
    # 重复 301 个 id、49% 节点被改掉 source_id，chunk 归属错书且无报错）。
    flat = flatten(tree, source_id=args.source_id)
    nodes = nodes_from_flat(flat)
    # 书首前置页（卷名/目录/书前绪论）会被建 tree 时挂到 stack[0]，变成
    # depth=0 的叶知识点 —— 它们不是可掌握知识点，降级成容器。chunk 仍挂
    # 在它下面所以内容不丢，但地图/掌握度/出题/推荐四处都只看 is_leaf。
    print(report_demotions(demote_front_matter_leaves(nodes)))
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

    # 2. 正文 → chunk
    doc = pymupdf.open(args.pdf)
    start = args.first_page if args.first_page is not None else (args.toc_range[1])
    end = doc.page_count if args.limit is None else min(start + args.limit, doc.page_count)

    all_chunks = []
    for i in range(start, end):
        blocks = extract_page(doc[i], i)
        all_chunks.extend(
            blocks_to_chunks(blocks, args.source_id, page_offset=args.page_offset)
        )

    # 3. 二次过滤页眉页脚（extract 阶段的整串正则拦不住粘在正文里的页码行）
    # 判据要用**去掉编号与空格**后的目录标题集，因为页眉里的标题经常不带编号
    titles = {re.sub(r'\s+', '', re.sub(r'^\d+(\.\d+)*', '', n['name'])) for n in nodes}
    titles |= {re.sub(r'\s+', '', n['name']) for n in nodes}
    all_chunks, dropped = drop_furniture(all_chunks, titles)
    if dropped:
        print(f'丢弃页眉页脚 {len(dropped)} 条，例: {dropped[:2]}')

    # 4. 归属与答案块标注（页级归属 + 两型答案规则，判据见 assign.py docstring）
    assign(all_chunks, nodes)
    n_ans = sum(1 for c in all_chunks if c.answer_for)
    n_orphan = sum(1 for c in all_chunks if c.micro_kp_id is None)
    print(f'答案块 {n_ans} 条（{round(100 * n_ans / max(1, len(all_chunks)), 1)}%）；无归属 {n_orphan} 条')
    if args.review_sample:
        for s in review_sample(all_chunks, nodes, args.review_sample):
            mark = '答案' if s['markedAsAnswer'] else '背景'
            print(f"[{mark}] p.{s['printedPage']} {s['kind']} 「{s['kp']}」 {s['text']}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with io.open(out / 'toc.json', 'w', encoding='utf-8') as f:
        json.dump({'sourceId': args.source_id, 'nodeCount': len(nodes), 'nodes': nodes}, f, ensure_ascii=False, indent=2)

    # 5. 先修边：只从正文的后向交叉引用建，无证据不建（判据见 edges.py docstring）
    chunk_dicts = [c.__dict__ for c in all_chunks]
    edge_list, edge_stats = build_edges(chunk_dicts, nodes)
    edge_summary = summarize(edge_list, nodes)
    write_edges(str(out / 'edges.json'), edge_list, edge_summary)
    print(f'先修边 {edge_summary["edgeCount"]} 条（跨章 {edge_summary["crossChapter"]} 条），'
          f'覆盖叶节点 {edge_summary["leavesTouched"]}/{edge_summary["leafCount"]}；'
          f'排除非后向引用 {sum(v for k, v in edge_stats.items() if "非后向引用" in k)} 处')

    manifest = write_content_dir(all_chunks, out)
    print(f'知识点 {len(nodes)} 个；chunk {manifest["chunkCount"]} 个 {manifest["byKind"]}')
    print(f'页范围 {start}..{end - 1}; 产物在 {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
