"""盘面几何可行性：最大连通块 bbox -> 盘面积 -> 平均间距 vs nodeDiameter。"""
import math
import numpy as np
from PIL import Image
from scipy import ndimage

def check(path, n, tag, thr=60):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = a.shape
    flat = a.reshape(-1, 3)
    packed = (flat[:,0].astype(np.int32)<<16)|(flat[:,1].astype(np.int32)<<8)|flat[:,2].astype(np.int32)
    vals, counts = np.unique(packed, return_counts=True)
    v = int(vals[int(np.argmax(counts))])
    bg = np.array([(v>>16)&255,(v>>8)&255,v&255], dtype=np.int16)
    mask = np.abs(a - bg).max(axis=2) > thr
    lab, nb = ndimage.label(mask)
    areas = np.bincount(lab.ravel())[1:]
    big = int(np.argmax(areas)) + 1
    ys, xs = np.nonzero(lab == big)
    bw, bh = xs.max()-xs.min()+1, ys.max()-ys.min()+1
    disk_area = math.pi * (min(bw,bh)/2)**2
    spacing = math.sqrt(disk_area / n)
    d = max(2.0, min(9.0, 241.3/math.sqrt(n)))
    print(f"{tag:20s} canvas {w}x{h}  biggest-blob bbox {bw}x{bh}  A_disk~{disk_area:,.0f}px^2")
    print(f"{'':20s} n={n}  meanSpacing={spacing:.2f}px  nodeDiameter={d:.2f}px  ratio={spacing/d:.2f}  {'IMPOSSIBLE (must overlap)' if spacing < d else 'feasible'}")

check(".scratch/pw-t74g-manual/t74g/before-canvas.png", 3085, "current 340x480")
check(".scratch/pw-t74g-manual/t74g/after-canvas.png", 3085, "widened 686x480")
check(".scratch/pw-t44e-1792675615/t44e/early-canvas.png", 5495, "t44-era 932x481")
