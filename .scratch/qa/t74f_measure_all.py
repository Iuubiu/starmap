import io
import json
import sys

sys.path.insert(0, ".scratch/qa")
import importlib.util

spec = importlib.util.spec_from_file_location("m", ".scratch/qa/t74_final_measure.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

files = [
    ("1440x900", ".scratch/pw-t74f-manual/t74f/canvas-1440x900.png"),
    ("1920x1080", ".scratch/pw-t74f-manual/t74f/canvas-1920x1080.png"),
    ("2560x1440", ".scratch/pw-t74f-manual/t74f/canvas-2560x1440.png"),
    ("1024x768", ".scratch/pw-t74f-manual/t74f/canvas-1024x768.png"),
]
out = []
for tag, p in files:
    r = m.report(p, None, tag)
    b60 = [b for b in r["blobs"] if b["thr"] == 60][0]
    b80 = [b for b in r["blobs"] if b["thr"] == 80][0]
    row = dict(
        tag=tag,
        size=r["size"],
        bg=r["bg"],
        ink60=b60["inkShare"],
        blobs60=b60["blobs"],
        largest60=b60["largestShare"],
        blobs80=b80["blobs"],
        largest80=b80["largestShare"],
        peaks=r["peakCount"],
        nn=r.get("nn"),
        sep=r["separable"],
    )
    out.append(row)
    print(tag.ljust(10), "size", r["size"], "bg", r["bg"])
    print(
        "   thr60 ink", b60["inkShare"], "blobs", b60["blobs"], "largest", b60["largestShare"],
        "| thr80 blobs", b80["blobs"], "largest", b80["largestShare"],
    )
    print("   peaks", r["peakCount"], "nn", r.get("nn"))
    print("   sep", r["separable"])

io.open(".scratch/qa/t74f-measure.json", "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
print("WROTE .scratch/qa/t74f-measure.json")
