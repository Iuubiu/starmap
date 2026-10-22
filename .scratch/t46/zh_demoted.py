"""t46：中文书里被新 _PUNCT 降级（不再算答案块）的块，抽样看是不是真公式。"""
import json
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
NEW = assign._PUNCT
OLD = '，。、；：'


def toc_names(sid):
    p = CONTENT / sid / 'toc.json'
    nodes = json.loads(p.read_text(encoding='utf-8')).get('nodes', []) if p.exists() else []
    return [n.get('name') or '' for n in nodes if n.get('isLeaf')]


demoted = []
for sid in sorted(ZH):
    f = CONTENT / sid / 'chunks.jsonl'
    if not f.exists():
        continue
    terms = toc_names(sid)
    for line in f.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        c = json.loads(line)
        t = c.get('text') or ''
        k = c.get('kind') or 'text'
        assign._PUNCT = OLD
        was = assign.is_answer_block(t, k, terms)
        assign._PUNCT = NEW
        now = assign.is_answer_block(t, k, terms)
        if was and not now:
            demoted.append((sid, k, t))

assign._PUNCT = NEW
print('demoted total:', len(demoted))
from collections import Counter
print(Counter(k for _, k, _ in demoted))
# 有没有「真公式形态」被降级：短、含 = 、标点里没有半角句读
suspicious = [d for d in demoted if d[1] == 'formula' and len(d[2]) < 80]
print('formula 且 <80 字的降级块:', len(suspicious))
for sid, k, t in demoted[:12]:
    print(f'  [{sid[:22]}] {k}: {t[:70]!r}')
print('---- 短 formula 降级样例 ----')
for sid, k, t in suspicious[:12]:
    print(f'  [{sid[:22]}] {t!r}')
