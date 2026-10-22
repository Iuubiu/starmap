"""票 02 AC 第 1 条的核对工具：抽样 20 页，逐页对比 PDF 与抽取产物。

不是「跑一遍看看有没有报错」，而是把两边的可比量并排放出来让人逐页看：
每页的字符覆盖率、块数、块类型分布、被丢弃的页眉页脚条数、以及最可疑的块。

用法：
    PYTHONIOENCODING=utf-8 python tools/ingest/audit_sample.py \
        "资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf" \
        content/digital-kanghua-5e --offset 22 --samples 20
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

import pymupdf

# 20 个抽样点，刻意覆盖全书而不是均匀切 20 段：
# 前 20 页（目录/绪论/表格密集）、中间各章开头、公式密集区、书末附录。
DEFAULT_PAGES = [2, 8, 14, 28, 40, 52, 62, 83, 96, 110, 132, 155, 178, 196, 210, 240, 268, 300, 340, 420]


def pdf_chars_per_page(doc: pymupdf.Document, offset: int, pages: list[int]) -> dict[int, int]:
    out: dict[int, int] = {}
    for printed in pages:
        pdf_index = printed + offset
        if 0 <= pdf_index < doc.page_count:
            text = doc[pdf_index].get_text()
            out[printed] = len(''.join(text.split()))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('content_dir')
    ap.add_argument('--offset', type=int, required=True, help='PDF 索引 = 印刷页码 + offset')
    ap.add_argument('--samples', type=int, default=20)
    args = ap.parse_args()

    chunks_path = Path(args.content_dir) / 'chunks.jsonl'
    chunks = [json.loads(line) for line in chunks_path.read_text(encoding='utf-8').splitlines() if line]

    doc = pymupdf.open(args.pdf)
    pages = DEFAULT_PAGES[: args.samples]
    truth = pdf_chars_per_page(doc, args.offset, pages)

    rng = random.Random(20261020)
    print(f'{"页":>4} {"PDF字数":>8} {"抽取字数":>8} {"覆盖率":>7} {"块数":>5}  类型分布')
    print('-' * 78)
    bad = []
    for printed in pages:
        mine = [c for c in chunks if c['printed_page'] == printed]
        my_chars = sum(len(''.join(c['text'].split())) for c in mine)
        base = truth.get(printed, 0)
        ratio = (my_chars / base) if base else 0.0
        kinds = Counter(c['kind'] for c in mine)
        kind_str = ' '.join(f'{k}:{v}' for k, v in sorted(kinds.items()))
        print(f'{printed:>4} {base:>8} {my_chars:>8} {ratio:>6.1%} {len(mine):>5}  {kind_str}')
        if base and ratio < 0.90:
            bad.append((printed, ratio))

    print()
    print(f'覆盖率 <90% 的页：{bad if bad else "无"}')

    # 最可疑的三类块，逐类给几条让人眼验
    print('\n--- 可疑块（每类抽 3 条）---')
    suspicious = {
        '疑似表格碎片混进正文': [
            c for c in chunks
            if c['kind'] == 'text'
            and len(c['text']) < 260
            and len(''.join(c['text'].split())) > 10
            and not any('\u4e00' <= ch <= '\u9fff' for ch in c['text'])
        ],
        '疑似正文被当成表格': [
            c for c in chunks
            if c['kind'] == 'table' and any(ch in c['text'] for ch in '，。；：')
        ],
        '过短的正文块（可能是脚注）': [
            c for c in chunks if c['kind'] == 'text' and len(c['text']) < 40
        ],
    }
    for label, items in suspicious.items():
        print(f'\n[{label}] 共 {len(items)} 条')
        for c in rng.sample(items, min(3, len(items))):
            snippet = c['text'].replace('\n', ' ⏎ ')[:110]
            print(f"  p.{c['printed_page']} {c['kind']}: {snippet}")

    print(f'\n总块数 {len(chunks)}，类型分布 {dict(Counter(c["kind"] for c in chunks))}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
