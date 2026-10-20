import sys; sys.path.insert(0,"tools/ingest")
import extract as E, pymupdf, statistics
d = pymupdf.open("资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf")
page = d[50]
spans = E._spans_of(page)
print("spans:", len(spans))
xs = E._cluster([s['x'] for s in spans], 12); ys = E._cluster([s['y'] for s in spans], 10)
print("cols:", len(xs), "rows:", len(ys))
grid = len(xs)*len(ys)
print("grid cells:", grid, "spans:", len(spans), "fill:", len(spans)/grid)
short = sum(1 for s in spans if len(s['text'].strip())<=4)/len(spans)
print("short ratio:", round(short,3))
print("result:", "None" if E._reconstruct_table(spans) is None else "table")
