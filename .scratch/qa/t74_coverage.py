"""独立交叉校验：盘内 ink 覆盖率 vs 理论覆盖率。
理论：n 个直径 d 的圆互不重叠时，盘内 ink 覆盖 = n*pi*(d/2)^2 / A_disk。
实测若显著高于理论 => 圆在互相压盖（糊成一团）；接近 => 逐点分开。
"""
import math
import numpy as np
from PIL import Image

def analyze(path, n, label):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = a.shape
    flat = a.reshape(-1, 3)
    packed = (flat[:,0].astype(np.int32)<<16)|(flat[:,1].astype(np.int32)<<8)|flat[:,2].astype(np.int32)
    vals, counts = np.unique(packed, return_counts=True)
    v = int(vals[int(np.argmax(counts))]); bg = np.array([(v>>16)&255,(v>>8)&255,v&255], dtype=np.int16)
    diff = np.abs(a - bg).max(axis=2)
    ink = diff > 60
    ys, xs = np.nonzero(ink)
    cx, cy = xs.mean(), ys.mean()
    r = np.hypot(xs - cx, ys - cy)
    disk_r = float(np.percentile(r, 99.5))
    yy, xx = np.mgrid[0:h, 0:w]
    inside = np.hypot(xx - cx, yy - cy) <= disk_r
    ink_in = ink & inside
    measured = ink_in.sum() / inside.sum()
    d = max(2.0, min(9.0, 241.3 / math.sqrt(n)))
    ideal = min(1.0, n * math.pi * (d / 2) ** 2 / (math.pi * disk_r ** 2))
    print(f"{label:18s} canvas {w}x{h} diskR={disk_r:.0f}px  A_disk={math.pi*disk_r**2:,.0f}px^2")
    print(f"{'':18s} nodeDiameter={d:.2f}px  measured ink-in-disk={measured:.3f}  ideal(non-overlap)={ideal:.3f}  ratio={measured/ideal:.2f}x  -> {'OVERLAPPING' if measured > ideal*1.35 else 'separate'}")

analyze(".scratch/pw-t74g-manual/t74g/before-canvas.png", 3085, "current 340x480")
analyze(".scratch/pw-t74g-manual/t74g/after-canvas.png", 3085, "widened 686x480")
analyze(".scratch/pw-t44e-1792675615/t44e/early-canvas.png", 5495, "t44-era 932x481")
