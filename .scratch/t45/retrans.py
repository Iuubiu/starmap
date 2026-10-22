"""t45：把 27 本 toc.json 的 name 用当前 translate.py 按 nameOriginal 重译，再跑 naming 消歧。

只改 `name` 一个字段（chunk 的 micro_kp_id 是节点 id，与 name 无关），
`--dry-run` 只报统计不改盘。
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'ingest'))
from translate import load_overrides, make_translator, translate_title  # noqa: E402
from naming import disambiguate_duplicate_names  # noqa: E402

CONTENT = ROOT / 'content'
TR = make_translator(load_overrides())
FORBIDDEN = ('未收录术语', '未譯', 'TODO', '（原文）')
NUM_PREFIX = re.compile(r'^(\d+(?:\.\d+)+)\s+')


def stats(nodes):
    groups = {}
    for n in nodes:
        groups.setdefault(n['name'], set()).add(n.get('nameOriginal') or '')
    a = sum(1 for v in groups.values() if len(v) > 1)
    b = 0
    for n in nodes:
        if not (n.get('nameOriginal') or ''):
            continue
        m = NUM_PREFIX.match(n['name'])
        if m and m.group(1) == (n.get('num') or ''):
            b += 1
    return a, b


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--only')
    args = ap.parse_args(argv)
    tot_a = tot_b = tot_changed = 0
    for p in sorted(CONTENT.glob('*/toc.json')):
        sid = p.parent.name
        if args.only and sid != args.only:
            continue
        doc = json.loads(p.read_text(encoding='utf-8'))
        nodes = doc.get('nodes', [])
        a0, b0 = stats(nodes)
        changed = 0
        for n in nodes:
            orig = (n.get('nameOriginal') or '').strip()
            if not orig:
                continue
            new = TR(orig) or translate_title(orig)
            if not new or any(f in new for f in FORBIDDEN):
                continue
            if new != n['name']:
                n['name'] = new
                changed += 1
        renames = disambiguate_duplicate_names(nodes)
        a1, b1 = stats(nodes)
        tot_a += a1; tot_b += b1; tot_changed += changed
        print('%-42s nodes=%-5d retranslated=%-4d renamed=%-3d A %d->%d  B %d->%d'
              % (sid, len(nodes), changed, len(renames), a0, a1, b0, b1))
        if not args.dry_run:
            text = json.dumps(doc, ensure_ascii=False, indent=2) + '\n'
            p.write_bytes(text.replace('\n', '\r\n').encode('utf-8'))
    print('TOTAL retranslated=%d  A=%d  B=%d' % (tot_changed, tot_a, tot_b))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
