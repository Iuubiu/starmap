"""复算票面另一条验收：inner（中心不能空）。用亮核质心，按到盘心半径归一化。"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage

def inner(path, thr=80, right_cut=70):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    h, w, _ = a.shape
    a = a[:, : w - right_cut]
    flat = a.reshape(-1, 3)
    packed = (flat[:,0].astype(np.int32)<<16)|(flat[:,1].astype(np.int32)<<8)|flat[:,2].astype(np.int32)
    vals, counts = np.unique(packed, return_counts=True)
    v = int(vals[int(np.argmax(counts))]); bg = np.array([(v>>16)&255,(v>>8)&255,v&255], dtype=np.int16)
    mask = np.abs(a - bg).max(axis=2) > thr
    lab, nb = ndimage.label(mask)
    cents = np.array(ndimage.center_of_mass(mask, lab, range(1, nb+1)))
    pts = np.stack([cents[:,1], cents[:,0]], axis=1)
    cx, cy = pts[:,0].mean(), pts[:,1].mean()
    r = np.hypot(pts[:,0]-cx, pts[:,1]-cy)
    maxr = np.percentile(r, 99)
    norm = r / maxr
    return dict(peaks=int(len(pts)), inner30=round(float((norm <= 0.3).mean()),3),
                r0to10=round(float((norm <= 0.1).mean()),3),
                outer80to100=round(float(((norm >= 0.8) & (norm <= 1.0)).mean()),3),
                maxR=round(float(maxr),1))

for tag, p in [("current 340x480", ".scratch/pw-t74g-manual/t74g/before-canvas.png"),
               ("widened 686x480", ".scratch/pw-t74g-manual/t74g/after-canvas.png"),
               ("t44-era 932x481", ".scratch/pw-t44e-1792675615/t44e/early-canvas.png")]:
    print(tag, inner(p))
