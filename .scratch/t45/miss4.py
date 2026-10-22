import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0,'tools/ingest')
import translate as T
cases = [
 'thermoluminescent detector arrays','thermoluminescent detectors',
 'pulse counting','slow pulse counting',
 'DEPFET Pixel Detectors','Pixel Detectors',
 'Breaking parasitic current paths','Forward current',
]
for c in cases:
    before = dict(T._MISSING)
    out = T.translate_title(c)
    miss = {k:v for k,v in T._MISSING.items() if k not in before}
    print(f'{c!r:45s} -> {out!r:20s} missing={sorted(miss)}')
