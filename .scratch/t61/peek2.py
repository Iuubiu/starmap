import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

p = 'content/radiation-detectors-dinghonglin-2010/toc.json'
d = json.load(open(p, encoding='utf-8'))
nodes = d['nodes']
print('nodeCount field:', d['nodeCount'], 'len(nodes):', len(nodes))
print('nodes with microKpId:', sum(1 for n in nodes if n.get('microKpId')))
for n in nodes[:4]:
    print(json.dumps(n, ensure_ascii=False))
