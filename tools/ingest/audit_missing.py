"""票 02 AC 第 1 条的正面核对：找出「PDF 里有、抽取产物里没有」的段落。

字数覆盖率会把两件事混在一起：图内标签被并进 figure（该丢）、段落被漏掉（不该丢）。
所以这里不数字数，而是**按句比对**：把 PDF 文字层切成句子，逐句在抽取产物里
找它是否出现过。找不到的句子才是真正的「漏段」。

用法：
    PYTHONIOENCODING=utf-8 python tools/ingest/audit_missing.py <pdf> <content_dir> --offset 22 --pages 300 420 8
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pymupdf

# 句子切分：中文句读与换行都算，但不切在数字/公式中间
_SENT = re.compile(r'[^。！？；\n]+[。！？；]?')


def norm(s: str) -> str:
    """只留文字与数字，去掉所有空白和标点。

    比对的是「这段话在不在」，不是排版。留标点会让 PDF 的软换行、
    全角半角差异全部误报为漏段。
    """
    return re.sub(r'[^\u4e00-\u9fffA-Za-z0-9]', '', s)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('content_dir')
    ap.add_argument('--offset', type=int, required=True)
    ap.add_argument('--pages', type=int, nargs='+', required=True, help='印刷页码')
    ap.add_argument('--min-chars', type=int, default=20, help='短于此的句子不参与比对')
    args = ap.parse_args()

    chunks = [
        json.loads(line)
        for line in (Path(args.content_dir) / 'chunks.jsonl').read_text(encoding='utf-8').splitlines()
        if line
    ]
    # 全书拼成一本字典：跨页段落可能落在别的页上，只在本页找会误报
    haystack = norm(''.join(c['text'] for c in chunks))

    doc = pymupdf.open(args.pdf)
    total_sent = 0
    missing: list[tuple[int, str]] = []
    for printed in args.pages:
        idx = printed + args.offset
        if not (0 <= idx < doc.page_count):
            continue
        raw = doc[idx].get_text()
        for sent in _SENT.findall(raw):
            n = norm(sent)
            if len(n) < args.min_chars:
                continue
            total_sent += 1
            if n not in haystack:
                missing.append((printed, sent.strip()))

    print(f'抽样页数 {len(args.pages)}，参与比对的句子 {total_sent} 句')
    print(f'在抽取产物中找不到的句子：{len(missing)} 句')
    if missing:
        print()
        for printed, sent in missing:
            one_line = ' '.join(sent.split())
            print(f'  p.{printed}: {one_line[:150]}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
