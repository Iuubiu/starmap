"""票 02 AC 第 1 条的人工核对助手：把抽样页的 PDF 原文与抽取产物并排打印。

AC 要求「抽样 20 页与原书逐段对照，不漏整段」。脚本只负责把两侧摆到一起，
判断仍然要人看 —— 这里输出的是核对材料，不是核对结论。
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, 'tools/ingest')
import pymupdf

ROOT = Path('.')
PDF = ROOT / '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
CONTENT = ROOT / 'content/digital-kanghua-5e'
OFFSET = 22

PAGES = [2, 8, 14, 28, 40, 52, 62, 83, 96, 110, 132, 155, 178, 196, 210, 240, 268, 300, 340, 420]


def norm(s: str) -> str:
    return re.sub(r'[^\u4e00-\u9fffA-Za-z0-9]', '', s)


def main() -> None:
    doc = pymupdf.open(PDF)
    chunks = [json.loads(l) for l in (CONTENT / 'chunks.jsonl').read_text(encoding='utf-8').splitlines() if l]
    by_page: dict[int, list[dict]] = {}
    for c in chunks:
        by_page.setdefault(c['printed_page'], []).append(c)

    out = []
    for p in PAGES:
        out.append('=' * 78)
        out.append(f'印刷页 {p}（PDF 第 {p + OFFSET} 页）')
        out.append('-' * 78)
        raw = doc[p + OFFSET].get_text()
        out.append('【PDF 原文】')
        out.extend(raw.splitlines())
        out.append('')
        out.append('【抽取产物】')
        for c in by_page.get(p, []):
            kind = c['kind']
            if kind == 'table' and c.get('rows'):
                body = '\n'.join(' | '.join(r) for r in c['rows'])
            else:
                body = c['text']
            out.append(f'[{kind}] {body}')
            out.append('')
        out.append('')
    (ROOT / '.scratch' / 'sample-compare.txt').write_text('\n'.join(out), encoding='utf-8')
    print(f'已写出 {len(PAGES)} 页的并排对照 → .scratch/sample-compare.txt')


if __name__ == '__main__':
    main()
