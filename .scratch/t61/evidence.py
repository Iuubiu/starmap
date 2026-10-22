"""取证：把 t61 的关键证据以 UTF-8 写到文件（Windows 控制台是 GBK，中文打印会乱码）。"""
import io
import json
from pathlib import Path

OUT = Path('.scratch/t61/evidence.txt')
lines = []


def w(s=''):
    lines.append(s)


# 1) B 类：dinghonglin-2010 的前三个节点 + 子节点的 chunk
toc = json.loads(Path('content/radiation-detectors-dinghonglin-2010/toc.json').read_text(encoding='utf-8'))
w('== B 类：dinghonglin-2010 toc.json 前 4 个节点 ==')
for n in toc['nodes'][:4]:
    w(json.dumps({k: n.get(k) for k in ('microKpId', 'name', 'nameOriginal', 'num', 'printedPage', 'depth', 'isLeaf', 'parentId')}, ensure_ascii=False))
w()

w('== B 类：子节点自己名下的 chunk 文本（前 3 条） ==')
shown = 0
for line in io.open('content/radiation-detectors-dinghonglin-2010/chunks.jsonl', encoding='utf-8'):
    c = json.loads(line)
    if c.get('micro_kp_id') == 'kp-dinghonglin-2010-p1-作用与地位':
        w(f"  p{c.get('printed_page')} kind={c.get('kind')} text={c.get('text')[:160]!r}")
        shown += 1
        if shown >= 3:
            break
w()

# 2) A 类：10 处的前后兄弟
TARGETS = {
    'analog-electronics-tongshibai-5e': 'kp-tongshibai-5e-p598-晶体三极管模型及其参数',
    'nuclear-physics-experiment-methods-1997': [
        'kp-methods-1997-p28-带电粒子在靶物质中的慢化',
        'kp-methods-1997-p20-倍增过程统计学',
    ],
    'nuclear-radiation-physics-chenboxian-2011': 'kp-chenboxian-2011-13-4',
    'radiation-detector-handbook-jichangsong-1990': [
        'kp-jichangsong-1990-p472-光导纤维光导',
        'kp-jichangsong-1990-4-2-1',
    ],
}
w('== A 类：碎片在 toc.json 里的前后兄弟 ==')
for sid, ids in TARGETS.items():
    if isinstance(ids, str):
        ids = [ids]
    doc = json.loads(Path(f'content/{sid}/toc.json').read_text(encoding='utf-8'))
    nodes = doc['nodes']
    for tid in ids:
        idx = next((i for i, n in enumerate(nodes) if n.get('microKpId') == tid), None)
        if idx is None:
            w(f'[{sid}] {tid} NOT FOUND')
            continue
        w(f'[{sid}] {tid}  idx={idx}')
        for j in range(max(0, idx - 2), min(len(nodes), idx + 3)):
            n = nodes[j]
            mark = ' <== 碎片' if j == idx else ''
            w(
                f"   idx={j} num={n.get('num')!r} p={n.get('printedPage')} "
                f"d={n.get('depth')} leaf={n.get('isLeaf')} name={n.get('name')!r}{mark}"
            )
        w()

OUT.write_text('\n'.join(lines), encoding='utf-8')
print(f'written {len(lines)} lines to {OUT}')
