"""t74 重审：对当前字节的 /map 截图做我自己的可分度度量（不调用实现者断言函数）。

度量口径（独立实现）：
1. 从可见画布区域裁图，找背景色（众数）与节点亮核。
2. 用「与背景色差 > THR」的二值图 + 4-连通标记，统计 ink 比例、连通块数、最大块占比。
3. 用距离变换局部极大（footprint）估计节点中心，算最近邻距离分布。
4. separable(阈值 d) = 最近邻距离 > d 的比例。
"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def load(path, box=None):
    im = Image.open(path).convert("RGB")
    if box:
        im = im.crop(box)
    return np.asarray(im).astype(np.int16), im.size


def bg_color(a):
    # 众数颜色（画布底色占比最大）
    flat = a.reshape(-1, 3)
    packed = (flat[:, 0].astype(np.int32) << 16) | (flat[:, 1].astype(np.int32) << 8) | flat[:, 2].astype(np.int32)
    vals, counts = np.unique(packed, return_counts=True)
    v = int(vals[int(np.argmax(counts))])
    return np.array([(v >> 16) & 255, (v >> 8) & 255, v & 255], dtype=np.int16)


def blobs_at(a, bg, thr):
    diff = np.abs(a - bg).max(axis=2)
    mask = diff > thr
    lab, n = ndimage.label(mask)
    if n == 0:
        return dict(thr=thr, inkPx=0, inkShare=0.0, blobs=0, largestShare=0.0, areas=[])
    areas = np.bincount(lab.ravel())[1:]
    keep = areas[areas >= 2]
    return dict(
        thr=thr,
        inkPx=int(mask.sum()),
        inkShare=round(float(mask.mean()), 4),
        blobs=int(len(keep)),
        largestShare=round(float(areas.max() / max(1, mask.sum())), 3),
        areas=sorted(int(x) for x in keep)[-6:],
    )


def centers(a, bg, thr, footprint=4):
    diff = np.abs(a - bg).max(axis=2)
    mask = diff > thr
    dist = ndimage.distance_transform_edt(mask)
    mx = ndimage.maximum_filter(dist, size=footprint)
    peaks = (dist == mx) & (dist >= 1.0)
    ys, xs = np.nonzero(peaks)
    return np.stack([xs, ys], axis=1).astype(float), int(mask.sum())


def nn_stats(pts, scale=1.0):
    if len(pts) < 2:
        return dict(n=len(pts), median=None, p10=None, p90=None)
    from scipy.spatial import cKDTree

    t = cKDTree(pts)
    d, _ = t.query(pts, k=2)
    nn = d[:, 1] * scale
    return dict(
        n=int(len(pts)),
        median=round(float(np.median(nn)), 2),
        p10=round(float(np.percentile(nn, 10)), 2),
        p90=round(float(np.percentile(nn, 90)), 2),
        min=round(float(nn.min()), 2),
        max=round(float(nn.max()), 2),
    )


def separable(nn, thr):
    return round(float((nn > thr).mean()), 3) if nn is not None else None


def report(path, box=None, tag=""):
    a, size = load(path, box)
    bg = bg_color(a)
    out = {"tag": tag, "path": path, "crop": list(box) if box else None, "size": list(size), "bg": bg.tolist()}
    out["blobs"] = [blobs_at(a, bg, t) for t in (24, 60, 80)]
    pts, inkpx = centers(a, bg, 80)
    out["peakCount"] = int(len(pts))
    nn = None
    if len(pts) >= 2:
        from scipy.spatial import cKDTree

        t = cKDTree(pts)
        d, _ = t.query(pts, k=2)
        nn = d[:, 1]
        out["nn"] = nn_stats(pts)
    out["separable"] = {
        "at_4.34": separable(nn, 4.34),
        "at_3.26": separable(nn, 3.26),
        "at_5.00": separable(nn, 5.00),
    }
    return out


if __name__ == "__main__":
    target = sys.argv[1]
    box = None
    if len(sys.argv) > 5:
        box = (int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]))
    tag = sys.argv[6] if len(sys.argv) > 6 else ""
    print(json.dumps(report(target, box, tag), ensure_ascii=False, indent=1))
