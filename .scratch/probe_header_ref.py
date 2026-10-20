"""验证「表头更宽时改用表头作列基准」这条判据。

实测背景：印刷页 40 的表2.1.1 原书 4 列，众数基准给 3 列（与/非被并）；
印刷页 28 的 ASCII 表原书 9 列，众数基准给 8 列（001/010 被并）。
两张表的共同点：**表头行的格数 > 数据行格数众数**。

反例检查：印刷页 416 的 555 功能表 counts=[2,5,5,4,3,2,5,2,5]，表头 2 格
（跨列表头「输入/输出」被切碎），此时 header < mode，判据不触发。
"""
import sys

sys.path.insert(0, 'tools/ingest')
import pymupdf
import extract as E

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'


def align(rows, ref):
    centers = [c[1] for c in ref]
    bounds = [-1e9] + [(a + b) / 2 for a, b in zip(centers, centers[1:])] + [1e9]
    grid = []
    for row in rows:
        cells = [''] * len(ref)
        for text, xc in row:
            idx = len(ref) - 1
            for i in range(len(ref)):
                if bounds[i] <= xc < bounds[i + 1]:
                    idx = i
                    break
            cells[idx] += text
        grid.append(cells)
    return grid


def main(pages=None):
    doc = pymupdf.open(PDF)
    hits = 0
    for pg in range(24, 559):
        if pages and pg not in pages:
            continue
        page = doc[pg]
        lines = E._group_lines(E._spans_of(page))
        body = E._page_body_edges(lines)
        bands = E._table_bands(lines)
        taken = {li for a, b in bands for li in range(a, b + 1)}
        bands = sorted(bands + [cb for cb in E._caption_bands(lines, body, taken)
                                if not (set(range(cb[0], cb[1] + 1)) & taken)])
        for a, b in bands:
            region = [s for j in range(a, b + 1) for s in lines[j]]
            if not region:
                continue
            rows = [r for r in E._rows_from_chars(E._chars_within(page, region)) if r]
            if len(rows) < 2:
                continue
            counts = [len(r) for r in rows]
            strong = [c for c in counts if c >= 2]
            if not strong:
                continue
            mode = max(set(strong), key=lambda n: (strong.count(n), n))
            if counts[0] <= mode or counts[0] < 3:
                continue
            hits += 1
            m = E._align_rows(rows)
            h = align(rows, rows[0])
            print(f'=== p{pg - 22} counts={counts}')
            print(f'    [众数 {len(m[0])} 列]', ' / '.join('|'.join(r) for r in m[:3]))
            print(f'    [表头 {len(h[0])} 列]', ' / '.join('|'.join(r) for r in h[:3]))
    print('触发次数', hits)


if __name__ == '__main__':
    main()
