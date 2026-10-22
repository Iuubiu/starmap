"""更稳的盘半径：排除右上角控件列后，取 ink 像素到质心距离的 99 分位当盘半径。"""
import math
import numpy as np
from PIL import Image

def check(path, n, tag, thr=60, right_cut=0):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = a.shape
    if right_cut:
        a = a[:, : w - right_cut]
    flat = a.reshape(-1, 3)
    packed = (flat[:,0].astype(np.int32)<<16)|(flat[:,1].astype(np.int32)<<8)|flat[:,2].astype(np.int32)
    vals, counts = np.unique(packed, return_counts=True)
    v = int(vals[int(np.argmax(counts))])
    bg = np.array([(v>>16)&255,(v>>8)&255,v&255], dtype=np.int16)
    mask = np.abs(a - bg).max(axis=2) > thr
    ys, xs = np.nonzero(mask)
    cx, cy = np.median(xs), np.median(ys)
    r = np.hypot(xs-cx, ys-cy)
    R = float(np.percentile(r, 98))
    A = math.pi * R**2
    spacing = math.sqrt(A / n)
    d = max(2.0, min(9.0, 241.3/math.sqrt(n)))
    print(f"{tag:18s} canvas {a.shape[1]}x{a.shape[0]}  center=({cx:.0f},{cy:.0f}) R98={R:.0f}px A={A:,.0f}px^2")
    print(f"{'':18s} n={n} meanSpacing={spacing:.2f}px nodeDiameter={d:.2f}px ratio={spacing/d:.2f} {'IMPOSSIBLE' if spacing<d else 'feasible'}")

check(".scratch/pw-t74g-manual/t74g/before-canvas.png", 3085, "current 340x480", right_cut=70)
check(".scratch/pw-t74g-manual/t74g/after-canvas.png", 3085, "widened 686x480", right_cut=70)
check(".scratch/pw-t44e-1792675615/t44e/early-canvas.png", 5495, "t44-era 932x481", right_cut=70)
