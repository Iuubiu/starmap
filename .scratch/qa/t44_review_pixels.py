"""
t44 独立评审：从**渲染出来的像素**量可分辨度（reviewer-2 自己的度量）。

不调用实现者的任何断言函数，只吃 PNG。指标：

  ink        —— 非背景墨迹像素数（节点圆 + 标签 + 边）
  coverage   —— ink / 画布面积
  blobs      —— 8-连通墨迹团的数量（一团 = 一片粘连的节点）
  largest    —— 最大团的像素占 ink 的比例（越大越像「一坨」）
  singles    —— 面积落在单节点量级（≤ 4× 单点面积）的团数，近似「可逐点分辨的点数」
  inner      —— 墨迹落在内圈（半径 30%）的比例（甜甜圈布局会接近 0）
  radial     —— 10 等分径向密度剖面

同时用**同一套**度量处理对照图（反向验证产物），输出并排对比。
"""
import json
import math
import sys
from collections import deque
from pathlib import Path

from PIL import Image

# 深色画布底色 + 极淡网格（graph.css：background #12161c，网格点 #1e2632）
BG = (0x12, 0x16, 0x1C)


def load(path):
    return Image.open(path).convert("RGB")


def is_ink(px, tol=26):
    r, g, b = px
    # 背景 #12161c 与网格 #1e2632 都在这个范围内；节点色是 #5A6A80/#3f6fd0 等
    return abs(r - BG[0]) > tol or abs(g - BG[1]) > tol or abs(b - BG[2]) > tol


def analyze(path, tol=26):
    img = load(path)
    w, h = img.size
    px = img.load()
    ink = [[False] * w for _ in range(h)]
    total = 0
    for y in range(h):
        row = ink[y]
        for x in range(w):
            if is_ink(px[x, y], tol):
                row[x] = True
                total += 1

    # 8-连通分量
    seen = [[False] * w for _ in range(h)]
    sizes = []
    for y in range(h):
        for x in range(w):
            if not ink[y][x] or seen[y][x]:
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            size = 0
            while q:
                cx, cy = q.popleft()
                size += 1
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and ink[ny][nx]:
                            seen[ny][nx] = True
                            q.append((nx, ny))
            sizes.append(size)

    sizes.sort(reverse=True)
    blobs = len(sizes)
    largest = (sizes[0] / total) if total else 0.0

    # 单节点面积：直径约 3.26px 的圆 ≈ 8.3px；允许标签像素，取 4 倍作「单点量级」上界
    unit = math.pi * (3.26 / 2) ** 2
    singles = sum(1 for s in sizes if 6 <= s <= 4 * unit + 24)

    # 径向剖面（以墨迹质心为中心）
    sx = sy = 0
    for y in range(h):
        for x in range(w):
            if ink[y][x]:
                sx += x
                sy += y
    cx = sx / total if total else w / 2
    cy = sy / total if total else h / 2
    maxr = math.hypot(max(cx, w - cx), max(cy, h - cy))
    bins = [0] * 10
    inner = 0
    for y in range(h):
        for x in range(w):
            if not ink[y][x]:
                continue
            r = math.hypot(x - cx, y - cy) / maxr
            bins[min(9, int(r * 10))] += 1
            if r <= 0.3:
                inner += 1
    radial = [round(b / total, 4) if total else 0 for b in bins]

    return {
        "path": str(path),
        "size": [w, h],
        "ink": total,
        "coverage": round(total / (w * h), 4),
        "blobs": blobs,
        "largest_blob_share": round(largest, 4),
        "single_node_blobs": singles,
        "inner_ink_share": round(inner / total, 4) if total else 0,
        "radial_10": radial,
    }


def main():
    out = {}
    for arg in sys.argv[1:]:
        p = Path(arg)
        if not p.exists():
            out[str(p)] = {"error": "missing"}
            continue
        for tol in (26, 60):
            key = f"{p.stem}@tol{tol}"
            out[key] = analyze(p, tol)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
