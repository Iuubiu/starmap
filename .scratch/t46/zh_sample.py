"""t46：把中文书被降级的块写成 UTF-8 文件，供人眼判断是不是真公式。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'ingest'))
import assign  # noqa: E402

CONTENT = ROOT / 'content'
ZH = ['analog-electronics-kanghuaguang-5e', 'digital-kanghua-5e',
      'nuclear-electronics-wangzhiying-1989', 'nuclear-radiation-physics-chenboxian-2011']
NEW, OLD = assign._PUNCT, '，。、；：'


def toc_names(sid):
    p = CONTENT / sid / 'toc.json'
    nodes = json.loads(p.read_text(encoding='utf-8')).get('nodes', []) if p.exists() else []
    return [n.get('name') or '' for n in nodes if n.get('isLeaf')]


out = []
for sid in ZH:
    f = CONTENT / sid / 'chunks.jsonl'
    terms = toc_names(sid)
    n = 0
    for line in f.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        c = json.loads(line)
        t, k = c.get('text') or '', c.get('kind') or 'text'
        assign._PUNCT = OLD; was = assign.is_answer_block(t, k, terms)
        assign._PUNCT = NEW; now = assign.is_answer_block(t, k, terms)
        if was and not now:
            n += 1
            if n <= 8:
                out.append(f'[{sid}] kind={k} len={len(t)}\n  {t[:160]!r}\n')
    out.append(f'== {sid}: demoted {n}\n')
assign._PUNCT = NEW
(ROOT / '.scratch' / 't46' / 'zh_demoted.txt').write_text('\n'.join(out), encoding='utf-8')
print('written')
