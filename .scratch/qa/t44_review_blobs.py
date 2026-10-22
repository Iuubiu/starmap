"""
复算实现者报告里的像素指标：`tol=6`（只算接近纯节点色 #5A6A80 的像素）+ 4-连通。
用于核对 t44 报告声称的「默认视野 3677 blobs / 最大块 0.5%」。

同时给出我自己的一套（tol=26 / 8-连通），两套并列，避免只报好看的那一套。
"""
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image

NODE_COLOR = (0x5A, 0x6A, 0x80)  # unseen 的 STATUS_COLOR
BG = (0x12, 0x16, 0x1C)


def blobs(path, mode, tol, conn8):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    px = img.load()

    def ink(c):
        if mode == "nodecolor":
            # 只算接近纯节点色（实现者的口径）
            return all(abs(c[i] - NODE_COLOR[i]) <= tol for i in range(3))
        return any(abs(c[i] - BG[i]) > tol for i in range(3))

    mask = [[ink(px[x, y]) for x in range(w)] for y in range(h)]
    total = sum(sum(1 for v in row if v) for row in mask)
    seen = [[False] * w for _ in range(h)]
    sizes = []
    nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)] if conn8 else [
        (-1, 0), (1, 0), (0, -1), (0, 1)
    ]
    for y in range(h):
        for x in range(w):
            if not mask[y][x] or seen[y][x]:
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            size = 0
            while q:
                cx, cy = q.popleft()
                size += 1
                for dx, dy in nbrs:
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and mask[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            sizes.append(size)
    sizes.sort(reverse=True)
    return {
        "file": Path(path).name,
        "mode": mode,
        "tol": tol,
        "conn": 8 if conn8 else 4,
        "ink_px": total,
        "blobs": len(sizes),
        "largest_share": round(sizes[0] / total, 4) if total else 0,
        "median_blob": sizes[len(sizes) // 2] if sizes else 0,
    }


def main():
    out = []
    for p in sys.argv[1:]:
        if not Path(p).exists():
            out.append({"file": p, "error": "missing"})
            continue
        out.append(blobs(p, "nodecolor", 6, False))   # 实现者口径
        out.append(blobs(p, "nodecolor", 26, False))
        out.append(blobs(p, "bg", 26, True))          # 我的口径
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
