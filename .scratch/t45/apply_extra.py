# -*- coding: utf-8 -*-
"""把 .scratch/t45/extra.py 的 EXTRA 词表并进 translate.py 的 GLOSSARY。

过滤规则（保守）：
- 长度 1 的键（'e'/'f'/'m'/'z'/'d'/'li'/'he' 除外但 li/he 也是元素符号，保留）
  单字母键一律丢弃：它们几乎都是公式残片，加进词表只会让译文混入孤立字母。
- 明显 OCR 碎片（'pon'/'ller'/'ab'/'cros'/'clas'/'seri'/'statu'/'variou'/
  'mixtur'/'addres'/'anomalou'/'atla'/'homogeneou'/'compromis'/'challeng'/
  'babee'/'desenptor'/'auis'/'cwo'）保留 —— 它们是 _stem 后的形态，正是
  _lookup 里 stemmed 查表用的键。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'ingest'))
from translate import GLOSSARY  # noqa: E402

sys.path.insert(0, str(ROOT / '.scratch' / 't45'))
from extra import EXTRA  # noqa: E402

SKIP = {k for k in EXTRA if len(k) == 1}
missing = {k: v for k, v in EXTRA.items() if k not in SKIP and k not in GLOSSARY}
print('EXTRA total', len(EXTRA), 'skipped single-letter', len(SKIP), 'to add', len(missing))
(ROOT / '.scratch' / 't45' / 'missing.json').write_text(
    json.dumps(missing, ensure_ascii=False, indent=1, sort_keys=True), encoding='utf-8')
