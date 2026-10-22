import io, json, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path('tools/ingest').resolve()))
import translate as T

def strip_num(s: str) -> str:
    s2 = T._strip_number(T._normalize(s or ''))
    s2 = T._LEAD_ARTICLE.sub('', s2)
    return T._TRAIL_PUNCT.sub('', T._LEAD_PUNCT.sub('', s2)).strip()

CONTENT = Path('content')
bad = []
n_groups = 0
for p in sorted(CONTENT.glob('*/toc.json')):
    d = json.load(io.open(p, encoding='utf-8'))
    sid = d.get('sourceId') or p.parent.name
    byname = collections.defaultdict(list)
    for n in d.get('nodes', []):
        byname[n.get('name') or ''].append(n)
    for name, ns in byname.items():
        origs = sorted({(n.get('nameOriginal') or '') for n in ns if (n.get('nameOriginal') or '')})
        if len(origs) < 2:
            continue
        # 去掉编号后仍然不同的原文才算真塌缩
        distinct = sorted({strip_num(o) for o in origs})
        if len(distinct) < 2:
            continue          # 只是同一标题在不同章出现，正常
        n_groups += 1
        new = {T.translate_title(o) for o in origs}
        if len(new) < len(distinct):
            bad.append((sid, name, origs, sorted(new)))

print('真塌缩组（去编号后原文仍不同）:', n_groups)
print('修后仍塌缩:', len(bad))
for sid, name, origs, new in bad:
    print(' ', sid, '|', name, '->', new)
    for o in origs:
        print('      ', repr(o))
