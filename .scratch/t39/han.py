import glob, json, re
HAN = re.compile(r'[\u4e00-\u9fff]')
rows = []
for p in sorted(glob.glob('content/*/toc.json')):
    d = json.load(open(p, encoding='utf-8'))
    for n in d['nodes']:
        name = n['name'] or ''
        if not name:
            continue
        han = len(HAN.findall(name))
        rows.append((han / len(name), han, len(name), d['sourceId'], name))
rows.sort()
print('total names', len(rows))
for r in rows[:25]:
    print(f'ratio={r[0]:.3f} han={r[1]} len={r[2]}\t{r[3]}\t{r[4]!r}')
print('...')
# distribution
import statistics
ratios = [r[0] for r in rows]
for q in (0, 0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0):
    idx = min(len(ratios) - 1, int(q * len(ratios)))
    print(f'p{q*100:5.1f} ratio={ratios[idx]:.3f}')
# how many below thresholds
for t in (0.05, 0.1, 0.15, 0.2, 0.25, 0.3):
    print(f'below {t}: {sum(1 for r in ratios if r < t)}')
print('--- zero-han names', sum(1 for r in rows if r[1] == 0))
for r in rows:
    if r[1] == 0:
        print('   ', r[3], repr(r[4]))
