# -*- coding: utf-8 -*-
import json, subprocess
from pathlib import Path
REPO = Path('.').resolve()
EN = ['knoll-3e-2000','knoll-4e-2010','tsoulfanidis-4e','grupen-2e-2008','ahmed-2e',
      'spieler-2005','leo-2e','nakhostin-2018','rivetti-2015','lutz-2007','nicholson-1974',
      'gilmore-2e-2008','debertin-1988','guojiang-2023','guojiang-2014']

def counts_from_text(text):
    n=0; ans=0
    for line in text.splitlines():
        if not line.strip(): continue
        c=json.loads(line); n+=1
        if c.get('answer_for'): ans+=1
    return n,ans

def head_text(sid):
    r=subprocess.run(['git','show',f'HEAD:content/{sid}/chunks.jsonl'],capture_output=True,text=True,encoding='utf-8')
    return r.stdout

tot_b=tot_ba=tot_a=tot_aa=0
print(f'{"sourceId":<42}{"before":>8}{"ans":>7}{"pct":>8}{"after":>8}{"ans":>7}{"pct":>8}')
for sid in EN:
    b,ba = counts_from_text(head_text(sid))
    a,aa = counts_from_text((REPO/'content'/sid/'chunks.jsonl').read_text('utf-8'))
    tot_b+=b; tot_ba+=ba; tot_a+=a; tot_aa+=aa
    print(f'{sid:<42}{b:>8}{ba:>7}{100*ba/max(b,1):>7.1f}%{a:>8}{aa:>7}{100*aa/max(a,1):>7.1f}%')
print(f'{"TOTAL(15 EN)":<42}{tot_b:>8}{tot_ba:>7}{100*tot_ba/max(tot_b,1):>7.1f}%{tot_a:>8}{tot_aa:>7}{100*tot_aa/max(tot_a,1):>7.1f}%')
