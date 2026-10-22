# -*- coding: utf-8 -*-
"""t45 缺陷 A + B 的落地脚本（幂等，可重跑）。

A：用当前 GLOSSARY 按 `nameOriginal` 重译全部英文书节点。
B：重译后跑 naming 消歧；再把「name 以自身 num 开头」的**译文**前缀剥掉，
   只保留剥完仍与同书其它叶节点重名的那部分（那是 unavoidable，需要编号区分）。
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'ingest'))
from translate import load_overrides, make_translator  # noqa: E402
import naming  # noqa: E402

TR = make_translator(load_overrides())
CONTENT = ROOT / 'content'
NUM = re.compile(r'^\s*\d+(?:\.\d+)+\s+')
DRY = '--dry-run' in sys.argv


def dump(path: Path, data) -> None:
    """按原文件风格写回：2 空格缩进 + CRLF + 尾换行（实测 27 本都是这个风格）。"""
    text = json.dumps(data, ensure_ascii=False, indent=2).replace('\n', '\r\n') + '\r\n'
    if not DRY:
        path.write_bytes(text.encode('utf-8'))


stats = defaultdict(int)
for path in sorted(CONTENT.glob('*/toc.json')):
    sid = path.parent.name
    toc = json.loads(path.read_text(encoding='utf-8'))
    nodes = toc.get('nodes') or []

    # ---- A：按 nameOriginal 重译 ----
    changed_a = 0
    for n in nodes:
        orig = (n.get('nameOriginal') or '').strip()
        if not orig:
            continue
        new = TR(orig)
        if new and new != n.get('name'):
            n['name'] = new
            changed_a += 1
    stats['A retranslated'] += changed_a

    # ---- B：先跑消歧，再剥回「只是自己 num」的前缀 ----
    naming.disambiguate_duplicate_names(nodes)

    # 同书叶节点重名统计（剥之前）
    def leaf_names():
        d = defaultdict(list)
        for n in nodes:
            if n.get('isLeaf'):
                d[(n.get('name') or '').strip()].append(n)
        return d

    stripped = kept = 0
    for n in nodes:
        num = (n.get('num') or '').strip()
        nm = (n.get('name') or '').strip()
        if not num or not NUM.match(nm) or not nm.startswith(num + ' '):
            continue
        if not (n.get('nameOriginal') or '').strip():
            continue  # 中文原题自带编号，不动
        bare = nm[len(num):].lstrip()
        # 剥完是否与同书其它叶节点重名？
        clash = any(
            o is not n and (o.get('name') or '').strip() == bare
            for o in nodes if o.get('isLeaf')
        )
        if clash:
            kept += 1
            continue
        n['name'] = bare
        stripped += 1
    stats['B stripped'] += stripped
    stats['B kept (unavoidable)'] += kept

    dump(path, toc)
    if changed_a or stripped or kept:
        print(f'{sid:42s} A={changed_a:3d} B-strip={stripped:3d} B-keep={kept:3d}')

print(dict(stats), 'DRY' if DRY else 'WRITTEN')
