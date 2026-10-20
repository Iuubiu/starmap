"""保守规则测量：表头作基准只在「众数基准真的把两格并进一列」时才采用。

判据：
  1. header 格数 > 数据行格数众数；
  2. 用 header 的边界对齐时，数据行里**没有**两格落进同一列（零碰撞）；
  3. 用众数边界对齐时，数据行里**至少有一行**两格落进同一列（确实在并格）；
  4. 用 header 边界时每一列至少被一个数据格占用（防止表头被切碎后造出空列）。

第三条是这条规则的全部理由：并格是缺陷，空列只是浪费。只在前者成立、
后者不成立时替换。实测印刷页 40 的 4 列被压成 3 列（`A·A=A` 与 `A=A` 并进
同一列），印刷页 28 的 ASCII 表 9 列被压成 8 列；而印刷页 361 的表头
`引|脚|功|能` 被逐字切碎，用它对齐会出现整列无数据，必须拒绝。
"""
import sys

sys.path.insert(0, 'tools/ingest')
import pymupdf
import extract as E

PDF = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'


def bounds_of(ref):
    centers = [c[1] for c in ref]
    return [(a + b) / 2 for a, b in zip(centers, centers[1:])]


def place(rows, bounds):
    """把行里的格按边界归位，返回每行的列下标列表。"""
    edges = [-1e9] + list(bounds) + [1e9]
    out = []
    for row in rows:
        idxs = []
        for _text, xc in row:
            placed = len(edges) - 2
            for i in range(len(edges) - 1):
                if edges[i] <= xc < edges[i + 1]:
                    placed = i
                    break
            idxs.append(placed)
        out.append(idxs)
    return out


def collisions(idx_rows):
    n = 0
    for idxs in idx_rows:
        if len(idxs) != len(set(idxs)):
            n += len(idxs) - len(set(idxs))
    return n


def empty_columns(idx_rows, ncols):
    used = set()
    for idxs in idx_rows:
        used.update(idxs)
    return ncols - len(used)


def evaluate(ref, rows):
    b = bounds_of(ref)
    idx = place(rows, b)
    return collisions(idx), empty_columns(idx, len(ref)), idx


def main():
    doc = pymupdf.open(PDF)
    changed = 0
    for pg in range(24, 559):
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
            ref_mode = next(r for r in rows if len(r) == mode)
            data = rows[1:]
            cm, em, _ = evaluate(ref_mode, data)
            ch, eh, _ = evaluate(rows[0], data)
            ok = ch == 0 and cm > 0 and eh == 0
            if ok:
                changed += 1
                print(f'  p{pg - 22}: mode {mode} ({cm} 碰撞) -> header {counts[0]} (0 碰撞)')
    print('采用表头基准的表:', changed)


if __name__ == '__main__':
    main()
