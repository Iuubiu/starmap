"""t46 改前/改后对比：不修改任何文件，只在内存里还原旧行为。"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'ingest'))
import assign  # noqa: E402

CONTENT = ROOT / 'content'
ZH = {
    'analog-electronics-kanghuaguang-5e', 'analog-electronics-tongshibai-5e',
    'circuit-analysis-lihansun-5e-vol1', 'digital-electronics-yanshi-6e',
    'digital-kanghua-5e', 'nuclear-electronics-wangjingjin-1983',
    'nuclear-electronics-wangzhiying-1989', 'nuclear-physics-experiment-methods-1997',
    'nuclear-radiation-measurement-tangbin', 'nuclear-radiation-physics-chenboxian-2011',
    'radiation-detector-handbook-jichangsong-1990', 'radiation-detectors-dinghonglin-2010',
}

NEW_PUNCT = assign._PUNCT
OLD_PUNCT = '，。、；：'


def toc_names(sid):
    p = CONTENT / sid / 'toc.json'
    if not p.exists():
        return []
    nodes = json.loads(p.read_text(encoding='utf-8')).get('nodes', [])
    return [n.get('name') or '' for n in nodes if n.get('isLeaf')]


def count(sid, terms, punct):
    assign._PUNCT = punct
    total = ans = 0
    for line in (CONTENT / sid / 'chunks.jsonl').read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        c = json.loads(line)
        total += 1
        if assign.is_answer_block(c.get('text') or '', c.get('kind') or 'text', terms):
            ans += 1
    return total, ans


print(f'{"sourceId":46s} {"zh":2s} {"chunks":>7s} {"改前":>7s} {"改后":>7s}')
zt = za = et = ea = 0
zt2 = za2 = et2 = ea2 = 0
for cdir in sorted(CONTENT.iterdir()):
    if not (cdir / 'chunks.jsonl').exists():
        continue
    sid = cdir.name
    terms = toc_names(sid)
    total, before = count(sid, terms, OLD_PUNCT)
    _, after = count(sid, terms, NEW_PUNCT)
    zh = sid in ZH
    print(f'{sid:46s} {"中" if zh else "英":2s} {total:7d} {before:7d} {after:7d}')
    if zh:
        zt += total; za += before; zt2 += total; za2 += after
    else:
        et += total; ea += before; et2 += total; ea2 += after
print(f'中文书小计 {zt} 改前 {za} ({za/zt*100:.1f}%) -> 改后 {za2} ({za2/zt*100:.1f}%)')
print(f'英文书小计 {et} 改前 {ea} ({ea/et*100:.1f}%) -> 改后 {ea2} ({ea2/et*100:.1f}%)')
assign._PUNCT = NEW_PUNCT
