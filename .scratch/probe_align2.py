"""列基准判据对比：众数行 vs 边界支持度投票。

票 02 AC 第 2 条要求表格能还原出正确列。实测印刷页 40 的表2.1.1 原书 4 列
（基本定律 / 或 / 与 / 非），按「格数众数」取基准只得到 3 列 —— 因为数据行
大量只填 2–3 格（或/与列有上下两行合并），众数是 3，表头行才是 4 格。

反过来有些表表头是跨列标题被切碎，拿表头当基准会多出假列。所以对比
「边界支持度投票」：只有出现在一半以上行里的 x 分界才算真列分界。
"""
import sys
from collections import Counter

sys.path.insert(0, 'tools/ingest')
import pymupdf
import extract as E

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'


def row_bounds(r):
    xs = [x for _, x in r]
    return [(a + b) / 2 for a, b in zip(xs, xs[1:])]


def vote_bounds(rows, tol):
    """返回被足够多行支持的列分界。"""
    all_b = []
    for r in rows:
        if len(r) >= 2:
            all_b.extend(row_bounds(r))
    if not all_b:
        return []
    clusters = E._cluster(sorted(all_b), tol)
    support = Counter()
    for r in rows:
        if len(r) < 2:
            continue
        for b in row_bounds(r):
            for ci, cl in enumerate(clusters):
                if any(abs(b - v) <= tol for v in cl):
                    support[ci] += 1
                    break
    n = sum(1 for r in rows if len(r) >= 2)
    keep = sorted(ci for ci in support if support[ci] >= max(2, n * 0.5))
    return [sum(clusters[ci]) / len(clusters[ci]) for ci in keep]


def align(rows, bounds):
    edges = [-1e9] + list(bounds) + [1e9]
    out = []
    for r in rows:
        cols = [[] for _ in range(len(edges) - 1)]
        for t, x in r:
            for ci in range(len(edges) - 1):
                if edges[ci] <= x < edges[ci + 1]:
                    cols[ci].append(t)
                    break
        out.append([''.join(c) for c in cols])
    return out


def mode_align(rows):
    return E._align_rows(rows)


def report(pages):
    doc = pymupdf.open(PDF)
    for pg in pages:
        page = doc[pg]
        lines = E._group_lines(E._spans_of(page))
        body = E._page_body_edges(lines)
        bands = E._table_bands(lines)
        taken = {li for a, b in bands for li in range(a, b + 1)}
        bands = sorted(bands + [cb for cb in E._caption_bands(lines, body, taken)
                                if not (set(range(cb[0], cb[1] + 1)) & taken)])
        width = (body[1] - body[0]) if body else 1000
        for a, b in bands:
            region = [s for j in range(a, b + 1) for s in lines[j]]
            if not region:
                continue
            rows = [r for r in E._rows_from_chars(E._chars_within(page, region)) if r]
            if len(rows) < 2:
                continue
            m = mode_align(rows)
            vb = vote_bounds(rows, width * 0.02)
            v = align(rows, vb) if vb else m
            print(f'=== p{pg - 22} rows={len(rows)} counts={[len(r) for r in rows]}')
            print(f'    众数列数={len(m[0]) if m else 0}  投票列数={len(v[0]) if v else 0}')
            if len(m[0]) != len(v[0]):
                print('    [众数]', ' / '.join('|'.join(r) for r in m[:4]))
                print('    [投票]', ' / '.join('|'.join(r) for r in v[:4]))


if __name__ == '__main__':
    report([62, 50, 438, 110, 132])
