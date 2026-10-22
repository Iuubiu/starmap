import io, json, re, sys, collections
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path('tools/ingest').resolve()))
import translate as T
from naming import disambiguate_duplicate_names

TR = T.make_translator(T.load_overrides())
CONTENT = Path('content')
BOOKS = ['ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000',
         'knoll-4e-2010','leo-2e','lutz-2007','nakhostin-2018','nicholson-1974',
         'rivetti-2015','spieler-2005','tsoulfanidis-4e']

EMBED = re.compile(r'^\s*\d+(?:\.\d+)+\s+')

def dump(path, d, crlf):
    txt = json.dumps(d, ensure_ascii=False, indent=2)
    if crlf:
        txt = txt.replace('\n', '\r\n')
    path.write_bytes(txt.encode('utf-8'))

stat = {}
for sid in BOOKS:
    p = CONTENT / sid / 'toc.json'
    raw = p.read_bytes()
    crlf = b'\r\n' in raw
    d = json.loads(raw.decode('utf-8'))
    nodes = d.get('nodes', [])

    # 1) 找出塌缩组（同书内 name 相同、去编号后原文仍不同的组）
    byname = collections.defaultdict(list)
    for n in nodes:
        byname[n.get('name') or ''].append(n)
    retrans = 0
    for name, ns in byname.items():
        origs = sorted({(n.get('nameOriginal') or '') for n in ns if (n.get('nameOriginal') or '')})
        if len(origs) < 2:
            continue
        if len({T._normalize(o) for o in origs}) < 2:
            continue
        for n in ns:
            o = n.get('nameOriginal') or ''
            if not o:
                continue
            new = TR(o) or o
            if new != n.get('name'):
                n['name'] = new
                retrans += 1

    # 2) 译文里嵌了编号的（nameOriginal 非空且 name 以自身 num 开头）→ 剥掉
    stripped = 0
    for n in nodes:
        if not (n.get('nameOriginal') or ''):
            continue
        nm = n.get('name') or ''
        m = EMBED.match(nm)
        if m:
            n['name'] = nm[m.end():]
            stripped += 1

    # 3) 同书重名消歧（naming 是「编号」的合法来源）
    renames = disambiguate_duplicate_names(nodes)

    dump(p, d, crlf)
    stat[sid] = (retrans, stripped, len(renames))

print('sid | retranslated | stripped | renamed')
for k, v in stat.items():
    print(f'  {k:22s} {v[0]:5d} {v[1]:5d} {v[2]:5d}')
print('TOTAL', sum(v[0] for v in stat.values()), sum(v[1] for v in stat.values()), sum(v[2] for v in stat.values()))
