"""
抽样核对：逐页对比「PDF 文字层字符数」与「抽取产物字符数」。

用途是发现「整段漏抽」——某个块被丢掉、或者一个版面块被切成两半后
一半丢失。逐字比对没有意义（chunk 会重排空白、合并 span），但字符总量
的比值能捕捉到整段缺失。

输出一张表：页 / 文字层字符数 / 抽取字符数 / 比值 / 结论。
比值 < 0.95 的页需要人工看图。
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path('tools/ingest')))
import pymupdf
from extract import extract_page

SRC = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
OUT = Path('content/digital-kanghua-5e/chunks.jsonl')
PAGE_OFFSET = 22


def page_chars(chunks: dict[int, str], pdf_page: int) -> int:
    return len(re.sub(r'\s+', '', chunks.get(pdf_page, '')))


def main(sample: list[int]) -> None:
    doc = pymupdf.open(SRC)
    by_page: dict[int, str] = {}
    for line in OUT.open(encoding='utf-8'):
        c = json.loads(line)
        by_page.setdefault(c['pdf_page'], '')
        by_page[c['pdf_page']] += c['text']

    print(f'{"印刷页":>6} {"PDF页":>6} {"文字层":>8} {"抽取":>8} {"比值":>7}  结论')
    bad = []
    for printed in sample:
        pdf_page = printed + PAGE_OFFSET
        page = doc[pdf_page]
        layer = len(re.sub(r'\s+', '', page.get_text('text')))
        got = page_chars(by_page, pdf_page)
        ratio = got / layer if layer else 1.0
        verdict = 'OK' if ratio >= 0.95 else '需人工核对'
        if ratio < 0.95:
            bad.append((printed, layer, got, ratio))
        print(f'{printed:>6} {pdf_page:>6} {layer:>8} {got:>8} {ratio:>7.3f}  {verdict}')

    # 再扫全库，看有没有整页为空
    empty = [p - PAGE_OFFSET for p in range(24, 559) if not by_page.get(p)]
    print(f'\n全库抽取为空白的页: {empty if empty else "无"}')
    if bad:
        print(f'\n比值偏低的页（<0.95）共 {len(bad)} 页: {[b[0] for b in bad]}')


if __name__ == '__main__':
    # 覆盖：正文页、公式密集页、表格页、章首、附录
    main([2, 8, 14, 28, 40, 52, 83, 96, 110, 132, 155, 178, 196, 210, 240, 268, 300, 340, 420, 500])
