import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path('.').resolve()
CONTENT = ROOT/'content'

NUM = re.compile(r'^\s*(\d+(?:\.\d+)+)\s+')
EN = {'ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010',
      'leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e'}
ZH = {'analog-electronics-kanghuaguang-5e','analog-electronics-tongshibai-5e','circuit-analysis-lihansun-5e-vol1',
      'digital-electronics-yanshi-6e','digital-kanghua-5e','nuclear-electronics-wangjingjin-1983',
      'nuclear-electronics-wangzhiying-1989','nuclear-physics-experiment-methods-1997',
      'nuclear-radiation-measurement-tangbin','nuclear-radiation-physics-chenboxian-2011',
      'radiation-detector-handbook-jichangsong-1990','radiation-detectors-dinghonglin-2010'}

# ① embedded number in translated names
embedded = []
for p in sorted(CONTENT.glob('*/toc.json')):
    for n in json.loads(p.read_text(encoding='utf-8')).get('nodes') or []:
        m = NUM.match(n.get('name') or '')
        if m and n.get('num') and m.group(1) == n['num'] and (n.get('nameOriginal') or '').strip():
            embedded.append((p.parent.name, n['microKpId'], n['name']))
print('① embedded-number translated names:', len(embedded))
for e in embedded[:10]: print('   ', e)

# ② prose-like formula + answer-block density per book
HINT = set('=∑∫√±×÷∞≈≤≥≠∂Δ')
def ascii_ratio(t):
    letters = sum(1 for c in t if c.isascii() and c.isalpha())
    return letters / max(1, len(t))
tot = {'en_chunk':0,'en_ans':0,'zh_chunk':0,'zh_ans':0}
prose = 0
per = []
for d in sorted(CONTENT.iterdir()):
    f = d/'chunks.jsonl'
    if not f.is_file(): continue
    sid = d.name
    ch = ans = 0; pr = 0
    for line in f.read_text(encoding='utf-8').splitlines():
        c = json.loads(line); ch += 1
        if c.get('kind') == 'formula' and len(c.get('text') or '') > 200 and ascii_ratio(c.get('text') or '') > 0.55:
            pr += 1
        if c.get('answer_for'): ans += 1
    prose += pr
    if sid in EN: tot['en_chunk'] += ch; tot['en_ans'] += ans
    if sid in ZH: tot['zh_chunk'] += ch; tot['zh_ans'] += ans
    if sid in EN: per.append((sid, ch, ans, pr))
print(f'② prose-like formula (len>200 & ascii>0.55): {prose}')
print(f'   EN chunks {tot["en_chunk"]}  answer {tot["en_ans"]} ({100*tot["en_ans"]/max(1,tot["en_chunk"]):.1f}%)')
print(f'   ZH chunks {tot["zh_chunk"]}  answer {tot["zh_ans"]} ({100*tot["zh_ans"]/max(1,tot["zh_chunk"]):.1f}%)')
print('   per-book EN:')
for sid, ch, ans, pr in per:
    print(f'     {sid:24s} chunk {ch:5d} answer {ans:5d} ({100*ans/max(1,ch):5.1f}%)  prose-formula {pr}')
