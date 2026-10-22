import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path('content')
EN = ['ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010',
      'leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e']
OLD = set('，。、；：')
# 新判据：全角 + 半角逗号/分号/冒号 + 句点（排除小数点、排除数字内分隔）
NEW_RE = re.compile(r'[，。、；：,;:]|\.(?!\d)')
MAXP = 4
def old_cnt(t): return sum(1 for ch in t if ch in OLD)
def new_cnt(t): return len(NEW_RE.findall(t))
tot = {}
for p in sorted(ROOT.glob('*/chunks.jsonl')):
    sid = p.parent.name
    ans_old = ans_new = formula_old = formula_new = 0
    n = 0
    for line in p.read_text(encoding='utf-8').splitlines():
        if not line.strip(): continue
        c = json.loads(line); n += 1
        kind = c['kind']; t = c['text']
        was = bool(c.get('answer_for'))
        if was: ans_old += 1
        # 新规则下 is_answer_block 的 (A) 型判定
        if kind == 'table':
            new_ans = True
        elif kind == 'formula':
            new_ans = new_cnt(t) <= MAXP
        else:
            new_ans = None  # 定义型，取决于 terms，这里不重算
        if kind == 'formula':
            formula_old += 1
            if new_ans: formula_new += 1
        if was and new_ans is False:
            pass
    tot[sid] = (n, ans_old, formula_old, formula_new)
print(f'{"sourceId":44s} {"chunk":>6s} {"ansOld":>7s} {"fOld":>6s} {"fNewA":>6s}')
for sid,(n,a,fo,fn) in tot.items():
    mark = 'EN' if sid in EN else '  '
    print(f'{mark} {sid:41s} {n:6d} {a:7d} {fo:6d} {fn:6d}')
