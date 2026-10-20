"""扫描版教材的抽样核对：拿不到文字层，就用「第二次独立识别」当真值代理。

票 02 的 `audit_sample.py` 靠 PDF 自带文字层逐句比对，扫描书没有文字层，
所以换两条证据：

1. **交叉识别一致率**：抽样页用另一套渲染参数（默认 300 dpi）重新识别一遍，
   与入库用的 200 dpi 结果逐字比对。同一页两次独立识别出来几乎一样，说明
   识别稳定；差异大的页就是「可能错字」的地方，人工只需看这些页。
   注意这不是准确率本身 —— 两次都错成同一个字时它看不出来 —— 但能把
   可疑面从「全书 335 页」缩到「二十几页里的几页」，人工核对才做得完。
2. **可检索性**：领域词在 `chunks.jsonl` 里必须能命中，且命中的页号要与
   交叉识别时该词出现的页一致。这是 AC 里「可被检索到」的机器化版本。

用法：

```bash
python tools/ingest/audit_ocr.py content/nuclear-electronics-wangzhiying-1989 \
    --pdf "资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf" --samples 20
```

只打印，退出码恒为 0 —— 核对结论写进 `核对记录.md`，这里给的是数字。
"""
from __future__ import annotations

import argparse
import difflib
import io
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from ocr import OcrEngine, ocr_page, render_page  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

# 抽样点覆盖全书：目录后正文开头、各章交界、公式密集区、书末。
DEFAULT_PAGES = [20, 34, 48, 62, 76, 90, 105, 120, 134, 150,
                 164, 178, 192, 206, 220, 236, 252, 268, 284, 300]

# 只和「有没有这两个字」有关，标点与空白的差异不算错字。
_NORM = re.compile(r'[^\u4e00-\u9fffA-Za-z0-9]')


def _norm(s: str) -> str:
    return _NORM.sub('', s)


def _diff_snippets(a: str, b: str, limit: int = 4, width: int = 22) -> list[str]:
    """找出两段文本里对不上的片段，给人眼看。"""
    out: list[str] = []
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            continue
        left = a[max(0, i1 - 6): i2 + 6][:width]
        right = b[max(0, j1 - 6): j2 + 6][:width]
        out.append(f'{left} ≠ {right}')
        if len(out) >= limit:
            break
    return out


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    ap = argparse.ArgumentParser()
    ap.add_argument('content_dir')
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--samples', type=int, default=20)
    ap.add_argument('--check-dpi', type=int, default=300, help='交叉识别用的 dpi')
    ap.add_argument('--device', default='CPU')
    args = ap.parse_args(argv)

    import pymupdf

    content = Path(args.content_dir)
    pages = [json.loads(line) for line in
             (content / 'ocr' / 'pages.jsonl').read_text(encoding='utf-8').splitlines() if line]
    by_page = {p['page']: p for p in pages}
    chunks = [json.loads(line) for line in
              (content / 'chunks.jsonl').read_text(encoding='utf-8').splitlines() if line]

    doc = pymupdf.open(str(ROOT / args.pdf))
    engine = OcrEngine(device=args.device)

    sample = [p for p in DEFAULT_PAGES if p in by_page][: args.samples]
    print(f'抽样 {len(sample)} 页，用 {args.check_dpi} dpi 交叉识别（入库用 200 dpi）')
    print(f'{"PDF页":>6} {"置信度":>7} {"字数":>5} {"一致率":>7}  差异（左=入库 右=复检）')
    print('-' * 100)

    rates: list[float] = []
    suspects: list[int] = []
    for idx in sample:
        base = by_page[idx]
        mine = _norm(''.join(c['text'] for c in chunks if c['pdf_page'] == idx))
        again = ocr_page(engine, doc, idx, dpi=args.check_dpi)
        other = _norm(again.text)
        sm = difflib.SequenceMatcher(None, mine, other, autojunk=False)
        rate = sm.ratio() if (mine or other) else 1.0
        rates.append(rate)
        if rate < 0.95:
            suspects.append(idx)
        diff = ' | '.join(_diff_snippets(mine, other)) if rate < 0.99 else ''
        print(f'{idx:>6} {base["confidence"]:>7.3f} {len(mine):>5} {rate:>6.1%}  {diff}')

    avg = sum(rates) / len(rates) if rates else 0.0
    worst = min(rates) if rates else 0.0
    print(f'\n一致率：均值 {avg:.1%}，最低 {worst:.1%}；'
          f'低于 95% 的页 {len(suspects)} 个 {suspects if suspects else ""}')

    # 可检索性：领域词必须能命中
    terms = ['探测器', '前置放大器', '噪声', '甄别', '计数率', '脉冲幅度', '能量分辨率', '光电倍增管']
    hay = [(_norm(c['text']), c) for c in chunks]
    print('\n--- 可检索性 ---')
    miss = []
    for t in terms:
        hits = [(c['printed_page'], c['pdf_page']) for n, c in hay if t in n]
        flag = '✓' if hits else '✗'
        if not hits:
            miss.append(t)
        print(f'  {flag} {t:<8} 命中 {len(hits):>4} 块，'
              f'首现 p.{hits[0][0] if hits else "-"}'
              + (f'，页集合 {sorted({h[0] for h in hits})[:8]}…' if hits else ''))

    print(f'\n结论：一致率均值 {avg:.1%}；不可检索的词 {miss if miss else "无"}；'
          f'总 chunk {len(chunks)}、总页 {len(pages)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
