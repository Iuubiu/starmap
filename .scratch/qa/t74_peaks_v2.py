"""修正版可分度度量：峰值必须先去重（同一 plateau 只算一个中心）。

上一版 bug：`dist == maximum_filter(dist)` 在平台上会返回一整片相邻像素，
最近邻距离 median 因此恒为 1.0，可分度被系统性低估。本版把局部极大 mask
再做一次连通标记，取每个连通块的质心作为唯一中心。
"""
import json
import math
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree


def bg_color(a):
    flat = a.reshape(-1, 3)
    packed = (flat[:, 0].astype(np.int32) << 16) | (flat[:, 1].astype(np.int32) << 8) | flat[:, 2].astype(np.int32)
    vals, counts = np.unique(packed, return_counts=True)
    v = int(vals[int(np.argmax(counts))])
    return np.array([(v >> 16) & 255, (v >> 8) & 255, v & 255], dtype=np.int16)


def measure(path, n_nodes, thr=60, footprint=5):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = a.shape
    bg = bg_color(a)
    mask = np.abs(a - bg).max(axis=2) > thr
    lab, nblob = ndimage.label(mask)
    areas = np.bincount(lab.ravel())[1:] if nblob else np.array([])
    keep = areas[areas >= 2]

    dist = ndimage.distance_transform_edt(mask)
    mx = ndimage.maximum_filter(dist, size=footprint)
    plateau = (dist == mx) & (dist >= 1.0)
    plab, nplat = ndimage.label(plateau)
    if nplat:
        cents = np.array(ndimage.center_of_mass(plateau, plab, range(1, nplat + 1)))  # (y, x)
        pts = np.stack([cents[:, 1], cents[:, 0]], axis=1)
    else:
        pts = np.empty((0, 2))

    nn = None
    if len(pts) >= 2:
        t = cKDTree(pts)
        d, _ = t.query(pts, k=2)
        nn = d[:, 1]

    diameter = max(2.0, min(9.0, 241.3 / math.sqrt(max(1, n_nodes))))
    out = dict(
        path=path,
        canvas=[w, h],
        bg=bg.tolist(),
        nodes=n_nodes,
        thr=thr,
        inkShare=round(float(mask.mean()), 4),
        blobs=int(len(keep)),
        largestShare=round(float(areas.max() / max(1, mask.sum())), 3) if nblob else 0.0,
        peaks=int(len(pts)),
        nodeDiameter=round(diameter, 2),
    )
    if nn is not None:
        out["nn"] = dict(
            n=int(len(nn)),
            median=round(float(np.median(nn)), 2),
            p10=round(float(np.percentile(nn, 10)), 2),
            p25=round(float(np.percentile(nn, 25)), 2),
            p50=round(float(np.percentile(nn, 50)), 2),
            p90=round(float(np.percentile(nn, 90)), 2),
        )
        out["separable"] = {f"at_{d:.2f}": round(float((nn > d).mean()), 3) for d in (diameter, 3.26, 4.34, 5.0)}
    return out


if __name__ == "__main__":
    targets = [
        (".scratch/pw-t74g-manual/t74g/before-canvas.png", 3085, "current-340x480"),
        (".scratch/pw-t74g-manual/t74g/after-canvas.png", 3085, "widened-686x480"),
        (".scratch/pw-t44e-1792675615/t44e/early-canvas.png", 5495, "t44-era-932x481"),
        (".scratch/pw-t44f-revert-1792676062/t44e/early-canvas.png", 5495, "reverted-932x481"),
    ]
    res = []
    for p, n, tag in targets:
        try:
            r = measure(p, n)
        except FileNotFoundError:
            print("MISSING", p)
            continue
        r["tag"] = tag
        res.append(r)
        print(f"== {tag}  canvas={r['canvas']} nodes={n} nodeDiameter={r['nodeDiameter']}px")
        print(f"   ink={r['inkShare']} blobs={r['blobs']} largestShare={r['largestShare']} peaks={r['peaks']}")
        print(f"   nn={r.get('nn')}")
        print(f"   separable={r.get('separable')}")
    json.dump(res, open(".scratch/qa/t74_peaks_v2.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
