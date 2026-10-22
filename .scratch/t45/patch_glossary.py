# -*- coding: utf-8 -*-
"""把 220 个实测缺词并进 translate.py 的 GLOSSARY（插在 'kinematics' 之后）。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'tools' / 'ingest' / 'translate.py'
missing = json.loads((ROOT / '.scratch' / 't45' / 'missing.json').read_text(encoding='utf-8'))

ANCHOR = "    'kinematics': '运动学',\n}\n"
src = TARGET.read_bytes().decode('utf-8')
assert src.count(ANCHOR) == 1, src.count(ANCHOR)

# 按每行 3 条排，便于审阅
items = sorted(missing.items())
rows = []
for i in range(0, len(items), 3):
    chunk = items[i:i + 3]
    rows.append('    ' + ' '.join(f"{k!r}: {v!r},".replace("'", "'") for k, v in chunk))
block = (
    "    # ---- t45 缺陷 A：其余实测缺词（229 个 `_translate_words` 未命中的词干）----\n"
    "    # 来源：全库 6062 个节点名逐词扫 `GLOSSARY` 未命中，剔除编号/冠词/连字误报后\n"
    "    # 剩下的真实词干。补它们是为了让不同英文标题译出不同中文名（缺陷 A），\n"
    "    # 不是为了把译文变长 —— 每条都至少消掉一组塌缩或一个英文残留。\n"
    + '\n'.join(rows) + '\n'
)
out = src.replace(ANCHOR, "    'kinematics': '运动学',\n" + block + "}\n")
TARGET.write_bytes(out.encode('utf-8'))
print('patched, new size', len(out.encode('utf-8')))
