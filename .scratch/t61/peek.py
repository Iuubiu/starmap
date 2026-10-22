import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

p = 'content/radiation-detectors-dinghonglin-2010/toc.json'
d = json.load(open(p, encoding='utf-8'))
print('top keys:', list(d.keys()))
n0 = d['nodes'][0]
print('node keys:', list(n0.keys()))
for n in d['nodes'][:6]:
    print(repr(n.get('id')), repr(n.get('name')), repr(n.get('num')), n.get('page'), n.get('isLeaf'))
