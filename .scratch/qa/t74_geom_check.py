import math
from PIL import Image
import numpy as np

def disk_bbox(p):
    a = np.asarray(Image.open(p).convert("RGB")).astype(np.int16)
    flat = a.reshape(-1,3)
    packed = (flat[:,0].astype(np.int32)<<16)|(flat[:,1].astype(np.int32)<<8)|flat[:,2].astype(np.int32)
    vals,counts = np.unique(packed, return_counts=True)
    v=int(vals[int(np.argmax(counts))]); bg=np.array([(v>>16)&255,(v>>8)&255,v&255],dtype=np.int16)
    m = (np.abs(a-bg).max(axis=2) > 80)
    ys,xs = np.nonzero(m)
    if len(xs)==0: return None
    return dict(w=int(xs.max()-xs.min()+1), h=int(ys.max()-ys.min()+1), inkpx=int(m.sum()))

def node_diameter(n):
    return max(2.0, min(9.0, 241.3/math.sqrt(max(1,n))))

for tag,p,n in [("now-340x480",".scratch/pw-t74g-manual/t74g/before-canvas.png",3085),
                ("after-686x480",".scratch/pw-t74g-manual/t74g/after-canvas.png",3085),
                ("t44-era-932x481",".scratch/pw-t44e-1792675615/t44e/early-canvas.png",5495)]:
    b = disk_bbox(p)
    d = min(b["w"], b["h"])
    area = math.pi*(d/2)**2
    spacing = math.sqrt(area/n)
    dia = node_diameter(n)
    print(f"{tag:16s} disk bbox {b['w']}x{b['h']}  n={n}  diskArea={area:,.0f}px^2")
    print(f"{'':16s} spacing=sqrt(A/n)={spacing:.2f}px  nodeDiameter({n})={dia:.2f}px  spacing/diameter={spacing/dia:.2f}  -> {'OVERLAP (impossible)' if spacing < dia else 'ok'}")
