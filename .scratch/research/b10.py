import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save
T = {
 "memo_readme": "https://raw.githubusercontent.com/olmps/memo/main/README.md",
 "orbit_readme2": "https://raw.githubusercontent.com/andymatuschak/orbit/master/README.md",
 "razzia_readme": "https://raw.githubusercontent.com/Ralex91/Razzia/master/README.md",
 "remnote": "https://www.remnote.com/",
 "remnote_srs": "https://help.remnote.com/en/articles/7715110-spaced-repetition",
}
out={}
for k,u in T.items():
    try:
        t=text_of(get(u)); save(k+".txt",t); out[k]=len(t)
    except Exception as e: out[k]="ERR "+repr(e)
print(json.dumps(out,ensure_ascii=False,indent=1))
